import type { OmniscientView, PublicView, SeatView } from "../rules/types";
import type { Card } from "../rules/cards";
import type { StageZone } from "./types";

export interface Pose { x: number; y: number; z: number; yaw: number; tilt: number; roll?: number; scale: number }
export interface CardPlacement { key: string; card: Card | null; cardId?: string; zone: StageZone; seatId?: string; pose: Pose }

/** The three tightly adjacent zones of one seat, ordered along the seat's own
 *  tangent so that they form one continuous strip with no gaps. */
export type SeatStripKind = "ante" | "coins" | "flight";
export interface SeatStripZone {
  kind: SeatStripKind;
  /** Centre offset along the seat tangent, relative to the strip centre. */
  along: number;
  /** Extent across the tangent, in world units. */
  width: number;
  /** Depth across the tangent's normal, in world units. */
  depth: number;
  /** Rounded outer corners, in the zone plane's own local frame. */
  roundStart: boolean;
  roundEnd: boolean;
}
export interface SeatPlacement {
  id: string; self: boolean; angle: number; x: number; z: number;
  /** Outward unit normal of the seat, pointing away from the table centre. */
  nx: number; nz: number;
  /** The seat's contiguous ante | coins | flight strip. */
  strip: SeatStripZone[];
  ante: Pose; coins: Pose; flight: Pose;
  /** Centred badge anchors, raised above each region as seen from the camera. */
  flightBadge: { x: number; z: number };
  coinsBadge: { x: number; z: number };
  flightWidth: number;
}

/** A two-to-three player table stays round; four or more use a rounded square
 *  with the seats distributed along its edges. */
export type TableShape = "round" | "square";
export const tableShape = (players: number): TableShape => players >= 4 ? "square" : "round";
export const TABLE = {
  round: { feltRadius: 7.93, railRadius: 8.3, seatRadius: 6.05 },
  square: { half: 7.9, corner: 2.0, railInset: .4, seatDepth: 6.05 },
};
/** Zone sizes. `A+C+F` is the seat strip's tangent extent. */
export const ZONE_DEPTH = 2.523;
/** Every card lying in a player's own strip: the ante and the flight read the
 *  same size, so the two zones can never drift apart again. */
export const ZONE_CARD_SCALE = 1.104;
const ANTE_WIDTH = 1.236, COIN_WIDTH = 1.15, COIN_GAP = .34, STRIP_MARGIN = .35;
/** Radial distance of the viewer's own strip from the table centre. It is held
 *  constant across both table shapes so the private hand fan clears the seat's
 *  own regions by the same margin everywhere. */
export const SELF_STRIP_DEPTH = 2.65;
export const flightWidth = (players: number) => players >= 5 ? 3.3 : 3.8;
/** Two seats sharing an edge need a narrower flight so the strips stay apart. */
const sharedFlightWidth = 2.95, loneFlightWidth = 3.8;
/** Clockwise on screen from the viewer's own edge: bottom, left, top, right. */
const EDGES = [
  { nx: 0, nz: 1 }, { nx: -1, nz: 0 }, { nx: 0, nz: -1 }, { nx: 1, nz: 0 },
] as const;

export const DECK: Pose = { x: -.8, y: .16, z: 0, yaw: 0, tilt: 0, scale: 1 };
export const DISCARD: Pose = { ...DECK, x: .8 };
export const STAKES = { x: 0, y: .2, z: -2.3 };
/** Public debt-repayment pool. It is informational only: no action can target it. */
export const HOLE = { x: 2.35, y: .2, z: -2.3 };
export function moneyPlacement(view:PublicView,id:string){
 if(id==='stakes')return{x:STAKES.x,z:STAKES.z,yaw:0,labelX:STAKES.x,labelZ:STAKES.z+.95};
 if(id==='hole')return{x:HOLE.x,z:HOLE.z,yaw:0,labelX:HOLE.x,labelZ:HOLE.z+.95};
 const seat=seatPlacements(view).find(seat=>seat.id===id);
 if(!seat)return{x:0,z:0,yaw:0,labelX:0,labelZ:0};
 // Coins live in the seat's own middle zone, between the ante and the flight.
 const {x,z,yaw}=seat.coins;
 return{x,z,yaw,labelX:x+Math.sin(yaw)*.93,labelZ:z+Math.cos(yaw)*.93};
}
/** Top-card center; one card rests on the felt, large piles stay bounded. */
export const pileTop = (count: number, step: number) => .027 + Math.min(79, Math.max(0, count - 1)) * step;

/** The seat strip in its own local frame: ante at the start, flight at the end. */
function strip(kind: SeatStripKind, flightW: number, along: number): SeatStripZone {
  const width = kind === "ante" ? ANTE_WIDTH : kind === "coins" ? COIN_WIDTH : flightW;
  return { kind, along, width, depth: ZONE_DEPTH, roundStart: kind === "ante", roundEnd: kind === "flight" };
}
/** How many seats each edge carries, clockwise from the viewer's own edge. The
 *  viewer always sits alone at the centre of the near edge. */
function edgeCounts(players: number): number[] {
  // Index order is [self/bottom, left, top, right].
  //
  // The viewer's own edge keeps exactly one seat: the direction contract
  // requires the viewer to sit at the centre of the near edge. The remaining
  // players are spread so the two side edges stay balanced and the far edge is
  // never left empty, which is what the table layout is reviewed against:
  //   4 players -> left 1, top 1, right 1
  //   5 players -> left 1, top 2, right 1
  //   6 players -> left 2, top 1, right 2
  const others = players - 1;
  let left = Math.floor(others / 2), right = left, top = others - left - right;
  if (top === 0) { left -= 1; right -= 1; top = 2; }
  return [1, left, top, right];
}
export function seatPlacements(view: PublicView): SeatPlacement[] {
  const self = "selfSeatId" in view ? (view as SeatView).selfSeatId : view.seats[0]?.id;
  const first = Math.max(0, view.seats.findIndex(seat => seat.id === self));
  const players = view.seats.length, shape = tableShape(players);
  // Rotate the order so the viewer leads, then walk edges clockwise on screen.
  const ordered = view.seats.map((seat, index) => ({ seat, offset: (index - first + players) % players })).sort((a, b) => a.offset - b.offset);
  const slots: { seatId: string; edge: number; along: number; slotsOnEdge: number }[] = [];
  if (shape === "round") {
    ordered.forEach(({ seat, offset }) => slots.push({ seatId: seat.id, edge: -1, along: -offset * Math.PI * 2 / players, slotsOnEdge: 1 }));
  } else {
    const counts = edgeCounts(players);
    let cursor = 0;
    for (let edge = 0; edge < 4 && cursor < ordered.length; edge++) {
      const onEdge = Math.min(counts[edge], ordered.length - cursor);
      if (onEdge <= 0) continue;
      // Clockwise within an edge runs from the edge we just left toward the next.
      const spread = onEdge === 1 ? [0] : [1, -1];
      for (let slot = 0; slot < onEdge; slot++) slots.push({ seatId: ordered[cursor + slot].seat.id, edge, along: spread[slot] ?? 0, slotsOnEdge: onEdge });
      cursor += onEdge;
    }
  }
  // Callers index the result by position, so keep the projection's own seat
  // order even though the slots were assigned clockwise from the viewer.
  const slotBySeat = new Map(slots.map(slot => [slot.seatId, slot]));
  return view.seats.map(source => {
    const { seatId, edge, along, slotsOnEdge } = slotBySeat.get(source.id)!;
    const isSelf = seatId === self && "selfSeatId" in view;
    const flightW = shape === "round" ? flightWidth(players) : slotsOnEdge >= 2 ? sharedFlightWidth : loneFlightWidth;
    const total = ANTE_WIDTH + COIN_WIDTH + flightW;
    const zones = [
      strip("ante", flightW, -total / 2 + ANTE_WIDTH / 2),
      strip("coins", flightW, -total / 2 + ANTE_WIDTH + COIN_WIDTH / 2),
      strip("flight", flightW, total / 2 - flightW / 2),
    ];
    const angle = shape === "round" ? along : Math.atan2(EDGES[edge].nx, EDGES[edge].nz);
    const tangentX = Math.cos(angle), tangentZ = -Math.sin(angle);
    const normalX = shape === "round" ? Math.sin(angle) : EDGES[edge].nx;
    const normalZ = shape === "round" ? Math.cos(angle) : EDGES[edge].nz;
    // The seat anchor is the strip centre. The viewer's own strip is pulled
    // toward the middle so the near edge stays free for the private hand.
    const depth = shape === "round" ? TABLE.round.seatRadius : TABLE.square.seatDepth;
    // The seat anchor itself stays on the table's edge ring in every projection,
    // so a spectator and seat 0 resolve the same table. Only the viewer's own
    // strip is pulled toward the middle, to keep the near edge free for the
    // private hand fan.
    const inward = isSelf ? depth - SELF_STRIP_DEPTH : 0;
    const slotAlong = shape === "round" ? 0 : along * (total / 2 + STRIP_MARGIN);
    const seatX = normalX * depth + tangentX * slotAlong, seatZ = normalZ * depth + tangentZ * slotAlong;
    const pose = (zone: SeatStripZone): Pose => ({
      x: seatX + tangentX * zone.along - normalX * inward, y: .11,
      z: seatZ + tangentZ * zone.along - normalZ * inward, yaw: angle, tilt: 0, scale: .92,
    });
    const [anteZone, coinZone, flightZone] = zones;
    const ante = pose(anteZone), coins = pose(coinZone), flight = pose(flightZone);
    // Badges sit above each region on screen. The camera never orbits, so the
    // screen-up direction is a constant world vector.
    return {
      id: seatId, self: isSelf, angle, x: seatX, z: seatZ, nx: normalX, nz: normalZ, strip: zones, ante, coins, flight,
      flightWidth: flightW,
      coinsBadge: { x: coins.x, z: coins.z }, flightBadge: { x: flight.x, z: flight.z },
    };
  });
}
export function placements(view: PublicView): CardPlacement[] {
  const result: CardPlacement[] = []; const seats = seatPlacements(view);
  const privateView = "selfSeatId" in view ? view as SeatView : null;
  // The host-only inspection projection is deliberately opt-in. A normal
  // SeatView still has only its owner's hand and committed ante, so a stage
  // cannot accidentally turn private transport data into a public face.
  const omniscient = "omniscient" in view && view.omniscient === true ? view as OmniscientView : null;
  for (const seat of seats) {
    const value = view.seats.find(s => s.id === seat.id)!;
    if (seat.self && privateView) {
      const count = privateView.hand.length;
      privateView.hand.forEach((card, i) => {
        const offset = i - (count - 1) / 2;
        result.push({ key: card.id, card, cardId: card.id, zone: "hand", seatId: seat.id, pose: { x: offset * Math.min(1.06, 8.8 / Math.max(1, count - 1)), y: 1.0 + i * .008, z: 6.05 + offset * offset * .024, yaw: -offset * .065, tilt: .5, scale: 1.35 } });
      });
    } else if (omniscient && Array.isArray(omniscient.privateHands[seat.id])) {
      // In local omniscient mode, keep every opponent in its physical seat
      // and lift the authoritative local card objects into the same readable
      // hand fan used by ordinary table cards. The host can inspect the whole
      // table without changing what any other player receives.
      const privateHand = omniscient.privateHands[seat.id] ?? [];
      privateHand.forEach((card, i) => {
        const count = privateHand.length, offset = i - (count - 1) / 2;
        result.push({ key: `hand:${seat.id}:${card.id}`, card, cardId: card.id, zone: "hand", seatId: seat.id, pose: { x: seat.x + seat.nx * 2.15 + Math.cos(seat.angle) * offset * .23, y: .26 + i * .006, z: seat.z + seat.nz * 2.15 - Math.sin(seat.angle) * offset * .23, yaw: seat.angle - offset * .025, tilt: .22, scale: .62 } });
      });
    } else {
      for (let i = 0; i < Math.min(value.handCount, 10); i++) {
        const offset = i - (Math.min(value.handCount, 10) - 1) / 2;
        result.push({ key: `back:${seat.id}:${i}`, card: null, zone: "hand", seatId: seat.id, pose: { x: seat.x + seat.nx * 2.15 + Math.cos(seat.angle) * offset * .23, y: .26 + i * .006, z: seat.z + seat.nz * 2.15 - Math.sin(seat.angle) * offset * .23, yaw: seat.angle - offset * .025, tilt: .22, scale: .62 } });
      }
    }
    if (value.committed) {
      // A normal SeatView keeps even the owner's committed ante face-down.
      // Only the explicitly host-local omniscient projection may put its
      // authoritative card object on the front material.
      const ownCommittedAnte = privateView?.committedAnte ?? null;
      const omniscientAnte = omniscient?.privateCommittedAntes[seat.id] ?? null;
      const visibleAnte = omniscient ? omniscientAnte : null;
      const cardId = visibleAnte?.id ?? (seat.self ? ownCommittedAnte?.id : undefined);
      result.push({ key: cardId ?? `ante:${seat.id}`, card: visibleAnte, cardId, zone: "ante", seatId: seat.id, pose: { ...seat.ante, y: .15 } });
    }
    const step = Math.min(.38, (seat.flightWidth - .95) / Math.max(1, value.flight.length - 1));
    value.flight.forEach((entry, i) => { const offset = i - (value.flight.length - 1) / 2; result.push({ key: entry.cardId, card: entry.card, cardId: entry.cardId, zone: "flight", seatId: seat.id, pose: { ...seat.flight, x: seat.flight.x + Math.cos(seat.angle) * offset * step, z: seat.flight.z - Math.sin(seat.angle) * offset * step, y: .17 + i * .048, scale: ZONE_CARD_SCALE } }); });
  }
  if (view.deckCount) result.push({ key: "deck", card: null, zone: "deck", pose: { ...DECK, y: pileTop(view.deckCount, .005) } });
  const top = view.discard[view.discard.length - 1]; if (top) result.push({ key: top.id, card: top, cardId: top.id, zone: "discard", pose: { ...DISCARD, y: pileTop(view.discard.length, .004) } });
  const origins = new Map((view.anteOrigins ?? []).map(origin => [origin.cardId, origin.seatId]));
  const neutral = view.ante.filter(card => !seats.some(seat => seat.id === origins.get(card.id)));
  view.ante.forEach(card => {
    const seat = seats.find(seat => seat.id === origins.get(card.id));
    const index = neutral.findIndex(value => value.id === card.id);
    result.push({ key: card.id, card, cardId: card.id, zone: "ante", ...(seat ? { seatId: seat.id } : {}),
      pose: seat ? { ...seat.ante, y: .15, scale: ZONE_CARD_SCALE } : { x: (index - (neutral.length - 1) / 2) * 1.16, y: .17 + index * .005, z: 1.02, yaw: 0, tilt: 0, scale: .94 } });
  });
  // A source projection can reveal a card in multiple public informational lists;
  // only physical locations above produce objects. Never render `revealed` again.
  return result;
}
/** LE still stores integer gold. Ten decorative silver pieces replace ONE gold. */
export function coinDenominations(gold: number) { const whole = Math.max(0, Math.floor(Number.isFinite(gold) ? gold : 0)); return { gold: Math.max(0, whole - 1), silver: whole ? 10 : 0, totalGold: whole }; }
