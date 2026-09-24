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
function rpc(method:string,...args:any[]):Promise<any>{const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(id);reject(Error('枭熊连接超时'));},20000);waiting.set(id,{resolve,reject,timer});parent.postMessage({channel,id,method,args},location.origin);});}
function on(key:string,fn:(v:any)=>void){if(!subscriptions.has(key))subscriptions.set(key,new Set());subscriptions.get(key)!.add(fn);return()=>subscriptions.get(key)?.delete(fn);}
window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin||event.data?.channel!==channel)return;const m=event.data;if(m.event==='snapshot'){reads=m.data.reads;return;}if(m.event==='player'){for(const [key,field] of [['getRole','role'],['getName','name'],['getColor','color'],['getMetadata','metadata']])if(m.data[field]!==undefined)reads['player.'+key]=m.data[field];}if(m.event){subscriptions.get(m.event)?.forEach(fn=>fn(m.data));return;}const pending=waiting.get(m.id);if(pending){clearTimeout(pending.timer);waiting.delete(m.id);m.error?pending.reject(Error(m.error)):pending.resolve(m.result);}});
const ready=rpc('init').then(data=>{roomId=data.roomId;reads=data.reads;installExpressionHistory();});
const api:any={isAvailable:true,isReady:true,onReady:(fn:()=>void)=>{void ready.then(async()=>{await fn();document.body.inert=false;document.body.dataset.bridgeReady='true';parent.postMessage({channel,ready:true},location.origin);}).catch(error=>{document.body.inert=false;document.body.dataset.bridgeError=String(error);});},room:{get id(){return roomId;}},
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
