// Circle-image popover page — two modes:
//
//   1. CIRCLE CROP   — pan the source image inside a fixed circular
//                       viewport, optional coloured rim ring. Output
//                       is a square PNG with transparent corners
//                       outside the circle.
//   2. BG REMOVE     — keep source dimensions; zero the alpha of
//                       pixels close to pure white (or pure black)
//                       with a configurable tolerance + edge feather.
//
// Output flow (changed 2026-05-08):
//   The original "drag from popover ghost to canvas" UX assumed
//   OBR.scene.items.addItems would accept an `image.url` set to a
//   `data:image/png;base64,...` data URL. It does NOT — addItems
//   silently rejects data URLs. Confirmed empirically by dropping
//   instrumented log output ("addItems failed") in the user's
//   DevTools console.
//
//   The replacement is to upload the baked PNG via
//   `OBR.assets.uploadImages` — the only supported path for getting
//   a local image into an OBR scene. The user clicks "添加到资源库"
//   and the image lands in their OBR asset library; from there they
//   drag to the scene with OBR's native drag-from-library gesture
//   (same flow as importing any other image to OBR). We lose the
//   pixel-perfect drop position, but the alternative would require
//   either OBR adding data-URL support or us hosting an upload
//   server.

import OBR from "@owlbear-rodeo/sdk";
import { PLUGIN_ID, POPOVER_ID } from "./types";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $b = (id: string) => document.getElementById(id) as HTMLButtonElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;

const dropZone = $("drop-zone");
const fileInput = $i("file-input");
const editor = $("editor");
const canvasWrap = $("canvas-wrap");
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: true })!;
// Tab + control-panel groupings.
const tabs = document.querySelectorAll<HTMLButtonElement>(".tab-strip .tab");
const ctrlsCircle = $("ctrls-circle");
const ctrlsBgRemove = $("ctrls-bgremove");
// Circle-crop controls.
const sizeSlider = $i("size-slider");
const sizeVal = $("size-val");
const zoomSlider = $i("zoom-slider");
const zoomVal = $("zoom-val");
const ringColor = $i("ring-color");
const ringWidth = $i("ring-width");
const ringVal = $("ring-val");
// BG-remove controls.
const bgToggleBtns = document.querySelectorAll<HTMLButtonElement>(".bg-toggle");
const bgTolerance = $i("bg-tolerance");
const bgToleranceVal = $("bg-tolerance-val");
const bgFeather = $i("bg-feather");
const bgFeatherVal = $("bg-feather-val");
// Action buttons.
const btnClose = $b("btnClose");
const btnReset = $b("btnReset");
const btnDrag = $b("btnDrag");

// --- Mode ------------------------------------------------------------------

type Mode = "circle" | "bgremove";
let mode: Mode = "circle";

function switchMode(next: Mode): void {
  mode = next;
  tabs.forEach((t) => t.classList.toggle("on", t.dataset.mode === mode));
  ctrlsCircle.hidden = mode !== "circle";
  ctrlsBgRemove.hidden = mode !== "bgremove";
  canvasWrap.classList.toggle("show-checker", mode === "bgremove");
  if (srcImg) {
    requestAnimationFrame(() => {
      resizeCanvas();
      fitToView();
      draw();
    });
  }
}
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const m = tab.dataset.mode as Mode | undefined;
    if (m && m !== mode) switchMode(m);
  });
});

// --- Source image state ----------------------------------------------------

let srcImg: HTMLImageElement | null = null;
let srcW = 0;
let srcH = 0;

let panX = 0;
let panY = 0;
let zoom = 1.0;

let outputDiameter = 300;
let ringPx = 0;
let ringHex = "#f5a623";

let bgKind: "white" | "black" = "white";
let bgTol = 40;
let bgFeatherPx = 8;

let bgPreviewCanvas: HTMLCanvasElement | null = null;
let bgPreviewW = 0;
let bgPreviewH = 0;

// --- Canvas sizing ---------------------------------------------------------

function resizeCanvas(): void {
  const rect = canvasWrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
new ResizeObserver(() => resizeCanvas()).observe(canvasWrap);

// --- Image load ------------------------------------------------------------

function loadFromFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    alert("请选择图片文件（JPG / PNG / WebP / SVG）");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert("图片大于 10 MB，太大了。先压缩一下吧。");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const url = e.target?.result;
    if (typeof url !== "string") return;
    const img = new Image();
    img.onload = () => {
      srcImg = img;
      srcW = img.naturalWidth;
      srcH = img.naturalHeight;
      buildBgPreviewCache();
      dropZone.style.display = "none";
      editor.classList.add("active");
      requestAnimationFrame(() => {
        resizeCanvas();
        fitToView();
        draw();
      });
    };
    img.onerror = () => alert("图片加载失败");
    img.src = url;
  };
  reader.onerror = () => alert("读取失败");
  reader.readAsDataURL(file);
}

function buildBgPreviewCache(): void {
  if (!srcImg) return;
  const MAX = 600;
  const longer = Math.max(srcW, srcH);
  const scale = longer > MAX ? MAX / longer : 1;
  bgPreviewW = Math.max(1, Math.round(srcW * scale));
  bgPreviewH = Math.max(1, Math.round(srcH * scale));
  bgPreviewCanvas = document.createElement("canvas");
  bgPreviewCanvas.width = bgPreviewW;
  bgPreviewCanvas.height = bgPreviewH;
  const c = bgPreviewCanvas.getContext("2d", { willReadFrequently: true })!;
  c.clearRect(0, 0, bgPreviewW, bgPreviewH);
  c.drawImage(srcImg, 0, 0, bgPreviewW, bgPreviewH);
}

function fitToView(): void {
  if (!srcImg) return;
  const rect = canvasWrap.getBoundingClientRect();
  if (mode === "circle") {
    const visibleDiameter = Math.min(rect.width, rect.height) - 20;
    const baseFit = Math.min(srcW, srcH);
    zoom = visibleDiameter / baseFit;
    panX = (rect.width - srcW * zoom) / 2;
    panY = (rect.height - srcH * zoom) / 2;
    zoomSlider.value = String(Math.round(zoom * 100));
    zoomVal.textContent = `${Math.round(zoom * 100)}%`;
  } else {
    const longer = Math.max(srcW, srcH);
    zoom = (Math.min(rect.width, rect.height) - 20) / longer;
    panX = (rect.width - srcW * zoom) / 2;
    panY = (rect.height - srcH * zoom) / 2;
  }
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFromFile(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadFromFile(file);
  fileInput.value = "";
});
window.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const it of items) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) loadFromFile(f);
      e.preventDefault();
      return;
    }
  }
});

// --- Drawing ---------------------------------------------------------------

function draw(): void {
  if (mode === "circle") drawCircle();
  else drawBgRemove();
}

function drawCircle(): void {
  const rect = canvasWrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  if (!srcImg) return;

  const visibleDiameter = Math.min(w, h) - 20;
  const cx = w / 2;
  const cy = h / 2;
  const r = visibleDiameter / 2;

  ctx.globalAlpha = 0.25;
  ctx.drawImage(srcImg, panX, panY, srcW * zoom, srcH * zoom);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(srcImg, panX, panY, srcW * zoom, srcH * zoom);
  ctx.restore();

  if (ringPx > 0) {
    const ringScale = visibleDiameter / outputDiameter;
    ctx.beginPath();
    ctx.arc(cx, cy, r - (ringPx * ringScale) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = ringHex;
    ctx.lineWidth = ringPx * ringScale;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBgRemove(): void {
  const rect = canvasWrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  if (!srcImg || !bgPreviewCanvas) return;

  const tmp = document.createElement("canvas");
  tmp.width = bgPreviewW;
  tmp.height = bgPreviewH;
  const tctx = tmp.getContext("2d")!;
  tctx.drawImage(bgPreviewCanvas, 0, 0);
  applyBgRemoveToCanvas(tctx, bgPreviewW, bgPreviewH);

  const dx = panX;
  const dy = panY;
  const dw = srcW * zoom;
  const dh = srcH * zoom;
  ctx.drawImage(tmp, dx, dy, dw, dh);

  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function applyBgRemoveToCanvas(c: CanvasRenderingContext2D, w: number, h: number): void {
  const id = c.getImageData(0, 0, w, h);
  const data = id.data;
  const tol = bgTol;
  const feather = Math.max(0, bgFeatherPx);
  const isWhite = bgKind === "white";
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const d = isWhite
      ? Math.max(255 - r, 255 - g, 255 - b)
      : Math.max(r, g, b);
    let factor: number;
    if (d <= tol) factor = 0;
    else if (feather > 0 && d <= tol + feather) factor = (d - tol) / feather;
    else factor = 1;
    if (factor < 1) data[i + 3] = Math.round(data[i + 3] * factor);
  }
  c.putImageData(id, 0, 0);
}

// --- Pan with pointer (circle mode only) -----------------------------------

let dragging = false;
let dragStartX = 0, dragStartY = 0;
let dragStartPanX = 0, dragStartPanY = 0;

canvas.addEventListener("pointerdown", (e) => {
  if (!srcImg) return;
  if (mode !== "circle") return;
  dragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartPanX = panX;
  dragStartPanY = panY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  panX = dragStartPanX + (e.clientX - dragStartX);
  panY = dragStartPanY + (e.clientY - dragStartY);
  draw();
});
canvas.addEventListener("pointerup", (e) => {
  dragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
});
canvas.addEventListener("pointercancel", () => { dragging = false; });

canvas.addEventListener("wheel", (e) => {
  if (!srcImg) return;
  if (mode !== "circle") return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
  const newZoom = Math.max(0.05, Math.min(8, zoom * factor));
  panX = cx - (cx - panX) * (newZoom / zoom);
  panY = cy - (cy - panY) * (newZoom / zoom);
  zoom = newZoom;
  zoomSlider.value = String(Math.round(zoom * 100));
  zoomVal.textContent = `${Math.round(zoom * 100)}%`;
  draw();
}, { passive: false });

// --- Slider wiring (circle) ------------------------------------------------

sizeSlider.addEventListener("input", () => {
  outputDiameter = Number(sizeSlider.value) || 300;
  sizeVal.textContent = String(outputDiameter);
  draw();
});

zoomSlider.addEventListener("input", () => {
  if (!srcImg) return;
  const rect = canvasWrap.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const newZoom = (Number(zoomSlider.value) || 100) / 100;
  panX = cx - (cx - panX) * (newZoom / zoom);
  panY = cy - (cy - panY) * (newZoom / zoom);
  zoom = newZoom;
  zoomVal.textContent = `${Math.round(zoom * 100)}%`;
  draw();
});

ringColor.addEventListener("input", () => { ringHex = ringColor.value; draw(); });
ringWidth.addEventListener("input", () => {
  ringPx = Number(ringWidth.value) || 0;
  ringVal.textContent = String(ringPx);
  draw();
});

// --- Slider wiring (bg-remove) --------------------------------------------

bgToggleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const k = btn.dataset.kind;
    if (k !== "white" && k !== "black") return;
    bgKind = k;
    bgToggleBtns.forEach((b) => b.classList.toggle("on", b.dataset.kind === k));
    draw();
  });
});

bgTolerance.addEventListener("input", () => {
  bgTol = Number(bgTolerance.value) || 0;
  bgToleranceVal.textContent = String(bgTol);
  draw();
});

bgFeather.addEventListener("input", () => {
  bgFeatherPx = Number(bgFeather.value) || 0;
  bgFeatherVal.textContent = String(bgFeatherPx);
  draw();
});

// --- Output bake -----------------------------------------------------------
//
// Both modes return { blob, width, height }. Blob (vs data URL) is
// what OBR.assets.uploadImages takes; we don't need a data URL
// anymore because we no longer try to embed the image in
// `image.url` directly.

interface Baked {
  blob: Blob;
  width: number;
  height: number;
}

function canvasToBlob(c: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, type);
  });
}

async function renderCircleOutput(): Promise<Baked | null> {
  if (!srcImg) return null;
  const D = outputDiameter;
  const out = document.createElement("canvas");
  out.width = D;
  out.height = D;
  const octx = out.getContext("2d", { alpha: true })!;
  octx.clearRect(0, 0, D, D);
  const rect = canvasWrap.getBoundingClientRect();
  const visibleDiameter = Math.min(rect.width, rect.height) - 20;
  const cropperCx = rect.width / 2;
  const cropperCy = rect.height / 2;
  const scale = D / visibleDiameter;
  const outPanX = (panX - cropperCx) * scale + D / 2;
  const outPanY = (panY - cropperCy) * scale + D / 2;
  const outZoom = zoom * scale;

  octx.save();
  octx.beginPath();
  octx.arc(D / 2, D / 2, D / 2, 0, Math.PI * 2);
  octx.clip();
  octx.drawImage(srcImg, outPanX, outPanY, srcW * outZoom, srcH * outZoom);
  octx.restore();

  if (ringPx > 0) {
    octx.beginPath();
    octx.arc(D / 2, D / 2, D / 2 - ringPx / 2, 0, Math.PI * 2);
    octx.strokeStyle = ringHex;
    octx.lineWidth = ringPx;
    octx.stroke();
  }

  const blob = await canvasToBlob(out);
  return { blob, width: D, height: D };
}

async function renderBgRemoveOutput(): Promise<Baked | null> {
  if (!srcImg) return null;
  const MAX = 1024;
  const longer = Math.max(srcW, srcH);
  const scale = longer > MAX ? MAX / longer : 1;
  const W = Math.max(1, Math.round(srcW * scale));
  const H = Math.max(1, Math.round(srcH * scale));

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d", { alpha: true, willReadFrequently: true })!;
  octx.clearRect(0, 0, W, H);
  octx.drawImage(srcImg, 0, 0, W, H);
  applyBgRemoveToCanvas(octx, W, H);

  const blob = await canvasToBlob(out);
  return { blob, width: W, height: H };
}

async function bakeOutput(): Promise<Baked | null> {
  return mode === "circle" ? renderCircleOutput() : renderBgRemoveOutput();
}

// --- Reset / close ---------------------------------------------------------

function resetEditor(): void {
  srcImg = null;
  srcW = srcH = 0;
  panX = panY = 0;
  zoom = 1;
  bgPreviewCanvas = null;
  bgPreviewW = bgPreviewH = 0;
  editor.classList.remove("active");
  dropZone.style.display = "";
  draw();
}

btnReset.addEventListener("click", () => resetEditor());
btnClose.addEventListener("click", () => { void OBR.popover.close(POPOVER_ID); });

// --- Upload to OBR asset library ------------------------------------------
//
// Behavioural note: we don't know in advance whether OBR shows an
// import-confirm dialog when uploadImages is called. Some OBR builds
// upload silently; others pop a metadata-confirmation modal. Either
// way the asset ends up in the user's library and they can drag it
// to a scene with OBR's native library-drag gesture (same as
// dragging any other library asset).

let obrReady = false;
OBR.onReady(() => { obrReady = true; resizeCanvas(); });

async function uploadToLibrary(): Promise<void> {
  if (!srcImg) return;
  if (!obrReady) {
    alert("OBR 还在初始化，稍后再试");
    return;
  }
  setBtnState("uploading");
  let baked: Baked | null = null;
  try {
    baked = await bakeOutput();
  } catch (err) {
    console.error("[circleImage/popover] bake failed", err);
    setBtnState("idle");
    alert("生成图片失败：" + (err as Error).message);
    return;
  }
  if (!baked) {
    setBtnState("idle");
    return;
  }
  const longer = Math.max(baked.width, baked.height);
  const half = { x: baked.width / 2, y: baked.height / 2 };
  const stamp = Date.now();
  const name = mode === "circle"
    ? `圆形图片-${stamp}`
    : `去底图片-${stamp}`;
  console.log("[circleImage/popover] uploading", {
    mode,
    width: baked.width,
    height: baked.height,
    blobSizeBytes: baked.blob.size,
    name,
  });
  // Build the ImageUpload object once so we can also DUMP it to the
  // console — without the file itself, since logging a Blob is
  // unhelpful. Lets future me confirm OBR's required-field-list
  // hasn't drifted (the API isn't versioned and the validator's
  // error messages aren't always specific).
  const upload = {
    file: baked.blob,
    name,
    // OBR's SDK validator requires the FULL TextStyle shape (12
    // fields). An empty `{}` here previously rejected with
    // `"images[0].text.style.fillColor" is required`. These defaults
    // mirror the values the OBR text-tool writes for an empty label;
    // since plainText/richText are empty + textItemType "LABEL"
    // nothing actually renders.
    text: {
      plainText: "",
      richText: [],
      style: {
        fillColor: "#ffffff",
        fillOpacity: 1,
        strokeColor: "#000000",
        strokeOpacity: 1,
        strokeWidth: 0,
        textAlign: "CENTER" as const,
        textAlignVertical: "MIDDLE" as const,
        fontFamily: "Roboto, sans-serif",
        fontSize: 14,
        fontWeight: 400,
        lineHeight: 1.2,
        padding: 0,
      },
      type: "PLAIN" as const,
      width: "AUTO" as const,
      height: "AUTO" as const,
    },
    textItemType: "LABEL" as const,
    // Image grid: scale=1 → 1 grid cell wide. dpi = the longer
    // side, offset = image centre — matches the convention used
    // by portal / trickster spawning so the asset behaves like
    // a token when the user drags it from the library.
    grid: { dpi: longer, offset: half },
    visible: true,
    locked: false,
    rotation: 0,
    scale: { x: 1, y: 1 },
  };
  // Log everything except the binary blob so OBR validation
  // mismatches are debuggable from the user's DevTools.
  console.log("[circleImage/popover] uploadImages payload (sans blob)", {
    ...upload,
    file: `<Blob ${baked.blob.size} bytes>`,
  });
  try {
    await OBR.assets.uploadImages([upload], "PROP");
    console.log("[circleImage/popover] uploadImages OK");
    setBtnState("ok");
    setTimeout(() => setBtnState("idle"), 2400);
  } catch (err) {
    // Keep the full error object visible in DevTools so we can see
    // OBR's actual rejection reason (often nested inside `err.data`
    // or `err.cause`). The plain `.message` field is sometimes
    // undefined — falling back to JSON keeps the alert informative.
    console.error("[circleImage/popover] uploadImages failed", err);
    let detail: string;
    try {
      const e = err as any;
      detail = e?.message
        || e?.error?.message
        || e?.data?.message
        || JSON.stringify(err)
        || String(err);
    } catch {
      detail = String(err);
    }
    setBtnState("idle");
    alert("上传到资源库失败：" + detail);
  }
}

function setBtnState(state: "idle" | "uploading" | "ok"): void {
  switch (state) {
    case "idle":
      btnDrag.disabled = false;
      btnDrag.textContent = "⤴ 添加到资源库";
      btnDrag.classList.remove("uploading", "ok");
      break;
    case "uploading":
      btnDrag.disabled = true;
      btnDrag.textContent = "上传中…";
      btnDrag.classList.add("uploading");
      btnDrag.classList.remove("ok");
      break;
    case "ok":
      btnDrag.disabled = false;
      btnDrag.textContent = "✓ 已上传，从资源库拖入场景";
      btnDrag.classList.remove("uploading");
      btnDrag.classList.add("ok");
      break;
  }
}

btnDrag.addEventListener("click", () => { void uploadToLibrary(); });

void PLUGIN_ID;
