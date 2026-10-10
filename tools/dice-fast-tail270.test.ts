import assert from 'node:assert/strict';
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import {BUILD,now} from '../extensions/workbench-dice3d/src/types';
import {DiceSendQueue} from '../src/workbench/dice-send-queue';
import {Assembly,FAST_CHUNK_BYTES} from '../extensions/workbench-dice3d/src/wire.mjs';

const checks:{name:string;passed:boolean;error?:string}[]=[];
const check=async(name:string,fn:()=>Promise<void>)=>{try{await fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:String(error)});}};
const session='12345678-1234-1234-1234-123456789012';
const immediate=()=>new Promise<void>(resolve=>setImmediate(resolve));
const until=async(fn:()=>unknown)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('fixture wait timed out');};
const envelope=(from:string,data:any)=>({v:1,build:BUILD,from,...data});

function fixture(options:any={}){
  const id=options.id??'host',other=id==='host'?'peer':'host',h:any=Object.create(Controller.prototype);
  const packets:any[]=[],local:any[]=[],errors:any[]=[],worker:any[]=[],logs:any[]=[];
  let clock=0;
  const queue=new DiceSendQueue(100,()=>clock,async ms=>{clock+=ms;});
  Object.assign(h,{transport:{id,name:id,role:id==='host'?'GM':'PLAYER'},session,preparationGeneration:0,verifyingPeers:0,catalog:diceCatalog(),ready:true,overlayReady:true,physicsReady:true,disabled:false,born:id==='host'?0:1,
    peers:new Map([[other,{id:other,session,name:other,role:other==='host'?'GM':'PLAYER',ready:true,born:other==='host'?0:1,lastSeen:now(),rtt:20,offset:0,version:BUILD,tracePacketV1:options.fast!==false,poseDeltaV1:options.delta===true}]]),
    inbound:new Map(),outgoing:new Map(),rolls:new Map(),queue:[],requests:new Map(),accepted:new Map(),retainedUntil:new Map(),settledAt:new Map(),heldRolls:new Map(),reservations:new Map(),privateRunning:new Set(),privateAudiences:new Map(),secrets:new Map(),records:new Map(),probes:new Map(),clocks:new Map(),started:new Map(),events:[],retirementTimers:new Set(),
    lastState:now(),lastPresence:now(),bytesReceived:0,packetsReceived:0,bytesSent:0,packetsSent:0,viewport:{w:1280,h:800},
    keys:{ready:Promise.resolve(),forget:()=>{},remember:async()=>{},publicKey:'fixture'},worker:{postMessage:(p:any)=>worker.push(p),terminate:()=>{}},bus:{postMessage:(p:any)=>local.push(p),close:()=>{}},stopTransport:()=>{},state:()=>{},sendRecords:()=>{},log:(event:string,detail:any)=>logs.push({event,...detail}),fail:(...e:any[])=>errors.push(e),next:()=>{},addRecord:()=>{},retainUntilExit:()=>{},ping:async()=>{}});
  const transmit=(p:any,stamp?:()=>void)=>{
    const enqueuedType=p.type;
    return queue.send(async()=>{await options.before?.(h,p);stamp?.();packets.push({...structuredClone(p),enqueuedType,dispatch:clock});await options.after?.(h,p,()=>clock,v=>clock=v);},()=>!h.disposed,'control');
  };
  h.transport.send=transmit;h.transport.sendTimed=transmit;
  const count=options.count??1,frames=options.frames??2,poses=new Float32Array(frames*count*7);
  let random=19;for(let i=0;i<poses.length;i++){random=(Math.imul(random,1664525)+1013904223)|0;poses[i]=(random>>>0)/2**32;}
  const request={id:'roll',source:'host',authority:'host',name:'host',kind:'d6',count,theme:'ink_sketch',seed:1,modifier:0,visibility:'all'};
  const roll:any={version:2,request,kinds:Array(count).fill('d6'),results:Array(count).fill(3),fps:120,frames,poses,contacts:[],physicsMs:1,steps:frames,collisions:0,duration:(frames-1)/120};
  h.bus.postMessage=(p:any)=>{local.push(p);if(p.type==='prepare'&&options.localReady!==false&&id==='host')void h.onLocal({type:'prepared',id:p.roll.request.id});};
  h.pending=request;
  const ready=async(hash?:string)=>{const out=h.outgoing.get('roll');await h.receive(envelope(other,{type:'ready',id:'roll',hash:hash??out.hash}),other);};
  return{h,roll,packets,local,errors,worker,logs,ready,run:()=>h.onWorker({id:'roll',roll}),advance:(t:number)=>clock=t};
}

await check('ready just after the next slot uses that time, not another 100 ms slot',async()=>{
  const f=fixture({after:(h:any,p:any,_clock:any,advance:any)=>{if(p.type==='trace')setImmediate(()=>{advance(110);void h.receive(envelope('peer',{type:'ready',id:p.id,hash:p.hash}),'peer');});}});
  await f.run();assert.deepEqual(f.packets.map(p=>p.type),['trace','start']);assert.equal(f.packets[1].dispatch,110);assert.equal(f.packets[1].enqueuedType,'chunks-done');assert.equal(f.local.filter(p=>p.type==='start').length,1);assert.equal(f.h.retirementTimers.size,0);assert.deepEqual(f.errors,[]);
});
await check('already prepared fast trace retains the normal next paced slot',async()=>{
  const f=fixture({after:async(h:any,p:any)=>{if(p.type==='trace')await h.receive(envelope('peer',{type:'ready',id:p.id,hash:p.hash}),'peer');}});
  await f.run();assert.deepEqual(f.packets.map(p=>p.type),['trace','start']);assert.equal(f.packets[1].dispatch,100);
});
await check('unprepared peer has a bounded 250 ms trailer fallback and cannot start',async()=>{
  const f=fixture(),began=performance.now();await f.run();assert(performance.now()-began>=230);assert(performance.now()-began<1500);assert.deepEqual(f.packets.map(p=>p.type),['trace','chunks-done']);assert(!f.local.some(p=>p.type==='start'));assert.equal(f.h.retirementTimers.size,0);await f.ready();assert.equal(f.local.filter(p=>p.type==='start').length,1);
});
await check('peer readiness cannot replace missing local renderer preparation',async()=>{
  const f=fixture({localReady:false,after:async(h:any,p:any)=>{if(p.type==='trace')await h.receive(envelope('peer',{type:'ready',id:p.id,hash:p.hash}),'peer');}});
  await f.run();assert(f.packets.some(p=>p.type==='chunks-done'));assert(!f.local.some(p=>p.type==='start'));await f.h.onLocal({type:'prepared',id:'roll'});assert.equal(f.local.filter(p=>p.type==='start').length,1);
});
await check('last local preparation wakes the same guarded tail',async()=>{
  const f=fixture({localReady:false,after:async(h:any,p:any)=>{if(p.type==='trace'){await h.receive(envelope('peer',{type:'ready',id:p.id,hash:p.hash}),'peer');setImmediate(()=>void h.onLocal({type:'prepared',id:p.id}));}}});
  await f.run();assert.deepEqual(f.packets.map(p=>p.type),['trace','start']);assert.equal(f.h.retirementTimers.size,0);
});
await check('wrong-hash ready cannot wake or release an unprepared roll',async()=>{
  const f=fixture(),task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);await f.ready('0'.repeat(64));assert(f.h.outgoing.get('roll').tailWake);assert(!f.local.some(p=>p.type==='start'));await task;assert(f.packets.some(p=>p.type==='chunks-done'));
});
await check('preparation generation changed during the wait preserves ordinary fallback',async()=>{
  const f=fixture(),task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);f.h.preparationGeneration++;await f.ready();await task;assert.deepEqual(f.packets.map(p=>p.type),['trace','chunks-done','start']);assert.equal(f.packets.at(-1).enqueuedType,'start');
});
await check('legacy peer emits the established manifest, chunk, trailer sequence',async()=>{
  const f=fixture({fast:false});await f.run();assert.deepEqual(f.packets.map(p=>p.type),['offer','chunk','chunks-done']);assert.equal(f.h.retirementTimers.size,0);
});
await check('dispose resolves the pending wait, clears timers and never emits a ghost tail',async()=>{
  const f=fixture(),task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);f.h.dispose();await Promise.race([task,new Promise((_,reject)=>setTimeout(()=>reject(Error('dispose left a suspended upload')),100))]);assert.deepEqual(f.packets.map(p=>p.type),['trace']);assert.equal(f.h.retirementTimers.size,0);assert(!f.local.some(p=>p.type==='start'));assert.deepEqual(f.errors,[]);
});
await check('cancellation followed by disposal cannot leave a suspended fast upload',async()=>{
  const f=fixture(),task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);f.h.cancelSecret('roll');f.h.dispose();
  await Promise.race([task,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancel left a suspended upload')),100))]);assert.equal(f.h.retirementTimers.size,0);assert.deepEqual(f.packets.map(p=>p.type),['trace']);
});
await check('peer restart revokes the waiting upload before abort acknowledgement',async()=>{
  const f=fixture(),task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);
  await f.h.receive(envelope('peer',{type:'hello',session:'87654321-4321-4321-4321-210987654321',name:'peer',role:'PLAYER',ready:true,born:1,publicKey:'new',tracePacketV1:true}),'peer');
  await task;assert(!f.h.outgoing.has('roll'));assert(!f.packets.some(p=>p.type==='start'||p.type==='chunks-done'));assert(f.packets.some(p=>p.type==='abort'));assert.equal(f.h.retirementTimers.size,0);
});
await check('missing final fast packet is repaired by the bounded original trailer',async()=>{
  const sender=fixture({count:20,frames:80});await sender.run();const traces=sender.packets.filter(p=>p.type==='trace');assert(traces.length>1);
  const receiver=fixture({id:'peer'});for(const packet of traces.slice(0,-1))await receiver.h.receive(packet,'host');assert(!receiver.local.some(p=>p.type==='prepare'));
  await receiver.h.receive(sender.packets.find(p=>p.type==='chunks-done'),'host');const missing=receiver.packets.find(p=>p.type==='missing');assert.deepEqual(missing.indices,[traces.length-1]);
  await receiver.h.receive({...traces.at(-1),type:'chunk'},'host');assert.equal(receiver.local.filter(p=>p.type==='prepare').length,1);
});
await check('lost ready reply retains bounded directed preparation recovery',async()=>{
  const sender=fixture();sender.roll.request.source='peer';await sender.run();const receiver=fixture({id:'peer'}),trace=sender.packets.find(p=>p.type==='trace');await receiver.h.receive(trace,'host');await receiver.h.onLocal({type:'prepared',id:'roll'});assert(receiver.packets.some(p=>p.type==='ready'));
  // The first ready was lost. The existing retry sends a directed complete
  // one-packet trace; its already-prepared receiver acknowledges the same hash.
  sender.h.outgoing.get('roll').at=now()-2600;await sender.h.tick();const retry=sender.packets.find(p=>p.type==='trace'&&p.to==='peer');assert(retry);assert(!sender.local.some(p=>p.type==='start'));await receiver.h.receive(retry,'host');assert.equal(receiver.packets.filter(p=>p.type==='ready').length,2);await sender.h.receive(receiver.packets.at(-1),'peer');assert.equal(sender.local.filter(p=>p.type==='start').length,1);
});
await check('fully lost one-packet trace retains bounded directed retry without false readiness',async()=>{
  const sender=fixture();sender.roll.request.source='peer';await sender.run();const receiver=fixture({id:'peer'});sender.h.outgoing.get('roll').at=now()-2600;await sender.h.tick();
  const retry=sender.packets.find(p=>p.type==='trace'&&p.to==='peer');assert(retry);await receiver.h.receive(retry,'host');assert.equal(receiver.local.filter(p=>p.type==='prepare').length,1);assert(!sender.local.some(p=>p.type==='start'));assert(!receiver.packets.some(p=>p.type==='ready'));
});

async function packing(f:ReturnType<typeof fixture>){
  const out=f.h.outgoing.get('roll'),assembly=new Assembly(out.chunks.length,out.bytes,out.hash,out.chunkBytes);out.chunks.forEach((data:string,index:number)=>assembly.add(index,data));
  const bytes=await assembly.finish(),plain=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const n=new DataView(plain.buffer).getUint32(0,true);return JSON.parse(new TextDecoder().decode(plain.subarray(4,n+4))).posePacking;
}
for(const delta of [false,true])await check((delta?'new negotiated peer':'269 peer')+' receives its supported lossless pose encoding',async()=>{
  const f=fixture({delta,after:async(h:any,p:any)=>{if(p.type==='trace')await h.receive(envelope('peer',{type:'ready',id:p.id,hash:p.hash}),'peer');}});await f.run();assert.equal(await packing(f),delta?'delta2-shuffle-v1':'xor-shuffle-v1');assert.equal(f.h.outgoing.get('roll').chunkBytes,FAST_CHUNK_BYTES);
});
await check('capability changing during async compression receives universal legacy bytes',async()=>{
  const f=fixture({delta:true,after:async(h:any,p:any)=>{if(p.type==='trace')await h.receive(envelope('peer',{type:'ready',id:p.id,hash:p.hash}),'peer');}}),task=f.run();
  // onWorker has entered CompressionStream but cannot have created Outgoing.
  assert.equal(f.h.outgoing.size,0);f.h.peers.get('peer').poseDeltaV1=false;await task;assert.equal(await packing(f),undefined);
});
await check('new non-delta member during compression is included only with safe encoding',async()=>{
  const f=fixture({delta:true}),task=f.run();assert.equal(f.h.outgoing.size,0);f.h.peers.set('late',{...f.h.peers.get('peer'),id:'late',born:2,poseDeltaV1:false});await task;assert.equal(await packing(f),undefined);assert.deepEqual(f.h.outgoing.get('roll').members,['peer','late']);assert(!f.local.some(p=>p.type==='start'));
});
await check('hello advertises delta support and capability removal changes preparation generation',async()=>{
  const f=fixture({delta:true});await f.h.send({type:'hello',ready:true,name:'host'});assert.equal(f.packets[0].poseDeltaV1,true);const generation=f.h.preparationGeneration;
  await f.h.receive(envelope('peer',{type:'hello',session,name:'peer',role:'PLAYER',ready:true,born:1,publicKey:'same',tracePacketV1:true}),'peer');assert.equal(f.h.peers.get('peer').poseDeltaV1,false);assert.equal(f.h.preparationGeneration,generation+1);
});

await immediate();
const report={checks:checks.length,passed:checks.filter(row=>row.passed).length,failed:checks.filter(row=>!row.passed).length,boundary:'Production Controller, codecs and 100 ms send queue; deterministic queue clock, synthetic physics/renderer/network. Not real room or first visible pixels.',tests:checks};
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
