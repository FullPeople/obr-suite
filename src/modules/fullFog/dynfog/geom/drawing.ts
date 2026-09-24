// FOG-layer "Drawing" → contour polylines (in the item's LOCAL space).
//
// This is the single source of truth for wall geometry AND for the
// arc-length space that doors / windows are addressed in. Every client
// runs it on the same shared item data, so every client derives the
// same polylines — that's what lets an opening be stored as
// `{polyIndex, t1, t2}` and mean the same thing everywhere.
//
// It replaces upstream's CanvasKit pipeline
// (`drawingToSkPath` → `stroke()` → `skPathToPathCommands` →
// `commandsToPolylines`). See docs/DYNAMIC_FOG_PARITY.md §3 for why
// we don't stroke: walls follow the drawing's centre line, not its
// stroked outline.
//
// ⚠ DETERMINISM CONTRACT: changing anything in here (sample counts,
// closure rules, the shape primitives) shifts the arc-length space and
// therefore moves every already-placed door/window. Treat the numbers
// below as a wire format.

import {
  Command,
  isCurve,
  isLine,
  isPath,
  isShape,
  type Curve,
  type Item,
  type Line,
  type Path,
  type PathCommand,
  type Shape,
  type Vector2,
} from "@owlbear-rodeo/sdk";
import { cardinalSplineToCommands } from "./cardinal";

/** The item types Owlbear's fog tool can put on the FOG layer. */
export type Drawing = Shape | Path | Curve | Line;

export function isDrawing(item: Item): item is Drawing {
  return isShape(item) || isPath(item) || isCurve(item) || isLine(item);
}

/** An item that becomes walls: any Drawing sitting on the FOG layer. */
export function isFogDrawing(item: Item): item is Drawing {
  return item.layer === "FOG" && isDrawing(item);
}

/** Local-space units between samples on a curved segment. Matches
 *  upstream's `sampleDistance = 10`. */
const SAMPLE_DISTANCE = 10;
/** Hard bounds so a pathological curve can't explode the vertex count. */
const MIN_CURVE_SAMPLES = 2;
const MAX_CURVE_SAMPLES = 64;
/** Circles / ovals are sampled at a fixed count so their arc-length
 *  space never depends on their pixel size. 64 segments keeps a
 *  1000px-wide circle within ~1px of true. */
const CIRCLE_SEGMENTS = 64;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function curveSampleCount(controlNetLength: number): number {
  const n = Math.ceil(controlNetLength / SAMPLE_DISTANCE);
  if (!Number.isFinite(n)) return MIN_CURVE_SAMPLES;
  return Math.min(MAX_CURVE_SAMPLES, Math.max(MIN_CURVE_SAMPLES, n));
}

/**
 * Sample `PathCommand[]` into one polyline per subpath.
 *
 * A subpath starts at each MOVE. A CLOSE appends the subpath's start
 * point (so the closing edge exists as a real segment) and terminates
 * the subpath.
 */
export function commandsToPolylines(commands: PathCommand[]): Vector2[][] {
  const out: Vector2[][] = [];
  let cur: Vector2[] | null = null;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;

  const push = (x: number, y: number) => {
    if (cur) cur.push({ x, y });
  };

  for (const cmd of commands) {
    switch (cmd[0]) {
      case Command.MOVE: {
        if (cur && cur.length >= 2) out.push(cur);
        cur = [{ x: cmd[1], y: cmd[2] }];
        startX = lastX = cmd[1];
        startY = lastY = cmd[2];
        break;
      }
      case Command.LINE: {
        push(cmd[1], cmd[2]);
        lastX = cmd[1];
        lastY = cmd[2];
        break;
      }
      case Command.QUAD: {
        const [, cpx, cpy, ex, ey] = cmd;
        const n = curveSampleCount(
          dist(lastX, lastY, cpx, cpy) + dist(cpx, cpy, ex, ey),
        );
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push(
            u * u * lastX + 2 * u * t * cpx + t * t * ex,
            u * u * lastY + 2 * u * t * cpy + t * t * ey,
          );
        }
        lastX = ex;
        lastY = ey;
        break;
      }
      case Command.CONIC: {
        // [CONIC, cpx, cpy, ex, ey, weight] — rational quadratic.
        const [, cpx, cpy, ex, ey, w] = cmd;
        const weight = Number.isFinite(w) && w > 0 ? w : 1;
        const n = curveSampleCount(
          dist(lastX, lastY, cpx, cpy) + dist(cpx, cpy, ex, ey),
        );
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const b0 = u * u;
          const b1 = 2 * u * t * weight;
          const b2 = t * t;
          const denom = b0 + b1 + b2 || 1;
          push(
            (b0 * lastX + b1 * cpx + b2 * ex) / denom,
            (b0 * lastY + b1 * cpy + b2 * ey) / denom,
          );
        }
        lastX = ex;
        lastY = ey;
        break;
      }
      case Command.CUBIC: {
        const [, c1x, c1y, c2x, c2y, ex, ey] = cmd;
        const n = curveSampleCount(
          dist(lastX, lastY, c1x, c1y) +
            dist(c1x, c1y, c2x, c2y) +
            dist(c2x, c2y, ex, ey),
        );
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push(
            u * u * u * lastX +
              3 * u * u * t * c1x +
              3 * u * t * t * c2x +
              t * t * t * ex,
            u * u * u * lastY +
              3 * u * u * t * c1y +
              3 * u * t * t * c2y +
              t * t * t * ey,
          );
        }
        lastX = ex;
        lastY = ey;
        break;
      }
      case Command.CLOSE: {
        if (cur) {
          cur.push({ x: startX, y: startY });
          if (cur.length >= 2) out.push(cur);
          cur = null;
        }
        lastX = startX;
        lastY = startY;
        break;
      }
    }
  }
  if (cur && cur.length >= 2) out.push(cur);
  return out;
}

function shapeToPolylines(shape: Shape): Vector2[][] {
  const w = shape.width;
  const h = shape.height;
  switch (shape.shapeType) {
    case "RECTANGLE":
      // Owlbear anchors rectangles at their top-left corner.
      return [
        [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
          { x: 0, y: 0 },
        ],
      ];
    case "CIRCLE": {
      const rx = w / 2;
      const ry = h / 2;
      const pts: Vector2[] = [];
      for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
        const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
      }
      return [pts];
    }
    case "TRIANGLE":
      return [
        [
          { x: 0, y: 0 },
          { x: w / 2, y: h },
          { x: -w / 2, y: h },
          { x: 0, y: 0 },
        ],
      ];
    case "HEXAGON": {
      const r = Math.min(w, h) / 2;
      const pts: Vector2[] = [];
      for (let i = 0; i < 6; i++) {
        // Start at the top vertex and go clockwise — matches upstream's
        // RegularPolygon, which rotates {0, -r} by 60° steps.
        const a = (Math.PI / 180) * (60 * i);
        pts.push({
          x: 0 * Math.cos(a) - -r * Math.sin(a),
          y: 0 * Math.sin(a) + -r * Math.cos(a),
        });
      }
      pts.push({ ...pts[0] });
      return [pts];
    }
    default:
      return [];
  }
}

function curveToPolylines(curve: Curve): Vector2[][] {
  if (!Array.isArray(curve.points) || curve.points.length < 2) return [];
  const tension = curve.style?.tension ?? 0;
  const closed =
    (curve.style?.fillOpacity ?? 0) > 0 || Boolean(curve.style?.closed);
  const commands = cardinalSplineToCommands(curve.points, tension, closed);
  return commandsToPolylines(commands);
}

function lineToPolylines(line: Line): Vector2[][] {
  const a = line.startPosition;
  const b = line.endPosition;
  if (!a || !b) return [];
  return [[{ x: a.x, y: a.y }, { x: b.x, y: b.y }]];
}

function pathToPolylines(path: Path): Vector2[][] {
  if (!Array.isArray(path.commands) || path.commands.length === 0) return [];
  return commandsToPolylines(path.commands);
}

/**
 * Contour polylines for any Drawing, in the drawing's LOCAL space.
 *
 * Closed contours end with a duplicate of their first point so the
 * closing edge participates in arc length and in wall generation.
 */
export function drawingToPolylines(drawing: Drawing): Vector2[][] {
  let polys: Vector2[][];
  if (isShape(drawing)) polys = shapeToPolylines(drawing);
  else if (isCurve(drawing)) polys = curveToPolylines(drawing);
  else if (isPath(drawing)) polys = pathToPolylines(drawing);
  else if (isLine(drawing)) polys = lineToPolylines(drawing);
  else polys = [];

  // Drop degenerate contours — a 1-point subpath can't be a wall and
  // would break normalised arc-length maths downstream.
  return polys.filter((p) => p.length >= 2);
}
