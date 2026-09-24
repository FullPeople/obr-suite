// Portal landing-point search — the geometry half, extracted from
// index.ts so it can be benchmarked and fuzzed without an OBR session.
//
// Teleporting N tokens picks, for each, the first candidate position in
// a hex spiral around the destination that is (a) not already taken and
// (b) "safe": at least `clearance` away from every wall, and reachable
// from the portal centre without crossing one.
//
// The naive form tests EVERY candidate against EVERY wall. On a traced
// map that is thousands of segments against hundreds of candidates per
// token, which measured ~17 ms for a single token's probes and scales
// linearly with the party size.
//
// Both safety tests are spatially bounded, so both can be pruned:
//
//   * the clearance test only cares about walls within `clearance` of
//     the point;
//   * the crossing test only cares about walls whose bounding box meets
//     the segment from the portal centre to the point.
//
// `WallGrid` buckets the segments once per teleport and hands back a
// SUPERSET of the walls each test could care about. Since both tests
// ask "does ANY wall fail", and a pruned-out wall provably cannot fail,
// the boolean answer is identical to the exhaustive scan — which is
// what `tools/portal-landing-bench.entry.ts` and the selftest check.

export type Point = { x: number; y: number };
export type WallSegment = { a: Point; b: Point };

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.000001) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dist(p, { x: a.x + vx * t, y: a.y + vy * t });
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function segmentCrossesWall(
  from: Point,
  to: Point,
  wall: WallSegment,
): boolean {
  if (dist(from, to) < 1) return false;
  const r = subtract(to, from);
  const s = subtract(wall.b, wall.a);
  const denom = cross(r, s);
  if (Math.abs(denom) < 0.000001) return false;
  const qp = subtract(wall.a, from);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  return t > 0.02 && t < 0.98 && u >= -0.001 && u <= 1.001;
}

/** Exhaustive reference. Kept because it defines the answer the indexed
 *  path has to reproduce, and the selftest fuzzes against it. */
export function isSafeLandingPointExhaustive(
  point: Point,
  origin: Point,
  clearance: number,
  walls: WallSegment[],
): boolean {
  for (const wall of walls) {
    if (distancePointToSegment(point, wall.a, wall.b) < clearance) return false;
    if (segmentCrossesWall(origin, point, wall)) return false;
  }
  return true;
}

/** Uniform grid over wall segments, bucketed by bounding box. */
export class WallGrid {
  private cells = new Map<number, number[]>();
  private stamps: Int32Array;
  private pass = 0;
  private cell: number;
  private minX = 0;
  private minY = 0;
  private cols = 1;
  private rows = 1;
  readonly walls: WallSegment[];

  constructor(walls: WallSegment[], cellSize: number) {
    this.walls = walls;
    this.stamps = new Int32Array(walls.length);
    this.cell = Math.max(cellSize, 1);
    if (walls.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const w of walls) {
      minX = Math.min(minX, w.a.x, w.b.x);
      minY = Math.min(minY, w.a.y, w.b.y);
      maxX = Math.max(maxX, w.a.x, w.b.x);
      maxY = Math.max(maxY, w.a.y, w.b.y);
    }
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 1);
    this.rows = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 1);

    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const c0 = this.col(Math.min(w.a.x, w.b.x));
      const c1 = this.col(Math.max(w.a.x, w.b.x));
      const r0 = this.row(Math.min(w.a.y, w.b.y));
      const r1 = this.row(Math.max(w.a.y, w.b.y));
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

  private col(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.minX) / this.cell)));
  }
  private row(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.minY) / this.cell)));
  }

  /** Wall indices in every cell the box touches, each yielded once. */
  private collect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    out: number[],
  ): void {
    out.length = 0;
    if (this.walls.length === 0) return;
    this.pass++;
    const c0 = this.col(x0);
    const c1 = this.col(x1);
    const r0 = this.row(y0);
    const r1 = this.row(y1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const bucket = this.cells.get(r * this.cols + c);
        if (!bucket) continue;
        for (const i of bucket) {
          if (this.stamps[i] === this.pass) continue;
          this.stamps[i] = this.pass;
          out.push(i);
        }
      }
    }
  }

  /**
   * Same answer as `isSafeLandingPointExhaustive`, without visiting
   * every wall.
   *
   * The two tests get separate queries because they have very different
   * extents: the clearance test is a small disc around the point, while
   * the crossing test spans the whole portal-centre-to-point segment.
   * Running both off the larger box would throw away most of the prune.
   */
  isSafeLandingPoint(
    point: Point,
    origin: Point,
    clearance: number,
    scratch: number[] = [],
  ): boolean {
    if (this.walls.length === 0) return true;

    this.collect(
      point.x - clearance,
      point.y - clearance,
      point.x + clearance,
      point.y + clearance,
      scratch,
    );
    for (const i of scratch) {
      const w = this.walls[i];
      if (distancePointToSegment(point, w.a, w.b) < clearance) return false;
    }

    this.collect(
      Math.min(origin.x, point.x),
      Math.min(origin.y, point.y),
      Math.max(origin.x, point.x),
      Math.max(origin.y, point.y),
      scratch,
    );
    for (const i of scratch) {
      if (segmentCrossesWall(origin, point, this.walls[i])) return false;
    }
    return true;
  }
}

/** Grid resolution. Segments on a traced map are short, so a cell a few
 *  grid squares across keeps buckets small without exploding their
 *  count. Clamped so a huge clearance cannot produce a one-cell grid. */
export function landingCellSize(spacing: number): number {
  return Math.max(32, Math.min(spacing * 2, 512));
}
