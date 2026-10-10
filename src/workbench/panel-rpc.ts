import {QQ_CARDS,acceptQQSession,clearQQSession,qqSession,qqRequest,disconnectQQ} from '../modules/characterCards/qq-account';
import {markPlayerPermissionsRead} from '../player-permission-notice';
import { requestTextEffect } from '../modules/textEffects';
import { REQUEST as TEXT_EFFECT_REQUEST, STATUS as TEXT_EFFECT_STATUS } from '../modules/textEffects/protocol';
import OBR from '@owlbear-rodeo/sdk';
import {getState} from '../state';
import {assetUrl} from '../asset-base';
import {tableWorkbench} from './table';
import {SERVER_GRANT,SERVER_ROOM_KEY,SERVER_WINDOW,serverRoom} from '../../extensions/three-dragon-ante/src/game/server-protocol';
import {setupServerAdmission} from '../../extensions/three-dragon-ante/src/game/server-session';
import {privateNotesCapability,roomNotes} from './notes';
import type {Relay} from './relay';
const personalKeys=new Set(['obr-suite/lang','obr-suite/sfx-dice','obr-suite/sfx-initiative','obr-suite/sfx-on','com.obr-suite/bubbles/scale','obr-suite/boss-bar/preferences','obr-suite/dice/view-mode']);
const musicPrefix='com.obr-suite/music-board:';
const safeLocal=new Set(['com.obr-suite/state-changed','com.obr-suite/local-content-changed','com.obr-suite/lang-changed','com.obr-suite/module-status/query','com.obr-suite/panel-side-hint','com.obr-suite/boss-bar/preferences-changed','com.obr-suite/settings-closed']);
export function panelBridge(send:(type:string,data:Record<string,unknown>)=>void,relay?:Pick<Relay,'send'>,selectQQCard?:(id:string,document?:unknown)=>Promise<void>){
 setupServerAdmission();
 const notes=relay?roomNotes(relay,async()=>privateNotesCapability(OBR.room.id||'default',await OBR.player.getId()),()=>OBR.player.getRole()):undefined;
 const subscriptions=new Map<string,()=>void>();
 const imported=new Map<string,any>();
 const table=tableWorkbench((instance,event,name,data)=>send('panelEvent',{panel:'table',instance,event,name,data}));
 const events:Record<string,(fn:(data:any)=>void)=>()=>void>={
  'player':fn=>OBR.player.onChange(fn),'party':fn=>OBR.party.onChange(fn),'sceneReady':fn=>OBR.scene.onReadyChange(fn),'sceneMetadata':fn=>OBR.scene.onMetadataChange(fn),'roomMetadata':fn=>OBR.room.onMetadataChange(fn),'items':fn=>OBR.scene.items.onChange(fn),'grid':fn=>OBR.scene.grid.onChange(fn),'fog':fn=>OBR.scene.fog.onChange(fn)
 };
 return async function request(panel:string,instance:string,method:string,args:any[]){
  if(typeof instance!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(instance))throw Error('无效窗口');
  if(!['settings','music','table','notes','permissions','textEffects','qq'].includes(panel))throw Error('无效功能页');
  if(panel==='qq'){
   if(method==='account.attach'&&args.length===1)return acceptQQSession(args[0]);
   if(method==='account.clear'&&args.length===1)return clearQQSession(args[0]);
   if(method==='account.status'&&!args.length){const session=qqSession();return session?{authenticated:true,account:{id:session.accountId,nickname:session.nickname}}:{authenticated:false};}
   if(method==='account.logout'&&!args.length)return disconnectQQ();
   if(method==='account.request'){
    const [path,verb='GET',data,capability]=args;
    if(typeof path!=='string'||!(verb==='GET'&&['session','cards'].includes(path)||verb==='POST'&&/^cards\/(?:[A-Z]{6}|[a-f0-9-]{36})\/rooms$/.test(path)||['PUT','DELETE'].includes(verb)&&/^room-cards\/[a-f0-9-]{36}(?:\/lock)?$/.test(path)))throw Error('无效 QQ 卡库请求');
    if(verb==='POST'&&data?.room!==OBR.room.id)throw Error('房间已改变，请重新打开卡库');
    const result=await qqRequest(path,verb,data,capability);if(verb==='POST'){imported.set(result.id,result.document);while(imported.size>32)imported.delete(imported.keys().next().value!);}return result;
   }
   if(method==='card.select'&&args.length===1&&typeof args[0]==='string'&&selectQQCard){await selectQQCard(args[0],imported.get(args[0]));imported.delete(args[0]);return;}
   // Personal sessions stay with this player's host. Room APIs expose only the QQ registry.
   const select=(metadata:Record<string,unknown>)=>({[QQ_CARDS]:metadata[QQ_CARDS]??[]});
   if(method==='init')return {roomId:OBR.room.id,playerId:await OBR.player.getId(),preferences:{}};
   if(method==='player.getId')return OBR.player.getId();
   if(method==='room.getMetadata')return select(await OBR.room.getMetadata());
   if(method==='room.setMetadata'){
    const update=args[0],rows=update?.[QQ_CARDS];
    if(args.length!==1||!update||Object.keys(update).length!==1||!Array.isArray(rows)||rows.length>1000||JSON.stringify(rows).length>1000000||rows.some(row=>!row||typeof row.id!=='string'||typeof row.name!=='string'||typeof row.qqOwner!=='string'||typeof row.locked!=='boolean'||!['owners','public'].includes(row.visibility)||!Array.isArray(row.owner_ids)||row.owner_ids.some((id:unknown)=>typeof id!=='string')||typeof row.qqRoom?.id!=='string'||!/^[a-f0-9-]{36}$/.test(row.qqRoom.id)||typeof row.qqRoom?.capability!=='string'))throw Error('无效 QQ 房间卡资料');
    return OBR.room.setMetadata({[QQ_CARDS]:rows});
   }
   if(method==='subscribe'&&args[0]==='roomMetadata'&&args[1]==null){
    const key=`${panel}:${instance}:roomMetadata:`;
    if(!subscriptions.has(key))subscriptions.set(key,OBR.room.onMetadataChange(metadata=>send('panelEvent',{panel,instance,event:'roomMetadata',data:select(metadata)})));
    return;
   }
   if(method==='dispose'){for(const [key,off] of subscriptions)if(key.startsWith(`${panel}:${instance}:`)){off();subscriptions.delete(key);}return;}
   throw Error('不支持的 QQ 卡库操作');
  }
  if(panel==='textEffects'&&method!=='dispose'){
   if(method==='broadcast.sendMessage'){
    if(args.length!==3||args[0]!==TEXT_EFFECT_REQUEST||args[2]?.destination!=='LOCAL')throw Error('无效文字演出操作');
    return requestTextEffect(args[1]);
   }
   if(method==='subscribe'&&!(args[0]==='player'&&args[1]===undefined||args[0]==='sceneReady'&&args[1]===undefined||args[0]==='broadcast'&&args[1]===TEXT_EFFECT_STATUS))throw Error('无效文字演出订阅');
   if(!['init','subscribe','player.getConnectionId','player.getRole','scene.isReady'].includes(method))throw Error('无效文字演出操作');
  }
  if(panel==='notes'){if(!notes)throw Error('笔记存储暂不可用');return notes(method,args);}
  // The local GM guide has no scene, room, metadata or broadcast capability.
  if(panel==='permissions'&&method!=='dispose'){
   if(await OBR.player.getRole()!=='GM')throw Error('仅 DM 可查看权限说明');
   if(!['init','player.getRole','subscribe','permissions.acknowledge'].includes(method)||method==='subscribe'&&(args[0]!=='player'||args[1]!==undefined))throw Error('无效权限说明操作');
   if(method==='permissions.acknowledge'){if(args.length)throw Error('无效权限确认');markPlayerPermissionsRead();return {seen:true};}
  }
  if(panel==='music'&&getState().enabled.musicBoard===false)throw Error('音乐模块未开启');
  if(method==='init'){
   const [playerId,role,sceneReady,scene,room]=await Promise.all([OBR.player.getId(),OBR.player.getRole(),OBR.scene.isReady(),panel==='settings'?OBR.scene.getMetadata():Promise.resolve({}),panel==='settings'?OBR.room.getMetadata():Promise.resolve({})]);
   // Settings only need these variables at boot, never the full room card registry.
   const select=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(key=>Object.prototype.hasOwnProperty.call(value,key)).map(key=>[key,value[key]]));
   return {roomId:OBR.room.id,playerId,preferences:Object.fromEntries([...personalKeys].map(key=>[key,localStorage.getItem(key)])),reads:panel==='settings'?{'player.getRole':role,'scene.isReady':sceneReady,'scene.getMetadata':select(scene,['com.obr-suite/state','com.obr-suite/bubbles/settings']),'room.getMetadata':select(room,['com.obr-suite/state-room'])}:undefined};
  }
  const gm=await OBR.player.getRole()==='GM';
  if(method==='preferences.write'){const [key,value]=args;if(panel!=='settings'||!personalKeys.has(key)||value!==null&&(typeof value!=='string'||value.length>1000)||key==='obr-suite/dice/view-mode'&&value!==null&&value!=='2d'&&value!=='3d')throw Error('无效偏好');if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value,storageArea:localStorage}));return;}
  if(panel==='table'&&getState().enabled.threeDragonAnte===false&&method!=='dispose')throw Error('三龙牌未开启');
  if(method==='dispose'){if(panel==='table')await table(instance,method,args);for(const [key,off] of subscriptions)if(key.startsWith(`${panel}:${instance}:`)){off();subscriptions.delete(key);}return;}
  if(method==='subscribe'){
   const [event,name]=args,key=`${panel}:${instance}:${event}:${name||''}`;
   if(subscriptions.has(key))return;
   const emit=(data:any)=>send('panelEvent',{panel,instance,event,name,data});
   if(event==='broadcast'&&typeof name==='string'&&name.startsWith('com.')&&name.length<160){if(panel==='music'&&!name.startsWith(musicPrefix))throw Error('无效音乐订阅');if(panel==='table'&&!name.startsWith('com.fullpeople/three-dragon-ante/')&&!name.startsWith('com.obr-suite/three-dragon-ante/'))throw Error('无效牌桌订阅');subscriptions.set(key,OBR.broadcast.onMessage(name,emit));}
   else if(Object.prototype.hasOwnProperty.call(events,event))subscriptions.set(key,events[event](emit));else throw Error('无效订阅');return;
  }
  if(method==='broadcast.sendMessage'){
   const [name,data,options]=args;
   if(typeof name!=='string'||!name.startsWith('com.')||!['LOCAL','REMOTE','ALL'].includes(options?.destination))throw Error('无效功能消息');
   if(panel==='table'){
    if(name===SERVER_GRANT&&options.destination==='ALL'&&typeof data?.roomId==='string'&&typeof data?.memberId==='string'&&typeof data?.challenge==='string'&&JSON.stringify(data).length<500)return OBR.broadcast.sendMessage(name,data,options);
    if(name===SERVER_WINDOW&&options.destination==='LOCAL'&&['close','display'].includes(data?.command?.type))return true;
    if(options.destination!=='LOCAL')throw Error('牌桌消息必须经游戏控制器处理');return table(instance,method,args);
   }
   if(panel==='music'){
    if(![musicPrefix+'command',musicPrefix+'command:part',musicPrefix+'local',musicPrefix+'ready'].includes(name))throw Error('无效音乐操作');
    // Shared music commands still go through RoomMusic's writer and fresh role/allowPlayers check.
   }else if(!gm&&!safeLocal.has(name))throw Error('此设置仅 DM 可以调整');
   return OBR.broadcast.sendMessage(name,data,options);
  }
  const reads:Record<string,()=>Promise<any>>={
   'player.getId':()=>OBR.player.getId(),'player.getConnectionId':()=>OBR.player.getConnectionId(),'player.getRole':()=>OBR.player.getRole(),'player.getName':()=>OBR.player.getName(),'player.getColor':()=>OBR.player.getColor(),'player.getMetadata':()=>OBR.player.getMetadata(),'player.getSelection':()=>OBR.player.getSelection(),'party.getPlayers':()=>OBR.party.getPlayers(),
   'scene.isReady':()=>OBR.scene.isReady(),'scene.getMetadata':()=>OBR.scene.getMetadata(),'room.getMetadata':()=>OBR.room.getMetadata(),'scene.grid.getDpi':()=>OBR.scene.grid.getDpi(),'scene.grid.getScale':()=>OBR.scene.grid.getScale(),'scene.grid.getType':()=>OBR.scene.grid.getType(),'scene.fog.getFilled':()=>OBR.scene.fog.getFilled(),
   'viewport.getWidth':()=>OBR.viewport.getWidth(),'viewport.getHeight':()=>OBR.viewport.getHeight(),'viewport.getPosition':()=>OBR.viewport.getPosition(),'viewport.getScale':()=>OBR.viewport.getScale()
  };
  if(Object.prototype.hasOwnProperty.call(reads,method))return reads[method]();
  if(method==='notification.show')return OBR.notification.show(String(args[0]).slice(0,400));
  if(method==='player.setMetadata')return OBR.player.setMetadata(args[0]);
  if(panel==='table'&&method==='room.setMetadata'){
   const keys=Object.keys(args[0]||{});if(keys.length!==1||keys[0]!==SERVER_ROOM_KEY||!serverRoom(args[0][SERVER_ROOM_KEY]))throw Error('无效牌桌邀请');
   return OBR.room.setMetadata({[SERVER_ROOM_KEY]:serverRoom(args[0][SERVER_ROOM_KEY])});
  }
  if(panel!=='settings'||!gm)throw Error('此设置仅 DM 可以调整');
  if(method==='scene.items.getItems'||method==='scene.local.getItems'){const api=method.includes('.local.')?OBR.scene.local:OBR.scene.items;return api.getItems(Array.isArray(args[0])?args[0]:undefined);}
  if(method==='scene.items.applyChanges'||method==='scene.local.applyChanges'){
   const api=method.includes('.local.')?OBR.scene.local:OBR.scene.items,[previous,next]=args;
   if(!Array.isArray(previous)||!Array.isArray(next)||previous.length!==next.length||next.some((row,i)=>row.id!==previous[i]?.id))throw Error('无效的棋子更新');
   return api.updateItems(previous.map(row=>row.id),drafts=>{for(let i=0;i<previous.length;i++){const target=drafts.find(row=>row.id===previous[i].id);if(!target||JSON.stringify(target)!==JSON.stringify(previous[i]))throw Error('场景内容已经改变，请重试');Object.keys(target).forEach(key=>{if(!(key in next[i]))delete (target as any)[key];});Object.assign(target,next[i]);}});
  }
  const writes:Record<string,(...values:any[])=>Promise<any>>={
   'scene.setMetadata':v=>OBR.scene.setMetadata(v),'room.setMetadata':v=>OBR.room.setMetadata(v),'scene.fog.setFilled':v=>OBR.scene.fog.setFilled(!!v),
   'scene.items.addItems':v=>OBR.scene.items.addItems(v),'scene.items.deleteItems':v=>OBR.scene.items.deleteItems(v),'scene.local.addItems':v=>OBR.scene.local.addItems(v),'scene.local.deleteItems':v=>OBR.scene.local.deleteItems(v),
   'assets.downloadImages':(...v)=>OBR.assets.downloadImages(v[0],v[1],v[2]),'assets.uploadImages':(...v)=>OBR.assets.uploadImages(v[0],v[1]),
   'popover.open':v=>{const url=new URL(v.url,location.href);if(url.origin!==location.origin||!url.pathname.startsWith(new URL(assetUrl(''),location.href).pathname))throw Error('无效窗口地址');throw Error('请在工作台内打开设置，当前版本不在枭熊界面中弹出窗口。');}
  };
  if(!Object.prototype.hasOwnProperty.call(writes,method))throw Error('不支持的设置操作：'+method);return writes[method](...args);
 };
}
