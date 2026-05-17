// Status Tracker — types + default catalog.

export const PLUGIN_ID = "com.obr-suite/status";
export const STATUS_BUFFS_KEY = `${PLUGIN_ID}/buffs`;
export const STATUS_BUFF_ROUNDS_KEY = `${PLUGIN_ID}/buff-rounds`;
export const STATUS_RESOURCES_KEY = `${PLUGIN_ID}/resources`;

// 2026-05-16 — per-client global render-mode override.
//   "auto"   — fall back to per-buff settings (default).
//   "effect" — force the webm/icon path for every buff that HAS one;
//              fall back to text for buffs without.
//   "text"   — force the curved-band + text-label path for every
//              buff, ignoring webmAsset / iconAsset.
// Stored in localStorage so each client can choose its own preference
// (some players prefer the cleaner text-only view; some DMs want full
// effects on; per-buff defaults remain available via "auto").
export type StatusRenderMode = "auto" | "effect" | "text";
export const LS_STATUS_RENDER_MODE = `${PLUGIN_ID}/render-mode`;
export function getStatusRenderMode(): StatusRenderMode {
  try {
    const v = localStorage.getItem(LS_STATUS_RENDER_MODE);
    if (v === "effect" || v === "text" || v === "auto") return v;
  } catch {}
  return "auto";
}
export function setStatusRenderMode(mode: StatusRenderMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(LS_STATUS_RENDER_MODE);
    else localStorage.setItem(LS_STATUS_RENDER_MODE, mode);
  } catch {}
}

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
  /** Default remaining combat rounds when the buff is applied. */
  rounds?: number;
  group?: string;
  /** Visual mode. Defaults to "default" (static curved bubble). */
  effect?: BuffEffect;
  /** Effect tunables (emoji, speed, count). Only relevant when
   *  `effect` is non-default. */
  effectParams?: EffectParams;
  /** 2026-05-14 — relative URL to a pre-rendered WebM effect file
   *  (e.g. "buff-fx/paralysis.webm"). When set, the renderer creates
   *  ONE Image-with-video item for the buff (instead of the legacy
   *  ~2 path items + N per-glyph text items), cutting item count
   *  ~10× and offloading animation to GPU video decode. The path is
   *  resolved via `assetUrl()` so it works on both stable and dev
   *  channels. See tools/buff-fx-gen/buff_fx.py for the generator. */
  webmAsset?: string;
  /** 2026-05-14b — multiplier applied to the WebM's rendered size on
   *  the canvas. Default 1.0 (WebM bbox = token's natural footprint).
   *  Use 1.5 / 2.0 for effects that need to "leak past" the token
   *  cell (bardic music notes drifting far, flying wings extending
   *  sideways, charmed ripples reaching beyond the token). Tuned per
   *  effect so multiple stacked buffs don't visually fight each
   *  other. */
  webmScale?: number;
  /** 2026-05 — explicit "effect turned OFF" marker for a BUILT-IN buff
   *  (one whose id is in DEFAULT_BUFFS). Built-in buffs ship with a
   *  default `webmAsset`; the catalog editor offers a 2-way 无 / 默认
   *  特效 toggle. Picking 无 sets `webmOff: true` + clears `webmAsset`.
   *  Needed so the catalog loader can tell "user disabled the effect"
   *  apart from "an old catalog simply never stored the asset" — only
   *  the latter gets re-seeded from DEFAULT_BUFFS. Irrelevant for
   *  custom buffs (they have no built-in default to fall back to). */
  webmOff?: boolean;
  /** 2026-05-14 (#2) — STATIC image icon. Set by the "以此创建状态"
   *  right-click flow, which turns any canvas image into a buff: the
   *  item's image becomes the buff's on-token visual. Rendered the
   *  same way `webmAsset` is (one Image item, centre-anchored,
   *  scale/rotation-inheritance off) but with the image's real mime
   *  instead of "video/webm" — so a PNG/JPG/SVG/WebP renders as a
   *  still picture rather than a (broken) video. `webmScale` also
   *  applies to icons. When BOTH webmAsset and iconAsset are set,
   *  webmAsset wins (it's the richer visual). */
  iconAsset?: string;
  /** Mime of `iconAsset` (e.g. "image/png"). Falls back to
   *  "image/png" when unknown. */
  iconMime?: string;
  /** Intrinsic pixel size of `iconAsset`. Non-square images keep
   *  their aspect ratio; missing → assumed 256×256 square. */
  iconWidth?: number;
  iconHeight?: number;
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

// 2026-05-14 — each buff is now bound to a pre-baked WebM variant
// (see public/buff-fx/manifest.json). The renderer emits one OBR
// Image-with-video item per buff with `mime: video/webm` instead of
// the legacy ~20-item curved-band + per-glyph-text pipeline.
//
// Players can re-pick a variant in the catalog editor (status-tracker
// page → ✎ icon → effect picker). The old `effect` field stays in the
// types for back-compat but is now ignored unless `webmAsset` is unset.
export const DEFAULT_BUFFS: BuffDef[] = [
  // === Animated / directional ===
  { id: "paralyzed",    name: "麻痹 ⚡",       color: "#ffff00", group: "异常",  webmAsset: "buff-fx/flash-lightning.webm" },
  { id: "charmed",      name: "魅惑 💘",       color: "#ff00d0", group: "异常",  webmAsset: "buff-fx/custom-charmed.webm",      webmScale: 1.6 },
  // 2026-05-12 — invisible REVERTED to fade-ghost (the box version
  // was a bad fit per user feedback).
  { id: "invisible",    name: "隐形 👻",       color: "#cccccc", group: "Buffs", webmAsset: "buff-fx/fade-ghost.webm",          webmScale: 1.0 },
  { id: "bardic",       name: "诗人激励 🎵",   color: "#7300ff", group: "Buffs", webmAsset: "buff-fx/custom-bardic.webm",       webmScale: 1.4 },
  // 2026-05-12 — "被骂" renamed to 劣势 (disadvantage). Pure ⬇ arrows,
  // no rotation, falling down. Yellow ⬆ counterpart below.
  { id: "vicious",      name: "劣势 ⬇",       color: "#3b82f6", group: "异常",  webmAsset: "buff-fx/custom-disadvantage.webm", webmScale: 1.0 },
  { id: "advantage",    name: "优势 ⬆",       color: "#ffcc00", group: "Buffs", webmAsset: "buff-fx/custom-advantage.webm",    webmScale: 1.0 },
  { id: "stunned",      name: "眩晕 💫",       color: "#f5deb3", group: "异常",  webmAsset: "buff-fx/orbit-dizzy.webm" },
  { id: "wet",          name: "濡湿 💧",       color: "#87cefa", group: "异常",  webmAsset: "buff-fx/rain-drop.webm" },
  { id: "poisoned",     name: "中毒 🤢",       color: "#008000", group: "异常",  webmAsset: "buff-fx/rain-test_tube.webm" },
  { id: "haste",        name: "急速术 💨",     color: "#04a3ff", group: "Buffs", webmAsset: "buff-fx/float-wind.webm" },
  { id: "flying",       name: "飞行术 🕊️",    color: "#d5d5d5", group: "Buffs", webmAsset: "buff-fx/custom-flying.webm",       webmScale: 1.4 },
  { id: "frozen",       name: "冰冻 ❄️",      color: "#0000ff", group: "异常",  webmAsset: "buff-fx/custom-frozen.webm",       webmScale: 1.0 },
  { id: "innate_spell", name: "先天术法 ⚡️",  color: "#08fdfd", group: "Extra", webmAsset: "buff-fx/radial-star.webm" },
  { id: "wild_shape",   name: "野性形态 💥",   color: "#ff0000", group: "Extra", webmAsset: "buff-fx/flash-boom.webm" },
  { id: "blessing",     name: "祝福术 🧧",     color: "#ffff00", group: "Buffs", webmAsset: "buff-fx/radial-sparkles.webm" },
  { id: "frightened",   name: "恐慌 😱",       color: "#2f4f4f", group: "异常",  webmAsset: "buff-fx/shake-screaming.webm" },
  { id: "unconscious",  name: "昏迷 💤",       color: "#4b0082", group: "异常",  webmAsset: "buff-fx/float-zzz.webm" },
  // 神导术 (guidance) — user undecided; left without a custom asset.
  { id: "guidance",     name: "神导术 👍",     color: "#ffff00", group: "Buffs", webmAsset: "buff-fx/pulse-thumbs_up.webm" },

  // === Edge-slot persistent emoji (small, divided by compass point) ===
  // 2026-05-12 — small scale + custom position so multiple stack
  // without overlap. Each is at a distinct token-edge slot.
  { id: "hunters_mark", name: "猎人印记 🎯",   color: "#00ff26", group: "Extra", webmAsset: "buff-fx/custom-hunters_mark.webm", webmScale: 1.0 },  // T
  { id: "focused",      name: "专注 🧠",       color: "#4682b4", group: "Extra", webmAsset: "buff-fx/custom-focused.webm",      webmScale: 1.0 },  // TR
  { id: "deafened",     name: "耳聋 🎧",       color: "#c0c0c0", group: "异常",  webmAsset: "buff-fx/custom-deafened.webm",     webmScale: 1.0 },  // R
  { id: "incapacitated",name: "失能 💔",       color: "#708090", group: "异常",  webmAsset: "buff-fx/custom-incapacitated.webm",webmScale: 1.0 },  // BR
  { id: "prone",        name: "倒地 🦦",       color: "#cd853f", group: "异常",  webmAsset: "buff-fx/custom-prone.webm",        webmScale: 1.0 },  // B
  { id: "slowed",       name: "缓慢术 ⌛",     color: "#e805f4", group: "异常",  webmAsset: "buff-fx/custom-slowed.webm",       webmScale: 1.0 },  // BL
  { id: "blinded",      name: "目盲 🕶️",      color: "#4a4a4a", group: "异常",  webmAsset: "buff-fx/custom-blinded.webm",      webmScale: 1.0 },  // L
  { id: "exhaustion",   name: "力竭 🦥",       color: "#ff0000", group: "异常",  webmAsset: "buff-fx/custom-exhaustion.webm",   webmScale: 1.0 },  // TL

  // === Centre / character-wide persistent emoji (smaller than before) ===
  { id: "dead",         name: "死亡 💀",       color: "#000000", group: "Extra", webmAsset: "buff-fx/custom-dead.webm",         webmScale: 1.0 },
  { id: "petrified",    name: "石化 🗿",       color: "#8b7d6b", group: "异常",  webmAsset: "buff-fx/custom-petrified.webm",    webmScale: 1.0 },
  { id: "restrained",   name: "束缚 🔗",       color: "#8b4513", group: "异常",  webmAsset: "buff-fx/custom-restrained.webm",   webmScale: 1.0 },
  { id: "grappled",     name: "擒抱 🫂",       color: "#d2691e", group: "异常",  webmAsset: "buff-fx/custom-grappled.webm",     webmScale: 1.0 },
  { id: "raging",       name: "狂暴 😠",       color: "#f20808", group: "Extra", webmAsset: "buff-fx/custom-raging.webm",       webmScale: 1.0 },
  { id: "frozen_stiff", name: "冻僵 🥶",       color: "#00ffff", group: "异常",  webmAsset: "buff-fx/custom-frozen_stiff.webm", webmScale: 1.0 },
];
