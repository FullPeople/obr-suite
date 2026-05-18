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

// 2026-05-18 — DEFAULT_BUFFS regenerated to cover EVERY webm file
// shipped in public/buff-fx/ (~76 files). Each filename like
// `<group>-<topic>.webm` becomes one default entry: id = topic
// (custom-* keep the bare topic so the older built-in IDs migrate
// 1-to-1; non-custom files get the group prefix in the id to avoid
// collisions, e.g. `flash-fire` ≠ `radial-fire`). Names + colours
// reflect the topic; groups partition the catalog by effect style so
// the palette stays scannable.
//
// `DEFAULT_BUFF_RETIRED_IDS` lists every old built-in id that no
// longer ships as a default. The status-tracker-page catalog loader
// uses this set to migrate users from the old defaults to the new
// ones: any retired buff that's still in the LS catalog AND still
// matches its original default-state (no user-customised color /
// name / group / webm) is dropped on next load; any new default not
// already in the LS catalog is appended. User-customised entries are
// left untouched in both directions.

// Old default ids the migration may remove. Kept here even though
// many of these IDs ALSO appear in the new defaults below — the
// migration matches on the FULL default-state shape, not just the
// id, so a retired entry whose webmAsset / color / name / group all
// match the OLD defaults table is the only thing that gets removed.
// (A user who renamed "魅惑 💘" to "Charm of the Glabrezu" keeps it.)
export const DEFAULT_BUFF_RETIRED_IDS = new Set<string>([
  "paralyzed", "charmed", "invisible", "bardic", "vicious", "advantage",
  "stunned", "wet", "poisoned", "haste", "flying", "frozen",
  "innate_spell", "wild_shape", "blessing", "frightened", "unconscious",
  "guidance", "hunters_mark", "focused", "deafened", "incapacitated",
  "prone", "slowed", "blinded", "exhaustion", "dead", "petrified",
  "restrained", "grappled", "raging", "frozen_stiff",
]);

// Migration signature for each old-default id → the shape it had
// before the regeneration. Used to detect "user hasn't touched this
// built-in buff" — a match on every field means we can safely retire.
// Buffs whose new default has the SAME id will be re-added under the
// new defaults (with potentially different color / group), so the
// effect of the migration on those is "refresh to new defaults".
interface OldDefaultSignature {
  name: string; color: string; group?: string;
  webmAsset?: string; webmScale?: number;
}
export const OLD_DEFAULT_SIGNATURES: Record<string, OldDefaultSignature> = {
  paralyzed:    { name: "麻痹 ⚡",      color: "#ffff00", group: "异常",  webmAsset: "buff-fx/flash-lightning.webm" },
  charmed:      { name: "魅惑 💘",      color: "#ff00d0", group: "异常",  webmAsset: "buff-fx/custom-charmed.webm",      webmScale: 1.6 },
  invisible:    { name: "隐形 👻",      color: "#cccccc", group: "Buffs", webmAsset: "buff-fx/fade-ghost.webm",          webmScale: 1.0 },
  bardic:       { name: "诗人激励 🎵",  color: "#7300ff", group: "Buffs", webmAsset: "buff-fx/custom-bardic.webm",       webmScale: 1.4 },
  vicious:      { name: "劣势 ⬇",      color: "#3b82f6", group: "异常",  webmAsset: "buff-fx/custom-disadvantage.webm", webmScale: 1.0 },
  advantage:    { name: "优势 ⬆",      color: "#ffcc00", group: "Buffs", webmAsset: "buff-fx/custom-advantage.webm",    webmScale: 1.0 },
  stunned:      { name: "眩晕 💫",      color: "#f5deb3", group: "异常",  webmAsset: "buff-fx/orbit-dizzy.webm" },
  wet:          { name: "濡湿 💧",      color: "#87cefa", group: "异常",  webmAsset: "buff-fx/rain-drop.webm" },
  poisoned:     { name: "中毒 🤢",      color: "#008000", group: "异常",  webmAsset: "buff-fx/rain-test_tube.webm" },
  haste:        { name: "急速术 💨",    color: "#04a3ff", group: "Buffs", webmAsset: "buff-fx/float-wind.webm" },
  flying:       { name: "飞行术 🕊️",   color: "#d5d5d5", group: "Buffs", webmAsset: "buff-fx/custom-flying.webm",       webmScale: 1.4 },
  frozen:       { name: "冰冻 ❄️",     color: "#0000ff", group: "异常",  webmAsset: "buff-fx/custom-frozen.webm",       webmScale: 1.0 },
  innate_spell: { name: "先天术法 ⚡️", color: "#08fdfd", group: "Extra", webmAsset: "buff-fx/radial-star.webm" },
  wild_shape:   { name: "野性形态 💥",  color: "#ff0000", group: "Extra", webmAsset: "buff-fx/flash-boom.webm" },
  blessing:     { name: "祝福术 🧧",    color: "#ffff00", group: "Buffs", webmAsset: "buff-fx/radial-sparkles.webm" },
  frightened:   { name: "恐慌 😱",      color: "#2f4f4f", group: "异常",  webmAsset: "buff-fx/shake-screaming.webm" },
  unconscious:  { name: "昏迷 💤",      color: "#4b0082", group: "异常",  webmAsset: "buff-fx/float-zzz.webm" },
  guidance:     { name: "神导术 👍",    color: "#ffff00", group: "Buffs", webmAsset: "buff-fx/pulse-thumbs_up.webm" },
  hunters_mark: { name: "猎人印记 🎯",  color: "#00ff26", group: "Extra", webmAsset: "buff-fx/custom-hunters_mark.webm", webmScale: 1.0 },
  focused:      { name: "专注 🧠",      color: "#4682b4", group: "Extra", webmAsset: "buff-fx/custom-focused.webm",      webmScale: 1.0 },
  deafened:     { name: "耳聋 🎧",      color: "#c0c0c0", group: "异常",  webmAsset: "buff-fx/custom-deafened.webm",     webmScale: 1.0 },
  incapacitated:{ name: "失能 💔",      color: "#708090", group: "异常",  webmAsset: "buff-fx/custom-incapacitated.webm",webmScale: 1.0 },
  prone:        { name: "倒地 🦦",      color: "#cd853f", group: "异常",  webmAsset: "buff-fx/custom-prone.webm",        webmScale: 1.0 },
  slowed:       { name: "缓慢术 ⌛",    color: "#e805f4", group: "异常",  webmAsset: "buff-fx/custom-slowed.webm",       webmScale: 1.0 },
  blinded:      { name: "目盲 🕶️",     color: "#4a4a4a", group: "异常",  webmAsset: "buff-fx/custom-blinded.webm",      webmScale: 1.0 },
  exhaustion:   { name: "力竭 🦥",      color: "#ff0000", group: "异常",  webmAsset: "buff-fx/custom-exhaustion.webm",   webmScale: 1.0 },
  dead:         { name: "死亡 💀",      color: "#000000", group: "Extra", webmAsset: "buff-fx/custom-dead.webm",         webmScale: 1.0 },
  petrified:    { name: "石化 🗿",      color: "#8b7d6b", group: "异常",  webmAsset: "buff-fx/custom-petrified.webm",    webmScale: 1.0 },
  restrained:   { name: "束缚 🔗",      color: "#8b4513", group: "异常",  webmAsset: "buff-fx/custom-restrained.webm",   webmScale: 1.0 },
  grappled:     { name: "擒抱 🫂",      color: "#d2691e", group: "异常",  webmAsset: "buff-fx/custom-grappled.webm",     webmScale: 1.0 },
  raging:       { name: "狂暴 😠",      color: "#f20808", group: "Extra", webmAsset: "buff-fx/custom-raging.webm",       webmScale: 1.0 },
  frozen_stiff: { name: "冻僵 🥶",      color: "#00ffff", group: "异常",  webmAsset: "buff-fx/custom-frozen_stiff.webm", webmScale: 1.0 },
};

// Returns true when `buff` matches its old-default signature byte-for-byte.
// Other fields (effect, effectParams, iconAsset, rounds…) are ignored
// — if the user added any of those, that's a user customisation and
// the buff should NOT be auto-migrated away.
export function matchesOldDefault(buff: BuffDef): boolean {
  const sig = OLD_DEFAULT_SIGNATURES[buff.id];
  if (!sig) return false;
  if (buff.name !== sig.name) return false;
  if (buff.color !== sig.color) return false;
  if ((buff.group ?? undefined) !== (sig.group ?? undefined)) return false;
  if ((buff.webmAsset ?? undefined) !== (sig.webmAsset ?? undefined)) return false;
  const a = typeof buff.webmScale === "number" ? buff.webmScale : undefined;
  const b = typeof sig.webmScale === "number" ? sig.webmScale : undefined;
  if (a !== b) return false;
  if (buff.iconAsset) return false;
  if (buff.effect && buff.effect !== "default") return false;
  if (buff.webmOff) return false;
  return true;
}

export const DEFAULT_BUFFS: BuffDef[] = [
  // === custom-* : the curated "named status" set (D&D conditions + buffs) ===
  { id: "advantage",    name: "优势 ⬆",      color: "#ffcc00", group: "增益", webmAsset: "buff-fx/custom-advantage.webm" },
  { id: "bardic",       name: "诗人激励 🎵", color: "#7300ff", group: "增益", webmAsset: "buff-fx/custom-bardic.webm",       webmScale: 1.4 },
  { id: "blinded",      name: "目盲 🕶",     color: "#4a4a4a", group: "异常", webmAsset: "buff-fx/custom-blinded.webm" },
  { id: "charmed",      name: "魅惑 💘",     color: "#ff00d0", group: "异常", webmAsset: "buff-fx/custom-charmed.webm",      webmScale: 1.6 },
  { id: "dead",         name: "死亡 💀",     color: "#000000", group: "异常", webmAsset: "buff-fx/custom-dead.webm" },
  { id: "deafened",     name: "耳聋 🎧",     color: "#c0c0c0", group: "异常", webmAsset: "buff-fx/custom-deafened.webm" },
  { id: "disadvantage", name: "劣势 ⬇",     color: "#3b82f6", group: "异常", webmAsset: "buff-fx/custom-disadvantage.webm" },
  { id: "exhaustion",   name: "力竭 🦥",     color: "#ff6347", group: "异常", webmAsset: "buff-fx/custom-exhaustion.webm" },
  { id: "flying",       name: "飞行 🕊",    color: "#d5d5d5", group: "增益", webmAsset: "buff-fx/custom-flying.webm",       webmScale: 1.4 },
  { id: "focused",      name: "专注 🧠",     color: "#4682b4", group: "增益", webmAsset: "buff-fx/custom-focused.webm" },
  { id: "frozen",       name: "冰冻 ❄",     color: "#0000ff", group: "异常", webmAsset: "buff-fx/custom-frozen.webm" },
  { id: "frozen_stiff", name: "冻僵 🥶",     color: "#00ffff", group: "异常", webmAsset: "buff-fx/custom-frozen_stiff.webm" },
  { id: "grappled",     name: "擒抱 🫂",     color: "#d2691e", group: "异常", webmAsset: "buff-fx/custom-grappled.webm" },
  { id: "hunters_mark", name: "猎人印记 🎯", color: "#00ff26", group: "增益", webmAsset: "buff-fx/custom-hunters_mark.webm" },
  { id: "incapacitated",name: "失能 💔",     color: "#708090", group: "异常", webmAsset: "buff-fx/custom-incapacitated.webm" },
  { id: "invisible",    name: "隐形 👻",     color: "#cccccc", group: "增益", webmAsset: "buff-fx/custom-invisible.webm" },
  { id: "petrified",    name: "石化 🗿",     color: "#8b7d6b", group: "异常", webmAsset: "buff-fx/custom-petrified.webm" },
  { id: "prone",        name: "倒地 🦦",     color: "#cd853f", group: "异常", webmAsset: "buff-fx/custom-prone.webm" },
  { id: "raging",       name: "狂暴 😠",     color: "#f20808", group: "增益", webmAsset: "buff-fx/custom-raging.webm" },
  { id: "restrained",   name: "束缚 🔗",     color: "#8b4513", group: "异常", webmAsset: "buff-fx/custom-restrained.webm" },
  { id: "slowed",       name: "缓慢 ⌛",     color: "#e805f4", group: "异常", webmAsset: "buff-fx/custom-slowed.webm" },

  // === fade-* : ghostly / soft transitions ===
  { id: "fade_broken_heart", name: "心碎(渐隐) 💔", color: "#ff4d6d", group: "特效", webmAsset: "buff-fx/fade-broken_heart.webm" },
  { id: "fade_ghost",        name: "幽灵 👻",        color: "#cccccc", group: "特效", webmAsset: "buff-fx/fade-ghost.webm" },
  { id: "fade_sparkles",     name: "渐隐光辉 ✨",    color: "#f0e68c", group: "特效", webmAsset: "buff-fx/fade-sparkles.webm" },

  // === flash-* : punchy bursts ===
  { id: "flash_boom",      name: "爆裂 💥",      color: "#ff4500", group: "特效", webmAsset: "buff-fx/flash-boom.webm" },
  { id: "flash_clown",     name: "小丑 🤡",      color: "#ff69b4", group: "特效", webmAsset: "buff-fx/flash-clown.webm" },
  { id: "flash_fire",      name: "火焰闪 🔥",    color: "#ff4500", group: "特效", webmAsset: "buff-fx/flash-fire.webm" },
  { id: "flash_lightning", name: "闪电 ⚡",      color: "#ffff00", group: "特效", webmAsset: "buff-fx/flash-lightning.webm" },
  { id: "flash_sparkles",  name: "闪光 ✨",      color: "#fff8a0", group: "特效", webmAsset: "buff-fx/flash-sparkles.webm" },
  { id: "flash_star",      name: "闪星 ⭐",      color: "#ffd700", group: "特效", webmAsset: "buff-fx/flash-star.webm" },

  // === float-* : drifting upward ===
  { id: "float_dove",            name: "飘鸽 🕊",      color: "#dfe6ee", group: "特效", webmAsset: "buff-fx/float-dove.webm" },
  { id: "float_musical_note",    name: "飘音符 🎵",    color: "#7b61ff", group: "特效", webmAsset: "buff-fx/float-musical_note.webm" },
  { id: "float_sparkles",        name: "飘闪光 ✨",    color: "#ffd97a", group: "特效", webmAsset: "buff-fx/float-sparkles.webm" },
  { id: "float_sparkling_heart", name: "飘闪心 💖",    color: "#ff5ea8", group: "特效", webmAsset: "buff-fx/float-sparkling_heart.webm" },
  { id: "float_tulip",           name: "飘郁金香 🌷",  color: "#ff7eb3", group: "特效", webmAsset: "buff-fx/float-tulip.webm" },
  { id: "float_wind",            name: "飘风 💨",      color: "#04a3ff", group: "特效", webmAsset: "buff-fx/float-wind.webm" },
  { id: "float_zzz",             name: "睡眠 💤",      color: "#4b0082", group: "特效", webmAsset: "buff-fx/float-zzz.webm" },

  // === orbit-* : rotating ring around the token ===
  { id: "orbit_dizzy",     name: "眩晕 💫",     color: "#f5deb3", group: "特效", webmAsset: "buff-fx/orbit-dizzy.webm" },
  { id: "orbit_snowflake", name: "环雪 ❄",     color: "#a0e8ff", group: "特效", webmAsset: "buff-fx/orbit-snowflake.webm" },
  { id: "orbit_sparkles",  name: "环闪光 ✨",   color: "#ffd97a", group: "特效", webmAsset: "buff-fx/orbit-sparkles.webm" },
  { id: "orbit_star",      name: "环星 ⭐",     color: "#ffd700", group: "特效", webmAsset: "buff-fx/orbit-star.webm" },

  // === pulse-* : in-place heartbeat scale ===
  { id: "pulse_brain",            name: "脉动 🧠",     color: "#9b6dff", group: "特效", webmAsset: "buff-fx/pulse-brain.webm" },
  { id: "pulse_crystal_ball",     name: "占卜 🔮",     color: "#a685e2", group: "特效", webmAsset: "buff-fx/pulse-crystal_ball.webm" },
  { id: "pulse_sloth",            name: "缓动 🦥",     color: "#bda08a", group: "特效", webmAsset: "buff-fx/pulse-sloth.webm" },
  { id: "pulse_sparkling_heart",  name: "心搏 💖",     color: "#ff5ea8", group: "特效", webmAsset: "buff-fx/pulse-sparkling_heart.webm" },
  { id: "pulse_sun",              name: "日辉 ☀",     color: "#ffcc33", group: "特效", webmAsset: "buff-fx/pulse-sun.webm" },
  { id: "pulse_target",           name: "标靶 🎯",     color: "#ff4d4d", group: "特效", webmAsset: "buff-fx/pulse-target.webm" },
  { id: "pulse_thumbs_up",        name: "神导 👍",     color: "#ffff00", group: "特效", webmAsset: "buff-fx/pulse-thumbs_up.webm" },

  // === radial-* : emanating outward from token centre ===
  { id: "radial_fire",      name: "火辐 🔥",     color: "#ff4500", group: "特效", webmAsset: "buff-fx/radial-fire.webm" },
  { id: "radial_moon",      name: "月辉 🌙",     color: "#b8c4ff", group: "特效", webmAsset: "buff-fx/radial-moon.webm" },
  { id: "radial_snowflake", name: "雪辐 ❄",     color: "#a0e8ff", group: "特效", webmAsset: "buff-fx/radial-snowflake.webm" },
  { id: "radial_sparkles",  name: "祝福 🧧",     color: "#ffff00", group: "特效", webmAsset: "buff-fx/radial-sparkles.webm" },
  { id: "radial_star",      name: "星辐 ⭐",     color: "#ffd700", group: "特效", webmAsset: "buff-fx/radial-star.webm" },
  { id: "radial_sun",       name: "日光 ☀",     color: "#ffcc33", group: "特效", webmAsset: "buff-fx/radial-sun.webm" },

  // === rain-* : falling particles from above ===
  { id: "rain_cherry_blossom", name: "樱花雨 🌸",   color: "#ffb7d5", group: "特效", webmAsset: "buff-fx/rain-cherry_blossom.webm" },
  { id: "rain_drop",           name: "濡湿 💧",     color: "#87cefa", group: "特效", webmAsset: "buff-fx/rain-drop.webm" },
  { id: "rain_hourglass",      name: "沙漏 ⌛",     color: "#c5a880", group: "特效", webmAsset: "buff-fx/rain-hourglass.webm" },
  { id: "rain_leaves",         name: "落叶 🍃",     color: "#5db762", group: "特效", webmAsset: "buff-fx/rain-leaves.webm" },
  { id: "rain_snake",          name: "蛇雨 🐍",     color: "#8fbc8f", group: "特效", webmAsset: "buff-fx/rain-snake.webm" },
  { id: "rain_snowflake",      name: "雪雨 ❄",     color: "#a0e8ff", group: "特效", webmAsset: "buff-fx/rain-snowflake.webm" },
  { id: "rain_test_tube",      name: "中毒 🤢",     color: "#008000", group: "特效", webmAsset: "buff-fx/rain-test_tube.webm" },

  // === shake-* : jittering / vibrating ===
  { id: "shake_angry",     name: "愤怒 😠",     color: "#cc0000", group: "特效", webmAsset: "buff-fx/shake-angry.webm" },
  { id: "shake_cold_face", name: "寒颤 🥶",     color: "#00ffff", group: "特效", webmAsset: "buff-fx/shake-cold_face.webm" },
  { id: "shake_rage",      name: "暴怒 😡",     color: "#ff0000", group: "特效", webmAsset: "buff-fx/shake-rage.webm" },
  { id: "shake_screaming", name: "恐慌 😱",     color: "#2f4f4f", group: "特效", webmAsset: "buff-fx/shake-screaming.webm" },

  // === static-* : still-image icons placed on the token ===
  { id: "static_broken_heart",   name: "心碎 💔",     color: "#ff4d6d", group: "图标", webmAsset: "buff-fx/static-broken_heart.webm" },
  { id: "static_chains",         name: "锁链 🔗",     color: "#8b4513", group: "图标", webmAsset: "buff-fx/static-chains.webm" },
  { id: "static_crystal_ball",   name: "水晶球 🔮",   color: "#a685e2", group: "图标", webmAsset: "buff-fx/static-crystal_ball.webm" },
  { id: "static_headphones",     name: "耳机 🎧",     color: "#c0c0c0", group: "图标", webmAsset: "buff-fx/static-headphones.webm" },
  { id: "static_moai",           name: "石像 🗿",     color: "#8b7d6b", group: "图标", webmAsset: "buff-fx/static-moai.webm" },
  { id: "static_otter",          name: "水獭 🦦",     color: "#cd853f", group: "图标", webmAsset: "buff-fx/static-otter.webm" },
  { id: "static_people_hugging", name: "拥抱 🫂",     color: "#d2691e", group: "图标", webmAsset: "buff-fx/static-people_hugging.webm" },
  { id: "static_red_envelope",   name: "红包 🧧",     color: "#e53935", group: "图标", webmAsset: "buff-fx/static-red_envelope.webm" },
  { id: "static_skull",          name: "骷髅 💀",     color: "#222222", group: "图标", webmAsset: "buff-fx/static-skull.webm" },
  { id: "static_sunglasses",     name: "墨镜 🕶",    color: "#4a4a4a", group: "图标", webmAsset: "buff-fx/static-sunglasses.webm" },
  { id: "static_thumbs_up",      name: "拇指 👍",     color: "#ffd700", group: "图标", webmAsset: "buff-fx/static-thumbs_up.webm" },
];
