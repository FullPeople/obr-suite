import OBR from '@owlbear-rodeo/sdk';
import {CHANNEL} from '../../extensions/workbench-dice3d/src/types';
import {workbenchObservation} from './observation';
import type {DiceRollPayload} from '../modules/dice';
export type TokenResult={itemId:string;text:string;total:number;color:string;hidden:boolean};
let bus:BroadcastChannel|undefined,timer:ReturnType<typeof setTimeout>|undefined,flight=-1,generation=0,starting:Promise<void>|undefined,serial=0,epoch=-1;
const closed=new Set<string>(),visibility=new Map<string,boolean>();
const groups=new Map<string,{rows:TokenResult[];visible:boolean}>(),tracked=new Set<string>();
export async function setupTokenResults(){
 if(bus)return;if(starting)return starting;const own=generation;
 const task=(async()=>{const data=await workbenchObservation().read();if(own!==generation)return;
  bus=new BroadcastChannel(`${CHANNEL}:local:${data.player.connectionId}`);epoch=workbenchObservation().sceneEpoch();
  bus.onmessage=e=>{if(e.data?.type==='track-tokens'){tracked.clear();for(const id of e.data.ids||[])if(typeof id==='string')tracked.add(id);void refresh();}};void refresh();})();
 starting=task;try{await task;}finally{if(starting===task)starting=undefined;}
}
export function setTokenResults(id:string,rows:DiceRollPayload[],visible?:boolean){
 const currentEpoch=workbenchObservation().sceneEpoch();
 // Retire the previous scene before storing a result from the new one. With
 // an idle empty renderer, refresh may not have observed the ready transition.
 if(epoch!==-1&&epoch!==currentEpoch){epoch=currentEpoch;groups.clear();closed.clear();visibility.clear();tracked.clear();serial++;}
 if(closed.has(id))return;
 if(id.startsWith('history:')){
  for(const [key,group] of groups){
   if(key.startsWith('history:'))groups.delete(key);
   // Opening history replaces every existing automatic label. Remember that
   // dismissal so closing history or a late member cannot resurrect old rolls.
   else{group.visible=false;visibility.set(key,false);}
  }
  // Also dismiss the original roll if its automatic result has not arrived.
  // New roll IDs remain independent; explicit show can restore an old group.
  const original=id.slice('history:'.length);visibility.set(original,false);const group=groups.get(original);if(group)group.visible=false;
 }
 // The latest display control outranks the visibility captured when a roll
 // started; a late completion must not undo a subsequent cancellation.
 groups.set(id,{visible:visibility.get(id)??visible??groups.get(id)?.visible??true,rows:rows.filter(r=>r.itemId).map(r=>({itemId:r.itemId!,text:r.label||r.expression||'',total:r.total,color:r.rollerColor||'#fff',hidden:!!r.hidden}))});serial++;void setupTokenResults().then(refresh);
}
export function toggleTokenResults(id:string,visible:boolean){visibility.set(id,visible);const group=groups.get(id);if(group){group.visible=visible;serial++;void refresh();}}
export function clearTokenResults(id:string){if(id.startsWith('group-'))closed.add(id);if(closed.size>100)closed.delete(closed.values().next().value!);groups.delete(id);serial++;void refresh();}
export function resetTokenResults(){groups.clear();closed.clear();visibility.clear();tracked.clear();serial++;void refresh();}
export function teardownTokenResults(){generation++;starting=undefined;clearTimeout(timer);timer=undefined;bus?.close();bus=undefined;groups.clear();closed.clear();visibility.clear();tracked.clear();serial++;}
async function refresh(){
 if(!bus||flight===generation)return;const current=bus,ownGeneration=generation;let own=serial;clearTimeout(timer);flight=ownGeneration;
 try{
  const observation=workbenchObservation(),data=observation.peek();if(epoch!==observation.sceneEpoch()||!data.ready){
   const changed=epoch!==observation.sceneEpoch()||groups.size||closed.size||visibility.size||tracked.size;
   epoch=observation.sceneEpoch();groups.clear();closed.clear();visibility.clear();tracked.clear();if(changed)serial++;
   // This cleanup belongs to this refresh. Only a later external mutation
   // should request another pass; an unready scene is not a pending update.
   own=serial;
  }
  const ids=new Set([...tracked,...[...groups.values()].flatMap(g=>g.rows.map(r=>r.itemId))]);
  if(!ids.size){bus.postMessage({type:'token-results',groups:[],anchors:{}});return;}
  const [position,scale,dpi]=await Promise.all([OBR.viewport.getPosition(),OBR.viewport.getScale(),OBR.scene.grid.getDpi()]);if(bus!==current||generation!==ownGeneration||own!==serial||epoch!==observation.sceneEpoch())return;
  const anchors:Record<string,{x:number;y:number}>={};
  for(const item of data.items||[]){if(!ids.has(item.id)||data.role!=='GM'&&!item.visible)continue;const image=item as any,half=image.image?.height&&image.grid?.dpi?Math.abs(image.image.height/image.grid.dpi*dpi*(image.scale?.y??1))/2:dpi/2;
   anchors[item.id]={x:item.position.x*scale+position.x,y:(item.position.y-half)*scale+position.y-40};}
  const history=[...groups].find(([id,g])=>id.startsWith('history:')&&g.visible);
  bus.postMessage({type:'token-results',anchors,scale,groups:(history?[history]:[...groups]).map(([id,g])=>({id,visible:g.visible,rows:g.rows.filter(row=>anchors[row.itemId])}))});
 }catch(error){console.warn('[dice] token anchor update failed',error);}
 finally{if(flight===ownGeneration)flight=-1;if(bus===current&&generation===ownGeneration){if(own!==serial)queueMicrotask(()=>void refresh());else if(groups.size||tracked.size)timer=setTimeout(()=>void refresh(),100);}}
}
