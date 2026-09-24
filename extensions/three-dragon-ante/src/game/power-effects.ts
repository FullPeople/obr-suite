export type PowerEffectShape = "ember" | "tide" | "grove" | "arcane" | "crown";
export type PowerSound = "power-ember" | "power-tide" | "power-grove" | "power-arcane" | "power-crown";

export interface PowerEffectTheme {
  key: string;
  shape: PowerEffectShape;
  sound: PowerSound;
  formationColor: string;
  smokeColor: string;
  pulseColor: string;
  rotation: number;
  smokeOpacity: number;
}

const THEMES: Readonly<Record<string, PowerEffectTheme>> = {
  ember: { key: "ember", shape: "ember", sound: "power-ember", formationColor: "#ff9278", smokeColor: "#d69280", pulseColor: "#ffb08d", rotation: 1.15, smokeOpacity: .31 },
  tide: { key: "tide", shape: "tide", sound: "power-tide", formationColor: "#8cc7e8", smokeColor: "#9bbbc9", pulseColor: "#b9e1f4", rotation: .72, smokeOpacity: .24 },
  grove: { key: "grove", shape: "grove", sound: "power-grove", formationColor: "#a8d18e", smokeColor: "#9ab996", pulseColor: "#c6e4a4", rotation: .58, smokeOpacity: .26 },
  arcane: { key: "arcane", shape: "arcane", sound: "power-arcane", formationColor: "#d8b5ff", smokeColor: "#c3b1ba", pulseColor: "#ead8ff", rotation: .88, smokeOpacity: .28 },
  crown: { key: "crown", shape: "crown", sound: "power-crown", formationColor: "#f4ce78", smokeColor: "#c9ae78", pulseColor: "#ffe2a2", rotation: .46, smokeOpacity: .27 },
};

const FAMILY_THEME: Readonly<Record<string, keyof typeof THEMES>> = {
  black: "ember", red: "ember", thief: "ember", "red-destroyer": "ember", dracolich: "ember",
  blue: "tide", silver: "tide", white: "tide", "blue-overlord": "tide", "silver-seer": "tide", "white-hunter": "tide",
  green: "grove", copper: "grove", bronze: "grove", druid: "grove", "copper-trickster": "grove", "green-schemer": "grove", "bronze-warlord": "grove",
  prophet: "arcane", sorcerer: "arcane", illusionist: "arcane", archmage: "arcane", kobold: "arcane", "chromatic-wyrmling": "arcane",
  gold: "crown", brass: "crown", bahamut: "crown", "gold-monarch": "crown", "brass-sultan": "crown", "metallic-wyrmling": "crown", priest: "crown", princess: "crown", queen: "crown", "merchant-prince": "crown", "dragonrider": "crown", dragonslayer: "crown", wyrmpriest: "crown",
};

/**
 * Map a public ability family to a restrained visual language. This is a
 * presentation lookup only: it has no rule meaning and never receives a
 * hidden card, task or choice payload.
 */
export function powerEffectTheme(family: string | undefined): PowerEffectTheme {
  const key = family && family in THEMES ? family as keyof typeof THEMES : family ? FAMILY_THEME[family] : undefined;
  return THEMES[key ?? "arcane"];
}
