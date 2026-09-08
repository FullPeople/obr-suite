import OBR from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "../../utils/debugOverlay";
import { ICONS } from "../../icons";
import { resolveClickRollTarget } from "../dice/tags";
import { bindRollableContextMenu, bindRollableClickPopup } from "../dice/context-menu";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import { bindPanelDrag } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import {BUBBLES_META_KEY,EXTERNAL_BUBBLES_META_KEY,type BubblesData} from "../../utils/statEdit";
import { mountResourcePanel } from "../resourceTracker/panel";
import { mountStatBanner } from "../../utils/statBanner";
import { installPanelZoom } from "../../utils/panelZoom";
import {getLocalLang,onLangChange} from "../../state";
import {ccText,ccTerm,ccName,ccUnits,ccProperty,abilityKey,abilityName} from "./localization";
const L=(key:string)=>ccText(key,getLocalLang());
const term=(value:unknown)=>ccTerm(value,getLocalLang());

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
    btn.title = L(next ? "pinned" : "pin");
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
      <button class="rt-tab ${activeRtTab === "attr" ? "on" : ""}" data-rt-tab="attr" type="button">${L("attributes")}</button>
      <button class="rt-tab ${activeRtTab === "res" ? "on" : ""}" data-rt-tab="res" type="button">${L("resources")}</button>
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
  if (!container||!isCurrent(renderedTarget)) return;
  if(rtMountHandle)return;
  const target=renderedTarget!;
  const handle=mountResourcePanel({
    container,
    getItemId: () => isCurrent(target)?target.itemId:null,
  });
  rtMountHandle=handle;
  try{await handle.refresh();}catch(error){if(isCurrent(target))console.warn("[cc-info] resource refresh failed",error);}
  if(!isCurrent(target)||rtMountHandle!==handle)return;
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
  if (_adjustQueued||!alive||!sceneReady) return;
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
  if(!alive||!sceneReady)return;
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
  const title = `${L("nameToggle")}: ${name}`;
  return `<button class="name name-btn" type="button" data-name-text="${escapeHtml(name)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(name)}</button>`;
}

async function toggleTokenNameText(target:InfoTarget, name: string, btn: HTMLButtonElement): Promise<void> {
  const cleanName = name.trim();
  if (!cleanName||!isCurrent(target)||!target.itemId) return;
  const itemId=target.itemId;
  btn.disabled = true;
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    if(!isCurrent(target)||!canNameItem(items[0]))return;
    const current = String((items[0] as any)?.text?.plainText ?? "").trim();
    const next = current === cleanName ? "" : cleanName;
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        if(!isCurrent(target)||!canNameItem(d))return;
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
    if(isCurrent(target)&&btn.isConnected)btn.disabled = false;
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
  const mastM = /(?:精通|(?:weapon\s+)?mastery)\s*[：:]\s*([^,，、/]+)/i.exec(raw);
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
    const searchKey = term(t.replace(/[(（][^)）]*[)）]\s*/g, "").trim() || t);
    out.push(
      `<span class="prop prop-chip" data-search="${escapeHtml(searchKey)}" title="${L("search")}: ${escapeHtml(searchKey)}">${escapeHtml(ccProperty(t,getLocalLang()))}</span>`,
    );
  }
  if (masteryPart) {
    out.push(
      `<span class="prop prop-chip prop-mastery" data-search="${escapeHtml(term(masteryPart.trim()))}" title="${L("searchMastery")}: ${escapeHtml(term(masteryPart.trim()))}"><em>${L("mastery")}</em>${escapeHtml(term(masteryPart.trim()))}</span>`,
    );
  }
  return out.length ? `<span class="prop-row">${out.join("")}</span>` : "";
}

function classesStr(d: any): string {
  if (!Array.isArray(d.classes)) return "";
  return d.classes
    .map((c: any) => {
      const nm = ccName(c,getLocalLang());
      const lv = c.level ?? c.lvl ?? "";
      return `${nm}${lv}`;
    })
    .filter(Boolean)
    .join("/");
}

let currentCardId: string | null = null;
let currentRoomId: string | null = null;
const cardCache = new Map<string, any>();
interface InfoTarget {generation:number;scene:number;cardId:string;roomId:string;itemId:string|null;ownerIds?:string[];canName?:boolean;itemSignature?:string;permissionSignature?:string}
let alive=true,sceneReady=false,sceneGeneration=0,targetGeneration=0,localConnectionId="",playerId="";
let renderedTarget:InfoTarget|null=null,loadingTarget:InfoTarget|null=null,lastRendered:{data:any;live:BubblesData}|null=null;
let requestAbort:AbortController|null=null;
const subscriptions:Array<()=>void>=[];
const cacheKey=(roomId:string,cardId:string)=>JSON.stringify([roomId,cardId]);
// A-B-A changes need a generation as well as identifiers. Shared editors keep
// this captured target and become unusable as soon as a newer request starts.
function isCurrent(target:InfoTarget|null):target is InfoTarget{return !!target&&alive&&sceneReady&&target.generation===targetGeneration&&target.scene===sceneGeneration&&target.cardId===currentCardId&&target.roomId===currentRoomId&&target.itemId===boundItemId;}
function unmountPanels(){rtMountHandle?.unmount();rtMountHandle=null;ccStatHandle?.unmount();ccStatHandle=null;currentDragUnbind?.();currentDragUnbind=null;}
function invalidate(clear=false){targetGeneration++;loadingTarget=null;requestAbort?.abort();requestAbort=null;if(clear){unmountPanels();renderedTarget=null;lastRendered=null;root.replaceChildren();}root.inert=true;}
function canNameItem(item:any):boolean {if(!item||!renderedTarget)return false;if(cachedIsGM)return true;const owners=renderedTarget.ownerIds;return owners?.length?owners.includes(playerId):item.createdUserId===playerId;}
async function targetContext(target:InfoTarget):Promise<{allowed:boolean;live:BubblesData}>{
 const [metadata,items]=await Promise.all([OBR.scene.getMetadata(),target.itemId?OBR.scene.items.getItems([target.itemId]):Promise.resolve([])]);
 const entry=(Array.isArray(metadata["com.character-cards/list"])?metadata["com.character-cards/list"] as any[]:[]).find(c=>c?.id===target.cardId);
 const item=items[0],meta=item?.metadata??{},raw=meta[BUBBLES_META_KEY]??meta[EXTERNAL_BUBBLES_META_KEY];
 const live=raw&&typeof raw==="object"?{...raw as BubblesData}:{};
 target.itemSignature=JSON.stringify([item?.createdUserId,item?.metadata?.["com.character-cards/boundCardId"],live.locked]);
 target.permissionSignature=JSON.stringify([entry?.visibility,entry?.owner_ids]);
 target.ownerIds=Array.isArray(entry?.owner_ids)?entry.owner_ids.filter((id:unknown)=>typeof id==="string"):[];
 target.canName=cachedIsGM||!!item&&(target.ownerIds!.length?target.ownerIds!.includes(playerId):item.createdUserId===playerId);
 if(target.itemId&&(!item||item.metadata?.["com.character-cards/boundCardId"]!==target.cardId))return {allowed:false,live};
 if(cachedIsGM)return {allowed:true,live};
 if(!entry||entry.visibility==="dm"||(entry.visibility==="owners"&&!target.ownerIds!.includes(playerId))||entry.visibility&&!['public','owners'].includes(entry.visibility))return {allowed:false,live};
 const owns=target.ownerIds!.length?target.ownerIds!.includes(playerId):item?.createdUserId===playerId;
 return {allowed:!target.itemId||!!owns||(live.locked===false&&typeof item?.createdUserId==="string"&&!!item.createdUserId),live};
}

// Broadcast id mirrored from panel-page.ts. Receiving this with a
// matching cardId means another client uploaded / refreshed / imported
// the same card, so we should drop our cache and re-fetch.
const BC_CARD_UPDATED = "com.obr-suite/cc-card-updated";

// Cached role lookup. The DM-only lock button at the right end of the
// stat banner reads this. OBR.onReady below populates it before any
// showCard runs, so the very first render already has the right value.
let cachedIsGM = false;

async function showCard(cardId: string, roomId: string, itemId:string|null=boundItemId) {
  if(!alive||!sceneReady||roomId!==(OBR.room.id||"default"))return;
  invalidate();
  currentCardId = cardId;
  currentRoomId = roomId;
  boundItemId=itemId;
  const target:InfoTarget={generation:targetGeneration,scene:sceneGeneration,cardId,roomId,itemId};
  loadingTarget=target;
  const abort=new AbortController();requestAbort=abort;
  root.setAttribute("aria-busy","true");
  if(!root.childElementCount)root.innerHTML=`<div class="loading">${L("loading")}</div>`;
  try {
    const context=await targetContext(target);if(!isCurrent(target))return;
    if(!context.allowed){unmountPanels();renderedTarget=null;lastRendered=null;root.innerHTML=`<div class="err" data-cc-error="unavailable">${L("unavailable")}</div>`;return;}
    let data=cardCache.get(cacheKey(roomId,cardId));
    if(!data){const response=await fetch(`https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`,{cache:"no-store",signal:abort.signal});if(!response.ok)throw Error(`HTTP ${response.status}`);data=await response.json();}
    if(!isCurrent(target))return;
    cardCache.set(cacheKey(roomId,cardId),data);while(cardCache.size>32)cardCache.delete(cardCache.keys().next().value!);renderedTarget=target;lastRendered={data,live:context.live};
    render(data,cardId,roomId,context.live);
  } catch (e: any) {
    if(!isCurrent(target)||abort.signal.aborted)return;
    unmountPanels();renderedTarget=null;lastRendered=null;
    root.innerHTML=`<div class="err" data-cc-error="failed" data-detail="${escapeHtml(e?.message??e)}">${L("failed")}: ${escapeHtml(e?.message??e)}</div><button class="retry-card" type="button">${L("retry")}</button>`;
    root.querySelector(".retry-card")?.addEventListener("click",()=>{void showCard(cardId,roomId,itemId);});
  } finally {
    if(isCurrent(target)){loadingTarget=null;root.inert=false;root.removeAttribute("aria-busy");requestAbort=null;queueAdjustHeight();}
  }
}
function render(d: any, cardId: string, roomId: string, live: BubblesData = {},languageOnly=false) {
  if(!isCurrent(renderedTarget))return;
  const id = d.identity || {};
  const cs = d.core_stats || {};
  const ab = d.abilities || {};
  const cb = d.combat || {};
  const sp = d.spellcasting || {};

  const name = id.display_name || id.character_name || L("unnamed");
  const race = [ccName(id.race,getLocalLang()),term(id.race?.subrace)].filter(Boolean).join("·");
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

  const speedStr = cs.speed != null ? ccUnits(/^[\d.]+$/.test(String(cs.speed))?`${cs.speed}尺`:cs.speed,getLocalLang()) : "?";
  const castAbility = sp.spellcasting_ability ? abilityName(String(sp.spellcasting_ability),getLocalLang()) : "—";

  const statBanner = `<div class="cc-stat-mount" id="cc-stat-mount"></div>`;

  // The remaining read-only chips (HP/AC moved to stat-rows above).
  const chips = `
    <div class="chip init"><span class="k">${L("initiative")}</span><span class="v">${fmtMod(cs.initiative)}</span></div>
    <div class="chip"><span class="k">${L("speed")}</span><span class="v">${escapeHtml(speedStr)}</span></div>
    <div class="chip"><span class="k">${L("passive")}</span><span class="v">${escapeHtml(cs.passive_perception)}</span></div>
    <div class="chip"><span class="k">${L("proficiency")}</span><span class="v">${fmtMod(cs.proficiency_bonus)}</span></div>
    <div class="chip"><span class="k">${L("dc")}</span><span class="v">${escapeHtml(cs.dc)}</span></div>
    <div class="chip"><span class="k">${L("casting")}</span><span class="v">${escapeHtml(castAbility)}</span></div>
  `;

  // Group skills by their ability key — each ability card embeds its own
  // list of associated skills (e.g. DEX card shows 特技/巧手/隐匿).
  const skills = Array.isArray(d.skills) ? d.skills : [];
  const skillsByAbil: Record<string, any[]> = {};
  for (const s of skills) {
    const k = abilityKey(s?.ability);
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
    const lbl = ccName(s,getLocalLang())||"?";
    return `<div class="${cls} rollable" data-expr="${expr}" data-label="${escapeHtml(lbl)}" title="${escapeHtml(lbl)} ${expr}">
      <span class="sk-n">${escapeHtml(lbl)}</span>
      <span class="sk-v">${fmtMod(s.total)}</span>
    </div>`;
  };

  const abl = ORDER
    .map((k) => {
      const a:any = ab[k] || Object.entries(ab).find(([key])=>abilityKey(key)===k)?.[1] || {};
      const prof = !!a.save?.proficient;
      const skList = skillsByAbil[k] ?? [];
      const skHtml = skList.map(renderSkillRow).join("");
      // Ability check: 1d20+modifier. Saving-throw uses the same
      // modifier unless the save has its own bonus stored separately.
      const aMod = typeof a.modifier === "number" ? a.modifier : 0;
      const aExpr = `1d20${aMod >= 0 ? `+${aMod}` : aMod}`;
      const aLbl = `${abilityName(k,getLocalLang())}${getLocalLang()==="en"?" ":""}${L("check")}`;
      // Saving throw — different label, may have its own bonus.
      const saveBonus = typeof a.save?.bonus === "number"
        ? a.save.bonus
        : (a.save?.proficient ? aMod + (cs.proficiency_bonus ?? 0) : aMod);
      const saveExpr = `1d20${saveBonus >= 0 ? `+${saveBonus}` : saveBonus}`;
      const saveLbl = `${abilityName(k,getLocalLang())}${getLocalLang()==="en"?" ":""}${L("save")}`;
      return `<div class="abl${prof ? " prof" : ""}">
        <div class="abl-head">
          <span class="a rollable" data-expr="${saveExpr}" data-label="${escapeHtml(saveLbl)}" title="${escapeHtml(saveLbl)} ${saveExpr}">${abilityName(k,getLocalLang(),true)}</span>
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
    const atkLbl = L("spellAttack");
    weaponRows.push(`<div class="wp spell">
      <span class="n">${L("spellAttacks")}</span>
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
      const propsCombined = masteryPrefix && !/(?:精通|(?:weapon\s+)?mastery)\s*[：:]/i.test(propsRaw)
        ? (propsRaw ? `${propsRaw}, ${masteryPrefix}` : masteryPrefix)
        : propsRaw;
      const prop = propsCombined ? renderWeaponPropertyChips(propsCombined) : "";
      const dmgRaw = [w.damage, term(w.damage_type)].filter(Boolean).join(" ");
      const wpName = ccName(w,getLocalLang()) || "?";
      // Attack roll: parse the leading sign+number from attack_bonus.
      const atkBonusStr = String(w.attack_bonus ?? "").trim();
      const atkM = /([+-]?\s*\d+)/.exec(atkBonusStr);
      const atkBn = atkM ? parseInt(atkM[1].replace(/\s+/g, ""), 10) : 0;
      const atkExpr = `1d20${atkBn >= 0 ? `+${atkBn}` : atkBn}`;
      const atkLbl = `${wpName} ${L("attack")}`;
      // Damage: extract the raw dice expression from `w.damage`. Most
      // entries are like "1d8+3" or "2d6+4" — pass through directly.
      const dmgExprRaw = String(w.damage ?? "").replace(/\s+/g, "");
      const dmgExprMatch = /\d*d\d+([+-]\d+)?/.exec(dmgExprRaw);
      const dmgExpr = dmgExprMatch ? dmgExprMatch[0] : dmgExprRaw;
      const dmgLbl = `${wpName} ${L("damage")}${w.damage_type ? `(${term(w.damage_type)})` : ""}`;
      // 附加伤害骰 — bonus dice (sneak attack, divine smite, etc.).
      // Server attaches `extra_damage` (e.g. "1d8") and
      // `extra_damage_type` (e.g. "辐光").
      //
      // 2026-05-23 — merged into a SINGLE rollable button: clicking
      // the damage now rolls `base + extra` in one go (e.g. 1d6+4+1d6),
      // since the small character panel is a quick-action surface and
      // splitting the click into two felt wrong. The displayed text
      // still shows the extra portion separately (with its damage
      // type) so the player can read what's contributing, but only
      // one chip is clickable. (Note: when base + extra are different
      // damage types, the combined roll is a sum — dice rolling
      // doesn't carry per-die typing; the label still lists both
      // types for the GM.)
      const extraExprRaw = w.extra_damage
        ? String(w.extra_damage).replace(/\s+/g, "")
        : "";
      const combinedExpr = dmgExpr && extraExprRaw
        ? `${dmgExpr}+${extraExprRaw}`
        : dmgExpr || extraExprRaw;
      const combinedLbl = extraExprRaw
        ? `${dmgLbl} + ${w.extra_damage_type ? term(w.extra_damage_type) : L("extra")}`
        : dmgLbl;
      const extraDisplay = extraExprRaw
        ? [w.extra_damage, term(w.extra_damage_type)].filter(Boolean).join(" ")
        : "";
      const extraSuffix = extraExprRaw
        ? ` <span class="dmg-extra-label">+${escapeHtml(extraDisplay)}</span>`
        : "";
      const dmgClickable = combinedExpr
        ? `<span class="rollable" data-expr="${escapeHtml(combinedExpr)}" data-label="${escapeHtml(combinedLbl)}" title="${escapeHtml(combinedLbl)} ${escapeHtml(combinedExpr)}">${escapeHtml(dmgRaw || "?")}${extraSuffix}</span>`
        : escapeHtml(dmgRaw || "?");
      weaponRows.push(`<div class="wp">
        <span class="n">${escapeHtml(wpName)}</span>
        <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${escapeHtml(w.attack_bonus ?? "?")}</span>
        <span class="dmg">${dmgClickable}</span>
        ${prop}
      </div>`);
    }
  }

  const weps = weaponRows.length ? weaponRows.join("") : `<div class="empty">${L("none")}</div>`;

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
    <div class="sect">${ICONS.swords} ${L("weapons")}</div>
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
  const markup = `
    <div class="hdr">
      <button class="reset-btn" id="bubbles-reset-btn" type="button"
        title="${L("reset")}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8 a5 5 0 1 0 1.5 -3.5"/>
          <path d="M3.2 3 V5.5 H5.5"/>
        </svg>
      </button>
      <div class="drag-handle" id="drag-handle" title="${L("drag")}" aria-label="${L("drag")}">
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
        title="${L(pinned ? "pinned" : "pin")}">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.339-.016-.484-.041L7.176 13.04a.5.5 0 0 1-.708 0L3.633 10.207 1.4 12.439a.5.5 0 0 1-.707-.707L2.926 9.5.74 7.314a.5.5 0 0 1 0-.708l1.51-1.51c.41-.41.945-.625 1.482-.711.534-.085 1.139-.097 1.683-.024.546.073 1.169.114 1.643-.04.305-.099.62-.281.94-.602.193-.193.282-.467.348-.749.066-.281.117-.572.196-.793a1.51 1.51 0 0 1 .31-.508c.094-.092.215-.174.357-.232a.5.5 0 0 1 .19-.04Z" fill="currentColor"/>
        </svg>
      </button>
      <div class="name-wrap">
        ${renderNameButton(name, !!boundItemId&&!!renderedTarget.canName)}
      </div>
      <div class="sub">${escapeHtml(sub)}</div>
      <a class="raw-link" href="${rawUrl}" target="_blank" rel="noopener">${L("raw")}</a>
    </div>
    ${stickyTop}
    ${contentBlock}
  `;
  if(languageOnly){
    // Leave editable component roots attached; detaching a focused input would
    // fire blur and could commit a half-written expression.
    const fragment=document.createElement("div");fragment.innerHTML=markup;
    root.querySelector('[data-pane="attr"]')!.innerHTML=attrInner;
    for(const selector of ['.sub','.raw-link','[data-rt-tab="attr"]','[data-rt-tab="res"]']){const next=fragment.querySelector(selector),old=root.querySelector(selector);if(next&&old)old.textContent=next.textContent;}
    for(const selector of ['#bubbles-reset-btn','#drag-handle','#panel-pin-btn','.name']){const next=fragment.querySelector(selector),old=root.querySelector(selector);if(!next||!old)continue;for(const attr of ['title','aria-label']){const value=next.getAttribute(attr);if(value!==null)old.setAttribute(attr,value);}if(selector==='.name')old.textContent=next.textContent;}
    queueAdjustHeight();return;
  }
  unmountPanels();root.innerHTML=markup;
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
      getItemId: (()=>{const target=renderedTarget!;return ()=>isCurrent(target)?target.itemId:null;})(),
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
          { tokenId: isCurrent(renderedTarget)?renderedTarget.itemId:null },
          { destination: "LOCAL" },
        );
      } catch (err) { console.warn("[cc-info] reset broadcast failed", err); }
      resetBtn.classList.add("flash");
      setTimeout(() => resetBtn.classList.remove("flash"), 400);
    });
  }
  const nameBtn = root.querySelector<HTMLButtonElement>(".name-btn[data-name-text]");
  if (nameBtn && boundItemId) {
    const target=renderedTarget;
    nameBtn.addEventListener("click", () => {
      void toggleTokenNameText(target, nameBtn.dataset.nameText || name, nameBtn);
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
      const nm = ccName(x,getLocalLang());
      return `<span class="srch-chip" data-q="${escapeHtml(nm)}">${escapeHtml(nm)}</span>`;
    })
    .join("");

  // 特性 = race_features + class_features (merged into one tight grid).
  const featList: any[] = [];
  if (Array.isArray(features.race_features)) featList.push(...features.race_features);
  if (Array.isArray(features.class_features)) featList.push(...features.class_features);
  if (featList.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">${L("features")}</div>
      <div class="srch-grid">${renderChips(featList)}</div>
    </div>`);
  }

  // 专长 — class feats list.
  if (Array.isArray(features.feats) && features.feats.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">${L("feats")}</div>
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
      <div class="srch-sect-h">${L("spells")}</div>
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
  if(!isCurrent(renderedTarget))return null;
  if (renderedTarget.itemId) return renderedTarget.itemId;
  const target=renderedTarget,result=await resolveClickRollTarget();return isCurrent(target)?result:null;
}

root.addEventListener("click", async (e) => {
  if(!isCurrent(renderedTarget))return;
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
  const anchorBottom = vh - CC_BOTTOM_OFFSET - CC_BUTTON_HEIGHT - CC_INFO_GAP;
  // 2026-05-16 — with TOP-anchored popover the iframe's top stays at
  // anchorPosition.top = anchorBottom - h_open. h_open is captured
  // into INFO_MAX_HEIGHT at OBR.onReady. window.innerHeight tracks
  // the CURRENT (post-setHeight) height which can be smaller, so
  // using it here would drift the rollable / dice menu origin a few
  // dozen pixels off after the popover auto-shrinks. INFO_MAX_HEIGHT
  // is the right constant because it equals the open-time height.
  return {
    left: Math.round(vw - CC_RIGHT_OFFSET - window.innerWidth),
    top: Math.round(anchorBottom - INFO_MAX_HEIGHT),
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

function receiveShow(ev:any){
  if(!alive||ev.connectionId!==localConnectionId)return;
  const p=ev.data??{},itemId=typeof p.itemId==="string"?p.itemId:null;
  if(p.cardId===currentCardId&&p.roomId===currentRoomId&&itemId===boundItemId&&(isCurrent(renderedTarget)||isCurrent(loadingTarget)))return;
  if(typeof p.cardId==="string"&&typeof p.roomId==="string")void showCard(p.cardId,p.roomId,itemId);
}

OBR.onReady(async () => {
  if(!alive)return;
  installDebugOverlay();
  subscribeToSfx();
  // 2026-05-15 — popover-height ceiling. window.innerHeight inside an
  // OBR popover iframe equals the popover's currently-rendered height
  // (the layout-editor user-resize is already baked in by the time
  // onReady fires). adjustHeight() never grows past this — content
  // longer than the ceiling keeps the inner scrollbar instead of
  // forcing the popover to balloon.
  if (window.innerHeight > 0) INFO_MAX_HEIGHT = window.innerHeight;
  // 2026-05-16 — install the shared panel-zoom: scales text / spacing
  // / click targets when the user resizes via the layout editor.
  // Baseline = (INFO_WIDTH, INFO_HEIGHT) from characterCards/index.ts.
  // Uses the MIN of width-ratio and height-ratio so content fits both
  // axes — pulling the panel taller-but-not-wider doesn't make text
  // overflow horizontally.
  subscriptions.push(installPanelZoom({ baseWidth: 320, baseHeight: 260, target: root }));
  // Cache the player's role BEFORE first render so the DM-only lock
  // button appears on first paint instead of waiting for a re-render.
  let roleRevision=0,readyRevision=0;
  const earlyShows=new Map<string,any>();
  subscriptions.push(OBR.broadcast.onMessage(SHOW_MSG,event=>{if(!localConnectionId){earlyShows.set(event.connectionId,event);if(earlyShows.size>16)earlyShows.delete(earlyShows.keys().next().value!);}else receiveShow(event);}));
  subscriptions.push(OBR.player.onChange(player=>{roleRevision++;const next=player.role==="GM";if(next===cachedIsGM)return;cachedIsGM=next;const card=currentCardId,room=currentRoomId,item=boundItemId;invalidate(true);if(card&&room&&sceneReady)void showCard(card,room,item);}),
    OBR.scene.onReadyChange(ready=>{readyRevision++;sceneGeneration++;sceneReady=ready;invalidate(true);cardCache.clear();currentCardId=null;currentRoomId=null;boundItemId=null;if(!ready){root.innerHTML=`<div class="loading">${L("sceneClosed")}</div>`;root.inert=false;}}));
  const roleStart=roleRevision,readyStart=readyRevision;
  try{const [role,id,connection,ready]=await Promise.all([OBR.player.getRole(),OBR.player.getId(),OBR.player.getConnectionId(),OBR.scene.isReady()]);if(!alive)return;if(roleStart===roleRevision)cachedIsGM=role==="GM";if(readyStart===readyRevision)sceneReady=ready;playerId=id;localConnectionId=connection;}catch{if(alive){root.innerHTML=`<div class="err" data-cc-error="unavailable">${L("unavailable")}</div>`;}return;}
  // Initial card from URL — popover is opened on-demand by background.ts
  // with the ids in the query string. While the popover stays open, background
  // broadcasts in-place swaps when a different bound character is selected.
  // Drag grip is rendered inline inside .hdr (rebound after each render).
  try {
    const params = new URLSearchParams(location.search);
    const cardId = params.get("cardId");
    const roomId = params.get("roomId");
    const itemId = params.get("itemId");
    const latest=earlyShows.get(localConnectionId);earlyShows.clear();
    if(latest)receiveShow(latest);else if (cardId && roomId) void showCard(cardId, roomId,itemId);
  } catch {}
  // The background may have changed targets while this iframe was loading.
  // Replay its current authorized target after our LOCAL listener is ready.
  if(alive)void OBR.broadcast.sendMessage("com.character-cards/info-ready",{}, {destination:"LOCAL"}).catch(()=>{});

  // Multi-client sync — when another client refreshes / imports the
  // currently-shown card, drop our cache entry and re-fetch so the
  // small popover preview reflects the new data.json without the user
  // needing to re-open the panel.
  subscriptions.push(OBR.broadcast.onMessage(BC_CARD_UPDATED, (ev: any) => {
    if(!alive||!sceneReady)return;
    const payload = ev?.data as { cardId?: string;roomId?:string } | undefined;
    if (!payload?.cardId) return;
    const roomId=payload.roomId||OBR.room.id||"default";if(roomId!==(OBR.room.id||"default"))return;
    cardCache.delete(cacheKey(roomId,payload.cardId));
    if (currentCardId === payload.cardId && currentRoomId) {
      void showCard(payload.cardId, currentRoomId);
    }
  }),OBR.scene.onMetadataChange(metadata=>{
    const target=loadingTarget??renderedTarget;if(!isCurrent(target))return;
    const entry=(Array.isArray(metadata["com.character-cards/list"])?metadata["com.character-cards/list"] as any[]:[]).find(c=>c?.id===target.cardId);
    if(JSON.stringify([entry?.visibility,entry?.owner_ids])!==target.permissionSignature){invalidate(true);void showCard(target.cardId,target.roomId,target.itemId);}
  }),OBR.scene.items.onChange(items=>{
    const target=loadingTarget??renderedTarget;if(!isCurrent(target)||!target.itemId)return;
    const item=items.find(item=>item.id===target.itemId),meta=item?.metadata??{},live=(meta[BUBBLES_META_KEY]??meta[EXTERNAL_BUBBLES_META_KEY]) as BubblesData|undefined;
    if(JSON.stringify([item?.createdUserId,meta["com.character-cards/boundCardId"],live?.locked])!==target.itemSignature){invalidate(true);void showCard(target.cardId,target.roomId,target.itemId);}
  }));

  // Shared editors own value updates; this subscription only handles a changed
  // token binding/owner/lock so ordinary HP writes do not rebuild the card.
});

function localize(){document.documentElement.lang=getLocalLang()==="en"?"en":"zh-CN";document.title=L("title");if(lastRendered&&isCurrent(renderedTarget))render(lastRendered.data,renderedTarget.cardId,renderedTarget.roomId,lastRendered.live,true);else{const loading=root.querySelector(".loading");if(loading)loading.textContent=L(sceneReady?"loading":"sceneClosed");const error=root.querySelector<HTMLElement>("[data-cc-error]");if(error)error.textContent=`${L(error.dataset.ccError!)}${error.dataset.detail?`: ${error.dataset.detail}`:""}`;const retry=root.querySelector(".retry-card");if(retry)retry.textContent=L("retry");}}
subscriptions.push(onLangChange(localize));localize();
window.addEventListener("pagehide",()=>{alive=false;sceneReady=false;sceneGeneration++;invalidate(true);for(const off of subscriptions.splice(0)){try{off();}catch{}}cardCache.clear();});
