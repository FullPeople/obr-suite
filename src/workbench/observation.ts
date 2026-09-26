import OBR, {type Item, type Player} from '@owlbear-rodeo/sdk';
import {workbenchItemsSignature} from './item-observation';

type Observation = {
 ready:boolean; scene:Record<string,unknown>; room:Record<string,unknown>;
 items:Item[]; role:'GM'|'PLAYER'; party:Player[]; selection:string[]; player:Player;
};

// SDK getters are cross-frame RPCs, not local getters. Keep their initial values
// and replace them with the complete values supplied by SDK change events.
// Subscribe before reading: an initial RPC must never overwrite a newer event.
function createObservation(){
 const values:Partial<Observation>={},versions=new Map<keyof Observation,number>();
 let flight:Promise<Observation>|undefined,sceneEpoch=0,serial=0;
 const subscribers=new Set<()=>void>();
 const set=<K extends keyof Observation>(key:K,value:Observation[K])=>{values[key]=value;versions.set(key,(versions.get(key)||0)+1);};
 const notify=()=>{serial++;for(const listener of subscribers)listener();};
 const event=<K extends keyof Observation>(key:K,value:Observation[K])=>{
  const relevant=key!=='items'||workbenchItemsSignature((values.items||[]))!==workbenchItemsSignature(value as Item[]);
  set(key,value);if(relevant)notify();
 };
 OBR.scene.items.onChange(items=>event('items',items));
 OBR.scene.onMetadataChange(scene=>event('scene',scene));
 OBR.room.onMetadataChange(room=>event('room',room));
 OBR.party.onChange(party=>event('party',party));
 OBR.player.onChange(player=>{
  set('player',player);set('role',player.role);set('selection',player.selection||[]);notify();
 });
 OBR.scene.onReadyChange(ready=>{
  sceneEpoch++;set('ready',ready);set('items',[]);set('scene',{});
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
 return {read,peek:()=>values,version:()=>serial,onChange:(listener:()=>void)=>{subscribers.add(listener);return()=>subscribers.delete(listener);}};
}
let instance:ReturnType<typeof createObservation>|undefined;
export const workbenchObservation=()=>instance??=createObservation();
