// fullFog editor — main entry for the fullscreen modal.
//
// Composition layers (low to high):
//   1. base layer: either the source image, OR a B&W threshold preview
//      built from the current algorithm. Switched via displayMode.
//   2. mask layer: RGBA canvas same dims as image. Pixels where
//      mask=255 are tinted orange@55%, others are transparent. Drawn
//      with `drawImage` over the base — no per-pixel CPU loop on each
//      redraw.
//   3. tool overlays: lasso path, polygon vertices, rectangle preview,
//      drawn in screen space.
//
// Stroke rendering is incremental: each pointermove only updates the
// dirty rect of `maskLayer` (a few hundred px around the brush), not
// the whole image (millions of px). Algorithm + refinement runs are
// the only times we rebuild the full mask layer.
//
// Pipeline on save:
//   mask -> traceContours -> simplifyDP -> imagePxToWorld -> buildPath

import OBR, { isImage, isPath, buildPath, type Item } from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../state";
import { MODAL_ID, FOG_PATH_KEY, FOG_MAP_KEY, DEFAULT_PREFS, LS_PREFS } from "./types";
import type { ToolId, EditorPrefs, AlgorithmId, Vec2, ShapeToolId, ShapeMode } from "./types";
import { toGray, thresholdMask, gaussBlur3, gaussBlur5 } from "./algorithms/grayscale";
import { otsuMask } from "./algorithms/otsu";
import { adaptiveMask } from "./algorithms/adaptive";
import { colorDistanceMask } from "./algorithms/colorDistance";
import { colorExcludeMask } from "./algorithms/colorExclude";
import { satAwareMask } from "./algorithms/satAware";
import { open as morphOpen, close as morphClose } from "./refinement/morphology";
import { areaFilter, connectedComponents } from "./refinement/components";
import { selectiveHoleFill } from "./refinement/holeFill";
import { stampCircle, stampSegment } from "./tools/brush";
import { fillPolygon, fillRectangle } from "./tools/polygon";
import { magicWand, paintBucket } from "./tools/floodFill";
import { traceContours } from "./output/contours";
import { simplifyDP } from "./output/simplify";
import { buildFogPath, FOG_PATH_KIND_KEY } from "./output/obrPath";
import { imagePxToMapLocal } from "./output/obrWalls";
import { safeWallOffset } from "./output/wallOffset";
import { samplePathCommands } from "./output/samplePath";
// 2026-08-25 — opening bookkeeping shares the dynfog engine's geometry
// so the (polyIndex, t) space the editor writes is exactly the one the
// wall engine reads back. That is why `commandsToPolylines` replaces the
// local `samplePathCommands(cmds, 8)` here — see the determinism
// contract in dynfog/geom/drawing.ts.
import { OPENINGS_KEY, SNAP_DISTANCE } from "./dynfog/ids";
import {
  newOpeningId,
  type Opening,
  type OpeningKind,
} from "./dynfog/opening/types";
import { commandsToPolylines } from "./dynfog/geom/drawing";
import { pointAtT, snapToPolylines } from "./dynfog/geom/polyline";
import {
  itemMatrix,
  transformPoint,
  inverseTransformPoint,
} from "./dynfog/geom/xform";

/** Map-local → world for an item whose transform mirrors the map's. */
const mapLocalToWorld = (pt: Vec2, item: any): Vec2 =>
  transformPoint(itemMatrix(item), pt);
/** World → map-local. Inverse of the above. */
const worldToMapLocal = (pt: Vec2, item: any): Vec2 =>
  inverseTransformPoint(itemMatrix(item), pt);
import { chaikinSmooth, smoothToPolyline, smoothToPathCommands } from "./output/smooth";
import { encodeMaskRle, decodeMaskRle } from "./output/maskRle";
import { Command } from "@owlbear-rodeo/sdk";
import {
  fitToView,
  zoomAt,
  viewToImage,
  type View,
} from "./editor/viewport";
import { History } from "./editor/history";

// --- Read map id from URL --------------------------------------------------

const params = new URLSearchParams(location.search);
const mapItemId = params.get("id") ?? "";

// Dev-only editor; per-client language read once at load. Static HTML
// chrome carries data-en / data-en-title attrs translated here at boot.
const en = getLocalLang() === "en";
if (en) {
  document.title = "Edit map fog · fullFog";
  document.querySelectorAll<HTMLElement>("[data-en]").forEach((el) => { el.textContent = el.dataset.en!; });
  document.querySelectorAll<HTMLElement>("[data-en-title]").forEach((el) => { el.title = el.dataset.enTitle!; });
  document.querySelectorAll<HTMLOptionElement>("[data-en-opt]").forEach((el) => { el.textContent = el.dataset.enOpt!; });
}

// --- DOM -------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("canvas");
const ctx2d = canvas.getContext("2d", { alpha: true })!;
const stTool = $("st-tool");
const stZoom = $("st-zoom");
const stPos = $("st-pos");
const stMask = $("st-mask");
const stInfo = $("st-info");
const mapMetaEl = $("map-meta");

// --- State -----------------------------------------------------------------

let mapItem: any | null = null;
let mapImage: ImageBitmap | null = null;
let imgW = 0, imgH = 0;
/** Source image RGBA bytes (4·W·H). Used by algorithms + magic wand. */
let imgRGBA: Uint8ClampedArray | null = null;
/** Working mask, dimensions = image. 0/255 per pixel. */
let mask: Uint8Array | null = null;

/** 2026-05-26 (Phase C) — optional B&W reference image. The user's
 *  workflow: feed the original map to an AI, get back a clean
 *  high-contrast black-line-on-white "walls only" overlay, import
 *  it here, and run the algorithms against the B&W instead of the
 *  noisy original. The B&W is auto-resized to (imgW × imgH) so all
 *  downstream code keeps working with the same pixel grid.
 *  - bwImage: original-resolution HTMLImageElement for canvas
 *    overlay rendering (shown semi-transparent over the original).
 *  - bwRGBA: pre-resampled to imgW × imgH so runAlgorithm /
 *    rebuildThreshold can treat it as a drop-in replacement for
 *    imgRGBA.
 *  - bwShow / bwOpacity: GM-side overlay controls (don't affect
 *    algorithm input — only what's painted on the canvas). */
let bwImage: HTMLImageElement | null = null;
let bwRGBA: Uint8ClampedArray | null = null;
let bwShow: boolean = true;
let bwOpacity: number = 0.85;

/** 2026-05-26 (Phase D) — door tool state.
 *
 *  Doors are two-point straight lines living in IMAGE-PIXEL space
 *  (same coord system as `mask`). They are NOT in the mask — the
 *  brush, eraser, lasso, algorithm apply, etc. all leave them
 *  untouched. They render on top of everything as red (closed) or
 *  green (open) lines. On save, each door becomes a tiny FOG-layer
 *  Path with a `rodeo.owlbear.dynamic-fog/doors` metadata entry
 *  covering ~100% of its length; the official dynamic-fog plugin
 *  handles the rest (auto-deriving Wall items, slicing them when
 *  open). The fullFog plugin-id keys below mark items so we can
 *  re-hydrate doors[] on subsequent editor opens.
 */
type EditorDoor = {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  open: boolean;
};
let doors: EditorDoor[] = [];
let selectedDoorId: string | null = null;
type DoorDragKind = "endpoint1" | "endpoint2" | "whole";
let doorDrag: {
  kind: DoorDragKind;
  doorId: string;
  startImg: { x: number; y: number };
  orig: EditorDoor;
} | null = null;
let doorPlacement: { x: number; y: number } | null = null;
const DYNAMIC_FOG_DOORS_KEY = "rodeo.owlbear.dynamic-fog/doors";
// Distinct kind for our own door persistence; reusable by the
// loadExistingFog scanner to skip wall outlines vs doors.
const FULLFOG_DOOR_KIND = "door";
// Hit-test thresholds in screen pixels (converted to image px via
// view.zoom at the call site).
const DOOR_HANDLE_HIT_PX = 10;
const DOOR_LINE_HIT_PX = 8;
function newDoorId(): string {
  return `door-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Canvas door / window openings (the dynfog door tool) — preservation
// across a re-save.
//
// Those openings are NOT the Phase-D editor doors above. They live as
// an `openings[]` array on the outline Path's metadata, addressed by
// (polyIndex, t1, t2) — normalised arc-length on that Path's sampled
// polylines. A bound save deletes every fog Path for the map and
// writes fresh ones, so the array (and with it every door and window
// the GM placed on the canvas) used to be lost on each re-save.
//
// The parameters can't be carried over verbatim — the new walls have
// different geometry — so we snapshot each opening's two endpoints in
// WORLD coordinates, then re-project them onto the newly built paths
// and recompute (polyIndex, t1, t2) there. Openings whose stretch of
// wall no longer exists (the GM repainted that room) are dropped, and
// the save status line reports how many.

/** Endpoint pair of one opening, in world coords, plus its state. */
interface PreservedOpening {
  kind: OpeningKind;
  open: boolean;
  a: Vec2;
  b: Vec2;
}

/** Snapshot the canvas openings of every outline Path bound to this
 *  map, before the save wipes those Paths. */
async function snapshotOpenings(mapId: string): Promise<PreservedOpening[]> {
  const out: PreservedOpening[] = [];
  try {
    const paths = await OBR.scene.items.getItems((it: Item) => {
      if (!isPath(it)) return false;
      if ((it as any).attachedTo !== mapId) return false;
      const md = (it.metadata as any) ?? {};
      if (!md[FOG_PATH_KEY]) return false;
      const kind = md[FOG_PATH_KIND_KEY];
      if (kind && kind !== "outline") return false;
      return Array.isArray(md[OPENINGS_KEY]) && md[OPENINGS_KEY].length > 0;
    });
    for (const p of paths) {
      const cmds = (p as any).commands;
      if (!Array.isArray(cmds) || cmds.length === 0) continue;
      const polys = commandsToPolylines(cmds);
      const list = ((p.metadata as any)[OPENINGS_KEY] ?? []) as Opening[];
      for (const op of list) {
        const poly = polys[op.polyIndex];
        if (!poly) continue;
        const a = pointAtT(poly, Math.min(op.t1, op.t2));
        const b = pointAtT(poly, Math.max(op.t1, op.t2));
        if (!a || !b) continue;
        // The Path's own transform mirrors the map's as of the save
        // that produced it, so go through world coords — the map may
        // have been moved or rescaled since.
        out.push({
          kind: op.kind,
          open: !!op.open,
          a: mapLocalToWorld(a, p),
          b: mapLocalToWorld(b, p),
        });
      }
    }
  } catch (e) {
    console.warn("[fullFog] snapshot openings failed", e);
  }
  return out;
}

/** Re-project preserved openings onto freshly built outline Paths,
 *  mutating their metadata in place. Returns how many were kept. */
function reattachOpenings(
  preserved: PreservedOpening[],
  newPaths: any[],
  mapItem_: any,
): number {
  if (preserved.length === 0 || newPaths.length === 0) return 0;
  const samples = newPaths.map((p) => commandsToPolylines(p.commands ?? []));
  let kept = 0;
  for (const pr of preserved) {
    const la = worldToMapLocal(pr.a, mapItem_);
    const lb = worldToMapLocal(pr.b, mapItem_);
    let best: { idx: number; polyIndex: number; t1: number; t2: number; d: number } | null = null;
    for (let i = 0; i < newPaths.length; i++) {
      const ha = snapToPolylines(la, samples[i]);
      const hb = snapToPolylines(lb, samples[i]);
      // Both ends must land on the SAME polyline — an opening spanning
      // two contours is meaningless.
      if (!ha || !hb || ha.polyIndex !== hb.polyIndex) continue;
      const d = Math.max(ha.distance, hb.distance);
      if (d > SNAP_DISTANCE) continue;
      if (!best || d < best.d) {
        best = {
          idx: i,
          polyIndex: ha.polyIndex,
          t1: Math.min(ha.t, hb.t),
          t2: Math.max(ha.t, hb.t),
          d,
        };
      }
    }
    if (!best || best.t2 - best.t1 < 1e-4) continue;
    const md = newPaths[best.idx].metadata as any;
    const list: Opening[] = Array.isArray(md[OPENINGS_KEY]) ? md[OPENINGS_KEY] : [];
    list.push({
      id: newOpeningId(),
      kind: pr.kind,
      open: pr.open,
      polyIndex: best.polyIndex,
      t1: best.t1,
      t2: best.t2,
    });
    md[OPENINGS_KEY] = list;
    kept++;
  }
  return kept;
}

/** 2026-05-26 (Phase D) — turn an editor door into the OBR Path item
 *  that the official dynamic-fog plugin recognises. The Path:
 *   - layer "FOG" so dynamic-fog's WallActor picks it up
 *   - 2 commands (M, L) describing the door's straight line
 *   - non-zero strokeWidth so the auto-derived Wall has thickness
 *   - red (closed) / green (open) stroke as a fallback rendering for
 *     users without dynamic-fog installed; with dynamic-fog, its
 *     own DoorOverlayActor takes over the visual
 *   - dynamic-fog door metadata covering the line from `eps` to
 *     `length - eps` (i.e. ~100% of its length). When open,
 *     WallActor subtracts the entire range → the resulting Wall is
 *     ~empty (only the two sub-pixel stubs at the endpoints remain,
 *     which dynamic-fog's path simplification typically drops). When
 *     closed, the full segment renders as a wall.
 *   - our own FOG_PATH_KEY / FOG_MAP_KEY / kind="door" metadata so
 *     loadExistingFog can rehydrate the door[] array on re-open.
 *  Returns null for zero-length doors (failsafe). */
function buildDoorItem(
  d: EditorDoor,
  mapItem_: any,
  sceneDpi: number,
  bindToMap: boolean,
): any | null {
  const ml = imagePxToMapLocal([{ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }], mapItem_, sceneDpi);
  const p1 = ml[0], p2 = ml[1];
  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (length < 0.5) return null;
  // Tiny epsilon so distance markers aren't at exact 0 / length
  // (dynamic-fog hasn't been observed to care, but the safer choice
  // mirrors how createDoorMode never lets endpoints sit on a
  // contour seam).
  const eps = Math.min(0.5, length * 0.005);

  const commands = [
    [Command.MOVE, p1.x, p1.y],
    [Command.LINE, p2.x, p2.y],
  ];

  const mapId = mapItem_.id;
  const pos = mapItem_.position ?? { x: 0, y: 0 };
  const rot = mapItem_.rotation ?? 0;
  const scl = mapItem_.scale ?? { x: 1, y: 1 };
  const strokeW = Math.max(2, Math.round(sceneDpi / 30));

  let b = buildPath()
    .commands(commands as any)
    .fillRule("nonzero")
    .strokeColor(d.open ? "#5cd97c" : "#ff6b6b")
    .strokeOpacity(0.9)
    .strokeWidth(strokeW)
    .fillOpacity(0)
    .layer("FOG")
    .position(pos)
    .scale(scl)
    .rotation(rot)
    .visible(true)
    .locked(bindToMap)
    .disableHit(bindToMap)
    .metadata({
      [FOG_PATH_KEY]: true,
      [FOG_PATH_KIND_KEY]: FULLFOG_DOOR_KIND,
      [FOG_MAP_KEY]: {
        mapId,
        savedAt: Date.now(),
        kind: FULLFOG_DOOR_KIND,
        bindToMap,
        doorId: d.id,
      },
      // 2026-08-25 — was `rodeo.owlbear.dynamic-fog/doors` (absolute
      // arc length), written for the official extension. Now emits the
      // suite engine's own shape: one opening covering ~100% of the
      // segment, so an OPEN door leaves no wall and a CLOSED one leaves
      // the whole segment. Legacy items are still read via
      // dynfog/opening/read.ts's upstream compatibility path.
      [OPENINGS_KEY]: [
        {
          id: d.id,
          kind: "door",
          open: d.open,
          polyIndex: 0,
          t1: eps / length,
          t2: (length - eps) / length,
        } satisfies Opening,
      ],
    });
  if (bindToMap) {
    b = b.attachedTo(mapId).disableAttachmentBehavior(["VISIBLE", "COPY"]);
  }
  return b.build();
}

/** Mask overlay rendered as RGBA so the canvas can drawImage it
 *  directly — no per-pixel CPU loop on each redraw. Updated
 *  incrementally on stroke (only the dirty rect) or fully on
 *  algorithm-apply / undo / clear. */
let maskLayer: HTMLCanvasElement | OffscreenCanvas | null = null;
let maskCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/** B&W threshold preview of the source image (computed on demand
 *  when displayMode === "threshold"). Pixels < T → black, else white;
 *  the user paints corrections on top. */
let thresholdLayer: HTMLCanvasElement | OffscreenCanvas | null = null;
let thresholdDirty = true;

const history = new History();
const view: View = { panX: 0, panY: 0, zoom: 1 };
let tool: ToolId = "brush";

// In-progress gestures.
let panning = false;
let panStart = { sx: 0, sy: 0, panX: 0, panY: 0 };
let drawing = false;
let lastImgPt: { x: number; y: number } | null = null;
let lassoPath: { x: number; y: number }[] = [];
let polyPath: { x: number; y: number }[] = [];
let rectStart: { x: number; y: number } | null = null;
let spaceDown = false;

/** Bounding box of the current stroke's mask edits in image-pixel
 *  coords. Accumulates across pointermoves; flushed to maskLayer
 *  via blitMaskRect at every move (small enough to be cheap) and
 *  reset at pointerup. */
let strokeDirty: { x0: number; y0: number; x1: number; y1: number } | null = null;

// Persistent prefs (loaded from localStorage).
let prefs: EditorPrefs = loadPrefs();

// --- Prefs persistence -----------------------------------------------------

function loadPrefs(): EditorPrefs {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PREFS));
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      params: { ...DEFAULT_PREFS.params, ...(parsed.params ?? {}) },
      refinement: { ...DEFAULT_PREFS.refinement, ...(parsed.refinement ?? {}) },
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_PREFS));
  }
}

function savePrefs(): void {
  try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch {}
}

// --- Image / mask init -----------------------------------------------------

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  try {
    const res = await fetch(url, { mode: "cors", cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await createImageBitmap(await res.blob());
  } catch {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => createImageBitmap(img).then(resolve).catch(reject);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
  }
}

function makeOffscreen(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
}

async function loadMap(): Promise<void> {
  if (!mapItemId) {
    mapMetaEl.textContent = en ? "No map id supplied" : "未传入 map id";
    return;
  }
  try {
    const items = await OBR.scene.items.getItems([mapItemId]);
    if (items.length === 0) { mapMetaEl.textContent = en ? "map item not found" : "map item 不存在"; return; }
    const it = items[0] as any;
    if (!isImage(it as Item)) { mapMetaEl.textContent = en ? "target is not an image item" : "目标不是图片 item"; return; }
    mapItem = it;
    mapMetaEl.textContent = `${it.name ?? (en ? "(unnamed)" : "(未命名)")} · ${it.image.width}×${it.image.height}`;
    mapImage = await fetchBitmap(it.image.url);
    imgW = mapImage.width;
    imgH = mapImage.height;
    // Decode source image to RGBA buffer once.
    const oc = makeOffscreen(imgW, imgH);
    const octx = (oc as any).getContext("2d") as CanvasRenderingContext2D;
    octx.drawImage(mapImage as any, 0, 0);
    imgRGBA = octx.getImageData(0, 0, imgW, imgH).data;
    mask = new Uint8Array(imgW * imgH);
    // Mask layer: empty RGBA at image dimensions. drawImage'd on top
    // of the base layer in redraw().
    maskLayer = makeOffscreen(imgW, imgH);
    maskCtx = (maskLayer as any).getContext("2d") as CanvasRenderingContext2D;
    // Threshold layer is created on demand when user toggles display mode.
    thresholdLayer = null;
    thresholdDirty = true;

    // Re-import any previously-saved fog Path so the editor opens
    // showing the existing fog (instead of a blank mask). Reads the
    // outline-kind FOG_PATH_KEY items attached to this map and
    // rasterises their polygon commands back into `mask`.
    await loadExistingFog();

    resizeCanvas();
    fitToView(view, imgW, imgH, canvas.clientWidth, canvas.clientHeight);
    setStatus();
    rebuildMaskLayer();
    scheduleRedraw();
    stInfo.textContent = en ? "Loaded — start editing" : "已加载，开始编辑";
  } catch (e) {
    console.error("[fullFog] loadMap failed", e);
    mapMetaEl.textContent = (en ? "Load failed: " : "加载失败：") + (e as Error).message;
  }
}

/** Reverse of the save pipeline: find the legacy outline Path(s)
 *  that previous edit sessions left on the scene for THIS map, take
 *  their commands (which live in MAP-LOCAL coords), invert the
 *  imagePxToMapLocal transform back to image pixels, and rasterise
 *  the polygons onto the editor's mask buffer.
 *
 *  Why filter on "outline" kind: legacy scenes may still carry
 *  "darkFog-*" overlay Paths from the now-removed edge-feather
 *  feature. Rasterising those would either no-op (outer == outline)
 *  or shrink the mask incorrectly (inner). The outline Path is
 *  the only authoritative geometry.
 *
 *  Walls and maskRle metadata are deliberately NOT consulted — the
 *  Path commands are the single source of truth for the contour
 *  geometry from the wall watcher's perspective, so we use the same
 *  source here. */
async function loadExistingFog(): Promise<void> {
  if (!mask || !mapItem) return;
  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

  let existing: Item[] = [];
  try {
    existing = await OBR.scene.items.getItems((it: Item) => {
      if (!isPath(it)) return false;
      const md = (it.metadata as any) ?? {};
      if (!md[FOG_PATH_KEY]) return false;
      const kind = md[FOG_PATH_KIND_KEY];
      // 2026-05-26 (Phase D) — accept "outline" walls AND "door"
      // items. Doors get split off into the doors[] state below;
      // outlines feed the mask rasteriser as before.
      if (kind && kind !== "outline" && kind !== FULLFOG_DOOR_KIND) return false;
      if ((it as any).attachedTo !== mapItemId) return false;
      return true;
    });
  } catch (e) {
    console.warn("[fullFog/load] getItems failed", e);
    return;
  }
  if (existing.length === 0) return;

  // Inverse of imagePxToMapLocal: imagePx = mapLocal / ratio + offset.
  const ratio = sceneDpi / (mapItem.grid?.dpi || sceneDpi);
  const offX = mapItem.grid?.offset?.x ?? 0;
  const offY = mapItem.grid?.offset?.y ?? 0;

  // 2026-05-26 (Phase D) — split items by kind: doors are rehydrated
  // into the editor's doors[] state (NOT into the mask) so they
  // remain separately editable; outline walls feed the rasteriser.
  doors = [];
  const outlineItems: Item[] = [];
  for (const it of existing) {
    const kind = ((it as any).metadata as any)?.[FOG_PATH_KIND_KEY];
    if (kind === FULLFOG_DOOR_KIND) {
      const commands = (it as any).commands;
      if (!Array.isArray(commands) || commands.length < 2) continue;
      // Door commands are [MOVE, x1, y1] + [LINE, x2, y2]. Pull
      // endpoints (mapLocal) and invert to image-pixel coords.
      const cm = commands[0], cl = commands[1];
      if (!Array.isArray(cm) || !Array.isArray(cl)) continue;
      const x1ml = Number(cm[1]), y1ml = Number(cm[2]);
      const x2ml = Number(cl[1]), y2ml = Number(cl[2]);
      if (![x1ml, y1ml, x2ml, y2ml].every((v) => Number.isFinite(v))) continue;
      const md = ((it as any).metadata as any) ?? {};
      // Prefer the suite shape; fall back to the legacy upstream key so
      // doors saved before 2026-08-25 still round-trip.
      const ownMd = md[OPENINGS_KEY];
      const doorMd = Array.isArray(ownMd) && ownMd.length > 0
        ? ownMd
        : md[DYNAMIC_FOG_DOORS_KEY];
      const open = Array.isArray(doorMd) && doorMd[0] ? !!doorMd[0].open : false;
      const fmm = md[FOG_MAP_KEY] ?? {};
      const id = (typeof fmm.doorId === "string" && fmm.doorId) || newDoorId();
      doors.push({
        id,
        x1: x1ml / ratio + offX, y1: y1ml / ratio + offY,
        x2: x2ml / ratio + offX, y2: y2ml / ratio + offY,
        open,
      });
    } else {
      outlineItems.push(it);
    }
  }

  if (outlineItems.length === 0) return;

  // Rasterise polygons via Canvas2D fill (evenodd rule matches the
  // save side, so multi-subpath holes stay holes). Then read pixels
  // back into the mask Uint8Array.
  const oc = makeOffscreen(imgW, imgH);
  const ctx = (oc as any).getContext("2d") as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, imgW, imgH);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();

  let polyTotal = 0;
  for (const item of outlineItems) {
    const commands = (item as any).commands;
    if (!Array.isArray(commands) || commands.length === 0) continue;
    const polylines = samplePathCommands(commands, 8);
    for (const poly of polylines) {
      if (poly.length < 3) continue;
      const first = poly[0];
      ctx.moveTo(first.x / ratio + offX, first.y / ratio + offY);
      for (let i = 1; i < poly.length; i++) {
        const p = poly[i];
        ctx.lineTo(p.x / ratio + offX, p.y / ratio + offY);
      }
      ctx.closePath();
      polyTotal++;
    }
  }
  if (polyTotal === 0) return;

  // evenodd so nested subpaths (holes) carve out cleanly.
  (ctx as any).fill("evenodd");

  const data = ctx.getImageData(0, 0, imgW, imgH).data;
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) {
    if (data[i + 3] > 0) mask[j] = 255;
  }
  console.log(
    "[fullFog/load] re-imported existing fog",
    { items: existing.length, polygons: polyTotal },
  );
}

// --- Mask overlay rendering -----------------------------------------------

const TINT_R = 245;   // #f5a623
const TINT_G = 166;
const TINT_B = 35;
const TINT_A = 140;   // ~55% alpha out of 255

/** Rebuild the entire mask layer from `mask`. O(W·H). Use when the
 *  mask was replaced wholesale (algorithm apply, undo/redo, clear,
 *  refinement). For incremental edits use blitMaskRect. */
function rebuildMaskLayer(): void {
  if (!maskCtx || !mask) return;
  const id = (maskCtx as any).createImageData(imgW, imgH);
  const d = id.data;
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) {
    if (mask[j]) {
      d[i] = TINT_R; d[i + 1] = TINT_G; d[i + 2] = TINT_B; d[i + 3] = TINT_A;
    }
  }
  (maskCtx as any).putImageData(id, 0, 0);
  // Threshold layer derives from the same mask, so a full mask
  // rebuild forces a threshold rebuild on next redraw.
  thresholdDirty = true;
}

/** Update only a sub-rect of the mask layer from the current mask
 *  buffer. O(rect_area). Used during brush strokes — the dirty rect
 *  is at most ~brush_diameter² so this stays well under 1ms even at
 *  4K resolution.
 *
 *  Also updates the threshold layer (B&W "fog only" preview) in the
 *  same rect when it exists, so the threshold mode stays in sync
 *  without a full rebuild. */
function blitMaskRect(x0: number, y0: number, x1: number, y1: number): void {
  if (!maskCtx || !mask) return;
  // Clamp to image bounds.
  x0 = Math.max(0, Math.min(imgW, x0 | 0));
  y0 = Math.max(0, Math.min(imgH, y0 | 0));
  x1 = Math.max(0, Math.min(imgW, x1 | 0));
  y1 = Math.max(0, Math.min(imgH, y1 | 0));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  // Mask overlay (orange where mask=255, transparent elsewhere).
  const idMask = (maskCtx as any).createImageData(w, h);
  const dm = idMask.data;
  for (let yy = 0; yy < h; yy++) {
    const srcRow = (y0 + yy) * imgW + x0;
    const dstRow = yy * w * 4;
    for (let xx = 0; xx < w; xx++) {
      const i = dstRow + xx * 4;
      if (mask[srcRow + xx]) {
        dm[i] = TINT_R; dm[i + 1] = TINT_G; dm[i + 2] = TINT_B; dm[i + 3] = TINT_A;
      }
    }
  }
  (maskCtx as any).putImageData(idMask, x0, y0);

  // Threshold layer (black where mask=255, white where mask=0).
  if (thresholdLayer) {
    const tctx = (thresholdLayer as any).getContext("2d") as CanvasRenderingContext2D;
    const idThr = (tctx as any).createImageData(w, h);
    const dt = idThr.data;
    for (let yy = 0; yy < h; yy++) {
      const srcRow = (y0 + yy) * imgW + x0;
      const dstRow = yy * w * 4;
      for (let xx = 0; xx < w; xx++) {
        const i = dstRow + xx * 4;
        if (mask[srcRow + xx]) {
          dt[i] = 0; dt[i + 1] = 0; dt[i + 2] = 0; dt[i + 3] = 255;
        } else {
          dt[i] = 255; dt[i + 1] = 255; dt[i + 2] = 255; dt[i + 3] = 255;
        }
      }
    }
    (tctx as any).putImageData(idThr, x0, y0);
  }
}

function expandStrokeDirty(x0: number, y0: number, x1: number, y1: number): void {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  if (!strokeDirty) {
    strokeDirty = { x0, y0, x1, y1 };
  } else {
    if (x0 < strokeDirty.x0) strokeDirty.x0 = x0;
    if (y0 < strokeDirty.y0) strokeDirty.y0 = y0;
    if (x1 > strokeDirty.x1) strokeDirty.x1 = x1;
    if (y1 > strokeDirty.y1) strokeDirty.y1 = y1;
  }
}

function flushStrokeDirty(): void {
  if (!strokeDirty) return;
  blitMaskRect(strokeDirty.x0, strokeDirty.y0, strokeDirty.x1 + 1, strokeDirty.y1 + 1);
  strokeDirty = null;
}

// --- Threshold preview layer ----------------------------------------------

/** Rebuild the B&W "only fog" preview layer.
 *
 *  The preview shows ONLY what would be saved as walls/fog — no
 *  underlying map content. White background everywhere; pixels
 *  currently in `mask` render as black. This makes it easy to see
 *  exactly what geometry will be exported, free from the visual
 *  noise of the source map. The mask overlay (orange) is suppressed
 *  in this mode by setting the layer to fully opaque white-or-black,
 *  which obscures the orange tint underneath. */
function rebuildThresholdLayer(): void {
  if (!mask) return;
  if (!thresholdLayer) thresholdLayer = makeOffscreen(imgW, imgH);
  const tctx = (thresholdLayer as any).getContext("2d") as CanvasRenderingContext2D;
  const id = (tctx as any).createImageData(imgW, imgH);
  const d = id.data;
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) {
    if (mask[j]) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
    } else {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
  (tctx as any).putImageData(id, 0, 0);
  thresholdDirty = false;
}

// --- Canvas redraw ---------------------------------------------------------

const TOOL_LABELS: Record<ToolId, string> = en
  ? {
      pan: "Pan",
      brush: "Brush",
      eraser: "Eraser",
      lasso: "Lasso",
      polygon: "Polygon",
      rectangle: "Rect",
      line: "Line",
      magicWand: "Wand",
      paintBucket: "Fill",
      picker: "Pick",
      door: "Door",
    }
  : {
      pan: "拖动",
      brush: "画笔",
      eraser: "橡皮",
      lasso: "套索",
      polygon: "多边",
      rectangle: "矩形",
      line: "直线",
      magicWand: "魔棒",
      paintBucket: "油漆",
      picker: "取色",
      door: "门",
    };

function currentModeLabel(): string {
  if (!isShapeTool(tool)) return "";
  if (en) return prefs.toolModes[tool] === "add" ? "·fill" : "·erase";
  return prefs.toolModes[tool] === "add" ? "·填" : "·擦";
}

function setStatus(): void {
  stTool.textContent = (TOOL_LABELS[tool] ?? tool) + currentModeLabel();
  stZoom.textContent = `${view.zoom.toFixed(2)}×`;
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  scheduleRedraw();
}

let redrawScheduled = false;
function scheduleRedraw(): void {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => {
    redrawScheduled = false;
    redraw();
  });
}

function redraw(): void {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  ctx2d.clearRect(0, 0, cw, ch);
  if (!mapImage) return;

  // Build threshold preview lazily on first switch / on dirty.
  if (prefs.displayMode === "threshold" && (thresholdDirty || !thresholdLayer)) {
    rebuildThresholdLayer();
  }

  ctx2d.imageSmoothingEnabled = view.zoom < 1;
  ctx2d.save();
  ctx2d.translate(view.panX, view.panY);
  ctx2d.scale(view.zoom, view.zoom);

  // Base layer: source bitmap (color mode) OR pure-fog B&W preview
  // (threshold mode). In threshold mode the mask is ALREADY baked
  // into the layer as black pixels, so we skip the orange overlay
  // — drawing it would just tint the black/white into orange.
  if (prefs.displayMode === "threshold" && thresholdLayer) {
    ctx2d.drawImage(thresholdLayer as any, 0, 0);
  } else {
    ctx2d.drawImage(mapImage as any, 0, 0);
    // 2026-05-26 (Phase C) — B&W reference overlay. Drawn between
    // the original bitmap and the orange mask so the GM can compare
    // line work side-by-side: tweak opacity slider to fade between
    // "see the map underneath" and "trust the B&W alignment". The
    // overlay is purely visual feedback — it doesn't reflect what
    // the algorithm processes (that's bwRGBA, resampled to image
    // dimensions; the canvas-side bwImage may have its native size).
    if (bwImage && bwShow) {
      ctx2d.save();
      ctx2d.globalAlpha = bwOpacity;
      ctx2d.drawImage(bwImage, 0, 0, imgW, imgH);
      ctx2d.restore();
    }
    if (maskLayer) ctx2d.drawImage(maskLayer as any, 0, 0);
  }

  // Output preview overlay (toggled via the "预览输出" button).
  renderPreviewOverlay();

  // Tool overlays.
  if (tool === "lasso" && lassoPath.length > 1) {
    ctx2d.strokeStyle = "#f5a623";
    ctx2d.lineWidth = 2 / view.zoom;
    ctx2d.beginPath();
    ctx2d.moveTo(lassoPath[0].x, lassoPath[0].y);
    for (let i = 1; i < lassoPath.length; i++) ctx2d.lineTo(lassoPath[i].x, lassoPath[i].y);
    ctx2d.stroke();
  }
  if (tool === "polygon" && polyPath.length > 0) {
    ctx2d.strokeStyle = "#f5a623";
    ctx2d.lineWidth = 2 / view.zoom;
    ctx2d.beginPath();
    ctx2d.moveTo(polyPath[0].x, polyPath[0].y);
    for (let i = 1; i < polyPath.length; i++) ctx2d.lineTo(polyPath[i].x, polyPath[i].y);
    ctx2d.stroke();
    for (const p of polyPath) {
      ctx2d.fillStyle = "#f5a623";
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, 3 / view.zoom, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  if (tool === "rectangle" && rectStart && lastImgPt) {
    ctx2d.strokeStyle = "#f5a623";
    ctx2d.lineWidth = 2 / view.zoom;
    ctx2d.setLineDash([5 / view.zoom, 5 / view.zoom]);
    ctx2d.strokeRect(
      rectStart.x, rectStart.y,
      lastImgPt.x - rectStart.x, lastImgPt.y - rectStart.y,
    );
    ctx2d.setLineDash([]);
  }
  if (tool === "line" && rectStart && lastImgPt) {
    // Preview the about-to-stamp segment as a thick translucent
    // band of the brush radius — matches what the mask will get.
    ctx2d.strokeStyle = "rgba(245,166,35,0.35)";
    ctx2d.lineWidth = prefs.brushRadius * 2;
    ctx2d.lineCap = "round";
    ctx2d.beginPath();
    ctx2d.moveTo(rectStart.x, rectStart.y);
    ctx2d.lineTo(lastImgPt.x, lastImgPt.y);
    ctx2d.stroke();
    // Center line for precision.
    ctx2d.strokeStyle = "#f5a623";
    ctx2d.lineWidth = 1.2 / view.zoom;
    ctx2d.beginPath();
    ctx2d.moveTo(rectStart.x, rectStart.y);
    ctx2d.lineTo(lastImgPt.x, lastImgPt.y);
    ctx2d.stroke();
  }

  // 2026-05-26 (Phase D) — door rendering. Doors live on top of
  // everything else so they're always visible regardless of mask
  // / threshold overlay. Color = red (closed) / green (open). Line
  // width scales with zoom so doors stay visually consistent at
  // any magnification. Selected door gets endpoint handles for
  // grabbing. In door tool, all doors get a faint outer halo to
  // signal "click-to-select" affordance.
  if (doors.length > 0 || (tool === "door" && doorPlacement)) {
    const doorMode = tool === "door";
    const lineW = Math.max(1.5, 3 / view.zoom);
    for (const d of doors) {
      const isSelected = d.id === selectedDoorId;
      // Outer halo in door tool for selectability cue.
      if (doorMode && !isSelected) {
        ctx2d.strokeStyle = "rgba(255,255,255,0.20)";
        ctx2d.lineWidth = (lineW + 6) / 1;
        ctx2d.lineCap = "round";
        ctx2d.beginPath();
        ctx2d.moveTo(d.x1, d.y1); ctx2d.lineTo(d.x2, d.y2);
        ctx2d.stroke();
      }
      ctx2d.strokeStyle = d.open ? "#5cd97c" : "#ff6b6b";
      ctx2d.lineWidth = lineW;
      ctx2d.lineCap = "round";
      ctx2d.beginPath();
      ctx2d.moveTo(d.x1, d.y1); ctx2d.lineTo(d.x2, d.y2);
      ctx2d.stroke();
      // Endpoint handles only when door tool is active AND this
      // door is selected (avoid clutter for unselected doors).
      if (doorMode && isSelected) {
        const r = Math.max(3, 6 / view.zoom);
        ctx2d.fillStyle = "#ffffff";
        ctx2d.strokeStyle = d.open ? "#5cd97c" : "#ff6b6b";
        ctx2d.lineWidth = Math.max(1, 1.5 / view.zoom);
        for (const [hx, hy] of [[d.x1, d.y1], [d.x2, d.y2]] as const) {
          ctx2d.beginPath();
          ctx2d.arc(hx, hy, r, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.stroke();
        }
      }
    }
    // Placement preview: dashed line from the first click to current cursor.
    if (doorMode && doorPlacement && lastImgPt) {
      ctx2d.strokeStyle = "rgba(255,107,107,0.85)";
      ctx2d.lineWidth = lineW;
      ctx2d.setLineDash([8 / view.zoom, 6 / view.zoom]);
      ctx2d.beginPath();
      ctx2d.moveTo(doorPlacement.x, doorPlacement.y);
      ctx2d.lineTo(lastImgPt.x, lastImgPt.y);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      // Tiny marker at the first endpoint.
      ctx2d.fillStyle = "#ff6b6b";
      ctx2d.beginPath();
      ctx2d.arc(doorPlacement.x, doorPlacement.y, Math.max(2, 4 / view.zoom), 0, Math.PI * 2);
      ctx2d.fill();
    }
  }

  ctx2d.restore();
}

// --- Door tool: hit testing + helpers (Phase D) --------------------------

function distPointToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Pick the door hit at the image-pixel point (ix, iy). Returns
 *  `{door, kind}` where kind is "endpoint1" / "endpoint2" / "whole"
 *  describing what the user actually clicked on. Only the currently
 *  SELECTED door is endpoint-grabbable (handles are only drawn for
 *  it). For other doors, a whole-line click selects them first. */
function hitTestDoor(
  ix: number, iy: number,
): { door: EditorDoor; kind: DoorDragKind } | null {
  const handleR = Math.max(DOOR_HANDLE_HIT_PX / view.zoom, 4);
  const lineR = Math.max(DOOR_LINE_HIT_PX / view.zoom, 3);
  // Prefer selected door endpoint hits (smaller, more precise grab).
  if (selectedDoorId) {
    const sel = doors.find((d) => d.id === selectedDoorId);
    if (sel) {
      const d1 = Math.hypot(ix - sel.x1, iy - sel.y1);
      const d2 = Math.hypot(ix - sel.x2, iy - sel.y2);
      if (d1 <= handleR && d1 <= d2) return { door: sel, kind: "endpoint1" };
      if (d2 <= handleR) return { door: sel, kind: "endpoint2" };
    }
  }
  // Then any door's line (iterate in reverse so most-recently-added
  // wins on overlap).
  for (let i = doors.length - 1; i >= 0; i--) {
    const d = doors[i];
    if (distPointToSegment(ix, iy, d.x1, d.y1, d.x2, d.y2) <= lineR) {
      return { door: d, kind: "whole" };
    }
  }
  return null;
}

/** Build + show a right-click context menu for a door. Positioned at
 *  the click's screen coords; auto-closes on outside click / Esc. */
function openDoorContextMenu(door: EditorDoor, screenX: number, screenY: number): void {
  const existing = document.getElementById("ffDoorCtxMenu");
  if (existing) existing.remove();
  const menu = document.createElement("div");
  menu.id = "ffDoorCtxMenu";
  menu.style.cssText =
    "position:fixed;z-index:10000;background:#161922;border:1px solid rgba(255,255,255,0.18);" +
    "border-radius:6px;padding:4px;min-width:160px;color:#e6e8ee;font-size:13px;" +
    "font-family:inherit;box-shadow:0 6px 18px rgba(0,0,0,0.45)";
  // Clamp inside viewport.
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = `${Math.min(screenX, vw - 180)}px`;
  menu.style.top = `${Math.min(screenY, vh - 100)}px`;
  function makeItem(label: string, onClick: () => void): HTMLDivElement {
    const el = document.createElement("div");
    el.textContent = label;
    el.style.cssText =
      "padding:7px 12px;border-radius:4px;cursor:pointer;transition:background .08s";
    el.addEventListener("mouseenter", () => { el.style.background = "rgba(255,255,255,0.06)"; });
    el.addEventListener("mouseleave", () => { el.style.background = ""; });
    el.addEventListener("click", () => { onClick(); close(); });
    return el;
  }
  const toggleLabel = door.open
    ? (en ? "🔴 Close door" : "🔴 关上门")
    : (en ? "🟢 Open door" : "🟢 打开门");
  menu.appendChild(makeItem(toggleLabel, () => {
    door.open = !door.open;
    scheduleRedraw();
  }));
  menu.appendChild(makeItem(en ? "🗑 Delete door" : "🗑 删除门", () => {
    doors = doors.filter((d) => d.id !== door.id);
    if (selectedDoorId === door.id) selectedDoorId = null;
    scheduleRedraw();
  }));
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", onEsc, true);
  };
  const outside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  setTimeout(() => {
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", onEsc, true);
  }, 0);
  document.body.appendChild(menu);
}

// --- Brush cursor (custom outline circle) ---------------------------------

const brushCursorEl = $("brush-cursor");

function updateBrushCursorAt(sx: number, sy: number): void {
  if (!brushCursorEl) return;
  const usesBrush = tool === "brush" || tool === "eraser";
  if (!usesBrush || panning) {
    brushCursorEl.style.display = "none";
    return;
  }
  // Brush radius in image pixels → screen pixels at current zoom.
  const r = Math.max(2, prefs.brushRadius * view.zoom);
  brushCursorEl.style.display = "block";
  brushCursorEl.style.left = `${sx}px`;
  brushCursorEl.style.top = `${sy}px`;
  brushCursorEl.style.width = `${r * 2}px`;
  brushCursorEl.style.height = `${r * 2}px`;
  // Dim slightly while erasing so it's distinguishable from brush.
  brushCursorEl.dataset.mode = tool;
}

function hideBrushCursor(): void {
  if (brushCursorEl) brushCursorEl.style.display = "none";
}

// --- Output preview --------------------------------------------------------
//
// Renders the SAVE pipeline result (smoothed Path / sampled Wall
// polylines) directly onto the canvas in image space. Lets the user
// see what walls/curves will actually be exported BEFORE clicking
// save — and what the smoothing/simp/chaikin sliders do to them.
//
// Compute is non-trivial (contour trace + simplify + chaikin per
// segment), so we cache. Toggle-on triggers an immediate recompute;
// while on, slider changes auto-refresh after a 250ms debounce.

let previewOn = false;
let previewPath2D: Path2D | null = null;
let previewWallPolylines: Vec2[][] | null = null;
let previewSegmentCount = 0;
let previewRecomputeTimer: number | null = null;

function commandsToPath2D(commands: any[]): Path2D {
  const p = new Path2D();
  for (const c of commands) {
    switch (c[0]) {
      case Command.MOVE: p.moveTo(c[1], c[2]); break;
      case Command.LINE: p.lineTo(c[1], c[2]); break;
      case Command.QUAD: p.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
      case Command.CUBIC: p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break;
      case Command.CLOSE: p.closePath(); break;
    }
  }
  return p;
}

function recomputePreview(): void {
  if (!mask) return;
  // Mirror save()'s pre-output mask smoothing so the preview shows
  // what'll actually be saved, including jaggy cleanup. Cheap on
  // typical map sizes; expensive only if user cranked outputSmoothK
  // way up — that's a deliberate cost.
  let smoothMask = mask;
  if (prefs.outputSmoothK > 0) {
    const k = prefs.outputSmoothK;
    let m = morphClose(mask, imgW, imgH, k);
    m = morphOpen(m, imgW, imgH, Math.max(2, k - 1));
    smoothMask = m;
  }
  const contours = traceContours(smoothMask, imgW, imgH);
  const tol = Number(($<HTMLInputElement>("simp")).value) || 0;
  let processed = contours.map((c) => simplifyDP(c, tol));
  if (prefs.chaikinIters > 0) {
    processed = processed.map((c) => chaikinSmooth(c, prefs.chaikinIters, true));
  }
  processed = processed.filter((c) => c.length >= 4);
  previewSegmentCount = processed.length;
  const totalPts = processed.reduce((s, c) => s + c.length, 0);
  refreshOutputStats(processed.length, totalPts);

  const tension = prefs.smoothingTension;

  // Path preview: bezier commands.
  const path = new Path2D();
  for (const poly of processed) {
    if (poly.length < 3) continue;
    if (tension > 0) {
      const cmds = smoothToPathCommands(poly, tension, true);
      const sub = commandsToPath2D(cmds);
      path.addPath(sub);
    } else {
      const sub = new Path2D();
      sub.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) sub.lineTo(poly[i].x, poly[i].y);
      sub.closePath();
      path.addPath(sub);
    }
  }
  previewPath2D = path;

  // Wall preview: apply the user's wall-expand offset to a copy of
  // the contours BEFORE sampling. The Path preview above stays at
  // the original boundary so the GM can see exactly where the
  // visible edge lands; the magenta dashed wall preview shows the
  // actual blocking-wall geometry that the watcher will derive at
  // save time. safeWallOffset handles sign-flipping for the
  // outermost polygon and per-vertex clamping so thin features can't
  // collapse.
  const wallExpand = Number(prefs.wallExpandPx ?? 0);
  let wallContours = processed;
  if (wallExpand !== 0) {
    const expanded = safeWallOffset(processed, wallExpand, 1);
    if (expanded.length > 0) wallContours = expanded;
  }
  previewWallPolylines = wallContours.map((c) =>
    tension > 0 ? smoothToPolyline(c, tension, true, 8) : [...c, c[0]],
  );

  // (counts already pushed via refreshOutputStats above)
}

/** Pushes the latest segment / point count into the right-pane
 *  status line. Soft-budget warning kicks in above ~6000 points
 *  (we have an absolute budget of 8000 in save()'s adaptive loop;
 *  6000 leaves headroom). */
function refreshOutputStats(segs: number, pts: number): void {
  const ccCount = $("cc-count");
  if (ccCount) ccCount.textContent = String(segs);
  const ptsEl = $("cc-points");
  if (ptsEl) {
    ptsEl.textContent = String(pts);
    if (pts > 6000) ptsEl.dataset.over = "1";
    else delete ptsEl.dataset.over;
  }
}

function schedulePreviewRefresh(): void {
  if (!previewOn) return;
  if (previewRecomputeTimer != null) clearTimeout(previewRecomputeTimer);
  previewRecomputeTimer = window.setTimeout(() => {
    previewRecomputeTimer = null;
    recomputePreview();
    scheduleRedraw();
  }, 250);
}

function togglePreview(): void {
  previewOn = !previewOn;
  const btn = $<HTMLButtonElement>("btn-preview");
  if (btn) btn.classList.toggle("on", previewOn);
  if (previewOn) {
    recomputePreview();
  }
  scheduleRedraw();
}

function renderPreviewOverlay(): void {
  if (!previewOn) return;
  const wantPath = prefs.outputMode === "path" || prefs.outputMode === "both";
  const wantWall = prefs.outputMode === "wall" || prefs.outputMode === "both";

  // Walls drawn first (under) so the Path stroke sits clearly on top.
  if (wantWall && previewWallPolylines && previewWallPolylines.length > 0) {
    ctx2d.lineWidth = Math.max(1, 1.6 / view.zoom);
    ctx2d.strokeStyle = "rgba(245, 100, 245, 0.92)"; // magenta = walls
    ctx2d.setLineDash([6 / view.zoom, 4 / view.zoom]);
    for (const poly of previewWallPolylines) {
      if (poly.length < 2) continue;
      ctx2d.beginPath();
      ctx2d.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx2d.lineTo(poly[i].x, poly[i].y);
      ctx2d.stroke();
    }
    ctx2d.setLineDash([]);
  }
  if (wantPath && previewPath2D) {
    ctx2d.lineWidth = Math.max(1.5, 2.5 / view.zoom);
    ctx2d.strokeStyle = "rgba(78, 201, 176, 0.95)"; // cyan = path
    ctx2d.stroke(previewPath2D);
  }
}

// --- Algorithm dispatcher --------------------------------------------------

function preFilter(rgba: Uint8ClampedArray): Uint8ClampedArray {
  if (prefs.preFilter === "none" || prefs.preFilter === "bilateral") return rgba;
  const gray = toGray(rgba, imgW, imgH);
  const blurred = prefs.preFilter === "gauss5"
    ? gaussBlur5(gray, imgW, imgH)
    : gaussBlur3(gray, imgW, imgH);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[i] = blurred[j];
    out[i + 1] = blurred[j];
    out[i + 2] = blurred[j];
    out[i + 3] = 255;
  }
  return out;
}

/** Returns the RGBA buffer the algorithms should run against. When
 *  the user has imported a B&W reference image, that takes priority
 *  — the whole point is that the B&W gives the algorithms cleaner
 *  input than the noisy original. Otherwise falls back to the
 *  source map bitmap. (Phase C — 2026-05-26.) */
function algoSourceRGBA(): Uint8ClampedArray | null {
  return bwRGBA ?? imgRGBA;
}

/** Resize an HTMLImageElement / ImageBitmap onto an offscreen
 *  canvas at exactly imgW × imgH and read back its RGBA bytes. Used
 *  by the B&W reference import path so the resulting bwRGBA lines
 *  up pixel-for-pixel with imgRGBA. A simple stretch resample is
 *  fine here — the typical B&W input is already at the original's
 *  dimensions, and even when not the algorithms are looking for
 *  thresholdable contrast, not sub-pixel accuracy. */
function resampleToImagePixels(src: CanvasImageSource): Uint8ClampedArray {
  const oc = makeOffscreen(imgW, imgH);
  const oct = (oc as any).getContext("2d") as CanvasRenderingContext2D;
  oct.imageSmoothingEnabled = true;
  // White background so any transparent areas in the B&W (alpha=0)
  // read as background (white) rather than as black, which would
  // get picked up as "wall" by Otsu / threshold algos.
  oct.fillStyle = "#ffffff";
  oct.fillRect(0, 0, imgW, imgH);
  oct.drawImage(src, 0, 0, imgW, imgH);
  return oct.getImageData(0, 0, imgW, imgH).data;
}

async function importBwImage(file: File): Promise<void> {
  if (!imgW || !imgH) {
    stInfo.textContent = en ? "Load a map first" : "请先打开地图";
    return;
  }
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error ?? new Error("file read failed"));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("image decode failed"));
      im.src = dataUrl;
    });
    bwImage = img;
    bwRGBA = resampleToImagePixels(img);
    thresholdDirty = true;
    syncBwUi();
    scheduleRedraw();
    stInfo.textContent = en
      ? `B&W reference loaded (${img.naturalWidth}×${img.naturalHeight}, resampled to ${imgW}×${imgH})`
      : `已加载黑白参考图（${img.naturalWidth}×${img.naturalHeight}，重采样到 ${imgW}×${imgH}）`;
  } catch (e: any) {
    stInfo.textContent = (en ? "B&W import failed: " : "黑白图导入失败：") + (e?.message ?? e);
  }
}

function clearBwImage(): void {
  bwImage = null;
  bwRGBA = null;
  thresholdDirty = true;
  syncBwUi();
  scheduleRedraw();
  stInfo.textContent = en ? "B&W reference cleared" : "已清除黑白参考图";
}

/** Update the B&W controls' visible state — disables Show / opacity
 *  / Clear when nothing is loaded, swaps button label to indicate
 *  current state. Called whenever bwImage flips loaded↔unloaded. */
function syncBwUi(): void {
  const hasBw = !!bwImage;
  const importBtn = document.getElementById("btn-bw-import") as HTMLButtonElement | null;
  const clearBtn = document.getElementById("btn-bw-clear") as HTMLButtonElement | null;
  const showCb = document.getElementById("bw-show") as HTMLInputElement | null;
  const opSld = document.getElementById("bw-opacity") as HTMLInputElement | null;
  const opVal = document.getElementById("bw-opacity-val");
  if (clearBtn) clearBtn.disabled = !hasBw;
  if (showCb) { showCb.disabled = !hasBw; showCb.checked = bwShow; }
  if (opSld) { opSld.disabled = !hasBw; opSld.value = String(Math.round(bwOpacity * 100)); }
  if (opVal) opVal.textContent = `${Math.round(bwOpacity * 100)}%`;
  if (importBtn) {
    importBtn.textContent = hasBw
      ? (en ? "📂 Replace B&W" : "📂 替换黑白图")
      : (en ? "📂 Import B&W" : "📂 导入黑白图");
  }
}

function runAlgorithm(algo: AlgorithmId): Uint8Array {
  const src = algoSourceRGBA();
  if (!src) throw new Error("no image");
  const rgba = preFilter(src);
  const gray = toGray(rgba, imgW, imgH);
  const p = prefs.params;
  switch (algo) {
    case "threshold":     return thresholdMask(gray, p.threshold.T);
    case "otsu":          return otsuMask(gray, p.otsu.offset);
    case "adaptive":      return adaptiveMask(gray, imgW, imgH, p.adaptive.block, p.adaptive.C);
    case "colorDistance": return colorDistanceMask(rgba, imgW, imgH, p.colorDistance.r, p.colorDistance.g, p.colorDistance.b, p.colorDistance.tol);
    case "colorExclude":  return colorExcludeMask(rgba, imgW, imgH, p.colorExclude.T);
    case "satAware":      return satAwareMask(rgba, imgW, imgH, p.satAware.T, p.satAware.maxSat);
  }
}

function applyAlgorithm(): void {
  if (!mask || !algoSourceRGBA()) return;
  pushUndo();
  let next = runAlgorithm(prefs.algorithm);
  // Thin-line filter runs IMMEDIATELY after the algorithm so user-
  // tunable open/close sliders apply on top of cleaner input.
  if (prefs.refinement.thinLineK > 0) {
    next = morphOpen(next, imgW, imgH, prefs.refinement.thinLineK);
  }
  const merge = $<HTMLInputElement>("merge-mode").checked;
  if (merge) {
    for (let i = 0; i < mask.length; i++) {
      if (next[i]) mask[i] = 255;
    }
  } else {
    mask.set(next);
  }
  rebuildMaskLayer();
  thresholdDirty = true; // params may have changed via this run
  updateMaskCount();
  schedulePreviewRefresh();
  scheduleRedraw();
  stInfo.textContent = en
    ? `Algorithm ${prefs.algorithm} applied (${merge ? "merge" : "overwrite"})`
    : `算法 ${prefs.algorithm} 已应用 (${merge ? "合并" : "覆盖"})`;
}

function applyRefinement(): void {
  if (!mask) return;
  pushUndo();
  let m = mask;
  const r = prefs.refinement;
  if (r.thinLineK > 0) m = morphOpen(m, imgW, imgH, r.thinLineK);
  if (r.openK > 0) m = morphOpen(m, imgW, imgH, r.openK);
  if (r.closeK > 0) m = morphClose(m, imgW, imgH, r.closeK);
  if (r.minArea > 0) m = areaFilter(m, imgW, imgH, r.minArea);
  if (r.holeFillMaxArea > 0) m = selectiveHoleFill(m, imgW, imgH, r.holeFillMaxArea);
  mask.set(m);
  rebuildMaskLayer();
  updateMaskCount();
  schedulePreviewRefresh();
  scheduleRedraw();
  stInfo.textContent = en ? "Cleanup done" : "清理完成";
}

// --- Mask stats ------------------------------------------------------------

function updateMaskCount(): void {
  if (!mask) return;
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  stMask.textContent = `${n.toLocaleString()}px`;
  // Don't update cc-count here when preview is on — the preview
  // pipeline (which mirrors save) is the authoritative source of
  // segment + point count. Only compute via CC when preview is off.
  if (previewOn) return;
  if (n > 0 && mask.length < 6_000_000) {
    const cc = connectedComponents(mask, imgW, imgH);
    let kept = 0;
    for (let i = 1; i <= cc.count; i++) {
      if (cc.stats[i].area >= Math.max(20, prefs.refinement.minArea)) kept++;
    }
    refreshOutputStats(kept, 0);
  } else {
    refreshOutputStats(0, 0);
  }
}

// --- History ---------------------------------------------------------------

function pushUndo(): void {
  if (!mask) return;
  history.push(mask);
}

function undo(): void {
  if (!mask) return;
  const prev = history.undo(mask);
  if (!prev) return;
  mask.set(prev);
  rebuildMaskLayer();
  updateMaskCount();
  schedulePreviewRefresh();
  scheduleRedraw();
}

function redo(): void {
  if (!mask) return;
  const next = history.redo(mask);
  if (!next) return;
  mask.set(next);
  rebuildMaskLayer();
  updateMaskCount();
  schedulePreviewRefresh();
  scheduleRedraw();
}

function clearMask(): void {
  if (!mask) return;
  pushUndo();
  mask.fill(0);
  rebuildMaskLayer();
  updateMaskCount();
  schedulePreviewRefresh();
  scheduleRedraw();
  stInfo.textContent = en ? "Mask cleared" : "已清空 mask";
}

// --- Pointer handling ------------------------------------------------------

function getMousePoint(e: PointerEvent): { sx: number; sy: number; ix: number; iy: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const ip = viewToImage(view, sx, sy);
  return { sx, sy, ix: ip.x, iy: ip.y };
}

/** Whether the current shape tool's mode is "add" (paint=true) or
 *  "erase" (paint=false). Right-click on the tool BUTTON toggles
 *  this persistently — much less error-prone than a per-stroke
 *  modifier. Brush/eraser are separate tools and don't read this. */
function isShapeTool(t: ToolId): t is ShapeToolId {
  return t === "lasso" || t === "polygon" || t === "rectangle" || t === "line";
}

function shapeFillPaint(): boolean {
  if (!isShapeTool(tool)) return true;
  return prefs.toolModes[tool] === "add";
}

/** Snap (ix, iy) — image-pixel coords — to the nearest grid
 *  intersection of the source map. The IMAGE has its own
 *  grid offset/dpi (image.grid.{offset, dpi}) — that's what we
 *  snap against, NOT the scene grid (which is in world units).
 *  Held-Ctrl temporarily flips the snap state. */
let ctrlDown = false;
function snapPoint(ix: number, iy: number): { x: number; y: number } {
  const want = prefs.gridSnap !== ctrlDown; // XOR with temporary flip
  if (!want || !mapItem) return { x: ix, y: iy };
  const dpi = mapItem.image?.grid?.dpi;
  if (!dpi || dpi <= 0) return { x: ix, y: iy };
  const offX = mapItem.image?.grid?.offset?.x ?? 0;
  const offY = mapItem.image?.grid?.offset?.y ?? 0;
  return {
    x: Math.round((ix - offX) / dpi) * dpi + offX,
    y: Math.round((iy - offY) / dpi) * dpi + offY,
  };
}

// 2026-05-26 (Phase D) — right-click in door tool opens a per-door
// context menu (toggle open/close, delete) instead of just being
// suppressed. Outside door tool keeps the previous "just suppress"
// behaviour so other tools' right-click semantics (e.g. erase) work.
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (tool !== "door" || !mapImage) return;
  const m = getMousePoint(e);
  const hit = hitTestDoor(m.ix, m.iy);
  if (hit) {
    selectedDoorId = hit.door.id;
    scheduleRedraw();
    openDoorContextMenu(hit.door, e.clientX, e.clientY);
  }
});

canvas.addEventListener("pointerdown", (e) => {
  if (!mask || !mapImage) return;
  const m = getMousePoint(e);
  const sx = m.sx, sy = m.sy;
  // Snap shape-tool clicks to grid; brush/eraser/lasso stay unsnapped
  // because freeform drawing on a snap grid would be jerky and
  // useless. Polygon/rectangle/line corners snap.
  const snap = (tool === "polygon" || tool === "rectangle" || tool === "line")
    ? snapPoint(m.ix, m.iy)
    : { x: m.ix, y: m.iy };
  const ix = snap.x, iy = snap.y;
  // Pan: middle-click OR space+left-click OR pan tool active.
  if (e.button === 1 || (e.button === 0 && (spaceDown || tool === "pan"))) {
    panning = true;
    panStart = { sx, sy, panX: view.panX, panY: view.panY };
    canvas.classList.add("pan-active");
    hideBrushCursor();
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  // 2026-05-26 (Phase D) — door tool: NOT a mask-drawing operation.
  // Click-1 sets first endpoint; click-2 commits a new door at
  // (firstEndpoint → cursor). Clicking on an existing door's line
  // selects + starts a whole-line drag; clicking on the selected
  // door's endpoint handle drags just that endpoint. We bypass the
  // generic `drawing=true / setPointerCapture` flow because doors
  // don't write to the mask and the modal drag UX is different.
  if (tool === "door") {
    const hit = hitTestDoor(m.ix, m.iy);
    if (hit) {
      selectedDoorId = hit.door.id;
      doorDrag = {
        kind: hit.kind,
        doorId: hit.door.id,
        startImg: { x: m.ix, y: m.iy },
        orig: { ...hit.door },
      };
      canvas.setPointerCapture(e.pointerId);
      scheduleRedraw();
      return;
    }
    // Empty-space click: placement flow.
    if (!doorPlacement) {
      // First click — remember start point, deselect any prior door.
      doorPlacement = { x: m.ix, y: m.iy };
      selectedDoorId = null;
      scheduleRedraw();
    } else {
      // Second click — commit the door. Reject zero-length placements
      // (silent return, leaves placement state so the next click can
      // try again from the same start).
      const dx = m.ix - doorPlacement.x, dy = m.iy - doorPlacement.y;
      if (dx * dx + dy * dy >= 4) {
        const d: EditorDoor = {
          id: newDoorId(),
          x1: doorPlacement.x, y1: doorPlacement.y,
          x2: m.ix, y2: m.iy,
          open: false,
        };
        doors.push(d);
        selectedDoorId = d.id;
        doorPlacement = null;
        scheduleRedraw();
        stInfo.textContent = en
          ? `Door placed (${doors.length} total — red=closed; right-click to toggle/delete)`
          : `已放置门（共 ${doors.length} 扇 — 红色=关；右键切换开关/删除）`;
      }
    }
    return;
  }

  drawing = true;
  canvas.setPointerCapture(e.pointerId);

  switch (tool) {
    case "picker":
      pickColorAt(ix, iy);
      drawing = false;
      break;
    case "brush":
    case "eraser": {
      pushUndo();
      lastImgPt = null;
      const paint = tool === "brush";
      stampCircle(mask, imgW, imgH, ix, iy, prefs.brushRadius, paint);
      const r = prefs.brushRadius + 1;
      expandStrokeDirty(ix - r, iy - r, ix + r, iy + r);
      flushStrokeDirty();
      lastImgPt = { x: ix, y: iy };
      scheduleRedraw();
      break;
    }
    case "lasso":
      pushUndo();
      lassoPath = [{ x: ix, y: iy }];
      break;
    case "polygon":
      if (polyPath.length === 0) pushUndo();
      polyPath.push({ x: ix, y: iy });
      scheduleRedraw();
      drawing = false;
      break;
    case "rectangle":
      pushUndo();
      rectStart = { x: ix, y: iy };
      lastImgPt = { x: ix, y: iy };
      break;
    case "line":
      pushUndo();
      // Reuse rectStart/lastImgPt as the segment endpoints — this
      // tool draws a single straight stroke from rectStart to
      // pointer-up, which is a strict subset of the rectangle
      // gesture's lifecycle. Saves duplicate state.
      rectStart = { x: ix, y: iy };
      lastImgPt = { x: ix, y: iy };
      break;
    case "magicWand": {
      pushUndo();
      if (!imgRGBA) break;
      const n = magicWand(imgRGBA, mask, imgW, imgH, ix, iy, prefs.wandTolerance, true);
      stInfo.textContent = en ? `Wand selected ${n}px` : `魔棒选中 ${n}px`;
      rebuildMaskLayer();
      updateMaskCount();
      scheduleRedraw();
      drawing = false;
      break;
    }
    case "paintBucket": {
      pushUndo();
      const n = paintBucket(mask, imgW, imgH, ix, iy);
      stInfo.textContent = en ? `Bucket filled ${n}px` : `油漆桶填充 ${n}px`;
      rebuildMaskLayer();
      updateMaskCount();
      scheduleRedraw();
      drawing = false;
      break;
    }
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!mask) return;
  const m = getMousePoint(e);
  const sx = m.sx, sy = m.sy;
  const snap = (tool === "polygon" || tool === "rectangle" || tool === "line")
    ? snapPoint(m.ix, m.iy)
    : { x: m.ix, y: m.iy };
  const ix = snap.x, iy = snap.y;
  stPos.textContent = `${Math.round(ix)}, ${Math.round(iy)}`;
  updateBrushCursorAt(sx, sy);

  // 2026-05-26 (Phase D) — door drag: move endpoint or whole line.
  // Also keep lastImgPt fresh so the placement preview (dashed
  // line from first endpoint to cursor) tracks the mouse.
  if (tool === "door") {
    lastImgPt = { x: m.ix, y: m.iy };
    if (doorDrag) {
      const door = doors.find((d) => d.id === doorDrag!.doorId);
      if (door) {
        const dx = m.ix - doorDrag.startImg.x;
        const dy = m.iy - doorDrag.startImg.y;
        if (doorDrag.kind === "endpoint1") {
          door.x1 = doorDrag.orig.x1 + dx;
          door.y1 = doorDrag.orig.y1 + dy;
        } else if (doorDrag.kind === "endpoint2") {
          door.x2 = doorDrag.orig.x2 + dx;
          door.y2 = doorDrag.orig.y2 + dy;
        } else {
          door.x1 = doorDrag.orig.x1 + dx;
          door.y1 = doorDrag.orig.y1 + dy;
          door.x2 = doorDrag.orig.x2 + dx;
          door.y2 = doorDrag.orig.y2 + dy;
        }
        scheduleRedraw();
      }
      return;
    }
    if (doorPlacement) {
      scheduleRedraw(); // refresh placement-preview dashed line
    }
  }

  if (panning) {
    view.panX = panStart.panX + (sx - panStart.sx);
    view.panY = panStart.panY + (sy - panStart.sy);
    setStatus();
    scheduleRedraw();
    return;
  }
  if (!drawing) {
    if (tool === "polygon" && polyPath.length > 0) {
      lastImgPt = { x: ix, y: iy };
      scheduleRedraw();
    }
    if (tool === "rectangle" && rectStart) {
      lastImgPt = { x: ix, y: iy };
      scheduleRedraw();
    }
    return;
  }
  switch (tool) {
    case "brush":
    case "eraser": {
      const paint = tool === "brush";
      const r = prefs.brushRadius + 1;
      if (lastImgPt) {
        stampSegment(mask, imgW, imgH, lastImgPt.x, lastImgPt.y, ix, iy, prefs.brushRadius, paint);
        expandStrokeDirty(
          Math.min(lastImgPt.x, ix) - r,
          Math.min(lastImgPt.y, iy) - r,
          Math.max(lastImgPt.x, ix) + r,
          Math.max(lastImgPt.y, iy) + r,
        );
      } else {
        stampCircle(mask, imgW, imgH, ix, iy, prefs.brushRadius, paint);
        expandStrokeDirty(ix - r, iy - r, ix + r, iy + r);
      }
      flushStrokeDirty();
      lastImgPt = { x: ix, y: iy };
      scheduleRedraw();
      break;
    }
    case "lasso":
      lassoPath.push({ x: ix, y: iy });
      scheduleRedraw();
      break;
    case "rectangle":
    case "line":
      lastImgPt = { x: ix, y: iy };
      scheduleRedraw();
      break;
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (!mask) return;
  if (panning) {
    panning = false;
    canvas.classList.remove("pan-active");
    return;
  }
  // 2026-05-26 (Phase D) — finalize a door drag. The actual position
  // mutation already happened in pointermove; here we just clear the
  // drag state and release pointer capture.
  if (doorDrag) {
    doorDrag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    return;
  }
  if (!drawing) return;
  drawing = false;
  if (tool === "lasso") {
    if (lassoPath.length >= 3) {
      fillPolygon(mask, imgW, imgH, lassoPath, shapeFillPaint());
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of lassoPath) {
        if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
      }
      blitMaskRect(x0 - 1, y0 - 1, x1 + 2, y1 + 2);
      updateMaskCount();
    }
    lassoPath = [];
    scheduleRedraw();
  } else if (tool === "rectangle") {
    if (rectStart && lastImgPt) {
      fillRectangle(mask, imgW, imgH, rectStart.x, rectStart.y, lastImgPt.x, lastImgPt.y, shapeFillPaint());
      blitMaskRect(
        Math.min(rectStart.x, lastImgPt.x) - 1,
        Math.min(rectStart.y, lastImgPt.y) - 1,
        Math.max(rectStart.x, lastImgPt.x) + 2,
        Math.max(rectStart.y, lastImgPt.y) + 2,
      );
      updateMaskCount();
    }
    rectStart = null;
    lastImgPt = null;
    scheduleRedraw();
  } else if (tool === "line") {
    if (rectStart && lastImgPt) {
      const paint = shapeFillPaint();
      stampSegment(
        mask, imgW, imgH,
        rectStart.x, rectStart.y,
        lastImgPt.x, lastImgPt.y,
        prefs.brushRadius, paint,
      );
      const r = prefs.brushRadius + 1;
      blitMaskRect(
        Math.min(rectStart.x, lastImgPt.x) - r,
        Math.min(rectStart.y, lastImgPt.y) - r,
        Math.max(rectStart.x, lastImgPt.x) + r,
        Math.max(rectStart.y, lastImgPt.y) + r,
      );
      updateMaskCount();
    }
    rectStart = null;
    lastImgPt = null;
    scheduleRedraw();
  } else if (tool === "brush" || tool === "eraser") {
    lastImgPt = null;
    updateMaskCount();
  }
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener("pointerleave", () => {
  hideBrushCursor();
});

canvas.addEventListener("dblclick", (e) => {
  if (!mask) return;
  if (tool === "polygon" && polyPath.length >= 3) {
    fillPolygon(mask, imgW, imgH, polyPath, shapeFillPaint());
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polyPath) {
      if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
    }
    blitMaskRect(x0 - 1, y0 - 1, x1 + 2, y1 + 2);
    polyPath = [];
    updateMaskCount();
    scheduleRedraw();
    e.preventDefault();
  }
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  zoomAt(view, sx, sy, factor);
  setStatus();
  updateBrushCursorAt(sx, sy);
  scheduleRedraw();
}, { passive: false });

// --- Color picker ----------------------------------------------------------

function pickColorAt(ix: number, iy: number): void {
  if (!imgRGBA) return;
  const x = ix | 0;
  const y = iy | 0;
  if (x < 0 || y < 0 || x >= imgW || y >= imgH) return;
  const i = (y * imgW + x) * 4;
  const r = imgRGBA[i], g = imgRGBA[i + 1], b = imgRGBA[i + 2];
  prefs.params.colorDistance.r = r;
  prefs.params.colorDistance.g = g;
  prefs.params.colorDistance.b = b;
  const hex = "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
  $<HTMLInputElement>("cd-color").value = hex;
  $("cd-color-hex").textContent = hex;
  setAlgorithm("colorDistance");
  thresholdDirty = true;
  stInfo.textContent = (en ? "Picked color " : "已取色 ") + hex;
  savePrefs();
}

// --- Save ------------------------------------------------------------------

// 2026-05-26 — Save now goes through a small in-editor modal that
// asks the user whether the resulting Path + Wall items should be
// BOUND to this map (current behaviour: locked, attached, cleared
// and rewritten on each save) or INDEPENDENT (standalone scene
// items; unlocked + hit-enabled so the GM can move / edit them;
// re-opening the editor on this map shows a clean canvas because
// loadExistingFog filters by `attachedTo === mapItemId`).
function openSaveModeModal(): void {
  if (document.getElementById("ffSaveModeOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "ffSaveModeOverlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(8,10,14,0.78);" +
    "display:flex;align-items:center;justify-content:center;padding:20px";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#161922;border:1px solid rgba(255,255,255,0.15);border-radius:10px;" +
    "padding:18px 20px;max-width:520px;width:100%;display:flex;flex-direction:column;" +
    "gap:12px;color:#e6e8ee;font-family:inherit;font-size:13px";
  const title = document.createElement("div");
  title.style.cssText = "font-size:14.5px;font-weight:600;color:#fff";
  title.textContent = en ? "Save fog as…" : "保存方式";
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:12px;color:#9aa0b3;line-height:1.6";
  hint.innerHTML = en
    ? "<b>Bound to this map</b>: items follow the map when moved; re-opening the editor on this map preloads them.<br><br><b>Independent</b>: items stay put if the map moves; selectable / editable with OBR's native tools; re-opening the editor starts with a clean canvas (these items are left untouched)."
    : "<b>绑定到地图</b>：迷雾跟随地图移动；再次打开编辑器时会自动加载这些迷雾。<br><br><b>独立存在</b>：地图移动后迷雾保持原位；可以用 OBR 原生工具选中 / 移动 / 编辑；再次打开编辑器是空白画布（不会动这批数据）。";
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:4px";
  const close = () => { overlay.remove(); };
  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.textContent = en ? "Cancel" : "取消";
  btnCancel.style.cssText =
    "padding:8px 16px;border-radius:6px;background:#262a38;color:#cfd3df;" +
    "border:1px solid rgba(255,255,255,0.12);font-size:13px;cursor:pointer";
  btnCancel.addEventListener("click", close);
  const btnIndep = document.createElement("button");
  btnIndep.type = "button";
  btnIndep.textContent = en ? "Independent" : "独立存在";
  btnIndep.style.cssText =
    "padding:8px 16px;border-radius:6px;background:#3a3f50;color:#fff;" +
    "border:1px solid rgba(255,255,255,0.18);font-size:13px;cursor:pointer";
  btnIndep.addEventListener("click", () => { close(); void save(false); });
  const btnBind = document.createElement("button");
  btnBind.type = "button";
  btnBind.textContent = en ? "Bind to map" : "绑定到地图";
  btnBind.style.cssText =
    "padding:8px 16px;border-radius:6px;background:linear-gradient(180deg,#5dade2,#3b8fc5);" +
    "color:#fff;border:none;font-size:13px;font-weight:600;cursor:pointer";
  btnBind.addEventListener("click", () => { close(); void save(true); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  btnRow.append(btnCancel, btnIndep, btnBind);
  panel.append(title, hint, btnRow);
  overlay.append(panel);
  document.body.append(overlay);
}

async function save(bindToMap: boolean = true): Promise<void> {
  if (!mapItem || !mask) return;
  stInfo.textContent = en ? "Trimming edges…" : "毛边整理中…";
  const t0 = performance.now();

  // Pre-output mask smoothing on a TEMP copy. The user's editing
  // mask remains pixel-perfect for further work; this smoothed
  // version only feeds the contour tracer. Empirically, irregular
  // walls (trees, rocks) leave thousands of single-pixel zigzags
  // along the contour, multiplying point counts by 10-50× — morph
  // close+open with a 3×3 kernel collapses that noise into clean
  // boundaries without altering the silhouette enough to notice.
  let smoothMask = mask;
  if (prefs.outputSmoothK > 0) {
    const k = prefs.outputSmoothK;
    // Close (dilate→erode) fills tiny notches.
    let m = morphClose(mask, imgW, imgH, k);
    // Open (erode→dilate) removes thin spikes / single-pixel hairs.
    m = morphOpen(m, imgW, imgH, Math.max(2, k - 1));
    smoothMask = m;
  }

  stInfo.textContent = en ? "Extracting contours…" : "提取轮廓中…";
  const contours = traceContours(smoothMask, imgW, imgH);
  const baseTol = Number(($<HTMLInputElement>("simp")).value) || 0;

  // OBR rejects an items.add when any field's array length exceeds
  // its validator limit. Empirically ~250k+ commands fails outright;
  // smaller multi-path saves can still fail when individual paths'
  // commands arrays cross some lower threshold. We attack this on
  // three fronts:
  //
  //   1. Adaptive per-pipeline tolerance — if total point count
  //      after simplify+chaikin would blow the budget, increase the
  //      DP tolerance (and reduce chaikin iters as a last resort)
  //      and re-run. Preserves the user's smoothing intent.
  //   2. Multi-Path batching — split commands across multiple Path
  //      items, each well below the per-item ceiling.
  //   3. Chunked addItems — call addItems in small batches so the
  //      OUTER array (the parameter to OBR.scene.items.addItems)
  //      also stays small.
  //
  // Empirically-validated safe values:
  //   - Per-path commands: 1500 (tested up to 5k = OK most of the
  //     time, but 1.5k has zero failures).
  //   - Total point budget: 8000 (after smoothing this is plenty
  //     for typical maps; output-time jaggy cleanup means the
  //     pre-budget contours are already much smaller than v1.0.78).
  const TOTAL_POINT_BUDGET = 8000;
  const COMMANDS_PER_PATH = 1500;
  const ADD_ITEMS_CHUNK = 8;

  let tol = baseTol;
  let iters = prefs.chaikinIters;
  let processed: Vec2[][] = [];
  let totalPts = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    processed = contours.map((c) => simplifyDP(c, tol));
    if (iters > 0) {
      processed = processed.map((c) => chaikinSmooth(c, iters, true));
    }
    processed = processed.filter((c) => c.length >= 4);
    totalPts = processed.reduce((s, c) => s + c.length, 0);
    if (totalPts <= TOTAL_POINT_BUDGET) break;
    // Trim chaikin first (preserve detail), then bump DP tolerance.
    if (iters > 0) {
      iters--;
    } else {
      tol = tol > 0 ? tol * 1.5 : 1.5;
    }
  }
  const adaptiveNote =
    tol !== baseTol || iters !== prefs.chaikinIters
      ? (en
          ? ` (auto-simplified tol=${tol.toFixed(1)} corner=${iters})`
          : `（自适应简化 tol=${tol.toFixed(1)} 切角=${iters}）`)
      : "";

  // 2026-05-26 (Phase D) — relax the "no contours" guard when the
  // user has placed doors. Door-only saves are valid (no walls, just
  // door segments). If both are empty, still abort.
  if (processed.length === 0 && doors.length === 0) {
    stInfo.textContent = en
      ? "Nothing to save — paint some walls or place a door first"
      : "没有可保存的内容 — 先涂点墙或者放一扇门";
    return;
  }

  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

  // Clear pre-existing fullFog Path (shared) AND Wall items (local)
  // for this map. Walls live in OBR.scene.local — separate API.
  // 2026-05-26 — only clear when saving BOUND. Independent save mode
  // leaves prior items alone (they're user-managed standalone scene
  // items at this point — the editor shouldn't touch them on a
  // subsequent save).
  // Canvas doors / windows live on the outline Paths we're about to
  // delete — snapshot them first so they can be re-projected onto the
  // new geometry below.
  let preservedOpenings: PreservedOpening[] = [];
  if (bindToMap) {
    preservedOpenings = await snapshotOpenings(mapItemId);
    try {
      const existingPaths = await OBR.scene.items.getItems((it: Item) => {
        return (it as any).attachedTo === mapItemId
          && !!((it as any).metadata as any)?.[FOG_PATH_KEY];
      });
      if (existingPaths.length > 0) {
        await OBR.scene.items.deleteItems(existingPaths.map((i) => i.id));
      }
      const existingWalls = await OBR.scene.local.getItems((it: any) => {
        return it.attachedTo === mapItemId
          && !!(it.metadata as any)?.[FOG_PATH_KEY];
      });
      if (existingWalls.length > 0) {
        await OBR.scene.local.deleteItems(existingWalls.map((i: any) => i.id));
      }
    } catch (e) {
      console.warn("[fullFog] clear existing items failed", e);
    }
  }

  const tension = prefs.smoothingTension;
  const wantPath = prefs.outputMode === "path" || prefs.outputMode === "both";
  const wantWall = prefs.outputMode === "wall" || prefs.outputMode === "both";

  // Path is the canonical persistent record (shared scene). Walls
  // are derived per-client from Path commands — see the watcher in
  // setupFullFog. We do NOT store wall polylines in metadata because
  // sampled bezier polylines for ~50 segments easily exceed OBR's
  // per-item metadata array length limit on busy maps. The Path's
  // `commands` field is a top-level array with a separate (much
  // higher) limit and already encodes the smoothed shape.
  //
  // Path coords are MAP-LOCAL (matching the Wall convention) so
  // both can share the same image-space → map-local transform and
  // the watcher's command sampler can output Wall polylines without
  // any re-projection.
  const localPolysForOutput = processed.map((c) => imagePxToMapLocal(c, mapItem, sceneDpi));

  // Batch polygons into Path items so each path's `commands` array
  // stays well under OBR's validator limit. Per-polygon command
  // count is approximately poly.length + 2 (move + N segments + close)
  // for both LINE and CUBIC outputs.
  const sharedItems: any[] = [];
  {
    const visible = prefs.outputMode !== "wall";
    const opts = {
      fillOpacity: 0.0,
      strokeOpacity: visible ? 0.85 : 0.0,
      strokeWidth: visible ? Math.max(2, Math.round(sceneDpi / 30)) : 0,
      tension,
      // Signed — a negative offset pushes the blocking wall INTO the
      // wall material. It used to be clamped at 0 here, so half the
      // slider's range silently did nothing and the magenta wall
      // preview disagreed with what was saved.
      wallExpandPx: Math.round(prefs.wallExpandPx ?? 0),
      // Pre-converted to map-local units so the wall engine never has
      // to find the map image for its grid dpi — an independent save
      // has no map to find.
      wallExpandLocalPx:
        Math.round(prefs.wallExpandPx ?? 0) *
        (sceneDpi / (mapItem.grid?.dpi || sceneDpi)),
      bindToMap,
    };
    let batch: typeof localPolysForOutput = [];
    let batchCount = 0;
    for (const poly of localPolysForOutput) {
      const polyCmds = poly.length + 2;
      if (batchCount + polyCmds > COMMANDS_PER_PATH && batch.length > 0) {
        const p = buildFogPath(batch, mapItem, opts);
        if (p) sharedItems.push(p);
        batch = [];
        batchCount = 0;
      }
      batch.push(poly);
      batchCount += polyCmds;
    }
    if (batch.length > 0) {
      const p = buildFogPath(batch, mapItem, opts);
      if (p) sharedItems.push(p);
    }
  }

  // Re-project the canvas doors / windows onto the new outline Paths.
  // Must happen while `sharedItems` still holds ONLY outline paths —
  // the Phase-D door items are appended further down.
  const reattachedOpenings = reattachOpenings(preservedOpenings, sharedItems, mapItem);
  const lostOpenings = preservedOpenings.length - reattachedOpenings;

  // 2026-08-25 — the editor no longer emits Wall items itself.
  //
  // It used to, for INDEPENDENT (unbound) saves only, because the old
  // wall watcher skipped Paths without `attachedTo`. The dynfog engine
  // has no such restriction: it derives walls from every FOG-layer
  // drawing, bound or not, and it is the only thing that cuts door /
  // window gaps into them. Emitting a second, untracked wall set here
  // would leave an unbound map permanently sealed — the engine would
  // open its own copy of the wall while the editor's copy went on
  // blocking vision.
  const localItems: any[] = [];
  void wantWall;

  // 2026-05-26 (Phase D) — append door items to sharedItems. Doors
  // are tiny FOG-layer Paths with dynamic-fog door metadata; they
  // travel through the same scene.items.addItems pipeline as the
  // wall outline paths. (Old doors with the same map-binding were
  // already cleared in the existing-items wipe above, gated on
  // bindToMap — independent doors stay untouched on subsequent
  // saves, matching the wall behaviour.)
  let doorItemCount = 0;
  for (const d of doors) {
    const di = buildDoorItem(d, mapItem, sceneDpi, bindToMap);
    if (di) {
      sharedItems.push(di);
      doorItemCount++;
    }
  }

  if (sharedItems.length === 0 && localItems.length === 0) {
    stInfo.textContent = en ? "Failed to build output" : "构建输出失败";
    return;
  }

  try {
    // Chunk both add calls so the OUTER array (the addItems
    // parameter) stays small enough for the outer validator —
    // separate from the per-item commands cap.
    for (let i = 0; i < sharedItems.length; i += ADD_ITEMS_CHUNK) {
      const chunk = sharedItems.slice(i, i + ADD_ITEMS_CHUNK);
      await OBR.scene.items.addItems(chunk);
    }
    // 2026-05-26 — Walls always go to scene.local regardless of
    // bind mode. The plugin SDK's scene.items.addItems rejects WALL
    // items with "items[0] does not match any of the allowed types"
    // (shared scene only accepts Path / Shape / Image / Curve / etc.;
    // Walls are a per-client visibility primitive or get auto-derived
    // by dynamic-fog from FOG-layer Drawings). The user's "selectable
    // / editable" requirement in independent mode is satisfied by the
    // Path items above (which DO go to shared scene.items, and are
    // emitted unlocked + hit-enabled when bindToMap=false).
    for (let i = 0; i < localItems.length; i += ADD_ITEMS_CHUNK) {
      const chunk = localItems.slice(i, i + ADD_ITEMS_CHUNK);
      await OBR.scene.local.addItems(chunk);
    }
    const t1 = performance.now();
    const modeTag = en
      ? (bindToMap ? "bound" : "independent")
      : (bindToMap ? "绑定" : "独立");
    const doorSuffix = doorItemCount > 0
      ? (en ? ` + ${doorItemCount} doors` : ` + ${doorItemCount} 门`)
      : "";
    // Canvas doors / windows carried over to the new geometry. Say so
    // explicitly — including any that had to be dropped, so the GM
    // knows to re-place them instead of discovering it mid-session.
    const openingSuffix = preservedOpenings.length > 0
      ? (en
          ? ` · kept ${reattachedOpenings}/${preservedOpenings.length} door/window markers${lostOpenings > 0 ? ` (${lostOpenings} dropped — wall moved too far)` : ""}`
          : ` · 门窗标记保留 ${reattachedOpenings}/${preservedOpenings.length}${lostOpenings > 0 ? `（${lostOpenings} 个因墙体位置变化过大被丢弃）` : ""}`)
      : "";
    stInfo.textContent = en
      ? `✅ Saved [${modeTag}] ${processed.length} segments, ${totalPts} points${adaptiveNote} (${sharedItems.length} shared Path${doorSuffix} · ${(t1 - t0).toFixed(0)}ms)${openingSuffix}`
      : `✅ 保存了 [${modeTag}] ${processed.length} 段 ${totalPts} 个点${adaptiveNote}（${sharedItems.length} 共享 Path${doorSuffix} · ${(t1 - t0).toFixed(0)}ms）${openingSuffix}`;
    setTimeout(() => { void OBR.modal.close(MODAL_ID).catch(() => {}); }, 700);
  } catch (e) {
    // OBR rejects with a plain object whose `.message` is undefined.
    // Try every property we know about so the user gets a readable
    // hint. The real validation message is usually in `.error.message`.
    let detail = "";
    try {
      const err = e as any;
      detail = err?.error?.message
        ?? err?.message
        ?? err?.error
        ?? (typeof err === "string" ? err : JSON.stringify(err).slice(0, 240))
        ?? String(e);
    } catch { detail = String(e); }
    console.error("[fullFog] save failed", e, "shared:", sharedItems, "local:", localItems);
    stInfo.textContent = (en ? "❌ Save failed: " : "❌ 保存失败：") + detail;
  }
}

async function cancel(): Promise<void> {
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

// --- Mask import / export -------------------------------------------------
//
// Save the WIP mask to a JSON file (RLE-encoded) so the user never
// loses work to a refresh / redeploy / accidental modal close. The
// JSON also embeds the current prefs so re-importing restores the
// full editor state.
//
// File format (small enough to copy-paste into a chat if needed):
//   {
//     "fullFogVersion": "1",
//     "savedAt": "2026-05-05T...",
//     "mapId": "...",
//     "imgW": 4000, "imgH": 3000,
//     "maskRle": "100,200,500,...",
//     "prefs": { ... full EditorPrefs ... }
//   }

interface ExportedMaskFile {
  fullFogVersion: string;
  savedAt: string;
  mapId: string | null;
  mapName: string | null;
  imgW: number;
  imgH: number;
  maskRle: string;
  prefs: EditorPrefs;
}

function exportMaskJSON(): void {
  if (!mask) return;
  const data: ExportedMaskFile = {
    fullFogVersion: "1",
    savedAt: new Date().toISOString(),
    mapId: mapItem?.id ?? null,
    mapName: mapItem?.name ?? null,
    imgW,
    imgH,
    maskRle: encodeMaskRle(mask),
    prefs,
  };
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = (mapItem?.name || "map").replace(/[^a-zA-Z0-9一-龯_-]/g, "_");
  a.download = `fullfog-${name}-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
  stInfo.textContent = en
    ? `Exported mask JSON (${(json.length / 1024).toFixed(1)} KB)`
    : `已导出 mask JSON（${(json.length / 1024).toFixed(1)} KB）`;
}

function importMaskJSON(): void {
  if (!mask) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as ExportedMaskFile;
      if (data.fullFogVersion !== "1") {
        if (!confirm(en
          ? `Unknown fullFog version ${data.fullFogVersion}. Import anyway?`
          : `未知的 fullFog 版本 ${data.fullFogVersion}，仍然导入？`)) return;
      }
      if (data.imgW !== imgW || data.imgH !== imgH) {
        if (!confirm(en
          ? `JSON was exported for a ${data.imgW}×${data.imgH} map, ` +
            `but the current one is ${imgW}×${imgH}. Import anyway? (mask will be cropped/stretched to the current size)`
          : `JSON 是为 ${data.imgW}×${data.imgH} 的地图导出的，` +
            `但当前是 ${imgW}×${imgH}。仍然导入？（mask 会被裁剪/拉伸到当前尺寸）`,
        )) return;
      }
      pushUndo();
      const decoded = decodeMaskRle(data.maskRle, imgW * imgH);
      mask!.set(decoded.subarray(0, mask!.length));
      // Restore prefs (without losing the displayMode / outputMode / etc
      // structure if older JSONs lack new fields).
      if (data.prefs) {
        prefs = {
          ...DEFAULT_PREFS,
          ...data.prefs,
          params: { ...DEFAULT_PREFS.params, ...(data.prefs.params ?? {}) },
          refinement: { ...DEFAULT_PREFS.refinement, ...(data.prefs.refinement ?? {}) },
          toolModes: { ...DEFAULT_PREFS.toolModes, ...((data.prefs as any).toolModes ?? {}) },
        };
        savePrefs();
        // Re-apply UI to reflect imported prefs.
        refreshToolBadges();
        const snapBtn = $<HTMLButtonElement>("btn-snap");
        if (snapBtn) snapBtn.classList.toggle("on", prefs.gridSnap);
      }
      rebuildMaskLayer();
      updateMaskCount();
      schedulePreviewRefresh();
      scheduleRedraw();
      stInfo.textContent = (en ? "Imported mask (" : "已导入 mask（") + file.name + (en ? ")" : "）");
    } catch (e) {
      console.error("[fullFog] import failed", e);
      stInfo.textContent = (en ? "❌ Import failed: " : "❌ 导入失败：") + (e as Error).message;
    }
  };
  input.click();
}

// --- UI binding ------------------------------------------------------------

function setTool(t: ToolId): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-tool]").forEach((b) => {
    b.classList.toggle("on", b.dataset.tool === t);
  });
  if (t !== "polygon") polyPath = [];
  if (t !== "rectangle" && t !== "line") { rectStart = null; lastImgPt = null; }
  canvas.classList.toggle("brush-active", t === "brush" || t === "eraser");
  if (t !== "brush" && t !== "eraser") hideBrushCursor();
  setStatus();
  scheduleRedraw();
}

/** Right-click on a shape tool's toolbar button toggles its
 *  per-tool add/erase mode. Visual badge on the button reflects
 *  the current mode for at-a-glance state. */
function toggleShapeMode(t: ShapeToolId): void {
  const next: ShapeMode = prefs.toolModes[t] === "add" ? "erase" : "add";
  prefs.toolModes[t] = next;
  refreshToolBadges();
  if (tool === t) setStatus();
  savePrefs();
}

function refreshToolBadges(): void {
  document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-tool]").forEach((b) => {
    const t = b.dataset.tool as ToolId;
    if (isShapeTool(t)) {
      const mode = prefs.toolModes[t];
      b.dataset.mode = mode;
      b.title = en
        ? `${TOOL_LABELS[t]} (now: ${mode === "add" ? "fill" : "erase"}) — right-click to toggle fill/erase`
        : `${TOOL_LABELS[t]}（当前：${mode === "add" ? "填充" : "擦除"}）— 右键此按钮切换填/擦`;
    }
  });
}

function setAlgorithm(a: AlgorithmId): void {
  prefs.algorithm = a;
  $<HTMLSelectElement>("algorithm").value = a;
  document.querySelectorAll<HTMLDivElement>(".param-group").forEach((g) => {
    g.style.display = "none";
  });
  const grp = document.getElementById(`params-${a}`);
  if (grp) grp.style.display = "block";
  thresholdDirty = true;
  if (prefs.displayMode === "threshold") scheduleRedraw();
  savePrefs();
}

function setDisplayMode(m: "color" | "threshold"): void {
  prefs.displayMode = m;
  thresholdDirty = true;
  document.querySelectorAll<HTMLButtonElement>(".display-mode-btn").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === m);
  });
  scheduleRedraw();
  savePrefs();
}

function bindSlider(
  inputId: string,
  valId: string,
  setter: (v: number) => void,
  fmt?: (v: number) => string,
): void {
  const input = $<HTMLInputElement>(inputId);
  const val = $(valId);
  const sync = () => {
    const v = Number(input.value);
    setter(v);
    val.textContent = fmt ? fmt(v) : String(v);
    savePrefs();
  };
  input.addEventListener("input", sync);
  sync();
}

function bindUI(): void {
  document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-tool]").forEach((b) => {
    b.addEventListener("click", () => setTool(b.dataset.tool as ToolId));
    // Right-click on shape-tool buttons toggles add/erase mode.
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const t = b.dataset.tool as ToolId;
      if (isShapeTool(t)) toggleShapeMode(t);
    });
  });
  refreshToolBadges();

  // Header grid-snap toggle.
  const snapBtn = $<HTMLButtonElement>("btn-snap");
  if (snapBtn) {
    snapBtn.classList.toggle("on", prefs.gridSnap);
    snapBtn.addEventListener("click", () => {
      prefs.gridSnap = !prefs.gridSnap;
      snapBtn.classList.toggle("on", prefs.gridSnap);
      savePrefs();
    });
  }

  // Display mode toggle (色彩 / 灰白预览).
  document.querySelectorAll<HTMLButtonElement>(".display-mode-btn").forEach((b) => {
    b.addEventListener("click", () => setDisplayMode(b.dataset.mode as "color" | "threshold"));
  });
  setDisplayMode(prefs.displayMode);

  // Pre-filter.
  const pre = $<HTMLSelectElement>("prefilter");
  pre.value = prefs.preFilter;
  pre.addEventListener("change", () => {
    prefs.preFilter = pre.value as EditorPrefs["preFilter"];
    $("prefilter-val").textContent = pre.options[pre.selectedIndex].text;
    thresholdDirty = true;
    if (prefs.displayMode === "threshold") scheduleRedraw();
    savePrefs();
  });
  $("prefilter-val").textContent = pre.options[pre.selectedIndex]?.text ?? "";

  const algoSel = $<HTMLSelectElement>("algorithm");
  algoSel.value = prefs.algorithm;
  algoSel.addEventListener("change", () => setAlgorithm(algoSel.value as AlgorithmId));
  setAlgorithm(prefs.algorithm);

  // Mark threshold dirty whenever any algorithm param changes so the
  // preview re-renders to reflect the new settings on next redraw.
  const markThresholdDirty = () => {
    thresholdDirty = true;
    if (prefs.displayMode === "threshold") scheduleRedraw();
  };

  bindSlider("thr-T", "thr-T-val", (v) => { prefs.params.threshold.T = v; markThresholdDirty(); });
  bindSlider("otsu-off", "otsu-off-val", (v) => { prefs.params.otsu.offset = v; markThresholdDirty(); });
  bindSlider("adp-blk", "adp-blk-val", (v) => {
    prefs.params.adaptive.block = v % 2 === 0 ? v + 1 : v;
    markThresholdDirty();
  });
  bindSlider("adp-C", "adp-C-val", (v) => { prefs.params.adaptive.C = v; markThresholdDirty(); });
  bindSlider("cd-tol", "cd-tol-val", (v) => { prefs.params.colorDistance.tol = v; markThresholdDirty(); });
  bindSlider("ce-T", "ce-T-val", (v) => { prefs.params.colorExclude.T = v; markThresholdDirty(); });
  bindSlider("sa-T", "sa-T-val", (v) => { prefs.params.satAware.T = v; markThresholdDirty(); });
  bindSlider("sa-S", "sa-S-val", (v) => { prefs.params.satAware.maxSat = v; markThresholdDirty(); });

  const cdColor = $<HTMLInputElement>("cd-color");
  cdColor.value = "#000000";
  cdColor.addEventListener("input", () => {
    const hex = cdColor.value;
    prefs.params.colorDistance.r = parseInt(hex.slice(1, 3), 16);
    prefs.params.colorDistance.g = parseInt(hex.slice(3, 5), 16);
    prefs.params.colorDistance.b = parseInt(hex.slice(5, 7), 16);
    $("cd-color-hex").textContent = hex;
    markThresholdDirty();
    savePrefs();
  });

  bindSlider("ref-thinline", "ref-thinline-val", (v) => { prefs.refinement.thinLineK = v; });
  bindSlider("ref-open", "ref-open-val", (v) => { prefs.refinement.openK = v; });
  bindSlider("ref-close", "ref-close-val", (v) => { prefs.refinement.closeK = v; });
  bindSlider("ref-area", "ref-area-val", (v) => { prefs.refinement.minArea = v; });
  bindSlider("ref-hole", "ref-hole-val", (v) => { prefs.refinement.holeFillMaxArea = v; });

  bindSlider("brush-r", "brush-r-val", (v) => {
    prefs.brushRadius = v;
    // Refresh visible brush cursor immediately so the user can SEE
    // the new size while dragging the slider.
    const last = lastBrushScreenPos;
    if (last) updateBrushCursorAt(last.sx, last.sy);
  });
  bindSlider("wand-tol", "wand-tol-val", (v) => { prefs.wandTolerance = v; });
  bindSlider("simp", "simp-val", () => { schedulePreviewRefresh(); });

  // Output settings.
  document.querySelectorAll<HTMLButtonElement>(".output-mode-btn").forEach((b) => {
    b.addEventListener("click", () => {
      prefs.outputMode = b.dataset.mode as EditorPrefs["outputMode"];
      document.querySelectorAll<HTMLButtonElement>(".output-mode-btn").forEach((x) => {
        x.classList.toggle("on", x.dataset.mode === prefs.outputMode);
      });
      savePrefs();
    });
    if (b.dataset.mode === prefs.outputMode) b.classList.add("on");
  });
  bindSlider("smooth-tension", "smooth-tension-val",
    (v) => { prefs.smoothingTension = v / 100; schedulePreviewRefresh(); },
    (v) => (v / 100).toFixed(2));
  // Restore the saved value before bindSlider runs so the bind's
  // first `sync()` reads the loaded pref and not the HTML default.
  $<HTMLInputElement>("wall-expand").value = String(prefs.wallExpandPx ?? 0);
  bindSlider("wall-expand", "wall-expand-val",
    (v) => {
      prefs.wallExpandPx = v;
      // Wall-preview reflects this offset — re-render so the magenta
      // dashed line tracks the slider live.
      schedulePreviewRefresh();
    });
  bindSlider("chaikin-iters", "chaikin-iters-val",
    (v) => { prefs.chaikinIters = v; schedulePreviewRefresh(); });
  bindSlider("out-smooth-k", "out-smooth-k-val",
    (v) => { prefs.outputSmoothK = v; schedulePreviewRefresh(); });

  // Preview button — toggles output overlay on/off; first toggle-on
  // also computes from current state. While on, slider edits debounce-
  // refresh so the user can SEE smoothing curves change in real time.
  $("btn-preview").addEventListener("click", () => togglePreview());

  $("btn-apply-algo").addEventListener("click", () => applyAlgorithm());

  // 2026-05-26 (Phase C) — B&W reference image wiring. The hidden
  // <input type=file> spawned per click matches the project's
  // existing import patterns (see panel-page's paste-JSON modal,
  // editor's mask-import). The clear / show / opacity controls are
  // also bound here; syncBwUi() flips their disabled state based
  // on whether bwImage is currently loaded.
  $("btn-bw-import").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/png,image/jpeg,image/webp,image/*";
    inp.addEventListener("change", () => {
      const f = inp.files?.[0];
      if (f) void importBwImage(f);
    });
    inp.click();
  });
  $("btn-bw-clear").addEventListener("click", () => { clearBwImage(); });
  const bwShowCb = document.getElementById("bw-show") as HTMLInputElement | null;
  bwShowCb?.addEventListener("change", () => {
    bwShow = bwShowCb.checked;
    scheduleRedraw();
  });
  const bwOpSld = document.getElementById("bw-opacity") as HTMLInputElement | null;
  bwOpSld?.addEventListener("input", () => {
    bwOpacity = Math.max(0, Math.min(1, Number(bwOpSld.value) / 100));
    const opVal = document.getElementById("bw-opacity-val");
    if (opVal) opVal.textContent = `${Math.round(bwOpacity * 100)}%`;
    scheduleRedraw();
  });
  syncBwUi();
  $("btn-apply-refine").addEventListener("click", () => applyRefinement());
  $("btn-undo").addEventListener("click", () => undo());
  $("btn-redo").addEventListener("click", () => redo());
  $("btn-fit").addEventListener("click", () => {
    if (!mapImage) return;
    fitToView(view, imgW, imgH, canvas.clientWidth, canvas.clientHeight);
    setStatus();
    scheduleRedraw();
  });
  $("btn-clear").addEventListener("click", () => {
    if (confirm(en ? "Clear the current mask? This can be undone." : "确定清空当前 mask？此操作可撤销。")) clearMask();
  });
  // 2026-05-26 — Save now opens a mode-picker modal first (bound vs
  // independent). The modal callbacks call save(true|false).
  $("btn-save").addEventListener("click", () => { openSaveModeModal(); });
  $("btn-cancel").addEventListener("click", () => { void cancel(); });
  $("btn-export").addEventListener("click", () => exportMaskJSON());
  $("btn-import").addEventListener("click", () => importMaskJSON());
}

// Last screen-space pointer position — used to keep the brush cursor
// visible after a brush-radius slider tweak. Distinct from the main
// pointermove handler above (separate listener to avoid coupling
// state to drawing logic).
let lastBrushScreenPos: { sx: number; sy: number } | null = null;
canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  lastBrushScreenPos = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}, { capture: true });

// --- Keyboard --------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement | null;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;

  if (e.key === " ") {
    spaceDown = true;
    canvas.classList.add("pan");
    e.preventDefault();
    return;
  }
  if (e.key === "1") setTool("brush");
  if (e.key === "2") setTool("eraser");
  if (e.key === "3") setTool("lasso");
  if (e.key === "4") setTool("polygon");
  if (e.key === "5") setTool("rectangle");
  if (e.key === "6") setTool("line");
  if (e.key === "7") setTool("magicWand");
  if (e.key === "8") setTool("paintBucket");
  if (e.key === "9") setTool("picker");
  if (e.key === "Control") ctrlDown = true;
  if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  }
  if ((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    redo();
  }
  if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openSaveModeModal();
  }
  if (e.key === "Escape") {
    // Door tool: Esc cancels in-flight placement first, then
    // deselects the active door, before bubbling up to "close editor".
    if (tool === "door" && doorPlacement) {
      doorPlacement = null;
      scheduleRedraw();
    } else if (tool === "door" && selectedDoorId) {
      selectedDoorId = null;
      scheduleRedraw();
    } else if (polyPath.length > 0) { polyPath = []; scheduleRedraw(); }
    else void cancel();
  }
  // 2026-05-26 (Phase D) — Delete / Backspace removes the selected
  // door when the door tool is active. Mirrors how other editors
  // handle a focused selection.
  if (tool === "door" && selectedDoorId && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    doors = doors.filter((d) => d.id !== selectedDoorId);
    selectedDoorId = null;
    scheduleRedraw();
  }
  if (e.key === "f" || e.key === "F") {
    if (!mapImage) return;
    fitToView(view, imgW, imgH, canvas.clientWidth, canvas.clientHeight);
    setStatus();
    scheduleRedraw();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === " ") { spaceDown = false; canvas.classList.remove("pan"); }
  if (e.key === "Control") ctrlDown = false;
});

window.addEventListener("resize", () => resizeCanvas());

// --- Boot ------------------------------------------------------------------

OBR.onReady(async () => {
  bindUI();
  resizeCanvas();
  await loadMap();
  setTool("brush");
});

if (typeof OBR === "undefined" || !(OBR as any).onReady) {
  bindUI();
  resizeCanvas();
}
