/** Base-box identities and numeric rules data, independently transcribed from
 * the publisher's card inventory (Legendary Edition rulebook, printed p15).
 * 2026-09-10: the user chose their supplied card pack's three differing values.
 * Keep white-6 as a stable identity for saves; its printed strength is now 7. */
export const COLORS = ["black", "blue", "brass", "bronze", "copper", "gold", "green", "red", "silver", "white"] as const;
export type Color = typeof COLORS[number];
export type Alignment = "good" | "evil" | "mortal";
export interface Card {
  id: string;
  name: string;
  family: string;
  strength: number;
  alignment: Alignment;
  color?: Color;
  category: "standard" | "legendary" | "mortal";
  rulesPage: number;
}
const STANDARD: Record<Color, number[]> = {
  black: [1,2,3,5,6,7,9], blue: [1,2,4,6,7,9,11], brass: [1,2,3,4,5,7,9], bronze: [1,3,6,7,8,9,11],
  copper: [1,3,5,6,7,8,10], gold: [2,4,6,8,9,11,13], green: [1,2,4,5,6,8,10], red: [2,3,5,7,8,10,12],
  silver: [2,3,6,7,8,10,12], white: [1,2,3,4,5,6,8],
};
export const EVIL_COLORS: readonly Color[] = ["black", "blue", "green", "red", "white"];
const pages: Record<Color, number> = {black:16,blue:16,brass:17,bronze:17,copper:18,gold:19,green:20,red:22,silver:22,white:23};
const title = (id:string) => id.split("-").map(part=>part[0].toUpperCase()+part.slice(1)).join(" ");
export const STANDARD_CARDS: readonly Card[] = COLORS.flatMap(color=>STANDARD[color].map(strength=>({id:`${color}-${strength}`,family:color,name:`${title(color)} Dragon`,strength:color==="white"&&strength===6?7:strength,color,alignment:EVIL_COLORS.includes(color)?"evil":"good",category:"standard",rulesPage:pages[color]} as Card)));
const legendary: [string,number,Alignment,Color|undefined,number][] = [
  ["bahamut",13,"good",undefined,16], ["black-raider",8,"evil","black",16], ["blue-overlord",8,"evil","blue",16],
  ["brass-sultan",8,"good","brass",17], ["bronze-warlord",10,"good","bronze",17], ["chromatic-wyrmling",1,"evil",undefined,18],
  ["copper-trickster",9,"good","copper",18], ["dracolich",10,"evil",undefined,18], ["gold-monarch",12,"good","gold",19],
  ["green-schemer",5,"evil","green",20], ["metallic-wyrmling",1,"good",undefined,21], ["red-destroyer",11,"evil","red",22],
  ["silver-seer",11,"good","silver",23], ["tiamat",13,"evil",undefined,23], ["white-hunter",10,"evil","white",23],
];
const mortals: [string,number,number][] = [["archmage",9,16],["dragonrider",6,19],["dragonslayer",8,19],["druid",6,19],["fool",3,19],
  ["illusionist",4,20],["kobold",2,20],["merchant-prince",5,21],["priest",5,21],["princess",4,21],["prophet",10,22],
  ["queen",7,22],["sorcerer",8,23],["thief",7,23],["wyrmpriest",5,24]];
export const SPECIAL_CARDS: readonly Card[] = [
  ...legendary.map(([id,strength,alignment,color,rulesPage])=>({id,family:id,name:title(id),strength,alignment,color,category:"legendary",rulesPage} as Card)),
  ...mortals.map(([id,strength,rulesPage])=>({id,family:id,name:`The ${title(id)}`,strength,alignment:"mortal",category:"mortal",rulesPage} as Card)),
];
export const CARDS: readonly Card[] = [...STANDARD_CARDS,...SPECIAL_CARDS];
export const CARD_BY_ID: Readonly<Record<string,Card>> = Object.freeze(Object.fromEntries(CARDS.map(card=>[card.id,Object.freeze(card)])));
export function card(id:string):Card { const value=CARD_BY_ID[id]; if(!value)throw Error(`Unknown card: ${id}`); return value; }
