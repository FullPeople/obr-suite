import OBR from '@owlbear-rodeo/sdk';
import {isGlobalDarkRollEnabled,type DiceRollPayload} from '../modules/dice';
import {submitDice3dGroup} from './dice3d';
import {setTokenResults,toggleTokenResults,clearTokenResults} from './token-results';
import {workbenchObservation} from './observation';
export const GROUP_RESULT_CONTROL='com.obr-suite/workbench/group-result-control';
const abilities=['str','dex','con','int','wis','cha'] as const,labels=['力量','敏捷','体质','智力','感知','魅力'];
export type GroupTarget={itemId:string;key:string;name:string;ability:Record<string,number>;saves:Record<string,number>;initiative:number;hidden:boolean;result?:number;applied?:boolean;uncertain?:boolean;error?:string};
export type GroupRollState={id:string;phase:'select'|'rolling'|'resolve'|'settled';targets:GroupTarget[];selectedCount?:number;visible:boolean;kind:'save'|'ability'|'initiative';ability:string;variant:'normal'|'adv'|'dis';field?:'health'|'max health'|'armor class';adjustment?:{field:string;mode:string;value:number;pending:boolean};dc?:number;value?:number;mode?:'damage'|'heal'|'set';error?:string};
export function targetFromDocument(item:any,document:any,key:string):GroupTarget{
 const doc=document||{},ability:Record<string,number>={},saves:Record<string,number>={};
 for(const key of abilities){const raw=doc.abilities?.[key],score=Number(raw?.total??doc[key]);if(!Number.isFinite(score))throw Error('目标缺少完整属性资料');ability[key]=Number.isFinite(raw?.modifier)?raw.modifier:Math.floor((score-10)/2);const save=Number(raw?.save?.bonus??doc.save?.[key]);saves[key]=Number.isFinite(save)?save:ability[key];}
 return {itemId:item.id,key,name:doc.identity?.character_name||doc.name||item.name||'单位',ability,saves,initiative:Number(doc.core_stats?.initiative??item.metadata?.['com.initiative-tracker/dexMod']??ability.dex),hidden:!!item.metadata?.['com.initiative-tracker/data']?.invisible};
}
export function createGroupRolls(deps:{observation:ReturnType<typeof workbenchObservation>;send:(type:string,payload:any)=>void;resolveTarget:(itemId:string)=>Promise<{item:any;document:any;key:string}>;applyDelta:(itemId:string,change:{mode:'damage'|'heal'|'set';value:number;key:string;field?:'health'|'max health'|'armor class'})=>Promise<unknown>}){
 let group:GroupRollState|null=null,selectionKey='',groupSelectionKey='',dismissed='',sceneEpoch=deps.observation.sceneEpoch(),generation=0,groupRevision=0,disposed=false,busy=false;
 const publish=()=>deps.send('groupRollState',{group:group?structuredClone(group):null,groupRevision:++groupRevision});
 const control=(id:string,action:string)=>OBR.broadcast.sendMessage(GROUP_RESULT_CONTROL,{id,action},{destination:'ALL'});
 const close=()=>{const id=group?.id;generation++;group=null;busy=false;dismissed=selectionKey;if(id){clearTokenResults(id);void control(id,'close');}publish();};
 async function refreshSelection(){
  const observed=await deps.observation.read();if(disposed)return;
  if(!observed.ready||observed.role!=='GM'){if(group)close();selectionKey='';return;}
  if(sceneEpoch!==deps.observation.sceneEpoch()){sceneEpoch=deps.observation.sceneEpoch();if(group)close();selectionKey='';dismissed='';}
  const preparing=!!(observed.scene?.['com.initiative-tracker/combat'] as any)?.preparing,initialKind=preparing?'initiative' as const:'save' as const;
  const key=JSON.stringify([deps.observation.sceneEpoch(),observed.selection,preparing]);if(key===selectionKey)return;selectionKey=key;const epoch=++generation;
  if(group&&(group.phase!=='select'||group.adjustment?.pending))return;
  if(observed.selection.length<2||key===dismissed){group=null;publish();return;}
  if(observed.selection.length>100){groupSelectionKey=key;group={id:'group-'+crypto.randomUUID(),phase:'select',targets:[],selectedCount:observed.selection.length,visible:true,kind:initialKind,ability:'dex',variant:'normal',error:'单批最多 100 枚实体骰，当前选择超过 100 个单位；没有省略或投掷任何目标。'};publish();return;}
  const results=await Promise.allSettled(observed.selection.map(async id=>{const row=await deps.resolveTarget(id);return targetFromDocument(row.item,row.document,row.key);}));
  if(disposed||epoch!==generation)return;
  const targets=results.flatMap(row=>row.status==='fulfilled'?[row.value]:[]);
  groupSelectionKey=key;group=targets.length>=2?{id:'group-'+crypto.randomUUID(),phase:'select',targets,visible:true,kind:initialKind,ability:'dex',variant:'normal'}:null;publish();
 }
 async function handle(message:any){
  const observed=await deps.observation.read();if(observed.role!=='GM'||!observed.ready)throw Error('只有当前场景的 DM 可以操作群体区域');
  if(!group||message.id!==group.id)throw Error('群体区域已改变');
  if(message.action==='close'){close();return;}
  if(message.action==='visibility'){group.visible=!!message.visible;toggleTokenResults(group.id,group.visible);await control(group.id,group.visible?'show':'hide');publish();return;}
  if(busy)throw Error('群体操作正在进行');
  if(message.action==='roll'){
   if(group.adjustment?.pending)throw Error('先完成或关闭当前群体数值调整');
   if(group.phase!=='select')throw Error('本轮已投掷，请关闭后重新选择');
   if(!['save','ability','initiative'].includes(message.kind)||!abilities.includes(message.ability)||!['normal','adv','dis'].includes(message.variant))throw Error('无效群体投掷');
   const dicePerTarget=message.variant==='normal'?1:2,limit=100/dicePerTarget;
   if((group.selectedCount??group.targets.length)>limit||group.targets.length<2)throw Error(`${message.variant==='normal'?'普通':message.variant==='adv'?'优势':'劣势'}投掷需要选择 2 至 ${limit} 个有效单位（每目标 ${dicePerTarget} 枚，共不超过 100 枚实体骰）；没有投掷或省略任何目标。`);
   const current=group,id=group.id,operationEpoch=deps.observation.sceneEpoch();busy=true;current.phase='rolling';current.kind=message.kind;current.ability=message.ability;current.variant=message.variant;current.error=undefined;publish();
   try{
    // Recheck bindings/permissions and bonuses once at the transaction boundary.
    current.targets=await Promise.all(current.targets.map(async t=>{const row=await deps.resolveTarget(t.itemId);return targetFromDocument(row.item,row.document,row.key);}));
    if(group!==current)return;
    const title=message.kind==='initiative'?'先攻':labels[abilities.indexOf(message.ability)]+(message.kind==='save'?'豁免':'检定');
    const requests=current.targets.map(t=>{const bonus=message.kind==='initiative'?t.initiative:message.kind==='save'?t.saves[message.ability]:t.ability[message.ability];return {itemId:t.itemId,expression:`1d20${bonus>=0?'+':''}${bonus}`,label:title,advMode:message.variant==='normal'?undefined:message.variant,hidden:t.hidden||!!message.hidden||isGlobalDarkRollEnabled(),collectiveId:id};});
    const results=await submitDice3dGroup(requests,id);if(group!==current)return;
    current.targets=current.targets.map((target,i)=>({...target,result:results[i].total,hidden:!!results[i].hidden}));current.phase='resolve';
    setTokenResults(id,results,current.visible);
    if(message.kind==='initiative'){
     await Promise.all(current.targets.map(async target=>{const latest=await deps.resolveTarget(target.itemId);if(latest.key!==target.key)throw Error('目标关联已改变，先攻未写入');}));
     if(group!==current||operationEpoch!==deps.observation.sceneEpoch())throw Error('场景已改变，先攻未写入');
     const expected=new Set(current.targets.map(t=>t.itemId));await OBR.scene.items.updateItems([...expected],items=>{if(operationEpoch!==deps.observation.sceneEpoch())throw Error('场景已改变，先攻未写入');for(const item of items){const target=current.targets.find(t=>t.itemId===item.id)!;const raw=Number(target.result)-target.initiative;item.metadata['com.initiative-tracker/data']={...(item.metadata['com.initiative-tracker/data'] as object||{active:false}),count:raw,rolled:true};}});current.phase='settled';
    }
   }catch(error){if(group===current){current.error=String(error);if(!current.targets.some(t=>t.result!==undefined))current.phase='select';}throw error;}finally{if(group===current){busy=false;publish();}}
   return;
  }
  if(message.action==='settle'||message.action==='adjust'){
   const settlement=message.action==='settle';
   if(settlement?(group.kind==='initiative'||!['resolve','settled'].includes(group.phase)):group.phase!=='select')throw Error('当前群体区域不能执行此操作');
   const dc=message.dc==null?undefined:Number(message.dc),value=Number(message.value),mode=message.mode,field=message.field??'health';
   if(settlement&&mode==='damage'&&(!Number.isInteger(dc)||dc!<0||dc!>999)||!Number.isInteger(value)||value<0||value>99999||!['damage','heal','set'].includes(mode)||!['health','max health','armor class'].includes(field))throw Error('无效的 DC、数值或目标字段');
   if(group.targets.length<2||(group.selectedCount??group.targets.length)>100)throw Error('群体调整需要选择 2 至 100 个有效单位');
   if(group.targets.some(t=>t.uncertain))throw Error('有目标的回执不确定，请先核对数值，不能重复操作');
   const prior=group.adjustment,retry=settlement?group.targets.some(t=>t.applied):!!prior?.pending;
   if(retry&&(settlement?(group.dc!==dc||group.value!==value||group.mode!==mode||(group.field??'health')!==field):(prior!.field!==field||prior!.mode!==mode||prior!.value!==value)))throw Error('部分目标已处理，重试须沿用同一参数');
   const current=group;busy=true;current.error=undefined;
   if(settlement){current.dc=dc;current.value=value;current.mode=mode;current.field=field;}
   else{if(!retry)for(const target of current.targets){target.applied=false;target.error=undefined;}current.adjustment={field,mode,value,pending:true};}publish();
   try{for(const target of current.targets){if(target.applied)continue;try{const amount=settlement&&mode==='damage'&&Number(target.result)>=dc!?Math.floor(value/2):value;if(amount===0&&mode!=='set'){target.applied=true;target.error=undefined;continue;}await deps.applyDelta(target.itemId,{mode,value:amount,key:target.key,field});target.applied=true;target.error=undefined;}catch(error){target.uncertain=!!(error as any)?.uncertain;target.error=target.uncertain?'回执不确定，请核对数值；已阻止重复操作':String(error);}if(group!==current)break;}}
   finally{if(group===current){busy=false;const complete=current.targets.every(t=>t.applied);if(settlement)current.phase=complete?'settled':'resolve';else current.adjustment!.pending=!complete;publish();if(!settlement&&complete&&selectionKey!==groupSelectionKey){selectionKey='';void refreshSelection();}}}
   return;
  }
  throw Error('未知群体操作');
 }
 const stop=deps.observation.onChange(()=>{void refreshSelection().catch(error=>{if(group){group.error=String(error);publish();}});});void refreshSelection();
 return {handle,refreshSelection,revision:()=>groupRevision,snapshot:()=>group?structuredClone(group):null,dispose:()=>{disposed=true;stop();close();}};
}
