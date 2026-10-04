import assert from 'node:assert/strict';
import {DiceSendQueue} from '../src/workbench/dice-send-queue';
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {Assembly} from '../extensions/workbench-dice3d/src/wire.mjs';
import {BUILD,now} from '../extensions/workbench-dice3d/src/types';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const tests:{name:string;passed:boolean;error?:string}[]=[];
const check=async(name:string,fn:()=>unknown)=>{try{await fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:String(e)});}};
const host=()=>{
 const h:any=Object.create(Controller.prototype),sent:any[]=[],local:any[]=[];
 Object.assign(h,{transport:{id:'host',name:'Host',role:'GM'},peers:new Map(),inbound:new Map(),outgoing:new Map(),rolls:new Map(),queue:[],requests:new Map(),accepted:new Map(),retainedUntil:new Map(),settledAt:new Map(),heldRolls:new Map(),reservations:new Map(),privateRunning:new Set(),privateAudiences:new Map(),secrets:new Map(),records:new Map(),probes:new Map(),clocks:new Map(),started:new Map(),events:[],lastState:now(),lastPresence:now(),keys:{forget:()=>{}},worker:{postMessage:()=>{}},bus:{postMessage:(p:any)=>local.push(p)},state:()=>{},sendRecords:()=>{},log:()=>{},fail:()=>{},next:()=>{},send:async(p:any,stamp?:(packet:any)=>void)=>{stamp?.(p);sent.push(p);},retainUntilExit:()=>{}});
 return {h,sent,local};
};
const outgoing=(source='host')=>({uploading:false,roll:{request:{id:'roll',source,authority:'host'},kinds:['d20']},chunks:['first','last'],hash:'a'.repeat(64),bytes:14000,wait:new Set(['spectator']),members:['spectator'],at:now()-4000,started:false,retry:0,acks:new Set(['spectator']),lastStartRetry:0,window:20000,viewers:new Set(['host','spectator'])});
await check('start confirmations overtake queued trajectory fragments without exceeding send rate',async()=>{
 let time=0;const q=new DiceSendQueue(100,()=>time,async ms=>{time+=ms;}),order:string[]=[];
 const tasks=Array.from({length:8},(_,i)=>q.send(async()=>{order.push('chunk'+i);},()=>true));
 tasks.push((q.send as any)(async()=>{order.push('start');},()=>true,'control'));
 await Promise.all(tasks);assert(order.indexOf('start')<3,JSON.stringify(order));assert(time>=800);
});
await check('an unresponsive spectator cannot hold the room for 20 seconds',async()=>{
 const {h,sent}=host(),out=outgoing();h.outgoing.set('roll',out);await h.tick();assert.equal(out.started,true);assert(sent.some(p=>p.type==='start'));assert(h.outgoing.has('roll'));
});
await check('the submitting player remains required, including private rolls',async()=>{
 const {h}=host(),out=outgoing('spectator');h.outgoing.set('roll',out);await h.tick();assert.equal(out.started,false);assert(out.wait.has('spectator'));
});
await check('the local renderer remains required after the spectator grace period',async()=>{
 const {h,local}=host(),out=outgoing();out.wait.add('host');h.outgoing.set('roll',out);await h.tick();assert.equal(out.started,false);assert(out.wait.has('host'));assert(local.some(p=>p.type==='prepare'));
});
await check('a missed local preparation message is retried with the verified incoming trajectory',async()=>{
 const {h,local}=host(),roll={request:{id:'roll'}},assembly=new Assembly(1,1,'a'.repeat(64));h.rolls.set('roll',roll);h.inbound.set('roll',{source:'sender',assembly,at:now()-4000,retry:0,processing:true,prepared:false});await h.tick();assert.equal(local.find(p=>p.type==='prepare')?.roll,roll);
});
await check('an unconfirmed spectator does not cancel subsequent requests or throw a global error',async()=>{
 const {h}=host(),out=outgoing();out.started=true;out.start=now()-21000;out.lastStartRetry=now()-2000;let failures=0;h.fail=()=>{failures++;};h.outgoing.set('roll',out);await h.tick();assert.equal(failures,0);assert.equal(out.acks.size,0);
});
await check('repair transmission cannot block processing a following ready message',async()=>{
 const {h}=host(),out=outgoing();out.at=now();h.outgoing.set('roll',out);h.send=()=>new Promise(()=>{});
 const repaired=h.receive({v:1,build:BUILD,from:'spectator',type:'missing',id:'roll',indices:[0,1]},'spectator');
 const result=await Promise.race([repaired.then(()=>true),new Promise(r=>setTimeout(()=>r(false),50))]);assert.equal(result,true);
});
await check('an early authenticated start is buffered until the trajectory and renderer are ready',async()=>{
 const {h}=host(),assembly=new Assembly(1,1,'a'.repeat(64));h.inbound.set('roll',{source:'sender',assembly,at:now(),retry:0,processing:false,prepared:false});h.peers.set('sender',{rtt:1,offset:0,lastSeen:now()});
 await h.receive({v:1,build:BUILD,from:'sender',type:'start',id:'roll',hash:assembly.sha,start:now()-1000},'sender');assert(h.inbound.get('roll').start);assert(!h.started.has('roll'));
});
await check('a forged ready cannot bypass the submitting player barrier',async()=>{
 const {h}=host(),out=outgoing('spectator');h.outgoing.set('roll',out);await h.receive({v:1,build:BUILD,from:'outsider',type:'ready',id:'roll',hash:out.hash},'outsider');assert(out.wait.has('spectator'));assert.equal(out.started,false);
});
await check('a mismatching start hash is rejected before buffering or playback',async()=>{
 const {h}=host(),assembly=new Assembly(1,1,'a'.repeat(64));h.inbound.set('roll',{source:'sender',assembly,at:now(),retry:0,processing:false,prepared:false});
 await assert.rejects(h.receive({v:1,build:BUILD,from:'sender',type:'start',id:'roll',hash:'b'.repeat(64),start:now()},'sender'),/散列/);assert.equal(h.inbound.get('roll').start,undefined);
});
await check('repair indices are validated before any fragment is queued',async()=>{
 const {h,sent}=host(),out=outgoing();h.outgoing.set('roll',out);await assert.rejects(h.receive({v:1,build:BUILD,from:'spectator',type:'missing',id:'roll',indices:[-1]},'spectator'),/repair index/);assert.equal(sent.length,0);
});
await check('empty composer submissions do not clear input or send an empty formula',async()=>{
 const source=readFileSync('tools/build-workbench-dice.mjs','utf8').match(/const physicalPanelAdapter=`([\s\S]*?)`;/)![1];
 let sent=0,cleared=0;const c:any={readFixedRoll:()=>false,getOwnedSelectedTokenIds:async()=>[],crypto:{randomUUID:()=> 'test'},saveLastExpr:()=>{},btnLastRoll:{},setExpression:()=>{cleared++;},labelInput:{},expression:'',OBR:{dice3d:{submit:async()=>{sent++;}},notification:{show:async()=>{}}}};vm.createContext(c);vm.runInContext(source,c);await c.performPhysicalPanelRoll('', '',false,true);assert.equal(sent,0);assert.equal(cleared,0);
});
await check('card quick popup double click submits once and retains input on a failed submission',async()=>{
 const html=readFileSync('dice-quick-popup.html','utf8'),source=html.slice(html.indexOf('let submitting = false;'),html.indexOf('OBR.onReady(async () => {'));
 let sent=0,closed=0,finish:()=>void=()=>{};const errors:string[]=[];
 const c:any={exprInput:{value:'1d20+5'},labelInput:{value:'命中'},itemId:null,BC_QUICK_ROLL:'quick',close:async()=>{closed++;},console:{error:()=>{}},OBR:{broadcast:{sendMessage:()=>{sent++;return new Promise<void>(resolve=>{finish=resolve;});}},notification:{show:async(message:string)=>errors.push(message)}}};vm.createContext(c);vm.runInContext(source,c);
 const first=c.fireRoll({});await c.fireRoll({});assert.equal(sent,1);finish();await first;assert.equal(closed,1);
 c.OBR.broadcast.sendMessage=async()=>{throw Error('公式超过上限');};await c.fireRoll({});assert.equal(closed,1);assert.deepEqual(errors,['公式超过上限']);assert.equal(c.exprInput.value,'1d20+5');
});
console.log(JSON.stringify({checks:tests.length,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,tests},null,2));
if(tests.some(t=>!t.passed))process.exitCode=1;
