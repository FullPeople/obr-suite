/* Buff FX Studio — main app entry.
 *
 * Wires the UI together:
 *   - source picker (emoji / upload / URL) → loads HTMLImageElement
 *   - template picker (9 templates)
 *   - dynamic parameter form (per-template + canvas-wide)
 *   - live preview loop (canvas, 30fps)
 *   - "Generate" → renders all frames, encodes via ffmpeg.wasm
 *   - result block (looping <video> + download link + config JSON)
 *
 * State is held in module-scope `state`. Re-renders the preview
 * on every state change.
 */

import { TEMPLATES, TEMPLATE_ORDER } from "./templates.js";
import { EMOJI_CATALOG, loadEmoji, loadImage, searchEmoji } from "./emoji.js";
import { encodeWebm, prewarmEncoder } from "./encoder.js";

// ============ State ============
const state = {
  sourceMode:  "emoji",                  // "emoji" | "upload" | "url"
  sourceEmoji: "lightning",              // catalog key
  sourceImage: null,                     // HTMLImageElement once loaded
  template:    "flash",
  params:      structuredClone(TEMPLATES.flash.defaults),
  width:       192,
  height:      192,
  duration:    1.5,
  fps:         30,
  seed:        42,
};

// ============ Element refs ============
const $ = (sel) => document.querySelector(sel);

const previewCanvas = $("#previewCanvas");
const previewCtx    = previewCanvas.getContext("2d");
const previewInfo   = $("#previewInfo");

const sourceModeSeg = $("#sourceModeSeg");
const emojiGrid     = $("#emojiGrid");
const emojiSearch   = $("#emojiSearch");
const fileUpload    = $("#fileUpload");
const dropzone      = $("#dropzone");
const uploadPreview = $("#uploadPreview");
const uploadImg     = $("#uploadPreviewImg");
const uploadClear   = $("#uploadClear");
const urlInput      = $("#urlInput");
const urlLoad       = $("#urlLoad");

const templateGrid  = $("#templateGrid");
const paramList     = $("#paramList");

const paramWidth    = $("#paramWidth");
const paramHeight   = $("#paramHeight");
const paramDuration = $("#paramDuration");
const paramFps      = $("#paramFps");
const paramSeed     = $("#paramSeed");
const paramSeedRand = $("#paramSeedRandom");

const generateBtn    = $("#generateBtn");
const generateStatus = $("#generateStatus");
const progressFill   = $("#progressFill");
const progressText   = $("#progressText");
const resultBox      = $("#resultBox");
const resultVideo    = $("#resultVideo");
const resultInfo     = $("#resultInfo");
const resultDownload = $("#resultDownload");
const resultConfig   = $("#resultConfig");
const copyConfigBtn  = $("#copyConfigBtn");

// ============ Source picker ============

function renderEmojiGrid(filter = "") {
  const keys = searchEmoji(filter);
  emojiGrid.innerHTML = keys.map((k) => {
    const e = EMOJI_CATALOG[k];
    const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${e.code}.png`;
    const on = (state.sourceMode === "emoji" && state.sourceEmoji === k) ? "on" : "";
    return `
      <div class="emoji-cell ${on}" data-key="${k}" title="${e.label}">
        <img src="${url}" alt="${e.char}" loading="lazy">
        <span class="ec-name">${k}</span>
      </div>
    `;
  }).join("");
  emojiGrid.querySelectorAll(".emoji-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      state.sourceMode = "emoji";
      state.sourceEmoji = cell.dataset.key;
      emojiGrid.querySelectorAll(".emoji-cell").forEach((c) => c.classList.toggle("on", c === cell));
      void reloadSource();
    });
  });
}

emojiSearch.addEventListener("input", () => renderEmojiGrid(emojiSearch.value));

// Mode segmented switcher
sourceModeSeg.querySelectorAll(".seg-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    sourceModeSeg.querySelectorAll(".seg-opt").forEach((b) => b.classList.toggle("on", b === btn));
    document.querySelectorAll(".src-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== mode));
    state.sourceMode = mode;
    void reloadSource();
  });
});

// File upload (drag + click)
function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUri = reader.result;
    try {
      const img = await loadImage(dataUri);
      state.sourceMode = "upload";
      state.sourceImage = img;
      uploadImg.src = dataUri;
      uploadPreview.classList.remove("hidden");
      dropzone.classList.add("hidden");
      void renderPreviewFrame();
    } catch (e) { alert(`图片加载失败: ${e.message}`); }
  };
  reader.readAsDataURL(file);
}
fileUpload.addEventListener("change", (e) => handleFile(e.target.files?.[0]));
["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.add("dragover");
}));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.remove("dragover");
}));
dropzone.addEventListener("drop", (e) => handleFile(e.dataTransfer?.files?.[0]));
uploadClear.addEventListener("click", () => {
  state.sourceImage = null;
  state.sourceMode = "emoji";
  uploadPreview.classList.add("hidden");
  dropzone.classList.remove("hidden");
  sourceModeSeg.querySelector('[data-mode="emoji"]').click();
});

// Remote URL load
urlLoad.addEventListener("click", async () => {
  const u = urlInput.value.trim();
  if (!u) return;
  try {
    const img = await loadImage(u);
    state.sourceMode = "url";
    state.sourceImage = img;
    void renderPreviewFrame();
  } catch (e) {
    alert(`远程图片加载失败（很可能是 CORS）: ${e.message}`);
  }
});

// Resolve current source to an HTMLImageElement (cached per emoji /
// per upload / per URL).
async function reloadSource() {
  if (state.sourceMode === "emoji") {
    try {
      state.sourceImage = await loadEmoji(state.sourceEmoji);
    } catch (e) {
      console.warn("emoji load failed", e);
      state.sourceImage = null;
    }
  }
  // upload / url paths already set sourceImage when the user picked.
  renderPreviewFrame();
}

// ============ Template picker ============

function renderTemplateGrid() {
  templateGrid.innerHTML = TEMPLATE_ORDER.map((id) => {
    const t = TEMPLATES[id];
    const on = state.template === id ? "on" : "";
    return `
      <div class="template-cell ${on}" data-tmpl="${id}" title="${t.meta.description}">
        <span class="tc-icon">${t.meta.icon}</span>
        <div class="tc-name">${t.meta.name}</div>
        <div class="tc-desc">${t.meta.description}</div>
      </div>
    `;
  }).join("");
  templateGrid.querySelectorAll(".template-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const id = cell.dataset.tmpl;
      state.template = id;
      state.params = structuredClone(TEMPLATES[id].defaults);
      templateGrid.querySelectorAll(".template-cell").forEach((c) => c.classList.toggle("on", c === cell));
      renderParamForm();
      renderPreviewFrame();
    });
  });
}

// ============ Parameter form (dynamic per-template) ============

function renderParamForm() {
  const tmpl = TEMPLATES[state.template];
  paramList.innerHTML = tmpl.paramSpec.map((spec) => paramRowHtml(spec)).join("");
  tmpl.paramSpec.forEach((spec) => {
    const row = paramList.querySelector(`[data-key="${spec.key}"]`);
    if (!row) return;
    const inp = row.querySelector("input, select");
    if (!inp) return;
    inp.addEventListener("input", () => {
      let v;
      if (spec.type === "bool")       v = inp.checked;
      else if (spec.type === "int")   v = parseInt(inp.value, 10);
      else if (spec.type === "float") v = parseFloat(inp.value);
      else                            v = inp.value;
      if (Number.isNaN(v)) return;
      state.params[spec.key] = v;
      // Re-display the live number alongside range slider.
      const valSpan = row.querySelector(".range-val");
      if (valSpan) valSpan.textContent = (spec.type === "float") ? Number(v).toFixed(2) : String(v);
      renderPreviewFrame();
    });
  });
}

function paramRowHtml(spec) {
  const v = state.params[spec.key] ?? 0;
  if (spec.type === "bool") {
    return `
      <label class="param" data-key="${spec.key}">
        <span>${spec.label}</span>
        <input type="checkbox" ${v ? "checked" : ""}>
      </label>
      ${spec.hint ? `<div class="param row-hint">${spec.hint}</div>` : ""}
    `;
  }
  // Numeric → slider + number readout.
  const step = spec.step ?? (spec.type === "int" ? 1 : 0.01);
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const displayV = spec.type === "float" ? Number(v).toFixed(2) : v;
  return `
    <label class="param" data-key="${spec.key}">
      <span>${spec.label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${v}">
      <span class="range-val">${displayV}</span>
    </label>
    ${spec.hint ? `<div class="param row-hint">${spec.hint}</div>` : ""}
  `;
}

// Canvas-wide param wiring.
function syncGlobalParams() {
  state.width    = parseInt(paramWidth.value, 10)  || 192;
  state.height   = parseInt(paramHeight.value, 10) || 192;
  state.duration = parseFloat(paramDuration.value) || 1.5;
  state.fps      = parseInt(paramFps.value, 10)    || 30;
  state.seed     = parseInt(paramSeed.value, 10)   || 0;
  // Update canvas size if changed.
  if (previewCanvas.width !== state.width || previewCanvas.height !== state.height) {
    previewCanvas.width  = state.width;
    previewCanvas.height = state.height;
  }
  const tot = Math.round(state.fps * state.duration);
  previewInfo.textContent = `${state.width} × ${state.height} · ${state.fps}fps · ${state.duration}s · ${tot} 帧`;
}
[paramWidth, paramHeight, paramDuration, paramFps, paramSeed].forEach((el) => {
  el.addEventListener("input", () => { syncGlobalParams(); renderPreviewFrame(); });
});
paramSeedRand.addEventListener("click", () => {
  paramSeed.value = String(Math.floor(Math.random() * 1000000));
  syncGlobalParams();
  renderPreviewFrame();
});

// ============ Live preview ============

let _previewRaf = null;
let _previewStart = 0;

function renderPreviewFrame() {
  // Cancel any running rAF and restart so we always re-render when
  // params change (so user sees changes instantly).
  if (_previewRaf) cancelAnimationFrame(_previewRaf);
  _previewStart = performance.now();
  const tick = (now) => {
    const t = ((now - _previewStart) / 1000) % state.duration;
    const u = t / state.duration;
    const totalFrames = Math.round(state.fps * state.duration);
    const f = Math.floor(u * totalFrames);
    drawFrame(previewCtx, f, totalFrames);
    _previewRaf = requestAnimationFrame(tick);
  };
  _previewRaf = requestAnimationFrame(tick);
}

function drawFrame(ctx, frameIdx, totalFrames) {
  ctx.clearRect(0, 0, state.width, state.height);
  if (!state.sourceImage) {
    // Placeholder: a centered ? glyph in muted grey.
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.font = `${Math.floor(state.height * 0.3)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("?", state.width / 2, state.height / 2);
    return;
  }
  const tmpl = TEMPLATES[state.template];
  const params = { ...state.params, width: state.width, height: state.height,
                    duration: state.duration, fps: state.fps, seed: state.seed };
  tmpl.render(ctx, frameIdx, totalFrames, params, state.sourceImage);
}

// ============ Generate (encode all frames → WebM) ============

generateBtn.addEventListener("click", async () => {
  if (!state.sourceImage) { alert("先选一个素材"); return; }
  // Cancel preview for the duration of the encode (canvas is busy).
  if (_previewRaf) cancelAnimationFrame(_previewRaf);
  generateBtn.disabled = true;
  generateStatus.classList.remove("hidden");
  resultBox.classList.add("hidden");

  try {
    progressFill.style.width = "0%";
    progressText.textContent = "渲染帧…";

    const totalFrames = Math.round(state.fps * state.duration);
    const frames = [];
    // Offscreen canvas per-frame so we don't fight the preview canvas.
    const off = new OffscreenCanvas(state.width, state.height);
    const offCtx = off.getContext("2d");
    for (let f = 0; f < totalFrames; f++) {
      offCtx.clearRect(0, 0, state.width, state.height);
      drawFrameTo(offCtx, f, totalFrames);
      const data = offCtx.getImageData(0, 0, state.width, state.height).data;
      // ImageData.data is a Uint8ClampedArray view, slice() makes a
      // detached Uint8Array we can hand to ffmpeg.
      frames.push(new Uint8Array(data));
      // UI yield every few frames so the page stays responsive.
      if (f % 8 === 0) {
        const r = (f / totalFrames) * 0.20;
        progressFill.style.width = `${(r * 100).toFixed(1)}%`;
        progressText.textContent = `渲染帧 ${f + 1}/${totalFrames}`;
        await new Promise((res) => setTimeout(res, 0));
      }
    }

    progressText.textContent = "加载 ffmpeg.wasm…";
    const blob = await encodeWebm(frames, state.width, state.height, state.fps,
      (ratio, msg) => {
        progressFill.style.width = `${(ratio * 100).toFixed(1)}%`;
        progressText.textContent = msg;
      });

    // Display result
    const url = URL.createObjectURL(blob);
    resultVideo.src = url;
    resultDownload.href = url;
    const sourceLabel = state.sourceMode === "emoji" ? state.sourceEmoji :
                        state.sourceMode === "upload" ? "upload" : "url";
    resultDownload.download = `${state.template}-${sourceLabel}.webm`;
    resultInfo.textContent = `${(blob.size / 1024).toFixed(1)} KB · ${state.template}-${sourceLabel}`;
    resultConfig.textContent = JSON.stringify(exportConfig(), null, 2);
    resultBox.classList.remove("hidden");
  } catch (e) {
    progressText.textContent = `失败：${e.message}`;
    console.error(e);
  } finally {
    generateBtn.disabled = false;
    // Resume preview
    renderPreviewFrame();
  }
});

// drawFrameTo is the version used during encode; identical to
// drawFrame but takes the context explicitly (could be Offscreen).
function drawFrameTo(ctx, frameIdx, totalFrames) {
  const tmpl = TEMPLATES[state.template];
  const params = { ...state.params, width: state.width, height: state.height,
                    duration: state.duration, fps: state.fps, seed: state.seed };
  tmpl.render(ctx, frameIdx, totalFrames, params, state.sourceImage);
}

// Config JSON (for sharing / restoring an exact configuration).
function exportConfig() {
  return {
    template:  state.template,
    sourceMode: state.sourceMode,
    sourceEmoji: state.sourceMode === "emoji" ? state.sourceEmoji : undefined,
    params:    state.params,
    canvas:    { width: state.width, height: state.height,
                 duration: state.duration, fps: state.fps, seed: state.seed },
  };
}

copyConfigBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(resultConfig.textContent);
    copyConfigBtn.textContent = "✓ 已复制";
    setTimeout(() => { copyConfigBtn.textContent = "📋 复制"; }, 1500);
  } catch (e) { alert(`复制失败：${e.message}`); }
});

// ============ Boot ============

(async function init() {
  renderEmojiGrid("");
  renderTemplateGrid();
  renderParamForm();
  syncGlobalParams();
  await reloadSource();
  renderPreviewFrame();
  // Pre-warm ffmpeg.wasm download in the background. Cancels safely
  // if the user closes the tab; just an optimisation for first
  // Generate click.
  requestIdleCallback?.(() => prewarmEncoder());
})();
