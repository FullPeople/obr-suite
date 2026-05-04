// Per-client custom panel positions for the 5 draggable suite popovers.
//
// Each panel has a built-in default anchor (e.g. cluster = bottom-right
// with rightOffset/bottomOffset). On top of that, the user can drag the
// panel via its grip handle and the resulting `(dx, dy)` offset is
// persisted to localStorage. Every time the panel opens, its background
// module reads the offset and applies it to the anchor `left/top`
// coords passed to OBR.popover.open().
//
// OBR has no `popover.setPosition()` API and re-issuing
// `OBR.popover.open()` triggers the SDK's fade-in/out animation, so
// real-time drag preview is inherently flickery. The drag controller
// (see panelDrag.ts) only fires the SDK update on pointerup — during
// drag it just translates the iframe's CSS transform locally so the
// user gets instant feedback. The popover snaps to the final offset
// once at release.

export const PANEL_IDS = {
  cluster: "cluster",
  /** Cluster ROW (the action button strip that opens above the
   *  trigger). Treated as its own draggable panel so the layout
   *  editor can reposition it independently of the trigger. */
  clusterRow: "cluster-row",
  diceHistory: "dice-history",
  /** Dice-history TRIGGER button at the bottom-right (the d20 chip
   *  the user clicks to toggle the history popover). Independent
   *  panel so users can move the trigger out of OBR's bottom-right
   *  hot-zone if it overlaps something else. */
  diceHistoryTrigger: "dice-history-trigger",
  initiative: "initiative",
  bestiaryPanel: "bestiary-panel",
  bestiaryInfo: "bestiary-info",
  ccInfo: "cc-info",
  search: "search",
  portalEdit: "portal-edit",
  /** Status-tracker buff palette (the bottom-right pop-up). Drag the
   *  header to relocate; participates in the layout-editor along
   *  with everything else. */
  statusPalette: "status-palette",
  /** Standalone HP / Temp / AC bar that auto-pops on selection of a
   *  lightweight token (no bestiary slug, no character-card binding,
   *  but with the per-token `hp-bar-enabled` flag set via the
   *  right-click menu). Same drag mechanics as the bestiary info /
   *  cc-info popovers. */
  hpBar: "hp-bar",
} as const;

export type PanelId = (typeof PANEL_IDS)[keyof typeof PANEL_IDS];

export interface PanelOffset {
  /** Logical x displacement from the panel's default anchor. Positive
   *  means dragged towards the right edge of the viewport. */
  dx: number;
  /** Logical y displacement. Positive means dragged towards the bottom. */
  dy: number;
}

const STORAGE_PREFIX = "obr-suite/panel-offset/";
const ZERO: PanelOffset = { dx: 0, dy: 0 };

/** Read the persisted offset for a panel. Returns {0,0} when nothing
 *  has been stored, when storage is unavailable, or when the stored
 *  value is malformed. */
export function getPanelOffset(panelId: string): PanelOffset {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + panelId);
    if (!raw) return { ...ZERO };
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed === "object" &&
      typeof parsed.dx === "number" && Number.isFinite(parsed.dx) &&
      typeof parsed.dy === "number" && Number.isFinite(parsed.dy)
    ) {
      return { dx: parsed.dx, dy: parsed.dy };
    }
  } catch {}
  return { ...ZERO };
}

export function setPanelOffset(panelId: string, offset: PanelOffset): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + panelId, JSON.stringify(offset));
  } catch {}
}

export function clearPanelOffset(panelId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + panelId);
  } catch {}
}

// === Per-panel SIZE overrides (added for the layout editor's resize) ==
// Separate from offsets so a user who only moves a panel doesn't end
// up locking its size at the moment-of-move dimensions. Modules that
// can honour a size override read getPanelSize() at open() time and
// fall back to their compiled-in defaults when null.

const SIZE_PREFIX = "obr-suite/panel-size/";

export interface PanelSize {
  width: number;
  height: number;
}

export function getPanelSize(panelId: string): PanelSize | null {
  try {
    const raw = localStorage.getItem(SIZE_PREFIX + panelId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed === "object" &&
      typeof parsed.width === "number" && Number.isFinite(parsed.width) && parsed.width > 0 &&
      typeof parsed.height === "number" && Number.isFinite(parsed.height) && parsed.height > 0
    ) {
      return { width: parsed.width, height: parsed.height };
    }
  } catch {}
  return null;
}

export function setPanelSize(panelId: string, size: PanelSize): void {
  try {
    localStorage.setItem(SIZE_PREFIX + panelId, JSON.stringify(size));
  } catch {}
}

export function clearPanelSize(panelId: string): void {
  try {
    localStorage.removeItem(SIZE_PREFIX + panelId);
  } catch {}
}

/** Reset every panel's stored offset AND size back to defaults. */
export function resetAllPanelOffsets(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(STORAGE_PREFIX) || key.startsWith(SIZE_PREFIX))) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

/** LOCAL broadcast: an iframe's drag handle telling the background
 *  module the user just released after a drag. Payload =
 *  `{ panelId, offset }`. Background re-issues OBR.popover.open()
 *  with the new anchor. */
export const BC_PANEL_DRAG_END = "com.obr-suite/panel-drag-end";

/** LOCAL broadcast: settings panel issued a reset. Every iframe with
 *  an open panel listens, clears its `transform` CSS, and the
 *  background module re-anchors all panels at default. */
export const BC_PANEL_RESET = "com.obr-suite/panel-reset";

/** LOCAL broadcast: pointerdown on a drag handle. Background opens a
 *  fullscreen drag-preview modal at the panel's current bbox. The
 *  modal renders a translucent ghost the user drags around. */
export const BC_PANEL_DRAG_START = "com.obr-suite/panel-drag-start";

/** LOCAL broadcast: pointermove during drag. Modal updates the ghost
 *  position. Payload = `{ panelId, dx, dy }` in screen-pixel deltas
 *  from the original pointerdown. */
export const BC_PANEL_DRAG_MOVE = "com.obr-suite/panel-drag-move";

/** LOCAL broadcast: drag cancelled (pointercancel or escape). Modal
 *  closes itself, offset is NOT persisted. */
export const BC_PANEL_DRAG_CANCEL = "com.obr-suite/panel-drag-cancel";

export interface DragEndPayload {
  panelId: string;
  offset: PanelOffset;
  /** Layout editor includes a size override on the same broadcast so
   *  panels re-anchor with the new dimensions in one round trip
   *  instead of needing a separate resize message. */
  size?: PanelSize;
}

export interface DragStartPayload {
  panelId: string;
  /** Pointer screen position at pointerdown — used as the origin for
   *  delta calculations on subsequent moves. */
  startScreenX: number;
  startScreenY: number;
  /** The panel's bbox in OBR-viewport coordinates at pointerdown. The
   *  modal renders the ghost at exactly this rect, then translates it
   *  by the drag delta on each move. */
  bbox: { left: number; top: number; width: number; height: number };
}

export interface DragMovePayload {
  panelId: string;
  dx: number;
  dy: number;
}

/** Modal id for the fullscreen drag-preview overlay. Single instance
 *  — only one panel can be dragged at a time. */
export const DRAG_PREVIEW_MODAL_ID = "com.obr-suite/drag-preview";

/** Layout-editor modal id. Opened from Settings → 基础设置. */
export const LAYOUT_EDITOR_MODAL_ID = "com.obr-suite/layout-editor";

/** LOCAL broadcast: settings panel asks background to open the
 *  layout editor. Background gathers all panel bboxes from the
 *  registry, encodes them into the modal URL's hash, and opens
 *  the modal — settings can't do this itself because the bbox
 *  registry only exists in the background iframe. */
export const BC_OPEN_LAYOUT_EDITOR = "com.obr-suite/open-layout-editor";

/** LOCAL broadcast: tell an iframe its panel's drag-handle side
 *  should flip (panel just got dragged across the viewport midpoint).
 *  Payload: `{ panelId, side: "left" | "right" }`. Iframes that have
 *  registered drag-handle UX subscribe via watchDragSide(). */
export const BC_PANEL_SIDE_HINT = "com.obr-suite/panel-side-hint";

// === Bbox registry ====================================================
// Each draggable panel exposes a bbox provider so background.ts can
// look up the panel's CURRENT viewport-coord rect at drag-start time.
// (The iframe can't compute this itself: window.screenX is identical
// for every iframe in the same browser window, so an iframe-side
// "self-position" calculation always returns 0,0.)

export interface PanelBbox {
  /** Top-left in OBR-viewport coords (which is what fullscreen modals
   *  also use, so the modal can render the ghost directly without
   *  conversion). */
  left: number;
  top: number;
  width: number;
  height: number;
}

type BboxProvider = () => Promise<PanelBbox | null> | PanelBbox | null;

const bboxProviders = new Map<string, BboxProvider>();

/** Register a bbox provider for `panelId`. Each module's setup calls
 *  this once. The provider can be sync or async. */
export function registerPanelBbox(panelId: string, provider: BboxProvider): void {
  bboxProviders.set(panelId, provider);
}

export async function computePanelBbox(panelId: string): Promise<PanelBbox | null> {
  const p = bboxProviders.get(panelId);
  if (!p) return null;
  try {
    const result = await p();
    return result ?? null;
  } catch {
    return null;
  }
}
