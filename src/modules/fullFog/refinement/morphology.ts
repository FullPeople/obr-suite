// Binary morphology — erode / dilate / open / close on Uint8 masks
// with rectangular kernels.
//
// Two implementations, same answer:
//
//   * GENERAL — 4-pass (van Herk / Gil-Werman) decomposition, a
//     separable row+column pass with a monotonic min/max queue. Works
//     for any byte values. O(w*h) regardless of kernel size.
//
//   * BINARY — the same separable decomposition, but a window's max /
//     min is derived from a running COUNT of set pixels instead of a
//     monotonic queue. Only valid when every byte is 0 or 255, which
//     every mask in this editor is: brush, polygon, flood fill and the
//     thresholding algorithms all write `paint ? 255 : 0`, and
//     `traceContours` reads them back as `> 127`.
//
// The binary path is picked by actually CHECKING the input (one linear
// scan, a couple of ms on a 6.6 Mpx mask) rather than by assuming, so a
// future caller that puts other values in a mask still gets the right
// answer from the general path.
//
// Why bother: open/close on a 3000x2200 map ran ~350 ms each, and the
// user clicks them repeatedly while tuning a trace. The queue's inner
// while-loops and its double indirection (`mask[row + queue[qTail-1]]`)
// cost far more than the arithmetic they save on two-valued data.
//
// Border convention, which BOTH paths must honour: the window is
// [c-r, c+r] CLAMPED to the array, not padded. A pixel at x=0 sees a
// window of r+1, not 2r+1.

const ON = 255;
const OFF = 0;

/** Every byte 0 or 255? Decides which implementation is valid. */
function isBinaryMask(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    if (v !== OFF && v !== ON) return false;
  }
  return true;
}

// --- general path -----------------------------------------------------------

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

// --- binary path ------------------------------------------------------------

/** Row pass over a 0/255 mask. `isMax` → set if ANY set in window;
 *  otherwise → set only if ALL set. */
function rowBinary(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
  isMax: boolean,
): Uint8Array {
  const r = Math.floor(k / 2);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // Seed the window for x = 0: [0, min(w-1, r)].
    let count = 0;
    let hi = Math.min(w - 1, r);
    for (let x = 0; x <= hi; x++) if (mask[row + x]) count++;
    let lo = 0;
    for (let cx = 0; cx < w; cx++) {
      const wantLo = cx - r > 0 ? cx - r : 0;
      const wantHi = cx + r < w - 1 ? cx + r : w - 1;
      while (hi < wantHi) if (mask[row + ++hi]) count++;
      while (lo < wantLo) if (mask[row + lo++]) count--;
      out[row + cx] = isMax
        ? count > 0
          ? ON
          : OFF
        : count === wantHi - wantLo + 1
          ? ON
          : OFF;
    }
  }
  return out;
}

/**
 * Column pass over a 0/255 mask.
 *
 * Keeps a per-column running count and slides it DOWN one row at a
 * time, so every memory access stays row-major. Walking each column
 * top-to-bottom instead (the obvious mirror of the row pass) strides by
 * `w` and misses cache on every read.
 */
function colBinary(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
  isMax: boolean,
): Uint8Array {
  const r = Math.floor(k / 2);
  const out = new Uint8Array(mask.length);
  const count = new Int32Array(w);
  let lo = 0;
  let hi = -1;
  for (let cy = 0; cy < h; cy++) {
    const wantLo = cy - r > 0 ? cy - r : 0;
    const wantHi = cy + r < h - 1 ? cy + r : h - 1;
    while (hi < wantHi) {
      hi++;
      const o = hi * w;
      for (let x = 0; x < w; x++) if (mask[o + x]) count[x]++;
    }
    while (lo < wantLo) {
      const o = lo * w;
      for (let x = 0; x < w; x++) if (mask[o + x]) count[x]--;
      lo++;
    }
    const o = cy * w;
    const len = wantHi - wantLo + 1;
    if (isMax) {
      for (let x = 0; x < w; x++) out[o + x] = count[x] > 0 ? ON : OFF;
    } else {
      for (let x = 0; x < w; x++) out[o + x] = count[x] === len ? ON : OFF;
    }
  }
  return out;
}


// --- bitset path ------------------------------------------------------------
//
// One bit per pixel, rows word-aligned so a shift can never bleed from
// the end of one row into the start of the next.
//
// "Is any pixel set within r" is computed by DOUBLING: OR the
// accumulator with itself shifted by s, and its reach grows by s each
// round. Starting from reach 0 and taking s = min(shift, r - reach)
// with shift doubling gives exactly reach r in O(log r) passes over the
// bitset, instead of r passes. Each pass touches w*h/32 words.
//
// Erosion is the De Morgan dual: a window is all-set iff its complement
// contains no set pixel, so erode = NOT dilate(NOT x). That holds under
// the CLAMPED window convention too, because both sides use the same
// clamped window. It does mean the padding bits past the end of each
// row have to be cleared after every complement, or they would dilate
// back in as real pixels.

const WORD = 32;

function wordsPerRow(w: number): number {
  return (w + WORD - 1) >>> 5;
}

function packMask(mask: Uint8Array, w: number, h: number): Uint32Array {
  const wpr = wordsPerRow(w);
  const bits = new Uint32Array(wpr * h);
  for (let y = 0; y < h; y++) {
    const src = y * w;
    const dst = y * wpr;
    for (let x = 0; x < w; x++) {
      if (mask[src + x]) bits[dst + (x >>> 5)] |= 1 << (x & 31);
    }
  }
  return bits;
}

function unpackMask(bits: Uint32Array, w: number, h: number): Uint8Array {
  const wpr = wordsPerRow(w);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = y * wpr;
    const dst = y * w;
    for (let x = 0; x < w; x++) {
      out[dst + x] = (bits[src + (x >>> 5)] >>> (x & 31)) & 1 ? ON : OFF;
    }
  }
  return out;
}

/** Zero the bits past column w-1 in every row. */
function clearTail(bits: Uint32Array, w: number, h: number): void {
  const wpr = wordsPerRow(w);
  const used = w & 31;
  if (used === 0) return;
  const keep = (1 << used) - 1;
  for (let y = 0; y < h; y++) bits[y * wpr + wpr - 1] &= keep;
}

function complement(bits: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(bits.length);
  for (let i = 0; i < bits.length; i++) out[i] = ~bits[i];
  clearTail(out, w, h);
  return out;
}

/** acc |= acc shifted left and right by `s` columns, within each row. */
function spreadCols(acc: Uint32Array, w: number, h: number, s: number): void {
  const wpr = wordsPerRow(w);
  const wordShift = s >>> 5;
  const bitShift = s & 31;
  const row = new Uint32Array(wpr);
  for (let y = 0; y < h; y++) {
    const base = y * wpr;
    for (let i = 0; i < wpr; i++) row[i] = acc[base + i];
    for (let i = 0; i < wpr; i++) {
      let left = 0;
      let right = 0;
      // shift toward higher columns
      const a = i - wordShift;
      if (a >= 0) {
        left = bitShift === 0 ? row[a] : (row[a] << bitShift) >>> 0;
        if (bitShift !== 0 && a - 1 >= 0) left |= row[a - 1] >>> (WORD - bitShift);
      }
      // shift toward lower columns
      const b = i + wordShift;
      if (b < wpr) {
        right = bitShift === 0 ? row[b] : row[b] >>> bitShift;
        if (bitShift !== 0 && b + 1 < wpr) {
          right |= (row[b + 1] << (WORD - bitShift)) >>> 0;
        }
      }
      acc[base + i] |= left | right;
    }
  }
  clearTail(acc, w, h);
}

/** acc |= acc shifted up and down by `s` rows. */
function spreadRows(acc: Uint32Array, w: number, h: number, s: number): void {
  const wpr = wordsPerRow(w);
  const snapshot = acc.slice();
  for (let y = 0; y < h; y++) {
    const base = y * wpr;
    const up = y - s;
    const down = y + s;
    if (up >= 0) {
      const o = up * wpr;
      for (let i = 0; i < wpr; i++) acc[base + i] |= snapshot[o + i];
    }
    if (down < h) {
      const o = down * wpr;
      for (let i = 0; i < wpr; i++) acc[base + i] |= snapshot[o + i];
    }
  }
}

/** Grow every set bit by `r` in both axes, clamped at the borders. */
function dilateBits(bits: Uint32Array, w: number, h: number, r: number): Uint32Array {
  const acc = bits.slice();
  let reach = 0;
  let step = 1;
  while (reach < r) {
    const s = Math.min(step, r - reach);
    spreadCols(acc, w, h, s);
    spreadRows(acc, w, h, s);
    reach += s;
    step <<= 1;
  }
  return acc;
}

function dilateBinaryBits(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
): Uint8Array {
  const r = Math.floor(k / 2);
  if (r === 0) return mask.slice();
  return unpackMask(dilateBits(packMask(mask, w, h), w, h, r), w, h);
}

function erodeBinaryBits(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
): Uint8Array {
  const r = Math.floor(k / 2);
  if (r === 0) return mask.slice();
  const inv = complement(packMask(mask, w, h), w, h);
  const grown = dilateBits(inv, w, h, r);
  return unpackMask(complement(grown, w, h), w, h);
}

// --- public API -------------------------------------------------------------

function pass(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
  isMax: boolean,
  binary: boolean,
): Uint8Array {
  if (!binary) {
    return colMinMax(rowMinMax(mask, w, h, k, isMax), w, h, k, isMax);
  }
  return isMax
    ? dilateBinaryBits(mask, w, h, k)
    : erodeBinaryBits(mask, w, h, k);
}

export function dilate(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  return pass(mask, w, h, k, true, isBinaryMask(mask));
}

export function erode(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  return pass(mask, w, h, k, false, isBinaryMask(mask));
}

export function open(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  // One classification for both halves: a binary input stays binary
  // through the first pass, since both paths only ever emit 0 or the
  // values already present.
  const binary = isBinaryMask(mask);
  return pass(pass(mask, w, h, k, false, binary), w, h, k, true, binary);
}

export function close(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask;
  const binary = isBinaryMask(mask);
  return pass(pass(mask, w, h, k, true, binary), w, h, k, false, binary);
}

/** Test-only: force the general (non-binary) implementation, so the
 *  selftest can fuzz the fast path against it. */
export function _morphologyReference(
  mask: Uint8Array,
  w: number,
  h: number,
  k: number,
  op: "dilate" | "erode" | "open" | "close",
): Uint8Array {
  if (k <= 1) return mask;
  switch (op) {
    case "dilate":
      return pass(mask, w, h, k, true, false);
    case "erode":
      return pass(mask, w, h, k, false, false);
    case "open":
      return pass(pass(mask, w, h, k, false, false), w, h, k, true, false);
    case "close":
      return pass(pass(mask, w, h, k, true, false), w, h, k, false, false);
  }
}
