// Real SDK/WASM/WebGL in a synthetic, local-only Owlbear host. Never connects to a room.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

export const PROBE_SCHEMA=2;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function probeOptions(env=process.env){
 const expression=env.DICE_IDLE_EXPRESSION||'1d20+5';assert(['1d20+5','2d6','5d6','9d6'].includes(expression),'DICE_IDLE_EXPRESSION must be 1d20+5, 2d6, 5d6 or 9d6');
 const integer=(name,fallback,min,max)=>{const n=Number(env[name]??fallback);assert(Number.isSafeInteger(n)&&n>=min&&n<=max,`${name} must be an integer in [${min}, ${max}]`);return n;};
 return{expression,root:resolve(env.DICE_IDLE_BUILD||'.local-evidence/dice-idle/runtime'),out:resolve(env.DICE_IDLE_EVIDENCE||'.local-evidence/dice-idle/browser'),port:integer('DICE_IDLE_PORT',5239,1,65535),idleMs:integer('DICE_IDLE_WAIT_MS',60000,1000,2147483647),rounds:integer('DICE_IDLE_ROUNDS',10,1,10000),cycles:integer('DICE_IDLE_CYCLES',3,1,10000)};
}
export function fixtureHTML(old,origin){
 const start=old.indexOf('res.end(`'),end=old.indexOf('`);});',start);
 assert(start>=0&&end>start,'SDK fixture extraction boundary changed');
 let template=old.slice(start+9,end);
 const replace=(needle,next)=>{assert.equal(template.split(needle).length,2,'SDK fixture boundary changed or ambiguous: '+needle);template=template.replace(needle,next);};
 replace('${JSON.stringify(base)}',JSON.stringify(origin+'/suite-dev/'));
 replace("frame('sdk-verify.html','background')","frame('extensions/workbench-dice3d/sdk-verify.html','background')");
 // The fixture must not retain packet payloads or an ever-growing message history during idle.
 replace('subscribers=new Set()','subscribers=new Map()');
 replace('window.fixture={errors:[],sent:[],metadata:{},ids:[]}',"window.fixture={errors:[],errorCount:0,metadata:{},messageCount:0,sentCount:0,modalOpenCount:0,modalCloseCount:0}");
 replace('window.fixture.ids.push(m.id);','window.fixture.messageCount++;');
 replace('window.fixture.sent.push(packet);','window.fixture.sentCount++;');
 replace("else if(m.id==='OBR_NOTIFICATION_SHOW')window.fixture.errors.push(m.data);","else if(m.id==='OBR_NOTIFICATION_SHOW'){window.fixture.errorCount++;window.fixture.errors.push(m.data);if(window.fixture.errors.length>32)window.fixture.errors.shift();}");
 replace("else if(m.id==='OBR_BROADCAST_SUBSCRIBE')subscribers.add(e.source);",`else if(m.id==='OBR_BROADCAST_SUBSCRIBE'){const channels=subscribers.get(e.source)||new Map();channels.set(m.data.channel,(channels.get(m.data.channel)||0)+1);subscribers.set(e.source,channels);}
else if(m.id==='OBR_BROADCAST_UNSUBSCRIBE'){const channels=subscribers.get(e.source),count=channels?.get(m.data.channel)||0;if(count>1)channels.set(m.data.channel,count-1);else channels?.delete(m.data.channel);if(!channels?.size)subscribers.delete(e.source);}`);
 replace('for(const w of subscribers)w.postMessage(',"for(const [w,channels] of subscribers)if(channels.has(packet.channel))w.postMessage(");
 replace("else if(m.id==='OBR_MODAL_OPEN'){window.fixture.modal=m.data;frame(m.data.url,'overlay');}",`else if(m.id==='OBR_MODAL_OPEN'){window.fixture.modal=m.data;window.fixture.modalOpenCount++;removeOverlay();frame(m.data.url,'overlay');}
else if(m.id==='OBR_MODAL_CLOSE'){window.fixture.modalCloseCount++;if(window.fixture.modal?.id===m.data.id){removeOverlay();window.fixture.modal=null;}}`);
 replace('function frame(file,id){',`function removeOverlay(){const f=document.querySelector('#overlay');if(f){subscribers.delete(f.contentWindow);f.onload=null;f.remove();}}
window.fixtureSnapshot=()=>({messageCount:window.fixture.messageCount,sentCount:window.fixture.sentCount,modalOpenCount:window.fixture.modalOpenCount,modalCloseCount:window.fixture.modalCloseCount,errorCount:window.fixture.errorCount,subscriberWindows:subscribers.size,subscriptions:[...subscribers.values()].reduce((n,channels)=>n+[...channels.values()].reduce((a,b)=>a+b,0),0)});
function frame(file,id){`);
 assert(!template.includes('${'),'Unexpanded SDK template expression');
 return template;
}

// Runs separately in each document. Only numeric counters / timer IDs are retained.
// Callback receiver and arguments are preserved; clearTimeout may also cancel an interval.
export function installIdleCounters(){
 const stats={rafCallbacks:0,intervalCallbacks:0,workerCreates:0,workerTerminateCalls:0},periods=new Map(),terminated=new WeakSet();
 const raf=window.requestAnimationFrame.bind(window),si=window.setInterval.bind(window),ci=window.clearInterval.bind(window),ct=window.clearTimeout.bind(window);
 window.requestAnimationFrame=fn=>raf(function(t){stats.rafCallbacks++;return Reflect.apply(fn,this,[t]);});
 window.setInterval=(fn,ms,...args)=>{const callback=typeof fn==='function'?function(...values){stats.intervalCallbacks++;return Reflect.apply(fn,this,values);}:fn;const id=si(callback,ms,...args);periods.set(id,Number(ms)||0);return id;};
 window.clearInterval=id=>{periods.delete(id);return ci(id);};
 window.clearTimeout=id=>{periods.delete(id);return ct(id);};
 const NativeWorker=window.Worker;
 window.Worker=class extends NativeWorker{constructor(...a){super(...a);stats.workerCreates++;}terminate(){if(!terminated.has(this)){terminated.add(this);stats.workerTerminateCalls++;}return super.terminate();}};
 window.__idleCounters=()=>({...stats,intervalPeriods:[...periods.values()],visibility:document.visibilityState});
}
export async function waitForCondition(test,description,timeout=15000){
 const until=Date.now()+timeout;
 while(!await test()){assert(Date.now()<until,description);await sleep(50);}
}
export function assertIdle(before,after){
 for(const s of [before,after]){assert(s,'Overlay snapshot missing');assert.equal(s.hidden,false,'Only visible-page idle is covered');assert.equal(s.ready,true);assert.equal(s.active,0);assert.equal(s.scheduledFrame,false);assert.equal(s.audio.active.length,0);assert.equal(s.audioTimer,false);}
 assert.equal(after.renderCalls,before.renderCalls,'idle must submit no additional DiceRenderer WebGL renders');
}

export async function runIdleProbe(){
 const {root,out,port,idleMs,rounds,cycles,expression}=probeOptions(),origin='http://127.0.0.1:'+port;
 mkdirSync(out,{recursive:true});
 // Never leave a previous successful report beside a newer failed run.
 rmSync(out+'/result.json',{force:true});rmSync(out+'/failure.json',{force:true});rmSync(out+'/final-idle.png',{force:true});
 const samples=[],errors=[],rolls=[];let browser,context,page,cdp,server,provenance,runtimeVerified=false,completedModuleCycles=0,pauseVerified=false;
 const metadata=()=>({probeSchema:PROBE_SCHEMA,provenance,idleMs,rounds,cycles,expression,softwareRequested:process.env.DICE_IDLE_SOFTWARE==='1',headless:process.env.DICE_IDLE_HEADFUL!=='1',scope:'isolated dice subsystem in a single-client synthetic host; no full Wiki/card workbench or real Owlbear room',coverage:{realSDK:runtimeVerified,realPhysics:runtimeVerified,realWebGL:runtimeVerified,completedModuleCycles,realContextPauseResume:pauseVerified,paused20msAudioTimer:pauseVerified,realOwlbearRoom:false,realHiddenTab:false,sceneReadyTransitions:false,closePopover:false,audioOutputAudibilityVerified:false,archiveEvictionRequested:rounds>20},memoryBoundary:'CDP main target / associated renderer isolate JS heap, DOM and logical resource counts. Same-process frames may share this heap; separate-process frames/workers are not covered by this heap. Never sum it with frame/worker logical bytes. Not browser/Windows working set, GPU bytes, or a process-total measurement.',measurementCaveats:['No forced GC; one bounded sequence cannot establish or rule out a leak.','WASM linear-memory byteLength is addressable capacity, not live allocations or OS resident memory.','Three.js geometry/texture/program counts are not GPU byte usage. Asset download bytes and pose-view bytes are logical counters, not additive physical memory.','Inspector attachment, snapshots, callback wrappers, browser caches and normal GC timing perturb measurements. Samples are descriptive; no automatic leak verdict.','Synthetic host stores counters instead of packet history; verification event/result rings are bounded and cleared before snapshots. Product history/replay retention is left intact.','Lifecycle coverage is explicit module teardown, iframe removal, reinitialization and another roll. It does not simulate scene switch, popover close, background tab or minimized-window scheduling.']});
 try{
  provenance=JSON.parse(readFileSync(root+'/provenance.json','utf8'));assert.equal(provenance.probeSchema,PROBE_SCHEMA,'Rebuild with the matching idle probe before running');assert.equal(provenance.diagnosticOnly,true);
  const template=fixtureHTML(readFileSync('tools/workbench-dice3d-sdk-probe.mjs','utf8'),origin);
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf'};
  server=createServer((req,res)=>{try{const path=decodeURIComponent(new URL(req.url,origin).pathname);if(path==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(template);}if(path==='/favicon.ico'){res.writeHead(204);return res.end();}const file=resolve(root,path.replace(/^\/suite-dev\//,''));if(!path.startsWith('/suite-dev/')||!file.startsWith(root+sep)){res.writeHead(403);return res.end();}try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end(path);}}catch{res.writeHead(400);res.end();}});
  await new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);});
  browser=await chromium.launch({headless:process.env.DICE_IDLE_HEADFUL!=='1',...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:process.env.DICE_IDLE_SOFTWARE==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
  context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
  await context.addInitScript(installIdleCounters);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack||String(e)));await page.exposeBinding('sendRemote',async()=>{});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  const bg=()=>page.frames().find(f=>f.url().includes('sdk-verify')),overlay=()=>page.frames().find(f=>f.url().includes('/overlay.html'));
  const ready=async()=>{
   // Current controller and current iframe must both be initialized. Historical state events
   // from the previous generation cannot satisfy this predicate.
   await page.waitForFunction(()=>{const b=document.querySelector('#background')?.contentWindow,o=document.querySelector('#overlay')?.contentWindow;return b?.suiteHostProbe&&b.__diceControllerSnapshot?.()?.ready===true&&o?.__diceOverlaySnapshot?.()?.ready===true;},null,{timeout:120000,polling:100});
   await waitForCondition(()=>page.workers().length===1,'ready must own exactly one physics worker');
  };
  const clearDiagnosticHistory=async()=>{if(bg())await bg().evaluate(()=>{window.suiteHostProbe.events.length=0;window.suiteHostProbe.results.length=0;});};
  const snapshot=async name=>{
   await clearDiagnosticHistory();
   const frames=[];for(const f of page.frames())frames.push(await f.evaluate(()=>({url:location.href,counters:window.__idleCounters?.(),controller:window.__diceControllerSnapshot?.(),overlay:window.__diceOverlaySnapshot?.(),fixture:window.fixtureSnapshot?.(),diagnosticHistory:window.suiteHostProbe?{events:window.suiteHostProbe.events.length,results:window.suiteHostProbe.results.length}:undefined,canvasCount:document.querySelectorAll('canvas').length,domNodes:document.querySelectorAll('*').length,resourceCount:performance.getEntriesByType('resource').length})));
   const workers=[];for(const w of page.workers())workers.push(await w.evaluate(()=>({url:location.href,snapshot:globalThis.__diceWorkerSnapshot?.()??null})));
   const [heap,dom,perf]=await Promise.all([cdp.send('Runtime.getHeapUsage'),cdp.send('Memory.getDOMCounters'),cdp.send('Performance.getMetrics')]);
   const record={name,at:Date.now(),frames,workers,topTargetHeap:heap,topTargetDom:dom,topTargetMetrics:Object.fromEntries(perf.metrics.map(x=>[x.name,x.value]))};samples.push(record);
   assert.deepEqual(errors,[]);const c=frames.find(x=>x.controller)?.controller;if(c){assert.equal(c.failures,0,c.error);assert.equal(c.disabled,false);}
   assert.equal(frames.find(x=>x.fixture)?.fixture.errorCount,0,'Synthetic host received a notification');
   for(const w of workers){assert(w.snapshot,'Physics worker instrumentation missing');assert(w.snapshot.wasmLinearMemoryBytes>0,'Physics WASM not initialized');}
   const o=frames.find(x=>x.overlay)?.overlay;if(o){assert(o.archive<=20,'Replay archive count exceeded policy');assert(o.archivePoseViewBytes<=64000000,'Replay archive pose-view budget exceeded policy');}
   return record;
  };
  const quiescent=async()=>{await overlay().waitForFunction(()=>{const s=window.__diceOverlaySnapshot?.();return s?.ready&&!s.hidden&&s.active===0&&!s.scheduledFrame&&s.audio.active.length===0&&!s.audioTimer;},null,{timeout:30000,polling:100});};
  const quiet=async name=>{await quiescent();const a=await snapshot(name+'-start');await sleep(idleMs);const b=await snapshot(name+'-end');assertIdle(a.frames.find(x=>x.overlay)?.overlay,b.frames.find(x=>x.overlay)?.overlay);};
  const rollOnce=async (name,selectedExpression=expression)=>{
   await clearDiagnosticHistory();
   const result=await bg().evaluate(expression=>window.suiteHostProbe.submitDice3d({expression,label:'Idle lifecycle synthetic '+Date.now(),itemId:null}),selectedExpression);rolls.push({name,id:result.rollId,total:result.total});
   await bg().waitForFunction(id=>window.suiteHostProbe.events.some(e=>e.event==='render-complete'&&e.detail.roll===id),result.rollId,{timeout:180000,polling:100});
   await quiescent();await snapshot(name+'-complete');
  };
  await page.goto(origin+'/fixture?name=Host');await ready();await quiet('never-rolled-idle');runtimeVerified=true;
  // The real renderer context-loss event pauses the real mixer; no fake timers or stub audio engine.
  const pausedRoll=await bg().evaluate(()=>window.suiteHostProbe.submitDice3d({expression:'1d20+5',itemId:null}));
  await overlay().waitForFunction(()=>window.__diceOverlaySnapshot().audioTimer,null,{timeout:30000,polling:20});
  await overlay().evaluate(()=>window.__diceOverlayContextLoss());
  await overlay().waitForFunction(()=>{const s=window.__diceOverlaySnapshot();return s.contextLost&&s.active>0&&s.audio.active.length>0&&!s.audioTimer;},null,{timeout:5000,polling:20});
  const pausedStart=await snapshot('context-paused-start');await sleep(250);const pausedEnd=await snapshot('context-paused-end');
  const a=pausedStart.frames.find(f=>f.overlay),b=pausedEnd.frames.find(f=>f.overlay);
  assert.equal(b.overlay.renderCalls,a.overlay.renderCalls,'paused renderer does not render');
  assert(!b.counters.intervalPeriods.includes(20),'paused audio must release its 20 ms interval');
  await overlay().evaluate(()=>window.__diceOverlayContextLoss(true));
  await overlay().waitForFunction(()=>{const s=window.__diceOverlaySnapshot();return !s.contextLost&&s.audioTimer;},null,{timeout:30000,polling:20});
  await bg().waitForFunction(id=>window.suiteHostProbe.events.some(e=>e.event==='render-complete'&&e.detail.roll===id),pausedRoll.rollId,{timeout:180000,polling:100});await quiescent();
  pauseVerified=true;rolls.push({name:'context-pause-resume',id:pausedRoll.rollId,total:pausedRoll.total});
  for(let i=0;i<rounds;i++)await rollOnce('roll-'+i,['1d20+5','2d6','5d6','9d6'][i%4]);
  const archiveAfterRounds=samples.at(-1).frames.find(x=>x.overlay).overlay;assert.deepEqual(archiveAfterRounds.archiveIds,rolls.slice(-20).map(r=>r.id),'replay archive must retain exactly the newest bounded roll IDs');
  await quiet('post-roll-idle');const idleBeforeRetention=samples.at(-1).frames.find(x=>x.overlay)?.overlay;await sleep(65000);const retention=await snapshot('post-protocol-retention');assertIdle(idleBeforeRetention,retention.frames.find(x=>x.overlay)?.overlay);
  for(const name of ['outgoing','requests','privateAudiences','retirementTimers'])assert.equal(retention.frames.find(x=>x.controller)?.controller.maps[name],0,name+' must retire after the protocol window');
  for(let i=0;i<cycles;i++){
   const previous=await bg().evaluate(()=>window.__diceControllerSnapshot().generation);
   await bg().evaluate(()=>window.suiteHostProbe.teardownWorkbenchDice());
   await page.waitForFunction(()=>!document.querySelector('#overlay')&&document.querySelector('#background')?.contentWindow?.__diceControllerSnapshot?.()===null,null,{timeout:15000,polling:100});
   await waitForCondition(()=>page.workers().length===0,'worker must close after module teardown');
   const stopped=await snapshot('teardown-'+i);assert(!stopped.frames.some(x=>x.overlay));
   await bg().evaluate(()=>window.suiteHostProbe.setupWorkbenchDice());await ready();
   assert(await bg().evaluate(previous=>window.__diceControllerSnapshot().generation>previous,previous),'restart must create a new controller generation');
   const restarted=await snapshot('restart-'+i);assert.deepEqual(restarted.frames.find(x=>x.overlay).overlay.archiveIds,[],'restarted iframe owns an empty replay archive');await rollOnce('restart-'+i+'-roll');completedModuleCycles++;
  }
  await quiet('restarted-idle');await page.screenshot({path:out+'/final-idle.png'});assert.deepEqual(errors,[]);
  writeFileSync(out+'/result.json',JSON.stringify({success:true,...metadata(),browser:await browser.version(),samples,rolls,errors},null,2));
  console.log(JSON.stringify({success:true,samples:samples.length,rolls:rolls.length}));
 }catch(error){writeFileSync(out+'/failure.json',JSON.stringify({success:false,...metadata(),error:String(error),samples,rolls,errors},null,2));throw error;}
 finally{try{await context?.close();}finally{try{await browser?.close();}finally{if(server?.listening)await new Promise(r=>server.close(r));}}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await runIdleProbe();
