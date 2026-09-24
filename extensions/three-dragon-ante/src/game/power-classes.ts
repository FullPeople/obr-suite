/**
 * The rule *semantics* of an ability, as opposed to the card family that owns
 * it. Families alone are a poor key for presentation: `green` and `copper` are
 * different colours but different kinds of power, while `black` and `thief` are
 * different families that both take gold out of the stakes. Grouping the 40
 * families by what the ability actually does lets each kind of effect get one
 * deliberate treatment instead of forty ad-hoc ones.
 *
 * This is a presentation lookup only. It has no rule authority, never receives
 * a private card, and never changes what is legal.
 */
export type AbilityClass =
  | "steal-stakes" | "forced-payment" | "neighbour-demand" | "comparison-payment"
  | "steal-hand" | "draw" | "discard-draw" | "hand-replace" | "deck-replace"
  | "take-ante" | "remove-dragon" | "swap-flight" | "copy-power" | "score-modifier"
  | "field-rule" | "scry-deck" | "static-ban" | "extra-round";

const ABILITY_CLASS: Readonly<Record<string, AbilityClass>> = {
  // take gold straight out of the stakes
  black: "steal-stakes", thief: "steal-stakes", "black-raider": "steal-stakes",
  // make opponents pay you or the stakes
  blue: "forced-payment", "blue-overlord": "forced-payment",
  // demand a card or gold from a neighbour
  brass: "neighbour-demand", "brass-sultan": "neighbour-demand",
  green: "neighbour-demand", "green-schemer": "neighbour-demand",
  // weaker or stronger opponents pay automatically
  white: "comparison-payment", "white-hunter": "comparison-payment", queen: "comparison-payment",
  // take a card out of a hand
  red: "steal-hand", "red-destroyer": "steal-hand",
  // draw more cards
  gold: "draw", "gold-monarch": "draw", silver: "draw", fool: "draw",
  // look at the top of the deck
  "silver-seer": "scry-deck",
  // take a committed ante card
  bronze: "take-ante",
  // an extra round
  "bronze-warlord": "extra-round",
  // replace with the top of the deck
  copper: "deck-replace", "copper-trickster": "deck-replace", sorcerer: "deck-replace",
  // discard from hand, then draw the same number
  kobold: "discard-draw",
  // put a hand card into the flight instead
  "chromatic-wyrmling": "hand-replace", "metallic-wyrmling": "hand-replace",
  // remove a dragon from a flight
  dragonslayer: "remove-dragon",
  // exchange mortals between flights
  illusionist: "swap-flight",
  // copy or repeat another ability
  princess: "copy-power", prophet: "copy-power",
  // change how the round scores
  dracolich: "score-modifier", dragonrider: "score-modifier",
  // permanently rewrite a rule while on the table
  archmage: "field-rule", druid: "field-rule", priest: "field-rule",
  "merchant-prince": "field-rule", wyrmpriest: "field-rule",
  // static restrictions on who may win
  bahamut: "static-ban", tiamat: "static-ban",
};

export function abilityClass(family: string | undefined): AbilityClass {
  return (family && ABILITY_CLASS[family]) || "field-rule";
}

export type ClassGlyph = "chevron" | "card-fan" | "chain" | "coin-ring" | "crown-ring";
export type ClassAnchor = "stakes" | "hole" | "deck" | "discard" | "self";

export interface ClassEffect {
  /** Silhouette drawn on the felt for this kind of power. */
  glyph: ClassGlyph;
  /** What the one-shot sends across the table, if anything. */
  flight: "coin" | "card" | "none";
  /** Where that element comes from. */
  from: ClassAnchor;
  /** Formation radius multiplier, so a table-wide rule looks table-wide. */
  ring: number;
  /** Whether the formation lingers as a field rather than a flash. */
  field: boolean;
}

const EFFECTS: Readonly<Record<AbilityClass, ClassEffect>> = {
  "steal-stakes": { glyph: "chevron", flight: "coin", from: "stakes", ring: 1, field: false },
  "forced-payment": { glyph: "chain", flight: "coin", from: "self", ring: 1.15, field: false },
  "neighbour-demand": { glyph: "chain", flight: "card", from: "self", ring: 1.05, field: false },
  "comparison-payment": { glyph: "chevron", flight: "coin", from: "self", ring: 1.2, field: false },
  "steal-hand": { glyph: "chevron", flight: "card", from: "self", ring: .95, field: false },
  draw: { glyph: "card-fan", flight: "card", from: "deck", ring: 1, field: false },
  "discard-draw": { glyph: "card-fan", flight: "card", from: "discard", ring: 1.1, field: false },
  "hand-replace": { glyph: "card-fan", flight: "card", from: "self", ring: 1, field: false },
  "deck-replace": { glyph: "card-fan", flight: "card", from: "deck", ring: .95, field: false },
  "take-ante": { glyph: "coin-ring", flight: "card", from: "stakes", ring: 1, field: false },
  "remove-dragon": { glyph: "chevron", flight: "card", from: "discard", ring: 1.25, field: false },
  "swap-flight": { glyph: "chain", flight: "card", from: "self", ring: 1.15, field: false },
  "copy-power": { glyph: "crown-ring", flight: "none", from: "self", ring: 1.35, field: false },
  "score-modifier": { glyph: "crown-ring", flight: "none", from: "self", ring: 1.4, field: false },
  "field-rule": { glyph: "coin-ring", flight: "none", from: "self", ring: 1.6, field: true },
  "scry-deck": { glyph: "coin-ring", flight: "none", from: "deck", ring: .8, field: false },
  "static-ban": { glyph: "crown-ring", flight: "none", from: "self", ring: 1.5, field: true },
  "extra-round": { glyph: "crown-ring", flight: "none", from: "self", ring: 1.3, field: true },
};

export function classEffect(kind: AbilityClass): ClassEffect {
  return EFFECTS[kind];
}
