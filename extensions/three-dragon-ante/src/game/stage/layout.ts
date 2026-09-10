import type { PublicView, SeatView } from "../rules/types";
import type { Card } from "../rules/cards";
import type { StageZone } from "./types";

export interface Pose { x: number; y: number; z: number; yaw: number; tilt: number; roll?: number; scale: number }
export interface CardPlacement { key: string; card: Card | null; cardId?: string; zone: StageZone; seatId?: string; pose: Pose }
export interface SeatPlacement { id: string; self: boolean; angle: number; x: number; z: number; ante: Pose; flight: Pose; flightWidth:number }
export const flightWidth=(players:number)=>players>=5?3.3:3.8;
export const DECK: Pose = { x: -.8, y: .16, z: 0, yaw: 0, tilt: 0, scale: 1 };
export const DISCARD: Pose = { ...DECK, x: .8 };
export const STAKES = { x: 0, y: .2, z: -2.3 };
export function moneyPlacement(view:PublicView,id:string){
 if(id==='stakes')return{x:STAKES.x,z:STAKES.z,yaw:0,labelX:STAKES.x,labelZ:STAKES.z+.95};
 const seat=seatPlacements(view).find(seat=>seat.id===id);
 if(!seat)return{x:0,z:0,yaw:0,labelX:0,labelZ:0};
 const {x,z,yaw}=seat.ante;
 return{x,z,yaw,labelX:x+Math.sin(yaw)*.93,labelZ:z+Math.cos(yaw)*.93};
}
/** Top-card center; one card rests on the felt, large piles stay bounded. */
export const pileTop = (count: number, step: number) => .027 + Math.min(79, Math.max(0, count - 1)) * step;
export function seatPlacements(view: PublicView): SeatPlacement[] {
  const self = "selfSeatId" in view ? (view as SeatView).selfSeatId : view.seats[0]?.id;
  const first = Math.max(0, view.seats.findIndex(seat => seat.id === self));
  return view.seats.map((seat, index) => {
    const offset = (index - first + view.seats.length) % view.seats.length;
    // From the near/bottom seat, clockwise proceeds toward screen-left.
    const angle = -offset * Math.PI * 2 / view.seats.length;
    const x = Math.sin(angle) * 6.05, z = Math.cos(angle) * 6.05;
    const pose = (along: number, inward: number): Pose => ({ x: x + Math.cos(angle) * along - Math.sin(angle) * inward, y: .11, z: z - Math.sin(angle) * along - Math.cos(angle) * inward, yaw: angle, tilt: 0, scale: .92 });
    const isSelf = seat.id === self && "selfSeatId" in view;
    // One pair anchor per seat: ante always immediately left of the flight,
    // sharing its radial depth. Local hand presentation reserves the near edge.
    const width=flightWidth(view.seats.length),along=.7,inward=isSelf?3.4:0;
    return { id: seat.id, self: isSelf, angle, x, z,flightWidth:width,
      ante: pose(along-width/2-.62-.28,inward), flight:pose(along,inward) };
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
        result.push({ key: `back:${seat.id}:${i}`, card: null, zone: "hand", seatId: seat.id, pose: { x: seat.x + Math.sin(seat.angle) * 2.15 + Math.cos(seat.angle) * offset * .23, y: .26 + i * .006, z: seat.z + Math.cos(seat.angle) * 2.15 - Math.sin(seat.angle) * offset * .23, yaw: seat.angle - offset * .025, tilt: .22, scale: .62 } });
      }
    }
    if (value.committed) result.push({ key: seat.self && privateView?.committedAnte ? privateView.committedAnte.id : `ante:${seat.id}`, card: null, cardId: seat.self ? privateView?.committedAnte?.id : undefined, zone: "ante", seatId: seat.id, pose: { ...seat.ante, y: .15 } });
    value.flight.forEach((entry, i) => { const offset = i - (value.flight.length - 1) / 2; result.push({ key: entry.cardId, card: entry.card, cardId: entry.cardId, zone: "flight", seatId: seat.id, pose: { ...seat.flight, x: seat.flight.x + Math.cos(seat.angle) * offset * Math.min(.38,(seat.flightWidth-.95)/Math.max(1,value.flight.length-1)), z: seat.flight.z - Math.sin(seat.angle) * offset * Math.min(.38,(seat.flightWidth-.95)/Math.max(1,value.flight.length-1)), y: .17 + i * .048, scale: .87 } }); });
  }
  if (view.deckCount) result.push({ key: "deck", card: null, zone: "deck", pose: { ...DECK, y: pileTop(view.deckCount, .005) } });
  const top = view.discard[view.discard.length - 1]; if (top) result.push({ key: top.id, card: top, cardId: top.id, zone: "discard", pose: { ...DISCARD, y: pileTop(view.discard.length, .004) } });
  const origins = new Map((view.anteOrigins ?? []).map(origin => [origin.cardId, origin.seatId]));
  const neutral = view.ante.filter(card => !seats.some(seat => seat.id === origins.get(card.id)));
  view.ante.forEach(card => {
    const seat = seats.find(seat => seat.id === origins.get(card.id));
    const index = neutral.findIndex(value => value.id === card.id);
    result.push({ key: card.id, card, cardId: card.id, zone: "ante", ...(seat ? { seatId: seat.id } : {}),
      pose: seat ? { ...seat.ante, y: .15 } : { x: (index - (neutral.length - 1) / 2) * 1.03, y: .17 + index * .005, z: 1.02, yaw: 0, tilt: 0, scale: .78 } });
  });
  // A source projection can reveal a card in multiple public informational lists;
  // only physical locations above produce objects. Never render `revealed` again.
  return result;
}
/** LE still stores integer gold. Ten decorative silver pieces replace ONE gold. */
export function coinDenominations(gold: number) { const whole = Math.max(0, Math.floor(Number.isFinite(gold) ? gold : 0)); return { gold: Math.max(0, whole - 1), silver: whole ? 10 : 0, totalGold: whole }; }
