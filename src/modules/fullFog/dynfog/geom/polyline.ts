// Normalised arc-length addressing on polylines.
//
// This is the pure-TS stand-in for Skia's `ContourMeasureIter`:
// a point on a wall is `(polyIndex, t)` with `t ∈ [0, 1]` measured as
// a fraction of that contour's total length. Openings (doors/windows)
// are stored as a `[t1, t2]` range, which is what makes them stable
// across clients without any shared geometry cache.

import type { Vector2 } from "@owlbear-rodeo/sdk";

export interface SnapHit {
  polyIndex: number;
  /** Normalised arc-length parameter on that polyline, in [0, 1]. */
  t: number;
  /** The closest point itself, in the same space as the polyline. */
  point: Vector2;
  /** Distance from the queried point to `point`. */
  distance: number;
}

/** Total length of a polyline. */
export function polylineLength(poly: Vector2[]): number {
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    total += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
  }
  return total;
}

function closestOnSegment(
  p: Vector2,
  a: Vector2,
  b: Vector2,
): { u: number; point: Vector2; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return {
      u: 0,
      point: { x: a.x, y: a.y },
      distance: Math.hypot(p.x - a.x, p.y - a.y),
    };
  }
  let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const qx = a.x + u * dx;
  const qy = a.y + u * dy;
  return {
    u,
    point: { x: qx, y: qy },
    distance: Math.hypot(p.x - qx, p.y - qy),
  };
}

/** Closest point on ONE polyline. `null` when it's degenerate. */
export function snapToPolyline(
  p: Vector2,
  poly: Vector2[],
): Omit<SnapHit, "polyIndex"> | null {
  if (poly.length < 2) return null;
  const total = polylineLength(poly);
  if (total < 1e-6) return null;
  let best: Omit<SnapHit, "polyIndex"> | null = null;
  let arc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-9) continue;
    const c = closestOnSegment(p, a, b);
    if (best === null || c.distance < best.distance) {
      best = {
        t: (arc + c.u * segLen) / total,
        point: c.point,
        distance: c.distance,
      };
    }
    arc += segLen;
  }
  return best;
}

/** Closest point across a whole contour set. `null` when every contour
 *  is degenerate. Equivalent to upstream's `getSkPathIntersection`. */
export function snapToPolylines(
  p: Vector2,
  polylines: Vector2[][],
): SnapHit | null {
  let best: SnapHit | null = null;
  for (let pi = 0; pi < polylines.length; pi++) {
    const poly = polylines[pi];
    if (poly.length < 2) continue;
    const total = polylineLength(poly);
    if (total < 1e-6) continue;
    let arc = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-9) continue;
      const c = closestOnSegment(p, a, b);
      if (best === null || c.distance < best.distance) {
        best = {
          polyIndex: pi,
          t: (arc + c.u * segLen) / total,
          point: c.point,
          distance: c.distance,
        };
      }
      arc += segLen;
    }
  }
  return best;
}

/** `t` → (segment index, parameter within that segment). */
export function tToSegment(
  poly: Vector2[],
  t: number,
): { segIndex: number; segT: number } | null {
  if (poly.length < 2) return null;
  const total = polylineLength(poly);
  if (total < 1e-6) return null;
  const target = Math.max(0, Math.min(1, t)) * total;
  let arc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const segLen = Math.hypot(
      poly[i + 1].x - poly[i].x,
      poly[i + 1].y - poly[i].y,
    );
    if (arc + segLen >= target || i === poly.length - 2) {
      const segT = segLen < 1e-9 ? 0 : (target - arc) / segLen;
      return { segIndex: i, segT: Math.max(0, Math.min(1, segT)) };
    }
    arc += segLen;
  }
  return { segIndex: poly.length - 2, segT: 1 };
}

/** Inverse of `tToSegment`. */
export function tAtSegment(
  poly: Vector2[],
  segIndex: number,
  segT: number,
): number | null {
  if (poly.length < 2) return null;
  if (segIndex < 0 || segIndex > poly.length - 2) return null;
  const total = polylineLength(poly);
  if (total < 1e-6) return null;
  let arc = 0;
  for (let i = 0; i < segIndex; i++) {
    arc += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
  }
  const segLen = Math.hypot(
    poly[segIndex + 1].x - poly[segIndex].x,
    poly[segIndex + 1].y - poly[segIndex].y,
  );
  return Math.max(0, Math.min(1, (arc + segT * segLen) / total));
}

/** Point on a polyline at normalised arc-length `t`. */
export function pointAtT(poly: Vector2[], t: number): Vector2 | null {
  const seg = tToSegment(poly, t);
  if (!seg) return null;
  const a = poly[seg.segIndex];
  const b = poly[seg.segIndex + 1];
  return {
    x: a.x + (b.x - a.x) * seg.segT,
    y: a.y + (b.y - a.y) * seg.segT,
  };
}

/** The stretch of `poly` between `t1` and `t2` (t1 < t2). */
export function subPolyline(
  poly: Vector2[],
  t1: number,
  t2: number,
): Vector2[] {
  if (t1 >= t2 || poly.length < 2) return [];
  const a = tToSegment(poly, t1);
  const b = tToSegment(poly, t2);
  if (!a || !b) return [];
  const start = pointAtT(poly, t1);
  const end = pointAtT(poly, t2);
  if (!start || !end) return [];
  const out: Vector2[] = [start];
  for (let i = a.segIndex + 1; i <= b.segIndex; i++) {
    out.push({ x: poly[i].x, y: poly[i].y });
  }
  out.push(end);
  return out;
}

export interface TRange {
  t1: number;
  t2: number;
}

/** Normalise + merge a set of t-ranges. */
export function mergeRanges(ranges: TRange[]): TRange[] {
  const clean = ranges
    .map((r) => ({
      t1: Math.max(0, Math.min(1, Math.min(r.t1, r.t2))),
      t2: Math.max(0, Math.min(1, Math.max(r.t1, r.t2))),
    }))
    .filter((r) => r.t2 - r.t1 > 1e-6)
    .sort((a, b) => a.t1 - b.t1);
  const merged: TRange[] = [];
  for (const r of clean) {
    const last = merged[merged.length - 1];
    if (!last || r.t1 > last.t2) merged.push({ ...r });
    else last.t2 = Math.max(last.t2, r.t2);
  }
  return merged;
}

/**
 * Split a polyline so the given t-ranges are removed — this is what
 * turns an open door into a hole in the wall. Equivalent to upstream's
 * `skLines.op(doorPath, PathOp.Difference)`.
 */
export function splitPolylineByRanges(
  poly: Vector2[],
  ranges: TRange[],
): Vector2[][] {
  if (poly.length < 2) return [];
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return [poly.slice()];

  const out: Vector2[][] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.t1 > cursor + 1e-6) {
      const seg = subPolyline(poly, cursor, r.t1);
      if (seg.length >= 2) out.push(seg);
    }
    cursor = r.t2;
  }
  if (cursor < 1 - 1e-6) {
    const seg = subPolyline(poly, cursor, 1);
    if (seg.length >= 2) out.push(seg);
  }
  return out;
}

/**
 * Re-express a `t` measured on `from` as the equivalent `t` on `to`.
 *
 * Used when 墙体外扩 (wall-expand) is non-zero: openings are authored
 * against the raw contour but the Wall items come from the offset
 * contour, and normalised arc length doesn't survive an offset. Both
 * polylines have 1:1 vertex correspondence (the offset moves vertices,
 * never adds or drops them), so we project onto the corresponding
 * segment and its two neighbours — restricting the search is what
 * stops a door in a narrow corridor snapping to the far wall.
 */
export function remapT(from: Vector2[], to: Vector2[], t: number): number {
  if (from.length !== to.length) return t;
  const seg = tToSegment(from, t);
  if (!seg) return t;
  const fallback = tAtSegment(to, seg.segIndex, seg.segT) ?? t;
  const p = pointAtT(from, t);
  if (!p) return fallback;
  const lo = Math.max(0, seg.segIndex - 1);
  const hi = Math.min(to.length - 2, seg.segIndex + 1);
  let best: { segIndex: number; u: number; distance: number } | null = null;
  for (let i = lo; i <= hi; i++) {
    const c = closestOnSegment(p, to[i], to[i + 1]);
    if (!best || c.distance < best.distance) {
      best = { segIndex: i, u: c.u, distance: c.distance };
    }
  }
  if (!best) return fallback;
  return tAtSegment(to, best.segIndex, best.u) ?? fallback;
}
