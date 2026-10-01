import {canSeeDiceHistory,diceHistory,storedDiceHistory} from '../modules/dice/history-policy';
import {setupTokenResults,setTokenResults,toggleTokenResults,clearTokenResults,resetTokenResults,teardownTokenResults} from './token-results';
import {setupActivityPanel,ensureActivityPanel} from './activity-panel';
import OBR from '@owlbear-rodeo/sdk';
import {BROADCAST_DICE_ROLL,handleQuickRoll,showDiceEffect,normalizePayload,isGlobalDarkRollEnabled,openReplay,closeReplay,type DiceRollPayload,type QuickRollRequest} from '../modules/dice';
import {workbenchObservation} from './observation';
import {setupDice3d,teardownDice3d,submitDice3d,dice3dRpc} from './dice3d';
import {readFixedRoll} from '../modules/dice/fixed-roll';
export const rolls:DiceRollPayload[]=[];
export function getRollHistory(){const {role,player}=workbenchObservation().peek();return diceHistory(rolls,{role:role||'',playerId:player?.id||''});}
export function canForwardDiceHistory(event:{connectionId:string;data:unknown}){const {role,player}=workbenchObservation().peek(),data=normalizePayload(event.data);return !!data&&event.connectionId===player?.connectionId&&(event.data as any)?._3dConnection===player?.connectionId&&canSeeDiceHistory(data,{role:role||'',playerId:player?.id||''});}
export const rollListeners=new Set<()=>void>();
let unsubs:(()=>void)[]=[];
let startup:Promise<void>|undefined,generation=0;
export function setupWorkbenchDice(){return startup??=startWorkbenchDice(generation);}
async function startWorkbenchDice(own:number){
 if(unsubs.length)return;
 const initial=await workbenchObservation().read();if(own!==generation)return;const connection=initial.player.connectionId;let replay='';
 setupActivityPanel();
 const historyKey=`obr-suite/dice/history:${String(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_')}`;
 try{const history=JSON.parse(localStorage.getItem(historyKey)||'[]');if(Array.isArray(history))rolls.push(...storedDiceHistory(history.map(normalizePayload).filter(Boolean) as DiceRollPayload[]));}catch{}
 const persist=()=>{try{localStorage.setItem(historyKey,JSON.stringify(storedDiceHistory(rolls)));}catch{}};
 persist();let viewerKey=initial.role+':'+initial.player.id;
 unsubs.push(workbenchObservation().onChange(()=>{const {role,player}=workbenchObservation().peek(),key=role+':'+player?.id;if(own!==generation||key===viewerKey)return;viewerKey=key;resetTokenResults();replay='';rollListeners.forEach(fn=>fn());}));
 unsubs.push(OBR.broadcast.onMessage('com.obr-suite/workbench/group-result-control',event=>{void (async()=>{const data=event.data as any,observed=await workbenchObservation().read(),sender=event.connectionId===connection?observed.player:observed.party.find(p=>p.connectionId===event.connectionId);if(own!==generation||sender?.role!=='GM'||typeof data?.id!=='string'||!data.id.startsWith('group-'))return;if(data.action==='close')clearTokenResults(data.id);else if(data.action==='hide'||data.action==='show')toggleTokenResults(data.id,data.action==='show');})();}),OBR.broadcast.onMessage(BROADCAST_DICE_ROLL,async event=>{
  if(own!==generation||event.connectionId!==connection||(event.data as any)?._3dConnection!==connection)return;
  const data=normalizePayload(event.data);
  if(!data||typeof data.rollId!=='string'||!Array.isArray(data.dice))return;
  (data as any)._3dConnection=(event.data as any)._3dConnection;
  await workbenchObservation().read();if(own!==generation||!canForwardDiceHistory(event))return;
  const existing=rolls.find(r=>r.rollId===data.rollId);
  if(existing&&(!existing.hidden||data.hidden))return;
  const next=storedDiceHistory([data,...rolls]);rolls.splice(0,rolls.length,...next);persist();rollListeners.forEach(fn=>fn());
  if(data.collectiveId?.startsWith('group-'))setTokenResults(data.collectiveId,getRollHistory().filter(row=>row.collectiveId===data.collectiveId));
  void ensureActivityPanel();
 }),OBR.broadcast.onMessage('com.obr-suite/dice-quick-roll',event=>{
  if(event.connectionId!==connection)return;
  void executeRoll(event.data as QuickRollRequest).catch(error=>{void OBR.notification.show(String(error),'ERROR');});
 }),OBR.broadcast.onMessage('com.obr-suite/dice3d-reveal',event=>{if(event.connectionId!==connection)return;void dice3dRpc('reveal',[(event.data as any)?.rollId]).catch(error=>OBR.notification.show(String(error),'ERROR'));}),OBR.broadcast.onMessage('com.obr-suite/dice-replay',event=>{
  if(own!==generation||event.connectionId!==connection)return;const data=event.data as any;
  if(typeof data?.cid!=='string'||!data.cid||!['open','toggle','close'].includes(data.action))return;
  // A delayed close for the previous row must not clear the current selection.
  if(data.action==='close'&&replay!==data.cid)return;
  if(data.action==='close'||data.action==='toggle'&&replay===data.cid){clearTokenResults(`history:${data.cid}`);replay='';}
  else{const rows=getRollHistory().filter(row=>row.rollId===data.cid||row.collectiveId===data.cid);if(!rows.length)return;if(replay)clearTokenResults(`history:${replay}`);replay=data.cid;setTokenResults(`history:${data.cid}`,rows);}
 }),OBR.broadcast.onMessage('com.obr-suite/dice-panel-toggle',event=>{if(own===generation&&event.connectionId===connection)void OBR.action.open();}));
 // Install all room subscriptions before opening the renderer, independent of any UI.
 await Promise.all([setupDice3d(),setupTokenResults()]);
}
export function teardownWorkbenchDice(){generation++;teardownDice3d();teardownTokenResults();startup=undefined;unsubs.splice(0).forEach(fn=>fn());rolls.length=0;rollListeners.forEach(fn=>fn());}
export async function executeRoll(req:QuickRollRequest){
 const own=generation,expression=String(req.expression||'').replace(/\s/g,'');
 const {role,player}=await workbenchObservation().read();if(own!==generation)throw Error('投骰模块已关闭');
 const request={...req,expression,label:String(req.label||'').slice(0,120),focus:false,hidden:role==='GM'&&(!!req.hidden||isGlobalDarkRollEnabled())};
 if(readFixedRoll())await handleQuickRoll(request,{id:player.id,name:player.name,color:player.color,role});
 else await submitDice3d(request);
}
