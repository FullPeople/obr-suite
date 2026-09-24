/** Public hand movements use ordinal slots only, never a private card ID.
 *  `slap` rides the same envelope: it is a public table gesture with no hand
 *  data of its own, and it inherits this channel's validation and rate limit
 *  instead of introducing a second message type. */
export interface HandGesture { gameId: string; revision: number; count: number; hover: number | null; selected: number[]; sequence: number; slap?: boolean }
export const TABLE_GESTURE = "com.fullpeople/three-dragon-ante/gesture";
export const GESTURE_INTERVAL_MS = 125;
export const isClearGesture = (value: HandGesture) => value.hover === null && value.selected.length === 0 && !value.slap;
export function readHandGesture(value: unknown): HandGesture | null {
  if (!value || typeof value !== "object") return null;
  const g = value as HandGesture;
  if (typeof g.gameId !== "string" || !g.gameId || g.gameId.length > 128 || !Number.isSafeInteger(g.revision) || g.revision < 0 ||
    !Number.isSafeInteger(g.sequence) || g.sequence < 0 || !Number.isInteger(g.count) || g.count < 0 || g.count > 10 ||
    (g.hover !== null && (!Number.isInteger(g.hover) || g.hover < 0 || g.hover >= g.count)) ||
    !Array.isArray(g.selected) || g.selected.length > g.count || g.selected.some(i => !Number.isInteger(i) || i < 0 || i >= g.count) ||
    (g.slap !== undefined && g.slap !== true)) return null;
  return { gameId: g.gameId, revision: g.revision, count: g.count, hover: g.hover, selected: [...new Set(g.selected)], sequence: g.sequence, ...(g.slap === true ? { slap: true } : {}) };
}
