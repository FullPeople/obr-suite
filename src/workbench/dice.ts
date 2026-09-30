import {setupActivityPanel,ensureActivityPanel} from './activity-panel';
import OBR from '@owlbear-rodeo/sdk';
import {BROADCAST_DICE_ROLL,handleQuickRoll,showDiceEffect,normalizePayload,isGlobalDarkRollEnabled,openReplay,closeReplay,type DiceRollPayload,type QuickRollRequest} from '../modules/dice';
import {workbenchObservation} from './observation';
import {setupDice3d,teardownDice3d,submitDice3d,dice3dRpc} from './dice3d';
import {readFixedRoll} from '../modules/dice/fixed-roll';
export const rolls:DiceRollPayload[]=[];
export const rollListeners=new Set<()=>void>();
let unsubs:(()=>void)[]=[];
let startup:Promise<void>|undefined;
export function setupWorkbenchDice(){return startup??=startWorkbenchDice();}
async function startWorkbenchDice(){
 if(unsubs.length)return;
 const initial=await workbenchObservation().read(),connection=initial.player.connectionId;let replay='';
 setupActivityPanel();
 const historyKey=`obr-suite/dice/history:${String(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_')}`;
 try{const history=JSON.parse(localStorage.getItem(historyKey)||'[]');const {role,player:{id}}=initial;if(Array.isArray(history))rolls.push(...history.map(normalizePayload).filter(r=>r&&(!r.hidden||role==='GM'||r.rollerId===id)).slice(0,100) as DiceRollPayload[]);}catch{}
 unsubs.push(OBR.broadcast.onMessage(BROADCAST_DICE_ROLL,async event=>{
  if(event.connectionId!==connection||(event.data as any)?._3dConnection!==connection)return;
  const data=normalizePayload(event.data);
  if(!data||typeof data.rollId!=='string'||!Array.isArray(data.dice))return;
  (data as any)._3dConnection=(event.data as any)._3dConnection;
  const existing=rolls.findIndex(r=>r.rollId===data.rollId);if(existing>=0){if(rolls[existing].hidden&&!data.hidden){rolls[existing]=data;try{localStorage.setItem(historyKey,JSON.stringify(rolls.filter(r=>!r.hidden)));}catch{}rollListeners.forEach(fn=>fn());}return;}
  const {role,player:{id}}=await workbenchObservation().read();
  if((event.data as any)._3dConnection!==connection&&data.hidden&&role!=='GM'&&data.rollerId!==id)return;
  if(rolls.some(r=>r.rollId===data.rollId))return;
  rolls.unshift(data);rolls.splice(100);try{localStorage.setItem(historyKey,JSON.stringify(rolls.filter(r=>!r.hidden)));}catch{}rollListeners.forEach(fn=>fn());
  void ensureActivityPanel();
 }),OBR.broadcast.onMessage('com.obr-suite/dice-quick-roll',event=>{
  if(event.connectionId!==connection)return;
  void executeRoll(event.data as QuickRollRequest).catch(error=>{void OBR.notification.show(String(error),'ERROR');});
 }),OBR.broadcast.onMessage('com.obr-suite/dice3d-reveal',event=>{if(event.connectionId!==connection)return;void dice3dRpc('reveal',[(event.data as any)?.rollId]).catch(error=>OBR.notification.show(String(error),'ERROR'));}),OBR.broadcast.onMessage('com.obr-suite/dice-replay',event=>{const data=event.data as any;if(!data?.cid)return;void dice3dRpc(data.action==='close'?'clear':'replay',[data.cid]).catch(error=>OBR.notification.show(String(error),'ERROR'));}),OBR.broadcast.onMessage('com.obr-suite/dice-panel-toggle',()=>{void OBR.action.open();}));
 // Install all room subscriptions before opening the renderer, independent of any UI.
 await setupDice3d();
}
export function teardownWorkbenchDice(){teardownDice3d();startup=undefined;unsubs.splice(0).forEach(fn=>fn());rolls.length=0;rollListeners.forEach(fn=>fn());}
export async function executeRoll(req:QuickRollRequest){
 const expression=String(req.expression||'').replace(/\s/g,'');
 const {role,player}=await workbenchObservation().read();
 const request={...req,expression,label:String(req.label||'').slice(0,120),focus:false,hidden:role==='GM'&&(!!req.hidden||isGlobalDarkRollEnabled())};
 if(readFixedRoll())await handleQuickRoll(request,{id:player.id,name:player.name,color:player.color,role});
 else await submitDice3d(request);
}
