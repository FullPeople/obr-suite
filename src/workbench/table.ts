import OBR from '@owlbear-rodeo/sdk';
import {TABLE_COMMAND,TABLE_READY,TABLE_VIEW} from '../../extensions/three-dragon-ante/src/game/protocol';
import {localViewParts} from '../../extensions/three-dragon-ante/src/game/local-view';
import type {TableController} from '../../extensions/three-dragon-ante/src/game/controller';
import {TABLE_GESTURE} from '../../extensions/three-dragon-ante/src/game/gesture';
import {TABLE_UI_RESTORE,readUIDraft,type TableUIDraft} from '../../extensions/three-dragon-ante/src/game/ui-command';
/** The table runtime outlives its right-hand view, just like the Owlbear panel. */
export function tableWorkbench(emit:(instance:string,event:string,name:string,data:unknown)=>void){
 let controller:TableController|undefined,starting:Promise<void>|undefined,sequence=0;
 const clients=new Map<string,string>();
 let draft:TableUIDraft|null=null;
 setInterval(()=>{if(clients.size)void publish().catch(()=>{});},3000);
 async function publish(){if(!controller)return;const connectionId=await OBR.player.getConnectionId();for(const [instance,client] of clients)for(const part of localViewParts(controller.view,client,++sequence))emit(instance,'broadcast',TABLE_VIEW,{connectionId,data:part});}
 async function ready(){if(controller&&!starting)return;if(!starting)starting=(async()=>{const {TableController}=await import('../../extensions/three-dragon-ante/src/game/controller');controller=new TableController(()=>{void publish();},{onGesture(seatId,gesture){void OBR.player.getConnectionId().then(connectionId=>{for(const [instance,clientId] of clients)emit(instance,'broadcast',TABLE_GESTURE,{connectionId,data:{instance,clientId,seatId,gesture}});});}});await controller.start();})().catch(async error=>{const old=controller;controller=undefined;await old?.stop();throw error;}).finally(()=>{starting=undefined;});await starting;}
 return async(instance:string,method:string,args:any[])=>{
  if(method==='dispose'){clients.delete(instance);if(!clients.size)await controller?.clearGesture();return;}
  if(method!=='broadcast.sendMessage')return false;
  const [name,data]=args;
  if(name===TABLE_READY){if(typeof data?.clientId!=='string'||data.clientId.length>80)throw Error('无效牌桌身份');clients.set(instance,data.clientId);await ready();await publish();if(draft&&draft.tableId===controller?.view.table?.id&&draft.gameId===controller?.view.game?.id)emit(instance,'broadcast',TABLE_UI_RESTORE,{connectionId:await OBR.player.getConnectionId(),data:{instance,clientId:data.clientId,draft}});return true;}
  if(clients.get(instance)!==data?.clientId)throw Error('牌桌连接已改变');
  if(name===TABLE_COMMAND){await ready();const command=data.command;if(!command||typeof command.type!=='string')throw Error('无效牌桌操作');if(['close','display','remember'].includes(command.type)){const next=readUIDraft(command.draft);if(next&&next.tableId===controller?.view.table?.id&&next.gameId===controller?.view.game?.id)draft=next;if(command.type==='close')await controller?.clearGesture();}
   else if(command.type==='omniscient'){if(await OBR.player.getRole()!=='GM')throw Error('仅 DM 可以查看完整牌局');if(controller!.view.isHost)controller!.setOmniscient(!!command.enabled);else await controller!.command({type:'inspect',enabled:!!command.enabled});}
   else await controller!.command(command);await publish();return true;}
  if(name===TABLE_GESTURE){if(data.clear)await controller?.clearGesture();else await controller?.gesture(data.gesture);return true;}
  throw Error('无效牌桌操作');
 };
}
