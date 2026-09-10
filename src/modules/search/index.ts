import OBR from "@owlbear-rodeo/sdk";
import { setPanelOpen } from "../../utils/panelObstacles";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import { getState, onStateChange, refreshFromScene } from "../../state";
import {
  PANEL_IDS,
  getPanelOffset,
  getPanelSize,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type DragEndPayload,
} from "../../utils/panelLayout";

// Search bar bbox — RIGHT/TOP anchor. The bar collapses/expands its
// own width on blur/focus, but the layout editor only needs the IDLE
// footprint (the user-visible "always there" strip). Returned even
// when the popover hasn't opened so the editor can pre-arrange.
registerPanelBbox(PANEL_IDS.search, async () => {
  // §7: when the bar is GM-only, players get no layout-editor proxy
  // box either (same contract as hpBar's provider — null hides it).
  if (!searchAllowed()) return null;
  try {
    const vw = await OBR.viewport.getWidth();
    const userOff = getPanelOffset(PANEL_IDS.search);
    const sizeOverride = getPanelSize(PANEL_IDS.search);
    const w = sizeOverride?.width ?? BAR_W_IDLE;
    const h = sizeOverride?.height ?? BAR_H_IDLE;
    const anchorRight = vw - RIGHT_OFFSET + userOff.dx;
    const anchorTop = TOP_OFFSET + userOff.dy;
    return {
      left: anchorRight - w,
      top: anchorTop,
      width: w,
      height: h,
    };
  } catch { return null; }
});

// Search module — independent always-visible popover at the top-right
// of the OBR viewport, mirroring the legacy 5e-search standalone.
//
// Layout:
//   - Idle:    280×40 (just the input row; clicks pass through below)
//   - Active:  720×440 (input + filter row + dropdown + preview)
// The iframe itself drives the resize via OBR.popover.setWidth/setHeight
// when the user types / clears.
//
// Cluster does NOT have a search input anymore — this popover owns its
// own input row. Other modules can still ASK us to fill the search by
// broadcasting BC_SEARCH_QUERY (e.g. character-card search-chips); the
// iframe listens for the broadcast and runs the query.

const POPOVER_ID = "com.obr-suite/search-bar";
const URL = assetUrl("search-bar.html");

// Idle bar size MUST match `BAR_W_IDLE` / `BAR_H_IDLE` in
// `src/modules/search/page.ts` — the iframe shrinks/grows the popover
// via OBR.popover.setWidth/setHeight, and a mismatch makes the popover
// resize on first input/clear (visible flicker, drag-grip clipping).
// The drag grip pokes out 20px from the row's right edge — the row
// uses `margin-right: 20px` to reserve that space, so the iframe
// doesn't need to be wider than the row.
const BAR_W_IDLE = 280;
const BAR_H_IDLE = 40;
const RIGHT_OFFSET = 200;
const TOP_OFFSET = 12;

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}

let unsubs: Array<() => void> = [];
let isOpen = false;
let openInFlight = false;
// §7: role cache — seeded in setupSearch, kept live by player.onChange.
// null = not yet known / getRole failed → treated as PLAYER (deny by
// default, matching settings.ts / metadata-inspector).
let searchRole: "GM" | "PLAYER" | null = null;

// §7: THE permission decision — every show/hide path consults this and
// nothing else. Pure sync read of cached role + suite state.
function searchAllowed(): boolean {
  if (!getState().searchGmOnly) return true;
  return searchRole === "GM";
}

// §7: single visibility applier. All entry points funnel through here,
// and runs are chained so an open and a close can never interleave —
// the LAST decision always wins (no "open resolves after the deny
// already ran" leak). `reanchor` forces a close+reopen for fresh
// geometry (viewport resize / layout-editor drag).
let visChain: Promise<void> = Promise.resolve();
function applySearchVisibility(entry: string, reanchor = false): Promise<void> {
  visChain = visChain
    .then(() => applySearchVisibilityImpl(entry, reanchor))
    .catch((e) => {
      console.warn("[obr-suite/search] visibility pass failed", {
        entry, role: searchRole, error: e,
      });
    });
  return visChain;
}

async function applySearchVisibilityImpl(entry: string, reanchor: boolean): Promise<void> {
  let ready = false;
  try {
    ready = await OBR.scene.isReady();
  } catch (e) {
    console.warn("[obr-suite/search] scene.isReady failed — treating as not ready", {
      entry, role: searchRole, error: e,
    });
  }
  if (ready && searchAllowed()) {
    if (!isOpen && searchRole !== "GM") {
      // Player-side open: confirm against FRESH scene state first, so
      // a not-yet-hydrated default (gmOnly=false) can never flash the
      // bar open before the scene's real settings arrive (§7 forbids
      // show-then-close leaks). GM opens skip the extra round-trip.
      try {
        await refreshFromScene();
      } catch (e) {
        console.warn("[obr-suite/search] pre-open state refresh failed", { entry, error: e });
      }
      if (!searchAllowed()) {
        console.warn("[obr-suite/search] open denied by fresh state", {
          entry, role: searchRole, sceneReady: ready, gmOnly: getState().searchGmOnly,
        });
        return;
      }
    }
    if (!isOpen || reanchor) await openBar();
  } else {
    if ((isOpen || openInFlight) && ready && !searchAllowed()) {
      console.warn("[obr-suite/search] deny — closing bar", {
        entry, role: searchRole, sceneReady: ready, gmOnly: getState().searchGmOnly,
      });
    }
    await closeBar(entry);
  }
}

// Quadrant of the search bar's CENTER on the viewport. Determines
// (a) which screen edge the popover anchors at — so when the iframe
// resizes for the expanded view, it grows AWAY from the edge; and
// (b) which way detail content stacks (above vs below the input),
// passed to the iframe via URL params so CSS can flip the row order.
async function computeOrigin(): Promise<{
  hAnchor: "LEFT" | "RIGHT";
  vAnchor: "TOP" | "BOTTOM";
  anchorPos: { left: number; top: number };
}> {
  const [vw, vh] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  const userOff = getPanelOffset(PANEL_IDS.search);
  const sizeOverride = getPanelSize(PANEL_IDS.search);
  const w = sizeOverride?.width ?? BAR_W_IDLE;
  const h = sizeOverride?.height ?? BAR_H_IDLE;

  // Default position: top-RIGHT corner inset by RIGHT_OFFSET / TOP_OFFSET.
  // user offsets shift the bar around without changing the anchor.
  const defLeft = vw - RIGHT_OFFSET - w + userOff.dx;
  const defTop = TOP_OFFSET + userOff.dy;
  const cx = defLeft + w / 2;
  const cy = defTop + h / 2;

  const hAnchor: "LEFT" | "RIGHT" = cx < vw / 2 ? "LEFT" : "RIGHT";
  const vAnchor: "TOP" | "BOTTOM" = cy < vh / 2 ? "TOP" : "BOTTOM";

  // Anchor position the OBR popover treats as the corner reference.
  // hAnchor=LEFT → anchorPos.left is the bar's LEFT edge.
  // hAnchor=RIGHT → anchorPos.left is the bar's RIGHT edge.
  // vAnchor=TOP → anchorPos.top is the bar's TOP edge.
  // vAnchor=BOTTOM → anchorPos.top is the bar's BOTTOM edge.
  const left = hAnchor === "LEFT" ? defLeft : defLeft + w;
  const top = vAnchor === "TOP" ? defTop : defTop + h;

  return { hAnchor, vAnchor, anchorPos: { left, top } };
}

async function openBar(): Promise<void> {
  if (openInFlight) return;
  openInFlight = true;
  try {
    const sizeOverride = getPanelSize(PANEL_IDS.search);
    const w = sizeOverride?.width ?? BAR_W_IDLE;
    const h = sizeOverride?.height ?? BAR_H_IDLE;
    const { hAnchor, vAnchor, anchorPos } = await computeOrigin();
    // §7 belt-and-braces: a role/state flip can land during the awaits
    // above — re-check the cached decision right before touching the
    // popover. The visChain serialization makes this near-impossible
    // to hit, but the check is free.
    if (!searchAllowed()) {
      console.warn("[obr-suite/search] open refused mid-flight", {
        role: searchRole, gmOnly: getState().searchGmOnly,
      });
      return;
    }
    try { await OBR.popover.close(POPOVER_ID); isOpen = false; setPanelOpen(PANEL_IDS.search, false); } catch {}
    // Pass quadrant info to the iframe so it can flip element order
    // (e.g. detail panel goes ABOVE the input row when vAnchor=BOTTOM).
    const h_q = hAnchor === "LEFT" ? "left" : "right";
    const v_q = vAnchor === "TOP" ? "top" : "bottom";
    await OBR.popover.open({
      id: POPOVER_ID,
      url: `${URL}?h=${h_q}&v=${v_q}`,
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: anchorPos,
      anchorOrigin: { horizontal: hAnchor, vertical: vAnchor },
      transformOrigin: { horizontal: hAnchor, vertical: vAnchor },
      hidePaper: true,
      // Stays open even when the user clicks the canvas. The iframe
      // collapses itself to BAR_W_IDLE×BAR_H_IDLE on blur, so the
      // popover only physically blocks the small input strip — clicks
      // below it always pass through.
      disableClickAway: true,
    });
    isOpen = true; setPanelOpen(PANEL_IDS.search, true);
  } catch (e) {
    console.error("[obr-suite/search] openPopover failed", e);
  } finally {
    openInFlight = false;
  }
}

async function closeBar(entry = "close"): Promise<void> {
  // §7: NO `isOpen` early-return. A deny can arrive while an open is
  // still in flight (isOpen flips true only after popover.open
  // resolves), and the old guard let that popover survive the denial.
  // popover.close on an already-closed id is a cheap no-op.
  const wasVisible = isOpen || openInFlight;
  try {
    await OBR.popover.close(POPOVER_ID);
    isOpen = false; setPanelOpen(PANEL_IDS.search, false);
  } catch (e) {
    if (wasVisible) {
      console.warn("[obr-suite/search] popover.close failed", {
        entry, role: searchRole, error: e,
      });
    }
  }
}

export async function setupSearch(): Promise<void> {
  if (isMobileDevice()) return;

  // §7: seed the role BEFORE the first visibility decision. getRole
  // failure counts as PLAYER (deny by default) — the pre-open fresh
  // state confirm in applySearchVisibilityImpl covers the state side.
  try {
    searchRole = (await OBR.player.getRole()) as "GM" | "PLAYER";
  } catch (e) {
    searchRole = "PLAYER";
    console.warn("[obr-suite/search] getRole failed — treating as PLAYER", e);
  }

  await applySearchVisibility("setup");

  // Role promotions/demotions re-gate immediately (checklist §7).
  unsubs.push(
    OBR.player.onChange((p) => {
      const nextRole: "GM" | "PLAYER" = p.role === "GM" ? "GM" : "PLAYER";
      if (nextRole === searchRole) return;
      searchRole = nextRole;
      void applySearchVisibility("role-change");
    }),
  );
  // DM flips the toggle (or any suite-state refresh) → re-gate. The
  // background iframe runs startSceneSync, so this fires on remote
  // scene-metadata changes too.
  unsubs.push(
    onStateChange(() => {
      void applySearchVisibility("state-change");
    }),
  );
  // Scene switch / reconnect (checklist §7).
  unsubs.push(
    OBR.scene.onReadyChange(() => {
      void applySearchVisibility("scene-ready-change");
    }),
  );
  // Re-anchor on viewport resize — same gate, forced reopen so openBar
  // reads `vw` fresh and re-issues OBR.popover.open with new geometry.
  unsubs.push(
    onViewportResize(() => {
      if (!isOpen) return;
      void applySearchVisibility("viewport-resize", true);
    }),
  );
  // Layout-editor drag-end / global reset → re-anchor with new
  // offset / size from localStorage. openBar reads both fresh.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.search) return;
      if (!isOpen) return;
      void applySearchVisibility("panel-drag-end", true);
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, () => {
      if (!isOpen) return;
      void applySearchVisibility("panel-reset", true);
    }),
  );
}

export async function teardownSearch(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  await closeBar("teardown");
}
