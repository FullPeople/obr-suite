import OBR from '@owlbear-rodeo/sdk';
import {getState} from '../state';
import {assetUrl} from '../asset-base';
import {tableWorkbench} from './table';
import {privateNotesCapability,roomNotes} from './notes';
import type {Relay} from './relay';
const personalKeys=new Set(['obr-suite/lang','obr-suite/sfx-dice','obr-suite/sfx-initiative','obr-suite/sfx-on','com.obr-suite/bubbles/scale','obr-suite/boss-bar/preferences']);
const musicPrefix='com.obr-suite/music-board:';
const safeLocal=new Set(['com.obr-suite/state-changed','com.obr-suite/local-content-changed','com.obr-suite/lang-changed','com.obr-suite/module-status/query','com.obr-suite/panel-side-hint','com.obr-suite/boss-bar/preferences-changed','com.obr-suite/settings-closed']);
export function panelBridge(send:(type:string,data:Record<string,unknown>)=>void,relay?:Pick<Relay,'send'>){
 const notes=relay?roomNotes(relay,async()=>privateNotesCapability(OBR.room.id||'default',await OBR.player.getId()),()=>OBR.player.getRole()):undefined;
 const subscriptions=new Map<string,()=>void>();
 const table=tableWorkbench((instance,event,name,data)=>send('panelEvent',{panel:'table',instance,event,name,data}));
 const events:Record<string,(fn:(data:any)=>void)=>()=>void>={
  'player':fn=>OBR.player.onChange(fn),'party':fn=>OBR.party.onChange(fn),'sceneReady':fn=>OBR.scene.onReadyChange(fn),'sceneMetadata':fn=>OBR.scene.onMetadataChange(fn),'roomMetadata':fn=>OBR.room.onMetadataChange(fn),'items':fn=>OBR.scene.items.onChange(fn),'grid':fn=>OBR.scene.grid.onChange(fn),'fog':fn=>OBR.scene.fog.onChange(fn)
 };
 return async function request(panel:string,instance:string,method:string,args:any[]){
  if(typeof instance!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(instance))throw Error('无效窗口');
  if(!['settings','music','studio','table','notes'].includes(panel))throw Error('无效功能页');
  if(panel==='notes'){if(!notes)throw Error('笔记存储暂不可用');return notes(method,args);}
  if(['music','studio'].includes(panel)&&getState().enabled.musicBoard===false)throw Error('音乐模块未开启');
  if(method==='init'){
   const [playerId,role,sceneReady,scene,room]=await Promise.all([OBR.player.getId(),OBR.player.getRole(),OBR.scene.isReady(),panel==='settings'?OBR.scene.getMetadata():Promise.resolve({}),panel==='settings'?OBR.room.getMetadata():Promise.resolve({})]);
   // Settings only need these variables at boot, never the full room card registry.
   const select=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(key=>Object.prototype.hasOwnProperty.call(value,key)).map(key=>[key,value[key]]));
   return {roomId:OBR.room.id,playerId,preferences:Object.fromEntries([...personalKeys].map(key=>[key,localStorage.getItem(key)])),reads:panel==='settings'?{'player.getRole':role,'scene.isReady':sceneReady,'scene.getMetadata':select(scene,['com.obr-suite/state','com.obr-suite/bubbles/settings']),'room.getMetadata':select(room,['com.obr-suite/state-room'])}:undefined};
  }
  const gm=await OBR.player.getRole()==='GM';
  if(method==='preferences.write'){const [key,value]=args;if(panel!=='settings'||!personalKeys.has(key)||value!==null&&(typeof value!=='string'||value.length>1000))throw Error('无效偏好');if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value,storageArea:localStorage}));return;}
  if(panel==='table'&&getState().enabled.threeDragonAnte===false&&method!=='dispose')throw Error('三龙牌未开启');
  if(method==='dispose'){if(panel==='table')await table(instance,method,args);for(const [key,off] of subscriptions)if(key.startsWith(`${panel}:${instance}:`)){off();subscriptions.delete(key);}return;}
  if(panel==='studio'&&['studio.read','studio.command'].includes(method)){const {workbenchStudio}=await import('../modules/musicBoard');return method==='studio.read'?workbenchStudio():workbenchStudio(args[0],String(args[1]).slice(0,100));}
  if(method==='subscribe'){
   const [event,name]=args,key=`${panel}:${instance}:${event}:${name||''}`;
   if(subscriptions.has(key))return;
   const emit=(data:any)=>send('panelEvent',{panel,instance,event,name,data});
   if(event==='broadcast'&&typeof name==='string'&&name.startsWith('com.')&&name.length<160){if(['music','studio'].includes(panel)&&!name.startsWith(musicPrefix))throw Error('无效音乐订阅');if(panel==='table'&&!name.startsWith('com.fullpeople/three-dragon-ante/'))throw Error('无效牌桌订阅');subscriptions.set(key,OBR.broadcast.onMessage(name,emit));}
   else if(Object.prototype.hasOwnProperty.call(events,event))subscriptions.set(key,events[event](emit));else throw Error('无效订阅');return;
  }
  if(method==='broadcast.sendMessage'){
   const [name,data,options]=args;
   if(typeof name!=='string'||!name.startsWith('com.')||!['LOCAL','REMOTE','ALL'].includes(options?.destination))throw Error('无效功能消息');
   if(panel==='table'){if(options.destination!=='LOCAL')throw Error('牌桌消息必须经游戏控制器处理');return table(instance,method,args);}
   if(['music','studio'].includes(panel)){
    if(![musicPrefix+'command',musicPrefix+'local',musicPrefix+'ready'].includes(name))throw Error('无效音乐操作');
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
   'popover.open':v=>{const url=new URL(v.url,location.href);if(url.origin!==location.origin||!url.pathname.startsWith(new URL(assetUrl(''),location.href).pathname))throw Error('无效窗口地址');return OBR.popover.open(v);}
  };
  if(!Object.prototype.hasOwnProperty.call(writes,method))throw Error('不支持的设置操作：'+method);return writes[method](...args);
 };
}
