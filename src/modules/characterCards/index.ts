import OBR from "@owlbear-rodeo/sdk";

// Character Cards module — migrated from the standalone plugin.
//
// Components:
//   1. Main panel popover — 64×64 floating button at bottom-right that
//      opens into a fullscreen panel via internal popover.setWidth/Height.
//      The cluster's "角色卡界面按钮" broadcasts a panel-open event the
//      iframe listens for to maximize.
//   2. Info popover — small floating preview that opens above the main
//      button when a bound character token is selected. DM + players see
//      it (subject to the auto-info localStorage toggle, which the
//      cluster's "角色卡悬浮" toggle also writes to).
//   3. Bind modal — opened from the right-click context menu (GM only),
//      lets the GM bind/rebind/unbind a card to a character token.
//
// The "controls" popover from the standalone plugin (the two popup
// toggles) is intentionally NOT migrated — those toggles already live
// in the suite cluster.

const PLUGIN_ID = "com.character-cards"; // backward-compat for scene metadata + broadcasts
const POPOVER_ID = "com.obr-suite/cc-panel";
const INFO_POPOVER_ID = "com.obr-suite/cc-info";
const BIND_MODAL_ID = "com.obr-suite/cc-bind-picker";
const PANEL_URL = "https://obr.dnd.center/suite/cc-panel.html";
const INFO_URL = "https://obr.dnd.center/suite/cc-info.html";
const BIND_URL = "https://obr.dnd.center/suite/cc-bind.html";
const ICON_URL = "https://obr.dnd.center/suite/cc-icon.svg";

const BIND_META = `${PLUGIN_ID}/boundCardId`;
const SCENE_META_KEY = `${PLUGIN_ID}/list`;
const AUTO_INFO_KEY = "character-cards/auto-info";
const TOGGLE_MSG = `${PLUGIN_ID}/auto-info-toggled`;
const INFO_SHOW_MSG = `${PLUGIN_ID}/info-show`;
const CTX_BIND = "com.obr-suite/cc-bind-menu";

// Tool action with shortcut — registered on the Select tool so pressing
// Shift toggles the panel while in Select mode.
const TOOL_ACTION_TOGGLE = "com.obr-suite/cc-toggle-shortcut";
const SELECT_TOOL = "rodeo.owlbear.tool/select";

const POPOVER_BOX = 64;
const BOTTOM_OFFSET = 160;
const RIGHT_OFFSET = 12;
const INFO_WIDTH = 320;
const INFO_HEIGHT = 360;
const INFO_GAP = 8;

const unsubs: Array<() => void> = [];
let infoPopoverOpen = false;
let currentInfoCard: string | null = null;
let panelOpen = false;

function isAutoInfoEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_INFO_KEY) !== "0";
  } catch { return true; }
}

// The main panel opens already-maximized (full viewport). The blue circular
// mini button was removed in v1.1 — the suite cluster's "角色卡界面"
// button is the only way in. The panel-page itself listens for the
// "panel-open" broadcast and calls setMaximized(true), which sets up the
// popover-wide layout.
async function openMainPopover() {
  try {
    const [w, h] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    await OBR.popover.open({
      id: POPOVER_ID,
      url: PANEL_URL,
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: { left: 0, top: 0 },
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    panelOpen = true;
  } catch (e) {
    console.error("[obr-suite/character-cards] openMainPopover failed", e);
  }
}

async function closeMainPopover() {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  panelOpen = false;
}

async function toggleMainPanel() {
  if (panelOpen) await closeMainPopover();
  else await openMainPopover();
}

async function openInfoPopoverFor(cardId: string, roomId: string) {
  if (infoPopoverOpen) return;
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const buttonTop = vh - (BOTTOM_OFFSET + 48 + 8);
    const anchorTop = buttonTop - INFO_GAP;
    await OBR.popover.open({
      id: INFO_POPOVER_ID,
      url: `${INFO_URL}?cardId=${encodeURIComponent(cardId)}&roomId=${encodeURIComponent(
        roomId
      )}`,
      width: INFO_WIDTH,
      height: INFO_HEIGHT,
      anchorReference: "POSITION",
      anchorPosition: { left: vw - RIGHT_OFFSET, top: anchorTop },
      anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      hidePaper: true,
      disableClickAway: true,
    });
    infoPopoverOpen = true;
  } catch (e) {
    console.error("[obr-suite/character-cards] openInfoPopoverFor failed", e);
  }
}

async function closeInfoPopover() {
  try { await OBR.popover.close(INFO_POPOVER_ID); } catch {}
  infoPopoverOpen = false;
  currentInfoCard = null;
}

async function showInfoFor(cardId: string) {
  if (currentInfoCard === cardId && infoPopoverOpen) return;
  const roomId = OBR.room.id || "default";
  if (!infoPopoverOpen) {
    await openInfoPopoverFor(cardId, roomId);
  } else {
    try {
      await OBR.broadcast.sendMessage(
        INFO_SHOW_MSG,
        { cardId, roomId },
        { destination: "LOCAL" }
      );
    } catch {}
  }
  currentInfoCard = cardId;
}

async function hideInfo() {
  if (!infoPopoverOpen && currentInfoCard === null) return;
  await closeInfoPopover();
}

async function getSceneCardIds(): Promise<Set<string>> {
  try {
    const meta = await OBR.scene.getMetadata();
    const list = meta[SCENE_META_KEY];
    if (Array.isArray(list))
      return new Set(list.map((c: any) => c.id).filter(Boolean));
  } catch {}
  return new Set();
}

async function handleSelection(selection: string[] | undefined) {
  if (!isAutoInfoEnabled()) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  if (!selection || selection.length !== 1) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  let boundId: string | null = null;
  try {
    const items = await OBR.scene.items.getItems(selection);
    const m = items[0]?.metadata?.[BIND_META];
    if (typeof m === "string") boundId = m;
  } catch {}
  if (!boundId) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  const known = await getSceneCardIds();
  if (!known.has(boundId)) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  if (currentInfoCard === boundId) return;
  await showInfoFor(boundId);
}

export async function setupCharacterCards(): Promise<void> {
  // The main panel opens/closes on broadcast from the cluster button or
  // from the Shift keyboard shortcut registered below.
  unsubs.push(
    OBR.broadcast.onMessage("com.character-cards/panel-open", async () => {
      await openMainPopover();
    })
  );
  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/cc-panel-toggle", async () => {
      await toggleMainPanel();
    })
  );

  // ① Shift+A shortcut on the Select tool — toggles the cc panel.
  // Plain "Shift" was a modifier and conflicted with normal Shift use;
  // Shift+A is a real combo press that won't fire on Shift-clicks.
  try {
    await OBR.tool.createAction({
      id: TOOL_ACTION_TOGGLE,
      shortcut: "Shift+A",
      icons: [
        {
          icon: ICON_URL,
          label: "切换角色卡面板",
          filter: { activeTools: [SELECT_TOOL] },
        },
      ],
      onClick: async () => { await toggleMainPanel(); },
    });
  } catch (e) {
    console.error("[obr-suite/character-cards] createAction failed", e);
  }

  // Close the panel + info popover if scene unloads.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (!ready) {
        await closeMainPopover();
        await closeInfoPopover();
      }
    })
  );

  // Right-click context menu (GM only) to bind a card.
  await OBR.contextMenu.create({
    id: CTX_BIND,
    icons: [
      {
        icon: ICON_URL,
        label: "绑定角色卡",
        filter: {
          roles: ["GM"],
          every: [{ key: "type", value: "IMAGE" }],
          max: 1,
        },
      },
    ],
    onClick: async (context) => {
      const id = context.items[0]?.id;
      if (!id) return;
      try {
        await OBR.modal.open({
          id: BIND_MODAL_ID,
          url: `${BIND_URL}?itemId=${encodeURIComponent(id)}`,
          width: 360,
          height: 480,
        });
      } catch (e) {
        console.error("[obr-suite/character-cards] open bind modal failed", e);
      }
    },
  });

  // Selection-based info popover.
  unsubs.push(
    OBR.player.onChange(async (player) => {
      try { await handleSelection(player.selection); } catch {}
    })
  );
  try {
    const sel = await OBR.player.getSelection();
    await handleSelection(sel);
  } catch {}

  // Auto-info toggle changes (cluster's popup toggle writes to the same
  // localStorage key + sends the same broadcast).
  unsubs.push(
    OBR.broadcast.onMessage(TOGGLE_MSG, async () => {
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    })
  );

  // Hide info if the bound card was deleted from scene metadata, or its
  // host token was removed.
  unsubs.push(
    OBR.scene.onMetadataChange(async () => {
      if (!currentInfoCard) return;
      const known = await getSceneCardIds();
      if (!known.has(currentInfoCard)) await hideInfo();
    })
  );
  unsubs.push(
    OBR.scene.items.onChange(async () => {
      if (!currentInfoCard) return;
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    })
  );
}

export async function teardownCharacterCards(): Promise<void> {
  await closeMainPopover();
  await closeInfoPopover();
  try { await OBR.contextMenu.remove(CTX_BIND); } catch {}
  try { await OBR.tool.removeAction(TOOL_ACTION_TOGGLE); } catch {}
  for (const u of unsubs.splice(0)) u();
}
