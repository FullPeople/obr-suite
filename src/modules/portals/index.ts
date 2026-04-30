import OBR, { buildImage, Item } from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  PORTAL_KEY,
  PortalMeta,
} from "./types";
import { t } from "../../i18n";
import { getLocalLang } from "../../state";

const _lang = () => getLocalLang();
const _t = (k: Parameters<typeof t>[1]) => t(_lang(), k);

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
const EDIT_W = 380;
const EDIT_H = 540;
const EDIT_TOP_OFFSET = 60;

const DEST_MODAL_ID = `${PLUGIN_ID}/destination-modal`;
const DEST_URL = "https://obr.dnd.center/suite/portal-destination.html";

const ICON_URL = "https://obr.dnd.center/suite/portal-icon.svg";
const TOOL_ICON_URL = "https://obr.dnd.center/suite/portal-tool-icon.svg";

// Intrinsic SVG box. Visible glow fills this edge-to-edge so the
// rendered diameter == 2 × trigger radius.
const ICON_INTRINSIC = 64;
// Default base size for OBR's image grid.dpi math — matches the SVG.
const ICON_SIZE = ICON_INTRINSIC;
const MIN_RADIUS = 16; // ignore drags shorter than this (treated as click)

// Broadcast channels (LOCAL only — single client lifecycle):
const BROADCAST_TELEPORT = `${PLUGIN_ID}/teleport`;
const BROADCAST_EDIT_SAVE = `${PLUGIN_ID}/edit-save`;
const BROADCAST_EDIT_DELETE = `${PLUGIN_ID}/edit-delete`;
const BROADCAST_EDIT_CLOSE = `${PLUGIN_ID}/edit-close`;

const unsubs: Array<() => void> = [];
let role: "GM" | "PLAYER" = "PLAYER";

// --- Drag-to-draw state ---
// `dragStart` is the user's first pointerdown — it becomes the CENTER
// of the portal trigger zone. The drag distance from start to cursor
// = the trigger radius. While dragging, a LIVE PREVIEW of the actual
// SVG icon is rendered locally (OBR.scene.local) so the user sees the
// final size grow in real-time. On drag-end the preview is removed
// and the real portal is committed to scene metadata.
let dragStart: { x: number; y: number } | null = null;
let previewItemId: string | null = null;

// --- Drag-end portal entry detection ---
//
// Strategy: when the local player's selected token's position changes,
// start a debounce timer. If no further position change for the token
// arrives within DRAG_END_MS, treat that as "drag end" and check if
// the token now sits inside a (visible) portal. If yes, open the
// destination modal.
//
// This replaces the earlier containment state machine which had two
// nasty failure modes:
//   1. Re-trigger immediately after a teleport (token lands inside the
//      destination portal → state machine fires again).
//   2. State got stuck "inside portal X" if selection changed mid-drag
//      → no future entries could fire.
// The drag-end approach has zero accumulated state per token; each
// drag-end is evaluated fresh against the current world.
const DRAG_END_MS = 350;
let dragEndTimer: ReturnType<typeof setTimeout> | null = null;
const lastTokenPos = new Map<string, { x: number; y: number }>();
// Tokens just teleported by this client — their drag-end check is
// suppressed for SUPPRESS_AFTER_TELEPORT_MS to swallow the
// programmatic position change. Window is just long enough to cover
// the post-update debounce (DRAG_END_MS + a buffer); legitimate user
// drags landing AFTER the window fire normally.
const SUPPRESS_AFTER_TELEPORT_MS = 700;
const recentlyTeleported = new Map<string, number>();
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

// The portal item's `position` is the world coord where the image's
// `offset` point lands. We always set offset to image-center, so
// `position` IS the geometric center of the visible icon — same
// pattern OBR's bestiary spawn uses.
function portalCenter(it: Item): { x: number; y: number } {
  return { x: it.position.x, y: it.position.y };
}

// --- Live preview (local-only, scales with the drag) ---------------------

async function startPreview(center: { x: number; y: number }) {
  try {
    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
    const half = ICON_SIZE / 2;
    // Start at scale = MIN_RADIUS so the preview is visible from the
    // very first move event instead of popping in at frame 2.
    const s = (2 * MIN_RADIUS) / sceneDpi;
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
      .scale({ x: s, y: s })
      .layer("DRAWING")
      .locked(true)
      .disableHit(true)
      .visible(true)
      .metadata({ [`${PLUGIN_ID}/preview`]: true })
      .build();
    await OBR.scene.local.addItems([img]);
    previewItemId = img.id;
  } catch (e) {
    console.error("[obr-suite/portals] startPreview failed", e);
  }
}

async function updatePreview(center: { x: number; y: number }, radius: number) {
  if (!previewItemId) return;
  try {
    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
    const s = (2 * radius) / sceneDpi;
    await OBR.scene.local.updateItems([previewItemId], (drafts) => {
      for (const d of drafts) {
        d.position = { x: center.x, y: center.y };
        d.scale = { x: s, y: s };
      }
    });
  } catch {}
}

async function clearPreview() {
  if (!previewItemId) return;
  const id = previewItemId;
  previewItemId = null;
  try { await OBR.scene.local.deleteItems([id]); } catch {}
}

// --- Create portal --------------------------------------------------------

async function createPortal(center: { x: number; y: number }, radius: number) {
  const meta: PortalMeta = { name: "", tag: "", radius };
  // Same pattern as the bestiary's monster spawn (modules/bestiary/spawn.ts):
  //   - dpi = ICON_SIZE → with scale=1 the icon renders at exactly 1 cell.
  //   - offset = image-center → OBR places the offset point at `position`,
  //     so `position` IS the world-coord center of the visible icon.
  //   - .scale() multiplies the displayed size LINEARLY around the offset
  //     point, so radius doubling → diameter doubling (no geometric blow-up).
  // The trigger zone is invisible — only the SVG renders. Setting
  // `locked(false)` + no `disableHit` keeps the item selectable and
  // deletable via OBR's built-in handles.
  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
  const half = ICON_SIZE / 2;
  // Linear scale: visible diameter = 2 × radius scene-pixels.
  // Base render (scale=1) = 1 grid cell = sceneDpi scene-pixels.
  const s = (2 * radius) / sceneDpi;
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
    .scale({ x: s, y: s })
    .name(_t("portalToolName"))
    .layer("PROP")
    .visible(true)
    .locked(false)
    .metadata({ [PORTAL_KEY]: meta })
    .build();
  await OBR.scene.items.addItems([img]);
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
      // disableClickAway:true so OBR doesn't insert a viewport-wide
      // invisible click-catcher overlay (which the user perceives as
      // "a mouse-event mask"). Clicks outside the popover go straight
      // to the canvas (move tokens / open menus / etc.); the popover
      // is dismissed only via its own X / 取消 / 保存 / 删除 buttons.
      disableClickAway: true,
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

// --- Drag-end portal entry detection --------------------------------------

// Called from scene.items.onChange. Tracks tokens this client cares
// about — selection (whatever's actively highlighted) PLUS tokens
// the local player owns (createdUserId match). The ownership fallback
// is what makes portals work for PLAYERS who drag without keeping a
// selection — earlier the selection-only check meant only the GM
// (who tends to keep things selected) reliably triggered teleport.
//
// Whenever any of these tokens' positions change, restart a debounce
// timer; if no further change for DRAG_END_MS, treat as drag-end.
async function getCareAboutTokenIds(): Promise<Set<string>> {
  const careAbout = new Set<string>();
  try {
    const s = await OBR.player.getSelection();
    if (s) for (const id of s) careAbout.add(id);
  } catch {}
  let myId = "";
  try { myId = await OBR.player.getId(); } catch {}
  if (myId) {
    // Owner-fallback: for PLAYERS, this picks up "I created this
    // token" (their own characters / summons). For GM, it includes
    // everything they spawned which is fine — we only act on tokens
    // that actually moved AND sit on a portal, so broad inclusion
    // is safe.
    try {
      const all = await OBR.scene.items.getItems(
        (it: Item) => it.createdUserId === myId,
      );
      for (const it of all) careAbout.add(it.id);
    } catch {}
  }
  return careAbout;
}

async function onItemsMaybeDragging(items: Item[]) {
  const careAbout = await getCareAboutTokenIds();
  if (careAbout.size === 0) return;

  let moved = false;
  for (const it of items) {
    if (!careAbout.has(it.id)) continue;
    if (it.layer !== "CHARACTER" && it.layer !== "MOUNT") continue;
    if (isPortal(it)) continue;
    const prev = lastTokenPos.get(it.id);
    if (!prev || prev.x !== it.position.x || prev.y !== it.position.y) {
      lastTokenPos.set(it.id, { x: it.position.x, y: it.position.y });
      moved = true;
    }
  }

  if (!moved) return;
  if (dragEndTimer) clearTimeout(dragEndTimer);
  dragEndTimer = setTimeout(() => {
    dragEndTimer = null;
    onDragEnd().catch(() => {});
  }, DRAG_END_MS);
}

// Evaluates the world fresh: is any "I care about" token currently
// sitting inside a visible portal? If yes, open the destination
// modal — only on this client, only with this client's owned tokens
// as candidates for teleport.
async function onDragEnd() {
  if (destModalOpen) return;
  const careAbout = await getCareAboutTokenIds();
  if (careAbout.size === 0) return;

  let items: Item[];
  try { items = await OBR.scene.items.getItems(); } catch { return; }

  const portals = items.filter(isPortal);
  if (portals.length === 0) return;
  const visiblePortals = portals.filter((p) => p.visible);
  if (visiblePortals.length === 0) return;

  const now = Date.now();
  // Sweep stale entries from recentlyTeleported.
  for (const [id, t] of recentlyTeleported) {
    if (now - t > SUPPRESS_AFTER_TELEPORT_MS) recentlyTeleported.delete(id);
  }

  for (const tok of items) {
    if (!careAbout.has(tok.id)) continue;
    if (tok.layer !== "CHARACTER" && tok.layer !== "MOUNT") continue;
    if (isPortal(tok)) continue;
    if (recentlyTeleported.has(tok.id)) continue; // Just teleported here.
    for (const p of visiblePortals) {
      const pm = readPortalMeta(p);
      if (!pm) continue;
      if (dist(tok.position, portalCenter(p)) <= pm.radius) {
        // Only this client opens the modal (OBR.modal is local). Pass
        // the careAbout set so the resulting teleport only considers
        // tokens this client has the right to move — the destination
        // page returns these via BROADCAST_TELEPORT and the listener
        // running on this same client uses OBR.scene.items.updateItems
        // which OBR's permission layer enforces.
        await openDestinationModal(p, items, [...careAbout]);
        return; // Only one modal, one entry.
      }
    }
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
        name: m.name || _t("portalUnnamed"),
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
  // Hard safety net: after 60 s the flag is force-reset so a missed
  // close-signal can't permanently lock the entry detector. The modal
  // page itself sends close on click/cancel/Esc/unload, so this is
  // pure paranoia — but the cost of getting stuck once was bad enough
  // (user reported the bug), so the safety net stays.
  setTimeout(() => { destModalOpen = false; }, 60_000);
  const payload = {
    entryName: entryMeta.name || _t("portalUnnamed"),
    entryTag: entryMeta.tag,
    candidates,
    tokenIds,
  };
  const url = `${DEST_URL}?p=${encodeURIComponent(JSON.stringify(payload))}`;
  // Height fits content up to THREE candidates without inner scroll;
  // 4+ candidates use the 3-item height and scroll inside the .list
  // pane. Per-item row + gap ≈ 50px. Header (title + sub line) +
  // bottom button bar + paddings ≈ 180px.
  const ITEM_H = 50;
  const BASE = 180;
  const visibleItems = Math.min(Math.max(candidates.length, 1), 3);
  const height = BASE + visibleItems * ITEM_H;
  try {
    await OBR.modal.open({
      id: DEST_MODAL_ID,
      url,
      width: 380,
      height,
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

// Snapshotted light metadata so the post-teleport restore knows the
// original values. Map<tokenId, Record<metadataKey, originalValue>>.
type LightSnapshot = Map<string, Record<string, any>>;

// Detect "light source" metadata entries on an item — keys whose value
// is an object with `attenuationRadius` or `sourceRadius`. Covers
// OBR's official Dynamic Fog (`rodeo.owlbear.dynamic-fog/light`) and
// any other extension following the same shape. Returns the literal
// key names so we can restore them by-name later.
function findLightKeys(metadata: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if ("attenuationRadius" in o || "sourceRadius" in o) keys.push(k);
  }
  return keys;
}

async function snapshotLightMetadata(tokenIds: string[]): Promise<LightSnapshot> {
  const snap: LightSnapshot = new Map();
  try {
    const items = await OBR.scene.items.getItems(tokenIds);
    for (const it of items) {
      const keys = findLightKeys(it.metadata as Record<string, unknown>);
      if (keys.length === 0) continue;
      const captured: Record<string, any> = {};
      for (const k of keys) captured[k] = (it.metadata as any)[k];
      snap.set(it.id, captured);
    }
  } catch (e) {
    console.warn("[obr-suite/portals] snapshotLightMetadata failed", e);
  }
  return snap;
}

async function teleport(destPortalId: string, tokenIds: string[]) {
  if (tokenIds.length === 0) return;
  let dest: Item | null = null;
  try {
    const fetched = await OBR.scene.items.getItems([destPortalId]);
    if (fetched.length > 0) dest = fetched[0];
  } catch {}
  if (!dest) return;

  // Mark tokens as "just teleported" BEFORE any state changes. The
  // upcoming `updateItems` will fire `scene.items.onChange`, which
  // arms the drag-end debounce; without this guard set up-front, the
  // debounce would fire after ~350ms — before our suppress flag is
  // set — and `onDragEnd` would see the token sitting on the
  // destination portal and pop the modal a second time. Setting it
  // now (and clearing any in-flight debounce) makes the cancellation
  // unconditional for the entire suppress window.
  if (dragEndTimer) {
    clearTimeout(dragEndTimer);
    dragEndTimer = null;
  }
  const stamp = Date.now();
  for (const id of tokenIds) recentlyTeleported.set(id, stamp);

  let dpi = 150;
  try { dpi = await OBR.scene.grid.getDpi(); } catch {}
  const spacing = dpi;
  const center = portalCenter(dest);

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

  // Phase 1 — strip light metadata so dynamic-fog stops rejecting the
  // move. No animation: the user reported the gradual-shrink path
  // stuttered too much over OBR's metadata-update channel, so we
  // just delete-and-snap. All snapshot values restored verbatim in
  // Phase 3.
  const lightSnap = await snapshotLightMetadata(tokenIds);
  if (lightSnap.size > 0) {
    try {
      await OBR.scene.items.updateItems([...lightSnap.keys()], (drafts) => {
        for (const d of drafts) {
          const captured = lightSnap.get(d.id);
          if (!captured) continue;
          for (const k of Object.keys(captured)) delete (d.metadata as any)[k];
        }
      });
    } catch (e) {
      console.warn("[obr-suite/portals] strip light failed", e);
    }
  }

  // Phase 2 — actual position update.
  try {
    await OBR.scene.items.updateItems(tokenIds, (drafts) => {
      drafts.forEach((d, idx) => {
        if (positions[idx]) d.position = positions[idx];
      });
    });
  } catch (e) {
    console.error("[obr-suite/portals] teleport updateItems failed", e);
  }

  // Pan the local camera to the destination portal (only on the
  // originating client — BROADCAST_TELEPORT is LOCAL only). Same
  // pattern as the focus module: keep current zoom, center on portal.
  try {
    const [vw, vh, vpScale] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
      OBR.viewport.getScale(),
    ]);
    OBR.viewport.animateTo({
      position: {
        x: -center.x * vpScale + vw / 2,
        y: -center.y * vpScale + vh / 2,
      },
      scale: vpScale,
    }).catch(() => {});
  } catch {}

  // Phase 3 — restore the original light metadata values verbatim.
  if (lightSnap.size > 0) {
    try {
      await OBR.scene.items.updateItems([...lightSnap.keys()], (drafts) => {
        for (const d of drafts) {
          const captured = lightSnap.get(d.id);
          if (!captured) continue;
          for (const [key, original] of Object.entries(captured)) {
            (d.metadata as any)[key] = original;
          }
        }
      });
    } catch (e) {
      console.warn("[obr-suite/portals] restore light failed", e);
    }
  }

  // Refresh suppress timestamp at end so the full window covers any
  // additional items.onChange noise from Phase 3 metadata writes.
  const endStamp = Date.now();
  for (const id of tokenIds) recentlyTeleported.set(id, endStamp);
  // Belt-and-suspenders: also clear any debounce that armed during
  // teleport. With the recentlyTeleported guard the timer's onDragEnd
  // would no-op anyway, but cancelling it skips a wasted check.
  if (dragEndTimer) {
    clearTimeout(dragEndTimer);
    dragEndTimer = null;
  }
}

// --- Setup / teardown -----------------------------------------------------

// One-shot migration for portals created in plugin v0.x where the
// SVG image was 96×96. The shipped portal-icon.svg is now 64×64
// (matching ICON_INTRINSIC), and OBR logs a "content size 96 does
// not match image size 64" warning every time those legacy items
// render. Sweep them on setup and rewrite image.width / image.height
// to ICON_SIZE so the warning stops. Idempotent — items already at
// ICON_SIZE skip the update.
async function migrateLegacyPortalIconSize(): Promise<void> {
  try {
    const items = await OBR.scene.items.getItems(isPortal);
    const stale = items.filter((it: any) => {
      const w = it?.image?.width;
      const h = it?.image?.height;
      return (typeof w === "number" && w !== ICON_SIZE)
        || (typeof h === "number" && h !== ICON_SIZE);
    });
    if (stale.length === 0) return;
    await OBR.scene.items.updateItems(
      stale.map((it: any) => it.id),
      (drafts: any[]) => {
        for (const d of drafts) {
          if (d.image) {
            d.image.width = ICON_SIZE;
            d.image.height = ICON_SIZE;
          }
        }
      },
    );
  } catch (e) {
    console.warn("[obr-suite/portals] icon-size migration skipped", e);
  }
}

export async function setupPortals(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // Quietly normalise old portals (image.width/height = 96 from earlier
  // versions) to the current ICON_SIZE so OBR stops warning on every
  // render. Only the GM has scene-write permission, so we gate on role.
  if (role === "GM") {
    void migrateLegacyPortalIconSize();
  }

  // GM-only tool icon. Players don't need the draw tool — they only get the
  // entry detector + destination prompt path.
  if (role === "GM") {
    await OBR.tool.create({
      id: TOOL_ID,
      icons: [
        {
          icon: TOOL_ICON_URL,
          label: _t("portalToolName"),
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
          label: _t("portalToolHint"),
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
        dragStart = null;
        await clearPreview();
        if (!p) return;
        const radius = dist(center, p);
        if (radius < MIN_RADIUS) return; // Treat as click — no portal created.
        await createPortal(center, radius);
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
      // Drop the per-token last-position cache for any token no longer
      // selected. Prevents stale entries leaking memory and stops a
      // pending drag-end timer from firing on a deselected token.
      const sel = new Set(player.selection ?? []);
      for (const id of [...lastTokenPos.keys()]) {
        if (!sel.has(id)) lastTokenPos.delete(id);
      }
    })
  );

  // Item changes drive both DM edit (portal could be deleted) and the
  // player drag-end portal-entry check.
  unsubs.push(
    OBR.scene.items.onChange(async (items) => {
      if (editPopoverOpen && currentEditId) {
        if (!items.find((i) => i.id === currentEditId)) {
          await closeEditPopover();
        }
      }
      await onItemsMaybeDragging(items);
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

  // No initial pass — only player drag-end events trigger the modal.
  // If the player happens to have selected a token already inside a
  // portal at scene load, no modal opens until they drag the token.
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
  if (dragEndTimer) {
    clearTimeout(dragEndTimer);
    dragEndTimer = null;
  }
  lastTokenPos.clear();
  recentlyTeleported.clear();
}
