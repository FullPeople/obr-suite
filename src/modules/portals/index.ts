import OBR, { buildImage, buildShape, Item } from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  PORTAL_KEY,
  PortalMeta,
} from "./types";

// Portal module — DM draws a circle with the tool, the area becomes a
// teleport trigger zone marked by an SVG icon at its center. Tokens dragged
// into a visible portal trigger a destination prompt: pick another portal
// with the same `tag`, all selected tokens teleport there in a hex spiral.
//
// Hidden portals (`visible=false`) are out-only — DM sees them translucent,
// players can't see them, and the entry detector skips them, but their
// names still appear in destination lists.

const TOOL_ID = `${PLUGIN_ID}/tool`;
const TOOL_MODE_ID = `${PLUGIN_ID}/mode`;
const PREVIEW_ID = `${PLUGIN_ID}/draw-preview`;

const EDIT_POPOVER_ID = `${PLUGIN_ID}/edit-popover`;
const EDIT_URL = "https://obr.dnd.center/suite/portal-edit.html";
const EDIT_W = 360;
const EDIT_H = 320;
const EDIT_TOP_OFFSET = 60;

const DEST_MODAL_ID = `${PLUGIN_ID}/destination-modal`;
const DEST_URL = "https://obr.dnd.center/suite/portal-destination.html";

const ICON_URL = "https://obr.dnd.center/suite/portal-icon.svg";
const TOOL_ICON_URL = "https://obr.dnd.center/suite/portal-tool-icon.svg";

const ICON_SIZE = 96; // image px (intrinsic SVG box × ~1.5)
const MIN_RADIUS = 30; // ignore drags shorter than this (treated as click)

// Broadcast channels (LOCAL only — single client lifecycle):
const BROADCAST_TELEPORT = `${PLUGIN_ID}/teleport`;
const BROADCAST_EDIT_SAVE = `${PLUGIN_ID}/edit-save`;
const BROADCAST_EDIT_DELETE = `${PLUGIN_ID}/edit-delete`;
const BROADCAST_EDIT_CLOSE = `${PLUGIN_ID}/edit-close`;

const unsubs: Array<() => void> = [];
let role: "GM" | "PLAYER" = "PLAYER";

// --- Drag-to-draw state ---
let dragStart: { x: number; y: number } | null = null;
let previewItemId: string | null = null;

// --- Local-player containment tracking (entry detection) ---
// Maps each token id we currently track to the portal id it's inside (or
// null). Only items in OBR.player.getSelection() are tracked. When a token
// transitions from null → portalId on a *visible* portal, we open the
// destination modal once with the local player's full selection.
const myPortalContainment = new Map<string, string | null>();
let lastSelection: string[] = [];
let destModalOpen = false;

// --- DM auto-edit-popover when single portal selected ---
let editPopoverOpen = false;
let currentEditId: string | null = null;
// Skip the auto-popover the first time selection becomes the portal we
// just created — the post-draw flow opens the popover explicitly with
// isNew=1 and we don't want it racing with the selection-watcher.
let suppressAutoEditOnce: string | null = null;

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function isPortal(it: Item): boolean {
  return !!it.metadata[PORTAL_KEY];
}

function readPortalMeta(it: Item): PortalMeta | null {
  const m = it.metadata[PORTAL_KEY];
  if (!m || typeof m !== "object") return null;
  const mm = m as any;
  if (typeof mm.tag !== "string") return null;
  return {
    name: typeof mm.name === "string" ? mm.name : "",
    tag: mm.tag,
    radius: typeof mm.radius === "number" && mm.radius > 0 ? mm.radius : 70,
  };
}

// --- Drag preview (local-only circle) -------------------------------------

async function startPreview(center: { x: number; y: number }) {
  try {
    // Shape position = top-left of bounding box; circle is drawn inside.
    // Start with radius=1 so the preview is invisible until the user drags.
    const shape = buildShape()
      .shapeType("CIRCLE")
      .width(2)
      .height(2)
      .position({ x: center.x - 1, y: center.y - 1 })
      .strokeColor("#a78bfa")
      .strokeWidth(2)
      .strokeOpacity(0.9)
      .fillColor("#6366f1")
      .fillOpacity(0.18)
      .layer("DRAWING")
      .locked(true)
      .disableHit(true)
      .visible(true)
      .metadata({ [`${PLUGIN_ID}/preview`]: true })
      .build();
    await OBR.scene.local.addItems([shape]);
    previewItemId = shape.id;
  } catch (e) {
    console.error("[obr-suite/portals] startPreview failed", e);
  }
}

async function updatePreview(center: { x: number; y: number }, radius: number) {
  if (!previewItemId) return;
  const d = Math.max(2, radius * 2);
  try {
    await OBR.scene.local.updateItems([previewItemId], (drafts) => {
      for (const dr of drafts) {
        dr.position = { x: center.x - radius, y: center.y - radius };
        (dr as any).width = d;
        (dr as any).height = d;
      }
    });
  } catch {}
}

async function clearPreview() {
  if (!previewItemId) return;
  try { await OBR.scene.local.deleteItems([previewItemId]); } catch {}
  previewItemId = null;
}

// --- Create portal --------------------------------------------------------

async function createPortal(center: { x: number; y: number }, radius: number) {
  const meta: PortalMeta = { name: "", tag: "", radius };
  const half = ICON_SIZE / 2;
  const img = buildImage(
    {
      width: ICON_SIZE,
      height: ICON_SIZE,
      url: ICON_URL,
      mime: "image/svg+xml",
    },
    { dpi: ICON_SIZE, offset: { x: half, y: half } }
  )
    .position(center)
    .name("传送门")
    .layer("PROP")
    .visible(true)
    .locked(false)
    .metadata({ [PORTAL_KEY]: meta })
    .build();
  await OBR.scene.items.addItems([img]);
  // Open the edit popover for the just-created portal so the DM can name it.
  suppressAutoEditOnce = img.id;
  await openEditPopover(img.id, true);
}

// --- Edit popover ---------------------------------------------------------

async function openEditPopover(portalId: string, isNew: boolean) {
  if (editPopoverOpen && currentEditId === portalId) return;
  if (editPopoverOpen) await closeEditPopover();
  try {
    const vw = await OBR.viewport.getWidth();
    const url = `${EDIT_URL}?id=${encodeURIComponent(portalId)}${isNew ? "&isNew=1" : ""}`;
    await OBR.popover.open({
      id: EDIT_POPOVER_ID,
      url,
      width: EDIT_W,
      height: EDIT_H,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(vw / 2), top: EDIT_TOP_OFFSET },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: false,
    });
    editPopoverOpen = true;
    currentEditId = portalId;
  } catch (e) {
    console.error("[obr-suite/portals] openEditPopover failed", e);
  }
}

async function closeEditPopover() {
  try { await OBR.popover.close(EDIT_POPOVER_ID); } catch {}
  editPopoverOpen = false;
  currentEditId = null;
}

// --- DM selection watcher → auto edit popover -----------------------------

async function handleDMSelectionForEdit(selection: string[] | undefined) {
  if (role !== "GM") return;
  if (!selection || selection.length !== 1) {
    if (editPopoverOpen) await closeEditPopover();
    return;
  }
  const id = selection[0];
  if (suppressAutoEditOnce === id) {
    // The post-draw open already handled this id once.
    suppressAutoEditOnce = null;
    return;
  }
  let portalItem: Item | null = null;
  try {
    const items = await OBR.scene.items.getItems([id]);
    if (items.length > 0 && isPortal(items[0])) portalItem = items[0];
  } catch {}
  if (!portalItem) {
    if (editPopoverOpen) await closeEditPopover();
    return;
  }
  if (currentEditId === portalItem.id && editPopoverOpen) return;
  await openEditPopover(portalItem.id, false);
}

// --- Token entry detection ------------------------------------------------

async function refreshContainment(allItems?: Item[]) {
  let items = allItems;
  if (!items) {
    try { items = await OBR.scene.items.getItems(); } catch { return; }
  }

  let selection: string[] = [];
  try {
    const s = await OBR.player.getSelection();
    selection = s ?? [];
  } catch {}

  // Drop tracking for tokens that are no longer selected.
  if (selection.join("|") !== lastSelection.join("|")) {
    for (const id of [...myPortalContainment.keys()]) {
      if (!selection.includes(id)) myPortalContainment.delete(id);
    }
    lastSelection = selection;
  }
  if (selection.length === 0) return;

  const portals = items.filter(isPortal);
  if (portals.length === 0) return;

  const visiblePortals = portals.filter((p) => p.visible);

  let entered: { tokenId: string; portal: Item } | null = null;
  for (const tok of items) {
    if (!selection.includes(tok.id)) continue;
    if (tok.layer !== "CHARACTER" && tok.layer !== "MOUNT") continue;
    if (isPortal(tok)) continue;
    // Find the visible portal currently containing this token (if any).
    let inside: Item | null = null;
    for (const p of visiblePortals) {
      const pm = readPortalMeta(p);
      if (!pm) continue;
      if (dist(tok.position, p.position) <= pm.radius) {
        inside = p;
        break;
      }
    }
    const prev = myPortalContainment.get(tok.id) ?? null;
    const cur = inside?.id ?? null;
    if (cur !== prev) {
      myPortalContainment.set(tok.id, cur);
      if (cur && !entered) entered = { tokenId: tok.id, portal: inside! };
    }
  }

  if (entered) {
    await openDestinationModal(entered.portal, items, selection);
  }
}

// --- Destination modal ----------------------------------------------------

async function openDestinationModal(
  entryPortal: Item,
  allItems: Item[],
  selectedTokenIds: string[]
) {
  if (destModalOpen) return;
  const entryMeta = readPortalMeta(entryPortal);
  if (!entryMeta) return;

  const candidates = allItems
    .filter(isPortal)
    .filter((p) => p.id !== entryPortal.id)
    .map((p) => {
      const m = readPortalMeta(p);
      if (!m) return null;
      if (m.tag !== entryMeta.tag) return null;
      return {
        id: p.id,
        name: m.name || "(未命名)",
        tag: m.tag,
        hidden: !p.visible,
      };
    })
    .filter(Boolean) as Array<{ id: string; name: string; tag: string; hidden: boolean }>;

  if (candidates.length === 0) return; // No destinations — silent

  // Filter token ids to only the moveable ones (CHARACTER/MOUNT in selection)
  const tokenIds = allItems
    .filter(
      (i) =>
        selectedTokenIds.includes(i.id) &&
        (i.layer === "CHARACTER" || i.layer === "MOUNT") &&
        !isPortal(i)
    )
    .map((i) => i.id);
  if (tokenIds.length === 0) return;

  destModalOpen = true;
  const payload = {
    entryName: entryMeta.name || "(未命名)",
    entryTag: entryMeta.tag,
    candidates,
    tokenIds,
  };
  const url = `${DEST_URL}?p=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    await OBR.modal.open({
      id: DEST_MODAL_ID,
      url,
      width: 380,
      height: Math.min(420, 140 + candidates.length * 48),
    });
  } catch (e) {
    console.error("[obr-suite/portals] openDestinationModal failed", e);
    destModalOpen = false;
  }
}

async function closeDestinationModal() {
  try { await OBR.modal.close(DEST_MODAL_ID); } catch {}
  destModalOpen = false;
}

// --- Teleport: gather tokens around destination portal --------------------

async function teleport(destPortalId: string, tokenIds: string[]) {
  if (tokenIds.length === 0) return;
  let dest: Item | null = null;
  try {
    const fetched = await OBR.scene.items.getItems([destPortalId]);
    if (fetched.length > 0) dest = fetched[0];
  } catch {}
  if (!dest) return;

  const center = { x: dest.position.x, y: dest.position.y };

  let dpi = 150;
  try { dpi = await OBR.scene.grid.getDpi(); } catch {}
  const spacing = dpi;

  // Hex-ring spiral, same algorithm as initiative "gather here".
  const positions: { x: number; y: number }[] = [
    { x: center.x, y: center.y },
  ];
  let ring = 1;
  while (positions.length < tokenIds.length) {
    const count = ring * 6;
    for (let i = 0; i < count && positions.length < tokenIds.length; i++) {
      const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
      positions.push({
        x: center.x + Math.cos(angle) * spacing * ring,
        y: center.y + Math.sin(angle) * spacing * ring,
      });
    }
    ring++;
  }

  try {
    await OBR.scene.items.updateItems(tokenIds, (drafts) => {
      drafts.forEach((d, idx) => {
        if (positions[idx]) d.position = positions[idx];
      });
    });
  } catch (e) {
    console.error("[obr-suite/portals] teleport updateItems failed", e);
  }

  // Mark these tokens' containment as the destination so they don't
  // immediately re-trigger the prompt for landing inside the dest portal.
  const destMeta = readPortalMeta(dest);
  if (destMeta) {
    for (const id of tokenIds) {
      myPortalContainment.set(id, dest.id);
    }
  }
}

// --- Setup / teardown -----------------------------------------------------

export async function setupPortals(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // GM-only tool icon. Players don't need the draw tool — they only get the
  // entry detector + destination prompt path.
  if (role === "GM") {
    await OBR.tool.create({
      id: TOOL_ID,
      icons: [
        {
          icon: TOOL_ICON_URL,
          label: "传送门",
          filter: { roles: ["GM"] },
        },
      ],
      onClick: async () => {
        await OBR.tool.activateTool(TOOL_ID);
        return false;
      },
    });

    await OBR.tool.createMode({
      id: TOOL_MODE_ID,
      icons: [
        {
          icon: TOOL_ICON_URL,
          label: "画圈创建传送门",
          filter: { activeTools: [TOOL_ID] },
        },
      ],
      cursors: [{ cursor: "crosshair" }],
      onToolDragStart: async (_ctx, event) => {
        // If the drag began on an existing portal item, don't draw — let
        // OBR handle the move/select instead.
        const target: any = (event as any).target;
        if (target && target.metadata && target.metadata[PORTAL_KEY]) {
          dragStart = null;
          return;
        }
        const p = (event as any).pointerPosition as { x: number; y: number };
        if (!p) return;
        dragStart = { x: p.x, y: p.y };
        await startPreview(p);
      },
      onToolDragMove: async (_ctx, event) => {
        if (!dragStart) return;
        const p = (event as any).pointerPosition as { x: number; y: number };
        if (!p) return;
        const r = dist(dragStart, p);
        await updatePreview(dragStart, r);
      },
      onToolDragEnd: async (_ctx, event) => {
        if (!dragStart) return;
        const p = (event as any).pointerPosition as { x: number; y: number };
        const center = dragStart;
        await clearPreview();
        dragStart = null;
        if (!p) return;
        const r = dist(center, p);
        if (r < MIN_RADIUS) return; // Treat as click — no portal created.
        await createPortal(center, r);
      },
      onToolDragCancel: async () => {
        dragStart = null;
        await clearPreview();
      },
    });
  }

  // Selection watcher (DM): single-portal selection → edit popover.
  unsubs.push(
    OBR.player.onChange(async (player) => {
      try {
        if (role === "GM") await handleDMSelectionForEdit(player.selection);
      } catch {}
      // Selection change also feeds containment tracking for everyone.
      await refreshContainment();
    })
  );

  // Item changes feed both DM edit (item could be deleted) and player entry
  // detection.
  unsubs.push(
    OBR.scene.items.onChange(async (items) => {
      // If the currently-edited portal disappeared, close the popover.
      if (editPopoverOpen && currentEditId) {
        if (!items.find((i) => i.id === currentEditId)) {
          await closeEditPopover();
        }
      }
      await refreshContainment(items);
    })
  );

  // Destination modal → teleport.
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_TELEPORT, async (msg) => {
      const data = msg.data as
        | { destPortalId: string; tokenIds: string[] }
        | undefined;
      if (!data) return;
      destModalOpen = false;
      await teleport(data.destPortalId, data.tokenIds);
    })
  );

  // Edit popover save / delete / close (broadcast from edit page back to bg).
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_EDIT_SAVE, async (msg) => {
      const data = msg.data as
        | { id: string; name: string; tag: string }
        | undefined;
      if (!data) return;
      try {
        await OBR.scene.items.updateItems([data.id], (drafts) => {
          for (const d of drafts) {
            const cur = (d.metadata[PORTAL_KEY] as PortalMeta | undefined) ?? {
              name: "",
              tag: "",
              radius: 70,
            };
            d.metadata[PORTAL_KEY] = {
              name: data.name,
              tag: data.tag,
              radius: cur.radius,
            };
          }
        });
      } catch (e) {
        console.error("[obr-suite/portals] save failed", e);
      }
    })
  );
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_EDIT_DELETE, async (msg) => {
      const data = msg.data as { id: string } | undefined;
      if (!data) return;
      try { await OBR.scene.items.deleteItems([data.id]); } catch {}
      await closeEditPopover();
    })
  );
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_EDIT_CLOSE, async () => {
      await closeEditPopover();
    })
  );

  // Modal-close detector: if the user closes the destination modal via OBR
  // (Esc / X), reset the in-flight flag. There's no direct "modal closed"
  // event, so use a broadcast from the modal's beforeunload as the signal.
  unsubs.push(
    OBR.broadcast.onMessage(`${PLUGIN_ID}/dest-modal-closed`, () => {
      destModalOpen = false;
    })
  );

  // Initial pass — fire entry detection if user already has selection.
  await refreshContainment();
}

export async function teardownPortals(): Promise<void> {
  await closeEditPopover();
  await closeDestinationModal();
  await clearPreview();
  if (role === "GM") {
    try { await OBR.tool.removeMode(TOOL_MODE_ID); } catch {}
    try { await OBR.tool.remove(TOOL_ID); } catch {}
  }
  for (const u of unsubs.splice(0)) u();
  myPortalContainment.clear();
  lastSelection = [];
}
