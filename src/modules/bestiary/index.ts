import OBR from "@owlbear-rodeo/sdk";
import { setupGroupSaves, teardownGroupSaves } from "./group-saves";

// Bestiary module — migrated from the standalone plugin.
//
// Setup creates the left-rail Tool icon (DM-only). When the DM activates
// the tool, the side panel opens; switching to any other tool closes it.
// Setup also wires DM-only selection-tracking that pops a monster info
// popover at top-center when a spawned monster is selected.

const PLUGIN_ID = "com.bestiary"; // backward-compat for existing scene metadata + broadcasts
const TOOL_ID = "com.obr-suite/bestiary-tool";
const POPOVER_ID = "com.obr-suite/bestiary-panel";
const INFO_POPOVER_ID = "com.obr-suite/bestiary-info";
const TOOL_ACTION_TOGGLE = "com.obr-suite/bestiary-toggle-shortcut";
const SELECT_TOOL = "rodeo.owlbear.tool/select";
const MOVE_TOOL = "rodeo.owlbear.tool/move";
const POPOVER_URL = "https://obr.dnd.center/suite/bestiary-panel.html";
const INFO_URL = "https://obr.dnd.center/suite/bestiary-monster-info.html";
const ICON_URL = "https://obr.dnd.center/suite/bestiary-icon.svg";

const BESTIARY_SLUG_KEY = `${PLUGIN_ID}/slug`;
const INFO_SHOW_MSG = `${PLUGIN_ID}/info-show`;
const AUTO_POPUP_KEY = `${PLUGIN_ID}/auto-popup`;
const AUTO_POPUP_TOGGLE_MSG = `${PLUGIN_ID}/auto-popup-toggled`;
const CLOSE_MSG = `${PLUGIN_ID}/close`;

// Right-click context menu IDs (DM-only, see filter.roles below).
const CTX_BIND = "com.obr-suite/bestiary-bind";
const CTX_REBIND = "com.obr-suite/bestiary-rebind";
const CTX_UNBIND = "com.obr-suite/bestiary-unbind";

// Picker modal — reuses the bestiary panel HTML with `?pickerForItemId=...`.
const PICKER_MODAL_ID = "com.obr-suite/bestiary-picker";

// Bubbles + Initiative metadata keys used when binding (must match
// spawn.ts so existing tokens look identical to freshly-spawned ones).
const BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";
const INITIATIVE_MODKEY = "com.initiative-tracker/dexMod";

const isAutoPopupOn = (): boolean => {
  try { return localStorage.getItem(AUTO_POPUP_KEY) !== "0"; } catch { return true; }
};

const POPOVER_WIDTH = 350;
const POPOVER_HEIGHT = 600;
const RIGHT_OFFSET = 60;
const TOP_OFFSET = 80;

const INFO_WIDTH = 520;
const INFO_HEIGHT = 340;
const INFO_TOP_OFFSET = 60;

const unsubs: Array<() => void> = [];
let isOpen = false;
let infoPopoverOpen = false;
let currentInfoSlug: string | null = null;
let bestiaryRole: "GM" | "PLAYER" = "PLAYER";
// Tracks the previous tool so CapsLock can toggle back to it when the user
// is currently on the bestiary tool.
let previousTool: string | null = null;

async function openPanel() {
  try {
    const vw = await OBR.viewport.getWidth();
    await OBR.popover.open({
      id: POPOVER_ID,
      url: POPOVER_URL,
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      anchorReference: "POSITION",
      anchorPosition: { left: vw - RIGHT_OFFSET, top: TOP_OFFSET },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      disableClickAway: true,
    });
    isOpen = true;
  } catch (e) {
    console.error("[obr-suite/bestiary] openPanel failed", e);
  }
}

async function closePanel() {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  isOpen = false;
}

async function openInfoPopoverFor(slug: string) {
  if (infoPopoverOpen) return;
  try {
    const vw = await OBR.viewport.getWidth();
    await OBR.popover.open({
      id: INFO_POPOVER_ID,
      url: `${INFO_URL}?slug=${encodeURIComponent(slug)}`,
      width: INFO_WIDTH,
      height: INFO_HEIGHT,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(vw / 2), top: INFO_TOP_OFFSET },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    infoPopoverOpen = true;
  } catch (e) {
    console.error("[obr-suite/bestiary] openInfoPopoverFor failed", e);
  }
}

async function closeInfoPopover() {
  try { await OBR.popover.close(INFO_POPOVER_ID); } catch {}
  infoPopoverOpen = false;
  currentInfoSlug = null;
}

async function showInfoFor(slug: string) {
  if (currentInfoSlug === slug && infoPopoverOpen) return;
  if (!infoPopoverOpen) {
    await openInfoPopoverFor(slug);
  } else {
    try {
      await OBR.broadcast.sendMessage(INFO_SHOW_MSG, { slug }, { destination: "LOCAL" });
    } catch {}
  }
  currentInfoSlug = slug;
}

async function hideInfo() {
  if (!infoPopoverOpen && currentInfoSlug === null) return;
  await closeInfoPopover();
}

async function handleSelection(selection: string[] | undefined) {
  if (!isAutoPopupOn()) {
    if (currentInfoSlug) await hideInfo();
    return;
  }
  if (!selection || selection.length !== 1) {
    if (currentInfoSlug) await hideInfo();
    return;
  }
  let slug: string | null = null;
  try {
    const items = await OBR.scene.items.getItems(selection);
    const m = items[0]?.metadata?.[BESTIARY_SLUG_KEY];
    if (typeof m === "string") slug = m;
  } catch {}
  if (!slug) {
    if (currentInfoSlug) await hideInfo();
    return;
  }
  if (currentInfoSlug === slug) return;
  await showInfoFor(slug);
}

export async function setupBestiary(): Promise<void> {
  // Tool: GM-only left-rail icon. Clicking activates our tool which opens
  // the panel via onToolChange below.
  await OBR.tool.create({
    id: TOOL_ID,
    icons: [
      {
        icon: ICON_URL,
        label: "怪物图鉴",
        filter: { roles: ["GM"] },
      },
    ],
    onClick: async () => {
      await OBR.tool.activateTool(TOOL_ID);
      return false;
    },
  });

  // Passthrough mode — required for tools to be selectable, but we don't
  // intercept any pointer events.
  await OBR.tool.createMode({
    id: `${TOOL_ID}/mode`,
    icons: [
      {
        icon: ICON_URL,
        label: "浏览",
        filter: { activeTools: [TOOL_ID] },
      },
    ],
    cursors: [{ cursor: "default" }],
  });

  // Track previous tool + open/close panel based on which tool is active.
  unsubs.push(
    OBR.tool.onToolChange(async (activeId) => {
      if (activeId === TOOL_ID) {
        if (!isOpen) await openPanel();
      } else {
        // Remember the tool the user was on so CapsLock can return there.
        previousTool = activeId;
        if (isOpen) await closePanel();
      }
    })
  );

  // ② CapsLock shortcut. Two paths to the same toggle:
  //   a) OBR tool action shortcut (works when keyboard focus is on OBR's
  //      main window — i.e. user hasn't clicked into the panel iframe yet)
  //   b) keydown listener inside the panel iframe (works once the user
  //      has clicked into the panel) → broadcasts to here.
  const performShortcutToggle = async () => {
    try {
      const cur = await OBR.tool.getActiveTool();
      if (cur === TOOL_ID) {
        await OBR.tool.activateTool(previousTool ?? MOVE_TOOL);
      } else {
        previousTool = cur;
        await OBR.tool.activateTool(TOOL_ID);
      }
    } catch (e) {
      console.error("[obr-suite/bestiary] CapsLock toggle failed", e);
    }
  };

  try {
    await OBR.tool.createAction({
      id: TOOL_ACTION_TOGGLE,
      shortcut: "Shift+A",
      icons: [
        {
          icon: ICON_URL,
          label: "切换怪物图鉴",
          filter: { activeTools: [SELECT_TOOL, TOOL_ID] },
        },
      ],
      onClick: performShortcutToggle,
    });
  } catch (e) {
    console.error("[obr-suite/bestiary] createAction failed", e);
  }

  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/bestiary-shortcut-toggle", () => {
      performShortcutToggle();
    })
  );

  // Panel close button broadcasts → switch to default move tool.
  unsubs.push(
    OBR.broadcast.onMessage(CLOSE_MSG, async () => {
      try { await OBR.tool.activateTool("rodeo.owlbear.tool/move"); }
      catch { await closePanel(); }
    })
  );

  // --- DM-only monster info popover ---
  try { bestiaryRole = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  if (bestiaryRole !== "GM") return;

  // --- Right-click context menu: bind / rebind / unbind ---
  // Three entries with mutually-exclusive filters keyed on the
  // `BESTIARY_SLUG_KEY` metadata so each token only ever shows the
  // entry that makes sense for its current state.
  const openPicker = async (itemId: string) => {
    try {
      await OBR.modal.open({
        id: PICKER_MODAL_ID,
        url: `${POPOVER_URL}?pickerForItemId=${encodeURIComponent(itemId)}`,
        width: 400,
        height: 600,
      });
    } catch (e) {
      console.error("[obr-suite/bestiary] open picker failed", e);
    }
  };
  try {
    await OBR.contextMenu.create({
      id: CTX_BIND,
      icons: [
        {
          icon: ICON_URL,
          label: "绑定怪物图鉴",
          filter: {
            roles: ["GM"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: ["metadata", BESTIARY_SLUG_KEY], value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        const id = ctx.items[0]?.id;
        if (id) void openPicker(id);
      },
    });
    await OBR.contextMenu.create({
      id: CTX_REBIND,
      icons: [
        {
          icon: ICON_URL,
          label: "更换怪物图鉴",
          filter: {
            roles: ["GM"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: ["metadata", BESTIARY_SLUG_KEY], operator: "!=", value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        const id = ctx.items[0]?.id;
        if (id) void openPicker(id);
      },
    });
    await OBR.contextMenu.create({
      id: CTX_UNBIND,
      icons: [
        {
          icon: ICON_URL,
          label: "移除怪物图鉴绑定",
          filter: {
            roles: ["GM"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: ["metadata", BESTIARY_SLUG_KEY], operator: "!=", value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: async (ctx) => {
        const ids = ctx.items.map((i) => i.id);
        if (ids.length === 0) return;
        try {
          await OBR.scene.items.updateItems(ids, (drafts) => {
            for (const d of drafts) {
              delete d.metadata[BESTIARY_SLUG_KEY];
              // Bubbles HP/AC and the bound name are kept — the user
              // may want to re-bind later or just continue without
              // the stat-block link. Only the slug reference is
              // removed, which is what disables the auto-popup +
              // info popover behavior.
            }
          });
        } catch (e) {
          console.error("[obr-suite/bestiary] unbind failed", e);
        }
      },
    });
  } catch (e) {
    console.error("[obr-suite/bestiary] context menu register failed", e);
  }

  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (!ready) await closeInfoPopover();
    })
  );

  unsubs.push(
    OBR.player.onChange(async (player) => {
      try { await handleSelection(player.selection); } catch {}
    })
  );

  try {
    const sel = await OBR.player.getSelection();
    await handleSelection(sel);
  } catch {}

  unsubs.push(
    OBR.broadcast.onMessage(AUTO_POPUP_TOGGLE_MSG, async () => {
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    })
  );

  unsubs.push(
    OBR.scene.items.onChange(async () => {
      if (!currentInfoSlug) return;
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    })
  );

  // DM-only group-saves popover. Auto-shows when 2+ selected tokens
  // are all bestiary-bound monsters. Lifecycle is paired with the
  // bestiary module's own setup/teardown.
  await setupGroupSaves();
}

export async function teardownBestiary(): Promise<void> {
  await teardownGroupSaves();
  await closePanel();
  await closeInfoPopover();
  try { await OBR.modal.close(PICKER_MODAL_ID); } catch {}
  try { await OBR.tool.removeAction(TOOL_ACTION_TOGGLE); } catch {}
  try { await OBR.tool.removeMode(`${TOOL_ID}/mode`); } catch {}
  try { await OBR.tool.remove(TOOL_ID); } catch {}
  try { await OBR.contextMenu.remove(CTX_BIND); } catch {}
  try { await OBR.contextMenu.remove(CTX_REBIND); } catch {}
  try { await OBR.contextMenu.remove(CTX_UNBIND); } catch {}
  for (const u of unsubs.splice(0)) u();
}
