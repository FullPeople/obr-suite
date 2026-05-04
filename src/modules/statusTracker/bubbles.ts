// Status-tracker on-token buff visualisation.
//
// Each token gets a ring of small Text+Shape items hovering above
// its top edge. Buffs are placed clockwise starting from straight
// up, then alternating left/right by chunks of ~15° per buff. If
// the inner ring would exceed ARC_SPAN_DEG (120°), spillover goes
// onto a wider outer ring.

import OBR, {
  buildShape,
  buildText,
  Image,
  Item,
  Math2,
} from "@owlbear-rodeo/sdk";

import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  BuffDef,
  textColorFor,
} from "./types";

const OWNER_KEY = `${PLUGIN_ID}/buff-owner`;
const ROLE_KEY = `${PLUGIN_ID}/buff-role`;
type Role = "bg" | "label";

// Geometry
const RING_GAP = 28;          // distance from token edge to inner ring centerline
const RING_SPACING = 30;      // distance between adjacent rings
const ARC_SPAN_DEG = 120;     // max arc degrees per ring before spilling out
const STEP_DEG = 22;          // angular step between adjacent buffs in same ring
const LABEL_HEIGHT = 22;
const LABEL_PADDING_X = 9;
const FONT_SIZE = 13;
const FONT_FAMILY = "Roboto, sans-serif";

function meta(tokenId: string, role: Role, buffId: string): Record<string, unknown> {
  return {
    [OWNER_KEY]: tokenId,
    [ROLE_KEY]: role,
    [`${PLUGIN_ID}/buff-id`]: buffId,
  };
}

// Pattern = top, left, right, left, right, ... starts from straight up
// then alternates. We compute (slot index → degree offset from up).
function angleForSlot(slot: number): number {
  if (slot === 0) return 0;
  // Slots 1,3,5,... are LEFT (negative degrees), 2,4,6,... are RIGHT.
  const half = Math.ceil(slot / 2);
  const sign = slot % 2 === 1 ? -1 : 1;
  return sign * STEP_DEG * half;
}

interface Placement {
  ring: number;        // 0 = innermost
  slot: number;        // 0 = top, then alternating left/right per pattern
}

// Distribute N buffs into rings of ARC_SPAN_DEG. Each ring fits as
// many slots as keep |angleForSlot(slot)| ≤ ARC_SPAN_DEG/2.
function placeBuffs(count: number): Placement[] {
  const slotsPerRing: number[] = [];
  const half = ARC_SPAN_DEG / 2;
  const max = (() => {
    // Find max slot index k such that angleForSlot(k) is within half.
    // angleForSlot grows ~STEP_DEG * ceil(k/2). So k_max = floor(2 * half / STEP_DEG).
    return Math.max(1, Math.floor((2 * half) / STEP_DEG));
  })();
  let remaining = count;
  let ring = 0;
  const out: Placement[] = [];
  while (remaining > 0) {
    const fit = Math.min(max + 1, remaining); // +1 for slot 0
    for (let s = 0; s < fit; s++) {
      out.push({ ring, slot: s });
    }
    remaining -= fit;
    ring += 1;
    slotsPerRing.push(fit);
  }
  return out;
}

function getTokenCenter(token: Image): { cx: number; cy: number; halfH: number } {
  // Image dpi/grid handling is similar to bubbles.ts. Use bounds.
  const dpi = token.grid?.dpi ?? 150;
  const w = (token.image?.width ?? dpi) * (token.scale?.x ?? 1) / dpi * dpi;
  const h = (token.image?.height ?? dpi) * (token.scale?.y ?? 1) / dpi * dpi;
  // image.offset within the original artwork; OBR positions tokens
  // at the artwork's pivot. For our purposes the token rect is
  // centered roughly on token.position with half-extents w/2, h/2.
  const cx = token.position.x;
  const cy = token.position.y;
  return { cx, cy, halfH: h / 2 };
}

function buildItemsForToken(
  token: Image,
  buffs: BuffDef[],
): Item[] {
  if (buffs.length === 0) return [];
  const placements = placeBuffs(buffs.length);
  const { cx, cy, halfH } = getTokenCenter(token);
  const tokenId = token.id;
  const items: Item[] = [];
  for (let i = 0; i < buffs.length; i++) {
    const buff = buffs[i];
    const p = placements[i];
    const rdist = halfH + RING_GAP + p.ring * RING_SPACING;
    const ang = angleForSlot(p.slot);
    const rad = (ang - 90) * (Math.PI / 180); // -90 → top of token
    const px = cx + Math.cos(rad) * rdist;
    const py = cy + Math.sin(rad) * rdist;

    const labelW = LABEL_PADDING_X * 2 + buff.name.length * (FONT_SIZE * 0.85);
    const bg = buildShape()
      .shapeType("RECTANGLE")
      .position({ x: px - labelW / 2, y: py - LABEL_HEIGHT / 2 })
      .width(labelW)
      .height(LABEL_HEIGHT)
      .fillColor(buff.color)
      .fillOpacity(0.92)
      .strokeColor("#000000")
      .strokeOpacity(0.55)
      .strokeWidth(1)
      .layer("ATTACHMENT")
      .attachedTo(tokenId)
      .locked(true)
      .disableHit(true)
      .disableAttachmentBehavior(["SCALE", "ROTATION"])
      .metadata(meta(tokenId, "bg", buff.id))
      .build();
    items.push(bg);

    const text = buildText()
      .position({ x: px - labelW / 2, y: py - LABEL_HEIGHT / 2 })
      .width(labelW)
      .height(LABEL_HEIGHT)
      .plainText(buff.name)
      .fontSize(FONT_SIZE)
      .fontFamily(FONT_FAMILY)
      .fontWeight(700)
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .fillColor(textColorFor(buff.color))
      .layer("ATTACHMENT")
      .attachedTo(tokenId)
      .locked(true)
      .disableHit(true)
      .disableAttachmentBehavior(["SCALE", "ROTATION"])
      .metadata(meta(tokenId, "label", buff.id))
      .build();
    items.push(text);
  }
  return items;
}

/** Wipe and rebuild this token's buff bubbles to match the given list. */
export async function syncTokenBuffs(token: Image, buffs: BuffDef[]): Promise<void> {
  try {
    const all = await OBR.scene.items.getItems((it) => {
      return (it.metadata?.[OWNER_KEY] as string) === token.id;
    });
    const ids = all.map((it) => it.id);
    if (ids.length) await OBR.scene.items.deleteItems(ids);
    const next = buildItemsForToken(token, buffs);
    if (next.length) await OBR.scene.items.addItems(next);
  } catch (e) {
    console.warn("[obr-suite/status] syncTokenBuffs failed", e);
  }
}

/** Read buff-id list from token metadata. */
export function readTokenBuffIds(token: Item): string[] {
  const v = token.metadata?.[STATUS_BUFFS_KEY];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
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
    console.warn("[obr-suite/status] writeTokenBuffIds failed", e);
  }
}
