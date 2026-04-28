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

// Suite-version of the search bar. Differences from the standalone:
//   - No in-iframe toggles row — version + allowPlayerMonsters live in
//     the suite Settings panel (scene metadata).
//   - dataVersion is a 3-way ("2014" / "2024" / "all") rather than two
//     independent booleans.
//   - language affects display preference (zh shows cn first, en shows
//     en first) and could later switch to a different mirror.

const POPOVER_ID = "com.obr-suite/search-bar";

// Data source — kiwee.top works for both languages (has both cn/n fields).
// We pick the URL based on language so a future "official" mirror can be
// dropped in for English mode without touching the rest.
const KIWEE_BASE = "https://5e.kiwee.top";
function dataBase(_lang: Language): string {
  // For now both use kiwee.top — it has cn AND n fields, complete data, and
  // doesn't restrict iframe / CORS. If we later want to use 5etools'
  // English official mirror in EN mode, swap here.
  return KIWEE_BASE;
}
function indexUrl(lang: Language): string { return `${dataBase(lang)}/search/index.json`; }
function booksUrl(lang: Language): string { return `${dataBase(lang)}/data/books.json`; }

const BAR_W_IDLE = 280;
const BAR_W_OPEN = 640;
const BAR_H_IDLE = 40;
const BAR_H_OPEN = 440;

const CACHE_KEY = "obr-suite/search-index-v1";
const BOOKS_CACHE_KEY = "obr-suite/search-books-v1";
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
    | { fileBySource: (src: string) => string; key: string };
}

// kiwee.top index categories — verified against actual data files
// 2026-04-28 by sampling 5+ entries per category and resolving them to
// the 5etools data files. The ORIGINAL standalone 5e-search code (and
// the previous version of THIS file) had the category numbers wrong:
//   c=7 was "陷阱" but actually contains FEATS (Elven Accuracy, Dark
//        Gifts from VRGtR, etc.) — feats.json
//   c=8 was "专长" but actually contains OPTIONAL FEATURES (warlock
//        invocations etc.) — optionalfeatures.json
//   c=13 (冒险) had no data — exists as adventures.json
//   c=16 was "表格" but actually contains TRAPS — trapshazards.json
// The fixes below correct all of these and verify the rest.
const CATEGORY: Record<number, CategoryInfo> = {
  1:  { label: "怪物", data: { fileBySource: (s) => `bestiary/bestiary-${s}.json`, key: "monster" } },
  2:  { label: "法术", data: { fileBySource: (s) => `spells/spells-${s}.json`, key: "spell" } },
  3:  { label: "背景", data: { file: "backgrounds.json", key: "background" } },
  4:  { label: "物品", data: { file: "items.json", key: "item" } },
  5:  { label: "职业" },
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
  30: { label: "职业能力" },
  31: { label: "物品", data: { file: "items.json", key: "item" } },
  32: { label: "盟约", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  33: { label: "武僧能力", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  34: { label: "灌注", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  35: { label: "载具升级", data: { file: "vehicles.json", key: "vehicleUpgrade" } },
  36: { label: "船定制" },
  37: { label: "符文", data: { file: "optionalfeatures.json", key: "optionalfeature" } },
  40: { label: "子职业" },
  41: { label: "子职能力" },
  42: { label: "动作", data: { file: "actions.json", key: "action" } },
  43: { label: "语言", data: { file: "languages.json", key: "language" } },
  44: { label: "整本书", data: { file: "books.json", key: "book" } },
  45: { label: "页面" },
  // c=46 is the monster's "fluff" entry — base race/type description
  // separate from the per-age stat blocks at c=1. Lives in
  // fluff-bestiary-${src}.json under `monsterFluff` (NOT in the
  // regular bestiary-${src}.json#monster file).
  46: { label: "怪物概述", data: { fileBySource: (s) => `bestiary/fluff-bestiary-${s}.json`, key: "monsterFluff" } },
  47: { label: "角色选项", data: { file: "items.json", key: "item" } },
  48: { label: "食谱", data: { file: "recipes.json", key: "recipe" } },
  49: { label: "规则", data: { file: "conditionsdiseases.json", key: "status" } },
  50: { label: "技能" },
  51: { label: "感官" },
  52: { label: "牌组", data: { file: "decks.json", key: "deck" } },
  // c=53 牌内容 — per user request, the card detail display is
  // suppressed (was cluttering search results with low-value data).
  53: { label: "牌内容" },
  54: { label: "武器精通", data: { file: "items.json", key: "itemMastery" } },
  55: { label: "地点" },
  56: { label: "物品集合", data: { file: "items.json", key: "itemGroup" } },
  57: { label: "物品", data: { file: "items.json", key: "item" } },
};
function categoryInfo(c: number): CategoryInfo {
  return CATEGORY[c] ?? { label: `?${c}` };
}

// --- Source code lookup ---
let sourceById = new Map<number, string>();
let sourceNames = new Map<string, string>(); // CODE → 中文书名
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
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; data: IndexFile };
        if (Date.now() - parsed.ts < CACHE_TTL_MS && parsed.data?.x?.length) {
          indexCache = parsed.data;
          buildSourceMap(indexCache);
          return indexCache;
        }
      }
    } catch {}
    const res = await fetch(indexUrl(getLocalLang()), { cache: "default" });
    if (!res.ok) throw new Error(`index fetch failed: ${res.status}`);
    const data = (await res.json()) as IndexFile;
    indexCache = data;
    buildSourceMap(indexCache);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
    return data;
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
      const res = await fetch(booksUrl(getLocalLang()), { cache: "default" });
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
  dataVersion: DataVersion; // suite-wide
  language: Language;
  isGM: boolean;
  allowPlayerMonsters: boolean;
}
interface Hit { entry: Entry; score: number; }

const CORE_2014 = new Set(["PHB", "MM"]);
const CORE_2024 = new Set(["XPHB", "XMM"]);

// Returns true if an entry is allowed under the current dataVersion.
//   "2014"     → only PHB + MM
//   "2024"     → only XPHB + XMM
//   "all"      → everything (cores + extensions)
function passesVersion(code: string, dv: DataVersion): boolean {
  if (dv === "all") return true;
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

    // Score: prefer the active language's startsWith, then the other
    // language's startsWith, then their respective contains. English-mode
    // users get English-name matches first; Chinese-mode users get cn first.
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
async function loadCategoryData(entry: Entry): Promise<DataEntry[]> {
  const cat = categoryInfo(entry.c);
  if (!cat.data) return [];
  const src = srcCode(entry.s).toLowerCase();
  const ck = dataCacheKey(entry.c, src);
  const cached = dataCache.get(ck);
  if (cached) return cached;
  const pending = dataPending.get(ck);
  if (pending) return pending;
  const base = dataBase(getLocalLang());
  let url: string;
  if ("fileBySource" in cat.data) {
    url = `${base}/data/${cat.data.fileBySource(src)}`;
  } else {
    url = `${base}/data/${cat.data.file}`;
  }
  const p = (async () => {
    try {
      const res = await fetch(url, { cache: "default" });
      if (!res.ok) throw new Error(`data fetch failed: ${res.status}`);
      const json = await res.json();
      const arr = (json[cat.data!.key] ?? []) as DataEntry[];
      dataCache.set(ck, arr);
      return arr;
    } catch {
      dataCache.set(ck, []);
      return [];
    } finally {
      dataPending.delete(ck);
    }
  })();
  dataPending.set(ck, p);
  return p;
}

async function findEntryData(entry: Entry): Promise<DataEntry | null> {
  const arr = await loadCategoryData(entry);
  if (arr.length === 0) return null;
  const targetSrc = srcCode(entry.s).toUpperCase();
  const found =
    arr.find(
      (e) =>
        e.ENG_name?.toLowerCase() === entry.n.toLowerCase() &&
        e.source?.toUpperCase() === targetSrc
    ) ??
    arr.find((e) => e.ENG_name?.toLowerCase() === entry.n.toLowerCase()) ??
    null;
  if (!found) return null;
  // 5etools `_copy` inheritance — used heavily by monsterFluff (e.g.
  // "White Dragon" inherits from "Chromatic Dragons" with mods). Without
  // this resolution the entry has no body text. We do a shallow copy:
  // walk the parent in the same file by ENG_name, inherit its entries
  // if our entry lacks them. Mods (_mod) are NOT applied — the parent
  // text is good enough for display.
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
// Render an entry-level string with 5etools tags. Body text gets the
// rich version (clickable .rollable spans for {@dice}, {@damage},
// {@hit}, {@d20}, {@chance} etc.); the surrounding prose is escaped.
// Use this anywhere the 5etools data is INSIDE a <p>/<li>/<td> — i.e.
// the player will read it as flowing text. For chip headers / name
// labels stay with stripTags + escapeHtml.
function richTags(s: string): string {
  return formatTagsClickable(s);
}

// --- Generic recursive renderer (strings + 5etools structured types) ---
function renderEntries(entries: any[]): string {
  return entries.map(renderEntry).join("");
}
function renderEntry(e: any): string {
  if (e == null) return "";
  // Body strings: use richTags so {@dice} / {@damage} / {@hit} etc.
  // become clickable .rollable spans.
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
  // Body strings inside lists / table cells — clickable too.
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

  // Subtitle: 体型 类型，阵营
  const sz = sizeStr(data.size);
  const ty = typeStr(data.type);
  const al = alignmentStr(data.alignment);
  const sub = [sz, ty].filter(Boolean).join(" ");
  const subLine = al ? `${sub}，${al}` : sub;
  if (subLine) parts.push(`<div class="prev-subtitle">${escapeHtml(subLine)}</div>`);

  // Headline chips (CR/AC/HP/速度)
  parts.push(chipsFor(entry, data));

  // Ability scores grid
  parts.push(renderAbilityGrid(data));

  // Combat summary (saves, skills, resistances, immunities, senses, languages)
  parts.push(renderMonsterSummary(data));

  // Optional flavor entries (some monsters include `entries` for description)
  if (data.entries) parts.push(renderEntries(data.entries));

  // Sections
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
        // e.g. {"resist": ["fire", "cold"], "note": "from nonmagical"}
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
  // Wrap so the bold name and following <p>s read as one block.
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
  // Class list
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
  // Weapon stat line
  const weaponBits: string[] = [];
  if (data.dmg1) weaponBits.push(`${stripTags(String(data.dmg1))} ${dmgTypeStr(data.dmgType)}`);
  if (data.dmg2) weaponBits.push(`双手 ${stripTags(String(data.dmg2))}`);
  if (Array.isArray(data.property) && data.property.length)
    weaponBits.push(`属性：${data.property.map(stripTags).join("、")}`);
  if (data.range) weaponBits.push(`射程：${stripTags(String(data.range))}`);
  if (weaponBits.length)
    parts.push(`<p>${escapeHtml(weaponBits.join("　"))}</p>`);
  // Armor stat
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

// --- Generic helpers (shared by chips & renderers) ---
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

// --- DOM wiring ---
const inputEl = document.getElementById("q") as HTMLInputElement;
const clearEl = document.getElementById("clear") as HTMLButtonElement;
const wrapEl = document.getElementById("wrap") as HTMLDivElement;
const countEl = document.getElementById("count") as HTMLDivElement;
const dropEl = document.getElementById("drop") as HTMLDivElement;
const previewEl = document.getElementById("preview") as HTMLDivElement;

// All filter state lives in suite scene metadata now — read via getState().
let isGM = false;
let currentHits: Entry[] = [];
let kbdActiveIdx = -1;
let pinnedEntry: Entry | null = null;
let lastHoverEntry: Entry | null = null;
let collapsedKeepingQuery = false;

function applyLangPlaceholder() {
  const lang = getLocalLang();
  inputEl.placeholder =
    lang === "zh"
      ? "搜索 5etools…（怪物/法术/物品/职业/种族…）"
      : "Search 5etools… (monsters/spells/items/classes/races…)";
}

// --- Animated resize ---
// OBR.popover.setWidth/setHeight are instant (no built-in tween). We step
// from current → target over ~220ms with easeOutCubic so width/height
// changes feel smooth alongside the CSS opacity fade on .body / .tools.
// A monotonic token cancels in-flight animations when a newer call
// arrives, so rapid expand/collapse toggles never get stuck mid-step.
let currentW = BAR_W_IDLE;
let currentH = BAR_H_IDLE;
let resizeToken = 0;
const RESIZE_DURATION_MS = 220;
const RESIZE_STEPS = 6;

async function animateResize(targetW: number, targetH: number): Promise<void> {
  const myToken = ++resizeToken;
  const startW = currentW;
  const startH = currentH;
  if (startW === targetW && startH === targetH) return;
  const dw = targetW - startW;
  const dh = targetH - startH;
  for (let i = 1; i <= RESIZE_STEPS; i++) {
    if (myToken !== resizeToken) return;
    const t = i / RESIZE_STEPS;
    const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const w = Math.round(startW + dw * ease);
    const h = Math.round(startH + dh * ease);
    currentW = w;
    currentH = h;
    try {
      await Promise.all([
        OBR.popover.setWidth(POPOVER_ID, w),
        OBR.popover.setHeight(POPOVER_ID, h),
      ]);
    } catch {}
    if (i < RESIZE_STEPS) {
      await new Promise((r) => setTimeout(r, RESIZE_DURATION_MS / RESIZE_STEPS));
    }
  }
}

async function setExpanded(expanded: boolean) {
  await animateResize(
    expanded ? BAR_W_OPEN : BAR_W_IDLE,
    expanded ? BAR_H_OPEN : BAR_H_IDLE
  );
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
    // Edition badge color for the 4 core books only.
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
    // Keep focus on input when clicking — avoids losing it to body/row.
    row.addEventListener("mousedown", (e) => e.preventDefault());
  });
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

  // Make sure books data is loaded for the source-name lookup.
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

  // Dispatch by category
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
    // Generic: chips + entries
    const body = data.entries ? renderEntries(data.entries) : "";
    bodyEl.innerHTML = chipsFor(entry, data) + body;
  }
}

// Adventures / books carry only a manifest (chapters / appendices /
// covers / level range). The actual prose lives in `book/<ID>.json` /
// `adventure/<ID>.json` files which we don't fetch here. Render a
// readable chapter list + level/author meta so the entry isn't blank.
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

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Re-runs the search using the current input value + state without
// changing the visual collapsed/expanded state. Called from input events
// (which already drive expand on their own) and from suite state changes
// (which must NOT pop the panel back open).
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
  // Typing always expands — conscious user action.
  collapsedKeepingQuery = false;
  wrapEl.classList.remove("collapsed");
  await setExpanded(true);
  await runSearch(q);
}

// Re-filter without forcing the panel open. Used when suite settings
// change (language/dataVersion/allowPlayerMonsters) and the panel is in
// any state — including collapsed-with-query.
function refilter() {
  const q = inputEl.value.trim();
  if (!q) return;
  runSearch(q);
}

// Delegated click for any 5etools rollable tag inside the search
// preview pane. Fires a quick-roll using the player's current
// selection (if any) as the dice anchor.
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

// Cluster's inline search input broadcasts every keystroke here. We
// mirror it into our own (now hidden) input field and run the same
// debounced query pipeline. The input row in this iframe is hidden
// via CSS — typing in cluster IS typing here, conceptually.
const BC_SEARCH_QUERY = "com.obr-suite/search-query";
OBR.onReady(() => {
  OBR.broadcast.onMessage(BC_SEARCH_QUERY, (event) => {
    const q = (event.data as { q?: string } | undefined)?.q ?? "";
    inputEl.value = q;
    if (debounceTimer) clearTimeout(debounceTimer);
    onQueryChange(q).catch(() => {});
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
  // Iframe lost focus entirely (user clicked outside our popover, e.g. the
  // OBR map). Collapse visuals but keep input value + cached results so
  // re-clicking the input restores the panel instantly.
  if (wrapEl.classList.contains("has-q") && !collapsedKeepingQuery) {
    collapsedKeepingQuery = true;
    wrapEl.classList.add("collapsed");
    setExpanded(false).catch(() => {});
  }
});

// Re-expand on a deliberate user action: a real keystroke (printable key
// or backspace/delete) OR a real `click` (mouse-down + mouse-up on the
// input). `click` does NOT fire from programmatic focus, pointer drift
// while dragging a token across the bar, or popover-induced focus
// shuffling — so monsters being spawned and tokens being moved no
// longer wake the panel up.
function userExpand() {
  ensureDataLoad();
  if (collapsedKeepingQuery && inputEl.value) {
    collapsedKeepingQuery = false;
    wrapEl.classList.remove("collapsed");
    setExpanded(true).catch(() => {});
  }
}
inputEl.addEventListener("keydown", (e) => {
  if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") {
    userExpand();
  }
});
// Clicking the input row (input itself or the row container) is a real
// user action — wake the panel and start lazy-loading data so by the
// time they type the index is in flight.
inputEl.addEventListener("click", () => userExpand());
const rowEl = document.getElementById("row") as HTMLDivElement | null;
rowEl?.addEventListener("click", () => userExpand());

// Lazy data load: index + books are NOT preloaded. They start fetching
// the first time the user clicks the input or types a key. By the time
// they finish typing the first character, the index is usually ready.
let dataLoadStarted = false;
function ensureDataLoad() {
  if (dataLoadStarted) return;
  dataLoadStarted = true;
  loadIndex().catch(() => {});
  loadBooks().catch(() => {});
}

OBR.onReady(async () => {
  try {
    const role = await OBR.player.getRole();
    isGM = role === "GM";
  } catch {}

  // Subscribe to suite scene state — dataVersion / allowPlayerMonsters
  // changes from the Settings panel re-trigger filtering. refilter()
  // no longer forces the panel open, so silent updates while the bar is
  // collapsed-with-query stay silent.
  startSceneSync();
  applyLangPlaceholder();
  onStateChange(() => {
    if (inputEl.value) refilter();
  });
  // Per-client language change (localStorage): update placeholder + rerun
  // search since result ranking depends on language.
  onLangChange(() => {
    applyLangPlaceholder();
    if (inputEl.value) refilter();
  });
});
