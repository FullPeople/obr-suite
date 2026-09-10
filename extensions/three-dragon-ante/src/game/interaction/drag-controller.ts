import type { StageHit } from "../stage/types";

export interface DragContext {
  tableId: string; gameId: string; seatId: string; revision: number;
  kind: "ante" | "play" | null; legalCardIds: readonly string[]; locked: boolean;
  /** Optional local page generation; never sent with a rules action. */
  scopeId?: string;
}
export interface DropIntent {
  tableId: string; gameId: string; seatId: string; revision: number;
  kind: "ante" | "play"; cardId: string; zone: "ante" | "flight";
}
interface DragPorts {
  context(): DragContext | null;
  hitTest(x: number, y: number): StageHit | null;
  drag(value: {cardId: string; x: number; y: number} | null): void;
  /** A successful return means locally submitted, never server acceptance. */
  drop(intent: DropIntent): boolean;
  cancel(): void;
  inspect(cardId: string, pinned: boolean): void;
  hover(cardId: string | null): void;
}
/** DOM pointer lifecycle only. Rules remain in the authoritative action path. */
export function mountDragController(element: HTMLElement, ports: DragPorts) {
  let alive = true, frame = 0, inspectTimer: ReturnType<typeof setTimeout> | undefined;
  const pointers = new Set<number>();
  let held: {pointerId:number;cardId:string;x:number;y:number;lastX:number;lastY:number;context:DragContext|null;moving:boolean;inspected:boolean;canDrag:boolean}|null = null;
  const sameIdentity = (a:DragContext|null,b:DragContext|null) => a===null && b===null || !!a && !!b && a.tableId===b.tableId && a.gameId===b.gameId && a.seatId===b.seatId && a.kind===b.kind && a.scopeId===b.scopeId;
  const valid = () => {
    const now=ports.context();
    return held?.canDrag && !!now && sameIdentity(held.context,now) && !now.locked && !!now.kind && now.legalCardIds.includes(held.cardId) ? now : null;
  };
  const stopTimer=()=>{if(inspectTimer)clearTimeout(inspectTimer);inspectTimer=undefined;};
  function finish(cancelled:boolean) {
    if(frame)cancelAnimationFrame(frame);frame=0;stopTimer();
    const previous=held;held=null;
    if(previous) {
      // Capture can already be gone during blur, cancellation or DOM removal.
      try { if(element.hasPointerCapture?.(previous.pointerId))element.releasePointerCapture(previous.pointerId); } catch {}
      ports.hover(null);
    }
    if(cancelled&&previous?.moving)ports.cancel();
  }
  function down(event:PointerEvent) {
    if(!alive||held||pointers.size>1||event.button!==0||!event.isPrimary)return;
    const hit=ports.hitTest(event.clientX,event.clientY);if(!hit||hit.kind==="zone")return;
    if(hit.kind!=="hand"){ports.inspect(hit.cardId,true);return;}
    const current=ports.context(),context=current?{...current,legalCardIds:[...current.legalCardIds]}:null;
    const canDrag=!!context&&!context.locked&&!!context.kind&&context.legalCardIds.includes(hit.cardId)&&(!hit.seatId||hit.seatId===context.seatId);
    held={pointerId:event.pointerId,cardId:hit.cardId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,context,moving:false,inspected:false,canDrag};
    try { element.setPointerCapture?.(event.pointerId); } catch { finish(true); return; }
    ports.hover(hit.cardId);
    const press=held;
    if(event.pointerType!=="mouse")inspectTimer=setTimeout(()=>{
      inspectTimer=undefined;
      if(!alive||held!==press)return;
      if(!sameIdentity(held.context,ports.context())||(held.canDrag&&!valid())){finish(true);return;}
      if(!held.moving){held.inspected=true;ports.inspect(held.cardId,true);}
    },420);
    event.preventDefault();
  }
  function flush() {
    frame=0;if(!alive||!held?.moving)return;
    if(!valid()){finish(true);return;}
    ports.drag({cardId:held.cardId,x:held.lastX,y:held.lastY});
  }
  function move(event:PointerEvent) {
    if(!alive)return;
    if(!held){const hit=ports.hitTest(event.clientX,event.clientY);ports.hover(hit&&hit.kind!=="zone"?hit.cardId:null);return;}
    if(event.pointerId!==held.pointerId)return;
    if(held.inspected)return;
    held.lastX=event.clientX;held.lastY=event.clientY;
    if(!held.moving&&Math.hypot(event.clientX-held.x,event.clientY-held.y)<7)return;
    stopTimer();
    if(!valid()){finish(true);return;}
    held.moving=true;
    if(!frame){const press=held;frame=requestAnimationFrame(()=>{if(alive&&held===press)flush();});}
    event.preventDefault();
  }
  function up(event:PointerEvent) {
    if(!alive||!held||event.pointerId!==held.pointerId)return;
    if(!sameIdentity(held.context,ports.context())||(held.canDrag&&!valid())){finish(true);return;}
    const previous=held,context=valid();
    previous.lastX=event.clientX;previous.lastY=event.clientY;
    if(previous.moving){if(frame)cancelAnimationFrame(frame);frame=0;flush();}
    const hit=ports.hitTest(event.clientX,event.clientY);
    const zone=context?.kind==="ante"?"ante":"flight";
    // A public card in the central ante area is not this player's drop slot.
    const destination=!!hit&&!!context&&hit.zone===zone&&hit.seatId===context.seatId;
    finish(false);
    if(!previous.moving){if(!previous.inspected)ports.inspect(previous.cardId,true);return;}
    // Concurrent antes may change revision while dragging. Revalidate against
    // the newest projection and use its revision, preserving the same intent.
    let submitted=false;
    try { if(context&&destination)submitted=ports.drop({tableId:context.tableId,gameId:context.gameId,seatId:context.seatId,revision:context.revision,
      kind:context.kind!,cardId:previous.cardId,zone}); } finally { if(!submitted)ports.cancel(); }
    event.preventDefault();
  }
  const cancel=(event?:Event)=>{if(!event||!("pointerId" in event)||!held||(event as PointerEvent).pointerId===held.pointerId)finish(true);};
  const pointerStarted=(event:PointerEvent)=>{pointers.add(event.pointerId);if(held&&event.pointerId!==held.pointerId)finish(true);};
  const pointerEnded=(event:PointerEvent)=>{pointers.delete(event.pointerId);if(event.type==="pointercancel")cancel(event);};
  const lost=(event:PointerEvent)=>{if(held?.pointerId===event.pointerId&&!element.hasPointerCapture?.(event.pointerId))cancel(event);};
  const deactivate=()=>{pointers.clear();finish(true);};
  const leave=()=>{if(!held)ports.hover(null);};
  const hidden=()=>{if(document.hidden)deactivate();};
  const key=(event:KeyboardEvent)=>{if(event.key==="Escape"&&held){event.preventDefault();cancel();}};
  element.addEventListener("pointerdown",down);element.addEventListener("pointermove",move);element.addEventListener("pointerup",up);
  element.addEventListener("pointercancel",cancel);element.addEventListener("lostpointercapture",lost);element.addEventListener("pointerleave",leave);
  element.addEventListener("keydown",key);window.addEventListener("blur",deactivate);window.addEventListener("pagehide",deactivate);document.addEventListener("visibilitychange",hidden);
  window.addEventListener("pointerdown",pointerStarted,true);window.addEventListener("pointerup",pointerEnded,true);window.addEventListener("pointercancel",pointerEnded,true);
  return {
    refresh(){if(held&&(!sameIdentity(held.context,ports.context())||(held.canDrag&&!valid())))finish(true);},
    cancel(){cancel();},
    destroy(){alive=false;finish(true);pointers.clear();element.removeEventListener("pointerdown",down);element.removeEventListener("pointermove",move);element.removeEventListener("pointerup",up);
      element.removeEventListener("pointercancel",cancel);element.removeEventListener("lostpointercapture",lost);element.removeEventListener("pointerleave",leave);
      element.removeEventListener("keydown",key);window.removeEventListener("blur",deactivate);window.removeEventListener("pagehide",deactivate);document.removeEventListener("visibilitychange",hidden);
      window.removeEventListener("pointerdown",pointerStarted,true);window.removeEventListener("pointerup",pointerEnded,true);window.removeEventListener("pointercancel",pointerEnded,true);ports.hover(null);},
  };
}
