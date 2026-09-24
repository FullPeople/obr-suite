// The source grip captures and forwards actual pointer events. Some browsers
// keep those events in the original iframe after the drag preview mounts;
// others deliver them to the preview. Both paths share one gesture identity,
// and the preview commits once. The host buffers an early pointerup until the
// preview's ready message instead of treating a normal release as cancellation.
import OBR from "@owlbear-rodeo/sdk";
import {
  BC_PANEL_DRAG_START,
  BC_PANEL_DRAG_CANCEL,
  BC_PANEL_DRAG_INPUT,
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
  let cancelActive:(()=>void)|undefined;
  const onPointerDown = (event:PointerEvent) => {
    if(event.button!==0)return;
    cancelActive?.();event.preventDefault();event.stopPropagation();
    const gestureId=crypto.randomUUID(),pointerId=event.pointerId;
    handleEl.classList.add('is-dragging');
    try{handleEl.setPointerCapture(pointerId);}catch{}
    let frame=0,latest:PointerEvent|undefined,finished=false;
    const send=(phase:'move'|'end',e:PointerEvent)=>void OBR.broadcast.sendMessage(BC_PANEL_DRAG_INPUT,{panelId,gestureId,phase,screenX:e.screenX,screenY:e.screenY},{destination:'LOCAL'}).catch(()=>{});
    const cleanup=()=>{if(finished)return;finished=true;cancelAnimationFrame(frame);clearTimeout(safety);handleEl.classList.remove('is-dragging');document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancel,true);try{handleEl.releasePointerCapture(pointerId);}catch{}cancelActive=undefined;};
    const move=(e:PointerEvent)=>{if(e.pointerId!==pointerId)return;latest=e;if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(latest&&!finished)send('move',latest);});};
    const up=(e:PointerEvent)=>{if(e.pointerId!==pointerId)return;send('end',e);cleanup();};
    const cancel=()=>{cleanup();void OBR.broadcast.sendMessage(BC_PANEL_DRAG_CANCEL,{panelId,gestureId},{destination:'LOCAL'}).catch(()=>{});};
    const safety=setTimeout(cancel,35000);cancelActive=cancel;
    document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);
    void OBR.broadcast.sendMessage(BC_PANEL_DRAG_START,{panelId,gestureId,startScreenX:event.screenX,startScreenY:event.screenY},{destination:'LOCAL'}).catch(cancel);
  };
  handleEl.addEventListener('pointerdown',onPointerDown);
  return()=>{cancelActive?.();handleEl.removeEventListener('pointerdown',onPointerDown);};
}