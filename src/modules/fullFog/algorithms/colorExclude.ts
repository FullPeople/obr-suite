// Color-exclude threshold — keep only DARK pixels that are NOT
// saturated green / saturated brown.
//
// Designed for hand-drawn outdoor maps (forest + path). Without
// exclusion, plain grayscale threshold catches the forest as walls.
// With exclusion, only the line-art ink remains.
//
// Empirically tuned on Thundertree map. Drops:
//   - Hue ∈ [35, 90] AND S > 40   (greenish)
//   - Hue ∈ [8, 30]  AND S > 80   (warm brown / orange path)

import { rgbToHsv } from "./hsv";

export function colorExcludeMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  T: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    // Quick BT.601 luma for "is dark".
    const v = (r * 77 + g * 150 + b * 29) >> 8;
    if (v >= T) { out[j] = 0; continue; }
    const [hue, sat /*, _val */] = rgbToHsv(r, g, b);
    const isGreen = hue >= 35 && hue <= 90 && sat > 40;
    const isBrown = hue >= 8 && hue <= 30 && sat > 80;
    out[j] = isGreen || isBrown ? 0 : 255;
  }
  return out;
}
