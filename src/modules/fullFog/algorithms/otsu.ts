// Otsu's method — optimal global threshold by maximising
// inter-class variance.
//
// Reference: https://en.wikipedia.org/wiki/Otsu%27s_method
//
// O(256) after a one-pass histogram so it's effectively free.

import { thresholdMask } from "./grayscale";

/** Returns the Otsu threshold (0..255) for a grayscale buffer. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let bestT = 0;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      bestT = t;
    }
  }

  return bestT;
}

/** Apply Otsu and produce a mask. `offset` lets the user nudge the
 *  algorithm's pick (useful when Otsu over- or under-segments). */
export function otsuMask(gray: Uint8Array, offset: number = 0): Uint8Array {
  const T = Math.max(0, Math.min(255, otsuThreshold(gray) + offset));
  return thresholdMask(gray, T);
}
