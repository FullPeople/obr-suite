import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../state";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import {
  PANEL_IDS,
  getPanelOffset,
  getPanelSize,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type DragEndPayload,
} from "../../utils/panelLayout";

// Character-card info popover bbox — RIGHT/BOTTOM anchor. Always
// returns the expected bbox so the layout editor can render a
// proxy for it regardless of whether a card is currently bound.
registerPanelBbox(PANEL_IDS.ccInfo, async () => {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const buttonTop = vh - (BOTTOM_OFFSET + 48 + 8);
    const anchorTop = buttonTop - INFO_GAP;
    const userOff = getPanelOffset(PANEL_IDS.ccInfo);
    const sizeOverride = getPanelSize(PANEL_IDS.ccInfo);
    const w = sizeOverride?.width ?? INFO_WIDTH;
    const h = sizeOverride?.height ?? INFO_HEIGHT;
    const anchorRight = vw - RIGHT_OFFSET + userOff.dx;
    const anchorBottom = anchorTop + userOff.dy;
    return {
      left: anchorRight - w,
      top: anchorBottom - h,
      width: w,
      height: h,
    };
  } catch { return null; }
});

// Character Cards module — migrated from the standalone plugin.
//
// Components:
//   1. Main panel — sized modal opened by the toolbar or a local
//      panel-open message.
//   2. Info popover — small floating preview that opens above the main
//      button when a bound character token is selected. DM + players see
//      it (subject to the auto-info localStorage toggle, which the
//      cluster's "角色卡悬浮" toggle also writes to).
//   3. Bind modal — opened from the right-click context menu (GM only),
//      lets the GM bind/rebind/unbind a card to a character token.
//
// The "controls" popover from the standalone plugin (the two popup
// toggles) is intentionally NOT migrated — those toggles already live
// in the suite cluster.

const PLUGIN_ID = "com.character-cards"; // backward-compat for scene metadata + broadcasts
// The main panel uses OBR.modal (NOT popover) so it opens/closes
// instantly without popover's built-in fade-in/fade-out transition.
// disablePointerEvents stays false so the panel buttons work.
const PANEL_MODAL_ID = "com.obr-suite/cc-panel";
const INFO_POPOVER_ID = "com.obr-suite/cc-info";
const BIND_MODAL_ID = "com.obr-suite/cc-bind-picker";
const PANEL_URL = assetUrl("cc-panel.html");
const INFO_URL = assetUrl("cc-info.html");
const BIND_URL = assetUrl("cc-bind.html");
const ICON_URL = assetUrl("cc-icon.svg");

const BIND_META = `${PLUGIN_ID}/boundCardId`;
const SCENE_META_KEY = `${PLUGIN_ID}/list`;
const BUBBLES_META_KEY = "com.obr-suite/bubbles/data";
const EXTERNAL_BUBBLES_META_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";
const INIT_DEXMOD_META = "com.initiative-tracker/dexMod";
const AUTO_INFO_KEY = "character-cards/auto-info";
const TOGGLE_MSG = `${PLUGIN_ID}/auto-info-toggled`;
const INFO_SHOW_MSG = `${PLUGIN_ID}/info-show`;
const CTX_BIND = "com.obr-suite/cc-bind-menu";

// 2026-05-14 — BC_CARD_UPDATED is broadcast by panel-page (xlsx
// upload / refresh) and fullscreen-page (JSON import). When we
// receive it we propagate the new card stats to every token bound
// to that cardId, so the bubbles overlay + initiative dex-mod stay
// in sync without the user manually re-binding. CURRENT HP is left
// alone — mid-session HP edits shouldn't be wiped by a passive
// refresh.
const BC_CARD_UPDATED = "com.obr-suite/cc-card-updated";
const SERVER_ORIGIN = "https://obr.dnd.center";

// Standalone TOOL id — a top-level button in OBR's tool toolbar
// (alongside Move / Select / Measure / …), NOT an action nested
// under another tool. Its onClick returns false so clicking it just
// toggles the character-card panel without switching the active
// tool. Replaces the old suite-cluster "角色卡界面" button.
const CC_TOOL_ID = "com.obr-suite/cc-panel-tool";

const BOTTOM_OFFSET = 160;
const RIGHT_OFFSET = 12;
const INFO_WIDTH = 320;
// 2026-05-15 — was 360. Reduced to 260 because info-page.ts now
// auto-shrinks to the actual content height after first render, and
// most cards measure ~180-240 px. The smaller default means the
// first paint (before adjustHeight lands) doesn't block as much
// canvas. setHeight can still grow to the user's saved size on a
// resized popover; this is just the un-resized default.
const INFO_HEIGHT = 260;
const INFO_GAP = 8;

const unsubs: Array<() => void> = [];
let infoPopoverOpen = false;
let currentInfoCard: string | null = null;
// Panel open-state is tracked in localStorage (shared across this
// client's same-origin iframes), NOT a cached boolean. The panel
// iframe clears the key on EVERY close path — including OBR's
// click-outside close, which only fires pagehide/beforeunload, where a
// synchronous localStorage write lands reliably but an async OBR
// broadcast does not. That async-broadcast unreliability was the root
// of the long-standing "click the tool twice to reopen" bug.
const PANEL_OPEN_KEY = "com.obr-suite/cc-panel-open";
function isPanelOpen(): boolean {
  try { return localStorage.getItem(PANEL_OPEN_KEY) === "1"; } catch { return false; }
}
let ccMyId = "";
let ccRole: "GM" | "PLAYER" = "PLAYER";
let ccConnectionId = "";
let active = false, sceneReady = false, generation = 0, sceneGeneration = 0, selectionGeneration = 0;
let playerRevision = 0, metadataRevision = 0;
let selectedIds: string[] = [];
interface CardEntry { id: string; visibility?: string; owner_ids?: string[] }
interface InfoTarget { cardId: string; roomId: string; itemId: string | null }
let cards = new Map<string, CardEntry>();
const observedItems = new Map<string, Item>();
let desiredInfo: InfoTarget | null = null, reanchorInfo = false, openedInfoUrl = "";
let infoQueue: Promise<void> | null = null, infoRequested = false;
let mainQueue: Promise<void> | null = null, mainRequested = false, desiredMain = false;
const refreshes = new Map<string, AbortController>();
const INFO_READY_MSG = `${PLUGIN_ID}/info-ready`;
const PIN_CHANGED_MSG = "com.obr-suite/cc-info-pin-changed";
const current = (run: number, scene: number) => active && sceneReady && generation === run && sceneGeneration === scene;
const localEvent = (sender: string) => active && !!ccConnectionId && sender === ccConnectionId;
function setCards(metadata: Record<string, unknown>): void {
  const list = metadata[SCENE_META_KEY];
  cards = new Map(Array.isArray(list) ? list.filter((entry: any) => entry && typeof entry.id === "string").map((entry: CardEntry) => [entry.id, entry]) : []);
}
function mayShow(item: Item | undefined, cardId: string): boolean {
  const entry = cards.get(cardId);
  if (!item || item.metadata[BIND_META] !== cardId || !entry) return false;
  if (ccRole === "GM") return true;
  const owners = Array.isArray(entry.owner_ids) ? entry.owner_ids : [];
  if (entry.visibility === "dm" || entry.visibility === "owners" && !owners.includes(ccMyId) ||
      entry.visibility && !["public", "owners"].includes(entry.visibility)) return false;
  const owns = owners.length ? owners.includes(ccMyId) : item.createdUserId === ccMyId;
  const bubbles = (item.metadata[BUBBLES_META_KEY] ?? item.metadata[EXTERNAL_BUBBLES_META_KEY]) as { locked?: unknown } | undefined;
  return owns || bubbles?.locked === false && typeof item.createdUserId === "string" && !!item.createdUserId;
}
function itemPermissionSignature(item: Item | undefined): string {
  const bubbles = (item?.metadata[BUBBLES_META_KEY] ?? item?.metadata[EXTERNAL_BUBBLES_META_KEY]) as { locked?: unknown } | undefined;
  return JSON.stringify([item?.id, item?.createdUserId, item?.metadata[BIND_META], bubbles?.locked]);
}
function revokeInvalidInfo(): void {
  if (desiredInfo?.itemId && !mayShow(observedItems.get(desiredInfo.itemId), desiredInfo.cardId)) void closeInfoPopover();
}

function isAutoInfoEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_INFO_KEY) === "1";
  } catch { return false; }
}

// The main panel opens as a SIZED modal (NOT fullScreen), leaving a
// gap on each side so OBR's left tool toolbar stays visible and
// clickable while the panel is open — the panel is now launched from
// a toolbar action, and the user wants the toolbar reachable
// underneath (this is the pattern a future big status/resource stats
// panel will reuse). OBR's Modal type exposes only width/height (no
// inset/position), and modals are centred, so the gap is symmetric
// left+right; `hideBackdrop` keeps those side strips interactive.
//
// 2026-05-16 — MUI gotcha. `hidePaper: true` only hides the visual
// paper styling (background, shadow) — the `MuiDialog-paper` element
// is still present and still carries MUI's default
// `maxHeight: calc(100% - 64px)`. If we ask OBR for height = vh, the
// iframe is sized to vh but the Paper clamps to vh-64; iframe taller
// than Paper → Paper scrolls (= the "div.panel 919 但内容溢出 →
// 外滚动条" the user reported even though our internal CSS had
// overflow:hidden everywhere). The 64px is split as 32 top + 32
// bottom by MUI's vertical centering, so the same effect applies
// horizontally — width clamps to vw-64 if we asked for vw.
// Subtract MUI's margin BEFORE handing the size to OBR so the
// iframe matches Paper exactly and nothing scrolls.
const PANEL_SIDE_GAP = 64;
const MUI_DIALOG_MARGIN = 64;
async function performOpenMain() {
  const run = generation, scene = sceneGeneration;
  try {
    let vw = 1280;
    let vh = 800;
    try {
      [vw, vh] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
    } catch { /* viewport read failed — fall back to sane defaults */ }
    if (!current(run, scene) || !desiredMain) return;
    // 2026-05-16 — width already shrinks by PANEL_SIDE_GAP * 2 = 128,
    // which is wider than MUI's 64 horizontal margin so the side
    // toolbar stays visible AND the width fits MUI's max. Height
    // needs the MUI_DIALOG_MARGIN subtracted to match Paper's max.
    await OBR.modal.open({
      id: PANEL_MODAL_ID,
      url: PANEL_URL,
      width: Math.max(360, Math.round(vw) - PANEL_SIDE_GAP * 2),
      height: Math.max(240, Math.round(vh) - MUI_DIALOG_MARGIN),
      hideBackdrop: true, // no dark overlay → the side gaps stay interactive
      hidePaper: true,    // no Material paper background / shadow
      // disablePointerEvents stays default (false) — panel buttons need clicks
    });
    try { localStorage.setItem(PANEL_OPEN_KEY, "1"); } catch {}
  } catch (e) {
    console.error("[obr-suite/character-cards] openMainPopover failed", e);
  }
}

function syncMainPanel(): Promise<void> {
  mainRequested = true;
  if (mainQueue) return mainQueue;
  mainQueue = (async () => {
    while (true) {
      mainRequested = false;
      if (!active || !sceneReady || !desiredMain) {
        if (!isPanelOpen()) return;
        try { await OBR.modal.close(PANEL_MODAL_ID); } catch { return; }
        try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
        continue;
      }
      if (isPanelOpen()) return;
      await performOpenMain();
      if (active && sceneReady && desiredMain && !isPanelOpen()) return;
    }
  })().finally(() => { mainQueue = null; if (mainRequested) void syncMainPanel(); });
  return mainQueue;
}
async function openMainPopover() { if (!active || !sceneReady) return; desiredMain = true; await syncMainPanel(); }
async function closeMainPopover() { desiredMain = false; await syncMainPanel(); }
async function toggleMainPanel() {
  if (!active || !sceneReady) return;
  desiredMain = mainQueue ? !desiredMain : !isPanelOpen(); await syncMainPanel();
}

async function openInfoPopoverFor(cardId: string, roomId: string, itemId: string | null) {
  const run = generation, scene = sceneGeneration, target = desiredInfo;
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    if (!current(run, scene) || desiredInfo !== target || !target) return;
    const buttonTop = vh - (BOTTOM_OFFSET + 48 + 8);
    // `desiredBottom` is the screen-y the popover SHOULD bottom-out at
    // (the inset above the action button). With BOTTOM anchor we passed
    // this as `anchorPosition.top` directly; with TOP anchor (used here
    // since 2026-05-16) we compute the TOP from it: top = bottom - h.
    const desiredBottom = buttonTop - INFO_GAP;
    const itemParam = itemId ? `&itemId=${encodeURIComponent(itemId)}` : "";
    const userOff = getPanelOffset(PANEL_IDS.ccInfo);
    const sizeOverride = getPanelSize(PANEL_IDS.ccInfo);
    const w = sizeOverride?.width ?? INFO_WIDTH;
    const h = sizeOverride?.height ?? INFO_HEIGHT;
    openedInfoUrl ||= `${INFO_URL}?cardId=${encodeURIComponent(cardId)}&roomId=${encodeURIComponent(roomId)}${itemParam}`;
    // 2026-05-16 — switched to TOP-anchored vertical alignment so the
    // popover's TOP edge stays fixed when info-page.ts auto-shrinks it
    // via OBR.popover.setHeight (e.g. when switching tabs to a shorter
    // pane). Previously the BOTTOM was fixed and a shrink visibly
    // pulled the top down ("突兀变下面去了" — user). The initial open
    // is at the same visual position as before because we compute
    // `top = desiredBottom - h` so the open-time bottom still lands
    // at `desiredBottom`. Later shrinks keep the top put and let the
    // bottom move up instead.
    await OBR.popover.open({
      id: INFO_POPOVER_ID,
      url: openedInfoUrl,
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: {
        left: vw - RIGHT_OFFSET + userOff.dx,
        top: desiredBottom - h + userOff.dy,
      },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    infoPopoverOpen = true;
  } catch (e) {
    console.error("[obr-suite/character-cards] openInfoPopoverFor failed", e);
  }
}

async function closeInfoPopover() {
  desiredInfo = null; currentInfoCard = null;
  await syncInfoPanel();
}

async function showInfoFor(cardId: string, itemId: string | null = null) {
  if (!active || !sceneReady || !itemId || !mayShow(observedItems.get(itemId), cardId)) return;
  if (desiredInfo?.cardId === cardId && desiredInfo.itemId === itemId && infoPopoverOpen) return;
  desiredInfo = { cardId, roomId: OBR.room.id || "default", itemId };
  currentInfoCard = cardId;
  await syncInfoPanel(); await sendInfoTarget();
}
async function sendInfoTarget() {
  const target = desiredInfo;
  if (!active || !sceneReady || !infoPopoverOpen || !target?.itemId || !mayShow(observedItems.get(target.itemId), target.cardId)) return;
  try { await OBR.broadcast.sendMessage(INFO_SHOW_MSG, { ...target }, { destination: "LOCAL" }); } catch {}
}
function syncInfoPanel(): Promise<void> {
  infoRequested = true;
  if (infoQueue) return infoQueue;
  infoQueue = (async () => {
    while (true) {
      infoRequested = false;
      if (!active || !sceneReady || !desiredInfo) {
        if (!infoPopoverOpen) { openedInfoUrl = ""; return; }
        try { await OBR.popover.close(INFO_POPOVER_ID); } catch { return; }
        infoPopoverOpen = false; openedInfoUrl = "";
        continue;
      }
      if (infoPopoverOpen && !reanchorInfo) return;
      reanchorInfo = false;
      const target = desiredInfo;
      await openInfoPopoverFor(target.cardId, target.roomId, target.itemId);
      if (desiredInfo !== target) continue;
      if (!infoPopoverOpen) return;
      await sendInfoTarget();
    }
  })().finally(() => { infoQueue = null; if (infoRequested) void syncInfoPanel(); });
  return infoQueue;
}

async function hideInfo() {
  // 2026-05-10: when the user has pinned the panel via the new
  // panel-pin button, selection-driven close is suppressed. Explicit
  // closes (closeInfoPopover via panel-close action, scene unload)
  // still go through.
  if (isCcInfoPinned()) return;
  if (!infoPopoverOpen && currentInfoCard === null) return;
  await closeInfoPopover();
}

const LS_CC_INFO_PINNED = "obr-suite/cc-info-pinned";
function isCcInfoPinned(): boolean {
  try { return localStorage.getItem(LS_CC_INFO_PINNED) === "1"; } catch { return false; }
}

async function handleSelection(selection: string[] | undefined, snapshot?: Item | null) {
  selectedIds = [...(selection ?? [])];
  const request = ++selectionGeneration, run = generation, scene = sceneGeneration;
  const valid = () => current(run, scene) && selectionGeneration === request;
  if (!valid()) return;
  revokeInvalidInfo();
  if (!isAutoInfoEnabled()) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  if (!selection || selection.length !== 1) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  let item: Item | undefined;
  const itemId = selection[0];
  try {
    item = snapshot === undefined ? (await OBR.scene.items.getItems([itemId]))[0] : snapshot ?? undefined;
  } catch { return; }
  if (!valid()) return;
  if (item) observedItems.set(itemId, item); else observedItems.delete(itemId);
  for (const id of observedItems.keys()) if (id !== itemId && id !== desiredInfo?.itemId) observedItems.delete(id);
  const boundId = item?.metadata[BIND_META];
  if (!boundId) {
    if (desiredInfo?.itemId === itemId) await closeInfoPopover();
    else if (currentInfoCard) await hideInfo();
    return;
  }
  if (typeof boundId !== "string" || !mayShow(item, boundId)) {
    if (desiredInfo?.itemId === itemId) await closeInfoPopover();
    if (currentInfoCard) await hideInfo();
    return;
  }
  await showInfoFor(boundId, itemId);
}

// 2026-05-14 — fetch the minimal card stats we need to push to bound
// tokens after a refresh / import / save. Server URL pattern mirrors
// `bind-page.ts`. Returns null on any failure (network, parse, missing
// fields) so callers can early-return without writing stale data.
async function fetchCardSnapshot(cardId: string, room: string, signal: AbortSignal): Promise<{
  maxHp: number | null;
  ac: number | null;
  initBonus: number | null;
} | null> {
  try {
    const roomId = room.replace(/[^a-zA-Z0-9_-]/g, "_");
    const url = `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`;
    // cache:'no-store' so multi-edit roundtrips don't see the previous
    // version sitting in HTTP cache. The data.json is small (typically
    // < 50 KB) so the per-edit fetch is cheap.
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) return null;
    const d = await res.json();
    const cs = d?.core_stats || {};
    const hp = cs.hp || {};
    return {
      maxHp: typeof hp.max === "number" && Number.isFinite(hp.max) ? hp.max : null,
      ac: typeof cs.ac === "number" && Number.isFinite(cs.ac) ? cs.ac : null,
      initBonus: typeof cs.initiative === "number" && Number.isFinite(cs.initiative) ? cs.initiative : null,
    };
  } catch {
    return null;
  }
}

// Find every token bound to `cardId` and push the refreshed stats
// (max HP / AC / initiative dex-mod) into their metadata. CURRENT HP
// is preserved — see comment at BC_CARD_UPDATED above. GM-only, because
// the GM has write access to every bound token regardless of who owns
// it; players run their own copies of this listener but bail at the
// role gate so we don't fight over the same writes.
async function propagateCardRefresh(cardId: string): Promise<void> {
  if (!active || !sceneReady || ccRole !== "GM" || !cards.has(cardId)) return;
  const run = generation, scene = sceneGeneration, room = OBR.room.id || "default";
  const abort = new AbortController(); refreshes.get(cardId)?.abort(); refreshes.set(cardId, abort);
  const finish = () => { if (refreshes.get(cardId) === abort) refreshes.delete(cardId); };
  const valid = () => current(run, scene) && ccRole === "GM" && (OBR.room.id || "default") === room && refreshes.get(cardId) === abort && !abort.signal.aborted && cards.has(cardId);
  const snap = await fetchCardSnapshot(cardId, room, abort.signal);
  if (!snap || !valid()) { finish(); return; }
  // No-op if nothing meaningful to push (server returned a parseable
  // but empty data.json — avoids spurious metadata churn).
  if (snap.maxHp == null && snap.ac == null && snap.initBonus == null) { finish(); return; }
  try {
    const boundTokens = await OBR.scene.items.getItems(
      (it: any) =>
        (it.metadata as Record<string, unknown> | undefined)?.[BIND_META] === cardId,
    );
    if (!valid() || boundTokens.length === 0) return;
    const ids = boundTokens.map((it: any) => it.id);
    await OBR.scene.items.updateItems(ids, (drafts: any[]) => {
      for (const d of drafts) {
        if (!valid() || d.metadata[BIND_META] !== cardId) continue;
        // Bubbles seed: merge new max/ac into whichever shape already
        // exists on the token (suite key takes priority, fall through
        // to legacy Stat-Bubbles external key). Preserves all other
        // bubble fields (current hp, temp hp, hide flag, lock flag).
        const cur = d.metadata[BUBBLES_META_KEY] as Record<string, unknown> | undefined;
        const ext = d.metadata[EXTERNAL_BUBBLES_META_KEY] as Record<string, unknown> | undefined;
        const existing = cur ?? ext ?? {};
        const next: Record<string, unknown> = { ...existing };
        if (snap.maxHp != null) next["max health"] = snap.maxHp;
        if (snap.ac != null) next["armor class"] = snap.ac;
        if (!("temporary health" in next)) next["temporary health"] = 0;
        d.metadata[BUBBLES_META_KEY] = next;
        if (d.metadata[EXTERNAL_BUBBLES_META_KEY] != null) {
          d.metadata[EXTERNAL_BUBBLES_META_KEY] = { ...ext, ...next };
        }
        if (snap.initBonus != null) {
          d.metadata[INIT_DEXMOD_META] = snap.initBonus;
        }
      }
    });
  } catch (e) {
    console.warn("[obr-suite/character-cards] propagateCardRefresh failed", e);
  } finally { finish(); }
}

async function refreshSceneState(): Promise<void> {
  const run = generation, scene = sceneGeneration, metaVersion = metadataRevision, selectionVersion = selectionGeneration;
  try {
    const [metadata, selection] = await Promise.all([OBR.scene.getMetadata(), OBR.player.getSelection()]);
    if (!current(run, scene)) return;
    if (metadataRevision === metaVersion) setCards(metadata);
    if (selectionGeneration === selectionVersion) await handleSelection(selection);
    else await handleSelection(selectedIds, observedItems.get(selectedIds[0]));
  } catch { /* A later ready/metadata/selection event can retry unavailable state. */ }
}

export async function setupCharacterCards(): Promise<void> {
  if (active) return;
  active = true; const run = ++generation;
  sceneReady = false; ccRole = "PLAYER"; ccMyId = ""; ccConnectionId = "";
  const alive = () => active && generation === run;
  const en = getLocalLang() === "en";
  const roleVersion = playerRevision, readyVersion = sceneGeneration;
  unsubs.push(
    OBR.player.onChange(player => {
      if (!alive()) return;
      playerRevision++;
      ccRole = player.role === "GM" ? "GM" : "PLAYER";
      if (ccRole !== "GM") { for (const abort of refreshes.values()) abort.abort(); refreshes.clear(); }
      ccMyId = player.id;
      if (player.connectionId) ccConnectionId = player.connectionId;
      revokeInvalidInfo();
      void handleSelection(player.selection).catch(() => {});
    }),
    OBR.scene.onReadyChange(ready => {
      if (!alive()) return;
      sceneGeneration++; selectionGeneration++; metadataRevision++; sceneReady = ready;
      for (const abort of refreshes.values()) abort.abort();
      refreshes.clear(); cards.clear(); observedItems.clear();
      void closeInfoPopover(); void closeMainPopover();
      void OBR.modal.close(BIND_MODAL_ID).catch(() => {});
      if (ready) void refreshSceneState();
    }),
    OBR.scene.onMetadataChange(metadata => {
      if (!alive() || !sceneReady) return;
      metadataRevision++; setCards(metadata); revokeInvalidInfo();
      void handleSelection(selectedIds, observedItems.get(selectedIds[0])).catch(() => {});
    }),
    OBR.scene.items.onChange(items => {
      if (!alive() || !sceneReady) return;
      const selected = selectedIds.length === 1 ? selectedIds[0] : null;
      const interested = new Set([selected, desiredInfo?.itemId].filter((id): id is string => !!id));
      let changed = false;
      for (const id of interested) {
        const before = observedItems.get(id), next = items.find(item => item.id === id);
        if (itemPermissionSignature(before) !== itemPermissionSignature(next)) changed = true;
        if (next) observedItems.set(id, next); else observedItems.delete(id);
      }
      if (!changed) return;
      revokeInvalidInfo();
      void handleSelection(selectedIds, selected ? observedItems.get(selected) ?? null : null).catch(() => {});
    }),
    OBR.broadcast.onMessage("com.character-cards/panel-open", event => { if (alive() && localEvent(event.connectionId)) void openMainPopover(); }),
    OBR.broadcast.onMessage("com.obr-suite/cc-shortcut-toggle", event => { if (alive() && localEvent(event.connectionId)) void toggleMainPanel(); }),
    OBR.broadcast.onMessage(TOGGLE_MSG, event => { if (alive() && localEvent(event.connectionId)) void handleSelection(selectedIds, observedItems.get(selectedIds[0])); }),
    OBR.broadcast.onMessage(PIN_CHANGED_MSG, event => { if (alive() && localEvent(event.connectionId)) { revokeInvalidInfo(); void handleSelection(selectedIds, observedItems.get(selectedIds[0])); } }),
    OBR.broadcast.onMessage(INFO_READY_MSG, event => { if (alive() && localEvent(event.connectionId)) void sendInfoTarget(); }),
    OBR.broadcast.onMessage(BC_CARD_UPDATED, event => {
      if (!alive() || !sceneReady) return;
      const data = event.data as { cardId?: unknown; roomId?: unknown } | undefined;
      if (typeof data?.cardId !== "string" || !data.cardId || data.cardId.length > 160 ||
          data.roomId !== undefined && data.roomId !== (OBR.room.id || "default")) return;
      // Remote refresh notifications are intentional. They carry no trusted
      // stats/URL: the GM reads this room's server snapshot and rechecks binding.
      void propagateCardRefresh(data.cardId);
    }),
  );

  try {
    const [role, id, connection, ready] = await Promise.all([OBR.player.getRole(), OBR.player.getId(), OBR.player.getConnectionId(), OBR.scene.isReady()]);
    if (!alive()) return;
    if (roleVersion === playerRevision) { ccRole = role === "GM" ? "GM" : "PLAYER"; ccMyId = id; ccConnectionId = connection; }
    if (readyVersion === sceneGeneration) sceneReady = ready;
  } catch { if (!alive()) return; }

  try {
    await OBR.tool.create({
      id: CC_TOOL_ID, shortcut: "CapsLock",
      icons: [{ icon: ICON_URL, label: en ? "Character sheet" : "角色卡界面" }],
      onClick: async () => { if (alive()) await toggleMainPanel(); return false; },
    });
    if (!alive()) { await OBR.tool.remove(CC_TOOL_ID); return; }
    await OBR.contextMenu.create({
      id: CTX_BIND,
      icons: [{ icon: ICON_URL, label: en ? "Bind character card" : "绑定角色卡",
        filter: { roles: ["GM"], every: [{ key: "type", value: "IMAGE" }, { key: "layer", value: "CHARACTER" }], max: 1 } }],
      onClick: async context => {
        if (!alive() || !sceneReady || ccRole !== "GM" || context.items.length !== 1) return;
        const id = context.items[0]?.id, scene = sceneGeneration;
        if (!id) return;
        try {
          const [role, items] = await Promise.all([OBR.player.getRole(), OBR.scene.items.getItems([id])]);
          if (!current(run, scene) || ccRole !== "GM" || role !== "GM" || items[0]?.type !== "IMAGE" || items[0]?.layer !== "CHARACTER") return;
          await OBR.modal.open({ id: BIND_MODAL_ID, url: BIND_URL + "?itemId=" + encodeURIComponent(id), width: 360, height: 480 });
          if (!current(run, scene) || ccRole !== "GM") await OBR.modal.close(BIND_MODAL_ID);
        } catch (error) { if (alive()) console.warn("[character-cards] bind entry failed", error); }
      },
    });
    if (!alive()) { await OBR.contextMenu.remove(CTX_BIND); return; }
  } catch (error) { if (alive()) console.warn("[character-cards] entry registration failed", error); }

  const reanchor = () => {
    if (!alive() || !sceneReady || !desiredInfo || !infoPopoverOpen) return;
    reanchorInfo = true; void syncInfoPanel();
  };
  if (!alive()) return;
  unsubs.push(onViewportResize(reanchor),
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, event => {
      if (!localEvent(event.connectionId)) return;
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId === PANEL_IDS.ccInfo) reanchor();
    }),
    OBR.broadcast.onMessage(BC_PANEL_RESET, event => { if (localEvent(event.connectionId)) reanchor(); }),
  );
  if (sceneReady) await refreshSceneState();
}

export async function teardownCharacterCards(): Promise<void> {
  active = false; sceneReady = false; generation++; sceneGeneration++; selectionGeneration++; metadataRevision++;
  for (const abort of refreshes.values()) abort.abort();
  refreshes.clear();
  for (const off of unsubs.splice(0)) off();
  await Promise.all([closeMainPopover(), closeInfoPopover()]);
  try { await OBR.modal.close(BIND_MODAL_ID); } catch {}
  try { await OBR.contextMenu.remove(CTX_BIND); } catch {}
  try { await OBR.tool.remove(CC_TOOL_ID); } catch {}
  cards.clear(); observedItems.clear(); selectedIds = []; ccConnectionId = "";
}
