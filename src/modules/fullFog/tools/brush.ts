// Brush / eraser — paint a circular stroke onto the mask.
//
// We rasterize the stroke as a stamped circle plus connecting line
// segments so fast pointer moves don't leave gaps.

/** Stamp a filled circle into mask (set pixels to 255 if paint, 0 if erase). */
export function stampCircle(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  paint: boolean,
): void {
  const value = paint ? 255 : 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy2 <= r2) mask[y * w + x] = value;
    }
  }
}

/** Connect two stamps with a thick line — Bresenham-stamped circles. */
export function stampSegment(
  mask: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  paint: boolean,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1) {
    stampCircle(mask, w, h, x1, y1, radius, paint);
    return;
  }
  // Step at half-radius so circles overlap.
  const step = Math.max(1, radius / 2);
  const n = Math.ceil(d / step);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    stampCircle(mask, w, h, x0 + dx * t, y0 + dy * t, radius, paint);
  }
}
