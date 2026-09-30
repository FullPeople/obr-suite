import OBR from '@owlbear-rodeo/sdk';
import {Controller,type ResultRecord} from '../../extensions/workbench-dice3d/src/controller';
import {BUILD,CHANNEL,type Roll,type Request,type ThemeID} from '../../extensions/workbench-dice3d/src/types';
import {parseFormula,initialPhysicalCount} from '../../extensions/workbench-dice3d/src/research/formula';
import {STYLE_CHOICES} from '../../extensions/workbench-dice3d/src/material-styles';
import type {QuickRollRequest,DiceRollPayload} from '../modules/dice';
import {workbenchObservation} from './observation';
const MODAL=CHANNEL+'/overlay',RESULT='com.obr-suite/dice-roll',THEME='com.obr-suite/dice/3d-theme';
let core:Controller|undefined,bus:BroadcastChannel|undefined,start:Promise<void>|undefined,ready=false,lastError='',connection='',profileStop:(()=>void)|undefined,historyStop:(()=>void)|undefined;
const waiters=new Map<string,{resolve:(p:DiceRollPayload)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>(),records=new Map<string,ResultRecord>();
export const resultListeners=new Set<(payload:DiceRollPayload,revealed:boolean)=>void>();
const payload=(record:ResultRecord):DiceRollPayload=>{
 const f=record.formulaData;if(!f)throw Error('3D 权威结果缺少公式归属');
 const rows=f.logicalRows||f.rows,dice=rows.flatMap(r=>r.dice),starts:number[]=[];let offset=0;for(const row of rows){starts.push(offset);offset+=row.dice.length;}
 const context=f.context,rowData=rows.map(row=>({total:row.total,modifier:row.total-row.dice.filter(d=>d.kept).reduce((n,d)=>n+d.value*d.sign,0),operation:row.operation}));
 const delta=rowData.reduce((n,row)=>n+row.modifier,0);
 return{_3dConnection:connection,_3dRows:rowData,rollId:record.id,itemId:context?.itemId??null,rollerId:context?.rollerId||record.source,rollerName:record.name,rollerColor:record.color||'',expression:f.expression,label:context?.label||'',collectiveId:context?.collectiveId,ts:context?.ts??record.at,total:record.total,modifier:delta,winnerIdx:-1,hidden:record.secret&&!record.revealed,dice:dice.map(d=>({type:d.kind==='d_percentile'?'d100':d.kind,value:d.kind==='d_percentile'?Math.max(1,d.value):d.value,loser:!d.kept,originalValue:d.raw!==d.value?d.raw:undefined,subtract:d.sign<0,...(d.parent?{burstParent:dice.findIndex(parent=>parent.id===d.parent)}:{})})),...(rows.length>1?{rowStarts:starts}:{}),sameHighlight:dice.some(d=>d.flags.includes('同值'))} as DiceRollPayload;
};
export async function setupDice3d(){
 if(start)return start;
 start=(async()=>{
  const observed=await workbenchObservation().read(),p=observed.player;connection=p.connectionId;
  bus=new BroadcastChannel(`${CHANNEL}:local:${connection}`);
  bus.onmessage=e=>{const m=e.data;if(m.type==='state'){ready=m.state.ready;const error=m.state.error||'';if(error&&error!==lastError){void OBR.notification.show('3D 骰子：'+error,'ERROR');for(const [id,w] of waiters){clearTimeout(w.timer);waiters.delete(id);w.reject(Error(error));}}lastError=error;}
   else if(m.type==='history')for(const r of m.records as ResultRecord[]){const previous=records.get(r.id);records.set(r.id,r);if(!r.formulaData)continue;const data=payload(r);
    if(!previous||previous.revealed!==r.revealed){resultListeners.forEach(fn=>fn(data,r.revealed));void OBR.broadcast.sendMessage(RESULT,data,{destination:'LOCAL'}).then(()=>{if(r.revealed)return Promise.all(['com.obr-suite/dice-history-reveal','com.obr-suite/dice3d-highlight'].map(channel=>OBR.broadcast.sendMessage(channel,{rollId:r.id,cid:r.formulaData?.context?.collectiveId??r.id},{destination:'LOCAL'})));});}
    const waiting=waiters.get(r.id);if(waiting){clearTimeout(waiting.timer);waiters.delete(r.id);waiting.resolve(data);}
   }
   else if(m.type==='log'&&m.event==='render-complete'){const rollId=m.detail.roll;if(records.has(rollId))void Promise.all(['com.obr-suite/dice-fade-start','com.obr-suite/dice-history-reveal'].map(channel=>OBR.broadcast.sendMessage(channel,{rollId,rollerId:records.get(rollId)!.formulaData?.context?.rollerId},{destination:'LOCAL'})));}
  };
  core=new Controller({id:p.connectionId,name:p.name,color:p.color,role:observed.role,resolveRole:async id=>(await workbenchObservation().read()).party.find(p=>p.connectionId===id)?.role,mode:'Full Suite 新版 3D',send:data=>OBR.broadcast.sendMessage(CHANNEL,data,{destination:'REMOTE'}),listen:fn=>OBR.broadcast.onMessage(CHANNEL,event=>fn(event.data,event.connectionId))});
  historyStop=OBR.broadcast.onMessage('com.obr-suite/dice3d-history-request',event=>{if(event.connectionId===connection)void dice3dRpc('history',[]).catch(error=>core?.fail('history-snapshot',error));});
  profileStop=workbenchObservation().onChange(()=>{const p=workbenchObservation().peek().player;if(p)void core?.setProfile(p.name,p.color,p.role).catch(e=>core?.fail('profile',e));});
  await core.init();await OBR.modal.open({id:MODAL,url:`/suite-dev/dice3d/overlay.html?client=${encodeURIComponent(connection)}&v=${BUILD}`,fullScreen:true,hideBackdrop:true,hidePaper:true,disablePointerEvents:true});
 })().catch(error=>{teardownDice3d();throw error});return start;
}
export function teardownDice3d(){core?.dispose();core=undefined;profileStop?.();profileStop=undefined;historyStop?.();historyStop=undefined;bus?.close();bus=undefined;start=undefined;ready=false;lastError='';records.clear();for(const w of waiters.values()){clearTimeout(w.timer);w.reject(Error('3D 投骰模块已关闭'));}waiters.clear();void OBR.modal.close(MODAL);}
async function whenReady(){await setupDice3d();const began=performance.now();while(!ready){if(lastError)throw Error(lastError);if(performance.now()-began>30000)throw Error('3D 模型/物理层准备超时');await new Promise(r=>setTimeout(r,40));}}
function theme(metadata:Record<string,unknown>):ThemeID{const id=metadata[THEME]??'ink_sketch';if(!STYLE_CHOICES.some(s=>s.id===id))throw Error('未知 3D 材质：'+String(id));return id as ThemeID;}
export async function submitDice3d(req:QuickRollRequest,compat?:Partial<DiceRollPayload>):Promise<DiceRollPayload>{
 await whenReady();const observed=await workbenchObservation().read(),id=compat?.rollId||crypto.randomUUID();let formula=String(req.expression||'');
 if(req.critMode)formula=formula.replace(/(\d*)d(\d+)/gi,(_,n,s)=>`${2*Number(n||1)}d${s}`);
 if(req.advMode==='adv'||req.advMode==='dis')formula=formula.replace(/(\d*)d20\b/gi,(_,n)=>`${req.advMode}(${n||1}d20)`);
 const count=compat?compat.dice!.reduce((n,d)=>n+(d.type==='d100'?2:1),0):initialPhysicalCount(parseFormula(formula));if(count<1||count>100)throw Error('一次公式须包含 1–100 枚实际骰子（d100 算两枚）');
 const visibility=observed.role==='GM'&&req.hidden?'gm':((req as any).visibility??'all');if(!['all','self','gm','players'].includes(visibility))throw Error('无效可见范围');
 const options={id,recipe:true,kind:'mixed',count,theme:theme(observed.player.metadata),modifier:compat?.modifier??0,visibility,formula:compat?undefined:formula,preset:compat?{dice:compat.dice,total:compat.total??compat.dice!.filter(d=>!d.loser).reduce((n,d)=>n+(d.subtract?-d.value:d.value),compat.modifier??0),rowStarts:compat.rowStarts}:undefined,context:{rollerId:observed.player.id,itemId:req.itemId??null,label:String(req.label||'').slice(0,120),collectiveId:req.collectiveId,expression:req.expression,ts:Date.now()}};
 bus!.postMessage({type:'audio-command',action:'unlock'});
 return new Promise<DiceRollPayload>((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(id);reject(Error(`3D 投骰 ${id} 超过 240 秒未返回，请查看网络/物理错误`));},240000);waiters.set(id,{resolve,reject,timer});void core!.submit(options).catch(e=>{clearTimeout(timer);waiters.delete(id);reject(e);});});
}
export async function submitCompat3d(opts:any){const result=await submitDice3d({expression:opts.expression||'',itemId:opts.itemId,label:opts.label,hidden:opts.hidden,collectiveId:opts.collectiveId},{...opts,total:opts.total??opts.dice.filter((d:any)=>!d.loser).reduce((n:number,d:any)=>n+(d.subtract?-d.value:d.value),opts.modifier??0)});return result.rollId;}
export async function dice3dRpc(method:string,args:any[]){
 if(method==='submit')return submitDice3d(args[0]);
 if(method==='history'){for(const r of records.values()){if(!r.formulaData)continue;await OBR.broadcast.sendMessage(RESULT,payload(r),{destination:'LOCAL'});if(r.complete)await OBR.broadcast.sendMessage('com.obr-suite/dice-history-reveal',{rollId:r.id},{destination:'LOCAL'});}return;}
 if(method==='material'){const id=args[0];if(!STYLE_CHOICES.some(s=>s.id===id))throw Error('未知材质');return OBR.player.setMetadata({[THEME]:id});}
 if(method==='audio'){const value=args[0];if(!Number.isFinite(value)||value<0||value>1)throw Error('无效音量');localStorage.setItem('obr-suite/dice3d/volume',String(value*100));bus?.postMessage({type:'audio-command',action:'volume',value});return;}
 const matched=[...records.values()].filter(r=>r.id===args[0]||r.formulaData?.context?.collectiveId===args[0]);
 if(method==='reveal'){const own=matched.filter(r=>r.secret&&!r.revealed&&r.source===connection);if(!own.length||own.some(r=>!r.canReveal))throw Error('只能公开自己的已结算暗骰');for(const r of own)bus?.postMessage({type:'command',action:'reveal',id:r.id});return;}
 if(method==='clear'){bus?.postMessage({type:'command',action:'clear'});return;}
 if(method==='replay'){if(!matched.length)throw Error('这条旧历史没有保存 3D 轨迹');if(matched.some(r=>!r.complete))throw Error('这次投骰尚未结束，请等结算后回放');bus?.postMessage({type:'suite-replay',ids:matched.map(r=>r.id)});return;}
 throw Error('不支持的 3D 操作');
}
