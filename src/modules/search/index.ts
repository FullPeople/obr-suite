import OBR from "@owlbear-rodeo/sdk";
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

// Search bar bbox — RIGHT/TOP anchor. The bar collapses/expands its
// own width on blur/focus, but the layout editor only needs the IDLE
// footprint (the user-visible "always there" strip). Returned even
// when the popover hasn't opened so the editor can pre-arrange.
registerPanelBbox(PANEL_IDS.search, async () => {
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

// Iframe is wider than the visible input row by ~20px so the side
// drag-grip (which pokes out half-tucked-half-visible from the bar's
// right end) lives inside the iframe rect — anything outside is
// clipped by OBR.
const BAR_W_IDLE = 300;
const BAR_H_IDLE = 42;
const RIGHT_OFFSET = 200;
const TOP_OFFSET = 12;

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}

let unsubs: Array<() => void> = [];
let isOpen = false;
let openInFlight = false;

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
    try { await OBR.popover.close(POPOVER_ID); } catch {}
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
    isOpen = true;
  } catch (e) {
    console.error("[obr-suite/search] openPopover failed", e);
  } finally {
    openInFlight = false;
  }
}

async function closeBar(): Promise<void> {
  if (!isOpen) return;
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  isOpen = false;
}

export async function setupSearch(): Promise<void> {
  if (isMobileDevice()) return;

  const showIfReady = async () => {
    try {
      if (await OBR.scene.isReady()) await openBar();
      else await closeBar();
    } catch {}
  };
  await showIfReady();
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready) await openBar();
      else await closeBar();
    }),
  );
  // Re-anchor on viewport resize. openBar reads `vw` fresh and re-issues
  // OBR.popover.open() with the same id, so OBR updates the popover
  // position in place.
  unsubs.push(
    onViewportResize(async () => {
      if (!isOpen) return;
      await openBar();
    }),
  );
  // Layout-editor drag-end / global reset → re-anchor with new
  // offset / size from localStorage. openBar reads both fresh.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.search) return;
      if (!isOpen) return;
      await openBar();
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (isOpen) await openBar();
    }),
  );
}

export async function teardownSearch(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  await closeBar();
}
