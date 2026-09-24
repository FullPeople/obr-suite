// Cross-drawing opening subtraction.
//
// An opening normally lives on the same Drawing whose wall it cuts, and
// that case is handled exactly, in the t-domain, by
// `splitPolylineByRanges`. But Owlbear's fog tool encourages OVERLAPPING
// shapes — two rectangles sharing a wall to make an L-shaped corridor,
// say — and upstream dynamic-fog subtracts every door from EVERY wall in
// world space, so a door drawn on one rectangle also punches through the
// rectangle behind it. Without that, a door on a shared wall looks open
// but vision is still blocked by the second shape's wall.
//
// This module reproduces that behaviour: an opening contributes a
// "cut" — a polyline plus a radius, i.e. a capsule chain — and any wall
// polyline passing within that radius loses the overlapping stretch.
//
// Precision is `radius / 2` (we march each wall segment at that step and
// then binary-refine the crossings), which is a couple of pixels at
// typical stroke widths — far below what a player can perceive.

import type { Vector2 } from "@owlbear-rodeo/sdk";
import { type TRange } from "./polyline";

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Cut {
  /** Which opening produced this, so a drawing can skip its own. */
  openingId: string;
  /** Which Drawing the opening is stored on. */
  parentId: string;
  /** Cut centre line, in WORLD space. */
  points: Vector2[];
  /** Half-width of the capsule chain, in WORLD units. */
  radius: number;
  bbox: BBox;
}

export function bboxOf(points: Vector2[], pad = 0): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

function distToSegmentSq(
  p: Vector2,
  a: Vector2,
  b: Vector2,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let u = lenSq < 1e-9 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const qx = a.x + u * dx - p.x;
  const qy = a.y + u * dy - p.y;
  return qx * qx + qy * qy;
}

/** Is `p` inside the capsule chain of `cut`? */
function insideCut(p: Vector2, cut: Cut): boolean {
  if (
    p.x < cut.bbox.minX ||
    p.x > cut.bbox.maxX ||
    p.y < cut.bbox.minY ||
    p.y > cut.bbox.maxY
  ) {
    return false;
  }
  const rSq = cut.radius * cut.radius;
  for (let i = 0; i < cut.points.length - 1; i++) {
    if (distToSegmentSq(p, cut.points[i], cut.points[i + 1]) <= rSq) return true;
  }
  // A one-point cut degenerates to a circle.
  if (cut.points.length === 1) {
    const dx = p.x - cut.points[0].x;
    const dy = p.y - cut.points[0].y;
    return dx * dx + dy * dy <= rSq;
  }
  return false;
}

function insideAny(p: Vector2, cuts: Cut[]): boolean {
  for (const cut of cuts) {
    if (insideCut(p, cut)) return true;
  }
  return false;
}

/** Binary-refine the arc-length at which `inside` flips between `loT`
 *  (known outside) and `hiT` (known inside), or vice versa. */
function refineCrossing(
  poly: Vector2[],
  cuts: Cut[],
  loT: number,
  hiT: number,
  wantInsideAtHi: boolean,
  pointAt: (t: number) => Vector2 | null,
): number {
  let lo = loT;
  let hi = hiT;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const p = pointAt(mid);
    if (!p) break;
    const isInside = insideAny(p, cuts);
    if (isInside === wantInsideAtHi) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The t-ranges of `poly` (same space as `cuts`) that fall inside any
 * cut. Feed the result to `splitPolylineByRanges`.
 */
export function cutRangesForPolyline(
  poly: Vector2[],
  cuts: Cut[],
): TRange[] {
  if (poly.length < 2 || cuts.length === 0) return [];

  // Bbox rejection FIRST. Most contours on a traced map are nowhere
  // near any door, and this is the branch that skips them — running it
  // before the arc-length walk means those contours cost one O(n) pass
  // instead of two.
  const polyBox = bboxOf(poly);
  const relevant = cuts.filter((c) => bboxIntersects(polyBox, c.bbox));
  if (relevant.length === 0) return [];

  // Cumulative arc length, so t → point is O(log n). The total is just
  // its last element — this used to call polylineLength as well, which
  // is the same additions in the same order, so taking it from here is
  // bit-identical, not merely close.
  const cum: number[] = [0];
  for (let i = 0; i < poly.length - 1; i++) {
    cum.push(
      cum[i] + Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y),
    );
  }
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [];

  const minRadius = Math.min(...relevant.map((c) => c.radius));
  const step = Math.max(1, minRadius / 2);
  const samples = Math.min(20000, Math.max(8, Math.ceil(total / step)));
  const pointAt = (t: number): Vector2 | null => {
    const target = Math.max(0, Math.min(1, t)) * total;
    // Binary search the segment containing `target`.
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const segLen = cum[lo + 1] - cum[lo];
    const u = segLen < 1e-9 ? 0 : (target - cum[lo]) / segLen;
    const a = poly[lo];
    const b = poly[lo + 1];
    if (!a || !b) return null;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };

  const ranges: TRange[] = [];
  let runStart: number | null = null;
  let prevT = 0;
  let prevInside = false;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = pointAt(t);
    const isInside = p ? insideAny(p, relevant) : false;
    if (i === 0) {
      prevInside = isInside;
      if (isInside) runStart = 0;
      prevT = t;
      continue;
    }
    if (isInside && !prevInside) {
      runStart = refineCrossing(poly, relevant, prevT, t, true, pointAt);
    } else if (!isInside && prevInside) {
      const end = refineCrossing(poly, relevant, t, prevT, true, pointAt);
      if (runStart !== null) ranges.push({ t1: runStart, t2: end });
      runStart = null;
    }
    prevInside = isInside;
    prevT = t;
  }
  if (prevInside && runStart !== null) ranges.push({ t1: runStart, t2: 1 });

  return ranges;
}
