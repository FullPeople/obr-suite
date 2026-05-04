// Local "tracker circles" — one per visible character. Drawn while
// the status tracker is active; deleted when it closes.
//
// Each circle is a Curve (open polygon approximating a circle ring),
// attached to its token so OBR's renderer keeps the circle locked to
// the token's current position automatically. The circle's geometry
// is recomputed on items.onChange so a token resize / scale flip
// updates the ring radius.
//
// Layout:
//   - Local items only (per-client). DM and player both see them while
//     the status tracker iframe is open on their client.
//   - Layer = POST_PROCESS so the ring renders above bubble bars and
//     other ATTACHMENT items.
//   - locked + disableHit so the ring never gets in the user's way
//     (clicks fall through to the token underneath).
//   - disableAttachmentBehavior=[SCALE, ROTATION] so the ring radius
//     stays in scene-coord units regardless of the token's scale —
//     OBR's scale-inheritance would otherwise double-apply the
//     parent's scale on top of our pre-computed radius.

import OBR, { buildShape, Image, Item, isImage } from "@owlbear-rodeo/sdk";
import { PLUGIN_ID } from "./types";

const ROLE_KEY = `${PLUGIN_ID}/circle-role`;
const TOKEN_KEY = `${PLUGIN_ID}/circle-token`;
const ROLE_RING = "tracker-ring";

// Visual config
const RING_COLOR = "#5dade2";
const RING_OPACITY = 0.65;
const RING_FILL_OPACITY = 0.05;
const RING_STROKE_WIDTH_PX = 4;
// Padding around token bounds — radius = max(half-width, half-height) + this.
const RING_PAD = 6;

// Compute the world-coord position + radius for a token's tracker
// circle. OBR Image.position is the artwork's offset anchor.
//
// World size of an image:
//   cellsWide  = image.width  / image.grid.dpi     (how many grid
//                                                   cells of artwork
//                                                   the image spans)
//   worldWidth = cellsWide * sceneDpi * scale.x
//              = image.width / image.grid.dpi * sceneDpi * scale.x
// where sceneDpi is `OBR.scene.grid.getDpi()`.
//
// Caller must pass the current sceneDpi so this function stays sync.
// `getTokenCircleSpec` consumers (syncCircles, capture-page) cache
// the dpi at the start of their batch.
export function getTokenCircleSpec(
  token: Image,
  sceneDpi: number,
): { cx: number; cy: number; radius: number } {
  const imgDpi = token.grid?.dpi ?? sceneDpi;
  const ratio = sceneDpi / Math.max(1, imgDpi);
  const w = (token.image?.width ?? imgDpi) * ratio * (token.scale?.x ?? 1);
  const h = (token.image?.height ?? imgDpi) * ratio * (token.scale?.y ?? 1);
  const cx = token.position.x;
  const cy = token.position.y;
  const radius = Math.max(w, h) / 2 + RING_PAD;
  return { cx, cy, radius };
}

// Build a closed-ring polygon (32 segments) centred on the origin.
// We position the curve at the world centre so the polygon points are
// relative offsets — that lets us bake the radius into the points,
// avoiding scale-attachment surprises with stroke-only circles.
function ringPoints(radius: number, segments = 48): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

function buildCircleItem(token: Image, sceneDpi: number): Item {
  const { cx, cy, radius } = getTokenCircleSpec(token, sceneDpi);
  // Shape CIRCLE attached to the token. attachedTo means OBR's
  // renderer tracks the parent token's POSITION automatically — no
  // need to issue updateItems on every drag tick. Disable SCALE +
  // ROTATION inheritance so a token resize/rotation doesn't
  // double-apply on top of our pre-computed radius.
  return buildShape()
    .shapeType("CIRCLE")
    .position({ x: cx - radius, y: cy - radius })
    .width(radius * 2)
    .height(radius * 2)
    .fillColor(RING_COLOR)
    .fillOpacity(RING_FILL_OPACITY)
    .strokeColor(RING_COLOR)
    .strokeOpacity(RING_OPACITY)
    .strokeWidth(RING_STROKE_WIDTH_PX)
    .layer("POST_PROCESS")
    .locked(true)
    .disableHit(true)
    .visible(true)
    .attachedTo(token.id)
    .disableAttachmentBehavior(["SCALE", "ROTATION"])
    .metadata({
      [ROLE_KEY]: ROLE_RING,
      [TOKEN_KEY]: token.id,
    })
    .build();
}

// Sync local circles to match the current set of visible characters.
// Keeps an internal map of tokenId → circleItemId and only adds /
// removes the diff so per-frame token updates don't reflow the whole
// scene.
const circleByToken = new Map<string, string>(); // tokenId → circleItemId
let lastSpecByToken = new Map<string, string>(); // tokenId → "cx,cy,radius" cache key

function specKey(spec: { cx: number; cy: number; radius: number }): string {
  return `${Math.round(spec.cx)},${Math.round(spec.cy)},${Math.round(spec.radius)}`;
}

export async function syncCircles(): Promise<void> {
  let items: Item[];
  try { items = await OBR.scene.items.getItems(); }
  catch { return; }
  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

  const tokens = items.filter((it): it is Image =>
    isImage(it) &&
    (it.layer === "CHARACTER" || it.layer === "MOUNT" || it.layer === "PROP"),
  );

  // Existing local circles authored by this module.
  let existing: Item[];
  try {
    existing = await OBR.scene.local.getItems((it: any) =>
      (it.metadata?.[ROLE_KEY]) === ROLE_RING,
    );
  } catch {
    existing = [];
  }
  const existingByToken = new Map<string, Item>();
  for (const it of existing) {
    const tokenId = (it.metadata as any)?.[TOKEN_KEY] as string | undefined;
    if (tokenId) existingByToken.set(tokenId, it);
  }

  const wantedTokenIds = new Set(tokens.map((t) => t.id));

  // Delete circles for tokens that no longer exist.
  const orphans: string[] = [];
  for (const [tokenId, item] of existingByToken) {
    if (!wantedTokenIds.has(tokenId)) orphans.push(item.id);
  }
  if (orphans.length > 0) {
    await OBR.scene.local.deleteItems(orphans).catch(() => {});
    for (const [tokenId, item] of existingByToken) {
      if (orphans.includes(item.id)) circleByToken.delete(tokenId);
    }
  }

  // Add / update circles for current tokens.
  const toAdd: Item[] = [];
  const toUpdateIds: string[] = [];
  const toUpdateSpecByCircleId = new Map<string, { cx: number; cy: number; radius: number }>();
  const nextLastSpecs = new Map<string, string>();
  for (const token of tokens) {
    const spec = getTokenCircleSpec(token, sceneDpi);
    const key = specKey(spec);
    nextLastSpecs.set(token.id, key);
    if (existingByToken.has(token.id)) {
      // Already present — update geometry only if it changed.
      const prevKey = lastSpecByToken.get(token.id);
      if (prevKey === key) continue;
      const circle = existingByToken.get(token.id)!;
      toUpdateIds.push(circle.id);
      toUpdateSpecByCircleId.set(circle.id, spec);
    } else {
      const item = buildCircleItem(token, sceneDpi);
      toAdd.push(item);
      circleByToken.set(token.id, item.id);
    }
  }
  lastSpecByToken = nextLastSpecs;

  if (toAdd.length > 0) {
    await OBR.scene.local.addItems(toAdd).catch((e) =>
      console.warn("[status/circles] addItems failed", e),
    );
  }
  if (toUpdateIds.length > 0) {
    await OBR.scene.local.updateItems(toUpdateIds, (drafts) => {
      for (const d of drafts) {
        const spec = toUpdateSpecByCircleId.get((d as any).id);
        if (!spec) continue;
        (d as any).position = { x: spec.cx - spec.radius, y: spec.cy - spec.radius };
        (d as any).width = spec.radius * 2;
        (d as any).height = spec.radius * 2;
      }
    }).catch((e) => console.warn("[status/circles] updateItems failed", e));
  }
}

// Remove every circle this module owns. Called when status tracker
// closes.
export async function clearCircles(): Promise<void> {
  try {
    const existing = await OBR.scene.local.getItems((it: any) =>
      (it.metadata?.[ROLE_KEY]) === ROLE_RING,
    );
    if (existing.length > 0) {
      await OBR.scene.local.deleteItems(existing.map((i) => i.id));
    }
  } catch {}
  circleByToken.clear();
  lastSpecByToken.clear();
}

// Public read: all current token IDs that have a tracker ring. Used
// by the capture-modal page so it can do hit-tests without having to
// re-query OBR.
export function getTrackedTokenIds(): string[] {
  return Array.from(circleByToken.keys());
}
