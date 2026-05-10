// Selective hole-fill — fills enclosed background regions whose area
// is below maxArea AND that don't touch the image border.
//
// Avoids the v1 bug where a naive border-floodfill swallows the
// entire map: instead we run CC on the INVERSE mask, identify the
// "background" components, and selectively flip small enclosed ones
// to foreground.
//
// Skip components touching the border (those reach "outside" so they
// aren't enclosed) and skip components with area > maxArea (those
// are the parchment / sea / sky background, definitely not holes).

import { connectedComponents } from "./components";

export function selectiveHoleFill(
  mask: Uint8Array,
  w: number,
  h: number,
  maxArea: number,
): Uint8Array {
  if (maxArea <= 0) return mask;
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 255;
  const cc = connectedComponents(inv, w, h);
  // Mark each component "fill" or "skip".
  const fill = new Uint8Array(cc.count + 1);
  for (let lbl = 1; lbl <= cc.count; lbl++) {
    const s = cc.stats[lbl];
    if (s.area > maxArea) continue;
    if (s.x0 === 0 || s.y0 === 0 || s.x1 === w - 1 || s.y1 === h - 1) continue;
    fill[lbl] = 1;
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    out[i] = mask[i] || (cc.labels[i] && fill[cc.labels[i]]) ? 255 : 0;
  }
  return out;
}
