// Binary morphology — erode / dilate / open / close on Uint8 masks
// with rectangular kernels.
//
// Uses 4-pass (van Herk / Gil-Werman) decomposition: a separable
// row+column pass with monotonic-queue min/max. O(w*h) regardless
// of kernel size — important because we want to support kernels
// up to ~30 px without a noticeable hitch.

function rowMinMax(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
  isMax: boolean,
): Uint8Array {
  // Sliding window of half-size r = floor(k/2). For monotonic queue
  // of size k along each row, output[x] = max/min over [x-r, x+r].
  const r = Math.floor(k / 2);
  const out = new Uint8Array(mask.length);
  const queue = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let qHead = 0, qTail = 0;
    // Initialize: push x=0..r-1 onto queue.
    for (let x = -r; x < w + r; x++) {
      // Push current x (if in range).
      if (x >= 0 && x < w) {
        const v = mask[row + x];
        if (isMax) {
          while (qTail > qHead && mask[row + queue[qTail - 1]] <= v) qTail--;
        } else {
          while (qTail > qHead && mask[row + queue[qTail - 1]] >= v) qTail--;
        }
        queue[qTail++] = x;
      }
      // Pop expired.
      const cx = x - r;
      if (cx >= 0 && cx < w) {
        while (qHead < qTail && queue[qHead] < cx - r) qHead++;
        out[row + cx] = mask[row + queue[qHead]];
      }
    }
  }
  return out;
}

function colMinMax(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
  isMax: boolean,
): Uint8Array {
  const r = Math.floor(k / 2);
  const out = new Uint8Array(mask.length);
  const queue = new Int32Array(h);
  for (let x = 0; x < w; x++) {
    let qHead = 0, qTail = 0;
    for (let y = -r; y < h + r; y++) {
      if (y >= 0 && y < h) {
        const v = mask[y * w + x];
        if (isMax) {
          while (qTail > qHead && mask[queue[qTail - 1] * w + x] <= v) qTail--;
        } else {
          while (qTail > qHead && mask[queue[qTail - 1] * w + x] >= v) qTail--;
        }
        queue[qTail++] = y;
      }
      const cy = y - r;
      if (cy >= 0 && cy < h) {
        while (qHead < qTail && queue[qHead] < cy - r) qHead++;
        out[cy * w + x] = mask[queue[qHead] * w + x];
      }
    }
  }
  return out;
}

export function dilate(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  return colMinMax(rowMinMax(mask, w, h, k, true), w, h, k, true);
}

export function erode(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  return colMinMax(rowMinMax(mask, w, h, k, false), w, h, k, false);
}

export function open(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  return dilate(erode(mask, w, h, k), w, h, k);
}

export function close(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  return erode(dilate(mask, w, h, k), w, h, k);
}
