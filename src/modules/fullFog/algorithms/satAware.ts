// Saturation-aware threshold: pixels are walls iff
//   V (lightness) < T  AND  S (saturation) < maxSat
//
// The intuition: line-art maps have walls drawn in (near-)black ink
// — low saturation + low value. Decorative elements (trees, water)
// are usually colored, so they have high saturation even when dark.

import { rgbToHsv } from "./hsv";

export function satAwareMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  T: number,
  maxSat: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const [/* hue */, s, v] = rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    out[j] = v < T && s < maxSat ? 255 : 0;
  }
  return out;
}
