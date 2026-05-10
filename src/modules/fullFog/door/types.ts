// fullFog/door — door + window openings on existing fog walls.
//
// Stored as an array on each outline Path's metadata so the wall
// watcher (in any client) can subtract them when deriving Wall
// items, AND a per-client overlay can render coloured indicators
// for the GM. Doors toggle open/closed (open = vision passes,
// closed = wall stays); windows are always see-through.

import { PLUGIN_ID } from "../types";

/** Metadata key on the outline Path whose value is an Opening[]. */
export const OPENINGS_KEY = `${PLUGIN_ID}/openings`;

/** Metadata key on local-scene overlay items (lines + click handles)
 *  so the watcher can find/replace them surgically. Value is the
 *  parent Path id. */
export const OVERLAY_KEY = `${PLUGIN_ID}/openingOverlay`;

/** Metadata key on local-scene overlay items recording which
 *  opening (id) inside the parent Path's openings[] this overlay
 *  represents. Used by the click handler to look up + toggle. */
export const OVERLAY_OPENING_ID_KEY = `${PLUGIN_ID}/openingId`;

/** Metadata key on the local handle Shape. Value is the parent
 *  outline Path id. Click filter uses this to bring up the toggle
 *  / delete logic in the door mode handler. */
export const OVERLAY_PARENT_KEY = `${PLUGIN_ID}/openingParent`;

/** Tool-mode IDs registered under OBR's native fog tool. */
export const DOOR_MODE_ID = `${PLUGIN_ID}/door-mode`;
export const WINDOW_MODE_ID = `${PLUGIN_ID}/window-mode`;

export type OpeningKind = "door" | "window";

export interface Opening {
  /** Stable identifier within the parent path's openings array. */
  id: string;
  kind: OpeningKind;
  /** Door: true = open (vision passes), false = closed (vision blocked).
   *  Window: ignored (windows are always see-through). */
  open: boolean;
  /** Index into the polyline list returned by samplePathCommands of
   *  the parent Path's `commands`. Both endpoints must lie on the
   *  same polyline. */
  polyIndex: number;
  /** Normalised arc-length parameter of the start point on the
   *  polyline. 0 = polyline start, 1 = polyline end. t1 < t2. */
  t1: number;
  /** Normalised arc-length parameter of the end point. */
  t2: number;
}

/** Pixel distance threshold (in MAP-LOCAL units) for snapping a
 *  pointer to a polyline edge. Beyond this we don't accept the
 *  start of an opening drag. Same value the official dynamic-fog
 *  uses (75 world units) — works at typical OBR DPIs. */
export const SNAP_THRESHOLD = 75;

/** Visual colours — match the official dynamic-fog palette. */
export const COLOR_DOOR_CLOSED = "#ff4d4d";
export const COLOR_DOOR_OPEN = "#85ff66";
export const COLOR_WINDOW = "#5dade2";
/** Hover snap-point dot colour — same orange as official. */
export const COLOR_HOVER_DOT = "#ff7433";

/** Billboard icon metadata — image used by buildBillboard to render
 *  the clickable open/close door icon at each opening's centre. */
export interface DoorBillboardImage {
  url: string;
  width: number;
  height: number;
  mime: string;
}
