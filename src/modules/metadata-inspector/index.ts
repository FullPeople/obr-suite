// Metadata inspector — DM-only.
//
// Tool registers in OBR's left sidebar. While the tool is active,
// the top action bar shows THREE selectable mode buttons (modes have
// built-in active-state styling, unlike actions):
//
//   • 默认  — selection-driven small popover beside the picked item.
//             Empty / multi selection → no popover. This is the
//             original telescope behavior and the default starting
//             mode every time the tool activates.
//   • 场景  — full-height popover at the right edge with scene
//             metadata + the option to switch to room.
//   • 房间  — same popover, defaulting to room metadata.
//
// Mode buttons are mutually exclusive (OBR's mode selector is a
// segmented control). Switching to scene/room closes the small item
// popover; switching back to default closes the big popover and
// re-renders the item popover for the current selection.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { IS_MOBILE } from "../../feature-flags";

const TOOL_ID = "com.obr-suite/metadata-inspector";
const MODE_DEFAULT = `${TOOL_ID}/mode-default`;
const MODE_SCENE = `${TOOL_ID}/mode-scene`;
const MODE_ROOM = `${TOOL_ID}/mode-room`;
const POPOVER_ITEM_ID = "com.obr-suite/metadata-inspector/item";
const POPOVER_META_ID = "com.obr-suite/metadata-inspector/meta";
const ICON_URL = assetUrl("metadata-inspector-icon.svg");
const ICON_SCENE_URL = assetUrl("metadata-inspector-scene-icon.svg");
const ICON_ROOM_URL = assetUrl("metadata-inspector-room-icon.svg");
const POPOVER_URL = assetUrl("metadata-inspector.html");

export const BC_INSPECTOR_SET_MODE = "com.obr-suite/metadata-inspector/set-mode";

const ITEM_W = 320;
const ITEM_H = 360;

const META_W = 380;
const META_TOP_INSET = 12;
const META_BOTTOM_INSET = 12;

const unsubs: Array<() => void> = [];
let activeToolNow: string | null = null;
let activeModeNow: string = MODE_DEFAULT;
let itemPopoverOpen = false;
let metaPopoverOpen = false;
let lastInspectedItemId: string | null = null;

type MetaMode = "scene" | "room";

async function itemAnchor(itemId: string): Promise<{ left: number; top: number }> {
  let vw = 1280;
  let vh = 720;
  try { vw = await OBR.viewport.getWidth(); } catch {}
  try { vh = await OBR.viewport.getHeight(); } catch {}
  let left = 8;
  let top = 8;
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    if (items.length > 0) {
      const it = items[0] as any;
      const screen = await OBR.viewport.transformPoint({ x: it.position.x, y: it.position.y });
      left = screen.x + 20;
      top = screen.y - ITEM_H / 2;
    }
  } catch {}
  if (left + ITEM_W > vw - 8) left = vw - ITEM_W - 8;
  if (top + ITEM_H > vh - 8) top = vh - ITEM_H - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  return { left, top };
}

// Right-edge anchor + height that fills the viewport. The user
// asked for "可以更长一些包括整个屏幕高度" — so we compute a height
// that equals (viewport height − top inset − bottom inset). The
// inspector page's ResizeObserver still respects this (it can only
// shrink the popover smaller than what we set, never grow past the
// initial allocation).
async function metaAnchorAndSize(): Promise<{
  anchor: { left: number; top: number };
  height: number;
}> {
  let vw = 1280;
  let vh = 720;
  try { vw = await OBR.viewport.getWidth(); } catch {}
  try { vh = await OBR.viewport.getHeight(); } catch {}
  return {
    anchor: {
      left: Math.max(8, vw - META_W - META_TOP_INSET),
      top: META_TOP_INSET,
    },
    height: Math.max(240, vh - META_TOP_INSET - META_BOTTOM_INSET),
  };
}

async function closeItemInspector(): Promise<void> {
  if (!itemPopoverOpen) return;
  itemPopoverOpen = false;
  lastInspectedItemId = null;
  try { await OBR.popover.close(POPOVER_ITEM_ID); } catch {}
}

async function closeMetaInspector(): Promise<void> {
  if (!metaPopoverOpen) return;
  metaPopoverOpen = false;
  try { await OBR.popover.close(POPOVER_META_ID); } catch {}
}

async function openItemInspector(itemId: string): Promise<void> {
  if (metaPopoverOpen) await closeMetaInspector();
  // Reopen with new anchor — close existing first so OBR re-evaluates
  // anchorPosition; just calling open with the same id keeps the old
  // anchor on some SDK versions.
  if (itemPopoverOpen) {
    try { await OBR.popover.close(POPOVER_ITEM_ID); } catch {}
    itemPopoverOpen = false;
  }
  const anchor = await itemAnchor(itemId);
  const url = `${POPOVER_URL}?mode=item&id=${encodeURIComponent(itemId)}`;
  try {
    await OBR.popover.open({
      id: POPOVER_ITEM_ID,
      url,
      width: ITEM_W,
      height: ITEM_H,
      anchorReference: "POSITION",
      anchorPosition: anchor,
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    itemPopoverOpen = true;
    lastInspectedItemId = itemId;
  } catch (e) {
    console.error("[metadata-inspector] open item popover failed", e);
  }
}

async function openMetaInspector(mode: MetaMode): Promise<void> {
  if (itemPopoverOpen) await closeItemInspector();
  if (metaPopoverOpen) {
    // Already open — just switch tab via broadcast.
    try {
      await OBR.broadcast.sendMessage(
        BC_INSPECTOR_SET_MODE,
        { mode },
        { destination: "LOCAL" },
      );
    } catch (e) {
      console.warn("[metadata-inspector] broadcast set-mode failed", e);
    }
    return;
  }
  const { anchor, height } = await metaAnchorAndSize();
  const url = `${POPOVER_URL}?mode=${mode}`;
  try {
    await OBR.popover.open({
      id: POPOVER_META_ID,
      url,
      width: META_W,
      height,
      anchorReference: "POSITION",
      anchorPosition: anchor,
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    metaPopoverOpen = true;
  } catch (e) {
    console.error("[metadata-inspector] open meta popover failed", e);
  }
}

async function isOurToolActive(): Promise<boolean> {
  if (activeToolNow !== null) return activeToolNow === TOOL_ID;
  try {
    const t = await OBR.tool.getActiveTool();
    return t === TOOL_ID;
  } catch { return false; }
}

// Sync the item popover with the current selection. Called when the
// user enters default mode OR when selection changes while default
// mode is active. Empty / multi selection → close popover.
async function syncItemFromSelection(): Promise<void> {
  let sel: string[] = [];
  try { sel = (await OBR.player.getSelection()) ?? []; } catch {}
  if (sel.length !== 1) {
    if (itemPopoverOpen) await closeItemInspector();
    return;
  }
  const id = sel[0];
  if (id === lastInspectedItemId && itemPopoverOpen) return;
  await openItemInspector(id);
}

export async function setupMetadataInspector(): Promise<void> {
  // Mobile clients skip setup — the inspector tool icon + popover
  // overlay would just clutter the limited touch UI.
  if (IS_MOBILE) {
    console.info("[metadata-inspector] mobile client — skipping setup");
    return;
  }
  const role = await OBR.player.getRole().catch(() => "PLAYER");
  if (role !== "GM") return;

  // Tool entry — left sidebar.
  try {
    await OBR.tool.create({
      id: TOOL_ID,
      defaultMode: MODE_DEFAULT,
      icons: [{
        icon: ICON_URL,
        label: "元数据检查 (DM)",
        filter: { roles: ["GM"] },
      }],
      onClick: async () => {
        await OBR.tool.activateTool(TOOL_ID);
        return false;
      },
    });
  } catch (e) {
    console.warn("[metadata-inspector] tool.create failed", e);
  }

  // Default mode — passthrough cursor; item popover follows selection.
  try {
    await OBR.tool.createMode({
      id: MODE_DEFAULT,
      icons: [{
        icon: ICON_URL,
        label: "选物体（默认） — 选中物体即弹出，取消选中则收起",
        filter: { activeTools: [TOOL_ID] },
      }],
      cursors: [{ cursor: "help" }],
      onActivate: () => {
        // Going back to default — close meta popover, restore item
        // popover from selection.
        void closeMetaInspector();
        void syncItemFromSelection();
      },
    });
  } catch (e) {
    console.warn("[metadata-inspector] createMode default failed", e);
  }

  // Scene mode — opens the big popover with scene metadata.
  try {
    await OBR.tool.createMode({
      id: MODE_SCENE,
      icons: [{
        icon: ICON_SCENE_URL,
        label: "场景元数据 (OBR.scene.getMetadata)",
        filter: { activeTools: [TOOL_ID] },
      }],
      cursors: [{ cursor: "help" }],
      onActivate: () => {
        void openMetaInspector("scene");
      },
    });
  } catch (e) {
    console.warn("[metadata-inspector] createMode scene failed", e);
  }

  // Room mode — same big popover, defaults to room tab.
  try {
    await OBR.tool.createMode({
      id: MODE_ROOM,
      icons: [{
        icon: ICON_ROOM_URL,
        label: "房间元数据 (OBR.room.getMetadata)",
        filter: { activeTools: [TOOL_ID] },
      }],
      cursors: [{ cursor: "help" }],
      onActivate: () => {
        void openMetaInspector("room");
      },
    });
  } catch (e) {
    console.warn("[metadata-inspector] createMode room failed", e);
  }

  // Track active tool. Activating telescope starts in MODE_DEFAULT
  // (defaultMode set on the tool above), which fires onActivate and
  // syncs item popover from selection. Deactivating closes both
  // popovers.
  try {
    const onChange = (tool: string) => {
      const wasUs = activeToolNow === TOOL_ID;
      activeToolNow = tool;
      const isUs = tool === TOOL_ID;
      if (!isUs && wasUs) {
        // Switched away from telescope — close everything.
        void closeItemInspector();
        void closeMetaInspector();
      }
      // When switching INTO us: the defaultMode's onActivate handles
      // opening the item popover. No work here.
    };
    const unsub = OBR.tool.onToolChange(onChange);
    if (typeof unsub === "function") unsubs.push(unsub);
    try {
      const t = await OBR.tool.getActiveTool();
      if (t) onChange(t);
    } catch {}
  } catch {}

  // Track active mode separately from the tool so selection-watcher
  // knows whether to act on item popover.
  try {
    const unsub = OBR.tool.onToolModeChange((mode) => {
      activeModeNow = mode ?? MODE_DEFAULT;
    });
    if (typeof unsub === "function") unsubs.push(unsub);
  } catch {}

  // Selection-driven small popover (only in default mode).
  unsubs.push(
    OBR.player.onChange(async () => {
      if (!(await isOurToolActive())) return;
      if (activeModeNow !== MODE_DEFAULT) return;
      await syncItemFromSelection();
    }),
  );
}

export function teardownMetadataInspector(): void {
  for (const fn of unsubs.splice(0)) {
    try { fn(); } catch {}
  }
  void closeItemInspector();
  void closeMetaInspector();
  try { OBR.tool.remove(TOOL_ID); } catch {}
  try { OBR.tool.removeMode(MODE_DEFAULT); } catch {}
  try { OBR.tool.removeMode(MODE_SCENE); } catch {}
  try { OBR.tool.removeMode(MODE_ROOM); } catch {}
}
