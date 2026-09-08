// dynfog — the suite's dynamic-fog engine.
//
// Runs on EVERY client (walls and lights are local per-client items, so
// each client has to derive its own). Registration order matters:
// OpeningReactor caches the geometry the wall + overlay reactors read,
// so it goes first.
//
// GM-only pieces (the fog-tool modes and the light context menu) are
// gated on role; the toggle tool is registered for players too when the
// GM allows it.
//
// Every channel derives walls/lights and applies the same vision policy.
// GM light controls are available on both channels. Extra geometry tools,
// indicators and player opening controls are authoring-channel features.

import OBR from "@owlbear-rodeo/sdk";
import { Reconciler } from "./reconcile/Reconciler";
import { OpeningReactor } from "./reconcile/reactors/OpeningReactor";
import { WallReactor } from "./reconcile/reactors/WallReactor";
import {
  LightReactor,
  SelfLightReactor,
} from "./reconcile/reactors/LightReactor";
import { LightOcclusion } from "./light/occlusion";
import { initOverlay, syncOverlays, teardownOverlay } from "./overlay";
import { createLineMode, removeLineMode } from "./tools/createLineMode";
import {
  createOpeningMode,
  removeOpeningModes,
} from "./tools/createOpeningMode";
import { createToggleTool, removeToggleTool } from "./tools/createToggleTool";
import {
  startToggleListener,
  stopToggleListener,
} from "./tools/toggleChannel";
import { createLightMenu, removeLightMenu } from "./light/createLightMenu";
import {
  getPlayerOpeningsEnabled,
  isGM,
  refreshRuntime,
  setAlwaysShowOverlay,
  setLightOcclusionEnabled,
  setPlayerOpeningsEnabled,
  setSceneDpi,
  setShareVisionEnabled,
  setRole,
  setPlayerId,
  setVisionParty,
  setVisionCards,
  clearSceneVision,
} from "./runtime";

export interface DynfogOptions {
  /** Players may see + operate door/window indicators. */
  playerOpenings: boolean;
  /** GM keeps their indicators visible without the fog tool. */
  alwaysShowOverlay: boolean;
  /** Hide other people's lights unless a wall-free sight line reaches
   *  them from one of your own. See `light/occlusion.ts`. */
  lightOcclusion: boolean;
  /** Union authorized party revealing sources; never all scene lights. */
  shareVision: boolean;
  /**
   * Register the AUTHORING surface — the fog-tool
   * line/door/window modes, the indicator overlays and the player
   * toggle tool.
   *
   * The wall engine itself always runs: it is what turns fog shapes
   * (including the fog editor's traced outline) into vision-blocking
   * walls, and every channel needs that. Only the authoring UI is
   * channel-gated — see `feature-flags.ts::STABLE_HIDES`.
   */
  authoring: boolean;
}

let reconciler: Reconciler | null = null;
let occlusion: LightOcclusion | null = null;
let started = false;
let authoring = false;
const subscriptions: Array<() => void> = [];
let gmToolsRegistered = false;
let lightMenuRegistered = false;
let toolQueue = Promise.resolve();
let toggleToolWanted = false;
let lifetime = 0;
let sceneEpoch = 0;

async function syncGmTools(): Promise<void> {
  toolQueue = toolQueue.catch(() => {}).then(async () => {
    const wantLightMenu = started && isGM();
    if (wantLightMenu !== lightMenuRegistered) {
      if (wantLightMenu) {
        // Mark before awaiting so teardown also cleans up a partial creation.
        lightMenuRegistered = true;
        await createLightMenu();
      }
      else await removeLightMenu();
      lightMenuRegistered = wantLightMenu;
    }
    const want = started && authoring && isGM();
    if (want && !gmToolsRegistered) {
      gmToolsRegistered = true;
      try {
        await createLineMode();
        if (reconciler) {
          await createOpeningMode(reconciler, "door");
          await createOpeningMode(reconciler, "window");
          await createOpeningMode(reconciler, "secret");
        }
      } catch (e) {
        console.warn("[dynfog] GM tool registration failed", e);
      }
    } else if (!want && gmToolsRegistered) {
      gmToolsRegistered = false;
      await removeLineMode();
      await removeOpeningModes();
    }
  });
  return toolQueue;
}

async function syncToggleTool(): Promise<void> {
  // The GM always keeps the tool; players only get it when allowed.
  const want = authoring && (isGM() || getPlayerOpeningsEnabled());
  if (want === toggleToolWanted) return;
  toggleToolWanted = want;
  if (want) await createToggleTool(reconciler);
  else await removeToggleTool();
}

/** Push the suite's scene-level settings into the engine. Called by
 *  `fullFog/index.ts` whenever suite state changes. */
export async function applyDynfogSettings(
  options: DynfogOptions,
): Promise<void> {
  authoring = options.authoring;
  const a = setPlayerOpeningsEnabled(options.playerOpenings);
  const b = setAlwaysShowOverlay(options.alwaysShowOverlay);
  // Re-evaluate access without rebuilding the unchanged wall geometry.
  const c = setLightOcclusionEnabled(options.lightOcclusion);
  const d = setShareVisionEnabled(options.shareVision);
  if (c || d) reconciler?.refreshAccess();
  await syncGmTools();
  await syncToggleTool();
  if ((a || b) && reconciler && authoring) {
    syncOverlays(reconciler);
    reconciler.refresh();
  }
}

export async function setupDynfog(options: DynfogOptions): Promise<void> {
  if (started) {
    await applyDynfogSettings(options);
    return;
  }
  started = true;
  const generation = ++lifetime;
  authoring = options.authoring;

  setPlayerOpeningsEnabled(options.playerOpenings);
  setAlwaysShowOverlay(options.alwaysShowOverlay);
  setLightOcclusionEnabled(options.lightOcclusion);
  setShareVisionEnabled(options.shareVision);
  clearSceneVision();
  setRole("PLAYER");
  setPlayerId("");
  setVisionParty([]);

  // Subscribe before reads: late setup/old-scene responses must not restore
  // ownership which a newer scene, role or card metadata event revoked.
  subscriptions.push(OBR.party.onChange(players => {
    if (!started || generation !== lifetime || !setVisionParty(players)) return;
    reconciler?.refreshAccess();
  }));
  subscriptions.push(OBR.scene.onMetadataChange(metadata => {
    if (!started || generation !== lifetime || !setVisionCards(metadata)) return;
    reconciler?.refreshAccess();
  }));
  subscriptions.push(OBR.player.onChange(player => {
    if (!started || generation !== lifetime) return;
    const roleChanged = setRole(player.role);
    const idChanged = setPlayerId(player.id);
    if (!roleChanged && !idChanged) return;
    reconciler?.refreshAccess();
    void syncGmTools().catch(error => console.warn("[dynfog] role tools failed", error));
    void syncToggleTool();
    if (reconciler && authoring) syncOverlays(reconciler);
  }));
  subscriptions.push(OBR.scene.onReadyChange(ready => {
    const epoch = ++sceneEpoch;
    clearSceneVision();
    if (!ready) return;
    void refreshRuntime().then(() => {
      if (!started || generation !== lifetime || epoch !== sceneEpoch) return;
      reconciler?.refreshAccess();
      if (reconciler && authoring) syncOverlays(reconciler);
    });
  }));
  await refreshRuntime();
  if (!started || generation !== lifetime) return;

  reconciler = new Reconciler();
  reconciler.register(new OpeningReactor(reconciler));
  reconciler.register(new WallReactor(reconciler));
  // Lights RENDER on every channel, for the same reason walls do: a
  // scene with fog filled and no lights is a black screen for every
  // player. Gating light rendering behind `authoring` would leave a
  // stable-channel player blind in any scene a dev-channel GM lit.
  reconciler.register(new LightReactor(reconciler));
  reconciler.register(new SelfLightReactor(reconciler));
  occlusion = new LightOcclusion(reconciler);
  subscriptions.push(reconciler.onAfterReconcile(() => occlusion?.run()));
  if (authoring) {
    await initOverlay(reconciler);
    startToggleListener();
  }
  await syncGmTools();
  await syncToggleTool();

  // Grid dpi feeds 墙体外扩; scene swaps and grid edits both move it.
  try {
    subscriptions.push(
      OBR.scene.grid.onChange((grid) => {
        if (setSceneDpi(grid.dpi) && reconciler) reconciler.refresh();
      }),
    );
  } catch {}

}

export async function teardownDynfog(): Promise<void> {
  if (!started) return;
  started = false;
  lifetime++;
  sceneEpoch++;
  clearSceneVision();

  for (const unsubscribe of subscriptions.splice(0)) {
    try {
      unsubscribe();
    } catch {}
  }

  stopToggleListener();
  await removeToggleTool();
  toggleToolWanted = false;
  await toolQueue.catch(() => {});
  if (lightMenuRegistered) {
    lightMenuRegistered = false;
    await removeLightMenu();
  }
  if (gmToolsRegistered) {
    gmToolsRegistered = false;
    await removeLineMode();
    await removeOpeningModes();
  }

  occlusion?.reset();
  occlusion = null;

  if (reconciler) {
    teardownOverlay(reconciler);
    await reconciler.delete();
    reconciler = null;
  }
}
