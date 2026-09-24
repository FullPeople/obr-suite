// §9 (2026-08-21) — DM 固定投骰结果 ("固定下次").
//
// One-shot, per-CLIENT arming (localStorage, same pattern as 全局暗骰):
// the DM types a target total in the dice panel and arms it; the NEXT
// covered roll on this client resolves to that total. Consumed at the
// three single-roll DECISION POINTS:
//   • dice panel performRoll / rollFromCombo (panel-page.ts)
//   • background handleQuickRoll — single-value clicks from cards /
//     bestiary / search (dice/index.ts). Group saves ride the same
//     broadcast channel but always carry a collectiveId → excluded.
//   • single-character initiative 劣势/普通/优势 (useInitiative.ts).
// Group initiative (bestiary group-saves.ts) never consults this
// module at all — checklist §9 explicitly excludes both group paths.
//
// The fixed total is reached by REASSIGNING real die faces inside each
// die's legal range — never by editing a displayed number. Animation
// totals are derived from the face values (effect-page recomputes),
// history and broadcasts carry the same faces, so consistency follows
// by construction. Every consumer re-verifies GM identity with a
// fresh OBR.player.getRole() call at its own execution entry and logs
// an evidence line when a fixed roll is applied.
//
// This file is deliberately side-effect-free (same contract as
// types.ts) so panel iframe, background and initiative panel can all
// import it.

const LS_FIXED_ROLL = "obr-suite/dice/fixed-next";
export const FIXED_ROLL_LS_KEY = LS_FIXED_ROLL;

export interface FixedRollArm {
  value: number;
  armedAt: number;
}

export function readFixedRoll(): FixedRollArm | null {
  try {
    const raw = localStorage.getItem(LS_FIXED_ROLL);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FixedRollArm> | null;
    if (!parsed || !Number.isInteger(parsed.value)) return null;
    return { value: parsed.value as number, armedAt: parsed.armedAt ?? 0 };
  } catch (e) {
    console.warn("[obr-suite/dice] fixed-roll read failed", e);
    return null;
  }
}

export function armFixedRoll(value: number): boolean {
  if (!Number.isInteger(value)) return false;
  try {
    localStorage.setItem(
      LS_FIXED_ROLL,
      JSON.stringify({ value, armedAt: Date.now() } satisfies FixedRollArm),
    );
    return true;
  } catch (e) {
    console.warn("[obr-suite/dice] fixed-roll arm failed", { value, error: e });
    return false;
  }
}

export function disarmFixedRoll(): void {
  try {
    localStorage.removeItem(LS_FIXED_ROLL);
  } catch (e) {
    console.warn("[obr-suite/dice] fixed-roll disarm failed", e);
  }
}

/** One-shot consume: read + remove. Callers verify GM role FIRST. */
export function consumeFixedRoll(): FixedRollArm | null {
  const armed = readFixedRoll();
  if (armed) disarmFixedRoll();
  return armed;
}

// ---- face assignment -------------------------------------------------
//
// A DieSpec describes one physical die's LEGAL final-face range after
// any value wrappers (max/min clamps narrow it, reset* restores 1..s),
// plus whether it subtracts from the total. The assigner distributes a
// target dice-sum across the specs with randomized bumps so the faces
// look like a plausible spread rather than "all max then all min".

export interface DieSpec {
  /** physical sides — faces stay in [1, sides] on the wire */
  sides: number;
  /** legal final-face range (post-wrapper); 1 <= lo <= hi <= sides */
  lo: number;
  hi: number;
  /** true → this die's face SUBTRACTS from the total */
  subtract?: boolean;
}

/** Signed dice-sum bounds reachable by the given specs. */
export function faceBounds(specs: DieSpec[]): { low: number; high: number } {
  let low = 0;
  let high = 0;
  for (const s of specs) {
    low += s.subtract ? -s.hi : s.lo;
    high += s.subtract ? -s.lo : s.hi;
  }
  return { low, high };
}

/**
 * Distribute `target` (the signed sum the dice must contribute, i.e.
 * fixed total minus flat modifiers) across the specs. Returns one
 * legal FACE per spec (positive numbers — the subtract flag on the
 * spec already encodes the sign), or null when the target is not an
 * integer inside [low, high].
 */
export function distributeFaces(specs: DieSpec[], target: number): number[] | null {
  if (!Number.isInteger(target)) return null;
  const { low, high } = faceBounds(specs);
  if (target < low || target > high) return null;

  // Start every die at its signed LOW end, then spend the deficit in
  // random-sized bumps on random dice. Each bump is >= 1 so the loop
  // terminates in at most sum(hi-lo) iterations; the greedy sweep
  // after it is a belt-and-braces guarantee, not a real path.
  const contrib = specs.map((s) => (s.subtract ? -s.hi : s.lo));
  const room = specs.map((s) => s.hi - s.lo);
  let deficit = target - low;
  while (deficit > 0) {
    const cands: number[] = [];
    for (let i = 0; i < specs.length; i++) if (room[i] > 0) cands.push(i);
    if (!cands.length) break;
    const i = cands[Math.floor(Math.random() * cands.length)];
    const step = 1 + Math.floor(Math.random() * Math.min(deficit, room[i]));
    contrib[i] += step;
    room[i] -= step;
    deficit -= step;
  }
  if (deficit > 0) {
    for (let i = 0; i < specs.length && deficit > 0; i++) {
      const t = Math.min(deficit, room[i]);
      contrib[i] += t;
      room[i] -= t;
      deficit -= t;
    }
    if (deficit > 0) return null;
  }
  return specs.map((s, i) => (s.subtract ? -contrib[i] : contrib[i]));
}

/** Random integer in [lo, hi] (inclusive); assumes lo <= hi. */
export function randIntInclusive(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
