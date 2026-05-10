// RGB → HSV conversion using OpenCV's convention:
//   H ∈ [0, 180)   (so all 3 channels fit in uint8)
//   S ∈ [0, 255]
//   V ∈ [0, 255]
//
// Using OpenCV's range so thresholds we tuned in Python translate 1:1.

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const delta = max - min;
  let h = 0;
  let s = 0;
  if (max > 0) s = (delta * 255) / max;
  if (delta > 0) {
    if (max === r) h = 30 * ((g - b) / delta);
    else if (max === g) h = 60 + 30 * ((b - r) / delta);
    else h = 120 + 30 * ((r - g) / delta);
    if (h < 0) h += 180;
  }
  return [h, s, v];
}
