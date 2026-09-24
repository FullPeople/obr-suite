// Nearest fog-wall lookup for the door / window tool.
//
// Upstream relies on `ToolEvent.target` — you must be hovering the fog
// shape itself. That breaks for the suite's traced outline Path, which
// is `disableHit` (so it can't steal clicks from the map) and has no
// fill to hover. So we search EVERY fog drawing's cached contours
// instead: hover anywhere near a wall and it snaps. This is the fix for
// "墙壁上不能画线来实现门窗".
//
// Cost is bounded by the per-contour bounding boxes cached on
// OpeningActor: a traced map with tens of thousands of vertices rejects
// almost all of them with two comparisons.

import type { Item, Vector2 } from "@owlbear-rodeo/sdk";
import type { Reconciler } from "../reconcile/Reconciler";
import { OpeningReactor } from "../reconcile/reactors/OpeningReactor";
import { snapToPolyline } from "../geom/polyline";
import {
  inverseTransformPoint,
  itemMatrix,
  matrixScaleFactor,
  transformPoint,
} from "../geom/xform";
import { SNAP_DISTANCE } from "../ids";

export interface WallSnap {
  parent: Item;
  parentId: string;
  polyIndex: number;
  /** Normalised arc-length on that contour. */
  t: number;
  /** Snap point in WORLD space. */
  world: Vector2;
  /** Distance from the pointer, in WORLD units. */
  distance: number;
}

/** Nearest point on any fog wall, or null if nothing is within
 *  `maxDistance` world units. */
export function findWallSnap(
  reconciler: Reconciler,
  pointerWorld: Vector2,
  maxDistance = SNAP_DISTANCE,
  restrictToParentId?: string,
): WallSnap | null {
  const reactor = reconciler.find(OpeningReactor);
  if (!reactor) return null;

  let best: WallSnap | null = null;

  for (const actor of reactor.getAllActors()) {
    if (restrictToParentId && actor.parentId !== restrictToParentId) continue;
    const parent = reconciler.getItem(actor.parentId);
    if (!parent) continue;
    if (actor.polylines.length === 0) continue;

    const matrix = itemMatrix(parent);
    const scale = matrixScaleFactor(matrix) || 1;
    const localPointer = inverseTransformPoint(matrix, pointerWorld);
    // Compare in local units; convert the world budget once.
    const localMax = maxDistance / scale;

    for (let pi = 0; pi < actor.polylines.length; pi++) {
      const box = actor.polyBoxes[pi];
      if (
        box &&
        (localPointer.x < box.minX - localMax ||
          localPointer.x > box.maxX + localMax ||
          localPointer.y < box.minY - localMax ||
          localPointer.y > box.maxY + localMax)
      ) {
        continue;
      }
      const hit = snapToPolyline(localPointer, actor.polylines[pi]);
      if (!hit) continue;
      const worldDistance = hit.distance * scale;
      if (worldDistance > maxDistance) continue;
      if (best && worldDistance >= best.distance) continue;
      best = {
        parent,
        parentId: actor.parentId,
        polyIndex: pi,
        t: hit.t,
        world: transformPoint(matrix, hit.point),
        distance: worldDistance,
      };
    }
  }

  return best;
}
