export interface Monster {
  _copy?: {name?:string;ENG_name?:string;source?:string;_mod?:Record<string,unknown>};
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
  cr: string | number | { cr?: string | number; lair?: string | number; coven?: string | number; special?: string };
  hasToken?: boolean;
  hasFluffImages?: boolean;
}

// "2014" = strictly PHB+MM, "2024" = strictly XPHB+XMM, "other" = every
// other source (TCE/XGE/MTF/MPMM/BGG/FTD/etc.) — `other` is ALWAYS shown
// regardless of the 2014/2024 toggle state.
export type MonsterEdition = "2014" | "2024" | "other";

export interface ParsedMonster {
  /** Display-only provenance; binding still uses source + engName. */
  contentLanguage?: "zh" | "en" | "auto";
  authored?: boolean;
  aliases?: string[];
  sizeCode?: string;
  name: string;
  engName: string;
  source: string;
  ac: number;
  hp: number;
  dexMod: number;
  /** The stat block's own 先攻 bonus. Usually the DEX modifier, but 2024-era
   *  records print their own (`initiative` / `initiative.proficiency`), so the
   *  initiative tracker must use this rather than `dexMod`. */
  initiative: number;
  cr: string;
  size: string;
  type: string;
  tokenUrl: string;
  edition: MonsterEdition;
}
