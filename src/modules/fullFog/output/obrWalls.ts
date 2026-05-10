// Output to OBR's native Wall items.
//
// Walls are line segments the OBR engine raycasts against for its
// dynamic fog system. Each Wall item carries one polyline (multi-
// segment chain). For our use, each contour produces ONE Wall item
// (so the polygon's edges form the wall).
//
// Walls don't render visually by default — the renderer uses them
// purely for vision computation. To give the GM a visual confirmation
// of saved walls, callers can ALSO save a low-opacity Path item via
// the existing buildFogPath path.

import { buildWall, type Vector2 } from "@owlbear-rodeo/sdk";
import type { Vec2 } from "../types";
import { FOG_PATH_KEY, FOG_MAP_KEY } from "../types";

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

/** Legacy helper kept for the Path output, which is NOT attached
 *  via the parent-transform pattern: it sits at world (0,0) with
 *  attachedTo, so its `points` are in WORLD coords directly. */
export function imagePxToWorldPts(
  pts: Vec2[],
  mapItem: any,
  sceneDpi: number,
): Vec2[] {
  const ratio = sceneDpi / (mapItem.grid?.dpi || sceneDpi);
  const offX = mapItem.grid?.offset?.x ?? 0;
  const offY = mapItem.grid?.offset?.y ?? 0;
  const sx = mapItem.scale?.x ?? 1;
  const sy = mapItem.scale?.y ?? 1;
  const r = ((mapItem.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const px = mapItem.position.x;
  const py = mapItem.position.y;
  return pts.map((p) => {
    const lx = (p.x - offX) * ratio * sx;
    const ly = (p.y - offY) * ratio * sy;
    return {
      x: px + lx * cos - ly * sin,
      y: py + lx * sin + ly * cos,
    };
  });
}

/** Build N Wall items from N polylines (one wall per polyline).
 *
 *  IMPORTANT: when `attachedTo` is set on an item, OBR treats the
 *  item's `position/rotation/scale` as relative to the parent. So
 *  with the map at world (X, Y) and our wall at position (0, 0), the
 *  wall's effective world transform is `mapTransform * identity` →
 *  the wall's `points` are interpreted in the MAP's LOCAL space. The
 *  caller is responsible for converting image pixels to map-local
 *  coords (which are scene-units / sceneDpi-per-cell), NOT world
 *  coords — passing world coords here would double-transform.
 *
 *  For our use the math collapses: we pass image-pixel coords,
 *  scaled by `sceneDpi / image.grid.dpi`, with NO position/rotation
 *  baked in — see `imagePxToMapLocal` below. The wall then
 *  inherits the map's transform and follows it for free.
 *
 *  We deliberately omit `disableHit` and `locked` because past
 *  experiments showed OBR rejecting Wall items with those flags
 *  (the API throws an opaque error). dynamic-fog's WallActor also
 *  doesn't set them. */
export function buildFogWalls(
  localPolys: Vec2[][],
  mapItem: any,
): any[] {
  const out: any[] = [];
  const mapId = mapItem.id;
  const pos = mapItem.position ?? { x: 0, y: 0 };
  const rot = mapItem.rotation ?? 0;
  const scl = mapItem.scale ?? { x: 1, y: 1 };
  for (const poly of localPolys) {
    if (poly.length < 2) continue;
    const points: Vector2[] = poly.map((p) => ({ x: p.x, y: p.y }));
    try {
      const w = buildWall()
        .points(points)
        .doubleSided(true)
        .blocking(true)
        .attachedTo(mapId)
        .position(pos)
        .rotation(rot)
        .scale(scl)
        .disableAttachmentBehavior(["VISIBLE", "COPY"])
        .metadata({
          [FOG_PATH_KEY]: true,
          [FOG_MAP_KEY]: { mapId, savedAt: Date.now(), kind: "wall" },
        })
        .build();
      out.push(w);
    } catch (e) {
      console.error("[fullFog] buildWall failed for polyline of", points.length, "pts:", e);
    }
  }
  return out;
}
