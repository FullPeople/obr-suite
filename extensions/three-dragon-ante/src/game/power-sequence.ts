import { card, CARDS } from "./rules/cards";
import type { PublicEvent, PublicView } from "./rules/types";

/** Rotation stops after this interval; the explanation waits for a click. */
export const POWER_CARD_MOTION_MS = 1500;
export interface PowerCue { cardId:string; seatId:string; family:string; key:string }

/** Consume a new public log suffix, including coalesced revisions. First load
 * and unmatched history gaps have no provable suffix and are not replayed. */
export function freshPublicEvents(before:PublicView|null|undefined,after:PublicView|null|undefined):PublicEvent[] {
 if(!before||!after||before.id!==after.id||after.revision<=before.revision)return [];
 const old=before.events.map(event=>JSON.stringify(event)),next=after.events.map(event=>JSON.stringify(event));
 if(!old.length)return after.revision===before.revision+1?after.events:[];
 for(let size=Math.min(old.length,next.length);size>0;size--)if(old.slice(-size).every((event,i)=>event===next[i]))return after.events.slice(size);
 return [];
}
export function powerEvents(before:PublicView|null|undefined,after:PublicView|null|undefined):PowerCue[] {
 if(!after)return [];
 return freshPublicEvents(before,after).flatMap((event,index)=>{
  if(event.code!=="POWER_TRIGGERED"||!event.seatId||!after.seats.some(seat=>seat.id===event.seatId)||!event.cardIds?.[0])return [];
  try { const value=card(event.cardIds[0]);return [{cardId:value.id,seatId:event.seatId,family:event.effectFamily&&CARDS.some(c=>c.family===event.effectFamily)?event.effectFamily:value.family,key:`${after.id}:${after.revision}:${index}`}]; } catch { return []; }
 });
}

/** Cards remain lit while their public rule effect or response is pending. */
export function activePowerCards(view:PublicView|null|undefined):string[] {
 if(!view)return [];
 const ids=new Set(view.effects.map(effect=>effect.sourceCardId));
 if(view.choice?.sourceCardId)ids.add(view.choice.sourceCardId);
 for(const seat of view.seats)for(const entry of seat.flight)if(entry.wild||entry.rider||seat.archmage&&entry.card.family==="archmage")ids.add(entry.cardId);
 return [...ids];
}
