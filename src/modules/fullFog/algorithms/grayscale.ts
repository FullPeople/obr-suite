// Grayscale conversion + simple threshold.
//
// All algorithms in fullFog operate on Uint8 masks the same size as
// the source image. A pixel value of 255 = "wall", 0 = "background".
// Working in Uint8 lets us use ImageData round-trips for free.

/** Compute grayscale buffer from RGBA ImageData. Returns Uint8Array
 *  (single channel, length = w*h). Uses ITU-R BT.601 luma. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    // 0.299 R + 0.587 G + 0.114 B  (BT.601 luma)
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

/** Simple grayscale threshold. mask[i] = gray[i] < T ? 255 : 0. */
export function thresholdMask(gray: Uint8Array, T: number): Uint8Array {
  const n = gray.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = gray[i] < T ? 255 : 0;
  return out;
}

/** Gaussian blur 3×3 separable (sigma ≈ 0.85). In-place safe by way
 *  of intermediate buffer. */
export function gaussBlur3(gray: Uint8Array, w: number, h: number): Uint8Array {
  // Horizontal pass into tmp, vertical pass into out.
  const tmp = new Uint8Array(gray.length);
  const out = new Uint8Array(gray.length);
  // Kernel [1, 2, 1] / 4 — quick approximation of small Gaussian.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      tmp[row + x] = (gray[row + xm] + gray[row + x] * 2 + gray[row + xp]) >> 2;
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const ym = y > 0 ? (y - 1) * w : 0;
    const yp = y < h - 1 ? (y + 1) * w : (h - 1) * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = (tmp[ym + x] + tmp[row + x] * 2 + tmp[yp + x]) >> 2;
    }
  }
  return out;
}

/** Gaussian blur 5×5 (kernel [1,4,6,4,1] / 16). */
export function gaussBlur5(gray: Uint8Array, w: number, h: number): Uint8Array {
  const tmp = new Uint8Array(gray.length);
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 2), x1 = Math.max(0, x - 1);
      const x3 = Math.min(w - 1, x + 1), x4 = Math.min(w - 1, x + 2);
      tmp[row + x] = (gray[row + x0] + gray[row + x1] * 4 + gray[row + x] * 6
        + gray[row + x3] * 4 + gray[row + x4]) >> 4;
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const y0 = Math.max(0, y - 2) * w, y1 = Math.max(0, y - 1) * w;
    const y3 = Math.min(h - 1, y + 1) * w, y4 = Math.min(h - 1, y + 2) * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = (tmp[y0 + x] + tmp[y1 + x] * 4 + tmp[row + x] * 6
        + tmp[y3 + x] * 4 + tmp[y4 + x]) >> 4;
    }
  }
  return out;
}
