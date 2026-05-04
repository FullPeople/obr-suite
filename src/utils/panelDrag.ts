// Iframe-side drag handle binder.
//
// Each draggable popover's iframe entry script wires its grip element
// once via `bindPanelDrag(handleEl, panelId)`. The grip's only job is
// to detect the user's pointerdown intent and ask the background
// module to open the fullscreen drag-preview modal — the modal then
// owns the rest of the gesture (move, up, cancel).
//
// We do NOT try to track pointermove/pointerup inside the source
// iframe. When OBR.modal.open mounts a new fullscreen iframe on top
// of our popover, the OS / browser may release the source iframe's
// pointer capture and route subsequent events to the modal layer
// instead — a stuck gesture with no pointerup ever firing is the
// observed bug. Letting the modal own everything sidesteps the
// cross-iframe handoff entirely.
//
// Safety net: if the user releases or moves OUT of the iframe before
// the modal has mounted, we still want the gesture to be observable
// — so we attach a one-shot document-level pointerup listener that
// broadcasts BC_PANEL_DRAG_CANCEL. The modal also handles cancel
// independently via Esc / blocker click; the two paths converge in
// background.ts which closes the modal idempotently.

import OBR from "@owlbear-rodeo/sdk";
import {
  BC_PANEL_DRAG_START,
  BC_PANEL_DRAG_CANCEL,
  computePanelBbox,
} from "./panelLayout";

// Side-aware orientation helper used by every iframe that wants its
// drag handle to flip to the OPPOSITE side of the panel from the
// nearest viewport edge. Panel on the left half → handle pinned to
// its RIGHT edge; right half → handle pinned to its LEFT edge.
//
// Background owns the bbox registry, so the iframes ask via the
// `?side=` URL param (set when the popover is opened) and listen for
// the BC_PANEL_SIDE_HINT broadcast for live updates after a drag.
export type DragSide = "left" | "right";

/** Read initial side from the iframe's URL `?side=left|right` query
 *  param. Defaults to `right` (most panels are on the left edge by
 *  default; cluster trigger / row anchor bottom-left). */
export function readInitialSide(): DragSide {
  try {
    const v = new URLSearchParams(location.search).get("side");
    if (v === "left" || v === "right") return v;
  } catch {}
  return "right";
}

export const BC_PANEL_SIDE_HINT = "com.obr-suite/panel-side-hint";

/** Subscribe to side-hint broadcasts from background. Calls `onChange`
 *  immediately with the URL-derived value, then again whenever
 *  background re-opens the popover with a new `side` after a drag. */
export function watchDragSide(
  panelId: string,
  onChange: (side: DragSide) => void,
): () => void {
  onChange(readInitialSide());
  return OBR.broadcast.onMessage(BC_PANEL_SIDE_HINT, (event) => {
    const data = event.data as { panelId?: string; side?: string } | undefined;
    if (!data || data.panelId !== panelId) return;
    if (data.side === "left" || data.side === "right") {
      onChange(data.side);
    }
  });
}

/** Compute side for a given bbox + viewport width. Background uses
 *  this when opening / re-opening a panel to set the URL param + emit
 *  the broadcast. Panel center on left half → handle on right side. */
export function computeSideForBbox(
  bbox: { left: number; width: number },
  viewportWidth: number,
): DragSide {
  const center = bbox.left + bbox.width / 2;
  return center < viewportWidth / 2 ? "right" : "left";
}

export function applyDragSide(handleEl: HTMLElement, side: DragSide): void {
  handleEl.dataset.side = side;
}

// Keep computePanelBbox on the import surface so other modules can
// still pull it through this file if ever needed.
void computePanelBbox;

export function bindPanelDrag(handleEl: HTMLElement, panelId: string): () => void {
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handleEl.classList.add("is-dragging");
    try {
      OBR.broadcast.sendMessage(
        BC_PANEL_DRAG_START,
        {
          panelId,
          startScreenX: e.screenX,
          startScreenY: e.screenY,
        },
        { destination: "LOCAL" },
      );
    } catch {}

    // Pre-mount safety net: if the user releases before the modal
    // mounts (unlikely but possible during the ~50ms open-modal
    // window), broadcast a cancel so background can close any modal
    // that did manage to open. This listener self-destructs on first
    // pointerup or after 800ms — long enough for the modal to be up.
    const cleanup = (cancelled: boolean) => {
      handleEl.classList.remove("is-dragging");
      document.removeEventListener("pointerup", onEarlyUp, true);
      document.removeEventListener("pointercancel", onEarlyCancel, true);
      clearTimeout(armTimer);
      if (cancelled) {
        try {
          OBR.broadcast.sendMessage(
            BC_PANEL_DRAG_CANCEL,
            { panelId },
            { destination: "LOCAL" },
          );
        } catch {}
      }
    };
    const onEarlyUp = () => cleanup(true);
    const onEarlyCancel = () => cleanup(true);
    document.addEventListener("pointerup", onEarlyUp, true);
    document.addEventListener("pointercancel", onEarlyCancel, true);
    // Disarm after the modal should have mounted. Modal owns the
    // gesture from then on; if its own pointerup never fires, modal-
    // side safety nets (Esc, click blocker, 30s timeout in background)
    // take over.
    const armTimer = setTimeout(() => cleanup(false), 800);
  };

  handleEl.addEventListener("pointerdown", onPointerDown);

  return () => {
    handleEl.removeEventListener("pointerdown", onPointerDown);
  };
}
