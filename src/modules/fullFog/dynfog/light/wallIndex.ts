// Line-of-sight queries against the derived wall set.
//
// Used by `occlusion.ts` to answer one question: is there a wall
// between these two points? Owlbear does the equivalent internally when
// it renders light, but exposes nothing, so we run it ourselves against
// the very same polylines the WallActors emit — if a wall blocks light
// on screen it blocks a query here.
//
// A traced map can carry tens of thousands of wall segments and the
// query runs once per (own light × foreign light) pair on every token
// commit, so a linear scan is not an option. Segments go into a uniform
// grid and a query marches only the cells it actually crosses.
//
// The index is REBUILT, never mutated: wall geometry changes rarely
// (drawing a fog shape, toggling a door) while queries are frequent.

import type { Vector2 } from "@owlbear-rodeo/sdk";

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Target average segments per occupied cell. Smaller cells mean more
 *  buckets to allocate but fewer candidates per query. */
const TARGET_PER_CELL = 4;
/** Floor on cell size, so a degenerate input cannot ask for a
 *  billion-cell grid. */
const MIN_CELL = 8;
/** Cap on total cells, for the same reason from the other end. */
const MAX_CELLS = 400_000;

function cross(
  ox: number,
  oy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  return (
    Math.min(ax, bx) - 1e-9 <= cx &&
    cx <= Math.max(ax, bx) + 1e-9 &&
    Math.min(ay, by) - 1e-9 <= cy &&
    cy <= Math.max(ay, by) + 1e-9
  );
}

/** Proper segment intersection. Touching endpoints and collinear
 *  overlap both count as a hit — a sight line running exactly along a
 *  wall is blocked, which is the conservative answer. */
function segmentsIntersect(
  s: Segment,
  px: number,
  py: number,
  qx: number,
  qy: number,
): boolean {
  const d1 = cross(px, py, qx, qy, s.ax, s.ay);
  const d2 = cross(px, py, qx, qy, s.bx, s.by);
  const d3 = cross(s.ax, s.ay, s.bx, s.by, px, py);
  const d4 = cross(s.ax, s.ay, s.bx, s.by, qx, qy);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  if (Math.abs(d1) < 1e-9 && onSegment(px, py, qx, qy, s.ax, s.ay)) return true;
  if (Math.abs(d2) < 1e-9 && onSegment(px, py, qx, qy, s.bx, s.by)) return true;
  if (Math.abs(d3) < 1e-9 && onSegment(s.ax, s.ay, s.bx, s.by, px, py)) {
    return true;
  }
  if (Math.abs(d4) < 1e-9 && onSegment(s.ax, s.ay, s.bx, s.by, qx, qy)) {
    return true;
  }
  return false;
}

export class WallIndex {
  private segments: Segment[] = [];
  private cells: Map<number, number[]> = new Map();
  private cellSize = 128;
  private minX = 0;
  private minY = 0;
  private cols = 1;
  private rows = 1;
  /** Marks the query pass a segment was last tested in, so a segment
   *  spanning several cells is tested at most once per query. */
  private stamps: Int32Array = new Int32Array(0);
  private pass = 0;

  get size(): number {
    return this.segments.length;
  }

  /** Build from world-space polylines. Each consecutive pair becomes a
   *  segment; zero-length pairs are dropped. */
  static build(polylines: Vector2[][]): WallIndex {
    const index = new WallIndex();
    index.load(polylines);
    return index;
  }

  private load(polylines: Vector2[][]): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const poly of polylines) {
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        if (!a || !b) continue;
        if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) continue;
        this.segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
        if (a.x < minX) minX = a.x;
        if (b.x < minX) minX = b.x;
        if (a.y < minY) minY = a.y;
        if (b.y < minY) minY = b.y;
        if (a.x > maxX) maxX = a.x;
        if (b.x > maxX) maxX = b.x;
        if (a.y > maxY) maxY = a.y;
        if (b.y > maxY) maxY = b.y;
      }
    }
    if (this.segments.length === 0) return;

    this.stamps = new Int32Array(this.segments.length);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    // Aim for TARGET_PER_CELL segments per cell assuming an even
    // spread, then clamp so a pathological input cannot blow memory.
    const wanted = Math.max(1, this.segments.length / TARGET_PER_CELL);
    let cell = Math.max(MIN_CELL, Math.sqrt((width * height) / wanted));
    let cols = Math.ceil(width / cell) + 1;
    let rows = Math.ceil(height / cell) + 1;
    if (cols * rows > MAX_CELLS) {
      cell = Math.sqrt((width * height) / MAX_CELLS);
      cols = Math.ceil(width / cell) + 1;
      rows = Math.ceil(height / cell) + 1;
    }

    this.cellSize = cell;
    this.minX = minX;
    this.minY = minY;
    this.cols = cols;
    this.rows = rows;

    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      const c0 = this.clampCol(Math.min(s.ax, s.bx));
      const c1 = this.clampCol(Math.max(s.ax, s.bx));
      const r0 = this.clampRow(Math.min(s.ay, s.by));
      const r1 = this.clampRow(Math.max(s.ay, s.by));
      // Bucketing by bounding box rather than exact traversal slightly
      // over-approximates; the per-candidate test is exact, so it costs
      // a few wasted comparisons and no accuracy.
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const key = r * this.cols + c;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  private clampCol(x: number): number {
    const c = Math.floor((x - this.minX) / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private clampRow(y: number): number {
    const r = Math.floor((y - this.minY) / this.cellSize);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  /**
   * Is the straight line from `a` to `b` broken by a wall?
   *
   * `trim` pulls both endpoints inward along the line before testing.
   * Light sources sit on walls all the time — a sconce token is placed
   * over the wall it hangs on, a torchbearer stands in a doorway — and
   * without the trim such a source would be permanently self-occluded.
   */
  blocked(a: Vector2, b: Vector2, trim = 0): boolean {
    if (this.segments.length === 0) return false;

    let px = a.x;
    let py = a.y;
    let qx = b.x;
    let qy = b.y;
    const dx = qx - px;
    const dy = qy - py;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return false;
    const t = Math.min(trim, len * 0.25);
    if (t > 0) {
      const ux = dx / len;
      const uy = dy / len;
      px += ux * t;
      py += uy * t;
      qx -= ux * t;
      qy -= uy * t;
    }

    this.pass++;
    const stamp = this.pass;

    // March the grid cell by cell along the query segment. Visiting
    // only the crossed cells is what keeps this cheap on a 50k-segment
    // traced map.
    let col = this.clampCol(px);
    let row = this.clampRow(py);
    const endCol = this.clampCol(qx);
    const endRow = this.clampRow(qy);
    const stepX = qx > px ? 1 : qx < px ? -1 : 0;
    const stepY = qy > py ? 1 : qy < py ? -1 : 0;

    const invX = stepX === 0 ? Infinity : Math.abs(this.cellSize / (qx - px));
    const invY = stepY === 0 ? Infinity : Math.abs(this.cellSize / (qy - py));

    const boundaryX = this.minX + (col + (stepX > 0 ? 1 : 0)) * this.cellSize;
    const boundaryY = this.minY + (row + (stepY > 0 ? 1 : 0)) * this.cellSize;
    let tMaxX =
      stepX === 0 ? Infinity : Math.abs((boundaryX - px) / (qx - px));
    let tMaxY =
      stepY === 0 ? Infinity : Math.abs((boundaryY - py) / (qy - py));

    // Bound the march by the Manhattan cell distance plus slack, so a
    // numeric edge case cannot spin here.
    const maxSteps = Math.abs(endCol - col) + Math.abs(endRow - row) + 4;

    for (let step = 0; step <= maxSteps; step++) {
      const bucket = this.cells.get(row * this.cols + col);
      if (bucket) {
        for (const i of bucket) {
          if (this.stamps[i] === stamp) continue;
          this.stamps[i] = stamp;
          if (segmentsIntersect(this.segments[i], px, py, qx, qy)) return true;
        }
      }
      if (col === endCol && row === endRow) break;
      if (tMaxX < tMaxY) {
        tMaxX += invX;
        col += stepX;
        if (col < 0 || col >= this.cols) break;
      } else {
        tMaxY += invY;
        row += stepY;
        if (row < 0 || row >= this.rows) break;
      }
    }
    return false;
  }
}

/** An index over nothing — every query is clear. Used before the first
 *  build and whenever occlusion is switched off. */
export const EMPTY_WALL_INDEX = WallIndex.build([]);
