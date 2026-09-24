import OBR from '@owlbear-rodeo/sdk';
import {getState} from '../state';
import type {Relay} from './relay';
import {workbenchObservation} from './observation';
const KEY='com.obr-suite/workbench/shared',CHANGED='com.obr-suite/workbench/shared-changed';
export const defaultRules=()=>({edition:'2024',sourceMode:'both',profile:{enabledSources:['PHB','XPHB'],optional:{feats:true,multiclass:false,legacy:false},exceptions:{}},packs:[],customEntries:[]});
export function sharedDocuments(relay:Relay){
 let cache:{key:string;revision:number;data:any}|undefined;
 const room=(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_');
 async function scope(){
  const global=getState().crossSceneSyncSettings,api=global?OBR.room:OBR.scene;
  const observed=await workbenchObservation().read();
  if(!global&&!observed.ready)return null;
  const metadata=global?observed.room:observed.scene;let index=metadata[KEY] as {id:string;revision:number}|undefined;
  if(!index?.id&&observed.role==='GM'){
   index={id:global?'room':crypto.randomUUID(),revision:0};await api.setMetadata({[KEY]:index});
   // Concurrent GM initialization resolves to the index the host actually stored.
   index=(await api.getMetadata())[KEY] as typeof index;
  }
  return {api,index,key:global?`${room}_room`:index?.id?`${room}_${index.id}`:'',scope:global?'room':'scene'};
 }
 async function read(force=false){
  const current=await scope();if(!current?.key)return {key:'',revision:0,scope:current?.scope||'scene',rules:defaultRules()};
  if(force||!cache||cache.key!==current.key||cache.revision<(current.index?.revision||0)){
   const result=await relay.send({sharedDocument:{key:current.key,operation:'read'}});cache={key:current.key,...result};
  }
  return {key:current.key,scope:current.scope,revision:cache!.revision,rules:cache!.data?.rules||defaultRules()};
 }
 async function write(message:any){
  if(await OBR.player.getRole()!=='GM')throw Error('只有 DM 可以调整规则与扩展');
  const current=await scope();if(!current?.key||message.scopeKey!==current.key)throw Error('规则作用域已经切换');
  const rules=message.rules;
  if(!rules||!['2014','2024'].includes(rules.edition)||!['full','short','both'].includes(rules.sourceMode)||!Array.isArray(rules.profile?.enabledSources)||!rules.profile.optional||!rules.profile.exceptions||!Array.isArray(rules.packs)||!Array.isArray(rules.customEntries)||JSON.stringify(rules).length>5_000_000)throw Error('规则配置无效');
  await read(true);
  if(await OBR.player.getRole()!=='GM'||(await scope())?.key!==current.key)throw Error('规则作用域或权限已经改变');
  const result=await relay.send({sharedDocument:{key:current.key,operation:'write',expected:message.expected,data:{...cache?.data,rules}}});
  cache={key:current.key,...result};
  if((await scope())?.key===current.key)await current.api.setMetadata({[KEY]:{id:current.index!.id,revision:result.revision}});
  await OBR.broadcast.sendMessage(CHANGED,{key:current.key},{destination:'ALL'});
  return {key:current.key,scope:current.scope,revision:result.revision,rules};
 }
 const invalidate=()=>{cache=undefined;};
 OBR.broadcast.onMessage(CHANGED,invalidate);OBR.scene.onReadyChange(invalidate);
 return {read,write,invalidate};
}
