// Light source — Add Light / Light Settings context menu, mirrors
// the upstream Owlbear Rodeo "Dynamic Fog" plugin's data shape so
// the field names + units stay familiar to TRPG users coming from
// the official extension. Suite-owned namespace though (we don't
// share metadata with the upstream plugin), so a plugin-id swap
// is all that's needed to interop later if desired.
//
// Lights are independent of the existing 添加视野 (vision) menu:
// vision describes what a TOKEN can SEE; light describes what a
// TOKEN EMITS. The suite's fog renderer treats lights as additional
// vision sources with penetration = 0 (lights need a clear path —
// they don't pierce walls), so adding a light to a torch sprite
// reveals fog around it without giving the carrier x-ray vision.

import { PLUGIN_ID } from "../types";

/** Token metadata key. Presence = this token emits light. */
export const LIGHT_KEY = `${PLUGIN_ID}/light`;

/** Popover id for the light settings UI. */
export const LIGHT_EDIT_POPOVER = `${PLUGIN_ID}/light-edit`;

/** Context menu ids. */
export const CTX_LIGHT_ADD = `${PLUGIN_ID}/ctx-light-add`;
export const CTX_LIGHT_EDIT = `${PLUGIN_ID}/ctx-light-edit`;
export const CTX_LIGHT_REMOVE = `${PLUGIN_ID}/ctx-light-remove`;

/** Light configuration. Field names mirror upstream dynamic-fog's
 *  LightConfig so future interop is a metadata-key swap away. */
export interface LightConfig {
  /** Outer radius where the light fades to zero. World pixels (=
   *  dpi-scaled). Stored in pixels (NOT scene feet) to match the
   *  upstream extension exactly. */
  attenuationRadius: number;
  /** Soft "core" radius; below this the light is at full strength.
   *  Smaller default than upstream (25 vs 50) so a hand-held torch
   *  fits through a 5ft door cleanly. */
  sourceRadius: number;
  /** Falloff curve exponent. Smaller = harder edge. Default 0.2
   *  (upstream Add Light default). 1.0 = upstream Soft preset. */
  falloff: number;
}

/** Defaults applied when "Add Light" creates the metadata blob.
 *  The radius is set in setupLight() based on grid dpi (we want
 *  6 cells = 30 ft on a 5 ft grid). */
export const DEFAULT_LIGHT_FALLOFF = 0.2;
export const DEFAULT_LIGHT_SOURCE_RADIUS = 25;
export const DEFAULT_LIGHT_RADIUS_CELLS = 6;
