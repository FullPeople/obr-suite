export interface Monster {
  name: string;          // Chinese name
  ENG_name: string;      // English name
  source: string;        // Source book (MM, VGM, etc.)
  size: string[];        // S, M, L, H, G
  type: string | { type: string; tags?: string[] };
  ac: (number | { ac: number; from?: string[] })[];
  hp: { average: number; formula?: string };
  speed: Record<string, number>;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  cr: string;
  hasToken?: boolean;
  hasFluffImages?: boolean;
}

// "2014" = strictly PHB+MM, "2024" = strictly XPHB+XMM, "other" = every
// other source (TCE/XGE/MTF/MPMM/BGG/FTD/etc.) — `other` is ALWAYS shown
// regardless of the 2014/2024 toggle state.
export type MonsterEdition = "2014" | "2024" | "other";

export interface ParsedMonster {
  name: string;
  engName: string;
  source: string;
  ac: number;
  hp: number;
  dexMod: number;
  cr: string;
  size: string;
  type: string;
  tokenUrl: string;
  edition: MonsterEdition;
}
