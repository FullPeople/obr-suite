// Perf-window iframe entry. Renders FPS + an approximate drawcall
// count in a tiny draggable popover (top-left by default).
//
// FPS is measured via a frame-counting rAF loop inside this iframe —
// it's the iframe's own paint cadence, which on modern browsers
// matches the parent OBR canvas closely enough to be a useful proxy.
//
// Drawcall is approximated by `OBR.scene.items.getItems().length`
// (every Image / Curve / Text / Effect is roughly one draw operation
// per frame). OBR doesn't expose a real renderer counter; this is the
// closest we can get without instrumenting the rendering pipeline.

import OBR from "@owlbear-rodeo/sdk";
import { bindPanelDrag } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import { installDebugOverlay } from "./utils/debugOverlay";

const fpsEl = document.getElementById("fps") as HTMLSpanElement;
const drawEl = document.getElementById("draw") as HTMLSpanElement;

// rAF-based FPS sampler — counts frames over a 1-second window and
// reports the rounded rate. Stays close to the canvas refresh rate
// because the browser throttles rAF in invisible / occluded iframes,
// matching when the user can't see the canvas anyway.
let frameCount = 0;
let lastTime = performance.now();
let lastFps = 0;
function tickFps() {
  const now = performance.now();
  frameCount++;
  if (now - lastTime >= 1000) {
    lastFps = Math.round((frameCount * 1000) / (now - lastTime));
    frameCount = 0;
    lastTime = now;
    if (fpsEl) {
      fpsEl.textContent = String(lastFps);
      fpsEl.classList.remove("warn", "bad");
      if (lastFps < 20) fpsEl.classList.add("bad");
      else if (lastFps < 40) fpsEl.classList.add("warn");
    }
  }
  requestAnimationFrame(tickFps);
}
requestAnimationFrame(tickFps);

// Approximate drawcall = item count. Sample on scene-items change
// (rare) + a 2s tick fallback (catches scenes whose items don't fire
// onChange events but where item count visibly drifts).
let lastDraw = 0;
async function refreshDraw(): Promise<void> {
  try {
    const items = await OBR.scene.items.getItems();
    const n = items.length;
    if (n === lastDraw) return;
    lastDraw = n;
    if (drawEl) {
      drawEl.textContent = String(n);
      drawEl.classList.remove("warn", "bad");
      if (n > 800) drawEl.classList.add("bad");
      else if (n > 400) drawEl.classList.add("warn");
    }
  } catch {}
}

OBR.onReady(() => {
  installDebugOverlay();
  void refreshDraw();
  // onChange refresh — most accurate, no polling cost when scene is
  // idle.
  OBR.scene.items.onChange(() => { void refreshDraw(); });
  // 2s fallback so the count stays current even if onChange misses
  // (e.g. when only metadata-without-id changes flow through).
  setInterval(() => { void refreshDraw(); }, 2000);
});

// Drag handle wired into the same panelLayout system as the other
// suite panels — broadcast to background, ghost preview tracks the
// gesture, drag-end persists the offset to localStorage.
const dragHandle = document.getElementById("drag-handle");
if (dragHandle) bindPanelDrag(dragHandle, PANEL_IDS.perfWindow);
