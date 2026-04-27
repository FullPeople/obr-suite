import OBR from "@owlbear-rodeo/sdk";

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
const POPOVER_URL = "https://obr.dnd.center/suite/bestiary-panel.html";
const INFO_URL = "https://obr.dnd.center/suite/bestiary-monster-info.html";
const ICON_URL = "https://obr.dnd.center/suite/bestiary-icon.svg";

const BESTIARY_SLUG_KEY = `${PLUGIN_ID}/slug`;
const INFO_SHOW_MSG = `${PLUGIN_ID}/info-show`;
const AUTO_POPUP_KEY = `${PLUGIN_ID}/auto-popup`;
const AUTO_POPUP_TOGGLE_MSG = `${PLUGIN_ID}/auto-popup-toggled`;
const CLOSE_MSG = `${PLUGIN_ID}/close`;

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

  // Open / close panel based on which tool is active.
  unsubs.push(
    OBR.tool.onToolChange(async (activeId) => {
      if (activeId === TOOL_ID) {
        if (!isOpen) await openPanel();
      } else {
        if (isOpen) await closePanel();
      }
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
}

export async function teardownBestiary(): Promise<void> {
  await closePanel();
  await closeInfoPopover();
  try { await OBR.tool.removeMode(`${TOOL_ID}/mode`); } catch {}
  try { await OBR.tool.remove(TOOL_ID); } catch {}
  for (const u of unsubs.splice(0)) u();
}
