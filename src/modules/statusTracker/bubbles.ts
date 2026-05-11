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

// === Color helpers: hex ↔ HSL + per-buff gradient deriver ==================
//
// We derive a 2-stop linear gradient from each buff's main hex colour.
// The two stops are the main colour shifted ±L (lightness) by an
// amount seeded from the buff id so the result is deterministic per
// buff but varies between buffs. Hue stays put — main colour identity
// must remain recognisable.

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, l: 50 };
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 0xff) / 255;
  const g = ((v >> 8) & 0xff) / 255;
  const b = (v & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d) + (g < b ? 6 : 0);
    else if (max === g) h = ((b - r) / d) + 2;
    else                h = ((r - g) / d) + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1)      { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) {        g = c; b = x; }
  else if (hh < 4) {        g = x; b = c; }
  else if (hh < 5) { r = x;        b = c; }
  else             { r = c;        b = x; }
  const m = l - c / 2;
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Stable string hash → 32-bit int. Same string in = same number out. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Derive a 2-stop gradient + angle from the buff's main colour, seeded
 *  by the buff id so a buff always renders with the same gradient. */
function deriveGradient(mainHex: string, seedStr: string): { a: string; b: string; angleDeg: number } {
  const h = hashStr(seedStr);
  const r1 = (h & 0xff) / 0xff;
  const r2 = ((h >> 8) & 0xff) / 0xff;
  const hsl = hexToHsl(mainHex);
  // Shift lightness ±delta. Delta varies 14..28 so each buff has a
  // visibly distinct "punch" without losing the main colour identity.
  const delta = 14 + r1 * 14;
  const a = hslToHex(hsl.h, hsl.s, hsl.l - delta);
  const b = hslToHex(hsl.h, hsl.s, hsl.l + delta);
  // Random gradient direction 0..360°.
  const angleDeg = r2 * 360;
  return { a, b, angleDeg };
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
// Each glyph is its own TEXT item, positioned tangent to the band's
// arc and rotated to match. Splitting per-glyph fixes the
// "fragmented / transparent text" rendering bug we saw with a single
// rotated rectangle covering the whole label — small bbox + low
// rotation magnitude per item works around whatever subpixel /
// caching quirk OBR's text rasteriser was hitting.
interface GlyphDescriptor {
  buffId: string; effect: BuffEffect;
  posX: number; posY: number; rotationDeg: number;
  charBoxW: number; charBoxH: number;
  fontSize: number;
  fg: string;
  glyph: string;
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
//        bg main      = base + 0
//        bg highlight = base + 1
//        glyphs       = base + GLYPH_OFFSET (well above all bg paths)
// STACK_MULT = 1000 leaves room for 999 inner-slot items per token
// before colliding with the next token's stack — generous, given
// the typical max is ~20 (bg main + bg highlight + ~18 glyphs per
// short buff name × few buffs).
const STACK_MULT = 1000;
const SLOT_BG_MAIN = 0;
const SLOT_BG_HIGHLIGHT = 1;
const SLOT_GLYPH = 100;
// WebM effect items sit ABOVE the curved-band glyphs of the same token
// but BELOW any other token whose zIndex is higher. Slot 200 leaves
// room for additional in-stack roles between glyphs and webm if
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
  /** Top-left position in scene coords (so the WebM bbox is centred
   *  on the token). */
  position: { x: number; y: number };
  /** Scale.x = scale.y applied to the 192-intrinsic WebM so it renders
   *  at the token's natural footprint. */
  scale: number;
  /** Intrinsic WebM resolution (assumed square 192×192 — matches the
   *  generator's defaults). Used as ImageContent.width/height. */
  intrinsicSize: number;
  /** zIndex slot — token.zIndex * STACK_MULT + SLOT_WEBM. */
  zIndex: number;
}

interface TokenDescriptors {
  bgs: PillBgDescriptor[];
  glyphs: GlyphDescriptor[];
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
  const tokenH = (token.image?.height ?? imgDpi) * ratio * (token.scale?.y ?? 1);
  const tokenW = (token.image?.width ?? imgDpi) * ratio * (token.scale?.x ?? 1);
  const stackBase = computeStackBase(token);

  if (buffs.length === 0) {
    return { bgs: [], glyphs: [], effectBuffs: [], webms: [], cx, cy, tokenW, tokenH, ringRadius };
  }

  const halfH = tokenH / 2;
  const pillH = Math.max(12, halfH * PILL_HEIGHT_FACTOR * 2);
  const padX = pillH * PILL_PAD_X_FACTOR;
  const fontSize = pillH * FONT_FACTOR;

  // 2026-05-14 — Three-way buff routing:
  //   1. webms        — buff has `webmAsset` → ONE Image-with-video item
  //                     per buff. Best perf path (1 item vs ~20), used
  //                     for paralyzed / stunned / poisoned. Stacks
  //                     multiple WebMs centred on the same token; they
  //                     blend via alpha.
  //   2. effectBuffs  — non-default `effect` AND particles enabled →
  //                     particle system (currently disabled by feature
  //                     flag).
  //   3. defaultBuffs — fallback to the static curved-band + glyph
  //                     pipeline.
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
    if (b.webmAsset) {
      const buffScale = typeof b.webmScale === "number" && b.webmScale > 0 ? b.webmScale : 1.0;
      const footprint = baseFootprint * buffScale;
      const scale = footprint / DEFAULT_WEBM_INTRINSIC_SIZE;
      webms.push({
        buffId: b.id,
        url: assetUrl(b.webmAsset),
        position: { x: cx - footprint / 2, y: cy - footprint / 2 },
        scale,
        intrinsicSize: DEFAULT_WEBM_INTRINSIC_SIZE,
        // SLOT_WEBM (200) is above SLOT_GLYPH (100) so WebMs draw over
        // any sibling curved-band glyphs on the same token.
        zIndex: stackBase + SLOT_WEBM,
      });
      continue;
    }
    const useEffect = STATUS_EFFECTS_ENABLED && (b.effect ?? "default") !== "default";
    if (useEffect) {
      effectBuffs.push(b);
    } else {
      const pillW = Math.max(20, padX * 2 + estimateNameWidth(b.name, fontSize));
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
  const glyphs: GlyphDescriptor[] = [];
  // (stackBase computed at the top of describe() — used by WebMs above
  // and by glyph descriptors below.)

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

    // Pseudo-gradient via 2 stacked paths (OBR Path can't do native
    // gradients; SVG Image data URIs aren't supported by OBR's
    // image-fetcher, hence this approach).
    //
    //   Main band  — full radial range, solid main colour, fully
    //                opaque, with stroke. Always rendered first.
    //   Highlight  — half the radial range (inner OR outer half,
    //                seeded by buff id) at a derived shade with ~55%
    //                alpha so it blends with the main beneath. No
    //                stroke. Rendered second so it lands on top.
    //
    // The blend gives a clear two-tone "shaded" look without leaving
    // any pixel translucent against the scene — the main band is
    // always 100% opaque underneath, satisfying the "气泡不要半透明"
    // request while still varying the colour within the bubble.
    const grad = deriveGradient(buff.color, buff.id);
    // Per user spec: "靠近token的80%是原色，远离token的20%是暗色".
    // Inner 80% of band shows pure main colour, outer 20% (the rim
    // farthest from the token, i.e. the "crust edge") is shaded.
    // For very dark input colours (l < 25), the darker derivation
    // (grad.a) clamps near pure black with no contrast against
    // an already-dark main — switch to grad.b (lighter) instead so
    // black/navy buffs still get a visible rim. Threshold is the
    // lightness in HSL%.
    const HL_SPAN = 0.20;
    const radSpan = rOuter - rInner;
    const hlR1 = rInner + radSpan * (1 - HL_SPAN);  // 80% from inner = outer 20%
    const hlR2 = rOuter;
    const mainHsl = hexToHsl(buff.color);
    const hlColor = mainHsl.l < 25 ? grad.b : grad.a;

    // Path 1 — the main band (always pushed first).
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

    // Path 2 — the highlight overlay (pushed second → higher zIndex).
    // Same angular extent as the main band so the highlight goes
    // edge-to-edge tangentially.
    bgs.push({
      buffId: buff.id, effect: "default",
      cx, cy,
      thetaCenterRad: angRad,
      thetaHalfRad,
      rInner: hlR1, rOuter: hlR2,
      fillColor: hlColor,
      fillOpacity: 0.55,
      stroke: "#000000",
      strokeOpacity: 0,
      borderW: 0,
      zIndex: stackBase + SLOT_BG_HIGHLIGHT,
    });

    // Per-glyph text along the arc.
    //
    // Compute the angular span occupied by the glyph row (excluding
    // the band's padX padding on each side), then divide it by N
    // glyphs so each one gets an even angular slice.
    //
    // Tangent-space text width = pillW - 2·padX = N·fontSize·0.85
    // (matches the pillW formula in the buff filter above). We
    // re-derive it from pillW so changes there propagate.
    const graphemes = splitGraphemes(buff.name);
    const N = graphemes.length;
    if (N === 0) continue;
    const fg = textColorFor(buff.color);
    const textTangentW = Math.max(1, pillW - padX * 2);
    const textAngleHalf = Math.atan((textTangentW / 2) / p.ringRadius);
    const slotAngle = (2 * textAngleHalf) / N;

    for (let j = 0; j < N; j++) {
      const glyph = graphemes[j];
      // Slot j centred at: textStartAng + (j + 0.5) · slotAngle
      const slotAngOff = -textAngleHalf + (j + 0.5) * slotAngle;
      const θ = angRad + slotAngOff;
      const θdeg = θ * (180 / Math.PI);
      // Position the glyph's visual centre at (gcx, gcy) on the arc.
      const gcx = cx + Math.sin(θ) * p.ringRadius;
      const gcy = cy - Math.cos(θ) * p.ringRadius;
      // Bounding box for the single-char Text item. Padded
      // generously (1.6× fontSize wide, 1.6× pillH tall) so the
      // text rasteriser has plenty of room — tight bboxes were
      // causing the fragmented / fully-transparent glyph bug
      // because subpixel jitter at certain rotations clipped the
      // glyph against its own bounding box.
      const charBoxW = fontSize * 1.6;
      const charBoxH = pillH * 1.6;
      // Rotation pivots around top-left, so compute that top-left
      // such that after rotating by θ° the visual centre lands at
      // (gcx, gcy). Same trig as before:
      //   pos = (cx - w/2 cosθ + h/2 sinθ, cy - w/2 sinθ - h/2 cosθ)
      const cT = Math.cos(θ);
      const sT = Math.sin(θ);
      const posX = gcx - (charBoxW / 2) * cT + (charBoxH / 2) * sT;
      const posY = gcy - (charBoxW / 2) * sT - (charBoxH / 2) * cT;
      glyphs.push({
        buffId: buff.id, effect: "default",
        posX, posY,
        rotationDeg: θdeg,
        charBoxW, charBoxH,
        fontSize,
        fg,
        glyph,
        zIndex: stackBase + SLOT_GLYPH,
      });
    }
  }

  // Effect-mode buffs are handed off to particles.syncForToken
  // verbatim. Geom snapshot lets the particle module compute
  // absolute scene-coord positions per tick.
  return { bgs, glyphs, effectBuffs, webms, cx, cy, tokenW, tokenH, ringRadius };
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
  return buildImage(
    { width: d.intrinsicSize, height: d.intrinsicSize, mime: "video/webm", url: d.url },
    // ImageGrid: dpi describes the image's "natural" grid size, offset
    // is the local origin within the image. For our square WebM we
    // treat the centre as origin; OBR's scale handles the rest.
    { dpi: d.intrinsicSize, offset: { x: 0, y: 0 } },
  )
    .position(d.position)
    .scale({ x: d.scale, y: d.scale })
    .layer("ATTACHMENT")
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(true)
    .disableAutoZIndex(true)
    .zIndex(d.zIndex)
    .disableAttachmentBehavior(["SCALE", "ROTATION"])
    .metadata(meta(token.id, "bg", d.buffId, "default"))
    .build();
}

function buildGlyphItem(token: Image, d: GlyphDescriptor): Item {
  // 2026-05-13 — zIndex is now token-z-locked (was hardcoded
  // `Date.now() + 1_000_000_000`). Glyphs sit at stackBase + SLOT_GLYPH
  // so they're above both bg paths of the same token, while still
  // sorting consistently with other tokens' status items per the
  // user spec "保证当前 token 如果在别的 token 的上方，那么该 token
  // 的状态应该也在上方".
  return buildText()
    .textType("PLAIN")            // CRITICAL — see TextBuilder.js line 27
    .plainText(d.glyph)
    .position({ x: d.posX, y: d.posY })
    .rotation(d.rotationDeg)
    .width(d.charBoxW)
    .height(d.charBoxH)
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

  const labels: Item[] = [];
  for (const d of desc.bgs)    labels.push(buildBgItem(token, d));
  for (const d of desc.glyphs) labels.push(buildGlyphItem(token, d));
  for (const d of desc.webms)  labels.push(buildWebmItem(token, d));

  if (existingIds.length > 0) {
    try { await OBR.scene.items.deleteItems(existingIds); }
    catch (e) { logErr(`scene.items.deleteItems(token=${token.id}) failed`, e); }
  }
  if (staleLocalIds.length > 0) {
    try { await OBR.scene.local.deleteItems(staleLocalIds); } catch {}
  }
  if (labels.length > 0) {
    try { await OBR.scene.items.addItems(labels); }
    catch (e) { logErr(`addItems(labels token=${token.id}) failed`, e); }
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
