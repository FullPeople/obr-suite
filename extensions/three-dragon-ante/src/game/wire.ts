import { card } from "./rules/cards";
import {DEFAULT_VARIANT} from "./rules/variants";
import {sanitizePublicReplayFrame} from "./rules/projection";
import type { Choice, EligibleAction, FlightCard, HandPowerHint, PublicEvent, PublicHistoryEntry, PublicReplayFrame, PublicSeat, PublicView, ResolutionStep, SeatView } from "./rules/types";
type WireSeat = Omit<PublicSeat, "flight"> & { flight: FlightCard[] };
export type PublicWire = Omit<PublicView, "ante" | "discard" | "revealed" | "seats" | "resolutionStack" | "history" | "historyComplete" | "historyStartSequence" | "variant"> & { ante: string[]; discard: string[]; revealed: string[]; seats: WireSeat[]; variant?: PublicView["variant"]; resolutionStack?: PublicView["resolutionStack"]; history?: PublicHistoryEntry[]; historyComplete?: boolean; historyStartSequence?: number };
export type SeatWire = PublicWire & { selfSeatId: string; hand: string[]; committedAnte: string | null; actions: SeatView["actions"]; handPowerHints?: SeatView["handPowerHints"] };
/** Keep the private-channel snapshot comfortably below its 64 KiB plaintext
 * limit. Older entries are loaded on demand through the history cursor. */
export const HISTORY_WIRE_BUDGET = 48_000;
function packPublicHistoryEntry(value:PublicHistoryEntry):PublicHistoryEntry {
  const frame=value.frame?sanitizePublicReplayFrame(value.frame):undefined;
  return {sequence:value.sequence,revision:value.revision,phase:value.phase,gambit:value.gambit,round:value.round,activeSeatId:value.activeSeatId??null,event:unpackEvent(value.event),...(frame?{frame}:{})};
}
function wireBytes(value:unknown):number{return new TextEncoder().encode(JSON.stringify(value)).length;}
function fitHistory(view:PublicView,budget=HISTORY_WIRE_BUDGET):{entries:PublicHistoryEntry[];complete:boolean;start:number}{
  const all=(view.history??[]).map(packPublicHistoryEntry);
  let low=0,high=all.length,best:PublicHistoryEntry[]=[];
  while(low<=high){
    const take=Math.floor((low+high+1)/2),candidate=all.slice(Math.max(0,all.length-take));
    const probe={id:view.id,revision:view.revision,phase:view.phase,history:candidate,historyComplete:view.historyComplete&&candidate.length===all.length,historyStartSequence:candidate[0]?.sequence??0,
      stakes:view.stakes,hole:view.hole,gambit:view.gambit,round:view.round,leaderSeatId:view.leaderSeatId,activeSeatId:view.activeSeatId,waitingSeatIds:view.waitingSeatIds,
      deckCount:view.deckCount,events:view.events,choice:view.choice,resolutionStack:view.resolutionStack,lastGambit:view.lastGambit,winners:view.winners,issue:view.issue,effects:view.effects,
      variant:view.variant,anteOrigins:view.anteOrigins,ante:view.ante.map(value=>value.id),discard:view.discard.map(value=>value.id),revealed:view.revealed.map(value=>value.id),seats:view.seats.map(seat=>({...seat,flight:seat.flight.map(flight=>({cardId:flight.cardId,...(flight.wild===undefined?{}:{wild:flight.wild}),...(flight.rider===undefined?{}:{rider:flight.rider})}))}))};
    if(wireBytes(probe)<=budget){best=candidate;low=take+1;}else high=take-1;
  }
  return {entries:best,complete:best.length===all.length&&view.historyComplete,start:best[0]?.sequence??0};
}
function makePublicWire(view:PublicView,history:{entries:PublicHistoryEntry[];complete:boolean;start:number}):PublicWire{
  return { version: 1, id: view.id, revision: view.revision, phase: view.phase,
    variant: view.variant,
    stakes: view.stakes, hole: view.hole, gambit: view.gambit, round: view.round,
    leaderSeatId: view.leaderSeatId, activeSeatId: view.activeSeatId, waitingSeatIds: view.waitingSeatIds,
    deckCount: view.deckCount, events: view.events, choice: view.choice?{id:view.choice.id,seatId:view.choice.seatId,code:view.choice.code,...(view.choice.sourceCardId?{sourceCardId:view.choice.sourceCardId}:{}),...(view.choice.beneficiarySeatId?{beneficiarySeatId:view.choice.beneficiarySeatId}:{})}:null, lastGambit: view.lastGambit,
    winners: view.winners, issue: view.issue, effects: view.effects, resolutionStack: view.resolutionStack, history: history.entries, historyComplete: history.complete, historyStartSequence: history.start,
    anteOrigins: (view.anteOrigins ?? []).filter(origin => view.ante.some(card => card.id === origin.cardId) && view.seats.some(seat => seat.id === origin.seatId)).map(origin => ({ seatId: origin.seatId, cardId: origin.cardId })),
    ante: view.ante.map(card => card.id), discard: view.discard.map(card => card.id), revealed: view.revealed.map(card => card.id),
    seats: view.seats.map(seat => ({ id: seat.id, name: seat.name, gold: seat.gold, debt: seat.debt,
      handCount: seat.handCount, strength: seat.strength, scoringStrength: seat.scoringStrength, committed: seat.committed, archmage: seat.archmage,
      flight: seat.flight.map(flight => ({ cardId: flight.cardId, ...(flight.wild === undefined ? {} : { wild: flight.wild }), ...(flight.rider === undefined ? {} : { rider: flight.rider }) })) })) };
}
function unpackVariant(value:PublicView["variant"]|undefined):PublicView["variant"] {
  if(!value)return {...DEFAULT_VARIANT};
  return {ruleSetId:value.ruleSetId,deckId:value.deckId,...(value.specialIds===undefined?{}:{specialIds:[...value.specialIds]})};
}
function unpackEvent(value:PublicEvent):PublicEvent {
  return {code:value.code,...(value.seatId===undefined?{}:{seatId:value.seatId}),...(value.targetSeatId===undefined?{}:{targetSeatId:value.targetSeatId}),...(Array.isArray(value.cardIds)?{cardIds:value.cardIds.filter(id=>typeof id==="string")} : {}),...(value.amount!==undefined&&Number.isFinite(value.amount)?{amount:value.amount}:{}),...(value.effectFamily===undefined?{}:{effectFamily:value.effectFamily}),...(value.score?{score:{
    gambit:value.score.gambit,round:value.score.round,reason:value.score.reason,weakest:value.score.weakest,
    rows:value.score.rows.map(row=>({seatId:row.seatId,cards:row.cards.map(entry=>({cardId:entry.cardId,points:entry.points})),bonus:row.bonus,total:row.total,eligible:row.eligible})),
    winners:[...value.score.winners],stakes:value.score.stakes,payouts:value.score.payouts.map(payout=>({seatId:payout.seatId,amount:payout.amount}))
  }}:{})};
}
function unpackReplayFrame(value:unknown):PublicReplayFrame|undefined {
  try {
    if(!value||typeof value!=="object")return undefined;
    const frame=value as Record<string,unknown>;
    if(!Array.isArray(frame.waitingSeatIds)||!Array.isArray(frame.ante)||!Array.isArray(frame.discard)||!Array.isArray(frame.revealed)||!Array.isArray(frame.seats)||!Array.isArray(frame.resolutionStack)||!Array.isArray(frame.winners)||!Array.isArray(frame.effects))return undefined;
    return sanitizePublicReplayFrame(frame as unknown as PublicReplayFrame);
  } catch { return undefined; }
}
export function unpackPublicHistoryEntry(value:PublicHistoryEntry):PublicHistoryEntry {
  const frame=unpackReplayFrame(value.frame);
  return {sequence:value.sequence,revision:value.revision,phase:value.phase,gambit:value.gambit,round:value.round,activeSeatId:value.activeSeatId??null,event:unpackEvent(value.event),...(frame?{frame}:{})};
}
function unpackResolutionStep(value:ResolutionStep):ResolutionStep {
  return {id:value.id,kind:value.kind,status:value.status,...(value.seatId===undefined?{}:{seatId:value.seatId}),...(value.targetSeatId===undefined?{}:{targetSeatId:value.targetSeatId}),...(value.sourceCardId===undefined?{}:{sourceCardId:value.sourceCardId}),...(value.amount===undefined?{}:{amount:value.amount}),...(value.code===undefined?{}:{code:value.code})};
}
function unpackPublicSeat(value:WireSeat):PublicSeat {
  return {id:value.id,name:value.name,gold:value.gold,debt:value.debt,handCount:value.handCount,strength:value.strength,scoringStrength:value.scoringStrength,committed:value.committed,archmage:value.archmage,
    flight:value.flight.map(flight=>({cardId:flight.cardId,...(flight.wild===undefined?{}:{wild:flight.wild}),...(flight.rider===undefined?{}:{rider:flight.rider}),card:card(flight.cardId)}))};
}
function unpackChoice(value:PublicView["choice"]):PublicView["choice"] {
  return value?{id:value.id,seatId:value.seatId,code:value.code,...(value.sourceCardId===undefined?{}:{sourceCardId:value.sourceCardId}),...(value.beneficiarySeatId===undefined?{}:{beneficiarySeatId:value.beneficiarySeatId})}:null;
}
function unpackEligibleAction(value:EligibleAction):EligibleAction {
  if(value.kind!=="choose")return {kind:value.kind,cardIds:[...value.cardIds]};
  const choice:Choice=value.choice;
  return {kind:"choose",choice:{id:choice.id,seatId:choice.seatId,code:choice.code,options:choice.options.map(option=>({id:option.id,...(option.code===undefined?{}:{code:option.code}),...(option.cardId===undefined?{}:{cardId:option.cardId}),...(option.seatId===undefined?{}:{seatId:option.seatId})})),min:choice.min,max:choice.max,...(choice.sourceCardId===undefined?{}:{sourceCardId:choice.sourceCardId}),...(choice.beneficiarySeatId===undefined?{}:{beneficiarySeatId:choice.beneficiarySeatId})}};
}
function unpackHandPowerHint(value:HandPowerHint):HandPowerHint {
  return {cardId:value.cardId,state:value.state,reason:value.reason,ruleTriggers:value.ruleTriggers,...(value.comparedCardId===undefined?{}:{comparedCardId:value.comparedCardId}),...(value.comparedStrength===undefined?{}:{comparedStrength:value.comparedStrength})};
}
/** The full static card catalog is already installed. Sending IDs keeps every
 * legal option and public event while avoiding repeated card descriptions. */
export function packPublic(view: PublicView,budget=HISTORY_WIRE_BUDGET): PublicWire {
  const history=fitHistory(view,budget);
  return makePublicWire(view,history);
}
export function packSeat(view: SeatView,budget=HISTORY_WIRE_BUDGET): SeatWire {
  // This return is private only; packPublic whitelists public top-level fields.
  const packed = packPublic(view,budget);
  return { ...packed, selfSeatId: view.selfSeatId, hand: view.hand.map(card => card.id), committedAnte: view.committedAnte?.id ?? null, actions: view.actions, handPowerHints: view.handPowerHints };
}
export function unpackPublic(view: PublicWire): PublicView {
  const events=view.events.map(unpackEvent);
  const history=view.history?view.history.map(unpackPublicHistoryEntry):events.map((event,index)=>({sequence:index+1,revision:view.revision,phase:view.phase,gambit:view.gambit,round:view.round,activeSeatId:view.activeSeatId,event}));
  return {
    version:view.version,id:view.id,revision:view.revision,phase:view.phase,variant:unpackVariant(view.variant),
    seats:view.seats.map(unpackPublicSeat),stakes:view.stakes,hole:view.hole,gambit:view.gambit,round:view.round,
    leaderSeatId:view.leaderSeatId,activeSeatId:view.activeSeatId,waitingSeatIds:[...view.waitingSeatIds],
    ante:view.ante.map(id=>card(id)),discard:view.discard.map(id=>card(id)),deckCount:view.deckCount,revealed:view.revealed.map(id=>card(id)),events,
    history,historyComplete:view.historyComplete??false,historyStartSequence:view.historyStartSequence??history[0]?.sequence??0,
    anteOrigins:view.anteOrigins?.map(origin=>({seatId:origin.seatId,cardId:origin.cardId})),choice:unpackChoice(view.choice),
    resolutionStack:(view.resolutionStack??[]).map(unpackResolutionStep),lastGambit:view.lastGambit?{number:view.lastGambit.number,winners:[...view.lastGambit.winners],reason:view.lastGambit.reason,strengths:{...view.lastGambit.strengths},stakes:view.lastGambit.stakes}:null,
    winners:[...view.winners],issue:view.issue,effects:view.effects.map(effect=>({kind:effect.kind,seatId:effect.seatId,sourceCardId:effect.sourceCardId}))
  };
}
export function unpackSeat(view: SeatWire): SeatView {
  const handPowerHints=view.handPowerHints??view.hand.map(cardId=>({cardId,state:"unavailable" as const,reason:"legacy-sync" as const,ruleTriggers:false}));
  return { ...unpackPublic(view), selfSeatId:view.selfSeatId,hand:view.hand.map(id=>card(id)),committedAnte:view.committedAnte?card(view.committedAnte):null,actions:view.actions.map(unpackEligibleAction),handPowerHints:handPowerHints.map(unpackHandPowerHint) };
}
