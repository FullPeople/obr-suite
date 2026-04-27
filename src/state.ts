import OBR from "@owlbear-rodeo/sdk";

// Shared state across the suite. Two layers:
//
//   1. Scene metadata (DM-controlled, broadcast to all clients):
//      enabled modules, data version, language, allow-player-monsters.
//      Stored under SCENE_KEY as one object.
//
//   2. localStorage (per-client preferences):
//      auto-popup toggles for bestiary/character cards, expanded state
//      of the floating cluster, etc.

export const SCENE_KEY = "com.obr-suite/state";
export const BROADCAST_STATE_CHANGED = "com.obr-suite/state-changed";

export type ModuleId =
  | "timeStop"
  | "focus"
  | "bestiary"
  | "characterCards"
  | "initiative"
  | "search";

export type DataVersion = "2014" | "2024" | "all";
export type Language = "zh" | "en";

export interface SuiteState {
  enabled: Record<ModuleId, boolean>;
  dataVersion: DataVersion;
  language: Language;
  allowPlayerMonsters: boolean;
}

export const DEFAULT_STATE: SuiteState = {
  enabled: {
    timeStop: true,
    focus: true,
    bestiary: true,
    characterCards: true,
    initiative: true,
    search: true,
  },
  dataVersion: "2024",
  language: "zh",
  allowPlayerMonsters: false,
};

let cached: SuiteState = DEFAULT_STATE;
const listeners = new Set<(s: SuiteState) => void>();

export function getState(): SuiteState {
  return cached;
}

function merge(partial: any): SuiteState {
  if (!partial || typeof partial !== "object") return DEFAULT_STATE;
  return {
    enabled: { ...DEFAULT_STATE.enabled, ...(partial.enabled ?? {}) },
    dataVersion: partial.dataVersion ?? DEFAULT_STATE.dataVersion,
    language: partial.language ?? DEFAULT_STATE.language,
    allowPlayerMonsters:
      partial.allowPlayerMonsters ?? DEFAULT_STATE.allowPlayerMonsters,
  };
}

export async function refreshFromScene(): Promise<SuiteState> {
  try {
    const meta = await OBR.scene.getMetadata();
    cached = merge(meta[SCENE_KEY]);
  } catch {
    cached = DEFAULT_STATE;
  }
  for (const fn of listeners) fn(cached);
  return cached;
}

export function onStateChange(fn: (s: SuiteState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// DM-only writes; player writes are silently dropped at OBR's permission layer
// but we don't gate here — the UI hides write controls for non-GM users.
export async function setState(partial: Partial<SuiteState>): Promise<void> {
  const next: SuiteState = {
    ...cached,
    ...partial,
    enabled: { ...cached.enabled, ...(partial.enabled ?? {}) },
  };
  await OBR.scene.setMetadata({ [SCENE_KEY]: next });
  cached = next;
  for (const fn of listeners) fn(cached);
  // Explicit broadcast for cross-iframe sync. OBR.scene.onMetadataChange
  // SHOULD fire in all iframes when scene metadata changes, but in
  // practice some iframes miss the event (timing or layer issues). The
  // broadcast is a redundant pathway every other iframe listens for.
  try {
    await OBR.broadcast.sendMessage(
      BROADCAST_STATE_CHANGED,
      {},
      { destination: "LOCAL" }
    );
  } catch {}
}

// localStorage helpers (per-client prefs).
export function readLS(key: string, def: string): string {
  try {
    return localStorage.getItem(key) ?? def;
  } catch {
    return def;
  }
}
export function writeLS(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch {}
}

// Subscribe scene metadata changes — call once per iframe.
export function startSceneSync() {
  refreshFromScene();
  OBR.scene.onMetadataChange(() => refreshFromScene());
}
