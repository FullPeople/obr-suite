// Boundary tracing — Moore-neighbor traversal yields a closed CW
// polygon for each connected foreground component.
//
// Adapted from the prior collision-edit-page approach. Tracks visited
// boundary pixels to avoid re-tracing components already seen.

import type { Vec2 } from "../types";

/** Trace boundary contours of all "1" components. Returns an array of
 *  closed polygons (one per component). 4-connectivity for "is wall". */
export function traceContours(mask: Uint8Array, w: number, h: number): Vec2[][] {
  const NX = [-1, -1, 0, 1, 1, 1, 0, -1];
  const NY = [0, -1, -1, -1, 0, 1, 1, 1];
  const isWall = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return mask[y * w + x] > 127;
  };
  const visited = new Uint8Array(w * h);
  const contours: Vec2[][] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (visited[y * w + x]) continue;
      if (!isWall(x, y)) continue;
      // Boundary start: must have non-wall to the west.
      if (isWall(x - 1, y)) continue;
      const contour: Vec2[] = [];
      let cx = x, cy = y;
      const sx = x, sy = y;
      let dir = 4; // came from west
      let safety = 0;
      const maxSafe = w * h;
      do {
        if (visited[cy * w + cx]) break;
        visited[cy * w + cx] = 1;
        contour.push({ x: cx, y: cy });
        // Search clockwise from "left of incoming direction".
        const startSearch = (dir + 6) % 8;
        let found = false;
        for (let s = 0; s < 8; s++) {
          const d = (startSearch + s) % 8;
          const nx = cx + NX[d];
          const ny = cy + NY[d];
          if (isWall(nx, ny)) {
            cx = nx; cy = ny; dir = d;
            found = true;
            break;
          }
        }
        if (!found) break;
        if (++safety > maxSafe) break;
      } while (!(cx === sx && cy === sy));
      if (contour.length >= 3) contours.push(contour);
    }
  }

  return contours;
}
