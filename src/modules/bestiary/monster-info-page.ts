import OBR from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "../../utils/debugOverlay";
import { ICONS } from "../../icons";
import { formatTagsClickable, resolveClickRollTarget } from "../dice/tags";
import { bindRollableContextMenu, bindRollableClickPopup } from "../dice/context-menu";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import { bindPanelDrag } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import {
  parseStatInput,
  readBubbles,
  patchBubbles,
  clampStat,
  type BubblesData,
} from "../../utils/statEdit";
import { mountResourcePanel } from "../resourceTracker/panel";
import { getLocalLang, onLangChange } from "../../state";

// 2026-05-10: language-aware section titles, ability labels, save /
// check labels, etc. Foreign players using the kiwee Chinese mirror
// were stuck seeing Chinese chrome around the Chinese-prose entries;
// labels at least are now in their language. The actual prose stays
// in whatever language the data-source ships.
let _curLang: "zh" | "en" = (() => {
  try { return (getLocalLang() as "zh" | "en") ?? "zh"; } catch { return "zh"; }
})();

// 2026-05-10: pin-panel feature for monster-info (mirror of cc-info).
const LS_MONSTER_INFO_PINNED = "obr-suite/monster-info-pinned";
const BC_MONSTER_INFO_PIN_CHANGED = "com.obr-suite/monster-info-pin-changed";

function readMonsterInfoPinned(): boolean {
  try { return localStorage.getItem(LS_MONSTER_INFO_PINNED) === "1"; } catch { return false; }
}

function toggleMonsterInfoPinned(): void {
  const next = !readMonsterInfoPinned();
  try { localStorage.setItem(LS_MONSTER_INFO_PINNED, next ? "1" : "0"); } catch {}
  try {
    OBR.broadcast.sendMessage(
      BC_MONSTER_INFO_PIN_CHANGED,
      { pinned: next },
      { destination: "LOCAL" },
    );
  } catch {}
  const btn = document.querySelector<HTMLButtonElement>("#panel-pin-btn");
  if (btn) {
    btn.classList.toggle("pinned", next);
    btn.setAttribute("aria-pressed", String(next));
    btn.title = next ? "已置顶（取消则恢复随选择关闭）" : "置顶面板（取消选中也保持显示）";
  }
}

// Token id paired with the currently-shown monster slug. Updated when
// the SHOW_MSG broadcast fires (DM selects a different bestiary token).
// Drives where the editable HP/AC stat rows write to.
let currentItemId: string | null = null;
// Latest bubbles snapshot for the current token, refreshed on every
// render and after each commit. Lets stat-row inputs revert cleanly on
// invalid input.
let liveBubbles: BubblesData = {};

const SHOW_MSG = "com.bestiary/info-show";
const BESTIARY_DATA_KEY = "com.bestiary/monsters";
const DEFAULT_BASE = "https://5e.kiwee.top";

// Read enabled-library bases from suite state at call time. Same
// pattern as bestiary/data.ts — falls back to the kiwee mirror
// when state isn't populated yet.
function getBases(): string[] {
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

// Index cache is per-base now; a custom Cloudflare lib has its own
// `bestiary/index.json` that may list different sources than kiwee.
const indexCacheByBase = new Map<string, Record<string, string>>();
async function loadBestiaryIndexFor(base: string): Promise<Record<string, string>> {
  const cached = indexCacheByBase.get(base);
  if (cached) return cached;
  try {
    const res = await fetch(`${base}/data/bestiary/index.json`, { cache: "no-cache" });
    if (!res.ok) {
      indexCacheByBase.set(base, {});
      return {};
    }
    const idx = (await res.json()) as Record<string, string>;
    indexCacheByBase.set(base, idx);
    return idx;
  } catch {
    indexCacheByBase.set(base, {});
    return {};
  }
}

// File cache key: `${base}|${filename}` so the same source from
// different libraries doesn't collide.
const fileCache = new Map<string, any[]>();
async function fetchMonsterFile(base: string, filename: string): Promise<any[]> {
  const key = `${base}|${filename}`;
  const cached = fileCache.get(key);
  if (cached) return cached;
  try {
    const res = await fetch(`${base}/data/bestiary/${filename}`, { cache: "no-cache" });
    if (!res.ok) {
      fileCache.set(key, []);
      return [];
    }
    const data = await res.json();
    const list = (data.monster || []) as any[];
    fileCache.set(key, list);
    return list;
  } catch {
    fileCache.set(key, []);
    return [];
  }
}

// Walk every enabled library until we find the monster. Custom libs
// usually win because they're narrower; if not found there, falls
// through to kiwee.
async function findMonster(source: string, engName: string): Promise<any | null> {
  for (const base of getBases()) {
    const index = await loadBestiaryIndexFor(base);
    const filename = index[source];
    if (!filename) continue;
    const list = await fetchMonsterFile(base, filename);
    const hit = list.find((x) => (x.ENG_name || x.name) === engName);
    if (hit) return hit;
  }
  return null;
}

// Resolve 5etools _copy by fetching the parent source file and merging. Same
// shape as the panel's resolveCopy but does its own async fetch for fallback.
async function resolveFetchedCopy(m: any, stack: Set<string>): Promise<any> {
  if (!m || !m._copy) return m;
  const pSrc = m._copy.source;
  const pEn = m._copy.ENG_name || m._copy.name;
  const pSlug = `${pSrc}::${pEn}`;
  if (stack.has(pSlug)) return m;
  stack.add(pSlug);
  let parent = await findMonster(pSrc, pEn);
  if (!parent) return m;
  if (parent._copy) parent = await resolveFetchedCopy(parent, stack);
  const merged: any = JSON.parse(JSON.stringify(parent));
  for (const [k, v] of Object.entries(m)) {
    if (k === "_copy" || k === "_mod") continue;
    if (v !== undefined && v !== null) merged[k] = v;
  }
  return merged;
}

// Fetch a monster's raw JSON directly from the 5etools mirror, used as a
// fallback when the scene-metadata shared table doesn't have this slug.
async function fetchMonsterBySlug(slug: string): Promise<any | null> {
  const sep = slug.indexOf("::");
  if (sep === -1) return null;
  const source = slug.slice(0, sep);
  const engName = slug.slice(sep + 2);
  try {
    let m = await findMonster(source, engName);
    if (!m) return null;
    if (m._copy) m = await resolveFetchedCopy(m, new Set());
    return m;
  } catch {
    return null;
  }
}

const root = document.getElementById("root") as HTMLDivElement;

const ABBR: Record<string, string> = {
  str: "力", dex: "敏", con: "体", int: "智", wis: "感", cha: "魅",
};
// Full Chinese ability names for the rolled-dice LABEL text.
const FULL: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ORDER: Array<"str" | "dex" | "con" | "int" | "wis" | "cha"> =
  ["str", "dex", "con", "int", "wis", "cha"];

function escapeHtml(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function renderNameButton(name: string, clickable: boolean): string {
  if (!clickable) {
    return `<div class="name">${escapeHtml(name)}</div>`;
  }
  const title = `点击 → 同步 / 清除 token 名字：${name}`;
  return `<button class="name name-btn" type="button" data-name-text="${escapeHtml(name)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(name)}</button>`;
}

async function toggleTokenNameText(itemId: string, name: string, btn: HTMLButtonElement): Promise<void> {
  const cleanName = name.trim();
  if (!cleanName) return;
  btn.disabled = true;
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    const current = String((items[0] as any)?.text?.plainText ?? "").trim();
    const next = current === cleanName ? "" : cleanName;
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        const anyDraft = d as any;
        anyDraft.text = {
          ...(anyDraft.text ?? {}),
          type: anyDraft.text?.type ?? "PLAIN",
          plainText: next,
        };
      }
    });
  } catch (e) {
    console.warn("[monster-info] toggle token name text failed", e);
  } finally {
    btn.disabled = false;
  }
}

function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

// Strip 5etools inline tags: {@atk mw}, {@hit 5}, {@damage 1d6+3}, etc.
// Keeps the displayed portion (first pipe segment of the payload).
function stripTags(s: string): string {
  return s.replace(/\{@\w+\s+([^{}]+?)\}/g, (_, payload) => {
    const first = String(payload).split("|")[0];
    return first;
  });
}

// Flatten 5etools entries to a string. KEEPS the original {@tag ...}
// tokens intact so the caller can decide between rich (clickable) or
// plain (stripped) rendering. Use stripTags() afterwards for plain
// text fields, formatTagsClickable() for body prose where {@dice} /
// {@damage} / {@hit} should become rollable.
function flattenEntries(entries: any): string {
  if (entries == null) return "";
  if (typeof entries === "string") return entries;
  if (typeof entries === "number" || typeof entries === "boolean") return String(entries);
  if (Array.isArray(entries)) return entries.map(flattenEntries).filter(Boolean).join(" ");
  if (typeof entries === "object") {
    // common 5etools shapes
    if (entries.entries) return flattenEntries(entries.entries);
    if (entries.items) return flattenEntries(entries.items);
    if (entries.text) return flattenEntries(entries.text);
    return "";
  }
  return "";
}

function parseAc(ac: any): string {
  if (!ac || !Array.isArray(ac) || ac.length === 0) return "?";
  const first = ac[0];
  if (typeof first === "number") return String(first);
  if (typeof first === "object" && "ac" in first) return String(first.ac);
  return "?";
}

function parseHp(hp: any): string {
  if (!hp) return "?";
  if (typeof hp === "number") return String(hp);
  if (typeof hp === "object") {
    if (typeof hp.average === "number") return String(hp.average);
    // Homebrew / custom bestiary may use `{ special: "96" }` instead
    // of the standard `{ average, formula }` shape — surface that
    // value as-is so it still reads correctly in the panel.
    if (typeof hp.special === "number") return String(hp.special);
    if (typeof hp.special === "string") return hp.special;
    return "?";
  }
  return "?";
}

/** Numeric HP for live-stat overrides (bubble bars, max HP). Same
 *  spec coverage as `parseHp` but always returns a number. */
function hpToNumber(hp: any): number | null {
  if (typeof hp === "number") return hp;
  if (hp && typeof hp === "object") {
    if (typeof hp.average === "number") return hp.average;
    if (typeof hp.special === "number") return hp.special;
    if (typeof hp.special === "string") {
      const n = parseInt(hp.special, 10);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

// Returns a list of speed segments, one per movement type. The caller renders
// each as its own line so a monster with walk/fly/swim shows three lines.
function parseSpeedParts(speed: any): string[] {
  if (!speed) return ["?"];
  if (typeof speed === "number") return [`${speed}尺`];
  if (typeof speed !== "object") return ["?"];
  const v = (x: any) => typeof x === "number" ? x : (x?.number ?? "?");
  const parts: string[] = [];
  if (speed.walk != null) parts.push(`${v(speed.walk)}尺`);
  if (speed.fly != null) parts.push(`飞${v(speed.fly)}`);
  if (speed.swim != null) parts.push(`泳${v(speed.swim)}`);
  if (speed.climb != null) parts.push(`攀${v(speed.climb)}`);
  if (speed.burrow != null) parts.push(`掘${v(speed.burrow)}`);
  return parts.length ? parts : ["?"];
}

// 5etools-cn skill keys are sometimes English (acrobatics) and
// sometimes Chinese (特技). The map covers the English keys; pass
// any other key through unchanged so partially-localised data still
// renders something sensible.
const SKILL_CN: Record<string, string> = {
  acrobatics: "特技", "animal handling": "驯兽", arcana: "奥秘",
  athletics: "运动", deception: "欺瞒", history: "历史",
  insight: "洞悉", intimidation: "威吓", investigation: "调查",
  medicine: "医药", nature: "自然", perception: "察觉",
  performance: "表演", persuasion: "游说", religion: "宗教",
  "sleight of hand": "巧手", stealth: "隐匿", survival: "求生",
};
// 2026-05-10: English skill labels for the en-language path. Same keys
// as 5etools' canonical lower-case skill names so unhandled niche
// skills (e.g. variant rules) still pass through.
const SKILL_EN: Record<string, string> = {
  acrobatics: "Acrobatics", "animal handling": "Animal Handling",
  arcana: "Arcana", athletics: "Athletics", deception: "Deception",
  history: "History", insight: "Insight", intimidation: "Intimidation",
  investigation: "Investigation", medicine: "Medicine", nature: "Nature",
  perception: "Perception", performance: "Performance", persuasion: "Persuasion",
  religion: "Religion", "sleight of hand": "Sleight of Hand",
  stealth: "Stealth", survival: "Survival",
};
function skillLabel(key: string, lang: "zh" | "en"): string {
  return (lang === "en" ? SKILL_EN[key] : SKILL_CN[key]) ?? key;
}
// Skill value (e.g. "+5", "5", 5) → numeric bonus.
function parseSkillBonus(v: any): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = /([+-]?\s*\d+)/.exec(v);
    if (m) return parseInt(m[1].replace(/\s+/g, ""), 10);
  }
  return null;
}

// Returns HTML directly — each skill is wrapped in a `.rollable` span
// so left-click fires the existing 1d20+bonus check (same delegated
// listener on root that ability checks use). Right-click opens the
// shared rollable context menu (优势 / 劣势 / 暗骰 / 加入骰盘).
function formatSkillList(skill: any): string {
  if (!skill || typeof skill !== "object") return "";
  // 2026-05-10 i18n — both the skill name AND the trailing "Check" /
  // "检定" suffix swap to match user language.
  const en = _curLang === "en";
  const checkSfx = en ? " Check" : "检定";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(skill)) {
    const lbl = skillLabel(k.toLowerCase(), _curLang);
    const bn = parseSkillBonus(v);
    if (bn == null) {
      parts.push(`${escapeHtml(lbl)} ${escapeHtml(String(v))}`);
      continue;
    }
    const expr = `1d20${bn >= 0 ? `+${bn}` : bn}`;
    const rollLbl = `${lbl}${checkSfx}`;
    const display = `${escapeHtml(lbl)} ${bn >= 0 ? "+" : ""}${bn}`;
    parts.push(
      `<span class="rollable skill-roll" data-expr="${escapeHtml(expr)}" data-label="${escapeHtml(rollLbl)}" title="${escapeHtml(rollLbl)} ${escapeHtml(expr)}">${display}</span>`,
    );
  }
  return parts.join(en ? ", " : "、");
}
function formatList(value: any): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  if (typeof value === "string") return value;
  return "";
}
// Damage resist / immune / vulnerable arrays may contain plain
// strings ("fire") or condition-bracketed objects
// ({ resist: ["fire"], note: "from non-magical attacks" }).
// Flatten both shapes to a single human-readable comma list.
function formatDmgList(arr: any): string {
  if (!Array.isArray(arr)) return "";
  return arr.map((x: any) => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object") {
      const inner = x.resist || x.immune || x.vulnerable || x.special || [];
      const innerStr = Array.isArray(inner)
        ? inner.map((y: any) => typeof y === "string" ? y : (y?.name ?? "")).filter(Boolean).join("、")
        : "";
      const note = x.note || x.cond || "";
      const pre = x.preNote || "";
      return [pre, innerStr, note].filter(Boolean).join(" ");
    }
    return "";
  }).filter(Boolean).join("、");
}

function parseType(type: any): string {
  if (!type) return "?";
  if (typeof type === "string") return type;
  if (typeof type === "object") {
    const t = typeof type.type === "string" ? type.type : "";
    return t || "?";
  }
  return "?";
}

function parseSizeStr(size: any): string {
  if (!size) return "?";
  const arr = Array.isArray(size) ? size : [size];
  const code = String(arr[0] || "").toUpperCase();
  const map: Record<string, string> = { T: "超小", S: "小", M: "中", L: "大", H: "巨", G: "超巨" };
  return map[code] || code || "?";
}

// --- Section renderers for spellcasting + legendary preamble ---

/** Strip HTML tags from a snippet to get the plain spell name we
 *  feed into the global search broadcast. Cheap regex — the only
 *  HTML formatTagsClickable produces is `<span class="rollable">` /
 *  text-format spans, none of them nested. */
function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

function renderSpellList(arr: any): string {
  if (!Array.isArray(arr)) return "";
  // Each spell name is wrapped in a `.spell-chip` so clicking it
  // broadcasts BC_SEARCH_QUERY to open the global search popup
  // pre-filled with the spell name. formatTagsClickable still
  // handles inline {@dice}/{@damage} tags inside spell-name strings
  // (rare, e.g. "Magic Missile {@damage 1d4+1}"), but we wrap the
  // whole formatted result in the chip so the chip fires search and
  // any nested .rollable inside fires its own roll first (closest()
  // resolves to the most-specific match).
  return arr.map((s) => {
    const display = formatTagsClickable(String(s));
    const cleanName = stripHtmlTags(display);
    if (!cleanName) return "";
    return `<span class="spell-chip" data-q="${escapeHtml(cleanName)}" title="点击搜索: ${escapeHtml(cleanName)}">${display}</span>`;
  }).filter(Boolean).join("、");
}

function renderSpellLevels(spells: any): string {
  if (!spells || typeof spells !== "object") return "";
  const levels = Object.keys(spells).sort((a, b) => Number(a) - Number(b));
  return levels.map((lv) => {
    const slot = spells[lv];
    if (!slot) return "";
    const label = lv === "0" ? "戏法" : `${lv}环`;
    const slotInfo = typeof slot.slots === "number" ? ` (${slot.slots}次)` : "";
    const sp = renderSpellList(slot.spells);
    if (!sp) return "";
    return `<div class="spell-line"><span class="sl">${label}${slotInfo}</span>${sp}</div>`;
  }).filter(Boolean).join("");
}

function renderSpellDaily(daily: any): string {
  if (!daily || typeof daily !== "object") return "";
  return Object.entries(daily).map(([k, v]) => {
    const label = k.endsWith("e") ? `${k.slice(0, -1)}次/日（每个）` : `${k}次/日`;
    const sp = renderSpellList(v);
    if (!sp) return "";
    return `<div class="spell-line"><span class="sl">${label}</span>${sp}</div>`;
  }).filter(Boolean).join("");
}

function renderSpellGroup(label: string, arr: any): string {
  const sp = renderSpellList(arr);
  if (!sp) return "";
  return `<div class="spell-line"><span class="sl">${label}</span>${sp}</div>`;
}

function renderSpellcasting(sc: any): string {
  if (!Array.isArray(sc) || sc.length === 0) return "";
  const en = _curLang === "en";
  const blocks = sc.map((entry: any) => {
    const name = entry.name || (en ? "Spellcasting" : "施法");
    const header = flattenEntries(entry.headerEntries);
    const leveled = renderSpellLevels(entry.spells);
    const will = renderSpellGroup(en ? "At Will" : "随意", entry.will);
    const daily = renderSpellDaily(entry.daily);
    const rest = renderSpellGroup(en ? "Short Rest" : "短休回复", entry.rest);
    return `<div class="act spell">
      <div class="sc-hdr"><span class="n">${escapeHtml(name)}</span></div>
      ${header ? `<div class="t">${formatTagsClickable(header)}</div>` : ""}
      ${will}${daily}${rest}${leveled}
    </div>`;
  });
  return `<div class="sect">${ICONS.sparkles} ${en ? "Spellcasting" : "施法"}</div>${blocks.join("")}`;
}

function renderLegendary(m: any, displayName: string): string {
  const items = m.legendary;
  if (!Array.isArray(items) || items.length === 0) return "";
  const en = _curLang === "en";
  const headerText = Array.isArray(m.legendaryHeader)
    ? flattenEntries(m.legendaryHeader)
    : (en
        ? `${displayName} can take ${m.legendaryActions ?? 3} legendary actions, choosing from the options below. Only one can be used at a time and only at the end of another creature's turn. Spent legendary actions are regained at the start of ${displayName}'s turn.`
        : `${displayName}可进行 ${m.legendaryActions ?? 3} 个传奇动作，从下列选项中选择。同时只能使用一项，且只能在其他生物的回合结束时进行。${displayName}的每回合开始时，用完的传奇动作次数会重置。`);
  const rows = items.map((a: any) => {
    const n = a.name || "?";
    const t = flattenEntries(a.entries);
    return `<div class="act legendary"><span class="n">${formatTagsClickable(n)}</span><span class="t">${formatTagsClickable(t)}</span></div>`;
  }).join("");
  return `<div class="sect">${ICONS.star} ${en ? "Legendary Actions" : "传奇动作"}</div><div class="preamble">${formatTagsClickable(headerText)}</div>${rows}`;
}

let currentSlug: string | null = null;

const INFO_POPOVER_ID = "com.bestiary/info";
const INFO_MIN_HEIGHT = 120;
// Captured once at OBR.onReady, before any setHeight. This is the popover's
// opened height (from background.ts) and acts as our ceiling — we only ever
// shrink below it, never grow past it. Long content keeps the scrollbar.
let INFO_MAX_HEIGHT = 340;

// Role state — used to suppress DM-only affordances when the popover is
// open for a player (allowPlayerMonsters in suite settings).
let isGMRole = false;
function applyRoleGating() {
  // Stat inputs become read-only for non-GM. The lock button is
  // hidden via CSS based on the body class.
  document.body.classList.toggle("is-gm", isGMRole);
  document.body.classList.toggle("is-player", !isGMRole);
  root.querySelectorAll<HTMLInputElement>(".stat-input").forEach((el) => {
    el.readOnly = !isGMRole;
    if (!isGMRole) {
      el.title = "玩家端只读";
    }
  });
  root.querySelectorAll<HTMLButtonElement>(".stat-lock").forEach((el) => {
    el.style.display = isGMRole ? "" : "none";
  });
}

// After rendering, shrink the popover height to fit short content. Never
// grows beyond the initial opened height — long content stays scrollable.
async function adjustHeight() {
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const contentH = root.scrollHeight;
  if (!contentH) return;
  const target = Math.max(INFO_MIN_HEIGHT, Math.min(contentH + 4, INFO_MAX_HEIGHT));
  try {
    await OBR.popover.setHeight(INFO_POPOVER_ID, target);
  } catch {}
}

function render(m: any) {
  // 2026-05-10: snapshot language at the top of every render so all
  // i18n branches see the same value, even if the user flips lang
  // mid-render via a broadcast (would otherwise produce mixed-lang
  // output for the same monster).
  const en = _curLang === "en";
  const name = m.name || "???";
  const eng = m.ENG_name || "";
  const cr = m.cr?.cr ?? m.cr ?? "?";
  const size = parseSizeStr(m.size);
  const type = parseType(m.type);
  const sub = [size, type, eng].filter(Boolean).join(" · ");

  const hp = parseHp(m.hp);
  const ac = parseAc(m.ac);
  const speedLines = parseSpeedParts(m.speed)
    .map((s) => `<div>${escapeHtml(s)}</div>`)
    .join("");

  // Fall back to the static monster data when no token is selected
  // (rare — the popover is auto-opened on selection so currentItemId
  // is usually present). Live values override the monster's default
  // HP / max HP / AC so the panel matches the bubbles bar.
  const liveHp = typeof liveBubbles.health === "number"
    ? liveBubbles.health
    : hpToNumber(m.hp);
  const liveMaxHp = typeof liveBubbles["max health"] === "number"
    ? liveBubbles["max health"]
    : hpToNumber(m.hp);
  const liveTempHp = typeof liveBubbles["temporary health"] === "number"
    ? liveBubbles["temporary health"]
    : 0;
  const liveAc = typeof liveBubbles["armor class"] === "number"
    ? liveBubbles["armor class"]
    : (() => {
        // Pull a numeric default from the static AC string if possible.
        const acMatch = /(\d+)/.exec(String(ac));
        return acMatch ? parseInt(acMatch[1], 10) : 10;
      })();

  // Stat banner — single-row HP red pill + temp pink circle + AC
  // heater shield. Mirrors cc-info layout. Editable in place; commits
  // patch the bound token's bubbles metadata so the bar above the
  // token redraws live.
  // HP fill ratio for the pill's mask — 1 = full, 0 = empty. Falls
   // back to 1 when maxHp is missing/0 so the bar reads as a solid
   // red pill (legacy look) instead of an empty dark slot.
  const hpRatio = (typeof liveHp === "number" && typeof liveMaxHp === "number" && liveMaxHp > 0)
    ? Math.max(0, Math.min(1, liveHp / liveMaxHp))
    : 1;
  const statBanner = currentItemId ? `
    <div class="stat-banner">
      <div class="hp-pill" style="--hp-ratio: ${hpRatio.toFixed(3)}">
        <span class="stat-cell">
          <span class="prev-hint" data-prev></span>
          <input class="stat-input" type="text" inputmode="numeric"
                 data-field="health" value="${escapeHtml(String(liveHp ?? ""))}"
                 title="支持 20 / +5 / -3 / 15+5">
        </span>
        <span class="slash">/</span>
        <span class="stat-cell">
          <span class="prev-hint" data-prev></span>
          <input class="stat-input" type="text" inputmode="numeric"
                 data-field="max health" value="${escapeHtml(String(liveMaxHp ?? ""))}"
                 title="支持 20 / +5 / -3 / 15+5">
        </span>
      </div>
      <div class="temp-pill stat-cell">
        <span class="prev-hint" data-prev></span>
        <input class="stat-input" type="text" inputmode="numeric"
               data-field="temporary health" value="${escapeHtml(String(liveTempHp))}"
               title="支持 20 / +5 / -3 / 15+5">
      </div>
      <div class="ac-pill stat-cell">
        <span class="prev-hint" data-prev></span>
        <input class="stat-input" type="text" inputmode="numeric"
               data-field="armor class" value="${escapeHtml(String(liveAc))}"
               title="支持 20 / +5 / -3 / 15+5">
      </div>
      ${renderLockButton(liveBubbles.locked !== false)}
    </div>
  ` : "";

  // Compact CR / speed chips (HP & AC moved into stat-rows above).
  const chips = `
    <div class="chip cr"><span class="k">CR</span><span class="v">${escapeHtml(cr)}</span></div>
    <div class="chip speed"><span class="k">速度</span><span class="v">${speedLines}</span></div>
  `;

  // Meta block — skills, senses, languages, damage resistances /
  // immunities / vulnerabilities, condition immunities. Each row
  // skipped when its data is missing, so a goblin shows a tight
  // 2-row block while an ancient dragon shows a full 7-row table.
  const skillsStr = formatSkillList(m.skill);
  const sensesStr = formatList(m.senses);
  // 5etools attaches passive perception separately on most entries;
  // append it inline behind the senses list when present.
  const passiveLabel = en ? "Passive Perception" : "被动察觉";
  const passive = typeof m.passive === "number" ? `${passiveLabel} ${m.passive}` : "";
  const sensesFull = [sensesStr, passive].filter(Boolean).join(en ? ", " : "、");
  const languagesStr = formatList(m.languages);
  const resistStr = formatDmgList(m.resist);
  const immuneStr = formatDmgList(m.immune);
  const vulnerableStr = formatDmgList(m.vulnerable);
  const condImmuneStr = formatDmgList(m.conditionImmune);
  const metaRow = (label: string, value: string, raw = false) =>
    value
      ? `<div class="meta-row"><span class="meta-l">${label}</span><span class="meta-v">${raw ? value : formatTagsClickable(value)}</span></div>`
      : "";
  const metaLabels = en
    ? { skills: "Skills", senses: "Senses", languages: "Languages",
        resist: "Resistances", immune: "Immunities",
        vuln: "Vulnerabilities", condImmune: "Condition Immunities" }
    : { skills: "技能", senses: "感知", languages: "语言",
        resist: "抗性", immune: "免疫", vuln: "易伤",
        condImmune: "状态免疫" };
  const meta = [
    // Skills row already contains finalized HTML (`.rollable` spans
    // wrapped in formatSkillList) — pass `raw=true` so it isn't
    // re-escaped by formatTagsClickable.
    metaRow(metaLabels.skills, skillsStr, true),
    metaRow(metaLabels.senses, sensesFull),
    metaRow(metaLabels.languages, languagesStr),
    metaRow(metaLabels.resist, resistStr),
    metaRow(metaLabels.immune, immuneStr),
    metaRow(metaLabels.vuln, vulnerableStr),
    metaRow(metaLabels.condImmune, condImmuneStr),
  ].filter(Boolean).join("");
  const metaBlock = meta ? `<div class="meta">${meta}</div>` : "";

  // statBanner stays ABOVE the tab strip — name + HP / AC must remain
  // visible regardless of which tab is active.
  // 2026-05-13 — resource-tracker tabs graduated from dev to stable;
  // no longer gated on STABLE_HIDES.
  const stickyTop = `${statBanner}${renderTabStrip()}`;

  const saves = m.save || {};
  const monsterName = stripTags(m.name ?? m.ENG_name ?? (en ? "Monster" : "怪物"));
  // 2026-05-10 i18n — ability abbreviations + check / save labels.
  const ABBR_FOR_LANG: Record<string, string> = en
    ? { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" }
    : ABBR;
  const FULL_FOR_LANG: Record<string, string> = en
    ? { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" }
    : FULL;
  const checkSuffix = en ? " Check" : "检定";
  const saveSuffix = en ? " Save" : "豁免";
  const abl = ORDER
    .map((k) => {
      const score = typeof m[k] === "number" ? m[k] : 10;
      const isProf = saves[k] !== undefined;
      const aMod = mod(score);
      // Ability check: 1d20+modifier
      const aExpr = `1d20${aMod >= 0 ? `+${aMod}` : aMod}`;
      const aLbl = `${FULL_FOR_LANG[k] ?? ABBR_FOR_LANG[k]}${checkSuffix}`;
      // Saving throw — for proficient saves, m.save[k] holds the bonus
      // string ("+5" / "5"). Otherwise it's the same as the modifier.
      const saveBonusRaw = saves[k];
      let saveBn = aMod;
      if (typeof saveBonusRaw === "string") {
        const m2 = /([+-]?\s*\d+)/.exec(saveBonusRaw);
        if (m2) saveBn = parseInt(m2[1].replace(/\s+/g, ""), 10);
      } else if (typeof saveBonusRaw === "number") {
        saveBn = saveBonusRaw;
      }
      const saveExpr = `1d20${saveBn >= 0 ? `+${saveBn}` : saveBn}`;
      const saveLbl = `${FULL_FOR_LANG[k] ?? ABBR_FOR_LANG[k]}${saveSuffix}`;
      return `<div class="abl${isProf ? " prof" : ""}">
        <span class="a rollable" data-expr="${saveExpr}" data-label="${escapeHtml(saveLbl)}" title="${escapeHtml(saveLbl)} ${saveExpr}">${ABBR_FOR_LANG[k]}</span>
        <span class="t">${score}</span>
        <span class="m rollable" data-expr="${aExpr}" data-label="${escapeHtml(aLbl)}" title="${escapeHtml(aLbl)} ${aExpr}">${fmtMod(aMod)}</span>
      </div>`;
    })
    .join("");

  const sectionHtml = (items: any[] | undefined, cls: string, title: string) => {
    if (!Array.isArray(items) || items.length === 0) return "";
    const rows = items
      .map((a) => {
        const n = a.name || "?";
        const t = flattenEntries(a.entries);
        // Both NAME and BODY get the rich treatment so {@recharge 4} in
        // names ("Whelm {@recharge 4}") and {@hit}/{@damage} in entries
        // all become clickable rollable spans.
        return `<div class="act ${cls}"><span class="n">${formatTagsClickable(n)}</span><span class="t">${formatTagsClickable(t)}</span></div>`;
      })
      .join("");
    return `<div class="sect">${title}</div>${rows}`;
  };

  // 2026-05-10 i18n — section titles + ability/save labels switch on
  // user language. The actual entry prose stays whatever the data
  // source provides (kiwee mirror = Chinese). `en` was captured at
  // the top of render().
  const sectTitles = en
    ? { traits: "Traits", actions: "Actions", bonus: "Bonus Actions",
        reactions: "Reactions" }
    : { traits: "特性", actions: "动作", bonus: "附赠动作", reactions: "反应" };

  const traits = sectionHtml(m.trait, "trait", `${ICONS.sparkle4} ${sectTitles.traits}`);
  const spellcasting = renderSpellcasting(m.spellcasting);
  const actions = sectionHtml(m.action, "", `${ICONS.swords} ${sectTitles.actions}`);
  const bonus = sectionHtml(m.bonus, "bonus", `${ICONS.zap} ${sectTitles.bonus}`);
  const reactions = sectionHtml(m.reaction, "reaction", `${ICONS.shield} ${sectTitles.reactions}`);
  const legendary = renderLegendary(m, name);

  // Combined attribute pane content — chips / abilities / meta /
  // actions etc all in one block. It gets wrapped in a sliding rt-clip
  // alongside the resource pane so switching tabs translates the
  // whole content horizontally. 2026-05-13 — was previously gated on
  // STABLE_HIDES (dev-only); now always on per user request.
  const attrInner = `
    <div class="top">
      <div class="chips">${chips}</div>
      <div class="abil">${abl}</div>
    </div>
    ${metaBlock}
    ${traits}
    ${spellcasting}
    ${actions}
    ${bonus}
    ${reactions}
    ${legendary}
  `;
  const contentBlock = `
    <div class="rt-clip" data-active="${activeRtTab}">
      <div class="rt-pane" data-pane="attr">${attrInner}</div>
      <div class="rt-pane" data-pane="res">
        <div id="rt-mount" style="position:relative; min-height:80px"></div>
      </div>
    </div>
  `;

  // 2026-05-10: pin button — same UX as cc-info. When ON, the
  // monster-info popover stays open after deselect / different-token
  // selection (data still updates when a different bound token is
  // selected). Per-client localStorage key + LOCAL broadcast picked
  // up by bestiary/index.ts.
  const pinned = readMonsterInfoPinned();
  root.innerHTML = `
    <div class="hdr">
      <button class="reset-btn" id="bubbles-reset-btn" type="button"
        title="重置画面血条 — 清缓存重画，修复偶发的位置漂移">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8 a5 5 0 1 0 1.5 -3.5"/>
          <path d="M3.2 3 V5.5 H5.5"/>
        </svg>
      </button>
      <div class="drag-handle" id="drag-handle" title="拖动 / Drag" aria-label="拖动面板">
        <svg viewBox="0 0 12 18" aria-hidden="true">
          <circle cx="3" cy="3" r="1.2" fill="currentColor"/>
          <circle cx="9" cy="3" r="1.2" fill="currentColor"/>
          <circle cx="3" cy="9" r="1.2" fill="currentColor"/>
          <circle cx="9" cy="9" r="1.2" fill="currentColor"/>
          <circle cx="3" cy="15" r="1.2" fill="currentColor"/>
          <circle cx="9" cy="15" r="1.2" fill="currentColor"/>
        </svg>
      </div>
      <button class="panel-pin-btn ${pinned ? "pinned" : ""}" id="panel-pin-btn" type="button"
        aria-pressed="${pinned}"
        title="${pinned ? "已置顶（取消则恢复随选择关闭）" : "置顶面板（取消选中也保持显示）"}">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.339-.016-.484-.041L7.176 13.04a.5.5 0 0 1-.708 0L3.633 10.207 1.4 12.439a.5.5 0 0 1-.707-.707L2.926 9.5.74 7.314a.5.5 0 0 1 0-.708l1.51-1.51c.41-.41.945-.625 1.482-.711.534-.085 1.139-.097 1.683-.024.546.073 1.169.114 1.643-.04.305-.099.62-.281.94-.602.193-.193.282-.467.348-.749.066-.281.117-.572.196-.793a1.51 1.51 0 0 1 .31-.508c.094-.092.215-.174.357-.232a.5.5 0 0 1 .19-.04Z" fill="currentColor"/>
        </svg>
      </button>
      <div class="name-wrap">
        ${renderNameButton(name, !!currentItemId)}
      </div>
      <div class="sub">${escapeHtml(sub)}</div>
    </div>
    ${stickyTop}
    ${contentBlock}
  `;
  // 2026-05-13 — resource-tracker graduated to stable; always set up.
  setupTabSwitching();
  void ensureResourceMount();
  // Re-bind the drag listener — innerHTML reassignment GC's the
  // previous handle node along with its event handlers.
  const handle = root.querySelector<HTMLElement>("#drag-handle");
  if (handle) {
    if (currentMonsterDragUnbind) currentMonsterDragUnbind();
    currentMonsterDragUnbind = bindPanelDrag(handle, PANEL_IDS.bestiaryInfo);
  }
  const pinBtn = root.querySelector<HTMLButtonElement>("#panel-pin-btn");
  if (pinBtn) {
    pinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMonsterInfoPinned();
    });
  }
  // 2026-05-11 — bubble reset button. Broadcasts a LOCAL message to
  // the bubbles bg module which drops the cached entry for the
  // currently-bound token + sweeps every local item it owns, then
  // re-syncs. Fixes the "blood bar drifted off the token" bug.
  const resetBtn = root.querySelector<HTMLButtonElement>("#bubbles-reset-btn");
  if (resetBtn && currentItemId) {
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/bubbles-reset-token",
          { tokenId: currentItemId },
          { destination: "LOCAL" },
        );
      } catch (err) { console.warn("[monster-info] reset broadcast failed", err); }
      resetBtn.classList.add("flash");
      setTimeout(() => resetBtn.classList.remove("flash"), 400);
    });
  }
  bindStatRowInputs();
  const nameBtn = root.querySelector<HTMLButtonElement>(".name-btn[data-name-text]");
  if (nameBtn && currentItemId) {
    nameBtn.addEventListener("click", () => {
      void toggleTokenNameText(currentItemId!, nameBtn.dataset.nameText || name, nameBtn);
    });
  }
  // Re-apply role gating after each render — fresh DOM nodes need
  // their readOnly / display state set.
  applyRoleGating();
}

let currentMonsterDragUnbind: (() => void) | null = null;

// === Resource-tracker tab strip =============================================
//
// A tabbed switcher between the existing attribute view and the new
// resource tracker. The HP / AC stat banner stays above the tabs and
// is never hidden — switching tabs only hides / shows the content
// blocks below.
//
// Hover OR click switches tabs (per user spec: "鼠标进入这些区域会
// 直接平滑切换"). Smooth opacity transition is via CSS, not a true
// crossfade — keeping the cost low so this stays responsive on
// large stat-blocks.

type RtTabId = "attr" | "res";
let activeRtTab: RtTabId = "attr";

function renderTabStrip(): string {
  return `
    <div class="rt-tabstrip">
      <div class="rt-tab-indicator" data-rt-indicator></div>
      <button class="rt-tab ${activeRtTab === "attr" ? "on" : ""}" data-rt-tab="attr" type="button">属性</button>
      <button class="rt-tab ${activeRtTab === "res" ? "on" : ""}" data-rt-tab="res" type="button">资源</button>
    </div>
  `;
}

function setupTabSwitching(): void {
  const strip = root.querySelector<HTMLElement>(".rt-tabstrip");
  const clip = root.querySelector<HTMLElement>(".rt-clip");
  if (!strip) return;
  const buttons = strip.querySelectorAll<HTMLButtonElement>(".rt-tab");
  const indicator = strip.querySelector<HTMLElement>("[data-rt-indicator]");

  // Position-helpers for the sliding tab indicator.
  const moveIndicatorTo = (target: HTMLElement | null) => {
    if (!indicator || !target) return;
    indicator.style.transform = `translateX(${target.offsetLeft}px)`;
    indicator.style.width = `${target.offsetWidth}px`;
  };
  const findActiveButton = (): HTMLElement | null =>
    strip.querySelector<HTMLElement>(`.rt-tab[data-rt-tab="${activeRtTab}"]`);

  // 2026-05-12 — removed the JS-driven inline-height + ResizeObserver.
  // .rt-clip now uses CSS grid (both panes overlap in a single grid
  // cell that sizes naturally to max(active, inactive) height) so we
  // never touch clip.style.height. The earlier round's ResizeObserver
  // was firing on every patchRow's transient subpixel reflow → tiny
  // height changes → CSS height transition → user-perceived flicker
  // on every resource click. Grid kills that loop entirely.
  requestAnimationFrame(() => moveIndicatorTo(findActiveButton()));

  const switchTo = (next: RtTabId) => {
    if (next === activeRtTab) return;
    activeRtTab = next;
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.rtTab === next));
    moveIndicatorTo(findActiveButton());
    // Drive the horizontal slide by flipping the clip's data-active.
    // CSS handles the `transform:translateX` on .rt-pane.
    if (clip) clip.setAttribute("data-active", next);
    if (next === "res") void ensureResourceMount();
  };

  // 2026-05-11b — instant hover switch. Earlier round had a 200 ms
  // debounce on mouseenter (to gate against quick mouse pass-throughs),
  // but the user reported the wait felt sluggish. Switching to
  // immediate fire on mouseenter; quick passes will whiplash the
  // indicator + pane back to the active tab when the mouse leaves,
  // which is acceptable.
  buttons.forEach((b) => {
    const target = (b.dataset.rtTab as RtTabId) ?? "attr";
    b.addEventListener("click", () => switchTo(target));
    b.addEventListener("mouseenter", () => switchTo(target));
  });
}

let resourceMountHandle: { refresh: () => Promise<void>; unmount: () => void } | null = null;
async function ensureResourceMount(): Promise<void> {
  const container = root.querySelector<HTMLElement>("#rt-mount");
  if (!container) return;
  // mount() is idempotent per container — innerHTML overwrites of
  // root rip the previous container DOM, so we always re-create the
  // handle here.
  resourceMountHandle?.unmount();
  resourceMountHandle = mountResourcePanel({
    container,
    getItemId: () => currentItemId,
  });
  await resourceMountHandle.refresh();
}

// DM-only lock button. Bestiary panel is GM-only by definition so we
// always render the button when the popover is open. Closed padlock
// = locked (default — players see no bar in idle, silhouette in
// combat); open padlock = unlocked (everyone sees full HP / AC).
function renderLockButton(locked: boolean): string {
  const titleZh = locked
    ? "已上锁：玩家在战斗准备 / 战斗中只看到血条比例（无数值 / AC）"
    : "已解锁：所有玩家可见完整 HP / AC 数值";
  const lockedAttr = locked ? "true" : "false";
  return `
    <button class="stat-lock" data-locked="${lockedAttr}" title="${escapeHtml(titleZh)}" aria-label="${escapeHtml(titleZh)}" type="button">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" stroke="none"/>
        <path class="lock-shackle" d="M5 7 V5 a3 3 0 0 1 6 0 V7"/>
      </svg>
    </button>
  `;
}

// After a successful patch, refresh all four stat inputs so the user
// sees the actual cross-field-clamped values (typed HP=999 with
// maxHp=20 → input snaps to 20).
//
// `skipFocused` (default true) prevents clobbering the input the user
// is currently editing — relevant when this is called from the
// external-sync items.onChange path. The local-commit path runs after
// the user's blur so no input is focused, but passing true everywhere
// is harmless.
function refreshStatInputs(live: BubblesData, skipFocused = true): void {
  const fields: Array<keyof BubblesData> = [
    "health", "max health", "temporary health", "armor class",
  ];
  for (const f of fields) {
    const v = live[f];
    if (v == null) continue;
    const sel = `.stat-input[data-field="${f}"]`;
    const el = root.querySelector<HTMLInputElement>(sel);
    if (!el) continue;
    if (skipFocused && document.activeElement === el) continue;
    el.value = String(v);
  }
  // Re-paint the HP pill's fill ratio so the masked overlay tracks
  // edits live (without this the pill text updates but the colored
  // fill stays at the previous ratio until re-render).
  const hp = typeof live["health"] === "number" ? (live["health"] as number) : null;
  const maxHp = typeof live["max health"] === "number" ? (live["max health"] as number) : null;
  const ratio = (hp != null && maxHp != null && maxHp > 0)
    ? Math.max(0, Math.min(1, hp / maxHp))
    : 1;
  const pill = root.querySelector<HTMLElement>(".hp-pill");
  if (pill) pill.style.setProperty("--hp-ratio", ratio.toFixed(3));
  // Lock button state — kept in sync so an external `locked` flip
  // (e.g. from the standalone hp-bar's lock button on the same token)
  // updates this panel's icon too.
  const lockBtn = root.querySelector<HTMLButtonElement>(".stat-lock");
  if (lockBtn) {
    const locked = live.locked === undefined ? true : !!live.locked;
    lockBtn.dataset.locked = locked ? "true" : "false";
    lockBtn.title = locked
      ? "已上锁：玩家在战斗准备 / 战斗中只看到血条比例（无数值 / AC）"
      : "已解锁：所有玩家可见完整 HP / AC 数值";
  }
}

// 2026-05-10d — external sync. The standalone hp-bar component (and
// any other writer to the bubbles metadata) writes the same scene-meta
// key this panel reads from, so a items.onChange handler is enough to
// keep them in sync. Re-reads the live snapshot for currentItemId
// and repaints the inputs (skipping any input the user is currently
// editing). Cost: one getItems call per onChange firing — acceptable
// since the listener early-returns when no token is shown and OBR
// itself coalesces rapid metadata changes.
async function syncFromExternal(): Promise<void> {
  if (!currentItemId) return;
  let live: BubblesData = {};
  try { live = await readBubbles(currentItemId); } catch {}
  liveBubbles = { ...liveBubbles, ...live };
  refreshStatInputs(live, /* skipFocused */ true);
}

// Stat-row input wiring — mirrors cc-info's binder but writes to
// whichever token id is currently selected (currentItemId).
function bindStatRowInputs(): void {
  if (!currentItemId) return;
  const lockBtn = root.querySelector<HTMLButtonElement>(".stat-lock");
  if (lockBtn) {
    lockBtn.addEventListener("click", async () => {
      const wasLocked = lockBtn.dataset.locked !== "false";
      const next = !wasLocked;
      lockBtn.dataset.locked = next ? "true" : "false";
      lockBtn.title = next
        ? "已上锁：玩家在战斗准备 / 战斗中只看到血条比例（无数值 / AC）"
        : "已解锁：所有玩家可见完整 HP / AC 数值";
      try {
        await patchBubbles(
          currentItemId!,
          { locked: next } as Partial<BubblesData>,
        );
        liveBubbles = { ...liveBubbles, locked: next };
      } catch (e) {
        console.warn("[monster-info] toggle lock failed", e);
        lockBtn.dataset.locked = wasLocked ? "true" : "false";
      }
    });
  }
  const inputs = root.querySelectorAll<HTMLInputElement>(".stat-input[data-field]");
  inputs.forEach((input) => {
    const field = input.dataset.field as keyof BubblesData | undefined;
    if (!field) return;
    let editStart = input.value;
    const cell = input.closest<HTMLElement>(".stat-cell");
    const prevHint = cell?.querySelector<HTMLElement>(".prev-hint");

    const commit = async () => {
      if (!currentItemId) {
        input.value = editStart;
        return;
      }
      const text = input.value;
      const cur = parseFloat(editStart);
      const parsed = parseStatInput(text, Number.isFinite(cur) ? cur : 0);
      if (parsed == null) {
        input.value = editStart;
        return;
      }
      const next = clampStat(field, parsed);
      try {
        const final = await patchBubbles(
          currentItemId,
          { [field]: next } as Partial<BubblesData>,
        );
        liveBubbles = { ...liveBubbles, ...final };
        refreshStatInputs(final);
        editStart = input.value;
      } catch (e) {
        console.warn("[monster-info] patch bubbles failed", e);
        input.value = editStart;
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = editStart;
        input.blur();
      }
    });
    input.addEventListener("focus", () => {
      editStart = input.value;
      if (prevHint) prevHint.textContent = editStart;
      cell?.classList.add("editing");
      // Clear the input on focus (no blue text-selection rectangle).
      // Empty blur reverts to editStart.
      requestAnimationFrame(() => {
        input.value = "";
      });
    });
    input.addEventListener("blur", () => {
      cell?.classList.remove("editing");
      const text = input.value.trim();
      if (text === "") {
        input.value = editStart;
        return;
      }
      if (text !== editStart) void commit();
    });
  });
}

async function showMonster(slug: string, itemId: string | null = currentItemId) {
  currentSlug = slug;
  currentItemId = itemId;
  // Load the bound token's bubbles snapshot in parallel with monster
  // data — render() reads liveBubbles for the editable HP/AC rows.
  const liveP = itemId ? readBubbles(itemId) : Promise.resolve({} as BubblesData);
  try {
    const [meta, live] = await Promise.all([
      OBR.scene.getMetadata(),
      liveP,
    ]);
    liveBubbles = live;
    const table = (meta[BESTIARY_DATA_KEY] as Record<string, any>) || {};
    let m = table[slug];
    if (!m) m = await fetchMonsterBySlug(slug);
    if (currentSlug !== slug) return;
    if (!m) {
      root.innerHTML = `<div class="err">未找到怪物数据</div>`;
      await adjustHeight();
      return;
    }
    render(m);
    await adjustHeight();
  } catch (e: any) {
    if (currentSlug !== slug) return;
    root.innerHTML = `<div class="err">加载失败：${escapeHtml(e?.message ?? e)}</div>`;
    await adjustHeight();
  }
}

// 2026-05-10 spec change: LEFT click on a .rollable now opens the
// dice quick-pick popup (劣势 / 普通 / 优势 + 重击). The popup is
// installed below via `bindRollableClickPopup`; this in-page click
// handler only deals with .spell-chip clicks, since rollables are
// captured by the popup binder before they bubble here.
root.addEventListener("click", async (e) => {
  // Spell-chip click → broadcast BC_SEARCH_QUERY so the global
  // search popup opens with the spell name pre-filled. Same
  // protocol as the character-card search chips (info-page.ts).
  // Note: a `.rollable` nested INSIDE a `.spell-chip` is handled
  // first by `bindRollableClickPopup`'s capture-phase listener,
  // which calls stopPropagation, so we never reach here for those.
  const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(".spell-chip");
  if (chip) {
    e.preventDefault();
    e.stopPropagation();
    const q = chip.dataset.q ?? "";
    if (q) {
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/search-query",
          { q, autoPin: true },
          { destination: "LOCAL" },
        );
      } catch {}
      // Visual flash so the click registers even when the popup is
      // off-screen / closed.
      chip.classList.remove("spell-chip-flash");
      void chip.offsetWidth;
      chip.classList.add("spell-chip-flash");
    }
    return;
  }
});

// Right-click → context menu (投掷 / 优势 / 劣势 / 添加到骰盘).
// Replaces the previous "right click = open roll" shortcut; the menu's
// 投掷 entry preserves the open-roll path for users who want it.
//
// The bestiary monster-info popover is opened from `bestiary/index.ts`
// with anchorPosition = { left: vw/2, top: INFO_TOP_OFFSET } and
// anchorOrigin = CENTER/TOP. So the iframe's TOP-LEFT in viewport
// pixels is (vw/2 − innerWidth/2, INFO_TOP_OFFSET). INFO_TOP_OFFSET
// is 50 in bestiary/index.ts; pulled in via constant to stay aligned
// if it ever changes.
const INFO_TOP_OFFSET = 60; // matches bestiary/index.ts
const iframeOriginGetter = async () => {
  const vw = await OBR.viewport.getWidth().catch(() => 1280);
  return {
    left: Math.round(vw / 2 - window.innerWidth / 2),
    top: INFO_TOP_OFFSET,
  };
};
bindRollableContextMenu(
  root,
  () => "dark",
  () => resolveClickRollTarget(),
  iframeOriginGetter,
);
// LEFT-click → quick-pick popup (劣势 / 普通 / 优势 + 重击).
bindRollableClickPopup(
  root,
  () => resolveClickRollTarget(),
  iframeOriginGetter,
);

OBR.onReady(async () => {
  installDebugOverlay();
  subscribeToSfx();
  // Capture the popover's opened height as the ceiling for future resizes.
  if (window.innerHeight > 0) INFO_MAX_HEIGHT = window.innerHeight;

  // 2026-05-10: re-render on language flip so labels (section titles,
  // ability abbreviations, "Hit:" / "Save:" / "Recharge" prefixes)
  // swap without requiring the user to reselect the monster.
  onLangChange((next) => {
    const norm: "zh" | "en" = next === "en" ? "en" : "zh";
    if (norm === _curLang) return;
    _curLang = norm;
    if (currentSlug) {
      const slug = currentSlug;
      // Re-fire showMonster — looks the slug up again from cache /
      // fetch and runs render(m), which reads _curLang at the top.
      showMonster(slug, currentItemId);
    }
  });

  // Determine role early — when player + allowPlayerMonsters is on
  // the popover renders for them too, but with edit affordances
  // suppressed (HP / AC inputs become read-only, lock button hidden).
  // applyRoleGating() fires once at startup and again on player
  // change so a role flip during the session reflects immediately.
  try { isGMRole = (await OBR.player.getRole()) === "GM"; } catch {}
  applyRoleGating();
  OBR.player.onChange((p) => {
    const next = p.role === "GM";
    if (next !== isGMRole) {
      isGMRole = next;
      applyRoleGating();
    }
  });

  // Initial slug + itemId from URL — popover is opened on-demand with
  // both in the query string. While popover stays open, background
  // broadcasts in-place swaps when the DM selects a different
  // monster (or a different token bound to the same monster type).
  try {
    const params = new URLSearchParams(location.search);
    const slug = params.get("slug");
    const itemId = params.get("itemId");
    if (slug) showMonster(slug, itemId);
  } catch {}

  OBR.broadcast.onMessage(SHOW_MSG, (ev: any) => {
    const p = ev?.data || {};
    if (!p.slug) return;
    const slug = String(p.slug);
    const itemId = typeof p.itemId === "string" ? p.itemId : null;
    // 2026-05-12 — iframe-side dedupe. If the bg's selection
    // handler races itself (e.g. fires twice during one updateItems
    // transaction) it broadcasts SHOW_MSG twice with identical
    // payloads. Without this guard the second one rebuilds the
    // whole popover innerHTML (visible flicker, tab indicator
    // animation replay). Lang changes go through a separate
    // onLangChange path, so dedupe by slug+itemId here is safe.
    if (slug === currentSlug && itemId === currentItemId && root.childElementCount > 0) {
      return;
    }
    showMonster(slug, itemId);
  });

  // 2026-05-10d — items.onChange sync. Keeps the HP / AC / lock
  // inputs in step with external writers (the standalone hp-bar
  // component, the bubbles plugin's own field updates, anything that
  // writes the same `com.obr-suite/bubbles/data` key). Was missing
  // before — user reported "改独立血条组件时怪物面板没有变化" /
  // "edits to the standalone bar didn't propagate back here".
  // Local commits go through patchBubbles and call refreshStatInputs
  // synchronously already, so they're not double-painted by this.
  OBR.scene.items.onChange(() => { void syncFromExternal(); });
});
