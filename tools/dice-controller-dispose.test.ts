import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import {BUILD,now} from '../extensions/workbench-dice3d/src/types';
const flush=()=>new Promise(r=>setImmediate(r));
const intervals=new Map();let sequence=0;
(globalThis as any).setInterval=(fn:any)=>{const id=++sequence;intervals.set(id,fn);return id;};(globalThis as any).clearInterval=(id:any)=>intervals.delete(id);
class Channel {closed=false;onmessage:any;posts:any[]=[];late:any[]=[];constructor(public name:string){}postMessage(p:any){if(this.closed){this.late.push({type:p.type,event:p.event,stack:new Error().stack});throw new DOMException('BroadcastChannel is closed','InvalidStateError');}this.posts.push(p);}close(){this.closed=true;}}
class Worker {terminated=false;onmessage:any;onerror:any;posts:any[]=[];late:any[]=[];constructor(_url:any,_opts:any){}postMessage(p:any){if(this.terminated)this.late.push(p);else this.posts.push(p);}terminate(){this.terminated=true;}}
Object.assign(globalThis,{Worker,BroadcastChannel:Channel});
const results=[];
async function fixture(){intervals.clear();const sends:any[]=[],deferred:any[]=[];let stopped=false;
 const transport:any={id:'host',name:'Host',role:'GM',color:'#112233',mode:'review',listen(){return()=>{stopped=true;};},send(packet:any){sends.push({packet,afterStop:stopped});return new Promise((resolve,reject)=>deferred.push({resolve,reject}));}};
 const c:any=new Controller(transport);await c.keys.ready;c.catalog=diceCatalog();c.ready=true;c.overlayReady=true;c.physicsReady=true;c.wasAuthority=true;c.lastState=now();c.lastPresence=now();return{c,sends,deferred};}
for(const kind of ['tick','receive','onLocal','init'])for(const ending of ['resolve','reject'])for(const disposed of [true,false]){
 const {c,sends,deferred}=await fixture();let work:any;
 if(kind==='tick'){c.lastPresence=now()-5000;c.peers.set('expired',{id:'expired',name:'Old',lastSeen:now()-20000,ready:false});work=c.tick();}
 if(kind==='receive'){c.keys.remember=async()=>{};work=c.receive({v:1,build:BUILD,from:'peer',type:'hello',name:'Peer',color:'#112233',role:'PLAYER',session:'11111111-1111-1111-1111-111111111111',publicKey:'stub',born:1,ready:true},'peer');}
 if(kind==='onLocal'){c.rolls.set('r',{request:{id:'r',source:'host',authority:'host',visibility:'all'}});c.outgoing.set('r',{viewers:new Set(['host']),started:true,wait:new Set(),acks:new Set(),roll:{request:{id:'r'}}});work=c.onLocal({type:'renderer-event',event:'render-complete',detail:{roll:'r'}});}
 if(kind==='init')work=c.init();
 const terminal=work.catch((e:any)=>c.fail('review-'+kind,e)).then(()=>({status:'resolved'}), (e:any)=>({status:'rejected',error:String(e),stack:e.stack}));
 for(let n=0;n<5&&!deferred.length;n++)await flush();if(!deferred.length)throw Error('Fixture never reached delayed send: '+kind);
 if(disposed)c.dispose();
 if(ending==='resolve')deferred.shift().resolve();else deferred.shift().reject(Error('injected transport failure'));
 for(let n=0;n<10;n++){await flush();for(const d of deferred.splice(0))d.resolve();}
 const outcome=await terminal;
 results.push({kind,ending,disposed,...outcome,lateBus:c.bus.late,lateWorker:c.worker.late.map((x:any)=>x.type),lateNetwork:sends.filter(x=>x.afterStop).map(x=>x.packet.type),failures:c.failures,failureEvents:c.bus.posts.filter((x:any)=>x.event==='failure').map((x:any)=>x.detail),state:{ready:c.ready,peers:c.peers.size,records:c.records.size,completed:c.completed}});
 if(!disposed)c.dispose();
}
const wire=await import('../extensions/workbench-dice3d/src/wire.mjs');
const predicted=(id='crypto')=>({version:2,request:{id,source:'host',authority:'host',name:'Host',kind:'d6',count:1,theme:'ink_sketch',bodyColor:'#112233',seed:1,modifier:0,visibility:'all'},kinds:['d6'],results:[3],fps:120,frames:2,poses:new Float32Array([0,1,0,0,0,0,1,0,1,0,0,0,0,1]),contacts:[],physicsMs:1,steps:1,collisions:0,duration:1/120});
for(const kind of ['init-key','send-key','stress-submit','receive-role','receive-key','receive-chunk-finish','worker-seal','dispatch-arm'])for(const ending of ['resolve','reject'])for(const disposed of [true,false]){
 const {c,sends}=await fixture();let release:any,reject:any,value:any,stampCalls=0;
 const held=new Promise((resolve,deny)=>{release=resolve;reject=deny;});let work:any;
 c.transport.send=async(packet:any)=>{sends.push({packet,afterStop:c.disposed});};
 if(kind==='init-key'){c.keys.ready=held;work=c.init();}
 if(kind==='send-key'){c.keys.ready=held;work=c.send({type:'hello',ready:true,name:'Host'});}
 if(kind==='stress-submit'){c.submit=()=>held;work=c.onLocal({type:'command',action:'stress',options:{}});}
 const hello={v:1,build:BUILD,from:'peer',type:'hello',name:'Peer',color:'#112233',role:'PLAYER',session:'11111111-1111-1111-1111-111111111111',publicKey:'stub',born:1,ready:true};
 if(kind==='receive-role'){c.transport.resolveRole=()=>held;c.keys.remember=async()=>{};value='PLAYER';work=c.receive(hello,'peer');}
 if(kind==='receive-key'){c.keys.remember=()=>held;work=c.receive(hello,'peer');}
 if(kind==='receive-chunk-finish'){
  c.transport.id='peer';c.born=1;c.peers.set('host',{id:'host',name:'Host',ready:true,born:0,lastSeen:now(),rtt:1,version:BUILD});
  const roll=predicted(),{poses,contacts,...meta}=roll;value=await wire.encodeRoll({...meta,contacts:0},poses,contacts);
  c.inbound.set('crypto',{source:'host',assembly:{parts:new Map(),add(){},missing:()=>[],finish:()=>held,total:1},at:now(),retry:0,processing:false,prepared:false});work=c.receiveChunk({id:'crypto',index:0,data:'test'},'host');
 }
 if(kind==='worker-seal'){
  const roll:any=predicted();roll.request.visibility='self';c.pending=roll.request;c.reservations.set('crypto',{request:roll.request,broker:'host',members:['host'],at:now()});c.privateAudiences.set('crypto',['host']);c.keys.seal=()=>held;value={scope:'self',audience:['host'],commitment:'a'.repeat(64),data:{iv:'fixture',data:'fixture'},keys:[]};work=c.onWorker({id:'crypto',roll});
 }
 if(kind==='dispatch-arm'){
  const roll=predicted();const row={roll,members:['peer'],started:false,dispatching:false,at:now(),hash:'a'.repeat(64)};c.outgoing.set('crypto',row);
  c.transport.sendTimed=(packet:any,before:any)=>held.then(()=>{before();stampCalls++;sends.push({packet,afterStop:c.disposed});});work=c.dispatchStart([row],{type:'start',id:'crypto',hash:row.hash},70,'crypto');
 }
 const terminal=work.catch((e:any)=>c.fail('review-'+kind,e)).then(()=>({status:'resolved'}),(e:any)=>({status:'rejected',error:String(e),stack:e.stack}));
 await flush();if(disposed)c.dispose();if(ending==='resolve')release(value);else reject(Error('injected '+kind+' failure'));for(let n=0;n<5;n++)await flush();const outcome=await terminal;
 results.push({kind,ending,disposed,...outcome,stampCalls,timerCount:intervals.size,lateBus:c.bus.late,lateWorker:c.worker.late.map((x:any)=>x.type),lateNetwork:sends.filter(x=>x.afterStop).map(x=>x.packet.type),failures:c.failures,failureEvents:c.bus.posts.filter((x:any)=>x.event==='failure').map((x:any)=>x.detail),state:{peers:c.peers.size,records:c.records.size,completed:c.completed}});if(!disposed)c.dispose();
}


const checks=results.map((result:any)=>{
 const name=[result.kind,result.ending,result.disposed?'disposed':'live'].join(' / ');
 try{
  assert.equal(result.status,'resolved','event handler must not create an unhandled rejection');
  assert.deepEqual(result.lateBus,[],'no closed local-channel publication');
  assert.deepEqual(result.lateWorker,[],'no terminated-worker publication');
  assert.deepEqual(result.lateNetwork,[],'no retired transport publication');
  const expectedFailure=!result.disposed&&result.ending==='reject';
  assert.equal(result.failures,expectedFailure?1:0,'only live genuine failure is reported');
  if(expectedFailure){assert.equal(result.failureEvents.length,1);assert(result.failureEvents[0].error.includes('injected'),'preserve the original live failure cause');}
  if(result.kind==='stress-submit')assert.equal(result.timerCount,result.disposed?0:result.ending==='resolve'?2:1,'a disposed continuation cannot create a new stress interval');
  if(result.kind==='dispatch-arm')assert.equal(result.stampCalls,!result.disposed&&result.ending==='resolve'?1:0,'only a live dispatch arms the presentation');
  return{name,passed:true};
 }catch(error){return{name,passed:false,error:String(error),result};}
});
const report={scope:'Real Controller constructor and production methods; controlled transport, key/role waits, Web Worker and BroadcastChannel boundaries. Actual gzip encode/decode. No browser.',checks:checks.length,passed:checks.filter(x=>x.passed).length,failed:checks.filter(x=>!x.passed).length,tests:checks};
const output=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-controller-dispose');mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
