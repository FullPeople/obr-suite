// draw-kit/draw.js — shared Photoshop-grade drawing board for the
// OBR Suite Studio. Used by BOTH buff-studio (the paint board, card ④)
// and dice-studio (the dice-face painter). One module, zero drift.
//
//   initDraw({ mount, width, height, onSave, saveLabel }) → {
//     canvas,        // the paint <canvas> (this is what gets exported)
//     getDataURL(),  // current board as a PNG data URL
//     loadDataUrl(url),  // paint an existing image onto the board
//     clear(),       // wipe the board (undoable)
//     resize(w, h),  // change the board size (wipes content)
//     setGuide(fn),  // fn(ctx, w, h) draws a NON-exported template guide
//     destroy(),     // tear down listeners + DOM
//   }
//
// Tools: brush · eraser · bucket(flood fill) · line · rect · ellipse ·
// eyedropper · rect-select · lasso-select · move. Plus colour, size,
// opacity, undo / redo, clear, save. The module self-injects its CSS
// (all classes are `.dk-` prefixed) so a host page needs no extra
// stylesheet — drop it into any container.
//
// Stage = three stacked <canvas>:
//   .dk-guide   — host-drawn template outline (setGuide), NOT exported
//   .dk-canvas  — the actual paint surface (getDataURL / onSave export this)
//   .dk-overlay — live shape preview + selection marquee, NOT exported

const DK_CSS = `
.dk-root{display:flex;flex-direction:column;gap:8px;font-family:inherit}
.dk-toolbar{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px;
}
.dk-tools{
  display:flex;flex-wrap:wrap;gap:3px;
  background:var(--bg-strong,#1f232f);
  border:1px solid var(--border,rgba(255,255,255,0.08));
  border-radius:6px;padding:3px;
}
.dk-tool{
  display:flex;align-items:center;gap:4px;
  background:transparent;border:1px solid transparent;border-radius:4px;
  color:var(--text-dim,#9aa0b3);
  font-family:inherit;font-size:11px;font-weight:600;
  padding:5px 8px;cursor:pointer;white-space:nowrap;
  transition:color .12s,background .12s,border-color .12s;
}
.dk-tool:hover{color:var(--text,#e6e8ee);background:var(--bg-elev,#262a38)}
.dk-tool.on{
  color:var(--accent-dim,#7ec8f0);
  background:var(--bg-elev,#262a38);
  border-color:var(--border-strong,rgba(255,255,255,0.18));
  box-shadow:inset 0 -2px 0 0 var(--accent,#5dade2);
}
.dk-tool .dk-glyph{font-size:13px;line-height:1}
.dk-sep{width:1px;align-self:stretch;background:var(--border,rgba(255,255,255,0.08));margin:2px 1px}
.dk-field{
  display:flex;align-items:center;gap:5px;
  font-size:10.5px;color:var(--text-mute,#5a6075);font-weight:600;
}
.dk-color{
  width:30px;height:26px;padding:0;border:1px solid var(--border-strong,rgba(255,255,255,0.18));
  border-radius:5px;overflow:hidden;cursor:pointer;background:none;
}
.dk-color::-webkit-color-swatch-wrapper{padding:2px}
.dk-color::-webkit-color-swatch{border:none;border-radius:3px}
.dk-range{width:78px;height:4px;accent-color:var(--accent,#5dade2)}
.dk-num{
  min-width:30px;text-align:right;font-variant-numeric:tabular-nums;
  color:var(--text-dim,#9aa0b3);
}
.dk-btn{
  background:var(--bg-strong,#1f232f);
  border:1px solid var(--border-strong,rgba(255,255,255,0.18));
  color:var(--text-dim,#9aa0b3);
  font-family:inherit;font-size:11px;font-weight:600;
  padding:5px 9px;border-radius:5px;cursor:pointer;
  transition:color .12s,background .12s,border-color .12s;
}
.dk-btn:hover:not(:disabled){color:var(--text,#e6e8ee);border-color:var(--border-strong,rgba(255,255,255,0.28))}
.dk-btn:disabled{opacity:.4;cursor:not-allowed}
.dk-btn.primary{
  background:var(--accent,#5dade2);border-color:var(--accent,#5dade2);color:#0a0e16;
}
.dk-btn.primary:hover:not(:disabled){filter:brightness(1.1)}
.dk-stage{
  position:relative;width:100%;
  border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:6px;
  overflow:hidden;line-height:0;
  /* checkerboard so transparency reads clearly */
  background-color:#11131a;
  background-image:
    linear-gradient(45deg,#1c2030 25%,transparent 25%),
    linear-gradient(-45deg,#1c2030 25%,transparent 25%),
    linear-gradient(45deg,transparent 75%,#1c2030 75%),
    linear-gradient(-45deg,transparent 75%,#1c2030 75%);
  background-size:16px 16px;
  background-position:0 0,0 8px,8px -8px,-8px 0;
}
.dk-stage canvas{
  display:block;width:100%;height:auto;
  position:absolute;inset:0;
}
.dk-stage .dk-guide{pointer-events:none;z-index:0}
.dk-stage .dk-canvas{position:relative;z-index:1;touch-action:none;cursor:crosshair}
.dk-stage .dk-overlay{pointer-events:none;z-index:2}
.dk-hint{font-size:10px;color:var(--text-mute,#5a6075);line-height:1.5}
`;

let _cssInjected = false;
function ensureCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement("style");
  s.textContent = DK_CSS;
  document.head.appendChild(s);
}

// --- colour helpers --------------------------------------------------------
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// --- scanline flood fill ---------------------------------------------------
// Fills the connected region at (x,y) whose colour is within `tolerance`
// of the seed pixel. `inBounds(x,y)` (optional) constrains the fill to an
// active selection. A `visited` array guarantees termination even when
// the fill colour is close to the seed colour.
function floodFill(ctx, sx, sy, rgba, tolerance, inBounds) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return false;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const at = (x, y) => (y * W + x) * 4;
  const seed = at(sx, sy);
  const tr = d[seed], tg = d[seed + 1], tb = d[seed + 2], ta = d[seed + 3];
  const [fr, fg, fb, fa] = rgba;
  const tol = tolerance * tolerance * 4;
  const visited = new Uint8Array(W * H);
  const match = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    if (visited[y * W + x]) return false;
    if (inBounds && !inBounds(x, y)) return false;
    const i = at(x, y);
    const dr = d[i] - tr, dg = d[i + 1] - tg, db = d[i + 2] - tb, da = d[i + 3] - ta;
    return (dr * dr + dg * dg + db * db + da * da) <= tol;
  };
  const stack = [[sx, sy]];
  let touched = false;
  while (stack.length) {
    const [px, py] = stack.pop();
    let y = py;
    while (y >= 0 && match(px, y)) y--;
    y++;
    let spanL = false, spanR = false;
    while (y < H && match(px, y)) {
      const i = at(px, y);
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = fa;
      visited[y * W + px] = 1;
      touched = true;
      if (match(px - 1, y)) {
        if (!spanL) { stack.push([px - 1, y]); spanL = true; }
      } else spanL = false;
      if (match(px + 1, y)) {
        if (!spanR) { stack.push([px + 1, y]); spanR = true; }
      } else spanR = false;
      y++;
    }
  }
  if (touched) ctx.putImageData(img, 0, 0);
  return touched;
}

// --- tool palette ----------------------------------------------------------
const TOOLS = [
  { id: "brush",    glyph: "✏",  label: "画笔",   hint: "按住拖动自由绘制" },
  { id: "eraser",   glyph: "🩹", label: "橡皮",   hint: "擦除像素（透明）" },
  { id: "bucket",   glyph: "🪣", label: "填充",   hint: "油漆桶 — 点击填充相连色块" },
  { id: "line",     glyph: "╱",  label: "直线",   hint: "拖动画直线，松开落笔" },
  { id: "rect",     glyph: "▭",  label: "矩形",   hint: "拖动画矩形，松开落笔" },
  { id: "ellipse",  glyph: "⬭",  label: "椭圆",   hint: "拖动画椭圆，松开落笔" },
  { id: "eyedrop",  glyph: "💧", label: "吸色",   hint: "点击拾取画布上的颜色" },
  { id: "rectsel",  glyph: "⛶",  label: "选框",   hint: "拖出矩形选区；绘制 / 填充将被限制在选区内" },
  { id: "lasso",    glyph: "✣",  label: "套索",   hint: "自由勾勒选区轮廓" },
  { id: "move",     glyph: "✥",  label: "移动",   hint: "拖动选区内像素；无选区时移动整幅画" },
];

export function initDraw(opts) {
  const { mount, width = 256, height = 256, onSave, saveLabel = "💾 保存" } = opts || {};
  if (!mount) throw new Error("initDraw: `mount` is required");
  ensureCss();

  // ---- DOM ----------------------------------------------------------------
  mount.innerHTML = `
    <div class="dk-root">
      <div class="dk-toolbar">
        <div class="dk-tools">
          ${TOOLS.map((t, i) =>
            `<button class="dk-tool ${i === 0 ? "on" : ""}" data-tool="${t.id}" title="${t.hint}">
               <span class="dk-glyph">${t.glyph}</span>${t.label}
             </button>`).join("")}
        </div>
        <div class="dk-sep"></div>
        <label class="dk-field" title="颜色">
          <input type="color" class="dk-color" value="#5dade2">
        </label>
        <label class="dk-field" title="笔刷 / 描边大小">
          大小<input type="range" class="dk-range dk-size" min="1" max="96" step="1" value="10">
          <span class="dk-num dk-size-val">10</span>
        </label>
        <label class="dk-field" title="不透明度">
          透明<input type="range" class="dk-range dk-opacity" min="5" max="100" step="5" value="100">
          <span class="dk-num dk-opacity-val">100%</span>
        </label>
        <label class="dk-field dk-tol-field" title="填充容差 — 越大填得越宽松">
          容差<input type="range" class="dk-range dk-tol" min="0" max="120" step="4" value="32">
          <span class="dk-num dk-tol-val">32</span>
        </label>
        <div class="dk-sep"></div>
        <button class="dk-btn dk-undo" disabled title="撤销 (Ctrl+Z)">↶ 撤销</button>
        <button class="dk-btn dk-redo" disabled title="重做 (Ctrl+Y)">↷ 重做</button>
        <button class="dk-btn dk-deselect" disabled title="取消选区 (Esc)">⊘ 取消选区</button>
        <button class="dk-btn dk-clear" title="清空画布">🗑 清空</button>
        <button class="dk-btn primary dk-save" title="保存当前画布">${saveLabel}</button>
      </div>
      <div class="dk-stage">
        <canvas class="dk-guide" width="${width}" height="${height}"></canvas>
        <canvas class="dk-canvas" width="${width}" height="${height}"></canvas>
        <canvas class="dk-overlay" width="${width}" height="${height}"></canvas>
      </div>
      <div class="dk-hint">提示：选框 / 套索框出选区后，画笔 · 橡皮 · 填充只作用于选区内 · Esc 取消选区</div>
    </div>
  `;

  const $ = (s) => mount.querySelector(s);
  const guideCanvas = $(".dk-guide");
  const canvas = $(".dk-canvas");
  const overlay = $(".dk-overlay");
  const guideCtx = guideCanvas.getContext("2d");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const oCtx = overlay.getContext("2d");
  const colorInput = $(".dk-color");
  const sizeInput = $(".dk-size");
  const sizeVal = $(".dk-size-val");
  const opacityInput = $(".dk-opacity");
  const opacityVal = $(".dk-opacity-val");
  const tolInput = $(".dk-tol");
  const tolVal = $(".dk-tol-val");
  const undoBtn = $(".dk-undo");
  const redoBtn = $(".dk-redo");
  const deselectBtn = $(".dk-deselect");

  // ---- state --------------------------------------------------------------
  let tool = "brush";
  let guideFn = null;
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO = 30;

  // selection: null, or { points: [{x,y},...] } in canvas coords (a closed
  // polygon — rect selections store 4 corners, lasso stores the freeform path).
  let selection = null;

  // active pointer operation; shape varies by tool.
  let op = null;
  let _raf = 0;

  // ---- undo / redo --------------------------------------------------------
  function snapshot() {
    try { return ctx.getImageData(0, 0, canvas.width, canvas.height); }
    catch { return null; }
  }
  function pushUndo() {
    const snap = snapshot();
    if (!snap) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    syncButtons();
  }
  function undo() {
    if (!undoStack.length) return;
    const cur = snapshot();
    if (cur) redoStack.push(cur);
    const prev = undoStack.pop();
    ctx.putImageData(prev, 0, 0);
    syncButtons();
  }
  function redo() {
    if (!redoStack.length) return;
    const cur = snapshot();
    if (cur) undoStack.push(cur);
    const next = redoStack.pop();
    ctx.putImageData(next, 0, 0);
    syncButtons();
  }
  function syncButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    deselectBtn.disabled = !selection;
  }

  // ---- selection ----------------------------------------------------------
  function selPath() {
    if (!selection || selection.points.length < 3) return null;
    const p = new Path2D();
    const pts = selection.points;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.closePath();
    return p;
  }
  // Pixel-precision predicate for flood fill (canvas's isPointInPath is the
  // simplest correct point-in-polygon for our closed selection polygons).
  function selContains(x, y) {
    const path = selPath();
    if (!path) return true;
    return oCtx.isPointInPath(path, x + 0.5, y + 0.5);
  }
  function setSelection(points) {
    selection = points && points.length >= 3 ? { points } : null;
    syncButtons();
    kickOverlay();
  }
  function clearSelection() {
    if (!selection) return;
    selection = null;
    syncButtons();
    kickOverlay();
  }
  // Apply the active selection as a clip before a drawing op, if any.
  function withClip(fn) {
    const path = selPath();
    if (path) {
      ctx.save();
      ctx.clip(path);
      fn();
      ctx.restore();
    } else {
      fn();
    }
  }

  // ---- overlay (marquee + live shape / move preview) ----------------------
  function needsOverlay() { return !!selection || !!op; }
  function kickOverlay() {
    if (needsOverlay()) {
      if (!_raf) _raf = requestAnimationFrame(renderOverlay);
    } else {
      if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
      oCtx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }
  function renderOverlay() {
    _raf = 0;
    oCtx.clearRect(0, 0, overlay.width, overlay.height);

    // live move-float preview
    if (op && op.type === "move" && op.float) {
      oCtx.drawImage(op.float, op.dx, op.dy);
    }
    // live shape preview
    if (op && op.type === "shape") {
      drawShape(oCtx, op.tool, op.start, op.cur, true);
    }
    // live selection-being-drawn preview
    if (op && (op.type === "rectsel" || op.type === "lasso")) {
      strokeMarquee(op.previewPoints || [], 0);
    }
    // committed selection marquee (animated marching ants)
    if (selection) {
      const pts = op && op.type === "move" && op.movedSel ? op.movedSel : selection.points;
      strokeMarquee(pts, performance.now() / 60);
    }
    if (needsOverlay()) _raf = requestAnimationFrame(renderOverlay);
  }
  function strokeMarquee(pts, dashPhase) {
    if (!pts || pts.length < 2) return;
    oCtx.save();
    oCtx.beginPath();
    oCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) oCtx.lineTo(pts[i].x, pts[i].y);
    if (pts.length >= 3) oCtx.closePath();
    oCtx.lineWidth = 1.5;
    oCtx.strokeStyle = "rgba(0,0,0,0.85)";
    oCtx.setLineDash([5, 4]);
    oCtx.lineDashOffset = -dashPhase;
    oCtx.stroke();
    oCtx.strokeStyle = "rgba(255,255,255,0.95)";
    oCtx.lineDashOffset = -dashPhase + 4.5;
    oCtx.stroke();
    oCtx.restore();
  }

  // ---- drawing primitives -------------------------------------------------
  function strokeColor() {
    const [r, g, b] = hexToRgb(colorInput.value);
    const a = Number(opacityInput.value) / 100;
    return `rgba(${r},${g},${b},${a})`;
  }
  function brushSegment(targetCtx, a, b, erase) {
    const w = Number(sizeInput.value);
    targetCtx.save();
    targetCtx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    targetCtx.strokeStyle = erase ? "rgba(0,0,0,1)" : strokeColor();
    targetCtx.fillStyle = targetCtx.strokeStyle;
    targetCtx.lineWidth = w;
    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    targetCtx.beginPath();
    targetCtx.moveTo(a.x, a.y);
    targetCtx.lineTo(b.x, b.y);
    targetCtx.stroke();
    targetCtx.beginPath();
    targetCtx.arc(b.x, b.y, w / 2, 0, Math.PI * 2);
    targetCtx.fill();
    targetCtx.restore();
  }
  // line / rect / ellipse — `preview` true renders onto the overlay in an
  // accent colour; false commits the real shape onto the paint canvas.
  function drawShape(targetCtx, shapeTool, a, b, preview) {
    const w = Number(sizeInput.value);
    targetCtx.save();
    if (preview) {
      targetCtx.strokeStyle = "#5dade2";
      targetCtx.fillStyle = "rgba(93,173,226,0.18)";
      targetCtx.lineWidth = Math.max(1, w);
      targetCtx.setLineDash([4, 3]);
    } else {
      targetCtx.strokeStyle = strokeColor();
      targetCtx.fillStyle = strokeColor();
      targetCtx.lineWidth = w;
    }
    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    if (shapeTool === "line") {
      targetCtx.beginPath();
      targetCtx.moveTo(a.x, a.y);
      targetCtx.lineTo(b.x, b.y);
      targetCtx.stroke();
    } else if (shapeTool === "rect") {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
      targetCtx.strokeRect(x, y, rw, rh);
    } else if (shapeTool === "ellipse") {
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      targetCtx.beginPath();
      targetCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      targetCtx.stroke();
    }
    targetCtx.restore();
  }

  // ---- pointer → canvas coords -------------------------------------------
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * canvas.width,
      y: (e.clientY - r.top) / r.height * canvas.height,
    };
  }

  // ---- pointer handlers ---------------------------------------------------
  function onDown(e) {
    const p = pos(e);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    if (tool === "brush" || tool === "eraser") {
      pushUndo();
      op = { type: "free", last: p, erase: tool === "eraser" };
      withClip(() => brushSegment(ctx, p, p, op.erase));
      return;
    }
    if (tool === "bucket") {
      pushUndo();
      const [r, g, b] = hexToRgb(colorInput.value);
      const a = Math.round(Number(opacityInput.value) / 100 * 255);
      const tol = Number(tolInput.value);
      const inBounds = selection ? selContains : null;
      floodFill(ctx, p.x, p.y, [r, g, b, a], tol, inBounds);
      return;
    }
    if (tool === "eyedrop") {
      try {
        const d = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
        if (d[3] > 0) colorInput.value = rgbToHex(d[0], d[1], d[2]);
      } catch { /* ignore */ }
      return;
    }
    if (tool === "line" || tool === "rect" || tool === "ellipse") {
      op = { type: "shape", tool, start: p, cur: p };
      kickOverlay();
      return;
    }
    if (tool === "rectsel") {
      op = { type: "rectsel", start: p, previewPoints: [] };
      kickOverlay();
      return;
    }
    if (tool === "lasso") {
      op = { type: "lasso", previewPoints: [p] };
      kickOverlay();
      return;
    }
    if (tool === "move") {
      pushUndo();
      // Lift the moving pixels onto a float canvas, clear them from the
      // base. With a selection: just the selected region. Without: the
      // whole board.
      const float = document.createElement("canvas");
      float.width = canvas.width;
      float.height = canvas.height;
      const fCtx = float.getContext("2d");
      fCtx.drawImage(canvas, 0, 0);
      const path = selPath();
      if (path) {
        // mask the float down to the selection
        fCtx.globalCompositeOperation = "destination-in";
        fCtx.fill(path);
        fCtx.globalCompositeOperation = "source-over";
        // erase the selected pixels from the base
        ctx.save();
        ctx.clip(path);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      op = { type: "move", float, grab: p, dx: 0, dy: 0,
             movedSel: selection ? selection.points.map((q) => ({ ...q })) : null };
      kickOverlay();
      return;
    }
  }
  function onMove(e) {
    if (!op) return;
    const p = pos(e);
    if (op.type === "free") {
      withClip(() => brushSegment(ctx, op.last, p, op.erase));
      op.last = p;
    } else if (op.type === "shape") {
      op.cur = p;
    } else if (op.type === "rectsel") {
      const a = op.start;
      op.previewPoints = [
        { x: a.x, y: a.y }, { x: p.x, y: a.y },
        { x: p.x, y: p.y }, { x: a.x, y: p.y },
      ];
    } else if (op.type === "lasso") {
      const last = op.previewPoints[op.previewPoints.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) {
        op.previewPoints.push(p);
      }
    } else if (op.type === "move") {
      op.dx = p.x - op.grab.x;
      op.dy = p.y - op.grab.y;
      if (selection) {
        op.movedSel = selection.points.map((q) => ({ x: q.x + op.dx, y: q.y + op.dy }));
      }
    }
  }
  function onUp(e) {
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!op) return;
    const cur = op;
    op = null;

    if (cur.type === "shape") {
      pushUndo();
      withClip(() => drawShape(ctx, cur.tool, cur.start, cur.cur, false));
    } else if (cur.type === "rectsel") {
      const pts = cur.previewPoints;
      // a too-tiny drag clears the selection instead of making a sliver
      if (pts.length === 4 &&
          Math.abs(pts[2].x - pts[0].x) > 3 && Math.abs(pts[2].y - pts[0].y) > 3) {
        setSelection(pts);
      } else {
        clearSelection();
      }
    } else if (cur.type === "lasso") {
      if (cur.previewPoints.length >= 3) setSelection(cur.previewPoints);
      else clearSelection();
    } else if (cur.type === "move") {
      // The pre-move snapshot was already taken in onDown (before lifting
      // pixels onto the float), so committing here needs no second pushUndo.
      ctx.drawImage(cur.float, cur.dx, cur.dy);
      if (selection && cur.movedSel) selection = { points: cur.movedSel };
    }
    kickOverlay();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- toolbar wiring -----------------------------------------------------
  mount.querySelector(".dk-tools").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tool]");
    if (!btn) return;
    tool = btn.dataset.tool;
    mount.querySelectorAll(".dk-tool").forEach((b) => b.classList.toggle("on", b === btn));
  });
  sizeInput.addEventListener("input", () => { sizeVal.textContent = sizeInput.value; });
  opacityInput.addEventListener("input", () => { opacityVal.textContent = opacityInput.value + "%"; });
  tolInput.addEventListener("input", () => { tolVal.textContent = tolInput.value; });
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  deselectBtn.addEventListener("click", clearSelection);
  $(".dk-clear").addEventListener("click", () => {
    // "清空" always wipes the whole board (the least-surprising meaning of
    // a trash button) — the selection clip is for drawing tools, not this.
    pushUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
  $(".dk-save").addEventListener("click", () => {
    // Don't save a fully-blank board.
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let any = false;
    for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) { any = true; break; } }
    if (!any) return;
    if (onSave) onSave(canvas.toDataURL("image/png"));
  });

  // keyboard: Ctrl+Z / Ctrl+Y / Esc — scoped to when the mount is in the DOM.
  function onKey(e) {
    if (!mount.isConnected) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Escape") {
      clearSelection();
    }
  }
  window.addEventListener("keydown", onKey);

  // ---- guide --------------------------------------------------------------
  function renderGuide() {
    guideCtx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
    if (guideFn) {
      guideCtx.save();
      try { guideFn(guideCtx, guideCanvas.width, guideCanvas.height); } catch { /* ignore */ }
      guideCtx.restore();
    }
  }

  // ---- public API ---------------------------------------------------------
  syncButtons();

  return {
    canvas,
    getDataURL() { return canvas.toDataURL("image/png"); },
    loadDataUrl(url) {
      const img = new Image();
      img.onload = () => {
        pushUndo();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const s = Math.min(canvas.width / img.width, canvas.height / img.height);
        const dw = img.width * s, dh = img.height * s;
        ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      };
      img.src = url;
    },
    clear() {
      pushUndo();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      clearSelection();
    },
    /** Programmatic deselect — exposed so a host page can clear the
     *  active selection (e.g. when switching die templates). */
    deselect() { clearSelection(); },
    resize(w, h) {
      w = Math.max(16, Math.round(w));
      h = Math.max(16, Math.round(h));
      [guideCanvas, canvas, overlay].forEach((c) => { c.width = w; c.height = h; });
      undoStack.length = 0;
      redoStack.length = 0;
      selection = null;
      op = null;
      syncButtons();
      renderGuide();
      kickOverlay();
    },
    setGuide(fn) {
      guideFn = typeof fn === "function" ? fn : null;
      renderGuide();
    },
    destroy() {
      window.removeEventListener("keydown", onKey);
      if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
      mount.innerHTML = "";
    },
  };
}
