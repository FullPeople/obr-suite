import OBR from '@owlbear-rodeo/sdk';
import {armFixedRoll,readFixedRoll} from '../modules/dice/fixed-roll';
import {executeRoll,getRollHistory,lightDiceRpc,resolveDiceTarget} from './dice';
import {diceIdentity} from './dice-identity';
import {getState} from '../state';
import {BROADCAST_DICE_ROLL} from '../modules/dice';
export const DICE_EVENTS=[BROADCAST_DICE_ROLL,'com.obr-suite/dice-fade-start','com.obr-suite/dice-replay','com.obr-suite/dice-history-filter','com.obr-suite/dice-panel-fill','com.obr-suite/sfx'];
const channels=new Set(['com.obr-suite/sfx','com.obr-suite/dice-quick-roll','com.obr-suite/dice-force-clear','com.obr-suite/dice-replay']);
export async function diceRpc(method:string,args:any[],target:any){
 if(!getState().enabled.dice)throw Error('投骰模块未开启');
 const p=await diceIdentity(),itemId=target?.itemId??null;
 const submit=async(request:any)=>{
  if(!request||typeof request.expression!=='string')throw Error('无效公式');
  if(p.role==='GM'&&Number.isInteger(request.fixedArm?.value))armFixedRoll(request.fixedArm.value);
  const result=await executeRoll({...request,itemId:request.itemId??itemId,hidden:p.role==='GM'&&(!!request.hidden||!!request.globalDark)});
  return {...result,fixedConsumed:!!request.fixedArm&&!readFixedRoll()};
 };
 if(method==='dice2d.submit')return submit(args[0]);
 if(method==='dice2d.history')return getRollHistory();
 if(method==='dice2d.historyDelete')return lightDiceRpc('historyDelete',args);
 if(method.startsWith('dice3d.'))return lightDiceRpc(method.slice(7),args);
 if(method==='init')return {roomId:OBR.room.id,mode:'2d',reads:{'player.getId':p.id,'player.getConnectionId':p.connectionId,'player.getName':p.name,'player.getColor':p.color,'player.getRole':p.role,'player.getMetadata':p.metadata,'player.getSelection':itemId&&!itemId.startsWith('card:')?[itemId]:[],'scene.items.getItems':[],'party.getPlayers':[],'scene.grid.getDpi':100}};
 if(method==='player.getSelection')return itemId&&!itemId.startsWith('card:')?[itemId]:[];
 if(method==='scene.items.getItems'){
  const ids=Array.isArray(args[0])?args[0]:itemId&&!itemId.startsWith('card:')?[itemId]:[];if(ids.length>100)throw Error('目标过多');
  const allowed=await Promise.all(ids.map(id=>resolveDiceTarget(id,p)));return allowed.length?OBR.scene.items.getItems(allowed.filter((id):id is string=>!!id)):[];
 }
 if(method==='player.setMetadata'){
  if(!args[0]||Object.keys(args[0]).some(k=>!['com.obr-suite/dice/skins','com.obr-suite/dice/skin-library'].includes(k)))throw Error('无效的骰子设置');return OBR.player.setMetadata(args[0]);
 }
 if(method==='broadcast.sendMessage'){
  const [name,data,options]=args;if(!channels.has(name)||!['LOCAL','REMOTE','ALL'].includes(options?.destination))throw Error('无效的骰子消息');
  if(name==='com.obr-suite/dice-quick-roll')return submit(data);
  if(name==='com.obr-suite/dice-force-clear')return lightDiceRpc('clear',[]);
  return OBR.broadcast.sendMessage(name,data,options);
 }
 const allowed:Record<string,(...args:any[])=>unknown>={
  'player.getId':()=>p.id,'player.getConnectionId':()=>p.connectionId,'player.getRole':()=>p.role,'player.getName':()=>p.name,'player.getColor':()=>p.color,'player.getMetadata':()=>p.metadata,'party.getPlayers':()=>OBR.party.getPlayers(),
  'scene.grid.getDpi':()=>OBR.scene.grid.getDpi(),'viewport.getWidth':()=>OBR.viewport.getWidth(),'viewport.getHeight':()=>OBR.viewport.getHeight(),'viewport.getPosition':()=>OBR.viewport.getPosition(),'viewport.getScale':()=>OBR.viewport.getScale(),'viewport.transformPoint':point=>OBR.viewport.transformPoint(point),'viewport.animateTo':point=>OBR.viewport.animateTo(point),'viewport.animateToBounds':point=>OBR.viewport.animateToBounds(point),'notification.show':text=>OBR.notification.show(String(text).slice(0,300)),
 };if(!Object.hasOwn(allowed,method))throw Error('不支持的骰盘操作');return allowed[method](...args);
}
