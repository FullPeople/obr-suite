import OBR from "@owlbear-rodeo/sdk";
import { startSceneSync, getState, onStateChange } from "./state";
import { setupTimeStop, teardownTimeStop } from "./modules/timeStop";
import { setupFocus, teardownFocus } from "./modules/focus";
import { setupSearch, teardownSearch } from "./modules/search";

// One central popover hosts the floating button + collapsible cluster.
// The popover never closes itself; the iframe handles all expand/collapse
// internally so the user can click around the map without losing state.
const CLUSTER_POPOVER_ID = "com.obr-suite/cluster";
const CLUSTER_URL = "https://obr.dnd.center/suite/cluster.html";

const CLUSTER_W_COLLAPSED = 64;
const CLUSTER_W_EXPANDED = 540; // 7 buttons + group label + main + padding
const CLUSTER_H = 64;
const RIGHT_OFFSET = 12;
const BOTTOM_OFFSET = 12;

async function openCluster() {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    await OBR.popover.open({
      id: CLUSTER_POPOVER_ID,
      url: CLUSTER_URL,
      // Open at the expanded width so the iframe is wide enough to grow into
      // when the user clicks expand. The cluster.ts code uses
      // OBR.popover.setWidth to alternate between collapsed and expanded.
      width: CLUSTER_W_COLLAPSED,
      height: CLUSTER_H,
      anchorReference: "POSITION",
      anchorPosition: { left: vw - RIGHT_OFFSET, top: vh - BOTTOM_OFFSET },
      anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      hidePaper: true,
      disableClickAway: true,
    });
  } catch (e) {
    console.error("[obr-suite] openCluster failed", e);
  }
}

async function closeCluster() {
  try { await OBR.popover.close(CLUSTER_POPOVER_ID); } catch {}
}

// Module lifecycle: each module's setup() is called when its enable flag
// flips ON, teardown() when it flips OFF. Modules register OBR listeners
// (context menu, broadcast, popover, etc.) at setup and clean up at
// teardown. The shell is responsible for state-based dispatching.
type ModuleHooks = { setup: () => Promise<void>; teardown: () => Promise<void> };

const modules: Partial<Record<keyof ReturnType<typeof getState>["enabled"], ModuleHooks>> = {
  timeStop: { setup: setupTimeStop, teardown: teardownTimeStop },
  focus: { setup: setupFocus, teardown: teardownFocus },
  search: { setup: setupSearch, teardown: teardownSearch },
  // bestiary, characterCards, initiative are deferred to v0.3 — for now
  // the existing standalone plugins still handle those features. The
  // cluster's buttons for those still work because they broadcast to
  // the existing plugins, and Settings still controls visibility/state.
};

const moduleStatus = new Map<string, boolean>();

async function syncModules() {
  const state = getState();
  for (const [id, hooks] of Object.entries(modules)) {
    if (!hooks) continue;
    const wantOn = !!state.enabled[id as keyof typeof state.enabled];
    const isOn = !!moduleStatus.get(id);
    if (wantOn && !isOn) {
      await hooks.setup();
      moduleStatus.set(id, true);
    } else if (!wantOn && isOn) {
      await hooks.teardown();
      moduleStatus.set(id, false);
    }
  }
}

OBR.onReady(async () => {
  // Sync state, then open cluster + activate all enabled modules.
  startSceneSync();
  onStateChange(() => syncModules());

  const showIfReady = async () => {
    try {
      if (await OBR.scene.isReady()) {
        await openCluster();
        await syncModules();
      } else {
        await closeCluster();
      }
    } catch {}
  };
  await showIfReady();
  OBR.scene.onReadyChange(async (ready) => {
    if (ready) {
      await openCluster();
      await syncModules();
    } else {
      await closeCluster();
    }
  });
});
