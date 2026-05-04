// Status Tracker — types + default catalog.

export const PLUGIN_ID = "com.obr-suite/status";
export const STATUS_BUFFS_KEY = `${PLUGIN_ID}/buffs`;
export const STATUS_RESOURCES_KEY = `${PLUGIN_ID}/resources`;

export const SCENE_BUFF_CATALOG_KEY = `${PLUGIN_ID}/buff-catalog`;
export const SCENE_RESOURCE_CATALOG_KEY = `${PLUGIN_ID}/resource-catalog`;

// ====================================================================
// FEATURE FLAG: experimental on-token particle effects.
//
// Currently DISABLED. Effects (float/drop/flicker/curve/spread)
// remain in the data model — catalog can still carry `effect` and
// `effectParams` fields, JSON import/export round-trips them — but
// the renderer ignores them and falls back to the static curved-band
// bubble for every buff. The popup edit UI also hides the effect
// picker rows.
//
// To re-enable: flip this to true, restore the effect picker UI in
// status-tracker-page.ts (search for STATUS_EFFECTS_ENABLED), and
// the existing particles.ts machinery picks up where it left off.
// ====================================================================
export const STATUS_EFFECTS_ENABLED = false;

// === BuffEffect — visual mode for the on-token buff indicator ========
//
// default — static curved-band bubble (Path + Text glyphs).
// float   — emoji particles drift up from the token's feet.
// drop    — emoji particles fall from the top.
// flicker — emoji particles twinkle at random positions inside.
// curve   — emoji particles curve outward (music-note vibe), below.
// spread  — emoji particles radiate from token centre, below token.
//
// All non-default modes are per-client (scene.local) since OBR's
// scene.items validator rejects EFFECT-shape items; we render them
// as animated TEXT items rather than SkSL shaders so the actual
// emoji glyph is what travels.
export type BuffEffect = "default" | "float" | "drop" | "flicker" | "curve" | "spread";

/** Per-effect tunables. Optional; the renderer falls back to a
 *  bundled default particle image and per-mode defaults when fields
 *  are missing. */
export interface EffectParams {
  /** URL of the particle image (PNG / SVG). Either an external URL
   *  the user pasted, or an OBR asset URL returned by
   *  `OBR.assets.downloadImages`. The asset URL serves as the cache
   *  identity — once OBR has uploaded the file to its CDN the URL
   *  persists across sessions, so we only need to remember the URL
   *  itself, not the binary. Empty / missing → bundled default
   *  particle.svg (white 4-point sparkle). */
  imageUrl?: string;
  /** Intrinsic pixel width of the image, used to set the OBR
   *  ImageContent.width without re-querying every sync. Resolved
   *  via `new Image()` DOM probe when the URL is first seen if not
   *  already cached. */
  imageWidth?: number;
  imageHeight?: number;
  /** Animation speed multiplier. 1.0 = default. */
  speed?: number;
  /** Particle count override. Default depends on effect mode. */
  count?: number;
}

export interface BuffDef {
  id: string;
  name: string;
  /** Hex color like #ff00d0. Used as the bubble background. */
  color: string;
  group?: string;
  /** Visual mode. Defaults to "default" (static curved bubble). */
  effect?: BuffEffect;
  /** Effect tunables (emoji, speed, count). Only relevant when
   *  `effect` is non-default. */
  effectParams?: EffectParams;
}

export interface ResourceItem { id: string; name: string; current: number; max: number; }
export interface ResourceTemplate { id: string; name: string; max: number; }

export function textColorFor(bgHex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bgHex.trim());
  if (!m) return "#ffffff";
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const v = parseInt(m[1], 16);
  return [
    ((v >> 16) & 0xff) / 255,
    ((v >> 8) & 0xff) / 255,
    (v & 0xff) / 255,
  ];
}

// === DEFAULT_BUFFS =====================================================
// Each buff has a colour + name (with emoji decoration in the name
// itself, since OBR Text items can render emoji inline). Effects
// are pre-set per status using the user's intuition (麻痹 =
// flickering, 昏迷 = orbiting stars, 冰冻 = ice ripples spreading,
// etc.). With no `effectParams.imageUrl`, particles render with the
// bundled default sparkle (`/particle.svg`). Users can upload a
// custom PNG/SVG per buff via the palette ✎ popup.

export const DEFAULT_BUFFS: BuffDef[] = [
  { id: "paralyzed",    name: "麻痹 ⚡",       color: "#ffff00", group: "异常", effect: "flicker" },
  { id: "charmed",      name: "魅惑 💘",       color: "#ff00d0", group: "异常", effect: "spread" },
  { id: "invisible",    name: "隐形 👻",       color: "#cccccc", group: "Buffs", effect: "flicker" },
  { id: "bardic",       name: "诗人激励 🎵",   color: "#7300ff", group: "Buffs", effect: "curve" },
  { id: "vicious",      name: "被骂 🤡",       color: "#000000", group: "异常" },
  { id: "deafened",     name: "耳聋 🎧",       color: "#c0c0c0", group: "异常" },
  { id: "slowed",       name: "缓慢术 ⌛",     color: "#e805f4", group: "异常", effect: "drop" },
  { id: "guidance",     name: "神导术 👍",     color: "#ffff00", group: "Buffs", effect: "curve" },
  { id: "blessing",     name: "祝福术 🧧",     color: "#ffff00", group: "Buffs", effect: "curve" },
  { id: "petrified",    name: "石化 🗿",       color: "#8b7d6b", group: "异常" },
  { id: "stunned",      name: "眩晕 💫",       color: "#f5deb3", group: "异常", effect: "curve" },
  { id: "blinded",      name: "目盲 🕶️",      color: "#4a4a4a", group: "异常" },
  { id: "hunters_mark", name: "猎人印记 🎯",   color: "#00ff26", group: "Extra", effect: "flicker" },
  { id: "raging",       name: "狂暴 😠",       color: "#f20808", group: "Extra", effect: "flicker" },
  { id: "wet",          name: "濡湿 💧",       color: "#87cefa", group: "异常", effect: "drop" },
  { id: "dead",         name: "死亡 💀",       color: "#000000", group: "Extra", effect: "flicker" },
  { id: "restrained",   name: "束缚 🔗",       color: "#8b4513", group: "异常" },
  { id: "unconscious",  name: "昏迷 💤",       color: "#4b0082", group: "异常", effect: "curve" },
  { id: "grappled",     name: "擒抱 🫂",       color: "#d2691e", group: "异常" },
  { id: "frightened",   name: "恐慌 😱",       color: "#2f4f4f", group: "异常", effect: "flicker" },
  { id: "incapacitated",name: "失能 💔",       color: "#708090", group: "异常" },
  { id: "exhaustion",   name: "力竭 🦥",       color: "#ff0000", group: "异常" },
  { id: "frozen_stiff", name: "冻僵 🥶",       color: "#00ffff", group: "异常", effect: "flicker" },
  { id: "frozen",       name: "冰冻 ❄️",      color: "#0000ff", group: "异常", effect: "spread" },
  { id: "innate_spell", name: "先天术法 ⚡️",  color: "#08fdfd", group: "Extra", effect: "spread" },
  { id: "prone",        name: "倒地 🦦",       color: "#cd853f", group: "异常" },
  { id: "poisoned",     name: "中毒 🤢",       color: "#008000", group: "异常", effect: "spread" },
  { id: "focused",      name: "专注 🧠",       color: "#4682b4", group: "Extra", effect: "spread" },
  { id: "haste",        name: "急速术 💨",     color: "#04a3ff", group: "Buffs", effect: "float" },
  { id: "flying",       name: "飞行术 🕊️",    color: "#d5d5d5", group: "Buffs", effect: "float" },
  { id: "wild_shape",   name: "野性形态 💥",   color: "#ff0000", group: "Extra", effect: "spread" },
];
