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
import { setupBubbles, teardownBubbles } from "./modules/bubbles";
import { setupDevTest, teardownDevTest } from "./modules/dev-test";
import { setupCrossSceneCards } from "./modules/cross-scene-cards";
import { assetUrl } from "./asset-base";

// One central popover hosts the floating button + collapsible cluster.
// The popover never closes itself; the iframe handles all expand/collapse
// internally so the user can click around the map without losing state.
const CLUSTER_POPOVER_ID = "com.obr-suite/cluster";
const CLUSTER_URL = assetUrl("cluster.html");

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

// === Mobile-presence advertisement ===
//
// On a phone / tablet client some heavy popovers (full-screen
// character-card view, global search) are hidden because they don't
// render usefully or eat too much memory. To make this visible to the
// rest of the table — so the GM doesn't think a player is "missing"
// the cc panel by accident — every client broadcasts its mobile flag
// at scene-ready, and any client that receives "another player is on
// mobile" pops a yellow notification once per player ID per session.
//
// Disabled-feature list shown in the notification:
//   • 角色卡界面 / Character Card panel  (cluster button hidden)
//   • 全局搜索 / Global Search           (popover not registered)
const BC_MOBILE_PRESENCE = "com.obr-suite/mobile-presence";
const seenMobilePlayers = new Set<string>();

function disabledFeaturesText(lang: "zh" | "en"): string {
  return lang === "zh" ? "角色卡全屏面板、全局搜索" : "Character Card panel + Global Search";
}

async function announceMobilePresence(): Promise<void> {
  if (!IS_MOBILE) return;
  try {
    const [pid, pname] = await Promise.all([
      OBR.player.getId(),
      OBR.player.getName(),
    ]);
    await OBR.broadcast.sendMessage(
      BC_MOBILE_PRESENCE,
      { playerId: pid, playerName: pname || "?" },
      { destination: "ALL" },
    );
  } catch (e) {
    console.warn("[obr-suite] announceMobilePresence failed", e);
  }
}

function setupMobilePresenceListener(): void {
  OBR.broadcast.onMessage(BC_MOBILE_PRESENCE, async (event) => {
    const data = event.data as { playerId?: string; playerName?: string } | undefined;
    if (!data?.playerId) return;
    // Dedup: each player only triggers one notification per session
    // on each receiving client (else they'd re-fire on every
    // reconnection / scene change broadcast).
    if (seenMobilePlayers.has(data.playerId)) return;
    seenMobilePlayers.add(data.playerId);
    const lang = getLocalLang();
    const name = data.playerName || "?";
    const txt = lang === "zh"
      ? `${name} 正在使用手机端，为性能考虑无法使用：${disabledFeaturesText("zh")}。`
      : `${name} is on mobile — disabled for performance: ${disabledFeaturesText("en")}.`;
    try {
      await OBR.notification.show(txt, "WARNING");
    } catch (e) {
      console.warn("[obr-suite] mobile-presence notification failed", e);
    }
  });
}

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

// (HTTP-cache prewarm experiment removed — 不全书 is fronted by a
// Cloudflare bot challenge that fights back with CSP violations and
// 404s when loaded in a hidden iframe, so the cache never actually
// gets primed. Not worth the console noise. The cc-panel still
// reloads its iframes on every open; that's a known cost of OBR's
// "modal close = iframe destroy" lifecycle.)

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
  bubbles: { setup: setupBubbles, teardown: teardownBubbles },
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

  // Dev-only position-test tool. Self-gates on `import.meta.env.BASE_URL`
  // — registers nothing in stable builds. Runs outside the moduleStatus
  // machinery because it isn't a user-toggleable feature.
  void setupDevTest();

  // Mobile-presence: every client listens; phones additionally
  // broadcast their flag at scene-ready so others know which player
  // doesn't have the heavy popovers.
  setupMobilePresenceListener();

  // Cross-scene character-card sync. Always-on watcher; the actual
  // mirroring is gated on state.crossSceneSyncCards inside the
  // module so it's a no-op when the user hasn't enabled the toggle.
  void setupCrossSceneCards();

  const showIfReady = async () => {
    try {
      if (await OBR.scene.isReady()) {
        await openCluster();
        await syncModules();
        void announceMobilePresence();
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
      void announceMobilePresence();
    } else {
      await closeCluster();
    }
  });
});
