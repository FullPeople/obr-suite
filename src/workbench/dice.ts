import {setupActivityPanel,ensureActivityPanel} from './activity-panel';
import OBR from '@owlbear-rodeo/sdk';
import {BROADCAST_DICE_ROLL,handleQuickRoll,showDiceEffect,normalizePayload,isGlobalDarkRollEnabled,openReplay,closeReplay,type DiceRollPayload,type QuickRollRequest} from '../modules/dice';
import {workbenchObservation} from './observation';
import {storedDiceHistory} from '../modules/dice/history-policy';
export const rolls:DiceRollPayload[]=[];
let replay='';
const historyKey=()=>`obr-suite/dice/history:${String(OBR.room.id||'default').replace(/[^a-zA-Z0-9_-]/g,'_')}`;
function readHistory(fallback:DiceRollPayload[]=rolls):DiceRollPayload[]{try{const rows=JSON.parse(localStorage.getItem(historyKey())||'[]');return Array.isArray(rows)?storedDiceHistory(rows.map(normalizePayload).filter((row):row is DiceRollPayload=>row!==null)) as DiceRollPayload[]:[];}catch{return [...fallback];}}
export async function deleteDiceHistory(cid?:string){
 const {role,player:{id}}=await workbenchObservation().read();
 const next=readHistory().filter(row=>cid!==undefined&&(row.collectiveId??row.rollId)!==cid);
 localStorage.setItem(historyKey(),JSON.stringify(next));
 rolls.splice(0,rolls.length,...next.filter(r=>!r.hidden||role==='GM'||r.rollerId===id));
 if(cid===undefined||replay===cid){replay='';void closeReplay();}
 rollListeners.forEach(fn=>fn());
}
export const rollListeners=new Set<()=>void>();
let unsubs:(()=>void)[]=[];
export async function setupWorkbenchDice(){
 if(unsubs.length)return;
 const initial=await workbenchObservation().read(),connection=initial.player.connectionId;
 setupActivityPanel();
 const visible=(r:DiceRollPayload,role:string,id:string)=>!r.hidden||role==='GM'||r.rollerId===id;
 rolls.splice(0,rolls.length,...readHistory().filter(r=>visible(r,initial.role,initial.player.id)));
 const onStorage=(event:StorageEvent)=>{if(event.key!==historyKey())return;void workbenchObservation().read().then(({role,player:{id}})=>{rolls.splice(0,rolls.length,...readHistory().filter(r=>visible(r,role,id)));rollListeners.forEach(fn=>fn());});};
 window.addEventListener('storage',onStorage);unsubs.push(()=>window.removeEventListener('storage',onStorage));
 unsubs.push(OBR.broadcast.onMessage(BROADCAST_DICE_ROLL,async event=>{
  const data=normalizePayload(event.data);
  if(!data||typeof data.rollId!=='string'||!Array.isArray(data.dice))return;
  const {role,player:{id}}=await workbenchObservation().read();
  if(data.hidden&&role!=='GM'&&data.rollerId!==id)return;
  const current=readHistory().filter(r=>visible(r,role,id));
  if(current.some(r=>r.rollId===data.rollId))return;
  rolls.splice(0,rolls.length,...storedDiceHistory([data,...current]));try{localStorage.setItem(historyKey(),JSON.stringify(rolls));}catch{}rollListeners.forEach(fn=>fn());
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
