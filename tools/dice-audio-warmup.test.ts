import assert from 'node:assert/strict';
import {writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {DiceAudio} from '../extensions/workbench-dice3d/src/audio';
import {RollAudioMixer} from '../extensions/workbench-dice3d/src/audio-mixer';
import {DiceAssets} from '../extensions/workbench-dice3d/src/asset-loading';
import {diceCatalog} from '../extensions/workbench-dice3d/src/asset-catalog';
import type {AudioPlan} from '../extensions/workbench-dice3d/src/renderer';
import type {Catalog,Theme} from '../extensions/workbench-dice3d/src/types';

const catalog=diceCatalog(),themes=Object.values(catalog.themes),theme=themes[0];
const required=(t:Theme)=>[...Object.values(t.audio.impacts).flatMap(Object.values),t.audio.rolling];
const optional=(t:Theme)=>[t.audio.tension,t.audio.natural_1,t.audio.natural_20];
const requiredPaths=[...new Set(themes.flatMap(required))],optionalPaths=[...new Set(themes.flatMap(optional))];
const allPaths=[...requiredPaths,...optionalPaths],encoder=new TextEncoder(),decoder=new TextDecoder();
const visualPaths=['assets/fonts/Cinzel-Variable.ttf',...Object.values(catalog.dice).map(d=>d.model),...themes.flatMap(t=>Object.values(t.masks))];
let clock=1_000_000,timerId=0;
const timers=new Map<number,()=>void>(),sources:FakeSource[]=[],decodeFailures=new Map<string,number>(),unhandled:unknown[]=[];
Object.defineProperty(globalThis,'performance',{value:{timeOrigin:0,now:()=>clock},configurable:true});
class FakeNode{gain={value:1,setValueAtTime(_value:number,_at:number){}};connect(){}disconnect(){}}
class FakeSource extends FakeNode{
  buffer:any=null;loop=false;playbackRate={value:1};onended:(()=>void)|null=null;starts=0;stops=0;
  start(){this.starts++;sources.push(this)}stop(){this.stops++}
}
class FakeContext{
  state='running';currentTime=10;sampleRate=48000;destination=new FakeNode();
  createGain(){return new FakeNode()}createChannelMerger(){return new FakeNode()}createBufferSource(){return new FakeSource()}
  async decodeAudioData(bytes:ArrayBuffer){const path=decoder.decode(bytes),left=decodeFailures.get(path)||0;
    if(left){decodeFailures.set(path,left-1);throw Error('injected decode failure '+path)}return {path,duration:.06};}
  createBuffer(_channels:number,length:number,rate:number){return {path:'synthesized-rule',duration:length/rate,copyToChannel(){}}}
  async resume(){this.state='running'}
}
(globalThis as any).window={AudioContext:FakeContext,setInterval:(callback:()=>void)=>{const id=++timerId;timers.set(id,callback);return id;}};
(globalThis as any).clearInterval=(id:number)=>{timers.delete(id)};
process.on('unhandledRejection',error=>unhandled.push(error));
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const tick=()=>{for(const callback of [...timers.values()])callback()};
function deferred(){let resolve!:(value:ArrayBuffer)=>void,reject!:(error:Error)=>void;const promise=new Promise<ArrayBuffer>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
class ControlledAssets extends DiceAssets{
  calls=new Map<string,number>();holds=new Map<string,ReturnType<typeof deferred>>();failures=new Map<string,number>();
  hold(path:string){const pending=deferred();this.holds.set(path,pending);return ()=>{this.holds.delete(path);pending.resolve(encoder.encode(path).buffer)}}
  override bytes(path:string):Promise<ArrayBuffer>{this.calls.set(path,(this.calls.get(path)||0)+1);const left=this.failures.get(path)||0;
    if(left){this.failures.set(path,left-1);return Promise.reject(Error('injected download failure '+path))}
    return this.holds.get(path)?.promise||Promise.resolve(encoder.encode(path).buffer);
  }
}
function make(assets=new ControlledAssets(),data:Catalog=catalog){const events:{event:string;detail:any}[]=[];
  const mixer=new RollAudioMixer((event,detail)=>events.push({event,detail}),assets,data);return {mixer,assets,events};}
function observe<T>(promise:Promise<T>){const result:{state:'pending'|'fulfilled'|'rejected';error?:unknown}={state:'pending'};
  promise.then(()=>{result.state='fulfilled'},error=>{result.state='rejected';result.error=error});return result;}
const plan=(stinger:AudioPlan['stinger']=null):AudioPlan=>({impacts:[],hits:[],rules:[],stinger,stingerAt:0,duration:2,
  rolling:{activity:new Float32Array([0]),pan:new Float32Array([0]),step:.03},suppressed:0,merged:0,voices:0});
const results:{name:string;passed:boolean;error?:string}[]=[];
async function test(name:string,run:()=>Promise<void>){try{await run();results.push({name,passed:true});}
  catch(error){results.push({name,passed:false,error:String(error)});}finally{timers.clear();decodeFailures.clear();sources.length=0;clock=1_000_000;}}

await test('warmup fetches every peer theme collision/rolling URL once, and no unused roles',async()=>{
  const {mixer,assets}=make();await Promise.all([mixer.warmup(),mixer.warmup()]);
  assert.deepEqual([...assets.calls.keys()].sort(),requiredPaths.slice().sort());
  assert([...assets.calls.values()].every(n=>n===1));
});
await test('slow unused tension/natural files cannot hold current warmup',async()=>{
  const {mixer,assets}=make();for(const path of optionalPaths)assets.hold(path);
  const ready=observe(mixer.warmup());await flush();assert.equal(ready.state,'fulfilled');
  assert(optionalPaths.every(path=>!assets.calls.has(path)));
});
await test('failed unused tension/natural files cannot fail current warmup',async()=>{
  const {mixer,assets}=make();for(const path of optionalPaths)assets.failures.set(path,1);
  await mixer.warmup();assert(optionalPaths.every(path=>!assets.calls.has(path)));
});
await test('every required collision/rolling URL, including other peer themes, still gates readiness',async()=>{
  for(const path of requiredPaths){const {mixer,assets}=make();const release=assets.hold(path);mixer.setVolume(0);
    const warm=mixer.warmup(),ready=observe(warm);await flush();assert.equal(ready.state,'pending',path);
    release();await warm;assert.equal(ready.state,'fulfilled',path);}
});
await test('every required URL failure rejects readiness and an explicit retry fetches it again',async()=>{
  for(const path of requiredPaths){const {mixer,assets}=make();assets.failures.set(path,1);
    await assert.rejects(mixer.warmup(),/injected download failure/);await mixer.warmup();
    assert.equal(assets.calls.get(path),2,path);assert(optionalPaths.every(p=>!assets.calls.has(p)));}
});
await test('failed decode promises are evicted at all loading layers',async()=>{
  const path=requiredPaths[0],{mixer,assets}=make();decodeFailures.set(path,1);
  await assert.rejects(mixer.warmup(),/injected decode failure/);await mixer.warmup();assert.equal(assets.calls.get(path),2);
});
await test('strict DiceAudio.load still requires all ten files and retains stinger playback',async()=>{
  const assets=new ControlledAssets(),engine=new DiceAudio(null,undefined,assets),release=assets.hold(theme.audio.tension);
  const loading=engine.load(theme,''),ready=observe(loading);await flush();assert.equal(ready.state,'pending');release();
  const audio=await loading;assert.deepEqual([...assets.calls.keys()].sort(),[...required(theme),...optional(theme)].sort());
  assert(audio.tension&&audio.natural_1&&audio.natural_20);engine.start([],audio,clock);engine.stinger(true);engine.stinger(false);
  assert.deepEqual(sources.map(s=>s.buffer.path),[theme.audio.natural_20,theme.audio.natural_1]);engine.dispose();
});
await test('an explicitly requested stinger waits for exactly that clip and plays once',async()=>{
  for(const choice of ['one','twenty'] as const){const {mixer,assets,events}=make(),path=choice==='one'?theme.audio.natural_1:theme.audio.natural_20;
    await mixer.warmup();const finish=assets.hold(path);mixer.prepare(choice,theme.id,plan(choice));const release=mixer.release(choice,clock),ready=observe(release);
    await flush();assert.equal(ready.state,'pending');assert.equal(events.filter(e=>e.event==='audio-roll-start').length,0);
    finish();await release;tick();tick();await mixer.release(choice,clock);tick();
    assert.equal(sources.filter(s=>s.buffer.path===path).length,1);assert.equal(events.filter(e=>e.event==='audio-roll-start').length,1);
    assert(optionalPaths.filter(p=>assets.calls.has(p)).every(p=>p===path));mixer.stop(choice);}
});
await test('explicit stinger failure is reported, blocks release, and allows a fresh track retry',async()=>{
  const {mixer,assets,events}=make(),path=theme.audio.natural_20;await mixer.warmup();assets.failures.set(path,1);
  mixer.prepare('failed',theme.id,plan('twenty'));await assert.rejects(mixer.release('failed',clock),/injected download failure/);
  assert.equal(events.filter(e=>e.event==='audio-roll-start').length,0);assert.equal(events.filter(e=>e.event==='error').length,1);
  mixer.stop('failed');mixer.prepare('retry',theme.id,plan('twenty'));await mixer.release('retry',clock);tick();
  assert.equal(assets.calls.get(path),2);assert.equal(sources.filter(s=>s.buffer.path===path).length,1);mixer.stop('retry');
});
await test('late optional clips retain stale-cue suppression rather than playing a delayed surprise',async()=>{
  const {mixer,assets}=make();await mixer.warmup();const finish=assets.hold(theme.audio.natural_20);
  mixer.prepare('late',theme.id,plan('twenty'));const releasing=mixer.release('late',clock);await flush();clock+=200;
  finish();await releasing;tick();tick();assert.equal(sources.length,0);mixer.stop('late');
});
await test('slow load completion cannot resurrect a paused release; a later explicit release works',async()=>{
  const {mixer,assets,events}=make(),finish=assets.hold(required(theme)[0]);mixer.prepare('paused',theme.id,plan());
  const releasing=mixer.release('paused',clock);await flush();mixer.pause('paused');finish();await releasing;tick();
  assert.equal(events.filter(e=>e.event==='audio-roll-start').length,0);assert.equal(sources.length,0);
  await mixer.release('paused',clock);assert.equal(events.filter(e=>e.event==='audio-roll-start').length,1);mixer.stop('paused');
});
await test('slow optional clip cannot resurrect stopped/replaced tracks',async()=>{
  const {mixer,assets,events}=make();await mixer.warmup();const finish=assets.hold(theme.audio.natural_1);
  mixer.prepare('reused',theme.id,plan('one'));const stale=mixer.release('reused',clock);await flush();mixer.stop('reused');
  mixer.prepare('reused',theme.id,plan());await mixer.release('reused',clock);finish();await stale;tick();
  assert.equal(events.filter(e=>e.event==='audio-roll-start').length,1);assert.equal(sources.length,0);mixer.stop('reused');
});
await test('concurrent and repeated release does not duplicate playback',async()=>{
  const {mixer,assets,events}=make(),finish=assets.hold(required(theme)[0]);mixer.prepare('duplicate',theme.id,plan());
  const one=mixer.release('duplicate',clock),two=mixer.release('duplicate',clock);finish();await Promise.all([one,two]);
  await mixer.release('duplicate',clock);assert.equal(events.filter(e=>e.event==='audio-roll-start').length,1);mixer.stop('duplicate');
});
await test('retiming a paused started roll retains a single sound schedule',async()=>{
  const {mixer,events}=make();mixer.prepare('retime',theme.id,{...plan(),hits:[{t:.5,ordinal:0,maximumFace:false}]});
  await mixer.release('retime',clock);mixer.pause('retime');await mixer.retime('retime',clock+1000);clock+=1500;tick();tick();
  assert.equal(sources.length,1);assert.equal(events.filter(e=>e.event==='audio-roll-start').length,2);mixer.stop('retime');
});
await test('same-clock retime cannot duplicate already scheduled look-ahead hits or rules',async()=>{
  const {mixer}=make(),at=clock;mixer.prepare('same-clock',theme.id,{...plan(),hits:[{t:.5,ordinal:0,maximumFace:false}],rules:[{t:.5,kind:'max',pan:0}]});
  await mixer.release('same-clock',at);clock+=350;tick();assert.equal(sources.filter(s=>s.stops===0).length,2);
  await mixer.retime('same-clock',at);tick();tick();assert.equal(sources.filter(s=>s.stops===0).length,2);mixer.stop('same-clock');
});
await test('retime supersedes a pending optional load, including after pause',async()=>{
  for(const pause of [false,true]){const {mixer,assets,events}=make(),before=sources.length;await mixer.warmup();const finish=assets.hold(theme.audio.natural_20);
    mixer.prepare('retime-loading',theme.id,plan('twenty'));const original=mixer.release('retime-loading',clock);await flush();
    if(pause)mixer.pause('retime-loading');const revised=mixer.retime('retime-loading',clock+1000);finish();await Promise.all([original,revised]);
    const track=(mixer as any).tracks.get('retime-loading');assert.equal(track.at,clock+1000);assert.equal(track.engine.atWall,clock+1000);
    assert.equal(events.filter(e=>e.event==='audio-roll-start').length,1);clock+=1000;tick();tick();
    assert.equal(sources.length,before+1);assert.equal(sources.at(-1)?.buffer.path,theme.audio.natural_20);mixer.stop('retime-loading');}
});
await test('current collision, rolling, hit, emphasis, and synthesized rule sounds remain playable',async()=>{
  const {mixer}=make();const p={...plan(),impacts:[{t:0,surface:0,strength:'light',gain:.5,pan:0}] as any,
    hits:[{t:0,ordinal:0,maximumFace:false}],rules:[{t:0,kind:'max',pan:0}] as any,
    rolling:{activity:new Float32Array([1]),pan:new Float32Array([0]),step:.03}};
  mixer.prepare('sounds',theme.id,p);await mixer.release('sounds',clock);tick();
  assert(sources.some(s=>s.buffer.path===theme.audio.impacts.die_on_ground.light));
  assert(sources.some(s=>s.buffer.path===theme.audio.impacts.die_on_die.medium));
  assert(sources.some(s=>s.buffer.path===theme.audio.rolling));assert(sources.some(s=>s.buffer.path==='synthesized-rule'));
  const engine=(mixer as any).tracks.get('sounds').engine as DiceAudio;const before=sources.length;engine.emphasis();assert.equal(sources.length,before+1);mixer.stop('sounds');
});

await test('combined: active track and delayed optional track quiesce after pause, then retime once',async()=>{
 const {mixer,assets,events}=make();await mixer.warmup();
 const finish=assets.hold(theme.audio.natural_20);
 mixer.prepare('active',theme.id,plan());await mixer.release('active',clock);
 mixer.prepare('delayed',theme.id,plan('twenty'));const old=mixer.release('delayed',clock);await flush();
 assert.equal(timers.size,1);mixer.pause('active');assert.equal(timers.size,0);
 mixer.pause('delayed');finish();await old;tick();assert.equal(timers.size,0);
 assert.equal(events.filter(e=>e.event==='audio-roll-start').length,1);
 await Promise.all([mixer.retime('delayed',clock+1000),mixer.retime('delayed',clock+1000)]);
 assert.equal(timers.size,1);clock+=1000;tick();tick();
 assert.equal(sources.filter(s=>s.buffer.path===theme.audio.natural_20).length,1);
 assert.equal(events.filter(e=>e.event==='audio-roll-start').length,2);
 await mixer.retime('delayed',clock);tick();assert.equal(sources.filter(s=>s.buffer.path===theme.audio.natural_20).length,1);
 mixer.stop('delayed');assert.equal(timers.size,0);assert.equal(mixer.snapshot().active.length,1);mixer.stop('active');
});
await test('combined: deleting pending replacement cannot restart timer after last playing track stops',async()=>{
 const {mixer,assets,events}=make();await mixer.warmup();const finish=assets.hold(theme.audio.natural_1);
 mixer.prepare('active',theme.id,plan());await mixer.release('active',clock);
 mixer.prepare('replace',theme.id,plan('one'));const old=mixer.release('replace',clock);await flush();
 mixer.stop('replace');mixer.prepare('replace',theme.id,plan());await mixer.release('replace',clock);
 mixer.pause('replace');mixer.stop('active');assert.equal(timers.size,0);
 finish();await old;tick();assert.equal(timers.size,0);assert.equal(sources.length,0);
 assert.equal(events.filter(e=>e.event==='audio-roll-start').length,2);mixer.stop('replace');
});
await test('combined: completion stops timer with another prepared track still awaiting assets',async()=>{
 const {mixer,assets}=make();await mixer.warmup();const finish=assets.hold(theme.audio.natural_1);
 mixer.prepare('active',theme.id,plan());await mixer.release('active',clock);
 mixer.prepare('pending',theme.id,plan('one'));const waiting=mixer.release('pending',clock);await flush();
 clock+=2600;tick();assert.equal(timers.size,0);assert.deepEqual(mixer.snapshot().active,['pending']);
 mixer.pause('pending');finish();await waiting;assert.equal(timers.size,0);mixer.stop('pending');
});

// Real overlay/audio-host/mixer/asset planning, with only the WebGL boundary and DOM substituted.
const messages:any[]=[];
(globalThis as any).location={pathname:'/node-selftest'};
(globalThis as any).BroadcastChannel=class{onmessage:any;constructor(_name:string){}postMessage(message:any){messages.push(message)}};
(globalThis as any).localStorage={getItem:()=>null};
(globalThis as any).document={fonts:{add(){}},createElement:()=>({className:'',append(){}})};
(globalThis as any).FontFace=class{async load(){return this}};
const {mountOverlay}=await import('../extensions/workbench-dice3d/src/overlay');
async function overlayCase(run:(h:{assets:ControlledAssets;visual:ReturnType<typeof deferred>;mounted:Promise<unknown>;ready:ReturnType<typeof observe>})=>Promise<void>,configure:(assets:ControlledAssets)=>void=()=>{}){
  const assets=new ControlledAssets(),visual=deferred(),original=DiceAssets.prototype.bytes;configure(assets);messages.length=0;
  (globalThis as any).__diceOverlayVisual=visual;DiceAssets.prototype.bytes=path=>assets.bytes(path);
  const mounted=mountOverlay({append(){}} as any,'audio-selftest'),ready=observe(mounted);
  try{await run({assets,visual,mounted,ready})}finally{DiceAssets.prototype.bytes=original}
}
await test('overlay progress is 49 to 40, and visual-ready cannot bypass slow required audio',async()=>{
  let finish!:()=>void;
  await overlayCase(async({assets,visual,mounted,ready})=>{
    visual.resolve(new ArrayBuffer(0));await flush();assert.equal(ready.state,'pending');
    assert.equal(messages.filter(m=>m.type==='overlay-ready').length,0);
    assert.equal(messages.find(m=>m.type==='load-progress').progress.total,40);
    finish();await mounted;assert.equal(messages.filter(m=>m.type==='overlay-ready').length,1);
    assert(optionalPaths.every(path=>!assets.calls.has(path)));
  },assets=>{finish=assets.hold(requiredPaths[0]);for(const path of optionalPaths)assets.hold(path)});
});
await test('overlay audio-ready cannot bypass unfinished visuals',async()=>{
  await overlayCase(async({visual,mounted,ready})=>{
    await flush();assert.equal(ready.state,'pending');assert.equal(messages.filter(m=>m.type==='overlay-ready').length,0);
    visual.resolve(new ArrayBuffer(0));await mounted;assert.equal(messages.filter(m=>m.type==='overlay-ready').length,1);
  });
});
await test('overlay required audio failure never publishes overlay-ready',async()=>{
  await overlayCase(async({visual,mounted})=>{
    visual.resolve(new ArrayBuffer(0));await assert.rejects(mounted,/injected download failure/);
    assert.equal(messages.filter(m=>m.type==='overlay-ready').length,0);
  },assets=>assets.failures.set(requiredPaths[0],1));
});
await flush();await test('no unhandled asynchronous rejections',async()=>{assert.deepEqual(unhandled,[])});
const byteCount=(paths:string[])=>paths.reduce((sum,path)=>sum+statSync('extensions/workbench-dice3d/public/'+path).size,0);
const report={baseline:process.env.DICE_AUDIO_BASELINE||null,productionModules:true,realBrowser:false,realAudioDevice:false,
  themes:themes.length,strictUniqueRequests:allPaths.length,currentRequiredUniqueRequests:requiredPaths.length,unusedUniqueRequests:optionalPaths.length,
  strictOverlayPlannedAssets:new Set([...visualPaths,...allPaths]).size,currentOverlayPlannedAssets:new Set([...visualPaths,...requiredPaths]).size,
  strictEncodedBytes:byteCount(allPaths),requiredEncodedBytes:byteCount(requiredPaths),unusedEncodedBytes:byteCount(optionalPaths),
  passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
writeFileSync(join(process.env.DND_DICE_EVIDENCE||'.cache/dice-audio-warmup','result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
