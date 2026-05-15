import OBR from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "../../utils/debugOverlay";
import { ICONS } from "../../icons";
import { resolveClickRollTarget } from "../dice/tags";
import { bindRollableContextMenu, bindRollableClickPopup } from "../dice/context-menu";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import { bindPanelDrag } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import { readBubbles, type BubblesData } from "../../utils/statEdit";
import { mountResourcePanel } from "../resourceTracker/panel";
import { mountStatBanner } from "../../utils/statBanner";

// 2026-05-13 — Was previously dev-only (gated through STABLE_HIDES /
// STABLE_HIDES_CC) until cc-fullscreen + hp-bar integration matured.
// Now ships in both stable and dev channels; flags removed.

// 2026-05-10: pin-panel feature. When ON, the cc-info popover stays
// open even after the user clears / changes selection — bg module
// reads the same localStorage key + listens for the broadcast below.
const LS_CC_INFO_PINNED = "obr-suite/cc-info-pinned";
const BC_CC_INFO_PIN_CHANGED = "com.obr-suite/cc-info-pin-changed";

function readPanelPinned(): boolean {
  try { return localStorage.getItem(LS_CC_INFO_PINNED) === "1"; } catch { return false; }
}

function togglePanelPinned(): void {
  const next = !readPanelPinned();
  try { localStorage.setItem(LS_CC_INFO_PINNED, next ? "1" : "0"); } catch {}
  // Broadcast both LOCAL (so the bg module on this client picks it
  // up) and let the iframe re-render its button on next render call.
  try {
    OBR.broadcast.sendMessage(
      BC_CC_INFO_PIN_CHANGED,
      { pinned: next },
      { destination: "LOCAL" },
    );
  } catch {}
  // Update the DOM live without a full re-render — the pin state is
  // purely visual at this layer.
  const btn = document.querySelector<HTMLButtonElement>("#panel-pin-btn");
  if (btn) {
    btn.classList.toggle("pinned", next);
    btn.setAttribute("aria-pressed", String(next));
    btn.title = next ? "已置顶（取消则恢复随选择关闭）" : "置顶面板（取消选中也保持显示）";
  }
}

// === Resource-tracker tab strip =============================================
// Same pattern as bestiary monster-info-page: name + statBanner stay
// pinned at the top, the tab strip slides an indicator between attr
// (existing chips / abilities / weapons / features) and res (resource
// tracker). Hover or click switches; mouse-leave returns the indicator
// to the active tab.

type RtTabId = "attr" | "res";
let activeRtTab: RtTabId = "attr";

function renderRtTabStrip(): string {
  return `
    <div class="rt-tabstrip">
      <div class="rt-tab-indicator" data-rt-indicator></div>
      <button class="rt-tab ${activeRtTab === "attr" ? "on" : ""}" data-rt-tab="attr" type="button">属性</button>
      <button class="rt-tab ${activeRtTab === "res" ? "on" : ""}" data-rt-tab="res" type="button">资源</button>
    </div>
  `;
}

function setupRtTabSwitching(): void {
  const strip = root.querySelector<HTMLElement>(".rt-tabstrip");
  const clip = root.querySelector<HTMLElement>(".rt-clip");
  if (!strip) return;
  const buttons = strip.querySelectorAll<HTMLButtonElement>(".rt-tab");
  const indicator = strip.querySelector<HTMLElement>("[data-rt-indicator]");
  const moveIndicatorTo = (target: HTMLElement | null) => {
    if (!indicator || !target) return;
    indicator.style.transform = `translateX(${target.offsetLeft}px)`;
    indicator.style.width = `${target.offsetWidth}px`;
  };
  const findActiveButton = (): HTMLElement | null =>
    strip.querySelector<HTMLElement>(`.rt-tab[data-rt-tab="${activeRtTab}"]`);

  // 2026-05-12 — JS height tracking removed. .rt-clip uses CSS grid
  // overlap now; both panes share a single grid cell that sizes to
  // max(active, inactive) automatically. See monster-info-page.ts
  // for full rationale.
  requestAnimationFrame(() => moveIndicatorTo(findActiveButton()));

  const switchTo = (next: RtTabId) => {
    if (next === activeRtTab) return;
    activeRtTab = next;
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.rtTab === next));
    moveIndicatorTo(findActiveButton());
    if (clip) clip.setAttribute("data-active", next);
    if (next === "res") void ensureRtResourceMount();
    // 2026-05-15 — pane swap changes content height (the inactive pane
    // collapses to 0). Re-fit the popover so e.g. a short attribute
    // tab → tall resource tab grows back, or vice-versa shrinks.
    queueAdjustHeight();
  };

  // 2026-05-15 — click-only switching. Hover-to-switch (added in
  // 2026-05-11b for "instant" feedback) made the panel jumpy: any
  // accidental mouse-over while reading the resource list would flip
  // back to attributes. User explicitly asked to revert to click.
  buttons.forEach((b) => {
    const target = (b.dataset.rtTab as RtTabId) ?? "attr";
    b.addEventListener("click", () => switchTo(target));
  });
}

let rtMountHandle: { refresh: () => Promise<void>; unmount: () => void } | null = null;
// Shared stat-banner component handle (HP / temp HP / AC / lock). Same
// lifecycle as rtMountHandle — render() unmounts the previous instance
// and re-mounts so the component's scene.items.onChange subscription
// doesn't leak one listener per card switch.
let ccStatHandle: { refresh: () => Promise<void>; unmount: () => void } | null = null;
async function ensureRtResourceMount(): Promise<void> {
  const container = root.querySelector<HTMLElement>("#rt-mount");
  if (!container) return;
  rtMountHandle?.unmount();
  rtMountHandle = mountResourcePanel({
    container,
    getItemId: () => boundItemId,
  });
  await rtMountHandle.refresh();
  // The resource panel can grow / shrink as items are added/removed.
  // Re-fit the popover so the active="res" pane drives popover height.
  queueAdjustHeight();
}

const SHOW_MSG = "com.character-cards/info-show";

const root = document.getElementById("root") as HTMLDivElement;

// 2026-05-15 — popover-height auto-shrink. The popover opens at
// INFO_HEIGHT (260px in index.ts) so it has room for the tallest
// likely card, but on most cards the actual content is ~180-240px and
// the leftover whitespace makes the panel feel oversized + blocks
// canvas underneath. After every render / pane-switch we measure
// the content's actual extent and ask OBR to shrink the popover. We
// never grow past INFO_MAX_HEIGHT (captured at OBR.onReady from the
// actual opened popover height — respects user resize via the layout
// editor), so long content keeps an inner scrollbar instead of
// escaping the popover.
//
// NOTE on measurement: `root.scrollHeight` does NOT work here. Per
// CSSOM spec, scrollHeight on an `overflow:auto` box returns
// max(content, clientHeight) — i.e. when content is SHORTER than
// the box it just returns the box height, defeating the shrink. So
// we measure the children's bounding rects directly: the bottom of
// the lowest child minus the top of the highest child + root's own
// vertical padding gives the true content extent regardless of box
// size. This is the bug the user reported as "高度依旧过高导致需要
// 滚轮，但实际上内容并没有到需要滚轮的程度" — content fit fine but
// the popover stayed at INFO_HEIGHT because scrollHeight === clientHeight.
const INFO_POPOVER_ID = "com.obr-suite/cc-info";
const INFO_MIN_HEIGHT = 140;
let INFO_MAX_HEIGHT = 360;

let _adjustQueued = false;
function queueAdjustHeight(): void {
  if (_adjustQueued) return;
  _adjustQueued = true;
  // Two RAFs so the browser has time to lay out + the slide-pane
  // transitions stop animating (transform isn't part of scrollHeight,
  // but the inactive pane's height:0 collapse only takes effect after
  // the data-active attribute flip is committed).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      _adjustQueued = false;
      void adjustHeight();
    });
  });
}

function measureContentHeight(): number {
  if (!root.children.length) return 0;
  const rootRect = root.getBoundingClientRect();
  let contentTop = rootRect.bottom;
  let contentBottom = rootRect.top;
  for (const child of Array.from(root.children) as HTMLElement[]) {
    // Skip invisible children (e.g. inactive .rt-pane is height:0 +
    // overflow:hidden — its bounding rect is a zero-height line but
    // still contributes a single point, throwing off the min/max.
    // `offsetHeight === 0` filters cleanly).
    if (child.offsetHeight === 0) continue;
    const r = child.getBoundingClientRect();
    if (r.top < contentTop) contentTop = r.top;
    if (r.bottom > contentBottom) contentBottom = r.bottom;
  }
  if (contentBottom <= contentTop) return 0;
  const cs = getComputedStyle(root);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  // contentTop is at root's padding-top edge in viewport coords; root's
  // top is `rootRect.top` (= padding-top edge minus padTop). So the
  // content area extent is (contentBottom - contentTop), and adding
  // both vertical paddings reconstructs the full box height the popover
  // would need.
  return (contentBottom - contentTop) + padTop + padBottom;
}

async function adjustHeight(): Promise<void> {
  const contentH = measureContentHeight();
  if (!contentH) return;
  // +6 for a tiny breathing margin so the bottom border doesn't kiss
  // the popover edge. Clamp to [MIN, MAX] — never exceed the popover's
  // opened height (so user-resized larger popovers stay larger).
  const target = Math.max(INFO_MIN_HEIGHT, Math.min(contentH + 6, INFO_MAX_HEIGHT));
  try {
    await OBR.popover.setHeight(INFO_POPOVER_ID, target);
  } catch { /* popover may have closed mid-flight */ }
}

// The token id this card is currently bound to. Updated whenever the
// info popover is shown for a different character. Quick-rolls fire
// on this token (for camera focus + dice anchoring above the head).
let boundItemId: string | null = null;

const ABBR: Record<string, string> = {
  str: "力", dex: "敏", con: "体", int: "智", wis: "感", cha: "魅",
};
// Full Chinese names for the dice-roll label (e.g. "敏捷检定" rather
// than "敏检定"). Used for the panel-page formula label / history
// display — the chip itself still shows the single-char ABBR.
const FULL: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ORDER = ["str", "dex", "con", "int", "wis", "cha"];

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
    console.warn("[character-cards/info] toggle token name text failed", e);
  } finally {
    btn.disabled = false;
  }
}

function fmtMod(n: unknown): string {
  if (typeof n !== "number") return "?";
  return n >= 0 ? `+${n}` : `${n}`;
}

// attack_bonus is either "+3" (weapons) or "D20+7" (spells). Normalise to
// just the signed bonus like "+7".
function extractBonus(s: unknown): string {
  const str = String(s ?? "");
  const m = /([+-]\s*\d+)\s*$/.exec(str);
  if (!m) return str || "?";
  return m[1].replace(/\s+/g, "");
}

// Split a weapon's `properties` string into individual chips, each
// clickable to search the property name in the suite's global search.
//
// Delimiter handling is paren-aware: commas / slashes inside `(…)`
// or `（…）` belong to the same tag and don't trigger a split — that
// way "投掷(射程20，60)" stays one chip instead of getting torn into
// "投掷(射程20" and "60)". Supports CN+ASCII commas, slashes, and
// the explicit "精通：xxx" 2024-mastery prefix.
function renderWeaponPropertyChips(raw: string): string {
  if (!raw.trim()) return "";
  const out: string[] = [];
  // Split mastery from the rest first — "精通：xxx" or "精通: xxx"
  // is a single mastery label, even if the rest is comma-separated.
  let masteryPart = "";
  let restPart = raw;
  const mastM = /精通\s*[：:]\s*([^,，、/\s]+)/.exec(raw);
  if (mastM) {
    masteryPart = mastM[1];
    restPart = raw.replace(mastM[0], "").replace(/[,，、]\s*$/, "");
  }
  const tags: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of restPart) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === "，" || ch === "、" || ch === "/")) {
      const t = buf.trim();
      if (t) tags.push(t);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) tags.push(tail);
  for (const t of tags) {
    // For search, strip any "(...)" parenthetical so a chip labelled
    // "投掷(射程20，60)" looks up just "投掷" in the index. The
    // visible label keeps the full text.
    const searchKey = t.replace(/[(（][^)）]*[)）]\s*/g, "").trim() || t;
    out.push(
      `<span class="prop prop-chip" data-search="${escapeHtml(searchKey)}" title="搜索：${escapeHtml(searchKey)}">${escapeHtml(t)}</span>`,
    );
  }
  if (masteryPart) {
    out.push(
      `<span class="prop prop-chip prop-mastery" data-search="${escapeHtml(masteryPart)}" title="搜索精通词条：${escapeHtml(masteryPart)}"><em>精通</em>${escapeHtml(masteryPart)}</span>`,
    );
  }
  return out.length ? `<span class="prop-row">${out.join("")}</span>` : "";
}

function classesStr(d: any): string {
  if (!Array.isArray(d.classes)) return "";
  return d.classes
    .map((c: any) => {
      const nm = c.name || c.class_name || c.cls || "";
      const lv = c.level ?? c.lvl ?? "";
      return `${nm}${lv}`;
    })
    .filter(Boolean)
    .join("/");
}

let currentCardId: string | null = null;
let currentRoomId: string | null = null;
const cardCache = new Map<string, any>();

// Broadcast id mirrored from panel-page.ts. Receiving this with a
// matching cardId means another client uploaded / refreshed / imported
// the same card, so we should drop our cache and re-fetch.
const BC_CARD_UPDATED = "com.obr-suite/cc-card-updated";

// Cached role lookup. The DM-only lock button at the right end of the
// stat banner reads this. OBR.onReady below populates it before any
// showCard runs, so the very first render already has the right value.
let cachedIsGM = false;

async function showCard(cardId: string, roomId: string) {
  currentCardId = cardId;
  currentRoomId = roomId;

  // Cache hit: render instantly, 0 network wait, 0 intermediate frame.
  const cached = cardCache.get(cardId);
  if (cached) {
    const live = await readLiveBubbles();
    render(cached, cardId, roomId, live);
    return;
  }

  // Cold load: only show "loading" if nothing's rendered yet (first open).
  // When switching between bound characters, keep the previous card's content
  // on screen until the new data arrives — single atomic A→B swap, no flash.
  const isEmpty = root.childElementCount === 0;
  if (isEmpty) {
    root.innerHTML = '<div class="loading">加载中…</div>';
  }

  try {
    const [res, live] = await Promise.all([
      // 2026-05-15 — `cache: 'no-store'` so BC_CARD_UPDATED refetches
      // never get served stale data from the HTTP cache. fullscreen-
      // page.ts uses the same flag; without it the user saw "保存了但
      // 小面板没刷新" because the browser handed back the old data.json.
      fetch(
        `https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`,
        { cache: "no-store" },
      ),
      readLiveBubbles(),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    // If user switched cards between fetch start and end, ignore.
    if (currentCardId !== cardId) return;
    cardCache.set(cardId, d);
    render(d, cardId, roomId, live);
  } catch (e: any) {
    if (currentCardId !== cardId) return;
    root.innerHTML = `<div class="err">加载失败：${escapeHtml(e?.message ?? e)}</div>`;
  }
}

// Read the bound token's live bubbles metadata so the panel reflects
// the canonical HP/AC state (which the bubbles bar above the token
// also draws from). Falls back to {} when no token is bound — render()
// then uses the static card data values.
async function readLiveBubbles(): Promise<BubblesData> {
  if (!boundItemId) return {};
  return readBubbles(boundItemId);
}

function render(d: any, cardId: string, roomId: string, live: BubblesData = {}) {
  const id = d.identity || {};
  const cs = d.core_stats || {};
  const ab = d.abilities || {};
  const cb = d.combat || {};
  const sp = d.spellcasting || {};

  const name = id.display_name || id.character_name || "未命名";
  const race = [id.race?.name, id.race?.subrace].filter(Boolean).join("·");
  const cls = classesStr(d);
  const lvl = d.total_level != null ? `Lv${d.total_level}` : "";
  const sub = [race, cls, lvl].filter(Boolean).join(" ");

  const rawUrl = `https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/`;

  // Stat banner — the shared `mountStatBanner` component (the SAME one
  // the standalone DM resource tracker mounts). It owns the HP / temp HP
  // / AC / lock UI plus all the edit + scene-sync logic, so render() just
  // drops a host element here; the post-innerHTML step below mounts the
  // component into it. `statFallback` supplies the card-data HP/AC for
  // any field the bound token has no bubbles metadata for yet; the
  // already-fetched `live` snapshot is passed as initialLive for a
  // flicker-free first paint.
  const hp = cs.hp || {};
  const statFallback: Partial<Record<keyof BubblesData, number>> = {
    health: typeof hp.current === "number" ? hp.current : 0,
    "max health": typeof hp.max === "number" ? hp.max : 0,
    "temporary health": typeof hp.temp === "number" ? hp.temp : 0,
    "armor class": typeof cs.ac === "number" ? cs.ac : 10,
  };

  const speedStr = cs.speed != null ? `${cs.speed}尺` : "?";
  const castAbility = sp.spellcasting_ability || "—";

  const statBanner = `<div class="cc-stat-mount" id="cc-stat-mount"></div>`;

  // The remaining read-only chips (HP/AC moved to stat-rows above).
  const chips = `
    <div class="chip init"><span class="k">先攻</span><span class="v">${fmtMod(cs.initiative)}</span></div>
    <div class="chip"><span class="k">速度</span><span class="v">${escapeHtml(speedStr)}</span></div>
    <div class="chip"><span class="k">被动察觉</span><span class="v">${escapeHtml(cs.passive_perception)}</span></div>
    <div class="chip"><span class="k">熟练</span><span class="v">${fmtMod(cs.proficiency_bonus)}</span></div>
    <div class="chip"><span class="k">豁免DC</span><span class="v">${escapeHtml(cs.dc)}</span></div>
    <div class="chip"><span class="k">施法关键属性</span><span class="v">${escapeHtml(castAbility)}</span></div>
  `;

  // Group skills by their ability key — each ability card embeds its own
  // list of associated skills (e.g. DEX card shows 特技/巧手/隐匿).
  const skills = Array.isArray(d.skills) ? d.skills : [];
  const skillsByAbil: Record<string, any[]> = {};
  for (const s of skills) {
    const k = String(s?.ability ?? "").toLowerCase();
    if (!k) continue;
    (skillsByAbil[k] ??= []).push(s);
  }

  const renderSkillRow = (s: any) => {
    const cls = s.proficiency === "expertise"
      ? "sk sk-exp"
      : s.proficiency === "proficient"
        ? "sk sk-prof"
        : "sk";
    const total = typeof s.total === "number" ? s.total : 0;
    const expr = `1d20${total >= 0 ? `+${total}` : total}`;
    const lbl = `${s.name ?? "?"}`;
    return `<div class="${cls} rollable" data-expr="${expr}" data-label="${escapeHtml(lbl)}" title="${escapeHtml(lbl)} ${expr}">
      <span class="sk-n">${escapeHtml(s.name ?? "?")}</span>
      <span class="sk-v">${fmtMod(s.total)}</span>
    </div>`;
  };

  const abl = ORDER
    .map((k) => {
      const a = ab[k] || {};
      const prof = !!a.save?.proficient;
      const skList = skillsByAbil[k] ?? [];
      const skHtml = skList.map(renderSkillRow).join("");
      // Ability check: 1d20+modifier. Saving-throw uses the same
      // modifier unless the save has its own bonus stored separately.
      const aMod = typeof a.modifier === "number" ? a.modifier : 0;
      const aExpr = `1d20${aMod >= 0 ? `+${aMod}` : aMod}`;
      const aLbl = `${FULL[k] ?? ABBR[k] ?? k}检定`;
      // Saving throw — different label, may have its own bonus.
      const saveBonus = typeof a.save?.bonus === "number"
        ? a.save.bonus
        : (a.save?.proficient ? aMod + (cs.proficiency_bonus ?? 0) : aMod);
      const saveExpr = `1d20${saveBonus >= 0 ? `+${saveBonus}` : saveBonus}`;
      const saveLbl = `${FULL[k] ?? ABBR[k] ?? k}豁免`;
      return `<div class="abl${prof ? " prof" : ""}">
        <div class="abl-head">
          <span class="a rollable" data-expr="${saveExpr}" data-label="${escapeHtml(saveLbl)}" title="${escapeHtml(saveLbl)} ${saveExpr}">${ABBR[k]}</span>
          <span class="t">${escapeHtml(a.total)}</span>
          <span class="m rollable" data-expr="${aExpr}" data-label="${escapeHtml(aLbl)}" title="${escapeHtml(aLbl)} ${aExpr}">${fmtMod(a.modifier)}</span>
        </div>
        ${skHtml ? `<div class="abl-skills">${skHtml}</div>` : ""}
      </div>`;
    })
    .join("");

  const weaponRows: string[] = [];

  // Spell attack row (first so it's easy to find). Only if character casts.
  if (sp.attack_bonus) {
    const bonus = extractBonus(sp.attack_bonus);
    const bn = parseInt(bonus.replace(/[^\d-]/g, ""), 10) || 0;
    const atkExpr = `1d20${bn >= 0 ? `+${bn}` : bn}`;
    const atkLbl = `法术攻击`;
    weaponRows.push(`<div class="wp spell">
      <span class="n">近战/远程法术攻击</span>
      <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${escapeHtml(bonus)}</span>
      <span class="dmg">DC ${escapeHtml(sp.save_dc ?? cs.dc ?? "?")}</span>
    </div>`);
  }

  if (Array.isArray(cb.weapons)) {
    for (const w of cb.weapons) {
      // Weapon properties (e.g. "灵巧, 轻型, 精通：缓速") render as
      // individual clickable chips. Splits on the most common
      // delimiters (Chinese / ASCII commas, slash, and the explicit
      // "精通：" prefix) so each tag becomes its own search query.
      //
      // 2026-05-15 — also pull `w.mastery` (the parser's dedicated
      // mastery column, AN32 in the 2024 layout). When present, fold
      // it into the chip list with the "精通：" prefix so it renders
      // identically to mastery written inline in the properties text.
      // Description (AP32 effect) is NOT carried into the chip —
      // global search resolves the rule line on click.
      const propsRaw = String(w.properties ?? "");
      const masteryName = String((w as any).mastery ?? "").trim();
      const masteryPrefix = masteryName ? `精通：${masteryName}` : "";
      // Merge into one string. If the raw props already contains a
      // mastery tag (legacy cards), don't double-add the dedicated one.
      const propsCombined = masteryPrefix && !/精通[：:]/.test(propsRaw)
        ? (propsRaw ? `${propsRaw}, ${masteryPrefix}` : masteryPrefix)
        : propsRaw;
      const prop = propsCombined ? renderWeaponPropertyChips(propsCombined) : "";
      const dmgRaw = [w.damage, w.damage_type].filter(Boolean).join(" ");
      const wpName = w.name ?? "?";
      // Attack roll: parse the leading sign+number from attack_bonus.
      const atkBonusStr = String(w.attack_bonus ?? "").trim();
      const atkM = /([+-]?\s*\d+)/.exec(atkBonusStr);
      const atkBn = atkM ? parseInt(atkM[1].replace(/\s+/g, ""), 10) : 0;
      const atkExpr = `1d20${atkBn >= 0 ? `+${atkBn}` : atkBn}`;
      const atkLbl = `${wpName} 命中`;
      // Damage: extract the raw dice expression from `w.damage`. Most
      // entries are like "1d8+3" or "2d6+4" — pass through directly.
      const dmgExprRaw = String(w.damage ?? "").replace(/\s+/g, "");
      const dmgExprMatch = /\d*d\d+([+-]\d+)?/.exec(dmgExprRaw);
      const dmgExpr = dmgExprMatch ? dmgExprMatch[0] : dmgExprRaw;
      const dmgLbl = `${wpName} 伤害${w.damage_type ? `(${w.damage_type})` : ""}`;
      const dmgClickable = dmgExpr
        ? `<span class="rollable" data-expr="${escapeHtml(dmgExpr)}" data-label="${escapeHtml(dmgLbl)}" title="${escapeHtml(dmgLbl)} ${escapeHtml(dmgExpr)}">${escapeHtml(dmgRaw || "?")}</span>`
        : escapeHtml(dmgRaw || "?");
      // 附加伤害骰 — bonus dice (sneak attack, divine smite, etc.).
      // Server attaches `extra_damage` (e.g. "1d8") and
      // `extra_damage_type` (e.g. "辐光"). Render as a separate
      // clickable chunk after the base damage so different damage
      // types don't get folded into the same expression.
      let extraHtml = "";
      const extraExpr = w.extra_damage
        ? String(w.extra_damage).replace(/\s+/g, "")
        : "";
      if (extraExpr) {
        const extraLbl = `${wpName} 附加伤害${w.extra_damage_type ? `(${w.extra_damage_type})` : ""}`;
        const extraDisplay = [w.extra_damage, w.extra_damage_type]
          .filter(Boolean)
          .join(" ");
        extraHtml =
          ` <span class="dmg-extra rollable" data-expr="${escapeHtml(extraExpr)}" data-label="${escapeHtml(extraLbl)}" title="${escapeHtml(extraLbl)} ${escapeHtml(extraExpr)}">+${escapeHtml(extraDisplay)}</span>`;
      }
      weaponRows.push(`<div class="wp">
        <span class="n">${escapeHtml(wpName)}</span>
        <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${escapeHtml(w.attack_bonus ?? "?")}</span>
        <span class="dmg">${dmgClickable}${extraHtml}</span>
        ${prop}
      </div>`);
    }
  }

  const weps = weaponRows.length ? weaponRows.join("") : '<div class="empty">无</div>';

  // ── Searchable chips: features / feats / spells ────────────────
  // Each chip is a tiny compact name-only box. Clicking fills the
  // cluster's search input with that name (BC_SEARCH_QUERY) so the
  // 5etools search popover opens with matching results — letting
  // the player look up a feature definition without leaving OBR.
  const featuresHtml = renderSearchChips(d);

  // Combined attribute pane content (chips / abilities / weapons /
  // features). On stable: render flat (no tabs, no slide). On dev:
  // wrap in a sliding rt-clip alongside the resource pane.
  const attrInner = `
    <div class="row">${chips}</div>
    <div class="abil">${abl}</div>
    <div class="sect">${ICONS.swords} 武器 / 攻击</div>
    ${weps}
    ${featuresHtml}
  `;
  // 2026-05-13 — resource-tracker graduated from dev to stable;
  // tab strip + rt-clip render unconditionally now.
  const stickyTop = `${statBanner}${renderRtTabStrip()}`;
  const contentBlock = `
    <div class="rt-clip" data-active="${activeRtTab}">
      <div class="rt-pane" data-pane="attr">${attrInner}</div>
      <div class="rt-pane" data-pane="res">
        <div id="rt-mount" style="position:relative; min-height:80px"></div>
      </div>
    </div>
  `;
  // 2026-05-10: pin button — when toggled ON, the panel doesn't
  // auto-close on selection clear / mismatch. Data still updates
  // when a different bound token is selected. Per-client state in
  // localStorage; bg module reads the same key + listens for the
  // broadcast.
  const pinned = readPanelPinned();
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
        ${renderNameButton(name, !!boundItemId)}
      </div>
      <div class="sub">${escapeHtml(sub)}</div>
      <a class="raw-link" href="${rawUrl}" target="_blank" rel="noopener">原始数据</a>
    </div>
    ${stickyTop}
    ${contentBlock}
  `;
  // 2026-05-13 — resource-tracker graduated to stable; always set up.
  setupRtTabSwitching();
  void ensureRtResourceMount();
  // Mount the shared stat banner into its host element. Unmount any
  // prior instance first — render() runs on every card switch, so
  // without this the component's scene.items.onChange subscription
  // would leak one listener per switch. `initialLive` is the freshly
  // fetched bubbles snapshot, so the banner paints synchronously with
  // the right values (no refresh() round-trip needed).
  const statMount = root.querySelector<HTMLElement>("#cc-stat-mount");
  if (statMount) {
    ccStatHandle?.unmount();
    ccStatHandle = mountStatBanner({
      container: statMount,
      getItemId: () => boundItemId,
      isGM: cachedIsGM,
      fallback: statFallback,
      initialLive: live,
    });
  }
  // The drag handle DOM element is recreated on every render() (we
  // assigned root.innerHTML), so the existing pointer-event bindings
  // on the previous element are gone. Re-bind for the new node.
  const handle = root.querySelector<HTMLDivElement>("#drag-handle");
  if (handle) {
    if (currentDragUnbind) currentDragUnbind();
    currentDragUnbind = bindPanelDrag(handle, PANEL_IDS.ccInfo);
  }
  const pinBtn = root.querySelector<HTMLButtonElement>("#panel-pin-btn");
  if (pinBtn) {
    pinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanelPinned();
    });
  }
  // 2026-05-11 — bubble reset button (mirror of monster-info). LOCAL
  // broadcast tells the bubbles bg to drop the cached entry for the
  // bound token + sweep its local items + re-render. Fixes the
  // "blood bar drifted off-anchor" bug.
  const resetBtn = root.querySelector<HTMLButtonElement>("#bubbles-reset-btn");
  if (resetBtn && boundItemId) {
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/bubbles-reset-token",
          { tokenId: boundItemId },
          { destination: "LOCAL" },
        );
      } catch (err) { console.warn("[cc-info] reset broadcast failed", err); }
      resetBtn.classList.add("flash");
      setTimeout(() => resetBtn.classList.remove("flash"), 400);
    });
  }
  const nameBtn = root.querySelector<HTMLButtonElement>(".name-btn[data-name-text]");
  if (nameBtn && boundItemId) {
    nameBtn.addEventListener("click", () => {
      void toggleTokenNameText(boundItemId!, nameBtn.dataset.nameText || name, nameBtn);
    });
  }
  // 2026-05-15 — fit the popover to the freshly-rendered content. Runs
  // after every card switch / re-render. See queueAdjustHeight comment.
  queueAdjustHeight();
}

// Tracks the drag-handle's current bindPanelDrag unbind function so we
// can release the previous element's listeners before binding to the
// re-rendered one. (innerHTML reassignment GCs the old DOM nodes; their
// DOM listeners die with them — but we still want to clear our local
// pointer-capture state inside panelDrag, which the unbind handles.)
let currentDragUnbind: (() => void) | null = null;

// Compact name-only chips. Click → fires BC_SEARCH_QUERY to populate
// the cluster's search input. The cluster echoes its own input value
// from this broadcast so the user sees the chip text appear in the
// search box and the search popover opens with matching results.
function renderSearchChips(d: any): string {
  const sections: string[] = [];
  const features = d.features ?? {};

  const renderChips = (items: any[]) => items
    .filter((x) => x && x.name)
    .map((x) => {
      const nm = String(x.name);
      return `<span class="srch-chip" data-q="${escapeHtml(nm)}">${escapeHtml(nm)}</span>`;
    })
    .join("");

  // 特性 = race_features + class_features (merged into one tight grid).
  const featList: any[] = [];
  if (Array.isArray(features.race_features)) featList.push(...features.race_features);
  if (Array.isArray(features.class_features)) featList.push(...features.class_features);
  if (featList.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">特性</div>
      <div class="srch-grid">${renderChips(featList)}</div>
    </div>`);
  }

  // 专长 — class feats list.
  if (Array.isArray(features.feats) && features.feats.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">专长</div>
      <div class="srch-grid">${renderChips(features.feats)}</div>
    </div>`);
  }

  // 法术 — flatten always_known + prepared + cantrips_known into one
  // grid (de-duplicated by name).
  const sp = d.spellcasting ?? {};
  const allSpells: any[] = [];
  for (const key of ["cantrips_known", "always_known", "prepared"]) {
    const arr = sp[key];
    if (Array.isArray(arr)) for (const s of arr) if (s && s.name) allSpells.push(s);
  }
  if (allSpells.length) {
    const seen = new Set<string>();
    const uniq = allSpells.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">法术</div>
      <div class="srch-grid">${renderChips(uniq)}</div>
    </div>`);
  }

  return sections.join("");
}

// Single delegated click handler for ALL rollable spans inside the
// card. Reads the bound token id at click time so dice anchor on the
// currently-selected character (falls back to live selection if the
// info popover wasn't opened with one).
async function resolveBoundToken(): Promise<string | null> {
  if (boundItemId) return boundItemId;
  return resolveClickRollTarget();
}

root.addEventListener("click", async (e) => {
  // Search-chip click → fill the cluster's search input so the
  // 5etools popover opens with matching results.
  const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(".srch-chip");
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
    }
    chip.classList.remove("srch-flash");
    void chip.offsetWidth;
    chip.classList.add("srch-flash");
    return;
  }

  // Weapon-property chip click → same flow as the search chips.
  // Sends the property name (轻型 / 灵巧 / 缓速 / etc.) into the
  // global-search popover so the user can read the rule definition.
  const propChip = (e.target as HTMLElement | null)?.closest<HTMLElement>(".prop-chip");
  if (propChip) {
    e.preventDefault();
    e.stopPropagation();
    const q = propChip.dataset.search ?? "";
    if (q) {
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/search-query",
          { q, autoPin: true },
          { destination: "LOCAL" },
        );
      } catch {}
    }
    return;
  }

  // 2026-05-10: rollable left-click is handled by the
  // bindRollableClickPopup binding installed below — opens a quick
  // pick popup (劣势 / 普通 / 优势 + 重击) at the click point.
  // Don't fire any dice-tray prefill here.
});

// Right-click → context menu (投掷 / 优势 / 劣势 / 添加到骰盘).
// Anchors on the bound character token so dice / camera focus are
// consistent with the left-click behavior above.
//
// The cc-info popover is opened from `characterCards/index.ts` with
// anchorPosition = { left: vw − RIGHT_OFFSET, top: anchorTop } and
// anchorOrigin = RIGHT/BOTTOM. That puts the iframe's BOTTOM-RIGHT
// in viewport at (vw − RIGHT_OFFSET, anchorTop), so its TOP-LEFT is
// (vw − RIGHT_OFFSET − innerWidth, anchorTop − innerHeight). Constants
// mirrored from characterCards/index.ts.
const CC_RIGHT_OFFSET = 12;
const CC_BOTTOM_OFFSET = 160;
const CC_INFO_GAP = 8;
const CC_BUTTON_HEIGHT = 48 + 8;
const ccIframeOriginGetter = async () => {
  const [vw, vh] = await Promise.all([
    OBR.viewport.getWidth().catch(() => 1280),
    OBR.viewport.getHeight().catch(() => 720),
  ]);
  const anchorTop = vh - CC_BOTTOM_OFFSET - CC_BUTTON_HEIGHT - CC_INFO_GAP;
  return {
    left: Math.round(vw - CC_RIGHT_OFFSET - window.innerWidth),
    top: Math.round(anchorTop - window.innerHeight),
  };
};
bindRollableContextMenu(
  root,
  () => "open",
  () => resolveBoundToken(),
  ccIframeOriginGetter,
);
// LEFT-click → quick-pick popup (劣势 / 普通 / 优势 + 重击).
bindRollableClickPopup(
  root,
  () => resolveBoundToken(),
  ccIframeOriginGetter,
);

OBR.onReady(async () => {
  installDebugOverlay();
  subscribeToSfx();
  // 2026-05-15 — popover-height ceiling. window.innerHeight inside an
  // OBR popover iframe equals the popover's currently-rendered height
  // (the layout-editor user-resize is already baked in by the time
  // onReady fires). adjustHeight() never grows past this — content
  // longer than the ceiling keeps the inner scrollbar instead of
  // forcing the popover to balloon.
  if (window.innerHeight > 0) INFO_MAX_HEIGHT = window.innerHeight;
  // Cache the player's role BEFORE first render so the DM-only lock
  // button appears on first paint instead of waiting for a re-render.
  try {
    const role = await OBR.player.getRole();
    cachedIsGM = role === "GM";
  } catch {}
  // Initial card from URL — popover is opened on-demand by background.ts
  // with the ids in the query string. While the popover stays open, background
  // broadcasts in-place swaps when a different bound character is selected.
  // Drag grip is rendered inline inside .hdr (rebound after each render).
  try {
    const params = new URLSearchParams(location.search);
    const cardId = params.get("cardId");
    const roomId = params.get("roomId");
    const itemId = params.get("itemId");
    if (itemId) boundItemId = itemId;
    if (cardId && roomId) showCard(cardId, roomId);
  } catch {}

  OBR.broadcast.onMessage(SHOW_MSG, (ev: any) => {
    const p = ev?.data || {};
    // Update the bound-token used by quick-roll clicks (selecting a
    // different character should make rolls anchor on the new token).
    if (typeof p.itemId === "string") boundItemId = p.itemId;
    else if (p.itemId === null) boundItemId = null;
    // 2026-05-12 — dedupe duplicate SHOW_MSG with same card+room
    // (selection-handler-race protection; see monster-info-page.ts).
    if (
      p.cardId === currentCardId &&
      p.roomId === currentRoomId &&
      root.childElementCount > 0
    ) {
      return;
    }
    if (p.cardId && p.roomId) showCard(String(p.cardId), String(p.roomId));
  });

  // Multi-client sync — when another client refreshes / imports the
  // currently-shown card, drop our cache entry and re-fetch so the
  // small popover preview reflects the new data.json without the user
  // needing to re-open the panel.
  OBR.broadcast.onMessage(BC_CARD_UPDATED, (ev: any) => {
    const payload = ev?.data as { cardId?: string } | undefined;
    if (!payload?.cardId) return;
    cardCache.delete(payload.cardId);
    if (currentCardId === payload.cardId && currentRoomId) {
      void showCard(payload.cardId, currentRoomId);
    }
  });

  // The stat banner self-syncs on scene.items.onChange (it's the
  // shared mountStatBanner component now); the resource panel does
  // too. No card-level items.onChange hook needed here anymore.
});
