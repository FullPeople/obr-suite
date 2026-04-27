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
}

export async function setupFocus(): Promise<void> {
  await OBR.contextMenu.create({
    id: MENU_ID_ITEM,
    icons: [
      {
        icon: ICON_URL,
        label: "全员聚焦到此处",
        filter: { roles: ["GM"] },
      },
    ],
    onClick: async (context) => {
      const scale = await OBR.viewport.getScale();
      const pos =
        context.items.length > 0
          ? context.items[0].position
          : context.selectionBounds.center;
      OBR.broadcast.sendMessage(BROADCAST_FOCUS, {
        x: pos.x,
        y: pos.y,
        scale,
      });
      focusCamera(pos.x, pos.y, scale);
      OBR.notification.show("已聚焦所有玩家摄像头");
    },
  });

  await OBR.contextMenu.create({
    id: MENU_ID_EMPTY,
    icons: [
      {
        icon: ICON_URL,
        label: "全员聚焦到此处",
        filter: { roles: ["GM"], min: 0, max: 0 },
      },
    ],
    onClick: async (context) => {
      const scale = await OBR.viewport.getScale();
      const c = context.selectionBounds.center;
      OBR.broadcast.sendMessage(BROADCAST_FOCUS, { x: c.x, y: c.y, scale });
      focusCamera(c.x, c.y, scale);
      OBR.notification.show("已聚焦所有玩家摄像头");
    },
  });

  unsubBroadcast = OBR.broadcast.onMessage(BROADCAST_FOCUS, async (event) => {
    const data = event.data as
      | { x: number; y: number; scale: number }
      | undefined;
    if (!data) return;
    focusCamera(data.x, data.y, data.scale);
  });

  // Cluster trigger: focus current viewport center (or selection center if any).
  unsubTriggerBroadcast = OBR.broadcast.onMessage(
    BC_FOCUS_TRIGGER,
    async () => {
      try {
        const role = await OBR.player.getRole();
        if (role !== "GM") return; // only GM broadcasts focus events
        const sel = await OBR.player.getSelection();
        let x: number, y: number;
        if (sel && sel.length > 0) {
          const items = await OBR.scene.items.getItems(sel);
          if (items.length > 0) {
            const center = items[0].position;
            x = center.x;
            y = center.y;
          } else return;
        } else {
          // Use current viewport center.
          const [vp, scale, vw, vh] = await Promise.all([
            OBR.viewport.getPosition(),
            OBR.viewport.getScale(),
            OBR.viewport.getWidth(),
            OBR.viewport.getHeight(),
          ]);
          // viewport.position is the *world* coord at iframe (0,0); add half
          // the viewport size in world coords to get its center.
          x = -(vp.x - vw / 2) / scale;
          y = -(vp.y - vh / 2) / scale;
        }
        const scale = await OBR.viewport.getScale();
        OBR.broadcast.sendMessage(BROADCAST_FOCUS, { x, y, scale });
        focusCamera(x, y, scale);
        OBR.notification.show("已聚焦所有玩家摄像头");
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
