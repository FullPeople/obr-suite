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
//   3. Capture overlay modal (transient, still used by the manage
//      popover transfer path). Palette application itself is now a
//      click-select → canvas-click flow handled by this tool mode.
//
// Tool action (`]` shortcut on the Select tool) toggles the whole
// thing on / off. Modal lifecycle is driven by broadcasts the
// palette + capture iframes send back here.

import OBR, { type Item, type Tool, type ToolMode, type ToolAction } from "@owlbear-rodeo/sdk";
import { getLocalLang, onLangChange } from "../../state";
import { assetUrl } from "../../asset-base";
import { IS_MOBILE } from "../../feature-flags";
import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  STATUS_BUFF_ROUNDS_KEY,
  SCENE_BUFF_CATALOG_KEY,
  DEFAULT_BUFFS,
  BuffDef,
} from "./types";
import {
  syncTokenBuffs,
  readTokenBuffIds,
  readTokenBuffRounds,
  sweepAllOurItems,
  invalidateAllBuffCaches,
} from "./bubbles";
// getTokenCircleSpec is reused for invisible click hit-testing when a
// palette status has been selected. The persistent local-Shape rings
// are no longer rendered from the background.
import { getTokenCircleSpec } from "./circles";
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
// 2026-05-14 (#2) — "以此创建状态" right-click context menu. Only
// registered WHILE the status palette is open (activate() registers
// it, deactivate() removes it) so it doesn't clutter the menu when
// the user isn't in status-tracker mode. Lets the user turn any
// non-MAP image on the canvas into a new buff entry (the item's
// image becomes the buff icon).
const CTX_CREATE_STATUS = `${PLUGIN_ID}/ctx-create-status`;
const TOOL_ID = "com.obr-suite/status-tracker-tool";
const TOOL_ACTION_ID = "com.obr-suite/status-tracker-toggle";
const SELECT_TOOL = "rodeo.owlbear.tool/select";
const MOVE_TOOL = "rodeo.owlbear.tool/move";
const ICON_URL = assetUrl("status-icon.svg");
const COMBAT_STATE_KEY = "com.initiative-tracker/combat";

const BC_DRAG_START = `${PLUGIN_ID}/drag-start`;
const BC_DRAG_END = `${PLUGIN_ID}/drag-end`;
const BC_TOGGLE = `${PLUGIN_ID}/toggle`;
const BC_REFRESH_TOKEN = `${PLUGIN_ID}/refresh-token`;
const BC_SELECT_APPLY = `${PLUGIN_ID}/select-apply`;
const BC_SELECT_CANCEL = `${PLUGIN_ID}/select-cancel`;
const BC_SELECT_STATE = `${PLUGIN_ID}/select-state`;
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
type SelectedPaletteApply =
  | { kind: "buff"; key: string; buff: BuffDef }
  | { kind: "clear"; key: "__clear__" }
  | { kind: "manage"; key: "__manage__" };
let selectedApply: SelectedPaletteApply | null = null;
// Tool the user was on when they activated status tracker. Used so
// the `]` shortcut can switch BACK to whatever they had selected
// previously instead of always returning to the move tool.
let previousTool: string | null = null;
const unsubs: Array<() => void> = [];
type EntrySession = { alive: boolean; tool?: Tool; mode?: ToolMode; action?: ToolAction };
let entrySession: EntrySession | null = null;
let entryQueue: Promise<void> = Promise.resolve();
const entryText = (key: "tool" | "create" | "newStatus") => ({
  en: { tool: "Status Tracker", create: "Create status from this", newStatus: "New status" },
  zh: { tool: "状态追踪", create: "以此创建状态", newStatus: "新状态" },
})[getLocalLang()][key];
const isCurrentEntry = (own: EntrySession) => own.alive && entrySession === own;
// The SDK exposes create-by-ID for replacing a tool's description, not a
// setLabel API. Keep callbacks/IDs stable, never remove or activate on language
// changes, and drain outstanding updates before teardown removes these IDs.
function queueEntry(task: () => Promise<void>): Promise<void> {
  const result = entryQueue.then(task);
  entryQueue = result.catch(error => console.warn("[status] entry update failed", error));
  return result;
}
async function refreshEntryLabels(own: EntrySession): Promise<void> {
  for (const [definition, create] of [
    [own.tool, (value: Tool) => OBR.tool.create(value)],
    [own.mode, (value: ToolMode) => OBR.tool.createMode(value)],
    [own.action, (value: ToolAction) => OBR.tool.createAction(value)],
  ] as const) {
    if (!isCurrentEntry(own)) return;
    if (definition) {
      await create({ ...definition, icons: definition.icons.map(icon => ({ ...icon, label: entryText("tool") })) });
    }
  }
}

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
   *  "manage-transfer" — manage-popover bubble drag → transfer or remove
   *  "preset"          — preset chip drag → applies preset's buffs on drop */
  kind: "buff" | "clear" | "manage" | "manage-transfer" | "preset";
  buff?: BuffDef;
  /** "drop" = apply to single token on pointerup (left click).
   *  "paint-toggle" = drag-paint, toggling per-token (right click).
   *  "click-place" = selected palette bubble carried by the cursor. */
  mode: "drop" | "paint-toggle" | "click-place";
  /** Only set for kind="manage-transfer". The token the user dragged
   *  the buff FROM (= source). On drop on a target token we remove
   *  the buff from this source and add it to the target; on drop on
   *  empty space we just remove from this source. */
  sourceTokenId?: string;
  /** Only set for kind="preset". The id of the preset being dragged
   *  + a small display blob for the cursor pill. The capture page
   *  doesn't apply the buffs itself — it broadcasts the {presetId,
   *  tokenId} back to the palette page which holds the preset data. */
  presetId?: string;
  presetName?: string;
  presetCount?: number;
}): Promise<void> {
  if (captureOpen) return;
  const params = new URLSearchParams();
  params.set("kind", payload.kind);
  params.set("mode", payload.mode);
  if (payload.buff) params.set("buff", encodeURIComponent(JSON.stringify(payload.buff)));
  if (payload.sourceTokenId) params.set("source", payload.sourceTokenId);
  if (payload.presetId) params.set("preset", payload.presetId);
  if (payload.presetName) params.set("presetName", encodeURIComponent(payload.presetName));
  if (payload.presetCount != null) params.set("presetCount", String(payload.presetCount));
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

function isStatusTargetItem(item: any): boolean {
  return item?.type === "IMAGE"
    && (item.layer === "CHARACTER" || item.layer === "MOUNT" || item.layer === "PROP");
}

async function publishSelectedApplyState(): Promise<void> {
  try {
    await OBR.broadcast.sendMessage(
      BC_SELECT_STATE,
      { key: selectedApply?.key ?? null },
      { destination: "LOCAL" },
    );
  } catch {}
}

async function cancelSelectedApply(): Promise<void> {
  if (!selectedApply) return;
  selectedApply = null;
  await closeCapture();
  await publishSelectedApplyState();
}

async function findClickedStatusTarget(event: any): Promise<string | null> {
  const direct = event?.target;
  if (isStatusTargetItem(direct)) return direct.id as string;

  const p = event?.pointerPosition as { x?: number; y?: number } | undefined;
  if (!p || typeof p.x !== "number" || typeof p.y !== "number") return null;

  let items: any[] = [];
  try { items = await OBR.scene.items.getItems(); } catch { return null; }
  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

  const candidates = items
    .filter(isStatusTargetItem)
    .map((item) => {
      const spec = getTokenCircleSpec(item, sceneDpi);
      const dx = p.x! - spec.cx;
      const dy = p.y! - spec.cy;
      return {
        id: item.id as string,
        zIndex: typeof item.zIndex === "number" ? item.zIndex : 0,
        inside: dx * dx + dy * dy <= spec.radius * spec.radius,
      };
    })
    .filter((x) => x.inside)
    .sort((a, b) => b.zIndex - a.zIndex);
  return candidates[0]?.id ?? null;
}

async function toggleBuffOnToken(tokenId: string, buff: BuffDef): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata as any)[STATUS_BUFFS_KEY];
        const list: string[] = Array.isArray(cur)
          ? cur.filter((x: any) => typeof x === "string")
          : [];
        const idx = list.indexOf(buff.id);
        const curRounds = (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY];
        const roundsMap = curRounds && typeof curRounds === "object" && !Array.isArray(curRounds)
          ? { ...(curRounds as Record<string, number>) }
          : {};
        if (idx >= 0) {
          list.splice(idx, 1);
          delete roundsMap[buff.id];
        } else {
          list.push(buff.id);
          const rounds = Math.floor(Number(buff.rounds ?? 0));
          if (Number.isFinite(rounds) && rounds > 0) roundsMap[buff.id] = rounds;
        }
        (d.metadata as any)[STATUS_BUFFS_KEY] = list;
        (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY] = roundsMap;
      }
    });
    await refreshTokenBuffs(tokenId);
  } catch (e) {
    console.warn("[status] toggleBuffOnToken failed", { tokenId, buffId: buff.id, stage: "toggle", error: e });
  }
}

async function clearAllBuffsOnToken(tokenId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        (d.metadata as any)[STATUS_BUFFS_KEY] = [];
        (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY] = {};
      }
    });
    await refreshTokenBuffs(tokenId);
  } catch (e) {
    console.warn("[status] clearAllBuffsOnToken failed", { tokenId, stage: "clear-all", error: e });
  }
}

async function applySelectedToToken(tokenId: string): Promise<void> {
  if (!selectedApply) return;
  if (selectedApply.kind === "buff") {
    await toggleBuffOnToken(tokenId, selectedApply.buff);
  } else if (selectedApply.kind === "clear") {
    await clearAllBuffsOnToken(tokenId);
  } else if (selectedApply.kind === "manage") {
    await openManagePopover(tokenId);
    await cancelSelectedApply();
  }
}

async function handleSelectedCanvasClick(event: any): Promise<boolean> {
  const button = typeof event?.button === "number" ? event.button : 0;
  if (button === 2) {
    await cancelSelectedApply();
    return false;
  }
  if (!selectedApply) return true;
  const tokenId = await findClickedStatusTarget(event);
  if (!tokenId) return false;
  await applySelectedToToken(tokenId);
  return false;
}

// 2026-05-14 (#2) — append a buff built from a canvas item into the
// per-client localStorage catalog. The item's image becomes the
// buff's icon (effectParams.imageUrl + dims). We write the same v2
// shape status-tracker-page.ts writes, so the palette + manage
// popover parse it identically. Writing to localStorage fires a
// `storage` event in the palette iframe → it re-renders; we also
// broadcast catalog-changed so the background bubble sync refreshes.
function appendCatalogBuff(buff: BuffDef): void {
  let buffs: any[] = [];
  let groupOrder: string[] | undefined;
  try {
    const raw = localStorage.getItem(LS_BUFF_CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) buffs = parsed;
      else if (parsed && Array.isArray(parsed.buffs)) {
        buffs = parsed.buffs;
        if (Array.isArray(parsed.groupOrder)) groupOrder = parsed.groupOrder;
      }
    }
  } catch {}
  // If the catalog is still empty (user never customised), seed it
  // from DEFAULT_BUFFS so we don't wipe the built-ins by writing a
  // one-entry catalog.
  if (buffs.length === 0) buffs = DEFAULT_BUFFS.map((b) => ({ ...b }));
  buffs.push(buff);
  try {
    localStorage.setItem(
      LS_BUFF_CATALOG_KEY,
      JSON.stringify({ version: 2, buffs, ...(groupOrder ? { groupOrder } : {}) }),
    );
  } catch (e) {
    console.warn("[status] appendCatalogBuff write failed", e);
    return;
  }
  // Same-iframe write doesn't fire `storage` for ourselves, but the
  // palette iframe IS a different iframe so it gets the event. Also
  // broadcast so the background sync + any other listener refresh.
  try {
    OBR.broadcast.sendMessage("com.obr-suite/status/catalog-changed", {}, { destination: "LOCAL" });
  } catch {}
}

async function registerCreateStatusMenu(): Promise<void> {
  const own = entrySession;
  if (!own) return;
  return queueEntry(() => createStatusMenu(own));
}

async function createStatusMenu(own: EntrySession): Promise<void> {
  if (!isCurrentEntry(own) || !active) return;
  try {
    await OBR.contextMenu.create({
      id: CTX_CREATE_STATUS,
      icons: [
        {
          icon: ICON_URL,
          label: entryText("create"),
          // Non-MAP image items only — turning a map/backdrop into a
          // buff icon makes no sense. No role filter: players can
          // build their own catalog (it's per-client localStorage).
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "MAP", operator: "!=" },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        if (!isCurrentEntry(own) || !active) return;
        const item = ctx.items[0] as any;
        if (!item || !item.image?.url) return;
        // 2026-05-14 (#2 fix) — write the image into `iconAsset` (a
        // STATIC-image buff) rather than `effectParams.imageUrl`. The
        // old effectParams path belongs to the DISABLED particle
        // system (STATUS_EFFECTS_ENABLED = false), so the renderer
        // ignored it and fell back to the text pill — that's the
        // "still text form" bug. iconAsset renders the image itself.
        //
        // 2026-05-18 — bake the SOURCE item's current scale +
        // rotation into the new buff. User: "状态调色板开启时右键
        // 物体以此创建状态时一次性的考虑该状态的缩放和旋转再写入".
        // Both webmScale and rotation feed through buildWebmItem when
        // the buff is later applied to a token; without these two
        // lines, a buff made from a 2×-scaled source image renders at
        // the wrong footprint and any pre-rotated source visual loses
        // its orientation.
        const srcScale = typeof item.scale?.x === "number" && item.scale.x > 0
          ? item.scale.x : 1.0;
        const srcRotation = typeof item.rotation === "number" && Number.isFinite(item.rotation)
          ? item.rotation : 0;
        const buff: BuffDef = {
          id: `custom-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
          name: (item.name as string) || entryText("newStatus"),
          color: "#ffffff",
          iconAsset: item.image.url as string,
          ...(srcScale !== 1.0 ? { webmScale: srcScale } : {}),
          ...(srcRotation !== 0 ? { rotation: srcRotation } : {}),
          ...(typeof item.image.mime === "string" && item.image.mime
            ? { iconMime: item.image.mime as string }
            : {}),
          ...(typeof item.image.width === "number" && item.image.width > 0
            ? { iconWidth: item.image.width as number }
            : {}),
          ...(typeof item.image.height === "number" && item.image.height > 0
            ? { iconHeight: item.image.height as number }
            : {}),
        };
        appendCatalogBuff(buff);
      },
    });
  } catch (e) {
    console.warn("[status] registerCreateStatusMenu failed", e);
  }
}

async function removeCreateStatusMenu(): Promise<void> {
  await queueEntry(async () => {
    try { await OBR.contextMenu.remove(CTX_CREATE_STATUS); } catch {}
  });
}

async function activate(): Promise<void> {
  if (active) return;
  active = true;
  await openPalette();
  // The "以此创建状态" menu only exists while the palette is open.
  await registerCreateStatusMenu();
}

async function deactivate(): Promise<void> {
  if (!active) return;
  active = false;
  await cancelSelectedApply();
  await closeCapture();
  await closeManagePopover();
  await closePalette();
  await removeCreateStatusMenu();
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

const LS_BUFF_CATALOG_KEY = "obr-suite/status/buff-catalog";

async function getCatalog(): Promise<BuffDef[]> {
  // Catalog is now per-client (localStorage). Reads in order:
  //   1. localStorage entry (primary post-2026-05-09)
  //   2. scene metadata (one-time migration source for upgrading users
  //      whose customisation still lives in shared scene state)
  // If neither yields a list, fall back to DEFAULT_BUFFS.
  let arr: any[] | null = null;
  try {
    const raw = localStorage.getItem(LS_BUFF_CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
      else if (parsed && Array.isArray(parsed.buffs)) arr = parsed.buffs;
    }
  } catch {}
  if (!arr) {
    try {
      const meta = await OBR.scene.getMetadata();
      const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
      if (Array.isArray(v)) arr = v as any[];
      else if (v && typeof v === "object" && Array.isArray((v as any).buffs)) {
        arr = (v as any).buffs as any[];
      }
    } catch {}
  }
  try {
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
        // 2026-05-14 — parse `webmAsset` so users who customised the
        // catalog manually keep their chosen WebM. Without this the
        // field round-trips as undefined and the parser silently
        // strips it on every load.
        const wa = (e as any).webmAsset;
        if (typeof wa === "string" && wa.length > 0) {
          def.webmAsset = wa;
        }
        // 2026-05-14b — same for webmScale (per-buff size multiplier).
        const ws = (e as any).webmScale;
        if (typeof ws === "number" && Number.isFinite(ws) && ws > 0) {
          def.webmScale = ws;
        }
        // 2026-05 — `webmOff`: explicit "this built-in buff's effect is
        // turned OFF" marker, set by the catalog editor's 无 / 默认特效
        // toggle. MUST be parsed BEFORE the re-seed below — otherwise
        // the re-seed resurrects the default WebM on every load (the
        // "切到无、保存后还是有特效" bug).
        if ((e as any).webmOff === true) def.webmOff = true;
        // 2026-05-14 (#2) — static-image icon fields ("以此创建状态").
        // Round-trip iconAsset / iconMime / iconWidth / iconHeight so a
        // catalog with image-based buffs survives parse↔save.
        const ia = (e as any).iconAsset;
        if (typeof ia === "string" && ia.length > 0) {
          def.iconAsset = ia;
          const im = (e as any).iconMime;
          if (typeof im === "string" && im.length > 0) def.iconMime = im;
          const iw = (e as any).iconWidth;
          if (typeof iw === "number" && Number.isFinite(iw) && iw > 0) def.iconWidth = iw;
          const ih = (e as any).iconHeight;
          if (typeof ih === "number" && Number.isFinite(ih) && ih > 0) def.iconHeight = ih;
        }
        // 2026-05-14 — back-compat migration. Users on the pre-WebM
        // build have a localStorage catalog without webmAsset on any
        // entry. For ids that ALSO appear in DEFAULT_BUFFS WITH a
        // webmAsset (paralyzed / stunned / poisoned), inherit it so
        // those buffs auto-upgrade to the animated WebM rendering on
        // first load of the new build. Won't clobber a user who has
        // already chosen a different webmAsset themselves (only fills
        // in `undefined`).
        // 2026-05-14b — extended: also inherit webmScale from the
        // fallback when the loaded entry has none. Without this,
        // users on old catalogs would see new custom WebMs (which
        // depend on webmScale to look right) at 1.0× scale and the
        // visual would clip / overlap.
        // …UNLESS the user explicitly turned the effect off (webmOff):
        // then we must NOT resurrect webmAsset / webmScale.
        if (!def.webmOff && (!def.webmAsset || !def.webmScale)) {
          const fallback = DEFAULT_BUFFS.find((b) => b.id === def.id);
          if (fallback) {
            if (!def.webmAsset && fallback.webmAsset) {
              def.webmAsset = fallback.webmAsset;
            }
            if (!def.webmScale && fallback.webmScale) {
              def.webmScale = fallback.webmScale;
            }
          }
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
  // 2026-05-13 — token.zIndex is part of the key so that when the
  // user re-orders tokens (send to back / bring to front), the
  // status items get rebuilt with the new zIndex base. bubbles.ts
  // computes the items' zIndex from `token.zIndex * STACK_MULT`.
  const z = typeof it.zIndex === "number" ? it.zIndex : 0;
  const rounds = readTokenBuffRounds(it);
  const roundsKey = ids.map((id) => `${id}:${rounds[id] ?? ""}`).join(",");
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
  return `${ids.join("|")}#${roundsKey}@${sx}x${sy}|${w}x${h}|z${z}`;
}

// Cache of "is current player a GM?" — initialised in setup, kept
// fresh by player.onChange. Only the GM client manages buff items
// so we don't get cross-client duplicates in scene.items, AND
// hidden-token bubbles route to scene.local (only the GM client
// sees them, satisfying "hidden character effects only show to
// DM").
let isGM = false;

function displayBuffsWithRounds(token: any, buffs: BuffDef[]): BuffDef[] {
  const rounds = readTokenBuffRounds(token);
  return buffs.map((b) => {
    const n = rounds[b.id];
    return n > 0 ? { ...b, name: `${b.name} ${n}` } : b;
  });
}

// === Per-token write serialization =========================================
//
// syncTokenBuffs deletes/adds bubble items with STABLE ids — two
// concurrent runs for the same token produce duplicate addItems and
// late-delete-kills-fresh-add interleavings. Every syncTokenBuffs call
// (full pass AND single-token refresh) chains on the token's promise
// tail so writes for one token are strictly sequential; different
// tokens still run in parallel.
const tokenSyncTails = new Map<string, Promise<boolean>>();
/** Serialized syncTokenBuffs for one token. Returns the sync's success
 *  flag — callers must not record the token as synced on false. */
async function syncOneToken(token: any, buffs: BuffDef[]): Promise<boolean> {
  const prev = tokenSyncTails.get(token.id) ?? Promise.resolve(true);
  // .catch on the previous tail: one failed sync must not wedge the
  // token's queue forever.
  const next = prev.catch(() => false).then(() => syncTokenBuffs(token, buffs));
  tokenSyncTails.set(token.id, next);
  try {
    return await next;
  } finally {
    if (tokenSyncTails.get(token.id) === next) tokenSyncTails.delete(token.id);
  }
}

async function syncAllVisibleTokensImpl(itemsSnapshot?: Item[]): Promise<void> {
  if (!isGM) return;
  try {
    // onChange delivers the complete scene — reuse it instead of
    // re-fetching the whole scene per pass (checklist §1).
    const items = itemsSnapshot ?? await OBR.scene.items.getItems();
    const next = new Map<string, string>();
    // First pass: cheap key compare, collect what actually changed.
    const cleanups: any[] = [];
    const changed: Array<{ token: any; ids: string[] }> = [];
    for (const it of items) {
      if (!(it as any).image || (it as any).type !== "IMAGE") continue;
      const ids = readTokenBuffIds(it);
      if (ids.length === 0) {
        if (lastBuffSnapshot.has(it.id)) cleanups.push(it);
        continue;
      }
      const key = tokenSyncKey(it, ids);
      next.set(it.id, key);
      if (lastBuffSnapshot.get(it.id) === key) continue;
      changed.push({ token: it, ids });
    }
    // Catalog parse once per pass, not once per changed token.
    const cat = changed.length > 0 ? await getCatalog() : [];
    const byId = new Map(cat.map((b) => [b.id, b]));
    for (const it of cleanups) {
      await syncOneToken(it, []);
    }
    for (const { token, ids } of changed) {
      const buffs = ids
        .map((id) => byId.get(id))
        .filter((b): b is BuffDef => !!b);
      const ok = await syncOneToken(token, displayBuffsWithRounds(token, buffs));
      // Failed scene write: drop the key so the next pass retries this
      // token instead of key-skipping it forever.
      if (!ok) next.delete(token.id);
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
// Newest scene snapshot delivered by items.onChange — the queued
// coalesced rerun reuses it instead of re-fetching the whole scene.
let latestItemsSnapshot: Item[] | null = null;
// Sticky full-resync request (catalog edit / render-mode flip). A bare
// lastBuffSnapshot.clear() from those handlers can be LOST when a pass
// is in flight: the pass ends with `lastBuffSnapshot = next`, replacing
// the map that was just cleared, and the queued rerun then key-skips
// everything. The flag is consumed at the START of the next impl run,
// which is serialized, so the clear always lands on a fresh pass.
let forceFullResync = false;

// Exclusive gate shared by the sync pass AND sweepAllOurItems. Without
// it a sweep's cache-invalidate can be undone by a concurrent pass
// whose hydrate read raced the sweep's deleteItems: the pass would
// repopulate the sig caches from pre-sweep scene state, the sweep then
// deletes the real items, and every later pass diffs to zero ops —
// bubbles permanently missing after a scene switch (checklist §1).
let exclusiveChain: Promise<void> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = exclusiveChain.then(fn, fn);
  exclusiveChain = run.then(() => undefined, () => undefined);
  return run;
}
/** sweepAllOurItems, serialized against the sync pass. Every sweep in
 *  this module must go through here. */
function sweepExclusive(): Promise<void> {
  return runExclusive(() => sweepAllOurItems());
}

async function syncAllVisibleTokens(itemsSnapshot?: Item[]): Promise<void> {
  if (syncRunning) {
    syncQueued = true;
    return;
  }
  syncRunning = true;
  try {
    await runExclusive(() => {
      if (forceFullResync) {
        forceFullResync = false;
        lastBuffSnapshot.clear();
      }
      return syncAllVisibleTokensImpl(itemsSnapshot);
    });
  } finally {
    syncRunning = false;
    if (syncQueued) {
      syncQueued = false;
      void syncAllVisibleTokens(latestItemsSnapshot ?? undefined);
    }
  }
}

async function refreshTokenBuffs(tokenId: string): Promise<void> {
  // GM is the sole bubble-item writer (same gate as the full pass) —
  // a player client running this raced the GM's writes with the same
  // stable item ids. Player metadata writes replicate to the GM whose
  // onChange pass renders them.
  if (!isGM) return;
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    const token = items[0];
    if (!token || (token as any).type !== "IMAGE") return;
    const ids = readTokenBuffIds(token);
    const cat = await getCatalog();
    const buffs = ids
      .map((id) => cat.find((b) => b.id === id))
      .filter((b): b is BuffDef => !!b);
    const ok = await syncOneToken(token, displayBuffsWithRounds(token, buffs));
    // Keep the full pass' cache honest so it doesn't redo this token —
    // but only on success; a failed write must stay retryable.
    if (!ok) lastBuffSnapshot.delete(tokenId);
    else if (ids.length === 0) lastBuffSnapshot.delete(tokenId);
    else lastBuffSnapshot.set(tokenId, tokenSyncKey(token, ids));
  } catch (e) {
    console.warn("[status] refreshTokenBuffs failed", { tokenId, error: e });
  }
}

function readCombatRound(meta: Record<string, unknown>): number | null {
  const state = meta[COMBAT_STATE_KEY] as { inCombat?: unknown; round?: unknown } | undefined;
  if (!state || state.inCombat !== true) return null;
  const round = Number(state.round);
  return Number.isFinite(round) && round > 0 ? Math.floor(round) : null;
}

let lastCombatRound: number | null = null;
let tickingBuffRounds = false;

async function decrementBuffRounds(): Promise<void> {
  if (!isGM || tickingBuffRounds) return;
  tickingBuffRounds = true;
  let tickTokenIds: string[] = [];
  try {
    const tokens = await OBR.scene.items.getItems((item) => {
      const ids = item.metadata?.[STATUS_BUFFS_KEY];
      const rounds = item.metadata?.[STATUS_BUFF_ROUNDS_KEY];
      return Array.isArray(ids) && !!rounds && typeof rounds === "object";
    });
    if (tokens.length === 0) return;
    tickTokenIds = tokens.map((t) => t.id);
    await OBR.scene.items.updateItems(tokens.map((t) => t.id), (drafts) => {
      for (const d of drafts) {
        const ids = readTokenBuffIds(d as any);
        const cur = readTokenBuffRounds(d as any);
        let changed = false;
        const nextRounds: Record<string, number> = {};
        const nextIds: string[] = [];
        for (const id of ids) {
          const n = cur[id];
          if (n > 0) {
            const left = n - 1;
            changed = true;
            if (left > 0) {
              nextRounds[id] = left;
              nextIds.push(id);
            }
          } else {
            nextIds.push(id);
          }
        }
        if (!changed) continue;
        d.metadata[STATUS_BUFFS_KEY] = nextIds;
        d.metadata[STATUS_BUFF_ROUNDS_KEY] = nextRounds;
      }
    });
  } catch (e) {
    console.warn("[status] decrementBuffRounds failed", { tokenIds: tickTokenIds, stage: "round-tick", error: e });
  } finally {
    tickingBuffRounds = false;
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
  const own: EntrySession = { alive: true };
  entrySession = own;

  // Toolbar tool — same model as Bestiary (item 2 in the user's
  // 2026-05-04 spec). Click the icon → activate the tool → palette
  // opens. Click any other tool → deactivate → palette closes.
  // No role filter — anyone can manage their own / shared tokens
  // (item 4 in the same spec).
  try {
    own.tool = {
      id: TOOL_ID,
      icons: [
        {
          icon: ICON_URL,
          label: entryText("tool"),
          // No `roles` filter — both GM and players see the icon.
          // Per-token permission for buff writes is enforced by the
          // OBR scene-items API itself: players can only modify
          // tokens they own / created. The bubble RENDERING (sync
          // loop in `syncAllVisibleTokensImpl`) is still GM-gated
          // since only one client should own the persistent items.
        },
      ],
      onClick: async () => {
        if (!isCurrentEntry(own)) return false;
        await OBR.tool.activateTool(TOOL_ID);
        return false;
      },
    };
    await queueEntry(async () => { if (isCurrentEntry(own)) await OBR.tool.create(own.tool!); });
  } catch (e) {
    console.warn("[status] tool.create failed", e);
  }
  try {
    own.mode = {
      id: `${TOOL_ID}/mode`,
      icons: [
        {
          icon: ICON_URL,
          label: entryText("tool"),
          filter: { activeTools: [TOOL_ID] },
        },
      ],
      cursors: [{ cursor: "default" }],
      onToolDown: async (_ctx, event) => {
        if (!isCurrentEntry(own)) return;
        if ((event as any).button === 2) await cancelSelectedApply();
      },
      onToolClick: async (_ctx, event) => {
        if (!isCurrentEntry(own)) return false;
        return handleSelectedCanvasClick(event as any);
      },
      onKeyDown: async (_ctx, event) => {
        if (!isCurrentEntry(own)) return;
        if (event.key !== "Escape") return;
        await cancelSelectedApply();
      },
      onDeactivate: async () => {
        if (!isCurrentEntry(own)) return;
        await cancelSelectedApply();
      },
    };
    await queueEntry(async () => { if (isCurrentEntry(own)) await OBR.tool.createMode(own.mode!); });
  } catch (e) {
    console.warn("[status] createMode failed", e);
  }
  if (!isCurrentEntry(own)) return;

  // Track which tool is active and open / close the palette in sync.
  // Activating the status-tracker tool calls `activate()`; switching
  // away calls `deactivate()` so the palette closes when the user
  // picks any other tool, matching Bestiary's UX.
  unsubs.push(
    OBR.tool.onToolChange(async (activeId) => {
      if (!isCurrentEntry(own)) return;
      try {
        if (activeId === TOOL_ID) {
          if (!active) await activate();
        } else {
          // Remember the tool the user switched to (so `]` can switch
          // back to it next time).
          previousTool = activeId;
          if (active) await deactivate();
        }
      } catch (e) {
        console.warn("[status] tool.onToolChange failed", e);
      }
    }),
  );

  // `]` shortcut — keep working (item 2 doesn't ask to remove it,
  // and the muscle memory matters). Now toggles via the tool API
  // rather than calling `toggle()` directly so the active tool
  // stays in sync with the palette state.
  const performShortcutToggle = async (): Promise<void> => {
    if (!isCurrentEntry(own)) return;
    try {
      const cur = await OBR.tool.getActiveTool();
      if (!isCurrentEntry(own)) return;
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
    own.action = {
      id: TOOL_ACTION_ID,
      shortcut: "BracketRight",
      icons: [{
        icon: ICON_URL,
        label: entryText("tool"),
        // Available on Select + on the status tracker tool itself
        // (so pressing `]` again from inside the tool exits it).
        // No roles filter — players can press `]` too.
        filter: { activeTools: [SELECT_TOOL, TOOL_ID] },
      }],
      onClick: performShortcutToggle,
    };
    await queueEntry(async () => { if (isCurrentEntry(own)) await OBR.tool.createAction(own.action!); });
  } catch (e) {
    console.warn("[status] createAction failed", e);
  }
  if (!isCurrentEntry(own)) return;
  let lastLang = getLocalLang();
  unsubs.push(onLangChange((lang) => {
    if (!isCurrentEntry(own) || lang === lastLang) return;
    lastLang = lang;
    void queueEntry(() => refreshEntryLabels(own)).catch(() => {});
    if (active) void registerCreateStatusMenu();
  }));
  // Catch a language change while the initial host registrations were pending.
  if ([own.tool, own.mode, own.action].some(def => def?.icons[0]?.label !== entryText("tool"))) {
    await queueEntry(() => refreshEntryLabels(own));
  }

  unsubs.push(
    OBR.broadcast.onMessage(BC_SELECT_APPLY, (event) => {
      const data = event.data as
        | { kind?: "buff"; buff?: BuffDef; key?: string }
        | { kind?: "clear"; key?: "__clear__" }
        | { kind?: "manage"; key?: "__manage__" }
        | undefined;
      if (!data?.kind) return;
      let capturePayload: Parameters<typeof openCapture>[0] | null = null;
      if (data.kind === "buff") {
        if (!data.buff?.id) return;
        selectedApply = { kind: "buff", key: data.key || data.buff.id, buff: data.buff };
        capturePayload = { kind: "buff", buff: data.buff, mode: "click-place" };
      } else if (data.kind === "clear") {
        selectedApply = { kind: "clear", key: "__clear__" };
        capturePayload = { kind: "clear", mode: "click-place" };
      } else if (data.kind === "manage") {
        selectedApply = { kind: "manage", key: "__manage__" };
        capturePayload = { kind: "manage", mode: "click-place" };
      }
      void publishSelectedApplyState();
      if (capturePayload) void openCapture(capturePayload);
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_SELECT_CANCEL, () => { void cancelSelectedApply(); }),
  );

  // Palette → background broadcasts. The drag-start payload now
  // includes `mode` (drop / paint-toggle) so the capture overlay
  // splits behaviour by mouse button (left = drop-on-release,
  // right = drag-paint with toggle).
  unsubs.push(
    OBR.broadcast.onMessage(BC_DRAG_START, (event) => {
      const data = event.data as {
        kind: "buff" | "clear" | "manage" | "manage-transfer" | "preset";
        buff?: BuffDef;
        mode?: "drop" | "paint-toggle";
        sourceTokenId?: string;
        presetId?: string;
        presetName?: string;
        count?: number;
      } | undefined;
      if (!data) return;
      void openCapture({
        kind: data.kind,
        buff: data.buff,
        mode: data.mode === "paint-toggle" ? "paint-toggle" : "drop",
        sourceTokenId: data.sourceTokenId,
        presetId: data.presetId,
        presetName: data.presetName,
        presetCount: data.count,
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
        void sweepExclusive();
      }
    }),
  );

  // Token-bubble sync. onChange delivers the complete scene snapshot —
  // hand it to the sync pass so it never re-reads the whole scene.
  unsubs.push(OBR.scene.items.onChange((items) => {
    latestItemsSnapshot = items;
    void syncAllVisibleTokens(items);
  }));
  // Catalog edits live in localStorage now (per-client, not shared).
  // When the user edits a buff's colour/effect via the palette ✎
  // popup, status-tracker-page broadcasts BC_CATALOG_CHANGED so this
  // background re-renders the bubbles with the new visual. The
  // `storage` event covers cross-tab changes (palette + manage popover
  // editing in parallel).
  try {
    const meta0 = await OBR.scene.getMetadata();
    lastCombatRound = readCombatRound(meta0 as Record<string, unknown>);
  } catch {}
  unsubs.push(OBR.scene.onMetadataChange((metaEvent) => {
    const nextRound = readCombatRound(metaEvent as Record<string, unknown>);
    if (isGM && nextRound !== null) {
      if (lastCombatRound !== null && nextRound > lastCombatRound) {
        void decrementBuffRounds();
      }
      lastCombatRound = nextRound;
    } else if (nextRound === null) {
      lastCombatRound = null;
    }
  }));
  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/status/catalog-changed", () => {
      // Sticky flag, not a bare clear() — see forceFullResync.
      forceFullResync = true;
      void syncAllVisibleTokens();
    }),
  );
  const onLSChange = (e: StorageEvent): void => {
    if (e.key !== LS_BUFF_CATALOG_KEY) return;
    forceFullResync = true;
    void syncAllVisibleTokens();
  };
  window.addEventListener("storage", onLSChange);
  unsubs.push(() => window.removeEventListener("storage", onLSChange));
  const onSceneReady = async (): Promise<void> => {
    if (!isGM) {
      lastBuffSnapshot.clear();
      return;
    }
    // Sweep first — clears any items left by an older renderer
    // (e.g. legacy rectangle-style bubbles) before we start drawing
    // the new curved bands. Serialized under the exclusive gate so no
    // onChange-driven pass can hydrate mid-sweep and repopulate the
    // sig caches from pre-sweep scene state.
    await sweepExclusive();
    lastBuffSnapshot.clear();
    void syncAllVisibleTokens();
  };
  if (await OBR.scene.isReady()) {
    await onSceneReady();
  }
  unsubs.push(
    OBR.scene.onReadyChange((ready) => {
      if (ready) void onSceneReady();
      else {
        lastBuffSnapshot.clear();
        latestItemsSnapshot = null;
        // Sig caches describe items of the scene we just LEFT — a
        // stale hit here was the "return to a scene → bubbles never
        // re-added" bug (checklist §1 scene-switch case).
        invalidateAllBuffCaches();
      }
    }),
  );
}

export async function teardownStatusTracker(): Promise<void> {
  if (entrySession) entrySession.alive = false;
  entrySession = null;
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
  await entryQueue;
  try { await OBR.tool.removeAction(TOOL_ACTION_ID); } catch {}
  try { await OBR.tool.removeMode(`${TOOL_ID}/mode`); } catch {}
  try { await OBR.tool.remove(TOOL_ID); } catch {}
  await removeCreateStatusMenu();
  // Force-close every popover/modal UNCONDITIONALLY. We can't rely on
  // deactivate() here — it early-returns when the status tool isn't the
  // active tool (e.g. user switched to Select, then disabled the module
  // in Settings), which would leave the capture / manage modal open.
  active = false;
  try { await closeCapture(); } catch {}
  try { await closeManagePopover(); } catch {}
  try { await closePalette(); } catch {}
  await sweepExclusive();
}
