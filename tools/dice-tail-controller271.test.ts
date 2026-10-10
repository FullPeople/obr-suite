import assert from 'node:assert/strict';
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import {BUILD,now} from '../extensions/workbench-dice3d/src/types';
import {DiceSendQueue} from '../src/workbench/dice-send-queue';

const checks:{name:string;passed:boolean;error?:string}[]=[];
const check=async(name:string,fn:()=>Promise<void>)=>{try{await fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:String(error)});}};
const until=async(fn:()=>unknown)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('fixture wait timed out');};
const session='12345678-1234-1234-1234-123456789012';
function fixture(options:{reserve?:boolean;fast?:boolean;retire?:boolean;readyMs?:number}={}){
 const h:any=Object.create(Controller.prototype),queue=new DiceSendQueue(),packets:any[]=[],local:any[]=[],errors:any[]=[],releases:any[]=[],normalTasks:Promise<void>[]=[];
 const active=new Set<()=>void>();let reservations=0,readyTimer:ReturnType<typeof setTimeout>|undefined;
 Object.assign(h,{transport:{id:'host',name:'host',role:'GM'},session,preparationGeneration:0,verifyingPeers:0,catalog:diceCatalog(),ready:true,overlayReady:true,physicsReady:true,disabled:false,born:0,
  peers:new Map([['peer',{id:'peer',session,name:'peer',role:'PLAYER',ready:true,born:1,lastSeen:now(),rtt:20,offset:0,version:BUILD,tracePacketV1:options.fast!==false,poseDeltaV1:true}]]),
  inbound:new Map(),outgoing:new Map(),rolls:new Map(),queue:[],requests:new Map(),accepted:new Map(),retainedUntil:new Map(),settledAt:new Map(),heldRolls:new Map(),reservations:new Map(),privateRunning:new Set(),privateAudiences:new Map(),secrets:new Map(),records:new Map(),probes:new Map(),clocks:new Map(),started:new Map(),events:[],retirementTimers:new Set(),
  bytesReceived:0,packetsReceived:0,bytesSent:0,packetsSent:0,viewport:{w:1280,h:800},
  keys:{ready:Promise.resolve(),forget:()=>{},remember:async()=>{},publicKey:'fixture'},worker:{postMessage:()=>{},terminate:()=>{}},bus:{postMessage:(p:any)=>local.push(p),close:()=>{}},stopTransport:()=>{},state:()=>{},sendRecords:()=>{},log:()=>{},fail:(...e:any[])=>errors.push(e),next:()=>{},addRecord:()=>{},retainUntilExit:()=>{},ping:async()=>{}});
 const ready=async()=>{const out=h.outgoing.get('roll');await h.receive({v:1,build:BUILD,from:'peer',type:'ready',id:'roll',hash:out.hash},'peer');};
 const transmit=(p:any,stamp?:()=>void)=>queue.send(async()=>{
  stamp?.();packets.push({type:p.type,at:performance.now()});
  if(p.type==='trace'){
   if(options.retire)normalTasks.push(transmit({type:'retire'}));
   if(options.readyMs!==undefined)readyTimer=setTimeout(()=>void ready(),options.readyMs);
  }
 },()=>!h.disposed,p.type==='retire'?'normal':'control');
 h.transport.send=transmit;h.transport.sendTimed=transmit;
 if(options.reserve!==false)h.transport.reserveNormalWindow=(ms:number,valid:()=>boolean)=>{
  reservations++;const release=queue.reserveNormalWindow(ms,valid);
  const done=()=>{if(!active.delete(done))return;releases.push({at:performance.now(),types:packets.map(p=>p.type)});release();};active.add(done);return done;
 };
 const request={id:'roll',source:'host',authority:'host',name:'host',kind:'d6',count:1,theme:'ink_sketch',seed:1,modifier:0,visibility:'all'};
 const roll:any={version:2,request,kinds:['d6'],results:[3],fps:120,frames:2,poses:new Float32Array(14),contacts:[],physicsMs:1,steps:2,collisions:0,duration:1/120};
 h.bus.postMessage=(p:any)=>{local.push(p);if(p.type==='prepare')void h.onLocal({type:'prepared',id:p.roll.request.id});};h.pending=request;
 return{h,packets,local,errors,releases,active,ready,roll,reservations:()=>reservations,run:()=>h.onWorker({id:'roll',roll}),normalDone:()=>Promise.all(normalTasks),cleanup:()=>{clearTimeout(readyTimer);h.dispose();}};
}

for(const reserve of [false,true])await check((reserve?'reserved':'old optional transport')+' tail competes with a previous retire without changing packet contents',async()=>{
 const f=fixture({reserve,retire:true,readyMs:130});
 try{await f.run();await f.normalDone();assert.deepEqual(f.packets.map(p=>p.type),reserve?['trace','start','retire']:['trace','retire','start']);assert.equal(f.local.filter(p=>p.type==='start').length,1);assert.equal(f.active.size,0);assert.equal(f.reservations(),reserve?1:0);if(reserve)assert(f.releases[0].types.includes('start'),'normal lease must survive until start has entered the send lane');assert.deepEqual(f.errors,[]);}finally{f.cleanup();}
});
await check('missing ready ends the reservation and uses the existing trailer without false start',async()=>{
 const f=fixture();try{await f.run();assert.deepEqual(f.packets.map(p=>p.type),['trace','chunks-done']);assert.equal(f.active.size,0);assert.equal(f.h.retirementTimers.size,0);assert(!f.local.some(p=>p.type==='start'));assert.deepEqual(f.errors,[]);}finally{f.cleanup();}
});
await check('preparation generation invalidation releases normal work immediately',async()=>{
 const f=fixture();try{const task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);assert.equal(f.active.size,1);f.h.invalidatePreparation();assert.equal(f.active.size,0);await f.ready();await task;assert.deepEqual(f.packets.map(p=>p.type),['trace','chunks-done','start']);assert.equal(f.releases.length,1);assert.deepEqual(f.errors,[]);}finally{f.cleanup();}
});
for(const action of ['cancel','dispose'])await check(action+' releases the lease and resolves the upload without a ghost tail',async()=>{
 const f=fixture();try{const task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);assert.equal(f.active.size,1);if(action==='dispose')f.h.dispose();else f.h.cancelSecret('roll');assert.equal(f.active.size,0);await task;assert.deepEqual(f.packets.map(p=>p.type),['trace']);assert.equal(f.releases.length,1);assert.equal(f.h.retirementTimers.size,0);assert.deepEqual(f.errors,[]);}finally{f.cleanup();}
});
await check('legacy peer does not reserve a normal window',async()=>{
 const f=fixture({fast:false});try{await f.run();assert.deepEqual(f.packets.map(p=>p.type),['offer','chunk','chunks-done']);assert.equal(f.reservations(),0);assert.deepEqual(f.errors,[]);}finally{f.cleanup();}
});
await check('authenticated peer restart releases the reservation before abort delivery',async()=>{
 const f=fixture();try{const task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);assert.equal(f.active.size,1);
  await f.h.receive({v:1,build:BUILD,from:'peer',type:'hello',session:'87654321-4321-4321-4321-210987654321',name:'peer',role:'PLAYER',ready:true,born:1,publicKey:'new',tracePacketV1:true,poseDeltaV1:true},'peer');
  await task;assert.equal(f.active.size,0);assert.equal(f.releases.length,1);assert(!f.packets.some(p=>p.type==='start'||p.type==='chunks-done'));assert(f.packets.some(p=>p.type==='abort'));assert.equal(f.h.retirementTimers.size,0);assert.deepEqual(f.errors,[['peer-restarted','roll']]);
 }finally{f.cleanup();}
});
await check('tail send failure releases its reservation in finally',async()=>{
 const f=fixture();try{f.h.sendTail=async()=>{throw Error('fixture transport failure');};const task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);await f.ready();await task;assert.equal(f.active.size,0);assert.equal(f.releases.length,1);assert.equal(f.h.retirementTimers.size,0);assert(!f.packets.some(p=>p.type==='start'));assert.equal(f.errors.length,1);assert.match(String(f.errors[0][1]),/fixture transport failure/);}finally{f.cleanup();}
});
await check('the reservation shares the existing authority, privacy and group guards',async()=>{
 const f=fixture();try{const task=f.run();await until(()=>f.h.outgoing.get('roll')?.tailWake);const out=f.h.outgoing.get('roll'),generation=f.h.preparationGeneration,signature=f.h.tailSignature(out);assert(f.h.currentFastTail(out,signature,generation));
  for(const [key,value]of [['visibility','self'],['batch',{id:'group',index:0,size:1}],['groupSize',1],['authority','peer']] as const){const old=out.roll.request[key];out.roll.request[key]=value;assert(!f.h.currentFastTail(out,signature,generation),String(key));if(old===undefined)delete out.roll.request[key];else out.roll.request[key]=old;}
  out.roll.masked=true;assert(!f.h.currentFastTail(out,signature,generation));delete out.roll.masked;assert(!f.h.currentFastTail(out,signature,generation+1));await f.ready();await task;assert.equal(f.active.size,0);assert.deepEqual(f.errors,[]);
 }finally{f.cleanup();}
});

const report={checks:checks.length,passed:checks.filter(row=>row.passed).length,failed:checks.filter(row=>!row.passed).length,boundary:'Actual Controller and paced send queue, synthetic renderer and peer ready. Packet ordering and lifecycle checks, not real-room latency.',tests:checks};
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
