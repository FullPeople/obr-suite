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

const DEST_POPOVER_ID = `${PLUGIN_ID}/destination-popover`;
const DEST_URL = `${import.meta.env.BASE_URL}portal-destination.html`;

const BLINK_MODAL_ID = `${PLUGIN_ID}/blink-modal`;
const BLINK_URL = `${import.meta.env.BASE_URL}portal-blink.html`;

const ICON_URL = `${import.meta.env.BASE_URL}portal-icon.svg`;
const TOOL_ICON_URL = `${import.meta.env.BASE_URL}portal-tool-icon.svg`;

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
const BROADCAST_DEST_CLOSED = `${PLUGIN_ID}/dest-modal-closed`;
// Blink-effect handshake — see openBlinkAndTeleport() and portal-blink.html.
const BROADCAST_BLINK_PROCEED = `${PLUGIN_ID}/blink-proceed`;
const BROADCAST_BLINK_DONE = `${PLUGIN_ID}/blink-done`;

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
let destPopoverOpen = false;
let destPopoverSafetyTimer: ReturnType<typeof setTimeout> | null = null;
// Blink modal stays attached to the dest-popover lifecycle: when the
// modal is up we behave like the popover is up (no new portal entries
// fire) so a teleport in flight can't be interrupted by another drag.
let blinkModalOpen = false;
// Payload latched at destination-pick time. The blink modal asks for
// it via BROADCAST_BLINK_PROCEED at the apex of the close animation.
let pendingTeleport: { destPortalId: string; tokenIds: string[] } | null = null;

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

// === Drag-end portal entry detection ===
//
// Attribution is via `Item.lastModifiedUserId` — OBR sets this to
// the player who initiated the change (drag, metadata write, etc.).
// The reference plugin (gitlab.com/resident-uhlig/owlbear-rodeo-portals)
// uses the same approach and it's the only RELIABLE way to answer
// "did I just move this?" — neither selection nor createdUserId
// works:
//   • selection updates timing-race with item changes; sometimes
//     the new selection isn't reflected when items.onChange fires
//   • createdUserId tells you the OWNER, not the MOVER. DM has
//     write permission for player-owned tokens, so DM can drag
//     them — yet createdUserId stays as the player, mis-attributing
//     the move to whoever happens to own the token.
// `lastModifiedUserId` is the canonical OBR signal: whoever just
// wrote position is whoever should fire portal logic.
//
// Group teleport: when the user explicitly selects a party of N and
// drags ONE into the portal, all N should teleport. Group =
// (tokens I just moved) ∪ (current selection that's a CHARACTER /
// MOUNT). OBR's permission layer drops any token in the group that
// the dragger doesn't have write access to during the actual
// teleport's updateItems call.

const movedByMeIds = new Set<string>();

async function onItemsMaybeDragging(items: Item[]) {
  let myId = "";
  try { myId = await OBR.player.getId(); } catch {}
  if (!myId) return;

  let didMove = false;
  for (const it of items) {
    if (it.layer !== "CHARACTER" && it.layer !== "MOUNT") continue;
    if (isPortal(it)) continue;
    // Only attribute moves where THIS client is the last writer.
    // Other clients see the change but didn't initiate it.
    if ((it as any).lastModifiedUserId !== myId) {
      // Still update lastTokenPos so a subsequent move-by-me can
      // correctly diff against the latest known position.
      lastTokenPos.set(it.id, { x: it.position.x, y: it.position.y });
      continue;
    }
    const prev = lastTokenPos.get(it.id);
    if (prev && (prev.x !== it.position.x || prev.y !== it.position.y)) {
      movedByMeIds.add(it.id);
      didMove = true;
    }
    lastTokenPos.set(it.id, { x: it.position.x, y: it.position.y });
  }

  if (!didMove) return;
  if (dragEndTimer) clearTimeout(dragEndTimer);
  dragEndTimer = setTimeout(() => {
    dragEndTimer = null;
    onDragEnd().catch(() => {});
  }, DRAG_END_MS);
}

async function onDragEnd() {
  // Always drain movedByMeIds — even if we early-return below — so
  // accumulating IDs from a drag-during-modal session can't leak into
  // the next teleport's tokenIds. Ditto for clearing the per-token
  // last-position cache for entries we won't act on.
  const movedNow = new Set(movedByMeIds);
  movedByMeIds.clear();
  if (destPopoverOpen || blinkModalOpen) return;
  if (movedNow.size === 0) return;

  let items: Item[];
  try { items = await OBR.scene.items.getItems(); } catch { return; }

  const portals = items.filter(isPortal);
  if (portals.length === 0) return;
  const visiblePortals = portals.filter((p) => p.visible);
  if (visiblePortals.length === 0) return;

  const now = Date.now();
  for (const [id, t] of recentlyTeleported) {
    if (now - t > SUPPRESS_AFTER_TELEPORT_MS) recentlyTeleported.delete(id);
  }

  // Group-teleport candidates: ONLY the tokens this client actually
  // moved during the current drag. OBR's multi-select drag fires
  // change events for every token in the move (lastModifiedUserId =
  // this client), so movedNow already contains the full party. We
  // intentionally DO NOT union with the player's current selection —
  // that union was the source of "single drag still teleports the
  // multi-select party" because OBR keeps the previous multi-selection
  // around after a teleport, and a fresh single-token drag would inherit
  // it. movedNow is the canonical "what just moved" set.
  const groupCandidates = movedNow;

  // Trigger geometry: token center must enter the portal's visible
  // glow. Scale + offset math in createPortal() makes the rendered
  // image diameter = 2×pm.radius scene-units, so pm.radius is the
  // visible boundary radius. Earlier versions added the token's
  // image-bounds radius to extend the trigger; that turned out
  // to over-fire — token PNGs typically have transparent padding,
  // so the real visible character lives well inside the bounding
  // box, and the trigger radius would grow by 30-50% of the visible
  // mismatch. Using just pm.radius makes the trigger == the visible
  // ring, predictable for both DM and players.
  for (const tok of items) {
    if (!movedNow.has(tok.id)) continue;
    if (tok.layer !== "CHARACTER" && tok.layer !== "MOUNT") continue;
    if (isPortal(tok)) continue;
    if (recentlyTeleported.has(tok.id)) continue;
    for (const p of visiblePortals) {
      const pm = readPortalMeta(p);
      if (!pm) continue;
      const d = dist(tok.position, portalCenter(p));
      if (d <= pm.radius) {
        console.log("[obr-suite/portals] portal entry detected", {
          dragger: "this client",
          movedToken: tok.id,
          movedTokenName: tok.name,
          portal: p.id,
          tokenPos: tok.position,
          portalCenter: portalCenter(p),
          portalRadius: pm.radius,
          dist: d,
          groupCandidates: [...groupCandidates],
        });
        await openDestinationPopover(p, items, [...groupCandidates]);
        return;
      }
    }
  }
}

// --- Destination popover --------------------------------------------------
//
// Renders a small transparent bubble ABOVE the entered portal. The
// popover is anchored in screen-space (anchorReference: "POSITION"),
// so the user can still pan / click / drag elsewhere on the canvas
// while it's up. `disableClickAway: true` is REQUIRED so OBR doesn't
// insert its viewport-wide click-catcher overlay (the user reported
// the modal version blocked all canvas interaction). The popover is
// dismissed via its own × button, picking a destination, or pressing
// Esc inside it.

async function openDestinationPopover(
  entryPortal: Item,
  allItems: Item[],
  selectedTokenIds: string[]
) {
  if (destPopoverOpen || blinkModalOpen) return;
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

  // Filter token ids to only the moveable ones (CHARACTER/MOUNT)
  const tokenIds = allItems
    .filter(
      (i) =>
        selectedTokenIds.includes(i.id) &&
        (i.layer === "CHARACTER" || i.layer === "MOUNT") &&
        !isPortal(i)
    )
    .map((i) => i.id);
  if (tokenIds.length === 0) return;

  // Anchor: bottom-center of popover sits a few px above the portal's
  // visual top edge. Compute screen-space portal radius so the gap is
  // consistent regardless of zoom.
  const center = portalCenter(entryPortal);
  let screenX = 0;
  let screenY = 0;
  let portalScreenRadius = 32;
  try {
    const screen = await OBR.viewport.transformPoint(center);
    screenX = screen.x;
    screenY = screen.y;
    const vScale = await OBR.viewport.getScale();
    portalScreenRadius = entryMeta.radius * vScale;
  } catch {}

  // Clamp so the popover never lands outside the OBR viewport.
  let vw = 1280, vh = 720;
  try {
    [vw, vh] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  } catch {}

  const POPOVER_W = 240;
  const ITEM_H = 38;
  const BASE = 70; // header + paddings + tail
  const visibleItems = Math.min(Math.max(candidates.length, 1), 4);
  const POPOVER_H = BASE + visibleItems * ITEM_H;

  const GAP = 14;
  let anchorTop = screenY - portalScreenRadius - GAP;
  let placeBelow = false;
  // If there isn't room above, flip below the portal.
  if (anchorTop - POPOVER_H < 12) {
    anchorTop = screenY + portalScreenRadius + GAP;
    placeBelow = true;
  }
  let anchorLeft = screenX;
  // Clamp the anchor's horizontal projection so the popover stays
  // inside the viewport with a small margin.
  const half = POPOVER_W / 2;
  anchorLeft = Math.max(half + 8, Math.min(vw - half - 8, anchorLeft));

  destPopoverOpen = true;
  // Hard safety net: 60 s force-reset of destPopoverOpen so a missed
  // close-signal can't permanently lock the entry detector.
  if (destPopoverSafetyTimer) clearTimeout(destPopoverSafetyTimer);
  destPopoverSafetyTimer = setTimeout(() => {
    destPopoverOpen = false;
    destPopoverSafetyTimer = null;
  }, 60_000);

  const payload = {
    entryName: entryMeta.name || _t("portalUnnamed"),
    entryTag: entryMeta.tag,
    candidates,
    tokenIds,
    placeBelow,
  };
  const url = `${DEST_URL}?p=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    await OBR.popover.open({
      id: DEST_POPOVER_ID,
      url,
      width: POPOVER_W,
      height: POPOVER_H,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(anchorLeft), top: Math.round(anchorTop) },
      anchorOrigin: { horizontal: "CENTER", vertical: placeBelow ? "TOP" : "BOTTOM" },
      transformOrigin: { horizontal: "CENTER", vertical: placeBelow ? "TOP" : "BOTTOM" },
      hidePaper: true,
      // No viewport-wide click-catcher — keeps canvas interaction free.
      disableClickAway: true,
    });
  } catch (e) {
    console.error("[obr-suite/portals] openDestinationPopover failed", e);
    destPopoverOpen = false;
  }
}

async function closeDestinationPopover() {
  try { await OBR.popover.close(DEST_POPOVER_ID); } catch {}
  destPopoverOpen = false;
  if (destPopoverSafetyTimer) {
    clearTimeout(destPopoverSafetyTimer);
    destPopoverSafetyTimer = null;
  }
}

// --- Blink (eye-close → teleport → eye-open) ------------------------------
//
// Triggered when the destination popover sends BROADCAST_TELEPORT.
// We open a fullscreen modal that paints two black "eyelid" bars
// closing in the middle, perform the teleport while the eyes are
// closed (camera moves instantly via setPosition during the closed
// window so no visible canvas snap), then the modal opens the eyes
// onto the destination and closes itself.
async function openBlinkAndTeleport(destPortalId: string, tokenIds: string[]) {
  if (blinkModalOpen) return;
  pendingTeleport = { destPortalId, tokenIds };
  blinkModalOpen = true;
  try {
    await OBR.modal.open({
      id: BLINK_MODAL_ID,
      url: BLINK_URL,
      fullScreen: true,
      hideBackdrop: true,
      hidePaper: true,
      // Block pointer events while the blink is in progress so the
      // user can't drag during the teleport.
      disablePointerEvents: false,
    });
  } catch (e) {
    console.error("[obr-suite/portals] openBlinkAndTeleport failed", e);
    blinkModalOpen = false;
    pendingTeleport = null;
    // Fall back to plain teleport so the user isn't stranded.
    await teleport(destPortalId, tokenIds, false);
  }
}

async function closeBlinkModal() {
  try { await OBR.modal.close(BLINK_MODAL_ID); } catch {}
  blinkModalOpen = false;
}

// --- Teleport: gather tokens around destination portal --------------------

// Snapshotted token-side extension metadata so the post-teleport
// restore knows the original values.
// Map<tokenId, Record<metadataKey, originalValue>>.
type ExtMetaSnapshot = Map<string, Record<string, any>>;

// Detect token-side metadata entries that fog / line-of-sight / wall
// extensions watch — these often reject "illegal" position updates
// (token crosses a wall / leaves an allowed region), so we strip
// them before teleporting and restore right after. Covers:
//
//   • OBR Dynamic Fog (`rodeo.owlbear.dynamic-fog/light` etc.) —
//     keys whose value carries attenuationRadius / sourceRadius.
//   • Smoke & Spectre walls — the SS extension keeps per-token state
//     under the `rodeo.owlbear.codeo.smoke-and-spectre/...` namespace
//     (and also exposes metadata keys with "smoke", "spectre" or
//     "specter" in them). When the token has a vision range stored
//     here, SS will validate any position change against its wall
//     geometry and snap the token back if the segment crosses a
//     wall — exactly what blocks our teleport. Stripping the
//     metadata briefly bypasses the validator.
//   • Anything else with `visionRange` / `lightRadius` / `wallBlocks`
//     properties on the value — defensive catch-all for similar
//     fog/wall plugins.
//
// Restoration is verbatim — we don't mutate the captured value, just
// delete the key for the duration of the position update and set it
// back to the exact same object after.
function findExtensionPositionKeys(metadata: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    // KEY-based namespace check FIRST — must run before the value-
    // type guard below, because Smoke & Spectre stores its per-token
    // state as FLAT primitives (hasVision: boolean, visionRange:
    // number, etc.), not nested objects. Round 7's "if not object,
    // continue" was skipping every SS key.
    //
    // Confirmed SS keys (from user's DevTools dump):
    //   com.battle-system.smoke/hasVision
    //   com.battle-system.smoke/visionRange
    //   com.battle-system.smoke/visionSourceRange
    //   com.battle-system.smoke/visionFallOff
    //   com.battle-system.smoke/visionInAngle
    //   com.battle-system.smoke/visionOutAngle
    //   com.battle-system.smoke/visionDark
    // The "smoke" substring catches all of them. We also keep the
    // looser "spectre" / "specter" checks in case a future SS build
    // changes namespace.
    const kl = k.toLowerCase();
    if (
      kl.includes("smoke") ||
      kl.includes("spectre") ||
      kl.includes("specter") ||
      kl.includes("battle-system")  // SS's actual prefix
    ) {
      keys.push(k);
      continue;
    }
    // Object-shape checks for plugins that nest their state.
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    // Dynamic Fog
    if ("attenuationRadius" in o || "sourceRadius" in o) { keys.push(k); continue; }
    // Generic vision / wall shape
    if ("visionRange" in o || "lightRadius" in o || "wallBlocks" in o) { keys.push(k); continue; }
  }
  return keys;
}

async function snapshotExtensionMetadata(tokenIds: string[]): Promise<ExtMetaSnapshot> {
  const snap: ExtMetaSnapshot = new Map();
  console.log(
    "%c[obr-suite/portals] === TELEPORT SNAPSHOT START ===",
    "background:#5dade2;color:#fff;padding:2px 6px;font-weight:bold;border-radius:3px",
    { tokenIds },
  );
  try {
    const items = await OBR.scene.items.getItems(tokenIds);
    for (const it of items) {
      const allKeys = Object.keys(it.metadata as Record<string, unknown>);
      const matchedKeys = findExtensionPositionKeys(it.metadata as Record<string, unknown>);
      // DIAGNOSTIC: log every metadata key on the token and which we
      // matched. If teleport still bumps into Smoke & Spectre walls
      // the user can copy this console output to share the exact
      // metadata key namespace SS uses, and we extend the matcher.
      console.log(
        "%c[obr-suite/portals] token metadata",
        "color:#7be0a0;font-weight:bold",
        {
          tokenId: it.id,
          tokenName: it.name,
          allMetadataKeys: allKeys,
          matchedForStrip: matchedKeys,
          matchedValues: matchedKeys.reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (it.metadata as any)[k];
            return acc;
          }, {}),
          fullMetadata: it.metadata,  // full dump so user can grep visually
        },
      );
      if (matchedKeys.length === 0) continue;
      const captured: Record<string, any> = {};
      for (const k of matchedKeys) captured[k] = (it.metadata as any)[k];
      snap.set(it.id, captured);
    }
  } catch (e) {
    console.warn("[obr-suite/portals] snapshotExtensionMetadata failed", e);
  }
  console.log(
    "%c[obr-suite/portals] === TELEPORT SNAPSHOT END ===",
    "background:#5dade2;color:#fff;padding:2px 6px;font-weight:bold;border-radius:3px",
    { snappedKeys: [...snap.entries()].map(([id, v]) => ({ id, keys: Object.keys(v) })) },
  );
  return snap;
}

async function teleport(
  destPortalId: string,
  tokenIds: string[],
  instantCamera: boolean = false,
) {
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

  // Phase 1 — strip extension metadata that fog/wall plugins use to
  // validate token movement. Covers Dynamic Fog (light sources) and
  // Smoke & Spectre vision keys (com.battle-system.smoke/...). All
  // captured values restored verbatim in Phase 3.
  const extSnap = await snapshotExtensionMetadata(tokenIds);
  if (extSnap.size > 0) {
    try {
      await OBR.scene.items.updateItems([...extSnap.keys()], (drafts) => {
        for (const d of drafts) {
          const captured = extSnap.get(d.id);
          if (!captured) continue;
          for (const k of Object.keys(captured)) delete (d.metadata as any)[k];
        }
      });
    } catch (e) {
      console.warn("[obr-suite/portals] strip extension metadata failed", e);
    }
  }

  // Phase 1.5 — handle Smoke & Spectre's ATTACHMENT-based wall
  // collision. Stripping the token's own SS metadata isn't enough
  // for tokens with vision sources because SS attaches separate
  // scene items (light cones / vision sources) to the token; those
  // attachments collide with walls during the position update and
  // SS snaps the whole group back.
  //
  // The reference plugin (gitlab.com/resident-uhlig/owlbear-rodeo-portals)
  // works around this by toggling the attachments' `visible` flag
  // off during the move. Invisible items don't trigger SS's wall
  // check. After the move we restore visible exactly as it was.
  type AttSnap = Map<string, boolean>;
  const attVisible: AttSnap = new Map();
  let attachmentIds: string[] = [];
  let localAttachmentIds: string[] = [];
  try {
    const attachments = await OBR.scene.items.getItemAttachments(tokenIds);
    for (const a of attachments) {
      attVisible.set(a.id, a.visible);
      attachmentIds.push(a.id);
    }
  } catch (e) {
    console.warn("[obr-suite/portals] getItemAttachments failed", e);
  }
  try {
    const localAttachments = await OBR.scene.local.getItemAttachments(tokenIds);
    for (const a of localAttachments) {
      attVisible.set(a.id, a.visible);
      localAttachmentIds.push(a.id);
    }
  } catch (e) {
    console.warn("[obr-suite/portals] local.getItemAttachments failed", e);
  }
  if (attachmentIds.length > 0 || localAttachmentIds.length > 0) {
    console.log(
      "[obr-suite/portals] hiding attachments for teleport",
      { sceneAttachments: attachmentIds, localAttachments: localAttachmentIds },
    );
  }
  try {
    if (attachmentIds.length > 0) {
      await OBR.scene.items.updateItems(attachmentIds, (drafts) => {
        for (const d of drafts) d.visible = false;
      });
    }
    if (localAttachmentIds.length > 0) {
      await OBR.scene.local.updateItems(localAttachmentIds, (drafts) => {
        for (const d of drafts) d.visible = false;
      });
    }
  } catch (e) {
    console.warn("[obr-suite/portals] hide attachments failed", e);
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

  // Phase 2.5 — restore attachments' visible state. Symmetric with
  // Phase 1.5; uses the captured value so we don't accidentally
  // un-hide an item that the user intentionally had hidden.
  try {
    if (attachmentIds.length > 0) {
      await OBR.scene.items.updateItems(attachmentIds, (drafts) => {
        for (const d of drafts) {
          const v = attVisible.get(d.id);
          if (typeof v === "boolean") d.visible = v;
        }
      });
    }
    if (localAttachmentIds.length > 0) {
      await OBR.scene.local.updateItems(localAttachmentIds, (drafts) => {
        for (const d of drafts) {
          const v = attVisible.get(d.id);
          if (typeof v === "boolean") d.visible = v;
        }
      });
    }
  } catch (e) {
    console.warn("[obr-suite/portals] restore attachments visibility failed", e);
  }

  // Move the local camera to the destination portal (only on the
  // originating client — BROADCAST_TELEPORT is LOCAL only). When
  // called during the blink flow the camera should jump INSTANTLY so
  // when the eyes open the destination is already centered;
  // otherwise we keep the smooth animateTo for the legacy fallback
  // path. Either way, scale is preserved.
  try {
    const [vw, vh, vpScale] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
      OBR.viewport.getScale(),
    ]);
    const targetPos = {
      x: -center.x * vpScale + vw / 2,
      y: -center.y * vpScale + vh / 2,
    };
    if (instantCamera) {
      // setPosition is synchronous from the camera's POV — no tween,
      // canvas redraws on the next frame. The blink overlay covers
      // any flash.
      await OBR.viewport.setPosition(targetPos).catch(() => {});
    } else {
      OBR.viewport.animateTo({ position: targetPos, scale: vpScale }).catch(() => {});
    }
  } catch {}

  // Phase 3 — restore the original extension metadata values
  // verbatim (Dynamic Fog light + Smoke & Spectre vision/wall keys).
  if (extSnap.size > 0) {
    try {
      await OBR.scene.items.updateItems([...extSnap.keys()], (drafts) => {
        for (const d of drafts) {
          const captured = extSnap.get(d.id);
          if (!captured) continue;
          for (const [key, original] of Object.entries(captured)) {
            (d.metadata as any)[key] = original;
          }
        }
      });
    } catch (e) {
      console.warn("[obr-suite/portals] restore extension metadata failed", e);
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

  // Banner log so the user can confirm the module actually started
  // on this client. If they see this in DevTools console, it means
  // the bg iframe loaded. Subsequent portal logs (drag detection,
  // metadata snapshots) are then guaranteed to fire when relevant.
  console.log(
    "%c[obr-suite/portals] setup OK",
    "background:#9a6cf2;color:#fff;padding:2px 6px;font-weight:bold;border-radius:3px",
    { role, base: import.meta.env.BASE_URL },
  );

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

  // Destination popover → blink modal → (proceed) → teleport.
  // The popover sends BROADCAST_TELEPORT when the user picks a
  // destination. We close the popover and open the blink modal; the
  // modal animates eyelids closing, then sends BROADCAST_BLINK_PROCEED
  // back to us — that's when the actual position update runs (camera
  // jumps instantly so the post-blink eye-open lands on the
  // destination). When the teleport finishes we send
  // BROADCAST_BLINK_DONE so the modal can run the eye-open animation
  // and close itself.
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_TELEPORT, async (msg) => {
      const data = msg.data as
        | { destPortalId: string; tokenIds: string[] }
        | undefined;
      if (!data) return;
      await closeDestinationPopover();
      await openBlinkAndTeleport(data.destPortalId, data.tokenIds);
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_BLINK_PROCEED, async () => {
      const job = pendingTeleport;
      pendingTeleport = null;
      if (!job) {
        // Modal asked to proceed but we've already cleared the job
        // (e.g. modal opened twice somehow). Tell it to recover.
        try {
          await OBR.broadcast.sendMessage(BROADCAST_BLINK_DONE, {}, { destination: "LOCAL" });
        } catch {}
        return;
      }
      await teleport(job.destPortalId, job.tokenIds, true);
      try {
        await OBR.broadcast.sendMessage(BROADCAST_BLINK_DONE, {}, { destination: "LOCAL" });
      } catch {}
    })
  );

  // The blink modal sends this right before it closes itself, so the
  // background can flip its open flag back off. (Modal onClose is not
  // surfaced by OBR, so we rely on the page's beforeunload handler.)
  unsubs.push(
    OBR.broadcast.onMessage(`${PLUGIN_ID}/blink-modal-closed`, () => {
      blinkModalOpen = false;
      pendingTeleport = null;
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

  // Popover-close detector: when the destination popover closes via
  // user × / Esc / page unload, it broadcasts here so we can reset
  // destPopoverOpen. (OBR doesn't expose a popover close-event API.)
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_DEST_CLOSED, () => {
      destPopoverOpen = false;
      if (destPopoverSafetyTimer) {
        clearTimeout(destPopoverSafetyTimer);
        destPopoverSafetyTimer = null;
      }
    })
  );

  // No initial pass — only player drag-end events trigger the popover.
  // If the player happens to have selected a token already inside a
  // portal at scene load, no popover opens until they drag the token.
}

export async function teardownPortals(): Promise<void> {
  await closeEditPopover();
  await closeDestinationPopover();
  await closeBlinkModal();
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
  if (destPopoverSafetyTimer) {
    clearTimeout(destPopoverSafetyTimer);
    destPopoverSafetyTimer = null;
  }
  movedByMeIds.clear();
  pendingTeleport = null;
  lastTokenPos.clear();
  recentlyTeleported.clear();
}
