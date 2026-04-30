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

// --- Per-token rendering state -----------------------------------------
//
// Each token may have up to 6 attached local items:
//   bgId / fillId / textId   — HP bar (3 items)
//   acBgId / acTextId        — AC stat bubble (2 items)
//   tempBgId / tempTextId    — Temp HP stat bubble (2 items)
interface BubbleEntry {
  ids: string[];     // every local item id we own for this token
  hash: string;      // matches dataHash(data)
  geomKey: string;   // matches the layout signature (position + width)
}
const entries = new Map<string, BubbleEntry>();

let role: "GM" | "PLAYER" = "PLAYER";
let unsubs: Array<() => void> = [];
let inSync = false;
let queuedSync = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    syncBubbles().catch((e) => console.warn("[obr-suite/bubbles] sync failed", e));
  }, 60);
}

// --- Layout computation ------------------------------------------------

interface BarLayout {
  /** anchor at the token's bottom-center in scene coords */
  origin: Vector2;
  /** bar's TOP-LEFT in scene coords */
  barOrigin: Vector2;
  /** bar width in scene units */
  barWidth: number;
  /** AC stat bubble CENTER (Shape CIRCLE position semantics) — null if no AC */
  acCenter: Vector2 | null;
  /** Temp HP stat bubble CENTER — null if tempHp == 0 */
  tempCenter: Vector2 | null;
}

function computeLayout(image: Image, sceneDpi: number, data: BubbleData): BarLayout {
  const center = getImageCenter(image, sceneDpi);
  const size = getRenderedSize(image, sceneDpi);
  const origin: Vector2 = { x: center.x, y: center.y + size.height / 2 };

  const barWidth = Math.max(40, size.width - BAR_PADDING * 2);
  const barOrigin: Vector2 = {
    x: origin.x - barWidth / 2,
    y: origin.y - BAR_HEIGHT - 2,
  };

  // Stat bubbles sit right-aligned ABOVE the bar's top edge, with the
  // rightmost bubble nestled at the token's right edge.
  const showHp = data.maxHp > 0;
  const bubbleBottomY = barOrigin.y - 4; // 4 px gap above the bar
  const bubbleCenterY = bubbleBottomY - DIAMETER / 2;

  let acCenter: Vector2 | null = null;
  let tempCenter: Vector2 | null = null;

  let nextRightEdge = origin.x + size.width / 2 - 2;
  if (data.ac != null) {
    acCenter = { x: nextRightEdge - DIAMETER / 2, y: bubbleCenterY };
    nextRightEdge -= DIAMETER + 8;
  }
  if (data.tempHp > 0 && showHp) {
    tempCenter = { x: nextRightEdge - DIAMETER / 2, y: bubbleCenterY };
  }

  void showHp;
  return { origin, barOrigin, barWidth, acCenter, tempCenter };
}

function geometryKey(L: BarLayout, has: { hp: boolean; ac: boolean; temp: boolean }): string {
  const parts = [
    `hp:${has.hp ? `${L.barOrigin.x.toFixed(2)},${L.barOrigin.y.toFixed(2)},${L.barWidth.toFixed(2)}` : "_"}`,
    `ac:${has.ac && L.acCenter ? `${L.acCenter.x.toFixed(2)},${L.acCenter.y.toFixed(2)}` : "_"}`,
    `tp:${has.temp && L.tempCenter ? `${L.tempCenter.x.toFixed(2)},${L.tempCenter.y.toFixed(2)}` : "_"}`,
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
    .points(roundedRectanglePoints(L.barWidth, BAR_HEIGHT, BAR_CORNER_RADIUS))
    .position(L.barOrigin)
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(10000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata({ [BUBBLE_OWNER_KEY]: ctx.token.id })
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
    .points(roundedRectanglePoints(L.barWidth, BAR_HEIGHT, BAR_CORNER_RADIUS, ratio))
    .position(L.barOrigin)
    .layer("ATTACHMENT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(20000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata({ [BUBBLE_OWNER_KEY]: ctx.token.id })
    .build();
}

function buildBarText(ctx: BuildContext, L: BarLayout, data: BubbleData): any {
  const text = `${data.hp}/${data.maxHp}${data.tempHp > 0 ? ` +${data.tempHp}` : ""}`;
  return buildText()
    .plainText(text)
    .textType("PLAIN")
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fontFamily(FONT_FAMILY)
    .fontSize(BAR_FONT_SIZE)
    .fontWeight(700)
    .fillColor("#ffffff")
    .fillOpacity(1)
    .strokeColor("#000000")
    .strokeOpacity(0.7)
    .strokeWidth(1.5)
    .lineHeight(0.95)
    .width(L.barWidth)
    .height(BAR_HEIGHT)
    .position({ x: L.barOrigin.x, y: L.barOrigin.y + TEXT_VERTICAL_OFFSET })
    .layer("TEXT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(30000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata({ [BUBBLE_OWNER_KEY]: ctx.token.id })
    .build();
}

function buildStatBubbleBg(ctx: BuildContext, center: Vector2, color: string): any {
  // Shape CIRCLE position is the bubble's CENTER (verified empirically
  // against the upstream's positioning math).
  return buildShape()
    .shapeType("CIRCLE")
    .width(DIAMETER)
    .height(DIAMETER)
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
    .metadata({ [BUBBLE_OWNER_KEY]: ctx.token.id })
    .build();
}

function buildStatBubbleText(ctx: BuildContext, center: Vector2, value: number): any {
  const text = value.toString();
  const fontSize = text.length >= 3 ? BUBBLE_FONT_SIZE_TIGHT : BUBBLE_FONT_SIZE;
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
    .strokeWidth(1.5)
    .lineHeight(0.95)
    .width(DIAMETER)
    .height(DIAMETER)
    .position({
      x: center.x - DIAMETER / 2,
      y: center.y - DIAMETER / 2 + TEXT_VERTICAL_OFFSET,
    })
    .layer("TEXT")
    .attachedTo(ctx.token.id)
    .locked(true)
    .disableHit(true)
    .visible(ctx.visible)
    .disableAutoZIndex(true)
    .zIndex(25000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata({ [BUBBLE_OWNER_KEY]: ctx.token.id })
    .build();
}

// --- Sync --------------------------------------------------------------

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

    interface Wanted {
      tok: Image;
      data: BubbleData;
      layout: BarLayout;
      hash: string;
      geomKey: string;
      statsVisible: boolean;
    }
    const wanted = new Map<string, Wanted>();
    for (const it of allItems) {
      // Match upstream — Character / Mount / Prop layers all show bubbles.
      if (it.layer !== "CHARACTER" && it.layer !== "MOUNT" && it.layer !== "PROP") continue;
      if (!isImage(it)) continue;
      const d = readBubbleData(it);
      if (!d) continue;
      const statsVisible = !d.hide;
      if (d.hide && role !== "GM") continue;
      const layout = computeLayout(it, sceneDpi, d);
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

    for (const [tokId, w] of wanted) {
      const existing = entries.get(tokId);
      if (existing && existing.hash === w.hash && existing.geomKey === w.geomKey) continue;
      if (existing) rebuildIds.push(...existing.ids);

      const ctx: BuildContext = { token: w.tok, visible: w.tok.visible };
      const newIds: string[] = [];

      // HP bar
      if (w.data.maxHp > 0) {
        const ratio = Math.max(0, Math.min(1, w.data.hp / w.data.maxHp));
        const bg = buildBarBg(ctx, w.layout, w.statsVisible);
        const fill = buildBarFill(ctx, w.layout, ratio);
        const text = buildBarText(ctx, w.layout, w.data);
        toAdd.push(bg, fill, text);
        newIds.push(bg.id, fill.id, text.id);
      }
      // AC bubble
      if (w.layout.acCenter && w.data.ac != null) {
        const acBg = buildStatBubbleBg(ctx, w.layout.acCenter, AC_COLOR);
        const acText = buildStatBubbleText(ctx, w.layout.acCenter, w.data.ac);
        toAdd.push(acBg, acText);
        newIds.push(acBg.id, acText.id);
      }
      // Temp HP bubble
      if (w.layout.tempCenter && w.data.tempHp > 0) {
        const tempBg = buildStatBubbleBg(ctx, w.layout.tempCenter, TEMP_HP_COLOR);
        const tempText = buildStatBubbleText(ctx, w.layout.tempCenter, w.data.tempHp);
        toAdd.push(tempBg, tempText);
        newIds.push(tempBg.id, tempText.id);
      }

      entries.set(tokId, { ids: newIds, hash: w.hash, geomKey: w.geomKey });
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

    if (toAdd.length || rebuildIds.length || orphans.length) {
      const sample = [...wanted.values()][0];
      console.log(
        "%c[obr-suite/bubbles] sync",
        "background:#5dade2;color:#fff;padding:1px 5px;border-radius:3px",
        {
          tokens: wanted.size,
          itemsAdded: toAdd.length,
          itemsRebuilt: rebuildIds.length,
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

  unsubs.push(OBR.scene.items.onChange(() => scheduleSync()));

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
