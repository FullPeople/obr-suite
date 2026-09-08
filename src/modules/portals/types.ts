export const PLUGIN_ID = "com.obr-suite/portals";

// Stored on the portal Item's metadata under this key.
export const PORTAL_KEY = `${PLUGIN_ID}/data`;

// LocalStorage key holding the user's name + tag presets.
export const PRESETS_KEY = `${PLUGIN_ID}/presets`;
export const CREATE_PREFS_KEY = `${PLUGIN_ID}/create-prefs`;
export type PortalEffect = "inherit" | "off" | "blink" | "fade";
export function normalizePortalEffect(value: unknown): PortalEffect {
  return value === "off" || value === "blink" || value === "fade" ? value : "inherit";
}
export function resolvePortalEffect(value: unknown, globalEnabled: boolean, reducedMotion: boolean): PortalEffect {
  if (reducedMotion) return "off";
  const effect = normalizePortalEffect(value);
  return effect === "inherit" ? (globalEnabled ? "inherit" : "off") : effect;
}

export interface PortalMeta {
  name: string;
  tag: string;
  // Trigger radius in scene-space pixels (same units as Item.position).
  radius: number;
  // When true, the portal token renders its `name` as an on-scene
  // text label (via OBR Image.text). The toggle button in the edit
  // popover writes through immediately so re-opening the dialog
  // shows the persisted state.
  showName?: boolean;
  // Persisted visibility state for the portal.
  visible?: boolean;
  // Persisted lock state for the portal.
  locked?: boolean;
  /** Entry portal's screen transition; absent preserves the client's old global blink setting. */
  effect?: PortalEffect;
}

export interface Presets {
  names: string[];
  tags: string[];
}

export interface CreatePrefs {
  showName?: boolean;
  visible?: boolean;
  locked?: boolean;
}

export const DEFAULT_PRESETS: Presets = {
  names: ["一楼", "二楼", "三楼", "地下室"],
  tags: ["001", "002", "003"],
};
