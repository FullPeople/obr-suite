import OBR, {type Item, type Player} from '@owlbear-rodeo/sdk';
import {workbenchItemsSignature} from './item-observation';

type ObservationChange = 'data'|'selection';
type Observation = {
 ready:boolean; scene:Record<string,unknown>; room:Record<string,unknown>;
 items:Item[]; role:'GM'|'PLAYER'; party:Player[]; selection:string[]; player:Player;
};

// SDK getters are cross-frame RPCs, not local getters. Keep their initial values
// and replace them with the complete values supplied by SDK change events.
// Subscribe before reading: an initial RPC must never overwrite a newer event.
function createObservation(){
 const values:Partial<Observation>={},versions=new Map<keyof Observation,number>();
 let flight:Promise<Observation>|undefined,authorityFlight:Promise<Observation>|undefined,sceneEpoch=0,serial=0,authoritySerial=0,authorityScope=0;
 const authorityTargets=new Map<string,number>();
 const bumpAuthority=(id:string)=>authorityTargets.set(id,(authorityTargets.get(id)||0)+1);
 const authorityItems=(items:Item[])=>JSON.stringify(items.map(item=>[item.id,item.createdUserId,item.metadata['com.character-cards/boundCardId'],item.metadata['com.bestiary/slug'],item.metadata['com.obr-suite/workbench/locked']]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 const identityChanged=(player:Player)=>{if(values.player&&(values.player.id!==player.id||values.player.connectionId!==player.connectionId)){authoritySerial++;authorityScope++;}};
 const subscribers=new Set<(change:ObservationChange)=>void>();
 const set=<K extends keyof Observation>(key:K,value:Observation[K])=>{values[key]=value;versions.set(key,(versions.get(key)||0)+1);};
 const notify=(change:ObservationChange='data')=>{if(change==='data')serial++;for(const listener of subscribers)listener(change);};
 const event=<K extends keyof Observation>(key:K,value:Observation[K])=>{
  if(key==='player')identityChanged(value as Player);
  if(key==='items'&&authorityItems(values.items||[])!==authorityItems(value as Item[])){
   authoritySerial++;const previous=new Map((values.items||[]).map(item=>[item.id,item])),next=new Map((value as Item[]).map(item=>[item.id,item]));
   for(const id of new Set([...previous.keys(),...next.keys()])){const before=previous.get(id),after=next.get(id);if(authorityItems(before?[before]:[])===authorityItems(after?[after]:[]))continue;bumpAuthority('token:'+id);for(const cardId of new Set([before?.metadata['com.character-cards/boundCardId'],after?.metadata['com.character-cards/boundCardId']]))if(typeof cardId==='string')bumpAuthority('card:'+cardId);}
  }
  if(key==='role'&&values.role!==value){authoritySerial++;authorityScope++;}
  const relevant=key==='player'?values.player?.id!==(value as Player).id||values.player?.connectionId!==(value as Player).connectionId:key==='role'?values.role!==value:key!=='items'||workbenchItemsSignature((values.items||[]))!==workbenchItemsSignature(value as Item[]);
  set(key,value);if(relevant)notify();
 };
 OBR.scene.items.onChange(items=>event('items',items));
 OBR.scene.onMetadataChange(scene=>event('scene',scene));
 OBR.room.onMetadataChange(room=>event('room',room));
 const profile=(player:Partial<Player>)=>{const {selection,syncView,...value}=player;return value;};
 OBR.party.onChange(party=>{
  const changed=JSON.stringify((values.party||[]).map(profile))!==JSON.stringify(party.map(profile));
  set('party',party);if(changed)notify();
 });
 OBR.player.onChange(player=>{
  // Selection arrives in the same SDK event as profile/permission changes. It
  // does not invalidate the card catalog or require reconciling every card.
  const {selection}=player;
  const profileChanged=JSON.stringify(profile(values.player||{}))!==JSON.stringify(profile(player));
  const selectionChanged=JSON.stringify(values.selection||[])!==JSON.stringify(selection||[]);
  if(values.role!==player.role){authoritySerial++;authorityScope++;}
  identityChanged(player);set('player',player);set('role',player.role);set('selection',selection||[]);
  if(profileChanged)notify();else if(selectionChanged)notify('selection');
 });
 OBR.scene.onReadyChange(ready=>{
  sceneEpoch++;authoritySerial++;authorityScope++;set('ready',ready);set('items',[]);set('scene',{});
  if(ready){delete values.items;delete values.scene;}notify();
 });
 async function fill<K extends keyof Observation>(key:K,read:()=>Promise<Observation[K]>){
  if(values[key]!==undefined)return;
  const version=versions.get(key)||0,result=await read();
  if((versions.get(key)||0)===version)set(key,result);
 }
 async function read():Promise<Observation>{
  if(['ready','scene','room','items','role','party','selection','player'].every(key=>values[key as keyof Observation]!==undefined))return {...values} as Observation;
  if(flight){await flight;return read();}
  const task=(async()=>{
   const epoch=sceneEpoch;
   await fill('ready',()=>OBR.scene.isReady());
   await Promise.all([
    fill('scene',()=>values.ready?OBR.scene.getMetadata():Promise.resolve({})),
    fill('items',()=>values.ready?OBR.scene.items.getItems():Promise.resolve([])),
    fill('room',()=>OBR.room.getMetadata()),fill('party',()=>OBR.party.getPlayers()),
    fill('selection',async()=>await OBR.player.getSelection()||[]),fill('role',()=>OBR.player.getRole()),
    fill('player',async()=>{const [id,connectionId,name,color,role,metadata,selection]=await Promise.all([OBR.player.getId(),OBR.player.getConnectionId(),OBR.player.getName(),OBR.player.getColor(),OBR.player.getRole(),OBR.player.getMetadata(),OBR.player.getSelection()]);return {id,connectionId,name,color,role,metadata,selection,syncView:false};})
   ]);
   if(epoch!==sceneEpoch)return values as Observation;
   return {...values} as Observation;
  })();flight=task;
  try{await task;}finally{if(flight===task)flight=undefined;}
  return read();
 }
 // Event caches keep selection responsive; the final mutation boundary must
 // also recover a missed owner event from Owlbear's authoritative getters.
 async function refreshAuthority():Promise<Observation>{
  if(authorityFlight)return authorityFlight;
  const task=(async()=>{await read();const epoch=sceneEpoch;
   const refresh=async<K extends keyof Observation>(key:K,get:()=>Promise<Observation[K]>)=>{const version=versions.get(key)||0,value=await get();if(epoch===sceneEpoch&&(versions.get(key)||0)===version)event(key,value);};
   await Promise.all([refresh('player',async()=>{const [id,connectionId]=await Promise.all([OBR.player.getId(),OBR.player.getConnectionId()]);return {...values.player!,id,connectionId};}),refresh('role',()=>OBR.player.getRole()),refresh('items',()=>values.ready?OBR.scene.items.getItems():Promise.resolve([]))]);
   if(epoch!==sceneEpoch)throw Error('场景已改变，请重新选择角色卡');
   return read();
  })();authorityFlight=task;try{return await task;}finally{if(authorityFlight===task)authorityFlight=undefined;}
 }
 async function refreshCatalog():Promise<Observation>{
  await refreshAuthority();const epoch=sceneEpoch;
  const refresh=async(key:'scene'|'room',get:()=>Promise<Record<string,unknown>>)=>{const version=versions.get(key)||0,value=await get();if(epoch===sceneEpoch&&(versions.get(key)||0)===version)event(key,value);};
  await Promise.all([refresh('room',()=>OBR.room.getMetadata()),refresh('scene',()=>values.ready?OBR.scene.getMetadata():Promise.resolve({}))]);
  if(epoch!==sceneEpoch)throw Error('场景已改变，请重新刷新目录');return read();
 }
 return {read,refreshAuthority,refreshCatalog,authorityVersion:(target?:string)=>target===undefined?authoritySerial:`${authorityScope}:${authorityTargets.get(target.startsWith('card:')?target:'token:'+target.replace(/^(monster|token):/,''))||0}`,peek:()=>values,version:()=>serial,sceneEpoch:()=>sceneEpoch,onChange:(listener:(change:ObservationChange)=>void)=>{subscribers.add(listener);return()=>subscribers.delete(listener);}};
}
let instance:ReturnType<typeof createObservation>|undefined;
export const workbenchObservation=()=>instance??=createObservation();
