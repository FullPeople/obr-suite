import {sameValue} from './merge';

export type ConditionRow={id:string;name:string;entry?:any;level?:number};
type Change={itemId:string;conditionId:string;before:ConditionRow|null;after:ConditionRow|null;grant?:boolean};
type Adapter={read:(id:string)=>Promise<{rows:ConditionRow[];write:boolean;receive?:boolean}>;write:(change:Change)=>Promise<void>;snapshot:(id:string)=>Promise<any>;catalog:()=>Promise<any>;notice?:(changes:Change[])=>Promise<void>};
/** Runtime edits use the existing character document / monster metadata owner.
 * A transfer has two durable writes. On a definite second-write failure, roll
 * back only the specific unchanged target field; never roll back an unknown write. */
export function conditionCommands(api:Adapter){
 const history=new Map<string,Change[]>();
 const row=(rows:ConditionRow[],id:string)=>rows.find(r=>r.id===id)||null;
 return async(message:any)=>{
  let changes:Change[]=[];
  if(message.action==='history'){
   const previous=history.get(String(message.reference));if(!previous)throw Error('状态操作的撤销记录已过期');
   changes=previous.map(change=>({...change,before:change.after,after:change.before})).reverse();
  }else{
   if(!['add','remove','transfer'].includes(message.action))throw Error('无效状态操作');
   const condition=message.condition as ConditionRow;if(typeof condition?.id!=='string'||condition.id.length>500||!condition.id||typeof condition.name!=='string'||!condition.name||condition.name.length>160||condition.entry&&(condition.entry.kind!=='condition'||typeof condition.entry.id!=='string'||typeof condition.entry.name!=='string'||JSON.stringify(condition.entry).length>500000))throw Error('无效状态');
   const source=await api.read(message.itemId);if(!source.write&&!(message.action==='add'&&source.receive))throw Error('没有修改此角色状态的权限');
   const before=row(source.rows,condition.id);
   if(message.action==='add'){if(!before)changes.push({itemId:message.itemId,conditionId:condition.id,before:null,after:condition,grant:true});}
   else if(message.action==='remove'){if(before)changes.push({itemId:message.itemId,conditionId:condition.id,before,after:null});}
   else if(message.to!==message.itemId){
    if(!before)throw Error('要转交的状态已被移除');
    const target=await api.read(message.to);if(!target.write&&!target.receive)throw Error('没有修改目标角色状态的权限');
    if(!row(target.rows,condition.id))changes.push({itemId:message.to,conditionId:condition.id,before:null,after:before,grant:true});
    changes.push({itemId:message.itemId,conditionId:condition.id,before,after:null});
   }
  }
  // Validate all fields before the first write. Each write rechecks the field.
  for(const change of changes){const current=await api.read(change.itemId);if(!current.write&&!(change.grant&&current.receive))throw Error('角色状态修改权限已改变');if(!sameValue(row(current.rows,change.conditionId),change.before))throw Error(`状态已改变，请重试（${change.before?.name||change.after?.name}）`);}
  const committed:Change[]=[];
  try{for(const change of changes){await api.write(change);committed.push(change);}}
  catch(error){const e=error as any,rollbackErrors:string[]=[];
   if(!e?.uncertain)for(const change of [...committed].reverse())try{await api.write({...change,before:change.after,after:change.before});}catch(failure){rollbackErrors.push(`${change.itemId}: ${String(failure)}`);}
   if(e?.uncertain&&!committed.length)throw error;
   if(e?.uncertain||rollbackErrors.length)throw Object.assign(Error('状态转交部分结果暂时无法确认，请核对两张角色卡。'),{uncertain:true,diagnostic:{...e?.diagnostic,code:'CONDITION_TRANSFER_PARTIAL',requestId:message.requestId,committed:committed.map(c=>c.itemId),rollbackErrors,cause:String(error),causeDiagnostic:e?.diagnostic}});
   throw error;
  }
  const reference=crypto.randomUUID();if(changes.length){history.set(reference,changes);if(history.size>160)history.delete(history.keys().next().value!);await api.notice?.(changes).catch(error=>console.warn('[workbench] condition notice failed',error));}
  const ids=[...new Set([message.itemId,message.to,...changes.map(c=>c.itemId)].filter(Boolean))];
  const snapshots=(await Promise.all(ids.map(id=>api.snapshot(id).catch(error=>{console.warn('[workbench] condition snapshot pending',error);return undefined;})))).filter(Boolean);
  const catalog=await api.catalog().catch(error=>{console.warn('[workbench] condition catalog pending',error);return undefined;});
  return {snapshots,catalog,...(changes.length?{historyId:reference,undo:{itemId:message.itemId,action:'history',reference}}:{})};
 };
}
