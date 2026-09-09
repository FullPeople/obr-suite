import type { BossObstacle } from "./model";

export function validObstacle(value: unknown): value is BossObstacle {
  if (!value || typeof value !== "object") return false;
  const box = value as BossObstacle;
  return [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
}

/** Bottom-center placement against actual open host rectangles. A rectangle
 * with no free vertical room suppresses artwork rather than covering controls. */
export function bossPlacement(width: number, height: number, barHeight: number, inset: number, obstacles: readonly BossObstacle[]) {
  const w = Math.max(0, Math.min(600, width - 32));
  const left = (width - w) / 2;
  let bottom = Math.max(88, Math.min(inset, height - barHeight - 12));
  for (let pass = 0; pass <= obstacles.length; pass++) {
    const top = height - bottom - barHeight;
    const hits = obstacles.filter(validObstacle).filter(box => box.left < left + w + 8 && box.left + box.width > left - 8
      && box.top < top + barHeight + 8 && box.top + box.height > top - 8);
    if (!hits.length) return { left, top, width: w, visible: w >= 128 && top >= 12 };
    bottom = Math.max(bottom, ...hits.map(box => height - box.top + 12));
  }
  return { left, top: 0, width: w, visible: false };
}
