// Production Controller/codec parity against the fixed released 245 source; synthetic physics and transport.
import assert from 'node:assert/strict';
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import {BUILD,now} from '../extensions/workbench-dice3d/src/types';
import {encodeRoll,hash,split} from '../extensions/workbench-dice3d/src/wire.mjs';
function host(){const h:any=Object.create(Controller.prototype),sent:any[]=[],local:any[]=[],worker:any[]=[],errors:any[]=[];
 Object.assign(h,{transport:{id:'host',name:'Host',role:'GM'},catalog:diceCatalog(),ready:true,disabled:false,born:0,peers:new Map([['peer',{id:'peer',session:'12345678-1234-1234-1234-123456789012',name:'Peer',role:'PLAYER',ready:true,born:1,lastSeen:now(),rtt:20,offset:0,version:BUILD,inlineRollV1:true}]]),inbound:new Map(),outgoing:new Map(),rolls:new Map(),queue:[],requests:new Map(),accepted:new Map(),retainedUntil:new Map(),settledAt:new Map(),heldRolls:new Map(),reservations:new Map(),privateRunning:new Set(),privateAudiences:new Map(),secrets:new Map(),records:new Map(),probes:new Map(),clocks:new Map(),started:new Map(),events:[],lastState:now(),lastPresence:now(),bytesReceived:0,packetsReceived:0,bytesSent:0,packetsSent:0,viewport:{w:390,h:844},keys:{forget:()=>{},remember:async()=>{},ready:Promise.resolve(),publicKey:'synthetic'},worker:{postMessage:(p:any)=>worker.push(p)},bus:{postMessage:(p:any)=>local.push(p)},state:()=>{},sendRecords:()=>{},log:()=>{},fail:(...e:any[])=>errors.push(e),next:()=>{},addRecord:()=>{},retainUntilExit:()=>{},send:async(p:any,stamp?:(q:any)=>void)=>{stamp?.(p);sent.push(structuredClone(p));},ping:async()=>{}});return {h,sent,local,worker,errors};}
function roll(count=1,frames=30){const request:any={id:'r',source:'host',authority:'host',name:'Host',kind:'d6',count,theme:'ink_sketch',seed:1,modifier:0,visibility:'all'};return{version:2,request,kinds:Array(count).fill('d6'),results:Array(count).fill(3),fps:120,frames,poses:new Float32Array(frames*count*7),contacts:[],physicsMs:1,steps:frames*2,collisions:0,duration:(frames-1)/120};}
async function produce(options:any={}){const fixture=host(),{h,sent,local}=fixture,r=roll(options.count??1,options.frames??30);options.alterRoll?.(r);options.alter?.(h);h.pending=r.request;
 h.bus.postMessage=(p:any)=>{local.push(p);if(p.type==='prepare')void h.onLocal({type:'prepared',id:p.roll.request.id});};
 h.send=async(p:any,stamp?:(q:any)=>void)=>{stamp?.(p);sent.push(structuredClone(p));if(p.type==='offer'){const out=h.outgoing.get(p.id);for(const member of out?.members||[])out.wait.delete(member);await options.duringOffer?.(h,p);}};
 await h.onWorker({id:r.request.id,roll:r});return{...fixture,r};}

const outputs:any[]=[];
for(const count of [1,2,5,9,10])for(const noisy of [false,true]){
 const f=await produce({count,frames:noisy?180:30,alter:(h:any)=>{h.peers.get('peer').inlineChunkV1=true;},alterRoll:(r:any)=>{if(noisy){let seed=91;for(let i=0;i<r.poses.length;i++){seed=(Math.imul(1664525,seed)+1013904223)>>>0;r.poses[i]=seed/2**32;}}}});
 assert.deepEqual(f.errors,[]);const network=f.sent.filter(p=>['offer','chunk','chunks-done'].includes(p.type)),offer=network[0];
 assert.equal(offer.type,'offer');assert.equal(offer.inlineChunk,undefined);assert.deepEqual(network.slice(1,-1).map(p=>[p.type,p.index]),Array.from({length:offer.total},(_,i)=>['chunk',i]));assert.equal(network.at(-1).type,'chunks-done');
 assert.equal(f.local.filter(p=>p.type==='start').length,1);outputs.push({count,noisy,network,results:f.r.results});
}
for(const spec of [{label:'d100x4',logical:4},{label:'d100x5',logical:5}]){
 const f=await produce({count:spec.logical*2,alterRoll:(r:any)=>{r.kinds=Array.from({length:spec.logical},()=>['d_percentile','d10']).flat();r.results=r.kinds.map(k=>k==='d_percentile'?30:3);}});
 assert.deepEqual(f.errors,[]);const network=f.sent.filter(p=>['offer','chunk','chunks-done'].includes(p.type));assert.equal(network[0].inlineChunk,undefined);assert.equal(network[1].index,0);assert.equal(network.at(-1).type,'chunks-done');outputs.push({label:spec.label,network,results:f.r.results});
}
for(const kind of ['group','old-peer','solo','mixed-capabilities']){
 const f=await produce({alter:(h:any)=>{if(kind==='solo')h.peers.clear();if(kind==='old-peer')delete h.peers.get('peer').inlineRollV1;if(kind==='mixed-capabilities')h.peers.set('older',{...h.peers.get('peer'),id:'older',inlineRollV1:false,inlineChunkV1:false});},alterRoll:(r:any)=>{if(kind==='group')r.request.batch={id:'g',index:0,size:1};}});
 assert.deepEqual(f.errors,[]);const network=f.sent.filter(p=>['offer','chunk','chunks-done'].includes(p.type));if(kind==='solo')assert.equal(network.length,0);else{assert.equal(network[0].inlineChunk,undefined);assert.equal(network[1].index,0);assert.equal(network.at(-1).type,'chunks-done');}outputs.push({kind,network,results:f.r.results});
}

for(const inlineChunk of ['valid',123,'invalid base64']){
 const f=host(),h=f.h;h.transport.id='peer';h.born=1;h.peers=new Map([['host',{id:'host',name:'Host',ready:true,born:0,lastSeen:now(),rtt:20,offset:0,version:BUILD}]]);
 const r=roll(),{poses,contacts,...meta}=r,bytes=await encodeRoll({...meta,contacts:0},poses,contacts),chunks=split(bytes);assert.equal(chunks.length,1);
 const p={v:1,build:BUILD,from:'host',type:'offer',id:'r',total:chunks.length,bytes:bytes.length,hash:await hash(bytes),members:['peer'],inlineChunk:inlineChunk==='valid'?chunks[0]:inlineChunk};
 await h.receive(p,'host');assert.equal(f.local.filter(p=>p.type==='prepare').length,0);assert.equal(h.inbound.get('r').assembly.parts.size,0);assert.deepEqual(h.inbound.get('r').assembly.missing(),[0]);
 await h.receive({...p,type:'chunk',index:0,data:chunks[0]},'host');assert.equal(f.local.filter(p=>p.type==='prepare').length,1);assert.deepEqual(h.rolls.get('r').results,[3]);assert.equal(f.local.filter(p=>p.type==='start').length,0);
 outputs.push({kind:'legacy-receive-ignores-'+String(inlineChunk),results:h.rolls.get('r').results,prepared:1});
}
console.log(JSON.stringify({checks:outputs.length,outputs}));
