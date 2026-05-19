import OBR from "@owlbear-rodeo/sdk";
import { STABLE_HIDES } from "./feature-flags";

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
  | "resourceTracker"
  | "hpBar"
  | "metadataInspector"
  | "fullFog"
  | "trickster"
  | "circleImage"
  | "follow"
  | "musicBoard";

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
  /** Base URL — must serve `search/<indexPath>` + `data/<file>.json`. */
  baseUrl: string;
  /** Whether the library is currently active (data fetched + merged). */
  enabled: boolean;
  /** Built-in libraries can't be deleted, only enabled/disabled. */
  builtin?: boolean;
  /** Path (relative to baseUrl) for the search index file. Defaults
   *  to `search/index.json` when omitted, which matches the standard
   *  5etools layout. The kiwee partnered listing uses a different
   *  filename (`search/index-partnered.json`) so the field overrides
   *  it per-library. */
  indexPath?: string;
  /** Per-library blacklist of source codes the user wants to exclude
   *  (added 2026-05-09). Each entry is an UPPERCASE source code as
   *  emitted by 5etools — e.g. `"BOOKOFEBONTIDES"`, `"DMG"`. The
   *  search loader filters out every entry whose `source` (or `s` /
   *  `data.source`) appears here. Empty / undefined = no exclusions
   *  for this library. Stored per-library (not globally) so the same
   *  source code can be disabled in one library while still allowed
   *  in another. */
  disabledSources?: string[];
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
  // When true, the spawned token's OBR-native plainText label
  // (the small text under the token) is set to the monster's name
  // automatically. When false, the token spawns label-less; the DM
  // can still sync the label later by clicking the monster name in
  // the info popover. Default false (legacy behaviour — DM had to
  // click-sync per token before this toggle existed).
  bestiaryAutoName: boolean;
  // Initiative tracker — focus the active token's owner camera onto
  // the next character whenever the turn advances. Default true.
  initiativeFocusOnTurnChange: boolean;
  // Initiative tracker — when entering "preparing combat" state, snap
  // every initiative token to the center of its grid cell so the
  // turn order tokens line up cleanly. Default false (most groups
  // pre-position by hand).
  initiativeAutoSnapOnPrep: boolean;
  // 2026-05-16 — Initiative tracker — hide the percent HP bar that
  // appears under each token's portrait in the initiative strip.
  // Some tables prefer not to leak HP info to players via the strip.
  // Default false (strip shows the bar).
  initiativeHidePercentHpBar: boolean;
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
  {
    id: "5etools-kiwee-partnered",
    name: "5etools (kiwee.top, 合作版)",
    baseUrl: "https://5e.kiwee.top",
    // Kiwee hosts a separate index for partnered third-party content
    // alongside the main one. Same data shape, different filename —
    // the indexPath override is what makes this library reachable
    // (without it the loader 404s on /search/index.json with the
    // partnered URL hint).
    indexPath: "search/index-partnered.json",
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
    // Status tracker — promoted to stable. Default ON in all channels.
    // The right-click "状态追踪" pill on the Select tool + the new
    // toolbar tool both work for everyone (no role gate); per-token
    // buff metadata is enforced by OBR's normal item-edit permissions.
    statusTracker: true,
    // Resource tracker — per-token consumable / progress / numeric
    // resources, plus a DM-only toolbar tool that opens a full-screen
    // stats panel of every player character's resources. Default ON.
    resourceTracker: true,
    // HP bar component — standalone draggable HP/Temp/AC popover
    // that auto-shows on selection of "lightweight" tokens (no
    // bestiary binding, no character-card binding). Right-click
    // menu adds / removes the per-token flag. Default ON.
    hpBar: true,
    // DM-only inspection tool. Default ON in all channels; useful for
    // field debugging token / scene / room metadata.
    metadataInspector: true,
    // fullFog — Photoshop-style fog/wall extraction editor for map
    // images. Right-click MAP layer → fullscreen modal → algorithms
    // (Otsu / adaptive / color-exclude / saturation-aware / threshold)
    // + manual tools (brush / eraser / lasso / wand / bucket) → save
    // as a single low-drawcall Path item attached to the map. Dev-only
    // (hidden from stable until polished). Disabled when STABLE_HIDES
    // is true.
    fullFog: !STABLE_HIDES,
    // Trickster — DM-placed circular trigger zone. When a target
    // token drag-commits into the zone, fires a one-shot time stop
    // + camera focus on the entering token. Useful for ambush
    // setups: hide the trickster, point its targets at the party,
    // wait for them to walk through the spot. Promoted from dev to
    // stable on 2026-05-08; available everywhere now.
    trickster: true,
    // Circle-image — toolbar tool that opens a small image-processing
    // popover (圆形裁剪 / 白底黑底剔除), uploads the result to the
    // user's OBR asset library via OBR.assets.uploadImages, and the
    // user drags from there to the scene. Promoted from dev to
    // stable on 2026-05-08; available everywhere now.
    circleImage: true,
    // Follow — retired 2026-05-14 per user request. The flag stays in
    // the type/state shape (removing it would ripple through settings
    // + saved scene metadata) but it's hard-pinned OFF and no longer
    // registered as a module in background.ts. modules/follow/ source
    // is kept on disk un-wired in case it's revived.
    follow: false,
    // Music board — promoted to stable 2026-05-19. Background-resident
    // engine plays audio + maintains the PeerJS connection across
    // popover open/close, so all players hear synchronised audio.
    musicBoard: true,
  },
  dataVersion: "2024",
  allowPlayerMonsters: false,
  bestiaryAutoInitiative: true,
  bestiaryAutoHide: true,
  bestiaryAutoName: false,
  initiativeFocusOnTurnChange: true,
  initiativeAutoSnapOnPrep: false,
  initiativeHidePercentHpBar: false,
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
        // Preserve `disabledSources` through the merge — was getting
        // dropped because the field wasn't enumerated here, which made
        // every subsequent setState load discard the user's per-source
        // blacklist (the "checkbox bounces back" bug). Normalise to a
        // string array, drop empties / non-strings.
        const disabledSources = Array.isArray((lib as any).disabledSources)
          ? ((lib as any).disabledSources as unknown[])
              .filter((s): s is string => typeof s === "string" && s.length > 0)
          : undefined;
        libraries.push({
          id: String(lib.id),
          name: String(lib.name ?? lib.id),
          baseUrl: String(lib.baseUrl ?? ""),
          enabled: lib.enabled !== false,
          builtin: !!lib.builtin,
          indexPath: typeof lib.indexPath === "string" && lib.indexPath.length > 0
            ? lib.indexPath
            : undefined,
          disabledSources: disabledSources && disabledSources.length > 0
            ? disabledSources
            : undefined,
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
    bestiaryAutoName:
      partial.bestiaryAutoName ?? DEFAULT_STATE.bestiaryAutoName,
    initiativeFocusOnTurnChange:
      partial.initiativeFocusOnTurnChange ?? DEFAULT_STATE.initiativeFocusOnTurnChange,
    initiativeAutoSnapOnPrep:
      partial.initiativeAutoSnapOnPrep ?? DEFAULT_STATE.initiativeAutoSnapOnPrep,
    initiativeHidePercentHpBar:
      partial.initiativeHidePercentHpBar ?? DEFAULT_STATE.initiativeHidePercentHpBar,
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
  if (a.bestiaryAutoName !== b.bestiaryAutoName) return false;
  if (a.initiativeFocusOnTurnChange !== b.initiativeFocusOnTurnChange) return false;
  if (a.initiativeAutoSnapOnPrep !== b.initiativeAutoSnapOnPrep) return false;
  if (a.initiativeHidePercentHpBar !== b.initiativeHidePercentHpBar) return false;
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
    // 2026-05-09: also diff per-source blacklist. Without this, the
    // setState short-circuit (`if (suiteStateEqual(prev, next))
    // return`) would skip the scene write when the user toggled a
    // source checkbox — i.e. the change never persists.
    const aDisabled = (la.disabledSources ?? []).slice().sort().join(",");
    const bDisabled = (lb.disabledSources ?? []).slice().sort().join(",");
    if (aDisabled !== bDisabled) return false;
    if ((la.indexPath ?? "") !== (lb.indexPath ?? "")) return false;
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

  if (suiteStateEqual(prev, next)) return;

  await OBR.scene.setMetadata({ [SCENE_KEY]: next });
  lastSceneStateJson = JSON.stringify(next);
  cached = next;

  // Cross-scene sync mirror: write to room when ON, clear when
  // transitioning ON → OFF so other scenes don't keep hydrating from
  // a stale mirror.
  try {
    if (next.crossSceneSyncSettings) {
      await OBR.room.setMetadata({ [ROOM_STATE_KEY]: next });
      lastRoomStateJson = JSON.stringify(next);
    } else if (prev.crossSceneSyncSettings) {
      // Was on, now off — clear so scene-loads stop seeing it.
      await OBR.room.setMetadata({ [ROOM_STATE_KEY]: undefined });
      lastRoomStateJson = JSON.stringify(null);
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
let sceneSyncStarted = false;
let lastSceneStateJson = "";
let lastRoomStateJson = "";
export function startSceneSync() {
  if (sceneSyncStarted) return;
  sceneSyncStarted = true;
  void refreshFromScene().then((s) => {
    lastSceneStateJson = JSON.stringify(s);
  });
  OBR.scene.onMetadataChange((meta) => {
    if (!meta || !(SCENE_KEY in meta)) return;
    const nextJson = JSON.stringify(meta[SCENE_KEY] ?? null);
    if (nextJson === lastSceneStateJson) return;
    lastSceneStateJson = nextJson;
    void refreshFromScene();
  });
  OBR.room.onMetadataChange((meta) => {
    if (!meta || !(ROOM_STATE_KEY in meta)) return;
    const nextJson = JSON.stringify(meta[ROOM_STATE_KEY] ?? null);
    if (nextJson === lastRoomStateJson) return;
    lastRoomStateJson = nextJson;
    void refreshFromScene();
  });
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
