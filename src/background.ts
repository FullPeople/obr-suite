import OBR from "@owlbear-rodeo/sdk";
import { startSceneSync, getState, onStateChange } from "./state";
import { setupTimeStop, teardownTimeStop } from "./modules/timeStop";
import { setupFocus, teardownFocus } from "./modules/focus";
import { setupSearch, teardownSearch } from "./modules/search";
import { setupInitiative, teardownInitiative } from "./modules/initiative";
import { setupBestiary, teardownBestiary } from "./modules/bestiary";
import {
  setupCharacterCards,
  teardownCharacterCards,
} from "./modules/characterCards";

// One central popover hosts the floating button + collapsible cluster.
// The popover never closes itself; the iframe handles all expand/collapse
// internally so the user can click around the map without losing state.
const CLUSTER_POPOVER_ID = "com.obr-suite/cluster";
const CLUSTER_URL = "https://obr.dnd.center/suite/cluster.html";

const CLUSTER_W_COLLAPSED = 64;
const CLUSTER_W_EXPANDED = 540; // 7 buttons + group label + main + padding
const CLUSTER_H = 64;
const RIGHT_OFFSET = 12;
// Lifted up from 12 → 80 so the cluster sits above OBR's bottom-right
// toolbar (zoom controls + scene selector). The cluster.ts code may
// further adjust if needed.
const BOTTOM_OFFSET = 80;

async function openCluster() {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    // Read persisted state and pass it to the cluster iframe via URL param.
    // We open the popover ONCE at the correct width; the cluster iframe
    // never has to call setWidth on init. This fixes the initial-clipping
    // bug + removes the resize flicker that retry-setWidth caused.
    let isExpanded = false;
    try { isExpanded = localStorage.getItem("obr-suite/cluster-expanded") === "1"; } catch {}
    const initialWidth = isExpanded ? CLUSTER_W_EXPANDED : CLUSTER_W_COLLAPSED;
    await OBR.popover.open({
      id: CLUSTER_POPOVER_ID,
      url: `${CLUSTER_URL}?expanded=${isExpanded ? "1" : "0"}`,
      width: initialWidth,
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

// Module setup order matters — OBR's popover layer warms up after the
// first few popovers are opened, and the LAST popover to be opened
// sometimes fails its first-load render if it's the very first popover
// to come up. So we load the popover-heavy modules first (initiative
// panel, bestiary tool, character-cards) and search LAST.
const modules: Partial<Record<keyof ReturnType<typeof getState>["enabled"], ModuleHooks>> = {
  timeStop: { setup: setupTimeStop, teardown: teardownTimeStop },
  focus: { setup: setupFocus, teardown: teardownFocus },
  initiative: { setup: setupInitiative, teardown: teardownInitiative },
  bestiary: { setup: setupBestiary, teardown: teardownBestiary },
  characterCards: {
    setup: setupCharacterCards,
    teardown: teardownCharacterCards,
  },
  search: { setup: setupSearch, teardown: teardownSearch },
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
