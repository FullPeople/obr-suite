import OBR from '@owlbear-rodeo/sdk';
import {closeHistory} from '../modules/dice';
import {ACTION_HISTORY_CHANNEL,actionTabKey} from './action-history-state';

// New Suite history belongs to the top-left action. Scene changes and dismissals
// use one lane so a late open cannot revive a surface from the previous scene.
let started=false,ready=false,connection='',generation=0;
let opening:Promise<void>|undefined,lane:Promise<void>=Promise.resolve();
type PanelChange={dismissedAt?:number};
const listeners=new Set<(event:PanelChange)=>void>();
export function onActivityPanelChange(fn:(event:PanelChange)=>void){listeners.add(fn);return()=>listeners.delete(fn);}
function changed(event:PanelChange={}){listeners.forEach(fn=>fn(event));}
export function ensureActivityPanel(_reanchor=false):Promise<void>{
 if(!ready)return Promise.resolve();
 try{sessionStorage.setItem(actionTabKey(String(OBR.room.id||'default')),'history');}catch{}
 if(opening)return opening;
 const own=generation;
 const task=lane.then(async()=>{
  if(own!==generation||!ready)return;
  await OBR.action.open();
  if(own!==generation||!ready)return;
  await OBR.broadcast.sendMessage(ACTION_HISTORY_CHANNEL,{latest:true},{destination:'LOCAL'});
 });
 lane=task.catch(error=>console.warn('[activity] action history open failed',error));
 opening=lane.finally(()=>{opening=undefined;});return opening;
}
export function setupActivityPanel(){
 if(started)return;started=true;
 const scene=(value:boolean)=>{generation++;ready=value;changed();};
 OBR.scene.onReadyChange(scene);
 OBR.action.onOpenChange(open=>{if(!open){generation++;changed({dismissedAt:performance.timeOrigin+performance.now()});}});
 OBR.broadcast.onMessage('com.obr-suite/dice-history-dismiss',event=>{
  if(event.connectionId!==connection)return;generation++;
  lane=lane.then(()=>OBR.action.close()).catch(error=>console.warn('[activity] close failed',error));changed({dismissedAt:(event.data as any)?.issuedAt});
 });
 const own=generation;
 void Promise.all([OBR.player.getConnectionId(),OBR.scene.isReady()]).then(([id,value])=>{connection=id;if(own===generation)scene(value);}).catch(error=>console.warn('[activity] startup failed',error));
 // Remove a prior-version floating surface; the stable plugin source is unchanged.
 void closeHistory().catch(()=>{});
}
