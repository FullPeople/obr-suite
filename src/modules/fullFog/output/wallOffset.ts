// Wall-expand offset utility (V3 — per-vertex independence).
//
// V2 used a global binary-search-on-magnitude per polygon: if any
// part of the polygon would self-intersect at distance d, the WHOLE
// polygon's offset shrunk to fit. That made the slider behave way
// too conservatively — a single thin pinch in a 1000-vertex polygon
// dragged the entire shape down to its safe distance.
//
// V3 keeps two pieces independently:
//
//   1. MITER LIMIT (corner safety).
//      Bisector formula
//        v' = v + (n1+n2) · d / (1 + n1·n2)
//      diverges as the corner angle gets acute (n1·n2 → -1). Cap
//      the per-vertex displacement magnitude at MITER_LIMIT × |d|
//      so sharp convex corners get a beveled offset rather than a
//      vertex shooting off to infinity.
//
//   2. PER-VERTEX RAYCAST CLAMP (thin-feature safety).
//      For each vertex, cast a ray along its move direction. If the
//      ray crosses a non-adjacent edge at distance D, cap that
//      vertex's offset to (D/2 − minPx). Each vertex clamps based
//      on its OWN local geometry — a thin neck stops moving while
//      thick lobes still travel the full distance.
//
// Trade-off: per-vertex clamping can leave the resulting polygon
// with tiny self-intersecting bowties at sharp transitions between
// thick and thin regions. For our use (deriving Wall line segments
// for OBR vision) that's acceptable — each segment blocks vision
// independently of polygon validity.

import type { Vec2 } from "../types";

const MITER_LIMIT = 4;

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (
      ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi)
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function markOutermost(polys: Vec2[][]): boolean[] {
  const out = new Array<boolean>(polys.length).fill(true);
  for (let i = 0; i < polys.length; i++) {
    if (polys[i].length < 3) continue;
    const sample = polys[i][0];
    for (let j = 0; j < polys.length; j++) {
      if (i === j) continue;
      if (polys[j].length < 3) continue;
      if (pointInPolygon(sample, polys[j])) {
        out[i] = false;
        break;
      }
    }
  }
  return out;
}

function signedAreaOf(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += (b.x - a.x) * (b.y + a.y);
  }
  return s;
}

/** Compute the mitered "ideal" target position for each vertex.
 *  Same bisector math as the original `erodePolygon`, but caps the
 *  displacement magnitude to MITER_LIMIT × |distance| so acute
 *  convex corners don't shoot off to infinity. */
function miteredTargets(poly: Vec2[], distance: number): Vec2[] {
  const n = poly.length;
  const cw = signedAreaOf(poly) > 0;
  const inwardNormal = (dx: number, dy: number, len: number): Vec2 =>
    cw
      ? { x: dy / len, y: -dx / len }
      : { x: -dy / len, y: dx / len };
  const maxDisp = MITER_LIMIT * Math.abs(distance);
  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const e1x = cur.x - prev.x, e1y = cur.y - prev.y;
    const e2x = next.x - cur.x, e2y = next.y - cur.y;
    const e1Len = Math.hypot(e1x, e1y);
    const e2Len = Math.hypot(e2x, e2y);
    if (e1Len < 1e-6 || e2Len < 1e-6) {
      out[i] = { x: cur.x, y: cur.y };
      continue;
    }
    const n1 = inwardNormal(e1x, e1y, e1Len);
    const n2 = inwardNormal(e2x, e2y, e2Len);
    const dot = n1.x * n2.x + n1.y * n2.y;
    const denom = 1 + dot;
    let dispX: number, dispY: number;
    if (Math.abs(denom) < 1e-6) {
      dispX = n1.x * distance;
      dispY = n1.y * distance;
    } else {
      const scale = distance / denom;
      dispX = (n1.x + n2.x) * scale;
      dispY = (n1.y + n2.y) * scale;
    }
    const dispLen = Math.hypot(dispX, dispY);
    if (dispLen > maxDisp) {
      const k = maxDisp / dispLen;
      dispX *= k;
      dispY *= k;
    }
    out[i] = { x: cur.x + dispX, y: cur.y + dispY };
  }
  return out;
}

/** Ray-segment intersection — returns the ray parameter t (distance
 *  along the ray from origin if direction is unit-length) at which
 *  the ray crosses segment AB, or -1 if no crossing. */
function rayHitDistance(
  ox: number, oy: number,
  dx: number, dy: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const sx = bx - ax;
  const sy = by - ay;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return -1;
  const oax = ax - ox;
  const oay = ay - oy;
  const t = (oax * sy - oay * sx) / denom;
  const u = (oax * dy - oay * dx) / denom;
  if (u < 0 || u > 1) return -1;
  if (t <= 1e-6) return -1;
  return t;
}

/**
 * Uniform grid over a contour's edges, so a vertex can ask "which
 * edges are near me" instead of testing all of them.
 *
 * The clamp below only cares about a hit closer than `targetDist * 2`.
 * `miteredTargets` caps `targetDist` at MITER_LIMIT × |distance|, but
 * that worst case only happens at sharp convex corners — the typical
 * vertex moves about |distance|, so its useful reach is about
 * 2 × |distance|, four times smaller than the global bound.
 *
 * Cells are therefore sized to |distance| and each vertex queries only
 * as many rings as ITS OWN reach needs. Sizing them to the global bound
 * instead made every query sweep a 144×144 area to serve a ray that
 * usually travels 12.
 *
 * This returns a SUPERSET of the edges that could qualify, and the
 * clamp takes a MIN over whatever qualifies. Min is order-independent
 * and exact in floating point, so testing a superset in a different
 * order gives the identical answer to testing all of them — the
 * selftest fuzzes that against the brute-force version.
 */
class EdgeGrid {
  private cells: Map<number, number[]> = new Map();
  private stamps: Int32Array;
  private pass = 0;
  private cell: number;
  private minX: number;
  private minY: number;
  private cols: number;

  constructor(poly: Vec2[], cellSize: number) {
    const n = poly.length;
    this.stamps = new Int32Array(n);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.cell = Math.max(cellSize, 1e-6);
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 1);
    const rows = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 1);
    // Register each edge in every cell its bounding box touches.
    for (let j = 0; j < n; j++) {
      const a = poly[j];
      const b = poly[(j + 1) % n];
      const c0 = this.col(Math.min(a.x, b.x));
      const c1 = this.col(Math.max(a.x, b.x));
      const r0 = this.row(Math.min(a.y, b.y));
      const r1 = this.row(Math.max(a.y, b.y));
      for (let r = r0; r <= r1; r++) {
        if (r < 0 || r >= rows) continue;
        for (let c = c0; c <= c1; c++) {
          if (c < 0 || c >= this.cols) continue;
          const key = r * this.cols + c;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(j);
          else this.cells.set(key, [j]);
        }
      }
    }
  }

  private col(x: number): number {
    return Math.floor((x - this.minX) / this.cell);
  }
  private row(y: number): number {
    return Math.floor((y - this.minY) / this.cell);
  }

  /** Edge indices within `reach` of (x, y), each yielded once.
   *
   *  The ring count is derived from `reach`, so the query covers at
   *  least a `reach`-radius disc around the point — a superset of what
   *  the ray can hit, which is what makes the result exact. */
  near(x: number, y: number, reach: number, out: number[]): void {
    out.length = 0;
    this.pass++;
    const c = this.col(x);
    const r = this.row(y);
    const rings = Math.max(1, Math.ceil(reach / this.cell));
    for (let rr = r - rings; rr <= r + rings; rr++) {
      for (let cc = c - rings; cc <= c + rings; cc++) {
        const bucket = this.cells.get(rr * this.cols + cc);
        if (!bucket) continue;
        for (const j of bucket) {
          if (this.stamps[j] === this.pass) continue;
          this.stamps[j] = this.pass;
          out.push(j);
        }
      }
    }
  }
}

/** Clamp each vertex's motion based on the nearest non-adjacent
 *  edge along its move direction. Vertices in thick regions of the
 *  polygon move the full distance; vertices near a thin pinch stop
 *  at half the pinch width minus minPx. */
function perVertexRaycastClamp(
  poly: Vec2[],
  targets: Vec2[],
  minPx: number,
  cellSize: number,
  useIndex: boolean,
): Vec2[] {
  const n = poly.length;
  if (targets.length !== n) return poly.slice();
  // Below this the grid costs more than it saves, and the O(n²) loop
  // is already trivial. `useIndex` false forces the brute-force path,
  // which the selftest uses as the reference to fuzz the grid against.
  const grid = useIndex && n >= 64 ? new EdgeGrid(poly, cellSize) : null;
  const candidates: number[] = [];
  const result: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const orig = poly[i];
    const tgt = targets[i];
    const dx = tgt.x - orig.x;
    const dy = tgt.y - orig.y;
    const targetDist = Math.hypot(dx, dy);
    if (targetDist < 1e-6) {
      result[i] = { x: orig.x, y: orig.y };
      continue;
    }
    const dirX = dx / targetDist;
    const dirY = dy / targetDist;

    let maxAllowed = targetDist;
    const prevEdge = (i - 1 + n) % n;
    if (grid) {
      grid.near(orig.x, orig.y, targetDist * 2, candidates);
      for (let k = 0; k < candidates.length; k++) {
        const j = candidates[k];
        // Skip the two edges adjacent to vertex i (i-1→i and i→i+1).
        if (j === i || j === prevEdge) continue;
        const A = poly[j];
        const B = poly[(j + 1) % n];
        const t = rayHitDistance(
          orig.x, orig.y, dirX, dirY,
          A.x, A.y, B.x, B.y,
        );
        if (t > 0 && t < targetDist * 2) {
          const safe = Math.max(0, t / 2 - minPx);
          if (safe < maxAllowed) maxAllowed = safe;
        }
      }
    } else {
      for (let j = 0; j < n; j++) {
        if (j === i || j === prevEdge) continue;
        const A = poly[j];
        const B = poly[(j + 1) % n];
        const t = rayHitDistance(
          orig.x, orig.y, dirX, dirY,
          A.x, A.y, B.x, B.y,
        );
        // Allow the raycast to reach up to 2× targetDist before
        // clamping — this is the "is there an opposite wall within
        // our reachable range" test. Past that, the obstacle is too
        // far to constrain us.
        if (t > 0 && t < targetDist * 2) {
          const safe = Math.max(0, t / 2 - minPx);
          if (safe < maxAllowed) maxAllowed = safe;
        }
      }
    }
    result[i] = {
      x: orig.x + dirX * maxAllowed,
      y: orig.y + dirY * maxAllowed,
    };
  }
  return result;
}

/** Public entry point.
 *
 *  Sign convention: `userExpand > 0` means polygon grows outward
 *  into the cavity / floor side. For non-outermost polygons we
 *  pass that as a NEGATIVE distance to the bisector math (which
 *  treats positive distance as inward). For the outermost polygon
 *  we flip — its "outward" goes off-map, so positive `userExpand`
 *  shrinks it inward into the wall material instead. */
export function safeWallOffset(
  polys: Vec2[][],
  userExpand: number,
  minPx: number = 1,
  /** Testing hook. `false` skips the edge grid and tests every vertex
   *  against every edge, which is what this used to do unconditionally.
   *  The grid is supposed to be an exact optimisation of that, and the
   *  selftest fuzzes the two against each other to keep it honest. */
  useIndex: boolean = true,
): Vec2[][] {
  if (!Number.isFinite(userExpand) || userExpand === 0) {
    return polys.map((p) => p.slice());
  }
  const outer = markOutermost(polys);
  const out: Vec2[][] = new Array(polys.length);
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    if (p.length < 3) { out[i] = p.slice(); continue; }
    const distance = outer[i] ? +userExpand : -userExpand;
    const targets = miteredTargets(p, distance);
    // Grid resolution, not a bound: a typical vertex moves about
    // |distance| and so reaches about 2 × that. Each vertex widens its
    // own query when it needs to.
    const cellSize = Math.abs(distance);
    out[i] = perVertexRaycastClamp(p, targets, minPx, cellSize, useIndex);
  }
  return out;
}
