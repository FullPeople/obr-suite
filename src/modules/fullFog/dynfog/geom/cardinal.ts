// Cardinal spline → PathCommand[].
//
// Direct port of upstream `src/background/util/CardinalSpline.ts`,
// except it emits OBR `PathCommand`s instead of writing into a Skia
// path. Everything downstream (Curve items and Path items alike) then
// goes through the single command sampler in `drawing.ts`, so a Curve
// and an equivalent Path sample identically.
//
// This is the same maths Konva (and therefore Owlbear's own renderer)
// uses for `Curve.style.tension`, so the polyline we derive tracks
// what the GM actually sees on screen.

import { Command, Math2, type PathCommand, type Vector2 } from "@owlbear-rodeo/sdk";

function allFinite(values: number[]): boolean {
  for (const v of values) {
    if (v !== undefined && !Number.isFinite(v)) return false;
  }
  return true;
}

function controlPoints(
  p0: Vector2,
  p1: Vector2,
  p2: Vector2,
  t: number,
): [Vector2, Vector2] {
  const d01 = Math2.distance(p0, p1);
  const d12 = Math2.distance(p1, p2);
  const d = d01 + d12;
  if (d <= 0) {
    return [{ ...p0 }, { ...p0 }];
  }
  const fa = (t * d01) / d;
  const fb = (t * d12) / d;
  const p02 = Math2.subtract(p2, p0);
  const cp1 = Math2.subtract(p1, Math2.multiply(p02, fa));
  const cp2 = Math2.add(p1, Math2.multiply(p02, fb));
  return [cp1, cp2];
}

function expandPoints(p: Vector2[], tension: number): Vector2[] {
  const all: Vector2[] = [];
  for (let n = 1; n < p.length - 1; n++) {
    const [cp1, cp2] = controlPoints(p[n - 1], p[n], p[n + 1], tension);
    if (Number.isNaN(cp1.x)) continue;
    all.push(cp1, p[n], cp2);
  }
  return all;
}

function tensionPointsClosed(p: Vector2[], tension: number): Vector2[] {
  const len = p.length;
  const first = controlPoints(p[len - 1], p[0], p[1], tension);
  const last = controlPoints(p[len - 2], p[len - 1], p[0], tension);
  const middle = expandPoints(p, tension);
  return [first[1]]
    .concat(middle)
    .concat([last[0], p[len - 1], last[1], first[0], p[0]]);
}

function tensionPoints(
  points: Vector2[],
  tension: number,
  closed: boolean,
): Vector2[] {
  return closed
    ? tensionPointsClosed(points, tension)
    : expandPoints(points, tension);
}

/** Convert a Curve's `points` + `tension` into path commands. */
export function cardinalSplineToCommands(
  points: Vector2[],
  tension = 0.5,
  closed = true,
): PathCommand[] {
  const out: PathCommand[] = [];
  if (points.length === 0) return out;

  out.push([Command.MOVE, points[0].x, points[0].y]);

  if (tension !== 0 && points.length > 2) {
    const tp = tensionPoints(points, tension, closed);
    const tpLen = tp.length;

    if (!closed && tpLen > 1) {
      out.push([Command.QUAD, tp[0].x, tp[0].y, tp[1].x, tp[1].y]);
    }

    for (let n = closed ? 0 : 2; n < tpLen - 1; n += 3) {
      const cp1 = tp[n];
      const cp2 = tp[n + 1];
      const end = tp[n + 2];
      if (!cp1 || !cp2 || !end) break;
      if (!allFinite([cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y])) continue;
      out.push([Command.CUBIC, cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y]);
    }

    if (!closed && tpLen > 0) {
      const last = points[points.length - 1];
      out.push([
        Command.QUAD,
        tp[tpLen - 1].x,
        tp[tpLen - 1].y,
        last.x,
        last.y,
      ]);
    }
  } else {
    for (let n = 1; n < points.length; n++) {
      out.push([Command.LINE, points[n].x, points[n].y]);
    }
  }

  if (closed) out.push([Command.CLOSE]);

  return out;
}
