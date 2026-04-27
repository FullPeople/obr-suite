import OBR from "@owlbear-rodeo/sdk";

// "Time Stop" / 时停模式 module — migrated from time-stop plugin.
//
// Trigger paths:
//   1. Right-click empty space → context menu "开启/关闭时停"
//   2. Cluster button → broadcasts BC_TIMESTOP_TOGGLE (handled here)
//
// State persisted in scene metadata so mid-scene joiners auto-enter time
// stop. Player tokens are locked when on, unlocked (only those WE locked)
// when off.

const PLUGIN_ID = "com.time-stop"; // backward-compat scene-meta key
const META_KEY = `${PLUGIN_ID}/state`;
const LOCK_TAG = `${PLUGIN_ID}/locked-by-timestop`;
const MODAL_ID = `${PLUGIN_ID}/overlay`;
const BROADCAST_ON = `${PLUGIN_ID}/on`;
const BROADCAST_OFF = `${PLUGIN_ID}/off`;
const BC_TOGGLE = "com.obr-suite/timestop-toggle";
const BC_STATE = "com.obr-suite/timestop-state";

const MENU_ID = `${PLUGIN_ID}/toggle`;
const ICON_URL = "https://obr.dnd.center/suite/timestop-icon.svg";
const OVERLAY_URL = "https://obr.dnd.center/suite/timestop-overlay.html";

const unsubs: Array<() => void> = [];
let isGM = false;

async function isTimeStopActive(): Promise<boolean> {
  try {
    const meta = await OBR.scene.getMetadata();
    return !!(meta[META_KEY] as any)?.active;
  } catch { return false; }
}

async function showOverlay(passThrough: boolean) {
  try {
    await OBR.modal.open({
      id: MODAL_ID,
      url: OVERLAY_URL,
      fullScreen: true,
      hidePaper: true,
      hideBackdrop: true,
      disablePointerEvents: passThrough,
    });
  } catch {}
}

async function hideOverlay() {
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

async function lockCharacterItems() {
  const items = await OBR.scene.items.getItems(
    (item) =>
      (item.layer === "CHARACTER" || item.layer === "MOUNT") && !item.locked
  );
  if (items.length === 0) return;
  const ids = items.map((i) => i.id);
  await OBR.scene.items.updateItems(ids, (drafts) => {
    for (const d of drafts) {
      d.locked = true;
      d.metadata[LOCK_TAG] = true;
    }
  });
}

async function unlockCharacterItems() {
  const items = await OBR.scene.items.getItems(
    (item) => item.metadata[LOCK_TAG] === true
  );
  if (items.length === 0) return;
  const ids = items.map((i) => i.id);
  await OBR.scene.items.updateItems(ids, (drafts) => {
    for (const d of drafts) {
      d.locked = false;
      delete d.metadata[LOCK_TAG];
    }
  });
}

function notifyClusterState(active: boolean) {
  try {
    OBR.broadcast.sendMessage(BC_STATE, { active }, { destination: "LOCAL" });
  } catch {}
}

async function turnOn() {
  await OBR.scene.setMetadata({ [META_KEY]: { active: true } });
  await OBR.broadcast.sendMessage(BROADCAST_ON, {});
  await showOverlay(true); // GM gets pass-through overlay
  await lockCharacterItems();
  notifyClusterState(true);
  OBR.notification.show("时停模式已开启");
}

async function turnOff() {
  await OBR.scene.setMetadata({ [META_KEY]: { active: false } });
  await OBR.broadcast.sendMessage(BROADCAST_OFF, {});
  await hideOverlay();
  await unlockCharacterItems();
  notifyClusterState(false);
  OBR.notification.show("时停已结束");
}

async function toggle() {
  if (!isGM) return;
  if (await isTimeStopActive()) await turnOff();
  else await turnOn();
}

export async function setupTimeStop(): Promise<void> {
  isGM = (await OBR.player.getRole()) === "GM";

  // Right-click context menu removed per user feedback — the only entry
  // point is now the cluster's 时停 button (GM-only).

  unsubs.push(
    OBR.broadcast.onMessage(BC_TOGGLE, async () => {
      if (!isGM) return;
      await toggle();
    })
  );

  // Players: on ON broadcast, force deselect + show overlay (modal blocks pointer)
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_ON, async () => {
      if (!isGM) {
        try { await OBR.player.deselect(); } catch {}
        await showOverlay(false);
      }
      notifyClusterState(true);
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_OFF, async () => {
      await hideOverlay();
      notifyClusterState(false);
    })
  );

  // Mid-scene join: re-apply state.
  const checkState = async () => {
    if (!(await OBR.scene.isReady())) return;
    if (await isTimeStopActive()) {
      if (!isGM) { try { await OBR.player.deselect(); } catch {} }
      await showOverlay(isGM);
      notifyClusterState(true);
    } else {
      notifyClusterState(false);
    }
  };
  await checkState();
  // OBR.scene.onReadyChange is added at the shell level — when scene ready
  // flips and modules need to re-check their state, the shell calls
  // teardownTimeStop / setupTimeStop. So no need for our own listener.
}

export async function teardownTimeStop(): Promise<void> {
  // Context menu was removed but we still try in case an old listener
  // lingered.
  try { await OBR.contextMenu.remove(MENU_ID); } catch {}
  for (const u of unsubs.splice(0)) u();
  await hideOverlay();
}
