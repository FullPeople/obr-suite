// Polygon / lasso fill — scanline-rasterise a closed polygon onto
// the mask.
//
// Even-odd rule: a pixel is "inside" if a horizontal ray from it
// crosses an odd number of polygon edges.

import type { Vec2 } from "../types";

export function fillPolygon(
  mask: Uint8Array,
  w: number,
  h: number,
  pts: Vec2[],
  paint: boolean,
): void {
  if (pts.length < 3) return;
  const value = paint ? 255 : 0;
  // Bounding box.
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));

  for (let y = y0; y <= y1; y++) {
    // Find x-intersections for scanline y + 0.5.
    const xs: number[] = [];
    const yc = y + 0.5;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        const t = (yc - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((a, b) => a - b);
    // Pair-wise: fill between (xs[0], xs[1]), (xs[2], xs[3]), ...
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.floor(xs[i]));
      const xb = Math.min(w - 1, Math.ceil(xs[i + 1]));
      const row = y * w;
      for (let x = xa; x <= xb; x++) mask[row + x] = value;
    }
  }
}

export function fillRectangle(
  mask: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  paint: boolean,
): void {
  const value = paint ? 255 : 0;
  const xa = Math.max(0, Math.floor(Math.min(x0, x1)));
  const xb = Math.min(w - 1, Math.ceil(Math.max(x0, x1)));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1)));
  const yb = Math.min(h - 1, Math.ceil(Math.max(y0, y1)));
  for (let y = ya; y <= yb; y++) {
    const row = y * w;
    for (let x = xa; x <= xb; x++) mask[row + x] = value;
  }
}
