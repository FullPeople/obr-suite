import OBR from "@owlbear-rodeo/sdk";
import * as en from "./locale";
const tr = (zh: string, english: string) => getLocalLang() === "en" ? english : zh;
const comma = () => tr("，", ", ");
import { selectContentLibraries, contentConfigurationKey, type ContentSource, type ContentLanguage } from "../../utils/contentLocale";
import { fetchContentJson, createContentRequestGuard, mapWithConcurrency } from "../../utils/contentRequests";
import {
  startSceneSync,
  getState,
  onStateChange,
  getLocalLang,
  onLangChange,
  DataVersion,
  Language,
} from "../../state";
import { formatTagsClickable, resolveClickRollTarget } from "../dice/tags";
import { bindRollableClickPopup } from "../dice/context-menu";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import { applyI18nDom } from "../../i18n";
import {
  getLocalIndexFile,
  getLocalDataByKeySource,
  getLocalContentSignature,
  initLocalContent,
  forceReloadLocalContent,
  BC_LOCAL_CONTENT_CHANGED,
} from "../../utils/localContent";
import { groupSpellcastingByDisplay } from "../bestiary/spellcasting-display";

// Suite-version of the search bar — independent top-right popover with
// its OWN visible input row (not driven by cluster). The popover resizes
// itself via OBR.popover.setWidth/setHeight as the user types / clears,
// so when idle the popover is only 280×40 and clicks below the input
// pass through to the canvas naturally.

const POPOVER_ID = "com.obr-suite/search-bar";

// Data language is local to this player. Room libraries and authored data are never rewritten.
function getEnabledLibrarySources(): ContentSource[] {
  return selectContentLibraries(getState().libraries ?? [], getLocalLang());
}

const BAR_W_IDLE = 280;
const BAR_W_OPEN = 720;
const BAR_H_IDLE = 40;
const BAR_H_OPEN = 440;

// v4 includes originating library and content language. Old v3 index/book
// caches cannot identify the chosen translation and are intentionally ignored.
const CACHE_KEY = "obr-suite/search-index-v4";
const BOOKS_CACHE_KEY = "obr-suite/search-books-v4";
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
  library?: string;
  contentLanguage?: ContentLanguage;
  local?: boolean;
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
  _contentLibrary?: string;
  _contentLanguage?: ContentLanguage;
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
// English labels for the result-category chips (lang === "en"). Keyed by
// the same numeric category code as CATEGORY. categoryInfo() swaps these
// in on the EN path so every display site reading `.label` gets it for
// free (the zh `label` above stays the source of truth for fallback).
const CATEGORY_LABEL_EN: Record<number, string> = {
  1: "Monster", 2: "Spell", 3: "Background", 4: "Item", 5: "Class",
  6: "Condition", 7: "Feat", 8: "Feature", 9: "Psionic", 10: "Race",
  11: "Reward", 12: "Variant Rule", 13: "Adventure", 14: "Deity",
  15: "Vehicle", 16: "Trap", 17: "Hazard", 18: "Book", 19: "Cult",
  20: "Boon", 21: "Disease", 22: "Metamagic", 23: "Maneuver", 24: "Table",
  25: "Deck", 27: "Arcane Shot", 29: "Fighting Style", 30: "Class Feature",
  31: "Item", 32: "Pact", 33: "Ki Feature", 34: "Infusion",
  35: "Vehicle Upgrade", 36: "Ship Customization", 37: "Rune",
  40: "Subclass", 41: "Subclass Feature", 42: "Action", 43: "Language",
  44: "Book", 45: "Page", 46: "Monster Lore", 47: "Char Option",
  48: "Recipe", 49: "Rule", 50: "Skill", 51: "Sense", 52: "Deck",
  53: "Card", 54: "Weapon Mastery", 55: "Place", 56: "Item Group",
  57: "Item", 58: "Weapon Property",
};
function categoryInfo(c: number): CategoryInfo {
  const info = CATEGORY[c] ?? { label: `?${c}` };
  if (getLocalLang() === "en") {
    const en = CATEGORY_LABEL_EN[c];
    if (en) return { ...info, label: en };
  }
  return info;
}

// --- Source code lookup ---
let sourceById = new Map<number, string>();
let sourceNames = new Map<string, string>();
function srcCode(s: Entry["s"]): string {
  if (typeof s === "string") return s;
  if (typeof s === "number") return sourceById.get(s) ?? "";
  return "";
}
function sourceLabel(code: string, entry?: Entry): string {
  const name = sourceNames.get(`${entry?.library}|${code.toUpperCase()}`);
  return name ? `${code} (${name})` : code;
}

// --- Index + books fetch & cache ---
let indexCache: IndexFile | null = null;
let indexLoading: Promise<IndexFile> | null = null;
let contentAbort = new AbortController();
const previewRequests = createContentRequestGuard();
let contentGeneration = 0;
let indexRetryAt = Infinity;

async function loadIndex(): Promise<IndexFile> {
  if (indexCache && Date.now() < indexRetryAt) return indexCache;
  if (indexLoading) return indexLoading;
  const generation = contentGeneration;
  let incomplete = false;
  indexLoading = (async () => {
    // 2026-05-10 — warm the IDB-backed local-content cache before we
    // call getLocalContentSignature() / getLocalIndexFile() below.
    // Idempotent.
    await initLocalContent();
    if (generation !== contentGeneration) throw new DOMException("Content changed", "AbortError");
    // Cache key is keyed on the active library set + local-content
    // signature so switching libraries OR adding/removing local
    // imports both invalidate the cached merged index.
    const sources = getEnabledLibrarySources();
    // Cache key encodes base + indexPath + disabledSources so toggling
    // between index.json and index-partnered.json AND toggling any
    // per-library source blacklist (e.g. disabling BOOKOFEBONTIDES)
    // both invalidate the cache.
    const cacheKey = `${CACHE_KEY}:${contentConfigurationKey(getState().libraries ?? [], getLocalLang())}:${getLocalContentSignature()}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; data: IndexFile };
        if (Date.now() - parsed.ts < CACHE_TTL_MS && parsed.data?.x?.length) {
          indexCache = parsed.data;
          indexRetryAt = Infinity;
          buildSourceMap(indexCache);
          return indexCache;
        }
      }
    } catch {}
    // Fetch all libraries in parallel; carry the per-library config
    // alongside each fetched index so the merge loop below can apply
    // each lib's own `disabledSources` blacklist.
    const perLibrary = await Promise.all(
      sources.map(async (cfg) => {
        try {
          const res = await fetchContentJson(`${cfg.base}/${cfg.indexPath}`, { cache: "no-cache", signal: contentAbort.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const idx = await res.json() as IndexFile;
          if (!Array.isArray(idx.x)) throw new Error("Invalid search index");
          return { idx, cfg };
        } catch (e) {
          incomplete = true;
          console.warn(`[obr-suite/search] index fetch failed for ${cfg.base}/${cfg.indexPath}`, e);
          return null;
        }
      })
    );
    if (generation !== contentGeneration) throw new DOMException("Content changed", "AbortError");
    indexRetryAt = incomplete ? Date.now() + 15_000 : Infinity;
    const valid = perLibrary.filter(
      (x): x is { idx: IndexFile; cfg: typeof sources[number] } =>
        !!x && Array.isArray(x.idx.x),
    );
    // Locally-imported homebrew gets synthesised into a virtual
    // index file so it merges into the same flow as URL libraries.
    // Local content has no `disabledSources` blacklist (per-source
    // toggling for local homebrew can be done by deleting the file).
    const localIdx = getLocalIndexFile();
    const allValid: Array<{ idx: IndexFile; cfg: Pick<ContentSource, "disabledSources"> & Partial<ContentSource> }> =
      localIdx.x.length > 0
        ? [{ idx: localIdx as unknown as IndexFile, cfg: { disabledSources: new Set<string>() } }, ...valid]
        : valid;
    if (allValid.length === 0) {
      // 2026-05-10: with all libraries disabled and no local content,
      // return an empty index instead of throwing. Prevents the
      // user-visible "loading…" spinner from sticking around when the
      // user deliberately wants a clean canvas.
      const empty: IndexFile = { x: [], m: { s: {} } };
      indexCache = empty;
      buildSourceMap(empty);
      return empty;
    }
    // Naive merge — primary lib's source map wins, all entries pooled.
    // dedupeKey uses `${cn}|${n}|${s ?? ""}` so the same monster from
    // two libraries collapses to one row (custom lib wins because
    // it's typically listed first).
    const merged: IndexFile = { x: [], m: { s: {} } };
    for (const { idx } of allValid) {
      if (idx.m?.s) {
        for (const [code, id] of Object.entries(idx.m.s)) {
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
    //
    // 2026-05-09 ROOT-CAUSE FIX for the
    // "BOOKOFEBONTIDES override hides PHB" bug:
    //
    //   The numeric `e.s` is a per-library id. Two libraries can
    //   assign the SAME numeric id to DIFFERENT source codes —
    //   exactly what kiwee does:
    //     main  m.s  → "XPHB": 11
    //     partnered m.s  → "BookOfEbonTides": 11
    //
    //   Earlier code merged `m.s` into a single `merged.m.s` with
    //   "first-wins" on the CODE key (so both XPHB:11 and
    //   BookOfEbonTides:11 ended up in merged.m.s). The display path
    //   then built `sourceById: Map<number, string>` from
    //   merged.m.s, where the LAST iterated code-for-id wins —
    //   "BookOfEbonTides" overwrote "XPHB" at id 11. Result: every
    //   XPHB entry in main's index displayed as "BOOKOFEBONTIDES",
    //   the source data fetch went looking for the wrong filename
    //   and 404'd.
    //
    //   The fix: at merge time, rewrite each entry's `e.s` from its
    //   per-library numeric id into the resolved UPPERCASE source
    //   CODE string. After this, every entry carries a globally-
    //   unique source identity, and the display path's
    //   `srcCode(e.s)` short-circuits on the string branch — the
    //   stale `sourceById` numeric map is never consulted again.
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
    const mergedByKey = new Map<string, Entry>();
    for (const { idx, cfg } of allValid) {
      for (const e of idx.x) {
        const cn = (e.cn || "").trim().toLowerCase();
        const n = (e.n || "").trim().toLowerCase();
        const src = resolveSourceCode(e, idx);
        // Per-library source blacklist (e.g. user disabled
        // BOOKOFEBONTIDES inside the partnered library). Apply BEFORE
        // dedupe so an entry available in another library where the
        // source is allowed still gets through under that library.
        if (cfg.disabledSources.size > 0 && src && cfg.disabledSources.has(src)) continue;
        const key = `${n || cn}|${src}|${e.c ?? ""}`;
        if (seen.has(key)) {
          // Keep alternate query names even when their translated body loses
          // priority. Existing character-card chips may still search in Chinese.
          const preferred = mergedByKey.get(key);
          if (preferred && (!preferred.cn || preferred.cn === preferred.n) && e.cn) preferred.cn = e.cn;
          continue;
        }
        seen.add(key);
        // Clone the entry with `s` rewritten to the resolved code
        // string (uppercased — display does .toUpperCase() anyway,
        // and uppercase makes it easier to grep filenames). When
        // src is empty (entry has no resolvable source), preserve
        // the original `e.s` so we don't accidentally null it out.
        const fixedEntry: Entry = {
          ...e, s: src ? src.toUpperCase() : e.s,
          library: cfg.id, contentLanguage: cfg.language ?? "auto", local: !cfg.id,
        };
        mergedByKey.set(key, fixedEntry);
        merged.x.push(fixedEntry);
      }
    }
    // Synthesise weapon-property entries from items-base.json's
    // itemProperty array. 5etools doesn't add these to the search
    // index because they're definitional, but the cc-info weapon
    // chips need them to resolve. The same language order/blacklist applies;
    // successful files are shared with subsequent property detail requests.
    try {
      const propertyFiles = await Promise.all(sources.map(async (cfg) => {
        try { return { cfg, body: await loadSourceFile(cfg, "items-base.json") }; }
        catch { return { cfg, body: null }; }
      }));
      for (const { cfg, body: j } of propertyFiles) {
        try {
          if (!j) continue;
          const arr = (j.itemProperty ?? []) as any[];
          let synthId = 9_000_000;
          for (const p of arr) {
            const inner = Array.isArray(p.entries) && p.entries[0] && typeof p.entries[0] === "object" ? p.entries[0] : null;
            const cn = (p as any).name ?? inner?.name ?? "";
            const en = (p as any).ENG_name ?? inner?.ENG_name ?? (p as any).name ?? inner?.name ?? (p as any).abbreviation ?? "";
            if (!cn && !en) continue;
            const source = String(p.source ?? "");
            if (cfg.disabledSources.has(source.toLowerCase())) continue;
            const dedupeKey = `${en || cn}|${source.toLowerCase()}|58`;
            if (seen.has(dedupeKey)) {
              const preferred = mergedByKey.get(dedupeKey);
              if (preferred && (!preferred.cn || preferred.cn === preferred.n) && cn) preferred.cn = cn;
              continue;
            }
            seen.add(dedupeKey);
            const property: Entry = {
              id: synthId++,
              u: "",
              c: 58,
              s: (p as any).source ?? "",
              n: en,
              cn, library: cfg.id, contentLanguage: cfg.language,
            };
            mergedByKey.set(dedupeKey, property);
            merged.x.push(property);
          }
        } catch {}
      }
    } catch {}
    if (generation !== contentGeneration) throw new DOMException("Content changed", "AbortError");
    indexCache = merged;
    buildSourceMap(indexCache);
    try {
      if (!incomplete) localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: merged }));
    } catch {}
    return merged;
  })();
  const pending = indexLoading;
  try { return await pending; } finally { if (indexLoading === pending) indexLoading = null; }
}

/**
 * Lower-cased names and upper-cased source codes for every entry,
 * built once per index rather than once per keystroke.
 *
 * `search()` runs over the WHOLE index on every character typed, and it
 * used to call `e.n.toLowerCase()`, `e.cn.toLowerCase()` and
 * `srcCode(e.s).toUpperCase()` inside that loop — three fresh strings
 * per entry per keystroke. At 20k entries that measured 3.0 ms a
 * keystroke against 1.1 ms with these precomputed.
 *
 * Kept as parallel arrays rather than extra fields on Entry, because
 * the merged index is serialised into localStorage and stashing two
 * more strings on every entry would inflate that cache for nothing.
 */
let searchKeys: {
  /** The exact index these were built for, compared by identity. */
  for: IndexFile | null;
  en: string[];
  cn: string[];
  code: string[];
} = { for: null, en: [], cn: [], code: [] };

function buildSearchKeys(idx: IndexFile) {
  const n = idx.x.length;
  const en = new Array<string>(n);
  const cn = new Array<string>(n);
  const code = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    const e = idx.x[i];
    en[i] = e.n?.toLowerCase() ?? "";
    cn[i] = e.cn?.toLowerCase() ?? "";
    code[i] = srcCode(e.s).toUpperCase();
  }
  searchKeys = { for: idx, en, cn, code };
}

/** Index bookkeeping that has to happen every time `indexCache` is
 *  replaced: the id→code map first, then the per-entry search keys,
 *  which depend on it via `srcCode`. */
function buildSourceMap(idx: IndexFile) {
  sourceById = new Map();
  if (idx.m?.s) {
    for (const [code, id] of Object.entries(idx.m.s)) {
      sourceById.set(id, code);
    }
  }
  buildSearchKeys(idx);
}

// Book labels use the selected detail library, not a global cross-language map.
const booksCache = new Map<string, Record<string, string>>();
const booksPending = new Map<string, Promise<Record<string, string>>>();
async function loadBooks(entry?: Entry): Promise<void> {
  const generation = contentGeneration;
  const code = entry ? srcCode(entry.s).toUpperCase() : "";
  const sources = getEnabledLibrarySources().filter((source) => !source.disabledSources.has(code.toLowerCase()));
  const own = sources.find((source) => source.id === entry?.library);
  const candidates = own ? [own] : sources.slice(0, 1);
  for (const source of candidates) {
    const key = `${BOOKS_CACHE_KEY}:${getLocalLang()}:${source.identity}`;
    let names = booksCache.get(key);
    if (!names) {
      let pending = booksPending.get(key);
      if (!pending) {
        pending = (async () => {
          try {
            const saved = JSON.parse(localStorage.getItem(key) ?? "null");
            if (saved && Date.now() - saved.ts < CACHE_TTL_MS && typeof saved.data === "object") return saved.data as Record<string, string>;
          } catch {}
          const response = await fetchContentJson(`${source.base}/data/books.json`, { cache: "no-cache", signal: contentAbort.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          if (!Array.isArray(body.book)) throw new Error("Invalid book list");
          const result: Record<string, string> = {};
          for (const book of body.book) {
            const id = String(book.source ?? book.id ?? "").toUpperCase();
            if (id && typeof book.name === "string" && !source.disabledSources.has(id.toLowerCase())) result[id] = book.name;
          }
          if (generation === contentGeneration) {
            booksCache.set(key, result);
            try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: result })); } catch {}
          }
          return result;
        })();
        booksPending.set(key, pending);
      }
      try { names = await pending; }
      catch { return; } // Optional labels never block or fail the detail view.
      finally { if (booksPending.get(key) === pending) booksPending.delete(key); }
    }
    if (generation !== contentGeneration) return;
    // This map is display-only; keys include the originating library in cache.
    if (code && names?.[code]) sourceNames.set(`${source.id}|${code}`, names[code]);
  }
}

// --- Filter & search ---
interface FilterOpts {
  dataVersion: DataVersion;
  language: Language;
  isGM: boolean;
  allowPlayerMonsters: boolean;
}
interface Hit { entry: Entry; score: number; }

const CORE_2014 = new Set(["PHB", "MM", "DMG"]);
const CORE_2024 = new Set(["XPHB", "XMM", "XDMG"]);

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

  // Keyed on the index OBJECT, not on its length: two different
  // indexes can have the same entry count, and searching one with the
  // other's keys would silently return wrong matches. Every path that
  // assigns indexCache already rebuilds these via buildSourceMap; this
  // is the belt.
  if (searchKeys.for !== idx) buildSearchKeys(idx);
  const keyEn = searchKeys.en;
  const keyCn = searchKeys.cn;
  const keyCode = searchKeys.code;

  for (let i = 0; i < idx.x.length; i++) {
    const e = idx.x[i];
    const code = keyCode[i];
    if (!passesVersion(code, opts.dataVersion)) continue;

    if ((e.c === 1 || e.c === 46) && !opts.isGM && !opts.allowPlayerMonsters) {
      continue;
    }

    const en = keyEn[i];
    const cn = keyCn[i];

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

// Successful JSON files are cached per configuration and generation. A detail
// request reads one candidate library at a time; no all-library detail fan-out.
const dataCache = new Map<string, any>();
const dataPending = new Map<string, Promise<any>>();
const loggedMissingSources = new Set<string>();
const unavailableSources = new Set<string>();

function invalidateSearchContent() {
  contentGeneration++;
  contentAbort.abort();
  contentAbort = new AbortController();
  booksCache.clear();
  booksPending.clear();
  sourceNames.clear();
  previewRequests.invalidate();
  indexCache = null;
  indexLoading = null;
  indexRetryAt = Infinity;
  dataCache.clear();
  dataPending.clear();
  loggedMissingSources.clear();
  unavailableSources.clear();
}
function isSourceDataKnownMissing(key: string | undefined, source: string): boolean {
  return !!key && loggedMissingSources.has(`${key}|${source}`);
}
async function loadSourceFile(source: ContentSource, path: string): Promise<any | null> {
  const generation = contentGeneration;
  const key = `${generation}:${source.identity}:${path}`;
  if (dataCache.has(key)) return dataCache.get(key);
  const existing = dataPending.get(key);
  if (existing) return existing;
  const signal = contentAbort.signal;
  const pending = (async () => {
    const response = await fetchContentJson(`${source.base}/data/${path}`, { cache: "no-cache", signal });
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    if (!body || typeof body !== "object") throw new Error("Invalid content file");
    if (generation !== contentGeneration) throw new DOMException("Content changed", "AbortError");
    dataCache.set(key, body);
    return body;
  })().finally(() => { if (dataPending.get(key) === pending) dataPending.delete(key); });
  dataPending.set(key, pending);
  return pending;
}

async function loadCategoryData(entry: Entry, cat = categoryInfo(entry.c), source?: ContentSource): Promise<DataEntry[]> {
  if (!cat.data) return [];
  if (!source) return getLocalDataByKeySource(cat.data.key, srcCode(entry.s)) as DataEntry[];
  const data = cat.data;
  let files: string[];
  if ("allClassFiles" in data) {
    const index = await loadSourceFile(source, "class/index.json");
    if (!index) return [];
    const entries = Object.entries(index).filter((pair): pair is [string, string] => typeof pair[1] === "string");
    // Native hash contains the parent class slug even when the displayed name
    // has been translated. Unknown/homebrew hashes retain the pooled fallback.
    let hash = entry.u ?? "";
    try { hash = decodeURIComponent(hash).toLowerCase(); } catch {}
    const parsed = parseClassFamilyEntry(entry);
    const candidates = [parsed.classCn, parsed.classEn, entry.c === 5 ? entry.n : ""].filter(Boolean).map((name) => name!.toLowerCase());
    const matched = entries.filter(([name]) => candidates.includes(name.toLowerCase()) || hash.split("_").includes(name.toLowerCase()));
    files = [...new Set((matched.length ? matched : entries).map(([, file]) => `class/${file}`))];
  } else if ("itemsBaseKey" in data) files = ["items-base.json"];
  else if ("file" in data) files = [data.file];
  else files = [...new Set([srcCode(entry.s).toLowerCase(), srcCode(entry.s), srcCode(entry.s).toUpperCase()].map(data.fileBySource))];
  const result: DataEntry[] = [];
  let failure: unknown;
  const readFile = async (file: string): Promise<DataEntry[] | null> => {
    try {
      const body = await loadSourceFile(source, file);
      if (!body) return null;
      const rows = body[data.key] ?? [];
      if (!Array.isArray(rows)) throw new Error("Invalid detail list");
      const items: DataEntry[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || source.disabledSources.has(String(row.source ?? "").toLowerCase())) continue;
        if ("itemsBaseKey" in data) {
          const inner = row.entries?.[0];
          items.push({ ...row, ENG_name: row.ENG_name ?? inner?.ENG_name ?? row.abbreviation,
            name: row.name ?? inner?.name, entries: inner?.entries ?? row.entries,
            _contentLibrary: source.id, _contentLanguage: source.language });
        } else items.push({ ...row, _contentLibrary: source.id, _contentLanguage: source.language });
      }
      return items;
    } catch (error) {
      failure = error;
      if (contentAbort.signal.aborted || (error as Error).name === "AbortError") throw error;
      unavailableSources.add(`${data.key}|${srcCode(entry.s)}`);
      return null;
    }
  };
  if ("allClassFiles" in data) {
    // Unknown homebrew hashes retain bounded, ordered pooled loading. There
    // is no total-duration cutoff that could truncate healthy slow sources.
    for (const rows of await mapWithConcurrency(files, 2, readFile)) if (rows) result.push(...rows);
  } else {
    for (const file of files) {
      const rows = await readFile(file);
      if (rows) { result.push(...rows); break; } // Case variants are alternatives.
    }
  }
  if (failure && !result.length) throw failure;
  return result;
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
  classEn: string | null;
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
      classEn: mEn ? mEn[1].trim() : null,
      classCn: mCn ? mCn[1].trim() : null,
      level: mEn ? parseInt(mEn[2], 10) : (mCn ? parseInt(mCn[2], 10) : null),
      featureEng: mEn ? mEn[3].trim() : null,
      featureCn: mCn ? mCn[3].trim() : null,
    };
  }
  // No semicolon → it's a top-level class or subclass entry.
  return {
    classEn: n || null,
    classCn: cn || null,
    level: null,
    featureEng: n || null,
    featureCn: cn || null,
  };
}

function matchesEntry(entry: Entry, data: DataEntry): boolean {
  const source = srcCode(entry.s).toUpperCase();
  // Same name in PHB and XPHB must never resolve to the other edition.
  if (source && String(data.source ?? "").toUpperCase() !== source) return false;
  const classFamily = [5, 30, 40, 41].includes(entry.c);
  const parsed = classFamily ? parseClassFamilyEntry(entry) : null;
  const names = (parsed ? [parsed.featureEng, parsed.featureCn] : [entry.n, entry.cn])
    .filter(Boolean).map((name) => name!.toLowerCase());
  if (![data.ENG_name, data.name, data.abbreviation].some((name) => typeof name === "string" && names.includes(name.toLowerCase()))) return false;
  if (parsed?.level != null && data.level != null && parsed.level !== data.level) return false;
  if (parsed?.level != null && data.className) {
    const classes = [parsed.classEn, parsed.classCn].filter(Boolean).map((name) => name!.toLowerCase());
    let hash = entry.u ?? "";
    try { hash = decodeURIComponent(hash).toLowerCase(); } catch {}
    if (!classes.includes(String(data.className).toLowerCase()) && !hash.split("_").includes(String(data.className).toLowerCase())) return false;
  }
  return true;
}

async function findEntryData(entry: Entry): Promise<DataEntry | null> {
  const generation = contentGeneration;
  const cat = categoryInfo(entry.c);
  if (!cat.data) return null;
  const keys = [...new Set([cat.data.key, ...({ 10: ["subrace"], 5: ["subclass", "classFeature"], 30: ["subclassFeature"] } as Record<number, string[]>)[entry.c] ?? []])];
  const code = srcCode(entry.s);
  const sources = getEnabledLibrarySources().filter((source) => !source.disabledSources.has(code.toLowerCase()));
  // A stale selection is never permission to fetch a disabled library.
  if (entry.library && !sources.some((source) => source.id === entry.library)) return null;
  const availableKey = `${cat.data.key}|${code}`;
  let unavailable = false;
  for (const source of [undefined, ...sources]) {
    for (const key of keys) {
      try {
        const pool = await loadCategoryData(entry, { ...cat, data: { ...cat.data, key } }, source);
        if (generation !== contentGeneration) return null;
        let found = pool.find((item) => matchesEntry(entry, item));
        if (!found) continue;
        if (!source) found = { ...found, _contentLanguage: "auto" }; // Authored content is verbatim.
        if (!found.entries && found._copy) {
          const copy = found._copy;
          const parentName = String(copy.ENG_name ?? copy.name ?? "").toLowerCase();
          const parent = pool.find((item) => String(item.ENG_name ?? item.name ?? "").toLowerCase() === parentName &&
            (!copy.source || item.source?.toUpperCase() === String(copy.source).toUpperCase()));
          if (parent?.entries) found = { ...found, entries: parent.entries, _copyResolvedFrom: parent.ENG_name || parent.name };
        }
        unavailableSources.delete(availableKey);
        return found;
      } catch (error) {
        if (generation !== contentGeneration) return null;
        unavailable = true;
        console.warn("[search] detail candidate unavailable", { library: source?.base, code, key, error });
      }
    }
  }
  if (unavailable || unavailableSources.has(availableKey)) unavailableSources.add(availableKey);
  else loggedMissingSources.add(availableKey);
  return null;
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
  if (getLocalLang() === "en") return en.alignmentEn(a);
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
    add(tr("速度", "Speed"), speedStr(data.speed));
  } else if (c === 2) {
    add(tr("环阶", "Level"), spellLevelStr(data.level));
    add(tr("学派", "School"), schoolStr(data.school));
    add(tr("施法", "Casting Time"), timeStr(data.time));
    add(tr("距离", "Range"), rangeStr(data.range));
    add(tr("成分", "Components"), componentsStr(data.components));
    add(tr("持续", "Duration"), durationStr(data.duration));
  } else if (c === 4 || c === 31 || c === 56 || c === 57) {
    add(tr("类型", "Type"), getLocalLang() === "en" ? en.enumEn("item", data.type ?? data.weaponCategory ?? data.armorCategory) : String(data.type ?? data.weaponCategory ?? data.armorCategory ?? ""));
    if (data.weight != null) add(tr("重量", "Weight"), `${data.weight} ${tr("磅", "lb.")}`);
    if (data.value != null) add(tr("价值", "Value"), `${data.value} cp`);
    if (data.rarity) add(tr("稀有度", "Rarity"), String(data.rarity));
    if (data.reqAttune) add(tr("需调谐", "Attunement"), typeof data.reqAttune === "string" ? stripTags(data.reqAttune) : tr("是", "Yes"));
  } else if (c === 8) {
    if (data.prerequisite) add(tr("先决", "Prerequisite"), prerequisiteStr(data.prerequisite));
  } else if (c === 10) {
    add(tr("体型", "Size"), sizeStr(data.size));
    add(tr("速度", "Speed"), speedStr(data.speed));
  }
  return chips.length ? `<div class="chips">${chips.join("")}</div>` : "";
}

function renderMonster(entry: Entry, data: DataEntry): string {
  const parts: string[] = [];

  const sz = sizeStr(data.size);
  const ty = typeStr(data.type);
  const al = alignmentStr(data.alignment);
  const sub = [sz, ty].filter(Boolean).join(" ");
  const subLine = al ? `${sub}${comma()}${al}` : sub;
  if (subLine) parts.push(`<div class="prev-subtitle">${escapeHtml(subLine)}</div>`);

  parts.push(chipsFor(entry, data));
  parts.push(renderAbilityGrid(data));
  parts.push(renderMonsterSummary(data));

  if (data.entries) parts.push(renderEntries(data.entries));

  if (data.trait?.length) {
    parts.push(`<h4>${tr("特性", "Traits")}</h4>`);
    for (const t of data.trait) parts.push(renderTrait(t));
  }
  // displayAs routing (checklist §5) — mirrors the monster-info
  // popover: flagged entries render inside 动作/附赠动作/反应 after the
  // native rows; unflagged ones stay in the default spellcasting spot.
  const scGroups = groupSpellcastingByDisplay(
    data.spellcasting ?? [],
    `${data.ENG_name || data.name || entry.n} (${data.source ?? "?"})`,
    "[obr-suite/search]",
  );
  for (const sc of scGroups.default) parts.push(renderSpellcasting(sc));
  const pushActionSection = (title: string, native: any[] | undefined, spellEntries: any[]) => {
    const hasNative = Array.isArray(native) && native.length > 0;
    if (!hasNative && spellEntries.length === 0) return;
    parts.push(`<h4>${title}</h4>`);
    if (hasNative) for (const t of native!) parts.push(renderTrait(t));
    for (const sc of spellEntries) parts.push(renderSpellcasting(sc));
  };
  pushActionSection(tr("动作", "Actions"), data.action, scGroups.action);
  pushActionSection(tr("附赠动作", "Bonus Actions"), data.bonus, scGroups.bonus);
  pushActionSection(tr("反应", "Reactions"), data.reaction, scGroups.reaction);
  if (data.legendary?.length) {
    parts.push(`<h4>${tr("传奇动作", "Legendary Actions")}</h4>`);
    if (data.legendaryHeader) parts.push(renderEntries(data.legendaryHeader));
    else
      parts.push(
        `<p>${tr(`本怪物可执行 ${data.legendaryActions ?? 3} 次传奇动作，从下列动作中选择，每次只能用一个传奇动作选项，且只能在另一生物的回合结束时使用。在自己的回合开始时回复全部消耗。`, `This creature has ${data.legendaryActions ?? 3} legendary actions. It can use one option at the end of another creature's turn and regains spent actions at the start of its turn.`)}</p>`
      );
    for (const t of data.legendary) parts.push(renderTrait(t));
  }
  if (data.mythic?.length) {
    parts.push(`<h4>${tr("神话动作", "Mythic Actions")}</h4>`);
    if (data.mythicHeader) parts.push(renderEntries(data.mythicHeader));
    for (const t of data.mythic) parts.push(renderTrait(t));
  }
  if (data.lairActions?.length) {
    parts.push(`<h4>${tr("巢穴动作", "Lair Actions")}</h4>`);
    for (const t of data.lairActions) parts.push(renderEntries([t]));
  }
  if (data.regionalEffects?.length) {
    parts.push(`<h4>${tr("区域效应", "Regional Effects")}</h4>`);
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
      .map(([k, v]) => `${getLocalLang() === "en" ? en.abilityEn[k] ?? k : ABILITY_ZH[k] ?? k} ${v}`);
    lines.push(mkLine(tr("豁免", "Saving Throws"), parts.join(comma())));
  }
  if (data.skill && Object.keys(data.skill).length) {
    const parts = Object.entries(data.skill).map(([k, v]) => `${k} ${v}`);
    lines.push(mkLine(tr("技能", "Skills"), parts.join(comma())));
  }
  if (data.resist) lines.push(mkLine(tr("抗性", "Damage Resistances"), formatTypeList(data.resist)));
  if (data.immune) lines.push(mkLine(tr("免疫", "Damage Immunities"), formatTypeList(data.immune)));
  if (data.vulnerable) lines.push(mkLine(tr("易伤", "Damage Vulnerabilities"), formatTypeList(data.vulnerable)));
  if (data.conditionImmune) lines.push(mkLine(tr("状态免疫", "Condition Immunities"), formatTypeList(data.conditionImmune)));
  if (data.senses) {
    const senses = Array.isArray(data.senses)
      ? data.senses.map(stripTags).join(comma())
      : stripTags(String(data.senses));
    const passive = data.passive != null ? `${comma()}${tr("被动察觉", "Passive Perception")} ${data.passive}` : "";
    lines.push(mkLine(tr("感官", "Senses"), `${senses}${passive}`));
  }
  if (data.languages) {
    const langs = Array.isArray(data.languages)
      ? data.languages.map(stripTags).join(comma())
      : stripTags(String(data.languages));
    lines.push(mkLine(tr("语言", "Languages"), langs));
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
    .join(comma());
}

function renderTrait(t: any): string {
  const name = t.name ? `<b>${escapeHtml(stripTags(t.name))}.</b> ` : "";
  const entries = t.entries ? renderEntries(t.entries) : "";
  return `<div class="trait">${name}${entries}</div>`;
}

function renderSpellcasting(sc: any): string {
  const parts: string[] = [];
  parts.push(`<div class="trait"><b>${escapeHtml(stripTags(sc.name ?? tr("施法", "Spellcasting")))}.</b> `);
  if (sc.headerEntries) parts.push(renderEntries(sc.headerEntries));
  parts.push("</div>");

  const fmtSpells = (arr: any[]) =>
    (arr || []).map((s) => escapeHtml(stripTags(String(s)))).join(tr("、", ", "));

  if (sc.will?.length) parts.push(`<p><b>${tr("随意施放：", "At will: ")}</b>${fmtSpells(sc.will)}</p>`);
  if (sc.daily) {
    for (const k of ["1", "1e", "2", "2e", "3", "3e", "4", "4e", "5", "5e"]) {
      const arr = (sc.daily as any)[k];
      if (Array.isArray(arr) && arr.length) {
        const label = getLocalLang() === "en" ? `${k.replace(/e$/, "")}/day${k.endsWith("e") ? " each" : ""}` : k.endsWith("e") ? `每日每项 ${k.slice(0, -1)} 次` : `${k}/天`;
        parts.push(`<p><b>${label}${tr("：", ": ")}</b>${fmtSpells(arr)}</p>`);
      }
    }
  }
  if (sc.rest) {
    for (const [k, v] of Object.entries(sc.rest)) {
      if (Array.isArray(v) && v.length)
        parts.push(`<p><b>${tr(`每次休整 ${k}/次：`, `${k.replace(/e$/, "")}/rest${k.endsWith("e") ? " each" : ""}: `)}</b>${fmtSpells(v as any[])}</p>`);
    }
  }
  if (sc.spells) {
    for (const [level, info] of Object.entries(sc.spells)) {
      const lvl = spellLevelStr(Number(level));
      const slots = (info as any).slots != null
        ? tr(`（${(info as any).slots} 个法术位）`, ` (${(info as any).slots} ${(info as any).slots === 1 ? "slot" : "slots"})`)
        : "";
      const ll = (info as any).lower ? tr(`（${(info as any).lower}–${level} 环）`, ` (levels ${(info as any).lower}–${level})`) : "";
      const arr = (info as any).spells ?? [];
      parts.push(`<p><b>${lvl}${slots}${ll}${tr("：", ": ")}</b>${fmtSpells(arr)}</p>`);
    }
  }
  if (sc.footerEntries) parts.push(renderEntries(sc.footerEntries));
  return parts.join("");
}

function renderSpell(_entry: Entry, data: DataEntry): string {
  const parts: string[] = [];
  if (data.entries) parts.push(renderEntries(data.entries));
  if (data.entriesHigherLevel) {
    parts.push(`<h4>${tr("当以更高阶法术位施放时", "At Higher Levels")}</h4>`);
    parts.push(renderEntries(data.entriesHigherLevel));
  }
  const fromClass: string[] = [];
  if (data.classes?.fromClassList)
    for (const c of data.classes.fromClassList) fromClass.push(stripTags(c.name));
  if (data.classes?.fromSubclass)
    for (const c of data.classes.fromSubclass)
      fromClass.push(`${stripTags(c.class?.name ?? "")} (${stripTags(c.subclass?.name ?? "")})`);
  if (fromClass.length)
    parts.push(`<p><b>${tr("职业列表：", "Classes: ")}</b>${escapeHtml(fromClass.join(tr("、", ", ")))}</p>`);
  return parts.join("");
}

function renderItem(_entry: Entry, data: DataEntry): string {
  const parts: string[] = [];
  const weaponBits: string[] = [];
  if (data.dmg1) weaponBits.push(`${stripTags(String(data.dmg1))} ${dmgTypeStr(data.dmgType)}`);
  if (data.dmg2) weaponBits.push(`${tr("双手", "Two-handed")} ${stripTags(String(data.dmg2))}`);
  if (Array.isArray(data.property) && data.property.length)
    weaponBits.push(`${tr("属性：", "Properties: ")}${data.property.map((value: string) => getLocalLang() === "en" ? en.enumEn("property", value) : stripTags(value)).join(tr("、", ", "))}`);
  if (data.range) weaponBits.push(`${tr("射程：", "Range: ")}${stripTags(String(data.range))}`);
  if (weaponBits.length)
    parts.push(`<p>${escapeHtml(weaponBits.join("　"))}</p>`);
  if (data.ac != null) parts.push(`<p><b>AC</b> ${escapeHtml(String(data.ac))}</p>`);
  if (data.entries) parts.push(renderEntries(data.entries));
  return parts.join("");
}

function dmgTypeStr(t: any): string {
  if (getLocalLang() === "en") return en.enumEn("damage", t);
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
  if (getLocalLang() === "en") return en.speedEn(sp);
  if (!sp) return "";
  if (typeof sp === "number") return `${sp} 尺`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(sp)) {
    const n = typeof v === "object" && v != null ? (v as any).number : v;
    const cond = typeof v === "object" && (v as any).condition ? `（${stripTags((v as any).condition)}）` : "";
    if (k === "walk") parts.unshift(`${n} 尺${cond}`);
    else if (typeof n === "number") parts.push(`${k} ${n} 尺${cond}`);
  }
  return parts.join(comma());
}
function sizeStr(size: any): string {
  if (getLocalLang() === "en") return (Array.isArray(size) ? size : [size]).filter(Boolean).map((value) => en.enumEn("size", value)).join("/");
  const SZ: Record<string, string> = { T: "微型", S: "小型", M: "中型", L: "大型", H: "巨型", G: "超巨" };
  if (Array.isArray(size)) return size.map((c) => SZ[c] ?? c).join("/");
  if (typeof size === "string") return SZ[size] ?? size;
  return "";
}
function spellLevelStr(lvl: any): string {
  if (getLocalLang() === "en") return en.spellLevelEn(lvl);
  if (lvl == null) return "";
  if (lvl === 0) return "戏法";
  return `${lvl} 环`;
}
// 2026-05-16 — school code → 中文学派 mapping. 5etools uses single-
// letter codes for the eight 5e schools:
//   A = Abjuration (防护)     C = Conjuration (咒法)
//   D = Divination (预言)      E = Enchantment (附魔)
//   V = Evocation (塑能)       I = Illusion (幻术)
//   N = Necromancy (死灵)      T = Transmutation (变化)
// The previous table had C→塑能, D→死灵, N→塑能, V→预言 — four of
// the eight schools were displaying the wrong Chinese name. Fixed.
const SCHOOLS: Record<string, string> = {
  A: "防护", C: "咒法", D: "预言", E: "附魔",
  V: "塑能", I: "幻术", N: "死灵", T: "变化",
};
function schoolStr(s: any): string {
  if (getLocalLang() === "en") return en.enumEn("school", s);
  return typeof s === "string" ? SCHOOLS[s] ?? s : "";
}
// 2026-05-16 — casting-time unit translation. 5etools sends
// `{ number, unit }` with `unit` as raw English ("action", "bonus",
// "reaction", "minute", "hour"). Untranslated this read as "1 action"
// on the chip; localize for the Chinese UI.
const CAST_TIME_UNIT_ZH: Record<string, string> = {
  action: "动作",
  bonus: "附赠动作",
  reaction: "反应",
  minute: "分钟", minutes: "分钟",
  hour: "小时", hours: "小时",
  round: "回合", rounds: "回合",
};
function castTimeUnitZh(u: unknown): string {
  if (typeof u !== "string") return "";
  return CAST_TIME_UNIT_ZH[u.toLowerCase()] ?? u;
}
function timeStr(t: any): string {
  if (getLocalLang() === "en") return en.timeEn(t);
  if (!Array.isArray(t)) return "";
  return t
    .map((x) => {
      if (typeof x !== "object" || x == null) return String(x);
      const n = x.number ?? "";
      const unit = castTimeUnitZh(x.unit);
      const out = `${n} ${unit}`.trim();
      // Preserve any condition text ({@condition triggered when ...})
      // as a follow-on so e.g. reaction-on-trigger spells still read
      // sensibly: "1 反应（当...）".
      const cond = typeof x.condition === "string" ? stripTags(x.condition) : "";
      return cond ? `${out}（${cond}）` : out;
    })
    .join(comma());
}
// 2026-05-16 — distance / shape unit translation. 5etools uses
// `distance.type` = "self" / "touch" / "feet" / "miles" /
// "unlimited" / "sight" and `range.type` = "point" / "radius" /
// "cone" / "line" / "sphere" / "cube" etc. Localize both so spells
// show "60 尺 锥形" instead of "60 feet cone".
const DISTANCE_UNIT_ZH: Record<string, string> = {
  feet: "尺", foot: "尺",
  miles: "英里", mile: "英里",
  unlimited: "无限", sight: "视野范围",
};
const RANGE_SHAPE_ZH: Record<string, string> = {
  radius: "半径", cone: "锥形", line: "线状",
  sphere: "球状", cube: "立方", hemisphere: "半球",
  cylinder: "圆柱",
};
function rangeStr(r: any): string {
  if (getLocalLang() === "en") return en.rangeEn(r);
  if (!r) return "";
  if (typeof r === "string") return r;
  const d = r.distance;
  if (r.type === "point" && d) {
    if (d.type === "self") return "自身";
    if (d.type === "touch") return "触及";
    const unit = DISTANCE_UNIT_ZH[String(d.type ?? "").toLowerCase()] ?? d.type ?? "";
    return `${d.amount ?? ""} ${unit}`.trim();
  }
  // Shape-based range (radius / cone / line / etc.) — append the
  // distance afterwards so "60 ft cone" → "60 尺 锥形".
  const shape = RANGE_SHAPE_ZH[String(r.type ?? "").toLowerCase()] ?? r.type ?? "";
  if (shape && d) {
    const unit = DISTANCE_UNIT_ZH[String(d.type ?? "").toLowerCase()] ?? d.type ?? "";
    const dist = `${d.amount ?? ""} ${unit}`.trim();
    return dist ? `${dist} ${shape}` : shape;
  }
  return shape || "";
}
function componentsStr(c: any): string {
  if (getLocalLang() === "en") return en.componentsEn(c);
  if (!c) return "";
  const parts: string[] = [];
  if (c.v) parts.push("V");
  if (c.s) parts.push("S");
  // 2026-05-15 — M material can be:
  //   • a plain string: "pinch of mistletoe"
  //   • a {text, cost?, consume?} object (5etools shape) — show the
  //     text and append cost / consumed markers when present.
  // User asked for the actual material spelled out, not just "M".
  if (c.m) {
    let mText = "";
    if (typeof c.m === "string") mText = stripTags(c.m);
    else if (typeof c.m === "object" && c.m) {
      const t = (c.m as any).text;
      if (typeof t === "string") mText = stripTags(t);
      const cost = (c.m as any).cost;
      if (typeof cost === "number" && cost > 0) {
        // 5etools "cost" is in copper pieces; show as gp for spell-component readability.
        mText = mText ? `${mText}（价值 ${(cost / 100).toFixed(0)} 金币）` : `（${(cost / 100).toFixed(0)} 金币材料）`;
      }
      if ((c.m as any).consume) mText = mText ? `${mText} · 消耗` : "消耗";
    }
    parts.push(mText ? `M（${mText}）` : "M");
  }
  return parts.join(", ");
}
// 2026-05-16 — duration-unit translation. 5etools sends raw English
// units inside `duration.type` ("minute" / "hour" / "day" / "round").
// Without this map the duration chip on Chinese cards read "10 minute"
// instead of "10 分钟". Falls back to the raw unit when not mapped.
const DURATION_UNIT_ZH: Record<string, string> = {
  round: "回合", rounds: "回合",
  minute: "分钟", minutes: "分钟",
  hour: "小时", hours: "小时",
  day: "天", days: "天",
  week: "周", weeks: "周",
  month: "月", months: "月",
  year: "年", years: "年",
};
function durationUnitZh(u: unknown): string {
  if (typeof u !== "string") return "";
  return DURATION_UNIT_ZH[u.toLowerCase()] ?? u;
}
function durationStr(d: any): string {
  if (getLocalLang() === "en") return en.durationEn(d);
  if (!Array.isArray(d) || !d.length) return "";
  const x = d[0];
  if (typeof x === "string") return x;
  if (x.type === "instant") return "瞬发";
  if (x.type === "permanent") return "永久";
  if (x.type === "special") return "特殊";
  // 2026-05-16 — concentration spells from 5etools come through as
  // `{ type: "timed", duration: {...}, concentration: true }`. The
  // old code matched `type === "timed"` first and returned without
  // ever checking `concentration`, so "专注" never appeared on any
  // spell using the standard 5e shape. Prefix it inline now.
  if (x.type === "timed" && x.duration) {
    const prefix = x.concentration ? "专注 " : "";
    const amount = x.duration.amount ?? "";
    const unit = durationUnitZh(x.duration.type);
    return `${prefix}${amount} ${unit}`.trim();
  }
  if (x.concentration) {
    const amount = x.duration?.amount ?? "";
    const unit = durationUnitZh(x.duration?.type);
    return `专注 ${amount} ${unit}`.trim();
  }
  return x.type ?? "";
}
function prerequisiteStr(prereq: any): string {
  if (getLocalLang() === "en") return en.prerequisiteEn(prereq);
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
    ? `<p><b>${tr("等级范围：", "Level Range: ")}</b>${escapeHtml(`${data.level.start ?? "?"} - ${data.level.end ?? "?"}`)}</p>`
    : "";
  const author = data.author ? `<p><b>${tr("作者：", "Author: ")}</b>${escapeHtml(stripTags(String(data.author)))}</p>` : "";
  const story = data.storyline ? `<p><b>${tr("故事线：", "Storyline: ")}</b>${escapeHtml(stripTags(String(data.storyline)))}</p>` : "";
  const published = data.published ? `<p><b>${tr("出版：", "Published: ")}</b>${escapeHtml(String(data.published))}</p>` : "";
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
    parts.push(`<h4>${tr("章节", "Chapters")}</h4><ol class="chap-list">${chapters}</ol>`);
  }
  return parts.join("");
}

function renderBook(_entry: Entry, data: DataEntry): string {
  const parts: string[] = [];
  if (data.published) parts.push(`<p><b>${tr("出版：", "Published: ")}</b>${escapeHtml(String(data.published))}</p>`);
  if (data.author) parts.push(`<p><b>${tr("作者：", "Author: ")}</b>${escapeHtml(stripTags(String(data.author)))}</p>`);
  if (Array.isArray(data.contents) && data.contents.length) {
    const chapters = data.contents.map((ch: any) => {
      const ord = ch.ordinal
        ? `<span class="chap-ord">${escapeHtml(String(ch.ordinal.identifier ?? ""))}.</span> `
        : "";
      const title = escapeHtml(stripTags(ch.name ?? ch.ENG_name ?? "?"));
      return `<li>${ord}${title}</li>`;
    }).join("");
    parts.push(`<h4>${tr("目录", "Contents")}</h4><ol class="chap-list">${chapters}</ol>`);
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
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = tr("全局搜索", "Global Search");
  const drag = document.getElementById("search-drag-handle");
  drag?.setAttribute("title", tr("拖动搜索栏", "Drag search bar"));
  drag?.setAttribute("aria-label", tr("拖动搜索栏", "Drag search bar"));
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
    renderHint(tr("无匹配条目", "No matching entries"));
    renderPreviewIdle();
    return;
  }
  countEl.textContent = String(hits.length);
  const parts: string[] = [];
  hits.forEach((e, idx) => {
    const cat = categoryInfo(e.c);
    const display = !e.local && getLocalLang() === "en" ? e.n || e.cn || "" : e.cn || e.n;
    // Retain translated aliases in the search index without adding a second
    // language to the English result surface. Authored local titles stay intact.
    const alternate = getLocalLang() === "en" ? "" : e.n;
    const sub = alternate && alternate !== display ? alternate : "";
    const code = srcCode(e.s).toUpperCase();
    const edClass =
      CORE_2014.has(code)
        ? "ed-2014"
        : CORE_2024.has(code)
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
  previewRequests.invalidate();
  previewEl.innerHTML = `<div class="prev-empty">${tr("悬停或点击词条查看详情", "Hover over or select an entry for details")}<br><span class="prev-empty-sub">${tr("Esc 关闭 · ↑↓ 选择", "Esc Close · ↑↓ Select")}</span></div>`;
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
  if (pinnedEntry === entry) {
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

// 2026-05-15 — "未显示？顺手汇报" button. Posts the search entry to
// /api/character/missing-report (Flask) which appends one JSON line to
// /var/log/obr-suite/missing-reports.jsonl. The maintainer greps the
// file later to see which 5etools fields the renderer doesn't surface
// yet. Best-effort: a network blip just shows an error pill.
async function sendMissingReport(
  entry: Entry,
  bodyEl: HTMLElement | null,
  btn: HTMLButtonElement,
): Promise<void> {
  // Once-per-click guard so accidental double-clicks don't double-log.
  if (btn.disabled) return;
  btn.disabled = true;
  const originalLabel = btn.innerHTML;
  btn.innerHTML = `<span style="opacity:0.7">${tr("汇报中…", "Sending…")}</span>`;
  // Lightweight visible-context snapshot: first ~600 chars of the
  // body's textContent. Helps me see what DID render (or that it's
  // empty) without needing the user to type anything.
  let context = "";
  try {
    if (bodyEl) context = (bodyEl.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  } catch { /* ignore */ }
  const payload = {
    entry: {
      id: entry.id,
      n: entry.n,
      cn: entry.cn ?? "",
      c: entry.c,
      s: entry.s,
      p: entry.p,
    },
    context,
    pageUrl: location.href,
  };
  try {
    const r = await fetch("/api/character/missing-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    btn.innerHTML = `<span style="color:#7be0a0">${tr("✓ 已汇报，谢谢", "✓ Report sent, thank you")}</span>`;
    // Restore after a moment so the user can resubmit if needed
    setTimeout(() => { btn.innerHTML = originalLabel; btn.disabled = false; }, 2400);
  } catch (e) {
    btn.innerHTML = `<span style="color:#ff7a6b">${tr("汇报失败，稍后再试", "Report failed. Try again later.")}</span>`;
    setTimeout(() => { btn.innerHTML = originalLabel; btn.disabled = false; }, 2400);
    console.warn("[search/missing-report]", e);
  }
}

async function renderPreviewFor(entry: Entry) {
  const isCurrent = previewRequests.next();
  const cat = categoryInfo(entry.c);
  const display = !entry.local && getLocalLang() === "en" ? entry.n || entry.cn || "" : entry.cn || entry.n;
  const code = srcCode(entry.s).toUpperCase();
  const page = entry.p ? ` · p.${entry.p}` : "";

  const srcDisplay = sourceLabel(code, entry);

  previewEl.innerHTML = `
    <div class="prev-head">
      <button class="prev-report" id="prev-report" type="button"
              title="${tr("该词条没正确显示？点一下汇报，我会收集起来做适配。", "Report a problem displaying this entry.")}">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
             style="vertical-align:-1px;margin-right:3px">
          <circle cx="8" cy="8" r="6"/><path d="M8 5v4"/><path d="M8 11.2v.05"/>
        </svg>${tr("未显示？顺手汇报", "Report a display issue")}
      </button>
      <div class="prev-title">${escapeHtml(display)}</div>
      ${entry.n && entry.n !== display ? `<div class="prev-eng">${escapeHtml(entry.n)}</div>` : ""}
      <div class="prev-meta">${escapeHtml(cat.label)} · ${escapeHtml(srcDisplay)}${escapeHtml(page)}</div>
    </div>
    <div class="prev-body" id="prev-body"><div class="prev-loading">${tr("加载中…", "Loading…")}</div></div>
  `;
  const bodyEl = previewEl.querySelector("#prev-body") as HTMLDivElement;
  const metaEl = previewEl.querySelector(".prev-meta") as HTMLDivElement;
  // Source names are optional decoration. Paint the usable shell first.
  let detailLoaded = false;
  void loadBooks(entry).then(() => {
    if (!isCurrent() || !metaEl.isConnected || detailLoaded) return;
    metaEl.textContent = `${cat.label} · ${sourceLabel(code, entry)}${page}`;
  });
  // Wire the "未显示？汇报" button. POST the search entry to the
  // character-cards Flask service (it logs to a JSONL file the
  // maintainer reviews). Single-shot per click, with a small toast on
  // success/failure — see sendMissingReport below.
  const reportBtn = previewEl.querySelector<HTMLButtonElement>("#prev-report");
  if (reportBtn) {
    reportBtn.addEventListener("click", () => void sendMissingReport(entry, bodyEl, reportBtn));
  }

  if (!cat.data) {
    bodyEl.innerHTML = `<div class="prev-empty">${tr("该分类暂无内置详情", "No built-in details for this category")}<br><span class="prev-empty-sub">${escapeHtml(cat.label)} · ${tr("仅显示名称与来源", "Name and source only")}</span></div>`;
    return;
  }

  let data: DataEntry | null = null;
  try { data = await findEntryData(entry); }
  catch (error) { console.warn("[search] preview load failed", { entry: entry.n, source: code, error }); }
  if (!isCurrent() || !bodyEl.isConnected) return;
  detailLoaded = true;

  if (!data) {
    if (unavailableSources.has(`${cat.data?.key}|${srcCode(entry.s)}`)) {
      bodyEl.innerHTML = `<div class="prev-empty">${getLocalLang() === "zh" ? "暂时无法读取此资料。" : "This content is temporarily unavailable."}<br><button type="button" class="prev-retry">${getLocalLang() === "zh" ? "重试" : "Retry"}</button></div>`;
      bodyEl.querySelector(".prev-retry")?.addEventListener("click", () => { void renderPreviewFor(entry); });
      return;
    }
    // If we've previously detected that this source's data files are
    // entirely missing from every enabled library (the all-404 path
    // in loadCategoryData also recorded a probeKey), show a more
    // specific workaround pointing to the library settings — the
    // generic "尚未同步" message wasn't actionable. Most common
    // culprit: the kiwee.top "合作版" library whose index lists
    // ~5300 stub entries with no backing JSON files.
    const isMissing = isSourceDataKnownMissing(cat.data?.key, srcCode(entry.s));
    if (isMissing) {
      bodyEl.innerHTML = `<div class="prev-empty">${tr("已启用的资料库中没有对应详情", "No matching details in the enabled libraries")}<br><span class="prev-empty-sub">${tr("来源", "Source")} ${escapeHtml(code)} · ${tr("搜索目录存在此条目，但内容文件可能缺失。可在设置中检查资料库。", "The index lists this entry, but its content may be missing. Check Libraries in Settings.")}</span></div>`;
    } else {
      bodyEl.innerHTML = `<div class="prev-empty">${tr("未找到详情数据", "Details not found")}<br><span class="prev-empty-sub">${tr("来源", "Source")} ${escapeHtml(code)}</span></div>`;
    }
    return;
  }

  const origin = { ...entry, library: data._contentLibrary, contentLanguage: data._contentLanguage };
  if (!data._contentLibrary && data.name) {
    // Local authors' names stay visible even when their ENG_name doubles as
    // the lookup identity for an override of a published record.
    previewEl.querySelector(".prev-title")!.textContent = data.name;
  }
  const originLabel = data._contentLanguage && data._contentLanguage !== "auto" && data._contentLanguage !== getLocalLang()
    ? tr(` · 原文：${data._contentLanguage === "en" ? "英语" : "中文"}`, ` · Original: ${data._contentLanguage === "zh" ? "Chinese" : "English"}`) : "";
  metaEl.textContent = `${cat.label} · ${sourceLabel(code, origin)}${page}${originLabel}`;
  void loadBooks(origin).then(() => {
    if (isCurrent() && metaEl.isConnected) metaEl.textContent = `${cat.label} · ${sourceLabel(code, origin)}${page}${originLabel}`;
  });
  const c = entry.c;
  if (c === 1 || c === 46) {
    bodyEl.innerHTML = renderMonster(entry, data);
  } else if (c === 2) {
    bodyEl.innerHTML = chipsFor(entry, data) + renderSpell(entry, data);
  } else if (c === 4 || c === 31 || c === 56 || c === 57) {
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
  const generation = contentGeneration;
  if (!indexCache) renderHint(tr("加载索引中…（首次约 1 秒）", "Loading search index…"));
  let idx: IndexFile;
  try { idx = await loadIndex(); }
  catch (e) {
    if (generation !== contentGeneration) return;
    renderHint(tr("索引加载失败，请稍后重试。", "The search index could not be loaded. Please try again."), true);
    return;
  }
  const currentQ = inputEl.value.trim();
  if (currentQ !== q || generation !== contentGeneration) return;
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

// 2026-05-10: rollable left-click in the search preview now opens
// the dice quick-pick popup (劣势 / 普通 / 优势 + 重击) instead of
// auto-rolling. Same UX as the bestiary / cc-info panels. The search
// popover has a quadrant-dependent anchor (LEFT/RIGHT × TOP/BOTTOM)
// that's hard to mirror without coordination from the bg module, so
// the popup falls back to the viewport top-center fallback baked
// into bindRollableClickPopup. Good-enough until the user asks for
// pixel-perfect anchoring.
bindRollableClickPopup(previewEl, () => resolveClickRollTarget());

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
  // 2026-05-27 — also force-reload the localContent in-memory mirror
  // from IDB. Without that, this iframe's `memFiles` map still holds
  // its boot-time snapshot and any new file written by the settings
  // iframe (manual import OR URL subscription refresh) wouldn't be
  // visible here until the user reloads the whole page.
  OBR.broadcast.onMessage(BC_LOCAL_CONTENT_CHANGED, () => {
    invalidateSearchContent();
    lastHoverEntry = null;
    pinnedEntry = null;
    renderPreviewIdle();
    void forceReloadLocalContent().then(() => {
      invalidateSearchContent();
      refilter();
    }).catch((error) => console.warn("[search] local content refresh failed", error));
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
  } catch (e) {
    console.warn("[obr-suite/search] getRole failed — treating as PLAYER", e);
  }
  // §7 family: keep the role live. The initial getRole above is only a
  // snapshot — a promoted/demoted player must gain/lose monster results
  // in the already-open bar without reopening it.
  try {
    OBR.player.onChange((p) => {
      const next = p.role === "GM";
      if (next === isGM) return;
      isGM = next;
      refilter();
    });
  } catch (e) {
    console.warn("[obr-suite/search] player.onChange subscribe failed", e);
  }

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
  //
  // 2026-05-09: signature also includes per-library disabledSources
  // and indexPath. Toggling a source checkbox in the library
  // settings doesn't change baseUrl, so the previous bases-only
  // signature missed the change → search kept showing entries from
  // disabled sources because the in-memory indexCache wasn't reset.
  const libSig = () => {
    return contentConfigurationKey(getState().libraries ?? [], getLocalLang());
  };
  let lastLibSig = libSig();
  onStateChange(() => {
    const sig = libSig();
    if (sig !== lastLibSig) {
      lastLibSig = sig;
      invalidateSearchContent();
      lastHoverEntry = null;
      pinnedEntry = null;
      renderPreviewIdle();
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
    lastLibSig = libSig();
    invalidateSearchContent();
    lastHoverEntry = null;
    pinnedEntry = null;
    renderPreviewIdle();
    applyLangPlaceholder();
    applyI18nDom(next);
    if (inputEl.value) refilter();
  });

  setTimeout(() => {
    loadIndex().catch(() => {});
  }, 250);
});
