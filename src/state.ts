import OBR from "@owlbear-rodeo/sdk";

// Shared state across the suite. Three layers:
//
//   1. Scene metadata (DM-controlled, broadcast to all clients):
//      enabled modules, data version, allow-player-monsters.
//      Stored under SCENE_KEY as one object.
//
//   2. localStorage shared across iframes of this client only:
//      `obr-suite/lang` — UI language, per-client preference. Each
//      player chooses their own; the DM's setting does NOT sync.
//
//   3. localStorage per-feature (auto-popup toggles, cluster expanded
//      state, etc.). Each module owns its own keys.

export const SCENE_KEY = "com.obr-suite/state";
export const BROADCAST_STATE_CHANGED = "com.obr-suite/state-changed";

export type ModuleId =
  | "timeStop"
  | "focus"
  | "bestiary"
  | "characterCards"
  | "initiative"
  | "search"
  | "dice"
  | "portals"
  | "bubbles"
  | "statusTracker"
  | "metadataInspector"
  | "vision";

export type DataVersion = "2014" | "2024" | "all";
export type Language = "zh" | "en";

// User-managed data libraries. The default library is 5etools-on-kiwee,
// always available. Additional libraries follow the same JSON schema
// (see settings.ts → 库设置 tab → 教程 for the contract). When more
// than one library is enabled, search / bestiary will merge results
// from all of them, prefixed with the library `name` so the source is
// clear in the UI.
export interface LibraryConfig {
  /** Stable id, used as React-style key + for URL caches. */
  id: string;
  /** Display name shown in search-result row + chips. */
  name: string;
  /** Base URL — must serve `search/index.json` + `data/<file>.json`. */
  baseUrl: string;
  /** Whether the library is currently active (data fetched + merged). */
  enabled: boolean;
  /** Built-in libraries can't be deleted, only enabled/disabled. */
  builtin?: boolean;
}

export interface SuiteState {
  enabled: Record<ModuleId, boolean>;
  dataVersion: DataVersion;
  allowPlayerMonsters: boolean;
  // When true, monsters spawned from the bestiary panel are written
  // with `com.initiative-tracker/data` already populated, so they
  // immediately appear in the initiative tracker. When false, the
  // metadata is omitted and the DM has to right-click → Add to
  // initiative manually. Default true (matches legacy behavior).
  bestiaryAutoInitiative: boolean;
  // When true, monsters spawned from the bestiary panel start with
  // `visible: false` so the DM can position them off-screen / behind
  // fog before revealing. When false, spawned tokens are immediately
  // visible to all players. Default true (matches legacy behavior).
  bestiaryAutoHide: boolean;
  // Initiative tracker — focus the active token's owner camera onto
  // the next character whenever the turn advances. Default true.
  initiativeFocusOnTurnChange: boolean;
  // Initiative tracker — when entering "preparing combat" state, snap
  // every initiative token to the center of its grid cell so the
  // turn order tokens line up cleanly. Default false (most groups
  // pre-position by hand).
  initiativeAutoSnapOnPrep: boolean;
  // Cross-scene sync. When ON, the suite's scene-state is mirrored
  // to ROOM metadata so every scene in the room shares the same
  // settings. The flag itself rides along with the state (it's part
  // of the mirror), so once enabled in one scene it propagates to
  // all. Default false (per-scene settings, classic behaviour).
  crossSceneSyncSettings: boolean;
  // Cross-scene sync for character cards (the list under
  // `com.character-cards/list`). Same pattern as above but keyed off
  // a separate room key so users can mix-and-match: "share my
  // settings across scenes but keep different card decks per scene"
  // is a valid combo.
  crossSceneSyncCards: boolean;
  libraries: LibraryConfig[];
}

export const DEFAULT_LIBRARIES: LibraryConfig[] = [
  {
    id: "5etools-kiwee",
    name: "5etools (kiwee.top 镜像)",
    baseUrl: "https://5e.kiwee.top",
    enabled: true,
    builtin: true,
  },
];

export const DEFAULT_STATE: SuiteState = {
  enabled: {
    timeStop: true,
    focus: true,
    bestiary: true,
    characterCards: true,
    initiative: true,
    search: true,
    dice: true,
    portals: true,
    bubbles: true,
    // Default OFF — status tracker is in active development (调试中).
    // Each scene starts with it disabled; the user has to flip it
    // on in Settings → 状态追踪 every scene reload until it ships
    // as stable.
    statusTracker: false,
    // DM-only inspection tool. Default OFF — most users never need
    // it; only enable when you specifically want to peek at what
    // plugins have stamped onto a token / scene / room. The tool
    // icon in the OBR sidebar only shows when this is enabled.
    metadataInspector: false,
    // Vision / fog plugin — light sources on tokens, raycast against
    // walls, per-client fog mask. Default OFF because it's heavy
    // (continuous raycast on token movement) and will conflict
    // visually with OBR's own fog drawings if both are in use.
    vision: false,
  },
  dataVersion: "2024",
  allowPlayerMonsters: false,
  bestiaryAutoInitiative: true,
  bestiaryAutoHide: true,
  initiativeFocusOnTurnChange: true,
  initiativeAutoSnapOnPrep: false,
  crossSceneSyncSettings: false,
  crossSceneSyncCards: false,
  libraries: DEFAULT_LIBRARIES,
};

let cached: SuiteState = DEFAULT_STATE;
const listeners = new Set<(s: SuiteState) => void>();

export function getState(): SuiteState {
  return cached;
}

function merge(partial: any): SuiteState {
  if (!partial || typeof partial !== "object") return DEFAULT_STATE;
  // Libraries merge: user-saved entries take precedence, but built-in
  // libraries are always present (so the default 5etools never
  // disappears from older saves).
  let libraries = DEFAULT_LIBRARIES.slice();
  if (Array.isArray(partial.libraries)) {
    const seen = new Set<string>();
    libraries = [];
    for (const lib of partial.libraries) {
      if (lib && typeof lib.id === "string" && lib.id && !seen.has(lib.id)) {
        seen.add(lib.id);
        libraries.push({
          id: String(lib.id),
          name: String(lib.name ?? lib.id),
          baseUrl: String(lib.baseUrl ?? ""),
          enabled: lib.enabled !== false,
          builtin: !!lib.builtin,
        });
      }
    }
    // Re-add any built-ins that weren't in the saved data.
    for (const def of DEFAULT_LIBRARIES) {
      if (!seen.has(def.id)) libraries.unshift(def);
    }
  }
  return {
    enabled: { ...DEFAULT_STATE.enabled, ...(partial.enabled ?? {}) },
    dataVersion: partial.dataVersion ?? DEFAULT_STATE.dataVersion,
    allowPlayerMonsters:
      partial.allowPlayerMonsters ?? DEFAULT_STATE.allowPlayerMonsters,
    bestiaryAutoInitiative:
      partial.bestiaryAutoInitiative ?? DEFAULT_STATE.bestiaryAutoInitiative,
    bestiaryAutoHide:
      partial.bestiaryAutoHide ?? DEFAULT_STATE.bestiaryAutoHide,
    initiativeFocusOnTurnChange:
      partial.initiativeFocusOnTurnChange ?? DEFAULT_STATE.initiativeFocusOnTurnChange,
    initiativeAutoSnapOnPrep:
      partial.initiativeAutoSnapOnPrep ?? DEFAULT_STATE.initiativeAutoSnapOnPrep,
    crossSceneSyncSettings:
      partial.crossSceneSyncSettings ?? DEFAULT_STATE.crossSceneSyncSettings,
    crossSceneSyncCards:
      partial.crossSceneSyncCards ?? DEFAULT_STATE.crossSceneSyncCards,
    libraries,
  };
}

function suiteStateEqual(a: SuiteState, b: SuiteState): boolean {
  if (a.dataVersion !== b.dataVersion) return false;
  if (a.allowPlayerMonsters !== b.allowPlayerMonsters) return false;
  if (a.bestiaryAutoInitiative !== b.bestiaryAutoInitiative) return false;
  if (a.bestiaryAutoHide !== b.bestiaryAutoHide) return false;
  if (a.initiativeFocusOnTurnChange !== b.initiativeFocusOnTurnChange) return false;
  if (a.initiativeAutoSnapOnPrep !== b.initiativeAutoSnapOnPrep) return false;
  if (a.crossSceneSyncSettings !== b.crossSceneSyncSettings) return false;
  if (a.crossSceneSyncCards !== b.crossSceneSyncCards) return false;
  for (const k of Object.keys(a.enabled) as ModuleId[]) {
    if (a.enabled[k] !== b.enabled[k]) return false;
  }
  if ((a.libraries?.length ?? 0) !== (b.libraries?.length ?? 0)) return false;
  for (let i = 0; i < (a.libraries?.length ?? 0); i++) {
    const la = a.libraries[i];
    const lb = b.libraries[i];
    if (la.id !== lb.id || la.name !== lb.name || la.baseUrl !== lb.baseUrl || la.enabled !== lb.enabled) {
      return false;
    }
  }
  return true;
}

// Cross-scene sync — when crossSceneSyncSettings is on, the suite's
// state is mirrored to ROOM metadata under this key. Every scene-load
// checks here first; if the room mirror exists AND its sync flag is
// still on, the scene is hydrated from the room copy instead of the
// scene's own metadata. The flag rides along with the state, so once
// enabled in any scene it propagates to all.
const ROOM_STATE_KEY = "com.obr-suite/state-room";

export async function refreshFromScene(): Promise<SuiteState> {
  let next: SuiteState;
  try {
    // Cross-scene sync: prefer room mirror when active.
    try {
      const [roomMeta, sceneMeta] = await Promise.all([
        OBR.room.getMetadata(),
        OBR.scene.getMetadata(),
      ]);
      const fromRoom = roomMeta[ROOM_STATE_KEY] as any;
      if (fromRoom && fromRoom.crossSceneSyncSettings) {
        next = merge(fromRoom);
        // Mirror to scene metadata so consumers that read
        // SCENE_KEY directly (bestiary auto-init flag, etc.) see the
        // synced value too — but ONLY if the scene doesn't already
        // match. Without this guard, every refresh writes scene →
        // OBR.scene.onMetadataChange fires → refreshFromScene runs
        // again → writes scene → ... infinite loop. The user
        // reported severe flicker / freeze when toggling sync on,
        // and that's the root cause.
        const currentScene = merge(sceneMeta[SCENE_KEY]);
        if (!suiteStateEqual(currentScene, next)) {
          try { await OBR.scene.setMetadata({ [SCENE_KEY]: next }); } catch {}
        }
      } else {
        next = merge(sceneMeta[SCENE_KEY]);
      }
    } catch {
      try {
        const meta = await OBR.scene.getMetadata();
        next = merge(meta[SCENE_KEY]);
      } catch {
        next = DEFAULT_STATE;
      }
    }
  } catch {
    next = DEFAULT_STATE;
  }
  // OBR.scene.onMetadataChange fires for ANY scene metadata write (bestiary
  // spawn list, character cards list, initiative combat state, etc.) — not
  // just suite state writes. Diff before notifying so unrelated metadata
  // changes don't cascade to listeners (e.g. waking the search panel
  // every time a monster is spawned).
  const changed = !suiteStateEqual(cached, next);
  cached = next;
  if (changed) {
    for (const fn of listeners) fn(cached);
  }
  return cached;
}

export function onStateChange(fn: (s: SuiteState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// DM-only writes; player writes are silently dropped at OBR's permission layer
// but we don't gate here — the UI hides write controls for non-GM users.
export async function setState(partial: Partial<SuiteState>): Promise<void> {
  const prev = cached;
  const next: SuiteState = {
    ...cached,
    ...partial,
    enabled: { ...cached.enabled, ...(partial.enabled ?? {}) },
  };
  await OBR.scene.setMetadata({ [SCENE_KEY]: next });
  cached = next;

  // Cross-scene sync mirror: write to room when ON, clear when
  // transitioning ON → OFF so other scenes don't keep hydrating from
  // a stale mirror.
  try {
    if (next.crossSceneSyncSettings) {
      await OBR.room.setMetadata({ [ROOM_STATE_KEY]: next });
    } else if (prev.crossSceneSyncSettings) {
      // Was on, now off — clear so scene-loads stop seeing it.
      await OBR.room.setMetadata({ [ROOM_STATE_KEY]: undefined });
    }
  } catch (e) {
    console.warn("[obr-suite/state] room mirror write failed", e);
  }

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

// --- Per-client language (localStorage) ---
//
// Language is intentionally NOT in scene metadata. Each player picks the
// UI language they want; the DM's choice does not propagate. Cross-iframe
// sync within one client uses the `storage` event for receivers and a
// direct in-process notify for the writer (the storage event does not
// fire in the iframe that did the write).

const LS_LANG = "obr-suite/lang";
const langListeners = new Set<(l: Language) => void>();
let langStorageInstalled = false;

export function getLocalLang(): Language {
  try {
    const v = localStorage.getItem(LS_LANG);
    if (v === "zh" || v === "en") return v;
  } catch {}
  return "zh";
}

export function setLocalLang(lang: Language): void {
  if (lang !== "zh" && lang !== "en") return;
  if (getLocalLang() === lang) return;
  try { localStorage.setItem(LS_LANG, lang); } catch {}
  for (const fn of langListeners) fn(lang);
}

function ensureLangStorageListener() {
  if (langStorageInstalled) return;
  langStorageInstalled = true;
  window.addEventListener("storage", (e) => {
    if (e.key !== LS_LANG) return;
    const v = e.newValue;
    if (v !== "zh" && v !== "en") return;
    for (const fn of langListeners) fn(v);
  });
}

export function onLangChange(fn: (l: Language) => void): () => void {
  langListeners.add(fn);
  ensureLangStorageListener();
  return () => langListeners.delete(fn);
}
