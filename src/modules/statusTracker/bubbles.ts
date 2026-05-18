// Status-tracker on-token buff visualisation.
//
// === Placement algorithm (per user spec) =============================
// "以角色为圆心，顶部为点，左右120度的范围内都可以作为可放置气泡区域。"
// → Token centre is the circle origin; the placeable arc is ±120° from
//   straight up (240° total fan at the top of the token).
//
// "每个 buff 气泡象征着以自己的宽度的两端 AB，到圆点 O 的位置是不能放
//  置新的气泡 buff 的，称呼为范围 Q。"
// → Each placed bubble has an angular range Q = [θ - δ, θ + δ] where
//   δ = atan(W/2 / R) is the half-angle subtended by half the bubble's
//   width at radius R. New bubbles can't overlap any existing Q.
//
// "第二个气泡放置上去时…先通过左右放置计数器决定放在左边还是右边，
//  然后看看这边剩余的宽度是否能够容纳自己的范围 Q2，如果不能则检测
//  另外一边是否能容纳自己的范围 Q2，还是不能则另起一行放置。"
// → Side counter (alternates R/L). For each new bubble, try the
//   preferred side; if its Q doesn't fit before hitting ±120°, try the
//   other side; if neither, increase the radius (new row) and retry.
// "和上一行保持 3px 的间距" → row gap ≈ 3 screen-px. Implemented as a
//   small fraction of pillH so it scales with the bubble.
//
// === Render strategy =================================================
// Each pill is a curved "pizza-crust" band (PATH with line-segment
// approximated arc) plus a TEXT label sitting on top of it. The Path
// commands are built directly in token-centred coords so the band
// follows the token's circumference; rotation is baked into the
// commands and the .position() pins the path's local origin to the
// token centre. Text is a separate flat rectangle that we rotate by
// the band's centre angle — the user agreed slight visual mismatch
// between curved band and straight text is acceptable.
//
// Both bg path and text label render on the **DRAWING layer** so
// they sit below the token (CHARACTER layer). The inner half of the
// bubble naturally hides under the token, only the outer "crust"
// shows — matches the user's spec ("显示在角色下方被角色覆盖").
//
// === Sync strategy ===================================================
// Previously we used updateItems (Immer-based diff/patch) to update
// existing items in place. That turned out to be brittle: the
// updateItems batch fails wholesale if the Immer producer throws on
// any draft, and OBR's draft proxies have edge cases that we hit.
//
// Now we use the dumb-and-reliable approach: delete-all-our-items-
// for-this-token, then add the fresh set. Index.ts already gates
// re-syncs via tokenSyncKey (token id + buff list + scale + dims),
// so this only fires when SOMETHING actually changed. The ~1 frame
// of flicker on a scale tick is the cost of reliability.
//
// === Stale-item sweep ================================================
// All items we create carry the OWNER_KEY metadata. `sweepAllOurItems`
// finds and deletes every such item — used by index.ts on scene-ready
// to wipe leftovers from a previous session.

import OBR, {
  buildImage,
  buildPath,
  buildText,
  Command,
  Image,
  Item,
  PathCommand,
} from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";

import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  STATUS_BUFF_ROUNDS_KEY,
  STATUS_RESOURCES_KEY,
  STATUS_EFFECTS_ENABLED,
  BuffDef,
  BuffEffect,
  textColorFor,
  getStatusRenderMode,
} from "./types";
import * as particles from "./particles";

export const OWNER_KEY = `${PLUGIN_ID}/buff-owner`;
const ROLE_KEY = `${PLUGIN_ID}/buff-role`;
const BUFF_ID_KEY = `${PLUGIN_ID}/buff-id`;
const EFFECT_KEY = `${PLUGIN_ID}/buff-effect`;
type Role = "bg" | "label" | "effect";

// (Bubble drag-by-grab feature was reverted in favour of the
// "manage popover" UX — see status-tracker-manage-page.ts. The
// bubble items themselves are now always static / non-interactive,
// rendered on the DRAWING layer below the token. To remove or
// transfer a buff, the user drags the 🛠 manage pill from the
// palette onto a token; that opens a popover listing the token's
// buffs, and the user drags within THAT popover to remove or
// transfer.)

// === Geometry constants ====================================================
const PILL_HEIGHT_FACTOR = 0.10;   // 10% of token height
const PILL_PAD_X_FACTOR = 0.55;
const FONT_FACTOR = 0.62;
const PLACEABLE_ARC_DEG = 120;
// Row stacking: subsequent rows step out by `pillH + ROW_GAP` scene
// units. User asked for tighter packing — 1 unit overlap so each row
// almost-touches the previous one (visually ~1 screen-px overlap at
// typical zoom). Previous value was ROW_GAP = pillH * 0.15 (≈ 3px).
const ROW_GAP = -1;                // scene units; negative = overlap
const ARC_SEGMENTS = 24;           // line-segment count for each arc edge
const FONT_FAMILY = '"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji","Twemoji Mozilla","EmojiOne Color","Microsoft YaHei",sans-serif';
// Fully opaque bubble per user spec (was 0.65 — felt too washed-out).
const FILL_OPACITY = 1.0;

// 2026-05-15 — strip pictographic emoji from buff names when rendering
// the on-token bubble pills + labels. Doesn't mutate the underlying
// buff data: legacy "麻痹 ⚡" / "魅惑 💘" etc. saves still load, the
// label just renders as the textual portion ("麻痹" / "魅惑"). Width
// estimates use the cleaned string too so layout stays consistent.
function stripEmoji(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, "")
          .replace(/[\u{FE0E}\u{FE0F}\u{200D}]/gu, "")
          .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
          .replace(/\s+/g, " ")
          .trim();
}

// Split text into grapheme clusters so emoji ZWJ sequences (👨‍👩‍👧
// etc.) stay together as single "characters". Falls back to
// codepoint iteration if Intl.Segmenter is unavailable.
function splitGraphemes(s: string): string[] {
  try {
    const SegCtor = (Intl as any).Segmenter;
    if (SegCtor) {
      const seg = new SegCtor([], { granularity: "grapheme" });
      return Array.from(seg.segment(s), (item: any) => item.segment as string);
    }
  } catch { /* fallthrough */ }
  return Array.from(s);
}

// 2026-05-05 bug fix: per-grapheme width estimate.
// The old pillW formula was `padX*2 + name.length * fontSize * 0.85`
// — that 0.85 multiplier was tuned for CJK glyphs (which are roughly
// `fontSize` wide each) and made English buff names allocate ~70%
// more width than they actually rendered. Long English labels (e.g.
// "Bardic Insp. 🎵") then overflowed the placeable arc on the FIRST
// row, kicking subsequent buffs to outer rows where the curved-band
// degenerates visually into "tall thin rectangles far from the
// token". Now we estimate width per-grapheme: ASCII letter / digit /
// punctuation ≈ 0.55× fontSize, ASCII space ≈ 0.30×, anything
// non-ASCII (CJK / emoji) ≈ 1.0×.
function estimateGraphemeWidth(g: string, fontSize: number): number {
  if (!g) return 0;
  const code = g.codePointAt(0) ?? 0;
  if (code < 0x80) {
    if (g === " ") return fontSize * 0.30;
    if (/[iIl1.,;:!|']/.test(g)) return fontSize * 0.32;
    return fontSize * 0.55;
  }
  // Non-ASCII: full-width CJK / emoji.
  return fontSize * 1.0;
}
function estimateNameWidth(name: string, fontSize: number): number {
  let total = 0;
  for (const g of splitGraphemes(name)) total += estimateGraphemeWidth(g, fontSize);
  return total;
}

import { getTokenCircleSpec } from "./circles";

function meta(tokenId: string, role: Role, buffId: string, effect: BuffEffect): Record<string, unknown> {
  return {
    [OWNER_KEY]: tokenId,
    [ROLE_KEY]: role,
    [BUFF_ID_KEY]: buffId,
    [EFFECT_KEY]: effect,
  };
}

function darken(hex: string, amount = 0.30): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#000000";
  const v = parseInt(m[1], 16);
  let r = (v >> 16) & 0xff;
  let g = (v >> 8) & 0xff;
  let b = v & 0xff;
  r = Math.round(r * (1 - amount));
  g = Math.round(g * (1 - amount));
  b = Math.round(b * (1 - amount));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// === Curved-band path commands =============================================
//
// Builds a closed polygon shaped like a pizza-crust slice — outer arc
// from (θ_c - θ_h) to (θ_c + θ_h) at radius rOuter, then inner arc
// reversed at radius rInner. Coordinates are RELATIVE to the token
// centre (caller .position()s the path at (cx, cy)). θ = 0 is "up",
// positive = clockwise.
function curvedBandCommands(
  thetaCenter: number, thetaHalf: number,
  rInner: number, rOuter: number,
  segments: number = ARC_SEGMENTS,
): PathCommand[] {
  const out: PathCommand[] = [];
  const start = thetaCenter - thetaHalf;
  const end = thetaCenter + thetaHalf;
  // Outer arc, start → end
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const θ = start + t * (end - start);
    const x = Math.sin(θ) * rOuter;
    const y = -Math.cos(θ) * rOuter;
    out.push([i === 0 ? Command.MOVE : Command.LINE, x, y]);
  }
  // Inner arc, end → start (reversed)
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const θ = start + t * (end - start);
    const x = Math.sin(θ) * rInner;
    const y = -Math.cos(θ) * rInner;
    out.push([Command.LINE, x, y]);
  }
  out.push([Command.CLOSE]);
  return out;
}

// === Placement algorithm ===================================================

interface Placement {
  ringRadius: number;
  angleDeg: number; // -120..+120, 0 = straight up
}

function packBuffs(
  widths: number[],
  pillH: number,
  ringRadius0: number,
): Placement[] {
  const out: Placement[] = [];
  let ringRadius = ringRadius0;
  let rightUsed = 0;
  let leftUsed = 0;
  let nextSide: "right" | "left" = "right";
  // Row step = pillH + (negative gap → 1 unit overlap with previous row).
  // Per user spec: "更加贴近一些试着贴紧 1px，也就是半径减少 1px".
  const rowStep = pillH + ROW_GAP;
  const TO_DEG = 180 / Math.PI;

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    let placed = false;
    let safety = 0;

    while (!placed && safety < 12) {
      safety++;
      const halfAngle = Math.atan((w / 2) / ringRadius) * TO_DEG;

      if (rightUsed === 0 && leftUsed === 0) {
        out.push({ ringRadius, angleDeg: 0 });
        rightUsed = halfAngle;
        leftUsed = halfAngle;
        placed = true;
        break;
      }

      const order: Array<"right" | "left"> = nextSide === "right"
        ? ["right", "left"]
        : ["left", "right"];
      for (const side of order) {
        if (side === "right" && rightUsed + 2 * halfAngle <= PLACEABLE_ARC_DEG) {
          out.push({ ringRadius, angleDeg: rightUsed + halfAngle });
          rightUsed += 2 * halfAngle;
          nextSide = "left";
          placed = true;
          break;
        }
        if (side === "left" && leftUsed + 2 * halfAngle <= PLACEABLE_ARC_DEG) {
          out.push({ ringRadius, angleDeg: -(leftUsed + halfAngle) });
          leftUsed += 2 * halfAngle;
          nextSide = "right";
          placed = true;
          break;
        }
      }

      if (!placed) {
        ringRadius += rowStep;
        rightUsed = 0;
        leftUsed = 0;
      }
    }

    if (!placed) {
      ringRadius += rowStep;
      out.push({ ringRadius, angleDeg: 0 });
    }
  }
  return out;
}

// === Build descriptors =====================================================

interface PillBgDescriptor {
  buffId: string; effect: BuffEffect;
  cx: number; cy: number;
  thetaCenterRad: number; thetaHalfRad: number;
  rInner: number; rOuter: number;
  fillColor: string; fillOpacity: number;
  stroke: string; strokeOpacity: number; borderW: number;
  /** 2026-05-13 — token-z-locked zIndex. See computeStackBase. */
  zIndex: number;
}
// ONE TEXT item per buff — the whole name as a single flat rectangle
// laid over the curved band. (An earlier revision split the label
// per-grapheme to hug the arc; the user asked to go back to one item
// per buff to cut item count / render load. The font is scaled down
// so the flat text stays inside the curved band — the box itself is
// kept generously larger than the rendered text so OBR's rotated-text
// rasteriser never clips it.)
interface LabelDescriptor {
  buffId: string; effect: BuffEffect;
  posX: number; posY: number; rotationDeg: number;
  boxW: number; boxH: number;
  fontSize: number;
  fg: string;
  text: string;
  /** 2026-05-13 — token-z-locked zIndex. See computeStackBase. */
  zIndex: number;
}

// 2026-05-13 — per-token zIndex base. Status items live on the
// DRAWING layer; tokens live on CHARACTER. Items within a layer
// sort by zIndex. Mapping `token.zIndex * STACK_MULT + slotOffset`
// guarantees:
//   • All items belonging to token A end up above all items of token
//     B whenever A.zIndex > B.zIndex (matches the user spec: "if the
//     current token is above another token, its status should also
//     be above").
//   • Within a single token, slot offsets order the layers:
//        bg band = base + 0
//        label   = base + SLOT_LABEL (above the band path)
// STACK_MULT = 1000 leaves room for 999 inner-slot items per token
// before colliding with the next token's stack — generous, given a
// no-effect buff is now just 2 items (one band path + one text label).
const STACK_MULT = 1000;
const SLOT_BG_MAIN = 0;
const SLOT_LABEL = 100;
// WebM effect items sit ABOVE the curved-band label of the same token
// but BELOW any other token whose zIndex is higher. Slot 200 leaves
// room for additional in-stack roles between label and webm if
// needed later.
const SLOT_WEBM = 200;
function computeStackBase(token: Image): number {
  // token.zIndex CAN be negative on tokens the user manually sent to
  // back; Math.floor preserves sign while quantising. Falling back to
  // 0 if undefined (very old items).
  const z = typeof token.zIndex === "number" ? token.zIndex : 0;
  return Math.floor(z) * STACK_MULT;
}
/** A buff whose visual is a pre-rendered WebM video (rendered as a
 *  single OBR Image item with mime:video/webm). The browser plays
 *  the video natively — no per-frame JS work, GPU-decoded animation.
 *  See tools/buff-fx-gen/buff_fx.py for the WebM generator. */
interface WebmDescriptor {
  buffId: string;
  /** Absolute URL of the WebM (resolved via assetUrl() at describe time). */
  url: string;
  /** World-coord centre of the rendered WebM (= token centre). The
   *  Image item is built with ImageGrid.offset = (intrinsicSize/2,
   *  intrinsicSize/2) so this `centre` lands at the WebM's middle —
   *  fixing the earlier upper-left drift bug caused by treating
   *  ImageContent.width/dpi as scene pixels. */
  centre: { x: number; y: number };
  /** Scale.x = scale.y applied so the WebM renders at the token's
   *  natural footprint × per-buff webmScale. */
  scale: number;
  /** Intrinsic WebM resolution (assumed square 192×192 — matches the
   *  generator's defaults). Used as the offset (half) for
   *  centre-anchor positioning, and as the fallback square dims. */
  intrinsicSize: number;
  /** 2026-05-14 (#2) — explicit width/height. WebM buffs leave these
   *  at intrinsicSize (square). Static-image buffs (iconAsset) set
   *  the image's real dimensions so non-square pictures keep their
   *  aspect ratio. */
  intrinsicW: number;
  intrinsicH: number;
  /** 2026-05-14 (#2) — content mime. WebM buffs → "video/webm";
   *  static-image (iconAsset) buffs → the image's real mime so OBR
   *  renders a still picture, not a broken video element. */
  mime: string;
  /** Scene grid DPI captured at describe-time. Plugged into
   *  ImageGrid.dpi so OBR scales the image correctly — using the
   *  image's intrinsic 192 as dpi made it render (192/sceneDpi)
   *  smaller than expected. */
  sceneDpi: number;
  /** zIndex slot — token.zIndex * STACK_MULT + SLOT_WEBM. */
  zIndex: number;
  /** 2026-05-18 — degrees. From BuffDef.rotation; baked when the buff
   *  was created via "以此创建状态" from a pre-rotated source image
   *  so the buff retains that orientation when rendered on any token. */
  rotation?: number;
}

interface TokenDescriptors {
  bgs: PillBgDescriptor[];
  labels: LabelDescriptor[];
  /** Buffs whose `effect` is non-default — these are passed verbatim
   *  to particles.syncForToken which manages its own item set. */
  effectBuffs: BuffDef[];
  /** 2026-05-14 — buffs with a `webmAsset` resolve to one Image item
   *  each, bypassing the curved-band pipeline entirely. */
  webms: WebmDescriptor[];
  // Geom snapshot needed by particles.syncForToken.
  cx: number; cy: number;
  tokenW: number; tokenH: number;
  ringRadius: number;
}

// Assumed intrinsic resolution of every WebM produced by buff_fx.py.
// If a future WebM is rendered at a different canvas size, store it
// per-asset on the BuffDef instead (intrinsicWebmSize field).
const DEFAULT_WEBM_INTRINSIC_SIZE = 192;

function describe(token: Image, buffs: BuffDef[], sceneDpi: number): TokenDescriptors {
  const { cx, cy, radius: ringRadius } = getTokenCircleSpec(token, sceneDpi);
  const imgDpi = token.grid?.dpi ?? sceneDpi;
  const ratio = sceneDpi / Math.max(1, imgDpi);
  // Math.abs on the scale — a flipped token has scale.x or scale.y = -1
  // (horizontal / vertical flip; a full 180° flip is both at -1).
  // tokenW/tokenH are a FOOTPRINT MAGNITUDE — they drive pill sizing and
  // the WebM Image's `scale`. Without abs(), a flip propagated a negative
  // dimension → negative WebM scale → the effect rendered mirrored /
  // upside-down. The flip is orientation, not size; it must not bleed in.
  const tokenH = (token.image?.height ?? imgDpi) * ratio * Math.abs(token.scale?.y ?? 1);
  const tokenW = (token.image?.width ?? imgDpi) * ratio * Math.abs(token.scale?.x ?? 1);
  const stackBase = computeStackBase(token);

  if (buffs.length === 0) {
    return { bgs: [], labels: [], effectBuffs: [], webms: [], cx, cy, tokenW, tokenH, ringRadius };
  }

  const halfH = tokenH / 2;
  const pillH = Math.max(12, halfH * PILL_HEIGHT_FACTOR * 2);
  const padX = pillH * PILL_PAD_X_FACTOR;
  const fontSize = pillH * FONT_FACTOR;

  // 2026-05-14 — Three-way buff routing:
  //   1. webms        — buff has `webmAsset` → ONE Image-with-video item
  //                     per buff. Best perf path, used for paralyzed /
  //                     stunned / poisoned. Stacks multiple WebMs
  //                     centred on the same token; they blend via alpha.
  //   2. effectBuffs  — non-default `effect` AND particles enabled →
  //                     particle system (currently disabled by feature
  //                     flag).
  //   3. defaultBuffs — "无特效" fallback: one solid curved band + one
  //                     flat text label (2 items per buff).
  //
  // 2026-05-16 — global render-mode override (per-client localStorage):
  //   "text"   — force every buff into defaultBuffs (skip webms even if
  //              the buff has a webmAsset / iconAsset).
  //   "effect" — keep webm/icon routing; only skip the per-buff
  //              `default` fallback to text would happen anyway.
  //   "auto"   — legacy per-buff behaviour.
  const renderMode = getStatusRenderMode();
  const webms: WebmDescriptor[] = [];
  const defaultBuffs: Array<{ buff: BuffDef; pillW: number }> = [];
  const effectBuffs: BuffDef[] = [];

  // For WebM placement: centre the WebM bbox on the token. Base bbox
  // size matches the token's natural rendered footprint so the
  // generator's canvas-relative motion (% of canvas) maps directly
  // to token-cell-relative motion (% of cell). 2026-05-14b — each
  // buff may override its visible size via `webmScale` so effects
  // that need to leak past the cell (bardic music drifting up-and-
  // away, flying wings extending sideways, charmed ripples reaching
  // beyond the token) can; while compact effects (deafened ear,
  // slowed hourglass-in-corner) stay tight at 1.0×.
  // Use min(tokenW, tokenH) so non-square tokens still get a sensible
  // square overlay rather than a stretched one.
  const baseFootprint = Math.min(tokenW, tokenH);

  for (const b of buffs) {
    const buffRotation = typeof b.rotation === "number" && Number.isFinite(b.rotation)
      ? b.rotation : 0;
    if (b.webmAsset && renderMode !== "text") {
      const buffScale = typeof b.webmScale === "number" && b.webmScale > 0 ? b.webmScale : 1.0;
      const footprint = baseFootprint * buffScale;
      const scale = footprint / DEFAULT_WEBM_INTRINSIC_SIZE;
      webms.push({
        buffId: b.id,
        url: assetUrl(b.webmAsset),
        // 2026-05-15 — centre-anchor positioning (was top-left). Pair
        // with buildWebmItem's offset=(intrinsicSize/2, intrinsicSize/2)
        // so OBR places the WebM's midpoint at this scene coord.
        centre: { x: cx, y: cy },
        scale,
        intrinsicSize: DEFAULT_WEBM_INTRINSIC_SIZE,
        intrinsicW: DEFAULT_WEBM_INTRINSIC_SIZE,
        intrinsicH: DEFAULT_WEBM_INTRINSIC_SIZE,
        mime: "video/webm",
        sceneDpi,
        // SLOT_WEBM (200) is above SLOT_LABEL (100) so WebMs draw over
        // any sibling curved-band label on the same token.
        zIndex: stackBase + SLOT_WEBM,
        rotation: buffRotation,
      });
      continue;
    }
    // 2026-05-14 (#2) — static-image buff ("以此创建状态"). Rendered
    // through the SAME webms[] pipeline as a WebM (one centre-anchored
    // Image item, scale/rotation inheritance off) — the only
    // differences are the real image mime + the image's real
    // dimensions (so non-square pictures aren't squished). webmScale
    // applies here too. Skipped when webmAsset is also set (webm wins).
    if (b.iconAsset && renderMode !== "text") {
      const iconScale = typeof b.webmScale === "number" && b.webmScale > 0 ? b.webmScale : 1.0;
      const iw = typeof b.iconWidth === "number" && b.iconWidth > 0 ? b.iconWidth : 256;
      const ih = typeof b.iconHeight === "number" && b.iconHeight > 0 ? b.iconHeight : 256;
      // Scale so the image's LONGEST edge matches the token footprint
      // × iconScale — keeps the aspect ratio, fits inside the cell.
      const longEdge = Math.max(iw, ih);
      const footprint = baseFootprint * iconScale;
      const scale = footprint / longEdge;
      webms.push({
        buffId: b.id,
        url: b.iconAsset,
        centre: { x: cx, y: cy },
        scale,
        intrinsicSize: longEdge,
        intrinsicW: iw,
        intrinsicH: ih,
        mime: typeof b.iconMime === "string" && b.iconMime ? b.iconMime : "image/png",
        sceneDpi,
        zIndex: stackBase + SLOT_WEBM,
        rotation: buffRotation,
      });
      continue;
    }
    const useEffect = STATUS_EFFECTS_ENABLED && (b.effect ?? "default") !== "default";
    if (useEffect) {
      effectBuffs.push(b);
    } else {
      const pillW = Math.max(20, padX * 2 + estimateNameWidth(stripEmoji(b.name), fontSize));
      defaultBuffs.push({ buff: b, pillW });
    }
  }

  // Pack the static pills into the 240° fan.
  const placements = packBuffs(
    defaultBuffs.map((d) => d.pillW),
    pillH,
    ringRadius,
  );

  const bgs: PillBgDescriptor[] = [];
  const labels: LabelDescriptor[] = [];
  // (stackBase computed at the top of describe() — used by WebMs above
  // and by label descriptors below.)

  for (let i = 0; i < defaultBuffs.length; i++) {
    const { buff, pillW } = defaultBuffs[i];
    const p = placements[i];
    const angDeg = p.angleDeg;
    const angRad = angDeg * (Math.PI / 180);
    // Half-angle in radians for the band's angular span. atan keeps
    // it correct even when bubble is wide vs. radius.
    const thetaHalfRad = Math.atan((pillW / 2) / p.ringRadius);
    const rInner = p.ringRadius - pillH / 2;
    const rOuter = p.ringRadius + pillH / 2;

    // ONE solid curved band — background only. The earlier 2-path
    // pseudo-gradient (main + ~55%-alpha highlight overlay) was
    // dropped per user request: a no-effect buff is just background +
    // text now. Band stays fully opaque so nothing shows through.
    bgs.push({
      buffId: buff.id, effect: "default",
      cx, cy,
      thetaCenterRad: angRad,
      thetaHalfRad,
      rInner, rOuter,
      fillColor: buff.color,
      fillOpacity: FILL_OPACITY,
      stroke: darken(buff.color, 0.32),
      strokeOpacity: 0.85,
      borderW: Math.max(0.5, pillH * 0.07),
      zIndex: stackBase + SLOT_BG_MAIN,
    });

    // ONE flat TEXT label for the whole buff name (was: one item per
    // grapheme hugging the arc). The band is an arc but the text box
    // is a straight rectangle, so the font is scaled DOWN until the
    // rendered text fits the largest flat rectangle that still sits
    // inside the curved band — guaranteeing "文字即使横着也在披萨边内部".
    //
    //   • radial fit — box centred at ringRadius, radial half-height
    //     `safeHalfH`; its outer corners must stay within rOuter,
    //     which bounds the tangential half-width `wOuter`.
    //   • angular fit — at the box's inner radius the tangential
    //     half-width must stay within the band's angular span → wAng.
    //
    // The TEXT item's *box* is then sized generously around the
    // already-fitted text so OBR's rotated-text rasteriser never clips
    // it; box overflow past the band is invisible (the item has no
    // fill — only the centred glyphs are visible).
    if (!buff.name) continue;
    const fg = textColorFor(buff.color);
    const safeHalfH = pillH * 0.33;
    const wOuterSq = rOuter * rOuter - (p.ringRadius + safeHalfH) * (p.ringRadius + safeHalfH);
    const wOuter = wOuterSq > 0 ? Math.sqrt(wOuterSq) : 0;
    const wAng = Math.max(0, p.ringRadius - safeHalfH) * Math.tan(thetaHalfRad);
    const safeW = Math.max(6, Math.min(wOuter, wAng) * 2 * 0.90);
    const safeH = safeHalfH * 2 * 0.92;
    // estimateNameWidth is linear in fontSize, so width at size 1 is
    // the per-unit width — divide safeW by it to get the largest font
    // that still fits tangentially. Also cap by safeH and the nominal
    // fontSize so short names don't blow up past the band thickness.
    const cleanName = stripEmoji(buff.name);
    const unitW = Math.max(0.01, estimateNameWidth(cleanName, 1));
    const labelFont = Math.max(5, Math.min(fontSize, safeW / unitW, safeH));
    const renderedW = estimateNameWidth(cleanName, labelFont);
    const boxW = renderedW * 1.35 + labelFont * 1.2;
    const boxH = labelFont * 1.9;
    // Place the box centre on the band's mid-radius, rotated to the
    // band's centre angle. Rotation pivots around the box's top-left,
    // so back it out so the centre lands on (gcx, gcy).
    const cT = Math.cos(angRad);
    const sT = Math.sin(angRad);
    const gcx = cx + sT * p.ringRadius;
    const gcy = cy - cT * p.ringRadius;
    const posX = gcx - (boxW / 2) * cT + (boxH / 2) * sT;
    const posY = gcy - (boxW / 2) * sT - (boxH / 2) * cT;
    labels.push({
      buffId: buff.id, effect: "default",
      posX, posY,
      rotationDeg: angDeg,
      boxW, boxH,
      fontSize: labelFont,
      fg,
      text: cleanName,
      zIndex: stackBase + SLOT_LABEL,
    });
  }

  // Effect-mode buffs are handed off to particles.syncForToken
  // verbatim. Geom snapshot lets the particle module compute
  // absolute scene-coord positions per tick.
  return { bgs, labels, effectBuffs, webms, cx, cy, tokenW, tokenH, ringRadius };
}

// === Item factories ========================================================

// Build a curved-band Path item with the given fill / stroke spec.
// Multiple of these can stack (main + highlight) to fake a gradient
// since OBR Path only supports solid fills and the SVG Image data-
// URI route doesn't work (OBR's image-fetcher tries to HTTP-GET the
// data: URI as a relative URL → 404).
function buildBgItem(token: Image, d: PillBgDescriptor): Item {
  return buildPath()
    .commands(curvedBandCommands(d.thetaCenterRad, d.thetaHalfRad, d.rInner, d.rOuter))
    .position({ x: d.cx, y: d.cy })
    .rotation(0)
    .fillColor(d.fillColor)
    .fillOpacity(d.fillOpacity)
    .strokeColor(d.stroke)
    .strokeOpacity(d.strokeOpacity)
    .strokeWidth(d.borderW)
    .layer("DRAWING")
    .zIndex(d.zIndex)
    .disableAutoZIndex(true)
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(true)
    .disableAttachmentBehavior(["SCALE", "ROTATION"])
    .metadata(meta(token.id, "bg", d.buffId, d.effect))
    .build();
}

/** Build an Image item rendering a pre-baked WebM video effect. The
 *  browser plays the video natively via OBR's `<video>` element path
 *  (selected by mime: "video/webm"). Each item is ONE buff effect —
 *  way cheaper than the per-glyph item explosion of the curved-band
 *  pipeline (~1 item vs ~20).
 *
 *  Attachment / inheritance:
 *    - attachedTo(token.id) so the WebM follows token drags / scale
 *    - SCALE inheritance DISABLED — the WebM is pre-scaled via
 *      `scale()` so OBR's auto-scaling doesn't double-up the size
 *      when the token has a non-1 scale
 *    - ROTATION DISABLED — the effect always stays upright relative
 *      to the camera, regardless of how the token is rotated
 *    - layer ATTACHMENT — above CHARACTER (the token sprite), below
 *      NOTE / TEXT; effects visibly overlay the token */
function buildWebmItem(token: Image, d: WebmDescriptor): Item {
  const builder = buildImage(
    // 2026-05-14 (#2) — width/height + mime now come off the
    // descriptor. WebM buffs pass square 192 + "video/webm";
    // static-image buffs pass the image's real dims + real mime.
    { width: d.intrinsicW, height: d.intrinsicH, mime: d.mime, url: d.url },
    // 2026-05-15 — ImageGrid recipe matches Embers' working pattern:
    //   dpi    = scene grid DPI (NOT the image's intrinsic resolution).
    //            Critical — using the image's intrinsic 192 here made
    //            OBR think 192px = 1 grid cell and rendered the image
    //            at (192 / sceneDpi)× the intended size, with the
    //            top-left-anchored position offset showing as upper-
    //            left drift.
    //   offset = image centre. Combined with .position(centre) below,
    //            the WebM's midpoint lands exactly on the token centre.
    { dpi: d.sceneDpi, offset: { x: d.intrinsicW / 2, y: d.intrinsicH / 2 } },
  )
    .position(d.centre)
    .scale({ x: d.scale, y: d.scale })
    .layer("ATTACHMENT")
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(true)
    .disableAutoZIndex(true)
    .zIndex(d.zIndex)
    .disableAttachmentBehavior(["SCALE", "ROTATION"])
    .metadata(meta(token.id, "bg", d.buffId, "default"));
  // 2026-05-18 — apply baked rotation (from "以此创建状态"). Skipped
  // when 0 to keep the build minimal for the common case.
  if (d.rotation) builder.rotation(d.rotation);
  return builder.build();
}

function buildLabelItem(token: Image, d: LabelDescriptor): Item {
  // 2026-05-13 — zIndex is token-z-locked (was hardcoded
  // `Date.now() + 1_000_000_000`). The label sits at stackBase +
  // SLOT_LABEL so it's above the band path of the same token, while
  // still sorting consistently with other tokens' status items per
  // the user spec "保证当前 token 如果在别的 token 的上方，那么该
  // token 的状态应该也在上方".
  return buildText()
    .textType("PLAIN")            // CRITICAL — see TextBuilder.js line 27
    .plainText(d.text)
    .position({ x: d.posX, y: d.posY })
    .rotation(d.rotationDeg)
    .width(d.boxW)
    .height(d.boxH)
    .fontSize(d.fontSize)
    .fontFamily(FONT_FAMILY)
    .fontWeight(700)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fillColor(d.fg)
    .fillOpacity(1)
    .strokeOpacity(0)
    .strokeWidth(0)
    .padding(Math.max(2, d.fontSize * 0.10))
    .layer("DRAWING")
    .zIndex(d.zIndex)
    .disableAutoZIndex(true)
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(true)
    .disableAttachmentBehavior(["SCALE", "ROTATION"])
    .metadata(meta(token.id, "label", d.buffId, d.effect))
    .build();
}

// === Detailed error logger =================================================
// OBR rejections come back as plain Object {} which doesn't pretty-
// print well. This helper unpacks every enumerable property + the
// stack so we can actually see what OBR's complaining about.
function logErr(prefix: string, e: unknown): void {
  console.warn(`[obr-suite/status] ${prefix}`, e);
  if (e && typeof e === "object") {
    const keys = Object.keys(e);
    if (keys.length > 0) {
      const dump: Record<string, unknown> = {};
      for (const k of keys) {
        try { dump[k] = (e as any)[k]; } catch { /* getter throw */ }
      }
      console.warn(`[obr-suite/status] ${prefix} :: keys`, dump);
    }
    const m = (e as any).message;
    if (typeof m === "string") console.warn(`[obr-suite/status] ${prefix} :: message`, m);
    const s = (e as any).stack;
    if (typeof s === "string") console.warn(`[obr-suite/status] ${prefix} :: stack`, s);
  }
}

// === Sync (delete-then-add per token) ======================================
//
// Reverted from diff-and-patch to the simple approach: get all our
// items for this token, delete them, build fresh, add. The diff
// approach's updateItems-fail-wholesale-on-any-draft-throw
// behaviour was making troubleshooting impossible. The token-level
// cache key in index.ts prevents this from running on every viewport
// tick — only when SOMETHING actually changed for this token.

export async function syncTokenBuffs(token: Image, buffs: BuffDef[]): Promise<void> {
  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
  const desc = describe(token, buffs, sceneDpi);

  let existingIds: string[] = [];
  try {
    const ex = await OBR.scene.items.getItems((it) =>
      (it.metadata?.[OWNER_KEY] as string) === token.id &&
      (it.metadata?.[ROLE_KEY] as string) !== "particle",
    );
    existingIds = ex.map((it) => it.id);
  } catch (e) { logErr(`scene.items.getItems(token=${token.id}) failed`, e); }

  let staleLocalIds: string[] = [];
  try {
    const ex = await OBR.scene.local.getItems((it) =>
      (it.metadata?.[OWNER_KEY] as string) === token.id &&
      (it.metadata?.[ROLE_KEY] as string) !== "particle",
    );
    staleLocalIds = ex.map((it) => it.id);
  } catch {}

  const items: Item[] = [];
  for (const d of desc.bgs)    items.push(buildBgItem(token, d));
  for (const d of desc.labels) items.push(buildLabelItem(token, d));
  for (const d of desc.webms)  items.push(buildWebmItem(token, d));

  if (existingIds.length > 0) {
    try { await OBR.scene.items.deleteItems(existingIds); }
    catch (e) { logErr(`scene.items.deleteItems(token=${token.id}) failed`, e); }
  }
  if (staleLocalIds.length > 0) {
    try { await OBR.scene.local.deleteItems(staleLocalIds); } catch {}
  }
  if (items.length > 0) {
    try { await OBR.scene.items.addItems(items); }
    catch (e) { logErr(`addItems(token=${token.id}) failed`, e); }
  }

  await particles.syncForToken(token.id, desc.effectBuffs, {
    cx: desc.cx, cy: desc.cy,
    tokenW: desc.tokenW, tokenH: desc.tokenH,
    ringRadius: desc.ringRadius,
  });
}

// === Token hit-test (used by capture overlay for manage-transfer) ====
//
// Exported so the capture overlay can query "which token did the user
// release on" in scene coordinates. Uses the same circle-bounds math
// as the tracker ring (getTokenCircleSpec) so hit-test matches the
// visual ring.

export async function findTokenAt(x: number, y: number): Promise<Image | null> {
  try {
    const items = await OBR.scene.items.getItems((it) =>
      (it as any).type === "IMAGE" &&
      (it.layer === "CHARACTER" || it.layer === "MOUNT" || it.layer === "PROP"),
    );
    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
    for (const tok of items) {
      const spec = getTokenCircleSpec(tok as Image, sceneDpi);
      const dx = x - spec.cx;
      const dy = y - spec.cy;
      if (dx * dx + dy * dy <= spec.radius * spec.radius) {
        return tok as Image;
      }
    }
  } catch {}
  return null;
}

/** True if the given item's metadata has ANY key in the status-
 *  tracker plugin namespace. Broader than the original
 *  `OWNER_KEY === string` test — catches items written by older
 *  versions of this module that may have used different key
 *  schemes (e.g. role/buff-id keys without an owner-key, or stray
 *  partial writes). Used by sweep so a migration from any prior
 *  layout (rectangles, curved bands, attached labels …) cleans
 *  fully on first run. */
function hasPluginMetadata(item: Item): boolean {
  const m = item.metadata;
  if (!m || typeof m !== "object") return false;
  const prefix = `${PLUGIN_ID}/`;
  for (const k of Object.keys(m)) {
    // These keys live on real tokens. They are state, not rendered
    // status items, so sweep must never delete the owning character.
    if (k === STATUS_BUFFS_KEY || k === STATUS_BUFF_ROUNDS_KEY || k === STATUS_RESOURCES_KEY) continue;
    if (k.startsWith(prefix)) return true;
  }
  return false;
}

/** Wipe EVERY item this module has ever created, anywhere in the
 * scene. Touches BOTH scene.items (bubble bg + text — shared across
 * clients, or hidden-token bubbles routed to scene.local) and
 * scene.local (particles + hidden-token bubbles). Particle module's
 * in-memory state is also reset so its tick loop forgets stale
 * particle IDs.
 *
 * 2026-05-05: broadened the filter from `OWNER_KEY===string` to
 * "any plugin-namespaced metadata key" to catch leftover items
 * from the legacy EN rectangle-based renderer (init commit; same
 * PLUGIN_ID, same OWNER_KEY scheme — but a defensive belt-and-
 * braces filter is safer when migrating across major refactors).
 * The user reported seeing a "far-away right-angle rectangle"
 * alongside the new curved band; that's exactly what the legacy
 * `buildShape().shapeType("RECTANGLE")` items rendered as. */
export async function sweepAllOurItems(): Promise<void> {
  try {
    const ours = await OBR.scene.items.getItems(hasPluginMetadata);
    if (ours.length > 0) {
      await OBR.scene.items.deleteItems(ours.map((it) => it.id));
    }
  } catch (e) {
    logErr("sweepAllOurItems(scene.items) failed", e);
  }
  try {
    const localOurs = await OBR.scene.local.getItems(hasPluginMetadata);
    if (localOurs.length > 0) {
      await OBR.scene.local.deleteItems(localOurs.map((it) => it.id));
    }
  } catch (e) {
    logErr("sweepAllOurItems(scene.local) failed", e);
  }
  // Reset particles module's internal Map + stop its rAF tick.
  await particles.clearAll();
}

/** Read buff-id list from token metadata. */
export function readTokenBuffIds(token: Item): string[] {
  const v = token.metadata?.[STATUS_BUFFS_KEY];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}

export function readTokenBuffRounds(token: Item): Record<string, number> {
  const v = token.metadata?.[STATUS_BUFF_ROUNDS_KEY];
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out[id] = Math.floor(n);
  }
  return out;
}

/** Write buff-id list to a token's metadata. */
export async function writeTokenBuffIds(tokenId: string, ids: string[]): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        d.metadata[STATUS_BUFFS_KEY] = ids;
      }
    });
  } catch (e) {
    logErr(`writeTokenBuffIds(${tokenId}) failed`, e);
  }
}
