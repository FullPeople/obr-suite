import type {Item} from '@owlbear-rodeo/sdk';
const KEYS=['com.character-cards/boundCardId','com.bestiary/slug','com.obr-suite/bubbles/data','com.owlbear-rodeo-bubbles-extension/metadata','com.obr-suite/resources/data','com.obr-suite/workbench/runtime-baseline','com.obr-suite/workbench/monster','com.obr-suite/workbench/locked','com.obr-suite/hp-bar/enabled','com.obr-suite/status/buffs','com.obr-suite/workbench/condition-details'];
/** Map movement does not change a character sheet. Retain fresh item objects,
 * but only schedule sheet work for fields its permissions/projection consume. */
export function workbenchItemsSignature(items:Item[]):string {
 return JSON.stringify(items.filter(item=>item.type==='IMAGE').map(item=>[
  item.id,item.name,item.type,item.layer,item.createdUserId,item.visible,
  (item as any).image?.url,(item as any).image?.width,(item as any).image?.height,KEYS.map(key=>item.metadata[key]),
 ]));
}
