import {cloneJson} from './clone-json';
import {sameValue,applyPatch} from './merge';
import {conditionIdentity,runtimeConditions} from './conditions';
/** Character JSON owns durable runtime; scene metadata is an editable projection.
 * The baseline distinguishes a real scene edit from a token returning with old data. */
export const RUNTIME_BASELINE='com.obr-suite/workbench/runtime-baseline';
export const DOCUMENT_REVISION='_suiteRevision';
export type Runtime={stats:Record<string,any>;resources:Record<string,any>;conditions:string[]};
export type RuntimeBaseline={version:1;cardId:string;revision:number;value:Runtime};
const fields=['health','max health','temporary health','armor class'];
export const documentRevision=(doc:any)=>Number.isSafeInteger(doc?.[DOCUMENT_REVISION])?doc[DOCUMENT_REVISION]:0;
export function documentRuntime(doc:any,definitions:any[]=[]):Runtime {
 const native=doc?.dnd_card_web,hp=doc?.core_stats?.hp||{},selections=native?.selections;
 const resources=cloneJson(native?.runtime?.resources||doc?.web_resources||{});
 for(const [id,row] of Object.entries(resources) as [string,any][])row.id=id;
 return {stats:Object.fromEntries(Object.entries({health:native?.runtime?.hp??hp.current,'max health':hp.max,'temporary health':native?.runtime?.tempHp??hp.temp??0,'armor class':doc?.core_stats?.ac}).filter(([,v])=>typeof v==='number')),
 resources,conditions:[...new Set<string>((selections?selections.filter((s:any)=>s.entry?.kind==='condition').map((s:any)=>s.entry):doc?.web_conditions||[]).map((entry:any)=>conditionIdentity(entry,definitions)))]};
}
export function tokenRuntime(metadata:Record<string,any>,fallback:Runtime):Runtime {
 const stats=metadata['com.obr-suite/bubbles/data']??metadata['com.owlbear-rodeo-bubbles-extension/metadata']??{};
 const resources=Array.isArray(metadata['com.obr-suite/resources/data'])?Object.fromEntries(metadata['com.obr-suite/resources/data'].filter((r:any)=>r&&typeof r.id==='string').map((r:any)=>[r.id,cloneJson(r)])):fallback.resources;
 return {stats:{...fallback.stats,...Object.fromEntries(fields.filter(k=>typeof stats[k]==='number').map(k=>[k,stats[k]]))},resources,conditions:Array.isArray(metadata['com.obr-suite/status/buffs'])?[...new Set<string>(metadata['com.obr-suite/status/buffs'])]:fallback.conditions};
}
function changedValue(current:any,before:any,next:any){return sameValue(current,before)||sameValue(current,next)?next:current;}
/** Merge only token deltas against its stamped projection. A stale conflicting
 * value is not a new mutation; independent fields and condition additions merge. */
export function mergeTokenRuntime(current:Runtime,observed:Runtime,baseline:RuntimeBaseline|undefined,cardId:string,revision:number):Runtime {
 if(!baseline||baseline.version!==1||baseline.cardId!==cardId){
  // Imported legacy cards adopt their existing scene runtime once. A modern card
  // already has a revision: an unstamped old token must not overwrite it.
  return revision===0?cloneJson(observed):current;
 }
 if(baseline.revision>revision)return current;
 const before=baseline.value,result=cloneJson(current);
 for(const field of fields)if(!sameValue(before.stats[field],observed.stats[field]))result.stats[field]=changedValue(current.stats[field],before.stats[field],observed.stats[field]);
 for(const id of new Set([...Object.keys(before.resources),...Object.keys(observed.resources)])){
  const old=before.resources[id],next=observed.resources[id];if(sameValue(old,next))continue;
  if(old&&next&&current.resources[id]){const row={...current.resources[id]};for(const field of new Set([...Object.keys(old),...Object.keys(next)]))if(!sameValue(old[field],next[field])){const value=changedValue(row[field],old[field],next[field]);if(value===undefined)delete row[field];else row[field]=value;}result.resources[id]=row;}
  else{const value=changedValue(current.resources[id],old,next);if(value===undefined)delete result.resources[id];else result.resources[id]=cloneJson(value);}
 }
 const removed=before.conditions.filter(id=>!observed.conditions.includes(id)),added=observed.conditions.filter(id=>!before.conditions.includes(id));
 result.conditions=[...new Set([...current.conditions.filter(id=>!removed.includes(id)),...added])];
 return result;
}
export function writeRuntime(doc:any,runtime:Runtime,definitions:any[]=[]){
 const before=documentRuntime(doc,definitions),result=cloneJson(doc),hp=(result.core_stats||={}).hp||={};
 for(const [key,field] of [['health','current'],['max health','max'],['temporary health','temp']])if(typeof runtime.stats[key]==='number')hp[field]=runtime.stats[key];
 if(typeof runtime.stats['armor class']==='number')result.core_stats.ac=runtime.stats['armor class'];
 result.web_resources=cloneJson(runtime.resources);
 const native=result.dnd_card_web;if(native){native.runtime||={};native.runtime.hp=hp.current;native.runtime.tempHp=hp.temp;native.runtime.resources=cloneJson(runtime.resources);native.selections=runtimeConditions(native.selections||[],native.selections||[],runtime.conditions,definitions);native.revision=(native.revision||0)+1;
 if(runtime.stats['max health']!==before.stats['max health']){native.baseHp=runtime.stats['max health'];native.sheetBonuses={...native.sheetBonuses,hp:0};native.adjustments=[...(native.adjustments||[]).filter((a:any)=>a.target!=='hp'),{id:'suite-hp',target:'hp',value:runtime.stats['max health'],reason:'枭熊场景'}];}
 // Scene AC is a final total; retain the card offset without applying it twice.
 if(runtime.stats['armor class']!==before.stats['armor class'])native.adjustments=[...(native.adjustments||[]).filter((a:any)=>a.target!=='ac'),{id:'suite-ac',target:'ac',value:runtime.stats['armor class']-(native.sheetBonuses?.ac||0),reason:'枭熊场景'}];
 for(const [id,r] of Object.entries(runtime.resources) as [string,any][])if(id.startsWith('spell-slot:')&&native.spellSettings)native.spellSettings.slots[id.split(':')[1]]={max:r.max,used:r.max-r.current};
 result.web_conditions=native.selections.filter((r:any)=>r.entry?.kind==='condition').map((r:any)=>r.entry);
 }else result.web_conditions=runtimeConditions((result.web_conditions||[]).map((entry:any)=>({entry})),[],runtime.conditions,definitions).map((r:any)=>r.entry);
 return result;
}

/** Monsters have no character document; merge a requested metadata delta against
 * the live callback draft so separate resource edits cannot replace each other. */
export function mergeMonsterMetadata(current:Record<string,any>,before:Record<string,any>,patch:any){
 const key='com.obr-suite/bubbles/data',legacy='com.owlbear-rodeo-bubbles-extension/metadata',resources='com.obr-suite/resources/data',conditions='com.obr-suite/status/buffs',result={...current};
 if(patch.stats){const observed=before[key]??before[legacy]??{},live=current[key]??current[legacy]??{},next={...live};for(const [field,value] of Object.entries(patch.stats))next[field]=applyPatch(live[field],observed[field],value,'metadata.stats.'+field);result[key]=next;if(current[legacy])result[legacy]={...current[legacy],...next};}
 if(patch.resources!==undefined)result[resources]=applyPatch(current[resources]||[],before[resources]||[],patch.resources,'metadata.resources');
 if(patch.conditions!==undefined){const old:string[]=before[conditions]||[],live:string[]=current[conditions]||[],next:string[]=patch.conditions;result[conditions]=[...new Set([...live.filter(id=>!old.includes(id)||next.includes(id)),...next.filter(id=>!old.includes(id))])];}
 return result;
}
