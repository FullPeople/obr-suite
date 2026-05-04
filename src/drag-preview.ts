// Fullscreen drag-preview modal — owns the entire gesture.
//
// The source panel's iframe broadcasts BC_PANEL_DRAG_START on
// pointerdown. Background.ts looks up the panel's bbox in OBR-viewport
// coordinates (via the bbox registry) and opens THIS modal with the
// payload baked into the URL hash. From then on the gesture is
// entirely owned by this modal:
//
//   - The fullscreen blocker layer captures pointer events so the
//     user can't accidentally click through to the canvas mid-drag.
//   - document.pointermove updates a translucent "ghost" rectangle
//     that follows the cursor by a fixed offset (= cursor's position
//     within the panel at pointerdown time). That offset is what
//     keeps the cursor on the original grip handle as the user
//     drags, instead of the ghost snapping its top-left to the
//     cursor.
//   - document.pointerup commits: persists the panel offset to
//     localStorage and broadcasts BC_PANEL_DRAG_END.
//   - Esc / right-click on blocker / 5-second-no-event timeout =
//     cancel.
//
// This sidesteps the cross-iframe pointer-capture handoff issues we
// saw with the previous design (iframe captured, then sometimes lost
// pointer events when modal mounted — leading to stuck drags).

import OBR from "@owlbear-rodeo/sdk";
import {
  BC_PANEL_DRAG_END,
  BC_PANEL_DRAG_CANCEL,
  getPanelOffset,
  setPanelOffset,
  type PanelOffset,
  type PanelBbox,
} from "./utils/panelLayout";

interface StartPayload {
  panelId: string;
  startScreenX: number;
  startScreenY: number;
  bbox: PanelBbox;
}

const blocker = document.getElementById("blocker") as HTMLDivElement;
const ghost = document.getElementById("ghost") as HTMLDivElement;
const ghostLabel = document.getElementById("ghost-label") as HTMLSpanElement;

let session: {
  panelId: string;
  startScreenX: number;
  startScreenY: number;
  bbox: PanelBbox;
  startOffset: PanelOffset;
} | null = null;

function panelLabel(panelId: string): string {
  switch (panelId) {
    case "cluster": return "悬浮按钮";
    case "dice-history": return "投骰记录";
    case "initiative": return "先攻条";
    case "bestiary-panel": return "怪物图鉴";
    case "bestiary-info": return "怪物详情";
    case "cc-info": return "角色卡";
    default: return panelId;
  }
}

// OBR clamps popovers ~5px from each viewport edge — panels that try
// to sit flush at left:0 / right:vw / etc. are nudged inward by the
// renderer. Mirroring that clamp inside the drag preview keeps the
// ghost in lockstep with where the panel will ACTUALLY land on
// release: without this, a user who drags the cluster to (0, 0) sees
// the ghost at (0, 0) but the actual cluster snaps to (5, 5), and the
// preview/reality mismatch is what they're complaining about.
const VIEWPORT_MARGIN = 5;

function clampGhost(left: number, top: number): { left: number; top: number } {
  if (!session) return { left, top };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = session.bbox.width;
  const h = session.bbox.height;
  const minX = VIEWPORT_MARGIN;
  const minY = VIEWPORT_MARGIN;
  const maxX = Math.max(VIEWPORT_MARGIN, vw - w - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN);
  return {
    left: Math.max(minX, Math.min(maxX, left)),
    top: Math.max(minY, Math.min(maxY, top)),
  };
}

function applyGhost(left: number, top: number): void {
  const clamped = clampGhost(left, top);
  ghost.style.left = `${Math.round(clamped.left)}px`;
  ghost.style.top = `${Math.round(clamped.top)}px`;
}

function startSession(payload: StartPayload): void {
  session = {
    panelId: payload.panelId,
    startScreenX: payload.startScreenX,
    startScreenY: payload.startScreenY,
    bbox: payload.bbox,
    startOffset: getPanelOffset(payload.panelId),
  };
  ghost.style.width = `${Math.round(payload.bbox.width)}px`;
  ghost.style.height = `${Math.round(payload.bbox.height)}px`;
  ghostLabel.textContent = panelLabel(payload.panelId);
  // Initial render: ghost at the panel's CURRENT bbox in viewport coords.
  // The user's cursor is somewhere on the grip handle — wherever they
  // pressed. As they move, the delta is added to bbox top-left so the
  // ghost shifts in lockstep with the cursor (cursor stays on the same
  // pixel of the ghost the whole time).
  applyGhost(payload.bbox.left, payload.bbox.top);
}

function endSession(persist: boolean, dx: number, dy: number): void {
  if (!session) return;
  const cur = session;
  session = null;
  if (persist) {
    // Clamp the final offset against the same 5px viewport-margin
    // box the ghost was clamped to. Without this the persisted offset
    // would let the panel re-open AT the un-clamped target, then OBR
    // would silently nudge it inward — leaving a mismatch between
    // preview and reality. The clamp computed below mirrors clampGhost.
    const proposedLeft = cur.bbox.left + dx;
    const proposedTop = cur.bbox.top + dy;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = cur.bbox.width;
    const h = cur.bbox.height;
    const clampedLeft = Math.max(
      VIEWPORT_MARGIN,
      Math.min(Math.max(VIEWPORT_MARGIN, vw - w - VIEWPORT_MARGIN), proposedLeft),
    );
    const clampedTop = Math.max(
      VIEWPORT_MARGIN,
      Math.min(Math.max(VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN), proposedTop),
    );
    const adjDx = clampedLeft - cur.bbox.left;
    const adjDy = clampedTop - cur.bbox.top;
    const next: PanelOffset = {
      dx: cur.startOffset.dx + adjDx,
      dy: cur.startOffset.dy + adjDy,
    };
    setPanelOffset(cur.panelId, next);
    try {
      OBR.broadcast.sendMessage(
        BC_PANEL_DRAG_END,
        { panelId: cur.panelId, offset: next },
        { destination: "LOCAL" },
      );
    } catch {}
  } else {
    try {
      OBR.broadcast.sendMessage(
        BC_PANEL_DRAG_CANCEL,
        { panelId: cur.panelId },
        { destination: "LOCAL" },
      );
    } catch {}
  }
}

OBR.onReady(() => {
  // Background encoded the StartPayload into the URL hash so we can
  // render the ghost immediately at mount without a broadcast race.
  try {
    const raw = location.hash.replace(/^#/, "");
    if (raw) {
      const payload = JSON.parse(decodeURIComponent(raw)) as StartPayload;
      startSession(payload);
    }
  } catch (e) {
    console.warn("[drag-preview] failed to parse hash payload", e);
  }

  // Pointer tracking on the document so we don't depend on which
  // exact element happens to be under the cursor — blocker covers
  // everything anyway, but document-level capture is the most
  // defensive option.
  document.addEventListener("pointermove", (e) => {
    if (!session) return;
    const dx = e.screenX - session.startScreenX;
    const dy = e.screenY - session.startScreenY;
    applyGhost(session.bbox.left + dx, session.bbox.top + dy);
  });

  document.addEventListener("pointerup", (e) => {
    if (!session) return;
    const dx = e.screenX - session.startScreenX;
    const dy = e.screenY - session.startScreenY;
    endSession(true, dx, dy);
  });
  document.addEventListener("pointercancel", () => {
    endSession(false, 0, 0);
  });

  // Esc cancels — quick way out if the gesture got into a weird state.
  document.addEventListener("keydown", (e) => {
    if (!session) return;
    if (e.key === "Escape") {
      e.preventDefault();
      endSession(false, 0, 0);
    }
  });

  // Right-click on the blocker also cancels (alternate escape hatch).
  blocker.addEventListener("contextmenu", (e) => {
    if (!session) return;
    e.preventDefault();
    endSession(false, 0, 0);
  });

  // 30-second safety timeout: if no pointerup arrives in this long,
  // the gesture is almost certainly stuck — broadcast cancel so the
  // background closes us. Refreshing-the-tab-only stuck states should
  // never happen with this in place.
  const safetyTimer = setTimeout(() => {
    if (session) {
      console.warn("[drag-preview] safety timeout — broadcasting cancel");
      endSession(false, 0, 0);
    }
  }, 30_000);
  // Tear down the timer when the iframe unloads (modal closes).
  window.addEventListener("beforeunload", () => clearTimeout(safetyTimer));
});
