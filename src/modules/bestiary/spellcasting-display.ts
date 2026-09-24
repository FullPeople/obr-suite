// 5etools `spellcasting[].displayAs` classification (checklist §5).
//
// MPMM-era stat blocks route innate-casting entries into the Actions /
// Bonus Actions / Reactions sections via `displayAs`. This module is the
// single classifier shared by the monster-info popover and the global
// search preview. Monster Studio (tools/monster-studio/statblock.js) is
// a standalone browser module OUTSIDE the vite/tsc build and cannot
// import this file — it carries a mirrored plain-JS copy; keep the two
// in sync when the rules change.
//
// Side-effect-free by design (no OBR import) so any page can pull it in.

export type SpellcastingDisplay = "default" | "action" | "bonus" | "reaction";

// Chain A re-renders on every bubble/HP tick and language flip — an
// unknown displayAs would warn once per render. One warning per
// monster+entry+value is evidence enough; the rest is spam.
const warned = new Set<string>();

/** Classify one spellcasting entry.
 *
 *  - "" / absent and "trait" → "default" silently — "trait" is
 *    5etools' explicit name for the default (Spellcasting) section, so
 *    it is legitimate data, not an anomaly.
 *  - "action" / "bonus" / "reaction" → routed as-is.
 *  - anything else (the 5etools schema also allows "legendary" /
 *    "mythic", which we don't render as separate spell targets) → warn
 *    with monster identity + raw value, fall back to "default" so the
 *    entry stays visible under 施法.
 */
export function classifySpellcastingDisplay(
  entry: any,
  ident: string,
  logPrefix: string,
): SpellcastingDisplay {
  const raw = String(entry?.displayAs ?? "").trim().toLowerCase();
  if (raw === "" || raw === "trait") return "default";
  if (raw === "action" || raw === "bonus" || raw === "reaction") return raw;
  const key = `${ident}|${entry?.name ?? ""}|${raw}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`${logPrefix} unknown spellcasting displayAs — falling back to default section`, {
      monster: ident,
      entryName: entry?.name,
      displayAs: entry?.displayAs,
      fallback: "default",
    });
  }
  return "default";
}

/** Bucket a raw 5etools spellcasting array by display target. Always
 *  returns all four buckets (possibly empty). */
export function groupSpellcastingByDisplay(
  arr: any[],
  ident: string,
  logPrefix: string,
): Record<SpellcastingDisplay, any[]> {
  const groups: Record<SpellcastingDisplay, any[]> = {
    default: [],
    action: [],
    bonus: [],
    reaction: [],
  };
  if (!Array.isArray(arr)) return groups;
  for (const entry of arr) {
    groups[classifySpellcastingDisplay(entry, ident, logPrefix)].push(entry);
  }
  return groups;
}
