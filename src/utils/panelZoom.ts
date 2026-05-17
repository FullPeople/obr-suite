// Per-iframe content-zoom for panels users can resize from the layout
// editor.
//
// When the user pulls a panel bigger via the layout-editor's resize
// handle (or smaller via the per-panel min clamp), we want the
// content INSIDE the panel to scale with it — bigger panel = bigger
// text, padding, click targets; smaller panel = smaller. Without
// scaling, a stretched panel just adds whitespace and a shrunk panel
// truncates content.
//
// Implementation: Chrome's CSS `zoom` property scales an element and
// all of its descendants as a single visual unit. We set
// `--panel-zoom` on a target element (usually the root container)
// and that element's CSS rule reads the variable via `zoom: var(...)`.
//
// Scale is the MIN of width-ratio and height-ratio — we want the
// content to fit BOTH axes, so we scale to the smaller dimension's
// ratio.

export interface PanelZoomOpts {
  /** Iframe-relative width the design was authored at. */
  baseWidth: number;
  /** Iframe-relative height the design was authored at. */
  baseHeight: number;
  /** Element to set `--panel-zoom` on. The element's own CSS must
   *  read the variable via `zoom: var(--panel-zoom, 1)`. Defaults to
   *  `document.documentElement`. */
  target?: HTMLElement;
  /** Lower clamp on the zoom factor. Default 0.7 — below this text
   *  gets unreadable. */
  min?: number;
  /** Upper clamp. Default 1.7 — above this the panel feels
   *  cartoonish and click targets get unwieldy. */
  max?: number;
}

/**
 * Install a viewport-resize listener that recomputes `--panel-zoom`
 * on the target element. Returns an unbind fn.
 *
 * Call from OBR.onReady (or whenever the iframe knows its size baseline).
 * Idempotent per `target` — calling twice on the same element replaces
 * the previous listener.
 */
export function installPanelZoom(opts: PanelZoomOpts): () => void {
  const baseW = Math.max(1, opts.baseWidth);
  const baseH = Math.max(1, opts.baseHeight);
  const minZoom = opts.min ?? 0.7;
  const maxZoom = opts.max ?? 1.7;
  const target = opts.target ?? document.documentElement;

  // Replace any previous installation on the same target so the
  // listener doesn't leak across hot-reloads or repeated calls.
  const prev = (target as any).__panelZoomUnbind as (() => void) | undefined;
  if (typeof prev === "function") prev();

  const update = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 0 || h <= 0) return;
    const ratio = Math.min(w / baseW, h / baseH);
    const clamped = Math.max(minZoom, Math.min(maxZoom, ratio));
    target.style.setProperty("--panel-zoom", String(clamped));
  };

  update();
  window.addEventListener("resize", update);
  const unbind = () => {
    window.removeEventListener("resize", update);
    target.style.removeProperty("--panel-zoom");
    delete (target as any).__panelZoomUnbind;
  };
  (target as any).__panelZoomUnbind = unbind;
  return unbind;
}
