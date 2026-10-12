import {QQ_CARDS,QQ_ORIGIN,QQ_STORAGE,qqSession,clearQQSession,type QQRoom} from './qq-account';
import {watchCloudChanges} from './change-watch';

/** Keep room proofs in memory; no character data is included in a notice. */
export function qqChangeRooms(metadata:Record<string,unknown>):QQRoom[]{
 const rows=metadata[QQ_CARDS];if(!Array.isArray(rows))return [];
 const rooms=new Map<string,QQRoom>();
 for(const row of rows){const room=row?.qqRoom;if(typeof room?.id==='string'&&room.id&&typeof room.capability==='string'&&room.capability)rooms.set(room.id,{id:room.id,capability:room.capability});}
 return [...rooms.values()].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,32);
}

export async function qqChangeNotice(rooms:QQRoom[],cursor:string|undefined,signal:AbortSignal):Promise<unknown>{
 const session=qqSession(),controller=new AbortController(),abort=()=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const timer=setTimeout(abort,30000);
 try{
  const response=await fetch(QQ_ORIGIN+'/api/changes',{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...session?{Authorization:'Bearer '+session.token}:{}},body:JSON.stringify({cursor,rooms})});
  const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||'云端变更读取失败。'),{status:response.status});return value;
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

export function observeQQChanges(options:{rooms:()=>QQRoom[];changed:()=>Promise<void>}){
 const scope=()=>JSON.stringify([qqSession()?.token||'',options.rooms()]);
 let current=scope(),alive=true;
 const watcher=watchCloudChanges({scope,account:()=>qqSession()?.accountId,active:()=>navigator.onLine&&!!(qqSession()||options.rooms().length),request:(cursor,signal)=>qqChangeNotice(options.rooms(),cursor,signal),changed:options.changed,failed:error=>{if((error as {status?:number}).status===401)clearQQSession(qqSession()?.token);}});
 const refresh=()=>{if(alive)void options.changed().catch(()=>{});};
 const wake=()=>{current=scope();watcher.wake();refresh();};
 const storage=(event:StorageEvent)=>{if(event.key===QQ_STORAGE)wake();};
 const pagehide=(event:PageTransitionEvent)=>{if(!event.persisted)stop();};
 const stop=()=>{if(!alive)return;alive=false;watcher.stop();window.removeEventListener('qq-account-changed',wake);window.removeEventListener('storage',storage);window.removeEventListener('online',wake);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',wake);};
 window.addEventListener('qq-account-changed',wake);window.addEventListener('storage',storage);window.addEventListener('online',wake);window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',wake);
 return {stop,checkScope(){const next=scope();if(next!==current){current=next;watcher.wake();refresh();}},done:watcher.done};
}
