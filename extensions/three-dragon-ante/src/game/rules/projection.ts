import {card} from "./cards";
import {eligibleActions, flightStrength} from "./engine";
import type {GameState, PublicView, SeatView} from "./types";
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function projectPublic(s:GameState):PublicView {
  const waiting=s.pending?[s.pending.seatId]:s.stage==="ante"?s.seats.filter(seat=>!Object.prototype.hasOwnProperty.call(s.committed,seat.id)).map(seat=>seat.id):s.stage==="play"?[s.seats[s.active].id]:[];
  return {
    version:1,id:s.id,revision:s.revision,phase:s.pending?"choice":s.stage,
    seats:s.seats.map((seat,i)=>({id:seat.id,name:seat.name,gold:seat.gold,debt:seat.debt,handCount:seat.hand.length,
      flight:seat.flight.map(f=>({...f,card:copy(card(f.cardId))})),strength:flightStrength(s,i,s.scoring),committed:Object.prototype.hasOwnProperty.call(s.committed,seat.id),archmage:seat.archmage})),
    stakes:s.stakes,hole:s.hole,gambit:s.gambit,round:s.round,leaderSeatId:s.round?s.seats[s.leader].id:null,
    activeSeatId:s.pending?.seatId??(s.stage==="play"?s.seats[s.active].id:null),waitingSeatIds:waiting,
    ante:s.ante.map(id=>copy(card(id))),anteOrigins:(s.anteOrigins??[]).filter(origin=>s.ante.includes(origin.cardId)&&s.seats.some(seat=>seat.id===origin.seatId)).map(origin=>({...origin})),discard:s.discard.map(id=>copy(card(id))),deckCount:s.deck.length,
    revealed:s.revealed.map(id=>copy(card(id))),events:copy(s.events),
    choice:s.pending?{id:s.pending.id,seatId:s.pending.seatId,code:s.pending.code,...(s.pending.sourceCardId?{sourceCardId:s.pending.sourceCardId}:{}),...(s.pending.beneficiarySeatId?{beneficiarySeatId:s.pending.beneficiarySeatId}:{})}:null,
    lastGambit:copy(s.lastGambit),winners:[...s.winners],issue:s.issue,effects:s.effects.map(e=>({kind:e.kind,seatId:s.seats[e.seat].id,sourceCardId:e.source})),
  };
}
export function projectSeat(s:GameState,seatId:string):SeatView {
  const seat=s.seats.find(p=>p.id===seatId);if(!seat)throw Error("UNKNOWN_SEAT");
  return {...projectPublic(s),selfSeatId:seatId,hand:seat.hand.map(id=>copy(card(id))),
    committedAnte:Object.prototype.hasOwnProperty.call(s.committed,seatId)?copy(card(s.committed[seatId])):null,actions:eligibleActions(s,seatId)};
}
