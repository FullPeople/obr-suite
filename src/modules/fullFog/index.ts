// The map-fog context editor has been retired in both channels. Saved FOG paths
// and the separately switchable dynamic-fog engine remain supported. Keep the
// legacy lifecycle exports so persisted fogEditor flags still parse safely.
import OBR from "@owlbear-rodeo/sdk";
import { getState, onStateChange } from "../../state";
import { STABLE_HIDES } from "../../feature-flags";
import { CTX_EDIT_FOG, MODAL_ID, PLUGIN_ID } from "./types";
import { applyDynfogSettings, setupDynfog, teardownDynfog, type DynfogOptions } from "./dynfog";

// Remove by stable id even when this document never registered the old menu,
// including reloads with fogEditor disabled and GM/player role changes.
export async function setupFogEditor(): Promise<void> {
  try { await OBR.contextMenu.remove(CTX_EDIT_FOG); }
  catch (error) { console.warn("[fullFog] retired editor menu cleanup failed", error); }
}

export async function teardownFogEditor(): Promise<void> {
  await setupFogEditor();
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

// --- 2. the engine ----------------------------------------------------------

let engineRegistered = false;
const engineUnsubs: Array<() => void> = [];

function currentOptions(): DynfogOptions {
  const state = getState();
  return {
    playerOpenings: state.fogPlayerDoors,
    alwaysShowOverlay: state.fogDoorOverlayAlways,
    lightOcclusion: state.fogLightOcclusion,
    shareVision: state.fogShareVision,
    // The authoring surface (light menu, fog-tool modes, indicators,
    // player toggle tool) is dev-channel only
    // for now; the wall engine runs everywhere because the stable fog
    // editor's output is worthless without it.
    authoring: !STABLE_HIDES,
  };
}

export async function setupDynamicFog(): Promise<void> {
  if (engineRegistered) return;
  engineRegistered = true;

  // The engine runs on every client — Wall, Light and Effect items are
  // local per-client, so each client derives its own from the shared
  // fog drawings.
  await setupDynfog(currentOptions());

  // Keep the engine in step with the GM's suite settings.
  engineUnsubs.push(
    onStateChange(() => {
      void applyDynfogSettings(currentOptions());
    }),
  );
}

export async function teardownDynamicFog(): Promise<void> {
  if (!engineRegistered) return;
  engineRegistered = false;
  for (const unsubscribe of engineUnsubs.splice(0)) {
    try {
      unsubscribe();
    } catch {}
  }
  await teardownDynfog();
}

void PLUGIN_ID;
