import {QQ_CARDS,QQ_ORIGIN,QQ_STORAGE,qqSession,clearQQSession,type QQRoom} from './qq-account';
import {watchCloudChanges} from './change-watch';
import {cloudFeaturesEnabled,assertCloudEnabled} from '../../cloud-availability';

/** Keep room proofs in memory; no character data is included in a notice. */
export function qqChangeRooms(metadata:Record<string,unknown>):QQRoom[]{
 if(!cloudFeaturesEnabled)return [];
 const rows=metadata[QQ_CARDS];if(!Array.isArray(rows))return [];
 const rooms=new Map<string,QQRoom>();
 for(const row of rows){const room=row?.qqRoom;if(typeof room?.id==='string'&&room.id&&typeof room.capability==='string'&&room.capability)rooms.set(room.id,{id:room.id,capability:room.capability});}
 return [...rooms.values()].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,32);
}

export async function qqChangeNotice(rooms:QQRoom[],cursor:string|undefined,signal:AbortSignal):Promise<unknown>{
 assertCloudEnabled();
 const session=qqSession(),controller=new AbortController(),abort=()=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const timer=setTimeout(abort,30000);
 try{
  const response=await fetch(QQ_ORIGIN+'/api/changes',{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...session?{Authorization:'Bearer '+session.token}:{}},body:JSON.stringify({cursor,rooms})});
  const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||'云端变更读取失败。'),{status:response.status});return value;
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

export type QQScopeStatus={room:QQRoom;valid:boolean;status:number};
async function probeRoom(room:QQRoom,token:string,signal:AbortSignal):Promise<QQScopeStatus>{
 const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();const timer=setTimeout(abort,1000);
 try{const response=await fetch(QQ_ORIGIN+'/api/room-cards/'+encodeURIComponent(room.id)+'?summary=1',{credentials:'omit',cache:'no-store',signal:controller.signal,headers:{...token?{Authorization:'Bearer '+token}:{},'X-Room-Capability':room.capability}});await response.body?.cancel();return {room,valid:response.ok,status:response.status};}
 catch{return {room,valid:false,status:0};}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export function observeQQChanges(options:{rooms:()=>QQRoom[];changed:()=>Promise<void>;scopeStatus?:(results:QQScopeStatus[])=>void}){
 if(!cloudFeaturesEnabled)return {stop:()=>{},retry:()=>{},checkScope:()=>{},blockedRooms:()=>new Set<string>(),done:Promise.resolve()};
 const scope=()=>JSON.stringify([qqSession()?.token||'',options.rooms()]);
 let current=scope(),alive=true;
 const excluded=new Map<string,{key:string;retryAt:number}>(),key=(room:QQRoom)=>JSON.stringify([qqSession()?.token||'',room.id,room.capability]);
 let retryTimer:ReturnType<typeof setTimeout>|undefined;
 const armRetry=()=>{clearTimeout(retryTimer);retryTimer=undefined;const rooms=options.rooms();let deadline=Infinity;for(const [id,value] of excluded){const room=rooms.find(room=>room.id===id);if(!room||value.key!==key(room)){excluded.delete(id);continue;}if(value.retryAt>Date.now())deadline=Math.min(deadline,value.retryAt);}if(alive&&Number.isFinite(deadline))retryTimer=setTimeout(()=>{retryTimer=undefined;if(alive){watcher.wake();armRetry();}},Math.max(0,deadline-Date.now()));};
 const activeRooms=()=>options.rooms().filter(room=>{const rejected=excluded.get(room.id);return !rejected||rejected.key!==key(room)||Date.now()>=rejected.retryAt;});
 const request=async(cursor:string|undefined,signal:AbortSignal)=>{
  const identity=scope(),token=qqSession()?.token||'',rooms=activeRooms();
  try{const value=await qqChangeNotice(rooms,cursor,signal);if(alive&&!signal.aborted&&identity===scope()){const restored=rooms.filter(room=>excluded.has(room.id));for(const room of restored)excluded.delete(room.id);armRetry();if(restored.length){options.scopeStatus?.(restored.map(room=>({room,valid:true,status:200})));return {...value as object,changed:true};}}return value;}catch(error){
   if(![403,404,410].includes(Number((error as {status?:number})?.status))||!rooms.length||signal.aborted)throw error;
   const results:QQScopeStatus[]=[],queue=[...rooms];
   await Promise.all(Array.from({length:Math.min(4,rooms.length)},async()=>{for(;;){const room=queue.shift();if(!room||signal.aborted)return;results.push(await probeRoom(room,token,signal));}}));
   if(!alive||signal.aborted||identity!==scope())throw error;
   let rejected=false;
   for(const result of results){if(result.valid)excluded.delete(result.room.id);else{rejected=true;excluded.set(result.room.id,{key:key(result.room),retryAt:Date.now()+([403,404,410].includes(result.status)?30000:5000)});}}
   options.scopeStatus?.(results);while(excluded.size>64)excluded.delete(excluded.keys().next().value!);
   armRetry();
   if(!rejected)throw error;
   if(!token&&!activeRooms().length)throw Object.assign(error as object,{scopeFailure:true});
   const recovered=await qqChangeNotice(activeRooms(),undefined,signal);return {...recovered as object,changed:true};
  }
 };
 const watcher=watchCloudChanges({scope,account:()=>qqSession()?.accountId,active:()=>navigator.onLine&&!!(qqSession()||activeRooms().length),request,changed:options.changed,failed:error=>{if((error as {status?:number}).status===401)clearQQSession(qqSession()?.token);}});
 const refresh=()=>{if(alive)void options.changed().catch(()=>{});};
 const wake=()=>{current=scope();for(const value of excluded.values())value.retryAt=0;armRetry();watcher.wake();refresh();};
 const storage=(event:StorageEvent)=>{if(event.key===QQ_STORAGE)wake();};
 const pagehide=(event:PageTransitionEvent)=>{if(!event.persisted)stop();};
 const stop=()=>{if(!alive)return;alive=false;clearTimeout(retryTimer);retryTimer=undefined;watcher.stop();window.removeEventListener('qq-account-changed',wake);window.removeEventListener('storage',storage);window.removeEventListener('online',wake);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',wake);};
 window.addEventListener('qq-account-changed',wake);window.addEventListener('storage',storage);window.addEventListener('online',wake);window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',wake);
 return {stop,retry:wake,checkScope(){const next=scope();if(next!==current){current=next;armRetry();watcher.wake();refresh();}},blockedRooms:()=>new Set(options.rooms().filter(room=>excluded.get(room.id)?.key===key(room)).map(room=>room.id)),done:watcher.done};
}
