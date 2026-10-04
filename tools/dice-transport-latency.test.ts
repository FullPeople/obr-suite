import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const evidence=process.env.DND_DICE_EVIDENCE||'.cache/dice-clock-latency';mkdirSync(evidence,{recursive:true});
import {Controller} from '../extensions/workbench-dice3d/src/controller';
import {DiceSendQueue} from '../src/workbench/dice-send-queue';
import {CHANNEL,now} from '../extensions/workbench-dice3d/src/types';
const results:any[]=[];const traffic:any[]=[];const events:any[]=[];
const mode=process.env.PROBE_MODE||'warm';
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const until=async(fn:()=>any,ms=15000)=>{let end=now()+ms;while(!fn()){if(now()>end)throw Error('probe timeout');await delay(5);}};
let physicsFrames=Number(process.env.PROBE_FRAMES)||121;let physicsCount=Number(process.env.PROBE_COUNT)||1;
class StubWorker {onmessage:any;onerror:any;dead=false;constructor(...args:any[]){}terminate(){this.dead=true;}
 postMessage(p:any){if(this.dead)return;if(p.type==='warmup'){queueMicrotask(()=>this.onmessage?.({data:{type:'warm',engineMs:0,totalMs:0}}));return;}if(!p.request)return;
 const n=p.request.count,frames=physicsFrames,poses=new Float32Array(frames*n*7);let state=42;
 for(let i=0;i<poses.length;i++){state=(Math.imul(1664525,state)+1013904223)|0;poses[i]=(state>>>0)/2**32;}
 const roll={version:2,request:p.request,kinds:Array(n).fill('d20'),results:Array(n).fill(10),fps:120,frames,poses,contacts:[],physicsMs:0,steps:frames,collisions:0,duration:(frames-1)/120};
 queueMicrotask(()=>this.onmessage?.({data:{id:p.request.id,roll}})); }
}
(globalThis as any).Worker=StubWorker;
const channels=new Map<string,Set<LocalBus>>();
class LocalBus {onmessage:any;dead=false;constructor(readonly name:string){if(!channels.has(name))channels.set(name,new Set());channels.get(name)!.add(this);}
 postMessage(p:any){for(const peer of channels.get(this.name)||[])if(peer!==this&&!peer.dead)queueMicrotask(()=>peer.onmessage?.({data:p}));}
 close(){this.dead=true;channels.get(this.name)?.delete(this);}
}
(globalThis as any).BroadcastChannel=LocalBus;
const control=new Set(['hello','ping','pong','ready','start','start-group','start-ack','offer','chunks-done','abort','secret-failed','request-ack','roll-rejected']);
const listeners=new Map<string,(data:any,source:string)=>void>();
const queues=new Map<string,DiceSendQueue>();
const perClient=new Map<string,any>();
const make=(id:string)=>{
 const q=new DiceSendQueue();queues.set(id,q);let startAttempts=0;const transmit=(p:any,beforeDispatch?:()=>void)=>{const queued=now();return q.send(async()=>{beforeDispatch?.();traffic.push({id,type:p.type,roll:p.id,queued,at:now(),queueMs:now()-queued});if(id==='a'&&p.type==='start'){startAttempts++;if(startAttempts<=Number(process.env.PROBE_RATE_ERRORS||0))throw {error:{name:'RateLimitHit'}};if(process.env.PROBE_UNKNOWN_START==='1'&&startAttempts===1)throw Error('Start ACK unknown; simulated packet loss');}const sent=structuredClone(p);for(const [other,fn]of listeners)if(other!==id)setTimeout(()=>fn(sent,id),10);if(p.type==='start'&&process.env.PROBE_ACK_MS)await delay(Number(process.env.PROBE_ACK_MS));},()=>true,control.has(p.type)?'control':'normal');};const c=new Controller({id,name:id,role:'GM',mode:'node-virtual',send:transmit,sendTimed:transmit,listen:fn=>{listeners.set(id,fn);return()=>listeners.delete(id);}});
 // Do not invent wall-clock waits or alter Controller's state machine. The stub
 // renderer acknowledges local preparation and records the scheduled first frame.
 const renderer=new LocalBus(`${CHANNEL}:local:${id}`);renderer.onmessage=(e:any)=>{const p=e.data;
  if(p.type==='prepare'){events.push({id,event:'stub-prepare',roll:p.roll.request.id,at:now()});renderer.postMessage({type:'prepared',id:p.roll.request.id});}
  if(p.type==='start')events.push({id,event:'stub-first-frame',roll:p.id,at:Math.max(now(),p.at),received:now()});
  if(p.type==='log')events.push({client:id,event:p.event,at:now(),...p.detail});
 };
 perClient.set(id,{c,renderer});return c as any;
};
const a=make('a'),b=make('b');await Promise.all([a.init(),b.init()]);
await Promise.all([a.onLocal({type:'overlay-ready',detail:{view:{w:1920,h:1080}}}),b.onLocal({type:'overlay-ready',detail:{view:{w:1920,h:1080}}})]);
await until(()=>a.ready&&b.ready&&a.peers.get('b')?.ready&&b.peers.get('a')?.ready&&a.peers.get('b')?.rtt>=0&&b.peers.get('a')?.rtt>=0);
await delay(800);
for(let i=0;i<(Number(process.env.PROBE_ROLLS)||3);i++){
 const roll=`roll${i}`,at=now();await a.submit({id:roll,kind:'d20',count:physicsCount,theme:'ink_sketch',modifier:0});
 await until(()=>events.some(e=>e.id==='a'&&e.event==='stub-first-frame'&&e.roll===roll)&&events.some(e=>e.id==='b'&&e.event==='stub-first-frame'&&e.roll===roll));
 const local=events.find(e=>e.id==='a'&&e.event==='stub-first-frame'&&e.roll===roll),remote=events.find(e=>e.id==='b'&&e.event==='stub-first-frame'&&e.roll===roll),scheduled=events.find(e=>e.client==='a'&&e.event==='roll-start-scheduled'&&e.id===roll&&e.hash&&e.at>=at);
 results.push({roll,clickAt:at,localMs:local.at-at,remoteMs:remote.at-at,hostRtt:a.peers.get('b')?.rtt,peerRtt:b.peers.get('a')?.rtt,scheduled,traffic:traffic.filter(e=>e.at>=at)});
 // Repeated standalone rolls after visible physics settles; retained visual
 // result dressing stays intact and is not used to fake a faster baseline.
 await delay(Math.max(0,Math.max(local.at,remote.at)-now())+1100);
}
for(const {c,renderer}of perClient.values()){c.dispose();renderer.close();}
const failures=events.filter(e=>e.event==='failure');assert.equal(failures.length,0,JSON.stringify(failures));for(const row of results)for(const id of ['a','b'])assert.equal(events.filter(e=>e.id===id&&e.event==='stub-first-frame'&&e.roll===row.roll).length,1);const observedMinimumDispatchGapMs=Object.fromEntries(['a','b'].map(id=>{const sends=traffic.filter(e=>e.id===id);return [id,Math.min(...sends.slice(1).map((send,index)=>send.at-sends[index].at))];}));
writeFileSync(join(evidence,`${mode}-transport.json`),JSON.stringify({mode,observedMinimumDispatchGapMs,boundary:'Production Controller, keys, encoding, assembly, priority queue, 10ms virtual one-way delivery; stub physics and prepared renderer, not browser first pixels.',results,traffic,events},null,2));
console.log(JSON.stringify({mode,results:results.map(({traffic,scheduled,...r})=>({...r,lead:scheduled?.leadMs,prepareWait:scheduled?.prepareWaitMs,messages:traffic.length}))},null,2));
process.exit(0);
