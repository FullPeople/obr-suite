// Flood-fill on the IMAGE (magic wand) and on the MASK (paint bucket).
//
// Both use 4-connectivity scanline-flood (efficient — no recursion,
// no per-pixel queue blow-up).

/** Magic wand: 4-conn flood from (sx, sy) on the source image; pixels
 *  within `tol` Euclidean RGB distance of the seed pixel get added to
 *  mask. Returns count of pixels added. */
export function magicWand(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tol: number,
  paint: boolean,
): number {
  const ix = sx | 0;
  const iy = sy | 0;
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0;
  const i0 = (iy * w + ix) * 4;
  const r0 = rgba[i0], g0 = rgba[i0 + 1], b0 = rgba[i0 + 2];
  const t2 = tol * tol;
  const visited = new Uint8Array(w * h);
  const value = paint ? 255 : 0;
  let added = 0;
  // Scanline flood.
  const stack: number[] = [iy * w + ix];
  visited[iy * w + ix] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    const y = (idx / w) | 0;
    const x = idx - y * w;
    // Find left / right extents of run.
    let xa = x;
    while (xa > 0 && !visited[idx - (x - xa) - 1] && colorClose(rgba, (y * w + xa - 1) * 4, r0, g0, b0, t2)) xa--;
    let xb = x;
    while (xb < w - 1 && !visited[idx + (xb - x) + 1] && colorClose(rgba, (y * w + xb + 1) * 4, r0, g0, b0, t2)) xb++;
    // Fill the run.
    for (let xi = xa; xi <= xb; xi++) {
      const ii = y * w + xi;
      visited[ii] = 1;
      mask[ii] = value;
      added++;
      // Seed runs above / below.
      if (y > 0) {
        const up = ii - w;
        if (!visited[up] && colorClose(rgba, up * 4, r0, g0, b0, t2)) stack.push(up);
      }
      if (y < h - 1) {
        const dn = ii + w;
        if (!visited[dn] && colorClose(rgba, dn * 4, r0, g0, b0, t2)) stack.push(dn);
      }
    }
  }
  return added;
}

function colorClose(rgba: Uint8ClampedArray, i: number, r: number, g: number, b: number, t2: number): boolean {
  const dr = rgba[i] - r;
  const dg = rgba[i + 1] - g;
  const db = rgba[i + 2] - b;
  return dr * dr + dg * dg + db * db <= t2;
}

/** Paint bucket: 4-conn flood on the MASK from (sx, sy). Fills all
 *  connected pixels of the same value (0 OR 255) as the seed, swapping
 *  them to the opposite. Returns count flipped. */
export function paintBucket(
  mask: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
): number {
  const ix = sx | 0;
  const iy = sy | 0;
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0;
  const seed = mask[iy * w + ix];
  const newVal = seed ? 0 : 255;
  let flipped = 0;
  const stack: number[] = [iy * w + ix];
  while (stack.length) {
    const idx = stack.pop()!;
    if (mask[idx] !== seed) continue;
    const y = (idx / w) | 0;
    const x = idx - y * w;
    // Find run.
    let xa = x;
    while (xa > 0 && mask[idx - (x - xa) - 1] === seed) xa--;
    let xb = x;
    while (xb < w - 1 && mask[idx + (xb - x) + 1] === seed) xb++;
    for (let xi = xa; xi <= xb; xi++) {
      const ii = y * w + xi;
      if (mask[ii] !== seed) continue;
      mask[ii] = newVal;
      flipped++;
      if (y > 0 && mask[ii - w] === seed) stack.push(ii - w);
      if (y < h - 1 && mask[ii + w] === seed) stack.push(ii + w);
    }
  }
  return flipped;
}
