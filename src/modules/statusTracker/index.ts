// Status Tracker — module lifecycle.
//
// Three OBR windows participate:
//
//   1. Palette popover (always open while status tracker is on,
//      bottom-right by default, drag-movable). Lists every buff +
//      a red "clear all" eraser.
//   2. Local Shape ring per visible character — drawn on the scene
//      via OBR.scene.local.addItems on layer POST_PROCESS, attached
//      to its token. These follow tokens automatically; the user
//      can pan / zoom freely while the rings stay locked on.
//   3. Capture overlay modal (transient, opens on drag-start, closes
//      on drag-end). Fullscreen, captures pointer events, paints
//      buffs onto tokens as the cursor crosses each ring.
//
// Tool action (`]` shortcut on the Select tool) toggles the whole
// thing on / off. Modal lifecycle is driven by broadcasts the
// palette + capture iframes send back here.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { IS_MOBILE } from "../../feature-flags";
import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  SCENE_BUFF_CATALOG_KEY,
  DEFAULT_BUFFS,
  BuffDef,
} from "./types";
import {
  syncTokenBuffs,
  readTokenBuffIds,
  sweepAllOurItems,
} from "./bubbles";
// circles.ts is still imported by capture-page for getTokenCircleSpec
// (hit-testing radius). The persistent local-Shape rings are no longer
// rendered from the background — the helpers stay around so the
// capture overlay's hit-test math reuses the exact same radius
// formula.
import {
  PANEL_IDS,
  getPanelOffset,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
} from "../../utils/panelLayout";

const POPOVER_PALETTE = `${PLUGIN_ID}/palette`;
const POPOVER_MANAGE = `${PLUGIN_ID}/manage`;
const MODAL_CAPTURE = `${PLUGIN_ID}/capture`;
const TOOL_ID = "com.obr-suite/status-tracker-tool";
const TOOL_ACTION_ID = "com.obr-suite/status-tracker-toggle";
const SELECT_TOOL = "rodeo.owlbear.tool/select";
const MOVE_TOOL = "rodeo.owlbear.tool/move";
const ICON_URL = assetUrl("status-icon.svg");

const BC_DRAG_START = `${PLUGIN_ID}/drag-start`;
const BC_DRAG_END = `${PLUGIN_ID}/drag-end`;
const BC_TOGGLE = `${PLUGIN_ID}/toggle`;
const BC_REFRESH_TOKEN = `${PLUGIN_ID}/refresh-token`;
// Sent by the capture overlay when the user drops the 🛠 manage
// pill onto a token. Background opens a popover anchored to that
// token listing the token's current buffs for direct manipulation.
const BC_OPEN_MANAGE = `${PLUGIN_ID}/open-manage`;
// Sent by the manage popover when the user closes it (Esc / × / click
// outside) so we can release any stale references in the background.
const BC_CLOSE_MANAGE = `${PLUGIN_ID}/close-manage`;

// Palette popover size. Widened from 280→340 and tallened 360→408,
// then bumped 408→544 (×4/3) so the bubble grid has enough vertical
// room to show the eraser + manage pills + a meaningful chunk of the
// catalog without immediate scrolling.
const PALETTE_W = 340;
const PALETTE_H = 544;
// Default anchor: bottom-right with a 16px inset, so the palette sits
// over the corner of the viewport on first activation. Subsequent
// drags persist the user's preferred offset via getPanelOffset.
const PALETTE_INSET_RIGHT = 16;
const PALETTE_INSET_BOTTOM = 16;

let active = false;
let captureOpen = false;
// Tool the user was on when they activated status tracker. Used so
// the `]` shortcut can switch BACK to whatever they had selected
// previously instead of always returning to the move tool.
let previousTool: string | null = null;
const unsubs: Array<() => void> = [];

// Compute the palette's current world (= viewport) anchor: default
// bottom-right corner inset, plus the user's stored offset (set by
// the bindPanelDrag → drag-preview modal flow).
async function paletteAnchor(): Promise<{ left: number; top: number }> {
  let vw = 1280, vh = 720;
  try { vw = await OBR.viewport.getWidth(); } catch {}
  try { vh = await OBR.viewport.getHeight(); } catch {}
  const off = getPanelOffset(PANEL_IDS.statusPalette);
  // Default = bottom-right corner with the configured inset. dx > 0
  // pushes palette LEFTWARDS (towards centre), dy > 0 pushes UPWARDS.
  // We sign dx/dy this way so dragging the palette TOWARDS the
  // centre (positive dx, positive dy in screen-space) feels natural.
  const baseLeft = vw - PALETTE_W - PALETTE_INSET_RIGHT;
  const baseTop = vh - PALETTE_H - PALETTE_INSET_BOTTOM;
  const left = Math.min(Math.max(8, baseLeft + off.dx), vw - PALETTE_W - 8);
  const top = Math.min(Math.max(8, baseTop + off.dy), vh - PALETTE_H - 8);
  return { left, top };
}

async function openPalette(): Promise<void> {
  const anchor = await paletteAnchor();
  try {
    await OBR.popover.open({
      id: POPOVER_PALETTE,
      url: assetUrl("status-tracker.html"),
      width: PALETTE_W,
      height: PALETTE_H,
      anchorReference: "POSITION",
      anchorPosition: anchor,
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
  } catch (e) {
    console.warn("[status] open palette failed", e);
  }
}

async function closePalette(): Promise<void> {
  try { await OBR.popover.close(POPOVER_PALETTE); } catch {}
}

async function openCapture(payload: {
  /** "buff"            — palette pill drag → applies buff on drop
   *  "clear"           — palette eraser drag → clears all on drop / paint
   *  "manage"          — palette manage pill drag → opens manage popover
   *  "manage-transfer" — manage-popover bubble drag → transfer or remove */
  kind: "buff" | "clear" | "manage" | "manage-transfer";
  buff?: BuffDef;
  /** "drop" = apply to single token on pointerup (left click).
   *  "paint-toggle" = drag-paint, toggling per-token (right click). */
  mode: "drop" | "paint-toggle";
  /** Only set for kind="manage-transfer". The token the user dragged
   *  the buff FROM (= source). On drop on a target token we remove
   *  the buff from this source and add it to the target; on drop on
   *  empty space we just remove from this source. */
  sourceTokenId?: string;
}): Promise<void> {
  if (captureOpen) return;
  const params = new URLSearchParams();
  params.set("kind", payload.kind);
  params.set("mode", payload.mode);
  if (payload.buff) params.set("buff", encodeURIComponent(JSON.stringify(payload.buff)));
  if (payload.sourceTokenId) params.set("source", payload.sourceTokenId);
  const url = `${assetUrl("status-tracker-capture.html")}?${params.toString()}`;
  try {
    await OBR.modal.open({
      id: MODAL_CAPTURE,
      url,
      fullScreen: true,
      hidePaper: true,
      hideBackdrop: true,
      disablePointerEvents: false, // capture all pointer events
    });
    captureOpen = true;
  } catch (e) {
    console.warn("[status] open capture failed", e);
  }
}

async function closeCapture(): Promise<void> {
  if (!captureOpen) return;
  try { await OBR.modal.close(MODAL_CAPTURE); } catch {}
  captureOpen = false;
}

const MANAGE_POPOVER_W = 260;
const MANAGE_POPOVER_H = 220;
let managePopoverOpen = false;

/** Open the buff-management popover anchored on a token. The popover
 *  iframe (status-tracker-manage.html) reads the token's buff list
 *  and renders each as a draggable bubble; users drag-out / drag-to-
 *  another-token to remove or transfer. */
async function openManagePopover(tokenId: string): Promise<void> {
  // Compute the token's screen position so we can anchor the popover
  // visually on top of it. transformPoint converts scene → screen.
  let screenLeft = 200, screenTop = 200;
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (items.length === 0) return;
    const t = items[0];
    const pt = await OBR.viewport.transformPoint({
      x: (t as any).position?.x ?? 0,
      y: (t as any).position?.y ?? 0,
    });
    screenLeft = Math.max(8, pt.x - MANAGE_POPOVER_W / 2);
    screenTop = Math.max(8, pt.y - MANAGE_POPOVER_H / 2);
    // Clamp to viewport bounds.
    let vw = 1280, vh = 720;
    try { vw = await OBR.viewport.getWidth(); } catch {}
    try { vh = await OBR.viewport.getHeight(); } catch {}
    if (screenLeft + MANAGE_POPOVER_W > vw - 8) screenLeft = vw - MANAGE_POPOVER_W - 8;
    if (screenTop + MANAGE_POPOVER_H > vh - 8) screenTop = vh - MANAGE_POPOVER_H - 8;
  } catch {}

  const params = new URLSearchParams();
  params.set("token", tokenId);
  const url = `${assetUrl("status-tracker-manage.html")}?${params.toString()}`;

  try {
    if (managePopoverOpen) {
      try { await OBR.popover.close(POPOVER_MANAGE); } catch {}
    }
    await OBR.popover.open({
      id: POPOVER_MANAGE,
      url,
      width: MANAGE_POPOVER_W,
      height: MANAGE_POPOVER_H,
      anchorReference: "POSITION",
      anchorPosition: { left: screenLeft, top: screenTop },
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: false,
    });
    managePopoverOpen = true;
  } catch (e) {
    console.warn("[status] open manage popover failed", e);
  }
}

async function closeManagePopover(): Promise<void> {
  if (!managePopoverOpen) return;
  try { await OBR.popover.close(POPOVER_MANAGE); } catch {}
  managePopoverOpen = false;
}

async function activate(): Promise<void> {
  if (active) return;
  active = true;
  await openPalette();
}

async function deactivate(): Promise<void> {
  if (!active) return;
  active = false;
  await closeCapture();
  await closeManagePopover();
  await closePalette();
}

async function toggle(): Promise<void> {
  if (active) await deactivate();
  else await activate();
}

// === On-token bubble sync (shared with old design — we still
// render the small label bubbles around each token to match what the
// existing scene metadata tracking expects). ===

// Catalog formats accepted on read:
//   v1 (legacy): bare BuffDef[] array
//   v2 (current): { version: 2, buffs: BuffDef[], groupOrder?: string[] }
// We always WRITE v2 (in status-tracker-page.ts); this reader has to
// understand both. Previously this function only handled v1 (the
// `Array.isArray(v)` check), so any catalog written through the
// edit popup (always v2) silently fell back to DEFAULT_BUFFS — that
// silently dropped every user customization including the `effect`
// mode, which is why the experimental shaders never rendered
// (`effects=0` in the diagnostic log).
const VALID_EFFECTS = new Set<string>([
  "default", "float", "drop", "flicker", "curve", "spread",
]);

async function getCatalog(): Promise<BuffDef[]> {
  try {
    const meta = await OBR.scene.getMetadata();
    const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
    let arr: any[] | null = null;
    if (Array.isArray(v)) {
      arr = v;
    } else if (v && typeof v === "object" && Array.isArray((v as any).buffs)) {
      arr = (v as any).buffs;
    }
    if (arr) {
      const out: BuffDef[] = [];
      for (const e of arr) {
        if (!e || typeof (e as any).id !== "string") continue;
        const eff = (e as any).effect;
        const def: BuffDef = {
          id: (e as any).id,
          name: String((e as any).name ?? (e as any).id),
          color: String((e as any).color ?? "#ffffff"),
          group: typeof (e as any).group === "string" ? (e as any).group : undefined,
        };
        if (typeof eff === "string" && VALID_EFFECTS.has(eff) && eff !== "default") {
          def.effect = eff as any;
        }
        // Parse effectParams (imageUrl / dims / speed / count).
        // Missing/malformed fields are ignored individually so a
        // partial object still yields a valid catalog entry.
        const ep = (e as any).effectParams;
        if (ep && typeof ep === "object") {
          const params: any = {};
          if (typeof ep.imageUrl === "string" && ep.imageUrl.length > 0) params.imageUrl = ep.imageUrl;
          if (typeof ep.imageWidth === "number" && isFinite(ep.imageWidth)) params.imageWidth = ep.imageWidth;
          if (typeof ep.imageHeight === "number" && isFinite(ep.imageHeight)) params.imageHeight = ep.imageHeight;
          if (typeof ep.speed === "number" && isFinite(ep.speed)) params.speed = ep.speed;
          if (typeof ep.count === "number" && isFinite(ep.count)) params.count = ep.count;
          if (Object.keys(params).length > 0) def.effectParams = params;
        }
        out.push(def);
      }
      if (out.length > 0) return out;
    }
  } catch {}
  return DEFAULT_BUFFS;
}

let lastBuffSnapshot = new Map<string, string>();

// Cache key: buff IDs + scale + image dims. Including scale + dims
// means a pure scale change (no buff change) still re-runs the
// builder, which is necessary because `syncTokenBuffs` rebuilds the
// pills from the CURRENT token half-height — without this the pills
// would stay at their original size after the user scales the
// token. (Buff bubbles are attached with SCALE-inheritance disabled,
// so we have to rebuild manually rather than ride OBR's scale.)
function tokenSyncKey(it: any, ids: string[]): string {
  const sx = (it.scale?.x ?? 1).toFixed(3);
  const sy = (it.scale?.y ?? 1).toFixed(3);
  const w = it.image?.width ?? 0;
  const h = it.image?.height ?? 0;
  // Neither visibility NOR position is in the key:
  //   - visibility: OBR's attachment system inherits the parent's
  //     visible flag automatically, so players see bubbles
  //     hide/unhide in the same frame as the token state changes.
  //     Re-syncing would cause delete-then-add flicker.
  //   - position: bubbles are attached to the token (palette
  //     closed) so they follow via OBR's attachment system; or
  //     detached (palette open) where the user is the source of
  //     truth for position. In neither case do we need to re-sync
  //     on token movement.
  return `${ids.join("|")}@${sx}x${sy}|${w}x${h}`;
}

// Cache of "is current player a GM?" — initialised in setup, kept
// fresh by player.onChange. Only the GM client manages buff items
// so we don't get cross-client duplicates in scene.items, AND
// hidden-token bubbles route to scene.local (only the GM client
// sees them, satisfying "hidden character effects only show to
// DM").
let isGM = false;

async function syncAllVisibleTokensImpl(): Promise<void> {
  if (!isGM) return;
  try {
    const items = await OBR.scene.items.getItems();
    const next = new Map<string, string>();
    for (const it of items) {
      if (!(it as any).image || (it as any).type !== "IMAGE") continue;
      const ids = readTokenBuffIds(it);
      if (ids.length === 0) {
        if (lastBuffSnapshot.has(it.id)) {
          await syncTokenBuffs(it as any, []);
        }
        continue;
      }
      const key = tokenSyncKey(it, ids);
      next.set(it.id, key);
      if (lastBuffSnapshot.get(it.id) === key) continue;
      const cat = await getCatalog();
      const buffs = ids
        .map((id) => cat.find((b) => b.id === id))
        .filter((b): b is BuffDef => !!b);
      await syncTokenBuffs(it as any, buffs);
    }
    lastBuffSnapshot = next;
  } catch (e) {
    console.warn("[status] syncAllVisibleTokens failed", e);
  }
}

// === Sync mutex / coalescer ================================================
//
// `OBR.scene.items.onChange` fires CONSTANTLY — every viewport tick,
// every item modification (including our OWN modifications). Without
// serialisation, we'd have multiple syncs running in parallel:
//   • Sync A reads existing items at time T0
//   • Sync B starts at T0+ε, also reads existing
//   • Sync A's deleteItems lands → onChange fires → triggers Sync C
//   • Sync B's deleteItems lands on items already deleted by A → fail
// This was the source of the error storms in the console.
//
// Mutex behaviour: at most ONE sync runs at a time. While one runs,
// at most ONE more is queued — additional triggers collapse into the
// pending one (we always sync against current scene state anyway).
let syncRunning = false;
let syncQueued = false;
async function syncAllVisibleTokens(): Promise<void> {
  if (syncRunning) {
    syncQueued = true;
    return;
  }
  syncRunning = true;
  try {
    await syncAllVisibleTokensImpl();
  } finally {
    syncRunning = false;
    if (syncQueued) {
      syncQueued = false;
      void syncAllVisibleTokens();
    }
  }
}

async function refreshTokenBuffs(tokenId: string): Promise<void> {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    const token = items[0];
    if (!token || (token as any).type !== "IMAGE") return;
    const ids = readTokenBuffIds(token);
    const cat = await getCatalog();
    const buffs = ids
      .map((id) => cat.find((b) => b.id === id))
      .filter((b): b is BuffDef => !!b);
    await syncTokenBuffs(token as any, buffs);
  } catch (e) {
    console.warn("[status] refreshTokenBuffs failed", e);
  }
}

// === Setup / teardown ===

export async function setupStatusTracker(): Promise<void> {
  // Mobile clients skip the entire setup — the palette + capture
  // overlay rely on continuous WebGL re-render of attached items
  // and a dragable fullscreen modal, both of which choke on phone-
  // class GPUs. The yellow notification (rendered by background.ts)
  // tells the user why this feature is missing.
  if (IS_MOBILE) {
    console.info("[status] mobile client — skipping setup");
    return;
  }

  // Toolbar tool — same model as Bestiary (item 2 in the user's
  // 2026-05-04 spec). Click the icon → activate the tool → palette
  // opens. Click any other tool → deactivate → palette closes.
  // No role filter — anyone can manage their own / shared tokens
  // (item 4 in the same spec).
  try {
    await OBR.tool.create({
      id: TOOL_ID,
      icons: [
        {
          icon: ICON_URL,
          label: "状态追踪",
          // No `roles` filter — both GM and players see the icon.
          // Per-token permission for buff writes is enforced by the
          // OBR scene-items API itself: players can only modify
          // tokens they own / created. The bubble RENDERING (sync
          // loop in `syncAllVisibleTokensImpl`) is still GM-gated
          // since only one client should own the persistent items.
        },
      ],
      onClick: async () => {
        await OBR.tool.activateTool(TOOL_ID);
        return false;
      },
    });
    // Passthrough mode — required for the tool to be selectable, but
    // we don't intercept any pointer events.
    await OBR.tool.createMode({
      id: `${TOOL_ID}/mode`,
      icons: [
        {
          icon: ICON_URL,
          label: "状态追踪",
          filter: { activeTools: [TOOL_ID] },
        },
      ],
      cursors: [{ cursor: "default" }],
    });
  } catch (e) {
    console.warn("[status] tool.create failed", e);
  }

  // Track which tool is active and open / close the palette in sync.
  // Activating the status-tracker tool calls `activate()`; switching
  // away calls `deactivate()` so the palette closes when the user
  // picks any other tool, matching Bestiary's UX.
  unsubs.push(
    OBR.tool.onToolChange(async (activeId) => {
      if (activeId === TOOL_ID) {
        if (!active) await activate();
      } else {
        // Remember the tool the user switched to (so `]` can switch
        // back to it next time).
        previousTool = activeId;
        if (active) await deactivate();
      }
    }),
  );

  // `]` shortcut — keep working (item 2 doesn't ask to remove it,
  // and the muscle memory matters). Now toggles via the tool API
  // rather than calling `toggle()` directly so the active tool
  // stays in sync with the palette state.
  const performShortcutToggle = async (): Promise<void> => {
    try {
      const cur = await OBR.tool.getActiveTool();
      if (cur === TOOL_ID) {
        await OBR.tool.activateTool(previousTool ?? MOVE_TOOL);
      } else {
        previousTool = cur;
        await OBR.tool.activateTool(TOOL_ID);
      }
    } catch (e) {
      console.warn("[status] BracketRight toggle failed", e);
    }
  };
  try {
    await OBR.tool.createAction({
      id: TOOL_ACTION_ID,
      shortcut: "BracketRight",
      icons: [{
        icon: ICON_URL,
        label: "状态追踪",
        // Available on Select + on the status tracker tool itself
        // (so pressing `]` again from inside the tool exits it).
        // No roles filter — players can press `]` too.
        filter: { activeTools: [SELECT_TOOL, TOOL_ID] },
      }],
      onClick: performShortcutToggle,
    });
  } catch (e) {
    console.warn("[status] createAction failed", e);
  }

  // Palette → background broadcasts. The drag-start payload now
  // includes `mode` (drop / paint-toggle) so the capture overlay
  // splits behaviour by mouse button (left = drop-on-release,
  // right = drag-paint with toggle).
  unsubs.push(
    OBR.broadcast.onMessage(BC_DRAG_START, (event) => {
      const data = event.data as {
        kind: "buff" | "clear" | "manage" | "manage-transfer";
        buff?: BuffDef;
        mode?: "drop" | "paint-toggle";
        sourceTokenId?: string;
      } | undefined;
      if (!data) return;
      void openCapture({
        kind: data.kind,
        buff: data.buff,
        mode: data.mode === "paint-toggle" ? "paint-toggle" : "drop",
        sourceTokenId: data.sourceTokenId,
      });
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_DRAG_END, () => { void closeCapture(); }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_TOGGLE, () => { void performShortcutToggle(); }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_REFRESH_TOKEN, (event) => {
      const tokenId = (event.data as any)?.tokenId as string | undefined;
      if (tokenId) void refreshTokenBuffs(tokenId);
    }),
  );
  // Open the manage popover anchored on a token. Sent by the
  // capture overlay when the user drops the 🛠 manage pill on a
  // token. Capture page broadcasts BC_DRAG_END right after, which
  // closes the capture modal — the popover then becomes visible.
  unsubs.push(
    OBR.broadcast.onMessage(BC_OPEN_MANAGE, (event) => {
      const data = event.data as { tokenId?: string } | undefined;
      if (!data?.tokenId) return;
      void openManagePopover(data.tokenId);
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_CLOSE_MANAGE, () => { void closeManagePopover(); }),
  );

  // Panel-layout integration. Register the bbox provider so the
  // layout-editor can render the palette as a draggable proxy. The
  // bbox is computed each call so it picks up viewport resizes /
  // user-saved offsets correctly.
  registerPanelBbox(PANEL_IDS.statusPalette, async () => {
    if (!active) return null; // hide from layout editor when closed
    const { left, top } = await paletteAnchor();
    return { left, top, width: PALETTE_W, height: PALETTE_H };
  });

  // Panel-drag-end → re-anchor popover at the new offset (the standard
  // bindPanelDrag flow stores the offset before broadcasting END).
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const data = event.data as { panelId?: string } | undefined;
      if (data?.panelId !== PANEL_IDS.statusPalette) return;
      if (!active) return;
      // Close + reopen at new anchor (OBR popover has no setAnchor).
      try { await OBR.popover.close(POPOVER_PALETTE); } catch {}
      await openPalette();
    }),
  );
  // Panel-reset → restore default position.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (!active) return;
      try { await OBR.popover.close(POPOVER_PALETTE); } catch {}
      await openPalette();
    }),
  );

  // Player-role tracking — only the GM client manages buff items.
  // Other clients see them via OBR's normal scene replication for
  // visible tokens; for hidden tokens, the bubbles live in the GM's
  // scene.local so other clients never see them.
  try { isGM = (await OBR.player.getRole()) === "GM"; } catch {}
  unsubs.push(
    OBR.player.onChange((p) => {
      const wasGM = isGM;
      isGM = p.role === "GM";
      if (!wasGM && isGM) {
        // Just promoted — we own the items now. Force a fresh sync
        // (the previous-GM's items may still linger).
        lastBuffSnapshot.clear();
        void syncAllVisibleTokens();
      }
      if (wasGM && !isGM) {
        // Demoted — drop everything we created. New GM will rebuild.
        void sweepAllOurItems();
      }
    }),
  );

  // Token-bubble sync.
  unsubs.push(OBR.scene.items.onChange(() => {
    void syncAllVisibleTokens();
  }));
  // Catalog edits live in scene metadata. When the user changes a
  // buff's colour/effect via the palette ✎ popup, the metadata
  // changes — we invalidate the per-token cache and re-sync.
  //
  // Bug fix: scene metadata is written by MANY modules (panel
  // layouts, dice state, fog config, etc). The naive listener fired
  // on EVERY metadata write, wiping our cache + triggering a full
  // delete-then-add of every bubble. That was the "buff every once
  // in a while flickers" symptom. Solution: snapshot the catalog
  // sub-key as JSON; if the catalog itself didn't change, ignore
  // the metadata event entirely.
  let lastCatalogJson = "";
  try {
    const meta0 = await OBR.scene.getMetadata();
    lastCatalogJson = JSON.stringify(meta0[SCENE_BUFF_CATALOG_KEY] ?? null);
  } catch {}
  unsubs.push(OBR.scene.onMetadataChange(async () => {
    try {
      const meta = await OBR.scene.getMetadata();
      const catJson = JSON.stringify(meta[SCENE_BUFF_CATALOG_KEY] ?? null);
      if (catJson === lastCatalogJson) return;
      lastCatalogJson = catJson;
      lastBuffSnapshot.clear();
      void syncAllVisibleTokens();
    } catch {}
  }));
  const onSceneReady = async (): Promise<void> => {
    // Sweep first — clears any items left by an older renderer
    // (e.g. legacy rectangle-style bubbles) before we start drawing
    // the new curved bands. Awaited so syncAllVisibleTokens can't
    // race it.
    await sweepAllOurItems();
    lastBuffSnapshot.clear();
    void syncAllVisibleTokens();
  };
  if (await OBR.scene.isReady()) {
    await onSceneReady();
  }
  unsubs.push(
    OBR.scene.onReadyChange((ready) => {
      if (ready) void onSceneReady();
      else lastBuffSnapshot.clear();
    }),
  );
}

export async function teardownStatusTracker(): Promise<void> {
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
  try { await OBR.tool.removeAction(TOOL_ACTION_ID); } catch {}
  try { await OBR.tool.removeMode(`${TOOL_ID}/mode`); } catch {}
  try { await OBR.tool.remove(TOOL_ID); } catch {}
  await deactivate();
}
