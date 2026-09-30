import './tone';
import {installExpressionHistory,rememberExpression} from './expression-history';
import {readFixedRoll,disarmFixedRoll} from '../modules/dice/fixed-roll';
// SDK facade for the original dice pages embedded in the external workbench.
// Only the dedicated dice allowlist is forwarded by the authenticated host.
import type OBRType from '@owlbear-rodeo/sdk';
const channel='workbench-dice-frame/v1';
const waiting=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const subscriptions=new Map<string,Set<(v:any)=>void>>();
let roomId='',reads:Record<string,any>={};
const read=(method:string,...args:any[])=>Object.prototype.hasOwnProperty.call(reads,method)?Promise.resolve(structuredClone(reads[method])):rpc(method,...args);
document.body.inert=true;
function rpc(method:string,...args:any[]):Promise<any>{const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(id);reject(Error('枭熊连接超时'));},method==='dice3d.submit'||method==='broadcast.sendMessage'?245000:20000);waiting.set(id,{resolve,reject,timer});parent.postMessage({channel,id,method,args},location.origin);});}
function on(key:string,fn:(v:any)=>void){if(!subscriptions.has(key))subscriptions.set(key,new Set());subscriptions.get(key)!.add(fn);return()=>subscriptions.get(key)?.delete(fn);}
window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin||event.data?.channel!==channel)return;const m=event.data;if(m.event==='snapshot'){reads=m.data.reads;return;}if(m.event==='player'){for(const [key,field] of [['getRole','role'],['getName','name'],['getColor','color'],['getMetadata','metadata']])if(m.data[field]!==undefined)reads['player.'+key]=m.data[field];}if(m.event){subscriptions.get(m.event)?.forEach(fn=>fn(m.data));return;}const pending=waiting.get(m.id);if(pending){clearTimeout(pending.timer);waiting.delete(m.id);m.error?pending.reject(Error(m.error)):pending.resolve(m.result);}});
const ready=rpc('init').then(data=>{roomId=data.roomId;reads=data.reads;installExpressionHistory();});
function install3dChoices(){
 if(!document.getElementById('exprInput'))return;
 const bar=document.createElement('div');bar.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 12px;font-size:12px';
 const material=document.createElement('select');material.id='dice3d-material';material.setAttribute('aria-label','3D 骰子材质');
 for(const [id,name] of [['ink_sketch','卡通涂鸦'],['stage6_calibration','瓷质'],['brushed_metal','拉丝金属'],['godot_blue_cat_eye','猫眼石'],['royal_ember_resin','半透明树脂'],['comic_print','漫画印刷'],['flowing_ink','流动水墨'],['neon_runes','霓虹符文']]){const o=document.createElement('option');o.value=id;o.textContent=name;material.append(o);}
 material.value=reads['player.getMetadata']?.['com.obr-suite/dice/3d-theme']||'ink_sketch';material.onchange=()=>{void rpc('dice3d.material',material.value).catch(e=>rpc('notification.show',String(e)));};
 const scope=document.createElement('select');scope.id='dice3d-scope';scope.setAttribute('aria-label','结果可见范围');for(const [id,name] of [['all','全部可见'],['self','仅自己'],['gm','自己 + 主持人'],['players','非主持人']]){const o=document.createElement('option');o.value=id;o.textContent=name;scope.append(o);}scope.value=localStorage.getItem('obr-suite/dice/3d-scope')||'all';scope.onchange=()=>localStorage.setItem('obr-suite/dice/3d-scope',scope.value);
 bar.append(material,scope);document.body.prepend(bar);
 const skinPane=document.querySelector<HTMLElement>('.tabPane[data-tab="skins"]');if(skinPane){const title=document.createElement('p');title.textContent='3D 骰子材质 · 使用投掷者的枭熊玩家颜色。原来的图片/视频皮肤数据保留，不用于 3D 表面。';const picker=material.cloneNode(true) as HTMLSelectElement;picker.id='dice3d-skin-picker';picker.onchange=()=>{material.value=picker.value;material.onchange?.(new Event('change'));};const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';volume.value=localStorage.getItem('obr-suite/dice3d/volume')||'100';volume.setAttribute('aria-label','3D 骰子音量');volume.oninput=()=>{localStorage.setItem('obr-suite/dice3d/volume',volume.value);void rpc('dice3d.audio',Number(volume.value)/100);};const label=document.createElement('label');label.textContent='骰子音量 ';label.append(volume);skinPane.replaceChildren(title,picker,label);}
 const style=document.createElement('style');style.textContent='#dice3d-material,#dice3d-scope{font:inherit;color:#eee;background:#383b40;border:1px solid #686c73;border-radius:6px;padding:4px;min-width:0}';document.head.append(style);
}
const api:any={isAvailable:true,isReady:true,onReady:(fn:()=>void)=>{void ready.then(async()=>{await fn();install3dChoices();await rpc('dice3d.history');document.body.inert=false;document.body.dataset.bridgeReady='true';parent.postMessage({channel,ready:true},location.origin);}).catch(error=>{document.body.inert=false;document.body.dataset.bridgeError=String(error);});},room:{get id(){return roomId;}},
 dice3d:{submit:async(req:any)=>{const result=await rpc('dice3d.submit',{...req,visibility:(document.getElementById('dice3d-scope') as HTMLSelectElement)?.value||'all',globalDark:localStorage.getItem('obr-suite/dice/global-dark-roll')==='1'});rememberExpression(req.expression);return result;}},
 player:Object.fromEntries(['getId','getConnectionId','getName','getColor','getRole','getMetadata','getSelection','setMetadata'].map(key=>[key,async(...args:any[])=>{if(key==='setMetadata'){const result=await rpc('player.'+key,...args);reads['player.getMetadata']={...reads['player.getMetadata'],...args[0]};return result;}return read('player.'+key,...args);}])),
 party:{getPlayers:()=>read('party.getPlayers')},
 scene:{grid:{getDpi:()=>read('scene.grid.getDpi')},items:{getItems:async(filter:any)=>{const rows=await rpc('scene.items.getItems',Array.isArray(filter)?filter:undefined);return typeof filter==='function'?rows.filter(filter):Array.isArray(filter)?rows.filter((r:any)=>filter.includes(r.id)):rows;}}},
 viewport:Object.fromEntries(['getWidth','getHeight','getPosition','getScale','transformPoint','animateTo','animateToBounds'].map(key=>[key,(...args:any[])=>rpc('viewport.'+key,...args)])),
 broadcast:{onMessage:(name:string,fn:any)=>on(name,fn),sendMessage:async(...args:any[])=>{if(args[0]==='com.obr-suite/dice-quick-roll')args[1]={...args[1],fixedArm:readFixedRoll(),globalDark:localStorage.getItem('obr-suite/dice/global-dark-roll')==='1'};const expression=args[1]?.expression||(document.getElementById('exprInput') as HTMLInputElement)?.value;const result=await rpc('broadcast.sendMessage',...args);if(['com.obr-suite/dice-quick-roll','com.obr-suite/dice-roll'].includes(args[0]))rememberExpression(expression);if(result?.fixedConsumed)disarmFixedRoll();return result;}},
 notification:{show:(...args:any[])=>rpc('notification.show',...args)},
 modal:{close:async()=>{parent.postMessage({channel,close:true},location.origin);}}
};
api.player.onChange=(fn:any)=>on('player',fn);
export default api as typeof OBRType;
