import { card } from "./rules/cards";
import type { FlightCard, PublicSeat, PublicView, SeatView } from "./rules/types";
type WireSeat = Omit<PublicSeat, "flight"> & { flight: FlightCard[] };
export type PublicWire = Omit<PublicView, "ante" | "discard" | "revealed" | "seats"> & { ante: string[]; discard: string[]; revealed: string[]; seats: WireSeat[] };
export type SeatWire = PublicWire & { selfSeatId: string; hand: string[]; committedAnte: string | null; actions: SeatView["actions"] };
/** The full static card catalog is already installed. Sending IDs keeps every
 * legal option and public event while avoiding repeated card descriptions. */
export function packPublic(view: PublicView): PublicWire {
  return { version: 1, id: view.id, revision: view.revision, phase: view.phase,
    stakes: view.stakes, hole: view.hole, gambit: view.gambit, round: view.round,
    leaderSeatId: view.leaderSeatId, activeSeatId: view.activeSeatId, waitingSeatIds: view.waitingSeatIds,
    deckCount: view.deckCount, events: view.events, choice: view.choice, lastGambit: view.lastGambit,
    winners: view.winners, issue: view.issue, effects: view.effects,
    anteOrigins: (view.anteOrigins ?? []).filter(origin => view.ante.some(card => card.id === origin.cardId) && view.seats.some(seat => seat.id === origin.seatId)).map(origin => ({ seatId: origin.seatId, cardId: origin.cardId })),
    ante: view.ante.map(card => card.id), discard: view.discard.map(card => card.id), revealed: view.revealed.map(card => card.id),
    seats: view.seats.map(seat => ({ id: seat.id, name: seat.name, gold: seat.gold, debt: seat.debt,
      handCount: seat.handCount, strength: seat.strength, committed: seat.committed, archmage: seat.archmage,
      flight: seat.flight.map(flight => ({ cardId: flight.cardId, ...(flight.wild === undefined ? {} : { wild: flight.wild }), ...(flight.rider === undefined ? {} : { rider: flight.rider }) })) })) };
}
export function packSeat(view: SeatView): SeatWire {
  // This return is private only; packPublic whitelists public top-level fields.
  const packed = packPublic(view);
  return { ...packed, selfSeatId: view.selfSeatId, hand: view.hand.map(card => card.id), committedAnte: view.committedAnte?.id ?? null, actions: view.actions };
}
export function unpackPublic(view: PublicWire): PublicView {
  return { ...view, ante: view.ante.map(id => card(id)), discard: view.discard.map(id => card(id)), revealed: view.revealed.map(id => card(id)),
    seats: view.seats.map(seat => ({ ...seat, flight: seat.flight.map(flight => ({ ...flight, card: card(flight.cardId) })) })) };
}
export function unpackSeat(view: SeatWire): SeatView {
  return { ...unpackPublic(view), selfSeatId: view.selfSeatId, hand: view.hand.map(id => card(id)), committedAnte: view.committedAnte ? card(view.committedAnte) : null, actions: view.actions };
}
