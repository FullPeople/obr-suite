// Perf-window module — small draggable popover anchored to the
// top-left of the OBR viewport. Renders FPS + an approximate
// drawcall count (= scene item count). Visibility is per-client (no
// scene-metadata sync) so each player can independently choose to
// monitor performance without touching the DM's view.
//
// Local state: `obr-suite/perf-window/visible` localStorage key.
// "1" = open on scene-ready, anything else = stay closed.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import {
  PANEL_IDS,
  getPanelOffset,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type DragEndPayload,
} from "../../utils/panelLayout";

const POPOVER_ID = "com.obr-suite/perf-window";
const URL_HTML = assetUrl("perf-window.html");
const PERF_W = 130;
const PERF_H = 56;
// Top-left inset — sit clear of OBR's own toolbar (which starts at
// the top edge) by roughly OBR's button row height + a small gutter.
const PERF_LEFT_OFFSET = 12;
const PERF_TOP_OFFSET = 60;

export const LS_PERF_VISIBLE = "obr-suite/perf-window/visible";

let isOpen = false;
const unsubs: Array<() => void> = [];

function isVisiblePref(): boolean {
  try {
    return localStorage.getItem(LS_PERF_VISIBLE) === "1";
  } catch {
    return false;
  }
}

export function setPerfWindowVisible(v: boolean): void {
  try {
    localStorage.setItem(LS_PERF_VISIBLE, v ? "1" : "0");
  } catch {}
  if (v) void openPerf();
  else void closePerf();
}

// Bbox provider — even when the popover isn't open, the layout
// editor wants to render a proxy at the expected position. Returns
// the offset-adjusted top-left rectangle.
registerPanelBbox(PANEL_IDS.perfWindow, async () => {
  try {
    const userOff = getPanelOffset(PANEL_IDS.perfWindow);
    return {
      left: PERF_LEFT_OFFSET + userOff.dx,
      top: PERF_TOP_OFFSET + userOff.dy,
      width: PERF_W,
      height: PERF_H,
    };
  } catch { return null; }
});

async function openPerf(): Promise<void> {
  try {
    const userOff = getPanelOffset(PANEL_IDS.perfWindow);
    const left = PERF_LEFT_OFFSET + userOff.dx;
    const top = PERF_TOP_OFFSET + userOff.dy;
    // Force-close before re-open on every call. OBR's `open` with the
    // same id is documented as in-place update, but in practice the
    // anchorPosition delta sometimes does NOT take effect — the
    // popover stays at the previous coordinates. Closing first
    // guarantees the new position lands.
    if (isOpen) {
      try { await OBR.popover.close(POPOVER_ID); } catch {}
    }
    await OBR.popover.open({
      id: POPOVER_ID,
      url: URL_HTML,
      width: PERF_W,
      height: PERF_H,
      anchorReference: "POSITION",
      anchorPosition: { left, top },
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    isOpen = true;
  } catch (e) {
    console.warn("[obr-suite/perf] open failed", e);
  }
}

async function closePerf(): Promise<void> {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  isOpen = false;
}

export async function setupPerfWindow(): Promise<void> {
  if (isVisiblePref()) {
    await openPerf();
  }

  // Re-anchor on viewport resize / drag-end / panel-reset so the
  // popover sticks to the top-left through window changes.
  unsubs.push(
    onViewportResize(async () => {
      if (isOpen) await openPerf();
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.perfWindow) return;
      if (isOpen) await openPerf();
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (isOpen) await openPerf();
    }),
  );
}

export async function teardownPerfWindow(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  await closePerf();
}
