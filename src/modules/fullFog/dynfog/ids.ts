// dynfog — namespaced ids for everything the dynamic-fog port owns.
//
// All ids derive from `com.obr-suite/fullFog`, which vite's
// devNamespaceIsolation plugin rewrites to `com.obr-suite-dev/fullFog`
// for the dev channel — so a dev install and a stable install never
// fight over the same scene metadata.
//
// Upstream (owlbear-rodeo/dynamic-fog) uses `rodeo.owlbear.dynamic-fog/…`.
// We deliberately DON'T reuse that namespace: if a table has both the
// official extension and this suite installed, sharing keys would make
// both plugins derive walls from the same fog shapes and double every
// wall / light in the scene. `opening/read.ts` still *reads* the
// upstream door shape for import compatibility.

import { PLUGIN_ID } from "../types";

/** Reverse-domain id for a dynfog path. */
export function dynfogId(path: string): string {
  return `${PLUGIN_ID}/${path}`;
}

// --- item metadata keys -----------------------------------------------------

/** On a FOG-layer Drawing: `Opening[]` (doors + windows). */
export const OPENINGS_KEY = dynfogId("openings");

/** On any item: `LightConfig`. Presence = this item emits light. */
export const LIGHT_KEY = dynfogId("light");

/** On a local overlay item: the id of the opening it represents. */
export const OVERLAY_OPENING_KEY = dynfogId("opening-id");

/** On a local overlay item: marks it as a light overlay billboard. */
export const LIGHT_OVERLAY_KEY = dynfogId("light-overlay");

/** On a FOG-layer Drawing produced by the fullFog image tracer: tells
 *  the wall engine to honour `FOG_WALL_EXPAND_KEY`. Reused from the
 *  existing editor output — see `../types.ts`. */
export {
  FOG_PATH_KEY,
  FOG_WALL_EXPAND_KEY,
  FOG_WALL_EXPAND_LOCAL_KEY,
} from "../types";

// --- tool ids ---------------------------------------------------------------

/** Owlbear's built-in fog tool — our GM modes hang off it. */
export const OBR_FOG_TOOL = "rodeo.owlbear.tool/fog";

export const LINE_MODE_ID = dynfogId("line-mode");
export const DOOR_MODE_ID = dynfogId("door-mode");
export const WINDOW_MODE_ID = dynfogId("window-mode");
export const SECRET_MODE_ID = dynfogId("secret-mode");

/** Standalone player-facing toolbar tool + its single mode. */
export const TOGGLE_TOOL_ID = dynfogId("toggle-tool");
export const TOGGLE_MODE_ID = dynfogId("toggle-mode");

// --- context menu ids -------------------------------------------------------

export const CTX_LIGHT_ADD = dynfogId("light-menu/add");
export const CTX_LIGHT_SETTINGS = dynfogId("light-menu/settings");

// --- broadcast channels -----------------------------------------------------

/** Player → GM: "set this opening to `open`". Payload `ToggleRequest`. */
export const BC_TOGGLE_OPENING = dynfogId("toggle-opening");

export interface ToggleRequest {
  /** Id of the FOG-layer Drawing that owns the opening. */
  itemId: string;
  /** `Opening.id`. */
  openingId: string;
  /**
   * The state the player wants, NOT "flip it". A room can have more
   * than one GM, and every GM client receives the broadcast — a flip
   * would be applied twice and cancel itself out. An absolute target
   * is idempotent.
   */
  open: boolean;
}

// --- palette (matches upstream dynamic-fog) ---------------------------------

// Colour encodes the OPEN state, not the vision state: green = a
// creature can pass. Windows are see-through either way, so their shut
// colour is glass-cyan rather than a "blocked" red.
export const COLOR_DOOR_CLOSED = "#ff4d4d";
export const COLOR_DOOR_OPEN = "#85ff66";
/** Window shut — glazed. Still see-through; cyan reads as "glass". */
export const COLOR_WINDOW_CLOSED = "#5dade2";
/** Window swung open — see-through AND passable. */
export const COLOR_WINDOW_OPEN = "#66ffd9";
/** Secret door, undiscovered. Purple + a dashed stroke, so the GM can
 *  never mistake one for a door the party can actually see. */
export const COLOR_SECRET_CLOSED = "#b06bff";
/** Secret door, swung open. */
export const COLOR_SECRET_OPEN = "#d8a6ff";
/** Dash pattern applied to secret-door indicators only. */
export const SECRET_DASH: number[] = [14, 10];
/** Snap indicator / in-progress drag — upstream's orange. */
export const COLOR_CONTROL = "#ff7433";

/** Pointer distance (world units) inside which the door tool will snap
 *  to a wall edge. Upstream uses 75. */
export const SNAP_DISTANCE = 75;
