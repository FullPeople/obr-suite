// fullFog/door — geometry helpers for snapping pointer positions
// to wall polylines, traversing them by arc-length, and splitting
// them around openings.

import type { Vec2 } from "../types";
import type { Opening } from "./types";

export interface SnapHit {
  polyIndex: number;
  /** Normalised arc-length parameter on the polyline [0, 1]. */
  t: number;
  /** Closest point on the polyline (map-local coords). */
  point: Vec2;
  /** Distance from the queried point to the closest point
   *  (map-local units). */
  distance: number;
}

/** Compute total arc length of a polyline (sum of segment lengths). */
export function polylineLength(poly: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    total += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
  }
  return total;
}

/** Find the closest point on a single segment AB to point P. Returns
 *  parameter u ∈ [0, 1] along AB and the closest point. */
function closestOnSegment(
  P: Vec2,
  A: Vec2,
  B: Vec2,
): { u: number; point: Vec2; distance: number } {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    const d = Math.hypot(P.x - A.x, P.y - A.y);
    return { u: 0, point: { x: A.x, y: A.y }, distance: d };
  }
  let u = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const qx = A.x + u * dx;
  const qy = A.y + u * dy;
  return {
    u,
    point: { x: qx, y: qy },
    distance: Math.hypot(P.x - qx, P.y - qy),
  };
}

/** Find the closest polyline (across the supplied list) to P, and
 *  return the snap hit. Returns null if all polylines are degenerate. */
export function snapToPolylines(
  P: Vec2,
  polylines: Vec2[][],
): SnapHit | null {
  let best: SnapHit | null = null;
  for (let pi = 0; pi < polylines.length; pi++) {
    const poly = polylines[pi];
    if (poly.length < 2) continue;
    const total = polylineLength(poly);
    if (total < 1e-6) continue;
    let arcSoFar = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const A = poly[i];
      const B = poly[i + 1];
      const segLen = Math.hypot(B.x - A.x, B.y - A.y);
      if (segLen < 1e-9) continue;
      const c = closestOnSegment(P, A, B);
      if (best == null || c.distance < best.distance) {
        const t = (arcSoFar + c.u * segLen) / total;
        best = { polyIndex: pi, t, point: c.point, distance: c.distance };
      }
      arcSoFar += segLen;
    }
  }
  return best;
}

/** Convert a normalised t to (segmentIndex, segmentT) on a polyline.
 *  Returns null on degenerate input. */
function tToSegment(
  poly: Vec2[],
  t: number,
): { segIndex: number; segT: number } | null {
  if (poly.length < 2) return null;
  const total = polylineLength(poly);
  if (total < 1e-6) return null;
  const target = Math.max(0, Math.min(1, t)) * total;
  let arc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const segLen = Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
    if (arc + segLen >= target || i === poly.length - 2) {
      const segT = segLen < 1e-9 ? 0 : (target - arc) / segLen;
      return { segIndex: i, segT: Math.max(0, Math.min(1, segT)) };
    }
    arc += segLen;
  }
  return { segIndex: poly.length - 2, segT: 1 };
}

/** Interpolate a point on a polyline at normalised arc-length t. */
export function pointAtT(poly: Vec2[], t: number): Vec2 | null {
  const seg = tToSegment(poly, t);
  if (!seg) return null;
  const A = poly[seg.segIndex];
  const B = poly[seg.segIndex + 1];
  return {
    x: A.x + (B.x - A.x) * seg.segT,
    y: A.y + (B.y - A.y) * seg.segT,
  };
}

/** Extract the sub-polyline of `poly` between two normalised
 *  arc-length parameters t1 < t2. Returned polyline starts at
 *  pointAtT(t1), follows through whole intermediate vertices,
 *  ends at pointAtT(t2). */
export function subPolyline(poly: Vec2[], t1: number, t2: number): Vec2[] {
  if (t1 >= t2 || poly.length < 2) return [];
  const a = tToSegment(poly, t1);
  const b = tToSegment(poly, t2);
  if (!a || !b) return [];
  const A = poly[a.segIndex];
  const NA = poly[a.segIndex + 1];
  const startPt = {
    x: A.x + (NA.x - A.x) * a.segT,
    y: A.y + (NA.y - A.y) * a.segT,
  };
  const B = poly[b.segIndex];
  const NB = poly[b.segIndex + 1];
  const endPt = {
    x: B.x + (NB.x - B.x) * b.segT,
    y: B.y + (NB.y - B.y) * b.segT,
  };
  const out: Vec2[] = [startPt];
  // Walk full vertices between (a.segIndex+1) and b.segIndex inclusive.
  for (let i = a.segIndex + 1; i <= b.segIndex; i++) {
    out.push({ x: poly[i].x, y: poly[i].y });
  }
  out.push(endPt);
  return out;
}

/** Split a polyline into a list of sub-polylines that exclude the
 *  arc-length ranges occupied by "see-through" openings (open doors
 *  + windows). Closed-door regions remain part of the output (they
 *  still block vision).
 *
 *  Algorithm: collect every t-range to skip, sort, merge overlaps,
 *  then walk the polyline emitting sub-polylines for each gap
 *  between skip ranges.
 *
 *  Returns the original polyline as a single-element array if no
 *  see-through openings apply. */
export function splitPolylineByOpenings(
  poly: Vec2[],
  openingsForThisPoly: Opening[],
): Vec2[][] {
  if (poly.length < 2) return [];
  // See-through = window (always) OR open door.
  const skips = openingsForThisPoly
    .filter((o) => o.kind === "window" || (o.kind === "door" && o.open))
    .map((o) => ({
      t1: Math.max(0, Math.min(1, Math.min(o.t1, o.t2))),
      t2: Math.max(0, Math.min(1, Math.max(o.t1, o.t2))),
    }))
    .filter((r) => r.t2 - r.t1 > 1e-6)
    .sort((a, b) => a.t1 - b.t1);
  if (skips.length === 0) return [poly.slice()];

  // Merge overlapping skip ranges.
  const merged: Array<{ t1: number; t2: number }> = [];
  for (const r of skips) {
    if (merged.length === 0 || r.t1 > merged[merged.length - 1].t2) {
      merged.push({ ...r });
    } else {
      merged[merged.length - 1].t2 = Math.max(
        merged[merged.length - 1].t2,
        r.t2,
      );
    }
  }

  const out: Vec2[][] = [];
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

/** Convert a single point from world coordinates to map-local
 *  (matching the convention used by samplePathCommands' output). */
export function worldToMapLocal(worldPt: Vec2, mapItem: any): Vec2 {
  const px = mapItem.position?.x ?? 0;
  const py = mapItem.position?.y ?? 0;
  const sx = mapItem.scale?.x ?? 1;
  const sy = mapItem.scale?.y ?? 1;
  const r = ((mapItem.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // Inverse of: world = map.pos + R(rot) · (local · scale)
  const dx = worldPt.x - px;
  const dy = worldPt.y - py;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const xAbs = sx === 0 ? 0 : lx / sx;
  const yAbs = sy === 0 ? 0 : ly / sy;
  return { x: xAbs, y: yAbs };
}

/** Convert a single point from map-local back to world. Inverse of
 *  worldToMapLocal — matches the transform that OBR applies when
 *  attachedTo(mapId). */
export function mapLocalToWorld(localPt: Vec2, mapItem: any): Vec2 {
  const px = mapItem.position?.x ?? 0;
  const py = mapItem.position?.y ?? 0;
  const sx = mapItem.scale?.x ?? 1;
  const sy = mapItem.scale?.y ?? 1;
  const r = ((mapItem.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const lx = localPt.x * sx;
  const ly = localPt.y * sy;
  return {
    x: px + lx * cos - ly * sin,
    y: py + lx * sin + ly * cos,
  };
}
