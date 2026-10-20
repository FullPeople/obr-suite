// Local-content store. Lets the user import .json (5etools shape) or
// .md (YAML-frontmatter shape) files DIRECTLY into the suite without
// needing to host them on a public HTTPS site. Each imported file is
// stored in IndexedDB; its entries are merged into the search index +
// bestiary panel + per-entry data fetches.
//
// 2026-05-10 — migrated localStorage → IndexedDB. localStorage capped a
// single origin at ~5–10 MB and JSON-stringified everything; users
// importing larger homebrew packs hit "存储失败 — localStorage 容量
// 已满" with no recovery path. IDB lifts the cap to ~60% of free disk
// and stores native objects (no stringify roundtrip). The storage
// layer is now async, but every existing public sync getter
// (`getLocalFiles`, `getLocalIndexFile`, `getAllLocalMonsters`, etc.)
// still works by reading from a module-level in-memory mirror that
// `initLocalContent()` populates from IDB at startup. Callers that
// need a guaranteed-warm cache should `await initLocalContent()`
// before reading; everyone else gets best-effort current state.
//
// Migration: on first init we look in IDB. If empty AND the legacy
// localStorage keys still hold data, we copy them in then clear the
// localStorage entries. Re-runs of init are idempotent — if IDB has
// data, the migration step is skipped.

import { idbGet, idbPut, idbUpdate, idbGetAll, idbClear } from "./idbStore";
import { isLocalClassKind, localClassRows, localClassDetails, type LocalClassReference } from "./localClassCatalog";
import { LOCAL_RECORD_CATEGORIES, isLocalRecordKind, localRecordRows, localRecordDetails, type LocalRecordKind, type LocalRecordReference } from "./localRecordCatalog";

/** Broadcast id used to invalidate search/bestiary in-memory caches
 *  whenever the local content set changes. Listeners (search/page,
 *  bestiary/data) drop their cached data and re-derive on next read. */
export const BC_LOCAL_CONTENT_CHANGED = "com.obr-suite/local-content-changed";
//
// IDB key layout (mirrored 1:1 of the old localStorage layout for
// migration simplicity):
//   "index"       → { files: LocalFileMeta[] }
//   "file:<id>"   → original parsed JSON content
//
// The synthesized search index entries are computed on demand in
// `getLocalIndexFile()` from the in-memory mirror, so the data is
// always derived from the live stored files (no separate cache to
// keep in sync).

const IDB_INDEX_KEY = "index";
const IDB_FILE_PREFIX = "file:";

/** IDB key for the URL-subscription list. Each entry is a
 *  RemoteSubscription record; the actual fetched JSON is stored at
 *  `file:<id>` exactly like a manual import (so search / bestiary
 *  / character cards see it identically), linked via
 *  RemoteSubscription.fileId. */
const IDB_SUBS_KEY = "subscriptions";

/** How long after a successful subscription fetch we treat the
 *  cache as "fresh enough" and skip the boot-time auto-refresh.
 *  1h is a deliberate trade-off — fast enough that a homebrew
 *  author's update reaches the table within most sessions, slow
 *  enough that reload-spamming a flaky host doesn't make us look
 *  like an attacker. The per-row 🔄 button always force-refreshes
 *  regardless of this window. */
const SUB_STALE_MS = 60 * 60 * 1000;

// Legacy localStorage keys — used ONLY by the one-shot migration in
// initLocalContent(). After migration completes the legacy entries
// are wiped.
const LEGACY_LS_INDEX = "obr-suite/local-content/index";
const LEGACY_LS_FILE_PREFIX = "obr-suite/local-content/file:";

/** Top-level kind of a single imported file. Maps to the JSON top-level
 *  key (`"monster"` → bestiary, `"spell"` → spells, etc.). */
export type LocalKind =
  | LocalRecordKind
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
  | "deck"
  | "class"
  | "subclass"
  | "classFeature"
  | "subclassFeature";

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
  class: 5,
  subclass: 40,
  classFeature: 30,
  subclassFeature: 41,
  ...LOCAL_RECORD_CATEGORIES,
};

/** Each imported file = one row in the user's "本地内容" list. */
export interface LocalFileMeta {
  id: string;
  filename: string;
  /** Primary kind — kept for backward compat with files imported
   *  before the multi-kind refactor (2026-05-27). For multi-kind
   *  packs (e.g. kiwee homebrew with both `monster` and `spell`
   *  top-level arrays), this is `kinds[0]` and the full set is in
   *  `kinds`. */
  kind: LocalKind;
  /** Every recognised top-level kind in the file. Present for
   *  multi-kind packs; absent on legacy single-kind imports. The
   *  multi-kind refactor was added when we started subscribing to
   *  kiwee homebrew, which routinely packs `class` +
   *  `subclassFeature` + `creature` + `spell` etc into one file. */
  kinds?: LocalKind[];
  /** How many top-level entries the file contributed. For multi-kind
   *  files this is the SUM across every recognised kind so the UI's
   *  "X 类 · N" badge stays informative. */
  count: number;
  /** ms since epoch. Used to sort newest-first in the UI. */
  addedAt: number;
  /** When this meta belongs to a URL subscription, the source URL
   *  is mirrored here so the settings panel can mark the row with
   *  a 🔗 badge and route deletes through removeRemoteSubscription
   *  (which also drops the parent subscription record). Undefined
   *  = manually imported by the user. */
  remoteUrl?: string;
}

interface LocalIndexState {
  files: LocalFileMeta[];
}

/** A URL-based homebrew subscription. The plugin re-fetches the
 *  URL on stale (see SUB_STALE_MS) so the table picks up the
 *  author's updates without manual re-imports. The fetched JSON
 *  lives in the same per-file slot a manual import would use; the
 *  `fileId` here points at the corresponding LocalFileMeta. On
 *  fetch failure we KEEP whatever was previously cached and
 *  surface `lastError` so the settings UI can show a tooltip. */
export interface RemoteSubscription {
  /** Canonical URL — used as primary key and as the fetch target.
   *  Stored verbatim minus surrounding whitespace; never further
   *  normalised so we don't accidentally collapse two distinct
   *  homebrew packs that share a path prefix. */
  url: string;
  /** ms since epoch when the user added the subscription. */
  addedAt: number;
  /** ms since epoch — last successful fetch. undefined = never
   *  successfully fetched (first attempt failed; row appears in
   *  the UI with a "未获取" badge so the user can retry). */
  lastFetchedAt?: number;
  /** Most recent error message — cleared on the next successful
   *  fetch. Used by the settings UI to flag the row red and show
   *  a tooltip with the error reason. */
  lastError?: string;
  /** LocalFileMeta.id holding this sub's last good content.
   *  undefined = first fetch hasn't succeeded yet. */
  fileId?: string;
}

interface RemoteSubsState {
  list: RemoteSubscription[];
}

// === In-memory cache layer ===
//
// All reads come out of these maps; init() populates them from IDB
// (with a one-shot migration from localStorage if needed). Writes go
// through both the cache AND IDB so the next read sees the new state
// without waiting on disk. RAM cost is bounded by what the user has
// imported — typical homebrew packs are a few MB at most.
let memIndex: LocalIndexState = { files: [] };
const memFiles = new Map<string, any>();
let memSubs: RemoteSubsState = { list: [] };

let initPromise: Promise<void> | null = null;

/** Initialise the local-content store. Idempotent — repeated calls
 *  return the same promise so concurrent callers all wait on the
 *  same warm-up. Resolves once the in-memory mirror is populated
 *  from IDB. The bestiary / search / settings entry points each
 *  await this before doing their first read; sync getters before
 *  init resolves return whatever's in the in-memory cache (empty
 *  on cold-start, possibly stale during the brief init window). */
export function initLocalContent(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  // 1. Try to read the IDB index. If we have entries, this is a
  //    normal warm-up — no migration needed.
  let idbHasData = false;
  try {
    const idx = await idbGet<LocalIndexState>(IDB_INDEX_KEY);
    if (idx && Array.isArray(idx.files) && idx.files.length > 0) {
      idbHasData = true;
      memIndex = { files: [...idx.files] };
      // Pull every file row in one batch — saves N round-trips on a
      // user with many imports.
      const all = await idbGetAll();
      for (const [k, v] of all) {
        if (k.startsWith(IDB_FILE_PREFIX)) {
          memFiles.set(k.slice(IDB_FILE_PREFIX.length), v);
        }
      }
    } else if (idx) {
      // Empty index already in IDB — fresh-but-touched store. Skip
      // migration so we don't accidentally restore stale localStorage
      // entries that the user explicitly cleared.
      idbHasData = true;
      memIndex = { files: [] };
    }
  } catch (e) {
    console.warn("[obr-suite/localContent] IDB init failed; falling back to legacy localStorage", e);
  }

  // 2. If IDB was empty, see if the legacy localStorage layout has
  //    data. If so, migrate it across in one shot, then clean the
  //    legacy keys so we never run this branch twice.
  if (!idbHasData) {
    try {
      const raw = typeof localStorage !== "undefined"
        ? localStorage.getItem(LEGACY_LS_INDEX)
        : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.files)) {
          const legacyIdx = parsed as LocalIndexState;
          memIndex = { files: [...legacyIdx.files] };
          // Persist the migrated index up front so that even if a
          // file-content read fails below the next init still sees
          // the index in IDB.
          try { await idbPut(IDB_INDEX_KEY, memIndex); } catch {}
          for (const meta of legacyIdx.files) {
            try {
              const txt = localStorage.getItem(LEGACY_LS_FILE_PREFIX + meta.id);
              if (!txt) continue;
              const content = JSON.parse(txt);
              memFiles.set(meta.id, content);
              try { await idbPut(IDB_FILE_PREFIX + meta.id, content); } catch (e) {
                console.warn("[obr-suite/localContent] migrate file failed", meta.id, e);
              }
            } catch (e) {
              console.warn("[obr-suite/localContent] parse legacy file failed", meta.id, e);
            }
          }
          // Wipe legacy localStorage entries — IDB is now the source
          // of truth. Wrapped in try-catch so a clear failure (e.g.
          // private-mode quota mid-clear) doesn't block init.
          try {
            for (const meta of legacyIdx.files) {
              localStorage.removeItem(LEGACY_LS_FILE_PREFIX + meta.id);
            }
            localStorage.removeItem(LEGACY_LS_INDEX);
          } catch {}
          console.info(`[obr-suite/localContent] migrated ${legacyIdx.files.length} file(s) from localStorage → IndexedDB`);
        }
      }
    } catch (e) {
      console.warn("[obr-suite/localContent] legacy localStorage migration failed", e);
    }
  }

  // 3. Warm the URL-subscription list. Independent of the files
  //    warm-up — even if the files index is empty / corrupt, a
  //    user may still have subscription records they want to keep.
  try {
    const subs = await idbGet<RemoteSubsState>(IDB_SUBS_KEY);
    if (subs && Array.isArray(subs.list)) {
      memSubs = { list: [...subs.list] };
    }
  } catch (e) {
    console.warn("[obr-suite/localContent] subscriptions warm-up failed", e);
  }
}

function readIndex(): LocalIndexState {
  return memIndex;
}

function readFile(id: string): any | null {
  return memFiles.has(id) ? memFiles.get(id) : null;
}

function storedIndex(value: unknown): LocalIndexState {
  if (value == null) return { files: [] };
  if (typeof value === "object" && Array.isArray((value as LocalIndexState).files)) return value as LocalIndexState;
  throw new Error("本地资料索引格式异常");
}

function storedSubs(value: unknown): RemoteSubsState {
  if (value == null) return { list: [] };
  if (typeof value === "object" && Array.isArray((value as RemoteSubsState).list)) return value as RemoteSubsState;
  throw new Error("资料订阅索引格式异常");
}

async function replaceImportedFile(meta: LocalFileMeta, content: unknown): Promise<void> {
  const saved = await idbUpdate([IDB_INDEX_KEY], ([value]) => {
    const state = storedIndex(value);
    const stale = state.files.filter(row => row.filename === meta.filename && row.kind === meta.kind);
    const ids = new Set(stale.map(row => row.id));
    const index = { ...state, files: [...state.files.filter(row => !ids.has(row.id)), meta] };
    return { result: { index, ids }, put: [[IDB_FILE_PREFIX + meta.id, content], [IDB_INDEX_KEY, index]] as const, delete: [...ids].filter(id => id !== meta.id).map(id => IDB_FILE_PREFIX + id) };
  });
  for (const id of saved.ids) memFiles.delete(id);
  memFiles.set(meta.id, content);
  memIndex = saved.index;
}

function readSubs(): RemoteSubsState {
  return memSubs;
}

/** Derive current kind/count badges from the stored body, including legacy
 * mixed packs; reading never rewrites metadata or refetches a source. */
export function getLocalFiles(): LocalFileMeta[] {
  return readIndex().files.map(meta => {
    const body = readFile(meta.id), kinds = detectKinds(body);
    if (!kinds.length) return meta;
    return { ...meta, kind: kinds.includes(meta.kind) ? meta.kind : kinds[0], kinds: kinds.length > 1 ? kinds : undefined,
      count: kinds.reduce((sum, kind) => sum + body[kind].length, 0) };
  }).sort((a, b) => b.addedAt - a.addedAt);
}

/** Compact signature of the current local-content state. Used by
 *  modules/search/page.ts as part of its index-cache key so the
 *  cache invalidates automatically when files are added / removed. */
export function getLocalContentSignature(): string {
  const idx = readIndex();
  if (idx.files.length === 0) return "0";
  return `${idx.files.length}:${idx.files.map((f) => f.id).join("|")}`;
}

/** Public read: raw entry array of a given file. When `kind` is
 *  omitted, returns the concatenation of every recognised top-level
 *  kind so multi-kind packs (kiwee homebrew etc.) surface ALL their
 *  entries to the caller. When `kind` is given, returns only that
 *  bucket. */
export function getLocalFileEntries(id: string, kind?: LocalKind): any[] {
  const content = readFile(id);
  if (!content) return [];
  if (kind) {
    return Array.isArray(content[kind]) ? content[kind] : [];
  }
  // Concat every recognised kind. We iterate KIND_TO_CATEGORY keys in
  // stable order so the synthetic search-index ids stay consistent
  // across runs.
  const out: any[] = [];
  for (const k of Object.keys(KIND_TO_CATEGORY) as LocalKind[]) {
    const arr = content[k];
    if (Array.isArray(arr)) out.push(...arr);
  }
  return out;
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
  localClass?: LocalClassReference;
  localRecord?: LocalRecordReference;
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
    // Newly supported kinds must also appear in previously cached mixed packs.
    // The original bodies already retain all top-level arrays.
    const body = readFile(meta.id);
    const fileKinds = body ? detectKinds(body) : [];
    for (const k of fileKinds) {
      const cat = KIND_TO_CATEGORY[k];
      if (typeof cat !== "number") continue;
      const entries = getLocalFileEntries(meta.id, k);
      if (isLocalRecordKind(k)) {
        for (const row of localRecordRows(meta.id, body).filter(row => row.ref.kind === k)) {
          if (!sourceNumByCode.has(row.source)) { sourceNumByCode.set(row.source, nextSourceNum++); out.m.s[row.source] = sourceNumByCode.get(row.source)!; }
          const suffix = row.ordinal ? ` · ${row.ordinal}` : "";
          out.x.push({id:nextId++,c:cat,n:row.english+suffix,cn:row.name+suffix,s:row.source,u:`local-record-${meta.id}-${row.ref.kind}-${row.ref.digest}`,__local:true,localRecord:row.ref});
        }
        continue;
      }
      if (isLocalClassKind(k)) {
        for (const row of localClassRows(meta.id, body).filter(row => row.ref.kind === k)) {
          const source = String(row.record.source ?? "HOMEBREW").trim() || "HOMEBREW";
          if (!sourceNumByCode.has(source)) { sourceNumByCode.set(source, nextSourceNum++); out.m.s[source] = sourceNumByCode.get(source)!; }
          const suffix = row.context ? ` (${row.context})` : "";
          out.x.push({ id: nextId++, c: cat, n: row.english + suffix, cn: row.name + suffix,
            s: source, u: `local-class-${meta.id}-${row.ref.digest}`, __local: true, localClass: row.ref });
        }
        continue;
      }
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
  }
  return out;
}

/** Exact, pack-bound lookup. A stale selection must not become a different source. */
export function getLocalClassData(ref: LocalClassReference, language: "zh" | "en"): any | null {
  if (!readIndex().files.some(file => file.id === ref.fileId)) return null;
  const body = readFile(ref.fileId);
  return body ? localClassDetails(ref, body, language) : null;
}

export function getLocalRecordData(ref: LocalRecordReference, language: "zh" | "en"): any | null {
  if (!readIndex().files.some(file => file.id === ref.fileId)) return null;
  const body = readFile(ref.fileId);
  return body ? localRecordDetails(ref, body, language) : null;
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
 *  by modules/bestiary/data.ts to merge into the bestiary panel.
 *  2026-05-27 — dropped the `meta.kind === "monster"` gate; multi-kind
 *  packs (kiwee homebrew etc.) have `kind === "class"` or similar
 *  while still carrying a `monster` array inside. We now always
 *  inspect content.monster directly. */
export function getAllLocalMonsters(): any[] {
  const idx = readIndex();
  const out: any[] = [];
  for (const meta of idx.files) {
    const content = readFile(meta.id);
    if (!content) continue;
    const arr = Array.isArray(content.monster) ? content.monster : [];
    for (const m of arr) if (m && typeof m === "object") out.push(m);
  }
  return out;
}

/** Detect which top-level kind a parsed JSON file represents. Returns
 *  null when no recognised key is found. Kept for backward compat
 *  with code paths that still want a single primary kind; the
 *  multi-kind enabled importer uses detectKinds() instead. */
function detectKind(parsed: any): LocalKind | null {
  if (!parsed || typeof parsed !== "object") return null;
  for (const k of Object.keys(KIND_TO_CATEGORY) as LocalKind[]) {
    if (Array.isArray(parsed[k]) && parsed[k].length > 0) return k;
  }
  return null;
}

/** Detect EVERY recognised top-level kind in the file. Returns them
 *  in KIND_TO_CATEGORY iteration order, which is stable across runs
 *  so the synthesized search-index ids stay consistent. Empty array
 *  when none of the known kinds appear — used to reject files that
 *  don't look like 5etools data. */
function detectKinds(parsed: any): LocalKind[] {
  if (!parsed || typeof parsed !== "object") return [];
  const out: LocalKind[] = [];
  for (const k of Object.keys(KIND_TO_CATEGORY) as LocalKind[]) {
    if (Array.isArray(parsed[k]) && parsed[k].length > 0) out.push(k);
  }
  return out;
}

/** Result from importLocalFile: ok=true with the new meta on success,
 *  ok=false with a human-readable error otherwise. */
export type ImportResult =
  | { ok: true; meta: LocalFileMeta }
  | { ok: false; error: string };

export async function importLocalJson(filename: string, jsonText: string): Promise<ImportResult> {
  await initLocalContent();
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    return { ok: false, error: `JSON 解析失败：${e?.message || String(e)}` };
  }
  const kinds = detectKinds(parsed);
  if (kinds.length === 0) {
    return {
      ok: false,
      error: "JSON 顶层缺少识别的内容键（应为 monster / spell / item / feat 等）",
    };
  }
  const primaryKind = kinds[0];
  // 2026-05-12 — user request #8: re-importing the same filename
  // should REPLACE the previous file, not stack a second copy
  // alongside it. Previously the import always generated a new
  // unique id, so a user updating their homebrew JSON ended up with
  // two entries — the bestiary listing showed both, and bound
  // tokens kept showing the older monster data because slug lookups
  // hit whichever entry rawBySlug saw last. Now we look for a
  // matching filename + primary kind and replace it atomically.
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Count = sum across every recognised kind so multi-kind packs
  // (e.g. kiwee homebrew with `creature` + `spell` + `subclassFeature`)
  // show a meaningful "N entries" badge in the UI.
  let count = 0;
  for (const k of kinds) {
    if (Array.isArray(parsed[k])) count += parsed[k].length;
  }
  const meta: LocalFileMeta = {
    id,
    filename,
    kind: primaryKind,
    kinds: kinds.length > 1 ? kinds : undefined,
    count,
    addedAt: Date.now(),
  };
  try { await replaceImportedFile(meta, parsed); }
  catch (e: any) { return { ok: false, error: `存储失败 —— IndexedDB 写入异常：${e?.message || String(e)}` }; }
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
  await initLocalContent();
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
  // 2026-05-12 — same replace-on-duplicate behaviour as importLocalJson.
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const meta: LocalFileMeta = {
    id,
    filename,
    kind: "monster",
    count: 1,
    addedAt: Date.now(),
  };
  try { await replaceImportedFile(meta, synth); }
  catch (e: any) { return { ok: false, error: `存储失败 —— IndexedDB 写入异常：${e?.message || String(e)}` }; }
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

export async function removeLocalFile(id: string): Promise<void> {
  await initLocalContent();
  const state = await idbUpdate([IDB_INDEX_KEY], ([value]) => {
    const old = storedIndex(value), index = { ...old, files: old.files.filter(row => row.id !== id) };
    return { result: index, put: [[IDB_INDEX_KEY, index]] as const, delete: [IDB_FILE_PREFIX + id] };
  });
  memFiles.delete(id);
  memIndex = state;
}

export async function clearAllLocal(): Promise<void> {
  await initLocalContent();
  // Wipe in-memory + the entire IDB store in one shot. Faster than
  // looping per-file, and guarantees we clear orphan keys (legacy
  // imports whose meta got dropped but file content lingered).
  memFiles.clear();
  memIndex = { files: [] };
  memSubs = { list: [] };
  try { await idbClear(); } catch (e) {
    console.warn("[obr-suite/localContent] clearAllLocal: idbClear failed", e);
  }
  // Re-seed the empty index so the next init takes the
  // "idbHasData / fresh-but-touched" branch instead of attempting
  // a legacy localStorage migration.
  try { await idbPut(IDB_INDEX_KEY, memIndex); } catch {}
}

// ─── URL subscriptions ────────────────────────────────────────────
//
// Lets the user paste an HTTPS URL pointing at a single 5etools-shape
// JSON (a homebrew "pack" — same format manual-import expects). The
// suite caches the fetched JSON locally and re-fetches it on session
// boot when the cache is stale, so updates the upstream author
// publishes appear on the table without anyone re-importing by hand.
//
// On fetch failure we keep the cached content (graceful degradation)
// and stash the error message on the subscription record so the
// settings UI can flag the row.

/** Result of an add / refresh subscription operation. On ok=true the
 *  meta + sub are populated and the fetched content is already merged
 *  into the local-content store; on ok=false an `error` string explains
 *  what went wrong (sub may still be populated when the sub record
 *  exists but the fetch / parse failed, so the UI can show the row). */
export type SubscriptionResult =
  | { ok: true; sub: RemoteSubscription; meta: LocalFileMeta }
  | { ok: false; sub?: RemoteSubscription; error: string };

/** Public read: ordered list of subscriptions (oldest-first to match
 *  the order the user added them — the UI labels are stable across
 *  refreshes). */
export function getRemoteSubscriptions(): RemoteSubscription[] {
  return [...readSubs().list].sort((a, b) => a.addedAt - b.addedAt);
}

function deriveSubFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
    return u.hostname || url;
  } catch {
    return url.length > 80 ? url.slice(0, 77) + "..." : url;
  }
}

/** Add a new subscription and kick off the first fetch. The
 *  subscription itself is persisted BEFORE the fetch, so even when
 *  the URL is unreachable the row shows up in the UI (with a retry
 *  button) instead of silently swallowing the user's input. */
export async function addRemoteSubscription(url: string): Promise<SubscriptionResult> {
  await initLocalContent();
  const cleanUrl = url.trim();
  if (!cleanUrl) return { ok: false, error: "URL 不能为空" };
  if (!/^https?:\/\//i.test(cleanUrl)) {
    return { ok: false, error: "URL 必须以 http:// 或 https:// 开头" };
  }
  try {
    const saved = await idbUpdate([IDB_SUBS_KEY], ([value]) => {
      const state = storedSubs(value);
      if (state.list.some(row => row.url === cleanUrl)) return { result: { state, added: false } };
      const next = { ...state, list: [...state.list, { url: cleanUrl, addedAt: Date.now() }] };
      return { result: { state: next, added: true }, put: [[IDB_SUBS_KEY, next]] as const };
    });
    memSubs = saved.state;
    if (!saved.added) return { ok: false, error: "该 URL 已经订阅过了 / Already subscribed" };
  } catch (e: any) { return { ok: false, error: `订阅保存失败：${e?.message || String(e)}` }; }
  return refreshRemoteSubscription(cleanUrl);
}

async function recordSubscriptionError(sub: RemoteSubscription, message: string): Promise<RemoteSubscription | undefined> {
  try {
    memSubs = await idbUpdate([IDB_SUBS_KEY], ([value]) => {
      const state = storedSubs(value);
      if (!state.list.some(row => row.url === sub.url && row.addedAt === sub.addedAt)) return { result: state };
      const next = { ...state, list: state.list.map(row => row.url === sub.url && row.addedAt === sub.addedAt ? { ...row, lastError: message } : row) };
      return { result: next, put: [[IDB_SUBS_KEY, next]] as const };
    });
  } catch (error) {
    const local = readSubs().list.find(row => row.url === sub.url && row.addedAt === sub.addedAt);
    if (local) local.lastError = message;
    console.warn("[obr-suite/localContent] failed to persist subscription error", error);
  }
  return readSubs().list.find(row => row.url === sub.url && row.addedAt === sub.addedAt);
}

/** Force-fetch a single subscription. Replaces the previous file
 *  entry (if any) so we never accumulate stale snapshots. Failures
 *  leave the cached file intact and only update `lastError`. */
export async function refreshRemoteSubscription(url: string): Promise<SubscriptionResult> {
  await initLocalContent();
  const sub = readSubs().list.find((s) => s.url === url);
  if (!sub) return { ok: false, error: "未找到对应的订阅" };

  let text: string;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e: any) {
    const error = `网络错误：${e?.message || String(e)}`;
    return { ok: false, sub: await recordSubscriptionError(sub, error), error };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e: any) {
    const error = `JSON 解析失败：${e?.message || String(e)}`;
    return { ok: false, sub: await recordSubscriptionError(sub, error), error };
  }
  const kinds = detectKinds(parsed);
  if (kinds.length === 0) {
    const error = "JSON 顶层缺少识别的内容键（应为 monster / spell / item / feat 等）";
    return { ok: false, sub: await recordSubscriptionError(sub, error), error };
  }
  const primaryKind = kinds[0];

  let count = 0;
  for (const k of kinds) {
    if (Array.isArray(parsed[k])) count += parsed[k].length;
  }
  try {
    const saved = await idbUpdate([IDB_INDEX_KEY, IDB_SUBS_KEY], ([indexValue, subsValue]) => {
      const oldIndex = storedIndex(indexValue), oldSubs = storedSubs(subsValue);
      const current = oldSubs.list.find(row => row.url === url && row.addedAt === sub.addedAt);
      if (!current) throw new Error("该订阅已移除或替换，未保存迟到的刷新结果");
      // Keep the URL's file identity and commit content plus both indexes together.
      const id = current.fileId ?? `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const meta: LocalFileMeta = { id, filename: deriveSubFilename(url), kind: primaryKind, kinds: kinds.length > 1 ? kinds : undefined, count, addedAt: Date.now(), remoteUrl: url };
      const nextSub = { ...current, fileId: id, lastFetchedAt: Date.now() };
      delete nextSub.lastError;
      const index = { ...oldIndex, files: [...oldIndex.files.filter(row => row.id !== id), meta] };
      const subscriptions = { ...oldSubs, list: oldSubs.list.map(row => row === current ? nextSub : row) };
      return { result: { index, subscriptions, sub: nextSub, meta }, put: [[IDB_FILE_PREFIX + id, parsed], [IDB_INDEX_KEY, index], [IDB_SUBS_KEY, subscriptions]] as const };
    });
    memFiles.set(saved.meta.id, parsed);
    memIndex = saved.index;
    memSubs = saved.subscriptions;
    return { ok: true, sub: saved.sub, meta: saved.meta };
  } catch (e: any) {
    const error = `存储失败：${e?.message || String(e)}`;
    return { ok: false, sub: await recordSubscriptionError(sub, error), error };
  }
}

/** Remove a subscription AND its cached file together — a "delete"
 *  on a subscribed row should drop the data too, otherwise the user
 *  is left with an orphaned local file they didn't manually import. */
export async function removeRemoteSubscription(url: string): Promise<void> {
  await initLocalContent();
  const saved = await idbUpdate([IDB_INDEX_KEY, IDB_SUBS_KEY], ([indexValue, subsValue]) => {
    const oldIndex = storedIndex(indexValue), oldSubs = storedSubs(subsValue), sub = oldSubs.list.find(row => row.url === url);
    const index = { ...oldIndex, files: oldIndex.files.filter(row => row.id !== sub?.fileId) };
    const subscriptions = { ...oldSubs, list: oldSubs.list.filter(row => row.url !== url) };
    return { result: { index, subscriptions, fileId: sub?.fileId }, put: [[IDB_INDEX_KEY, index], [IDB_SUBS_KEY, subscriptions]] as const, delete: sub?.fileId ? [IDB_FILE_PREFIX + sub.fileId] : [] };
  });
  if (saved.fileId) memFiles.delete(saved.fileId);
  memIndex = saved.index;
  memSubs = saved.subscriptions;
}

let refreshStalePromise: Promise<{ refreshed: number; failed: number }> | null = null;

/** Sweep every subscription whose last successful fetch is older than
 *  SUB_STALE_MS (or whose first fetch never succeeded) and try
 *  fetching them. Within a single session this is memoised — repeat
 *  callers get the same in-flight promise so we don't spam the
 *  homebrew host when multiple iframes ask in parallel. Pass
 *  `force=true` to bypass the memoisation (used by the "刷新全部"
 *  button to retry within the same session). */
export function refreshStaleSubscriptions(force = false): Promise<{ refreshed: number; failed: number }> {
  if (!refreshStalePromise || force) {
    refreshStalePromise = doRefreshStale(force);
  }
  return refreshStalePromise;
}

async function doRefreshStale(force: boolean): Promise<{ refreshed: number; failed: number }> {
  await initLocalContent();
  const now = Date.now();
  const subs = [...readSubs().list];
  let refreshed = 0;
  let failed = 0;
  for (const s of subs) {
    if (!force && s.lastFetchedAt && now - s.lastFetchedAt < SUB_STALE_MS) continue;
    const r = await refreshRemoteSubscription(s.url);
    if (r.ok) refreshed++; else failed++;
  }
  return { refreshed, failed };
}

/** Drop and re-populate the in-memory mirror from IDB. Use this in
 *  BC_LOCAL_CONTENT_CHANGED handlers so cross-iframe updates take
 *  effect without a page reload — without this, each iframe's
 *  `memFiles` was being held statically from its own init, which
 *  meant the settings iframe could write fresh content into IDB but
 *  the search / bestiary iframes would keep reading their old
 *  snapshot. */
export async function forceReloadLocalContent(): Promise<void> {
  initPromise = null;
  memIndex = { files: [] };
  memFiles.clear();
  memSubs = { list: [] };
  await initLocalContent();
}
