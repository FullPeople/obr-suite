import assert from 'node:assert/strict';
import {setImmediate as nativeImmediate,setTimeout as nativeTimeout,clearTimeout as nativeClearTimeout} from 'node:timers';
import {DiceSendQueue} from '../src/workbench/dice-send-queue';

const checks:{name:string;passed:boolean;error?:string}[]=[];
const flush=()=>new Promise<void>(resolve=>nativeImmediate(resolve));
class ManualClock {
 time=0;serial=0;timers=new Map<number,{at:number;run:()=>void}>();
 set=(callback:(...args:any[])=>void,ms=0,...args:any[])=>{
  const id=++this.serial;this.timers.set(id,{at:this.time+Math.max(0,Number(ms)||0),run:()=>callback(...args)});return id;
 };
 clear=(id:any)=>{this.timers.delete(Number(id));};
 sleep=(ms:number)=>new Promise<void>(resolve=>{this.set(resolve,ms);});
 async advance(to:number){
  assert(to>=this.time);await flush();let rounds=0;
  while(true){
   const next=[...this.timers.values()].reduce((value,timer)=>Math.min(value,timer.at),Infinity);
   if(next>to)break;assert(++rounds<10000,'Virtual timer must make progress');this.time=next;
   const due=[...this.timers].filter(([,timer])=>timer.at<=this.time);
   for(const [id,timer]of due)if(this.timers.delete(id))timer.run();await flush();
  }
  this.time=to;await flush();
 }
}
async function fixture(run:(q:DiceSendQueue,time:ManualClock,sent:{name:string;at:number}[],send:(name:string,priority?:'normal'|'control')=>Promise<void>)=>Promise<void>){
 const time=new ManualClock(),originalTimeout=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 globalThis.setTimeout=time.set as any;globalThis.clearTimeout=time.clear as any;
 try{
  const queue=new DiceSendQueue(100,()=>time.time,time.sleep),sent:{name:string;at:number}[]=[];
  const send=(name:string,priority:'normal'|'control'='normal')=>queue.send(async()=>{sent.push({name,at:time.time});},()=>true,priority);
  await run(queue,time,sent,send);
 }finally{globalThis.setTimeout=originalTimeout;globalThis.clearTimeout=originalClear;}
}
async function check(name:string,run:Parameters<typeof fixture>[0]){
 let timer:ReturnType<typeof nativeTimeout>|undefined;
 try{await Promise.race([fixture(run),new Promise<never>((_,reject)=>{timer=nativeTimeout(()=>reject(Error('Queue test did not finish')),1500);})]);checks.push({name,passed:true});}
 catch(error){checks.push({name,passed:false,error:String(error)});}
 finally{if(timer)nativeClearTimeout(timer);}
}
const names=(sent:{name:string}[])=>sent.map(row=>row.name);

await check('No reservation retains exact normal order and 100 ms pacing',async(_q,time,sent,send)=>{
 const tasks=['a','b','c','d'].map(name=>send(name));await time.advance(300);await Promise.all(tasks);
 assert.deepEqual(names(sent),['a','b','c','d']);assert.deepEqual(sent.map(row=>row.at),[0,100,200,300]);
});
await check('A queued retire waits while later ready and start take paced control slots',async(q,time,sent,send)=>{
 await send('previous','control');q.reserveNormalWindow(250);const retired=send('retire');
 await time.advance(100);assert.deepEqual(names(sent),['previous']);
 const ready=send('ready','control');await flush();assert.deepEqual(names(sent),['previous','ready']);
 const started=send('start','control');await time.advance(200);await Promise.all([ready,started]);
 assert.deepEqual(names(sent),['previous','ready','start']);await time.advance(300);await retired;
 assert.deepEqual(names(sent),['previous','ready','start','retire']);assert.deepEqual(sent.map(row=>row.at),[0,100,200,300]);
});
await check('An active reservation never holds an available control slot',async(q,_time,sent,send)=>{
 const release=q.reserveNormalWindow(250);await send('ready','control');assert.deepEqual(sent,[{name:'ready',at:0}]);release();
});
await check('Requested windows are capped at 250 ms',async(q,time,sent,send)=>{
 q.reserveNormalWindow(10000);const task=send('normal');await time.advance(249);assert.equal(sent.length,0);
 await time.advance(250);await task;assert.equal(sent[0].at,250);
});
await check('A shorter requested window ends at its own deadline',async(q,time,sent,send)=>{
 q.reserveNormalWindow(80);const task=send('normal');await time.advance(79);assert.equal(sent.length,0);
 await time.advance(80);await task;assert.equal(sent[0].at,80);
});
await check('Overlapping and replacement leases cannot extend the first deadline',async(q,time,sent,send)=>{
 const first=q.reserveNormalWindow(250),task=send('normal');await time.advance(100);q.reserveNormalWindow(250);
 await time.advance(200);first();q.reserveNormalWindow(250);await time.advance(249);assert.equal(sent.length,0);
 await time.advance(250);await task;assert.equal(sent[0].at,250);
});
await check('An expired epoch cannot renew before its pending normal is served',async(q,time,sent,send)=>{
 let finish!:()=>void;const held=q.send(()=>new Promise<void>(resolve=>{finish=resolve;}),()=>true,'control');
 q.reserveNormalWindow(100);const task=send('normal');await time.advance(150);q.reserveNormalWindow(250);
 finish();await flush();await Promise.all([held,task]);assert.deepEqual(sent,[{name:'normal',at:150}]);
});
await check('Releasing one overlapping lease leaves the other, and release is idempotent',async(q,time,sent,send)=>{
 const first=q.reserveNormalWindow(250),second=q.reserveNormalWindow(250),task=send('normal');
 await time.advance(20);first();first();await flush();assert.equal(sent.length,0);
 second();second();await flush();await task;assert.deepEqual(sent,[{name:'normal',at:20}]);
});
await check('A validity change is observed within the 25 ms polling bound',async(q,time,sent,send)=>{
 let valid=true;q.reserveNormalWindow(250,()=>valid);const task=send('normal');await time.advance(10);valid=false;
 await time.advance(24);assert.equal(sent.length,0);await time.advance(35);await task;
 assert(sent[0].at>=10&&sent[0].at<=35,JSON.stringify(sent));
});
await check('A normal dispatch permits a later independent reservation epoch',async(q,time,sent,send)=>{
 const release=q.reserveNormalWindow(50),first=send('first');await time.advance(50);await first;release();
 q.reserveNormalWindow(250);const second=send('second');await time.advance(299);assert.equal(sent.length,1);
 await time.advance(300);await second;assert.deepEqual(sent,[{name:'first',at:50},{name:'second',at:300}]);
});
await check('Eight control sends still force a normal turn inside a new reservation',async(q,time,sent,send)=>{
 const controls=Array.from({length:8},(_,i)=>send('control-'+i,'control'));await time.advance(700);await Promise.all(controls);
 await time.advance(750);q.reserveNormalWindow(250);const normal=send('normal'),extra=send('extra-control','control');
 await time.advance(800);await normal;assert.equal(sent[8].name,'normal');assert.equal(sent[8].at,800);
 await time.advance(900);await extra;assert.equal(sent[9].name,'extra-control');
});
await check('A 1000 ms old normal wins against a new lease and fresh controls',async(q,time,sent,send)=>{
 let finish!:()=>void;const held=q.send(()=>new Promise<void>(resolve=>{finish=resolve;}),()=>true,'control');
 const normal=send('old-normal');await time.advance(1001);q.reserveNormalWindow(250);const control=send('fresh-control','control');
 finish();await flush();await Promise.all([held,normal]);assert.deepEqual(names(sent),['old-normal']);assert.equal(sent[0].at,1001);
 await time.advance(1101);await control;assert.deepEqual(names(sent),['old-normal','fresh-control']);
});
await check('An expired epoch still protects an old normal from incoming controls',async(q,time,sent,send)=>{
 let finish!:()=>void;const held=q.send(()=>new Promise<void>(resolve=>{finish=resolve;}),()=>true,'control');
 q.reserveNormalWindow(100);const normal=send('old-normal');await time.advance(1001);const control=send('fresh-control','control');
 finish();await flush();await Promise.all([held,normal]);assert.equal(sent[0].name,'old-normal');
 await time.advance(1101);await control;
});
await check('Explicit rate-limit rejection retains the original 800/1600 ms backoff',async(q,time,sent,send)=>{
 q.reserveNormalWindow(250);const attempts:number[]=[];
 const control=q.send(async()=>{attempts.push(time.time);if(attempts.length<3)throw {error:{name:'RateLimitHit'}};},()=>true,'control');
 const normal=send('normal');await time.advance(2500);await Promise.all([control,normal]);
 assert.deepEqual(attempts,[0,800,2400]);assert.deepEqual(sent,[{name:'normal',at:2500}]);
});
await check('Unknown send failures are not replayed under a reservation',async(q,_time,_sent,_send)=>{
 const release=q.reserveNormalWindow(250);let calls=0;
 await assert.rejects(q.send(async()=>{calls++;throw Error('Acknowledgement unknown');},()=>true,'control'),/Acknowledgement unknown/);
 assert.equal(calls,1);release();
});
await check('Reservation release does not bypass a normal operation validity check',async(q,time,sent,_send)=>{
 const release=q.reserveNormalWindow(250);let valid=true;
 const task=assert.rejects(q.send(async()=>{sent.push({name:'invalid',at:time.time});},()=>valid),/disposed/);
 await time.advance(20);valid=false;release();await flush();await task;assert.equal(sent.length,0);
});

const report={checks:checks.length,passed:checks.filter(row=>row.passed).length,failed:checks.filter(row=>!row.passed).length,
 boundary:'Actual DiceSendQueue with controlled SDK and reservation clocks; no browser, network, GPU or real-room latency claim.',tests:checks};
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
