import OBR from "@owlbear-rodeo/sdk";

// "Sync Viewport" / 同步视口 module — migrated from focus-camera plugin.
//
// Trigger paths:
//   1. Right-click on item / empty space → context menu
//   2. Cluster button → broadcasts BC_FOCUS_TRIGGER (handled here too)
//
// All players listen for BROADCAST_FOCUS to animate their own viewport.

const PLUGIN_ID = "com.focus-camera"; // keep old id for backward compat with players
const BROADCAST_FOCUS = `${PLUGIN_ID}/focus-all`;
const BC_FOCUS_TRIGGER = "com.obr-suite/focus-trigger";

const MENU_ID_ITEM = `${PLUGIN_ID}/focus-item`;
const MENU_ID_EMPTY = `${PLUGIN_ID}/focus-empty`;
const ICON_URL = "https://obr.dnd.center/suite/focus-icon.svg";

let unsubBroadcast: (() => void) | null = null;
let unsubTriggerBroadcast: (() => void) | null = null;

async function focusCamera(x: number, y: number, scale: number) {
  const [w, h] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  OBR.viewport.animateTo({
    position: { x: -x * scale + w / 2, y: -y * scale + h / 2 },
    scale,
  });
  // "登" — gentle confirmation thunk. Fires on every client receiving
  // a focus broadcast, so everyone hears it together as their cameras
  // move.
  try {
    const { sfxSyncView } = await import("./dice/sfx-broadcast");
    sfxSyncView();
  } catch {}
}

export async function setupFocus(): Promise<void> {
  // Right-click context menus removed per user feedback — the only entry
  // point is now the cluster's 同步视口 button (GM-only).

  unsubBroadcast = OBR.broadcast.onMessage(BROADCAST_FOCUS, async (event) => {
    const data = event.data as
      | { x: number; y: number; scale: number }
      | undefined;
    if (!data) return;
    focusCamera(data.x, data.y, data.scale);
  });

  // Cluster trigger: ALWAYS broadcast the DM's current viewport center +
  // scale, regardless of any token selection. The earlier "focus selected
  // token if any" fallback was confusing — the DM expected players to see
  // exactly what they themselves were looking at.
  unsubTriggerBroadcast = OBR.broadcast.onMessage(
    BC_FOCUS_TRIGGER,
    async () => {
      try {
        const role = await OBR.player.getRole();
        if (role !== "GM") return;
        const [vp, scale, vw, vh] = await Promise.all([
          OBR.viewport.getPosition(),
          OBR.viewport.getScale(),
          OBR.viewport.getWidth(),
          OBR.viewport.getHeight(),
        ]);
        // viewport.position is the *world* coord at iframe (0,0); add half
        // the viewport size in world coords to get its center.
        const x = -(vp.x - vw / 2) / scale;
        const y = -(vp.y - vh / 2) / scale;
        OBR.broadcast.sendMessage(BROADCAST_FOCUS, { x, y, scale });
        // DM doesn't need to animate to where they already are.
      } catch (e) {
        console.error("[obr-suite/focus] trigger failed", e);
      }
    }
  );
}

export async function teardownFocus(): Promise<void> {
  try { await OBR.contextMenu.remove(MENU_ID_ITEM); } catch {}
  try { await OBR.contextMenu.remove(MENU_ID_EMPTY); } catch {}
  unsubBroadcast?.();
  unsubBroadcast = null;
  unsubTriggerBroadcast?.();
  unsubTriggerBroadcast = null;
}
