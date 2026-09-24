import OBR from '@owlbear-rodeo/sdk';
import {openHistory,closeHistory} from '../modules/dice';
import {onViewportResize} from '../utils/viewportAnchor';
import {BC_PANEL_DRAG_END,BC_PANEL_RESET,PANEL_IDS} from '../utils/panelLayout';

// The activity surface outlives individual feature toggles, including dice.
let started=false,ready=false,visible=false,wanted=false,connection='',generation=0;
let opening:Promise<void>|undefined;
let lane:Promise<void>=Promise.resolve();
type PanelChange={dismissedAt?:number};
const listeners=new Set<(event:PanelChange)=>void>();
export function onActivityPanelChange(fn:(event:PanelChange)=>void){listeners.add(fn);return()=>listeners.delete(fn);}
function changed(event:PanelChange={}){listeners.forEach(fn=>fn(event));}
export function ensureActivityPanel(reanchor=false):Promise<void>{
 if(!ready)return Promise.resolve();
 wanted=true;
 if(opening)return opening;
 if(visible&&!reanchor)return Promise.resolve();
 const own=generation;visible=true;changed();
 const task=lane.then(async()=>{if(own===generation&&ready&&wanted)await openHistory('all');});
 lane=task.catch(error=>{visible=false;console.warn('[activity] open failed',error);});
 opening=lane.finally(()=>{opening=undefined;if(own!==generation&&ready&&wanted&&!visible)void ensureActivityPanel();});
 return opening;
}
function close(){lane=lane.then(()=>closeHistory()).catch(error=>console.warn('[activity] close failed',error));}
export function setupActivityPanel(){
 if(started)return;started=true;
 const scene=(value:boolean)=>{generation++;ready=value;visible=false;wanted=value;changed();if(value)void ensureActivityPanel();else close();};
 OBR.scene.onReadyChange(scene);
 const reanchor=()=>{if(visible)void ensureActivityPanel(true);};
 onViewportResize(reanchor);
 OBR.broadcast.onMessage('com.obr-suite/dice-history-dismiss',event=>{if(event.connectionId!==connection)return;generation++;visible=false;wanted=false;close();changed({dismissedAt:(event.data as any)?.issuedAt});});
 OBR.broadcast.onMessage(BC_PANEL_DRAG_END,event=>{if(event.connectionId===connection&&(event.data as any)?.panelId===PANEL_IDS.diceHistory)reanchor();});
 OBR.broadcast.onMessage(BC_PANEL_RESET,event=>{if(event.connectionId===connection)reanchor();});
 const own=generation;
 void Promise.all([OBR.player.getConnectionId(),OBR.scene.isReady()]).then(([id,value])=>{connection=id;if(own===generation)scene(value);}).catch(error=>console.warn('[activity] startup failed',error));
}
