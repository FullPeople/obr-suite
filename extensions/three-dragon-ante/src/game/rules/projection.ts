import {CARDS,card} from "./cards";
import {eligibleActions, flightStrength, handPowerHints} from "./engine";
import {resolveVariant} from "./variants";
import type {GameState, OmniscientView, PublicEvent, PublicHistoryEntry, PublicReplayFrame, PublicView, ResolutionStep, SeatView, Task} from "./types";
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const knownCardId=(id:unknown):id is string=>typeof id==="string"&&CARDS.some(value=>value.id===id);
function safePublicEvent(value:PublicEvent):PublicEvent {
  return {code:value.code,...(value.seatId?{seatId:value.seatId}:{}),...(value.targetSeatId?{targetSeatId:value.targetSeatId}:{}),...(Array.isArray(value.cardIds)?{cardIds:value.cardIds.filter(id=>typeof id==="string")}:{}),...(value.amount!==undefined&&Number.isFinite(value.amount)?{amount:value.amount}:{}),...(value.effectFamily?{effectFamily:value.effectFamily}:{}),...(value.score?{score:copy(value.score)}:{})};
}
export function sanitizePublicReplayFrame(value:PublicReplayFrame|undefined):PublicReplayFrame|undefined {
  if(!value)return undefined;
  const cardIds=(ids:string[]|undefined)=>Array.isArray(ids)?ids.filter(knownCardId):[];
  return {
    phase:value.phase,gambit:value.gambit,round:value.round,stakes:value.stakes,hole:value.hole,deckCount:value.deckCount,
    leaderSeatId:value.leaderSeatId??null,activeSeatId:value.activeSeatId??null,waitingSeatIds:[...(value.waitingSeatIds??[])],
    ante:cardIds(value.ante),discard:cardIds(value.discard),discardCount:value.discardCount,revealed:cardIds(value.revealed),anteOrigins:(value.anteOrigins??[]).filter(origin=>knownCardId(origin.cardId)).map(origin=>({seatId:origin.seatId,cardId:origin.cardId})),
    seats:value.seats.map(seat=>({id:seat.id,name:seat.name,gold:seat.gold,debt:seat.debt,handCount:seat.handCount,flight:seat.flight.filter(flight=>knownCardId(flight.cardId)).map(flight=>({cardId:flight.cardId,...(flight.wild===undefined?{}:{wild:flight.wild}),...(flight.rider===undefined?{}:{rider:flight.rider})})),strength:seat.strength,scoringStrength:seat.scoringStrength,committed:seat.committed,archmage:seat.archmage})),
    choice:value.choice?{id:value.choice.id,seatId:value.choice.seatId,code:value.choice.code,...(knownCardId(value.choice.sourceCardId)?{sourceCardId:value.choice.sourceCardId}:{}),...(value.choice.beneficiarySeatId?{beneficiarySeatId:value.choice.beneficiarySeatId}:{})}:null,
    resolutionStack:value.resolutionStack.map(step=>({id:step.id,kind:step.kind,status:step.status,...(step.seatId?{seatId:step.seatId}:{}),...(step.targetSeatId?{targetSeatId:step.targetSeatId}:{}),...(knownCardId(step.sourceCardId)?{sourceCardId:step.sourceCardId}:{}),...(step.amount===undefined?{}:{amount:step.amount}),...(step.code?{code:step.code}:{})})),
    lastGambit:copy(value.lastGambit),winners:[...value.winners],issue:value.issue,
    effects:value.effects.map(effect=>({kind:effect.kind,seatId:effect.seatId,...(knownCardId(effect.sourceCardId)?{sourceCardId:effect.sourceCardId}:{})})),
  };
}
function historyPhase(s:GameState):PublicHistoryEntry["phase"] { return s.pending?"choice":s.stage; }
function activeHistorySeat(s:GameState):string|null { return s.pending?.seatId??(s.stage==="play"&&s.seats[s.active]?s.seats[s.active].id:null); }
function publicHistory(s:GameState):{entries:PublicHistoryEntry[];complete:boolean;start:number}{
  const entries:PublicHistoryEntry[]=Array.isArray(s.history)?s.history:s.events.map((event,index)=>({sequence:index+1,revision:s.revision,phase:historyPhase(s),gambit:s.gambit,round:s.round,activeSeatId:activeHistorySeat(s),event}));
  return {entries:entries.map(entry=>({sequence:entry.sequence,revision:entry.revision,phase:entry.phase,gambit:entry.gambit,round:entry.round,activeSeatId:entry.activeSeatId??null,event:safePublicEvent(entry.event),...(entry.frame?{frame:sanitizePublicReplayFrame(entry.frame)}:{})})),complete:Array.isArray(s.history)&&s.historyComplete===true,start:entries[0]?.sequence??0};
}
function publicCardIds(s:GameState):Set<string>{
  const ids=new Set<string>([...s.ante,...s.discard,...s.revealed,...s.seats.flatMap(seat=>seat.flight.map(flight=>flight.cardId))]);
  for(const event of s.events)for(const id of event.cardIds??[])ids.add(id);
  return ids;
}
function publicResolutionStep(s:GameState,task:Task,index:number,publicIds:Set<string>):ResolutionStep{
  const step:ResolutionStep={id:`queue:${index}`,kind:task.kind,status:index===0&&!s.pending?"active":"queued"};
  const seat=s.seats[task.seat];if(seat)step.seatId=seat.id;
  const target=s.seats[task.target??-1];if(target)step.targetSeatId=target.id;
  if(task.source&&publicIds.has(task.source))step.sourceCardId=task.source;
  if(task.amount!==undefined&&Number.isFinite(task.amount))step.amount=task.amount;
  return step;
}
function publicResolutionStack(s:GameState):ResolutionStep[]{
  const publicIds=publicCardIds(s),stack:ResolutionStep[]=[];
  if(s.pending){
    // A choice has two public roles: the beneficiary/caster owns the
    // resolution, while `seatId` is the player who must answer it. Keep those
    // roles in the same actor/target shape as ordinary queued tasks so the
    // stack, seat accent and stage target all point at the affected seat.
    const active:ResolutionStep={id:s.pending.id,kind:"choice",status:"active",seatId:s.pending.beneficiarySeatId??s.pending.seatId,targetSeatId:s.pending.seatId,code:s.pending.code};
    if(s.pending.sourceCardId&&publicIds.has(s.pending.sourceCardId))active.sourceCardId=s.pending.sourceCardId;
    stack.push(active);
  }
  s.queue.forEach((task,index)=>stack.push(publicResolutionStep(s,task,index,publicIds)));
  return stack;
}
export function projectPublic(s:GameState):PublicView {
  const history=publicHistory(s);
  const waiting=s.pending?[s.pending.seatId]:s.stage==="ante"?s.seats.filter(seat=>!Object.prototype.hasOwnProperty.call(s.committed,seat.id)).map(seat=>seat.id):s.stage==="play"?[s.seats[s.active].id]:[];
  return {
    version:1,id:s.id,revision:s.revision,phase:s.pending?"choice":s.stage,
    variant:resolveVariant(s.variant),
    seats:s.seats.map((seat,i)=>({id:seat.id,name:seat.name,gold:seat.gold,debt:seat.debt,handCount:seat.hand.length,
      flight:seat.flight.map(f=>({...f,card:copy(card(f.cardId))})),strength:flightStrength(s,i,s.scoring),scoringStrength:flightStrength(s,i,true),committed:Object.prototype.hasOwnProperty.call(s.committed,seat.id),archmage:seat.archmage})),
    stakes:s.stakes,hole:s.hole,gambit:s.gambit,round:s.round,leaderSeatId:s.round?s.seats[s.leader].id:null,
    activeSeatId:s.pending?.seatId??(s.stage==="play"?s.seats[s.active].id:null),waitingSeatIds:waiting,
    ante:s.ante.map(id=>copy(card(id))),anteOrigins:(s.anteOrigins??[]).filter(origin=>s.ante.includes(origin.cardId)&&s.seats.some(seat=>seat.id===origin.seatId)).map(origin=>({...origin})),discard:s.discard.map(id=>copy(card(id))),deckCount:s.deck.length,
    revealed:s.revealed.map(id=>copy(card(id))),events:copy(s.events),history:history.entries,historyComplete:history.complete,historyStartSequence:history.start,
    choice:s.pending?{id:s.pending.id,seatId:s.pending.seatId,code:s.pending.code,...(s.pending.sourceCardId?{sourceCardId:s.pending.sourceCardId}:{}),...(s.pending.beneficiarySeatId?{beneficiarySeatId:s.pending.beneficiarySeatId}:{})}:null,
    resolutionStack:publicResolutionStack(s),
    lastGambit:copy(s.lastGambit),winners:[...s.winners],issue:s.issue,effects:s.effects.map(e=>({kind:e.kind,seatId:s.seats[e.seat].id,sourceCardId:e.source})),
  };
}
export function projectSeat(s:GameState,seatId:string):SeatView {
  const seat=s.seats.find(p=>p.id===seatId);if(!seat)throw Error("UNKNOWN_SEAT");
  return {...projectPublic(s),selfSeatId:seatId,hand:seat.hand.map(id=>copy(card(id))),
    committedAnte:Object.prototype.hasOwnProperty.call(s.committed,seatId)?copy(card(s.committed[seatId])):null,actions:eligibleActions(s,seatId),handPowerHints:handPowerHints(s,seatId)};
}
/** Deliberately local-only host projection. The returned fields are private
 * inspection data; the controller must keep them out of every wire pack. */
export function projectOmniscient(s:GameState,seatId:string):OmniscientView {
  const base=seatId && s.seats.some(seat=>seat.id===seatId) ? projectSeat(s,seatId) : {...projectPublic(s),selfSeatId:"",hand:[],committedAnte:null,actions:[],handPowerHints:[]};
  return {...base,omniscient:true,privateHands:Object.fromEntries(s.seats.map(seat=>[seat.id,seat.hand.map(id=>copy(card(id)))])),privateCommittedAntes:Object.fromEntries(s.seats.map(seat=>[seat.id,Object.prototype.hasOwnProperty.call(s.committed,seat.id)?copy(card(s.committed[seat.id])):null])),privateHandPowerHints:Object.fromEntries(s.seats.map(seat=>[seat.id,handPowerHints(s,seat.id)])),
    privateDeck:s.deck.map(id=>copy(card(id))),privateExcluded:s.excluded.map(id=>copy(card(id)))};
}
