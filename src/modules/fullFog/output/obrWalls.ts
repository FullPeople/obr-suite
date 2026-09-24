// Image-pixel → map-local coordinate conversion for the fog editor.
//
// The file used to also build native `Wall` items, but wall derivation
// moved to `dynfog/` (see reconcile/actors/WallActor.ts), which derives
// walls per client from the FOG-layer drawings rather than baking them
// at save time. `buildFogWalls` and `imagePxToWorldPts` went with it —
// both had been unreachable since that change.
//
// What is left is the one transform the editor still needs when it
// writes its traced outline.

import type { Vec2 } from "../types";

/** Convert image-pixel polyline to MAP-LOCAL scene coords (pre-
 *  position/rotation/scale). Use this for items that will set
 *  `attachedTo(mapId)` along with the map's own transform, so OBR
 *  applies the map's transform exactly once — no double-transform.
 *
 *  Map-local = (imagePx - imageGridOffset) * (sceneDpi / imageGridDpi).
 *  No scale/rotation here — they live on the wall's own transform
 *  fields (which match the map's). */
export function imagePxToMapLocal(
  pts: Vec2[],
  mapItem: any,
  sceneDpi: number,
): Vec2[] {
  const ratio = sceneDpi / (mapItem.grid?.dpi || sceneDpi);
  const offX = mapItem.grid?.offset?.x ?? 0;
  const offY = mapItem.grid?.offset?.y ?? 0;
  return pts.map((p) => ({
    x: (p.x - offX) * ratio,
    y: (p.y - offY) * ratio,
  }));
}
