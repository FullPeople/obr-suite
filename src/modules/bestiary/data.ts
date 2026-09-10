import { Monster, ParsedMonster, MonsterEdition } from "./types";
import { getState, getLocalLang } from "../../state";
import { selectContentLibraries, contentConfigurationKey } from "../../utils/contentLocale";
import { annotateMonster, canonicalMonsterKey, monsterFingerprint } from "./provenance";
import { fetchContentJson, mapWithConcurrency, createContentIdleDeadline } from "../../utils/contentRequests";
import { getAllLocalMonsters, initLocalContent } from "../../utils/localContent";

// "2014" = strictly PHB + MM (the original core books). "2024" = strictly
// XPHB + XMM (the 2024 reprint). Every other source — DMG/XDMG, TCE, XGE,
// MTF, MPMM, BGG, FTD, etc. — counts as `other` and is ALWAYS visible
// regardless of the user's 2014/2024 toggle. Per user feedback 2026-04-27.
const EDITION_2014_CORE = new Set(["PHB", "MM"]);
const EDITION_2024_CORE = new Set(["XPHB", "XMM"]);

function detectEdition(source: string): MonsterEdition {
  source = source.trim().toUpperCase();
  if (EDITION_2014_CORE.has(source)) return "2014";
  if (EDITION_2024_CORE.has(source)) return "2024";
  return "other";
}

// Shared locale policy; disabled libraries are never silently restored.
function getLibrarySources() {
  return selectContentLibraries(getState().libraries ?? [], getLocalLang());
}
let cacheContext = "";
function ensureMonsterContext() {
  const next = contentConfigurationKey(getState().libraries ?? [], getLocalLang());
  if (next !== cacheContext) { cacheContext = next; clearMonsterCache(); }
}
// Images: use the same CORS-enabled kiwee mirror as the default data source.
// Do not route these through 5e.tools: its Cloudflare challenge can return
// cacheable HTML/403 responses instead of image bytes to our reverse proxy.
const IMG_BASE = "https://5e.kiwee.top/img";

const SIZE_MAP: Record<string, string> = {
  T: "超小型", S: "小型", M: "中型", L: "大型", H: "巨型", G: "超巨型",
};

// 2026-05-17 — accepts BOTH shapes used by the various data sources:
//   • number              → 5etools-style "ac: 15"
//   • array               → 5etools "ac: [15]" / "ac: [{ac:15, from:[...]}]"
//   • string              → digit-only "15" (rare; fall back parsing)
// Previously only handled the array shape; monster-studio's exporter
// emits a plain number for ACs without source notes, so the bestiary
// fell back to 10 for every monster authored there. User report:
// "怪物编辑器中不管填写AC为多少，最后绑定在token上时AC都显示为10".
function parseAC(ac: any): number {
  if (ac == null) return 10;
  if (typeof ac === "number" && Number.isFinite(ac)) return ac;
  if (typeof ac === "string") {
    const m = /(\d+)/.exec(ac);
    if (m) return Number(m[1]);
    return 10;
  }
  if (Array.isArray(ac) && ac.length > 0) {
    const first = ac[0];
    if (typeof first === "number") return first;
    if (first && typeof first === "object" && "ac" in first) {
      const v = (first as any).ac;
      if (typeof v === "number") return v;
    }
  }
  return 10;
}

function parseType(type: any): string {
  if (!type) return "unknown";
  if (typeof type === "string") return type;
  if (typeof type === "object") {
    const t = type.type;
    return typeof t === "string" ? t : JSON.stringify(t) || "unknown";
  }
  return String(type);
}

// Replicates 5etools Parser.nameToTokenName: toAscii + strip quotes
// We can't call toAscii (it's a String prototype extension), so we approximate
// with just removing quotes — most English monster names are already ASCII.
function nameToTokenName(name: string): string {
  return (name || "").replace(/"/g, "");
}

function buildTokenUrl(m: any): string {
  // Matches 5etools Renderer.monster.getTokenUrl logic, plus our
  // homebrew extensions:
  //   • `tokenHref: { type: "external", url }`  → external image (used
  //     by local-content packs that ship their own token URLs instead
  //     of relying on the IMG_BASE convention)
  //   • `tokenHref: { type: "internal", path }` → IMG_BASE-relative
  //   • `tokenUrl: "..."`                       → legacy direct URL
  if (m.tokenHref && typeof m.tokenHref === "object") {
    const th = m.tokenHref;
    if (th.type === "external" && typeof th.url === "string" && th.url) return th.url;
    if (th.type === "internal" && typeof th.path === "string" && th.path) {
      return `${IMG_BASE}/${th.path.replace(/^\/+/, "")}`;
    }
  }
  if (m.tokenUrl) return m.tokenUrl; // legacy
  if (m.token?.source && m.token?.name) {
    return `${IMG_BASE}/bestiary/tokens/${m.token.source}/${encodeURIComponent(nameToTokenName(m.token.name))}.webp`;
  }
  if (m.hasToken === false) return "";
  const src = m.source;
  const nm = m.ENG_name || m.name;
  if (!src || !nm) return "";
  return `${IMG_BASE}/bestiary/tokens/${src}/${encodeURIComponent(nameToTokenName(nm))}.webp`;
}

/** Parse a 5etools-style HP block to a single number. The standard
 *  shape is `{ average: 63, formula: "7d10+21" }` but homebrew /
 *  custom bestiary entries sometimes use `{ special: "96" }` (or
 *  `{ special: 96 }`) when the author just wants to specify a flat
 *  number without a formula. We accept both forms. Falls back to 0
 *  when none of the recognised shapes are present. */
export function parseHpNumber(hp: any): number {
  if (typeof hp === "number") return hp;
  if (hp && typeof hp === "object") {
    if (typeof hp.average === "number") return hp.average;
    if (typeof hp.special === "number") return hp.special;
    if (typeof hp.special === "string") {
      // Try plain integer first, then leading-digit extract for
      // values like "96 (8d8 + 60)".
      const n = parseInt(hp.special, 10);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function parseMon(m: any): ParsedMonster | null {
  try {
    if (!m || !m.name) return null;
    const source = m.source || "?";
    return {
      name: m.name || "???",
      engName: m.ENG_name || m.name || "???",
      source,
      ac: parseAC(m.ac),
      hp: parseHpNumber(m.hp),
      dexMod: Math.floor(((m.dex || 10) - 10) / 2),
      cr: m.cr ?? "?",
      size: (getLocalLang() === "en" ? { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" } as Record<string, string> : SIZE_MAP)[m.size?.[0]] || m.size?.[0] || "?",
      sizeCode: m.size?.[0],
      contentLanguage: m._suiteContent?.language ?? "auto",
      authored: m._suiteContent?.authored === true,
      aliases: m._suiteAliases ?? [],
      type: parseType(m.type),
      tokenUrl: buildTokenUrl(m),
      edition: detectEdition(source),
    };
  } catch {
    return null;
  }
}

let cachedMonsters: ParsedMonster[] | null = null;
let loadingPromise: Promise<ParsedMonster[]> | null = null;
const rawBySlug = new Map<string, any>();
let loadGeneration = 0;
let activeLoadController: AbortController | null = null;
export interface MonsterLoadProgress {
  loadedFiles: number;
  failedFiles: number;
  preview: ParsedMonster[];
}
let lastLoadProgress: MonsterLoadProgress = { loadedFiles: 0, failedFiles: 0, preview: [] };
const progressListeners = new Set<(progress: MonsterLoadProgress) => void>();
function reportProgress(progress: MonsterLoadProgress) {
  lastLoadProgress = progress;
  for (const listener of progressListeners) {
    try { listener(progress); } catch (error) { console.warn("[bestiary] progress listener failed", error); }
  }
}

/** Drop the cached monster list so the next loadAllMonsters() pulls
 *  fresh data. Called when the user imports / removes local content
 *  via the settings panel — the bestiary module subscribes to the
 *  BC_LOCAL_CONTENT_CHANGED broadcast and forwards it here. */
export function clearMonsterCache(): void {
  loadGeneration++;
  activeLoadController?.abort();
  activeLoadController = null;
  cachedMonsters = null;
  loadingPromise = null;
  rawBySlug.clear();
  lastLoadProgress = { loadedFiles: 0, failedFiles: 0, preview: [] };
}

// slug uniquely identifies a monster across sources: "MM::Goblin"
export function makeSlug(source: string, engName: string): string {
  return `${source || "?"}::${engName || "?"}`;
}

export function getRawMonster(slug: string): any | null {
  ensureMonsterContext();
  return rawBySlug.get(slug) ?? rawBySlug.get(canonicalMonsterKey(slug)) ?? null;
}

// 5etools `_copy` support. A monster can be defined as a diff on top of another
// monster (same or different source), with `_mod` describing per-field edits.
// We implement the most common mod modes: replaceArr / insertArr / appendArr /
// prependArr / removeArr. This is enough for stats + action sections to render.
function applyMod(target: any, field: string, spec: any) {
  if (!spec || typeof spec !== "object") return;
  const mode = spec.mode;
  const items = spec.items === undefined ? [] : (Array.isArray(spec.items) ? spec.items : [spec.items]);
  if (mode === "replaceArr") {
    if (!Array.isArray(target[field])) return;
    const needle = spec.replace;
    const idx = target[field].findIndex((x: any) => {
      if (typeof needle === "string") {
        return x && (x.name === needle || x.ENG_name === needle);
      }
      if (needle && typeof needle === "object") {
        return x && (x.name === needle.name || x.ENG_name === needle.ENG_name);
      }
      return false;
    });
    if (idx !== -1) target[field].splice(idx, 1, ...items);
  } else if (mode === "insertArr") {
    if (!Array.isArray(target[field])) target[field] = [];
    const at = typeof spec.index === "number" ? spec.index : target[field].length;
    target[field].splice(at, 0, ...items);
  } else if (mode === "appendArr") {
    if (!Array.isArray(target[field])) target[field] = [];
    target[field].push(...items);
  } else if (mode === "prependArr") {
    if (!Array.isArray(target[field])) target[field] = [];
    target[field].unshift(...items);
  } else if (mode === "removeArr") {
    if (!Array.isArray(target[field])) return;
    const names = Array.isArray(spec.names) ? spec.names : (spec.names ? [spec.names] : []);
    target[field] = target[field].filter(
      (x: any) => !names.some((n: any) => x && (x.name === n || x.ENG_name === n))
    );
  }
  // Other modes (addSpells, scalarMultProp, etc.) intentionally not handled —
  // falls through to parent data, which is still better than zeros.
}

export function resolveCopy(m: any, bySlug: Map<string, any>, stack: Set<string>): any {
  if (!m || !m._copy) return m;
  const parentSource = m._copy.source;
  // Some homebrew sources (notably WTTHC) reference the parent by
  // Chinese name in `_copy.name` while the parent itself is keyed by
  // `ENG_name`. Try both before giving up — if either match wins we
  // still get a fully merged stat block.
  const candidateNames = [
    m._copy.ENG_name,
    m._copy.name,
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  let parentSlug = "";
  let parent: any = null;
  for (const nm of candidateNames) {
    const slug = makeSlug(parentSource, nm);
    const found = bySlug.get(slug) ?? bySlug.get(canonicalMonsterKey(slug));
    if (found) { parentSlug = slug; parent = found; break; }
  }
  if (!parent) return m;
  if (stack.has(parentSlug)) return m; // cycle guard
  stack.add(parentSlug);
  const resolvedParent = parent._copy ? resolveCopy(parent, bySlug, stack) : parent;
  stack.delete(parentSlug);

  // Deep-clone parent so _mod edits don't leak into siblings that share it.
  const merged: any = JSON.parse(JSON.stringify(resolvedParent));
  // Child's own fields override parent. Keep parent's name/source though —
  // use child's for identity.
  for (const [k, v] of Object.entries(m)) {
    if (k === "_copy" || k === "_mod") continue;
    if (v !== undefined && v !== null) merged[k] = v;
  }
  // A new named child without an English alias must not inherit its parent's
  // identity. This is common for locally authored variants of translated data.
  if (!m.ENG_name && m.name !== resolvedParent.name) delete merged.ENG_name;

  if (m._copy._mod) {
    const mods = m._copy._mod;
    for (const [field, modSpec] of Object.entries(mods)) {
      if (Array.isArray(modSpec)) {
        for (const s of modSpec) applyMod(merged, field, s);
      } else {
        applyMod(merged, field, modSpec);
      }
    }
  }
  if (merged._suiteContent) merged._suiteContent = { ...merged._suiteContent, fingerprint: monsterFingerprint(merged) };
  return merged;
}

/** Name-based edits must target the language they were authored against. */
export function copyModTargetsAvailable(child: any, parent: any): boolean {
  const draft = JSON.parse(JSON.stringify(parent));
  for (const [field, values] of Object.entries(child?._copy?._mod ?? {})) {
    for (const spec of Array.isArray(values) ? values : [values]) {
      const entries = Array.isArray(draft[field]) ? draft[field] : [];
      if (spec?.mode === "replaceArr") {
        const needle = spec.replace;
        if (!entries.some((entry: any) => typeof needle === "string"
          ? entry?.name === needle || entry?.ENG_name === needle
          : needle && (entry?.name === needle.name || entry?.ENG_name === needle.ENG_name))) return false;
      }
      if (spec?.mode === "removeArr") {
        const names = Array.isArray(spec.names) ? spec.names : spec.names ? [spec.names] : [];
        if (!names.every((name: string) => entries.some((entry: any) => entry?.name === name || entry?.ENG_name === name))) return false;
      }
      applyMod(draft, field, spec);
    }
  }
  return true;
}

export async function loadAllMonsters(
  onProgress?: (progress: MonsterLoadProgress) => void,
): Promise<ParsedMonster[]> {
  ensureMonsterContext();
  if (onProgress) {
    progressListeners.add(onProgress);
    onProgress(lastLoadProgress);
  }
  try {
    if (cachedMonsters) return cachedMonsters;
    if (!loadingPromise) {
      const generation = loadGeneration;
      const controller = new AbortController();
      activeLoadController = controller;
      const pending = performMonsterLoad(generation, controller.signal);
      loadingPromise = pending;
      void pending.finally(() => {
        if (loadingPromise === pending) loadingPromise = null;
        if (activeLoadController === controller) activeLoadController = null;
      }).catch(() => {});
    }
    return await loadingPromise;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

async function performMonsterLoad(generation: number, signal: AbortSignal): Promise<ParsedMonster[]> {
    await initLocalContent();
    if (generation !== loadGeneration) return [];
    const sources = getLibrarySources();
    const bases = [...new Set(sources.map((source) => source.base))];
    const localMonsters = getAllLocalMonsters().map((monster) => annotateMonster(monster)) as Monster[];
    const annotated = new WeakMap<object, Map<string, any>>();
    const tag = (monster: any, source: typeof sources[number]) => {
      if (!annotated.has(monster)) annotated.set(monster, new Map());
      const versions = annotated.get(monster)!;
      if (!versions.has(source.identity)) versions.set(source.identity, annotateMonster(monster, source));
      return versions.get(source.identity);
    };
    const candidates = () => sources.map((source) => ({ source, monsters: (perLibraryMonsters[bases.indexOf(source.base)] ?? []).flat()
      .filter((monster) => monster && typeof monster === "object" && !source.disabledSources.has(String(monster.source ?? "").trim().toLowerCase()))
      .map((monster) => tag(monster, source)) }));
    const perLibraryMonsters: Monster[][][] = bases.map(() => []);
    const failed = new Set<string>();
    let loadedFiles = 0;
    let lastPreviewAt = 0;
    function publish(force = false) {
      if (generation !== loadGeneration) return;
      if (!force && Date.now() - lastPreviewAt < 200) return;
      lastPreviewAt = Date.now();
      // Preview rows are read-only until the complete, ordered inheritance
      // merge below. Incomplete _copy records must never be spawned.
      const preview = [...localMonsters, ...candidates().flatMap((candidate) => candidate.monsters)]
        .filter((m: any) => m && !m._copy)
        .map(parseMon)
        .filter((m): m is ParsedMonster => m !== null);
      const seen = new Set<string>();
      reportProgress({ loadedFiles, failedFiles: failed.size, preview: preview.filter((m) => {
        const key = `${m.source.trim().toUpperCase()}::${m.engName.trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }) });
    }
    publish(true);
    await Promise.all(bases.map(async (base, libraryIndex) => {
      // This is an inactivity deadline, not a total time budget: large healthy
      // libraries must finish even when their total load takes over 30 seconds.
      const sourceDeadline = createContentIdleDeadline(30_000, signal);
      const request = (path: string) => fetchContentJson(`${base}/${path}`, { cache: "no-cache", signal: sourceDeadline.signal });
      const recordFailure = (path: string, error: unknown) => {
        if (signal.aborted) return;
        const key = sourceDeadline.signal.aborted ? `${base}/timeout` : `${base}/${path}`;
        if (failed.has(key)) return;
        failed.add(key);
        console.warn("[obr-suite/bestiary] content unavailable", { base, path, error });
      };
      try {
        if (signal.aborted) return;
        let files: string[] | null = null;
        try {
          const response = await request("data/bestiary/index.json");
          if (response.ok) {
            const index = await response.json();
            if (!index || typeof index !== "object" || Array.isArray(index)) throw new Error("Invalid bestiary index");
            files = [...new Set(Object.entries(index).filter(([code, name]) => typeof name === "string" &&
              sources.some((source) => source.base === base && !source.disabledSources.has(code.trim().toLowerCase())))
              .map(([, name]) => name as string))];
            sourceDeadline.progress();
          } else if (response.status !== 404) recordFailure("data/bestiary/index.json", `HTTP ${response.status}`);
        } catch (error) { recordFailure("data/bestiary/index.json", error); }
        if (files !== null) {
          await mapWithConcurrency(files, 2, async (filename, fileIndex) => {
            try {
              const response = await request(`data/bestiary/${filename}`);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const data = await response.json();
              if (!Array.isArray(data.monster)) throw new Error("Invalid monster list");
              perLibraryMonsters[libraryIndex][fileIndex] = data.monster;
              loadedFiles++;
              sourceDeadline.progress();
            } catch (error) { recordFailure(`data/bestiary/${filename}`, error); }
            publish();
          });
        } else {
          const paths = [...new Set(sources.filter((source) => source.base === base).map((source) => source.indexPath))];
          const sourceCodes = new Set<string>();
          for (const path of paths) {
            try {
              const response = await request(path);
              if (!response.ok) throw new Error(`Search index HTTP ${response.status}`);
              const index = await response.json();
              if (!Array.isArray(index.x)) throw new Error("Invalid search index");
              sourceDeadline.progress();
              const codesById = new Map<number, string>(Object.entries(index.m?.s ?? {}).map(([code, id]) => [Number(id), code]));
              for (const entry of index.x) {
                const code = typeof entry?.s === "string" ? entry.s : codesById.get(entry?.s);
                if (entry?.c === 1 && typeof code === "string" && code) sourceCodes.add(code);
              }
            } catch (error) { recordFailure(path, error); }
          }
          const fallbackSources = [...sourceCodes];
          await mapWithConcurrency(fallbackSources.filter((code) => sources.some((source) => source.base === base && !source.disabledSources.has(code.toLowerCase()))), 2, async (source, fileIndex) => {
            for (const variant of new Set([source, source.toLowerCase(), source.toUpperCase()])) {
              try {
                const response = await request(`data/bestiary/bestiary-${variant}.json`);
                if (!response.ok) continue;
                const data = await response.json();
                if (!Array.isArray(data.monster)) throw new Error("Invalid monster list");
                perLibraryMonsters[libraryIndex][fileIndex] = data.monster;
                loadedFiles++;
                sourceDeadline.progress();
                publish();
                return;
              } catch (error) {
                if (sourceDeadline.signal.aborted) break;
              }
            }
            recordFailure(`data/bestiary/bestiary-${source}.json`, "No available case variant");
            publish();
          });
        }
      } catch (error) { recordFailure("index", error); }
      finally {
        sourceDeadline.dispose();
        publish(true);
      }
    }));
    if (generation !== loadGeneration) return [];
    // Resolve inheritance before choosing translations. Same-library parents
    // come first; compatible libraries can supply missing core dependencies.
    const candidateGroups = candidates();
    const remoteMonsters: any[] = [];
    const allGroups = candidateGroups.map((group) => ({ monsters: group.monsters, parents: [
      ...group.monsters,
      // Homebrew libraries may depend on a separately configured core library.
      // Keep known translations apart; unknown-language sources retain that
      // cross-library dependency behavior without claiming translated prose.
      ...candidateGroups.filter((other) => other !== group && (group.source.language === "auto" || other.source.language === "auto" || other.source.language === group.source.language))
        .flatMap((other) => other.monsters),
    ] }));
    for (const group of allGroups) {
      const candidatesBySlug = new Map<string, any[]>();
      for (const monster of group.parents) {
        if (!monster?.name) continue;
        for (const name of [monster.ENG_name, monster.name]) if (name) {
          const key = canonicalMonsterKey(makeSlug(monster.source, name));
          const values = candidatesBySlug.get(key) ?? [];
          if (!values.includes(monster)) values.push(monster);
          candidatesBySlug.set(key, values);
        }
      }
      const resolved = new Map<any, any>();
      const resolveCandidate = (monster: any, stack = new Set<any>()): any | null => {
        if (!monster._copy) return monster;
        if (stack.has(monster)) return null;
        if (resolved.has(monster)) return resolved.get(monster);
        const copy = monster._copy, next = new Set(stack).add(monster);
        const names = [copy.ENG_name, copy.name].filter((name): name is string => typeof name === "string" && !!name);
        const parents = new Set(names.flatMap(name => candidatesBySlug.get(canonicalMonsterKey(makeSlug(copy.source, name))) ?? []));
        for (const parent of parents) {
          const candidate = resolveCandidate(parent, next);
          if (!candidate || !copyModTargetsAvailable(monster, candidate)) continue;
          const value = resolveCopy(monster, new Map(names.map(name => [makeSlug(copy.source, name), candidate])), new Set());
          resolved.set(monster, value);
          return value;
        }
        return null;
      };
      for (const m of group.monsters as any[]) {
        if (!m?.name) continue;
        const complete = resolveCandidate(m);
        if (!complete) {
          failed.add(`copy:${m._suiteContent?.libraryId ?? "local"}:${makeSlug(m.source, m.ENG_name || m.name)}`);
          continue;
        }
        remoteMonsters.push(complete ?? m);
      }
    }
    const matchesParent = (monster: any, copy: any) => [copy.ENG_name, copy.name].some((name) => typeof name === "string" &&
      [monster.ENG_name, monster.name].some((candidate) => typeof candidate === "string" &&
        canonicalMonsterKey(makeSlug(monster.source, candidate)) === canonicalMonsterKey(makeSlug(copy.source, name))));
    const resolveLocal = (monster: any, stack = new Set<any>()): any | null => {
      if (!monster._copy) return monster;
      if (stack.has(monster)) return null;
      const next = new Set(stack).add(monster), copy = monster._copy;
      const localParent = localMonsters.find((candidate) => matchesParent(candidate, copy));
      const parents = localParent ? [resolveLocal(localParent, next)].filter(Boolean)
        : remoteMonsters.filter((candidate) => matchesParent(candidate, copy));
      const parent = parents.find((candidate) => copyModTargetsAvailable(monster, candidate));
      if (!parent) return null;
      const names = [copy.ENG_name, copy.name].filter((value): value is string => typeof value === "string" && !!value);
      return resolveCopy(monster, new Map(names.map((name) => [makeSlug(copy.source, name), parent])), new Set());
    };
    const readyMonsters: any[] = [];
    for (const monster of localMonsters) {
      const resolved = resolveLocal(monster);
      if (resolved) readyMonsters.push(resolved);
      else failed.add(`copy:local:${makeSlug(monster.source, monster.ENG_name || monster.name)}`);
    }
    readyMonsters.push(...remoteMonsters);
    const chosen = new Map<string, any>();
    const aliases = new Map<string, Set<string>>();
    for (const monster of readyMonsters) {
      const key = canonicalMonsterKey(makeSlug(monster.source, monster.ENG_name || monster.name));
      if (!chosen.has(key)) chosen.set(key, monster);
      if (!aliases.has(key)) aliases.set(key, new Set());
      for (const name of [monster.ENG_name, monster.name]) if (name) aliases.get(key)!.add(name);
    }
    const resolvedBySlug = new Map<string, any>();
    for (const [key, selected] of chosen) {
      const monster = { ...selected, _suiteAliases: [...aliases.get(key)!] };
      chosen.set(key, monster);
      resolvedBySlug.set(key, monster);
      for (const name of aliases.get(key)!) {
        resolvedBySlug.set(makeSlug(monster.source, name), monster);
        resolvedBySlug.set(canonicalMonsterKey(makeSlug(monster.source, name)), monster);
      }
    }
    let all = [...chosen.values()].map(parseMon).filter((monster): monster is ParsedMonster => monster !== null);

    // Sort by CR numerically, then by name
    all.sort((a, b) => {
      const crA = parseCR(a.cr);
      const crB = parseCR(b.cr);
      if (crA !== crB) return crA - crB;
      return a.name.localeCompare(b.name);
    });


    if (generation !== loadGeneration) return [];
    rawBySlug.clear();
    for (const [slug, monster] of resolvedBySlug) rawBySlug.set(slug, monster);
    cachedMonsters = all;
    reportProgress({ loadedFiles, failedFiles: failed.size, preview: all });
    return all;
}

function parseCR(cr: string): number {
  if (cr === "1/8") return 0.125;
  if (cr === "1/4") return 0.25;
  if (cr === "1/2") return 0.5;
  return parseFloat(cr) || 0;
}

/**
 * Per-monster search keys, derived once and remembered on the monster
 * object itself via a WeakMap.
 *
 * `searchMonsters` runs on every keystroke, every sort toggle and every
 * source-filter keystroke, and it lowercased name / engName / type for
 * every monster each time. The values depend only on the monster, and
 * parsed monsters are long-lived objects that outlive any one query.
 *
 * Stored under a SYMBOL on the monster itself, not in a WeakMap. A
 * WeakMap was the first attempt and it made the sort measurably WORSE
 * (1.27 -> 2.39 ms on 6k monsters): two `WeakMap.get` calls per
 * comparison cost more than the two `parseCR` calls they replaced. A
 * symbol-keyed property is an ordinary property lookup, and it is
 * invisible to `JSON.stringify`, `Object.keys` and `for...in`, so it
 * cannot leak into anything that re-serialises a monster.
 */
interface SearchKeys {
  name: string;
  eng: string;
  type: string;
  source: string;
  cr: number;
}
const SEARCH_KEYS = Symbol("bestiary.searchKeys");

function keysFor(m: ParsedMonster): SearchKeys {
  const existing = (m as any)[SEARCH_KEYS] as SearchKeys | undefined;
  if (existing) return existing;
  const k: SearchKeys = {
    name: [m.name, ...(m.aliases ?? [])].filter(Boolean).join(" ").toLowerCase(),
    eng: (m.engName || "").toLowerCase(),
    type: String(m.type || "").toLowerCase(),
    source: String((m as any).source ?? "").toLowerCase(),
    cr: parseCR(m.cr),
  };
  Object.defineProperty(m, SEARCH_KEYS, {
    value: k,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return k;
}

export function searchMonsters(
  monsters: ParsedMonster[],
  query: string,
  sortDesc: boolean = false,
  enabledEditions: Set<MonsterEdition> = new Set(["2014", "2024", "other"]),
  sourceFilter: string = "",
): ParsedMonster[] {
  // `other` is always implicitly enabled — the 2014/2024 toggles only
  // gate PHB/MM and XPHB/XMM respectively. Anything else passes through.
  let result = monsters.filter(
    (m) => m.edition === "other" || enabledEditions.has(m.edition)
  );

  // Source-code filter (e.g. "PHB" / "MYHB" / "kiwee"). Case-
  // insensitive substring match on m.source so a homebrew GM can
  // narrow the panel to ONLY their imported entries by typing the
  // source slug they used.
  const srcQ = sourceFilter.trim().toLowerCase();
  if (srcQ) {
    result = result.filter((m) => keysFor(m).source.includes(srcQ));
  }

  if (query.trim()) {
    const q = query.toLowerCase().trim();
    result = result.filter((m) => {
      const k = keysFor(m);
      return (
        k.name.includes(q) ||
        k.eng.includes(q) ||
        // Deliberately the RAW cr, not the parsed number: this is an
        // exact-string match so typing "1/4" finds CR 1/4 monsters.
        m.cr === q ||
        k.type.includes(q)
      );
    });
  }

  // Decorate / sort / undecorate. `parseCR` used to run twice per
  // COMPARISON — O(n log n) parses — and even a cached lookup per
  // comparison is slower than reading the value once per monster.
  //
  // `-diff` is kept verbatim rather than rewritten as `b.cr - a.cr`,
  // and Array#sort is stable and the decorated array preserves input
  // order, so the result is identical for ties as well.
  const decorated = result.map((m) => ({ m, cr: keysFor(m).cr }));
  decorated.sort((a, b) => {
    const diff = a.cr - b.cr;
    return sortDesc ? -diff : diff;
  });
  result = decorated.map((d) => d.m);

  // Bumped from 80 → 200 (2026-05-04) so heavily-populated homebrew
  // packs (e.g. WTTHC, MYHB) don't quietly hide entries behind the
  // truncation. The panel scrolls fine with 200 cards.
  return result.slice(0, 200);
}
