import OBR from "@owlbear-rodeo/sdk";
import { ICONS } from "../../icons";
import { formatTagsClickable, fireQuickRoll, resolveClickRollTarget } from "../dice/tags";

const SHOW_MSG = "com.bestiary/info-show";
const BESTIARY_DATA_KEY = "com.bestiary/monsters";
const DATA_BASE = "https://5e.kiwee.top";

let indexCache: Record<string, string> | null = null;
async function loadBestiaryIndex(): Promise<Record<string, string>> {
  if (indexCache) return indexCache;
  const res = await fetch(`${DATA_BASE}/data/bestiary/index.json`);
  indexCache = (await res.json()) as Record<string, string>;
  return indexCache;
}

const fileCache = new Map<string, any[]>();
async function fetchMonsterFile(filename: string): Promise<any[]> {
  const cached = fileCache.get(filename);
  if (cached) return cached;
  try {
    const res = await fetch(`${DATA_BASE}/data/bestiary/${filename}`);
    const data = await res.json();
    const list = (data.monster || []) as any[];
    fileCache.set(filename, list);
    return list;
  } catch {
    return [];
  }
}

async function findMonster(source: string, engName: string): Promise<any | null> {
  const index = await loadBestiaryIndex();
  const filename = index[source];
  if (!filename) return null;
  const list = await fetchMonsterFile(filename);
  return list.find((x) => (x.ENG_name || x.name) === engName) || null;
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
  if (typeof hp === "object") return String(hp.average ?? "?");
  return "?";
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

function renderSpellList(arr: any): string {
  if (!Array.isArray(arr)) return "";
  // Spell names with 5etools tags — make rollable where applicable
  // ({@spell ...} is cosmetic, but if a spell entry includes inline
  // {@dice} it'll be clickable). The split by "、" stays string-safe
  // because formatTagsClickable escapes the surrounding text.
  return arr.map((s) => formatTagsClickable(String(s))).filter(Boolean).join("、");
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
  const blocks = sc.map((entry: any) => {
    const name = entry.name || "施法";
    const header = flattenEntries(entry.headerEntries);
    const leveled = renderSpellLevels(entry.spells);
    const will = renderSpellGroup("随意", entry.will);
    const daily = renderSpellDaily(entry.daily);
    const rest = renderSpellGroup("短休回复", entry.rest);
    return `<div class="act spell">
      <div class="sc-hdr"><span class="n">${escapeHtml(name)}</span></div>
      ${header ? `<div class="t">${formatTagsClickable(header)}</div>` : ""}
      ${will}${daily}${rest}${leveled}
    </div>`;
  });
  return `<div class="sect">${ICONS.sparkles} 施法</div>${blocks.join("")}`;
}

function renderLegendary(m: any, displayName: string): string {
  const items = m.legendary;
  if (!Array.isArray(items) || items.length === 0) return "";
  const headerText = Array.isArray(m.legendaryHeader)
    ? flattenEntries(m.legendaryHeader)
    : `${displayName}可进行 ${m.legendaryActions ?? 3} 个传奇动作，从下列选项中选择。同时只能使用一项，且只能在其他生物的回合结束时进行。${displayName}的每回合开始时，用完的传奇动作次数会重置。`;
  const rows = items.map((a: any) => {
    const n = a.name || "?";
    const t = flattenEntries(a.entries);
    return `<div class="act legendary"><span class="n">${escapeHtml(n)}</span><span class="t">${formatTagsClickable(t)}</span></div>`;
  }).join("");
  return `<div class="sect">${ICONS.star} 传奇动作</div><div class="preamble">${formatTagsClickable(headerText)}</div>${rows}`;
}

let currentSlug: string | null = null;

const INFO_POPOVER_ID = "com.bestiary/info";
const INFO_MIN_HEIGHT = 120;
// Captured once at OBR.onReady, before any setHeight. This is the popover's
// opened height (from background.ts) and acts as our ceiling — we only ever
// shrink below it, never grow past it. Long content keeps the scrollbar.
let INFO_MAX_HEIGHT = 340;

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

  const chips = `
    <div class="chip hp"><span class="k">HP</span><span class="v">${escapeHtml(hp)}</span></div>
    <div class="chip ac"><span class="k">AC</span><span class="v">${escapeHtml(ac)}</span></div>
    <div class="chip cr"><span class="k">CR</span><span class="v">${escapeHtml(cr)}</span></div>
    <div class="chip speed"><span class="k">速度</span><span class="v">${speedLines}</span></div>
  `;
  const top = `
    <div class="top">
      <div class="chips">${chips}</div>
      <div class="abil">__ABIL__</div>
    </div>
  `;

  const saves = m.save || {};
  const monsterName = stripTags(m.name ?? m.ENG_name ?? "怪物");
  const abl = ORDER
    .map((k) => {
      const score = typeof m[k] === "number" ? m[k] : 10;
      const isProf = saves[k] !== undefined;
      const aMod = mod(score);
      // Ability check: 1d20+modifier
      const aExpr = `1d20${aMod >= 0 ? `+${aMod}` : aMod}`;
      const aLbl = `${monsterName} · ${FULL[k] ?? ABBR[k]}检定`;
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
      const saveLbl = `${monsterName} · ${FULL[k] ?? ABBR[k]}豁免`;
      return `<div class="abl${isProf ? " prof" : ""}">
        <span class="a rollable" data-expr="${saveExpr}" data-label="${escapeHtml(saveLbl)}" title="${escapeHtml(saveLbl)} ${saveExpr}">${ABBR[k]}</span>
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
        // Body text gets the rich treatment so attack hits / damage
        // dice in the entries become clickable rollable spans.
        return `<div class="act ${cls}"><span class="n">${escapeHtml(n)}</span><span class="t">${formatTagsClickable(t)}</span></div>`;
      })
      .join("");
    return `<div class="sect">${title}</div>${rows}`;
  };

  const traits = sectionHtml(m.trait, "trait", `${ICONS.sparkle4} 特性`);
  const spellcasting = renderSpellcasting(m.spellcasting);
  const actions = sectionHtml(m.action, "", `${ICONS.swords} 动作`);
  const bonus = sectionHtml(m.bonus, "bonus", `${ICONS.zap} 附赠动作`);
  const reactions = sectionHtml(m.reaction, "reaction", `${ICONS.shield} 反应`);
  const legendary = renderLegendary(m, name);

  root.innerHTML = `
    <div class="hdr">
      <div class="name">${escapeHtml(name)}</div>
      <div class="sub">${escapeHtml(sub)}</div>
    </div>
    ${top.replace("__ABIL__", abl)}
    ${traits}
    ${spellcasting}
    ${actions}
    ${bonus}
    ${reactions}
    ${legendary}
  `;
}

async function showMonster(slug: string) {
  currentSlug = slug;
  try {
    const meta = await OBR.scene.getMetadata();
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

// Delegated click for any 5etools rollable tag inside the monster
// stat-block. The bestiary popover is GM-only, so the click semantics
// here favor "DM stays in control" — left-click defaults to a DARK
// roll (only the DM sees the dice/result, players don't), right-click
// fires an OPEN roll (everyone sees it).
async function fireRollableFromBestiary(target: HTMLElement, hidden: boolean) {
  const expression = target.dataset.expr ?? "";
  const label = target.dataset.label ?? "";
  if (!expression) return;
  const itemId = await resolveClickRollTarget();
  fireQuickRoll({ expression, label, itemId, focus: !!itemId, hidden });
  target.classList.remove("rollable-flash");
  void target.offsetWidth;
  target.classList.add("rollable-flash");
}

root.addEventListener("click", async (e) => {
  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(".rollable");
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  await fireRollableFromBestiary(target, true);  // left click → dark
});

root.addEventListener("contextmenu", async (e) => {
  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(".rollable");
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  await fireRollableFromBestiary(target, false); // right click → open
});

OBR.onReady(() => {
  // Capture the popover's opened height as the ceiling for future resizes.
  if (window.innerHeight > 0) INFO_MAX_HEIGHT = window.innerHeight;

  // Initial slug from URL — popover is opened on-demand with the slug in
  // the query string. While popover stays open, background broadcasts
  // in-place swaps when the DM selects a different monster.
  try {
    const params = new URLSearchParams(location.search);
    const slug = params.get("slug");
    if (slug) showMonster(slug);
  } catch {}

  OBR.broadcast.onMessage(SHOW_MSG, (ev: any) => {
    const p = ev?.data || {};
    if (p.slug) showMonster(String(p.slug));
  });
});
