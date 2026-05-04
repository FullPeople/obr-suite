// Vision module — public types.

export const PLUGIN_ID = "com.obr-suite/vision";

// Metadata key written on Image items that emit light. Absence = no
// light. Setting it to undefined removes the light.
export const LIGHT_KEY = `${PLUGIN_ID}/light`;

// Metadata key on Curve items we treat as walls. Combined with OBR's
// own FOG-layer items, these together form the wall set passed to
// the raycaster.
export const COLLISION_WALL_KEY = `${PLUGIN_ID}/wall`;

// Metadata namespace for the collision-map editor: the map item the
// generated walls are attached to + a session id linking them so we
// can clear / replace cleanly.
export const COLLISION_MAP_KEY = `${PLUGIN_ID}/collision-map`;

// Module enable flag in suite state.enabled.vision.

// Per-DM-client preferences (localStorage):
//   `<PLUGIN>/shared`         — boolean. Default true. When true,
//                               every player sees the union of all
//                               player-token lights. When false,
//                               each player sees ONLY the lights
//                               attached to tokens THEY own.
export const LS_VISION_SHARED = `${PLUGIN_ID}/shared`;

// Default radii are in scene-units (= image grid units = "feet"
// in D&D 5e). We store the inner colored radius and the outer
// monochrome (darkvision) radius separately. The B&W radius
// extends FROM the color radius outward — i.e., total reach =
// color + dark.
export interface LightSource {
  /** Inner color-vision radius (full-color reveal). Scene units. */
  colorRadius: number;
  /** OPTIONAL extra darkvision ring beyond the color radius. The
   *  light reveals the area but with reduced fidelity (rendered with
   *  a slight desaturation tint overlay). 0 / undefined → no ring. */
  darkRadius?: number;
  /** Hex color — visual tint of the inner ring (additive overlay).
   *  Doesn't change WHAT'S visible, just how it looks. */
  color: string;
  /** Falloff distance in scene units. The reveal alpha eases toward
   *  zero in the last `falloff` units before the radius cap, so a
   *  light cone doesn't end with a razor edge. Default 8. */
  falloff?: number;
  /** Number of rays cast for the visibility polygon. More rays =
   *  smoother edges but more compute. Range 90-720; default 240. */
  rays?: number;
}

export interface SuiteVisionState {
  shared: boolean;
}

// In-memory wall: { a, b } scene-coord segment.
export interface WallSegment {
  ax: number; ay: number;
  bx: number; by: number;
}

// 2D vector helper (avoids importing OBR.Vector2 everywhere).
export interface Vec2 { x: number; y: number; }
