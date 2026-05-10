// Image-pixel polygons → single OBR Path item (multi-subpath).
//
// Why one item: each polygon would otherwise be its own Curve, blowing
// up the drawcall count for a complex map. Path supports
// MOVE/LINE/CLOSE commands across multiple subpaths in a single item;
// with `evenodd` fillRule, alternating subpaths automatically punch
// holes.
//
// Coordinate transform: image pixels → world coordinates using the
// map item's grid offset, dpi ratio, scale, rotation, position. We
// store the polygon's WORLD points directly with attachedTo = mapId
// so OBR's attachment inheritance keeps walls glued to the map for
// any future translate / scale / rotate.

import { buildPath, Command, type PathCommand } from "@owlbear-rodeo/sdk";
import type { Vec2 } from "../types";
import { FOG_PATH_KEY, FOG_MAP_KEY, FOG_WALL_EXPAND_KEY, PLUGIN_ID } from "../types";
import { smoothToPathCommands } from "./smooth";

/** Metadata sub-key tagging the role of a fog Path item. Currently
 *  only "outline" is emitted — legacy scenes may still carry
 *  "darkFog-outer" / "darkFog-inner" Paths from the now-removed
 *  edge-feather feature; the wall watcher skips anything that's
 *  not "outline" so those legacy items keep rendering visually
 *  but don't double-derive walls. */
export const FOG_PATH_KIND_KEY = `${PLUGIN_ID}/wallKind`;
export type FogPathKind = "outline";

/** Convert image-pixel polygon to world coords given the map's transform. */
export function imagePxToWorld(
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

/** Build a single OBR Path item from N MAP-LOCAL polygons.
 *
 *  Coords convention matches the Wall convention used by
 *  buildFogWalls: polygon points are in map-local space (i.e.
 *  `(imagePx - gridOffset) × (sceneDpi / imageDpi)` with no
 *  scale/rotation/position baked in), and the path's transform
 *  fields mirror the parent map's. With `attachedTo(mapId)`, OBR
 *  applies the map's transform exactly once at render time.
 *
 *  Why this matters: it keeps Path coords identical to Wall coords,
 *  so the wall-watcher in setupFullFog can sample the Path's
 *  `commands` field directly (a top-level item field, separately
 *  size-limited from `metadata`) to recreate Walls — no need to
 *  embed a redundant `FOG_WALL_POLYLINES` blob in metadata that
 *  hits OBR's per-item array length limit on busy maps.
 *
 *  When `tension > 0`, each polygon is smoothed to cubic Bezier
 *  curves via Cardinal-spline math; otherwise straight LINE commands
 *  preserve the input shape exactly. */
export function buildFogPath(
  localPolys: Vec2[][],
  mapItem: any,
  options: {
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    /** Cardinal-spline tension (0 = polyline, 0.5 = smooth curves). */
    tension?: number;
    /** Marker for the wall-watcher / light renderer. Currently
     *  only "outline" exists. Kept as an explicit option so the
     *  metadata layout matches legacy items and future kinds can
     *  be reintroduced without a migration. */
    kind?: FogPathKind;
    /** Override OBR layer. Default "FOG". */
    layer?: any;
    /** Explicit zIndex. Without this OBR auto-assigns by add order,
     *  which sometimes lets older items render on top of newer ones
     *  (e.g. OBR's own fog mask covering our dark fog). */
    zIndex?: number;
    /** Wall-expand distance (image pixels). Persisted on the outline
     *  Path's metadata so the wall watcher (in any client) can erode
     *  the sampled polylines inward before deriving Walls. Only the
     *  outline kind ever needs this; passing it on darkFog kinds is
     *  harmless because those Paths are skipped by the watcher. */
    wallExpandPx?: number;
  } = {},
): any | null {
  if (localPolys.length === 0) return null;
  const tension = options.tension ?? 0;

  const commands: PathCommand[] = [];
  for (const poly of localPolys) {
    if (poly.length < 3) continue;
    if (tension > 0) {
      const sub = smoothToPathCommands(poly, tension, /*closed*/ true);
      for (const c of sub) commands.push(c);
    } else {
      commands.push([Command.MOVE, poly[0].x, poly[0].y]);
      for (let i = 1; i < poly.length; i++) {
        commands.push([Command.LINE, poly[i].x, poly[i].y]);
      }
      commands.push([Command.CLOSE]);
    }
  }
  if (commands.length === 0) return null;

  const fill = options.fillColor ?? "#ff8a3d";
  const fillA = options.fillOpacity ?? 0.0;
  const stroke = options.strokeColor ?? "#ff8a3d";
  const strokeA = options.strokeOpacity ?? 0.85;
  const strokeW = options.strokeWidth ?? 4;

  const mapId = mapItem.id;
  const pos = mapItem.position ?? { x: 0, y: 0 };
  const rot = mapItem.rotation ?? 0;
  const scl = mapItem.scale ?? { x: 1, y: 1 };

  const kind: FogPathKind = options.kind ?? "outline";
  const layer = options.layer ?? "FOG";
  const zIndex = options.zIndex;

  let b = buildPath()
    .commands(commands)
    .fillRule("evenodd")
    .strokeColor(stroke)
    .strokeOpacity(strokeA)
    .strokeWidth(strokeW)
    .fillColor(fill)
    .fillOpacity(fillA)
    .layer(layer)
    .position(pos)
    .scale(scl)
    .rotation(rot)
    .visible(true)
    .locked(true)
    .disableHit(true)
    .attachedTo(mapId)
    .disableAttachmentBehavior(["VISIBLE", "COPY"])
    .metadata({
      [FOG_PATH_KEY]: true,
      [FOG_PATH_KIND_KEY]: kind,
      [FOG_MAP_KEY]: { mapId, savedAt: Date.now(), kind },
      [FOG_WALL_EXPAND_KEY]: Math.max(0, Math.round(options.wallExpandPx ?? 0)),
    });
  if (typeof zIndex === "number") {
    b = b.zIndex(zIndex).disableAutoZIndex(true);
  }
  return b.build();
}

void PLUGIN_ID;
