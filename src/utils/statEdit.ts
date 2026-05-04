// Shared HP / AC editing helpers used by both cc-info (character card)
// and bestiary monster-info popovers.
//
// Both panels render four editable stat rows (HP / Max HP / Temp HP /
// AC) that read from and write to the token's "Stat Bubbles for D&D"
// metadata key (`com.owlbear-rodeo-bubbles-extension/metadata`). The
// suite's bubbles module already reads from that key to draw the HP
// bar / heater shield above the token, so writing here makes the bar
// update live.
//
// Input format (parseStatInput):
//   "20"      → absolute set
//   "+5"      → current + 5
//   "-3"      → current − 3
//   "15+5"    → 15 + 5 = 20  (calc-style)
//   "15-3"    → 15 − 3 = 12
// Anything else returns null and the caller should leave the value
// unchanged (input box reverts).

import OBR from "@owlbear-rodeo/sdk";

export const BUBBLES_META_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";

export interface BubblesData {
  health?: number;
  "max health"?: number;
  "temporary health"?: number;
  "armor class"?: number;
  hide?: boolean;
  /** Per-token DM lock — see modules/bubbles/index.ts. Default true.
   *  When true, players see a combat-gated silhouette of the bar
   *  (no numbers, no AC). When false, full data visible to all. */
  locked?: boolean;
}

export function parseStatInput(input: string, current: number): number | null {
  const t = String(input ?? "").trim();
  if (!t) return null;
  // Relative: "+5" / "-3"
  let m = t.match(/^([+-])\s*(\d+)$/);
  if (m) return current + (m[1] === "+" ? 1 : -1) * parseInt(m[2], 10);
  // Absolute: "20"
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  // Calc-style: "15+5" / "15-3"
  m = t.match(/^(\d+)\s*([+-])\s*(\d+)$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const sign = m[2] === "+" ? 1 : -1;
    const b = parseInt(m[3], 10);
    return a + sign * b;
  }
  return null;
}

export async function readBubbles(itemId: string): Promise<BubblesData> {
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    const meta = items[0]?.metadata?.[BUBBLES_META_KEY];
    if (meta && typeof meta === "object") return { ...(meta as BubblesData) };
  } catch (e) {
    console.warn("[statEdit] readBubbles failed", e);
  }
  return {};
}

/** Merge-write: existing bubbles fields are preserved, only the keys
 *  in `patch` are overwritten. Cross-field clamp is applied after the
 *  merge so HP never exceeds max HP — covers BOTH "HP edited above
 *  max" (clamp HP down) and "max edited below current HP" (drag HP
 *  down with it). Returns the final committed state so callers can
 *  refresh their UI to reflect the clamped values. */
export async function patchBubbles(
  itemId: string,
  patch: Partial<BubblesData>,
): Promise<BubblesData> {
  let finalState: BubblesData = {};
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        const existing = (d.metadata[BUBBLES_META_KEY] as BubblesData) ?? {};
        const merged: BubblesData = { ...existing, ...patch };
        if (
          typeof merged.health === "number" &&
          typeof merged["max health"] === "number"
        ) {
          merged.health = Math.min(merged.health, merged["max health"]);
        }
        // Re-clamp temp HP to non-negative just in case.
        if (
          typeof merged["temporary health"] === "number" &&
          merged["temporary health"] < 0
        ) {
          merged["temporary health"] = 0;
        }
        d.metadata[BUBBLES_META_KEY] = merged;
        finalState = merged;
      }
    });
  } catch (e) {
    console.warn("[statEdit] patchBubbles failed", e);
  }
  return finalState;
}

/** Clamp values to sensible ranges. Negative HP is allowed because
 *  some house rules track "below zero" damage; max HP and AC must be
 *  non-negative. */
export function clampStat(field: keyof BubblesData, value: number): number {
  if (field === "max health") return Math.max(1, Math.round(value));
  if (field === "armor class") return Math.max(0, Math.round(value));
  if (field === "temporary health") return Math.max(0, Math.round(value));
  // health: floor at -999 just to bound it
  return Math.max(-999, Math.round(value));
}
