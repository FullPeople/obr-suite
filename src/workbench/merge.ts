import {cloneJson} from './clone-json';
const safeKey=(key:string)=>!['__proto__','constructor','prototype'].includes(key);
// These are exporter/document bookkeeping, not a user's editable fields. Match
// complete paths so similarly named fields inside homebrew/resources stay strict.
const generatedPaths=new Set(['native.revision','native.updatedAt','owlbear.meta.parsed_at','meta.parsed_at','owlbear.dnd_card_web.revision','owlbear.dnd_card_web.updatedAt','dnd_card_web.revision','dnd_card_web.updatedAt','owlbear._suiteRevision','_suiteRevision']);
function generatedValue(path:string,base:any,next:any){
 if(path.endsWith('_suiteRevision'))return base;
 if(path.endsWith('.revision'))return Math.max(Number.isSafeInteger(base)?base:0,Number.isSafeInteger(next)?next:0);
 // Keep the newest valid timestamp without allowing a stale export to roll it
 // backward. Both full saves and changed-branch saves pass through this rule.
 const old=typeof base==='string'?Date.parse(base):NaN,value=typeof next==='string'?Date.parse(next):NaN;
 return Number.isFinite(value)&&(!Number.isFinite(old)||value>old)?next:base;
}
/** JSON object member order is not a data change. Array order remains significant. */
export function sameValue(a:any,b:any):boolean {
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 if(Array.isArray(a))return a.length===b.length&&a.every((v,i)=>sameValue(v,b[i]));
 const keys=Object.keys(a).filter(k=>a[k]!==undefined),other=Object.keys(b).filter(k=>b[k]!==undefined);
 return keys.length===other.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&sameValue(a[k],b[k]));
}
function differences(before:any,remote:any,path='',out:any[]=[]):any[]{
 if(sameValue(before,remote)||out.length>=12)return out;
 if(before&&remote&&typeof before==='object'&&typeof remote==='object'&&!Array.isArray(before)&&!Array.isArray(remote)){
  for(const key of new Set([...Object.keys(before),...Object.keys(remote)]))if(safeKey(key))differences(before[key],remote[key],path?path+'.'+key:key,out);
 }else {
  const brief=(v:any)=>v===undefined?'[missing]':v===null?null:typeof v==='object'?Array.isArray(v)?`[array: ${v.length}]`:'[object]':typeof v==='string'?(v.startsWith('data:')?'[embedded data]':v.slice(0,160)):v;
  const privateField=/secret|password|credential|authorization|relayKey|clientKey|hostKey/i.test(path);
  out.push({path,before:privateField?'[redacted]':brief(before),remote:privateField?'[redacted]':brief(remote)});
 }
 return out;
}
function conflict(message:string,path:string,before:any,remote:any,operation:string):never {
 const diagnostic={code:'MERGE_CONFLICT',operation,path:path||'$root',entryId:before?.id||remote?.id,entryName:before?.entry?.name||before?.name||remote?.entry?.name, differences:differences(before,remote)};
 throw Object.assign(Error(message+'（'+diagnostic.path+'）'),{diagnostic});
}
const idRows=(...values:any[])=>values.every(Array.isArray)&&values.flat().every(v=>v&&typeof v.id==='string');
function mergeRows(base:any[],previous:any[],next:any[],observed:any[],path:string,projected:boolean){
 const result=[...base];
 for(const old of previous)if(!next.some(v=>v.id===old.id)){
  const at=result.findIndex(v=>v.id===old.id),seen=observed.find(v=>v.id===old.id);
  if(at>=0){if(!sameValue(result[at],old)&&!(projected&&sameValue(result[at],seen)))conflict('该条目已被修改，请重试',path+'['+old.id+']',old,result[at],'remove');result.splice(at,1);}
 }
 for(const row of next){
  const old=previous.find(v=>v.id===row.id);if(sameValue(old,row))continue;
  const at=result.findIndex(v=>v.id===row.id),rowPath=path+'['+row.id+']';
  if(at<0){if(old)conflict('该条目已被移除，请刷新后重试',rowPath,old,undefined,'update');result.push(cloneJson(row));}
  else result[at]=projected?applyProjectionPatch(result[at],old,row,observed.find(v=>v.id===row.id),rowPath):applyPatch(result[at],old,row,rowPath);
 }
 return result;
}
/** Compare changes with the original snapshot, not UI-only hydration/normalization.
 * ID arrays merge per row so a different concurrent addition is never overwritten. */
export function applyProjectionPatch(base:any,previous:any,next:any,observed:any,path=''):any {
 if(generatedPaths.has(path))return generatedValue(path,base,next);
 if(sameValue(previous,next)||sameValue(base,next))return base;
 if(idRows(base,previous,next))return mergeRows(base,previous,next,Array.isArray(observed)?observed:[],path,true);
 if(base&&previous&&next&&typeof base==='object'&&typeof previous==='object'&&typeof next==='object'&&![base,previous,next].some(Array.isArray)){
  const result={...base};for(const key of new Set([...Object.keys(previous),...Object.keys(next)]))if(safeKey(key)&&!sameValue(previous[key],next[key])){
   const field=path?path+'.'+key:key;
   if(generatedPaths.has(field)){result[key]=generatedValue(field,base[key],next[key]);continue;}
   if(!(key in next)){if(!sameValue(base[key],observed?.[key])&&!sameValue(base[key],previous[key]))conflict('此字段已由其他玩家修改，请重试',field,previous[key],base[key],'remove');delete result[key];}
   else result[key]=applyProjectionPatch(base[key],previous[key],next[key],observed?.[key],field);
  }return result;
 }
 if(sameValue(base,observed))return cloneJson(next);
 return applyPatch(base,previous,next,path);
}
export function applyPatch(base:any,previous:any,next:any,path=''):any {
 if(generatedPaths.has(path))return generatedValue(path,base,next);
 if(sameValue(previous,next)||sameValue(base,next))return base;
 if(idRows(base,previous,next))return mergeRows(base,previous,next,[],path,false);
 if(next&&previous&&base&&typeof next==='object'&&!Array.isArray(next)&&!Array.isArray(previous)&&!Array.isArray(base)){
  const result={...base};for(const key of new Set([...Object.keys(previous),...Object.keys(next)]))if(safeKey(key)){
   const field=path?path+'.'+key:key;
   if(generatedPaths.has(field)){result[key]=generatedValue(field,base[key],next[key]);continue;}
   if(!(key in next)){if(!sameValue(base[key],previous[key]))conflict('此字段已由其他玩家修改，请重试',field,previous[key],base[key],'remove');delete result[key];}
   else {const value=applyPatch(base[key],previous[key],next[key],field);if(value===undefined)delete result[key];else result[key]=value;}
  }return result;
 }
 if(sameValue(base,previous))return cloneJson(next);
 if(base===undefined){if(previous!==undefined)conflict('该字段已被移除，请刷新后重试',path,previous,base,'update');return cloneJson(next);}
 conflict('此字段已由其他玩家修改，请重试',path,previous,base,'update');
}

/** Token metadata may predate automatic hit-die/slot resources. Preserve these derived rows. */
export function resourceSnapshot(native:Record<string,any>,rows:any[]){
 const result:Record<string,any>=Object.fromEntries(Object.entries(native||{}).filter(([,r])=>r?.automatic));
 for(const r of rows)if(r&&typeof r.id==='string'&&safeKey(r.id)&&Number.isFinite(r.current)&&Number.isFinite(r.max))result[r.id]={...native?.[r.id],...r};
 return result;
}
