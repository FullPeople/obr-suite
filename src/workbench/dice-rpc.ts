import {armFixedRoll,readFixedRoll} from '../modules/dice/fixed-roll';
import {executeRoll} from './dice';
import OBR from '@owlbear-rodeo/sdk';
import {getState} from '../state';
import {normalizePayload,BROADCAST_DICE_ROLL} from '../modules/dice';
import {workbenchObservation} from './observation';
export const DICE_EVENTS=[BROADCAST_DICE_ROLL,'com.obr-suite/dice-fade-start','com.obr-suite/dice-replay','com.obr-suite/dice-history-filter','com.obr-suite/dice-panel-fill','com.obr-suite/sfx'];
const sendChannels=new Set([BROADCAST_DICE_ROLL,'com.obr-suite/sfx','com.obr-suite/dice-quick-roll','com.obr-suite/dice-force-clear','com.obr-suite/dice-replay']);
export async function diceRpc(method:string,args:any[],target:any,access:(id:string)=>Promise<any>){
 if(!getState().enabled.dice)throw Error('投骰模块未开启');
 const observed=await workbenchObservation().read(),playerRole=observed.role,player=observed.player;
 const checkItem=async(id:string)=>{if(target?.item?.id===id||target?.cardId&&id===`card:${target.cardId}`)return;await access(id);};
 if(method==='init'){
  return {roomId:OBR.room.id,reads:{'player.getId':player.id,'player.getConnectionId':player.connectionId,'player.getName':player.name,'player.getColor':player.color,'player.getMetadata':player.metadata,'party.getPlayers':observed.party,'scene.grid.getDpi':await OBR.scene.grid.getDpi(),'player.getRole':playerRole,'player.getSelection':target?.item?[target.item.id]:[],'scene.items.getItems':target?.item?[target.item]:[]}};
 }
 if(method==='player.getSelection')return target?.item?[target.item.id]:[];
 if(method==='scene.items.getItems'){
  if(target?.cardId&&!target.item)return [];
  const items=observed.items;return args[0]?items.filter(i=>args[0].includes(i.id)):items;
 }
 if(method==='player.setMetadata'){
  if(!args[0]||Object.keys(args[0]).some(k=>!['com.obr-suite/dice/skins','com.obr-suite/dice/skin-library'].includes(k)))throw Error('无效的骰子外观设置');
  return OBR.player.setMetadata(args[0]);
 }
 if(method==='broadcast.sendMessage'){
  let [name,data,options]=args;if(!sendChannels.has(name)||!['LOCAL','REMOTE','ALL'].includes(options?.destination))throw Error('无效的骰子消息');
  if(name===BROADCAST_DICE_ROLL){
   data=normalizePayload(data);if(!data||!Array.isArray(data.dice)||data.dice.length>100||!data.dice.length||!Number.isFinite(data.total)||!Number.isFinite(data.modifier)||data.dice.some((d:any)=>!/^d[1-9]\d{0,5}$/.test(d.type)||!Number.isInteger(d.value)||d.value<1||d.value>Number(d.type.slice(1))))throw Error('无效的投骰结果');
   if(data.itemId)await checkItem(data.itemId);
   data={...data,rollerId:player.id,rollerName:player.name,rollerColor:player.color,label:String(data.label||'').slice(0,120),hidden:playerRole==='GM'&&!!data.hidden};
   if(data.hidden&&options.destination!=='LOCAL')return;
  }
  if(name==='com.obr-suite/dice-quick-roll'){
   if(data.itemId)await checkItem(data.itemId);if(playerRole==='GM'&&Number.isInteger(data.fixedArm?.value))armFixedRoll(data.fixedArm.value);await executeRoll({...data,itemId:target?.item?.id||null,hidden:playerRole==='GM'&&(!!data.hidden||!!data.globalDark)});return {fixedConsumed:!!data.fixedArm&&!readFixedRoll()};
  }
  return OBR.broadcast.sendMessage(name,data,options);
 }
 const allowed:Record<string,(...args:any[])=>any>={
  'player.getId':()=>player.id,'player.getConnectionId':()=>player.connectionId,'player.getRole':()=>playerRole,'player.getName':()=>player.name,'player.getColor':()=>player.color,'player.getMetadata':()=>player.metadata,'party.getPlayers':()=>observed.party,
  'scene.grid.getDpi':()=>OBR.scene.grid.getDpi(),'viewport.getWidth':()=>OBR.viewport.getWidth(),'viewport.getHeight':()=>OBR.viewport.getHeight(),'viewport.getPosition':()=>OBR.viewport.getPosition(),'viewport.getScale':()=>OBR.viewport.getScale(),'viewport.transformPoint':p=>OBR.viewport.transformPoint(p),'viewport.animateTo':p=>OBR.viewport.animateTo(p),'viewport.animateToBounds':p=>OBR.viewport.animateToBounds(p),'notification.show':(text)=>OBR.notification.show(String(text).slice(0,300))
 };
 if(!Object.prototype.hasOwnProperty.call(allowed,method))throw Error('不支持的骰盘操作');return allowed[method](...args);
}
