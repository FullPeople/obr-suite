import OBR from "@owlbear-rodeo/sdk";
export const BOSS_PREFERENCES_KEY = "obr-suite/boss-bar/preferences";
export const BOSS_PREFERENCES_CHANGED = "com.obr-suite/boss-bar/preferences-changed";
export interface BossPreferences { hidden: boolean; reducedMotion: boolean; bottomInset: number }
function savedPreferences(): Partial<BossPreferences> {
  let saved: Partial<BossPreferences> = {};
  try { saved = JSON.parse(localStorage.getItem(BOSS_PREFERENCES_KEY) || "{}") || {}; } catch {}
  return { ...(typeof saved.hidden === "boolean" ? { hidden: saved.hidden } : {}),
    ...(typeof saved.reducedMotion === "boolean" ? { reducedMotion: saved.reducedMotion } : {}),
    ...(typeof saved.bottomInset === "number" && Number.isFinite(saved.bottomInset) ? { bottomInset: Math.max(88, Math.min(360, saved.bottomInset)) } : {}) };
}
export function getBossPreferences(): BossPreferences {
  const saved = savedPreferences();
  return { hidden: saved.hidden === true, bottomInset: saved.bottomInset ?? 104, reducedMotion: typeof saved.reducedMotion === "boolean" ? saved.reducedMotion :
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches };
}
export async function setBossPreferences(patch: Partial<BossPreferences>): Promise<void> {
  // A hide-only change must not freeze the current OS motion preference.
  const prefs = { ...savedPreferences(), ...patch };
  localStorage.setItem(BOSS_PREFERENCES_KEY, JSON.stringify(prefs));
  await OBR.broadcast.sendMessage(BOSS_PREFERENCES_CHANGED, getBossPreferences(), { destination: "LOCAL" });
}
