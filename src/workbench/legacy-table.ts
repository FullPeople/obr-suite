import OBR from '@owlbear-rodeo/sdk';
import {TABLE_COMMAND,TABLE_READY,TABLE_VIEW,TABLE_ROOM_KEY} from '../modules/threeDragonAnte/protocol';
import {localViewParts} from '../modules/threeDragonAnte/local-view';
import {TABLE_UI_RESTORE,readUIDraft,type TableUIDraft} from '../modules/threeDragonAnte/ui-command';
import type {TableController} from '../modules/threeDragonAnte/controller';

/** The historical channel keeps its own rules, native controller and private
 * database. Only an existing historical table can activate this adapter. */
export function legacyTableWorkbench(emit:(instance:string,event:string,name:string,data:unknown)=>void|Promise<void>){
 let controller:TableController|undefined,starting:Promise<void>|undefined,timer:ReturnType<typeof setInterval>|undefined,sequence=0;
 const clients=new Map<string,string>();let draft:TableUIDraft|null=null,publishing:Promise<void>|undefined,publishRequested=false;
 function publish():Promise<void>{publishRequested=true;if(publishing)return publishing;publishing=(async()=>{while(publishRequested){publishRequested=false;if(!controller)return;const connectionId=await OBR.player.getConnectionId();for(const [instance,client] of clients)for(const part of localViewParts(controller.view,client,++sequence))await emit(instance,'broadcast',TABLE_VIEW,{connectionId,data:part});}})().finally(()=>{publishing=undefined;});return publishing;}
 async function ready(){
  if(controller&&!starting)return;
  if(!starting)starting=(async()=>{
   if(!(await OBR.room.getMetadata())[TABLE_ROOM_KEY])throw Error('没有可恢复的旧版牌桌');
   const {TableController}=await import('../modules/threeDragonAnte/controller');
   controller=new TableController(()=>{void publish().catch(()=>{});});await controller.start();
   timer??=setInterval(()=>{if(clients.size)void publish().catch(()=>{});},3000);
  })().catch(async error=>{const old=controller;controller=undefined;await old?.stop();throw error;}).finally(()=>{starting=undefined;});
  await starting;
 }
 async function request(instance:string,method:string,args:any[]){
  if(method==='dispose'){clients.delete(instance);return true;}
  if(method!=='broadcast.sendMessage')return false;
  const [name,data]=args;if(name!==TABLE_READY&&name!==TABLE_COMMAND)return false;
  if(name===TABLE_READY){
   if(typeof data?.clientId!=='string'||!data.clientId||data.clientId.length>80)throw Error('无效旧版牌桌身份');
   clients.set(instance,data.clientId);await ready();await publish();
   if(draft&&draft.tableId===controller?.view.table?.id&&draft.gameId===controller?.view.game?.id)await emit(instance,'broadcast',TABLE_UI_RESTORE,{connectionId:await OBR.player.getConnectionId(),data:{instance,clientId:data.clientId,draft}});
   return true;
  }
  if(clients.get(instance)!==data?.clientId)throw Error('旧版牌桌连接已改变');
  const command=data.command;if(!command||typeof command.type!=='string')throw Error('无效旧版牌桌操作');
  if(command.type==='create')throw Error('旧版入口仅用于恢复已有牌桌，请从当前牌桌入口新建');
  if(['close','display','remember'].includes(command.type)){const next=readUIDraft(command.draft);if(next&&next.tableId===controller?.view.table?.id&&next.gameId===controller?.view.game?.id)draft=next;}
  else{await ready();await controller!.command(command);}
  await publish();return true;
 }
 async function stop(){if(timer)clearInterval(timer);timer=undefined;clients.clear();await starting?.catch(()=>{});const old=controller;controller=undefined;await old?.stop();await publishing?.catch(()=>{});}
 return {request,stop};
}
