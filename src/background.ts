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
// Desktop AND mobile: bottom-right corner. BOTTOM_OFFSET lifts the
// cluster above OBR's bottom toolbar (turn / hotkey strip, ~60-70px
// tall) so neither layer occludes the other. Moved off the top-right
// because the global-search popover lives there and the two were
// fighting for the same strip.
const RIGHT_OFFSET = 12;
const BOTTOM_OFFSET = 80;
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
    const right = IS_MOBILE ? MOBILE_RIGHT_OFFSET : RIGHT_OFFSET;
    const bottom = IS_MOBILE ? MOBILE_BOTTOM_OFFSET : BOTTOM_OFFSET;
    const anchor = {
      anchorPosition: { left: vw - right, top: vh - bottom },
      anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" } as const,
      transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" } as const,
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

// ──────────── HTTP-cache prewarm for cc-panel iframes ────────────
//
// The cc-panel modal kills its iframes on close (OBR API gives us no
// hide-keep-alive), so every reopen re-fetches 不全书 and each card.
// As a non-invasive workaround, we host hidden 1×1 iframes inside
// the always-alive `background.html` document for:
//   - 不全书 (5echm.kagangtuya.top) — the heavy third-party page
//   - the 3 most recent character cards on the scene (same origin,
//     cheap)
//
// These hidden iframes load the full pages once, which warms the
// browser's HTTP cache. When the visible cc-panel iframe later
// requests the same URLs, the JS/CSS/HTML come back from disk cache
// instead of a 5–10 s cold network fetch. Cross-origin caching only
// works if the upstream server's Cache-Control allows it (5echm
// does, in our testing). No JS state is shared — each iframe parses
// the same cached bytes independently.

const CC_LIST_KEY = "com.character-cards/list";
const CC_PREWARM_BQS_URL = "https://5echm.kagangtuya.top/";
const CC_PREWARM_CARD_LIMIT = 3;
const CC_PREWARM_DELAY_MS = 8_000; // wait until OBR finishes its own load
const SERVER_ORIGIN = "https://obr.dnd.center";

const prewarmFrames = new Map<string, HTMLIFrameElement>();
let prewarmStarted = false;

function makeHiddenIframe(url: string, key: string): HTMLIFrameElement {
  const f = document.createElement("iframe");
  f.src = url;
  f.title = `prewarm:${key}`;
  f.dataset.prewarmKey = key;
  // Off-screen, pointer-inert, zero footprint — pure cache primer.
  f.style.cssText =
    "position:fixed;left:-2px;top:-2px;width:1px;height:1px;" +
    "border:0;visibility:hidden;pointer-events:none;opacity:0";
  return f;
}

function ensurePrewarm(url: string, key: string): void {
  if (prewarmFrames.has(key)) return;
  try {
    const f = makeHiddenIframe(url, key);
    document.body.appendChild(f);
    prewarmFrames.set(key, f);
  } catch (e) {
    console.warn("[obr-suite/prewarm] failed", key, e);
  }
}

function syncCardPrewarms(): void {
  // Read the current cc list off scene metadata and ensure a hidden
  // iframe exists for each of the most recent N cards. Older cards
  // are left alone — if they're already prewarmed they stay; if
  // they were never prewarmed, the user pays the cold load on first
  // open. Keeps memory bounded.
  OBR.scene.getMetadata().then((meta) => {
    const list = (meta[CC_LIST_KEY] as Array<{ id: string; url: string }> | undefined) ?? [];
    const recent = list.slice(0, CC_PREWARM_CARD_LIMIT);
    for (const c of recent) {
      if (!c?.id || !c?.url) continue;
      ensurePrewarm(SERVER_ORIGIN + c.url, `card:${c.id}`);
    }
  }).catch(() => {});
}

function startCcPrewarm(): void {
  if (prewarmStarted) return;
  const state = getState();
  if (!state.enabled.characterCards) return;
  prewarmStarted = true;
  // Defer so we don't compete with OBR's own scene-load network.
  setTimeout(() => {
    ensurePrewarm(CC_PREWARM_BQS_URL, "bqs");
    syncCardPrewarms();
    // Also rewarm the card list whenever scene metadata changes
    // (new card uploaded, old one deleted) so the most recent N
    // cards are always primed.
    try {
      OBR.scene.onMetadataChange(() => syncCardPrewarms());
    } catch {}
  }, CC_PREWARM_DELAY_MS);
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
        startCcPrewarm();
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
      startCcPrewarm();
    } else {
      await closeCluster();
    }
  });
});
