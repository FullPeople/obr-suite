// Shared types/constants for the dice module — kept side-effect-free
// so it can be imported by both the always-loaded background module
// (index.ts) and the popover iframes (panel-page.ts, effect-page.ts)
// without double-running any subscription code.

export type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d100";

export const ALL_TYPES: DiceType[] = [
  "d4", "d6", "d8", "d10", "d12", "d20", "d100",
];

export const DIE_SIDES: Record<DiceType, number> = {
  d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100,
};

// Size factor relative to d20 (the canonical reference). Roughly mirrors
// real-world dice proportions — d4 is the smallest tetrahedron, d20 a
// fat icosahedron, d100 a slightly bigger "boulder" die.
export const DIE_SIZE_FACTOR: Record<DiceType, number> = {
  d4:   0.78,
  d6:   0.85,
  d8:   0.90,
  d10:  0.93,
  d12:  0.96,
  d20:  1.00,
  d100: 1.06,
};

export interface DieResult {
  // Type may be a non-standard "dN" string (e.g. "d600") for custom-side
  // rolls — the receiver maps it to the d100 art via imgTypeFor().
  type: DiceType | string;
  value: number;
  // Marks dice that didn't make it into the kept set (adv/dis losers).
  // The receiver renders them at 0.3 opacity throughout the animation
  // and skips them in the total-rush sequence.
  loser?: boolean;
  // Set when max/min/reset replaced the rolled value with something
  // else (e.g. dice rolled 1, max(d, 3) bumped to 3). Used by the
  // animation to display "3(1)" — new(original).
  originalValue?: number;
  // Index of the die that triggered this one via burst() — i.e. the
  // immediately-preceding die in the burst chain. The first / parent
  // die has no burstParent. Drives the chain animation: parents pop,
  // children fly in afterwards.
  burstParent?: number;
}

export function rollDie(type: DiceType): number {
  return Math.floor(Math.random() * DIE_SIDES[type]) + 1;
}

/** Resolve side count for any "dN" string — including non-standard
 *  sides like d7, d100, d600. Used for clamp / slot-machine cycling
 *  by every receiver / sender so non-standard dice survive intact. */
export function sidesOf(type: string): number {
  if (type in DIE_SIDES) return (DIE_SIDES as Record<string, number>)[type];
  const m = type.match(/^d(\d+)$/i);
  return m ? parseInt(m[1], 10) : 20;
}
