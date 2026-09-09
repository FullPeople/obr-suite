import type { PublicView, SeatView } from "../rules/types";
import type { Card } from "../rules/cards";
import type { StageZone } from "./types";

export interface Pose { x: number; y: number; z: number; yaw: number; tilt: number; roll?: number; scale: number }
export interface CardPlacement { key: string; card: Card | null; cardId?: string; zone: StageZone; seatId?: string; pose: Pose }
export interface SeatPlacement { id: string; self: boolean; angle: number; x: number; z: number; ante: Pose; flight: Pose }
export const DECK: Pose = { x: -1.55, y: .16, z: -.45, yaw: -.07, tilt: 0, scale: 1 };
export const DISCARD: Pose = { ...DECK, x: 1.6, yaw: .08 };
export const STAKES = { x: 0, y: .2, z: -2.0 };
/** Top-card center; one card rests on the felt, large piles stay bounded. */
export const pileTop = (count: number, step: number) => .027 + Math.min(79, Math.max(0, count - 1)) * step;
export function seatPlacements(view: PublicView): SeatPlacement[] {
  const self = "selfSeatId" in view ? (view as SeatView).selfSeatId : view.seats[0]?.id;
  const first = Math.max(0, view.seats.findIndex(seat => seat.id === self));
  return view.seats.map((seat, index) => {
    const offset = (index - first + view.seats.length) % view.seats.length;
    const angle = offset * Math.PI * 2 / view.seats.length;
    const x = Math.sin(angle) * 6.6, z = Math.cos(angle) * 4.5;
    const pose = (along: number, inward: number): Pose => ({ x: x + Math.cos(angle) * along - Math.sin(angle) * inward, y: .11, z: z - Math.sin(angle) * along - Math.cos(angle) * inward, yaw: angle, tilt: 0, scale: .92 });
    const isSelf = seat.id === self && "selfSeatId" in view;
    // Foreground hand cards occupy the near edge of this client's view. Keep
    // the two own drop targets on the visible cloth, beyond that fan.
    return { id: seat.id, self: isSelf, angle, x, z,
      ante: isSelf ? pose(-3, 2.3) : pose(-2, .2),
      flight: isSelf ? pose(.5, 2.6) : pose(0, 1.15) };
  });
}
export function placements(view: PublicView): CardPlacement[] {
  const result: CardPlacement[] = []; const seats = seatPlacements(view);
  const privateView = "selfSeatId" in view ? view as SeatView : null;
  for (const seat of seats) {
    const value = view.seats.find(s => s.id === seat.id)!;
    if (seat.self && privateView) {
      const count = privateView.hand.length;
      privateView.hand.forEach((card, i) => {
        const offset = i - (count - 1) / 2;
        result.push({ key: card.id, card, cardId: card.id, zone: "hand", seatId: seat.id, pose: { x: offset * Math.min(1.06, 8.8 / Math.max(1, count - 1)), y: 1.0 + i * .008, z: 6.05 + offset * offset * .024, yaw: -offset * .065, tilt: .5, scale: 1.35 } });
      });
    } else {
      for (let i = 0; i < Math.min(value.handCount, 10); i++) {
        const offset = i - (Math.min(value.handCount, 10) - 1) / 2;
        result.push({ key: `back:${seat.id}:${i}`, card: null, zone: "hand", seatId: seat.id, pose: { x: seat.x + Math.sin(seat.angle) * .72 + Math.cos(seat.angle) * offset * .3, y: .26 + i * .006, z: seat.z + Math.cos(seat.angle) * .72 - Math.sin(seat.angle) * offset * .3, yaw: seat.angle - offset * .04, tilt: .12, scale: .74 } });
      }
    }
    if (value.committed) result.push({ key: seat.self && privateView?.committedAnte ? privateView.committedAnte.id : `ante:${seat.id}`, card: null, cardId: seat.self ? privateView?.committedAnte?.id : undefined, zone: "ante", seatId: seat.id, pose: { ...seat.ante, y: .15 } });
    value.flight.forEach((entry, i) => { const offset = i - (value.flight.length - 1) / 2; result.push({ key: entry.cardId, card: entry.card, cardId: entry.cardId, zone: "flight", seatId: seat.id, pose: { ...seat.flight, x: seat.flight.x + Math.cos(seat.angle) * offset * 1.08, z: seat.flight.z - Math.sin(seat.angle) * offset * 1.08, y: .17 + i * .006, scale: .87 } }); });
  }
  if (view.deckCount) result.push({ key: "deck", card: null, zone: "deck", pose: { ...DECK, y: pileTop(view.deckCount, .005) } });
  const top = view.discard[view.discard.length - 1]; if (top) result.push({ key: top.id, card: top, cardId: top.id, zone: "discard", pose: { ...DISCARD, y: pileTop(view.discard.length, .004) } });
  view.ante.forEach((card, i) => result.push({ key: card.id, card, cardId: card.id, zone: "ante", pose: { x: (i - (view.ante.length - 1) / 2) * 1.03, y: .17 + i * .005, z: 1.02, yaw: 0, tilt: 0, scale: .78 } }));
  // A source projection can reveal a card in multiple public informational lists;
  // only physical locations above produce objects. Never render `revealed` again.
  return result;
}
/** LE still stores integer gold. Ten decorative silver pieces replace ONE gold. */
export function coinDenominations(gold: number) { const whole = Math.max(0, Math.floor(Number.isFinite(gold) ? gold : 0)); return { gold: Math.max(0, whole - 1), silver: whole ? 10 : 0, totalGold: whole }; }
