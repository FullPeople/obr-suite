/** Scene identity belongs to runtime state, not to a rule snapshot or stock ID. */
export function conditionIdentity(entry:any,definitions:{id:string;name?:string}[]=[]):string{
 if(typeof entry?.raw?._suiteStatusId==='string')return entry.raw._suiteStatusId;
 if(typeof entry?.id==='string'&&entry.id.startsWith('suite-condition:'))return entry.id.slice('suite-condition:'.length);
 const normalize=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const name=normalize(entry?.name||''),english=normalize(entry?.english||entry?.name||'');
 const found=definitions.find(row=>name&&normalize(row.name||'')===name||english&&normalize(row.id).endsWith(english));
 return found?.id||'web:'+entry.id;
}

/** Scene metadata owns presence; stored rows own counters/content. UI hydration
 * may annotate identities, but must never replace a newer stored counter. */
export function runtimeConditions(stored:any[],previous:any[],ids:string[],definitions:{id:string;name?:string}[]){
 const matches=(row:any,id:string)=>row.entry?.kind==='condition'&&(conditionIdentity(row.entry,definitions)===id||'web:'+row.entry.id===id);
 return [...stored.filter(row=>row.entry?.kind!=='condition'),...ids.map(id=>{
  const seen=previous.find(row=>matches(row,id)),old=stored.find(row=>matches(row,id)||seen&&row.id===seen.id)||seen;
  const entry=old?.entry||{id:'suite-condition:'+id,kind:'condition',name:definitions.find(d=>d.id===id)?.name||id,english:id,source:'IMPORTED',edition:'both',packId:'imported',revision:'1',entries:[],raw:{}};
  return {...old,id:old?.id||'suite-status:'+id,entry:{...entry,raw:{...entry.raw}},level:old?.level??1,quantity:old?.quantity??1,equipped:old?.equipped??false};
 })];
}
