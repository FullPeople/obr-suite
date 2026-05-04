import { Monster, ParsedMonster, MonsterEdition } from "./types";
import { getAllLocalMonsters } from "../../utils/localContent";

// "2014" = strictly PHB + MM (the original core books). "2024" = strictly
// XPHB + XMM (the 2024 reprint). Every other source — DMG/XDMG, TCE, XGE,
// MTF, MPMM, BGG, FTD, etc. — counts as `other` and is ALWAYS visible
// regardless of the user's 2014/2024 toggle. Per user feedback 2026-04-27.
const EDITION_2014_CORE = new Set(["PHB", "MM"]);
const EDITION_2024_CORE = new Set(["XPHB", "XMM"]);

function detectEdition(source: string): MonsterEdition {
  if (EDITION_2014_CORE.has(source)) return "2014";
  if (EDITION_2024_CORE.has(source)) return "2024";
  return "other";
}

// Data source (JSON) — primary kiwee.top Chinese mirror, but the
// suite's LibraryConfig (state.libraries) can add user-supplied
// alternates (e.g. self-hosted Cloudflare worker). loadAllMonsters
// fetches from EVERY enabled library and merges results, so
// monsters from a custom library show up in the bestiary panel
// alongside the default ones.
const DEFAULT_BASE = "https://5e.kiwee.top";

function getEnabledLibraryBases(): string[] {
  // Read library list lazily at call time. We deliberately import
  // through a runtime-resolved path (not top-level `import`) because
  // bestiary/data.ts is also pulled in by background bundles where
  // suite state may not be initialised yet — falling back to the
  // hardcoded DEFAULT_BASE is the right behaviour there.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getState } = require("../../state") as typeof import("../../state");
    const libs = getState().libraries || [];
    const bases = libs
      .filter((l) => l.enabled && typeof l.baseUrl === "string" && l.baseUrl.trim().length > 0)
      .map((l) => l.baseUrl.replace(/\/+$/, ""));
    return bases.length > 0 ? bases : [DEFAULT_BASE];
  } catch {
    return [DEFAULT_BASE];
  }
}
// Images: proxied through our own server so OBR can load them as WebGL textures
// (5e.tools doesn't send CORS headers, so direct loading fails in scene rendering).
const IMG_BASE = "https://obr.dnd.center/5etools-img";

const SIZE_MAP: Record<string, string> = {
  T: "超小型", S: "小型", M: "中型", L: "大型", H: "巨型", G: "超巨型",
};

function parseAC(ac: any): number {
  if (!ac || !Array.isArray(ac) || ac.length === 0) return 10;
  const first = ac[0];
  if (typeof first === "number") return first;
  if (first && typeof first === "object" && "ac" in first) return first.ac;
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

function parseMon(m: any): ParsedMonster | null {
  try {
    if (!m || !m.name) return null;
    const source = m.source || "?";
    return {
      name: m.name || "???",
      engName: m.ENG_name || m.name || "???",
      source,
      ac: parseAC(m.ac),
      hp: m.hp?.average ?? 0,
      dexMod: Math.floor(((m.dex || 10) - 10) / 2),
      cr: m.cr ?? "?",
      size: SIZE_MAP[m.size?.[0]] || m.size?.[0] || "?",
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

/** Drop the cached monster list so the next loadAllMonsters() pulls
 *  fresh data. Called when the user imports / removes local content
 *  via the settings panel — the bestiary module subscribes to the
 *  BC_LOCAL_CONTENT_CHANGED broadcast and forwards it here. */
export function clearMonsterCache(): void {
  cachedMonsters = null;
  loadingPromise = null;
  rawBySlug.clear();
}

// slug uniquely identifies a monster across sources: "MM::Goblin"
export function makeSlug(source: string, engName: string): string {
  return `${source || "?"}::${engName || "?"}`;
}

export function getRawMonster(slug: string): any | null {
  return rawBySlug.get(slug) ?? null;
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

function resolveCopy(m: any, bySlug: Map<string, any>, stack: Set<string>): any {
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
    const found = bySlug.get(slug);
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
  return merged;
}

export async function loadAllMonsters(): Promise<ParsedMonster[]> {
  if (cachedMonsters) return cachedMonsters;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // Fetch from EVERY enabled library and merge. Libraries may
    // disagree on which sources they ship (custom Cloudflare libs
    // typically only have a handful of homebrew monsters); merging
    // by makeSlug() naturally dedupes so the canonical 5etools
    // monster wins for shared sources, and homebrew slugs from a
    // custom library appear alongside.
    const bases = getEnabledLibraryBases();
    const perLibraryMonsters = await Promise.all(
      bases.map(async (base) => {
        // Try the canonical 5etools layout first: a `bestiary/index.json`
        // mapping `bestiary-<SOURCE>.json` → SOURCE. If that's missing
        // (most user-hosted homebrew sites don't ship one), fall back
        // to the search index — extract every c=1 (monster) entry's
        // source code and synthesise the file list ourselves.
        try {
          const indexRes = await fetch(`${base}/data/bestiary/index.json`, { cache: "no-cache" });
          if (indexRes.ok) {
            const index = await indexRes.json() as Record<string, string>;
            const files = Object.entries(index);
            const results = await Promise.all(
              files.map(async ([, filename]) => {
                try {
                  // No HTTP-cache so updates to library JSON show up
                  // on the next loadAllMonsters() call (after the
                  // user toggles libraries / re-opens the panel).
                  const res = await fetch(`${base}/data/bestiary/${filename}`, { cache: "no-cache" });
                  if (!res.ok) return [] as Monster[];
                  const data = await res.json();
                  return (data.monster || []) as Monster[];
                } catch (e) {
                  console.warn(`[obr-suite/bestiary] failed to load ${base}/data/bestiary/${filename}`, e);
                  return [] as Monster[];
                }
              })
            );
            return results.flat();
          }
        } catch {}
        // Fallback: read search/index.json, pick monster sources, fetch
        // each `bestiary-<SOURCE>.json`. Lets a self-hosted homebrew
        // library that only ships search/index.json + one bestiary file
        // still appear in the bestiary panel.
        try {
          const idxRes = await fetch(`${base}/search/index.json`, { cache: "no-cache" });
          if (!idxRes.ok) return [] as Monster[];
          const idx = await idxRes.json() as { x?: any[] };
          const xs = Array.isArray(idx.x) ? idx.x : [];
          const monsterSources = new Set<string>();
          for (const e of xs) {
            if (!e || e.c !== 1) continue;
            const s = typeof e.s === "string" ? e.s : null;
            if (s) monsterSources.add(s);
          }
          if (monsterSources.size === 0) return [] as Monster[];
          // Try each source under multiple case variants — GitHub
          // Pages is case-sensitive but homebrew authors often use
          // uppercase filenames while kiwee uses lowercase. We try
          // them all and use whichever 200s.
          const results = await Promise.all(
            Array.from(monsterSources).map(async (src) => {
              const cases = new Set<string>([src, src.toLowerCase(), src.toUpperCase()]);
              for (const c of cases) {
                try {
                  const res = await fetch(`${base}/data/bestiary/bestiary-${c}.json`, { cache: "no-cache" });
                  if (!res.ok) continue;
                  const data = await res.json();
                  const arr = (data.monster || []) as Monster[];
                  return arr;
                } catch {}
              }
              console.warn(
                `[obr-suite/bestiary] no working case variant for ${base}/data/bestiary/bestiary-${src}.json`,
              );
              return [] as Monster[];
            })
          );
          return results.flat();
        } catch (e) {
          console.warn(`[obr-suite/bestiary] failed to derive bestiary list from ${base}`, e);
          return [] as Monster[];
        }
      })
    );
    // Imported local-content monsters get folded in alongside any
    // URL-based libraries.
    const localMonsters = getAllLocalMonsters() as Monster[];
    const rawAll = [...perLibraryMonsters.flat(), ...localMonsters];
    // Build slug → raw lookup so spawn/info can read full monster data
    // (abilities, actions, etc.) without re-fetching. Index by BOTH
    // ENG_name and name (zh) so `_copy` lookups succeed regardless of
    // which form the child references — homebrew packs aren't always
    // consistent with their parent references.
    for (const m of rawAll) {
      if (m && m.name) {
        const eng = m.ENG_name;
        if (eng) rawBySlug.set(makeSlug(m.source, eng), m);
        if (!eng || eng !== m.name) {
          // Don't overwrite an existing English-keyed entry with the
          // zh slug — but DO add the zh slug for child _copy resolution.
          const zhSlug = makeSlug(m.source, m.name);
          if (!rawBySlug.has(zhSlug)) rawBySlug.set(zhSlug, m);
        }
      }
    }
    // Resolve 5etools _copy inheritance so entries like BGDIA::Zariel
    // (which only have diffs vs. MTF::Zariel) get full stats / actions.
    for (const [slug, m] of rawBySlug) {
      if (m && m._copy) {
        rawBySlug.set(slug, resolveCopy(m, rawBySlug, new Set()));
      }
    }
    // Dedupe via identity Set — rawBySlug now keys some monsters
    // under both their English and Chinese slugs (so `_copy` resolves
    // either way). Iterating values() would emit duplicates without
    // this guard.
    const seenRaw = new Set<any>();
    const uniqueRaw: any[] = [];
    for (const m of rawBySlug.values()) {
      if (seenRaw.has(m)) continue;
      seenRaw.add(m);
      uniqueRaw.push(m);
    }
    const all = uniqueRaw
      .map(parseMon)
      .filter((x): x is ParsedMonster => x !== null);
    // Sort by CR numerically, then by name
    all.sort((a, b) => {
      const crA = parseCR(a.cr);
      const crB = parseCR(b.cr);
      if (crA !== crB) return crA - crB;
      return a.name.localeCompare(b.name);
    });

    cachedMonsters = all;
    return all;
  })();

  return loadingPromise;
}

function parseCR(cr: string): number {
  if (cr === "1/8") return 0.125;
  if (cr === "1/4") return 0.25;
  if (cr === "1/2") return 0.5;
  return parseFloat(cr) || 0;
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
    result = result.filter((m) =>
      String((m as any).source ?? "").toLowerCase().includes(srcQ),
    );
  }

  if (query.trim()) {
    const q = query.toLowerCase().trim();
    result = result.filter((m) => {
      const t = String(m.type || "");
      return (
        (m.name || "").toLowerCase().includes(q) ||
        (m.engName || "").toLowerCase().includes(q) ||
        m.cr === q ||
        t.toLowerCase().includes(q)
      );
    });
  }

  // Sort by CR
  result = [...result].sort((a, b) => {
    const diff = parseCR(a.cr) - parseCR(b.cr);
    return sortDesc ? -diff : diff;
  });

  // Bumped from 80 → 200 (2026-05-04) so heavily-populated homebrew
  // packs (e.g. WTTHC, MYHB) don't quietly hide entries behind the
  // truncation. The panel scrolls fine with 200 cards.
  return result.slice(0, 200);
}
