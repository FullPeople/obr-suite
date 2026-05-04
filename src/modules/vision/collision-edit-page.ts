// Collision-map editor — full-screen modal.
//
// Pipeline:
//   1. Load the target map item from OBR; fetch its image bytes;
//      decode to an ImageBitmap.
//   2. Stage two canvases internally:
//        - displayCanvas — what the user sees (panned/zoomed view)
//        - maskCanvas    — the painted "this is wall" alpha mask,
//                          same dimensions as the source image
//   3. Tools (brush, eraser, lasso, picker) write to maskCanvas.
//      Color-detect walks the image bytes and marks alpha=255
//      anywhere the pixel matches the picked color within `thresh`.
//   4. Save: marching-squares-style boundary trace on maskCanvas.
//      Each contour → Douglas-Peucker simplify → polygon → OBR
//      Curve item on FOG layer, attached to the map, locked +
//      disable-hit. Tagged with COLLISION_WALL_KEY so vision raycast
//      treats them as walls.
//
// Coordinate systems:
//   - imagePx     = source image pixel coords (mask coords)
//   - view        = user's pan/zoom transform applied to imagePx
//   - sceneLocal  = imagePx scaled by sceneDpi/imageDpi (the
//                   "natural OBR world units" if scale=1)
//   - world       = scene metric, accounting for map's current
//                   position/scale/rotation
//
// We save walls in WORLD coords with attachedTo = mapId; OBR's
// attachment inheritance keeps them stuck to the map for future
// position / scale / rotation updates.

import OBR, { buildCurve, isImage, Item } from "@owlbear-rodeo/sdk";
import { COLLISION_WALL_KEY, COLLISION_MAP_KEY, PLUGIN_ID } from "./types";

const MODAL_ID = `${PLUGIN_ID}/collision-edit`;
const params = new URLSearchParams(location.search);
const mapItemId = params.get("id") ?? "";

// --- DOM ----------------------------------------------------------------

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx2d = canvas.getContext("2d", { alpha: true })!;
const stTool = document.getElementById("st-tool") as HTMLElement;
const stZoom = document.getElementById("st-zoom") as HTMLElement;
const stPos = document.getElementById("st-pos") as HTMLElement;
const stInfo = document.getElementById("st-info") as HTMLElement;
const mapMetaEl = document.getElementById("map-meta") as HTMLElement;
const rBrush = document.getElementById("r-brush") as HTMLInputElement;
const rBrushVal = document.getElementById("r-brush-val") as HTMLElement;
const rThresh = document.getElementById("r-thresh") as HTMLInputElement;
const rThreshVal = document.getElementById("r-thresh-val") as HTMLElement;
const rSimplify = document.getElementById("r-simplify") as HTMLInputElement;
const rSimplifyVal = document.getElementById("r-simplify-val") as HTMLElement;
const pickedColorEl = document.getElementById("picked-color") as HTMLInputElement;

// --- State --------------------------------------------------------------

type Tool = "brush" | "eraser" | "lasso" | "picker";
let tool: Tool = "brush";
let brushRadius = 20;
let thresh = 22;
let simplifyTol = 2;

let mapItem: any | null = null;
let mapImage: ImageBitmap | null = null;
// Mask is an OffscreenCanvas (preferred) or HTMLCanvasElement, sized
// to mapImage. Each pixel's alpha = "this is a wall" (255 = wall, 0 = none).
let mask: HTMLCanvasElement | OffscreenCanvas | null = null;
let maskCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

let view = { panX: 0, panY: 0, zoom: 1 };
let panning = false;
let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
let drawing = false;
let lastWorld: { x: number; y: number } | null = null;
let lassoPath: { x: number; y: number }[] = [];
let spaceDown = false;

// Undo stack — snapshots of the mask canvas. Capped at 12 entries.
const undoStack: ImageData[] = [];
const redoStack: ImageData[] = [];
const UNDO_CAP = 12;

// --- Utils --------------------------------------------------------------

function setStatus(): void {
  stTool.textContent = tool === "brush" ? "画笔" : tool === "eraser" ? "橡皮" : tool === "lasso" ? "套索" : "取色";
  stZoom.textContent = `${view.zoom.toFixed(2)}×`;
}

function viewToImage(vx: number, vy: number): { x: number; y: number } {
  return { x: (vx - view.panX) / view.zoom, y: (vy - view.panY) / view.zoom };
}

function fitToView(): void {
  if (!mapImage) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const zx = cw / mapImage.width;
  const zy = ch / mapImage.height;
  view.zoom = Math.min(zx, zy) * 0.95;
  view.panX = (cw - mapImage.width * view.zoom) / 2;
  view.panY = (ch - mapImage.height * view.zoom) / 2;
  setStatus();
  scheduleRedraw();
}

function resizeCanvas(): void {
  // Match canvas pixel size to its CSS size (HiDPI handled via DPR).
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
  ctx2d.save();
  ctx2d.translate(view.panX, view.panY);
  ctx2d.scale(view.zoom, view.zoom);
  // Map background.
  ctx2d.drawImage(mapImage as any, 0, 0);
  // Mask overlay — orange-tinted.
  if (mask) {
    ctx2d.globalAlpha = 0.55;
    ctx2d.globalCompositeOperation = "source-over";
    // Use a tinted version: draw mask as image, then re-tint.
    // Simplest: draw mask straight; its alpha already encodes paint.
    // We tint by drawing a colored rectangle clipped to mask alpha.
    // Approach: fill canvas with orange where mask alpha > 0.
    // Use a temporary tinted-mask render.
    const tinted = tintedMaskCache;
    if (tinted) ctx2d.drawImage(tinted, 0, 0);
    ctx2d.globalAlpha = 1;
  }
  // Lasso path preview.
  if (tool === "lasso" && lassoPath.length > 0) {
    ctx2d.strokeStyle = "#f5a623";
    ctx2d.lineWidth = 2 / view.zoom;
    ctx2d.beginPath();
    ctx2d.moveTo(lassoPath[0].x, lassoPath[0].y);
    for (let i = 1; i < lassoPath.length; i++) ctx2d.lineTo(lassoPath[i].x, lassoPath[i].y);
    ctx2d.stroke();
  }
  ctx2d.restore();
}

// We re-tint the mask when it changes so redraw is fast (just one
// drawImage). The tinted cache is rebuilt by `paintCommit`.
let tintedMaskCache: HTMLCanvasElement | OffscreenCanvas | null = null;
function rebuildTintedMask(): void {
  if (!mask) return;
  const w = (mask as any).width;
  const h = (mask as any).height;
  if (!tintedMaskCache || (tintedMaskCache as any).width !== w || (tintedMaskCache as any).height !== h) {
    tintedMaskCache = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
  }
  const tctx = (tintedMaskCache as any).getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  tctx.clearRect(0, 0, w, h);
  // Pull the mask alpha; replace with tint color preserving alpha.
  const md = (maskCtx as any).getImageData(0, 0, w, h) as ImageData;
  const td = new ImageData(w, h);
  for (let i = 0; i < md.data.length; i += 4) {
    const a = md.data[i + 3];
    if (a > 0) {
      td.data[i] = 245;
      td.data[i + 1] = 166;
      td.data[i + 2] = 35;
      td.data[i + 3] = a;
    }
  }
  (tctx as any).putImageData(td, 0, 0);
}

function paintCommit(): void {
  rebuildTintedMask();
  scheduleRedraw();
}

function pushUndo(): void {
  if (!mask) return;
  const w = (mask as any).width;
  const h = (mask as any).height;
  const snap = (maskCtx as any).getImageData(0, 0, w, h) as ImageData;
  undoStack.push(snap);
  if (undoStack.length > UNDO_CAP) undoStack.shift();
  redoStack.length = 0;
}

function undo(): void {
  if (!mask || undoStack.length === 0) return;
  const w = (mask as any).width;
  const h = (mask as any).height;
  const cur = (maskCtx as any).getImageData(0, 0, w, h) as ImageData;
  redoStack.push(cur);
  const prev = undoStack.pop()!;
  (maskCtx as any).putImageData(prev, 0, 0);
  paintCommit();
}

function redo(): void {
  if (!mask || redoStack.length === 0) return;
  const w = (mask as any).width;
  const h = (mask as any).height;
  const cur = (maskCtx as any).getImageData(0, 0, w, h) as ImageData;
  undoStack.push(cur);
  const next = redoStack.pop()!;
  (maskCtx as any).putImageData(next, 0, 0);
  paintCommit();
}

// --- Tool actions -------------------------------------------------------

function paintBrush(x: number, y: number): void {
  if (!maskCtx) return;
  (maskCtx as any).globalCompositeOperation = "source-over";
  (maskCtx as any).fillStyle = "rgba(255,255,255,1)";
  (maskCtx as any).beginPath();
  (maskCtx as any).arc(x, y, brushRadius, 0, Math.PI * 2);
  (maskCtx as any).fill();
  // Connect with last stroke point so fast moves don't leave gaps.
  if (lastWorld) {
    (maskCtx as any).strokeStyle = "rgba(255,255,255,1)";
    (maskCtx as any).lineWidth = brushRadius * 2;
    (maskCtx as any).lineCap = "round";
    (maskCtx as any).beginPath();
    (maskCtx as any).moveTo(lastWorld.x, lastWorld.y);
    (maskCtx as any).lineTo(x, y);
    (maskCtx as any).stroke();
  }
  lastWorld = { x, y };
}

function eraseBrush(x: number, y: number): void {
  if (!maskCtx) return;
  (maskCtx as any).globalCompositeOperation = "destination-out";
  (maskCtx as any).fillStyle = "rgba(0,0,0,1)";
  (maskCtx as any).beginPath();
  (maskCtx as any).arc(x, y, brushRadius, 0, Math.PI * 2);
  (maskCtx as any).fill();
  if (lastWorld) {
    (maskCtx as any).strokeStyle = "rgba(0,0,0,1)";
    (maskCtx as any).lineWidth = brushRadius * 2;
    (maskCtx as any).lineCap = "round";
    (maskCtx as any).beginPath();
    (maskCtx as any).moveTo(lastWorld.x, lastWorld.y);
    (maskCtx as any).lineTo(x, y);
    (maskCtx as any).stroke();
  }
  lastWorld = { x, y };
}

function fillLasso(): void {
  if (!maskCtx || lassoPath.length < 3) return;
  (maskCtx as any).globalCompositeOperation = "source-over";
  (maskCtx as any).fillStyle = "rgba(255,255,255,1)";
  (maskCtx as any).beginPath();
  (maskCtx as any).moveTo(lassoPath[0].x, lassoPath[0].y);
  for (let i = 1; i < lassoPath.length; i++) {
    (maskCtx as any).lineTo(lassoPath[i].x, lassoPath[i].y);
  }
  (maskCtx as any).closePath();
  (maskCtx as any).fill();
}

async function pickColorAt(x: number, y: number): Promise<void> {
  if (!mapImage) return;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= mapImage.width || iy >= mapImage.height) return;
  // Render the image to an offscreen buffer to read a pixel.
  const tmp = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(mapImage.width, mapImage.height)
    : Object.assign(document.createElement("canvas"), { width: mapImage.width, height: mapImage.height });
  const tctx = (tmp as any).getContext("2d");
  tctx.drawImage(mapImage as any, 0, 0);
  const px = tctx.getImageData(ix, iy, 1, 1).data;
  const hex = "#" + [px[0], px[1], px[2]].map((c) => c.toString(16).padStart(2, "0")).join("");
  pickedColorEl.value = hex;
  stInfo.textContent = `已取色 ${hex} @ (${ix}, ${iy})`;
}

// Color-detect: walk the source image bytes; for each pixel within
// `thresh` of the picked color (Euclidean distance in RGB), set the
// mask alpha to 255. Threshold uses uniform RGB distance so e.g.
// thresh=22 ≈ "within 22 RGB units" — surprisingly tight, hence the
// slider goes up to 80.
async function detectColor(): Promise<void> {
  if (!mapImage || !mask || !maskCtx) return;
  pushUndo();
  const W = mapImage.width;
  const H = mapImage.height;
  // Get image pixels.
  const tmp = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const tctx = (tmp as any).getContext("2d");
  tctx.drawImage(mapImage as any, 0, 0);
  const src = tctx.getImageData(0, 0, W, H);
  const dst = (maskCtx as any).getImageData(0, 0, W, H) as ImageData;
  // Parse picked color.
  const hex = pickedColorEl.value || "#000000";
  const r0 = parseInt(hex.slice(1, 3), 16);
  const g0 = parseInt(hex.slice(3, 5), 16);
  const b0 = parseInt(hex.slice(5, 7), 16);
  const t2 = thresh * thresh;
  const sd = src.data;
  const dd = dst.data;
  let painted = 0;
  for (let i = 0; i < sd.length; i += 4) {
    const dr = sd[i] - r0;
    const dg = sd[i + 1] - g0;
    const db = sd[i + 2] - b0;
    if (dr * dr + dg * dg + db * db <= t2) {
      dd[i] = 255;
      dd[i + 1] = 255;
      dd[i + 2] = 255;
      dd[i + 3] = 255;
      painted++;
    }
  }
  (maskCtx as any).putImageData(dst, 0, 0);
  paintCommit();
  stInfo.textContent = `已识别 ${painted} 像素为墙`;
}

function clearAll(): void {
  if (!mask || !maskCtx) return;
  pushUndo();
  (maskCtx as any).clearRect(0, 0, (mask as any).width, (mask as any).height);
  paintCommit();
}

// --- Pointer handling ---------------------------------------------------

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-tool]").forEach((b) => {
    b.classList.toggle("on", b.dataset.tool === t);
  });
  setStatus();
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  if (!mapImage || !maskCtx) return;
  const rect = canvas.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  const wp = viewToImage(vx, vy);
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = true;
    panStart = { x: vx, y: vy, panX: view.panX, panY: view.panY };
    canvas.classList.add("pan-active");
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  if (tool === "picker") {
    void pickColorAt(wp.x, wp.y);
    drawing = false;
    return;
  }
  pushUndo();
  if (tool === "lasso") {
    lassoPath = [wp];
    return;
  }
  lastWorld = null;
  if (tool === "brush") paintBrush(wp.x, wp.y);
  else if (tool === "eraser") eraseBrush(wp.x, wp.y);
});

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  const wp = viewToImage(vx, vy);
  stPos.textContent = `${Math.round(wp.x)}, ${Math.round(wp.y)}`;
  if (panning) {
    view.panX = panStart.panX + (vx - panStart.x);
    view.panY = panStart.panY + (vy - panStart.y);
    setStatus();
    scheduleRedraw();
    return;
  }
  if (!drawing) return;
  if (tool === "brush") {
    paintBrush(wp.x, wp.y);
    paintCommit();
  } else if (tool === "eraser") {
    eraseBrush(wp.x, wp.y);
    paintCommit();
  } else if (tool === "lasso") {
    lassoPath.push(wp);
    scheduleRedraw();
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (panning) {
    panning = false;
    canvas.classList.remove("pan-active");
    return;
  }
  if (!drawing) return;
  drawing = false;
  if (tool === "lasso") {
    fillLasso();
    lassoPath = [];
    paintCommit();
  } else {
    lastWorld = null;
  }
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  const wp = viewToImage(vx, vy);
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  view.zoom = Math.max(0.1, Math.min(8, view.zoom * factor));
  // Re-anchor pan so the world point under the cursor stays put.
  view.panX = vx - wp.x * view.zoom;
  view.panY = vy - wp.y * view.zoom;
  setStatus();
  scheduleRedraw();
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.key === " ") { spaceDown = true; canvas.classList.add("pan"); e.preventDefault(); return; }
  if (e.key === "1") setTool("brush");
  if (e.key === "2") setTool("eraser");
  if (e.key === "3") setTool("lasso");
  if (e.key === "4") setTool("picker");
  if ((e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.key === "z" || e.key === "Z") && e.shiftKey)  { e.preventDefault(); redo(); }
  if (e.key === "Escape") { void cancel(); }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") { spaceDown = false; canvas.classList.remove("pan"); }
});

// --- Boot ---------------------------------------------------------------

async function fetchImageBitmap(url: string): Promise<ImageBitmap> {
  // Try fetch + createImageBitmap. Fall back to <img> + drawImage if
  // CORS/whatever fails.
  try {
    const res = await fetch(url, { mode: "cors", cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await createImageBitmap(blob);
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

async function loadMap(): Promise<void> {
  if (!mapItemId) {
    mapMetaEl.textContent = "未传入 map id";
    return;
  }
  try {
    const items = await OBR.scene.items.getItems([mapItemId]);
    if (items.length === 0) {
      mapMetaEl.textContent = "map item 不存在";
      return;
    }
    const it = items[0] as any;
    if (!isImage(it as Item)) {
      mapMetaEl.textContent = "目标不是图片 item";
      return;
    }
    mapItem = it;
    mapMetaEl.textContent = `${it.name ?? "(no name)"} · ${it.image.width}×${it.image.height}`;
    mapImage = await fetchImageBitmap(it.image.url);
    // Init mask.
    const W = mapImage.width;
    const H = mapImage.height;
    mask = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement("canvas"), { width: W, height: H });
    maskCtx = (mask as any).getContext("2d");
    rebuildTintedMask();
    fitToView();
    // Pre-load existing collision walls? Skipped for simplicity —
    // a re-edit replaces the whole wall set on save.
  } catch (e) {
    console.error("[vision/collision-edit] load failed", e);
    mapMetaEl.textContent = `加载失败：${(e as Error).message}`;
  }
}

// --- Save: contour trace + simplify + spawn -----------------------------

// Moore neighborhood boundary tracing — produces a closed polygon
// (clockwise) for one connected component starting at a "1" pixel
// adjacent to a "0" pixel. We sample mask alpha > 127 as "wall".
//
// For a multi-component mask we trace each component once. To avoid
// re-tracing a component we maintain a "visited boundary pixels"
// set keyed on `y * W + x`.

function traceContours(maskData: ImageData): { x: number; y: number }[][] {
  const W = maskData.width;
  const H = maskData.height;
  const data = maskData.data;
  const isWall = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    return data[(y * W + x) * 4 + 3] > 127;
  };
  const visited = new Uint8Array(W * H);
  // Moore-neighbor offsets clockwise starting from west (-1, 0):
  // 0=W, 1=NW, 2=N, 3=NE, 4=E, 5=SE, 6=S, 7=SW
  const NX = [-1, -1, 0, 1, 1, 1, 0, -1];
  const NY = [0, -1, -1, -1, 0, 1, 1, 1];
  const contours: { x: number; y: number }[][] = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (visited[y * W + x]) continue;
      if (!isWall(x, y)) continue;
      // Found a starting boundary pixel only if (x-1, y) is not a wall.
      if (isWall(x - 1, y)) continue;
      // Trace.
      const contour: { x: number; y: number }[] = [];
      let cx = x, cy = y;
      const startX = x, startY = y;
      let dir = 4; // came from west (so we're traveling east-ish)
      let safety = 0;
      const maxSafe = W * H;
      do {
        if (visited[cy * W + cx]) break;
        visited[cy * W + cx] = 1;
        contour.push({ x: cx, y: cy });
        // Search neighbors clockwise starting from "left of incoming"
        const startSearch = (dir + 6) % 8;
        let found = false;
        for (let s = 0; s < 8; s++) {
          const d = (startSearch + s) % 8;
          const nx = cx + NX[d];
          const ny = cy + NY[d];
          if (isWall(nx, ny)) {
            cx = nx; cy = ny; dir = d;
            found = true;
            break;
          }
        }
        if (!found) break; // isolated pixel
        if (++safety > maxSafe) break;
      } while (!(cx === startX && cy === startY));
      if (contour.length >= 3) contours.push(contour);
    }
  }
  return contours;
}

// Douglas-Peucker simplification.
function simplifyDP(pts: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (pts.length <= 2 || tol <= 0) return pts;
  const out: { x: number; y: number }[] = [];
  const recur = (lo: number, hi: number) => {
    let maxD = 0;
    let idx = -1;
    const a = pts[lo];
    const b = pts[hi];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denom = Math.hypot(dx, dy) || 1e-9;
    for (let i = lo + 1; i < hi; i++) {
      const p = pts[i];
      const d = Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / denom;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      recur(lo, idx);
      recur(idx, hi);
    } else {
      out.push(a);
    }
  };
  recur(0, pts.length - 1);
  out.push(pts[pts.length - 1]);
  return out;
}

// Convert an image-pixel polygon to world coordinates using the
// map's transform.
function imagePxToWorld(
  pts: { x: number; y: number }[],
  m: any,
  sceneDpi: number,
): { x: number; y: number }[] {
  const ratio = sceneDpi / (m.grid?.dpi || sceneDpi);
  const offX = m.grid?.offset?.x ?? 0;
  const offY = m.grid?.offset?.y ?? 0;
  const sx = m.scale?.x ?? 1;
  const sy = m.scale?.y ?? 1;
  const r = ((m.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const px = m.position.x;
  const py = m.position.y;
  return pts.map((p) => {
    const lx = (p.x - offX) * ratio * sx;
    const ly = (p.y - offY) * ratio * sy;
    return {
      x: px + lx * cos - ly * sin,
      y: py + lx * sin + ly * cos,
    };
  });
}

async function save(): Promise<void> {
  if (!mapItem || !maskCtx || !mask) return;
  const W = (mask as any).width;
  const H = (mask as any).height;
  stInfo.textContent = "提取轮廓中…";
  const data = (maskCtx as any).getImageData(0, 0, W, H) as ImageData;
  const contours = traceContours(data);
  const simplified = contours.map((c) => simplifyDP(c, simplifyTol));
  // Drop tiny contours (< 4 points after simplification) — those are
  // pixel noise from color-detect.
  const usable = simplified.filter((c) => c.length >= 4);

  if (usable.length === 0) {
    stInfo.textContent = "没有可保存的轮廓 — 先涂点墙再保存";
    return;
  }

  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

  // Remove ANY pre-existing collision walls attached to this map.
  try {
    const existing = await OBR.scene.items.getItems((it: any) => {
      return it.attachedTo === mapItemId
        && !!(it.metadata as any)?.[COLLISION_WALL_KEY];
    });
    if (existing.length > 0) {
      await OBR.scene.items.deleteItems(existing.map((i) => i.id));
    }
  } catch {}

  // Build new walls.
  const walls: any[] = [];
  for (const c of usable) {
    const worldPts = imagePxToWorld(c, mapItem, sceneDpi);
    if (worldPts.length < 3) continue;
    // Wall stored at world position 0,0 with absolute world coords as
    // points (so attached parent moves with translation; scale/rotate
    // also propagate via attachment).
    const item = buildCurve()
      .points(worldPts)
      .strokeColor("#ff8a3d")
      .strokeOpacity(0.85)
      .strokeWidth(3)
      .fillColor("#ff8a3d")
      .fillOpacity(0)
      .closed(true)
      .layer("FOG")
      .position({ x: 0, y: 0 })
      .scale({ x: 1, y: 1 })
      .rotation(0)
      .visible(true)
      .locked(true)
      .disableHit(true)
      .attachedTo(mapItemId)
      .metadata({
        [COLLISION_WALL_KEY]: true,
        [COLLISION_MAP_KEY]: { mapId: mapItemId, savedAt: Date.now() },
      })
      .build();
    walls.push(item);
  }

  if (walls.length === 0) {
    stInfo.textContent = "没有可保存的有效墙体";
    return;
  }
  try {
    await OBR.scene.items.addItems(walls);
    stInfo.textContent = `✅ 保存了 ${walls.length} 段墙体（${usable.reduce((s, c) => s + c.length, 0)} 个顶点）`;
    // Auto-close after a short delay.
    setTimeout(() => { void OBR.modal.close(MODAL_ID).catch(() => {}); }, 800);
  } catch (e) {
    console.error("[vision/collision-edit] save failed", e);
    stInfo.textContent = `❌ 保存失败：${(e as Error).message}`;
  }
}

async function cancel(): Promise<void> {
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

// --- Wire up ------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-tool]").forEach((b) => {
  b.addEventListener("click", () => setTool(b.dataset.tool as Tool));
});
rBrush.addEventListener("input", () => {
  brushRadius = Number(rBrush.value);
  rBrushVal.textContent = String(brushRadius);
});
rThresh.addEventListener("input", () => {
  thresh = Number(rThresh.value);
  rThreshVal.textContent = String(thresh);
});
rSimplify.addEventListener("input", () => {
  simplifyTol = Number(rSimplify.value);
  rSimplifyVal.textContent = String(simplifyTol);
});
document.getElementById("btn-detect-color")?.addEventListener("click", () => { void detectColor(); });
document.getElementById("btn-clear")?.addEventListener("click", () => { clearAll(); });
document.getElementById("btn-save")?.addEventListener("click", () => { void save(); });
document.getElementById("btn-cancel")?.addEventListener("click", () => { void cancel(); });

OBR.onReady(async () => {
  resizeCanvas();
  await loadMap();
  setTool("brush");
});
window.addEventListener("resize", () => resizeCanvas());
