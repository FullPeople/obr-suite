/** Monster initiative — 先攻.
 *
 *  5etools records usually leave a monster's initiative to follow from DEX, but
 *  the 2024-era ones print their own on the stat block:
 *
 *    "initiative": 0                        → a flat bonus, DEX ignored
 *    "initiative": { proficiency: 1 }       → DEX modifier + 1 × PB(for its CR)
 *    "initiative": { advantageMode: "ADV" } → DEX modifier (the roll is made
 *                                             with advantage; the bonus is not
 *                                             affected)
 *
 *  Reading only the DEX modifier understated every monster of the first two
 *  kinds — an XMM cultist with DEX 19 at CR 8 rolls +4 instead of its printed
 *  +7. Kept dependency-free so the rule can be tested on its own.
 */

/** CR → proficiency bonus as a stat block uses it: CR 0–4 → +2, then +1 per
 *  four CR. Returns null when the record has no usable challenge rating. */
export function crToProficiencyBonus(cr: unknown): number | null {
  const value = crToNumber(cr);
  if (value === null || value < 0) return null;
  return value < 5 ? 2 : Math.ceil(value / 4) + 1;
}

/** 5etools stores CR as a string ("8", "1/2"), a number, or — for lair
 *  monsters — an object carrying `cr` beside the lair XP. */
export function crToNumber(cr: unknown): number | null {
  const raw = cr && typeof cr === "object" && !Array.isArray(cr) ? (cr as { cr?: unknown }).cr : cr;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const parts = raw.trim().split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  const whole = Number(parts[0]);
  if (!Number.isFinite(whole)) return null;
  if (parts.length === 1) return whole;
  const divisor = Number(parts[1]);
  return Number.isFinite(divisor) && divisor !== 0 ? whole / divisor : null;
}

/** Ability score → modifier. A missing or unparsable score counts as 10, which
 *  is what the previous `(m.dex || 10) - 10` intent was; a score of 0 must give
 *  −5 rather than being mistaken for "absent". */
export function abilityModifier(score: unknown): number {
  const value = typeof score === "number" ? score : typeof score === "string" && score.trim() !== "" ? Number(score) : NaN;
  return Math.floor(((Number.isFinite(value) ? value : 10) - 10) / 2);
}

/** The bonus the initiative tracker must use for this monster record. */
export function monsterInitiativeBonus(monster: any): number {
  const modifier = abilityModifier(monster?.dex);
  const explicit = monster?.initiative;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) return modifier;
  const flat = (explicit as { initiative?: unknown }).initiative;
  if (typeof flat === "number" && Number.isFinite(flat)) return flat;
  const count = Number((explicit as { proficiency?: unknown }).proficiency);
  const proficiency = crToProficiencyBonus(monster?.cr);
  return Number.isFinite(count) && count > 0 && proficiency !== null ? modifier + count * proficiency : modifier;
}
