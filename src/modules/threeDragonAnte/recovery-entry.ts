import OBR from '@owlbear-rodeo/sdk';
import {WORKBENCH_DEV} from '../../workbench/channel';
import {getLocalLang} from '../../state';
import {TABLE_OPEN,TABLE_ROOM_KEY} from './protocol';

/** This is an explicit recovery entry, not a new default game module. */
export function setupHistoricalTableEntry(){
 if(WORKBENCH_DEV)return;
 let loading:Promise<typeof import('./index')>|undefined;
 OBR.broadcast.onMessage(TABLE_OPEN,event=>{void(async()=>{
  if(event.connectionId!==await OBR.player.getConnectionId())return;
  const metadata=await OBR.room.getMetadata(),table=metadata[TABLE_ROOM_KEY] as {version?:number;id?:string;stage?:string}|undefined;
  if(table?.version!==1||typeof table.id!=='string'||!['lobby','playing'].includes(table.stage||'')){
   await OBR.notification.show(getLocalLang()==='en'?'No historical table is available to recover in this room.':'此房间没有可恢复的旧版牌局。','INFO');return;
  }
  loading??=(async()=>{const module=await import('./index');await module.setupThreeDragonAnte({listenOpen:false});return module;})().catch(error=>{loading=undefined;throw error;});
  const module=await loading;
  if(event.connectionId!==await OBR.player.getConnectionId())return;
  await module.openHistoricalTable();
 })().catch(error=>{console.warn('[three-dragon] historical recovery entry failed',error);void OBR.notification.show(getLocalLang()==='en'?'The historical table could not be opened. Please retry.':'旧版牌局暂时无法打开，请重试。','ERROR');});});
}
