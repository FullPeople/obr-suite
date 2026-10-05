import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {DiceSendQueue} from '../src/workbench/dice-send-queue';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import {BUILD,now} from '../extensions/workbench-dice3d/src/types';
const tests:any[]=[];
const check=async(name:string,fn:()=>any)=>{if(process.env.DICE_TAIL_CASE&&!name.includes(process.env.DICE_TAIL_CASE))return;try{await fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,error:String(error)});}};
const session='12345678-1234-1234-1234-123456789012';
const deferred=()=>{let resolve!:()=>void;return{promise:new Promise<void>(r=>resolve=r),resolve:()=>resolve()}};
function fixture(options:any={}){
 const h:any=Object.create(Controller.prototype),packets:any[]=[],local:any[]=[],errors:any[]=[],logs:any[]=[],worker:any[]=[],histories:any[]=[];
 let time=0;const queue=new DiceSendQueue(100,()=>time,async ms=>{time+=ms;});
 Object.assign(h,{transport:{id:'a',name:'a',role:'GM'},session,preparationGeneration:0,verifyingPeers:0,catalog:diceCatalog(),ready:true,overlayReady:true,physicsReady:true,disabled:false,born:0,peers:new Map([['b',{id:'b',session,name:'b',role:'PLAYER',ready:true,born:1,lastSeen:now(),rtt:20,offset:0,version:BUILD}]]),inbound:new Map(),outgoing:new Map(),rolls:new Map(),queue:[],requests:new Map(),accepted:new Map(),retainedUntil:new Map(),settledAt:new Map(),heldRolls:new Map(),reservations:new Map(),privateRunning:new Set(),privateAudiences:new Map(),secrets:new Map(),records:new Map(),probes:new Map(),clocks:new Map(),started:new Map(),events:[],lastState:now(),lastPresence:now(),bytesReceived:0,packetsReceived:0,bytesSent:0,packetsSent:0,viewport:{w:1920,h:1080},keys:{forget:()=>{},remember:async()=>{},ready:Promise.resolve(),publicKey:'fixture'},worker:{postMessage:(p:any)=>worker.push(p)},bus:{postMessage:(p:any)=>local.push(p)},state:()=>{},sendRecords:()=>histories.push([...h.records.keys()]),log:(event:string,detail:any)=>logs.push({event,...detail}),fail:(...e:any[])=>errors.push(e),next:()=>{},addRecord:()=>{},retainUntilExit:()=>{},ping:async()=>{}});
 const transmit=(p:any,before?:()=>void)=>{const enqueuedType=p.type;return queue.send(async()=>{
   await options.before?.(h,p,enqueuedType);before?.();const row={...structuredClone(p),enqueuedType,dispatch:time,at:now()};packets.push(row);
   // Boundary fixture supplies a prepared peer; the two-peer integration probe
   // separately requires real SHA/decode, authority validation and prepare.
   if(p.type==='chunk'){const out=h.outgoing.get(p.id);if(out)await h.receive({v:1,build:BUILD,from:'b',type:'ready',id:p.id,hash:out.hash},'b');}
   await options.after?.(h,p,row);
 },()=>!h.disposed,'control');};
 h.transport.send=transmit;h.transport.sendTimed=transmit;
 const request:any={id:'r',source:'a',authority:'a',name:'a',kind:'d6',count:1,theme:'ink_sketch',seed:1,modifier:0,visibility:'all'};
 const roll:any={version:2,request,kinds:['d6'],results:[3],fps:120,frames:2,poses:new Float32Array(14),contacts:[],physicsMs:0,steps:2,collisions:0,duration:1/120};
 options.alter?.(h,roll);
 h.bus.postMessage=(p:any)=>{local.push(p);if(p.type==='prepare'&&!options.noLocalReady)void h.onLocal({type:'prepared',id:p.roll.request.id});};
 h.pending=roll.request;
 return{h,roll,packets,local,errors,logs,worker,histories,run:()=>h.onWorker({id:'r',roll})};
}
const protocol=(f:any)=>f.packets.filter((p:any)=>['offer','chunk','chunks-done','start','start-group'].includes(p.type));
const hello=(fields:any={})=>({v:1,build:BUILD,from:'b',type:'hello',session,name:'b',role:'PLAYER',ready:true,born:1,...fields});
await check('all ready consumes the queued trailer slot with the original start envelope',async()=>{
 const f=fixture();await f.run();assert.deepEqual(protocol(f).map((p:any)=>p.type),['offer','chunk','start']);const start=f.packets.at(-1);assert.equal(start.enqueuedType,'chunks-done');assert.equal(start.dispatch,200);assert(Number.isFinite(start.start));assert(start.start-start.at>=68);assert.equal(f.local.filter(p=>p.type==='start').length,1);assert.deepEqual(f.errors,[]);
});
for(const [name,alter]of Object.entries({
 'ten actual dice':(_h:any,r:any)=>{r.kinds=Array(10).fill('d6');r.results=Array(10).fill(3);r.poses=new Float32Array(140)},
 'batch child':(_h:any,r:any)=>r.request.batch={id:'g',index:0,size:1},
 'private request':(_h:any,r:any)=>{r.request.visibility='self'},
 'unknown peer session':(h:any)=>delete h.peers.get('b').session,
 'unknown peer role':(h:any)=>delete h.peers.get('b').role,
 'unknown local session':(h:any)=>delete h.session,
 'legacy transport':(h:any)=>delete h.transport.sendTimed,
}))await check(name+' keeps the trailer',async()=>{
 // Private sealing is exercised by the genuine two-peer private probe. Here
 // only the scheduling eligibility predicate sees the private request.
 const f=fixture({alter:name==='private request'?undefined:alter,before:(h:any,p:any)=>{if(name==='private request'&&p.type==='chunks-done')h.outgoing.get('r').roll.request.visibility='self'}});await f.run();assert(protocol(f).some((p:any)=>p.type==='chunks-done'));assert.equal(protocol(f).find((p:any)=>p.enqueuedType==='chunks-done').type,'chunks-done');assert.deepEqual(f.errors,[]);
});
for(const name of ['peer-role','peer-role-restored','peer-ready-restored','local-role-restored','local-ready-restored','new-member','authority-change','session-change','expired-member'])await check(name+' invalidates only the fast-tail eligibility',async()=>{
 let changed=false;const f=fixture({before:async(h:any,p:any)=>{if(p.type!=='chunks-done'||changed)return;changed=true;
  if(name==='peer-role'||name==='peer-role-restored'){await h.receive(hello({role:'GM'}),'b');if(name.endsWith('restored'))await h.receive(hello(),'b');}
  if(name==='peer-ready-restored'){await h.receive(hello({ready:false}),'b');await h.receive(hello(),'b');}
  if(name==='local-role-restored'){const pending=h.setProfile('a',undefined,'PLAYER');h.setProfile('a',undefined,'GM');void pending;}
  if(name==='local-ready-restored'){h.overlayReady=false;h.refreshReady();h.overlayReady=true;h.refreshReady();}
  if(name==='new-member')h.peers.set('c',{...h.peers.get('b'),id:'c',born:2});
  if(name==='authority-change'){h.born=2;}
  if(name==='session-change')h.peers.get('b').session='87654321-4321-4321-4321-210987654321';
  if(name==='expired-member')h.peers.get('b').lastSeen=now()-13000;
 }});await f.run();assert(f.packets.some(p=>p.type==='chunks-done'));assert(!f.packets.some(p=>p.enqueuedType==='chunks-done'&&p.type==='start'));assert.equal(f.local.filter(p=>p.type==='start').length,1,'retain ordinary fallback completion');assert.deepEqual(f.errors,[]);
});
for(const kind of ['role','key'])await check('pending '+kind+' verification cannot promote the tail',async()=>{
 const hold=deferred();let handshake:any,changed=false;
 const f=fixture({before:(h:any,p:any)=>{if(p.type!=='chunks-done'||changed)return;changed=true;
  if(kind==='role')h.transport.resolveRole=async()=>{await hold.promise;return 'PLAYER'};
  else h.keys.remember=()=>hold.promise;
  handshake=h.receive(hello(kind==='key'?{ready:false}:{}),'b');
 }});await f.run();assert(f.packets.some(p=>p.type==='chunks-done'));assert(!f.packets.some(p=>p.enqueuedType==='chunks-done'&&p.type==='start'));assert.equal(f.h.verifyingPeers,1);hold.resolve();await handshake;assert.equal(f.h.verifyingPeers,0);
});
await check('verified unchanged hello ACK work does not hold the verification gate',async()=>{
 const hold=deferred();let handshake:any,changed=false;
 const f=fixture({before:async(h:any,p:any)=>{if(p.type!=='chunks-done'||changed)return;changed=true;h.ping=()=>hold.promise;handshake=h.receive(hello(),'b');await Promise.resolve();await Promise.resolve();assert.equal(h.verifyingPeers,0);}});
 await f.run();assert(f.packets.some(p=>p.type==='start'&&p.enqueuedType==='chunks-done'));hold.resolve();await handshake;
});
await check('first tail dispatch computes the unchanged lead from current RTT',async()=>{
 let attempts=0;const f=fixture({before:(h:any,p:any)=>{if(p.type==='chunks-done')h.peers.get('b').rtt=500;},after:(h:any,p:any)=>{if(p.type==='start'&&++attempts===1){h.peers.get('b').rtt=5;throw{error:{name:'RateLimitHit'}};}}});await f.run();const starts=f.packets.filter(p=>p.type==='start');assert.equal(starts.length,2);assert(starts[0].start-starts[0].at>=783);assert.equal(starts[0].start,starts[1].start);assert.equal(f.logs.find(p=>p.event==='roll-start-scheduled').leadMs,785);
});
await check('missing local prepare keeps trailer and cannot arm until prepared',async()=>{const f=fixture({noLocalReady:true});await f.run();assert(f.packets.some(p=>p.type==='chunks-done'));assert(!f.local.some(p=>p.type==='start'));await f.h.onLocal({type:'prepared',id:'r'});assert.equal(f.local.filter(p=>p.type==='start').length,1);});
await check('rate-rejected promoted start retries identical hash/time and arms once',async()=>{let attempts=0;const f=fixture({after:(_h:any,p:any)=>{if(p.type==='start'&&++attempts<3)throw{error:{name:'RateLimitHit'}}}});await f.run();const starts=f.packets.filter(p=>p.type==='start');assert.deepEqual(starts.map(p=>p.dispatch),[200,1000,2600]);assert.equal(new Set(starts.map(p=>p.start)).size,1);assert.equal(new Set(starts.map(p=>p.hash)).size,1);assert.equal(f.local.filter(p=>p.type==='start').length,1);assert.deepEqual(f.errors,[]);});
await check('a rate-rejected unready trailer stays a trailer when preparation completes',async()=>{let attempts=0;const f=fixture({noLocalReady:true,after:async(h:any,p:any)=>{if(p.type==='chunks-done'&&++attempts===1){await h.onLocal({type:'prepared',id:'r'});throw{error:{name:'RateLimitHit'}}}}});await f.run();const tails=f.packets.filter(p=>p.enqueuedType==='chunks-done');assert.deepEqual(tails.map(p=>p.type),['chunks-done','chunks-done']);assert(f.packets.some(p=>p.enqueuedType==='start'));});
await check('unknown promoted start ACK preserves physics and the armed start',async()=>{const f=fixture({after:(_h:any,p:any)=>{if(p.type==='start')throw Error('unknown ACK')}});await f.run();assert.equal(f.local.filter(p=>p.type==='start').length,1);assert(f.logs.some(p=>p.event==='start-send-unconfirmed'));assert(!f.worker.some(p=>p.type==='release'));assert.deepEqual(f.errors,[]);});
await check('slow promoted start ACK never gates local arm or upload completion',async()=>{const hold=deferred(),armed=deferred();const f=fixture({after:(_h:any,p:any)=>{if(p.type==='start'){armed.resolve();return hold.promise}}});const task=f.run();await armed.promise;assert.equal(f.local.filter(p=>p.type==='start').length,1);assert.equal(f.h.outgoing.get('r').uploading,false);assert.equal(f.h.outgoing.get('r').dispatching,false);hold.resolve();await task;});
for(const kind of ['tail','queued-start'])for(const abortReject of [false,true])await check(kind+' is revoked synchronously while restart abort ACK '+(abortReject?'fails':'waits'),async()=>{
 const blocked=deferred(),release=deferred(),abort=deferred();let restart:any;
 const f=fixture({alter:kind==='queued-start'?(h:any)=>delete h.session:undefined,before:async(h:any,p:any)=>{if(p.type===(kind==='tail'?'chunks-done':'start')){blocked.resolve();await release.promise;}},after:async(_h:any,p:any)=>{if(p.type==='abort'){if(abortReject)throw Error('unknown abort ACK');await abort.promise;}}});
 const task=f.run();await blocked.promise;const out=f.h.outgoing.get('r');assert.equal(out.wait.size,0);if(kind==='queued-start'){assert.equal(out.started,true);assert.equal(out.dispatching,true);}
 restart=f.h.receive(hello({session:'87654321-4321-4321-4321-210987654321'}),'b').catch((error:any)=>String(error));
 await Promise.resolve();await Promise.resolve();assert(!f.h.outgoing.has('r'));assert(!f.h.rolls.has('r'));assert(!f.h.records.has('r'));assert.deepEqual(f.histories.at(-1),[]);
 release.resolve();await task;assert(!f.packets.some(p=>p.type==='start'));assert(!f.local.some(p=>p.type==='start'));assert(f.worker.some(p=>p.type==='release'));abort.resolve();await restart;
});
for(const [armed,abortReject] of [[false,false],[false,true],[true,false]])await check('restart '+(armed?'preserves an armed group':'revokes every queued group row before first abort ACK'+(abortReject?' failure':'')),async()=>{
 const blocked=deferred(),release=deferred(),abort=deferred();
 const f=fixture({before:async(_h:any,p:any)=>{if(p.type==='start-group'&&!armed){blocked.resolve();await release.promise;}},after:async(_h:any,p:any)=>{if(p.type==='start-group'&&armed){blocked.resolve();await release.promise;}if(p.type==='abort'){if(abortReject)throw Error('unknown group abort ACK');await abort.promise;}}});
 const rows=['r.g0','r.g1'].map((id,index)=>({uploading:false,started:false,dispatching:false,roll:{...f.roll,request:{...f.roll.request,id,batch:{id:'r',index,size:2}}},members:['b'],wait:new Set(),at:now(),hash:'a'.repeat(64)}));
 for(const row of rows){f.h.outgoing.set(row.roll.request.id,row);f.h.rolls.set(row.roll.request.id,row.roll);f.h.records.set(row.roll.request.id,{});}
 const task=f.h.dispatchStart(rows,{type:'start-group',id:'r',entries:rows.map(r=>({id:r.roll.request.id,hash:r.hash}))},100,'r');await blocked.promise;
 const restart=f.h.receive(hello({session:'87654321-4321-4321-4321-210987654321'}),'b').catch((error:any)=>String(error));await Promise.resolve();await Promise.resolve();
 if(armed){assert.equal(f.h.outgoing.size,2);assert.equal(f.local.filter(p=>p.type==='start').length,2);assert(!f.local.some(p=>p.type==='discard'));}
 else {assert.equal(f.h.outgoing.size,0);assert.equal(f.h.rolls.size,0);assert.equal(f.h.records.size,0);assert.equal(new Set(f.local.filter(p=>p.type==='discard').map(p=>p.id)).size,2);assert.deepEqual(f.histories.at(-1),[]);}
 release.resolve();await task;
 if(!armed){assert(!f.packets.some(p=>p.type==='start-group'));assert(!f.local.some(p=>p.type==='start'));assert(rows.every(r=>r.dispatching===false));assert.equal(f.h.outgoing.size,0);}
 abort.resolve();await restart;assert.equal(f.packets.filter(p=>p.type==='abort').length,armed?0:abortReject?1:2);
});
await check('dispose before tail dispatch cancels the queued SDK operation',async()=>{const blocked=deferred(),release=deferred();const f=fixture({before:async(h:any,p:any)=>{if(p.type==='chunks-done'){blocked.resolve();await release.promise;}}});const task=f.run();await blocked.promise;f.h.disposed=true;release.resolve();await task;assert(!f.packets.some(p=>p.type==='start'||p.type==='chunks-done'));assert(!f.local.some(p=>p.type==='start'));assert.deepEqual(f.errors,[]);});
const report={boundary:'Production Controller methods, encoding, and 100ms DiceSendQueue; synthetic preparation/SDK boundaries. Two-peer probe separately validates real receiver assembly and keys.',checks:tests.length,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,tests};
const output=process.env.DND_DICE_EVIDENCE||'.cache/dice-ready-tail-slot';mkdirSync(output,{recursive:true});writeFileSync(output+'/regression.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
