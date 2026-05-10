// Trickster zone — shared types + metadata schema.
//
// A Trickster is an invisible (or DM-visible) circular trigger zone
// the GM places on the map. When any TARGET token is moved into the
// zone (drag-commit; OBR doesn't expose mid-drag position changes),
// the plugin fires a one-shot "time stop + camera focus on the
// triggering token" effect.

export const PLUGIN_ID = "com.obr-suite/trickster";

// Stored on the trickster Item's metadata under this key. Mirrors the
// portal module's pattern so the same items.onChange watcher can tell
// trickster items apart from regular images by metadata key.
export const TRICKSTER_KEY = `${PLUGIN_ID}/data`;

// LocalStorage key for per-client default-create prefs (visible /
// oneShot toggles persist across sessions).
export const CREATE_PREFS_KEY = `${PLUGIN_ID}/create-prefs`;

/** Which tokens are eligible to fire this trickster. The earlier
 *  "specific" id-list mode was removed in v2 — picking individual
 *  tokens by id was fragile (deleted-then-respawned tokens broke
 *  the list silently) and rarely useful in playtest. The three
 *  remaining categories cover the actual use cases. */
export type TricksterTargetMode =
  | "all"           // any CHARACTER/MOUNT token
  | "playerOnly"    // only player-controlled tokens (createdUserId !== GM)
  | "npcOnly";      // only DM-controlled tokens (createdUserId === GM)

export interface TricksterMeta {
  /** Display name for the GM edit popover; not rendered on canvas. */
  name: string;
  /** Trigger radius in scene-space pixels (same units as Item.position). */
  radius: number;
  /** When false, the icon is hidden from players (DM still sees a
   *  translucent ghost). Default false — the whole point of a trickster
   *  zone is that it's a hidden trap, players shouldn't see the marker. */
  visible?: boolean;
  /** Lock state — locked items can't be accidentally dragged by the GM.
   *  Default true so the trickster doesn't get knocked around mid-game. */
  locked?: boolean;
  /** Target selection mode. */
  targetMode: TricksterTargetMode;
  /** When true, the trickster fires at most once. After firing, the
   *  `fired` flag flips to true and the watcher skips it. The GM can
   *  reset via the edit popover. Default true (matches the user's
   *  most common ambush-trap use case). */
  oneShot?: boolean;
  /** One-shot lock. Set to true by the watcher when the trigger fires;
   *  cleared by the edit popover's "重置" button. */
  fired?: boolean;
}

export interface CreatePrefs {
  visible?: boolean;
  locked?: boolean;
  oneShot?: boolean;
  targetMode?: TricksterTargetMode;
}
