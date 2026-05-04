// Debug-overlay helper.
//
// When the user flips "调试模式" / "Debug mode" in Settings → 基础
// 设置, every suite iframe puts a translucent yellow tint on its
// `body` (and a dashed outline) so the user can see EXACTLY which
// pixels are click-blocking on the canvas. Specifically useful for
// popovers whose visible content is smaller than the iframe rect
// (e.g. cluster-row before width re-measure, drag-grip overflow,
// etc.).
//
// Wiring:
//   1. settings.ts owns the toggle. Flipping it writes
//      localStorage[LS_DEBUG_OVERLAY] AND broadcasts BC_DEBUG_OVERLAY
//      LOCAL.
//   2. Every iframe calls `installDebugOverlay()` once on OBR.onReady.
//      The helper reads LS to apply the initial state, then listens
//      for BC_DEBUG_OVERLAY to live-update without a reload.
//   3. CSS rule (added by this helper) tints body when the class is
//      present. Iframes with translucent backgrounds can override the
//      tint via more-specific selectors if needed.

import OBR from "@owlbear-rodeo/sdk";

export const LS_DEBUG_OVERLAY = "obr-suite/debug-overlay";
export const BC_DEBUG_OVERLAY = "com.obr-suite/debug-overlay";

export function isDebugOverlayOn(): boolean {
  try { return localStorage.getItem(LS_DEBUG_OVERLAY) === "1"; }
  catch { return false; }
}

export function setDebugOverlay(on: boolean): void {
  try { localStorage.setItem(LS_DEBUG_OVERLAY, on ? "1" : "0"); } catch {}
  try {
    OBR.broadcast.sendMessage(
      BC_DEBUG_OVERLAY,
      { on },
      { destination: "LOCAL" },
    );
  } catch {}
}

let cssInjected = false;
function injectStyleOnce(): void {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
body.debug-overlay-on {
  background: rgba(245, 166, 35, 0.18) !important;
  outline: 2px dashed rgba(245, 166, 35, 0.55);
  outline-offset: -2px;
}
body.debug-overlay-on::before {
  content: "DEBUG";
  position: fixed;
  top: 2px; right: 4px;
  font: 700 9px ui-monospace, Consolas, monospace;
  letter-spacing: 0.3px;
  color: rgba(245, 166, 35, 0.9);
  background: rgba(0, 0, 0, 0.45);
  padding: 1px 4px;
  border-radius: 3px;
  pointer-events: none;
  z-index: 99999;
}
`;
  document.head.appendChild(style);
}

function applyBodyClass(on: boolean): void {
  document.body.classList.toggle("debug-overlay-on", on);
}

let installed = false;
export function installDebugOverlay(): void {
  if (installed) return;
  installed = true;
  injectStyleOnce();
  // Apply initial state from LS so iframes mounted while the flag is
  // on come up with the tint immediately.
  applyBodyClass(isDebugOverlayOn());
  try {
    OBR.broadcast.onMessage(BC_DEBUG_OVERLAY, (event) => {
      const data = event.data as { on?: boolean } | undefined;
      const on = !!data?.on;
      try { localStorage.setItem(LS_DEBUG_OVERLAY, on ? "1" : "0"); } catch {}
      applyBodyClass(on);
    });
  } catch {}
}
