// Follow — A* pathfinding around OBR Wall items.
//
// The follow plugin used to teleport the source token to the target's
// new offset position the instant the target finished a drag. This
// felt jerky AND ignored walls — a follower could "walk through"
// solid geometry. With this module the follower instead computes an
// A* path on a regular grid (cell size = scene DPI) where any cell
// transition that would cross a Wall segment is blocked, then
// animates step-by-step.
//
// Walls are read from `OBR.scene.local` — the per-client wall set
// the fullFog watcher maintains. We assume the caller has already
// fetched them; this module is pure math (no OBR API calls).

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Vec2 { x: number; y: number; }

/** Flatten OBR Wall items into individual line segments. Each Wall
 *  has a `points` array — N points → N-1 segments. */
export function wallsToSegments(walls: Array<any>): WallSegment[] {
  const out: WallSegment[] = [];
  for (const w of walls) {
    const pts: Array<{ x: number; y: number }> | undefined = w?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    // Walls inherit their parent map's transform via attachedTo. To
    // get world-space segments we need: world = mapPos + R(rot) * (pt * scale).
    const px = w.position?.x ?? 0;
    const py = w.position?.y ?? 0;
    const sx = w.scale?.x ?? 1;
    const sy = w.scale?.y ?? 1;
    const r = ((w.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const xform = (p: { x: number; y: number }) => {
      const lx = p.x * sx;
      const ly = p.y * sy;
      return { x: px + lx * cos - ly * sin, y: py + lx * sin + ly * cos };
    };
    let prev = xform(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const cur = xform(pts[i]);
      out.push({ x1: prev.x, y1: prev.y, x2: cur.x, y2: cur.y });
      prev = cur;
    }
  }
  return out;
}

/** Standard 2D segment-segment intersection test. Returns true iff
 *  segments AB and CD cross (proper intersection — touching endpoints
 *  count). */
function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1x = bx - ax, d1y = by - ay;
  const d2x = dx - cx, d2y = dy - cy;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
  const s = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
  return t >= 0 && t <= 1 && s >= 0 && s <= 1;
}

/** Test whether a straight-line move from (a) to (b) (in world coords)
 *  would cross any wall. */
export function lineCrossesWalls(
  a: Vec2, b: Vec2, walls: WallSegment[],
): boolean {
  for (const w of walls) {
    if (segmentsIntersect(a.x, a.y, b.x, b.y, w.x1, w.y1, w.x2, w.y2)) {
      return true;
    }
  }
  return false;
}

/** Convert world-space coords to integer cell coords given cell size. */
function cellOf(p: Vec2, cellSize: number): { cx: number; cy: number } {
  return {
    cx: Math.round(p.x / cellSize),
    cy: Math.round(p.y / cellSize),
  };
}

function cellCenter(cx: number, cy: number, cellSize: number): Vec2 {
  return { x: cx * cellSize, y: cy * cellSize };
}

/** Squared distance from point P to segment AB. */
function pointToSegmentDistance(px: number, py: number, w: WallSegment): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(px - w.x1, py - w.y1);
  let t = ((px - w.x1) * dx + (py - w.y1) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = w.x1 + t * dx;
  const qy = w.y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/** Build the set of cells whose centres lie within `clearance` of any
 *  wall segment, restricted to the supplied search bounds. */
function buildBlockedCells(
  walls: WallSegment[],
  clearance: number,
  cellSize: number,
  bounds: { minCx: number; maxCx: number; minCy: number; maxCy: number },
): Set<string> {
  const blocked = new Set<string>();
  if (clearance <= 0) return blocked;
  for (const w of walls) {
    const xMin = Math.min(w.x1, w.x2) - clearance;
    const xMax = Math.max(w.x1, w.x2) + clearance;
    const yMin = Math.min(w.y1, w.y2) - clearance;
    const yMax = Math.max(w.y1, w.y2) + clearance;
    const cxMin = Math.max(bounds.minCx, Math.floor(xMin / cellSize));
    const cxMax = Math.min(bounds.maxCx, Math.ceil(xMax / cellSize));
    const cyMin = Math.max(bounds.minCy, Math.floor(yMin / cellSize));
    const cyMax = Math.min(bounds.maxCy, Math.ceil(yMax / cellSize));
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        const k = `${cx},${cy}`;
        if (blocked.has(k)) continue;
        const px = cx * cellSize;
        const py = cy * cellSize;
        if (pointToSegmentDistance(px, py, w) < clearance) {
          blocked.add(k);
        }
      }
    }
  }
  return blocked;
}

/** A* on a regular grid with 8-directional moves. Returns the path
 *  (including start + goal) in world coords, or null if no path
 *  found within `maxIterations`.
 *
 *  `clearance` (in world units, same as `cellSize`) is the minimum
 *  distance between a path cell's centre and any wall. Cells closer
 *  than this are treated as blocked — keeps the follower from
 *  hugging walls and from getting visually "stuck" on a wall corner
 *  when its grid cell happens to coincide with the wall geometry.
 *  Pass 0 to disable.
 *
 *  Start and goal cells are always allowed even if close to walls
 *  (otherwise a follower that's already near a wall can't move at
 *  all). */
export function findPath(
  start: Vec2,
  goal: Vec2,
  walls: WallSegment[],
  cellSize: number,
  clearance: number = 0,
  maxIterations: number = 4000,
): Vec2[] | null {
  if (cellSize <= 0) return null;
  if (Math.hypot(goal.x - start.x, goal.y - start.y) < cellSize * 0.5) {
    // Already at the goal (within half a cell).
    return [start, goal];
  }
  // Direct line of sight? Common short-circuit.
  if (!lineCrossesWalls(start, goal, walls)) {
    return [start, goal];
  }

  const startCell = cellOf(start, cellSize);
  const goalCell = cellOf(goal, cellSize);
  const goalKey = `${goalCell.cx},${goalCell.cy}`;

  // Bounds for early-out: limit search to a bounding box around start
  // and goal extended by a margin. Keeps A* from wandering forever
  // when the goal is unreachable.
  const margin = 12; // cells
  const minCx = Math.min(startCell.cx, goalCell.cx) - margin;
  const maxCx = Math.max(startCell.cx, goalCell.cx) + margin;
  const minCy = Math.min(startCell.cy, goalCell.cy) - margin;
  const maxCy = Math.max(startCell.cy, goalCell.cy) + margin;
  const blocked = buildBlockedCells(
    walls, clearance, cellSize,
    { minCx, maxCx, minCy, maxCy },
  );
  const startKey = `${startCell.cx},${startCell.cy}`;

  interface Node {
    cx: number; cy: number;
    g: number; f: number;
    parent: Node | null;
  }
  const open = new Map<string, Node>();
  const closed = new Set<string>();
  const startNode: Node = {
    cx: startCell.cx, cy: startCell.cy,
    g: 0, f: 0, parent: null,
  };
  startNode.f = Math.hypot(goalCell.cx - startCell.cx, goalCell.cy - startCell.cy);
  open.set(`${startNode.cx},${startNode.cy}`, startNode);

  const NEIGHBOURS: Array<[number, number, number]> = [
    [+1, 0, 1], [-1, 0, 1], [0, +1, 1], [0, -1, 1],
    [+1, +1, Math.SQRT2], [+1, -1, Math.SQRT2],
    [-1, +1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  let iterations = 0;
  while (open.size > 0 && iterations++ < maxIterations) {
    // Pick lowest-f node from open. Linear scan — Map insertion order
    // is fine for small/medium grids; replace with a binary heap if
    // perf becomes a problem.
    let bestKey = "";
    let best: Node | null = null;
    for (const [k, n] of open) {
      if (best === null || n.f < best.f) {
        best = n; bestKey = k;
      }
    }
    if (!best) break;
    open.delete(bestKey);
    closed.add(bestKey);

    if (bestKey === goalKey) {
      // Reconstruct.
      const path: Vec2[] = [];
      let cur: Node | null = best;
      while (cur) {
        path.push(cellCenter(cur.cx, cur.cy, cellSize));
        cur = cur.parent;
      }
      path.reverse();
      // Replace start cell center with the actual start, and goal
      // cell center with the actual goal, so we don't snap the
      // follower visibly.
      if (path.length >= 1) path[0] = start;
      if (path.length >= 1) path[path.length - 1] = goal;
      return path;
    }

    const fromCenter = cellCenter(best.cx, best.cy, cellSize);
    for (const [dx, dy, costMul] of NEIGHBOURS) {
      const nx = best.cx + dx;
      const ny = best.cy + dy;
      if (nx < minCx || nx > maxCx || ny < minCy || ny > maxCy) continue;
      const k = `${nx},${ny}`;
      if (closed.has(k)) continue;
      // Clearance gate — but always allow the start/goal cells so a
      // follower already near a wall can still depart / arrive.
      if (blocked.has(k) && k !== startKey && k !== goalKey) continue;
      const toCenter = cellCenter(nx, ny, cellSize);
      // Block if move from current cell center to neighbour center
      // crosses a wall.
      if (lineCrossesWalls(fromCenter, toCenter, walls)) continue;
      const tentativeG = best.g + costMul;
      const exists = open.get(k);
      if (exists && tentativeG >= exists.g) continue;
      const h = Math.hypot(goalCell.cx - nx, goalCell.cy - ny);
      const node: Node = {
        cx: nx, cy: ny,
        g: tentativeG,
        f: tentativeG + h,
        parent: best,
      };
      open.set(k, node);
    }
  }
  return null;
}
