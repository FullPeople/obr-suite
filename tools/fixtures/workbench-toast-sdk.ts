import api from './workbench-sdk';
const host=parent.frames[0] as any;
const mock=host.wbMock;
const unsubscribers=new Set<()=>void>();
api.broadcast.onMessage=(key:string,fn:any)=>{
 if(!mock.listeners.has(key))mock.listeners.set(key,new Set());
 mock.listeners.get(key).add(fn);
 const off=()=>{mock.listeners.get(key)?.delete(fn);unsubscribers.delete(off);};
 unsubscribers.add(off);return off;
};
// The real SDK iframe disconnects on removal. Keeping callbacks in the host's
// shared Set would let detached renderers consume notices and emit fake ACKs.
window.addEventListener('unload',()=>{for(const off of [...unsubscribers])off();},{once:true});
api.broadcast.sendMessage=async(name:string,data:any,opts:any)=>{mock.broadcasts.push({name,data,opts});if(opts?.destination!=='REMOTE')mock.emit(name,{data,connectionId:'connection'});};
api.player.getRole=async()=>{
 if(mock.delayToastRole){const role=mock.role;return new Promise(resolve=>{mock.resolveToastRole=()=>resolve(role);});}
 return mock.role;
};api.player.onChange=(fn:any)=>api.broadcast.onMessage('player',fn);
export default api;
