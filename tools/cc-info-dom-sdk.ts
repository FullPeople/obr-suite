const w=window as unknown as Record<string,any>,m=w.ccMock;
const on=(key:string,fn:any)=>{(m.listeners[key]??=new Set()).add(fn);return ()=>m.listeners[key].delete(fn);};
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
m.emit=(key:string,value:any)=>{for(const fn of [...m.listeners[key]??[]] as any[])fn(value);};
m.show=(cardId:string,itemId:string|null,roomId=m.roomId,connectionId="connection")=>m.emit("show",{connectionId,data:{cardId,itemId,roomId}});
m.releaseItems=()=>{for(const held of m.heldItems.splice(0))held.resolve(held.value);};
m.releaseFetch=(match:string)=>{const held=m.heldFetch.find((h:any)=>h.url.includes(match));if(held){m.heldFetch.splice(m.heldFetch.indexOf(held),1);held.resolve(held.value);}};
m.flushUpdates=()=>{for(const held of m.heldUpdates.splice(0))held();};
w.fetch=async(url:string)=>{m.fetches.push(url);const parts=new URL(url).pathname.split("/"),room=decodeURIComponent(parts[2]),id=decodeURIComponent(parts[3]);const data=copy(m.cards[`${room}:${id}`]);if(m.failFetch){m.failFetch=false;return {ok:false,status:503};}const value={ok:true,json:async()=>data};if(m.holdFetch)return new Promise(resolve=>m.heldFetch.push({url,resolve,value}));return value;};
export default {
 room:{get id(){return m.roomId;}},
 player:{getRole:()=>m.holdRole?new Promise(resolve=>m.releaseRole=()=>resolve(m.role)):Promise.resolve(m.role),getId:async()=>"player",getConnectionId:async()=>"connection",onChange:(fn:any)=>on("player",fn)},
 scene:{isReady:async()=>m.ready,onReadyChange:(fn:any)=>on("ready",fn),getMetadata:async()=>copy(m.metadata),onMetadataChange:(fn:any)=>on("metadata",fn),items:{
  getItems:async(ids:string[])=>{const value=ids.map(id=>m.items[id]).filter(Boolean).map(copy);if(m.holdItems)return new Promise(resolve=>m.heldItems.push({value,resolve}));return value;},
  onChange:(fn:any)=>on("items",fn),updateItems:async(ids:string[],update:(items:any[])=>void)=>{
   const write=()=>{const before=JSON.stringify(m.items),drafts=ids.map(id=>m.items[id]).filter(Boolean).map(copy);update(drafts);for(const draft of drafts)m.items[draft.id]=draft;if(before!==JSON.stringify(m.items))m.writes.push({ids:copy(ids),drafts:copy(drafts)});};
   if(m.holdUpdates)return new Promise<void>(resolve=>m.heldUpdates.push(()=>{write();resolve();}));write();
  },
 }},
 viewport:{getWidth:async()=>1200,getHeight:async()=>800},popover:{setHeight:async(_id:string,value:number)=>{m.heights.push(value);}},
 broadcast:{onMessage:(topic:string,fn:any)=>on(topic.endsWith("info-show")?"show":"updated",fn),sendMessage:async(topic:string,data:any,options:any)=>{m.sent.push({topic,data,options});}},
 onReady:(fn:()=>void)=>{void fn();},
};
