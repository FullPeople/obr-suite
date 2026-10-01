import {sendDiceMessage} from './dice-broadcast';
import {canSeeDiceHistory,DICE_HISTORY_LIMIT} from '../modules/dice/history-policy';
import OBR from '@owlbear-rodeo/sdk';
import {serveDiceSubmissions} from './dice-submit';
import {Controller,type ResultRecord} from '../../extensions/workbench-dice3d/src/controller';
import {BUILD,CHANNEL,type Roll,type Request,type ThemeID} from '../../extensions/workbench-dice3d/src/types';
import {parseFormula,initialPhysicalCount} from '../../extensions/workbench-dice3d/src/research/formula';
import {STYLE_CHOICES,RETIRED_STYLES} from '../../extensions/workbench-dice3d/src/material-styles';
import type {QuickRollRequest,DiceRollPayload} from '../modules/dice';
import {workbenchObservation} from './observation';
import type {DiceLoadingState} from './dice-loading-ui';
import type {LoadProgress} from '../../extensions/workbench-dice3d/src/asset-loading';
const MODAL=CHANNEL+'/overlay',RESULT='com.obr-suite/dice-roll',THEME='com.obr-suite/dice/3d-theme';
let core:Controller|undefined,bus:BroadcastChannel|undefined,start:Promise<void>|undefined,ready=false,lastError='',connection='',profileStop:(()=>void)|undefined,historyStop:(()=>void)|undefined;
let loadState:DiceLoadingState={ready:false,phase:'连接骰子渲染层'},renderProgress:LoadProgress|undefined,engineProgress:LoadProgress|undefined;
function updateLoadProgress(){const parts=[renderProgress,engineProgress].filter(Boolean) as LoadProgress[];loadState={...loadState,done:parts.reduce((n,p)=>n+p.done,0),total:parts.reduce((n,p)=>n+p.total,0),bytes:parts.reduce((n,p)=>n+p.bytes,0),phase:renderProgress?.phase||engineProgress?.phase||'连接骰子渲染层'};}
let generation=0,modalLane:Promise<void>=Promise.resolve(),submissionStop:(()=>void)|undefined;
const waiters=new Map<string,{resolve:(p:DiceRollPayload)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>(),records=new Map<string,ResultRecord>();
export const resultListeners=new Set<(payload:DiceRollPayload,revealed:boolean)=>void>();
const payload=(record:ResultRecord):DiceRollPayload=>{
 const f=record.formulaData;if(!f)throw Error('3D 权威结果缺少公式归属');
 const rows=f.logicalRows||f.rows,dice=rows.flatMap(r=>r.dice),starts:number[]=[];let offset=0;for(const row of rows){starts.push(offset);offset+=row.dice.length;}
 const context=f.context,rowData=rows.map(row=>({total:row.total,modifier:row.total-row.dice.filter(d=>d.kept).reduce((n,d)=>n+d.value*d.sign,0),operation:row.operation}));
 const delta=rowData.reduce((n,row)=>n+row.modifier,0);
 return{_3dConnection:connection,_3dRows:rowData,rollId:record.id,itemId:context?.itemId??null,rollerId:context?.rollerId||record.source,rollerName:record.name,rollerColor:record.color||'',expression:f.expression,label:context?.label||'',collectiveId:context?.collectiveId,ts:context?.ts??record.at,total:record.total,modifier:delta,winnerIdx:-1,hidden:record.secret&&!record.revealed,visibility:record.revealed?'all':record.visibility,dice:dice.map(d=>({type:d.kind==='d_percentile'?'d100':d.kind,value:d.kind==='d_percentile'?Math.max(1,d.value):d.value,loser:!d.kept,originalValue:d.raw!==d.value?d.raw:undefined,subtract:d.sign<0,...(d.parent?{burstParent:dice.findIndex(parent=>parent.id===d.parent)}:{})})),...(rows.length>1?{rowStarts:starts}:{}),sameHighlight:dice.some(d=>d.flags.includes('同值'))} as DiceRollPayload;
};
function visibleRecord(record:ResultRecord){const {role,player}=workbenchObservation().peek();return canSeeDiceHistory(payload(record),{role:role||'',playerId:player?.id||''});}
export async function setupDice3d(){
 if(start)return start;const own=generation;
 start=(async()=>{
  const observed=await workbenchObservation().read();if(own!==generation)return;const p=observed.player;connection=p.connectionId;
  submissionStop=serveDiceSubmissions(connection,(method,data)=>method==='compat'?submitCompat3d(data):submitDice3d(data));
  if(RETIRED_STYLES.includes(p.metadata[THEME] as any)){
   const removed=p.metadata[THEME];await OBR.player.setMetadata({[THEME]:'ink_sketch'});if(own!==generation)return;p.metadata={...p.metadata,[THEME]:'ink_sketch'};
   await OBR.notification.show(`已移除材质 ${removed}，后续骰子已改为卡通涂鸦，可在皮肤页重新选择。`,'INFO');
  }
  if(own!==generation)return;bus=new BroadcastChannel(`${CHANNEL}:local:${connection}`);
  bus.onmessage=e=>{if(own!==generation)return;const m=e.data;if(m.type==='load-progress'){if(m.engine)engineProgress=m.progress;else renderProgress=m.progress;updateLoadProgress();}
   else if(m.type==='state'){ready=m.state.ready;const error=m.state.error||'';loadState={...loadState,ready,physics:m.state.physics,overlay:m.state.overlay,error:ready?'':error};if(error&&error!==lastError){void OBR.notification.show('3D 骰子：'+error,'ERROR');for(const [id,w] of waiters){clearTimeout(w.timer);waiters.delete(id);w.reject(Error(error));}}lastError=error;}
   else if(m.type==='history'){const snapshot=(m.records as ResultRecord[]).slice(0,DICE_HISTORY_LIMIT);const ids=new Set(snapshot.map(r=>r.id));for(const id of records.keys())if(!ids.has(id))records.delete(id);for(const r of snapshot){const previous=records.get(r.id);records.set(r.id,r);if(!r.formulaData||!visibleRecord(r))continue;const data=payload(r);
    // Early prediction resolves only the submit RPC, never visible/stored history.
    if(r.complete&&(!previous?.complete||previous.revealed!==r.revealed)){resultListeners.forEach(fn=>fn(data,r.revealed));void sendDiceMessage(RESULT,data,{destination:'LOCAL'}).then(()=>Promise.all(['com.obr-suite/dice-history-reveal',...(r.revealed?['com.obr-suite/dice3d-highlight']:[])].map(channel=>sendDiceMessage(channel,{rollId:r.id,cid:r.formulaData?.context?.collectiveId??r.id},{destination:'LOCAL'})))).catch(error=>core?.fail('history-publish',error));}
    const waiting=waiters.get(r.id);if(waiting){clearTimeout(waiting.timer);waiters.delete(r.id);waiting.resolve(data);}
   }}
   else if(m.type==='log'&&m.event==='render-complete'){const rollId=m.detail.roll;if(records.has(rollId))void Promise.all(['com.obr-suite/dice-fade-start','com.obr-suite/dice-history-reveal'].map(channel=>sendDiceMessage(channel,{rollId,rollerId:records.get(rollId)!.formulaData?.context?.rollerId},{destination:'LOCAL'})));}
  };
  core=new Controller({id:p.connectionId,name:p.name,color:p.color,role:observed.role,resolveRole:async id=>(await workbenchObservation().read()).party.find(p=>p.connectionId===id)?.role,mode:'Full Suite 新版 3D',send:data=>sendDiceMessage(CHANNEL,data,{destination:'REMOTE'},()=>own===generation),listen:fn=>OBR.broadcast.onMessage(CHANNEL,event=>fn(event.data,event.connectionId))});
  historyStop=OBR.broadcast.onMessage('com.obr-suite/dice3d-history-request',event=>{if(event.connectionId===connection)void dice3dRpc('history',[]).catch(error=>core?.fail('history-snapshot',error));});
  profileStop=workbenchObservation().onChange(()=>{const p=workbenchObservation().peek().player;if(p)void core?.setProfile(p.name,p.color,p.role).catch(e=>core?.fail('profile',e));});
  await core.init();if(own!==generation)return;const url=`/suite-dev/dice3d/overlay.html?client=${encodeURIComponent(connection)}&v=${BUILD}`;
  const work=modalLane.then(async()=>{if(own===generation)await OBR.modal.open({id:MODAL,url,fullScreen:true,hideBackdrop:true,hidePaper:true,disablePointerEvents:true});});modalLane=work.catch(()=>{});await work;
 })().catch(error=>{if(own!==generation)return;teardownDice3d();loadState={...loadState,error:String(error)};throw error});return start;
}
export function teardownDice3d(close=true){generation++;submissionStop?.();submissionStop=undefined;core?.dispose();core=undefined;profileStop?.();profileStop=undefined;historyStop?.();historyStop=undefined;bus?.close();bus=undefined;start=undefined;ready=false;lastError='';renderProgress=undefined;engineProgress=undefined;loadState={ready:false,phase:'连接骰子渲染层'};records.clear();for(const w of waiters.values()){clearTimeout(w.timer);w.reject(Error('3D 投骰模块已关闭'));}waiters.clear();if(close)modalLane=modalLane.then(()=>OBR.modal.close(MODAL)).catch(error=>console.warn('[dice] overlay close failed',error));}
async function whenReady(){await setupDice3d();if(!ready)throw Error(lastError||'正在加载骰子，首次渲染会花费一点时间，请等待....');}
function theme(metadata:Record<string,unknown>):ThemeID{const id=metadata[THEME]??'ink_sketch';if(!STYLE_CHOICES.some(s=>s.id===id))throw Error('未知 3D 材质：'+String(id));return id as ThemeID;}
export async function submitDice3d(req:QuickRollRequest,compat?:Partial<DiceRollPayload>):Promise<DiceRollPayload>{
 const own=generation;await whenReady();const observed=await workbenchObservation().read();if(own!==generation)throw Error('骰子场景已改变');const id=compat?.rollId||crypto.randomUUID();let formula=String(req.expression||'');
 if(req.critMode)formula=formula.replace(/(\d*)d(\d+)/gi,(_,n,s)=>`${2*Number(n||1)}d${s}`);
 if(req.advMode==='adv'||req.advMode==='dis')formula=formula.replace(/(\d*)d20\b/gi,(_,n)=>`${req.advMode}(${n||1}d20)`);
 const count=compat?compat.dice!.reduce((n,d)=>n+(d.type==='d100'?2:1),0):initialPhysicalCount(parseFormula(formula));if(count<1||count>100)throw Error('一次公式须包含 1–100 枚实际骰子（d100 算两枚）');
 const visibility=observed.role==='GM'&&req.hidden?'gm':((req as any).visibility??'all');if(!['all','self','gm','players'].includes(visibility))throw Error('无效可见范围');
 const options={id,recipe:true,kind:'mixed',count,theme:theme(observed.player.metadata),modifier:compat?.modifier??0,visibility,formula:compat?undefined:formula,preset:compat?{dice:compat.dice,total:compat.total??compat.dice!.filter(d=>!d.loser).reduce((n,d)=>n+(d.subtract?-d.value:d.value),compat.modifier??0),rowStarts:compat.rowStarts}:undefined,context:{rollerId:observed.player.id,itemId:req.itemId??null,label:String(req.label||'').slice(0,120),collectiveId:req.collectiveId,expression:req.expression,ts:Date.now()}};
 bus!.postMessage({type:'audio-command',action:'unlock'});
 return new Promise<DiceRollPayload>((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(id);reject(Error(`3D 投骰 ${id} 超过 240 秒未返回，请查看网络/物理错误`));},240000);waiters.set(id,{resolve,reject,timer});void core!.submit(options).catch(e=>{clearTimeout(timer);waiters.delete(id);reject(e);});});
}
/** All target expressions enter one physics frontier; visibility is sealed per
 * target after prediction and every target waits at the same start barrier. */
export async function submitDice3dGroup(requests:QuickRollRequest[],collectiveId:string):Promise<DiceRollPayload[]>{
 const own=generation;await whenReady();const observed=await workbenchObservation().read();if(own!==generation)throw Error('骰子场景已改变');if(observed.role!=='GM')throw Error('只有 DM 可以群体投掷');
 if(!Array.isArray(requests)||requests.length<2||requests.length>50)throw Error('群体投掷须选择 2–50 个目标');
 const id=crypto.randomUUID(),formulas=requests.map(req=>{let value=String(req.expression||'');if(req.advMode==='adv'||req.advMode==='dis')value=value.replace(/(\d*)d20\b/gi,(_,n)=>`${req.advMode}(${n||1}d20)`);return value;}),count=formulas.reduce((n,formula)=>n+initialPhysicalCount(parseFormula(formula)),0);
 if(count>100)throw Error('群体实际骰子不能超过 100 枚');
 const contexts=requests.map(req=>({rollerId:observed.player.id,itemId:req.itemId??null,label:String(req.label||'').slice(0,120),collectiveId,expression:req.expression,ts:Date.now(),visibility:req.hidden?'gm' as const:'all' as const}));
 const options={id,recipe:true,kind:'mixed',count,theme:theme(observed.player.metadata),modifier:0,visibility:'gm',formulas,contexts};
 bus!.postMessage({type:'audio-command',action:'unlock'});
 const pending=requests.map((_,index)=>new Promise<DiceRollPayload>((resolve,reject)=>{const key=`${id}.g${index}`,timer=setTimeout(()=>{waiters.delete(key);reject(Error('群体投骰超过 240 秒未返回'));},240000);waiters.set(key,{resolve,reject,timer});}));
 void core!.submit(options).catch(error=>{for(let i=0;i<requests.length;i++){const key=`${id}.g${i}`,waiter=waiters.get(key);if(waiter){clearTimeout(waiter.timer);waiters.delete(key);waiter.reject(error);}}});
 return Promise.all(pending);
}
export async function submitCompat3d(opts:any){const result=await submitDice3d({expression:opts.expression||'',itemId:opts.itemId,label:opts.label,hidden:opts.hidden,collectiveId:opts.collectiveId},{...opts,total:opts.total??opts.dice.filter((d:any)=>!d.loser).reduce((n:number,d:any)=>n+(d.subtract?-d.value:d.value),opts.modifier??0)});return result.rollId;}
export async function dice3dRpc(method:string,args:any[]){
 if(method==='status'){if(!start&&!loadState.error)void setupDice3d().catch(()=>{});return {...loadState};}
 if(method==='retry'){if(ready||records.size||waiters.size)throw Error('已有投骰记录时不能重置物理层，请刷新房间重试');teardownDice3d(false);await OBR.modal.close(MODAL);await setupDice3d();return {...loadState};}
 if(method==='submit')return submitDice3d(args[0]);
 if(method==='history'){for(const r of records.values()){if(!r.formulaData||!r.complete||!visibleRecord(r))continue;await sendDiceMessage(RESULT,payload(r),{destination:'LOCAL'});await sendDiceMessage('com.obr-suite/dice-history-reveal',{rollId:r.id},{destination:'LOCAL'});}return;}
 if(method==='material'){const id=args[0];if(!STYLE_CHOICES.some(s=>s.id===id))throw Error('未知材质');return OBR.player.setMetadata({[THEME]:id});}
 if(method==='audio'){const value=args[0];if(!Number.isFinite(value)||value<0||value>1)throw Error('无效音量');localStorage.setItem('obr-suite/dice3d/volume',String(value*100));bus?.postMessage({type:'audio-command',action:'volume',value});return;}
 const matched=[...records.values()].filter(r=>r.formulaData&&visibleRecord(r)&&(r.id===args[0]||r.formulaData?.context?.collectiveId===args[0]));
 if(method==='reveal'){const own=matched.filter(r=>r.secret&&!r.revealed&&r.source===connection);if(!own.length||own.some(r=>!r.canReveal))throw Error('只能公开自己的已结算暗骰');for(const r of own)bus?.postMessage({type:'command',action:'reveal',id:r.id});return;}
 if(method==='clear'){bus?.postMessage({type:'command',action:'clear'});return;}
 if(method==='replay'){if(!matched.length)throw Error('这条旧历史没有保存 3D 轨迹');if(matched.some(r=>!r.complete))throw Error('这次投骰尚未结束，请等结算后回放');bus?.postMessage({type:'suite-replay',ids:matched.map(r=>r.id)});return;}
 throw Error('不支持的 3D 操作');
}
