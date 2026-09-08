// Format machine enums only. Unknown values and authored prose stay verbatim.
const clean = (value: unknown): string => String(value ?? "").replace(/\{@\w+\s+([^}]+)\}/g, (_, args: string) => args.split("|")[2] || args.split("|")[0]);
export const abilityEn: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const schools: Record<string, string> = { A: "Abjuration", C: "Conjuration", D: "Divination", E: "Enchantment", V: "Evocation", I: "Illusion", N: "Necromancy", T: "Transmutation" };
const sizes: Record<string, string> = { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" };
// Schema codes verified against 5etools-src/js/parser.js DMGTYPE_JSON_TO_FULL;
// O means force, I means poison. Legacy expanded aliases remain accepted.
const damage: Record<string, string> = { A: "acid", B: "bludgeoning", C: "cold", F: "fire", O: "force", I: "poison", Y: "psychic", R: "radiant", FORCE: "force", F_: "force", L: "lightning", N: "necrotic", P: "piercing", POISON: "poison", PSY: "psychic", RAD: "radiant", S: "slashing", T: "thunder" };
const properties: Record<string, string> = { A: "Ammunition", AF: "Ammunition (firearm)", BF: "Burst Fire", F: "Finesse", H: "Heavy", L: "Light", LD: "Loading", R: "Reach", RLD: "Reload", S: "Special", T: "Thrown", "2H": "Two-Handed", V: "Versatile" };
const itemTypes: Record<string, string> = { M: "Melee Weapon", R: "Ranged Weapon", LA: "Light Armor", MA: "Medium Armor", HA: "Heavy Armor", S: "Shield", G: "Adventuring Gear", A: "Ammunition", AF: "Firearm Ammunition", P: "Potion", RD: "Rod", RG: "Ring", SC: "Scroll", ST: "Staff", W: "Wondrous Item", WD: "Wand", T: "Tool", AT: "Artisan's Tools", INS: "Instrument", GS: "Gaming Set", MNT: "Mount", VEH: "Vehicle", SHP: "Ship", AIR: "Airship", SCF: "Spellcasting Focus", FD: "Food and Drink", EXP: "Explosive", TG: "Trade Good", OTH: "Other", GV: "Generic Variant", TB: "Tack and Harness", "$": "Treasure" };
const title = (value: unknown) => clean(value).replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
export function enumEn(group: "school" | "size" | "damage" | "property" | "item", value: unknown): string {
  const tables = { school: schools, size: sizes, damage, property: properties, item: itemTypes };
  const raw = clean(value);
  const code = raw.split("|")[0];
  return tables[group][code] ?? raw;
}
export function quantityEn(amount: unknown, unit: unknown): string {
  const n = amount ?? "";
  const raw = String(unit ?? "").toLowerCase();
  const special: Record<string, string> = { feet: "ft.", foot: "ft.", self: "Self", touch: "Touch", sight: "Sight", unlimited: "Unlimited", special: "Special", bonus: "bonus action", actions: "action", rounds: "round", minutes: "minute", hours: "hour", days: "day", weeks: "week", months: "month", years: "year", miles: "mile" };
  const base = special[raw] ?? clean(unit);
  const plural = new Set(["action", "bonus action", "reaction", "round", "minute", "hour", "day", "week", "month", "year", "mile"]);
  return `${n} ${plural.has(base) && n !== "" && Number(n) !== 1 ? `${base}s` : base}`.trim();
}
export function spellLevelEn(level: unknown): string { return level == null ? "" : Number(level) === 0 ? "Cantrip" : `Level ${level}`; }
export function alignmentEn(value: any): string {
  const codes: Record<string, string> = { L: "Lawful", N: "Neutral", C: "Chaotic", G: "Good", E: "Evil", U: "Unaligned", A: "Any Alignment", NX: "Any Non-Lawful", NY: "Any Non-Good" };
  if (Array.isArray(value)) return value.map(alignmentEn).filter(Boolean).join(" ");
  if (value && typeof value === "object") return value.special ? clean(value.special) : `${alignmentEn(value.alignment)}${value.chance != null ? ` (${value.chance}%)` : ""}`;
  return codes[value] ?? clean(value);
}
export function speedEn(value: any): string {
  if (value == null) return "";
  if (typeof value === "number") return `${value} ft.`;
  if (typeof value === "string") return clean(value);
  return Object.entries(value).flatMap(([mode, raw]: [string, any]) => {
    const n = typeof raw === "object" && raw ? raw.number : raw;
    if (typeof n !== "number") return [];
    return [`${mode === "walk" ? "" : `${title(mode)} `}${n} ft.${raw?.condition ? ` (${clean(raw.condition)})` : ""}${mode === "fly" && value.canHover ? " (hover)" : ""}`];
  }).join(", ");
}
export function timeEn(value: any): string {
  if (!Array.isArray(value)) return clean(value);
  return value.map((time) => typeof time === "object" && time ? `${quantityEn(time.number, time.unit)}${time.condition ? ` (${clean(time.condition)})` : ""}` : clean(time)).join(" or ");
}
export function rangeEn(value: any): string {
  if (!value || typeof value === "string") return clean(value);
  const distance = value.distance;
  const amount = distance ? quantityEn(distance.amount, distance.type) : "";
  if (value.type === "point") return amount;
  return [amount, title(value.type)].filter(Boolean).join(" ");
}
export function durationEn(value: any): string {
  if (!Array.isArray(value)) return clean(value);
  return value.map((duration) => {
    if (typeof duration === "string") return clean(duration);
    if (duration.type === "instant") return "Instantaneous";
    if (duration.type === "special") return "Special";
    if (duration.type === "permanent") {
      const end: Record<string, string> = { dispel: "dispelled", trigger: "triggered", discharge: "discharged" };
      return duration.ends?.length ? `Until ${duration.ends.map((key: string) => end[key] ?? key).join(" or ")}` : "Permanent";
    }
    const time = quantityEn(duration.duration?.amount, duration.duration?.type);
    return `${duration.concentration ? "Concentration, up to " : duration.duration?.upTo ? "Up to " : ""}${time || title(duration.type)}`;
  }).join(" or ");
}
export function componentsEn(value: any): string {
  if (!value) return "";
  const result: string[] = [];
  if (value.v) result.push("V");
  if (value.s) result.push("S");
  if (value.m) {
    const material = value.m;
    const parts = [typeof material === "string" ? clean(material) : clean(material.text)];
    if (typeof material.cost === "number" && material.cost > 0) parts.push(`worth ${material.cost / 100} gp`);
    if (material.consume) parts.push(material.consume === "optional" ? "optionally consumed" : "consumed");
    result.push(parts.filter(Boolean).length ? `M (${parts.filter(Boolean).join("; ")})` : "M");
  }
  return result.join(", ");
}
export function prerequisiteEn(value: any): string {
  if (Array.isArray(value)) return value.map(prerequisiteEn).join(" or ");
  if (!value || typeof value !== "object") return clean(value);
  return Object.entries(value).map(([key, raw]: [string, any]) => {
    if (key === "ability") return (Array.isArray(raw) ? raw : [raw]).map((abilities: any) => Object.entries(abilities).map(([ability, score]) => `${abilityEn[ability] ?? ability} ${score}+`).join(" and ")).join(" or ");
    if (key === "level") return typeof raw === "number" ? `Level ${raw}` : `Level ${raw.level ?? ""}${raw.class?.name ? ` ${clean(raw.class.name)}` : ""}`;
    if (key === "spellcasting" && raw === true) return "Spellcasting";
    if (key === "other") return clean(raw);
    const description = typeof raw === "object" ? (Array.isArray(raw) ? raw.map((item: any) => clean(item.name ?? item.entry ?? item)).join(", ") : clean(raw.name ?? raw.entry ?? JSON.stringify(raw))) : clean(raw);
    return `${title(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}: ${description}`;
  }).join("; ");
}
