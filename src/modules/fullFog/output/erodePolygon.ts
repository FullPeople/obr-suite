// Geometric polygon erosion (Minkowski-style inward offset).
//
// Used by the editor's "edge feather" save path: we run the
// original contour polygons through this to produce a smaller,
// eroded copy. The two are then rendered as a pair of stacked
// Paths (50% outer + 100% inner) so the rim ring of fog reveals
// ghost hints of objects underneath.
//
// Algorithm (per closed polygon):
//   1. compute signed area to detect winding (CW vs CCW)
//   2. for each vertex V with neighbours V_prev, V_next
//      a. unit inward-normal of edge V_prev→V (rotated by polygon
//         winding so it points INTO the interior)
//      b. unit inward-normal of edge V→V_next
//      c. new vertex V' = V + d * (n1 + n2) / (1 + n1·n2)
//
// Step 2c is the standard "offset two adjacent edges by d along
// their inward normals, find where the offset edges intersect"
// formula, derived via vectors. Holds for convex AND concave
// vertices because the bisector direction is correct for both
// (inward-normals already encode the side of the edge that
// contains the interior).
//
// Edge cases:
//   - Hairpin vertex (180° turn) → denominator (1 + n1·n2) ≈ 0;
//     fall back to a perpendicular shift along n1.
//   - Spike collapsing past 0 width → vertex flips outward; we
//     don't currently detect / clip self-intersections here. For
//     fog-blob shapes (smooth contours, no narrow necks) this is
//     fine in practice.
//   - degenerate edge (zero length) → keep vertex unchanged.

import type { Vec2 } from "../types";

/** Offset a closed polygon by `distance` image pixels along the
 *  inward normals of each edge. Sign convention:
 *    distance > 0  →  polygon shrinks (erode inward)
 *    distance < 0  →  polygon grows (expand outward)
 *  Returns a new polygon (does not mutate input). */
export function erodePolygon(poly: Vec2[], distance: number): Vec2[] {
  if (poly.length < 3 || distance === 0) return poly.slice();
  const n = poly.length;

  // Signed area (positive for CW in OBR's Y-down screen-coord
  // convention). Using the standard shoelace summation.
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    signedArea += (b.x - a.x) * (b.y + a.y);
  }
  const cw = signedArea > 0;

  // Inward normal of an edge with direction (dx, dy) of length len.
  //   CW polygon: rotate edge by -90° (right turn) → (dy, -dx) / len
  //   CCW polygon: rotate edge by +90° (left turn) → (-dy, dx) / len
  const inwardNormal = (dx: number, dy: number, len: number): Vec2 =>
    cw
      ? { x: dy / len, y: -dx / len }
      : { x: -dy / len, y: dx / len };

  const result: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];

    const e1x = cur.x - prev.x, e1y = cur.y - prev.y;
    const e2x = next.x - cur.x, e2y = next.y - cur.y;
    const e1Len = Math.hypot(e1x, e1y);
    const e2Len = Math.hypot(e2x, e2y);
    if (e1Len < 1e-6 || e2Len < 1e-6) {
      result[i] = { x: cur.x, y: cur.y };
      continue;
    }
    const n1 = inwardNormal(e1x, e1y, e1Len);
    const n2 = inwardNormal(e2x, e2y, e2Len);
    const dot = n1.x * n2.x + n1.y * n2.y;
    const denom = 1 + dot;
    if (Math.abs(denom) < 1e-6) {
      // 180° hairpin — bisector formula degenerates. Fall back to
      // perpendicular shift along n1 (any of the two edges' inward
      // normals; they're antiparallel here).
      result[i] = { x: cur.x + n1.x * distance, y: cur.y + n1.y * distance };
      continue;
    }
    const scale = distance / denom;
    result[i] = {
      x: cur.x + (n1.x + n2.x) * scale,
      y: cur.y + (n1.y + n2.y) * scale,
    };
  }
  return result;
}

/** Convenience helper — offset a list of polygons. For positive
 *  distance (erode), polygons that collapse (winding flips or area
 *  drops below 5% of original) are filtered out. For negative
 *  distance (expand) the area only grows, so the collapse check is
 *  skipped. */
export function erodePolygons(polys: Vec2[][], distance: number): Vec2[][] {
  if (distance === 0) return polys.map((p) => p.slice());
  const out: Vec2[][] = [];
  for (const p of polys) {
    if (p.length < 3) continue;
    const eroded = erodePolygon(p, distance);
    if (distance < 0) {
      // Expansion — area only grows, never collapses. Push as-is.
      out.push(eroded);
      continue;
    }
    // Erosion — drop polygons that flipped winding (collapsed past 0)
    // or shrunk to a near-zero sliver.
    let originalArea = 0;
    let erodedArea = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      originalArea += (b.x - a.x) * (b.y + a.y);
    }
    for (let i = 0; i < eroded.length; i++) {
      const a = eroded[i], b = eroded[(i + 1) % eroded.length];
      erodedArea += (b.x - a.x) * (b.y + a.y);
    }
    if (Math.sign(originalArea) !== Math.sign(erodedArea)) continue;
    if (Math.abs(erodedArea) < Math.abs(originalArea) * 0.05) continue;
    out.push(eroded);
  }
  return out;
}
