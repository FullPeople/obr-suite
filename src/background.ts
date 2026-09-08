import OBR from "@owlbear-rodeo/sdk";
import { startSceneSync, refreshFromScene, getState, onStateChange, onStateRefreshed, onStateRefreshFailed, getLocalLang } from "./state";
import { ModuleLifecycle, SceneModuleCoordinator, type ModuleHooks } from "./utils/moduleLifecycle";
import { BC_MODULE_STATUS, BC_MODULE_STATUS_QUERY, BC_MODULE_RETRY } from "./utils/moduleLifecycleProtocol";
import { setupTimeStop, teardownTimeStop } from "./modules/timeStop";
import { setupFocus, teardownFocus } from "./modules/focus";
import { setupSearch, teardownSearch } from "./modules/search";
import { setupInitiative, teardownInitiative } from "./modules/initiative";
import { setupBestiary, teardownBestiary } from "./modules/bestiary";
import {
  setupCharacterCards,
  teardownCharacterCards,
} from "./modules/characterCards";
import { setupDice, teardownDice } from "./modules/dice";
import { setupPortals, teardownPortals } from "./modules/portals";
import { setupTrickster, teardownTrickster } from "./modules/trickster";
import { setupCircleImage, teardownCircleImage } from "./modules/circleImage";
// 2026-05-14 — Follow plugin retired from the dev build per user
// request. The modules/follow/ source stays on disk (un-wired) in
// case it's revived later; it's just no longer registered.
import { setupResourceTracker, teardownResourceTracker } from "./modules/resourceTracker";
import { setupBubbles, teardownBubbles } from "./modules/bubbles";
import { setupStatusTracker, teardownStatusTracker } from "./modules/statusTracker";
import { setupHpBar, teardownHpBar } from "./modules/hpBar";
import { setupBossBar, teardownBossBar } from "./modules/bossBar";
import { setupTransitions, teardownTransitions } from "./modules/transitions";
import { setupThreeDragonAnte, teardownThreeDragonAnte } from "./modules/threeDragonAnte";
import { setupMetadataInspector, teardownMetadataInspector } from "./modules/metadata-inspector";
import {
  setupDynamicFog,
  setupFogEditor,
  teardownDynamicFog,
  teardownFogEditor,
} from "./modules/fullFog";
import { setupMusicBoard, teardownMusicBoard } from "./modules/musicBoard";
import { setupTransform, teardownTransform } from "./modules/transform";
import { setupCrossSceneCards } from "./modules/cross-scene-cards";
import { setupPerfWindow } from "./modules/perfWindow";
import { assetUrl } from "./asset-base";
import { onViewportResize } from "./utils/viewportAnchor";
import {
  PANEL_IDS,
  getPanelOffset,
  registerPanelBbox,
  computePanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_DRAG_START,
  BC_PANEL_DRAG_CANCEL,
  BC_PANEL_RESET,
  BC_OPEN_LAYOUT_EDITOR,
  BC_LAYOUT_EDITOR_REFRESH,
  BC_LAYOUT_EDITOR_BBOXES,
  BC_PANEL_SIDE_HINT,
  DRAG_PREVIEW_MODAL_ID,
  LAYOUT_EDITOR_MODAL_ID,
  type DragEndPayload,
} from "./utils/panelLayout";
import {
  refreshStaleSubscriptions,
  BC_LOCAL_CONTENT_CHANGED,
} from "./utils/localContent";

// Helper used everywhere a popover opens with a side-aware drag handle.
// Computes which half of the viewport the panel center sits in and
// returns the OPPOSITE side (so the handle pins to the visible/canvas
// edge of the panel). Background also broadcasts the side via
// BC_PANEL_SIDE_HINT so already-open iframes can flip their handle
// without reloading. Returns null when the bbox isn't yet registered.
async function computePanelSideAndBroadcast(
  panelId: string,
): Promise<"left" | "right"> {
  let side: "left" | "right" = "right";
  try {
    const [bbox, vw] = await Promise.all([
      computePanelBbox(panelId),
      OBR.viewport.getWidth(),
    ]);
    if (bbox && Number.isFinite(vw) && vw > 0) {
      const center = bbox.left + bbox.width / 2;
      side = center < vw / 2 ? "right" : "left";
    }
  } catch {}
  try {
    OBR.broadcast.sendMessage(
      BC_PANEL_SIDE_HINT,
      { panelId, side },
      { destination: "LOCAL" },
    );
  } catch {}
  return side;
}

// Cluster split into TWO popovers (since 2026-05-03 UI overhaul):
//   - Trigger: a 64×64 button at the BOTTOM-LEFT, always open. Click
//     it to broadcast BC_CLUSTER_ROW_TOGGLE.
//   - Row:    a horizontal strip of action buttons that opens ABOVE
//     the trigger when toggled on. Closed by clicking the trigger
//     again (disableClickAway prevents click-elsewhere from closing
//     it).
// The trigger never changes size; the row appears as a separate
// popover overlay.
const CLUSTER_POPOVER_ID = "com.obr-suite/cluster";          // trigger
const CLUSTER_ROW_POPOVER_ID = "com.obr-suite/cluster-row";  // row
const CLUSTER_URL = assetUrl("cluster.html");
const CLUSTER_ROW_URL = assetUrl("cluster-row.html");
const BC_CLUSTER_ROW_TOGGLE = "com.obr-suite/cluster-row-toggle";
const BC_CLUSTER_ROW_STATE = "com.obr-suite/cluster-row-state";
// Idempotent "ensure row open" — time-stop broadcasts this so the DM
// keeps the off-switch visible behind the cinematic / CG overlay.
const BC_CLUSTER_ROW_OPEN = "com.obr-suite/cluster-row-open";

// DM-only announcement modal. Opened from the megaphone button inside
// the cluster row (left of the gear), and — since 2026-08-25 — shown
// automatically the first time a GM loads the suite on any given day.
// Cluster-row blinks the megaphone while there's an unseen announcement.
const ANNOUNCE_MODAL_ID = "com.obr-suite/dm-announcement";
const ANNOUNCE_URL = assetUrl("dm-announcement.html");
const ANNOUNCE_MD_URL = assetUrl("announcement.md");
/** YYYY-MM-DD of the last day the announcement auto-opened here. */
const LS_ANNOUNCE_DAILY = "obr-suite/announce-daily-date";
/** Version string of the announcement the DM has acknowledged. Shared
 *  with cluster-row.ts, which uses it to blink the megaphone. */
const LS_ANNOUNCE_SEEN_VERSION = "obr-suite/announce-seen-version";

/** Local calendar day, not UTC — "first time today" should mean the
 *  DM's today, not a date that rolls over mid-session in Asia. */
function localDayStamp(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Show the announcement once a day, to GMs only.
 *
 * Deliberately NOT gated on the announcement version: the point is a
 * daily "here's what changed" like a game's patch notes, so it shows
 * again the next day even if nothing was published in between. The
 * version key is still written, so acknowledging here also stops the
 * megaphone blinking.
 *
 * Players never see it — it carries DM-facing notes, and a modal
 * appearing unprompted mid-session for a player would be worse than
 * useless.
 */
async function maybeShowDailyAnnouncement(): Promise<void> {
  try {
    if ((await OBR.player.getRole()) !== "GM") return;
  } catch {
    return;
  }
  const today = localDayStamp();
  try {
    if (localStorage.getItem(LS_ANNOUNCE_DAILY) === today) return;
  } catch {
    // No localStorage (private mode / blocked) — better to skip than to
    // reopen this on every single load.
    return;
  }
  try {
    localStorage.setItem(LS_ANNOUNCE_DAILY, today);
  } catch {}

  // Mark the current announcement acknowledged so the megaphone stops
  // blinking; failing to read the version is not a reason to skip the
  // popup.
  try {
    const res = await fetch(ANNOUNCE_MD_URL, { cache: "no-cache" });
    if (res.ok) {
      const m = (await res.text()).match(
        /^\s*-\s*(\d+\.\d+\.\d+(?:[-.][\w]+)*)\s*[·\-—]/m,
      );
      if (m) localStorage.setItem(LS_ANNOUNCE_SEEN_VERSION, m[1]);
    }
  } catch {}

  try {
    await OBR.modal.open({
      id: ANNOUNCE_MODAL_ID,
      url: ANNOUNCE_URL,
      // Same box the megaphone button opens, so the auto-popup and the
      // manual open are visually identical.
      width: 560,
      height: 580,
    });
  } catch (e) {
    console.warn("[obr-suite] daily announcement failed to open", e);
  }
}

// Trigger geometry. Anchored bottom-LEFT so it sits in the lower-left
// quadrant without competing with the global-search popover (top-right)
// or OBR's bottom-center turn-tracker strip. Inset slightly from the
// corner so it doesn't overlap OBR's own bottom-left button.
// Trigger iframe is wider than the button itself so a drag-grip can
// sit visibly INSIDE the iframe bounds (popover content outside its
// rect is clipped, so handles positioned at `right:-22px` etc. were
// invisible). 28px extra width accommodates the 18px grip + 10px gap.
const TRIGGER_W = 92;
const TRIGGER_H = 64;
const TRIGGER_LEFT_OFFSET = 60;
// 5px bottom inset (was flush) matches OBR's internal popover margin
// so the drag-preview ghost lands on the trigger's actual rendered
// position instead of the unclamped target.
const TRIGGER_BOTTOM_OFFSET = 5;
const MOBILE_TRIGGER_LEFT_OFFSET = 16;
const MOBILE_TRIGGER_BOTTOM_OFFSET = 5;
// On mobile the trigger renders at half size so it doesn't dominate
// the (already cramped) screen real estate. The iframe's CSS reads
// `?mobile=1` from the URL and applies `transform: scale(0.5)`-style
// adjustments to the inner buttons; here we just shrink the popover
// dimensions so its hit-area matches the rendered visual.
const MOBILE_TRIGGER_W = 46;
const MOBILE_TRIGGER_H = 32;

// Row popover hugs the LEFT viewport edge (independent of the
// trigger's horizontal offset). Width caps at 640px; height fixed
// at button-height + small padding.
const ROW_W = 640;
const ROW_H = 56;
const ROW_LEFT_OFFSET = 0;
// Row sits flush above the trigger — minimal gap so the two read as
// a single visual cluster.
const ROW_GAP = 4;

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}
const IS_MOBILE = isMobileDevice();

// === Mobile-presence advertisement ===
//
// On a phone / tablet client some heavy popovers (full-screen
// character-card view, global search) are hidden because they don't
// render usefully or eat too much memory. To make this visible to the
// rest of the table — so the GM doesn't think a player is "missing"
// the cc panel by accident — every client broadcasts its mobile flag
// at scene-ready, and any client that receives "another player is on
// mobile" pops a yellow notification once per player ID per session.
//
// Disabled-feature list shown in the notification:
//   • 角色卡界面 / Character Card panel  (cluster button hidden)
//   • 全局搜索 / Global Search           (popover not registered)
const BC_MOBILE_PRESENCE = "com.obr-suite/mobile-presence";
const seenMobilePlayers = new Set<string>();
function disabledFeaturesText(lang: "zh" | "en"): string {
  return lang === "zh"
    ? "角色卡全屏面板、全局搜索、状态追踪、元数据检查"
    : "Character Card panel, Global Search, Status Tracker, Metadata Inspector";
}

async function announceMobilePresence(): Promise<void> {
  if (!IS_MOBILE) return;
  try {
    const [pid, pname] = await Promise.all([
      OBR.player.getId(),
      OBR.player.getName(),
    ]);
    await OBR.broadcast.sendMessage(
      BC_MOBILE_PRESENCE,
      { playerId: pid, playerName: pname || "?" },
      { destination: "ALL" },
    );
  } catch (e) {
    console.warn("[obr-suite] announceMobilePresence failed", e);
  }
}

function setupMobilePresenceListener(): void {
  OBR.broadcast.onMessage(BC_MOBILE_PRESENCE, async (event) => {
    const data = event.data as { playerId?: string; playerName?: string } | undefined;
    if (!data?.playerId) return;
    // Dedup: each player only triggers one notification per session
    // on each receiving client (else they'd re-fire on every
    // reconnection / scene change broadcast).
    if (seenMobilePlayers.has(data.playerId)) return;
    seenMobilePlayers.add(data.playerId);
    const lang = getLocalLang();
    const name = data.playerName || "?";
    const txt = lang === "zh"
      ? `${name} 正在使用手机端，为性能考虑无法使用：${disabledFeaturesText("zh")}。`
      : `${name} is on mobile — disabled for performance: ${disabledFeaturesText("en")}.`;
    try {
      await OBR.notification.show(txt, "WARNING");
    } catch (e) {
      console.warn("[obr-suite] mobile-presence notification failed", e);
    }
  });
}

function getTriggerLeft(): number { return IS_MOBILE ? MOBILE_TRIGGER_LEFT_OFFSET : TRIGGER_LEFT_OFFSET; }
function getTriggerBottom(): number { return IS_MOBILE ? MOBILE_TRIGGER_BOTTOM_OFFSET : TRIGGER_BOTTOM_OFFSET; }
function getTriggerW(): number { return IS_MOBILE ? MOBILE_TRIGGER_W : TRIGGER_W; }
function getTriggerH(): number { return IS_MOBILE ? MOBILE_TRIGGER_H : TRIGGER_H; }

async function openCluster() {
  try {
    // The viewport height and the side computation are independent, and
    // each is a postMessage round trip to the host. Awaiting them in
    // sequence put two of them in front of first paint; Promise.all
    // makes it one. The side broadcast that computePanelSideAndBroadcast
    // fires can only land EARLIER as a result, and its consumer is the
    // popover iframe, which is not open yet either way.
    const [vh, side] = await Promise.all([
      OBR.viewport.getHeight(),
      computePanelSideAndBroadcast(PANEL_IDS.cluster),
    ]);
    const userOff = getPanelOffset(PANEL_IDS.cluster);
    const left = getTriggerLeft() + userOff.dx;
    // DY SIGN: anchorOrigin=BOTTOM so anchorPosition.top = vh - bottom
    // is the y of the panel's BOTTOM edge. Positive userOff.dy (user
    // dragged DOWN) should move the panel down → panel-bottom-y bigger
    // → bottom-distance smaller → SUBTRACT dy. Was using `+ dy` which
    // inverted: drag-down moved panel UP, eventually clamping it
    // against the top edge of the viewport so subsequent vertical
    // drags had no effect — the user-reported "only horizontal" bug.
    const bottom = getTriggerBottom() - userOff.dy;
    // `side` (resolved above) makes the iframe render its drag handle on
    // the correct edge from first paint, instead of flipping after the
    // broadcast arrives.
    await OBR.popover.open({
      id: CLUSTER_POPOVER_ID,
      url: `${CLUSTER_URL}?side=${side}${IS_MOBILE ? "&mobile=1" : ""}`,
      width: getTriggerW(),
      height: getTriggerH(),
      anchorReference: "POSITION",
      anchorPosition: { left, top: vh - bottom },
      anchorOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
      transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
      hidePaper: true,
      disableClickAway: true,
    });
    clusterIsOpen = true;
  } catch (e) {
    console.error("[obr-suite] openCluster failed", e);
  }
}

async function closeCluster() {
  try { await OBR.popover.close(CLUSTER_POPOVER_ID); } catch {}
  clusterIsOpen = false;
  // Closing the trigger should also close the row (it's anchored
  // relative to the trigger; orphan rows look awful).
  await closeClusterRow();
}

async function openClusterRow() {
  try {
    const vh = await OBR.viewport.getHeight();
    // Cluster-row position is INDEPENDENT of the cluster trigger's
    // user offset — dragging the cluster shouldn't reposition the
    // row (and vice versa). The row's default position sits just
    // above the trigger's DEFAULT position; user offsets layered on
    // top via rowOff alone.
    const rowOff = getPanelOffset(PANEL_IDS.clusterRow);
    const triggerBottomDefault = getTriggerBottom();
    const triggerTopDefault = triggerBottomDefault + getTriggerH();
    const rowAnchorTop = vh - (triggerTopDefault + ROW_GAP) + rowOff.dy;
    const rowAnchorLeft = ROW_LEFT_OFFSET + rowOff.dx;
    const side = await computePanelSideAndBroadcast(PANEL_IDS.clusterRow);
    await OBR.popover.open({
      id: CLUSTER_ROW_POPOVER_ID,
      url: `${CLUSTER_ROW_URL}?side=${side}`,
      width: ROW_W,
      height: ROW_H,
      anchorReference: "POSITION",
      anchorPosition: { left: rowAnchorLeft, top: rowAnchorTop },
      anchorOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
      transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
      hidePaper: true,
      disableClickAway: true,
    });
    clusterRowIsOpen = true;
    broadcastRowState(true);
  } catch (e) {
    console.error("[obr-suite] openClusterRow failed", e);
  }
}

async function closeClusterRow() {
  try { await OBR.popover.close(CLUSTER_ROW_POPOVER_ID); } catch {}
  clusterRowIsOpen = false;
  broadcastRowState(false);
}

function broadcastRowState(open: boolean) {
  try {
    OBR.broadcast.sendMessage(
      BC_CLUSTER_ROW_STATE,
      { open },
      { destination: "LOCAL" },
    );
  } catch {}
}

// Tracks whether openCluster has run successfully since the last close.
// The viewport-resize handler keys off this so it doesn't spawn a popover
// when one isn't currently displayed (e.g. scene not ready).
let clusterIsOpen = false;
let clusterRowIsOpen = false;

// Cluster bbox provider — bottom-LEFT, fixed-size trigger.
// Sign convention matches openCluster (subtract dy from bottom-distance).
registerPanelBbox(PANEL_IDS.cluster, async () => {
  try {
    const vh = await OBR.viewport.getHeight();
    const userOff = getPanelOffset(PANEL_IDS.cluster);
    const left = getTriggerLeft() + userOff.dx;
    const bottom = getTriggerBottom() - userOff.dy;
    return {
      left,
      top: vh - bottom - getTriggerH(),
      width: getTriggerW(),
      height: getTriggerH(),
    };
  } catch { return null; }
});

// Cluster ROW bbox — independent panel. Position derives ONLY from
// PANEL_IDS.clusterRow's stored offset (NOT cluster's). Dragging the
// cluster trigger no longer drags the row along with it, and vice
// versa.
registerPanelBbox(PANEL_IDS.clusterRow, async () => {
  try {
    const vh = await OBR.viewport.getHeight();
    const rowOff = getPanelOffset(PANEL_IDS.clusterRow);
    const triggerBottomDefault = getTriggerBottom();
    const triggerTopDefault = triggerBottomDefault + getTriggerH();
    const rowTop = vh - (triggerTopDefault + ROW_GAP) + rowOff.dy - ROW_H;
    const rowLeft = ROW_LEFT_OFFSET + rowOff.dx;
    return {
      left: rowLeft,
      top: rowTop,
      width: ROW_W,
      height: ROW_H,
    };
  } catch { return null; }
});

// Re-anchor cluster trigger + row on viewport resize. Same id + same url
// → OBR updates each popover in place.
onViewportResize(async () => {
  if (clusterIsOpen) await openCluster();
  if (clusterRowIsOpen) await openClusterRow();
});

OBR.onReady(() => {
  // Cluster trigger drag-end → re-anchor ONLY the cluster.
  // Cluster-row drag-end → re-anchor ONLY the row. They have fully
  // independent stored offsets so a drag on one doesn't drag the
  // other along.
  OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
    const payload = event.data as DragEndPayload | undefined;
    if (payload?.panelId === PANEL_IDS.cluster) {
      if (clusterIsOpen) await openCluster();
    } else if (payload?.panelId === PANEL_IDS.clusterRow) {
      if (clusterRowIsOpen) await openClusterRow();
    }
  });
  OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
    if (clusterIsOpen) await openCluster();
    if (clusterRowIsOpen) await openClusterRow();
  });

  // Trigger broadcast → toggle the row popover. disableClickAway means
  // clicking outside doesn't close it; user clicks the trigger again
  // to dismiss.
  OBR.broadcast.onMessage(BC_CLUSTER_ROW_TOGGLE, async () => {
    if (clusterRowIsOpen) await closeClusterRow();
    else await openClusterRow();
  });

  // Programmatic "ensure the row is OPEN" — used by time-stop so the
  // DM always has the off-switch (时停 button) visible while the
  // cinematic / CG overlay covers the screen (esp. CG, triggered from
  // a right-click menu while the row is closed). Goes through the SAME
  // openClusterRow() the trigger uses, so clusterRowIsOpen + the
  // trigger glow stay in sync — the next trigger click correctly
  // toggles it CLOSED. Idempotent: no-op when already open.
  OBR.broadcast.onMessage(BC_CLUSTER_ROW_OPEN, async () => {
    if (!clusterRowIsOpen) await openClusterRow();
  });

  // Cluster-row iframe broadcasts its measured natural width on every
  // render (renderRow → requestAnimationFrame → broadcast). We resize
  // the popover so its physical click-blocking area matches the
  // visible button row, and so language switches that lengthen
  // labels don't get truncated.
  OBR.broadcast.onMessage("com.obr-suite/cluster-row-width", async (event) => {
    const data = event.data as { width?: number } | undefined;
    if (!clusterRowIsOpen) return;
    if (typeof data?.width !== "number" || !Number.isFinite(data.width)) return;
    try {
      const viewportWidth = await OBR.viewport.getWidth();
      if (!clusterRowIsOpen) return;
      const w = Math.max(120, Math.min(960, viewportWidth - 24, Math.round(data.width)));
      await OBR.popover.setWidth(CLUSTER_ROW_POPOVER_ID, w);
    } catch {}
  });

  // Settings panel asked us to open the layout-editor modal. We
  // collect every registered panel's bbox and pack them into the
  // modal URL's hash so the editor can render proxy rectangles
  // from the get-go. Done here (not in settings) because the bbox
  // registry only exists in this background iframe.
  const LAYOUT_EDITOR_URL = assetUrl("layout-editor.html");
  // 2026-05-16 — extracted so the post-reset refresh handler below
  // can reuse the same panel list. Keep in sync with layout-editor.ts's
  // PANEL_ANCHOR / PANEL_MIN keys (or any future panel that wants a
  // proxy in the editor).
  const layoutEditorPanelIds = [
    PANEL_IDS.cluster,
    PANEL_IDS.clusterRow,
    PANEL_IDS.diceHistory,
    PANEL_IDS.perfWindow,
    PANEL_IDS.search,
    PANEL_IDS.initiative,
    PANEL_IDS.bestiaryPanel,
    PANEL_IDS.bestiaryInfo,
    PANEL_IDS.ccInfo,
    PANEL_IDS.portalEdit,
    PANEL_IDS.statusPalette,
    PANEL_IDS.hpBar,
    PANEL_IDS.musicBoard,
  ];
  async function collectLayoutEditorBboxes(): Promise<Record<string, { left: number; top: number; width: number; height: number }>> {
    // One round trip per panel, and there are 13 of them — awaited in
    // sequence that was 13 sequential bridge hops before the editor
    // modal could open. They are independent reads, so gather them at
    // once. Insertion order into bboxMap is preserved by iterating
    // layoutEditorPanelIds rather than settle order, and a provider that
    // throws still just drops out, exactly as the try/catch did.
    const bboxMap: Record<string, { left: number; top: number; width: number; height: number }> = {};
    const results = await Promise.all(
      layoutEditorPanelIds.map(async (id) => {
        try {
          return await computePanelBbox(id);
        } catch {
          return null;
        }
      }),
    );
    layoutEditorPanelIds.forEach((id, i) => {
      const bbox = results[i];
      if (bbox) bboxMap[id] = bbox;
    });
    return bboxMap;
  }
  OBR.broadcast.onMessage(BC_OPEN_LAYOUT_EDITOR, async () => {
    const bboxMap = await collectLayoutEditorBboxes();
    const url = `${LAYOUT_EDITOR_URL}#${encodeURIComponent(JSON.stringify(bboxMap))}`;
    try {
      await OBR.modal.open({
        id: LAYOUT_EDITOR_MODAL_ID,
        url,
        fullScreen: true,
        hidePaper: true,
      });
    } catch (e) {
      console.warn("[obr-suite/layout-editor] open failed", e);
    }
  });

  // 2026-05-16 — layout-editor reset-all path. After the editor
  // clears every panel-offset/size from localStorage it asks
  // background for a fresh bbox map (each provider now sees
  // userOff = {0,0} so the returned bboxes are the no-offset
  // defaults). We reply on BC_LAYOUT_EDITOR_BBOXES; the editor
  // re-snaps each proxy in its own listener. Fixes "重置全部时
  // 当前预览的所有框没有重置" — previously reset cleared storage
  // but the editor only snapped proxies back to startLeft/startTop
  // which were already offset-applied at open time.
  OBR.broadcast.onMessage(BC_LAYOUT_EDITOR_REFRESH, async () => {
    const bboxMap = await collectLayoutEditorBboxes();
    try {
      OBR.broadcast.sendMessage(
        BC_LAYOUT_EDITOR_BBOXES,
        { bboxes: bboxMap },
        { destination: "LOCAL" },
      );
    } catch {}
  });

  // ----- Drag-preview modal lifecycle ---------------------------------
  // BC_PANEL_DRAG_START arrives from whichever panel iframe the user
  // started dragging. We open the fullscreen drag-preview modal with
  // the start payload baked into its URL hash so the modal can render
  // the ghost rectangle on first paint. BC_PANEL_DRAG_END /
  // BC_PANEL_DRAG_CANCEL close it.
  let dragModalOpen = false;
  let dragSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  const DRAG_PREVIEW_URL = assetUrl("drag-preview.html");
  const closeDragModal = async () => {
    if (dragSafetyTimer) {
      clearTimeout(dragSafetyTimer);
      dragSafetyTimer = null;
    }
    if (!dragModalOpen) return;
    dragModalOpen = false;
    try { await OBR.modal.close(DRAG_PREVIEW_MODAL_ID); } catch {}
  };
  OBR.broadcast.onMessage(BC_PANEL_DRAG_START, async (event) => {
    const startData = event.data as
      | { panelId?: string; startScreenX?: number; startScreenY?: number }
      | undefined;
    if (!startData?.panelId) return;
    if (
      typeof startData.startScreenX !== "number" ||
      typeof startData.startScreenY !== "number"
    ) return;

    // Look up the panel's CURRENT bbox in OBR-viewport coordinates via
    // the registry. The iframe can't compute this itself: window.screenX
    // is identical for every iframe in the same browser window, so any
    // attempt at relative coords from the iframe side returns 0,0.
    let bbox;
    try {
      bbox = await computePanelBbox(startData.panelId);
    } catch {
      bbox = null;
    }
    if (!bbox) {
      console.warn("[obr-suite/drag-preview] no bbox for", startData.panelId);
      return;
    }

    const payload = {
      panelId: startData.panelId,
      startScreenX: startData.startScreenX,
      startScreenY: startData.startScreenY,
      bbox,
    };
    const url = `${DRAG_PREVIEW_URL}#${encodeURIComponent(JSON.stringify(payload))}`;
    try {
      if (dragModalOpen) await OBR.modal.close(DRAG_PREVIEW_MODAL_ID);
      await OBR.modal.open({
        id: DRAG_PREVIEW_MODAL_ID,
        url,
        fullScreen: true,
        hidePaper: true,
      });
      dragModalOpen = true;
      // Background-side safety: even if every modal-side cancel path
      // somehow misfires (browser quirk, broadcast lost, iframe
      // unmount during gesture, etc.), force-close after 35s. Prevents
      // the "stuck drag, must refresh tab" failure mode the user hit.
      if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
      dragSafetyTimer = setTimeout(() => {
        console.warn("[obr-suite/drag-preview] background safety: force-closing stuck modal");
        void closeDragModal();
      }, 35_000);
    } catch (e) {
      console.warn("[obr-suite/drag-preview] open failed", e);
    }
  });
  OBR.broadcast.onMessage(BC_PANEL_DRAG_END, () => { void closeDragModal(); });
  OBR.broadcast.onMessage(BC_PANEL_DRAG_CANCEL, () => { void closeDragModal(); });
});

// (HTTP-cache prewarm experiment removed — 不全书 is fronted by a
// Cloudflare bot challenge that fights back with CSP violations and
// 404s when loaded in a hidden iframe, so the cache never actually
// gets primed. Not worth the console noise. The cc-panel still
// reloads its iframes on every open; that's a known cost of OBR's
// "modal close = iframe destroy" lifecycle.)

// Module lifecycle: each module's setup() is called when its enable flag
// flips ON, teardown() when it flips OFF. Modules register OBR listeners
// (context menu, broadcast, popover, etc.) at setup and clean up at
// teardown. The shell is responsible for state-based dispatching.

// Module setup order matters — OBR's popover layer warms up after the
// first few popovers are opened, and the LAST popover to be opened
// sometimes fails its first-load render if it's the very first popover
// to come up. So we load the popover-heavy modules first (initiative
// panel, bestiary tool, character-cards) and search LAST.
const modules: Partial<Record<keyof ReturnType<typeof getState>["enabled"], ModuleHooks>> = {
  timeStop: { setup: setupTimeStop, teardown: teardownTimeStop },
  focus: { setup: setupFocus, teardown: teardownFocus },
  initiative: { setup: setupInitiative, teardown: teardownInitiative },
  bestiary: { setup: setupBestiary, teardown: teardownBestiary },
  characterCards: {
    setup: setupCharacterCards,
    teardown: teardownCharacterCards,
  },
  dice: { setup: setupDice, teardown: teardownDice },
  portals: { setup: setupPortals, teardown: teardownPortals },
  bubbles: { setup: setupBubbles, teardown: teardownBubbles },
  hpBar: { setup: setupHpBar, teardown: teardownHpBar },
  bossBar: { setup: setupBossBar, teardown: teardownBossBar },
  transitions: { setup: setupTransitions, teardown: teardownTransitions },
  threeDragonAnte: { setup: setupThreeDragonAnte, teardown: teardownThreeDragonAnte },
  metadataInspector: {
    setup: async () => { await setupMetadataInspector(); },
    teardown: async () => { teardownMetadataInspector(); },
  },
  statusTracker: { setup: setupStatusTracker, teardown: teardownStatusTracker },
  resourceTracker: { setup: setupResourceTracker, teardown: teardownResourceTracker },
  search: { setup: setupSearch, teardown: teardownSearch },
  // Trickster + circle-image promoted from dev to stable on 2026-05-08.
  trickster: { setup: setupTrickster, teardown: teardownTrickster },
  circleImage: { setup: setupCircleImage, teardown: teardownCircleImage },
  musicBoard: { setup: setupMusicBoard, teardown: teardownMusicBoard },
  // 2026-08-25 — `fullFog` split into two independently switchable
  // modules. `fogEditor` is the right-click map tracer and has no
  // runtime; `dynamicFog` is the engine that turns FOG-layer drawings
  // into per-client walls and owns doors / windows / lights. The
  // engine's AUTHORING surface (light context menu, fog-tool modes,
  // indicators, player toggle tool, occlusion) is gated
  // behind !STABLE_HIDES inside the module; the wall derivation
  // itself runs in both channels, because the editor's output is
  // worthless without it. See modules/fullFog/index.ts.
  fogEditor: {
    setup: async () => { await setupFogEditor(); },
    teardown: async () => { await teardownFogEditor(); },
  },
  dynamicFog: {
    setup: async () => { await setupDynamicFog(); },
    teardown: async () => { await teardownDynamicFog(); },
  },
  // Transform (变身) — stable: right-click CHARACTER token, pick a
  // bestiary form, swap image + bestiary/bubbles metadata, and revert
  // from the transform stack. DM can configure per-token owner limits
  // in the picker header.
  transform: {
    setup: async () => { await setupTransform(); },
    teardown: async () => { teardownTransform(); },
  },
};

const lifecycle = new ModuleLifecycle(modules, {
  onChange: (modules) => {
    if (OBR.isReady) void OBR.broadcast.sendMessage(
      BC_MODULE_STATUS, { modules }, { destination: "LOCAL" },
    ).catch(() => {});
  },
  onError: (id, operation, error) => console.error(`[obr-suite] ${id} ${operation} failed:`, error),
});
// Modules retain their scene listeners across switches. Only registration
// work waits until scene settings arrive; desired changes are never skipped.
void lifecycle.setPaused(true);
function syncModules() {
  return lifecycle.setDesired(getState().enabled);
}

OBR.onReady(async () => {
  // Sync state, then open cluster + activate all enabled modules.
  startSceneSync();
  onStateChange(() => { void syncModules(); });
  OBR.broadcast.onMessage(BC_MODULE_STATUS_QUERY, () => {
    void OBR.broadcast.sendMessage(BC_MODULE_STATUS,
      { modules: lifecycle.snapshot() }, { destination: "LOCAL" }).catch(() => {});
  });
  OBR.broadcast.onMessage(BC_MODULE_RETRY, (event) => {
    const id = (event.data as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") void lifecycle.retry(id);
  });

  // Mobile-presence: every client listens; phones additionally
  // broadcast their flag at scene-ready so others know which player
  // doesn't have the heavy popovers.
  setupMobilePresenceListener();

  // Cross-scene character-card sync. Always-on watcher; the actual
  // mirroring is gated on state.crossSceneSyncCards inside the
  // module so it's a no-op when the user hasn't enabled the toggle.
  void setupCrossSceneCards();

  // Perf window — per-client opt-in via localStorage. The setup call
  // is cheap (just a localStorage read + maybe one popover.open) so
  // we always run it; it's a no-op when the user hasn't enabled it.
  void setupPerfWindow();

  // Patch notes, once a day, GM only. Fire-and-forget so a slow fetch
  // can't hold up module startup.
  void maybeShowDailyAnnouncement();

  // URL-subscribed homebrew packs — re-fetch every stale subscription
  // (lastFetchedAt older than SUB_STALE_MS) so updates the upstream
  // author published since last session appear automatically.
  // Non-blocking: fetches run in the background; the suite continues
  // to use the previously-cached content until each refresh lands,
  // then broadcasts BC_LOCAL_CONTENT_CHANGED so search / bestiary
  // pick up the new data without a page reload.
  void (async () => {
    try {
      const { refreshed, failed } = await refreshStaleSubscriptions();
      if (refreshed > 0) {
        try {
          await OBR.broadcast.sendMessage(
            BC_LOCAL_CONTENT_CHANGED,
            { source: "subscription-refresh" },
            { destination: "LOCAL" },
          );
        } catch {}
      }
      if (failed > 0) {
        console.warn(`[obr-suite/background] subscription refresh: ${refreshed} ok, ${failed} failed (check Settings → 库设置 for details)`);
      }
    } catch (e) {
      console.warn("[obr-suite/background] subscription auto-refresh failed", e);
    }
  })();

  // (resourceTracker is now wired through the module registry above —
  // its enable flag lives in state.enabled.resourceTracker and is
  // toggled in Settings → 资源追踪.)

  // (metadataInspector is now wired through the module registry —
  // its enable flag lives in state.enabled.metadataInspector and is
  // toggled in Settings → 元数据检查.)

  const sceneCoordinator = new SceneModuleCoordinator({
    lifecycle, syncModules, refreshSettings: refreshFromScene,
    openCluster, closeCluster, onReady: announceMobilePresence,
    onError: (operation, error) => console.warn(`[obr-suite] scene ${operation} failed`, error),
    onSettingsUnavailable: () => {
      const message = getLocalLang() === "zh"
        ? "场景设置读取失败，已暂停新功能启动。稍后重新打开场景可重试。"
        : "Scene settings could not be loaded. New module startup is paused. Reopen the scene later to retry.";
      void OBR.notification.show(message, "ERROR").catch(error => console.warn("[obr-suite] settings failure notice failed", error));
    },
  });
  onStateRefreshed(() => sceneCoordinator.settingsRefreshed());
  onStateRefreshFailed(error => sceneCoordinator.settingsFailed(error));
  // Subscribe before the initial read so a rapid scene switch is not missed.
  OBR.scene.onReadyChange(ready => { sceneCoordinator.handleReady(ready); });
  const initialRevision = sceneCoordinator.revision;
  const ready = await OBR.scene.isReady().catch(() => false);
  if (initialRevision === sceneCoordinator.revision) sceneCoordinator.handleReady(ready);
});
