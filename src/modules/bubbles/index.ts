// Bubbles — HP bar + AC + temp-HP stat indicators on tokens.
//
// Adapted from "Stat Bubbles for D&D" by Seamus Finlayson:
//   https://github.com/SeamusFinlayson/Bubbles-for-Owlbear-Rodeo
// That project and this suite are both GNU GPL-3.0. What's shared is
// the architectural shape (compound items per token, image-grid-aware
// positioning via OBR's Math2, the metadata-key namespace) and the
// functional layout constants required for visual parity (bar height,
// bubble diameter, padding, opacities). The implementation below is
// written fresh, tracking the suite's existing module conventions.
//
// Layout:
//
//   ┌───────────── token bounds ─────────────┐
//   │                                        │
//   │           [ token image ]              │
//   │                                        │
//   │ ╭──────── HP bar full width ────────╮  │
//   │ │  current/max +temp-HP suffix       │  │   ← ⌐ bar straddles bottom edge
//   ╰─╰────────────────────────────────────╯──╯
//                                  ┌──┐  ┌──┐
//                                  │+5│  │16│   ← Temp HP / AC stat bubbles
//                                  └──┘  └──┘     (above the bar, right-aligned)

import OBR, {
  buildCurve,
  buildEffect,
  buildShape,
  buildText,
  Image,
  Item,
  isImage,
  Math2,
  Vector2,
} from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";

const PLUGIN_ID = "com.obr-suite/bubbles";
const BUBBLE_OWNER_KEY = `${PLUGIN_ID}/owner`;
// Role tag stamped onto each item's metadata so the in-place
// `patchGeometry` dispatcher knows what kind of update to apply
// (each role updates different fields — Curve.points vs
// Shape.width/height vs Effect.uniforms vs Text dimensions).
const BUBBLE_ROLE_KEY = `${PLUGIN_ID}/role`;
type BubbleRole =
  | "hp-bg" | "hp-fill" | "hp-shimmer" | "hp-text"
  | "ac-shield" | "ac-text"
  | "temp-bg"  | "temp-text";

function bubbleMeta(tokenId: string, role: BubbleRole): Record<string, unknown> {
  return { [BUBBLE_OWNER_KEY]: tokenId, [BUBBLE_ROLE_KEY]: role };
}

export const LS_BUBBLES_ENABLED = `${PLUGIN_ID}/enabled`;
export const LS_BUBBLES_SCALE = `${PLUGIN_ID}/scale`;
// Per-client vertical offset in scene-coord pixels. Negative shifts the
// whole bubble cluster upward (away from the token); the default -20
// keeps everything clear of the token's name label that OBR draws
// just below the bubble row.
export const LS_BUBBLES_VERTICAL_OFFSET = `${PLUGIN_ID}/vertical-offset`;
const DEFAULT_VERTICAL_OFFSET = -20;
// New 2026-05-09 setting. When ON, bubble cluster offsets up by
// TOKEN_TEXT_FONT_BASE (= 20) NATIVE pixels — SCALE inheritance
// then multiplies by parent.scale at draw time, so the visual
// offset matches the auto-scaling font label height. When ON, the
// `vertical-offset` slider is ignored.
export const LS_BUBBLES_OFFSET_BY_TEXT = `${PLUGIN_ID}/offset-by-text`;
// 2026-05-13 — overhead mode (头顶模式). Per-client toggle. When ON:
//   • HP bar sits above the token's top with a small gap (was below)
//   • Bar has 0 corner radius + a visible border (was capsule, no border)
//   • AC shield (and Temp HP) render INLINE at the right end of the
//     bar on the SAME PLANE (was stacked above the bar as separate
//     circles).
//   • The "offset by font size" toggle is force-disabled (UI-grayed
//     + ignored at compute-time) — overhead mode owns the vertical
//     placement.
export const LS_BUBBLES_OVERHEAD_MODE = `${PLUGIN_ID}/overhead-mode`;

// Per-DM-room player visibility threshold (in percent, 0-100). For
// LOCKED tokens, the player-side displayed HP ratio is quantised to
// the next ceiling step of size T% — e.g. T=25 means players see
// 100/75/50/25/0 only. T=0 → no quantisation (continuous). T=100 →
// always 100% (progress invisible). Stored per-DM-client so different
// tables can pick their own granularity.
export const LS_BUBBLES_PLAYER_THRESHOLD = `${PLUGIN_ID}/player-threshold`;
const DEFAULT_PLAYER_THRESHOLD = 25;
const SCENE_BUBBLES_SETTINGS_KEY = `${PLUGIN_ID}/settings`;

// Initiative-tracker scene metadata key — bubbles reads it to decide
// whether locked tokens should show their bar to players right now
// (during prep / combat) or stay hidden (idle).
const COMBAT_STATE_KEY = "com.initiative-tracker/combat";

// Suite-owned HP/AC namespace. We still read the upstream extension key
// as a migration fallback, but all new suite writes should target this.
export const BUBBLES_META = "com.obr-suite/bubbles/data";
export const EXTERNAL_BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";

// Suite binding markers — bubbles only renders for tokens that the
// suite has explicitly tagged as a bestiary monster or a character
// card. Plain image tokens (decorations, NPCs without HP, etc.)
// shouldn't sprout an HP bar even if they happen to carry stale
// bubbles metadata from a previous binding.
const CC_BIND_KEY = "com.character-cards/boundCardId";
const BESTIARY_SLUG_KEY = "com.bestiary/slug";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";
// Lightweight HP bar component flag — set by modules/hpBar/index.ts
// (right-click menu OR auto-add on selection of a token that
// already has bubbles values). Tokens with this flag render the
// HP bar even without a cc / bestiary binding, so user-spawned
// "plain" tokens with HP/AC also get the bar.
const HP_BAR_FLAG_KEY = "com.obr-suite/hp-bar/enabled";

// --- Functional constants matching upstream for visual parity ----------
const BAR_HEIGHT = 20;
const BAR_PADDING = 2;
const BAR_CORNER_RADIUS = BAR_HEIGHT / 2;
const BG_OPACITY = 0.6;
// Bumped from 0.5 → 0.85 so the red fill reads as a clear "this is
// the HP bar" instead of a faint translucent wash on top of the
// canvas. Matches the user's "目前太淡" feedback.
const FILL_OPACITY = 0.85;
const BAR_FONT_SIZE = 22;

const DIAMETER = 30;
const BUBBLE_FONT_SIZE = DIAMETER - 8;          // 22, fits 1–2 digits
const BUBBLE_FONT_SIZE_TIGHT = DIAMETER - 15;   // 15, used for 3 digits
const TEXT_VERTICAL_OFFSET = -0.3;              // OBR text rendering nudge

// OBR Image item's `text.style.fontSize` baseline at tokenScale = 1.0
// (a 5-foot / 1-cell token). Auto-scale-text mode multiplies this by
// tokenScale per token so a 3-cell ogre gets a name label 3× the
// height of a 1-cell goblin's. 20 was picked over OBR's default 33
// because tokens with two-digit HP / AC bubbles overlap the upstream
// default in cramped grids.
const TOKEN_TEXT_FONT_BASE = 20;

// Stat bubble palette. HP_FILL is a darker, more saturated red so
// the bar stays legible at lower opacities and against varied map
// art (was the lighter #e74c3c earlier).
const HP_FILL = "#a52424";
const HP_BG = "#A4A4A4";
const HP_BG_HIDDEN = "#3b0f12";    // GM-only dark-red bar when hidden from players
const TEMP_HP_COLOR = "#3b82f6";    // blue
const AC_COLOR = "#c0c4cc";         // silver

const FONT_FAMILY = "Roboto, sans-serif";

// 2026-05-09 rewrite: re-enable SCALE inheritance, keep ROTATION
// disabled.
//
// 2026-05-10 REVERT to 1.0.30-era model: SCALE inheritance is back
// on the disable list, so bubbles do NOT auto-scale with the parent.
// Every dimension is baked in RENDERED scene units (parent.scale
// magnitude already applied) and every position is in world coords.
// The renderer does NOT multiply by parent.scale at draw time, so
// the math is invariant to scale sign — negative parent.scale (token
// horizontally flipped) is handled by `getImageCenter` returning
// the correct visual centre, with no per-builder flipX hack.
//
// The trade-off vs. the SCALE-inherit model: bubbles snap on
// gesture-end instead of tracking the visual scale during the
// gesture itself (items.onChange + getItemBounds both only fire
// at commit). Earlier "live scale" experiments depended on the
// renderer multiplication, which the user reported as broken for
// (a) initial scales != 1 and (b) negative scales. Rolling back to
// the all-inherit-disabled model fixes both at the cost of a
// single-frame snap on resize commit, which the user has accepted
// in prior iterations.
const DISABLE_INHERIT: Array<"SCALE" | "ROTATION" | "POSITION" | "VISIBLE" | "LOCKED" | "COPY" | "DELETE"> = [
  "SCALE",
  "ROTATION",
  "LOCKED",
  "COPY",
];

// --- Data shape ---------------------------------------------------------
interface BubbleData {
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number | null;
  hide: boolean;
  /** Per-token DM lock. When true (default for new tokens) the player
   *  view is combat-gated: no bar in idle, bar without text+AC in
   *  prep/combat with the player-threshold quantization applied. When
   *  false everyone sees the full bar with text. The DM toggles this
   *  via the lock icon at the right end of the cc-info / monster-info
   *  stat banner. */
  locked: boolean;
}

function readBubbleData(item: Item): BubbleData | null {
  const meta = (item.metadata as any) ?? {};
  const m = meta[BUBBLES_META] ?? meta[EXTERNAL_BUBBLES_META];
  if (!m || typeof m !== "object") return null;
  const hpRaw = Number(m["health"]);
  const maxRaw = Number(m["max health"]);
  const tempRaw = Number(m["temporary health"]);
  const acRaw = m["armor class"];
  const hasHp = Number.isFinite(maxRaw) && maxRaw > 0;
  const hasAc = acRaw != null && Number.isFinite(Number(acRaw));
  if (!hasHp && !hasAc) return null;
  // `locked` defaults to TRUE when the field is absent — matches the
  // user's spec ("默认上锁"). DM unlock writes an explicit `false`.
  const lockedRaw = m["locked"];
  const locked = lockedRaw === undefined ? true : !!lockedRaw;
  return {
    hp: Number.isFinite(hpRaw) ? Math.max(0, Math.min(hpRaw, hasHp ? maxRaw : hpRaw)) : (hasHp ? maxRaw : 0),
    maxHp: hasHp ? maxRaw : 0,
    tempHp: Number.isFinite(tempRaw) && tempRaw > 0 ? Math.floor(tempRaw) : 0,
    ac: hasAc ? Number(acRaw) : null,
    hide: !!m["hide"],
    locked,
  };
}

function dataHash(d: BubbleData): string {
  return `${d.hp}|${d.maxHp}|${d.tempHp}|${d.ac == null ? "_" : d.ac}|${d.hide ? 1 : 0}`;
}

// Split the data hash into a structural component (which items must
// exist) and a value component (the numeric stats). Sync diffs that
// only touch valueHash now flow through patchGeometry instead of
// delete-then-add — eliminates the brief blank flash the user sees
// when adjusting HP via the cc-info / monster-info panels.
//
// Anything that affects WHICH bubble items exist or HOW they're styled
// at construction time goes into structureHash. Anything that's just a
// number patched live via patchGeometry → valueHash.
function structureHash(d: BubbleData): string {
  const hpBar = d.maxHp > 0 ? "1" : "0";
  const ac = d.ac != null ? "1" : "0";
  const hidden = d.hide ? "1" : "0";
  return `${hpBar}${ac}${hidden}`;
}
function valueHash(d: BubbleData): string {
  return `${d.hp}|${d.maxHp}|${d.tempHp}|${d.ac == null ? "_" : d.ac}`;
}

function readEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_BUBBLES_ENABLED);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {}
  return true;
}

function readUserScale(): number {
  try {
    const v = localStorage.getItem(LS_BUBBLES_SCALE);
    if (v) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0.3 && n < 3) return n;
    }
  } catch {}
  return 1;
}

function readVerticalOffset(): number {
  try {
    const v = localStorage.getItem(LS_BUBBLES_VERTICAL_OFFSET);
    if (v != null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  return DEFAULT_VERTICAL_OFFSET;
}

function readOffsetByText(): boolean {
  try {
    const v = localStorage.getItem(LS_BUBBLES_OFFSET_BY_TEXT);
    if (v === "1") return true;
  } catch {}
  return false;
}

function readOverheadMode(): boolean {
  try {
    const v = localStorage.getItem(LS_BUBBLES_OVERHEAD_MODE);
    if (v === "1") return true;
  } catch {}
  return false;
}

function readPlayerThreshold(): number {
  return cachedPlayerThreshold;
}

/** Quantise a 0..1 ratio to the nearest ceiling step of size T/100.
 *  Used for the player-side display ratio of locked tokens. T=0 →
 *  return ratio unchanged. T=100 → ratio always rounded up to 1
 *  (progress invisible). For 0 < T < 100, the next-ceiling step
 *  matches the user's spec: HP must drop to or below NN% before
 *  the player sees a step change. */
function quantiseRatio(ratio: number, thresholdPercent: number): number {
  if (thresholdPercent <= 0) return ratio;
  const step = thresholdPercent / 100;
  if (step >= 1) return ratio > 0 ? 1 : 0;
  const stepped = Math.ceil(ratio / step) * step;
  return Math.max(0, Math.min(1, stepped));
}

// Combat-active flag, cached so syncBubbles doesn't have to query
// scene metadata on every tick. Refreshed on scene-ready and on
// metadata-change events.
let cachedCombatActive = false;
let cachedPlayerThreshold = DEFAULT_PLAYER_THRESHOLD;
let cachedAutoScaleText = false;
function readCombatActive(meta: Record<string, unknown>): boolean {
  const c = meta[COMBAT_STATE_KEY] as { inCombat?: boolean; preparing?: boolean } | undefined;
  return !!(c?.inCombat || c?.preparing);
}
function readScenePlayerThreshold(meta: Record<string, unknown>): number {
  const settings = meta[SCENE_BUBBLES_SETTINGS_KEY] as { playerThreshold?: unknown } | undefined;
  const n = Number(settings?.playerThreshold);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_PLAYER_THRESHOLD;
}
// Auto-scale-text: when ON, the HP-bar / AC / temp bubble font size
// follows the token's renderedSize (in addition to the user's
// per-client `bubbleScale`). When OFF, font size is fixed across
// token sizes (only the user's manual scale slider affects it). The
// flag also gates whether the manual `verticalOffset` setting is
// honored — in auto-scale mode the offset becomes a function of the
// font size so big tokens push their bubble cluster up further than
// small tokens automatically. DM-controlled, lives in scene metadata
// so all clients render the same way.
function readSceneAutoScaleText(meta: Record<string, unknown>): boolean {
  const settings = meta[SCENE_BUBBLES_SETTINGS_KEY] as { autoScaleText?: unknown } | undefined;
  return !!settings?.autoScaleText;
}

type ViewMode = "full" | "hidden" | "silhouette";

/**
 * Decide what bubble shape this client should draw for `d`.
 *
 *   "full"       — bar + text + AC (GM, owner of the token, or
 *                  unlocked + visible-to-all)
 *   "hidden"     — nothing (legacy GM-only `hide`, or locked + idle)
 *   "silhouette" — bar only, with quantised ratio. No text, no AC.
 *                  Used for locked tokens shown to players during
 *                  prep / combat (excluding the player who owns
 *                  the token).
 *
 * `ownsItem` — whether this client is the OBR-side owner of the
 * token (createdUserId match). Owner gets the same view as DM so
 * that DM-given owner permission lets the player see real numbers
 * for "their" monster pet / ally etc.
 */
function computeViewMode(
  d: BubbleData,
  isGM: boolean,
  inCombat: boolean,
  ownsItem: boolean,
  isBestiaryBound: boolean,
): ViewMode {
  if (d.hide) return isGM ? "full" : "hidden";
  if (isGM) return "full";
  if (ownsItem) return "full";
  // Bestiary-bound monsters: respect lock state. Unlocked means full
  // visibility (HP numbers + AC visible to all players). Locked means
  // silhouette in combat (HP bar progress visible, numbers hidden).
  // Out of combat, locked monsters are hidden.
  if (isBestiaryBound) {
    if (d.locked) return inCombat ? "silhouette" : "hidden";
    return "full";
  }
  if (d.locked) return inCombat ? "silhouette" : "hidden";
  return "full";
}

// --- Math helpers ------------------------------------------------------
//
// Reproduce the visible center of a token image accounting for
// `image.grid.offset` (the image's anchor point), the image's own
// dpi vs the scene's dpi, the item's per-axis scale, and rotation.
// `tok.position` is where the OFFSET POINT lands in world coords —
// not necessarily the center.

function getImageCenter(image: Image, sceneDpi: number): Vector2 {
  let p: Vector2 = { x: image.image.width / 2, y: image.image.height / 2 };
  p = Math2.subtract(p, image.grid.offset);
  p = Math2.multiply(p, sceneDpi / image.grid.dpi);
  p = { x: p.x * image.scale.x, y: p.y * image.scale.y };
  p = Math2.rotate(p, { x: 0, y: 0 }, image.rotation);
  return Math2.add(p, image.position);
}

function getRenderedSize(image: Image, sceneDpi: number) {
  const dpiRatio = sceneDpi / image.grid.dpi;
  return {
    width: Math.abs(image.image.width * dpiRatio * image.scale.x),
    height: Math.abs(image.image.height * dpiRatio * image.scale.y),
  };
}

// Sync the OBR-native `text.style.fontSize` on every character / mount
// image so the parent token's plainText label scales with `tokenScale`
// when the DM enables auto-scale-text.
//
// **OFF-mode is a no-op** — once the toggle is off, this plugin must
// not touch fontSize again. Otherwise the user can't manually set a
// custom size in OBR's own token-edit panel without us overwriting
// it on the next sync pass.
//
// DM-only — the token data path is shared, so writing once on the GM
// client propagates to every player automatically. The dedupe guard
// (only push tokens whose fontSize differs from the target) keeps
// items.onChange from looping forever.
async function syncTokenTextFontSize(
  items: Item[],
  sceneDpi: number,
  autoScale: boolean,
): Promise<void> {
  if (!autoScale) return;
  const targetIds: string[] = [];
  const targetSize = new Map<string, number>();
  for (const it of items) {
    if (it.layer !== "CHARACTER" && it.layer !== "MOUNT") continue;
    if (!isImage(it)) continue;
    const text = (it as any).text as { style?: { fontSize?: number } } | undefined;
    if (!text || !text.style) continue;
    const cur = Number(text.style.fontSize ?? TOKEN_TEXT_FONT_BASE);
    const size = getRenderedSize(it as Image, sceneDpi);
    const tokenScale = Math.max(0.05, Math.min(size.width, size.height) / sceneDpi);
    const want = Math.round(TOKEN_TEXT_FONT_BASE * tokenScale);
    if (cur === want) continue;
    targetIds.push(it.id);
    targetSize.set(it.id, want);
  }
  if (!targetIds.length) return;
  try {
    await OBR.scene.items.updateItems(targetIds, (drafts) => {
      for (const d of drafts) {
        const want = targetSize.get(d.id);
        if (want == null) continue;
        const t = (d as any).text as { style?: { fontSize?: number } } | undefined;
        if (t?.style && t.style.fontSize !== want) {
          t.style.fontSize = want;
        }
      }
    });
  } catch (e) {
    console.warn("[obr-suite/bubbles] syncTokenTextFontSize failed", e);
  }
}

// Image dimensions and visible centre at NATIVE (image.scale = 1).
//
// With SCALE inheritance on, the parent's scale.x/y is applied by the
// renderer during attached-item drawing. We MUST size and position
// the bubbles at the parent's native scale, otherwise the renderer's
// applied scale double-stacks on top of our pre-scaled values.
//
// `getImageNativeCenter` returns the world position the image's
// pixel-centre would be at if image.scale = 1 — i.e. parent.position
// plus the dpi-adjusted (but unscaled) offset from anchor to centre.
// For typical centre-anchored tokens this equals image.position.
function getImageNativeSize(image: Image, sceneDpi: number) {
  const dpiRatio = sceneDpi / image.grid.dpi;
  return {
    width: Math.abs(image.image.width * dpiRatio),
    height: Math.abs(image.image.height * dpiRatio),
  };
}

function getImageNativeCenter(image: Image, sceneDpi: number): Vector2 {
  let p: Vector2 = { x: image.image.width / 2, y: image.image.height / 2 };
  p = Math2.subtract(p, image.grid.offset);
  p = Math2.multiply(p, sceneDpi / image.grid.dpi);
  // NB: deliberately NOT multiplied by image.scale — the renderer
  // applies that itself when SCALE inheritance is on.
  p = Math2.rotate(p, { x: 0, y: 0 }, image.rotation);
  return Math2.add(p, image.position);
}

/** Pre-scale, pre-rotation, pre-position offset from the parent's
 *  position to the image's visual centre. With SCALE inheritance ON
 *  and ROTATION inheritance OFF, the renderer computes a child's
 *  world position as `parent.position + S(parent.scale) * field`,
 *  so the bubble's `position` field is interpreted as this local
 *  pre-transform offset. For typical center-anchored tokens
 *  (image.grid.offset === image.size/2) this returns (0, 0). */
function getImageNativeLocalCenter(image: Image, sceneDpi: number): Vector2 {
  let p: Vector2 = { x: image.image.width / 2, y: image.image.height / 2 };
  p = Math2.subtract(p, image.grid.offset);
  p = Math2.multiply(p, sceneDpi / image.grid.dpi);
  // No rotation, no scale, no parent.position addition.
  return p;
}

// Polygon points for a rounded rectangle anchored at (0, 0) extending
// into the +x / +y quadrant. `fill` ∈ [0, 1] produces a partial
// rectangle ending in a rounded right edge — used for the HP bar's
// filled portion.
function roundedRectanglePoints(
  width: number,
  height: number,
  radius: number,
  fill = 1,
  pointsInCorner = 10,
): Vector2[] {
  if (radius * 2 > height) radius = height / 2;
  if (radius * 2 > width) radius = width / 2;

  const arc = (cx: number, cy: number, fromAngle: number, toAngle: number): Vector2[] => {
    const out: Vector2[] = [];
    for (let i = 0; i <= pointsInCorner; i++) {
      const t = i / pointsInCorner;
      const a = fromAngle + (toAngle - fromAngle) * t;
      out.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    }
    return out;
  };

  if (fill >= 1) {
    return [
      ...arc(radius, radius, -Math.PI, -Math.PI / 2),                  // top-left
      ...arc(width - radius, radius, -Math.PI / 2, 0),                 // top-right
      ...arc(width - radius, height - radius, 0, Math.PI / 2),         // bottom-right
      ...arc(radius, height - radius, Math.PI / 2, Math.PI),           // bottom-left
    ];
  }

  const filledWidth = Math.max(0, Math.min(width, fill * width));
  if (filledWidth <= 0) return [];
  if (filledWidth <= radius) {
    // Tiny sliver at critical HP — render a half-pill so the user
    // still sees a small red blip.
    return [
      ...arc(radius, radius, -Math.PI, -Math.PI / 2),
      { x: radius, y: 0 },
      { x: radius, y: height },
      ...arc(radius, height - radius, Math.PI / 2, Math.PI),
    ];
  }
  return [
    ...arc(radius, radius, -Math.PI, -Math.PI / 2),
    { x: filledWidth - radius, y: 0 },
    ...arc(filledWidth - radius, radius, -Math.PI / 2, 0),
    ...arc(filledWidth - radius, height - radius, 0, Math.PI / 2),
    { x: filledWidth - radius, y: height },
    ...arc(radius, height - radius, Math.PI / 2, Math.PI),
  ];
}

// Polygon points for a heraldic heater-shield outline anchored at
// (0, 0) extending into +x / +y. The shield has gently rounded top
// corners, vertical sides for the upper ~45%, then quadratic-bezier
// curves converging to a point at the bottom-center. Pure geometry,
// no styling — fed into `buildCurve().points()` like any other
// closed polygon.
function shieldPoints(W: number, H: number, segments = 14): Vector2[] {
  const pts: Vector2[] = [];
  const cornerR = Math.min(W, H) * 0.18;
  const sideStraightBottom = H * 0.42;

  // Top-left corner arc
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -Math.PI + (Math.PI / 2) * t;
    pts.push({
      x: cornerR + Math.cos(a) * cornerR,
      y: cornerR + Math.sin(a) * cornerR,
    });
  }
  // Top-right corner arc
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -Math.PI / 2 + (Math.PI / 2) * t;
    pts.push({
      x: W - cornerR + Math.cos(a) * cornerR,
      y: cornerR + Math.sin(a) * cornerR,
    });
  }
  // Right side straight to (W, sideStraightBottom)
  pts.push({ x: W, y: sideStraightBottom });
  // Quadratic bezier from (W, sideStraightBottom) → (W/2, H), bowing inward
  const segs2 = segments * 2;
  for (let i = 1; i <= segs2; i++) {
    const t = i / segs2;
    const u = 1 - t;
    const p0 = { x: W, y: sideStraightBottom };
    const p1 = { x: W * 0.85, y: H * 0.92 };
    const p2 = { x: W / 2, y: H };
    pts.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  // Mirror curve from bottom-point back up to (0, sideStraightBottom)
  for (let i = 1; i <= segs2; i++) {
    const t = i / segs2;
    const u = 1 - t;
    const p0 = { x: W / 2, y: H };
    const p1 = { x: W * 0.15, y: H * 0.92 };
    const p2 = { x: 0, y: sideStraightBottom };
    pts.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  // Curve auto-closes from (0, sideStraightBottom) back to first arc point
  return pts;
}

// SKSL shader for the HP-bar overlay (animation only, on top of the
// gray-bg + red-fill curves stacked underneath). Renders animated
// "blood cells" drifting left → right inside the filled portion
// of the bar. Driven by the `iTime` uniform that the animation
// timer ticks.
const HP_SHIMMER_SKSL = `
uniform float iTime;
uniform float2 iSize;
uniform float ratio;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 234.45));
  p += dot(p, p + 34.45);
  return fract(p.x * p.y);
}

half4 main(float2 coord) {
  float2 size = iSize;

  // Bail past the filled portion entirely.
  float fillEnd = ratio * size.x;
  if (coord.x > fillEnd) return half4(0);

  // Rounded-end clipping. Both bar ends and the right edge of the
  // partial fill are semicircles of radius size.y / 2.
  float r = size.y * 0.5;
  float2 cc;
  cc.x = clamp(coord.x, r, max(r, fillEnd - r));
  cc.y = clamp(coord.y, r, size.y - r);
  float dist = distance(coord, cc);
  if (dist > r) return half4(0);
  float edge = 1.0 - smoothstep(r - 1.5, r, dist);

  // Slow-drifting "blood cells" — 7 of them, each with its own
  // y-position, radius, speed, and phase, looping across the bar
  // with a 2-r overshoot so they enter / exit smoothly.
  float cells = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float s1 = hash21(float2(fi, 1.7));
    float s2 = hash21(float2(fi, 4.3));
    float s3 = hash21(float2(fi, 9.1));

    float speed = mix(size.y * 0.35, size.y * 0.75, s1);
    float cy = mix(size.y * 0.25, size.y * 0.75, s2);
    float cr = mix(size.y * 0.20, size.y * 0.34, s3);

    float cycle = size.x + cr * 4.0;
    float cx = mod(iTime * speed + s1 * cycle, cycle) - cr * 2.0;

    float d = length(float2(coord.x - cx, coord.y - cy));
    cells += smoothstep(cr, cr * 0.35, d);
  }

  float ripple = sin(coord.x * 0.05 - iTime * 1.2) * 0.04;
  float base = 0.72;
  float intensity = clamp(base + cells * 0.45 + ripple, 0.0, 1.0);
  intensity = clamp(intensity + (1.0 - coord.y / size.y) * 0.08, 0.0, 1.0);

  float cellMix = clamp(cells * 0.5, 0.0, 1.0);
  half3 deepRed   = half3(0.78, 0.05, 0.08);
  half3 brightRed = half3(1.00, 0.30, 0.22);
  half3 color = mix(deepRed, brightRed, cellMix);

  float alpha = clamp(intensity * 0.92, 0.0, 1.0) * edge;
  return half4(color * intensity, alpha);
}
`;

// --- Per-token rendering state -----------------------------------------
//
// Each token may have up to 6 attached local items:
//   bgId / fillId / textId   — HP bar (3 items)
//   acBgId / acTextId        — AC stat bubble (2 items)
//   tempBgId / tempTextId    — Temp HP stat bubble (2 items)
interface BubbleEntry {
  ids: string[];                  // every local item id we own for this token
  shimmerIds: string[];           // every shader Effect we own (timer ticks iTime on these)
  /** Rebuild trigger — combines structure + value + flip + intrinsic
   *  geometry into one string. Rebuilt = full delete + add. Things
   *  NOT included here (parent.position, parent.scale magnitude,
   *  parent.rotation) are handled by OBR's attachment inheritance
   *  at draw time, so a sync that finds no rebuildHash change can
   *  skip everything. */
  rebuildHash: string;
  data: BubbleData;
  statsVisible: boolean;
}
const entries = new Map<string, BubbleEntry>();

let role: "GM" | "PLAYER" = "PLAYER";
let myPlayerId = "";  // own id — used to detect token ownership for full-bar override
let unsubs: Array<() => void> = [];
let inSync = false;
let queuedSync = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
// Scene DPI cached at setup + on grid changes so the bounds-poll
// doesn't have to await `OBR.scene.grid.getDpi()` every frame.
let cachedSceneDpi = 150;

// --- Animation timer for shimmer effects ----------------------------------
// OBR Effect items don't auto-update their uniforms, so we drive `iTime`
// from a single throttled interval. One batched updateItems per tick
// updates every active shimmer — cheaper than per-token calls.
let animationTimer: ReturnType<typeof setInterval> | null = null;
let animationStart = Date.now();

function ensureAnimationTimer(): void {
  if (animationTimer) return;
  let any = false;
  for (const e of entries.values()) if (e.shimmerIds.length) { any = true; break; }
  if (!any) return;
  animationStart = Date.now();
  animationTimer = setInterval(() => {
    const ids: string[] = [];
    for (const e of entries.values()) ids.push(...e.shimmerIds);
    if (ids.length === 0) {
      stopAnimationTimer();
      return;
    }
    const t = (Date.now() - animationStart) / 1000;
    OBR.scene.local.updateItems(ids, (drafts) => {
      for (const d of drafts) {
        const eff = d as any;
        if (!Array.isArray(eff.uniforms)) continue;
        let found = false;
        for (const u of eff.uniforms) {
          if (u.name === "iTime") { u.value = t; found = true; break; }
        }
        if (!found) eff.uniforms.push({ name: "iTime", value: t });
      }
    }).catch((e) => console.warn("[bubbles] timer updateItems failed", e));
  }, 60);
}

function stopAnimationTimer(): void {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
}

let scheduleSyncCount = 0;
function scheduleSync(): void {
  scheduleSyncCount++;
  if (pendingTimer) return;
  // Debounce reduced from 60 → 16 ms (one frame). The original 60 ms
  // was set when a single onChange could spam many events during a
  // resize gesture, but the upstream cluster has since coalesced
  // those. For HP/AC edits dispatched from the cc-info / monster-info
  // panels, every saved 45 ms is felt as snappier feedback on the
  // bubbles bar above the token.
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    syncBubbles().catch((e) => console.warn("[obr-suite/bubbles] sync failed", e));
  }, 16);
}

// (Earlier rounds attempted a requestAnimationFrame `getItemBounds`
// poll here to drive live updates during a token-resize gesture.
// Empirically `getItemBounds` ALSO only updates on commit — same as
// `items.onChange` — so the poll fired only at the same instant the
// onChange handler did, with no benefit. The current solution uses
// SCALE attachment-inheritance instead: the renderer applies the
// parent's transform to attached items in real time, so the bar
// visually scales during the drag without any polling. On commit
// `items.onChange` fires and patchGeometry runs once for any
// permanent geometry shift.)

// --- Layout computation ------------------------------------------------
//
// Every dimension here scales with the token's actual rendered size on
// the map. The reference is `Math.min(rendered_w, rendered_h) /
// sceneDpi` — a default 1-cell token has scale 1.0, a 0.5-cell
// familiar has scale 0.5, a 3-cell ogre has scale 3.0, etc. The
// user's per-client preference (LS_BUBBLES_SCALE, default 1) is
// multiplied on top so they can globally enlarge / shrink.
//
// Without this scaling, a 20-px-tall bar swamps a 30-px-wide
// familiar but is invisible on a giant. With it, the bar always
// occupies roughly the same fraction of the token's footprint.

interface BarLayout {
  /** sign of parent.scale.x at creation. NOT applied as child.scale
   *  any more — that was the buggy "compensation" that shifted the
   *  bar off to the side. Kept as a metric in case future code
   *  wants to react to flip-state changes (e.g., re-bake text-only
   *  items differently). For now, parent flip just mirrors text
   *  inside the bar; bar position stays centred. */
  flipX: number;
  flipY: number;
  /** anchor at the token's bottom-center in scene coords */
  origin: Vector2;
  /** bar's TOP-LEFT in scene coords (already RENDERED-scale-aware) */
  barOrigin: Vector2;
  /** bar width in scene units (RENDERED — already includes tokenScale) */
  barWidth: number;
  /** scaled bar height (RENDERED) */
  barHeight: number;
  /** scaled bar corner radius (= barHeight / 2 for the capsule shape) */
  barCornerRadius: number;
  /** scaled bar text font size */
  barFontSize: number;
  /** scaled HP-bar text vertical offset (the upstream's TEXT_VERTICAL_OFFSET) */
  barTextOffset: number;
  /** scaled stat-bubble diameter */
  diameter: number;
  /** scaled stat-bubble font size for ≤2 digits */
  bubbleFontSize: number;
  /** scaled stat-bubble font size for 3-digit values */
  bubbleFontSizeTight: number;
  /** scaled stat-bubble text vertical offset */
  bubbleTextOffset: number;
  /** AC stat bubble CENTER (Shape CIRCLE position semantics) — null if no AC */
  acCenter: Vector2 | null;
  /** Temp HP stat bubble CENTER — null if tempHp == 0 */
  tempCenter: Vector2 | null;
  /** parent token's image-scale-equivalent (= rendered_w / sceneDpi).
   *  Kept for diagnostic logging and the geometryKey hash. */
  tokenScale: number;
  /** 2026-05-13 — overhead mode active flag (头顶模式). When true:
   *  - barCornerRadius is 0 (sharp corners)
   *  - barStrokeOpacity / barStrokeWidth produce a visible border
   *  - acCenter / tempCenter sit INLINE on the bar's right end at the
   *    bar's center y, with diameter = barHeight
   *  - text width is `barTextBoxWidth` (excludes inline icons) instead
   *    of barWidth (the bar's own width is already shrunk to make
   *    room, but the text bbox uses barTextBoxWidth so it stays
   *    centered inside the BAR portion, not the bar+icons span).
   */
  overheadMode: boolean;
  /** bar bg's stroke width / opacity (0 in standard mode, > 0 in
   *  overhead mode so the rectangular bar has a visible border). */
  barStrokeWidth: number;
  barStrokeOpacity: number;
  /** Text bbox width — equal to `barWidth` in both modes; the bar's
   *  width is already shrunk in overhead mode to leave room for the
   *  inline icons, so the text centers correctly within the bar. */
  barTextBoxWidth: number;
}

// Layout computation — MIXED frames:
//
//   - `position` fields (origin, barOrigin, acCenter, tempCenter) are
//     in WORLD coords at the CURRENT parent.scale. OBR's `position`
//     is always interpreted as world; SCALE attachment-inheritance
//     responds to FUTURE scale changes by reapplying the recorded
//     local-relative offset times the new parent.scale.
//
//   - INTRINSIC dimensions (barWidth, barHeight, font sizes, diameter,
//     curve point arrays) are baked at NATIVE × userScale (no
//     parent.scale baked in). The renderer multiplies by parent.scale
//     at draw time, so visual size = native × userScale × parent.scale.
//
// Earlier draft ran the entire layout in pre-scale-local coords —
// that broke because OBR doesn't reinterpret `position` as local
// when SCALE inheritance is on; it just applies the parent's transform
// to whatever world value was recorded at creation. With local
// position values like (-73, 33) baked, the bar rendered near world
// origin instead of next to the token. This MIXED frame keeps the
// bar visually correct at any parent.scale + propagates live during
// scale drags via the renderer.
function computeLayoutFromMetrics(
  centerX: number,
  centerY: number,
  renderedWidth: number,
  renderedHeight: number,
  sceneDpi: number,
  data: BubbleData,
  userScale: number,
  verticalOffset: number,
  offsetByText: boolean,
  autoScaleText: boolean,
  flipX: number,
  flipY: number,
  overheadMode: boolean = false,
): BarLayout {
  // 2026-05-10 REVERT — see DISABLE_INHERIT comment. Every dimension
  // returned here is RENDERED (i.e. token's parent.scale magnitude
  // already baked in via `t = min(rW, rH) / dpi`), and every position
  // is a world coordinate produced from `getImageCenter` which is
  // already scale-aware. SCALE inheritance is OFF on the items, so
  // the renderer draws them at exactly these dimensions / positions
  // — no per-builder flipX/flipY hacks needed.
  const tokenScale = Math.max(0.05, Math.min(renderedWidth, renderedHeight) / sceneDpi);
  const t = tokenScale;
  const u = userScale;
  const s = t * u;

  // RENDERED dimensions. Every constant is multiplied through `s`
  // so the visual size matches the token's actual rendered footprint.
  const barHeight = BAR_HEIGHT * s;
  const barPadding = BAR_PADDING * s;
  // 2026-05-13 — overhead mode: sharp corners + visible border.
  // Standard mode keeps the capsule shape with no border.
  const barCornerRadius = overheadMode ? 0 : barHeight / 2;
  const barStrokeWidth = overheadMode ? Math.max(0.6, barHeight * 0.08) : 0;
  const barStrokeOpacity = overheadMode ? 0.7 : 0;
  const barFontSize = BAR_FONT_SIZE * s;
  const barTextOffset = TEXT_VERTICAL_OFFSET * s;
  // 2026-05-13b/c/d — overhead mode shield:
  //   • Now 21% larger than bar height (1.0.106 = 1.1×, 1.0.108 added
  //     another +10% → 1.1 × 1.1 = 1.21×). User wanted a chunkier
  //     shield that clearly reads as the AC indicator.
  //   • Centred AT the bar's right endpoint (was right-edge-flush).
  //     Shield's centre line sits on the bar's terminal x; the
  //     shield extends `diameter/2` to either side of that line,
  //     so half overlaps the bar and half sticks out to the right.
  const diameter = overheadMode ? barHeight * 1.21 : DIAMETER * s;
  const bubbleFontSize = overheadMode ? barFontSize : BUBBLE_FONT_SIZE * s;
  const bubbleFontSizeTight = overheadMode ? barFontSize * 0.7 : BUBBLE_FONT_SIZE_TIGHT * s;
  const bubbleTextOffset = TEXT_VERTICAL_OFFSET * s;
  const totalSpan = Math.max(barHeight, renderedWidth - barPadding * 2);

  // === Inline icon footprint ============================================
  // Standard mode: icons float above the bar in a separate row.
  // Overhead mode: per user spec (2026-05-13c) the BAR length matches
  // the prior 1.0.105 release — short enough that bar + icons fit
  // inside totalSpan even though the icons now OVERLAP the bar (rather
  // than being appended). Centring keeps the bar's geometric centre
  // on the token's centre. Text bbox = full bar width (also matching
  // 1.0.105 — user said "文字同样也是").
  const showHp = data.maxHp > 0;
  const inlineGap = 2 * s;
  const acSlotW = overheadMode && data.ac != null ? diameter : 0;
  const tempSlotW = overheadMode && data.tempHp > 0 && showHp ? diameter : 0;
  const inlineSlotsTotal = acSlotW + tempSlotW
    + (acSlotW > 0 && tempSlotW > 0 ? inlineGap : 0);
  // 1.0.105 used `inlineSlotsTotal + inlineGap` as the bar's shrinkage
  // (the +inlineGap was the gap between bar and the appended shield).
  // Keep the same number now so the bar's PROPORTIONAL length matches
  // 1.0.105.
  const barShrink = inlineSlotsTotal > 0 ? inlineSlotsTotal + inlineGap : 0;
  const barWidth = overheadMode
    ? Math.max(barHeight * 2, totalSpan - barShrink)
    : totalSpan;

  // === Vertical positioning ==========================================
  // Standard:  bar sits below the token (legacy layout).
  // Overhead:  bar sits a small gap above the token, with the user's
  //            verticalOffset still honored (negative pushes higher).
  //            offsetByText is force-disabled in overhead mode — the
  //            settings UI greys out the toggle to match.
  void autoScaleText;
  let origin: Vector2;
  let barOrigin: Vector2;
  if (overheadMode) {
    const overheadGap = 6 * s;
    // origin anchors at the bar's center (x) and top edge (y).
    const topOfToken = centerY - renderedHeight / 2;
    const barTopY = topOfToken - overheadGap - barHeight + verticalOffset;
    origin = { x: centerX, y: topOfToken };
    // 2026-05-13c — bar centred on TOKEN (not on totalSpan). barWidth
    // is the shrunken 1.0.105-proportion length so the icons can
    // overlap inside totalSpan without pushing the bar off-centre.
    barOrigin = { x: centerX - barWidth / 2, y: barTopY };
  } else {
    const effectiveVerticalOffset = offsetByText
      ? -TOKEN_TEXT_FONT_BASE * t
      : verticalOffset;
    origin = { x: centerX, y: centerY + renderedHeight / 2 + effectiveVerticalOffset };
    void flipX; void flipY;
    barOrigin = {
      x: origin.x - barWidth / 2,
      y: origin.y - barHeight - 2 * s,
    };
  }

  // === AC / Temp HP placement ========================================
  let acCenter: Vector2 | null = null;
  let tempCenter: Vector2 | null = null;
  if (overheadMode) {
    // 2026-05-13d — AC shield CENTRE sits ON the bar's terminal x
    // (was: right-edge-flush). Half of the shield overlaps the
    // bar's right end, the other half hangs off to the right of
    // the bar's endpoint. Temp HP (if any) sits a full diameter +
    // gap to the LEFT of AC, still vertically aligned with the
    // bar's centre line.
    const inlineY = barOrigin.y + barHeight / 2;
    const barRightX = barOrigin.x + barWidth;
    if (data.ac != null) {
      acCenter = { x: barRightX, y: inlineY };
    }
    if (data.tempHp > 0 && showHp) {
      const tempCenterX = data.ac != null
        ? barRightX - diameter - inlineGap
        : barRightX;
      tempCenter = { x: tempCenterX, y: inlineY };
    }
  } else {
    // Standard layout — float above the bar.
    const bubbleGap = 4 * s;
    const bubbleSpacing = 8 * s;
    const edgeInset = 2 * s;
    const bubbleBottomY = barOrigin.y - bubbleGap;
    const bubbleCenterY = bubbleBottomY - diameter / 2;
    let nextRightEdge = origin.x + renderedWidth / 2 - edgeInset;
    if (data.ac != null) {
      acCenter = { x: nextRightEdge - diameter / 2, y: bubbleCenterY };
      nextRightEdge -= diameter + bubbleSpacing;
    }
    if (data.tempHp > 0 && showHp) {
      tempCenter = { x: nextRightEdge - diameter / 2, y: bubbleCenterY };
    }
  }

  // 2026-05-13c — text bbox matches the BAR's width (was narrowed in
  // 1.0.106 to avoid the overlapping shield, but the user explicitly
  // wanted "文字同样也是 [上一个版本的长度比例]". HP text is on layer
  // TEXT at zIndex 30000, above the shield at 26000, so if the digits
  // do overflow into the shield area they draw on top — fine.
  const barTextBoxWidth = barWidth;

  return {
    flipX: 1, flipY: 1,
    origin, barOrigin, barWidth,
    barHeight, barCornerRadius, barFontSize, barTextOffset,
    diameter, bubbleFontSize, bubbleFontSizeTight, bubbleTextOffset,
    acCenter, tempCenter,
    tokenScale: t,
    overheadMode,
    barStrokeWidth, barStrokeOpacity,
    barTextBoxWidth,
  };
}

function computeLayout(
  image: Image,
  sceneDpi: number,
  data: BubbleData,
  userScale: number,
  verticalOffset: number,
  offsetByText: boolean,
  autoScaleText: boolean,
  overheadMode: boolean = false,
): BarLayout {
  // World centre + rendered size. Sign of parent.scale (signed,
  // not |scale|) feeds into every position-offset computation so
  // negative-scale tokens get their bar visually mirrored INTO place
  // rather than flying off to one side.
  const center = getImageCenter(image, sceneDpi);
  const size = getRenderedSize(image, sceneDpi);
  const flipX = (image.scale?.x ?? 1) < 0 ? -1 : 1;
  const flipY = (image.scale?.y ?? 1) < 0 ? -1 : 1;
  return computeLayoutFromMetrics(
    center.x, center.y, size.width, size.height,
    sceneDpi, data, userScale, verticalOffset, offsetByText, autoScaleText,
    flipX, flipY, overheadMode,
  );
}

function geometryKey(L: BarLayout, has: { hp: boolean; ac: boolean; temp: boolean }): string {
  // Includes the scaled dimensions so a token-scale change
  // triggers a full rebuild — Curve polygon points are baked in at
  // create time, so width / height changes can't be patched
  // position-only.
  const parts = [
    `hp:${has.hp ? `${L.barOrigin.x.toFixed(2)},${L.barOrigin.y.toFixed(2)},${L.barWidth.toFixed(2)},${L.barHeight.toFixed(2)}` : "_"}`,
    `ac:${has.ac && L.acCenter ? `${L.acCenter.x.toFixed(2)},${L.acCenter.y.toFixed(2)},${L.diameter.toFixed(2)}` : "_"}`,
    `tp:${has.temp && L.tempCenter ? `${L.tempCenter.x.toFixed(2)},${L.tempCenter.y.toFixed(2)},${L.diameter.toFixed(2)}` : "_"}`,
  ];
  return parts.join("|");
}

// --- Item builders -----------------------------------------------------

interface BuildContext {
  token: Item;
  visible: boolean;
}

function buildBarBg(ctx: BuildContext, L: BarLayout, statsVisible: boolean): any {
  const color = statsVisible ? HP_BG : HP_BG_HIDDEN;
  return buildCurve()
    .fillColor(color)
    .fillOpacity(BG_OPACITY)
    // 2026-05-13 — overhead mode draws a visible border (standard mode
    // keeps strokeOpacity 0). Stroke colour matches the dark
    // hp-bg-hidden palette so it reads as a frame regardless of fill.
    .strokeColor("#000000")
    .strokeOpacity(L.barStrokeOpacity)
    .strokeWidth(L.barStrokeWidth)
    .tension(0)
    .closed(true)
    .points(roundedRectanglePoints(L.barWidth, L.barHeight, L.barCornerRadius))
    .position(L.barOrigin)
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(10000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata(bubbleMeta(ctx.token.id, "hp-bg"))
    .build();
}

function buildBarFill(ctx: BuildContext, L: BarLayout, ratio: number): any {
  return buildCurve()
    .fillColor(HP_FILL)
    .fillOpacity(FILL_OPACITY)
    .strokeOpacity(0)
    .strokeWidth(0)
    .tension(0)
    .closed(true)
    .points(roundedRectanglePoints(L.barWidth, L.barHeight, L.barCornerRadius, ratio))
    .position(L.barOrigin)
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(20000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata(bubbleMeta(ctx.token.id, "hp-fill"))
    .build();
}

// Shimmer overlay — Effect rendered on top of the static fill curve.
// Earlier rounds used effectType ATTACHMENT + blendMode PLUS, but
// neither was reliably visible. STANDALONE + SRC_OVER is the same
// pattern OBR's lighting uses and renders the shader as a normal
// alpha-blended overlay. The shader (HP_SHIMMER_SKSL) outputs
// half4(rgb, alpha) so SRC_OVER picks up its colors directly.
function buildHpShimmer(ctx: BuildContext, L: BarLayout, ratio: number): any {
  // RENDERED dimensions + SCALE inheritance disabled. Geometry IS
  // the visual. Resize commits go through the `shimmerRebuild` path
  // in syncBubbles (delete + re-add) since OBR's renderer doesn't
  // propagate width/height field updates for Effects through the
  // partial-update path.
  return buildEffect()
    .effectType("STANDALONE")
    .blendMode("SRC_OVER")
    .width(L.barWidth)
    .height(L.barHeight)
    .sksl(HP_SHIMMER_SKSL)
    .uniforms([
      { name: "iTime", value: 0 },
      { name: "iSize", value: { x: L.barWidth, y: L.barHeight } },
      { name: "ratio", value: ratio },
    ])
    .position(L.barOrigin)
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(25000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata(bubbleMeta(ctx.token.id, "hp-shimmer"))
    .build();
}


function buildBarText(ctx: BuildContext, L: BarLayout, data: BubbleData): any {
  const text = `${data.hp}/${data.maxHp}${data.tempHp > 0 ? ` +${data.tempHp}` : ""}`;
  // Stroke width tracks bar height too so the text outline doesn't
  // dominate the glyphs on a tiny familiar (was a fixed 1.5 px →
  // looked like a black blob at small scale).
  const strokeWidth = Math.max(0.4, L.barHeight * 0.075);
  // 2026-05-13b — text bbox uses barTextBoxWidth (= barWidth in
  // standard mode, = barWidth - inlineFootprint in overhead mode).
  // In overhead the inline icons overlap the right end of the bar;
  // narrowing the text bbox keeps HP digits clear of the shield.
  return buildText()
    .plainText(text)
    .textType("PLAIN")
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fontFamily(FONT_FAMILY)
    .fontSize(L.barFontSize)
    .fontWeight(700)
    .fillColor("#ffffff")
    .fillOpacity(1)
    .strokeColor("#000000")
    .strokeOpacity(0.7)
    .strokeWidth(strokeWidth)
    .lineHeight(0.95)
    .width(L.barTextBoxWidth)
    .height(L.barHeight)
    .position({ x: L.barOrigin.x, y: L.barOrigin.y + L.barTextOffset })
    .layer("TEXT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(30000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata(bubbleMeta(ctx.token.id, "hp-text"))
    .build();
}

function buildStatBubbleBg(ctx: BuildContext, L: BarLayout, center: Vector2, color: string): any {
  // 2026-05-13 — overhead mode overlaps the bar so this needs to sit
  // ABOVE hp-fill (zIndex 20000) and hp-shimmer (25000). Standard
  // mode the icons are physically separate from the bar so any
  // zIndex works; using 26000 unconditionally keeps the math simple.
  // Shape CIRCLE position is the bubble's CENTER (verified empirically
  // against the upstream's positioning math).
  // 2026-05-13b — overhead mode renders fully opaque ("护盾不再半透
  // 明"); standard mode keeps the original BG_OPACITY (0.6).
  return buildShape()
    .shapeType("CIRCLE")
    .width(L.diameter)
    .height(L.diameter)
    .fillColor(color)
    .fillOpacity(L.overheadMode ? 1.0 : BG_OPACITY)
    .strokeColor(color)
    .strokeOpacity(0)
    .strokeWidth(0)
    .position(center)
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(L.overheadMode ? 26000 : 15000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata(bubbleMeta(ctx.token.id, "temp-bg"))
    .build();
}

// AC shield — replaces the CIRCLE Shape with a Curve outlined as a
// heraldic heater shield. Same diameter footprint as the circle so
// the layout math doesn't shift; the shape inside the bbox is just
// the shield outline. A thin white stroke gives the rim a touch of
// shine.
function buildAcShield(ctx: BuildContext, L: BarLayout, center: Vector2, color: string): any {
  // L.diameter is INTRINSIC (native × userScale); the renderer
  // multiplies it by parent.scale at draw time. For centring math
  // (top-left of bbox = visual_centre − visual_half), multiply by
  // tokenScale × sign(parent.scale). When parent.scale is negative,
  // the curve points render in the opposite direction, so the bbox's
  // top-left in NORMAL frame is the bbox's "top-right" — which after
  // the renderer mirrors maps back to the visual top-left.
  // 2026-05-10 REVERT: L.diameter is RENDERED; SCALE inheritance off
  // so canonical top-left = center − diameter/2.
  const W = L.diameter;
  const H = L.diameter;
  // 2026-05-13b — overhead mode renders fully opaque per user spec
  // ("护盾不再半透明"); standard mode keeps the translucent 0.6.
  return buildCurve()
    .fillColor(color)
    .fillOpacity(L.overheadMode ? 1.0 : BG_OPACITY)
    .strokeColor("#ffffff")
    .strokeOpacity(0.45)
    .strokeWidth(Math.max(0.6, L.diameter * 0.04))
    .tension(0)
    .closed(true)
    .points(shieldPoints(W, H))
    .position({
      x: center.x - W / 2,
      y: center.y - H / 2,
    })
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    // 2026-05-13 — overhead mode overlaps the bar; see buildStatBubbleBg.
    .zIndex(L.overheadMode ? 26000 : 15000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata(bubbleMeta(ctx.token.id, "ac-shield"))
    .build();
}

// Stat-bubble text overlay — used for both AC and Temp HP.
// `role` distinguishes the two so patchGeometry can dispatch them
// differently (AC text gets an upward Y nudge to compensate for
// the shield outline's visual centroid being above the geometric
// center of the bbox; Temp HP sits in a centered circle and
// doesn't need that nudge). Stroke is dropped on very small icons
// where a 0.4-px outline reads as a black blob.
function buildStatBubbleText(ctx: BuildContext, L: BarLayout, center: Vector2, value: number, role: "ac-text" | "temp-text"): any {
  const text = value.toString();
  const fontSize = text.length >= 3 ? L.bubbleFontSizeTight : L.bubbleFontSize;
  const strokeWidth = L.diameter < 20 ? 0 : Math.max(0.4, L.diameter * 0.05);
  // Shield's visual centroid sits above its geometric center
  // (because the bottom point is thin); nudge AC text by 8% of
  // the bbox in the "visual up" direction.
  // 2026-05-10 REVERT: L.diameter is RENDERED; SCALE inheritance off
  // so canonical top-left = center − diameter/2 (no flipX/flipY).
  const yShift = role === "ac-text" ? -L.diameter * 0.08 : 0;
  return buildText()
    .plainText(text.length > 3 ? "…" : text)
    .textType("PLAIN")
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fontFamily(FONT_FAMILY)
    .fontSize(fontSize)
    .fontWeight(700)
    .fillColor("#ffffff")
    .fillOpacity(1)
    .strokeColor("#000000")
    .strokeOpacity(0.7)
    .strokeWidth(strokeWidth)
    .lineHeight(0.95)
    .width(L.diameter)
    .height(L.diameter)
    .position({
      x: center.x - L.diameter / 2,
      y: center.y - L.diameter / 2 + L.bubbleTextOffset + yShift,
    })
    .layer("TEXT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(25000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata(bubbleMeta(ctx.token.id, role))
    .build();
}

// --- Sync --------------------------------------------------------------

interface Wanted {
  tok: Image;
  data: BubbleData;
  viewMode: ViewMode;
  layout: BarLayout;
  rebuildHash: string;
  statsVisible: boolean;
}

// Geometry-only in-place update — used when the token's data
// (HP / AC / hide / temp HP) is unchanged but its position or
// scale shifted. Avoids the delete + re-add cycle that made
// resize feel "release-only" before: the user grabs the corner
// handle, OBR fires items.onChange repeatedly during the drag,
// and we patch each shimmer / shield / text item's position +
// dimensions + font size in a single batched updateItems call.
// `iTime` for shimmers is left alone — the animation timer
// keeps ticking it independently.
//
// Dispatches by the `BUBBLE_ROLE_KEY` metadata each builder
// stamps onto its item — that role tells us which fields to
// update for that item type.
async function patchGeometry(patches: Array<{ entry: BubbleEntry; w: Wanted }>): Promise<void> {
  if (patches.length === 0) return;

  const wantedByItemId = new Map<string, Wanted>();
  const allIds: string[] = [];
  for (const { entry, w } of patches) {
    for (const id of entry.ids) {
      wantedByItemId.set(id, w);
      allIds.push(id);
    }
  }
  if (allIds.length === 0) return;

  await OBR.scene.local.updateItems(allIds, (drafts) => {
    for (const d of drafts) {
      const w = wantedByItemId.get(d.id);
      if (!w) continue;
      const role = (d.metadata as any)?.[BUBBLE_ROLE_KEY] as BubbleRole | undefined;
      if (!role) continue;
      const L = w.layout;
      const D = L.diameter;
      const da = d as any;
      switch (role) {
        case "hp-bg": {
          da.position = L.barOrigin;
          da.points = roundedRectanglePoints(L.barWidth, L.barHeight, L.barCornerRadius);
          break;
        }
        case "hp-fill": {
          const ratio = Math.max(0, Math.min(1, w.data.hp / Math.max(1, w.data.maxHp)));
          da.position = L.barOrigin;
          da.points = roundedRectanglePoints(L.barWidth, L.barHeight, L.barCornerRadius, ratio);
          break;
        }
        case "hp-shimmer": {
          // Effect uses RENDERED dimensions + SCALE inheritance off.
          // Position and uniforms get partial-update propagation OK;
          // only width/height field changes are silently dropped by
          // OBR's renderer — those are handled separately via the
          // `shimmerRebuild` path in syncBubbles.
          const ratio = Math.max(0, Math.min(1, w.data.hp / Math.max(1, w.data.maxHp)));
          da.position = L.barOrigin;
          da.width = L.barWidth;
          da.height = L.barHeight;
          if (Array.isArray(da.uniforms)) {
            for (const u of da.uniforms) {
              if (u.name === "iSize") u.value = { x: L.barWidth, y: L.barHeight };
              else if (u.name === "ratio") u.value = ratio;
            }
          }
          break;
        }
        case "hp-text": {
          da.position = { x: L.barOrigin.x, y: L.barOrigin.y + L.barTextOffset };
          if (da.text) {
            // Replace the entire `text` object rather than mutating
            // its fields. OBR's renderer drops field-level mutations
            // (`da.text.plainText = "..."`) silently when the new
            // value happens to match a previously-built value — so
            // `66 → 20 → 66` would update the curve but leave the
            // text stuck at "20/66". Reassigning the whole object
            // forces the partial-update path to ship the change.
            const newText = `${w.data.hp}/${w.data.maxHp}${w.data.tempHp > 0 ? ` +${w.data.tempHp}` : ""}`;
            // 2026-05-13b — text width = barTextBoxWidth so overhead-
            // mode patches keep HP digits clear of the overlapping
            // shield. Standard mode is unchanged (barTextBoxWidth ==
            // barWidth there).
            da.text = {
              ...da.text,
              width: L.barTextBoxWidth,
              height: L.barHeight,
              plainText: newText,
              style: {
                ...(da.text.style ?? {}),
                fontSize: L.barFontSize,
                strokeWidth: Math.max(0.4, L.barHeight * 0.075),
              },
            };
          }
          break;
        }
        case "ac-shield": {
          if (L.acCenter) {
            // 2026-05-10 REVERT: D is RENDERED, SCALE inheritance off,
            // canonical top-left = center − D/2.
            da.position = {
              x: L.acCenter.x - D / 2,
              y: L.acCenter.y - D / 2,
            };
            da.points = shieldPoints(D, D);
            da.style = { ...(da.style ?? {}), strokeWidth: Math.max(0.6, D * 0.04) };
          }
          break;
        }
        case "ac-text": {
          if (L.acCenter) {
            const newText = w.data.ac != null ? String(w.data.ac) : "";
            const fs = newText.length >= 3 ? L.bubbleFontSizeTight : L.bubbleFontSize;
            const yShift = -D * 0.08;
            da.position = {
              x: L.acCenter.x - D / 2,
              y: L.acCenter.y - D / 2 + L.bubbleTextOffset + yShift,
            };
            if (da.text) {
              // Same reason as hp-text above: replace the whole text
              // object to bypass OBR's silent-drop-on-stale-mutation.
              da.text = {
                ...da.text,
                plainText: newText,
                width: D,
                height: D,
                style: {
                  ...(da.text.style ?? {}),
                  fontSize: fs,
                  strokeWidth: D < 20 ? 0 : Math.max(0.4, D * 0.05),
                },
              };
            }
          }
          break;
        }
        case "temp-bg": {
          if (L.tempCenter) {
            da.position = L.tempCenter;
            da.width = D;
            da.height = D;
          }
          break;
        }
        case "temp-text": {
          if (L.tempCenter) {
            const txt: string = da.text?.plainText ?? "";
            const fs = txt.length >= 3 ? L.bubbleFontSizeTight : L.bubbleFontSize;
            da.position = {
              x: L.tempCenter.x - D / 2,
              y: L.tempCenter.y - D / 2 + L.bubbleTextOffset,
            };
            if (da.text) {
              da.text.width = D;
              da.text.height = D;
              if (da.text.style) {
                da.text.style.fontSize = fs;
                da.text.style.strokeWidth = D < 20 ? 0 : Math.max(0.4, D * 0.05);
              }
            }
          }
          break;
        }
      }
    }
  }, true).catch((e) => console.warn("[obr-suite/bubbles] patchGeometry failed", e));
}

async function syncBubbles(): Promise<void> {
  if (inSync) {
    queuedSync = true;
    return;
  }
  inSync = true;
  try {
    if (!readEnabled()) {
      await clearAll();
      return;
    }

    let allItems: Item[];
    try { allItems = await OBR.scene.items.getItems(); }
    catch { return; }

    // Refresh cachedSceneDpi opportunistically every sync — most of the
    // time the value is stable, but a scene with a non-default grid
    // can change it. The bounds-poll reads from `cachedSceneDpi`
    // without awaiting, so this keeps it warm.
    try { cachedSceneDpi = await OBR.scene.grid.getDpi(); } catch {}
    const sceneDpi = cachedSceneDpi;

    const userScale = readUserScale();
    const verticalOffset = readVerticalOffset();
    // 2026-05-13 — overhead mode forces offsetByText OFF (UI greys
    // the toggle to match). Computing it once here so the rest of
    // the sync loop sees the canonical resolved value.
    const overheadModeFlag = readOverheadMode();
    const offsetByTextFlag = overheadModeFlag ? false : readOffsetByText();
    const playerThreshold = readPlayerThreshold();
    const autoScaleText = cachedAutoScaleText;
    // Refresh the cached combat-active flag at sync time so a player
    // who joins during combat picks up the right view mode without
    // waiting for the next metadata-change event.
    try {
      const meta = await OBR.scene.getMetadata();
      cachedCombatActive = readCombatActive(meta);
    } catch {}
    const isGM = role === "GM";

    // Sync OBR-native plainText font size on every character/mount
    // BEFORE we walk items for bubble layout — keeping the sync
    // inline with the rest of the sync loop is cheaper than a
    // separate pass + has dedupe baked in (we only `updateItems`
    // tokens whose fontSize is currently wrong).
    if (isGM) {
      void syncTokenTextFontSize(allItems, sceneDpi, autoScaleText);
    }

    const wanted = new Map<string, Wanted>();
    for (const it of allItems) {
      // Match upstream — Character / Mount / Prop layers all show bubbles.
      if (it.layer !== "CHARACTER" && it.layer !== "MOUNT" && it.layer !== "PROP") continue;
      if (!isImage(it)) continue;
      // Per-suite gating: only render bubbles for tokens explicitly
      // bound to a character card or a bestiary monster. Avoids
      // accidentally bubble-ifying random NPC art or terrain props
      // that happen to carry leftover bubbles metadata from a
      // previous bind.
      const meta = (it.metadata as any) || {};
      const hasCc = typeof meta[CC_BIND_KEY] === "string" && meta[CC_BIND_KEY];
      const hasBestiary = typeof meta[BESTIARY_SLUG_KEY] === "string" && meta[BESTIARY_SLUG_KEY];
      // 2026-05-04: tokens with the HP bar component flag also
      // render bubbles. The flag is set by modules/hpBar (right-
      // click menu OR auto-add on token selection). Removing the
      // flag (right-click "remove HP bar") makes bubbles disappear
      // again — matching the user's symmetric expectation.
      const hasHpBarComponent = !!meta[HP_BAR_FLAG_KEY];
      if (!hasCc && !hasBestiary && !hasHpBarComponent) continue;
      const d = readBubbleData(it);
      if (!d) continue;
      // OBR's "Give Owner" sets `createdUserId` on the item to the
      // chosen player. Owner gets the same full bar a DM sees.
      const ownsItem = !!myPlayerId && (it as any).createdUserId === myPlayerId;
      const viewMode = computeViewMode(d, isGM, cachedCombatActive, ownsItem, !!hasBestiary);
      if (viewMode === "hidden") continue;

      // Silhouette mode quantises the displayed HP ratio for players
      // (default step = 25%). We mutate `effectiveData.hp` so every
      // downstream build/patch path sees the quantised ratio without
      // having to know about the threshold logic.
      let effectiveData = d;
      if (viewMode === "silhouette" && !d.hide && d.maxHp > 0) {
        const q = quantiseRatio(d.hp / d.maxHp, playerThreshold);
        effectiveData = { ...d, hp: Math.round(q * d.maxHp), tempHp: 0 };
      }

      const statsVisible = !d.hide;
      const layout = computeLayout(it, sceneDpi, effectiveData, userScale, verticalOffset, offsetByTextFlag, autoScaleText, overheadModeFlag);
      // Silhouette suppresses AC and the temp bubble entry. The
      // geometryKey reflects what items will exist so a viewMode
      // flip drives a structure-rebuild instead of slipping
      // through patchGeometry.
      const has = {
        hp: effectiveData.maxHp > 0,
        ac: viewMode === "silhouette" ? false : (d.ac != null),
        temp: effectiveData.tempHp > 0 && effectiveData.maxHp > 0,
      };
      // rebuildHash combines every variable that requires items to
      // be torn down + rebuilt: structure (which items exist),
      // values (HP / AC / temp numbers), flip signs (negative scale
      // compensation), and intrinsic dimensions (native bar width
      // depends on token native size + userScale, can change if
      // image swaps). Variables NOT in this hash — parent.position,
      // parent.scale magnitude, parent.rotation — are handled by
      // OBR's attachment inheritance at draw time, so a sync that
      // sees an unchanged rebuildHash can do absolutely nothing.
      const rebuildHash = [
        structureHash(effectiveData),
        viewMode,
        valueHash(effectiveData),
        layout.barWidth.toFixed(2),
        layout.barHeight.toFixed(2),
        layout.diameter.toFixed(2),
        has.hp, has.ac, has.temp,
        // Toggling these changes the bake position; without them in
        // the hash, the user wouldn't see the toggle take effect
        // until a separate data edit triggers the rebuild.
        offsetByTextFlag ? "T" : "F",
        verticalOffset.toFixed(2),
        // 2026-05-13 — overhead mode flips the whole layout (above/below,
        // corner radius, border, inline-vs-stacked icons); must invalidate
        // the cache when toggled.
        overheadModeFlag ? "O" : "S",
        // parent.scale sign — flips position-offset signs in builders.
        // Need a rebuild on flip so the new bake takes effect.
        layout.flipX, layout.flipY,
      ].join("|");
      wanted.set(it.id, {
        tok: it,
        data: effectiveData,
        viewMode,
        layout,
        rebuildHash,
        statsVisible,
      });
    }

    // Drop bubbles for tokens that lost data or were removed.
    const orphans: string[] = [];
    for (const [tokId, e] of entries) {
      if (!wanted.has(tokId)) {
        orphans.push(...e.ids);
        entries.delete(tokId);
      }
    }
    if (orphans.length) {
      await OBR.scene.local.deleteItems(orphans).catch((err) =>
        console.warn("[obr-suite/bubbles] delete orphans failed", err),
      );
    }

    // 2026-05-09 rewrite: full rebuild whenever rebuildHash changes;
    // otherwise nothing — OBR's attachment inheritance handles every
    // visible difference (move / scale / rotation drag) at draw time
    // without us touching the items. Position changes never enter
    // rebuildHash, so a token drag commits flow through here as
    // total no-ops. Earlier patchGeometry path raced OBR's drag-time
    // snapshot, causing bubbles to flash their CREATION value during
    // scale gestures — the snapshot was taken at drag start and our
    // partial-update text changes never made it in.
    const toAdd: any[] = [];
    const toDelete: string[] = [];

    for (const [tokId, w] of wanted) {
      const existing = entries.get(tokId);
      if (existing && existing.rebuildHash === w.rebuildHash) continue;
      if (existing) toDelete.push(...existing.ids);

      const ctx: BuildContext = { token: w.tok, visible: w.tok.visible };
      const newIds: string[] = [];
      const shimmerIds: string[] = [];
      const isSilhouette = w.viewMode === "silhouette";

      if (w.data.maxHp > 0) {
        const ratio = Math.max(0, Math.min(1, w.data.hp / w.data.maxHp));
        const bg = buildBarBg(ctx, w.layout, w.statsVisible);
        const fill = buildBarFill(ctx, w.layout, ratio);
        toAdd.push(bg, fill);
        newIds.push(bg.id, fill.id);
        if (!isSilhouette) {
          const text = buildBarText(ctx, w.layout, w.data);
          toAdd.push(text);
          newIds.push(text.id);
        }
      }
      if (!isSilhouette && w.layout.acCenter && w.data.ac != null) {
        const acShield = buildAcShield(ctx, w.layout, w.layout.acCenter, AC_COLOR);
        const acText = buildStatBubbleText(ctx, w.layout, w.layout.acCenter, w.data.ac, "ac-text");
        toAdd.push(acShield, acText);
        newIds.push(acShield.id, acText.id);
      }

      entries.set(tokId, {
        ids: newIds,
        shimmerIds,
        rebuildHash: w.rebuildHash,
        data: w.data,
        statsVisible: w.statsVisible,
      });
    }

    // ADD-THEN-DELETE order: new items appear on screen BEFORE the
    // old ones are removed, so the user never sees a missing-bubble
    // frame. Both sets briefly overlap; OBR draws same-zIndex items
    // in insertion order so the new ones sit on top, hiding the
    // about-to-be-deleted old ones.
    if (toAdd.length) {
      await OBR.scene.local.addItems(toAdd).catch((err) =>
        console.warn("[obr-suite/bubbles] addItems failed", err),
      );
    }
    if (toDelete.length) {
      await OBR.scene.local.deleteItems(toDelete).catch((err) =>
        console.warn("[obr-suite/bubbles] delete-for-rebuild failed", err),
      );
    }
    // Shimmer animation timer — currently the shimmer Effect builder
    // is commented out, so this is a no-op. Kept so flipping the
    // shimmer back on doesn't require re-wiring the timer plumbing.
    let anyShimmer = false;
    for (const e of entries.values()) if (e.shimmerIds.length) { anyShimmer = true; break; }
    if (anyShimmer) ensureAnimationTimer();
    else stopAnimationTimer();
  } finally {
    inSync = false;
    if (queuedSync) {
      queuedSync = false;
      scheduleSync();
    }
  }
}

async function clearAll(): Promise<void> {
  const ids: string[] = [];
  for (const e of entries.values()) ids.push(...e.ids);
  entries.clear();
  stopAnimationTimer();
  if (ids.length) {
    await OBR.scene.local.deleteItems(ids).catch(() => {});
  }
}

/** Per-token reset — wipes the cache + every local item we own for
 *  ONE token, then schedules a fresh sync so the bubbles rebuild
 *  from scratch. Used by the hp-bar popover's reset button when a
 *  token's bar drifts out of position (typically caused by an
 *  intermediate parent transform we missed). 2026-05-11. */
async function resetTokenBubble(tokenId: string): Promise<void> {
  if (!tokenId) return;
  // 1. Drop the in-memory entry so the next sync treats this token
  //    as never-rendered (full create path) instead of patching.
  const e = entries.get(tokenId);
  if (e) entries.delete(tokenId);
  // 2. Sweep ALL items metadata-tagged for this token, including any
  //    orphans not in `entries` (e.g. from a previous session whose
  //    rebuildHash diverged before we wrote back). Match by
  //    BUBBLE_OWNER_KEY so we don't miss anything.
  try {
    const owned = await OBR.scene.local.getItems((it) => {
      const meta = (it.metadata as any) ?? {};
      return meta[BUBBLE_OWNER_KEY] === tokenId;
    });
    if (owned.length > 0) {
      await OBR.scene.local.deleteItems(owned.map((i) => i.id));
    }
  } catch (err) {
    console.warn("[obr-suite/bubbles] resetTokenBubble sweep failed", err);
  }
  // 3. Trigger a fresh sync. scheduleSync coalesces nearby calls so
  //    rapid resets don't queue redundant work.
  scheduleSync();
}


/** Scan scene.local for ANY item carrying our `BUBBLE_OWNER_KEY` and
 *  delete it. Called once at setup so stale items from a previous
 *  session (potentially built with an older layout convention — e.g.
 *  the pre-2026-05-09 absolute-world-coord scheme) get wiped before
 *  we rebuild fresh under the current scheme.
 *
 *  Safe to call any time; matches by metadata key, not ID, so it
 *  catches items the in-memory `entries` map doesn't know about. */
async function sweepStaleBubbleItems(): Promise<void> {
  try {
    const all = await OBR.scene.local.getItems((it) => {
      const meta = (it.metadata as any) ?? {};
      return !!meta[BUBBLE_OWNER_KEY];
    });
    if (all.length > 0) {
      await OBR.scene.local.deleteItems(all.map((i) => i.id));
    }
  } catch {}
}

// --- Module lifecycle --------------------------------------------------

export async function setupBubbles(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  try { myPlayerId = await OBR.player.getId(); } catch {}
  try { cachedSceneDpi = await OBR.scene.grid.getDpi(); } catch {}
  // Watch role + id changes so they take effect mid-session.
  unsubs.push(
    OBR.player.onChange((p) => {
      let changed = false;
      const nextRole = (p.role as "GM" | "PLAYER") || role;
      if (nextRole !== role) { role = nextRole; changed = true; }
      if (p.id && p.id !== myPlayerId) { myPlayerId = p.id; changed = true; }
      if (changed) scheduleSync();
    }),
  );

  // Refresh DPI cache when the grid changes so the bounds-poll's
  // synchronous read is never stale.
  try {
    unsubs.push(OBR.scene.grid.onChange((g) => {
      cachedSceneDpi = g.dpi;
      scheduleSync();
    }));
  } catch {}

  unsubs.push(OBR.scene.items.onChange(() => {
    scheduleSync();
  }));

  const onStorage = (e: StorageEvent) => {
    if (
      e.key === LS_BUBBLES_ENABLED ||
      e.key === LS_BUBBLES_SCALE ||
      e.key === LS_BUBBLES_VERTICAL_OFFSET ||
      e.key === LS_BUBBLES_OFFSET_BY_TEXT ||
      e.key === LS_BUBBLES_OVERHEAD_MODE
    ) {
      void clearAll().then(() => syncBubbles().catch(() => {}));
    }
  };
  window.addEventListener("storage", onStorage);
  unsubs.push(() => window.removeEventListener("storage", onStorage));

  try {
    const meta = await OBR.scene.getMetadata();
    cachedPlayerThreshold = readScenePlayerThreshold(meta as Record<string, unknown>);
    cachedAutoScaleText = readSceneAutoScaleText(meta as Record<string, unknown>);
  } catch {}

  // Combat state and synced bubble settings changes.
  unsubs.push(
    OBR.scene.onMetadataChange((meta) => {
      const next = readCombatActive(meta);
      const nextThreshold = readScenePlayerThreshold(meta as Record<string, unknown>);
      const nextAutoScale = readSceneAutoScaleText(meta as Record<string, unknown>);
      if (
        next !== cachedCombatActive ||
        nextThreshold !== cachedPlayerThreshold ||
        nextAutoScale !== cachedAutoScaleText
      ) {
        const autoScaleChanged = nextAutoScale !== cachedAutoScaleText;
        cachedCombatActive = next;
        cachedPlayerThreshold = nextThreshold;
        cachedAutoScaleText = nextAutoScale;
        // Auto-scale toggling changes both font sizes AND the
        // verticalOffset rule — tokens need a full layout rebuild,
        // not just patchGeometry. clearAll forces re-add on the
        // next sync.
        if (autoScaleChanged) {
          void clearAll();
        }
        scheduleSync();
      }
    }),
  );

  // Scene-ready re-sync. Catches the "initial load race" where a
  // scene's items arrive in `items.onChange` BEFORE their
  // `image.scale` has finished propagating (default 1.0 at first emit).
  // Under the new local-frame layout, scale doesn't affect the baked
  // geometry — the renderer adds it at draw time — so this race is
  // mostly cosmetic now. We still force a fresh sync so a scene swap
  // gets a clean slate.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (!ready) return;
      setTimeout(() => {
        void sweepStaleBubbleItems().then(() => {
          void clearAll().then(() => { void syncBubbles(); });
        });
      }, 250);
    }),
  );

  // 2026-05-10: bubble-guard select-tool mode removed. The custom
  // canvasDragMode under Select fundamentally can't beat OBR's native
  // drag latency (the bus round-trip stacks up), so users were
  // stuttering rather than getting smoother HP-bar gestures. The
  // bestiary tool keeps the same util because the bestiary tool
  // would otherwise have NO drag at all (OBR doesn't fall back to a
  // canvas handler for plugin-owned tools). Native Select interaction
  // is good enough for everyone outside the bestiary panel.
  //
  // Sweep any legacy guard mode left over from a previous install so
  // its pointerdown handler doesn't keep half-intercepting Select.
  try { await OBR.tool.removeMode(LEGACY_GUARD_MODE_ID); } catch {}

  // 2026-05-11 — listen for "reset this token's bubble" broadcasts
  // from the hp-bar popover's reset button. Wipes the cached entry +
  // every local item tagged with this tokenId so the next sync
  // rebuilds from scratch. Useful when the on-canvas bar drifts off
  // its anchor (typically because we mis-patched a transform).
  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/bubbles-reset-token", async (event) => {
      const data = event.data as { tokenId?: string } | undefined;
      const id = data?.tokenId;
      if (typeof id === "string" && id) {
        await resetTokenBubble(id);
      }
    }),
  );

  // First-run sweep: any local items left over from a previous session
  // (different scheme, different layout) get wiped before we build
  // fresh. The wipe is keyed off `BUBBLE_OWNER_KEY` metadata, not the
  // in-memory `entries` map, so it catches orphans we never tracked.
  await sweepStaleBubbleItems();
  void syncBubbles();
}

// 2026-05-10: removed `setupBubbleGuardMode` + the SELECT-tool
// canvasDragMode wiring. Native Select drag is more responsive than
// our reimplementation and the dev-build 2026-05-09 attempt was
// stuttery. The bestiary tool keeps using canvasDragMode (see
// modules/bestiary/index.ts) — that's a separate decision because
// bestiary's own tool has no fallback drag path and "stuttery drag
// > no drag" only there.

// Try to remove any legacy guard mode left over from a previous
// install — pointer-events otherwise stay weakly intercepted under
// Select's mode-row even after the user upgrades. Best-effort, no
// failure noise if it wasn't installed.
const LEGACY_GUARD_MODE_ID = "com.obr-suite/bubbles/guard-mode";

export async function teardownBubbles(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  try { await OBR.tool.removeMode(LEGACY_GUARD_MODE_ID); } catch {}
  await clearAll();
}

// --- Public helper for other modules to write bubble data --------------
export async function writeBubbleStats(
  tokenId: string,
  patch: { hp?: number; maxHp?: number; tempHp?: number; ac?: number | null; hide?: boolean; name?: string },
): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        // 2026-05-10: read each namespace independently so the upstream
        // extension's extra fields (e.g. `dm only`, `name plate`) survive
        // a round-trip when we patch HP / AC. Mirrors the fix in
        // utils/statEdit.ts patchBubbles.
        const ownPrev = ((d.metadata as any)[BUBBLES_META] as Record<string, unknown> | undefined) ?? null;
        const extPrev = ((d.metadata as any)[EXTERNAL_BUBBLES_META] as Record<string, unknown> | undefined) ?? null;
        const baseForClamp: Record<string, unknown> = ownPrev != null
          ? { ...ownPrev }
          : extPrev != null ? { ...extPrev } : {};
        const next: Record<string, unknown> = { ...baseForClamp };
        const writtenKeys = new Set<string>();
        if (patch.hp != null) {
          next["health"] = Math.max(0, Math.floor(patch.hp));
          writtenKeys.add("health");
        }
        if (patch.maxHp != null) {
          next["max health"] = Math.max(0, Math.floor(patch.maxHp));
          writtenKeys.add("max health");
        }
        if (patch.tempHp != null) {
          next["temporary health"] = Math.max(0, Math.floor(patch.tempHp));
          writtenKeys.add("temporary health");
        }
        if (patch.ac !== undefined) {
          if (patch.ac == null) {
            delete next["armor class"];
            writtenKeys.add("armor class");
          } else {
            next["armor class"] = Math.floor(patch.ac);
            writtenKeys.add("armor class");
          }
        }
        if (patch.hide != null) {
          next["hide"] = !!patch.hide;
          writtenKeys.add("hide");
        }
        const mx = Number(next["max health"]);
        const cur2 = Number(next["health"]);
        if (Number.isFinite(mx) && mx > 0 && Number.isFinite(cur2)) {
          next["health"] = Math.max(0, Math.min(cur2, mx));
          writtenKeys.add("health");
        }

        // Suite namespace — full overwrite (we own it).
        (d.metadata as any)[BUBBLES_META] = next;

        // External namespace — shallow merge so upstream-extension
        // fields we don't track (visibility flags, name plate
        // settings, etc.) survive intact.
        if (extPrev != null) {
          const extPatch: Record<string, unknown> = {};
          for (const k of writtenKeys) {
            if (k in next) extPatch[k] = next[k];
            else delete (extPrev as any)[k];
          }
          (d.metadata as any)[EXTERNAL_BUBBLES_META] = { ...extPrev, ...extPatch };
        }

        if (patch.name != null) (d.metadata as any)[BUBBLES_NAME] = patch.name;
      }
    });
  } catch (e) {
    console.warn("[obr-suite/bubbles] writeBubbleStats failed", e);
  }
}

export function readBubbleStatsForToken(item: Item): BubbleData | null {
  return readBubbleData(item);
}

// One-shot DM repair: clears the legacy `hide:true` flag on every bubble
// metadata blob in the current scene. We need this because the migration
// from `com.owlbear-rodeo-bubbles-extension/metadata` to `com.obr-suite/
// bubbles/data` carried the old flag forward, and `hide=true` makes
// computeViewMode return "hidden" for non-GMs unconditionally — players
// stop seeing the bar entirely. After the repair, visibility falls back
// to the `locked` field: unlocked → full bar; locked + in-combat →
// silhouette; locked + out-of-combat → hidden.
export async function repairLegacyHiddenBubbles(): Promise<{ touched: number; total: number }> {
  let items: Item[] = [];
  try {
    items = await OBR.scene.items.getItems();
  } catch (e) {
    console.warn("[obr-suite/bubbles] repair: getItems failed", e);
    return { touched: 0, total: 0 };
  }
  const targetIds: string[] = [];
  for (const it of items) {
    const meta = (it.metadata as any) ?? {};
    const a = meta[BUBBLES_META];
    const b = meta[EXTERNAL_BUBBLES_META];
    const aHide = a && typeof a === "object" && (a as any).hide === true;
    const bHide = b && typeof b === "object" && (b as any).hide === true;
    if (aHide || bHide) targetIds.push(it.id);
  }
  if (targetIds.length === 0) return { touched: 0, total: items.length };
  try {
    await OBR.scene.items.updateItems(targetIds, (drafts) => {
      for (const d of drafts) {
        const meta = d.metadata as any;
        const a = meta[BUBBLES_META];
        if (a && typeof a === "object" && (a as any).hide === true) {
          (a as any).hide = false;
        }
        const b = meta[EXTERNAL_BUBBLES_META];
        if (b && typeof b === "object" && (b as any).hide === true) {
          (b as any).hide = false;
        }
      }
    });
  } catch (e) {
    console.warn("[obr-suite/bubbles] repair: updateItems failed", e);
  }
  return { touched: targetIds.length, total: items.length };
}
