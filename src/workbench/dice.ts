import {setupActivityPanel,ensureActivityPanel} from './activity-panel';
import OBR from '@owlbear-rodeo/sdk';
import {BROADCAST_DICE_ROLL,handleQuickRoll,showDiceEffect,normalizePayload,isGlobalDarkRollEnabled,openReplay,closeReplay,type DiceRollPayload,type QuickRollRequest} from '../modules/dice';
import {workbenchObservation} from './observation';
export const rolls:DiceRollPayload[]=[];
export const rollListeners=new Set<()=>void>();
let unsubs:(()=>void)[]=[];
export async function setupWorkbenchDice(){
 if(unsubs.length)return;
 const initial=await workbenchObservation().read(),connection=initial.player.connectionId;let replay='';
 setupActivityPanel();
 const historyKey=`obr-suite/dice/history:${String(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_')}`;
 try{const history=JSON.parse(localStorage.getItem(historyKey)||'[]');const {role,player:{id}}=initial;if(Array.isArray(history))rolls.push(...history.map(normalizePayload).filter(r=>r&&(!r.hidden||role==='GM'||r.rollerId===id)).slice(0,100) as DiceRollPayload[]);}catch{}
 unsubs.push(OBR.broadcast.onMessage(BROADCAST_DICE_ROLL,async event=>{
  const data=normalizePayload(event.data);
  if(!data||typeof data.rollId!=='string'||!Array.isArray(data.dice)||rolls.some(r=>r.rollId===data.rollId))return;
  const {role,player:{id}}=await workbenchObservation().read();
  if(data.hidden&&role!=='GM'&&data.rollerId!==id)return;
  if(rolls.some(r=>r.rollId===data.rollId))return;
  rolls.unshift(data);rolls.splice(100);try{localStorage.setItem(historyKey,JSON.stringify(rolls));}catch{}rollListeners.forEach(fn=>fn());
  void showDiceEffect(data).catch(error=>console.error("[workbench] dice effect failed",error));
  void ensureActivityPanel();
 }),OBR.broadcast.onMessage('com.obr-suite/dice-quick-roll',event=>{
  if(event.connectionId!==connection)return;
  void executeRoll(event.data as QuickRollRequest).catch(()=>{});
 }),OBR.broadcast.onMessage('com.obr-suite/dice-replay',event=>{const data=event.data as any;if(!data?.cid)return;if(data.action==='close'||data.action!=='open'&&replay===data.cid){replay='';void closeReplay();}else if(rolls.some(r=>r.rollId===data.cid||r.collectiveId===data.cid)){replay=data.cid;void openReplay(data.cid);}}),OBR.broadcast.onMessage('com.obr-suite/dice-panel-toggle',()=>{void OBR.action.open();}));
}
export function teardownWorkbenchDice(){void closeReplay();unsubs.splice(0).forEach(fn=>fn());rolls.length=0;rollListeners.forEach(fn=>fn());}
export async function executeRoll(req:QuickRollRequest){
 const expression=String(req.expression||'').replace(/\s/g,'');
 if(expression.length>160||!/^[-+]?(?:\d*d(?:[1-9]\d{0,5})|\d+)(?:[-+](?:\d*d(?:[1-9]\d{0,5})|\d+))*$/i.test(expression)||!/[dD]/.test(expression))throw Error('请输入骰式，例如 1d20+5 或 2d6+3。');
 let count=0;for(const match of expression.matchAll(/(\d*)d\d+/gi))count+=Number(match[1]||1);
 if(count<1||count>100)throw Error('一次最多投掷 100 个骰子。');
 const {role,player}=await workbenchObservation().read();
 await handleQuickRoll({...req,expression,label:String(req.label||'').slice(0,120),focus:false,hidden:role==='GM'&&(!!req.hidden||isGlobalDarkRollEnabled())},{id:player.id,name:player.name,color:player.color,role});
}
