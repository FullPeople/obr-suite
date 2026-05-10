// Connected-component labelling (4-connectivity) + min-area filter.
//
// Two-pass union-find. Returns labels (Int32Array, 0 = background) and
// per-component stats (area, bbox).

export interface CompStat {
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CCResult {
  labels: Int32Array;
  /** stats[0] is unused; component ids start at 1. */
  stats: CompStat[];
  count: number;
}

export function connectedComponents(mask: Uint8Array, w: number, h: number): CCResult {
  const labels = new Int32Array(w * h);
  // Union-find over labels.
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };

  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] === 0) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      if (left && up) {
        const lo = Math.min(left, up);
        const hi = Math.max(left, up);
        labels[i] = lo;
        if (lo !== hi) union(lo, hi);
      } else if (left) {
        labels[i] = left;
      } else if (up) {
        labels[i] = up;
      } else {
        labels[i] = next;
        parent[next] = next;
        next++;
      }
    }
  }

  // Second pass: flatten + relabel + stats.
  const remap = new Int32Array(next);
  let final = 1;
  for (let lbl = 1; lbl < next; lbl++) {
    if (find(lbl) === lbl) {
      remap[lbl] = final++;
    }
  }
  for (let lbl = 1; lbl < next; lbl++) {
    if (remap[lbl] === 0) remap[lbl] = remap[find(lbl)];
  }

  const stats: CompStat[] = new Array(final);
  for (let i = 0; i < final; i++) {
    stats[i] = { area: 0, x0: w, y0: h, x1: -1, y1: -1 };
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] === 0) continue;
      const lbl = remap[labels[i]];
      labels[i] = lbl;
      const s = stats[lbl];
      s.area++;
      if (x < s.x0) s.x0 = x;
      if (y < s.y0) s.y0 = y;
      if (x > s.x1) s.x1 = x;
      if (y > s.y1) s.y1 = y;
    }
  }

  return { labels, stats, count: final - 1 };
}

/** Drop connected components with area < minArea. Returns NEW mask. */
export function areaFilter(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  if (minArea <= 0) return mask;
  const cc = connectedComponents(mask, w, h);
  const keep = new Uint8Array(cc.count + 1);
  for (let i = 1; i <= cc.count; i++) keep[i] = cc.stats[i].area >= minArea ? 1 : 0;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    out[i] = keep[cc.labels[i]] ? 255 : 0;
  }
  return out;
}
