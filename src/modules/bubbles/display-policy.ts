/** Shared HP progress policy; independent of either renderer's lifecycle. */
export const DEFAULT_PLAYER_THRESHOLD = 25;
export const SCENE_BUBBLES_SETTINGS_KEY = "com.obr-suite/bubbles/settings";

export function readScenePlayerThreshold(meta: Record<string, unknown>): number {
  const settings = meta[SCENE_BUBBLES_SETTINGS_KEY] as { playerThreshold?: unknown } | undefined;
  const n = Number(settings?.playerThreshold);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_PLAYER_THRESHOLD;
}

/** Same ceiling steps as traditional locked-player health bars. */
export function quantiseRatio(ratio: number, thresholdPercent: number): number {
  if (thresholdPercent <= 0) return ratio;
  const step = thresholdPercent / 100;
  if (step >= 1) return ratio > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, Math.ceil(ratio / step) * step));
}
