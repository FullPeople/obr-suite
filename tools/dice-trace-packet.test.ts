import assert from 'node:assert/strict';
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import {BUILD,now} from '../extensions/workbench-dice3d/src/types';
import {DiceSendQueue} from '../src/workbench/dice-send-queue';
import {Assembly,split,hash,sizeOf,MAX_MESSAGE_BYTES,FAST_CHUNK_BYTES} from '../extensions/workbench-dice3d/src/wire.mjs';
const checks:{name:string;passed:boolean;error?:string}[]=[];
const check=async(name:string,fn:()=>any)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:String(e)});}};
const session='12345678-1234-1234-1234-123456789012';
function fixture(id='host',capable=true){
 const other=id==='host'?'peer':'host',h:any=Object.create(Controller.prototype),sent:any[]=[],local:any[]=[],errors:any[]=[];
 Object.assign(h,{transport:{id,name:id,role:id==='host'?'GM':'PLAYER'},session,preparationGeneration:0,verifyingPeers:0,catalog:diceCatalog(),ready:true,disabled:false,born:id==='host'?0:1,
  peers:new Map([[other,{id:other,session,name:other,role:other==='host'?'GM':'PLAYER',ready:true,born:other==='host'?0:1,lastSeen:now(),rtt:20,offset:0,version:BUILD,tracePacketV1:capable}]]),
  inbound:new Map(),outgoing:new Map(),rolls:new Map(),queue:[],requests:new Map(),accepted:new Map(),retainedUntil:new Map(),settledAt:new Map(),heldRolls:new Map(),reservations:new Map(),privateRunning:new Set(),privateAudiences:new Map(),secrets:new Map(),records:new Map(),probes:new Map(),clocks:new Map(),started:new Map(),events:[],retirementTimers:new Set(),
  bytesReceived:0,packetsReceived:0,bytesSent:0,packetsSent:0,viewport:{w:1280,h:800},keys:{ready:Promise.resolve(),forget:()=>{},remember:async()=>{},publicKey:'fixture'},worker:{postMessage:()=>{},terminate:()=>{}},bus:{postMessage:(p:any)=>local.push(p),close:()=>{}},stopTransport:()=>{},state:()=>{},sendRecords:()=>{},log:()=>{},fail:(...e:any[])=>errors.push(e),next:()=>{},addRecord:()=>{},retainUntilExit:()=>{},ping:async()=>{}});
 const transmit=async(p:any,stamp?:()=>void)=>{stamp?.();sent.push(structuredClone(p));};h.transport.send=transmit;h.transport.sendTimed=transmit;
 return{h,sent,local,errors};
}
function makeRoll(count=20){
 const request:any={id:'r',source:'host',authority:'host',name:'host',kind:'d6',count,theme:'ink_sketch',seed:1,modifier:0,visibility:'all'},frames=61;
 const poses=new Float32Array(frames*count*7);let state=1234;for(let i=0;i<poses.length;i++){state=(Math.imul(1664525,state)+1013904223)|0;poses[i]=(state>>>0)/2**32;}
 return{version:2,request,kinds:Array(count).fill('d6'),results:Array(count).fill(3),fps:120,frames,poses,contacts:[],physicsMs:1,steps:frames*2,collisions:0,duration:(frames-1)/120};
}
async function produce(count=20,alter?:(h:any,r:any)=>void){const f=fixture(),r=makeRoll(count);alter?.(f.h,r);f.h.pending=r.request;f.h.bus.postMessage=(p:any)=>{f.local.push(p);if(p.type==='prepare')void f.h.onLocal({type:'prepared',id:'r'});};await f.h.onWorker({id:'r',roll:r});assert.deepEqual(f.errors,[]);return{...f,r};}
const wire=(p:any)=>({v:1,build:BUILD,from:'host',...p});
for(const count of [1,5,10,20])await check(count+' dice reconstruct exactly and cannot start before verified prepare',async()=>{
 const sender=await produce(count),packets=sender.sent.filter(p=>p.type==='trace');assert(packets.length);assert(!sender.sent.some(p=>p.type==='offer'||p.type==='chunk'));assert(!sender.local.some(p=>p.type==='start'));
 assert(packets.every(p=>sizeOf(wire(p))<=MAX_MESSAGE_BYTES));assert.equal(packets.length,Math.ceil(packets[0].bytes/FAST_CHUNK_BYTES));
 const receiver=fixture('peer');for(const p of packets.slice(0,-1))await receiver.h.receive(wire(p),'host');assert(!receiver.local.some(p=>p.type==='prepare'));
 await receiver.h.receive(wire(packets.at(-1)),'host');const prepared=receiver.local.find(p=>p.type==='prepare');assert(prepared);assert.deepEqual(prepared.roll.poses,sender.r.poses);assert.deepEqual(prepared.roll.results,sender.r.results);
 assert(!receiver.sent.some(p=>p.type==='ready'));await receiver.h.onLocal({type:'prepared',id:'r'});const ready=receiver.sent.find(p=>p.type==='ready');assert(ready);await sender.h.receive({v:1,build:BUILD,from:'peer',...ready},'peer');assert.equal(sender.local.filter(p=>p.type==='start').length,1);
 const start=sender.sent.find(p=>p.type==='start');assert(start);await receiver.h.receive(wire(start),'host');await receiver.h.receive(wire(start),'host');assert.equal(receiver.local.filter(p=>p.type==='start').length,1);assert.deepEqual(receiver.errors,[]);
});
for(const [name,alter] of Object.entries({
 'legacy member':(h:any)=>h.peers.get('peer').tracePacketV1=false,
 'unverified role':(h:any)=>delete h.peers.get('peer').role,
 'unverified session':(h:any)=>delete h.peers.get('peer').session,
 'verification in flight':(h:any)=>h.verifyingPeers=1,
 'more than twenty dice':(_h:any,r:any)=>Object.assign(r,makeRoll(21)),
 'batch child':(_h:any,r:any)=>r.request.batch={id:'g',index:0,size:1},
 'oversized room manifest':(h:any)=>{for(let i=0;i<64;i++){const id=String(i).padEnd(100,'x');h.peers.set(id,{...h.peers.get('peer'),id});}},
}))await check(name+' retains legacy packets',async()=>{const f=await produce(20,alter);assert(!f.sent.some(p=>p.type==='trace'));assert(f.sent.some(p=>p.type==='offer'));assert(f.sent.some(p=>p.type==='chunk'));});
await check('lost first packet is repaired from a later self-contained manifest',async()=>{
 const sender=await produce(),packets=sender.sent.filter(p=>p.type==='trace'),receiver=fixture('peer');assert(packets.length>1);
 for(const p of packets.slice(1))await receiver.h.receive(wire(p),'host');const missing=receiver.sent.find(p=>p.type==='missing');assert(missing);assert.deepEqual(missing.indices,[0]);assert(!receiver.local.some(p=>p.type==='prepare'));
 await receiver.h.receive(wire({...packets[0],type:'chunk'}),'host');assert.equal(receiver.local.filter(p=>p.type==='prepare').length,1);
});
await check('lost final packet is promptly requested by the existing trailer',async()=>{
 const sender=await produce(),packets=sender.sent.filter(p=>p.type==='trace'),receiver=fixture('peer');for(const p of packets.slice(0,-1))await receiver.h.receive(wire(p),'host');
 await receiver.h.receive(wire({type:'chunks-done',id:'r'}),'host');assert.deepEqual(receiver.sent.find(p=>p.type==='missing').indices,[packets.length-1]);
 await receiver.h.receive(wire({...packets.at(-1),type:'chunk'}),'host');assert.equal(receiver.local.filter(p=>p.type==='prepare').length,1);
});
await check('a lost one-packet trace is included in the directed preparation retry',async()=>{
 const sender=await produce(1),retry=sender.h.offer(sender.h.outgoing.get('r'),'peer');assert.equal(retry.type,'trace');assert.equal(retry.index,0);
 const receiver=fixture('peer');await receiver.h.receive(wire(retry),'host');assert.equal(receiver.local.filter(p=>p.type==='prepare').length,1);assert(sizeOf(wire(retry))<=MAX_MESSAGE_BYTES);
});
await check('duplicate packets prepare once and conflicting manifests are rejected',async()=>{
 const sender=await produce(),packets=sender.sent.filter(p=>p.type==='trace'),receiver=fixture('peer');for(const p of packets){await receiver.h.receive(wire(p),'host');await receiver.h.receive(wire(p),'host');}assert.equal(receiver.local.filter(p=>p.type==='prepare').length,1);
 await assert.rejects(()=>receiver.h.receive(wire({...packets[0],chunkBytes:7000}),'host'));await assert.rejects(()=>receiver.h.receive(wire({...packets[0],hash:'a'.repeat(64)}),'host'));
});
await check('unknown capability, wrong authority and bad hash cannot prepare',async()=>{
 const sender=await produce(1),p=sender.sent.find(p=>p.type==='trace');await assert.rejects(()=>fixture('peer',false).h.receive(wire(p),'host'));
 const receiver=fixture('peer');receiver.h.peers.get('host').born=2;await assert.rejects(()=>receiver.h.receive(wire(p),'host'));
 const bad=fixture('peer');await assert.rejects(()=>bad.h.receive(wire({...p,hash:'a'.repeat(64)}),'host'));assert(!bad.local.some(p=>p.type==='prepare'));
});
await check('a peer ready reply cannot bypass an unprepared local renderer',async()=>{
 const f=fixture(),r=makeRoll(1);f.h.pending=r.request;await f.h.onWorker({id:'r',roll:r});const out=f.h.outgoing.get('r');await f.h.receive({v:1,build:BUILD,from:'peer',type:'ready',id:'r',hash:out.hash},'peer');assert(!f.local.some(p=>p.type==='start'));
});
await check('fast assembly keeps bounded lengths, exact SHA and legacy defaults',async()=>{
 const bytes=crypto.getRandomValues(new Uint8Array(21001)),sha=await hash(bytes),parts=split(bytes,FAST_CHUNK_BYTES),a=new Assembly(parts.length,bytes.length,sha,FAST_CHUNK_BYTES);for(let i=0;i<parts.length;i++)a.add(i,parts[i]);assert.deepEqual(await a.finish(),bytes);
 assert.throws(()=>new Assembly(parts.length,bytes.length,sha,9999));assert.throws(()=>a.add(0,parts[1].slice(4)));assert.equal(new Assembly(1,1,sha).chunkBytes,7000);
});
await check('a pending clock reply cannot stall the receive lane',async()=>{
 const f=fixture('peer');let release!:()=>void,dispatch!:()=>void,done=false;
 f.h.transport.sendTimed=(_p:any,stamp:()=>void)=>new Promise<void>(resolve=>{dispatch=stamp;release=resolve;});
 const receivedAt=now();await f.h.receive({v:1,build:BUILD,from:'host',type:'ping',nonce:'n'},'host',receivedAt).then(()=>done=true);
 assert(done);dispatch();release();await Promise.resolve();assert.deepEqual(f.errors,[]);
});
await check('urgent roll takes a pacing slot reserved by a heartbeat',async()=>{
 let time=0,release!:()=>void;const order:string[]=[];
 const q=new DiceSendQueue(100,()=>time,async ms=>{await new Promise<void>(r=>release=r);time+=ms;});
 await q.send(async()=>{order.push('previous');});
 const heartbeat=q.send(async()=>{order.push('heartbeat');}),roll=q.send(async()=>{order.push('roll');},()=>true,'control');
 await new Promise(resolve=>setImmediate(resolve));release();await roll;await new Promise(resolve=>setImmediate(resolve));release();await heartbeat;assert.deepEqual(order,['previous','roll','heartbeat']);assert.equal(time,200);
});
await check('control traffic preserves pacing and gives ordinary traffic a turn',async()=>{
 let time=0;const order:string[]=[],times:number[]=[];const q=new DiceSendQueue(100,()=>time,async ms=>{time+=ms;});
 const jobs=Array.from({length:12},(_,i)=>q.send(async()=>{order.push('roll'+i);times.push(time);},()=>true,'control'));
 jobs.push(q.send(async()=>{order.push('heartbeat');times.push(time);}));await Promise.all(jobs);
 assert(order.indexOf('heartbeat')<=8);assert(times.every((t,i)=>!i||t-times[i-1]>=100));
});
console.log(JSON.stringify({checks:checks.length,passed:checks.filter(t=>t.passed).length,failed:checks.filter(t=>!t.passed).length,boundary:'Production codec/controller; synthetic transport and renderer. Browser and actual room measured separately.',tests:checks},null,2));if(checks.some(t=>!t.passed))process.exitCode=1;
