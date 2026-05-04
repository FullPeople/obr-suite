// Per-client fog/light rendering.
//
// We maintain ONE local Curve item that is the "fog of war" mask:
//   - A big outer rectangle (CCW) covering the visible area.
//   - One CW "hole" per visible polygon (per-light visibility).
//   - With non-zero winding fill, holes punch cleanly through the
//     outer rect.
//
// The mask sits on the FOG layer with high zIndex so it renders on
// top of every other scene layer except OBR's own UI overlay.
//
// Plus a small light "tint" overlay per light source so the user sees
// the colored radius (low-opacity Curve filled with the light's
// color, on the FOG layer just below the fog mask). Optional darkvision
// outer ring is rendered as a separate desaturated curve.

import OBR, { buildCurve } from "@owlbear-rodeo/sdk";
import { donutPolygon, expandedSceneRect, ensureCCW } from "./geom";
import { LightSource, PLUGIN_ID, Vec2 } from "./types";

// Local-scene metadata role tags so we can find/replace our items.
const ROLE_KEY = `${PLUGIN_ID}/role`;
type Role = "fog-mask" | "light-tint" | "dark-tint";

const META_FOG_MASK = { [ROLE_KEY]: "fog-mask" };
const META_LIGHT_TINT = { [ROLE_KEY]: "light-tint" };
const META_DARK_TINT = { [ROLE_KEY]: "dark-tint" };

// Default look — easy to tweak later.
const FOG_FILL = "#0b0e16";   // near-black
const FOG_OPACITY = 0.92;
const FOG_Z = 1_000_000;       // above scene contents

// Light tint = soft glow inside the color radius.
const LIGHT_TINT_OPACITY = 0.18;
const LIGHT_TINT_Z = 999_990;

// Darkvision tint = subtle desaturating overlay (cool grey-blue).
const DARK_TINT_FILL = "#1c2030";
const DARK_TINT_OPACITY = 0.22;
const DARK_TINT_Z = 999_989;

export interface LightInstance {
  /** Light source spec from the token's metadata. */
  light: LightSource;
  /** World position of the light origin (token center, scene units). */
  origin: Vec2;
  /** Computed visibility polygon at the COLOR radius. */
  colorPoly: Vec2[];
  /** Optional outer polygon at the (color + dark) radius. */
  darkPoly?: Vec2[];
}

// Atomic replace: delete every existing local item we own, then add
// the new ones in one update. Slight flicker possible on slow
// clients; OBR's local addItems is typically <16ms so it stays
// imperceptible.
export async function renderFog(lights: LightInstance[]): Promise<void> {
  // 1. Clear old items.
  try {
    const existing = await OBR.scene.local.getItems((it: any) => {
      const r = (it.metadata?.[ROLE_KEY]) as string | undefined;
      return r === "fog-mask" || r === "light-tint" || r === "dark-tint";
    });
    if (existing.length > 0) {
      await OBR.scene.local.deleteItems(existing.map((i) => i.id));
    }
  } catch (e) {
    console.warn("[vision] clear existing fog items failed", e);
  }

  // 2. Build new items.
  const adds: any[] = [];

  // Combine the unioned visible region as fog holes. We draw EACH
  // light's polygon as its own hole so partial overlaps work without
  // explicit polygon union. The donut helper handles N holes via a
  // shared bridge anchor.
  // — colorPoly is what reveals the map fully; darkPoly is the
  //   broader reveal for darkvision. We treat darkPoly (when set)
  //   as the outer reveal hole and overlay a desaturated tint on
  //   top to convey "you see it but in greyscale".
  const holes: Vec2[][] = [];
  for (const inst of lights) {
    const reveal = inst.darkPoly && inst.darkPoly.length >= 3
      ? inst.darkPoly
      : inst.colorPoly;
    if (reveal.length >= 3) holes.push(ensureCCW(reveal));
  }

  // Outer rect: big enough to cover all visible polygons + a margin.
  const allPts: Vec2[] = [];
  for (const h of holes) for (const p of h) allPts.push(p);
  const outerRect = expandedSceneRect(holes, lights.map((l) => l.origin), 4000);
  const outerCCW = ensureCCW(outerRect);

  // Build the fog mask donut. When there are NO lights, still draw
  // the full outer rect (everything dark). Otherwise punch holes.
  const mask = donutPolygon(outerCCW, holes);
  if (mask.length >= 3) {
    const fogItem = buildCurve()
      .points(mask)
      .strokeColor(FOG_FILL)
      .strokeOpacity(0)
      .strokeWidth(0)
      .fillColor(FOG_FILL)
      .fillOpacity(FOG_OPACITY)
      .layer("FOG")
      .closed(true)
      .locked(true)
      .disableHit(true)
      .visible(true)
      .zIndex(FOG_Z)
      .metadata(META_FOG_MASK)
      .build();
    adds.push(fogItem);
  }

  // 3. Per-light color tint (inside colorPoly).
  for (const inst of lights) {
    if (inst.colorPoly.length < 3) continue;
    const tintItem = buildCurve()
      .points(ensureCCW(inst.colorPoly))
      .strokeColor(inst.light.color)
      .strokeOpacity(0)
      .strokeWidth(0)
      .fillColor(inst.light.color)
      .fillOpacity(LIGHT_TINT_OPACITY)
      .layer("FOG")
      .closed(true)
      .locked(true)
      .disableHit(true)
      .visible(true)
      .zIndex(LIGHT_TINT_Z)
      .metadata(META_LIGHT_TINT)
      .build();
    adds.push(tintItem);

    // Darkvision outer ring (desaturating tint).
    if (inst.darkPoly && inst.darkPoly.length >= 3 && inst.light.darkRadius && inst.light.darkRadius > 0) {
      // Construct a "ring" from the dark polygon with the color
      // polygon punched out. donutPolygon handles this cleanly.
      const ring = donutPolygon(ensureCCW(inst.darkPoly), [ensureCCW(inst.colorPoly)]);
      if (ring.length >= 3) {
        const darkItem = buildCurve()
          .points(ring)
          .strokeColor(DARK_TINT_FILL)
          .strokeOpacity(0)
          .strokeWidth(0)
          .fillColor(DARK_TINT_FILL)
          .fillOpacity(DARK_TINT_OPACITY)
          .layer("FOG")
          .closed(true)
          .locked(true)
          .disableHit(true)
          .visible(true)
          .zIndex(DARK_TINT_Z)
          .metadata(META_DARK_TINT)
          .build();
        adds.push(darkItem);
      }
    }
  }

  if (adds.length > 0) {
    try {
      await OBR.scene.local.addItems(adds);
    } catch (e) {
      console.error("[vision] addItems failed", e);
    }
  }
}

// Remove ALL of our render items. Called on module teardown and when
// the client switches into "no vision" mode.
export async function clearFog(): Promise<void> {
  try {
    const existing = await OBR.scene.local.getItems((it: any) => {
      const r = (it.metadata?.[ROLE_KEY]) as string | undefined;
      return r === "fog-mask" || r === "light-tint" || r === "dark-tint";
    });
    if (existing.length > 0) {
      await OBR.scene.local.deleteItems(existing.map((i) => i.id));
    }
  } catch {}
}
