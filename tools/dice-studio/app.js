// Dice Studio — paint dice-face textures with the shared draw-kit.
//
// Pick a die type → the canvas shows that die's CURRENT plugin texture as
// a faded reference (so a redraw stays on-model). Draw on top with the
// full draw-kit tool set (brush / eraser / bucket / shapes / eyedropper
// / select / move). Export a transparent PNG, or save into a per-browser
// gallery.
//
// 2026-05-15 — the 7 reference textures are the SAME PNGs the obr-suite
// plugin actually ships (`obr-suite/public/d{4,6,8,10,12,20,100}.png`),
// copied into ./templates/ so the studio is self-contained. The picker
// chips and the on-canvas guide both render from these.

import { initDraw } from "../draw-kit/draw.js";

// --- die catalogue ---------------------------------------------------------
const DICE = [
  { id: "d4",   label: "d4",   png: "./templates/d4.png" },
  { id: "d6",   label: "d6",   png: "./templates/d6.png" },
  { id: "d8",   label: "d8",   png: "./templates/d8.png" },
  { id: "d10",  label: "d10",  png: "./templates/d10.png" },
  { id: "d12",  label: "d12",  png: "./templates/d12.png" },
  { id: "d20",  label: "d20",  png: "./templates/d20.png" },
  { id: "d100", label: "d100", png: "./templates/d100.png" },
];

// Pre-decoded reference Image per die id. The guide draws from these;
// while a die's image is still loading the guide just shows the label
// + crosshair, then auto-repaints once decode resolves.
const DIE_IMG = Object.create(null);
for (const d of DICE) {
  const img = new Image();
  img.src = d.png;
  // when each one decodes, kick a guide repaint so the user doesn't
  // have to switch dice to see it appear.
  img.addEventListener("load", () => { if (d.id === currentDie.id) applyGuide(); });
  DIE_IMG[d.id] = img;
}

const LS_SAVED = "dice-studio:saved";

let currentDie = DICE[5]; // default d20
let drawkit = null;

// --- element refs ----------------------------------------------------------
const dieGrid = document.getElementById("dieGrid");
const sizeSelect = document.getElementById("sizeSelect");
const showGuide = document.getElementById("showGuide");
const downloadBtn = document.getElementById("downloadBtn");
const diceGallery = document.getElementById("diceGallery");

// --- toast -----------------------------------------------------------------
let _toastTimer = 0;
function toast(msg, kind = "") {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = "toast show " + kind;
  clearTimeout(_toastTimer);
  _toastTimer = window.setTimeout(() => { el.className = "toast " + kind; }, 2400);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- die picker ------------------------------------------------------------
function renderDieGrid() {
  dieGrid.innerHTML = DICE.map((d) => `
    <button class="die-chip ${d.id === currentDie.id ? "on" : ""}" data-die="${d.id}" title="${d.label}">
      <img src="${d.png}" alt="${d.label}" draggable="false">
      <span class="die-name">${d.label}</span>
    </button>`).join("");
}
dieGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-die]");
  if (!btn) return;
  const die = DICE.find((d) => d.id === btn.dataset.die);
  if (!die) return;
  currentDie = die;
  dieGrid.querySelectorAll(".die-chip").forEach((c) => c.classList.toggle("on", c === btn));
  applyGuide();
});

// --- guide (template image) ------------------------------------------------
// Drawn onto the draw-kit's NON-exported guide canvas. Renders the actual
// plugin dice PNG faded behind the user's strokes — they can trace, redraw
// numbers, or just use it as a registration aid. Falls back to label-only
// before the PNG decodes (the image's load handler triggers a repaint).
function drawGuide(ctx, w, h) {
  const img = DIE_IMG[currentDie.id];
  if (img && img.complete && img.naturalWidth > 0) {
    // Fit-contain: scale the PNG into the canvas, preserve aspect ratio,
    // centre it. Fade hard so the user's paint reads as foreground.
    const sc = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * sc;
    const dh = img.naturalHeight * sc;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  // centre crosshair — helps line up symmetric numerals on the redraw.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  const cx = w / 2, cy = h / 2, t = w * 0.035;
  ctx.beginPath();
  ctx.moveTo(cx, cy - t); ctx.lineTo(cx, cy + t);
  ctx.moveTo(cx - t, cy); ctx.lineTo(cx + t, cy);
  ctx.stroke();
  // label
  ctx.fillStyle = "rgba(93,173,226,0.55)";
  ctx.font = `700 ${Math.round(w * 0.045)}px -apple-system,"Segoe UI",sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${currentDie.label} · 模板参考`, w * 0.04, h * 0.035);
}
function applyGuide() {
  if (!drawkit) return;
  drawkit.setGuide(showGuide.checked ? drawGuide : null);
}
showGuide.addEventListener("change", applyGuide);

// --- canvas size -----------------------------------------------------------
sizeSelect.addEventListener("change", () => {
  const s = parseInt(sizeSelect.value, 10) || 512;
  drawkit.resize(s, s);   // resize wipes the board + re-renders the guide
  applyGuide();
  toast(`画布已重设为 ${s} × ${s}（已清空）`);
});

// --- export ----------------------------------------------------------------
downloadBtn.addEventListener("click", () => {
  const url = drawkit.getDataURL();
  const a = document.createElement("a");
  a.href = url;
  a.download = `${currentDie.id}-face-${Date.now().toString(36)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("已下载 PNG", "ok");
});

// 2026-05-15 — template-PNG download. Renders the current die's
// reference outline onto a fresh transparent canvas (no user paint
// strokes mixed in) and saves it. Lets users open the template in
// Photoshop / Procreate / etc. as a layer to trace.
const downloadTemplateBtn = document.getElementById("downloadTemplateBtn");
if (downloadTemplateBtn) {
  downloadTemplateBtn.addEventListener("click", () => {
    const size = parseInt(sizeSelect.value, 10) || 512;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const ctx = off.getContext("2d");
    // Draw ONLY the guide — the user's strokes live on a separate
    // paint canvas we don't touch here. Mirrors the in-page guide
    // renderer (drawGuide) so the downloaded PNG matches what's
    // visible on the studio canvas.
    drawGuide(ctx, size, size);
    const url = off.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentDie.id}-template-${size}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`已下载 ${currentDie.label} 模板图（${size}×${size}）`, "ok");
  });
}

// --- saved-dice gallery (localStorage) -------------------------------------
function loadSaved() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_SAVED) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function writeSaved(arr) {
  try { localStorage.setItem(LS_SAVED, JSON.stringify(arr)); return true; }
  catch { toast("保存失败：浏览器本地存储已满", "err"); return false; }
}
function renderGallery() {
  const arr = loadSaved();
  if (!arr.length) {
    diceGallery.innerHTML = `<div class="gallery-empty">还没有保存的骰面。<br>画好后点画板上的「保存」。</div>`;
    return;
  }
  diceGallery.innerHTML = arr.map((d) => `
    <div class="dice-item" data-id="${esc(d.id)}" title="${esc(d.name)}">
      <img src="${d.url}" alt="${esc(d.name)}">
      <div class="dice-item-btns">
        <button class="di-btn" data-act="load" title="载入画板继续编辑">✎</button>
        <button class="di-btn" data-act="dl" title="下载 PNG">⬇</button>
        <button class="di-btn del" data-act="del" title="删除">✕</button>
      </div>
    </div>`).join("");
}
diceGallery.addEventListener("click", (e) => {
  const item = e.target.closest(".dice-item");
  if (!item) return;
  const id = item.dataset.id;
  const arr = loadSaved();
  const d = arr.find((x) => x.id === id);
  if (!d) return;
  const act = e.target.dataset.act;
  if (act === "del") {
    writeSaved(arr.filter((x) => x.id !== id));
    renderGallery();
  } else if (act === "dl") {
    const a = document.createElement("a");
    a.href = d.url;
    a.download = `${d.name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else if (act === "load") {
    drawkit.loadDataUrl(d.url);
    toast(`「${d.name}」已载入画板`, "ok");
  }
});

// --- boot ------------------------------------------------------------------
renderDieGrid();
renderGallery();

drawkit = initDraw({
  mount: document.getElementById("drawMount"),
  width: 512,
  height: 512,
  saveLabel: "💾 保存到「我的骰面」",
  onSave: (url) => {
    const arr = loadSaved();
    const name = `${currentDie.id} 骰面 ${arr.length + 1}`;
    arr.push({ id: "x" + Date.now().toString(36), name, url, die: currentDie.id });
    if (writeSaved(arr)) {
      renderGallery();
      toast(`已保存「${name}」`, "ok");
    }
  },
});
applyGuide();
