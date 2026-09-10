import { mountDragController, type DragContext, type DropIntent } from "../extensions/three-dragon-ante/src/game/interaction/drag-controller";
import type { StageHit } from "../extensions/three-dragon-ante/src/game/stage/types";

const element = document.querySelector<HTMLElement>("#stage")!;
const originalCapture = element.setPointerCapture.bind(element);
const originalRelease = element.releasePointerCapture.bind(element);
let context: DragContext | null;
let surface: ReturnType<typeof mountDragController> | undefined;
let capturesFail = false, releasesFail = false, submit = true, frame = 0;
let log: { drags: unknown[]; drops: DropIntent[]; cancels: number; inspections: unknown[]; hovers: unknown[]; pointerIds: number[]; trusted: number; untrusted: number };
const tick = () => { frame++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
element.setPointerCapture = id => { if (capturesFail) throw new DOMException("Capture unavailable", "NotFoundError"); originalCapture(id); };
element.releasePointerCapture = id => { if (releasesFail) throw new DOMException("Capture already gone", "NotFoundError"); originalRelease(id); };
element.addEventListener("pointerdown", event => { log.pointerIds.push(event.pointerId); });
for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) element.addEventListener(type, e => { if(e.isTrusted)log.trusted++;else log.untrusted++; });
function hitTest(x: number, y: number): StageHit | null {
  if (x >= 50 && x <= 160 && y >= 410 && y <= 540) return { kind: "hand", cardId: "black-3", zone: "hand", seatId: "self" };
  if (x >= 175 && x <= 285 && y >= 410 && y <= 540) return { kind: "hand", cardId: "gold-13", zone: "hand", seatId: "self" };
  if (x >= 90 && x <= 285 && y >= 180 && y <= 330) return { kind: "zone", zone: "ante", seatId: "self" };
  if (x >= 310 && x <= 505 && y >= 180 && y <= 330) return { kind: "zone", zone: "flight", seatId: "self" };
  if (x >= 540 && x <= 650 && y >= 180 && y <= 330) return { kind: "card", cardId: "white-5", zone: "flight", seatId: "other" };
  if (x >= 675 && x <= 800 && y >= 180 && y <= 330) return { kind: "zone", zone: "ante", seatId: "other" };
  if (x >= 500 && x <= 650 && y >= 20 && y <= 130) return { kind: "card", cardId: "red-7", zone: "ante" };
  return null;
}
function reset(patch: Partial<DragContext> = {}) {
  surface?.destroy();
  context = { tableId: "table", gameId: "game", seatId: "self", revision: 1, kind: "ante", legalCardIds: ["black-3", "gold-13"], locked: false, ...patch };
  capturesFail = false; releasesFail = false; submit = true;
  log = { drags: [], drops: [], cancels: 0, inspections: [], hovers: [], pointerIds: [], trusted: 0, untrusted: 0 };
  surface = mountDragController(element, {
    context: () => context, hitTest,
    drag: value => { log.drags.push({ value, frame }); document.querySelector("#ghost")!.textContent = value ? `${value.cardId} @ ${value.x},${value.y}` : ""; },
    drop: intent => { log.drops.push(structuredClone(intent)); return submit; },
    cancel: () => { log.cancels++; document.querySelector("#ghost")!.textContent = "returned"; },
    inspect: (cardId, pinned) => log.inspections.push({ cardId, pinned }), hover: value => log.hovers.push(value),
  });
}
reset();
(window as any).dragAudit = {
  reset,
  patch(value: Partial<DragContext> | null, refresh = true) { if(value === null)context = null;else Object.assign(context!, value); if(refresh)surface?.refresh(); },
  captureFailure(value: boolean) { capturesFail = value; }, releaseFailure(value: boolean) { releasesFail = value; },
  submit(value: boolean) { submit = value; }, destroy() { surface?.destroy(); }, cancel() { surface?.cancel(); },
  release() { const id = log.pointerIds.at(-1)!; originalRelease(id); },
  burst(points: number) { const pointerId = log.pointerIds.at(-1)!; for(let i = 0; i < points; i++)element.dispatchEvent(new PointerEvent("pointermove", {pointerId, pointerType:"mouse", isPrimary:true, clientX:140+i/10, clientY:350, buttons:1, bubbles:true})); },
  snapshot() { return structuredClone({ context, log, captured: log.pointerIds.filter(id => element.hasPointerCapture(id)) }); },
};
