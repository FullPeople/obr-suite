// Sample OBR PathCommand[] into dense polylines.
//
// Walls don't carry curves — only line segments. To build walls
// from a smoothed Path (cubic / quad bezier), each curve segment
// must be sampled into N straight segments. Caller controls density
// via `samplesPerCurve`; 8 looks visually smooth for typical TRPG
// scales, 4 saves geometry on busy maps.
//
// Returns one polyline per subpath (each MOVE starts a new one).
// Closed subpaths (ending in CLOSE) get the start point appended
// so callers can render them as polygons trivially.

import { Command, type PathCommand } from "@owlbear-rodeo/sdk";
import type { Vec2 } from "../types";

export function samplePathCommands(
  commands: PathCommand[],
  samplesPerCurve: number = 8,
): Vec2[][] {
  const polylines: Vec2[][] = [];
  let cur: Vec2[] | null = null;
  let lastX = 0, lastY = 0;
  let startX = 0, startY = 0;

  for (const cmd of commands) {
    switch (cmd[0]) {
      case Command.MOVE:
        if (cur && cur.length >= 2) polylines.push(cur);
        cur = [{ x: cmd[1], y: cmd[2] }];
        startX = lastX = cmd[1];
        startY = lastY = cmd[2];
        break;
      case Command.LINE:
        if (cur) cur.push({ x: cmd[1], y: cmd[2] });
        lastX = cmd[1];
        lastY = cmd[2];
        break;
      case Command.QUAD: {
        const cp1x = cmd[1], cp1y = cmd[2];
        const ex = cmd[3], ey = cmd[4];
        if (cur) {
          for (let i = 1; i <= samplesPerCurve; i++) {
            const t = i / samplesPerCurve;
            const u = 1 - t;
            const x = u * u * lastX + 2 * u * t * cp1x + t * t * ex;
            const y = u * u * lastY + 2 * u * t * cp1y + t * t * ey;
            cur.push({ x, y });
          }
        }
        lastX = ex; lastY = ey;
        break;
      }
      case Command.CUBIC: {
        const cp1x = cmd[1], cp1y = cmd[2];
        const cp2x = cmd[3], cp2y = cmd[4];
        const ex = cmd[5], ey = cmd[6];
        if (cur) {
          for (let i = 1; i <= samplesPerCurve; i++) {
            const t = i / samplesPerCurve;
            const u = 1 - t;
            const x =
              u * u * u * lastX +
              3 * u * u * t * cp1x +
              3 * u * t * t * cp2x +
              t * t * t * ex;
            const y =
              u * u * u * lastY +
              3 * u * u * t * cp1y +
              3 * u * t * t * cp2y +
              t * t * t * ey;
            cur.push({ x, y });
          }
        }
        lastX = ex; lastY = ey;
        break;
      }
      case Command.CLOSE:
        if (cur) {
          cur.push({ x: startX, y: startY });
          polylines.push(cur);
          cur = null;
        }
        break;
    }
  }
  if (cur && cur.length >= 2) polylines.push(cur);
  return polylines;
}
