// Cardinal-spline smoothing of polyline / polygon paths.
//
// Port of dynamic-fog's CardinalSpline (GPL-3.0, owlbear-rodeo) but:
//   - emits OBR PathCommand[] directly (CUBIC), no canvaskit dep
//   - works on { x, y } points without the SDK's Math2 wrapper
//   - returns BOTH the cubic-bezier commands (for visual Path) AND
//     a sampled polyline (for Wall items, which can't carry curves)
//
// The math: for each interior triple (p0, p1, p2), compute two
// control points around p1 such that the curve passes through p1
// with smooth tangent. Tension parameter scales the control-point
// distance; 0 = sharp polyline, 0.5 = nicely smooth, 1 = round-y.

import { Command, type PathCommand } from "@owlbear-rodeo/sdk";

export interface Vec2 { x: number; y: number; }

function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Vec2, s: number): Vec2 { return { x: a.x * s, y: a.y * s }; }
function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** For three consecutive points (p0, p1, p2), return a pair of
 *  control points (cp1, cp2) flanking p1. The curve passes through
 *  p1 with tangent parallel to (p2 - p0), scaled by `tension`. */
function controlPoints(p0: Vec2, p1: Vec2, p2: Vec2, t: number): [Vec2, Vec2] {
  const d01 = dist(p0, p1);
  const d12 = dist(p1, p2);
  const d = d01 + d12;
  if (d <= 0) return [{ ...p0 }, { ...p0 }];
  const fa = (t * d01) / d;
  const fb = (t * d12) / d;
  const p02 = sub(p2, p0);
  return [sub(p1, mul(p02, fa)), add(p1, mul(p02, fb))];
}

function expandPoints(pts: Vec2[], tension: number): Vec2[] {
  const out: Vec2[] = [];
  for (let n = 1; n < pts.length - 1; n++) {
    const [cp1, cp2] = controlPoints(pts[n - 1], pts[n], pts[n + 1], tension);
    if (Number.isNaN(cp1.x)) continue;
    out.push(cp1, pts[n], cp2);
  }
  return out;
}

function tensionPointsClosed(pts: Vec2[], tension: number): Vec2[] {
  const len = pts.length;
  const first = controlPoints(pts[len - 1], pts[0], pts[1], tension);
  const last = controlPoints(pts[len - 2], pts[len - 1], pts[0], tension);
  const middle = expandPoints(pts, tension);
  return [first[1], ...middle, last[0], pts[len - 1], last[1], first[0], pts[0]];
}

/** Convert a polygon (closed=true) or polyline (closed=false) to
 *  OBR PathCommand[] with cubic-bezier smoothing.
 *
 *  tension = 0 produces a polyline (LINE commands only).
 *  tension > 0 produces CUBIC commands following Cardinal-spline
 *  control point math. Recommended tension: 0.3-0.6. */
export function smoothToPathCommands(
  pts: Vec2[],
  tension: number,
  closed: boolean,
): PathCommand[] {
  if (pts.length === 0) return [];
  const out: PathCommand[] = [];
  out.push([Command.MOVE, pts[0].x, pts[0].y]);

  if (tension === 0 || pts.length <= 2) {
    for (let i = 1; i < pts.length; i++) {
      out.push([Command.LINE, pts[i].x, pts[i].y]);
    }
    if (closed) out.push([Command.CLOSE]);
    return out;
  }

  const tp = closed
    ? tensionPointsClosed(pts, tension)
    : expandPoints(pts, tension);
  const tlen = tp.length;

  if (!closed && tlen > 1) {
    // Lead-in quad from first point through first tension control.
    out.push([Command.QUAD, tp[0].x, tp[0].y, tp[1].x, tp[1].y]);
  }

  for (let n = closed ? 0 : 2; n < tlen - 1; n += 3) {
    const cp1 = tp[n];
    const cp2 = tp[n + 1];
    const p   = tp[n + 2];
    if ([cp1, cp2, p].every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))) {
      out.push([Command.CUBIC, cp1.x, cp1.y, cp2.x, cp2.y, p.x, p.y]);
    }
  }

  if (!closed && tlen > 0) {
    // Lead-out quad to the last point.
    const last = tp[tlen - 1];
    const endP = pts[pts.length - 1];
    out.push([Command.QUAD, last.x, last.y, endP.x, endP.y]);
  }

  if (closed) out.push([Command.CLOSE]);
  return out;
}

/** Sample a smoothed Cardinal-spline polygon as a dense polyline.
 *
 *  Walls and other geometry consumers that don't accept Bezier
 *  curves get this output instead. `samplesPerSegment` controls
 *  the density along each cubic segment (8-16 = visually smooth). */
export function smoothToPolyline(
  pts: Vec2[],
  tension: number,
  closed: boolean,
  samplesPerSegment: number = 12,
): Vec2[] {
  if (pts.length === 0) return [];
  if (tension === 0 || pts.length <= 2) {
    return closed ? [...pts, pts[0]] : pts.slice();
  }
  const tp = closed
    ? tensionPointsClosed(pts, tension)
    : expandPoints(pts, tension);
  const tlen = tp.length;

  const out: Vec2[] = [];
  out.push({ ...pts[0] });

  // Sample CUBIC segments. tp groups indices [n, n+1, n+2] = [cp1, cp2, p].
  for (let n = closed ? 0 : 2; n < tlen - 1; n += 3) {
    const cp1 = tp[n];
    const cp2 = tp[n + 1];
    const end = tp[n + 2];
    const start = out[out.length - 1];
    for (let i = 1; i <= samplesPerSegment; i++) {
      const t = i / samplesPerSegment;
      const u = 1 - t;
      const x =
        u * u * u * start.x +
        3 * u * u * t * cp1.x +
        3 * u * t * t * cp2.x +
        t * t * t * end.x;
      const y =
        u * u * u * start.y +
        3 * u * u * t * cp1.y +
        3 * u * t * t * cp2.y +
        t * t * t * end.y;
      out.push({ x, y });
    }
  }

  if (closed && out.length > 0) {
    out.push({ ...out[0] });
  }
  return out;
}

/** Chaikin corner-cutting smoothing — each iteration replaces every
 *  segment AB with two new vertices at 1/4 and 3/4 along it.
 *  Faster + simpler than Cardinal spline, but produces piecewise-
 *  linear output (no curves). Good for "remove jaggies but stay
 *  polyline" as needed by Wall items. iters >= 1; 2-3 is typical. */
export function chaikinSmooth(pts: Vec2[], iters: number, closed: boolean): Vec2[] {
  if (iters <= 0 || pts.length < 3) return pts.slice();
  let cur = pts.slice();
  for (let it = 0; it < iters; it++) {
    const next: Vec2[] = [];
    const n = cur.length;
    const last = closed ? n : n - 1;
    if (!closed) next.push({ ...cur[0] });
    for (let i = 0; i < last; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
      );
    }
    if (!closed) next.push({ ...cur[n - 1] });
    cur = next;
  }
  return cur;
}
