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

import OBR, { isImage, isPath, type Item } from "@owlbear-rodeo/sdk";
import { MODAL_ID, FOG_PATH_KEY, DEFAULT_PREFS, LS_PREFS } from "./types";
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
import { buildFogWalls, imagePxToMapLocal } from "./output/obrWalls";
import { safeWallOffset } from "./output/wallOffset";
import { samplePathCommands } from "./output/samplePath";
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
    mapMetaEl.textContent = "未传入 map id";
    return;
  }
  try {
    const items = await OBR.scene.items.getItems([mapItemId]);
    if (items.length === 0) { mapMetaEl.textContent = "map item 不存在"; return; }
    const it = items[0] as any;
    if (!isImage(it as Item)) { mapMetaEl.textContent = "目标不是图片 item"; return; }
    mapItem = it;
    mapMetaEl.textContent = `${it.name ?? "(未命名)"} · ${it.image.width}×${it.image.height}`;
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
    stInfo.textContent = "已加载，开始编辑";
  } catch (e) {
    console.error("[fullFog] loadMap failed", e);
    mapMetaEl.textContent = `加载失败：${(e as Error).message}`;
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
      if (kind && kind !== "outline") return false;
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

  // Rasterise polygons via Canvas2D fill (evenodd rule matches the
  // save side, so multi-subpath holes stay holes). Then read pixels
  // back into the mask Uint8Array.
  const oc = makeOffscreen(imgW, imgH);
  const ctx = (oc as any).getContext("2d") as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, imgW, imgH);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();

  let polyTotal = 0;
  for (const item of existing) {
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

const TOOL_LABELS: Record<ToolId, string> = {
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
};

function currentModeLabel(): string {
  if (!isShapeTool(tool)) return "";
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
  ctx2d.restore();
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

function runAlgorithm(algo: AlgorithmId): Uint8Array {
  if (!imgRGBA) throw new Error("no image");
  const rgba = preFilter(imgRGBA);
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
  if (!mask || !imgRGBA) return;
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
  stInfo.textContent = `算法 ${prefs.algorithm} 已应用 (${merge ? "合并" : "覆盖"})`;
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
  stInfo.textContent = "清理完成";
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
  stInfo.textContent = "已清空 mask";
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

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

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
      stInfo.textContent = `魔棒选中 ${n}px`;
      rebuildMaskLayer();
      updateMaskCount();
      scheduleRedraw();
      drawing = false;
      break;
    }
    case "paintBucket": {
      pushUndo();
      const n = paintBucket(mask, imgW, imgH, ix, iy);
      stInfo.textContent = `油漆桶填充 ${n}px`;
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
  stInfo.textContent = `已取色 ${hex}`;
  savePrefs();
}

// --- Save ------------------------------------------------------------------

async function save(): Promise<void> {
  if (!mapItem || !mask) return;
  stInfo.textContent = "毛边整理中…";
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

  stInfo.textContent = "提取轮廓中…";
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
      ? `（自适应简化 tol=${tol.toFixed(1)} 切角=${iters}）`
      : "";

  if (processed.length === 0) {
    stInfo.textContent = "没有可保存的轮廓 — 先涂点墙再保存";
    return;
  }

  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

  // Clear pre-existing fullFog Path (shared) AND Wall items (local)
  // for this map. Walls live in OBR.scene.local — separate API.
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
      wallExpandPx: Math.max(0, Math.round(prefs.wallExpandPx ?? 0)),
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

  // Walls also computed locally for IMMEDIATE feedback on the GM's
  // client (the watcher would create them anyway on the next
  // items.onChange tick, but doing it inline avoids a flicker frame).
  // Sampling done via smoothToPolyline so the lines match what the
  // watcher's commands-sampler will produce on other clients.
  //
  // Apply the SAME wall-expand offset the watcher will apply, so
  // the inline walls and watcher-produced walls coincide. Without
  // this, two sets of walls (one at the visible edge, one offset)
  // both block vision and the inner one always wins, defeating
  // negative wall-expand values.
  const wallExpandSavePx = Number(prefs.wallExpandPx ?? 0);
  let wallContoursForSave = processed;
  if (wallExpandSavePx !== 0) {
    const expanded = safeWallOffset(processed, wallExpandSavePx, 1);
    if (expanded.length > 0) wallContoursForSave = expanded;
  }
  const wallImgPolylines = wallContoursForSave.map((c) =>
    tension > 0 ? smoothToPolyline(c, tension, true, 8) : [...c, c[0]],
  );
  const localWallPolys = wallImgPolylines.map((c) => imagePxToMapLocal(c, mapItem, sceneDpi));
  const localItems: any[] = wantWall
    ? buildFogWalls(localWallPolys, mapItem)
    : [];

  if (sharedItems.length === 0 && localItems.length === 0) {
    stInfo.textContent = "构建输出失败";
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
    for (let i = 0; i < localItems.length; i += ADD_ITEMS_CHUNK) {
      const chunk = localItems.slice(i, i + ADD_ITEMS_CHUNK);
      await OBR.scene.local.addItems(chunk);
    }
    const t1 = performance.now();
    stInfo.textContent =
      `✅ 保存了 ${processed.length} 段 ${totalPts} 个点${adaptiveNote}（${sharedItems.length} 共享 Path + ${localItems.length} 本地 Wall · ${(t1 - t0).toFixed(0)}ms）`;
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
    stInfo.textContent = `❌ 保存失败：${detail}`;
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
  stInfo.textContent = `已导出 mask JSON（${(json.length / 1024).toFixed(1)} KB）`;
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
        if (!confirm(`未知的 fullFog 版本 ${data.fullFogVersion}，仍然导入？`)) return;
      }
      if (data.imgW !== imgW || data.imgH !== imgH) {
        if (!confirm(
          `JSON 是为 ${data.imgW}×${data.imgH} 的地图导出的，` +
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
      stInfo.textContent = `已导入 mask（${file.name}）`;
    } catch (e) {
      console.error("[fullFog] import failed", e);
      stInfo.textContent = `❌ 导入失败：${(e as Error).message}`;
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
      b.title = `${TOOL_LABELS[t]}（当前：${mode === "add" ? "填充" : "擦除"}）— 右键此按钮切换填/擦`;
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
    if (confirm("确定清空当前 mask？此操作可撤销。")) clearMask();
  });
  $("btn-save").addEventListener("click", () => { void save(); });
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
    void save();
  }
  if (e.key === "Escape") {
    if (polyPath.length > 0) { polyPath = []; scheduleRedraw(); }
    else void cancel();
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
