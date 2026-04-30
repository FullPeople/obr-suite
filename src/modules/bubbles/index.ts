// Bubbles — HP bar overlay for tokens.
//
// Adapted from "Stat Bubbles for D&D" by Seamus Finlayson:
//   https://github.com/SeamusFinlayson/Bubbles-for-Owlbear-Rodeo
// That project and this suite are both released under GNU GPL-3.0.
// Both reach into OBR's `Curve` + `Label` primitives for rendering;
// what is shared with the upstream here is the architectural shape
// (compound items per token, image-grid-aware positioning, the
// metadata-key namespace) and the functional constants required
// for visual parity (bar height, padding, corner radius). The
// implementation below is written fresh and styled to match the
// rest of the obr-suite codebase.
//
// Per the user's current direction this build is HP-only — no AC
// circle, no separate temp-HP pill, no name tag — and exposes a
// single Settings tab with one enabled-toggle. Temp HP is shown
// inline in the bar text as "current/max +N" when present.

import OBR, {
  buildCurve,
  buildLabel,
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
const FONT_SIZE = 22;

// Items have these inheritance behaviors disabled so dragging /
// scaling / locking the parent token doesn't get the bar items
// into a bad state. POSITION inheritance is left intact so the
// bar follows on drag without us re-positioning manually.
const DISABLE_INHERIT: Array<"SCALE" | "ROTATION" | "LOCKED" | "COPY"> = [
  "SCALE",     // we factor the token's scale into bar width manually
  "ROTATION",  // bar must stay upright when token rotates
  "LOCKED",    // we set our own .locked() above so don't inherit
  "COPY",      // a copy of the token shouldn't drag a copy of the bar
];

// --- Data shape ---------------------------------------------------------
interface BubbleData {
  hp: number;
  maxHp: number;
  tempHp: number;
  hide: boolean;
}

function readBubbleData(item: Item): BubbleData | null {
  const m = (item.metadata as any)?.[BUBBLES_META];
  if (!m || typeof m !== "object") return null;
  const hpRaw = Number(m["health"]);
  const maxRaw = Number(m["max health"]);
  const tempRaw = Number(m["temporary health"]);
  if (!Number.isFinite(maxRaw) || maxRaw <= 0) return null;
  return {
    hp: Number.isFinite(hpRaw) ? Math.max(0, Math.min(hpRaw, maxRaw)) : maxRaw,
    maxHp: maxRaw,
    tempHp: Number.isFinite(tempRaw) && tempRaw > 0 ? Math.floor(tempRaw) : 0,
    hide: !!m["hide"],
  };
}

function dataHash(d: BubbleData): string {
  return `${d.hp}|${d.maxHp}|${d.tempHp}|${d.hide ? 1 : 0}`;
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
// `getImageCenter` is the single most important fix versus my earlier
// rounds: an OBR Image's `position` lands at the IMAGE'S OFFSET POINT
// (which is whatever image-pixel was set as the image's anchor —
// usually but NOT always the image center). To get the visible center
// of the rendered token we have to start from the image's literal
// center in image-pixel coords, subtract the offset, scale-switch
// from image dpi to scene dpi, apply the item's scale, rotate, then
// add the item's position. Earlier rounds skipped most of this and
// just used `position.y - image.height/2`, which lands in the wrong
// place whenever the offset isn't at center.

function getImageCenter(image: Image, sceneDpi: number): Vector2 {
  // Image-coordinate point at the image's geometric center.
  let p: Vector2 = { x: image.image.width / 2, y: image.image.height / 2 };
  // Translate so the image's offset point becomes the new origin.
  p = Math2.subtract(p, image.grid.offset);
  // Scale-switch from image-pixel space to scene-pixel space.
  p = Math2.multiply(p, sceneDpi / image.grid.dpi);
  // Apply the item's per-axis scale.
  p = { x: p.x * image.scale.x, y: p.y * image.scale.y };
  // Apply the item's rotation around (0, 0).
  p = Math2.rotate(p, { x: 0, y: 0 }, image.rotation);
  // Translate by the item's world position to land in scene coords.
  return Math2.add(p, image.position);
}

function getRenderedSize(image: Image, sceneDpi: number) {
  const dpiRatio = sceneDpi / image.grid.dpi;
  return {
    width: Math.abs(image.image.width * dpiRatio * image.scale.x),
    height: Math.abs(image.image.height * dpiRatio * image.scale.y),
  };
}

// Polygon points for a rounded rectangle anchored at (0, 0) with the
// width / height extending into +x / +y quadrant. `fill` in [0, 1]
// produces a partial rectangle that ends with a rounded right edge —
// used for the HP bar's filled portion. Each corner is approximated
// with `pointsInCorner` segments so the curve looks smooth at scale.
function roundedRectanglePoints(
  width: number,
  height: number,
  radius: number,
  fill = 1,
  pointsInCorner = 10,
): Vector2[] {
  if (radius * 2 > height) radius = height / 2;
  if (radius * 2 > width) radius = width / 2;

  const arc = (
    cx: number,
    cy: number,
    fromAngle: number,
    toAngle: number,
  ): Vector2[] => {
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
      // Top edge — left endpoint after the top-left arc to the start
      // of the top-right arc.
      ...arc(radius, radius, -Math.PI, -Math.PI / 2),                  // TL
      ...arc(width - radius, radius, -Math.PI / 2, 0),                 // TR
      ...arc(width - radius, height - radius, 0, Math.PI / 2),         // BR
      ...arc(radius, height - radius, Math.PI / 2, Math.PI),           // BL
    ];
  }

  // Partial fill: stop the top + bottom edges at the fill width.
  // The right side keeps its rounded cap so the fill looks like a
  // filled-in HP bar rather than a square fragment. Below the
  // minimum width of `radius` we just collapse to nothing.
  const filledWidth = Math.max(0, Math.min(width, fill * width));
  if (filledWidth <= 0) return [];
  if (filledWidth <= radius) {
    // Tiny sliver — render a half-pill so the user still sees a
    // small red blip when HP is critical.
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
interface BubbleEntry {
  bgId: string;
  fillId: string;
  textId: string;
  hash: string;     // matches dataHash(data) for content
  posKey: string;   // matches the geometry key for placement
}
const entries = new Map<string, BubbleEntry>();

function geomKey(c: Vector2, w: number, h: number): string {
  return `${c.x.toFixed(2)}|${c.y.toFixed(2)}|${w.toFixed(2)}|${h.toFixed(2)}`;
}

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

// --- Item builders -----------------------------------------------------

interface BarPlacement {
  origin: Vector2;       // mid-point of the bar's bottom edge
  bgPosition: Vector2;   // top-left of the bg rectangle in world coords
  width: number;         // bar width in scene units
}

function placeBar(image: Image, sceneDpi: number): BarPlacement {
  const center = getImageCenter(image, sceneDpi);
  const size = getRenderedSize(image, sceneDpi);
  // Origin sits at the token's BOTTOM edge, horizontally centered.
  const origin: Vector2 = { x: center.x, y: center.y + size.height / 2 };
  // Bar top-left: shift left half the bar width, then up so the bar
  // sits ABOVE the origin (= just inside the token's bottom edge).
  const width = Math.max(40, size.width - BAR_PADDING * 2);
  return {
    origin,
    bgPosition: {
      x: origin.x - width / 2,
      y: origin.y - BAR_HEIGHT - 2,
    },
    width,
  };
}

function buildBgCurve(token: Item, p: BarPlacement, statsVisible: boolean): any {
  const color = statsVisible ? "#A4A4A4" : "#000000";
  return buildCurve()
    .fillColor(color)
    .fillOpacity(BG_OPACITY)
    .strokeColor("#000000")
    .strokeOpacity(0)
    .strokeWidth(0)
    .tension(0)
    .closed(true)
    .points(roundedRectanglePoints(p.width, BAR_HEIGHT, BAR_CORNER_RADIUS))
    .position(p.bgPosition)
    .layer("ATTACHMENT")
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(token.visible)
    .disableAutoZIndex(true)
    .zIndex(10000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata({ [BUBBLE_OWNER_KEY]: token.id })
    .build();
}

function buildFillCurve(token: Item, p: BarPlacement, ratio: number): any {
  return buildCurve()
    .fillColor("#e74c3c")
    .fillOpacity(FILL_OPACITY)
    .strokeOpacity(0)
    .strokeWidth(0)
    .tension(0)
    .closed(true)
    .points(roundedRectanglePoints(p.width, BAR_HEIGHT, BAR_CORNER_RADIUS, ratio))
    .position(p.bgPosition)
    .layer("ATTACHMENT")
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(token.visible)
    .disableAutoZIndex(true)
    .zIndex(20000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata({ [BUBBLE_OWNER_KEY]: token.id })
    .build();
}

function buildText(token: Item, p: BarPlacement, data: BubbleData): any {
  const text = `${data.hp}/${data.maxHp}${data.tempHp > 0 ? ` +${data.tempHp}` : ""}`;
  return buildLabel()
    .plainText(text)
    .width(p.width)
    .height(BAR_HEIGHT + 2)
    .padding(0)
    .fontSize(FONT_SIZE)
    .fontWeight(700)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fillColor("#ffffff")
    .strokeColor("#000000")
    .strokeOpacity(0.7)
    .strokeWidth(1.5)
    .backgroundColor("#000000")
    .backgroundOpacity(0)               // transparent — color comes from the curves underneath
    .cornerRadius(0)
    .pointerWidth(0)
    .pointerHeight(0)
    .position(p.bgPosition)
    .layer("ATTACHMENT")
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(token.visible)
    .disableAutoZIndex(true)
    .zIndex(30000)
    .disableAttachmentBehavior(DISABLE_INHERIT)
    .metadata({ [BUBBLE_OWNER_KEY]: token.id })
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
      placement: BarPlacement;
      hash: string;
      posKey: string;
      statsVisible: boolean;
    }
    const wanted = new Map<string, Wanted>();
    for (const it of allItems) {
      // Upstream covers Character / Mount / Prop layers; we follow.
      if (it.layer !== "CHARACTER" && it.layer !== "MOUNT" && it.layer !== "PROP") continue;
      if (!isImage(it)) continue;
      const d = readBubbleData(it);
      if (!d) continue;
      // The `hide` flag historically means "don't show stats to
      // players" — GM still sees them with a darkened backdrop.
      const statsVisible = !d.hide;
      if (d.hide && role !== "GM") continue;
      const placement = placeBar(it, sceneDpi);
      wanted.set(it.id, {
        tok: it,
        data: d,
        placement,
        hash: dataHash(d),
        posKey: geomKey(placement.bgPosition, placement.width, BAR_HEIGHT),
        statsVisible,
      });
    }

    // Drop bubbles for tokens that lost data or were removed.
    const orphans: string[] = [];
    for (const [tokId, e] of entries) {
      if (!wanted.has(tokId)) {
        orphans.push(e.bgId, e.fillId, e.textId);
        entries.delete(tokId);
      }
    }
    if (orphans.length) {
      await OBR.scene.local.deleteItems(orphans).catch((err) =>
        console.warn("[obr-suite/bubbles] delete orphans failed", err),
      );
    }

    const toAdd: any[] = [];
    const positionUpdates: Array<{ id: string; pos: Vector2 }> = [];
    const rebuildIds: string[] = [];

    for (const [tokId, w] of wanted) {
      const existing = entries.get(tokId);
      if (existing && existing.hash === w.hash && existing.posKey === w.posKey) continue;

      // Data hash changed → rebuild (fill width, text content,
      // and bg color all depend on the data).
      if (!existing || existing.hash !== w.hash) {
        if (existing) rebuildIds.push(existing.bgId, existing.fillId, existing.textId);
        const ratio = Math.max(0, Math.min(1, w.data.hp / w.data.maxHp));
        const bg = buildBgCurve(w.tok, w.placement, w.statsVisible);
        const fill = buildFillCurve(w.tok, w.placement, ratio);
        const text = buildText(w.tok, w.placement, w.data);
        toAdd.push(bg, fill, text);
        entries.set(tokId, {
          bgId: bg.id,
          fillId: fill.id,
          textId: text.id,
          hash: w.hash,
          posKey: w.posKey,
        });
        continue;
      }

      // Only geometry changed (drag / scale / rotation). Patch
      // positions in-place — much cheaper than rebuild.
      positionUpdates.push({ id: existing.bgId, pos: w.placement.bgPosition });
      positionUpdates.push({ id: existing.fillId, pos: w.placement.bgPosition });
      positionUpdates.push({ id: existing.textId, pos: w.placement.bgPosition });
      existing.posKey = w.posKey;
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
    if (positionUpdates.length) {
      const ids = positionUpdates.map((p) => p.id);
      await OBR.scene.local.updateItems(
        ids,
        (drafts) => {
          for (const d of drafts) {
            const u = positionUpdates.find((p) => p.id === d.id);
            if (u) (d as any).position = u.pos;
          }
        },
        true,
      ).catch((err) =>
        console.warn("[obr-suite/bubbles] position update failed", err),
      );
    }

    if (toAdd.length || rebuildIds.length || orphans.length) {
      const sample = [...wanted.values()][0];
      console.log(
        "%c[obr-suite/bubbles] sync",
        "background:#5dade2;color:#fff;padding:1px 5px;border-radius:3px",
        {
          tokens: wanted.size,
          added: toAdd.length / 3,
          rebuilt: rebuildIds.length / 3,
          orphans: orphans.length / 3,
          sample: sample ? {
            tokenId: sample.tok.id,
            tokenPosition: sample.tok.position,
            bgPosition: sample.placement.bgPosition,
            width: sample.placement.width,
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
  for (const e of entries.values()) ids.push(e.bgId, e.fillId, e.textId);
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
