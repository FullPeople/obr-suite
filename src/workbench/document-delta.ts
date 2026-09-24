export type DocumentChange={path:string[];before?:unknown;after?:unknown;observed?:unknown;remove?:boolean};
const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
const safe=(key:string)=>!['__proto__','prototype','constructor'].includes(key);
export function documentChanges(before:any,after:any,observed?:any,path:string[]=[],result:DocumentChange[]=[]):DocumentChange[]{
 // An explicitly absent observed leaf is meaningful. A default parameter here
 // would replace it with the UI's hydrated value on every recursive call.
 if(arguments.length<3)observed=before;
 if(JSON.stringify(before)===JSON.stringify(after))return result;
 // Preserve the shape of absent/null observed ancestors. Splitting a hydrated
 // race {name:'',subrace:null} into a name leaf would manufacture observed.race
 // as {}, falsely turning an uninitialised legacy branch into a deleted one.
 if(object(before)&&object(after)&&object(observed)){for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(safe(key))documentChanges(before[key],after[key],observed[key],[...path,key],result);}
 else result.push({path,before,after,observed,remove:after===undefined});
 return result;
}
/** Reconstruct three-way merge inputs from changed branches. Unchanged object
 * branches (e.g. portraits) are omitted; an edited array is still one leaf,
 * so changing selections carries its full ordered entries for ID-based merge. */
export function expandChanges(base:any,changes:DocumentChange[],field:'before'|'after'|'observed'){
 if(!Array.isArray(changes)||changes.length>10000)throw Error('无效角色增量');let result=structuredClone(base);
 for(const change of changes){if(!Array.isArray(change.path)||change.path.length>64||change.path.some(k=>typeof k!=='string'||!safe(k)))throw Error('无效角色字段');
  const value=change[field];if(!change.path.length){result=structuredClone(value);continue;}let current=result;
  for(const key of change.path.slice(0,-1)){if(!object(current[key]))current[key]={};current=current[key];}
  const key=change.path[change.path.length-1];if(value===undefined)delete current[key];else current[key]=structuredClone(value);
 }return result;
}
