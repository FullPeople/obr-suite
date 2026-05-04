// Local-content store. Lets the user import .json (5etools shape) or
// .md (YAML-frontmatter shape) files DIRECTLY into the suite without
// needing to host them on a public HTTPS site. Each imported file is
// stored in localStorage; its entries are merged into the search
// index + bestiary panel + per-entry data fetches.

/** Broadcast id used to invalidate search/bestiary in-memory caches
 *  whenever the local content set changes. Listeners (search/page,
 *  bestiary/data) drop their cached data and re-derive on next read. */
export const BC_LOCAL_CONTENT_CHANGED = "com.obr-suite/local-content-changed";
//
// Storage layout:
//   obr-suite/local-content/index → { files: LocalFileMeta[] }
//   obr-suite/local-content/file:<id> → original parsed JSON content
//
// The synthesized search index entries are computed on demand in
// `getLocalIndexFile()` so the data is always derived from the live
// stored files (no separate cache to keep in sync).

const LS_INDEX = "obr-suite/local-content/index";
const LS_FILE_PREFIX = "obr-suite/local-content/file:";

/** Top-level kind of a single imported file. Maps to the JSON top-level
 *  key (`"monster"` → bestiary, `"spell"` → spells, etc.). */
export type LocalKind =
  | "monster"
  | "spell"
  | "item"
  | "background"
  | "feat"
  | "race"
  | "optionalfeature"
  | "condition"
  | "vehicle"
  | "deity"
  | "language"
  | "psionic"
  | "reward"
  | "variantrule"
  | "trap"
  | "hazard"
  | "cult"
  | "boon"
  | "disease"
  | "table"
  | "action"
  | "recipe"
  | "deck";

/** Category number lookup matching CATEGORY in modules/search/page.ts. */
const KIND_TO_CATEGORY: Record<LocalKind, number> = {
  monster: 1,
  spell: 2,
  background: 3,
  item: 4,
  condition: 6,
  feat: 7,
  optionalfeature: 8,
  psionic: 9,
  race: 10,
  reward: 11,
  variantrule: 12,
  deity: 14,
  vehicle: 15,
  trap: 16,
  hazard: 17,
  cult: 19,
  boon: 20,
  disease: 21,
  table: 24,
  language: 43,
  action: 42,
  recipe: 48,
  deck: 52,
};

/** Each imported file = one row in the user's "本地内容" list. */
export interface LocalFileMeta {
  id: string;
  filename: string;
  kind: LocalKind;
  /** How many top-level entries the file contributed. */
  count: number;
  /** ms since epoch. Used to sort newest-first in the UI. */
  addedAt: number;
}

interface LocalIndexState {
  files: LocalFileMeta[];
}

function readIndex(): LocalIndexState {
  try {
    const raw = localStorage.getItem(LS_INDEX);
    if (!raw) return { files: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.files)) return { files: [] };
    return parsed as LocalIndexState;
  } catch {
    return { files: [] };
  }
}

function writeIndex(state: LocalIndexState): void {
  try { localStorage.setItem(LS_INDEX, JSON.stringify(state)); } catch {}
}

function readFile(id: string): any | null {
  try {
    const raw = localStorage.getItem(LS_FILE_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeFile(id: string, content: any): void {
  try {
    localStorage.setItem(LS_FILE_PREFIX + id, JSON.stringify(content));
  } catch (e) {
    // Most likely localStorage quota; surface as console error.
    console.error("[obr-suite/localContent] writeFile failed", e);
    throw e;
  }
}

function deleteFile(id: string): void {
  try { localStorage.removeItem(LS_FILE_PREFIX + id); } catch {}
}

/** Public read: ordered list of imported files (newest first). */
export function getLocalFiles(): LocalFileMeta[] {
  return [...readIndex().files].sort((a, b) => b.addedAt - a.addedAt);
}

/** Compact signature of the current local-content state. Used by
 *  modules/search/page.ts as part of its index-cache key so the
 *  cache invalidates automatically when files are added / removed. */
export function getLocalContentSignature(): string {
  const idx = readIndex();
  if (idx.files.length === 0) return "0";
  return `${idx.files.length}:${idx.files.map((f) => f.id).join("|")}`;
}

/** Public read: raw entry array of a given file. */
export function getLocalFileEntries(id: string): any[] {
  const content = readFile(id);
  if (!content) return [];
  // Extract the top-level array regardless of which key (monster /
  // spell / item / ...) was used.
  for (const key of Object.keys(content)) {
    if (Array.isArray(content[key])) return content[key];
  }
  return [];
}

/** Build a slug from a name that's safe to use as the `u` field. */
function slugify(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Synthesize a search-index-style file from every imported local file.
 *  Used by modules/search/page.ts to merge local entries into the
 *  combined search index. Entries collide gracefully with kiwee
 *  entries because the (cn|n|s|c) dedupe key includes source. */
export interface SearchIndexEntry {
  id: number;
  c: number;
  n: string;
  cn?: string;
  s?: string;
  u?: string;
  // Annotation so per-entry data fetches know to look in local store
  // rather than over the wire.
  __local?: true;
}
export interface SearchIndexFile {
  x: SearchIndexEntry[];
  m: { s: Record<string, number> };
}

export function getLocalIndexFile(): SearchIndexFile {
  const out: SearchIndexFile = { x: [], m: { s: {} } };
  const idx = readIndex();
  let nextId = 1;
  // Source codes get a synthetic numeric id starting at 9000 so they
  // don't collide with kiwee's source map. Each unique source string
  // gets its own number.
  const sourceNumByCode = new Map<string, number>();
  let nextSourceNum = 9000;

  for (const meta of idx.files) {
    const cat = KIND_TO_CATEGORY[meta.kind];
    if (typeof cat !== "number") continue;
    const entries = getLocalFileEntries(meta.id);
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const engName = String(e.ENG_name ?? e.name ?? "").trim();
      const cnName = String(e.name ?? "").trim();
      if (!engName && !cnName) continue;
      const source = String(e.source ?? "HOMEBREW").trim() || "HOMEBREW";
      if (!sourceNumByCode.has(source)) {
        sourceNumByCode.set(source, nextSourceNum++);
        out.m.s[source] = sourceNumByCode.get(source)!;
      }
      const u = e.u ? String(e.u) : slugify(engName || cnName);
      out.x.push({
        id: nextId++,
        c: cat,
        n: engName || cnName,
        cn: cnName !== engName ? cnName : undefined,
        s: source,
        u,
        __local: true,
      });
    }
  }
  return out;
}

/** Per-entry data lookup: given a category key (from CATEGORY[c].data.key
 *  in search/page.ts) and a source code, return the locally-stored
 *  entries for that key+source. Used by search/page.ts loadCategoryData
 *  to short-circuit URL fetches when the data is local. */
export function getLocalDataByKeySource(key: string, source: string): any[] {
  const idx = readIndex();
  const out: any[] = [];
  const upperSrc = source.toUpperCase();
  for (const meta of idx.files) {
    const content = readFile(meta.id);
    if (!content) continue;
    const arr = Array.isArray(content[key]) ? content[key] : [];
    for (const e of arr) {
      if (!e || typeof e !== "object") continue;
      const eSrc = String(e.source ?? "").toUpperCase();
      if (eSrc === upperSrc) out.push(e);
    }
  }
  return out;
}

/** Convenience: every locally imported monster across all files. Used
 *  by modules/bestiary/data.ts to merge into the bestiary panel. */
export function getAllLocalMonsters(): any[] {
  const idx = readIndex();
  const out: any[] = [];
  for (const meta of idx.files) {
    if (meta.kind !== "monster") continue;
    const content = readFile(meta.id);
    if (!content) continue;
    const arr = Array.isArray(content.monster) ? content.monster : [];
    for (const m of arr) if (m && typeof m === "object") out.push(m);
  }
  return out;
}

/** Detect which top-level kind a parsed JSON file represents. Returns
 *  null when no recognised key is found. */
function detectKind(parsed: any): LocalKind | null {
  if (!parsed || typeof parsed !== "object") return null;
  for (const k of Object.keys(KIND_TO_CATEGORY) as LocalKind[]) {
    if (Array.isArray(parsed[k]) && parsed[k].length > 0) return k;
  }
  return null;
}

/** Result from importLocalFile: ok=true with the new meta on success,
 *  ok=false with a human-readable error otherwise. */
export type ImportResult =
  | { ok: true; meta: LocalFileMeta }
  | { ok: false; error: string };

export async function importLocalJson(filename: string, jsonText: string): Promise<ImportResult> {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    return { ok: false, error: `JSON 解析失败：${e?.message || String(e)}` };
  }
  const kind = detectKind(parsed);
  if (!kind) {
    return {
      ok: false,
      error: "JSON 顶层缺少识别的内容键（应为 monster / spell / item / feat 等）",
    };
  }
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFile(id, parsed);
  } catch {
    return { ok: false, error: "存储失败 —— localStorage 容量已满" };
  }
  const count = Array.isArray(parsed[kind]) ? parsed[kind].length : 0;
  const meta: LocalFileMeta = { id, filename, kind, count, addedAt: Date.now() };
  const state = readIndex();
  state.files.push(meta);
  writeIndex(state);
  return { ok: true, meta };
}

/** Minimal MD-format importer.
 *  Supports YAML-frontmatter at the top + section headings inside body:
 *    ---
 *    name: 霜灵精怪
 *    ENG_name: Frost Wisp
 *    source: HOMEBREW
 *    size: T
 *    type: elemental
 *    ac: 14
 *    hp: 22 (5d4 + 10)
 *    speed: fly 30, hover
 *    str: 6
 *    ...
 *    cr: "1/2"
 *    ---
 *
 *    ## Traits
 *    ### Cold Aura
 *    Any creature within 5 ft. takes {@damage 1d4} cold damage.
 *
 *    ## Actions
 *    ### Frost Touch
 *    {@atk ms} {@hit 5}, reach 5 ft., one target. {@h}{@damage 2d6+3} cold.
 *
 *  The output is a synthetic single-monster JSON file in the same shape
 *  as a 5etools bestiary file. */
export async function importLocalMd(filename: string, mdText: string): Promise<ImportResult> {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) {
    return {
      ok: false,
      error: "MD 文件缺少 YAML frontmatter（开头要有 --- ... ---）",
    };
  }
  const front = m[1];
  const body = mdText.slice(m[0].length);
  const fields: Record<string, string> = {};
  for (const line of front.split(/\r?\n/)) {
    const mm = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    // Strip surrounding quotes for cr-like values that need to stay strings.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    fields[mm[1]] = v;
  }
  if (!fields.name && !fields.ENG_name) {
    return { ok: false, error: "MD frontmatter 至少需要一个 name 或 ENG_name 字段" };
  }
  const monster = mdFrontmatterToMonster(fields);
  // Attach trait/action/reaction/legendary arrays parsed from body
  // sections.
  const sections = parseMdBodySections(body);
  if (sections.trait?.length) monster.trait = sections.trait;
  if (sections.action?.length) monster.action = sections.action;
  if (sections.reaction?.length) monster.reaction = sections.reaction;
  if (sections.legendary?.length) monster.legendary = sections.legendary;
  const synth = { monster: [monster] };
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFile(id, synth);
  } catch {
    return { ok: false, error: "存储失败 —— localStorage 容量已满" };
  }
  const meta: LocalFileMeta = {
    id,
    filename,
    kind: "monster",
    count: 1,
    addedAt: Date.now(),
  };
  const state = readIndex();
  state.files.push(meta);
  writeIndex(state);
  return { ok: true, meta };
}

function mdFrontmatterToMonster(fields: Record<string, string>): any {
  const m: any = {
    name: fields.name || fields.ENG_name || "",
    ENG_name: fields.ENG_name || fields.name || "",
    source: fields.source || "HOMEBREW",
    page: fields.page ? Number(fields.page) || 0 : 0,
  };
  if (fields.size) m.size = fields.size;
  if (fields.type) m.type = fields.type;
  if (fields.alignment) m.alignment = fields.alignment;
  if (fields.ac) {
    const n = parseInt(fields.ac, 10);
    if (Number.isFinite(n)) {
      const rest = fields.ac.slice(String(n).length).trim().replace(/^[(,]/, "").replace(/[)]$/, "").trim();
      m.ac = [rest ? { ac: n, from: [rest] } : { ac: n }];
    }
  }
  if (fields.hp) {
    // "63 (7d10+21)" → {average:63, formula:"7d10+21"}
    const mm = fields.hp.match(/^(\d+)\s*(?:\(([^)]+)\))?$/);
    if (mm) {
      m.hp = mm[2] ? { average: Number(mm[1]), formula: mm[2].trim() } : { average: Number(mm[1]) };
    } else {
      m.hp = { average: 0, formula: fields.hp };
    }
  }
  if (fields.speed) {
    // "40" or "fly 30, walk 20, hover" → speed object
    const sp: any = {};
    const parts = fields.speed.split(/,/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (p === "hover") { sp.hover = true; continue; }
      const mm = p.match(/^(walk|fly|swim|burrow|climb)?\s*(\d+)/);
      if (mm) {
        const k = (mm[1] || "walk") as string;
        sp[k] = Number(mm[2]);
      } else if (/^\d+$/.test(p)) {
        sp.walk = Number(p);
      }
    }
    if (Object.keys(sp).length) m.speed = sp;
  }
  for (const stat of ["str", "dex", "con", "int", "wis", "cha"]) {
    if (fields[stat]) {
      const n = parseInt(fields[stat], 10);
      if (Number.isFinite(n)) m[stat] = n;
    }
  }
  if (fields.cr) m.cr = fields.cr;
  if (fields.senses) m.senses = fields.senses;
  if (fields.languages) m.languages = fields.languages;
  return m;
}

function parseMdBodySections(body: string): {
  trait?: any[];
  action?: any[];
  reaction?: any[];
  legendary?: any[];
} {
  // Split by `## Heading` headings — only the level-2 headings start a
  // new bucket.
  const lines = body.split(/\r?\n/);
  let curBucket: keyof ReturnType<typeof parseMdBodySections> | null = null;
  let curEntryName: string | null = null;
  let curEntryBody: string[] = [];
  const result: { trait: any[]; action: any[]; reaction: any[]; legendary: any[] } = {
    trait: [],
    action: [],
    reaction: [],
    legendary: [],
  };
  const flush = () => {
    if (curBucket && curEntryName != null) {
      const text = curEntryBody.join("\n").trim();
      result[curBucket].push({ name: curEntryName, entries: text ? [text] : [] });
    }
    curEntryName = null;
    curEntryBody = [];
  };
  for (const ln of lines) {
    const h2 = ln.match(/^##\s+(.+?)\s*$/);
    if (h2 && !ln.startsWith("###")) {
      flush();
      const head = h2[1].toLowerCase();
      if (/trait|特性/.test(head)) curBucket = "trait";
      else if (/legendary|传奇/.test(head)) curBucket = "legendary";
      else if (/reaction|反应/.test(head)) curBucket = "reaction";
      else if (/action|动作/.test(head)) curBucket = "action";
      else curBucket = null;
      continue;
    }
    const h3 = ln.match(/^###\s+(.+?)\s*$/);
    if (h3 && curBucket) {
      flush();
      curEntryName = h3[1];
      continue;
    }
    if (curEntryName != null) curEntryBody.push(ln);
  }
  flush();
  // Drop empty buckets so they're not serialised onto the monster.
  const out: any = {};
  for (const k of Object.keys(result) as (keyof typeof result)[]) {
    if (result[k].length) out[k] = result[k];
  }
  return out;
}

export function removeLocalFile(id: string): void {
  const state = readIndex();
  state.files = state.files.filter((f) => f.id !== id);
  writeIndex(state);
  deleteFile(id);
}

export function clearAllLocal(): void {
  const state = readIndex();
  for (const f of state.files) deleteFile(f.id);
  writeIndex({ files: [] });
}
