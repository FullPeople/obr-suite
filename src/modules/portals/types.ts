export const PLUGIN_ID = "com.obr-suite/portals";

// Stored on the portal Item's metadata under this key.
export const PORTAL_KEY = `${PLUGIN_ID}/data`;

// LocalStorage key holding the user's name + tag presets.
export const PRESETS_KEY = `${PLUGIN_ID}/presets`;

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
}

export interface Presets {
  names: string[];
  tags: string[];
}

export const DEFAULT_PRESETS: Presets = {
  names: ["一楼", "二楼", "三楼", "地下室"],
  tags: ["001", "002", "003"],
};
