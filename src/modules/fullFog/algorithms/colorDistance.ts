// Color-distance threshold — pixels within `tol` Euclidean RGB
// distance of a target color become wall.
//
// Designed to mimic Photoshop's Magic Wand (contiguous OFF mode):
// pick a color, set a tolerance, all matching pixels go to mask.

/** Pixels within `tol` distance of (r, g, b) are masked.
 *  Uses squared distance to avoid sqrt. */
export function colorDistanceMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  tol: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  const t2 = tol * tol;
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const dr = rgba[i] - r;
    const dg = rgba[i + 1] - g;
    const db = rgba[i + 2] - b;
    out[j] = dr * dr + dg * dg + db * db <= t2 ? 255 : 0;
  }
  return out;
}
