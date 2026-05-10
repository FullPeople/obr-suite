// Pan / zoom transform for the editor canvas.
//
// view = (panX, panY, zoom). image-space → screen-space:
//   sx = imageX * zoom + panX
//   sy = imageY * zoom + panY

export interface View {
  panX: number;
  panY: number;
  zoom: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 16;

export function viewToImage(v: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
}

export function imageToView(v: View, ix: number, iy: number): { x: number; y: number } {
  return { x: ix * v.zoom + v.panX, y: iy * v.zoom + v.panY };
}

/** Fit image into viewport (with margin). Mutates view. */
export function fitToView(
  view: View,
  imgW: number,
  imgH: number,
  vpW: number,
  vpH: number,
  margin: number = 0.95,
): void {
  const zx = vpW / imgW;
  const zy = vpH / imgH;
  view.zoom = Math.min(zx, zy) * margin;
  view.panX = (vpW - imgW * view.zoom) / 2;
  view.panY = (vpH - imgH * view.zoom) / 2;
}

/** Zoom around a screen-space anchor. Mutates view. */
export function zoomAt(view: View, sx: number, sy: number, factor: number): void {
  const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * factor));
  if (next === view.zoom) return;
  // Keep image-point under cursor anchored.
  const wp = viewToImage(view, sx, sy);
  view.zoom = next;
  view.panX = sx - wp.x * view.zoom;
  view.panY = sy - wp.y * view.zoom;
}
