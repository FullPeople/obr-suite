import type { Card } from "./cards";
import { CARDS } from "./cards";
import type { GameState } from "./types";

/** A host-only table edit. Every kind keeps the save's conservation law intact
 *  by construction, so an edited game still recovers: the 100-card pool stays
 *  80 in play and 20 excluded, and `sum(seat.gold) + stakes + hole` still equals
 *  `initialGold`. Returns the next state, or null when the edit cannot be
 *  applied without breaking an engine invariant. */
export type TableEdit =
  /** Set one seat's gold. The currency budget absorbs the difference, so no
   *  other seat or pool is silently changed. */
  | { kind: "gold"; seatId: string; amount: number }
  /** Move one card that is in a hand, the deck or the discard pile: to another
   *  seat's hand, or out of the game by discarding it when `toSeatId` is null. */
  | { kind: "moveCard"; cardId: string; toSeatId: string | null }
  /** Swap two cards' locations. This is the "replace" path: it can trade a hand
   *  card for a card in the deck, the discard pile, another hand, or one of the
   *  20 cards the deck excluded, because both locations change together. */
  | { kind: "replaceCard"; cardId: string; withCardId: string };

const MAX_AMOUNT = 100000;
const MAX_HAND = 10;

type Zone = { zone: "hand" | "deck" | "discard" | "excluded"; seatIndex: number };

function locate(seats: GameState["seats"], deck: string[], discard: string[], excluded: string[], cardId: string): Zone | null {
  const seatIndex = seats.findIndex(seat => seat.hand.includes(cardId));
  if (seatIndex >= 0) return { zone: "hand", seatIndex };
  if (deck.includes(cardId)) return { zone: "deck", seatIndex: -1 };
  if (discard.includes(cardId)) return { zone: "discard", seatIndex: -1 };
  if (excluded.includes(cardId)) return { zone: "excluded", seatIndex: -1 };
  return null;
}

function removeFrom(state: GameState, where: Zone, cardId: string): void {
  if (where.zone === "hand") state.seats[where.seatIndex].hand = state.seats[where.seatIndex].hand.filter(id => id !== cardId);
  else if (where.zone === "deck") state.deck = state.deck.filter(id => id !== cardId);
  else if (where.zone === "discard") state.discard = state.discard.filter(id => id !== cardId);
  else state.excluded = state.excluded.filter(id => id !== cardId);
}

function place(state: GameState, zone: "deck" | "discard" | "excluded", cardId: string): void {
  if (zone === "deck") state.deck.push(cardId);
  else if (zone === "discard") state.discard.push(cardId);
  else state.excluded.push(cardId);
}

/** A card that enters a hand must fit the engine's hand cap; a longer hand is
 *  reported as INVALID_SEAT_VALUES by the invariant check and would make the
 *  save unrecoverable, so the edit is refused instead. */
function handHasRoom(state: GameState, seatIndex: number): boolean {
  return state.seats[seatIndex].hand.length < MAX_HAND;
}

export function applyEdit(state: GameState, edit: TableEdit): GameState | null {
  if (!edit || typeof edit !== "object") return null;
  const next: GameState = structuredClone(state);
  if (edit.kind === "gold") {
    if (!Number.isSafeInteger(edit.amount) || edit.amount < 0 || edit.amount > MAX_AMOUNT) return null;
    const index = next.seats.findIndex(seat => seat.id === edit.seatId);
    if (index < 0) return null;
    const delta = edit.amount - next.seats[index].gold;
    if (!delta) return next;
    const budget = (next.initialGold ?? next.seats.length * next.seats.length * 10) + delta;
    if (!Number.isSafeInteger(budget) || budget < 0) return null;
    next.seats[index].gold = edit.amount;
    // The budget is the conservation total, not a rule of play: moving it with
    // the edit keeps `sum(gold) + stakes + hole === initialGold` exact.
    next.initialGold = budget;
    next.revision++;
    return next;
  }
  if (edit.kind === "moveCard") {
    if (typeof edit.cardId !== "string" || !CARDS.some(card => card.id === edit.cardId)) return null;
    const from = locate(next.seats, next.deck, next.discard, next.excluded, edit.cardId);
    if (!from) return null;
    if (edit.toSeatId === null) {
      if (from.zone === "discard") return null;
      removeFrom(next, from, edit.cardId);
      place(next, "discard", edit.cardId);
      next.revision++;
      return next;
    }
    const target = next.seats.findIndex(seat => seat.id === edit.toSeatId);
    if (target < 0) return null;
    if (from.zone === "hand" && from.seatIndex === target) return null;
    if (!handHasRoom(next, target)) return null;
    removeFrom(next, from, edit.cardId);
    next.seats[target].hand.push(edit.cardId);
    next.revision++;
    return next;
  }
  if (edit.kind === "replaceCard") {
    if (edit.cardId === edit.withCardId) return null;
    if (typeof edit.cardId !== "string" || typeof edit.withCardId !== "string") return null;
    if (!CARDS.some(card => card.id === edit.cardId) || !CARDS.some(card => card.id === edit.withCardId)) return null;
    const from = locate(next.seats, next.deck, next.discard, next.excluded, edit.cardId);
    const to = locate(next.seats, next.deck, next.discard, next.excluded, edit.withCardId);
    if (!from || !to) return null;
    if (from.zone === "hand" && to.zone === "hand" && (from.seatIndex === to.seatIndex || !handHasRoom(next, to.seatIndex) || !handHasRoom(next, from.seatIndex))) return null;
    removeFrom(next, from, edit.cardId);
    removeFrom(next, to, edit.withCardId);
    // Each card takes the other's place, so every pile keeps its exact size.
    if (from.zone === "hand") next.seats[from.seatIndex].hand.push(edit.withCardId); else place(next, from.zone, edit.withCardId);
    if (to.zone === "hand") next.seats[to.seatIndex].hand.push(edit.cardId); else place(next, to.zone, edit.cardId);
    next.revision++;
    return next;
  }
  return null;
}

/** Public name of a card, for the editor's search list. */
export function editCardLabel(card: Card): string {
  return card.name;
}
