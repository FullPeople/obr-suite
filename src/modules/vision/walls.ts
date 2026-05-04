// Wall sourcing — collect every blocking line segment in the scene.
//
// Sources, in order of priority:
//   1. OBR's native fog items (Curve / Path items on the FOG layer).
//      The DM draws these via OBR's fog tool. Closed → ring of
//      segments. Open path → adjacent segments only.
//   2. Items metadata-tagged with `COLLISION_WALL_KEY`. These are
//      created by our collision-map editor (the modal that lets the
//      DM trace walls onto a map). Locked + non-selectable items
//      attached to the map; tagged so we don't need to walk every
//      item's metadata each redraw.

import OBR, { Item, isCurve } from "@owlbear-rodeo/sdk";
import { COLLISION_WALL_KEY, WallSegment } from "./types";

// Apply a token's transform (position / rotation / scale) to its
// local-space point. Walls live as Curves with item-local point lists
// + a position/rotation/scale on the item; raycasting needs world
// coordinates.
function transformPoint(
  px: number, py: number,
  pos: { x: number; y: number },
  rot: number, // degrees
  scale: { x: number; y: number },
): { x: number; y: number } {
  const sx = px * scale.x;
  const sy = py * scale.y;
  const r = (rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    x: pos.x + sx * cos - sy * sin,
    y: pos.y + sx * sin + sy * cos,
  };
}

// Convert a Curve to wall segments. Honors `style.closed`: closed
// curves get the (n-1, 0) closing edge; open curves don't.
function curveToSegments(c: any): WallSegment[] {
  const pts = c.points as { x: number; y: number }[] | undefined;
  if (!Array.isArray(pts) || pts.length < 2) return [];
  const closed = !!c.style?.closed;
  const out: WallSegment[] = [];
  const xform = (p: { x: number; y: number }) =>
    transformPoint(p.x, p.y, c.position, c.rotation ?? 0, c.scale ?? { x: 1, y: 1 });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = xform(pts[i]);
    const b = xform(pts[i + 1]);
    out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  if (closed) {
    const a = xform(pts[pts.length - 1]);
    const b = xform(pts[0]);
    out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  return out;
}

// Some items (Path / Effect) carry a `commands` array (SVG-path-style)
// instead of a flat `points` list. We unify by best-effort: for the
// known commands { M, L, Z } we approximate as line segments.
function pathToSegments(p: any): WallSegment[] {
  const cmds = (p as any).commands as any[] | undefined;
  if (!Array.isArray(cmds)) return [];
  const out: WallSegment[] = [];
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;
  const xform = (x: number, y: number) =>
    transformPoint(x, y, p.position, p.rotation ?? 0, p.scale ?? { x: 1, y: 1 });
  for (const cmd of cmds) {
    if (!Array.isArray(cmd)) continue;
    const op = cmd[0];
    if (op === "M") {
      cx = cmd[1]; cy = cmd[2];
      startX = cx; startY = cy;
    } else if (op === "L") {
      const a = xform(cx, cy);
      const b = xform(cmd[1], cmd[2]);
      out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      cx = cmd[1]; cy = cmd[2];
    } else if (op === "Z") {
      const a = xform(cx, cy);
      const b = xform(startX, startY);
      out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      cx = startX; cy = startY;
    }
    // Q / C / A — bezier / arc commands are converted to a single
    // line for now (corner-cutting visible but rare in fog walls).
    else if (cmd.length >= 3) {
      const ex = cmd[cmd.length - 2];
      const ey = cmd[cmd.length - 1];
      if (typeof ex === "number" && typeof ey === "number") {
        const a = xform(cx, cy);
        const b = xform(ex, ey);
        out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
        cx = ex; cy = ey;
      }
    }
  }
  return out;
}

export function itemToWalls(item: Item): WallSegment[] {
  // Curve items are most common.
  if (isCurve(item)) return curveToSegments(item);
  // Path items (SVG-style commands).
  if ((item as any).type === "PATH") return pathToSegments(item);
  return [];
}

export interface WallCollectionStats {
  fogWalls: number;
  collisionWalls: number;
  totalSegments: number;
}

// Pull every wall segment in the current scene. Async because we
// have to fetch items + filter by layer + metadata.
export async function collectWalls(): Promise<{
  walls: WallSegment[];
  stats: WallCollectionStats;
}> {
  let items: Item[];
  try {
    items = await OBR.scene.items.getItems();
  } catch {
    return { walls: [], stats: { fogWalls: 0, collisionWalls: 0, totalSegments: 0 } };
  }
  const walls: WallSegment[] = [];
  let fogWalls = 0;
  let collisionWalls = 0;
  for (const it of items) {
    const isFogLayer = it.layer === "FOG";
    const isOurWall = !!(it.metadata as any)?.[COLLISION_WALL_KEY];
    if (!isFogLayer && !isOurWall) continue;
    const segs = itemToWalls(it);
    if (segs.length === 0) continue;
    walls.push(...segs);
    if (isFogLayer) fogWalls++;
    if (isOurWall) collisionWalls++;
  }
  return {
    walls,
    stats: { fogWalls, collisionWalls, totalSegments: walls.length },
  };
}
