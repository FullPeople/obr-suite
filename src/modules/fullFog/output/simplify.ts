// Douglas-Peucker polyline simplification.
//
// O(n log n) average; the recursion depth is bounded by the number of
// retained points so it's safe for big polygons.

import type { Vec2 } from "../types";

export function simplifyDP(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length <= 2 || tol <= 0) return pts;
  const out: Vec2[] = [];
  const recur = (lo: number, hi: number): void => {
    let maxD = 0;
    let idx = -1;
    const a = pts[lo];
    const b = pts[hi];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denom = Math.hypot(dx, dy) || 1e-9;
    for (let i = lo + 1; i < hi; i++) {
      const p = pts[i];
      const d = Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / denom;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      recur(lo, idx);
      recur(idx, hi);
    } else {
      out.push(a);
    }
  };
  recur(0, pts.length - 1);
  out.push(pts[pts.length - 1]);
  return out;
}
