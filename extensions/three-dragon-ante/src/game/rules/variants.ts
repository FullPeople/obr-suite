import {SPECIAL_CARDS} from "./cards";
import {CARD_PACK_RULESET} from "./printed-pack";
import type {DeckId,RuleSetId,TableVariant} from "./types";

export const DEFAULT_VARIANT:TableVariant=Object.freeze({ruleSetId:CARD_PACK_RULESET as RuleSetId,deckId:"random-specials-v1" as const});
export const RULE_SET_CATALOG=Object.freeze([
  {id:CARD_PACK_RULESET as RuleSetId,version:"pack-20260910",versionEn:"pack-20260910",name:"自备牌包规则",nameEn:"Supplied pack rules",summary:"当前已审核的点数、能力和牌面文字。",summaryEn:"Reviewed card values, powers and text."},
]);
export const DECK_CATALOG=Object.freeze([
  {id:"random-specials-v1" as DeckId,version:"v1",versionEn:"v1",name:"随机特殊牌池",nameEn:"Random special pool",summary:"每局从 30 张特殊牌中随机取 10 张。",summaryEn:"Randomly use 10 of the 30 special cards each game.",requiresSelection:false},
  {id:"selected-specials-v1" as DeckId,version:"v1",versionEn:"v1",name:"自选特殊牌池",nameEn:"Selected special pool",summary:"开局前选择正好 10 张特殊牌；牌局开始后锁定。",summaryEn:"Choose exactly 10 special cards before dealing; locked after start.",requiresSelection:true},
]);
const specialId=(value:string)=>SPECIAL_CARDS.some(card=>card.id===value);
const validSpecialIds=(value:unknown):value is string[]=>Array.isArray(value)&&value.length===10&&new Set(value).size===10&&value.every(id=>typeof id==="string"&&specialId(id));

/** Parse only an explicitly supplied variant. `undefined` is a legacy value,
 * not proof that a caller selected an unknown variant. */
export function parseVariant(value:unknown):TableVariant|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const candidate=value as Record<string,unknown>;
  if(candidate.ruleSetId!==CARD_PACK_RULESET||candidate.deckId!=="random-specials-v1"&&candidate.deckId!=="selected-specials-v1")return null;
  if(candidate.deckId==="random-specials-v1")return candidate.specialIds===undefined?{ruleSetId:CARD_PACK_RULESET,deckId:"random-specials-v1"}:null;
  return validSpecialIds(candidate.specialIds)?{ruleSetId:CARD_PACK_RULESET,deckId:"selected-specials-v1",specialIds:[...candidate.specialIds]}:null;
}

/** Resolve the compatibility alias used by older tests/saves. */
export function resolveVariant(value?:TableVariant,legacySpecialIds?:readonly string[]):TableVariant {
  if(value===undefined){
    if(legacySpecialIds!==undefined){if(!validSpecialIds([...legacySpecialIds]))throw Error("INVALID_CONFIG");return {ruleSetId:CARD_PACK_RULESET,deckId:"selected-specials-v1",specialIds:[...legacySpecialIds]};}
    return {...DEFAULT_VARIANT};
  }
  const parsed=parseVariant(value);
  if(!parsed)throw Error("INVALID_CONFIG");
  if(legacySpecialIds!==undefined&&(
    parsed.deckId!=="selected-specials-v1"||
    parsed.specialIds?.join("\u0000")!==[...legacySpecialIds].join("\u0000")
  ))throw Error("INVALID_CONFIG");
  return parsed;
}
export function variantSpecialIds(variant:TableVariant):string[]|undefined{return variant.deckId==="selected-specials-v1"?[...(variant.specialIds??[])]:undefined;}
export function sameVariant(a:TableVariant|undefined,b:TableVariant|undefined):boolean {
  const left=a??DEFAULT_VARIANT,right=b??DEFAULT_VARIANT;
  return left.ruleSetId===right.ruleSetId&&left.deckId===right.deckId&&(left.deckId!=="selected-specials-v1"||left.specialIds?.join("\u0000")===right.specialIds?.join("\u0000"));
}
