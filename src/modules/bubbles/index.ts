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

// Compatibility namespace — shared with the upstream extension so a
// scene previously using it migrates transparently.
export const BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";

// --- Functional constants matching upstream for visual parity ----------
const BAR_HEIGHT = 20;
const BAR_PADDING = 2;
const BAR_CORNER_RADIUS = BAR_HEIGHT / 2;
const BG_OPACITY = 0.6;
const FILL_OPACITY = 0.5;
const BAR_FONT_SIZE = 22;

const DIAMETER = 30;
const BUBBLE_FONT_SIZE = DIAMETER - 8;          // 22, fits 1–2 digits
const BUBBLE_FONT_SIZE_TIGHT = DIAMETER - 15;   // 15, used for 3 digits
const TEXT_VERTICAL_OFFSET = -0.3;              // OBR text rendering nudge

// Stat bubble palette.
const HP_FILL = "#e74c3c";
const HP_BG = "#A4A4A4";
const HP_BG_HIDDEN = "#000000";    // GM-only when stats are hidden from players
const TEMP_HP_COLOR = "#3b82f6";    // blue
const AC_COLOR = "#c0c4cc";         // silver

const FONT_FAMILY = "Roboto, sans-serif";

// Items have these inheritance behaviors disabled so that scaling /
// rotating / locking the parent token doesn't mangle the bubble
// items. POSITION inheritance stays so the bar follows on drag.
const DISABLE_INHERIT: Array<"SCALE" | "ROTATION" | "LOCKED" | "COPY"> = [
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
}

function readBubbleData(item: Item): BubbleData | null {
  const m = (item.metadata as any)?.[BUBBLES_META];
  if (!m || typeof m !== "object") return null;
  const hpRaw = Number(m["health"]);
  const maxRaw = Number(m["max health"]);
  const tempRaw = Number(m["temporary health"]);
  const acRaw = m["armor class"];
  const hasHp = Number.isFinite(maxRaw) && maxRaw > 0;
  const hasAc = acRaw != null && Number.isFinite(Number(acRaw));
  if (!hasHp && !hasAc) return null;
  return {
    hp: Number.isFinite(hpRaw) ? Math.max(0, Math.min(hpRaw, hasHp ? maxRaw : hpRaw)) : (hasHp ? maxRaw : 0),
    maxHp: hasHp ? maxRaw : 0,
    tempHp: Number.isFinite(tempRaw) && tempRaw > 0 ? Math.floor(tempRaw) : 0,
    ac: hasAc ? Number(acRaw) : null,
    hide: !!m["hide"],
  };
}

function dataHash(d: BubbleData): string {
  return `${d.hp}|${d.maxHp}|${d.tempHp}|${d.ac == null ? "_" : d.ac}|${d.hide ? 1 : 0}`;
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

// SKSL shader for the HP-bar shimmer overlay. Renders an additive
// highlight pass over the static fill curve underneath:
//   - rounded-end clipping so highlights respect the bar shape
//   - a gradient brightening the top edge (suggests volume)
//   - a moving bright band that sweeps left → right (the "flow")
//   - low-amplitude sine ripples for liquid motion
// All driven by the `iTime` uniform that we update from a single
// throttled timer (see `ensureAnimationTimer`).
const HP_SHIMMER_SKSL = `
uniform float iTime;
uniform float2 iSize;
uniform float ratio;

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
  float edge = 1.0 - smoothstep(r - 1.0, r, dist);

  // Sweeping highlight band — bandPos cycles through [-0.2, 1.2]
  // so the band scrolls off the right end and re-enters from the
  // left without a hard reset.
  float bandPos = mod(iTime * 0.5, 1.4) - 0.2;
  float bandX = bandPos * size.x;
  float bandWidth = max(8.0, size.x * 0.08);
  float bd = (coord.x - bandX) / bandWidth;
  float band = exp(-bd * bd) * 0.85;

  // Two interfering sine waves → subtle "liquid sloshing".
  float ripple = sin(coord.x * 0.35 - iTime * 3.0) * 0.07
              + sin(coord.x * 0.18 + iTime * 1.7) * 0.05;

  // Top-edge brightening for a hint of 3D volume.
  float vgrad = (1.0 - coord.y / size.y) * 0.20;

  // Final intensity. Probe runs showed the bar visibly rendering
  // but with alpha so low it read as "nothing happening", so the
  // raw sum is multiplied 2.5× and clamped to 1.0. The base
  // ripple+vgrad bias provides a faint always-on warm glow so
  // even the off-band sections show some color.
  float intensity = clamp((band + max(0.0, ripple) + vgrad) * 2.5, 0.0, 1.0);
  // Slight reddish warmth so the shimmer reads as "blood" rather
  // than plain white noise.
  half3 color = half3(1.0, 0.78, 0.78);
  return half4(color * intensity, intensity * edge);
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
  hash: string;                   // matches dataHash(data)
  geomKey: string;                // matches the layout signature (position + width)
}
const entries = new Map<string, BubbleEntry>();

let role: "GM" | "PLAYER" = "PLAYER";
let unsubs: Array<() => void> = [];
let inSync = false;
let queuedSync = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

// --- Animation timer for shimmer effects ----------------------------------
// OBR Effect items don't auto-update their uniforms, so we drive `iTime`
// from a single throttled interval. One batched updateItems per tick
// updates every active shimmer — cheaper than per-token calls.
let animationTimer: ReturnType<typeof setInterval> | null = null;
let animationStart = Date.now();

let timerTickCount = 0;
function ensureAnimationTimer(): void {
  if (animationTimer) return;
  let any = false;
  for (const e of entries.values()) if (e.shimmerIds.length) { any = true; break; }
  if (!any) return;
  animationStart = Date.now();
  timerTickCount = 0;
  console.log("%c[bubbles] animation timer START", "color:#9a6cf2");
  animationTimer = setInterval(() => {
    const ids: string[] = [];
    for (const e of entries.values()) ids.push(...e.shimmerIds);
    if (ids.length === 0) {
      stopAnimationTimer();
      return;
    }
    const t = (Date.now() - animationStart) / 1000;
    timerTickCount++;
    if (timerTickCount % 30 === 1) {
      console.log("[bubbles] timer tick", { ids: ids.length, t: t.toFixed(2) });
    }
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
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    syncBubbles().catch((e) => console.warn("[obr-suite/bubbles] sync failed", e));
  }, 60);
}

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
  /** anchor at the token's bottom-center in scene coords */
  origin: Vector2;
  /** bar's TOP-LEFT in scene coords */
  barOrigin: Vector2;
  /** bar width in scene units */
  barWidth: number;
  /** scaled bar height */
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
}

function computeLayout(
  image: Image,
  sceneDpi: number,
  data: BubbleData,
  userScale: number,
): BarLayout {
  const center = getImageCenter(image, sceneDpi);
  const size = getRenderedSize(image, sceneDpi);

  // Token-size-proportional scale. A standard 1-cell token (image
  // width = sceneDpi worth of scene units when scale.x = 1) yields
  // tokenScale = 1.0; halving / doubling the token halves / doubles
  // it. Min of width & height keeps very wide or very tall token
  // images from blowing up the bar past their narrower dimension.
  const tokenScale = Math.max(0.05, Math.min(size.width, size.height) / sceneDpi);
  const s = tokenScale * userScale;

  const barHeight = BAR_HEIGHT * s;
  const barPadding = BAR_PADDING * s;
  const barCornerRadius = barHeight / 2;
  const barFontSize = BAR_FONT_SIZE * s;
  const barTextOffset = TEXT_VERTICAL_OFFSET * s;
  const diameter = DIAMETER * s;
  const bubbleFontSize = BUBBLE_FONT_SIZE * s;
  const bubbleFontSizeTight = BUBBLE_FONT_SIZE_TIGHT * s;
  const bubbleTextOffset = TEXT_VERTICAL_OFFSET * s;

  const origin: Vector2 = { x: center.x, y: center.y + size.height / 2 };

  // Bar inset by `barPadding` on each side; sits 2*s scene units
  // above the bottom edge so there's a small gap to the token edge.
  const barWidth = Math.max(barHeight, size.width - barPadding * 2);
  const barOrigin: Vector2 = {
    x: origin.x - barWidth / 2,
    y: origin.y - barHeight - 2 * s,
  };

  // Stat bubbles sit right-aligned ABOVE the bar's top edge, with the
  // rightmost bubble nestled at the token's right edge. All gaps and
  // diameters scale with the token, so a tiny familiar's bubbles
  // proportionally hug the bar instead of looming over the top.
  const showHp = data.maxHp > 0;
  const bubbleGap = 4 * s;
  const bubbleSpacing = 8 * s;
  const edgeInset = 2 * s;
  const bubbleBottomY = barOrigin.y - bubbleGap;
  const bubbleCenterY = bubbleBottomY - diameter / 2;

  let acCenter: Vector2 | null = null;
  let tempCenter: Vector2 | null = null;

  let nextRightEdge = origin.x + size.width / 2 - edgeInset;
  if (data.ac != null) {
    acCenter = { x: nextRightEdge - diameter / 2, y: bubbleCenterY };
    nextRightEdge -= diameter + bubbleSpacing;
  }
  if (data.tempHp > 0 && showHp) {
    tempCenter = { x: nextRightEdge - diameter / 2, y: bubbleCenterY };
  }

  void showHp;
  return {
    origin, barOrigin, barWidth,
    barHeight, barCornerRadius, barFontSize, barTextOffset,
    diameter, bubbleFontSize, bubbleFontSizeTight, bubbleTextOffset,
    acCenter, tempCenter,
  };
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
    .strokeOpacity(0)
    .strokeWidth(0)
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
    .width(L.barWidth)
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
  // Shape CIRCLE position is the bubble's CENTER (verified empirically
  // against the upstream's positioning math).
  return buildShape()
    .shapeType("CIRCLE")
    .width(L.diameter)
    .height(L.diameter)
    .fillColor(color)
    .fillOpacity(BG_OPACITY)
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
    .zIndex(15000)
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
  const W = L.diameter;
  const H = L.diameter;
  return buildCurve()
    .fillColor(color)
    .fillOpacity(BG_OPACITY)
    .strokeColor("#ffffff")
    .strokeOpacity(0.45)
    .strokeWidth(Math.max(0.6, L.diameter * 0.04))
    .tension(0)
    .closed(true)
    .points(shieldPoints(W, H))
    .position({ x: center.x - W / 2, y: center.y - H / 2 })
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(15000)
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
  // (because the bottom point is thin); nudge AC text up by 8%
  // of the bbox so the number looks centered on the shield body.
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
  layout: BarLayout;
  hash: string;
  geomKey: string;
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
let patchGeometryCount = 0;
async function patchGeometry(patches: Array<{ entry: BubbleEntry; w: Wanted }>): Promise<void> {
  if (patches.length === 0) return;
  patchGeometryCount++;
  console.log("[bubbles] patchGeometry #" + patchGeometryCount, { patches: patches.length });

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
            da.text.width = L.barWidth;
            da.text.height = L.barHeight;
            if (da.text.style) {
              da.text.style.fontSize = L.barFontSize;
              da.text.style.strokeWidth = Math.max(0.4, L.barHeight * 0.075);
            }
          }
          break;
        }
        case "ac-shield": {
          if (L.acCenter) {
            da.position = { x: L.acCenter.x - D / 2, y: L.acCenter.y - D / 2 };
            da.points = shieldPoints(D, D);
            da.style = { ...(da.style ?? {}), strokeWidth: Math.max(0.6, D * 0.04) };
          }
          break;
        }
        case "ac-text": {
          if (L.acCenter) {
            const txt: string = da.text?.plainText ?? "";
            const fs = txt.length >= 3 ? L.bubbleFontSizeTight : L.bubbleFontSize;
            const yShift = -D * 0.08;
            da.position = {
              x: L.acCenter.x - D / 2,
              y: L.acCenter.y - D / 2 + L.bubbleTextOffset + yShift,
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

    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

    const userScale = readUserScale();

    const wanted = new Map<string, Wanted>();
    for (const it of allItems) {
      // Match upstream — Character / Mount / Prop layers all show bubbles.
      if (it.layer !== "CHARACTER" && it.layer !== "MOUNT" && it.layer !== "PROP") continue;
      if (!isImage(it)) continue;
      const d = readBubbleData(it);
      if (!d) continue;
      const statsVisible = !d.hide;
      if (d.hide && role !== "GM") continue;
      const layout = computeLayout(it, sceneDpi, d, userScale);
      const has = { hp: d.maxHp > 0, ac: d.ac != null, temp: d.tempHp > 0 && d.maxHp > 0 };
      wanted.set(it.id, {
        tok: it,
        data: d,
        layout,
        hash: dataHash(d),
        geomKey: geometryKey(layout, has),
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

    // For each wanted: rebuild on data hash change OR geometry change.
    // Earlier rounds tried position-only patches on geometry change,
    // but the Curve's polygon points are baked in at create time —
    // patching position alone makes the bar appear "anchored at its
    // bottom-left" because position shifts but width/shape doesn't.
    // Full rebuild on width change keeps the visual correct.
    const rebuildIds: string[] = [];
    const toAdd: any[] = [];
    // Tokens whose data is unchanged but whose geometry shifted
    // (drag, resize, scale change). Patched in-place via
    // patchGeometry — keeps the live update during a token resize
    // gesture instead of the user only seeing the new size on
    // mouse-release.
    const geomPatches: Array<{ entry: BubbleEntry; w: Wanted }> = [];

    for (const [tokId, w] of wanted) {
      const existing = entries.get(tokId);
      if (existing && existing.hash === w.hash && existing.geomKey === w.geomKey) continue;
      if (existing && existing.hash === w.hash) {
        // Data unchanged → cheap in-place geometry patch.
        geomPatches.push({ entry: existing, w });
        existing.geomKey = w.geomKey;
        continue;
      }
      // Hash changed (or new token) → full rebuild.
      if (existing) rebuildIds.push(...existing.ids);

      const ctx: BuildContext = { token: w.tok, visible: w.tok.visible };
      const newIds: string[] = [];

      // HP bar
      const shimmerIds: string[] = [];
      if (w.data.maxHp > 0) {
        const ratio = Math.max(0, Math.min(1, w.data.hp / w.data.maxHp));
        const bg = buildBarBg(ctx, w.layout, w.statsVisible);
        const fill = buildBarFill(ctx, w.layout, ratio);
        const text = buildBarText(ctx, w.layout, w.data);
        toAdd.push(bg, fill);
        newIds.push(bg.id, fill.id);

        // Single STD/SRC shimmer with a brighter shader than the
        // probe version. Test rows 1+2 confirmed the path renders
        // and animates — they were just too dim. The shader's
        // intensity has been multiplied 3× and the band peak
        // raised so the highlight reads cleanly without needing
        // PLUS blend (which the probe row 2 showed buys nothing
        // on top of SRC_OVER).
        if (w.statsVisible) {
          const shimmer = buildHpShimmer(ctx, w.layout, ratio);
          toAdd.push(shimmer);
          newIds.push(shimmer.id);
          shimmerIds.push(shimmer.id);
        }

        toAdd.push(text);
        newIds.push(text.id);
      }
      // AC shield (replaces the circular stat bubble)
      if (w.layout.acCenter && w.data.ac != null) {
        const acShield = buildAcShield(ctx, w.layout, w.layout.acCenter, AC_COLOR);
        const acText = buildStatBubbleText(ctx, w.layout, w.layout.acCenter, w.data.ac, "ac-text");
        toAdd.push(acShield, acText);
        newIds.push(acShield.id, acText.id);
      }
      // Temp HP bubble (still a circle — distinct from the shield)
      if (w.layout.tempCenter && w.data.tempHp > 0) {
        const tempBg = buildStatBubbleBg(ctx, w.layout, w.layout.tempCenter, TEMP_HP_COLOR);
        const tempText = buildStatBubbleText(ctx, w.layout, w.layout.tempCenter, w.data.tempHp, "temp-text");
        toAdd.push(tempBg, tempText);
        newIds.push(tempBg.id, tempText.id);
      }

      entries.set(tokId, { ids: newIds, shimmerIds, hash: w.hash, geomKey: w.geomKey });
    }

    if (rebuildIds.length) {
      await OBR.scene.local.deleteItems(rebuildIds).catch((err) =>
        console.warn("[obr-suite/bubbles] delete-for-rebuild failed", err),
      );
    }
    if (toAdd.length) {
      await OBR.scene.local.addItems(toAdd).catch((err) =>
        console.warn("[obr-suite/bubbles] addItems failed", err),
      );
    }
    if (geomPatches.length) {
      await patchGeometry(geomPatches);
    }

    if (toAdd.length || rebuildIds.length || orphans.length || geomPatches.length) {
      const sample = [...wanted.values()][0];
      console.log(
        "%c[obr-suite/bubbles] sync",
        "background:#5dade2;color:#fff;padding:1px 5px;border-radius:3px",
        {
          tokens: wanted.size,
          itemsAdded: toAdd.length,
          itemsRebuilt: rebuildIds.length,
          geomPatches: geomPatches.length,
          orphans: orphans.length,
          sample: sample ? {
            tokenId: sample.tok.id,
            tokenPosition: sample.tok.position,
            barOrigin: sample.layout.barOrigin,
            barWidth: sample.layout.barWidth,
            acCenter: sample.layout.acCenter,
            tempCenter: sample.layout.tempCenter,
          } : null,
        },
      );
    }
    // After every successful sync, kick the animation timer if any
    // shimmer effects are now alive — and let the timer self-stop
    // the next tick if `entries` is empty.
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

// --- Module lifecycle --------------------------------------------------

export async function setupBubbles(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  console.log(
    "%c[obr-suite/bubbles] setup",
    "background:#9a6cf2;color:#fff;padding:2px 6px;font-weight:bold;border-radius:3px",
    { role, enabled: readEnabled() },
  );

  // Diagnostic log on every items.onChange so the user can verify
  // (in DevTools console) whether OBR is firing change events
  // during a token resize gesture vs only on mouse-release.
  let onChangeCount = 0;
  unsubs.push(OBR.scene.items.onChange((items) => {
    onChangeCount++;
    if (onChangeCount % 5 === 1) {
      const sample = items.find((it) => it.layer === "CHARACTER" || it.layer === "MOUNT" || it.layer === "PROP");
      console.log("[bubbles] items.onChange #" + onChangeCount, {
        total: items.length,
        sampleScale: sample ? { x: sample.scale.x, y: sample.scale.y } : null,
        samplePos: sample ? { x: sample.position.x, y: sample.position.y } : null,
      });
    }
    scheduleSync();
  }));

  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_BUBBLES_ENABLED || e.key === LS_BUBBLES_SCALE) {
      void clearAll().then(() => syncBubbles().catch(() => {}));
    }
  };
  window.addEventListener("storage", onStorage);
  unsubs.push(() => window.removeEventListener("storage", onStorage));

  void syncBubbles();
}

export async function teardownBubbles(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
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
        const cur = ((d.metadata as any)[BUBBLES_META] as Record<string, unknown> | undefined) ?? {};
        const next: Record<string, unknown> = { ...cur };
        if (patch.hp != null) next["health"] = Math.max(0, Math.floor(patch.hp));
        if (patch.maxHp != null) next["max health"] = Math.max(0, Math.floor(patch.maxHp));
        if (patch.tempHp != null) next["temporary health"] = Math.max(0, Math.floor(patch.tempHp));
        if (patch.ac !== undefined) {
          if (patch.ac == null) delete next["armor class"];
          else next["armor class"] = Math.floor(patch.ac);
        }
        if (patch.hide != null) next["hide"] = !!patch.hide;
        const mx = Number(next["max health"]);
        const cur2 = Number(next["health"]);
        if (Number.isFinite(mx) && mx > 0 && Number.isFinite(cur2)) {
          next["health"] = Math.max(0, Math.min(cur2, mx));
        }
        (d.metadata as any)[BUBBLES_META] = next;
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
