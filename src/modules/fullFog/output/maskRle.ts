// RLE encode / decode for binary masks.
//
// Mask is 0/255 per pixel. We treat as binary (0 or 1), then emit
// alternating run lengths: index 0 = length of leading 0-run,
// index 1 = length of next 1-run, etc. A leading 1-run is encoded
// as a 0-length 0-run first (so the alternation stays consistent).
//
// Format: comma-separated decimal integers. Compact and JSON-safe.
//
// For typical fog masks (mostly empty + a handful of marked
// regions), the run count is in the thousands even for 4K images,
// producing JSON in the 30-100 KB range — easily copy-pasteable
// and well under any item-metadata size limits.

export function encodeMaskRle(mask: Uint8Array): string {
  const runs: number[] = [];
  let cur = 0;        // start with "0" run, even if mask[0] is 1
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v !== cur) {
      runs.push(count);
      cur = v;
      count = 1;
    } else {
      count++;
    }
  }
  runs.push(count);
  return runs.join(",");
}

export function decodeMaskRle(rle: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (!rle) return out;
  const runs = rle.split(",");
  let i = 0;
  let v = 0;
  for (const rStr of runs) {
    const r = +rStr;
    if (!Number.isFinite(r) || r < 0) continue;
    if (i + r > length) {
      out.fill(v ? 255 : 0, i, length);
      return out;
    }
    if (v) out.fill(255, i, i + r);
    i += r;
    v = 1 - v;
  }
  return out;
}
