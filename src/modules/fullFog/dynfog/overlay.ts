// Indicator lifecycle.
//
// Upstream shows door + light overlays only while the fog tool is
// active, which is right for the GM: the rest of the time they'd just
// clutter the map. Two additions here:
//
//   * players get the OPENING overlay permanently (when the GM allows
//     it) — that's the whole point of "let players work the doors";
//     they never get the LIGHT overlay, which is authoring UI.
//   * the GM can pin their overlay on with `fogDoorOverlayAlways`.

import OBR from "@owlbear-rodeo/sdk";
import type { Reconciler } from "./reconcile/Reconciler";
import {
  LightOverlayReactor,
  OpeningOverlayReactor,
} from "./reconcile/reactors/OverlayReactors";
import { OBR_FOG_TOOL, TOGGLE_TOOL_ID } from "./ids";
import {
  getAlwaysShowOverlay,
  getPlayerOpeningsEnabled,
  isGM,
} from "./runtime";

let unsubscribeTool: (() => void) | null = null;
let activeTool = "";

function wantOpeningOverlay(): boolean {
  if (isGM()) return getAlwaysShowOverlay() || activeTool === OBR_FOG_TOOL || activeTool === TOGGLE_TOOL_ID;
  return getPlayerOpeningsEnabled();
}

function wantLightOverlay(): boolean {
  return isGM() && activeTool === OBR_FOG_TOOL;
}

/** Bring the registered overlay reactors in line with what the current
 *  role / tool / settings call for. Safe to call as often as you like. */
export function syncOverlays(reconciler: Reconciler): void {
  const openings = reconciler.find(OpeningOverlayReactor);
  if (wantOpeningOverlay()) {
    if (!openings) reconciler.register(new OpeningOverlayReactor(reconciler));
  } else if (openings) {
    reconciler.unregister(openings);
  }

  const lights = reconciler.find(LightOverlayReactor);
  if (wantLightOverlay()) {
    if (!lights) reconciler.register(new LightOverlayReactor(reconciler));
  } else if (lights) {
    reconciler.unregister(lights);
  }
}

export async function initOverlay(reconciler: Reconciler): Promise<void> {
  try {
    activeTool = await OBR.tool.getActiveTool();
  } catch {}
  syncOverlays(reconciler);
  try {
    unsubscribeTool = OBR.tool.onToolChange((id) => {
      activeTool = id;
      syncOverlays(reconciler);
    });
  } catch {}
}

export function teardownOverlay(reconciler: Reconciler): void {
  if (unsubscribeTool) {
    try {
      unsubscribeTool();
    } catch {}
    unsubscribeTool = null;
  }
  const openings = reconciler.find(OpeningOverlayReactor);
  if (openings) reconciler.unregister(openings);
  const lights = reconciler.find(LightOverlayReactor);
  if (lights) reconciler.unregister(lights);
}
