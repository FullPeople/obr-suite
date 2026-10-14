import OBR from '@owlbear-rodeo/sdk';
import {canSeeDiceHistory,diceHistory,storedDiceHistory} from '../modules/dice/history-policy';
import {setupTokenResults,setTokenResults,toggleTokenResults,clearTokenResults,resetTokenResults,teardownTokenResults} from './token-results';
import {setupActivityPanel,ensureActivityPanel} from './activity-panel';
import {BROADCAST_DICE_ROLL,isGlobalDarkRollEnabled,type DiceRollPayload,type QuickRollRequest} from '../modules/dice';
import {diceIdentity,resetDiceIdentity,type DiceIdentity} from './dice-identity';
import {calculateLightRoll,launchLightResult} from './dice-light-engine';
import {serveLightDice} from './dice-light-submit';
import {readFixedRoll} from '../modules/dice/fixed-roll';
const CHANNEL='com.obr-suite/workbench-dice3d.v1',MODAL='com.obr-suite/dice-light-overlay';
export const rolls:DiceRollPayload[]=[];
export const rollListeners=new Set<()=>void>();
export const rollStates=new Map<string,'received'|'started'|'result'|'complete'>();
let player:DiceIdentity|undefined,bus:BroadcastChannel|undefined,rendererReady=false,generation=0,startup:Promise<void>|undefined;
let unsubs:(()=>void)[]=[],party:any[]=[],historyKey='';
const queued=new Map<string,DiceRollPayload>(),seen=new Set<string>(),commands=new Map<string,Promise<DiceRollPayload>>();
const report=(error:unknown)=>console.warn('[dice-light]',error);
export function getRollHistory(){return diceHistory(rolls,{role:player?.role||'',playerId:player?.id||''});}
export function canForwardDiceHistory(event:{connectionId:string;data:unknown}){return event.connectionId===player?.connectionId&&validResult(event.data)&&canSeeDiceHistory(event.data,{role:player?.role||'',playerId:player?.id||''});}
function validResult(p:any):p is DiceRollPayload{return !!p&&typeof p.rollId==='string'&&p.rollId.length<=120&&typeof p.rollerId==='string'&&Array.isArray(p.dice)&&p.dice.length>0&&p.dice.length<=100&&Number.isFinite(p.total)&&Number.isFinite(p.modifier)&&Number.isFinite(p.ts)&&p.dice.every((d:any)=>/^d\d{1,4}$/.test(d.type)&&Number.isSafeInteger(d.value)&&Math.abs(d.value)<=1e9);}
function remember(p:DiceRollPayload){
 if(!player||!canSeeDiceHistory(p,{role:player.role,playerId:player.id}))return;
 const existing=rolls.find(r=>r.rollId===p.rollId);if(existing&&(!existing.hidden||p.hidden))return;
 rolls.splice(0,rolls.length,...storedDiceHistory([p,...rolls]));
 try{localStorage.setItem(historyKey,JSON.stringify(storedDiceHistory(rolls)));}catch{}
 rollListeners.forEach(fn=>fn());void ensureActivityPanel().catch(report);
 void OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL,p,{destination:'LOCAL'}).catch(report);
}
function play(p:DiceRollPayload){
 if(seen.has(p.rollId))return;seen.add(p.rollId);if(seen.size>1000)seen.delete(seen.values().next().value!);
 rollStates.set(p.rollId,'received');if(rollStates.size>1000)rollStates.delete(rollStates.keys().next().value!);
 if(rendererReady)bus?.postMessage({type:'roll',payload:p});else queued.set(p.rollId,p);
}
export function setupWorkbenchDice(){return startup??=startDice(generation);}
async function startDice(own:number){
 const profile=await diceIdentity();if(own!==generation)return;player=profile;
 historyKey=`obr-suite/dice/history:${String(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_')}`;
 try{const prior=JSON.parse(localStorage.getItem(historyKey)||'[]');if(Array.isArray(prior))rolls.push(...storedDiceHistory(prior));}catch{}
 bus=new BroadcastChannel(`${CHANNEL}:local:${profile.connectionId}`);
 bus.onmessage=event=>{
  if(own!==generation)return;const m=event.data;
  if(m.type==='overlay-ready'){rendererReady=true;for(const p of queued.values())bus!.postMessage({type:'roll',payload:p});queued.clear();}
  else if(['started','result','complete'].includes(m.type)&&typeof m.rollId==='string'&&seen.has(m.rollId)){
   rollStates.set(m.rollId,m.type);
   if(m.type==='result'){const p=rolls.find(r=>r.rollId===m.rollId);if(p?.itemId)setTokenResults(p.collectiveId||p.rollId,getRollHistory().filter(r=>(r.collectiveId||r.rollId)===(p.collectiveId||p.rollId)));void OBR.broadcast.sendMessage('com.obr-suite/dice-fade-start',{rollId:m.rollId},{destination:'LOCAL'}).catch(report);}
  }else if(m.type==='sfx')void OBR.broadcast.sendMessage('com.obr-suite/sfx',m.data,{destination:'LOCAL'}).catch(report);
 };
 unsubs.push(serveLightDice(profile.connectionId,executeRoll));
 unsubs.push(OBR.party.onChange(p=>{party=p;}));void OBR.party.getPlayers().then(p=>{if(own===generation)party=p;}).catch(report);
 unsubs.push(OBR.player.onChange(p=>{if(own!==generation)return;const before=player?.role;Object.assign(profile,p);if(before!==profile.role){resetTokenResults();bus?.postMessage({type:'clear'});rollListeners.forEach(fn=>fn());}}));
 unsubs.push(OBR.broadcast.onMessage(BROADCAST_DICE_ROLL,event=>{
  if(own!==generation||event.connectionId===profile.connectionId||!validResult(event.data))return;
  const p=event.data,sender=party.find(peer=>peer.connectionId===event.connectionId);
  if(sender&&sender.id!==p.rollerId||p.hidden&&sender?.role!=='GM'||!canSeeDiceHistory(p,{role:profile.role,playerId:profile.id}))return;
  play(p);queueMicrotask(()=>remember(p));
 }));
 unsubs.push(OBR.broadcast.onMessage('com.obr-suite/dice-quick-roll',event=>{if(event.connectionId===profile.connectionId)void executeRoll(event.data as QuickRollRequest).catch(report);}));
 unsubs.push(OBR.broadcast.onMessage('com.obr-suite/dice3d-reveal',event=>{if(event.connectionId===profile.connectionId)void lightDiceRpc('reveal',[(event.data as any)?.rollId]).catch(report);}));
 unsubs.push(OBR.broadcast.onMessage('com.obr-suite/dice-light-history-request',event=>{if(event.connectionId!==profile.connectionId)return;for(const p of getRollHistory())void OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL,p,{destination:'LOCAL'}).catch(report);}));
 unsubs.push(OBR.broadcast.onMessage('com.obr-suite/dice-replay',event=>{if(event.connectionId!==profile.connectionId)return;const m=event.data as any,id=`history:${m?.cid}`;if(m?.action==='close')clearTokenResults(id);else if(['open','toggle'].includes(m?.action))setTokenResults(id,getRollHistory().filter(r=>r.rollId===m.cid||r.collectiveId===m.cid));}));
 unsubs.push(OBR.broadcast.onMessage('com.obr-suite/workbench/group-result-control',event=>{const sender=event.connectionId===profile.connectionId?profile:party.find(p=>p.connectionId===event.connectionId),m=event.data as any;if(sender?.role!=='GM'||typeof m?.id!=='string'||!m.id.startsWith('group-'))return;if(m.action==='close')clearTokenResults(m.id);else if(['hide','show'].includes(m.action))toggleTokenResults(m.id,m.action==='show');}));
 setupActivityPanel();void setupTokenResults().catch(report);
 void OBR.modal.open({id:MODAL,url:`/suite-dev/workbench-dice/overlay2d.html?client=${encodeURIComponent(profile.connectionId)}`,fullScreen:true,hideBackdrop:true,hidePaper:true,disablePointerEvents:true}).catch(report);
}
export async function executeRoll(req:QuickRollRequest&{commandId?:string;rollId?:string;autoDismiss?:boolean;fixedRaw?:boolean}):Promise<DiceRollPayload>{
 await setupWorkbenchDice();const id=req.commandId||crypto.randomUUID(),previous=commands.get(id);if(previous)return previous;
 const own=generation;
 const task=(async()=>{
  const identity=await diceIdentity();if(own!==generation)throw Error('投骰模块已关闭');
  const itemId=await resolveDiceTarget(req.itemId,identity);if(own!==generation)throw Error('投骰场景已改变');
  const p=calculateLightRoll({...req,itemId,hidden:identity.role==='GM'&&(!!req.hidden||isGlobalDarkRollEnabled())},identity);
  launchLightResult(p,play,payload=>payload.hidden?Promise.resolve():OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL,payload,{destination:'REMOTE'}),remember,report);
  if(identity.role==='GM'&&!req.collectiveId&&readFixedRoll())void OBR.notification.show('本次公式无法达到固定值，已真实投掷；固定下次保持开启。','WARNING').catch(report);
  return p;
 })();commands.set(id,task);if(commands.size>1000)commands.delete(commands.keys().next().value!);return task;
}
export async function resolveDiceTarget(id:unknown,identity?:DiceIdentity):Promise<string|null>{
 if(!id)return null;if(typeof id!=='string'||id.length>200)throw Error('无效投骰目标');const p=identity||await diceIdentity();
 if(id.startsWith('card:'))return null;
 const token=id.startsWith('monster:')?id.slice(8):id;
 const [item]=await OBR.scene.items.getItems([token]);if(!item||p.role!=='GM'&&!item.visible)throw Error('投骰目标不存在或不可见');return item.id;
}
export async function lightDiceRpc(method:string,args:any[]){
 await setupWorkbenchDice();if(method==='history')return getRollHistory();
 if(method==='clear'){bus?.postMessage({type:'clear'});return;}
 if(method==='status')return {ready:true,mode:'2d',physics:false};
 if(method==='reveal'){
  if(player?.role!=='GM')throw Error('只有 DM 可以公开暗骰');const p=rolls.find(r=>r.rollId===args[0]&&r.rollerId===player?.id&&r.hidden);if(!p)throw Error('只能公开自己的暗骰');
  const revealed={...p,hidden:false,visibility:'all' as const};remember(revealed);void OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL,revealed,{destination:'REMOTE'}).catch(report);return;
 }throw Error('3D 暂不可用');
}
export function teardownWorkbenchDice(){generation++;unsubs.splice(0).forEach(fn=>fn());teardownTokenResults();resetDiceIdentity();bus?.close();bus=undefined;startup=undefined;player=undefined;rendererReady=false;queued.clear();seen.clear();commands.clear();rolls.length=0;rollStates.clear();void OBR.modal.close(MODAL).catch(report);rollListeners.forEach(fn=>fn());}
