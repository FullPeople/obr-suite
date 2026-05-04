import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  getLocalLang,
  onLangChange,
  DataVersion,
  Language,
} from "../../state";
import { formatTagsClickable, fireQuickRoll, resolveClickRollTarget } from "../dice/tags";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import { applyI18nDom } from "../../i18n";
import {
  getLocalIndexFile,
  getLocalDataByKeySource,
  getLocalContentSignature,
  BC_LOCAL_CONTENT_CHANGED,
} from "../../utils/localContent";

// Suite-version of the search bar — independent top-right popover with
// its OWN visible input row (not driven by cluster). The popover resizes
// itself via OBR.popover.setWidth/setHeight as the user types / clears,
// so when idle the popover is only 280×40 and clicks below the input
// pass through to the canvas naturally.

const POPOVER_ID = "com.obr-suite/search-bar";

// Data source — kiwee.top works for both languages, but additional
// libraries can be wired in via the suite's library list (set in
// Settings → 库设置). When >1 library is enabled, loadIndex fetches
// from every one and merges entries — that way a self-hosted
// Cloudflare lib's homebrew monsters show up in search alongside
// the kiwee defaults.
const DEFAULT_BASE = "https://5e.kiwee.top";

function getEnabledLibraryBases(): string[] {
  try {
    const libs = getState().libraries || [];
    const bases = libs
      .filter((l) => l.enabled && typeof l.baseUrl === "string" && l.baseUrl.trim().length > 0)
      .map((l) => l.baseUrl.replace(/\/+$/, ""));
    return bases.length > 0 ? bases : [DEFAULT_BASE];
  } catch {
    return [DEFAULT_BASE];
  }
}

/** Like getEnabledLibraryBases but also returns each library's
 *  configured `indexPath` (defaults to `search/index.json` when
 *  unset). Used by `loadIndex` so the partnered kiwee listing
 *  (`search/index-partnered.json`) gets fetched correctly. */
function getEnabledLibrarySources(): Array<{ base: string; indexPath: string }> {
  try {
    const libs = getState().libraries || [];
    const out = libs
      .filter((l) => l.enabled && typeof l.baseUrl === "string" && l.baseUrl.trim().length > 0)
      .map((l) => ({
        base: l.baseUrl.replace(/\/+$/, ""),
        indexPath: typeof l.indexPath === "string" && l.indexPath.length > 0
          ? l.indexPath.replace(/^\/+/, "")
          : "search/index.json",
      }));
    return out.length > 0 ? out : [{ base: DEFAULT_BASE, indexPath: "search/index.json" }];
  } catch {
    return [{ base: DEFAULT_BASE, indexPath: "search/index.json" }];
  }
}

function dataBase(_lang: Language): string {
  // First enabled lib is the "primary" — used for per-entry data
  // fetches that look up by source code (we walk every base when
  // resolving). Fallback is the kiwee mirror.
  return getEnabledLibraryBases()[0];
}
function indexUrl(lang: Language): string { return `${dataBase(lang)}/search/index.json`; }
function booksUrl(lang: Language): string { return `${dataBase(lang)}/data/books.json`; }

const BAR_W_IDLE = 280;
const BAR_W_OPEN = 720;
const BAR_H_IDLE = 40;
const BAR_H_OPEN = 440;

// v2 (2026-05-04): bumped to force re-fetch after the partnered
// kiwee library + cross-library dedup changes. Old v1 caches under
// `obr-suite/search-index-v1*` are stale and ignored.
const CACHE_KEY = "obr-suite/search-index-v2";
const BOOKS_CACHE_KEY = "obr-suite/search-books-v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 50;

// --- Types ---
interface Entry {
  id: number;
  c: number;
  u: string;
  p?: number;
  s?: number | string;
  h?: number;
  hx?: number;
  r?: number;
  r2?: number;
  d?: number;
  dR?: number;
  n: string;
  cn?: string;
  uh?: string;
  b?: string;
}
interface IndexFile {
  x: Entry[];
  m: { s: Record<string, number> };
}
interface DataEntry {
  ENG_name?: string;
  name?: string;
  source?: string;
  page?: number;
  entries?: any[];
  [k: string]: any;
}

interface CategoryInfo {
  label: string;
  data?:
    | { file: string; key: string }
    | { fileBySource: (src: string) => string; key: string }
    // Class-family lookup: 5etools splits each class into its own file
    // (`class/class-{slug}.json`) and the search index entry doesn't
    // expose the parent-class English slug. We fetch `class/index.json`
    // → all listed files in parallel and merge their key arrays.
    // Used by c=5 / 30 / 40 / 41.
    | { allClassFiles: true; key: string }
    // Same idea for itemProperty / itemMastery: weapon properties
    // (轻型 / 灵巧 / 投掷 / 重型 …) live in `items-base.json` which
    // isn't covered by the search index. We extract the names so
    // clicking a property chip on a weapon row at least gets a hit.
    | { itemsBaseKey: string; key: string };
}

const CATEGORY: Record<number, CategoryInfo> = {
  1:  { label: "怪物", data: { fileBySource: (s) => `bestiary/bestiary-${s}.json`, key: "monster" } },
  2:  { label: "法术", data: { fileBySource: (s) => `spells/spells-${s}.json`, key: "spell" } },
  3:  { label: "背景", data: { file: "backgrounds.json", key: "background" } },
  4:  { label: "物品", data: { file: "items.json", key: "item" } },
  // 5etools classes are split into one file per class —
  // `class/class-{className-slug}.json`. The search index doesn't
  // surface the parent-class slug for features, so we fetch
  // `class/index.json` and pool every file's key array together.
  5:  { label: "职业", data: { allClassFiles: true, key: "class" } },
  6:  { label: "状态", data: { file: "conditionsdiseases.json", key: "condition" } },
  7:  { label: "专长", data: { file: "feats.json", key: "feat" } },
  8:  { label: "能力", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  9:  { label: "灵能", data: { file: "psionics.json", key: "psionic" } },
  10: { label: "种族", data: { file: "races.json", key: "race" } },
  11: { label: "奖励", data: { file: "rewards.json", key: "reward" } },
  12: { label: "副规则", data: { file: "variantrules.json", key: "variantrule" } },
  13: { label: "冒险", data: { file: "adventures.json", key: "adventure" } },
  14: { label: "神祇", data: { file: "deities.json", key: "deity" } },
  15: { label: "载具", data: { file: "vehicles.json", key: "vehicle" } },
  16: { label: "陷阱", data: { file: "trapshazards.json", key: "trap" } },
  17: { label: "灾害", data: { file: "trapshazards.json", key: "hazard" } },
  18: { label: "整本书", data: { file: "books.json", key: "book" } },
  19: { label: "教派", data: { file: "cultsboons.json", key: "cult" } },
  20: { label: "恩惠", data: { file: "cultsboons.json", key: "boon" } },
  21: { label: "疾病", data: { file: "conditionsdiseases.json", key: "disease" } },
  22: { label: "超魔", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  23: { label: "招式", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  24: { label: "表格", data: { file: "tables.json", key: "table" } },
  25: { label: "牌组" },
  27: { label: "奥术箭", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  29: { label: "战斗风格", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  30: { label: "职业能力", data: { allClassFiles: true, key: "classFeature" } },
  31: { label: "物品", data: { file: "items.json", key: "item" } },
  32: { label: "盟约", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  33: { label: "武僧能力", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  34: { label: "灌注", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  35: { label: "载具升级", data: { file: "vehicles.json", key: "vehicleUpgrade" } },
  36: { label: "船定制" },
  37: { label: "符文", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  40: { label: "子职业", data: { allClassFiles: true, key: "subclass" } },
  41: { label: "子职能力", data: { allClassFiles: true, key: "subclassFeature" } },
  42: { label: "动作", data: { file: "actions.json", key: "action" } },
  43: { label: "语言", data: { file: "languages.json", key: "language" } },
  44: { label: "整本书", data: { file: "books.json", key: "book" } },
  45: { label: "页面" },
  46: { label: "怪物概述", data: { fileBySource: (s) => `bestiary/fluff-bestiary-${s}.json`, key: "monsterFluff" } },
  47: { label: "角色选项", data: { file: "items.json", key: "item" } },
  48: { label: "食谱", data: { file: "recipes.json", key: "recipe" } },
  49: { label: "规则", data: { file: "conditionsdiseases.json", key: "status" } },
  50: { label: "技能" },
  51: { label: "感官" },
  52: { label: "牌组", data: { file: "decks.json", key: "deck" } },
  53: { label: "牌内容" },
  54: { label: "武器精通", data: { itemsBaseKey: "itemMastery", key: "itemMastery" } },
  // c=58 is a SUITE-synthesised pseudo-category for weapon properties
  // (轻型 / 灵巧 / 投掷 / …). 5etools doesn't index them, but we
  // synthesise virtual search entries from items-base.json's
  // itemProperty array so weapon-property chips on the cc-info popup
  // can resolve a definition.
  58: { label: "武器属性", data: { itemsBaseKey: "itemProperty", key: "itemProperty" } },
  55: { label: "地点" },
  56: { label: "物品集合", data: { file: "items.json", key: "itemGroup" } },
  57: { label: "物品", data: { file: "items.json", key: "item" } },
};
function categoryInfo(c: number): CategoryInfo {
  return CATEGORY[c] ?? { label: `?${c}` };
}

// --- Source code lookup ---
let sourceById = new Map<number, string>();
let sourceNames = new Map<string, string>();
function srcCode(s: Entry["s"]): string {
  if (typeof s === "string") return s;
  if (typeof s === "number") return sourceById.get(s) ?? "";
  return "";
}
function sourceLabel(code: string): string {
  const cn = sourceNames.get(code.toUpperCase());
  return cn ? `${code}（${cn}）` : code;
}

// --- Index + books fetch & cache ---
let indexCache: IndexFile | null = null;
let indexLoading: Promise<IndexFile> | null = null;
let booksLoading: Promise<void> | null = null;

async function loadIndex(): Promise<IndexFile> {
  if (indexCache) return indexCache;
  if (indexLoading) return indexLoading;
  indexLoading = (async () => {
    // Cache key is keyed on the active library set + local-content
    // signature so switching libraries OR adding/removing local
    // imports both invalidate the cached merged index.
    const sources = getEnabledLibrarySources();
    // Cache key encodes both base AND indexPath so toggling between
    // index.json and index-partnered.json invalidates the cache.
    const cacheKey = `${CACHE_KEY}:${sources.map((s) => `${s.base}|${s.indexPath}`).join("||")}:${getLocalContentSignature()}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; data: IndexFile };
        if (Date.now() - parsed.ts < CACHE_TTL_MS && parsed.data?.x?.length) {
          indexCache = parsed.data;
          buildSourceMap(indexCache);
          return indexCache;
        }
      }
    } catch {}
    // Fetch all libraries in parallel; merge `x` (entries) by
    // (cn / n / source) and the source map `m.s` by code.
    const perLibrary = await Promise.all(
      sources.map(async ({ base, indexPath }) => {
        try {
          const res = await fetch(`${base}/${indexPath}`, { cache: "no-cache" });
          if (!res.ok) return null;
          return (await res.json()) as IndexFile;
        } catch (e) {
          console.warn(`[obr-suite/search] index fetch failed for ${base}/${indexPath}`, e);
          return null;
        }
      })
    );
    const valid = perLibrary.filter((x): x is IndexFile => !!x && Array.isArray(x.x));
    // Locally-imported homebrew gets synthesised into a virtual
    // index file so it merges into the same flow as URL libraries.
    const localIdx = getLocalIndexFile();
    const allValid = localIdx.x.length > 0 ? [...valid, localIdx as unknown as IndexFile] : valid;
    if (allValid.length === 0) {
      throw new Error("no library returned a valid search index");
    }
    // Naive merge — primary lib's source map wins, all entries pooled.
    // dedupeKey uses `${cn}|${n}|${s ?? ""}` so the same monster from
    // two libraries collapses to one row (custom lib wins because
    // it's typically listed first).
    const merged: IndexFile = { x: [], m: { s: {} } };
    for (const lib of allValid) {
      if (lib.m?.s) {
        for (const [code, id] of Object.entries(lib.m.s)) {
          if (!(code in merged.m.s)) merged.m.s[code] = id;
        }
      }
    }
    // 2026-05-04 dedupe overhaul: the partnered kiwee library
    // overlaps significantly with the main kiwee one (same monsters
    // listed in both). The naive `s` field won't dedupe across
    // libraries because the same source can be assigned different
    // numeric ids in each lib's `m.s` map. Resolve the entry's
    // source to its CODE STRING per-library, normalise to lower-
    // case, and use that in the dedupe key. Result: identical
    // monsters from two libraries collapse to one row regardless
    // of how each lib chose to number its sources.
    const resolveSourceCode = (e: Entry, lib: IndexFile): string => {
      if (e.s == null) return "";
      if (typeof e.s === "string") return e.s.toLowerCase();
      const map = lib.m?.s || {};
      for (const [code, id] of Object.entries(map)) {
        if (id === e.s) return code.toLowerCase();
      }
      return String(e.s).toLowerCase();
    };
    const seen = new Set<string>();
    for (const lib of allValid) {
      for (const e of lib.x) {
        const cn = (e.cn || "").trim().toLowerCase();
        const n = (e.n || "").trim().toLowerCase();
        const src = resolveSourceCode(e, lib);
        const key = `${cn}|${n}|${src}|${e.c ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.x.push(e);
      }
    }
    // Synthesise weapon-property entries from items-base.json's
    // itemProperty array. 5etools doesn't add these to the search
    // index because they're definitional, but the cc-info weapon
    // chips need them to resolve. Best-effort — first library that
    // 200s wins.
    try {
      for (const base of bases) {
        try {
          const r = await fetch(`${base}/data/items-base.json`, { cache: "no-cache" });
          if (!r.ok) continue;
          const j = await r.json();
          const arr = (j.itemProperty ?? []) as any[];
          let synthId = 9_000_000;
          for (const p of arr) {
            const inner = Array.isArray(p.entries) && p.entries[0] && typeof p.entries[0] === "object" ? p.entries[0] : null;
            const cn = (p as any).name ?? inner?.name ?? "";
            const en = (p as any).ENG_name ?? inner?.ENG_name ?? (p as any).abbreviation ?? "";
            if (!cn && !en) continue;
            const dedupeKey = `${cn}|${en}|prop`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            merged.x.push({
              id: synthId++,
              c: 58,
              s: (p as any).source ?? "",
              n: en,
              cn,
            } as any);
          }
          break;
        } catch {}
      }
    } catch {}
    indexCache = merged;
    buildSourceMap(indexCache);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: merged }));
    } catch {}
    return merged;
  })();
  try { return await indexLoading; } finally { indexLoading = null; }
}

function buildSourceMap(idx: IndexFile) {
  sourceById = new Map();
  if (idx.m?.s) {
    for (const [code, id] of Object.entries(idx.m.s)) {
      sourceById.set(id, code);
    }
  }
}

async function loadBooks(): Promise<void> {
  if (booksLoading) return booksLoading;
  if (sourceNames.size > 0) return;
  booksLoading = (async () => {
    try {
      const raw = localStorage.getItem(BOOKS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; data: Record<string, string> };
        if (Date.now() - parsed.ts < CACHE_TTL_MS) {
          for (const [k, v] of Object.entries(parsed.data)) sourceNames.set(k, v);
          return;
        }
      }
    } catch {}
    try {
      const res = await fetch(booksUrl(getLocalLang()), { cache: "no-cache" });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, string> = {};
      for (const b of data.book ?? []) {
        if (b.source && b.name) {
          const code = String(b.source).toUpperCase();
          const cn = String(b.name);
          sourceNames.set(code, cn);
          map[code] = cn;
        }
      }
      try {
        localStorage.setItem(
          BOOKS_CACHE_KEY,
          JSON.stringify({ ts: Date.now(), data: map })
        );
      } catch {}
    } catch {}
  })();
  return booksLoading;
}

// --- Filter & search ---
interface FilterOpts {
  dataVersion: DataVersion;
  language: Language;
  isGM: boolean;
  allowPlayerMonsters: boolean;
}
interface Hit { entry: Entry; score: number; }

const CORE_2014 = new Set(["PHB", "MM"]);
const CORE_2024 = new Set(["XPHB", "XMM"]);

function passesVersion(code: string, dv: DataVersion): boolean {
  if (dv === "all") return true;
  // Custom / homebrew sources are "other" — always visible regardless
  // of the 2014/2024 toggle. Mirrors bestiary/data.ts detectEdition,
  // where anything not in the strict core sets falls into "other"
  // which is unconditionally enabled. Without this, default
  // dataVersion="2024" filtered out HOMEBREW / DEMO / etc. and the
  // user could only see them by switching to "all".
  const isCore = CORE_2014.has(code) || CORE_2024.has(code);
  if (!isCore) return true;
  if (dv === "2014") return CORE_2014.has(code);
  if (dv === "2024") return CORE_2024.has(code);
  return true;
}

function search(query: string, idx: IndexFile, opts: FilterOpts): Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  const preferEn = opts.language === "en";

  for (const e of idx.x) {
    const code = srcCode(e.s).toUpperCase();
    if (!passesVersion(code, opts.dataVersion)) continue;

    if ((e.c === 1 || e.c === 46) && !opts.isGM && !opts.allowPlayerMonsters) {
      continue;
    }

    const en = e.n?.toLowerCase() ?? "";
    const cn = e.cn?.toLowerCase() ?? "";

    let s = -1;
    const a = preferEn ? en : cn;
    const b = preferEn ? cn : en;
    if (a.startsWith(q)) s = 0 + a.length / 1000;
    else if (b && b.startsWith(q)) s = 0.5 + b.length / 1000;
    else if (a.includes(q)) s = 1 + a.length / 1000;
    else if (b && b.includes(q)) s = 1.5 + b.length / 1000;
    else continue;
    hits.push({ entry: e, score: s });
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, MAX_RESULTS).map((h) => h.entry);
}

// --- Per-source data file cache ---
const dataCache = new Map<string, DataEntry[]>();
const dataPending = new Map<string, Promise<DataEntry[]>>();
function dataCacheKey(c: number, src: string): string {
  return `${c}:${src.toLowerCase()}`;
}
async function loadCategoryData(
  entry: Entry,
  catOverride?: CategoryInfo,
): Promise<DataEntry[]> {
  // findEntryData passes a `catOverride` with a swapped key (race →
  // subrace, class → subclass / classFeature) when the primary
  // lookup misses. Same file, different list inside.
  const cat = catOverride ?? categoryInfo(entry.c);
  if (!cat.data) return [];

  // Class-family lookup: pool every class-*.json file. Cache key is
  // independent of entry source/category since the pooled data covers
  // all sources at once.
  if ("allClassFiles" in cat.data) {
    return loadAllClassData(cat.data.key);
  }

  // itemsBaseKey: weapon properties / item masteries pulled from
  // items-base.json. The file isn't in the search index but the chip
  // search flow still wants definitions for 灵巧 / 轻型 / 投掷 / etc.
  if ("itemsBaseKey" in cat.data) {
    return loadItemsBaseSubarray(cat.data.itemsBaseKey);
  }

  const srcOriginal = srcCode(entry.s);
  const src = srcOriginal.toLowerCase();
  // Cache key must include the data key (not just c+src) so
  // race-vs-subrace lookups don't collide.
  const ck = `${dataCacheKey(entry.c, src)}:${cat.data.key}`;
  const cached = dataCache.get(ck);
  if (cached) return cached;
  const pending = dataPending.get(ck);
  if (pending) return pending;
  // Build candidate file paths. Different libraries follow different
  // case conventions for the source segment in filenames:
  //   - kiwee.top:        bestiary-mm.json (lowercase)
  //   - homebrew/GitHub:  bestiary-HOMEBREW.json (uppercase)
  // Try every case variant in parallel — case-sensitive servers like
  // GitHub Pages 404 on the wrong case, so we have to send all
  // candidates and merge whichever 200s.
  const filePathsForSrc = (s: string) => "fileBySource" in cat.data!
    ? [cat.data!.fileBySource(s)]
    : [cat.data!.file];
  const candidatePaths = new Set<string>([
    ...filePathsForSrc(src),                  // lowercase
    ...filePathsForSrc(srcOriginal),          // original case
    ...filePathsForSrc(srcOriginal.toUpperCase()),  // uppercase
  ]);
  const bases = getEnabledLibraryBases();
  const p = (async () => {
    // Local imports always win — if the user has a homebrew JSON
    // imported with the matching source, prefer it over any URL.
    try {
      const localArr = getLocalDataByKeySource(cat.data!.key, srcCode(entry.s));
      if (localArr.length > 0) {
        dataCache.set(ck, localArr as DataEntry[]);
        return localArr as DataEntry[];
      }
    } catch (e) {
      console.warn("[obr-suite/search] local data lookup failed", e);
    }
    // Fetch from every (base × candidatePath) combination in parallel
    // and merge. First non-empty result keyed (ENG_name|source)
    // survives. Built-in kiwee will typically have most entries;
    // custom hosts contribute their homebrew without overwriting.
    const responses = await Promise.all(
      bases.flatMap((base) =>
        [...candidatePaths].map(async (path) => {
          try {
            const res = await fetch(`${base}/data/${path}`, { cache: "no-cache" });
            if (!res.ok) return null;
            const json = await res.json();
            return (json[cat.data!.key] ?? []) as DataEntry[];
          } catch {
            return null;
          }
        }),
      ),
    );
    const merged: DataEntry[] = [];
    const seen = new Set<string>();
    for (const arr of responses) {
      if (!arr) continue;
      for (const e of arr) {
        const key = `${(e.ENG_name || e.name || "").toLowerCase()}|${(e.source || "").toUpperCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(e);
      }
    }
    dataCache.set(ck, merged);
    return merged;
  })().finally(() => { dataPending.delete(ck); });
  dataPending.set(ck, p);
  return p;
}

// === Class-family pooled loader ======================================
// 5etools splits each class into its own JSON file; the search index
// doesn't include the parent-class slug for features. We pool every
// `class/class-*.json` listed in `class/index.json` and merge the
// requested key (class / classFeature / subclass / subclassFeature).
const classPoolCache = new Map<string, DataEntry[]>();
const classPoolPending = new Map<string, Promise<DataEntry[]>>();
async function loadAllClassData(key: string): Promise<DataEntry[]> {
  const cached = classPoolCache.get(key);
  if (cached) return cached;
  const pending = classPoolPending.get(key);
  if (pending) return pending;
  const bases = getEnabledLibraryBases();
  const p = (async () => {
    const merged: DataEntry[] = [];
    const seen = new Set<string>();
    for (const base of bases) {
      let index: Record<string, string> | null = null;
      try {
        const res = await fetch(`${base}/data/class/index.json`, { cache: "no-cache" });
        if (res.ok) index = await res.json();
      } catch {}
      if (!index) continue;
      const filenames = Object.values(index);
      // Fetch all class files for this library in parallel.
      const arrays = await Promise.all(
        filenames.map(async (fn) => {
          try {
            const r = await fetch(`${base}/data/class/${fn}`, { cache: "no-cache" });
            if (!r.ok) return null;
            const j = await r.json();
            return (j[key] ?? []) as DataEntry[];
          } catch { return null; }
        }),
      );
      for (const arr of arrays) {
        if (!arr) continue;
        for (const e of arr) {
          // Dedupe across libraries by ENG_name + source — same
          // approach as the per-source loader above.
          const eng = (e.ENG_name || (e as any).name || "").toLowerCase();
          const src = (e.source || "").toUpperCase();
          const k = `${eng}|${src}|${(e as any).className ?? ""}|${(e as any).level ?? ""}`;
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(e);
        }
      }
    }
    classPoolCache.set(key, merged);
    return merged;
  })().finally(() => { classPoolPending.delete(key); });
  classPoolPending.set(key, p);
  return p;
}

// === items-base.json subarray loader ================================
// Weapon properties / item masteries (轻型 / 灵巧 / 投掷 / 重型 …) live
// in `items-base.json` under `itemProperty`. Not indexed by 5etools
// search — we load lazily so weapon-property chip searches in
// character-card popovers can resolve a definition.
const itemsBaseCache = new Map<string, DataEntry[]>();
const itemsBasePending = new Map<string, Promise<DataEntry[]>>();
async function loadItemsBaseSubarray(key: string): Promise<DataEntry[]> {
  const cached = itemsBaseCache.get(key);
  if (cached) return cached;
  const pending = itemsBasePending.get(key);
  if (pending) return pending;
  const bases = getEnabledLibraryBases();
  const p = (async () => {
    const merged: DataEntry[] = [];
    const seen = new Set<string>();
    for (const base of bases) {
      try {
        const r = await fetch(`${base}/data/items-base.json`, { cache: "no-cache" });
        if (!r.ok) continue;
        const j = await r.json();
        const arr = (j[key] ?? []) as DataEntry[];
        for (const e of arr) {
          // itemProperty entries are nested: each has `entries[]` whose
          // first item carries `name` (CN) + `ENG_name` (EN). Hoist
          // those onto the top-level entry so the standard search
          // matcher finds them.
          const inner = (Array.isArray(e.entries) && e.entries[0] && typeof e.entries[0] === "object") ? e.entries[0] : null;
          const top: DataEntry = {
            ...e,
            ENG_name: e.ENG_name ?? (inner as any)?.ENG_name ?? (e as any).abbreviation ?? "",
            name: (e as any).name ?? (inner as any)?.name ?? "",
            entries: inner?.entries ?? e.entries,
          };
          const eng = (top.ENG_name || top.name || "").toLowerCase();
          const src = (top.source || "").toUpperCase();
          const k = `${eng}|${src}`;
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(top);
        }
      } catch {}
    }
    itemsBaseCache.set(key, merged);
    return merged;
  })().finally(() => { itemsBasePending.delete(key); });
  itemsBasePending.set(key, p);
  return p;
}

// Parse the malformed `n` / `cn` fields the search index uses for
// class-family entries:
//   c=5  (class)             → n: "Wizard"             cn: "法师"
//   c=30 (classFeature)      → n: "奇械师 1; Spellcasting}"
//                                cn: "奇械师 1; 施法"
//   c=40 (subclass)          → n: "School of Evocation"      cn: "塑能学派"
//   c=41 (subclassFeature)   → n: "炼金师 奇械师 3; Alchemist"
//                                cn: "炼金师 奇械师 3; 炼金师"
// Returns a partial breakdown so the matcher can pick the right entry
// out of the pooled class data.
interface ParsedClassEntry {
  classCn: string | null;       // parent-class CN ("奇械师")
  level: number | null;         // 1, 2, 3, …
  featureEng: string | null;    // "Spellcasting"
  featureCn: string | null;     // "施法"
}
function parseClassFamilyEntry(entry: Entry): ParsedClassEntry {
  const n = String(entry.n ?? "").replace(/\}+$/, "").trim();
  const cn = String(entry.cn ?? "").replace(/\}+$/, "").trim();
  // Level + feature pattern: "<class> <level>; <feature>"
  const re = /^(.+?)\s+(\d+);\s*(.+)$/;
  const mEn = re.exec(n);
  const mCn = re.exec(cn);
  if (mEn || mCn) {
    return {
      classCn: mCn ? mCn[1].trim() : null,
      level: mEn ? parseInt(mEn[2], 10) : (mCn ? parseInt(mCn[2], 10) : null),
      featureEng: mEn ? mEn[3].trim() : null,
      featureCn: mCn ? mCn[3].trim() : null,
    };
  }
  // No semicolon → it's a top-level class or subclass entry.
  return {
    classCn: cn || null,
    level: null,
    featureEng: n || null,
    featureCn: cn || null,
  };
}

async function findEntryData(entry: Entry): Promise<DataEntry | null> {
  let arr = await loadCategoryData(entry);
  // Some 5etools categories are physically stored under MULTIPLE keys
  // in the same JSON file. The category map points at one primary
  // key, but if the lookup misses we widen to the fallback key(s).
  // Common cases:
  //   c=10 (race)   — top-level races at key "race", subraces (e.g.
  //                    Pale Elf, Sea Elf) at key "subrace".
  //   c=5 (class)   — primary "class", but sub-class data may also
  //                    appear at "subclass" / "classFeature".
  const fallbackKeys: Record<number, string[]> = {
    10: ["subrace", "race"],
    5: ["class", "subclass", "classFeature"],
    30: ["classFeature", "subclassFeature"],
  };
  const tryKeys = fallbackKeys[entry.c] ?? [];
  if (arr.length === 0 && tryKeys.length === 0) return null;

  const targetSrc = srcCode(entry.s).toUpperCase();
  // For class-family entries the search index encodes `n` as
  // "<className_cn> <level>; <featureName>" (with stray `}`); the
  // CN side is in `cn`. We need to extract the feature name + parent
  // class name to match against the pooled file data.
  const isClassFamily = [5, 30, 40, 41].includes(entry.c);
  const parsed = isClassFamily ? parseClassFamilyEntry(entry) : null;
  const matchAny = (pool: DataEntry[]): DataEntry | null => {
    if (parsed) {
      // Match strategy for class/feature/subclass/subclassFeature.
      // Falls back through progressively looser matches so homebrew
      // packs (where ENG_name is often missing or set to a Chinese
      // string) still resolve content. The key insight for homebrew
      // is that featureEng will frequently equal featureCn — the
      // index regex extracts whatever's in `n` regardless of script.
      const targetEng = parsed.featureEng?.toLowerCase();
      const targetCn = parsed.featureCn;
      const targetClass = parsed.classCn;
      const lvl = parsed.level;
      const matchByLevel = (e: any) =>
        lvl == null || e.level == null || e.level === lvl;
      const matchByClass = (e: any) =>
        targetClass ? (e.className === targetClass) : true;
      // Helper: case-insensitive name comparison that also tries the
      // raw `name` field (homebrew packs sometimes only set `name`).
      const nameMatches = (e: any, target: string | null | undefined): boolean => {
        if (!target) return false;
        const t = target.toLowerCase();
        const eng = (e.ENG_name || "").toLowerCase();
        const nm = (e.name || "").toLowerCase();
        return eng === t || nm === t;
      };
      return (
        // 1. ENG_name + source + className + level
        pool.find((e: any) =>
          nameMatches(e, targetEng) &&
          e.source?.toUpperCase() === targetSrc &&
          matchByClass(e) &&
          matchByLevel(e),
        ) ??
        // 2. ENG_name + className + level (any source)
        pool.find((e: any) =>
          nameMatches(e, targetEng) &&
          matchByClass(e) &&
          matchByLevel(e),
        ) ??
        // 3. featureCn + className + level (homebrew often has
        //    only Chinese names with featureEng === featureCn)
        pool.find((e: any) =>
          nameMatches(e, targetCn) &&
          matchByClass(e) &&
          matchByLevel(e),
        ) ??
        // 4. ENG_name alone
        pool.find((e: any) => nameMatches(e, targetEng)) ??
        // 5. featureCn alone
        pool.find((e: any) => nameMatches(e, targetCn)) ??
        // 6. CN name only via raw `name` field (last resort)
        pool.find((e: any) => targetCn && e.name === targetCn) ??
        null
      );
    }
    return (
      pool.find(
        (e) =>
          e.ENG_name?.toLowerCase() === entry.n.toLowerCase() &&
          e.source?.toUpperCase() === targetSrc,
      ) ??
      pool.find((e) => e.ENG_name?.toLowerCase() === entry.n.toLowerCase()) ??
      // Some subrace entries store the sub name in `name` only (e.g.
      // "苍白精灵") with no separate ENG_name in the cn release.
      pool.find((e) => (e as any).name?.toLowerCase() === entry.n.toLowerCase()) ??
      null
    );
  };

  let found = matchAny(arr);
  if (!found && tryKeys.length > 0) {
    const cat = categoryInfo(entry.c);
    if (cat.data) {
      // Refetch with each fallback key and try matching there.
      for (const k of tryKeys) {
        if (k === cat.data.key) continue; // already tried
        const altCat: CategoryInfo = {
          ...cat,
          data: { ...cat.data, key: k } as CategoryInfo["data"],
        };
        const altArr = await loadCategoryData({ ...entry } as Entry, altCat);
        const hit = matchAny(altArr);
        if (hit) {
          found = hit;
          break;
        }
      }
    }
  }
  if (!found) return null;
  if (!found.entries && found._copy) {
    const cp = found._copy;
    const parentName = (cp.ENG_name || cp.name || "")?.toLowerCase();
    if (parentName) {
      const parent = arr.find((e) => (e.ENG_name || e.name || "").toLowerCase() === parentName);
      if (parent?.entries) {
        return { ...found, entries: parent.entries, _copyResolvedFrom: parent.ENG_name || parent.name };
      }
    }
  }
  return found;
}

// --- HTML escape + 5etools tag stripping ---
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function stripTags(s: string): string {
  return s.replace(/\{@(\w+)\s+([^}]+)\}/g, (_m, _tag, arg) => {
    const parts = String(arg).split("|");
    if (parts.length >= 3 && parts[2]) return parts[2];
    return parts[0];
  });
}
function richTags(s: string): string {
  return formatTagsClickable(s);
}

// --- Generic recursive renderer (strings + 5etools structured types) ---
function renderEntries(entries: any[]): string {
  return entries.map(renderEntry).join("");
}
function renderEntry(e: any): string {
  if (e == null) return "";
  if (typeof e === "string") return `<p>${richTags(e)}</p>`;
  if (typeof e !== "object") return "";
  const type = e.type ?? "entries";
  if (type === "entries" || type === "section") {
    const head = e.name ? `<h4>${escapeHtml(stripTags(e.name))}</h4>` : "";
    return head + (e.entries ? renderEntries(e.entries) : "");
  }
  if (type === "list") {
    const items = (e.items || [])
      .map((it: any) => `<li>${renderEntryInline(it)}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }
  if (type === "table") {
    const head = (e.colLabels || [])
      .map((c: string) => `<th>${escapeHtml(stripTags(c))}</th>`)
      .join("");
    const body = (e.rows || [])
      .map(
        (row: any[]) =>
          `<tr>${row.map((c) => `<td>${renderEntryInline(c)}</td>`).join("")}</tr>`
      )
      .join("");
    return `<table>${head ? `<thead><tr>${head}</tr></thead>` : ""}<tbody>${body}</tbody></table>`;
  }
  if (type === "inset" || type === "insetReadaloud") {
    return `<div class="inset">${e.entries ? renderEntries(e.entries) : ""}</div>`;
  }
  if (type === "quote") {
    const body = e.entries ? renderEntries(e.entries) : "";
    const by = e.by ? `<div class="quote-by">— ${escapeHtml(stripTags(e.by))}</div>` : "";
    return `<blockquote>${body}${by}</blockquote>`;
  }
  if (type === "item" || type === "itemSub") {
    const name = e.name ? `<b>${escapeHtml(stripTags(e.name))}.</b> ` : "";
    const entries = e.entries ? renderEntries(e.entries) : "";
    const single = !e.entries && e.entry ? renderEntryInline(e.entry) : "";
    return `<p>${name}${entries}${single}</p>`;
  }
  if (e.entries) return renderEntries(e.entries);
  return "";
}
function renderEntryInline(e: any): string {
  if (e == null) return "";
  if (typeof e === "string") return richTags(e);
  if (typeof e !== "object") return "";
  if (e.type === "item") {
    const name = e.name ? `<b>${escapeHtml(stripTags(e.name))}.</b> ` : "";
    const inner = e.entries
      ? renderEntries(e.entries)
      : e.entry
      ? renderEntryInline(e.entry)
      : "";
    return name + inner;
  }
  return renderEntry(e);
}

// --- Category-specific renderers ---

const ABILITY_ZH: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ABILITY_LABEL: Record<string, string> = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};

const ALIGN_ZH: Record<string, string> = {
  L: "守序", N: "中立", C: "混乱", G: "善良", E: "邪恶", U: "无属", A: "任意",
};
function alignmentStr(a: any): string {
  if (!a) return "";
  if (typeof a === "string") return ALIGN_ZH[a] ?? a;
  if (Array.isArray(a))
    return a.map((x) => (typeof x === "string" ? ALIGN_ZH[x] ?? x : "")).join("");
  return "";
}
function typeStr(t: any): string {
  if (!t) return "";
  if (typeof t === "string") return stripTags(t);
  if (typeof t === "object" && t.type) return stripTags(t.type);
  return "";
}

function chipsFor(entry: Entry, data: DataEntry | null): string {
  if (!data) return "";
  const c = entry.c;
  const chips: string[] = [];
  const add = (label: string, value: string) => {
    if (value) chips.push(
      `<span class="chip"><span class="chip-l">${escapeHtml(label)}</span><span class="chip-v">${escapeHtml(value)}</span></span>`
    );
  };
  if (c === 1 || c === 46) {
    add("CR", crStr(data.cr));
    add("AC", acStr(data.ac));
    add("HP", hpStr(data.hp));
    add("速度", speedStr(data.speed));
  } else if (c === 2) {
    add("环阶", spellLevelStr(data.level));
    add("学派", schoolStr(data.school));
    add("施法", timeStr(data.time));
    add("距离", rangeStr(data.range));
    add("成分", componentsStr(data.components));
    add("持续", durationStr(data.duration));
  } else if (c === 4 || c === 56 || c === 57) {
    add("类型", String(data.type ?? data.weaponCategory ?? data.armorCategory ?? ""));
    if (data.weight != null) add("重量", `${data.weight} 磅`);
    if (data.value != null) add("价值", `${data.value} cp`);
    if (data.rarity) add("稀有度", String(data.rarity));
    if (data.reqAttune) add("需调谐", typeof data.reqAttune === "string" ? stripTags(data.reqAttune) : "是");
  } else if (c === 8) {
    if (data.prerequisite) add("先决", prerequisiteStr(data.prerequisite));
  } else if (c === 10) {
    add("体型", sizeStr(data.size));
    add("速度", speedStr(data.speed));
  }
  return chips.length ? `<div class="chips">${chips.join("")}</div>` : "";
}

function renderMonster(entry: Entry, data: DataEntry): string {
  const parts: string[] = [];

  const sz = sizeStr(data.size);
  const ty = typeStr(data.type);
  const al = alignmentStr(data.alignment);
  const sub = [sz, ty].filter(Boolean).join(" ");
  const subLine = al ? `${sub}，${al}` : sub;
  if (subLine) parts.push(`<div class="prev-subtitle">${escapeHtml(subLine)}</div>`);

  parts.push(chipsFor(entry, data));
  parts.push(renderAbilityGrid(data));
  parts.push(renderMonsterSummary(data));

  if (data.entries) parts.push(renderEntries(data.entries));

  if (data.trait?.length) {
    parts.push("<h4>特性</h4>");
    for (const t of data.trait) parts.push(renderTrait(t));
  }
  if (data.spellcasting?.length) {
    for (const sc of data.spellcasting) parts.push(renderSpellcasting(sc));
  }
  if (data.action?.length) {
    parts.push("<h4>动作</h4>");
    for (const t of data.action) parts.push(renderTrait(t));
  }
  if (data.bonus?.length) {
    parts.push("<h4>附赠动作</h4>");
    for (const t of data.bonus) parts.push(renderTrait(t));
  }
  if (data.reaction?.length) {
    parts.push("<h4>反应</h4>");
    for (const t of data.reaction) parts.push(renderTrait(t));
  }
  if (data.legendary?.length) {
    parts.push("<h4>传奇动作</h4>");
    if (data.legendaryHeader) parts.push(renderEntries(data.legendaryHeader));
    else
      parts.push(
        `<p>本怪物可执行 ${data.legendaryActions ?? 3} 次传奇动作，从下列动作中选择，每次只能用一个传奇动作选项，且只能在另一生物的回合结束时使用。每回合开始时回复全部消耗。</p>`
      );
    for (const t of data.legendary) parts.push(renderTrait(t));
  }
  if (data.mythic?.length) {
    parts.push("<h4>神话动作</h4>");
    if (data.mythicHeader) parts.push(renderEntries(data.mythicHeader));
    for (const t of data.mythic) parts.push(renderTrait(t));
  }
  if (data.lairActions?.length) {
    parts.push("<h4>巢穴动作</h4>");
    for (const t of data.lairActions) parts.push(renderEntries([t]));
  }
  if (data.regionalEffects?.length) {
    parts.push("<h4>区域效应</h4>");
    for (const t of data.regionalEffects) parts.push(renderEntries([t]));
  }
  return parts.join("");
}

function renderAbilityGrid(data: DataEntry): string {
  const cells: string[] = [];
  for (const k of ["str", "dex", "con", "int", "wis", "cha"]) {
    const score = data[k];
    if (score == null) continue;
    const mod = Math.floor((score - 10) / 2);
    const modStr = mod >= 0 ? `+${mod}` : String(mod);
    cells.push(
      `<div class="ab-cell"><div class="ab-label">${ABILITY_LABEL[k]}</div><div class="ab-score">${score}</div><div class="ab-mod">${modStr}</div></div>`
    );
  }
  return cells.length ? `<div class="ab-grid">${cells.join("")}</div>` : "";
}

function renderMonsterSummary(data: DataEntry): string {
  const lines: string[] = [];
  const mkLine = (label: string, value: string) =>
    `<div class="ms-line"><span class="ms-l">${escapeHtml(label)}</span><span class="ms-v">${value}</span></div>`;

  if (data.save && Object.keys(data.save).length) {
    const parts = Object.entries(data.save)
      .map(([k, v]) => `${ABILITY_ZH[k] ?? k} ${v}`);
    lines.push(mkLine("豁免", parts.join("，")));
  }
  if (data.skill && Object.keys(data.skill).length) {
    const parts = Object.entries(data.skill).map(([k, v]) => `${k} ${v}`);
    lines.push(mkLine("技能", parts.join("，")));
  }
  if (data.resist) lines.push(mkLine("抗性", formatTypeList(data.resist)));
  if (data.immune) lines.push(mkLine("免疫", formatTypeList(data.immune)));
  if (data.vulnerable) lines.push(mkLine("易伤", formatTypeList(data.vulnerable)));
  if (data.conditionImmune) lines.push(mkLine("状态免疫", formatTypeList(data.conditionImmune)));
  if (data.senses) {
    const senses = Array.isArray(data.senses)
      ? data.senses.map(stripTags).join("，")
      : stripTags(String(data.senses));
    const passive = data.passive != null ? `，被动察觉 ${data.passive}` : "";
    lines.push(mkLine("感官", `${senses}${passive}`));
  }
  if (data.languages) {
    const langs = Array.isArray(data.languages)
      ? data.languages.map(stripTags).join("，")
      : stripTags(String(data.languages));
    lines.push(mkLine("语言", langs));
  }
  return lines.length ? `<div class="mon-summary">${lines.join("")}</div>` : "";
}

function formatTypeList(arr: any): string {
  if (!Array.isArray(arr)) return stripTags(String(arr));
  return arr
    .map((x) => {
      if (typeof x === "string") return stripTags(x);
      if (typeof x === "object") {
        const inner = formatTypeList(
          x.resist ?? x.immune ?? x.vulnerable ?? x.conditionImmune ?? []
        );
        return x.note ? `${inner}（${stripTags(x.note)}）` : inner;
      }
      return "";
    })
    .filter(Boolean)
    .join("，");
}

function renderTrait(t: any): string {
  const name = t.name ? `<b>${escapeHtml(stripTags(t.name))}.</b> ` : "";
  const entries = t.entries ? renderEntries(t.entries) : "";
  return `<div class="trait">${name}${entries}</div>`;
}

function renderSpellcasting(sc: any): string {
  const parts: string[] = [];
  parts.push(`<div class="trait"><b>${escapeHtml(stripTags(sc.name ?? "施法"))}.</b> `);
  if (sc.headerEntries) parts.push(renderEntries(sc.headerEntries));
  parts.push("</div>");

  const fmtSpells = (arr: any[]) =>
    (arr || []).map((s) => escapeHtml(stripTags(String(s)))).join("、");

  if (sc.will?.length) parts.push(`<p><b>随意施放：</b>${fmtSpells(sc.will)}</p>`);
  if (sc.daily) {
    for (const k of ["1", "1e", "2", "2e", "3", "3e", "4", "4e", "5", "5e"]) {
      const arr = (sc.daily as any)[k];
      if (Array.isArray(arr) && arr.length) {
        const label = k.endsWith("e") ? `每日 ${k.slice(0, -1)}/天` : `${k}/天`;
        parts.push(`<p><b>${label}：</b>${fmtSpells(arr)}</p>`);
      }
    }
  }
  if (sc.rest) {
    for (const [k, v] of Object.entries(sc.rest)) {
      if (Array.isArray(v) && v.length)
        parts.push(`<p><b>每次休整 ${k}/次：</b>${fmtSpells(v as any[])}</p>`);
    }
  }
  if (sc.spells) {
    for (const [level, info] of Object.entries(sc.spells)) {
      const lvl = level === "0" ? "戏法" : `${level} 环`;
      const slots = (info as any).slots != null
        ? `（${(info as any).slots} 个法术位）`
        : "";
      const ll = (info as any).lower ? `（${(info as any).lower}–${level} 环）` : "";
      const arr = (info as any).spells ?? [];
      parts.push(`<p><b>${lvl}${slots}${ll}：</b>${fmtSpells(arr)}</p>`);
    }
  }
  if (sc.footerEntries) parts.push(renderEntries(sc.footerEntries));
  return parts.join("");
}

function renderSpell(_entry: Entry, data: DataEntry): string {
  const parts: string[] = [];
  if (data.entries) parts.push(renderEntries(data.entries));
  if (data.entriesHigherLevel) {
    parts.push("<h4>当以更高阶法术位施放时</h4>");
    parts.push(renderEntries(data.entriesHigherLevel));
  }
  const fromClass: string[] = [];
  if (data.classes?.fromClassList)
    for (const c of data.classes.fromClassList) fromClass.push(stripTags(c.name));
  if (data.classes?.fromSubclass)
    for (const c of data.classes.fromSubclass)
      fromClass.push(`${stripTags(c.class?.name ?? "")} (${stripTags(c.subclass?.name ?? "")})`);
  if (fromClass.length)
    parts.push(`<p><b>职业列表：</b>${escapeHtml(fromClass.join("、"))}</p>`);
  return parts.join("");
}

function renderItem(_entry: Entry, data: DataEntry): string {
  const parts: string[] = [];
  const weaponBits: string[] = [];
  if (data.dmg1) weaponBits.push(`${stripTags(String(data.dmg1))} ${dmgTypeStr(data.dmgType)}`);
  if (data.dmg2) weaponBits.push(`双手 ${stripTags(String(data.dmg2))}`);
  if (Array.isArray(data.property) && data.property.length)
    weaponBits.push(`属性：${data.property.map(stripTags).join("、")}`);
  if (data.range) weaponBits.push(`射程：${stripTags(String(data.range))}`);
  if (weaponBits.length)
    parts.push(`<p>${escapeHtml(weaponBits.join("　"))}</p>`);
  if (data.ac != null) parts.push(`<p><b>AC</b> ${escapeHtml(String(data.ac))}</p>`);
  if (data.entries) parts.push(renderEntries(data.entries));
  return parts.join("");
}

function dmgTypeStr(t: any): string {
  const M: Record<string, string> = {
    A: "酸", B: "钝击", C: "冷冻", F: "火焰", "FORCE": "力场", "F_": "力场",
    L: "闪电", N: "死灵", P: "穿刺", "POISON": "毒素", "PSY": "心灵",
    "RAD": "光耀", S: "挥砍", "T": "雷鸣",
  };
  if (typeof t === "string") return M[t] ?? t;
  return "";
}

// --- Generic helpers ---
function crStr(cr: any): string {
  if (cr == null) return "";
  if (typeof cr === "string" || typeof cr === "number") return String(cr);
  if (typeof cr === "object" && cr.cr) return String(cr.cr);
  return "";
}
function acStr(ac: any): string {
  if (!Array.isArray(ac) || !ac.length) return "";
  const first = ac[0];
  if (typeof first === "number") return String(first);
  if (typeof first === "object") {
    const v = first.ac ?? first.value ?? "";
    const from = (first.from || []).map((s: string) => stripTags(s)).join(", ");
    return from ? `${v}（${from}）` : String(v);
  }
  return "";
}
function hpStr(hp: any): string {
  if (!hp) return "";
  if (typeof hp.average === "number")
    return `${hp.average}${hp.formula ? `（${hp.formula}）` : ""}`;
  if (typeof hp.special === "string") return hp.special;
  return "";
}
function speedStr(sp: any): string {
  if (!sp) return "";
  if (typeof sp === "number") return `${sp} 尺`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(sp)) {
    const n = typeof v === "object" && v != null ? (v as any).number : v;
    const cond = typeof v === "object" && (v as any).condition ? `（${stripTags((v as any).condition)}）` : "";
    if (k === "walk") parts.unshift(`${n} 尺${cond}`);
    else if (typeof n === "number") parts.push(`${k} ${n} 尺${cond}`);
  }
  return parts.join("，");
}
function sizeStr(size: any): string {
  const SZ: Record<string, string> = { T: "微型", S: "小型", M: "中型", L: "大型", H: "巨型", G: "超巨" };
  if (Array.isArray(size)) return size.map((c) => SZ[c] ?? c).join("/");
  if (typeof size === "string") return SZ[size] ?? size;
  return "";
}
function spellLevelStr(lvl: any): string {
  if (lvl == null) return "";
  if (lvl === 0) return "戏法";
  return `${lvl} 环`;
}
const SCHOOLS: Record<string, string> = {
  A: "防护", C: "塑能", D: "死灵", E: "附魔", I: "幻术",
  N: "塑能", T: "变化", V: "预言",
};
function schoolStr(s: any): string {
  return typeof s === "string" ? SCHOOLS[s] ?? s : "";
}
function timeStr(t: any): string {
  if (!Array.isArray(t)) return "";
  return t
    .map((x) =>
      typeof x === "object" && x != null
        ? `${x.number ?? ""} ${x.unit ?? ""}`.trim()
        : String(x)
    )
    .join("，");
}
function rangeStr(r: any): string {
  if (!r) return "";
  if (typeof r === "string") return r;
  if (r.type === "point" && r.distance) {
    const d = r.distance;
    if (d.type === "self") return "自身";
    if (d.type === "touch") return "触及";
    return `${d.amount ?? ""} ${d.type ?? ""}`.trim();
  }
  return r.type ?? "";
}
function componentsStr(c: any): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.v) parts.push("V");
  if (c.s) parts.push("S");
  if (c.m) parts.push(typeof c.m === "string" ? `M（${stripTags(c.m)}）` : "M");
  return parts.join(", ");
}
function durationStr(d: any): string {
  if (!Array.isArray(d) || !d.length) return "";
  const x = d[0];
  if (typeof x === "string") return x;
  if (x.type === "instant") return "瞬发";
  if (x.type === "permanent") return "永久";
  if (x.type === "timed" && x.duration)
    return `${x.duration.amount ?? ""} ${x.duration.type ?? ""}`.trim();
  if (x.concentration)
    return `专注 ${x.duration?.amount ?? ""} ${x.duration?.type ?? ""}`.trim();
  return x.type ?? "";
}
function prerequisiteStr(prereq: any): string {
  if (!Array.isArray(prereq) || !prereq.length) return "";
  return prereq
    .map((p) =>
      Object.entries(p)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join("; ")
    )
    .join(" / ");
}

// Adventures / books — manifest only.
function renderAdventure(_entry: Entry, data: DataEntry): string {
  const parts: string[] = [];
  const lvl = data.level && (data.level.start != null || data.level.end != null)
    ? `<p><b>等级范围：</b>${escapeHtml(`${data.level.start ?? "?"} - ${data.level.end ?? "?"}`)}</p>`
    : "";
  const author = data.author ? `<p><b>作者：</b>${escapeHtml(stripTags(String(data.author)))}</p>` : "";
  const story = data.storyline ? `<p><b>故事线：</b>${escapeHtml(stripTags(String(data.storyline)))}</p>` : "";
  const published = data.published ? `<p><b>出版：</b>${escapeHtml(String(data.published))}</p>` : "";
  parts.push(lvl, author, story, published);
  if (Array.isArray(data.contents) && data.contents.length) {
    const chapters = data.contents
      .map((ch: any) => {
        const ord = ch.ordinal
          ? `<span class="chap-ord">${escapeHtml(String(ch.ordinal.identifier ?? ""))}.</span> `
          : "";
        const title = escapeHtml(stripTags(ch.name ?? ch.ENG_name ?? "?"));
        const headers = Array.isArray(ch.headers) && ch.headers.length
          ? `<ul>${ch.headers.map((h: any) => {
              const t = typeof h === "string" ? h : (h?.header ?? "");
              return t ? `<li>${escapeHtml(stripTags(String(t)))}</li>` : "";
            }).filter(Boolean).join("")}</ul>`
          : "";
        return `<li>${ord}${title}${headers}</li>`;
      })
      .join("");
    parts.push(`<h4>章节</h4><ol class="chap-list">${chapters}</ol>`);
  }
  return parts.join("");
}

function renderBook(_entry: Entry, data: DataEntry): string {
  const parts: string[] = [];
  if (data.published) parts.push(`<p><b>出版：</b>${escapeHtml(String(data.published))}</p>`);
  if (data.author) parts.push(`<p><b>作者：</b>${escapeHtml(stripTags(String(data.author)))}</p>`);
  if (Array.isArray(data.contents) && data.contents.length) {
    const chapters = data.contents.map((ch: any) => {
      const ord = ch.ordinal
        ? `<span class="chap-ord">${escapeHtml(String(ch.ordinal.identifier ?? ""))}.</span> `
        : "";
      const title = escapeHtml(stripTags(ch.name ?? ch.ENG_name ?? "?"));
      return `<li>${ord}${title}</li>`;
    }).join("");
    parts.push(`<h4>目录</h4><ol class="chap-list">${chapters}</ol>`);
  }
  return parts.join("");
}

// --- DOM wiring ---
const inputEl = document.getElementById("q") as HTMLInputElement;
const clearEl = document.getElementById("clear") as HTMLButtonElement;
const wrapEl = document.getElementById("wrap") as HTMLDivElement;
const countEl = document.getElementById("count") as HTMLDivElement;
const dropEl = document.getElementById("drop") as HTMLDivElement;
const previewEl = document.getElementById("preview") as HTMLDivElement;

let isGM = false;
let currentHits: Entry[] = [];
let kbdActiveIdx = -1;
let pinnedEntry: Entry | null = null;
let lastHoverEntry: Entry | null = null;
let collapsedKeepingQuery = false;
// External callers (e.g. character-card name chips) can request that
// the first search hit be auto-pinned so the preview pane shows
// immediately. Cleared after one renderResults cycle so a stale flag
// doesn't auto-pin the next typed query.
let pendingAutoPin = false;

function applyLangPlaceholder() {
  const lang = getLocalLang();
  inputEl.placeholder =
    lang === "zh"
      ? "搜索 5etools…（怪物/法术/物品/职业/种族…）"
      : "Search 5etools… (monsters/spells/items/classes/races…)";
}

// --- Resize ---
let resizeBusy = false;
async function setExpanded(expanded: boolean) {
  if (resizeBusy) return;
  resizeBusy = true;
  try {
    await OBR.popover.setWidth(POPOVER_ID, expanded ? BAR_W_OPEN : BAR_W_IDLE);
    await OBR.popover.setHeight(POPOVER_ID, expanded ? BAR_H_OPEN : BAR_H_IDLE);
  } catch {}
  resizeBusy = false;
}

function renderHint(text: string, isErr = false) {
  dropEl.innerHTML = `<div class="hint${isErr ? " err" : ""}">${escapeHtml(text)}</div>`;
}
function highlight(text: string, q: string): string {
  if (!q) return escapeHtml(text);
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const i = lower.indexOf(ql);
  if (i < 0) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, i)) +
    "<mark>" +
    escapeHtml(text.slice(i, i + q.length)) +
    "</mark>" +
    escapeHtml(text.slice(i + q.length))
  );
}

function renderResults(hits: Entry[], q: string) {
  currentHits = hits;
  kbdActiveIdx = -1;
  pinnedEntry = null;
  if (hits.length === 0) {
    countEl.textContent = "0";
    renderHint("无匹配条目");
    renderPreviewIdle();
    return;
  }
  countEl.textContent = String(hits.length);
  const parts: string[] = [];
  hits.forEach((e, idx) => {
    const cat = categoryInfo(e.c);
    const display = e.cn || e.n;
    const sub = e.cn && e.n !== e.cn ? e.n : "";
    const code = srcCode(e.s).toUpperCase();
    const edClass =
      code === "PHB" || code === "MM"
        ? "ed-2014"
        : code === "XPHB" || code === "XMM"
        ? "ed-2024"
        : "";
    parts.push(
      `<div class="row-item" data-idx="${idx}" tabindex="-1">
        <span class="cat cat-${e.c}">${escapeHtml(cat.label)}</span>
        <span class="info">
          <span class="name">${highlight(display, q)}</span>
          ${sub ? `<span class="sub">${highlight(sub, q)}</span>` : ""}
        </span>
        <span class="src ${edClass}">${escapeHtml(code)}</span>
      </div>`
    );
  });
  dropEl.innerHTML = parts.join("");
  dropEl.querySelectorAll<HTMLDivElement>(".row-item").forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.addEventListener("mouseenter", () => onRowHover(idx));
    row.addEventListener("click", () => onRowClick(idx));
    row.addEventListener("mousedown", (e) => e.preventDefault());
  });
  if (pendingAutoPin && hits.length > 0) {
    pendingAutoPin = false;
    kbdActiveIdx = 0;
    const firstRow = dropEl.querySelector<HTMLDivElement>('.row-item[data-idx="0"]');
    if (firstRow) firstRow.classList.add("kbd-active");
    onRowClick(0);
    return;
  }
  renderPreviewIdle();
}

function renderPreviewIdle() {
  previewEl.innerHTML = `<div class="prev-empty">悬停或点击词条查看详情<br><span class="prev-empty-sub">Esc 关闭 · ↑↓ 选择</span></div>`;
}

async function onRowHover(idx: number) {
  if (pinnedEntry) return;
  const entry = currentHits[idx];
  if (!entry) return;
  lastHoverEntry = entry;
  await renderPreviewFor(entry);
}

async function onRowClick(idx: number) {
  const entry = currentHits[idx];
  if (!entry) return;
  if (pinnedEntry && pinnedEntry.id === entry.id) {
    pinnedEntry = null;
  } else {
    pinnedEntry = entry;
  }
  dropEl.querySelectorAll<HTMLDivElement>(".row-item").forEach((row) => {
    const i = Number(row.dataset.idx);
    row.classList.toggle("pinned", currentHits[i] === pinnedEntry);
  });
  await renderPreviewFor(pinnedEntry ?? entry);
}

async function renderPreviewFor(entry: Entry) {
  const cat = categoryInfo(entry.c);
  const display = entry.cn || entry.n;
  const code = srcCode(entry.s).toUpperCase();
  const page = entry.p ? ` · p.${entry.p}` : "";

  await loadBooks();
  const srcDisplay = sourceLabel(code);

  previewEl.innerHTML = `
    <div class="prev-head">
      <div class="prev-title">${escapeHtml(display)}</div>
      ${entry.n && entry.n !== display ? `<div class="prev-eng">${escapeHtml(entry.n)}</div>` : ""}
      <div class="prev-meta">${escapeHtml(cat.label)} · ${escapeHtml(srcDisplay)}${escapeHtml(page)}</div>
    </div>
    <div class="prev-body" id="prev-body"><div class="prev-loading">加载中…</div></div>
  `;
  const bodyEl = previewEl.querySelector("#prev-body") as HTMLDivElement;

  if (!cat.data) {
    bodyEl.innerHTML = `<div class="prev-empty">该分类暂无内置详情<br><span class="prev-empty-sub">${escapeHtml(cat.label)} · 仅显示名称与来源</span></div>`;
    return;
  }

  let data: DataEntry | null = null;
  try { data = await findEntryData(entry); } catch {}
  if (!pinnedEntry && lastHoverEntry && lastHoverEntry.id !== entry.id) return;

  if (!data) {
    bodyEl.innerHTML = `<div class="prev-empty">未找到详情数据<br><span class="prev-empty-sub">来源 ${escapeHtml(code)} 的数据可能尚未同步</span></div>`;
    return;
  }

  const c = entry.c;
  if (c === 1 || c === 46) {
    bodyEl.innerHTML = renderMonster(entry, data);
  } else if (c === 2) {
    bodyEl.innerHTML = chipsFor(entry, data) + renderSpell(entry, data);
  } else if (c === 4 || c === 56 || c === 57) {
    bodyEl.innerHTML = chipsFor(entry, data) + renderItem(entry, data);
  } else if (c === 13) {
    bodyEl.innerHTML = chipsFor(entry, data) + renderAdventure(entry, data);
  } else if (c === 18 || c === 44) {
    bodyEl.innerHTML = chipsFor(entry, data) + renderBook(entry, data);
  } else {
    const body = data.entries ? renderEntries(data.entries) : "";
    bodyEl.innerHTML = chipsFor(entry, data) + body;
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function runSearch(q: string) {
  if (!indexCache) renderHint("加载索引中…（首次约 1 秒）");
  let idx: IndexFile;
  try { idx = await loadIndex(); }
  catch (e) {
    renderHint("索引加载失败：" + ((e as Error).message ?? "网络错误"), true);
    return;
  }
  const currentQ = inputEl.value.trim();
  if (currentQ !== q) return;
  const s = getState();
  const hits = search(q, idx, {
    dataVersion: s.dataVersion,
    language: getLocalLang(),
    isGM,
    allowPlayerMonsters: s.allowPlayerMonsters,
  });
  renderResults(hits, q);
}

async function onQueryChange(qRaw: string) {
  const q = qRaw.trim();
  wrapEl.classList.toggle("has-q", q.length > 0);
  if (!q) {
    currentHits = [];
    pinnedEntry = null;
    lastHoverEntry = null;
    dropEl.innerHTML = "";
    renderPreviewIdle();
    countEl.textContent = "";
    collapsedKeepingQuery = false;
    wrapEl.classList.remove("collapsed");
    await setExpanded(false);
    return;
  }
  collapsedKeepingQuery = false;
  wrapEl.classList.remove("collapsed");
  await setExpanded(true);
  await runSearch(q);
}

function refilter() {
  const q = inputEl.value.trim();
  if (!q) return;
  runSearch(q);
}

// Delegated click for any 5etools rollable tag inside the search preview.
previewEl.addEventListener("click", async (e) => {
  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(".rollable");
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  const expression = target.dataset.expr ?? "";
  const label = target.dataset.label ?? "";
  if (!expression) return;
  const itemId = await resolveClickRollTarget();
  fireQuickRoll({ expression, label, itemId, focus: !!itemId });
  target.classList.remove("rollable-flash");
  void target.offsetWidth;
  target.classList.add("rollable-flash");
});

inputEl.addEventListener("input", () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => onQueryChange(inputEl.value), 200);
});
clearEl.addEventListener("click", async () => {
  inputEl.value = "";
  await onQueryChange("");
  inputEl.focus();
});

// External callers (character-card search-chips) can fill the input by
// broadcasting BC_SEARCH_QUERY.
const BC_SEARCH_QUERY = "com.obr-suite/search-query";
OBR.onReady(() => {
  OBR.broadcast.onMessage(BC_SEARCH_QUERY, (event) => {
    const data = (event.data as { q?: string; autoPin?: boolean } | undefined) ?? {};
    const q = data.q ?? "";
    inputEl.value = q;
    if (debounceTimer) clearTimeout(debounceTimer);
    pendingAutoPin = !!data.autoPin && q.length > 0;
    onQueryChange(q).catch(() => { pendingAutoPin = false; });
    if (q) inputEl.focus();
  });
  // Local-content imports / removals → drop the in-memory + LS
  // index cache so the next search pulls a fresh merged index.
  OBR.broadcast.onMessage(BC_LOCAL_CONTENT_CHANGED, () => {
    indexCache = null;
    dataCache.clear();
    dataPending.clear();
  });
});

// --- Esc / arrow handling at document level ---
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (pinnedEntry) {
      pinnedEntry = null;
      dropEl.querySelectorAll<HTMLDivElement>(".row-item")
        .forEach((row) => row.classList.remove("pinned"));
      if (lastHoverEntry) renderPreviewFor(lastHoverEntry);
      else renderPreviewIdle();
      inputEl.focus();
      return;
    }
    if (inputEl.value) {
      inputEl.value = "";
      onQueryChange("");
      inputEl.focus();
      return;
    }
    inputEl.blur();
    return;
  }
  if (!wrapEl.classList.contains("has-q")) return;
  const links = Array.from(dropEl.querySelectorAll<HTMLDivElement>(".row-item"));
  if (e.key === "Enter") {
    e.preventDefault();
    const target = links[Math.max(0, kbdActiveIdx)];
    if (target) target.click();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (links.length === 0) return;
    e.preventDefault();
    kbdActiveIdx = e.key === "ArrowDown"
      ? Math.min(kbdActiveIdx + 1, links.length - 1)
      : Math.max(kbdActiveIdx - 1, 0);
    links.forEach((el, i) => el.classList.toggle("kbd-active", i === kbdActiveIdx));
    links[kbdActiveIdx]?.scrollIntoView({ block: "nearest" });
    onRowHover(kbdActiveIdx);
  }
});

// --- Focus loss / regain → collapse / expand without losing query ---
window.addEventListener("blur", () => {
  if (wrapEl.classList.contains("has-q") && !collapsedKeepingQuery) {
    collapsedKeepingQuery = true;
    wrapEl.classList.add("collapsed");
    setExpanded(false).catch(() => {});
  }
});
inputEl.addEventListener("focus", () => {
  if (collapsedKeepingQuery && inputEl.value) {
    collapsedKeepingQuery = false;
    wrapEl.classList.remove("collapsed");
    setExpanded(true).catch(() => {});
  }
});

OBR.onReady(async () => {
  subscribeToSfx();
  try {
    const { installDebugOverlay } = await import("../../utils/debugOverlay");
    installDebugOverlay();
  } catch {}
  try {
    const role = await OBR.player.getRole();
    isGM = role === "GM";
  } catch {}

  // Drag handle — tab below/above the input row depending on the
  // popover's vertical anchor. Background passed `?v=top|bottom`.
  try {
    const { bindPanelDrag } = await import("../../utils/panelDrag");
    const { PANEL_IDS } = await import("../../utils/panelLayout");
    const dragEl = document.getElementById("search-drag-handle") as HTMLElement | null;
    if (dragEl) {
      bindPanelDrag(dragEl, PANEL_IDS.search);
    }
  } catch {}

  // Quadrant hints from background — `?h=left|right` controls which
  // direction the bar GROWS when expanded (not the bar's anchor —
  // that's already set on the OBR popover side). `?v=top|bottom`
  // controls whether the detail panel renders above or below the
  // input row (CSS flips child `order` per data-vert attribute).
  try {
    const params = new URLSearchParams(location.search);
    const v = params.get("v");
    const h = params.get("h");
    const wrap = document.getElementById("wrap");
    if (wrap) {
      wrap.setAttribute("data-vert", v === "bottom" ? "bottom" : "top");
      wrap.setAttribute("data-horiz", h === "right" ? "right" : "left");
    }
  } catch {}

  startSceneSync();
  applyLangPlaceholder();
  applyI18nDom(getLocalLang());
  // Track the library list so we only invalidate the merged-index
  // cache when it actually changes (data-version / allowPlayerMonsters
  // toggles also fire state-change but don't affect the index itself
  // — only the filtered view).
  let lastLibSig = JSON.stringify(getEnabledLibraryBases());
  onStateChange(() => {
    const sig = JSON.stringify(getEnabledLibraryBases());
    if (sig !== lastLibSig) {
      lastLibSig = sig;
      indexCache = null;
      dataCache.clear();
      dataPending.clear();
      // Reload the index in the background so the next user input
      // doesn't stall on a fetch. If the input is already populated,
      // re-run the filter once the new index lands.
      loadIndex()
        .then(() => { if (inputEl.value) refilter(); })
        .catch(() => {});
    } else if (inputEl.value) {
      refilter();
    }
  });
  onLangChange((next) => {
    applyLangPlaceholder();
    applyI18nDom(next);
    if (inputEl.value) refilter();
  });

  setTimeout(() => {
    loadIndex().catch(() => {});
    loadBooks().catch(() => {});
  }, 250);
});
