// Buff Studio — multi-layer buff-effect compositor.
//
// A composition is a stack of layers (emoji / static image / decoded
// GIF·video / hand-drawn). Each layer has its own position, scale,
// rotation, opacity, blend mode and a looping animation (50 types,
// param-driven, see anims.js). The stage plays the loop live; drag to
// move, the top handle rotates, the bottom-right handle scales.
// "Generate" bakes every frame and hands the RGBA buffers to
// ffmpeg.wasm → a WebM with real alpha.

import { EMOJI_CATALOG, loadEmoji, loadImage, searchEmoji } from "./emoji.js";
import { decodeSource } from "./decode.js";
import { encodeWebm, prewarmEncoder } from "./encoder.js";
import { ANIMS, ANIM_ORDER, defaultParams } from "./anims.js";
import { initDraw } from "../draw-kit/draw.js";

// ============ State ============
const state = {
  layers: [],          // bottom → top draw order
  selectedId: null,
  width: 256,
  height: 256,
  duration: 1.5,
  fps: 30,
  loop: true,
  // Preview-only backdrop (transparent / checker / dark / light /
  // black / white). Painted as a pre-pass in the LIVE tick so blend
  // modes (screen / multiply / lighter) have something to blend
  // against on screen. The bake loop in `generateBtn` always passes
  // `transparent` here so the exported WebM keeps a clean alpha.
  previewBg: "transparent",
};
let _layerId = 0;
let _curU = 0;           // current preview loop position
let _raf = 0;
let _t0 = 0;
let _drag = null;        // stage move-drag: { id, grabX, grabY }
let _handle = null;      // handle drag: { type:"rot"|"scale", cx, cy, ... }
let selBox = null;       // the .sel-box overlay element
let paintBoard = null;   // shared draw-kit instance

// ============ Element refs ============
const $ = (s) => document.querySelector(s);
const layerList     = $("#layerList");
const sourceModeSeg = $("#sourceModeSeg");
const emojiGrid     = $("#emojiGrid");
const emojiSearch   = $("#emojiSearch");
const imageDrop     = $("#imageDrop");
const imageFile     = $("#imageFile");
const animDrop      = $("#animDrop");
const animFile      = $("#animFile");
const convertBtn    = $("#convertBtn");
const savedGallery  = $("#savedGallery");
const stageBg       = $("#stageBg");
const stageCanvas   = $("#stageCanvas");
const stageCtx      = stageCanvas.getContext("2d");
const stageOverlay  = $("#stageOverlay");
const fakeToken     = $("#fakeToken");
const showToken     = $("#showToken");
const loopPlay      = $("#loopPlay");
const stageMeta     = $("#stageMeta");
const layerProps    = $("#layerProps");
const canvasW       = $("#canvasW");
const canvasH       = $("#canvasH");
const canvasDur     = $("#canvasDur");
const canvasFps     = $("#canvasFps");
const generateBtn   = $("#generateBtn");
const generateStatus= $("#generateStatus");
const progressFill  = $("#progressFill");
const progressText  = $("#progressText");
const resultBox     = $("#resultBox");
const resultVideo   = $("#resultVideo");
const resultInfo    = $("#resultInfo");
const resultDownload= $("#resultDownload");

const BLEND_OPTS = [
  ["source-over", "正常"], ["screen", "滤色"],
  ["lighter", "相加发光"], ["multiply", "正片叠底"],
];
const LS_DRAWINGS = "buff-studio:drawings";

// ============ Small helpers ============
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
}
function clampFloat(v, lo, hi, dflt) {
  const n = parseFloat(v);
  return Number.isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
}
function makeEven(n) { return n % 2 ? n - 1 : n; }
function selectedLayer() { return state.layers.find((l) => l.id === state.selectedId) || null; }
function layerById(id) { return state.layers.find((l) => l.id === id) || null; }
function fmtParamVal(pr, v) {
  return pr.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2);
}

let _toastTimer = 0;
function toast(msg, kind = "") {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = "toast show " + kind;
  clearTimeout(_toastTimer);
  _toastTimer = window.setTimeout(() => { el.className = "toast " + kind; }, 2600);
}

// ============ Layer model ============
function buildCum(durs) {
  const c = []; let s = 0;
  for (const d of durs) { s += d; c.push(s); }
  return c;
}
// fitScale: pixel multiplier so the source's longest edge ≈ 60% of the
// shorter canvas edge. `scale` is just a srcPx → canvasPx multiplier.
function fitScale(w, h) {
  const longest = Math.max(w, h) || 1;
  return (Math.min(state.width, state.height) * 0.6) / longest;
}
function makeLayer(kind, source, name) {
  const isAnim = kind === "anim";
  return {
    id: ++_layerId,
    name: name || (isAnim ? "动图" : "图层"),
    kind,
    img: isAnim ? null : source.img,
    frames: isAnim ? source.frames : null,
    durations: isAnim ? source.durations : null,
    cumDur: isAnim ? buildCum(source.durations) : null,
    totalDur: isAnim ? (source.durations.reduce((a, b) => a + b, 0) || 0.001) : 0,
    srcW: source.width || 1,
    srcH: source.height || 1,
    x: 0.5, y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
    blend: "source-over",
    visible: true,
    anim: "none",
    animParams: defaultParams("none"),
    animSpeed: 1,
    _thumb: null,
  };
}
function addImageLayer(img, name) {
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const layer = makeLayer("image", { img, width: w, height: h }, name);
  layer.scale = fitScale(w, h);
  state.layers.push(layer);
  selectLayer(layer.id);
  return layer;
}
function addAnimLayer(decoded, name) {
  const layer = makeLayer("anim", decoded, name);
  layer.scale = fitScale(decoded.width, decoded.height);
  state.layers.push(layer);
  selectLayer(layer.id);
  return layer;
}
function selectLayer(id) {
  state.selectedId = id;
  renderLayerList();
  renderLayerProps();
}

// ============ Animation + drawing ============
function animInstances(layer, u) {
  const def = ANIMS[layer.anim] || ANIMS.none;
  try {
    return def.instances(layer.animParams || {}, u) || [];
  } catch {
    return [{ dx: 0, dy: 0, dscale: 1, drot: 0, dalpha: 1 }];
  }
}
// Which source frame to draw for an anim layer at composition time u.
function layerFrameAt(layer, u) {
  if (layer.kind === "image") return layer.img;
  const frames = layer.frames;
  if (!frames || !frames.length) return null;
  if (frames.length === 1) return frames[0];
  const total = layer.totalDur;
  let srcT = (u * state.duration * layer.animSpeed) % total;
  if (srcT < 0) srcT += total;
  const cum = layer.cumDur;
  for (let i = 0; i < cum.length; i++) {
    if (srcT < cum[i]) return frames[i];
  }
  return frames[frames.length - 1];
}
function drawLayer(ctx, layer, u, W, H) {
  if (!layer.visible) return;
  const frame = layerFrameAt(layer, u);
  if (!frame) return;
  const instances = animInstances(layer, u);
  // layer.scale + layer.rotation are a GROUP transform — they scale and
  // rotate the WHOLE animation (every instance's offset, size and angle)
  // around the layer centre, not each sprite in place. The per-instance
  // dx/dy/dscale/drot the anim emits then apply inside that frame. At the
  // default scale=1, rotation=0 this is identical to the old per-sprite
  // path (cos=1, sin=0) — it only diverges once the user transforms.
  const baseCx = layer.x * W;
  const baseCy = layer.y * H;
  const grpRot = layer.rotation * Math.PI / 180;
  const cosR = Math.cos(grpRot), sinR = Math.sin(grpRot);
  for (const a of instances) {
    const sc = layer.scale * a.dscale;
    const dw = layer.srcW * sc;
    const dh = layer.srcH * sc;
    const alpha = clamp(layer.opacity * a.dalpha, 0, 1);
    if (alpha <= 0.003 || dw <= 0.5 || dh <= 0.5) continue;
    // instance offset, scaled by the group scale then rotated by the
    // group rotation → the formation spreads + turns as one unit.
    const ox = a.dx * W * layer.scale;
    const oy = a.dy * H * layer.scale;
    const cx = baseCx + ox * cosR - oy * sinR;
    const cy = baseCy + ox * sinR + oy * cosR;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = layer.blend;
    ctx.translate(cx, cy);
    const rot = grpRot + a.drot * Math.PI / 180;
    if (rot) ctx.rotate(rot);
    ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
}
function paintPreviewBg(ctx, kind, W, H) {
  if (!kind || kind === "transparent") return;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  if (kind === "checker") {
    // Drawn AT the canvas resolution so blend math (screen/multiply
    // against this) sees the actual pattern. Two-tone gray, 16px tiles.
    const tile = 16;
    ctx.fillStyle = "#3a3f4d";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#262a36";
    for (let y = 0; y < H; y += tile) {
      for (let x = 0; x < W; x += tile) {
        if (((x / tile) ^ (y / tile)) & 1) ctx.fillRect(x, y, tile, tile);
      }
    }
  } else {
    ctx.fillStyle = kind === "dark"  ? "#2c3040"
                  : kind === "light" ? "#a8adbb"
                  : kind === "black" ? "#000000"
                  : kind === "white" ? "#ffffff"
                  : "transparent";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}
function drawComposition(ctx, u, W, H, opts) {
  ctx.clearRect(0, 0, W, H);
  // Preview-only backdrop. opts is omitted by the bake loop, so the
  // exported WebM stays cleanly transparent.
  if (opts && opts.previewBg) paintPreviewBg(ctx, opts.previewBg, W, H);
  for (const layer of state.layers) drawLayer(ctx, layer, u, W, H);
}

// ============ Stage loop ============
function startLoop() {
  cancelAnimationFrame(_raf);
  _t0 = performance.now() - _curU * state.duration * 1000;
  const tick = (now) => {
    if (state.loop) {
      _curU = (((now - _t0) / 1000) % state.duration) / state.duration;
    }
    // Live tick passes the preview backdrop. Bake loop omits opts so
    // the exported WebM keeps a fully transparent background.
    drawComposition(stageCtx, _curU, state.width, state.height, { previewBg: state.previewBg });
    positionSelBox();
    _raf = requestAnimationFrame(tick);
  };
  _raf = requestAnimationFrame(tick);
}
function stopLoop() {
  cancelAnimationFrame(_raf);
  _raf = 0;
}
function redrawOnce() {
  drawComposition(stageCtx, _curU, state.width, state.height, { previewBg: state.previewBg });
  positionSelBox();
}
// The selection box tracks the layer's BASE transform (no animation) so
// it stays a stable, predictable drag target even for particle anims.
function positionSelBox() {
  const layer = selectedLayer();
  if (!layer || !layer.visible) { selBox.style.display = "none"; return; }
  const dw = layer.srcW * layer.scale;
  const dh = layer.srcH * layer.scale;
  selBox.style.display = "block";
  selBox.style.left = (layer.x * 100) + "%";
  selBox.style.top = (layer.y * 100) + "%";
  selBox.style.width = (dw / state.width * 100) + "%";
  selBox.style.height = (dh / state.height * 100) + "%";
  selBox.style.transform = `translate(-50%, -50%) rotate(${layer.rotation}deg)`;
}

// ============ Stage drag-to-move ============
function hitTest(layer, px, py) {
  if (!layer.visible) return false;
  const halfW = (layer.srcW * layer.scale) / 2 / state.width;
  const halfH = (layer.srcH * layer.scale) / 2 / state.height;
  return px >= layer.x - halfW && px <= layer.x + halfW &&
         py >= layer.y - halfH && py <= layer.y + halfH;
}
stageBg.addEventListener("pointerdown", (e) => {
  const rect = stageBg.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;
  for (let i = state.layers.length - 1; i >= 0; i--) {
    if (hitTest(state.layers[i], px, py)) {
      const layer = state.layers[i];
      if (layer.id !== state.selectedId) selectLayer(layer.id);
      _drag = { id: layer.id, grabX: px - layer.x, grabY: py - layer.y };
      try { stageBg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      break;
    }
  }
});
stageBg.addEventListener("pointermove", (e) => {
  if (!_drag) return;
  const layer = layerById(_drag.id);
  if (!layer) { _drag = null; return; }
  const rect = stageBg.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;
  layer.x = clamp(px - _drag.grabX, -0.3, 1.3);
  layer.y = clamp(py - _drag.grabY, -0.3, 1.3);
  syncPropsTransform();
});
function endStageDrag(e) {
  if (!_drag) return;
  _drag = null;
  try { stageBg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
}
stageBg.addEventListener("pointerup", endStageDrag);
stageBg.addEventListener("pointercancel", endStageDrag);

// ============ Rotation / scale handles ============
function layerScreenCenter(layer) {
  const rect = stageBg.getBoundingClientRect();
  return { x: rect.left + layer.x * rect.width, y: rect.top + layer.y * rect.height };
}
function onHandleMove(e) {
  if (!_handle) return;
  const layer = selectedLayer();
  if (!layer) return;
  if (_handle.type === "rot") {
    let ang = Math.atan2(e.clientY - _handle.cy, e.clientX - _handle.cx) * 180 / Math.PI + 90;
    ang = ((ang % 360) + 360) % 360;
    if (ang > 180) ang -= 360;
    layer.rotation = Math.round(ang);
  } else {
    const d = Math.hypot(e.clientX - _handle.cx, e.clientY - _handle.cy);
    layer.scale = clamp(_handle.startScale * d / _handle.startDist, 0.02, 8);
  }
  redrawOnce();
  syncPropsTransform();
}
function onHandleUp() {
  if (!_handle) return;
  _handle = null;
  window.removeEventListener("pointermove", onHandleMove);
  window.removeEventListener("pointerup", onHandleUp);
  startLoop();
}
function onHandleDown(e) {
  const layer = selectedLayer();
  if (!layer) return;
  const isRot = e.target.classList.contains("rot-handle");
  const isScale = e.target.classList.contains("scale-handle");
  if (!isRot && !isScale) return;
  e.stopPropagation();
  e.preventDefault();
  const c = layerScreenCenter(layer);
  if (isRot) {
    _handle = { type: "rot", cx: c.x, cy: c.y };
  } else {
    const d = Math.hypot(e.clientX - c.x, e.clientY - c.y);
    _handle = { type: "scale", cx: c.x, cy: c.y, startDist: Math.max(2, d), startScale: layer.scale };
  }
  stopLoop();
  window.addEventListener("pointermove", onHandleMove);
  window.addEventListener("pointerup", onHandleUp);
}

// ============ Layer list ============
function layerThumb(layer) {
  if (layer._thumb) return layer._thumb;
  const c = document.createElement("canvas");
  c.width = 30; c.height = 30;
  const cx = c.getContext("2d");
  const frame = layer.kind === "anim" ? layer.frames[0] : layer.img;
  if (frame) {
    const s = Math.min(30 / layer.srcW, 30 / layer.srcH);
    const dw = layer.srcW * s, dh = layer.srcH * s;
    cx.drawImage(frame, (30 - dw) / 2, (30 - dh) / 2, dw, dh);
  }
  layer._thumb = c.toDataURL();
  return layer._thumb;
}
function renderLayerList() {
  if (!state.layers.length) {
    layerList.innerHTML = `<div class="layer-empty">还没有图层。<br>用下方的素材添加第一层。</div>`;
    return;
  }
  const rows = [];
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const sel = layer.id === state.selectedId ? "sel" : "";
    const hid = layer.visible ? "" : "hidden-layer";
    const kindBadge = layer.kind === "anim"
      ? `<span class="kbadge">动图 ${layer.frames.length}帧</span>`
      : "静态图";
    rows.push(`<div class="layer-row ${sel} ${hid}" data-id="${layer.id}">
      <img class="layer-thumb" src="${layerThumb(layer)}" alt="">
      <div class="layer-info">
        <div class="layer-name">${esc(layer.name)}</div>
        <div class="layer-kind">${kindBadge}</div>
      </div>
      <div class="layer-btns">
        <button class="lyr-btn" data-act="up" ${i === state.layers.length - 1 ? "disabled" : ""} title="上移">▲</button>
        <button class="lyr-btn" data-act="down" ${i === 0 ? "disabled" : ""} title="下移">▼</button>
        <button class="lyr-btn" data-act="vis" title="显示/隐藏">${layer.visible ? "👁" : "⊘"}</button>
        <button class="lyr-btn del" data-act="del" title="删除">✕</button>
      </div>
    </div>`);
  }
  layerList.innerHTML = rows.join("");
}
layerList.addEventListener("click", (e) => {
  const row = e.target.closest(".layer-row");
  if (!row) return;
  const id = Number(row.dataset.id);
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx < 0) return;
  const act = e.target.dataset.act;
  if (act === "up" && idx < state.layers.length - 1) {
    [state.layers[idx], state.layers[idx + 1]] = [state.layers[idx + 1], state.layers[idx]];
  } else if (act === "down" && idx > 0) {
    [state.layers[idx], state.layers[idx - 1]] = [state.layers[idx - 1], state.layers[idx]];
  } else if (act === "vis") {
    state.layers[idx].visible = !state.layers[idx].visible;
  } else if (act === "del") {
    state.layers.splice(idx, 1);
    if (state.selectedId === id) {
      state.selectedId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
    }
  } else {
    state.selectedId = id;
  }
  renderLayerList();
  renderLayerProps();
});

// ============ Layer props ============
function renderLayerProps() {
  const layer = selectedLayer();
  if (!layer) {
    layerProps.innerHTML = `<div class="props-empty">选择一个图层来编辑它的位置、大小和动画。</div>`;
    return;
  }
  const animDef = ANIMS[layer.anim] || ANIMS.none;
  const paramRows = animDef.params.map((pr) => {
    const v = layer.animParams[pr.key] != null ? layer.animParams[pr.key] : pr.default;
    return `<label class="param"><span>${pr.label}</span>
      <input type="range" data-ap="${pr.key}" min="${pr.min}" max="${pr.max}" step="${pr.step}" value="${v}">
      <span class="range-val">${fmtParamVal(pr, v)}</span></label>`;
  }).join("");
  const animSpeedRow = layer.kind === "anim"
    ? `<label class="param"><span>播放速度</span>
        <input type="range" data-p="animSpeed" min="0.1" max="4" step="0.1" value="${layer.animSpeed}">
        <span class="range-val">${layer.animSpeed.toFixed(1)}×</span></label>`
    : "";
  const hasParamList = !!paramRows || layer.kind === "anim";
  layerProps.innerHTML = `
    <div class="props-section">变换</div>
    <div class="param-list">
      <label class="param"><span>名称</span>
        <input type="text" data-p="name" value="${esc(layer.name)}" style="flex:1;width:auto"></label>
      <label class="param"><span>位置 X</span>
        <input type="range" data-p="x" min="-0.2" max="1.2" step="0.005" value="${layer.x}">
        <span class="range-val">${layer.x.toFixed(2)}</span></label>
      <label class="param"><span>位置 Y</span>
        <input type="range" data-p="y" min="-0.2" max="1.2" step="0.005" value="${layer.y}">
        <span class="range-val">${layer.y.toFixed(2)}</span></label>
      <label class="param"><span>缩放</span>
        <input type="range" data-p="scale" min="0.02" max="6" step="0.01" value="${layer.scale}">
        <span class="range-val">${layer.scale.toFixed(2)}</span></label>
      <label class="param"><span>旋转</span>
        <input type="range" data-p="rotation" min="-180" max="180" step="1" value="${layer.rotation}">
        <span class="range-val">${Math.round(layer.rotation)}°</span></label>
      <label class="param"><span>透明度</span>
        <input type="range" data-p="opacity" min="0" max="1" step="0.01" value="${layer.opacity}">
        <span class="range-val">${layer.opacity.toFixed(2)}</span></label>
    </div>
    <div class="props-btn-row">
      <button class="btn-ghost btn-tiny" data-act="center">居中</button>
      <button class="btn-ghost btn-tiny" data-act="fit">适配</button>
      <button class="btn-ghost btn-tiny" data-act="cover">铺满</button>
    </div>
    <div class="props-section">混合模式</div>
    <div class="chip-row">
      ${BLEND_OPTS.map(([v, l]) =>
        `<button class="chip ${layer.blend === v ? "on" : ""}" data-blend-chip="${v}">${l}</button>`).join("")}
    </div>
    <div class="props-row-hint">滤色 / 相加发光 / 正片叠底 是把本图层与<b>下方像素</b>混合 —
      在透明画布上单图层不会有视觉差异。需要看效果就在合成台下方切换<b>「预览底色」</b>
      或叠多个图层。导出的 WebM 始终是透明背景。</div>
    <div class="props-section">动画（循环无缝 · 50 种）</div>
    <div class="chip-grid">
      ${ANIM_ORDER.map((k) =>
        `<button class="chip ${layer.anim === k ? "on" : ""}" data-anim-chip="${k}">${ANIMS[k].label}</button>`).join("")}
    </div>
    ${hasParamList ? `<div class="param-list">${paramRows}${animSpeedRow}</div>` : ""}
    <div class="props-row-hint">${layer.kind === "anim"
      ? `动图源：${layer.frames.length} 帧 · ${layer.totalDur.toFixed(2)}s · ${layer.srcW}×${layer.srcH}`
      : `静态图源：${layer.srcW}×${layer.srcH}`}</div>
  `;
}
function syncPropsTransform() {
  const layer = selectedLayer();
  if (!layer) return;
  const upd = (p, txt) => {
    const inp = layerProps.querySelector(`[data-p="${p}"]`);
    if (inp) {
      inp.value = layer[p];
      const span = inp.parentElement.querySelector(".range-val");
      if (span) span.textContent = txt;
    }
  };
  upd("x", layer.x.toFixed(2));
  upd("y", layer.y.toFixed(2));
  upd("scale", layer.scale.toFixed(2));
  upd("rotation", Math.round(layer.rotation) + "°");
}
layerProps.addEventListener("input", (e) => {
  const layer = selectedLayer();
  if (!layer) return;
  const el = e.target;
  if (el.dataset.p) {
    const p = el.dataset.p;
    if (p === "name") { layer.name = el.value; renderLayerList(); return; }
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return;
    layer[p] = v;
    const span = el.parentElement.querySelector(".range-val");
    if (span) {
      span.textContent = p === "rotation" ? Math.round(v) + "°"
        : p === "animSpeed" ? v.toFixed(1) + "×"
        : v.toFixed(2);
    }
  } else if (el.dataset.ap) {
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return;
    layer.animParams[el.dataset.ap] = v;
    const pr = (ANIMS[layer.anim]?.params || []).find((x) => x.key === el.dataset.ap);
    const span = el.parentElement.querySelector(".range-val");
    if (span && pr) span.textContent = fmtParamVal(pr, v);
  }
});
layerProps.addEventListener("click", (e) => {
  const layer = selectedLayer();
  if (!layer) return;
  const el = e.target;
  if (el.dataset.blendChip) {
    layer.blend = el.dataset.blendChip;
    layerProps.querySelectorAll("[data-blend-chip]").forEach((c) =>
      c.classList.toggle("on", c === el));
    return;
  }
  if (el.dataset.animChip) {
    layer.anim = el.dataset.animChip;
    layer.animParams = defaultParams(layer.anim);
    renderLayerProps();
    return;
  }
  const act = el.dataset.act;
  if (act === "center") { layer.x = 0.5; layer.y = 0.5; renderLayerProps(); }
  else if (act === "fit") {
    layer.scale = fitScale(layer.srcW, layer.srcH);
    layer.x = 0.5; layer.y = 0.5;
    renderLayerProps();
  } else if (act === "cover") {
    layer.scale = Math.max(state.width / layer.srcW, state.height / layer.srcH);
    layer.x = 0.5; layer.y = 0.5;
    renderLayerProps();
  }
});

// ============ Source picker ============
function renderEmojiGrid(filter = "") {
  const keys = searchEmoji(filter);
  emojiGrid.innerHTML = keys.map((k) => {
    const e = EMOJI_CATALOG[k];
    const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${e.code}.png`;
    return `<div class="emoji-cell" data-key="${k}" title="${esc(e.label)}">
      <img src="${url}" alt="${e.char}" loading="lazy"></div>`;
  }).join("");
}
emojiSearch.addEventListener("input", () => renderEmojiGrid(emojiSearch.value));
emojiGrid.addEventListener("click", async (e) => {
  const cell = e.target.closest(".emoji-cell");
  if (!cell) return;
  const key = cell.dataset.key;
  try {
    const img = await loadEmoji(key);
    const label = (EMOJI_CATALOG[key]?.label || key).split(" ")[0];
    addImageLayer(img, label);
    toast(`已添加图层「${label}」`, "ok");
  } catch (err) {
    toast("emoji 加载失败：" + err.message, "err");
  }
});
sourceModeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-opt");
  if (!btn) return;
  const mode = btn.dataset.mode;
  sourceModeSeg.querySelectorAll(".seg-opt").forEach((b) => b.classList.toggle("on", b === btn));
  document.querySelectorAll(".src-pane").forEach((p) =>
    p.classList.toggle("hidden", p.dataset.pane !== mode));
});

async function fileToImage(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try { return await loadImage(url); }
    finally { URL.revokeObjectURL(url); }
  }
}
async function handleImageFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  for (const file of files) {
    try {
      const img = await fileToImage(file);
      addImageLayer(img, file.name.replace(/\.[^.]+$/, ""));
      toast(`已添加图层「${file.name}」`, "ok");
    } catch {
      toast(`图片「${file.name}」加载失败`, "err");
    }
  }
  imageFile.value = "";
}
imageFile.addEventListener("change", () => handleImageFiles(imageFile.files));

async function handleAnimFiles(fileList, { fitCanvas = false } = {}) {
  const files = [...fileList];
  for (const file of files) {
    toast(`正在解码「${file.name}」…`);
    try {
      const decoded = await decodeSource(file);
      const layer = addAnimLayer(decoded, file.name.replace(/\.[^.]+$/, ""));
      if (fitCanvas) {
        setCanvasSizeFit(decoded.width, decoded.height);
        layer.scale = state.width / decoded.width;
        layer.x = 0.5; layer.y = 0.5;
        renderLayerProps();
      }
      toast(`「${file.name}」已加入 · ${decoded.frames.length} 帧`, "ok");
    } catch (err) {
      toast(`「${file.name}」解码失败：${err.message}`, "err");
    }
  }
  animFile.value = "";
}
animFile.addEventListener("change", () => handleAnimFiles(animFile.files));
convertBtn.addEventListener("click", () => {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/gif,image/webp,image/apng,video/*";
  inp.onchange = () => { if (inp.files[0]) handleAnimFiles([inp.files[0]], { fitCanvas: true }); };
  inp.click();
});

function wireDrop(el, handler) {
  ["dragenter", "dragover"].forEach((ev) => el.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); el.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((ev) => el.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); el.classList.remove("dragover");
  }));
  el.addEventListener("drop", (e) => handler(e.dataTransfer.files));
}
wireDrop(imageDrop, handleImageFiles);
wireDrop(animDrop, (files) => handleAnimFiles(files));
const isAnimFile = (f) => f.type.startsWith("video/") || /gif|webp|apng/i.test(f.type || f.name);
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  const anims = files.filter(isAnimFile);
  const imgs = files.filter((f) => !isAnimFile(f) && f.type.startsWith("image/"));
  if (anims.length) handleAnimFiles(anims);
  if (imgs.length) handleImageFiles(imgs);
});

// ============ Saved-drawings gallery (localStorage) ============
function loadDrawings() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_DRAWINGS) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function saveDrawings(arr) {
  try {
    localStorage.setItem(LS_DRAWINGS, JSON.stringify(arr));
    return true;
  } catch {
    toast("保存失败：浏览器本地存储已满", "err");
    return false;
  }
}
function renderGallery() {
  const arr = loadDrawings();
  if (!arr.length) {
    savedGallery.innerHTML = `<div class="gallery-empty">还没有保存的画作。<br>用画板画一个并「保存到素材」。</div>`;
    return;
  }
  savedGallery.innerHTML = arr.map((d) => `
    <div class="gallery-item" data-id="${esc(d.id)}" title="${esc(d.name)}">
      <img src="${d.url}" alt="${esc(d.name)}">
      <div class="gallery-item-btns">
        <button class="gi-btn" data-act="add" title="作为图层添加">＋</button>
        <button class="gi-btn" data-act="edit" title="载入画板编辑">✎</button>
        <button class="gi-btn del" data-act="del" title="删除">✕</button>
      </div>
    </div>`).join("");
}
savedGallery.addEventListener("click", async (e) => {
  const item = e.target.closest(".gallery-item");
  if (!item) return;
  const id = item.dataset.id;
  const arr = loadDrawings();
  const d = arr.find((x) => x.id === id);
  if (!d) return;
  const act = e.target.dataset.act;
  if (act === "del") {
    saveDrawings(arr.filter((x) => x.id !== id));
    renderGallery();
  } else if (act === "edit") {
    paintBoard.loadDataUrl(d.url);
    toast(`「${d.name}」已载入画板`, "ok");
  } else {
    try {
      const img = await loadImage(d.url);
      addImageLayer(img, d.name);
      toast(`已添加图层「${d.name}」`, "ok");
    } catch {
      toast("添加失败", "err");
    }
  }
});

// ============ Canvas settings ============
function syncStageMeta() {
  const frames = Math.round(state.fps * state.duration);
  stageMeta.textContent = `${state.width} × ${state.height} · ${state.fps}fps · ${state.duration}s · ${frames}帧`;
}
function applyCanvasSize() {
  if (stageCanvas.width !== state.width) stageCanvas.width = state.width;
  if (stageCanvas.height !== state.height) stageCanvas.height = state.height;
  stageBg.style.setProperty("--stage-ar", state.width / state.height);
  syncStageMeta();
}
function syncCanvasSettings() {
  state.width = makeEven(clampInt(canvasW.value, 32, 1024, 256));
  state.height = makeEven(clampInt(canvasH.value, 32, 1024, 256));
  state.duration = clampFloat(canvasDur.value, 0.2, 10, 1.5);
  state.fps = clampInt(canvasFps.value, 8, 60, 30);
  applyCanvasSize();
}
function setCanvasSizeFit(w, h) {
  const MAX = 1024;
  let cw = w, ch = h;
  if (cw > MAX || ch > MAX) {
    const s = MAX / Math.max(cw, ch);
    cw = Math.round(cw * s);
    ch = Math.round(ch * s);
  }
  state.width = makeEven(clampInt(cw, 32, 1024, 256));
  state.height = makeEven(clampInt(ch, 32, 1024, 256));
  canvasW.value = state.width;
  canvasH.value = state.height;
  applyCanvasSize();
}
[canvasW, canvasH, canvasDur, canvasFps].forEach((el) =>
  el.addEventListener("input", syncCanvasSettings));
showToken.addEventListener("change", () =>
  fakeToken.classList.toggle("hidden", !showToken.checked));
loopPlay.addEventListener("change", () => { state.loop = loopPlay.checked; });

// Preview-backdrop picker. Live-only — the bake loop uses transparent
// regardless. Lets the user actually SEE blend modes (screen / multiply
// / lighter need pixels under the layer to show their effect).
const previewBgSeg = document.getElementById("previewBgSeg");
if (previewBgSeg) {
  previewBgSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-opt[data-bg]");
    if (!btn) return;
    state.previewBg = btn.dataset.bg || "transparent";
    previewBgSeg.querySelectorAll(".seg-opt").forEach((b) => b.classList.toggle("on", b === btn));
    redrawOnce();
  });
}

// ============ Generate ============
// Synchronous PNG bake: a detached <canvas>.toDataURL is ~2ms/frame,
// while OffscreenCanvas.convertToBlob / canvas.toBlob can be ~1s/frame
// on some engines. Decode the base64 data URL straight to PNG bytes.
function pngDataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
generateBtn.addEventListener("click", async () => {
  if (!state.layers.length) { toast("先添加至少一个图层", "err"); return; }
  generateBtn.disabled = true;
  generateStatus.classList.remove("hidden");
  resultBox.classList.add("hidden");
  stopLoop();
  try {
    const W = state.width, H = state.height, fps = state.fps;
    const totalFrames = Math.max(1, Math.round(fps * state.duration));
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const offCtx = off.getContext("2d");
    const frames = [];
    for (let f = 0; f < totalFrames; f++) {
      const u = f / totalFrames;
      drawComposition(offCtx, u, W, H);
      // Bake to PNG right away. A raw RGBA frame is W*H*4 bytes —
      // hundreds of MB across a full clip — and ffmpeg.wasm can't
      // swallow a buffer that big ("memory access out of bounds").
      // PNG-compressed frames keep ffmpeg's wasm FS small.
      frames.push(pngDataUrlToBytes(off.toDataURL("image/png")));
      if (f % 6 === 0) {
        const r = (f / totalFrames) * 0.25;
        progressFill.style.width = (r * 100).toFixed(1) + "%";
        progressText.textContent = `烘焙帧 ${f + 1}/${totalFrames}`;
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    progressText.textContent = "加载 ffmpeg.wasm…";
    const blob = await encodeWebm(frames, fps, (ratio, msg) => {
      progressFill.style.width = (ratio * 100).toFixed(1) + "%";
      progressText.textContent = msg;
    });
    const url = URL.createObjectURL(blob);
    resultVideo.src = url;
    resultDownload.href = url;
    resultDownload.download = `buff-${Date.now().toString(36)}.webm`;
    resultInfo.textContent = `${(blob.size / 1024).toFixed(1)} KB · ${W}×${H} · ${totalFrames}帧`;
    resultBox.classList.remove("hidden");
    progressText.textContent = "完成 ✓";
  } catch (err) {
    const msg = (err && err.message) || String(err);
    progressText.textContent = "失败：" + msg;
    console.error(err);
    toast("生成失败：" + msg, "err");
  } finally {
    generateBtn.disabled = false;
    startLoop();
  }
});

// ============ Boot ============
(function init() {
  selBox = document.createElement("div");
  selBox.className = "sel-box";
  selBox.style.display = "none";
  selBox.innerHTML = `<div class="rot-handle"></div><div class="scale-handle"></div>`;
  stageOverlay.appendChild(selBox);
  selBox.addEventListener("pointerdown", onHandleDown);

  paintBoard = initDraw({
    mount: document.getElementById("paintMount"),
    width: 256,
    height: 256,
    saveLabel: "💾 保存到素材",
    onSave: (url) => {
      const arr = loadDrawings();
      const name = `画作 ${arr.length + 1}`;
      arr.push({ id: "d" + Date.now().toString(36), name, url });
      if (saveDrawings(arr)) {
        renderGallery();
        toast(`已保存「${name}」到素材`, "ok");
      }
    },
  });

  renderEmojiGrid("");
  renderLayerList();
  renderLayerProps();
  renderGallery();
  syncCanvasSettings();
  state.loop = loopPlay.checked;
  startLoop();

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => prewarmEncoder());
  }
})();
