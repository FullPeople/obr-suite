import type { PublicSeat } from "./rules/types";

/** Public-only formation labels shared by the WebGL and DOM table surfaces. */
export type PublicFlightFormationKind = "color" | "strength" | "mortal";

/**
 * A formation is a presentation label, not a new rules calculation. It uses
 * only the already-public flight faces and deliberately excludes wild cards;
 * reward eligibility remains authoritative in the rules engine.
 */
export function publicFlightFormation(seat: PublicSeat): PublicFlightFormationKind | null {
  if (seat.flight.length < 3 || seat.flight.some(entry => entry.wild)) return null;
  const cards = seat.flight.map(entry => entry.card);
  if (cards.every(value => value.alignment === "mortal")) return "mortal";
  if (cards.every(value => value.color !== undefined && value.color === cards[0].color)) return "color";
  if (cards.every(value => value.strength === cards[0].strength)) return "strength";
  return null;
}
