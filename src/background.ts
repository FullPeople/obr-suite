import OBR from "@owlbear-rodeo/sdk";
import { startSceneSync, getState, onStateChange, getLocalLang } from "./state";
import { setupTimeStop, teardownTimeStop } from "./modules/timeStop";
import { setupFocus, teardownFocus } from "./modules/focus";
import { setupSearch, teardownSearch } from "./modules/search";
import { setupInitiative, teardownInitiative } from "./modules/initiative";
import { setupBestiary, teardownBestiary } from "./modules/bestiary";
import {
  setupCharacterCards,
  teardownCharacterCards,
} from "./modules/characterCards";
import { setupDice, teardownDice } from "./modules/dice";
import { setupPortals, teardownPortals } from "./modules/portals";

// One central popover hosts the floating button + collapsible cluster.
// The popover never closes itself; the iframe handles all expand/collapse
// internally so the user can click around the map without losing state.
const CLUSTER_POPOVER_ID = "com.obr-suite/cluster";
const CLUSTER_URL = "https://obr.dnd.center/suite/cluster.html";

const CLUSTER_W_COLLAPSED = 64;
// Expanded width depends on UI language — English labels need more room.
// Cluster.ts owns subsequent resizes; here we just pick the right initial
// width when the popover first opens at scene-ready.
// Bumped from 540 / 720 to fit the inline search input (which moved
// from its own popover into the cluster row).
const CLUSTER_W_EXPANDED_ZH = 760;
const CLUSTER_W_EXPANDED_EN = 920;
const CLUSTER_H = 64;
// Desktop: top-right, offset enough to clear OBR's right-edge toolbar
// (player avatars + scene panel). Bumped to 65 so the cluster's right
// edge sits 5px further left than the bestiary panel reference (60),
// per user request.
const RIGHT_OFFSET = 65;
const TOP_OFFSET = 14;
// Mobile: keep bottom-right corner anchor — the top-right placement
// covers viewport space that's scarce on phone-sized screens.
const MOBILE_BOTTOM_OFFSET = 80;
const MOBILE_RIGHT_OFFSET = 12;

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}
const IS_MOBILE = isMobileDevice();

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
    const lang = getLocalLang();
    const expandedWidth = lang === "zh" ? CLUSTER_W_EXPANDED_ZH : CLUSTER_W_EXPANDED_EN;
    const initialWidth = isExpanded ? expandedWidth : CLUSTER_W_COLLAPSED;
    const anchor = IS_MOBILE
      ? {
          anchorPosition: {
            left: vw - MOBILE_RIGHT_OFFSET,
            top: vh - MOBILE_BOTTOM_OFFSET,
          },
          anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" } as const,
          transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" } as const,
        }
      : {
          anchorPosition: { left: vw - RIGHT_OFFSET, top: TOP_OFFSET },
          anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" } as const,
          transformOrigin: { horizontal: "RIGHT", vertical: "TOP" } as const,
        };
    await OBR.popover.open({
      id: CLUSTER_POPOVER_ID,
      url: `${CLUSTER_URL}?expanded=${isExpanded ? "1" : "0"}`,
      width: initialWidth,
      height: CLUSTER_H,
      anchorReference: "POSITION",
      ...anchor,
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
  dice: { setup: setupDice, teardown: teardownDice },
  portals: { setup: setupPortals, teardown: teardownPortals },
  search: { setup: setupSearch, teardown: teardownSearch },
};

// Module lifecycle states: "off" (not running), "starting" (setup in
// flight), "on" (setup completed), "stopping" (teardown in flight).
// Tracking the in-flight states prevents concurrent syncModules calls
// from issuing duplicate setup() invocations on the same module — which
// is what was causing search.setup to be retried 4 times when scene
// metadata changes fired in rapid succession during initial load.
type ModuleState = "off" | "starting" | "on" | "stopping";
const moduleStatus = new Map<string, ModuleState>();

async function syncModules() {
  const state = getState();
  for (const [id, hooks] of Object.entries(modules)) {
    if (!hooks) continue;
    const wantOn = !!state.enabled[id as keyof typeof state.enabled];
    const status = moduleStatus.get(id) ?? "off";
    if (wantOn && status === "off") {
      moduleStatus.set(id, "starting");
      try {
        await hooks.setup();
        moduleStatus.set(id, "on");
      } catch (e) {
        // Mark as "on" anyway — the module's own setup catches its own
        // errors normally; if something escapes here we don't want an
        // infinite retry loop. The user can manually toggle in Settings.
        console.error(`[obr-suite] ${id} setup escaped:`, e);
        moduleStatus.set(id, "on");
      }
    } else if (!wantOn && status === "on") {
      moduleStatus.set(id, "stopping");
      try {
        await hooks.teardown();
      } catch (e) {
        console.error(`[obr-suite] ${id} teardown escaped:`, e);
      }
      moduleStatus.set(id, "off");
    }
    // status "starting" or "stopping" → another syncModules is already
    // handling this module; let it finish.
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
