import { ccName, ccProperty, ccTerm, ccUnits, type CardLanguage } from "./localization";

const TERMS: readonly (readonly [string, string])[] = [
  ["守序善良", "Lawful Good"], ["中立善良", "Neutral Good"], ["混乱善良", "Chaotic Good"],
  ["守序中立", "Lawful Neutral"], ["绝对中立", "True Neutral"], ["中立", "Neutral"], ["混乱中立", "Chaotic Neutral"],
  ["守序邪恶", "Lawful Evil"], ["中立邪恶", "Neutral Evil"], ["混乱邪恶", "Chaotic Evil"],
  ["微型", "Tiny"], ["小型", "Small"], ["中型", "Medium"], ["大型", "Large"], ["巨型", "Huge"], ["超巨型", "Gargantuan"],
  ["通用语", "Common"], ["矮人语", "Dwarvish"], ["精灵语", "Elvish"], ["巨人语", "Giant"], ["侏儒语", "Gnomish"], ["地精语", "Goblin"], ["半身人语", "Halfling"], ["兽人语", "Orc"], ["龙语", "Draconic"], ["深渊语", "Abyssal"], ["炼狱语", "Infernal"], ["天界语", "Celestial"], ["原初语", "Primordial"], ["木族语", "Sylvan"], ["地底通用语", "Undercommon"], ["深潜语", "Deep Speech"], ["德鲁伊语", "Druidic"], ["盗贼黑话", "Thieves' Cant"],
  ["炼金工具", "Alchemist's Supplies"], ["酿酒工具", "Brewer's Supplies"], ["书法工具", "Calligrapher's Supplies"], ["木匠工具", "Carpenter's Tools"], ["制图工具", "Cartographer's Tools"], ["鞋匠工具", "Cobbler's Tools"], ["厨师工具", "Cook's Utensils"], ["玻璃匠工具", "Glassblower's Tools"], ["珠宝匠工具", "Jeweler's Tools"], ["皮匠工具", "Leatherworker's Tools"], ["石匠工具", "Mason's Tools"], ["画家工具", "Painter's Supplies"], ["陶匠工具", "Potter's Tools"], ["铁匠工具", "Smith's Tools"], ["修补工具", "Tinker's Tools"], ["织布工具", "Weaver's Tools"], ["木雕工具", "Woodcarver's Tools"], ["易容工具", "Disguise Kit"], ["文书伪造工具", "Forgery Kit"], ["草药工具", "Herbalism Kit"], ["领航工具", "Navigator's Tools"], ["制毒工具", "Poisoner's Kit"], ["盗贼工具", "Thieves' Tools"],
  ["布甲", "Padded Armor"], ["皮甲", "Leather Armor"], ["镶钉皮甲", "Studded Leather Armor"], ["兽皮甲", "Hide Armor"], ["链甲衫", "Chain Shirt"], ["鳞甲", "Scale Mail"], ["胸甲", "Breastplate"], ["半身板甲", "Half Plate Armor"], ["环甲", "Ring Mail"], ["链甲", "Chain Mail"], ["板条甲", "Splint Armor"], ["板甲", "Plate Armor"], ["盾牌", "Shield"],
  ["目盲", "Blinded"], ["魅惑", "Charmed"], ["耳聋", "Deafened"], ["恐慌", "Frightened"], ["擒抱", "Grappled"], ["失能", "Incapacitated"], ["隐形", "Invisible"], ["麻痹", "Paralyzed"], ["石化", "Petrified"], ["中毒", "Poisoned"], ["倒地", "Prone"], ["束缚", "Restrained"], ["震慑", "Stunned"], ["昏迷", "Unconscious"], ["力竭", "Exhaustion"],
  ["防护", "Abjuration"], ["咒法", "Conjuration"], ["预言", "Divination"], ["惑控", "Enchantment"], ["塑能", "Evocation"], ["幻术", "Illusion"], ["死灵", "Necromancy"], ["变化", "Transmutation"],
  ["动作", "Action"], ["附赠动作", "Bonus action"], ["反应", "Reaction"], ["瞬间", "Instantaneous"], ["自身", "Self"], ["接触", "Touch"], ["无限", "Unlimited"], ["专注", "Concentration"], ["仪式", "Ritual"], ["箭", "Arrows"], ["弩矢", "Crossbow bolts"],
];

/** View-only exact rule terms; never run replacements over authored prose. */
export function fullTerm(value: unknown, lang: CardLanguage): string {
  const raw = String(value ?? "");
  const pair = TERMS.find((entry) => entry.some((label) => label.toLowerCase() === raw.trim().toLowerCase()));
  return pair?.[lang === "en" ? 1 : 0] ?? ccTerm(raw, lang);
}
export function fullName(value: any, lang: CardLanguage): string { return fullTerm(ccName(value, lang), lang); }
export function fullDescription(value: any, lang: CardLanguage): string {
  const explicit = lang === "en" ? value?.description_en ?? value?.descriptionEn : value?.description_zh ?? value?.descriptionZh;
  return typeof explicit === "string" && explicit.trim() ? explicit : typeof value?.description === "string" ? value.description : "";
}
export function fullMeasure(value: unknown, lang: CardLanguage): string {
  const raw = String(value ?? "");
  if (lang !== "en") return raw;
  const numbered = /^(\d+(?:\.\d+)?)\s*个?\s*(分钟|小时|轮|回合|天|尺|磅|动作|附赠动作|反应)$/.exec(raw.trim());
  if (numbered) return `${numbered[1]} ${{ 分钟: "min.", 小时: "hr.", 轮: "rounds", 回合: "turns", 天: "days", 尺: "ft.", 磅: "lb.", 动作: "action", 附赠动作: "bonus action", 反应: "reaction" }[numbered[2]]}`;
  return fullTerm(ccUnits(raw, lang), lang);
}

export function fullContainer(value: unknown, lang: CardLanguage): string {
  const raw = String(value ?? "");
  const standard = /^(背包|次元袋)\s*(\d+)?$/.exec(raw.trim());
  return lang === "en" && standard ? `${standard[1] === "背包" ? "Backpack" : "Bag of Holding"}${standard[2] ? ` ${standard[2]}` : ""}` : raw;
}
export function fullProperties(weapon: any, lang: CardLanguage): string {
  const values = Array.isArray(weapon.properties) ? weapon.properties : String(weapon.properties ?? "").split(/[,，;；、](?![^()（）]*[)）])/);
  const properties: string[] = [], masteries: string[] = [];
  for (const value of values) {
    const raw = String(value).trim(); if (!raw) continue;
    const match = /^(?:武器精通|精通|Weapon\s+Mastery|Mastery)\s*[:：]\s*(.*)$/i.exec(raw);
    if (match) masteries.push(ccTerm(match[1], lang)); else properties.push(ccProperty(raw, lang));
  }
  for (const mastery of Array.isArray(weapon.mastery) ? weapon.mastery : weapon.mastery ? [weapon.mastery] : []) masteries.push(ccTerm(mastery, lang));
  if (masteries.length) properties.push(`${lang === "en" ? "Mastery" : "精通"}: ${[...new Set(masteries)].join(" / ")}`);
  return properties.join(" · ");
}

export const fullText = (lang: CardLanguage, zh: string, en: string): string => lang === "en" ? en : zh;
