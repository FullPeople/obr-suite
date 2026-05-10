// Adaptive thresholding — per-pixel threshold = blur(gray) - C.
//
// Equivalent to OpenCV ADAPTIVE_THRESH_GAUSSIAN_C with THRESH_BINARY_INV.
// We use a separable box-blur as a Gaussian approximation; it's two
// orders of magnitude faster than a true Gaussian convolution at large
// block sizes and visually identical for thresholding.

/** Box-blur with given window radius via integral-image. O(w*h). */
function boxBlur(gray: Uint8Array, w: number, h: number, radius: number): Float32Array {
  const sat = new Float32Array((w + 1) * (h + 1));
  // Build summed-area table.
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const A = sat[y0 * (w + 1) + x0];
      const B = sat[y0 * (w + 1) + x1 + 1];
      const C = sat[(y1 + 1) * (w + 1) + x0];
      const D = sat[(y1 + 1) * (w + 1) + x1 + 1];
      out[y * w + x] = (D - B - C + A) / area;
    }
  }
  return out;
}

/** Adaptive Gaussian threshold (binary inverse).
 *  block: window size; must be odd ≥ 3. C: bias subtracted from the
 *  local mean. mask = 255 where gray < (localMean - C). */
export function adaptiveMask(
  gray: Uint8Array,
  w: number,
  h: number,
  block: number = 51,
  C: number = 10,
): Uint8Array {
  const radius = Math.max(1, Math.floor(block / 2));
  const blurred = boxBlur(gray, w, h, radius);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    out[i] = gray[i] < blurred[i] - C ? 255 : 0;
  }
  return out;
}
