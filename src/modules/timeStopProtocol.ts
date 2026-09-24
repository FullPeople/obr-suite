export const TIME_STOP_META = "com.time-stop/state";
export const TIME_STOP_MODAL = "com.time-stop/overlay";
export const TIME_STOP_READY = "com.time-stop/overlay-ready";
export const TIME_STOP_VIEW = "com.time-stop/overlay-view";
export const TIME_STOP_HIDE = "com.time-stop/overlay-hide";
export const TIME_STOP_HIDDEN = "com.time-stop/overlay-hidden";
export const TIME_STOP_RETRY = "com.time-stop/overlay-retry";
export const CG_FADE_MS = 600;
export const CG_BARS_MS = 550;
export function validCgUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 16_000) return false;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol)
    || /^data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml)[;,]/i.test(value); }
  catch { return false; }
}
export function readTimeStop(value: unknown): { active: boolean; cgUrl: string | null } {
  const state = value as { active?: unknown; cgUrl?: unknown } | null;
  return { active: state?.active === true, cgUrl: validCgUrl(state?.cgUrl) ? state.cgUrl : null };
}
