import { card, CARDS } from "./rules/cards";
import type { PublicEvent, PublicView } from "./rules/types";

/** Rotation stops after this interval; the explanation waits for a click. */
export const POWER_CARD_MOTION_MS = 1500;
export type PowerTargetRelation = "direct" | "choice" | "payment" | "transfer" | "swap";
export interface PowerTarget { seatId:string; relation:PowerTargetRelation }
export interface PowerCue { cardId:string; seatId:string; family:string; key:string; targetSeatIds?:string[]; targetRelations?:PowerTarget[] }
export interface PublicGoldFlow { key:string; fromSeatId:string; toSeatId:string; amount:number; code:string }

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
  const events=freshPublicEvents(before,after);
  return events.flatMap((event,index)=>{
  if(event.code!=="POWER_TRIGGERED"||!event.seatId||!after.seats.some(seat=>seat.id===event.seatId)||!event.cardIds?.[0])return [];
  try {
   const value=card(event.cardIds[0]),validTargets=new Set(after.seats.map(seat=>seat.id));
   const nextPower=events.slice(index+1).findIndex(candidate=>candidate.code==="POWER_TRIGGERED"),segment=events.slice(index+1,nextPower<0?events.length:index+1+nextPower);
   const relations=new Map<string,PowerTargetRelation>();
   const rank=(relation:PowerTargetRelation)=>({direct:0,choice:1,payment:2,transfer:3,swap:4}[relation]);
   const addTarget=(id:string|undefined,relation:PowerTargetRelation)=>{if(!id||!validTargets.has(id))return;const previous=relations.get(id);if(!previous||rank(relation)>rank(previous))relations.set(id,relation);};
   addTarget(event.targetSeatId,"direct");
   for(const step of after.resolutionStack.filter(step=>step.sourceCardId===value.id)){
    const id=step.targetSeatId??(step.kind==="choice"?step.seatId:undefined);
    addTarget(id,step.kind==="choice"?"choice":"direct");
   }
   for(const item of segment){
    const relation=item.code==="PAID_PLAYER"?"payment":item.code==="CARD_TRANSFERRED"?"transfer":item.code==="MORTALS_SWAPPED"?"swap":undefined;
    if(relation)addTarget(item.targetSeatId,relation);
   }
   const targetRelations=[...relations].map(([seatId,relation])=>({seatId,relation})),targetSeatIds=targetRelations.map(target=>target.seatId);
   return [{cardId:value.id,seatId:event.seatId,family:event.effectFamily&&CARDS.some(c=>c.family===event.effectFamily)?event.effectFamily:value.family,key:`${after.id}:${after.revision}:${index}`,...(targetSeatIds.length?{targetSeatIds,targetRelations}: {})}];
  } catch { return []; }
 });
}

/** Convert only already-public transfer records into finite presentation paths.
 * Seat projections never need to reveal a hidden hand to explain these flows:
 * the engine has already published payer, recipient and amount in its event
 * log. A score report is the immutable public source for stakes payouts. */
export function publicGoldFlows(before:PublicView|null|undefined,after:PublicView|null|undefined):PublicGoldFlow[] {
 if(!after)return [];
 const events=freshPublicEvents(before,after),seatIds=new Set(after.seats.map(seat=>seat.id)),flows:PublicGoldFlow[]=[];
 const endpoint=(id:string|undefined)=>id==='stakes'||id==='hole'||!!id&&seatIds.has(id)?id:null;
 const amount=(value:number|undefined)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:null;
 const add=(key:string,code:string,from:string|undefined,to:string|undefined,value:number|undefined)=>{const source=endpoint(from),target=endpoint(to),gold=amount(value);if(!source||!target||source===target||gold===null)return;flows.push({key,code,fromSeatId:source,toSeatId:target,amount:gold});};
 const scored=events.some(event=>event.code==='GAMBIT_SCORED'&&Array.isArray(event.score?.payouts));
 for(const [index,event] of events.entries()){
  const key=`${after.id}:${after.revision}:gold:${index}`;
  if(event.code==='PAID_STAKES')add(key,event.code,event.seatId,'stakes',event.amount);
  else if(event.code==='PAID_PLAYER')add(key,event.code,event.seatId,event.targetSeatId,event.amount);
  else if(event.code==='TOOK_STAKES')add(key,event.code,'stakes',event.seatId,event.amount);
  else if(event.code==='PAID_HOLE')add(key,event.code,event.seatId,'hole',event.amount);
  else if(event.code==='TOOK_HOLE')add(key,event.code,'hole',event.seatId,event.amount);
  else if(event.code==='GAMBIT_SCORED'){if(event.score&&Array.isArray(event.score.payouts))for(const [payoutIndex,payout] of event.score.payouts.entries())if(payout)add(`${key}:payout:${payoutIndex}`,event.code,'stakes',payout.seatId,payout.amount);}
  // Older public logs may contain GAMBIT_WON without the immutable score
  // report. Keep those tables legible without duplicating modern payouts.
  else if(event.code==='GAMBIT_WON'&&!scored)add(key,event.code,'stakes',event.seatId,event.amount);
 }
 return flows;
}

/** Cards remain lit while their public rule effect or response is pending. */
export function activePowerCards(view:PublicView|null|undefined):string[] {
 if(!view)return [];
 const ids=new Set(view.effects.map(effect=>effect.sourceCardId));
 if(view.choice?.sourceCardId)ids.add(view.choice.sourceCardId);
 for(const seat of view.seats)for(const entry of seat.flight)if(entry.wild||entry.rider||seat.archmage&&entry.card.family==="archmage")ids.add(entry.cardId);
 return [...ids];
}
