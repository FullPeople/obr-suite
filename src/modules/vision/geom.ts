// 2D geometry helpers for the visibility polygon computation.
//
// The algorithm is the standard "angular sweep" raycaster used by
// 2D vision systems (e.g., the Smoke! plugin's underlying approach):
//
//   1. Collect every wall endpoint within `radius` of the light.
//   2. For each endpoint, compute its bearing from the light, then
//      cast THREE rays at that bearing (the bearing itself and two
//      tiny angular epsilons so we capture both the "hits this
//      corner head-on" and "skims past the corner" cases).
//   3. Each ray walks all walls and stops at the closest intersection,
//      capped at `radius`.
//   4. Sort hits by bearing → polygon vertices in radial order.
//
// To save us from writing a full BVH, we just iterate every wall
// per ray (O(walls) per ray, O(rays × walls) per light). On a typical
// scene with ~50 walls and ~120 lights/rays this is well under 10k
// operations per redraw, fine for 60fps.
//
// To stop player tokens with overlapping lights from drawing through
// the wall on the OTHER side from the player, we ALSO add the
// `radius` boundary as a "circle approximation" — a fan of points at
// the cap distance — so the polygon ends at radius even when no
// wall is closer.

import { Vec2, WallSegment } from "./types";

// Compute the closest intersection of a ray (origin + dir × t, with
// t > 0) against a single segment AB. Returns t if hit, else null.
// dir is assumed unit-length, but we don't strictly require it
// because we return parametric t in dir's units.
function rayHitsSegment(
  ox: number, oy: number,
  dx: number, dy: number,
  ax: number, ay: number,
  bx: number, by: number,
): number | null {
  // Standard ray vs segment using parametric:
  //   ray:  P = O + t * D  (t >= 0)
  //   seg:  P = A + u * (B - A)  (0 <= u <= 1)
  // Solve for t, u.
  const sx = bx - ax;
  const sy = by - ay;
  const denom = (-sx) * dy + dx * sy;
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const t = (sx * (oy - ay) - sy * (ox - ax)) / denom;
  const u = (-dy * (ox - ax) + dx * (oy - ay)) / denom;
  if (t > 0 && u >= 0 && u <= 1) return t;
  return null;
}

// Cast a single ray; return the (worldX, worldY) hit point clamped
// to `maxDist`.
export function cast(
  origin: Vec2,
  angleRad: number,
  maxDist: number,
  walls: WallSegment[],
): Vec2 {
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  let best = maxDist;
  for (const w of walls) {
    const t = rayHitsSegment(origin.x, origin.y, dx, dy, w.ax, w.ay, w.bx, w.by);
    if (t != null && t < best) best = t;
  }
  return { x: origin.x + dx * best, y: origin.y + dy * best };
}

// Visibility polygon: given a light origin + radius + walls, return
// the closed polygon (counter-clockwise points in scene coords) of
// the visible area.
export function visibilityPolygon(
  origin: Vec2,
  radius: number,
  walls: WallSegment[],
  // When `rays` is null, we use the corner-aware "endpoint sweep"
  // mode — one ray per wall endpoint plus its two epsilon variants,
  // plus a fallback fan of `fallbackRays` rays to make sure we get
  // smooth circular boundary in the absence of walls.
  fallbackRays: number = 64,
): Vec2[] {
  // Trim walls to those whose endpoints are at most `radius` away
  // (with a small slack — a far wall whose middle is within radius
  // is NOT trimmed because the segment can still occlude rays).
  // Cheap broad-phase: keep walls whose either endpoint is within
  // 2 × radius (handles long walls with mid-point inside).
  const r2 = (radius * 2) * (radius * 2);
  const near: WallSegment[] = [];
  for (const w of walls) {
    const da = (w.ax - origin.x) ** 2 + (w.ay - origin.y) ** 2;
    const db = (w.bx - origin.x) ** 2 + (w.by - origin.y) ** 2;
    if (da <= r2 || db <= r2) near.push(w);
  }

  // Collect candidate angles.
  const eps = 0.0008; // ~0.046° — wide enough to step past a corner
  const angles: number[] = [];
  for (const w of near) {
    const aA = Math.atan2(w.ay - origin.y, w.ax - origin.x);
    const aB = Math.atan2(w.by - origin.y, w.bx - origin.x);
    angles.push(aA - eps, aA, aA + eps, aB - eps, aB, aB + eps);
  }
  // Add fallback fan for smooth circular boundary.
  for (let i = 0; i < fallbackRays; i++) {
    angles.push((i / fallbackRays) * Math.PI * 2);
  }

  // Sort by angle.
  angles.sort((a, b) => a - b);

  // Cast each angle.
  const pts: Vec2[] = angles.map((a) => cast(origin, a, radius, near));

  // Dedupe consecutive near-duplicates (within 0.5 scene units +
  // < 0.001 rad apart).
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (out.length > 0) {
      const q = out[out.length - 1];
      if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5) continue;
    }
    out.push(p);
  }
  return out;
}

// Polygon area (signed). Positive = CCW.
export function polygonSignedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

// Reverse polygon order in-place. Used to flip CCW ↔ CW.
export function reversePolygon(pts: Vec2[]): Vec2[] {
  return pts.slice().reverse();
}

// Build a self-intersecting "donut" polygon that, with non-zero
// winding fill, renders as outer-rect minus each hole.
//
// Mechanics: walk outer CCW, then for each hole jump to its first
// vertex, walk it CW (opposite winding to outer), then jump back to
// outer. The "jump" is a zero-thickness back-and-forth that the
// renderer treats as part of the polygon boundary; with non-zero
// winding the jumps cancel out because they cross themselves.
//
// We pick the first outer vertex as the bridge anchor for all
// holes (single fan). This is simpler than picking per-hole anchors
// and works for any well-separated holes.
export function donutPolygon(outerCCW: Vec2[], holesCCW: Vec2[][]): Vec2[] {
  if (holesCCW.length === 0) return outerCCW;
  const out: Vec2[] = [...outerCCW];
  // Bridge anchor — last outer vertex (so we can return cleanly to
  // the start of the outer chain after each hole detour).
  const anchor = outerCCW[outerCCW.length - 1];
  for (const hole of holesCCW) {
    if (hole.length < 3) continue;
    const holeCW = reversePolygon(hole); // flip winding
    out.push({ x: holeCW[0].x, y: holeCW[0].y }); // jump in
    for (let i = 1; i < holeCW.length; i++) out.push(holeCW[i]);
    out.push({ x: holeCW[0].x, y: holeCW[0].y }); // close hole
    out.push({ x: anchor.x, y: anchor.y }); // jump back
  }
  return out;
}

// Compute a bounding rectangle expanded by `pad`. Used as the outer
// of the fog-of-war donut so the dark area extends beyond any
// visible region.
export function expandedSceneRect(
  visiblePolys: Vec2[][],
  origins: Vec2[],
  pad: number,
): Vec2[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consume = (p: Vec2) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  for (const poly of visiblePolys) for (const p of poly) consume(p);
  for (const o of origins) consume(o);
  if (!isFinite(minX)) {
    minX = -1000; minY = -1000; maxX = 1000; maxY = 1000;
  }
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  // Returned in CCW order.
  return [
    { x: minX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
    { x: maxX, y: minY },
  ];
}

// Ensure the polygon is CCW; flip in place otherwise.
export function ensureCCW(pts: Vec2[]): Vec2[] {
  return polygonSignedArea(pts) > 0 ? pts : reversePolygon(pts);
}
