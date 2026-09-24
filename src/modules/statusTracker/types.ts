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
  /** 2026-09-17 — render this buff's WebM on OBR's DRAWING layer, i.e. UNDER
   *  the token instead of over it. Used by 专注 / 隐身, which are ground rings
   *  the character stands inside: the token art covers the inner half, so the
   *  band reads as encircling the character rather than as a decal on top of it.
   *  The item is attached, locked and hit-disabled either way. */
  webmBelow?: boolean;
  /** 2026-05-18 — actual intrinsic pixel dimensions of the webm file.
   *  Used by bubbles.ts to set ImageContent.width / height AND
   *  ImageGrid.offset = (intrinsicW/2, intrinsicH/2). OBR interprets
   *  the offset against the FILE's real pixel dims (not our declared
   *  width/height), so if we lie (e.g. declare 192 for a 256-px file)
   *  the centre lands off-target and the buff drifts to the bottom-
   *  right. Default 192 for the shipped fx; user-curated webms shipped
   *  at /shared/buff-fx/*.webm carry their actual 256×256. */
  webmIntrinsicW?: number;
  webmIntrinsicH?: number;
  /** 2026-05-18 — rotation in degrees applied to the buff's rendered
   *  webm / icon item. Used by the "以此创建状态" flow to bake the
   *  source token's pre-rotated orientation into the resulting buff.
   *  Falls through as `.rotation()` on the OBR ImageBuilder when the
   *  buff is later applied to a target token. */
  rotation?: number;
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

// 2026-05-18 — DEFAULT_BUFFS now exactly matches the 12 webm files the
// user curated at the project root (E:\枭熊插件\*.webm). Earlier rounds
// shipped first 32 then 76 defaults — both retired. The "retired ids"
// set + signature map below let migrateDefaultsInPlace remove any of
// those auto-shipped entries that still match their factory state,
// without touching user customisations (renamed buffs, recoloured
// buffs, replaced webms, etc. — anything the user actually edited).



// 2026-05-18 — the user curates the default buff set at the project
// root (E:\枭熊插件\*.webm); those 12 files are copied into
// public/buff-fx/user-*.webm at deploy time and listed here. Nothing
// else ships as a default — every other webm in /buff-fx/ stays
// available for users to pick via the catalog editor's webm picker,
// but isn't auto-added.
//
// Catalog migration retires every previously-shipped default (the
// 32 from pre-2026-05-18 and the 76 from earlier that day) as long
// as the user hasn't customised them; see DEFAULT_BUFF_RETIRED_IDS
// + OLD_DEFAULT_SIGNATURES above.
export const DEFAULT_BUFFS: BuffDef[] = [
  // 2026-05-18 — re-encoded to 192×192 with alpha-preserving VP8
  // (libvpx, NOT libvpx-vp9: the latter silently strips the WebM
  // BlockAdditional alpha plane). 192×192 matches the default
  // intrinsic size every other shipped buff-fx file uses, so the
  // webmIntrinsicW/H override is no longer needed — bubbles.ts'
  // default offset (96, 96) lines up with the file centre.
  { id: "u_paralyzed",   name: "麻痹 ⚡",      color: "#ffff00", group: "异常", webmAsset: "buff-fx/user-paralyzed.webm" },
  { id: "u_stunned",     name: "眩晕 💫",      color: "#f5deb3", group: "异常", webmAsset: "buff-fx/user-stunned.webm" },
  { id: "u_charmed",     name: "魅惑 💘",      color: "#ff00d0", group: "异常", webmAsset: "buff-fx/user-charmed.webm" },
  // 专注 / 隐身 are ground rings, not overlay bubbles: 256px assets drawn
  // UNDER the token at 1.35x its footprint so the character stands inside them.
  // The intrinsic size must match the files or OBR mis-anchors the centre.
  { id: "u_invisible",   name: "隐形 👻",      color: "#cccccc", group: "增益", webmAsset: "buff-fx/user-invisible.webm", webmScale: 1.35, webmIntrinsicW: 256, webmIntrinsicH: 256, webmBelow: true },
  { id: "u_bardic",      name: "诗人激励 🎵",  color: "#7300ff", group: "增益", webmAsset: "buff-fx/user-bardic.webm" },
  { id: "u_disadvantage",name: "劣势 ⬇",      color: "#3b82f6", group: "异常", webmAsset: "buff-fx/user-disadvantage.webm" },
  { id: "u_advantage",   name: "优势 ⬆",      color: "#ffcc00", group: "增益", webmAsset: "buff-fx/user-advantage.webm" },
  { id: "u_restrained",  name: "束缚 🔗",      color: "#8b4513", group: "异常", webmAsset: "buff-fx/user-restrained.webm" },
  { id: "u_blessing",    name: "祝福 🧧",      color: "#ffff00", group: "增益", webmAsset: "buff-fx/user-blessing.webm" },
  { id: "u_guidance",    name: "神导术 👍",    color: "#ffff00", group: "增益", webmAsset: "buff-fx/user-guidance.webm" },
  { id: "u_hex",         name: "侵扰 😈",      color: "#7a1e9c", group: "异常", webmAsset: "buff-fx/user-hex.webm" },
  { id: "u_focused",     name: "专注 🧠",      color: "#4682b4", group: "增益", webmAsset: "buff-fx/user-focused.webm", webmScale: 1.35, webmIntrinsicW: 256, webmIntrinsicH: 256, webmBelow: true },
];
