// Test-only transport for the real light settings entry.
const host = window as any;
const data = host.visionMock;
const events:Record<string,((value:any)=>void)[]>={};
const on=(name:string)=>(fn:(value:any)=>void)=>{(events[name]??=[]).push(fn);return ()=>{};};
data.emit=(name:string,value:any)=>{for(const fn of events[name]??[])fn(value);};
data.pending=[];
const sdk={
 onReady:(fn:()=>void)=>fn(),
 player:{getSelection:async()=>data.selection,getRole:async()=>data.role,onChange:on("player")},
 party:{getPlayers:async()=>data.players,onChange:on("party")},
 scene:{
  onReadyChange:on("ready"),
  grid:{getDpi:async()=>150,getScale:async()=>null},
  items:{
   onChange:on("items"),
   getItems:async(ids:string[])=>{
    const result=ids.map(id=>structuredClone(data.items[id])).filter(Boolean);
    if(data.holdRead) return new Promise(resolve=>data.pending.push(()=>resolve(result)));
    return result;
   },
   updateItems:async(ids:string[],fn:(items:any[])=>void)=>{
    if(data.failNext){data.failNext=false;throw Error("Expected save failure");}
    const write=()=>{const items=ids.map(id=>structuredClone(data.items[id])).filter(Boolean);fn(items);for(const item of items)data.items[item.id]=item;};
    if(data.holdWrite) return new Promise<void>(resolve=>data.pending.push(()=>{write();resolve();}));
    write();
   },
  },
 },
};
export default sdk;
