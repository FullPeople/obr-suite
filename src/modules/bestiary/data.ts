import { Monster, ParsedMonster, MonsterEdition } from "./types";

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

// Data source (JSON) — kiwee.top Chinese mirror
const DATA_BASE = "https://5e.kiwee.top";
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
  // Matches 5etools Renderer.monster.getTokenUrl logic
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
  const parentName = m._copy.ENG_name || m._copy.name;
  const parentSlug = makeSlug(parentSource, parentName);
  if (stack.has(parentSlug)) return m; // cycle guard
  const parent = bySlug.get(parentSlug);
  if (!parent) return m;
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
    // Load index to get all source files
    const indexRes = await fetch(`${DATA_BASE}/data/bestiary/index.json`);
    const index = await indexRes.json() as Record<string, string>;

    // Load all source files in parallel
    const entries = Object.entries(index);
    const results = await Promise.all(
      entries.map(async ([, filename]) => {
        try {
          const res = await fetch(`${DATA_BASE}/data/bestiary/${filename}`);
          const data = await res.json();
          return (data.monster || []) as Monster[];
        } catch {
          return [] as Monster[];
        }
      })
    );

    const rawAll = results.flat();
    // Build slug → raw lookup so spawn/info can read full monster data
    // (abilities, actions, etc.) without re-fetching.
    for (const m of rawAll) {
      if (m && m.name) {
        rawBySlug.set(makeSlug(m.source, m.ENG_name || m.name), m);
      }
    }
    // Resolve 5etools _copy inheritance so entries like BGDIA::Zariel
    // (which only have diffs vs. MTF::Zariel) get full stats / actions.
    for (const [slug, m] of rawBySlug) {
      if (m && m._copy) {
        rawBySlug.set(slug, resolveCopy(m, rawBySlug, new Set()));
      }
    }
    const all = Array.from(rawBySlug.values())
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
  enabledEditions: Set<MonsterEdition> = new Set(["2014", "2024", "other"])
): ParsedMonster[] {
  // `other` is always implicitly enabled — the 2014/2024 toggles only
  // gate PHB/MM and XPHB/XMM respectively. Anything else passes through.
  let result = monsters.filter(
    (m) => m.edition === "other" || enabledEditions.has(m.edition)
  );

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

  return result.slice(0, 80);
}
