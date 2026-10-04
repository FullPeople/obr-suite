// CI ONLY: serial real-SDK/Jolt timing A/B/A, then separate strict pixel contexts.
// Never launch this runner locally. Browser work is reserved for authorized CI.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {cpus,availableParallelism,totalmem,release} from 'node:os';
import {fixtureHTML} from './dice-ground-sequence-fixture.mjs';
import {installCorrectnessHarness} from './dice-ground-sequence-correctness.mjs';
import {summarizeFrames,assertSameAuthority,summarizeAba} from './dice-ground-sequence-metrics.mjs';
assert.equal(process.env.CI,'true','This browser runner is CI-only; local browser execution is not authorized');
const root=resolve(process.env.DICE_GROUND_SEQUENCE_BUILD||'.local-evidence/dice-ground-sequence/runtime');
const out=resolve(process.env.DICE_GROUND_SEQUENCE_OUT||'.local-evidence/dice-ground-sequence/results');
const port=Number(process.env.DICE_GROUND_SEQUENCE_PORT||5242),origin='http://127.0.0.1:'+port;
const rounds=Number(process.env.DICE_GROUND_SEQUENCE_ROUNDS||1),minBodies=Number(process.env.DICE_GROUND_SEQUENCE_MIN_BODIES||20);
assert([1,2,3].includes(rounds),'Use one exploratory round, at most three repeated rounds');assert.equal(minBodies,20,'Timing evidence is scoped to the reviewed 20-caster threshold');
mkdirSync(out,{recursive:true});const source=JSON.parse(readFileSync(resolve(root,'ground-sequence-source.json'),'utf8'));
const report={schema:'dice-ground-live-sequence.v1',success:false,source,rounds,minBodies,realSDK:true,realJolt:true,realWebGL:true,realOwlbearRoom:false,productionClaim:false,softwareGPURequested:process.env.DICE_GROUND_SEQUENCE_SOFTWARE!=='0',viewport:{width:1280,height:800,dpr:1},timingBoundary:'CPU drawFrame return and real wall-clock completion. No GPU timestamp/presentation claim. Build, compile, signature and fallback cost remain inside whole drawFrame and wall time.',normalCapture:{screenshots:false,video:false,readPixels:false,finish:false,gpuTimestampQueries:false},host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,availableParallelism:availableParallelism(),memoryBytes:totalmem(),osRelease:release(),arch:process.arch,node:process.version},timing:[],pairedComparisons:[],correctness:[],errors:[]};
const save=()=>writeFileSync(resolve(out,'result.json'),JSON.stringify(report,null,2));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf'};
const server=createServer((req,res)=>{try{const u=new URL(req.url,origin);if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixtureHTML(origin,{single:u.searchParams.get('single')==='1'}));return;}if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}const file=resolve(root,decodeURIComponent(u.pathname).replace(/^\/suite-dev\//,''));if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch(error){res.writeHead(404);res.end(String(error));}});
let browser,live;
async function openSession({clients=1,enabled=false,seed=7,rollId,fixedClock=false,minBodies:threshold=minBodies}){
 const context=await browser.newContext({viewport:{width:report.viewport.width,height:report.viewport.height},deviceScaleFactor:1});
 await context.addInitScript(config=>{window.__diceSequenceConfig=config;window.__diceSequenceSeed=config.seed;window.__diceSequenceRollId=config.rollId;},{enabled,seed,rollId,fixedClock,minBodies:threshold,stableFrames:3});
 const session={context,pages:[],sdk:[],overlays:[],errors:[],consoleErrors:[],ready:[],transport:[]};live=session;
 for(const name of ['Host','Player'].slice(0,clients)){
  const page=await context.newPage();session.pages.push(page);page.on('pageerror',error=>session.errors.push({client:name,error:String(error)}));page.on('console',message=>{if(message.type()==='error')session.consoleErrors.push({client:name,text:message.text()});});
  await page.exposeBinding('sendRemote',async({page:sender},packet)=>{for(const other of session.pages)if(other!==sender){const queued=Date.now();setTimeout(()=>{session.transport.push({type:packet.data?.type,queuedAt:queued,deliveredAt:Date.now()});void other.evaluate(value=>window.deliver?.(value),packet).catch(error=>session.errors.push({transportError:String(error)}));},10);}});
  const began=Date.now();await page.goto(origin+'/fixture?name='+name+'&single='+(clients===1?'1':'0'));
  await page.waitForFunction(()=>document.querySelector('#background')?.contentWindow?.suiteHostProbe?.events.filter(e=>e.type==='state').at(-1)?.state.ready,null,{timeout:120000,polling:100});
  const sdk=page.frames().find(frame=>frame.url().includes('sdk-verify')),overlay=page.frames().find(frame=>frame.url().includes('/overlay.html'));assert(sdk&&overlay,'Real SDK/overlay frame missing');
  session.sdk.push(sdk);session.overlays.push(overlay);
  await overlay.waitForFunction(()=>window.__diceGroundLiveProbe&&window.__diceProfileRenderer?.ready,null,{timeout:120000,polling:100});
  session.ready.push({name,readyMs:Date.now()-began,renderer:await sdk.evaluate(()=>window.suiteHostProbe.events.find(e=>e.event==='renderer-ready')?.detail)});
 }
 if(clients===2)await Promise.all(session.sdk.map(frame=>frame.waitForFunction(()=>window.suiteHostProbe.events.filter(e=>e.type==='state').at(-1)?.state.peers.filter(peer=>peer.ready).length===1,null,{timeout:120000,polling:100})));
 return session;
}
async function closeSession(session){for(const page of session.pages)assert.deepEqual(await page.evaluate(()=>window.fixture.errors),[],'SDK host reported notification errors');assert.deepEqual(session.errors,[],'Browser/transport errors');await session.context.close();if(live===session)live=null;}
async function submit(session,expression,rollId,seed=7){
 await Promise.all(session.sdk.map(frame=>frame.evaluate(({rollId,seed})=>{window.__diceSequenceRollId=rollId;window.__diceSequenceSeed=seed;},{rollId,seed})));
 return session.sdk[0].evaluate(expression=>{const submittedAt=performance.timeOrigin+performance.now();window.__diceSequenceResult=undefined;window.__diceSequenceSubmitError=undefined;window.__diceSequencePromise=window.suiteHostProbe.submitDice3d({expression,itemId:null}).then(result=>{window.__diceSequenceResult=result;},error=>{window.__diceSequenceSubmitError=String(error);});return submittedAt;},expression);
}
async function waitActive(session,rollId){await Promise.all(session.overlays.map(frame=>frame.waitForFunction(id=>window.__diceProfileRenderer.active.some(active=>active.roll.request.id.startsWith(id)),rollId,{timeout:120000,polling:20})));}
async function collectOverlay(frame,rollId){return frame.evaluate(async id=>{
 const profile=window.__diceSequenceProfile,r=window.__diceProfileRenderer;
 const digest=async array=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',array))].map(value=>value.toString(16).padStart(2,'0')).join('');
 const rolls=await Promise.all(profile.rolls.filter(entry=>entry.roll.request.id.startsWith(id)).map(async({roll,cue,queuedStart,initialBirths})=>({requestId:roll.request.id,seed:roll.request.seed,poseSha256:await digest(roll.poses),poseBytes:roll.poses.byteLength,kinds:roll.kinds,results:roll.results,fps:roll.fps,frames:roll.frames,duration:roll.duration,physicsMs:roll.physicsMs,births:initialBirths??null,clamps:roll.formulaData?.timeline?.clamps??[],queuedStart,schedule:{settled:cue.settled,firstBeam:cue.firstBeam,finalReveal:cue.finalReveal,finalBeamEnd:cue.finalBeamEnd,diceExit:cue.diceExit,beams:cue.beams.map(beam=>({dieIndex:beam.dieIndex,start:beam.start,reveal:beam.reveal,ordinal:beam.ordinal,maximumFace:beam.maximumFace})),modifier:cue.modifier?{start:cue.modifier.start,reveal:cue.modifier.reveal}:null}})));
 return {rolls,frames:profile.frames,rendererEvents:profile.events.filter(event=>event.detail?.roll?.startsWith(id)),probe:window.__diceGroundLiveProbe.snapshot(),faults:profile.events.filter(event=>['error','render-frame-retry','render-cancelled','render-unavailable'].includes(event.event)),activeCount:r.active.length};
 },rollId);}
async function timingLeg(scenario,round,mode){
 const rollId='ground-sequence-'+scenario.id+'-r'+round,session=await openSession({...scenario,enabled:mode==='cache',rollId});
 const submittedAt=await submit(session,scenario.expression,rollId,scenario.seed);
 for(const frame of session.sdk)await frame.waitForFunction(id=>window.__diceSequenceSubmitError||window.suiteHostProbe.events.some(e=>e.event==='render-complete'&&e.detail.roll===id),rollId,{timeout:180000,polling:100});
 for(const frame of session.sdk)await frame.waitForFunction(id=>window.suiteHostProbe.results.some(result=>result.data.rollId===id),rollId,{timeout:15000,polling:50});
 const row={scenario:scenario.id,round,mode,rollId,seed:scenario.seed,expression:scenario.expression,submittedAt,ready:session.ready,clients:[]};
 for(let index=0;index<session.sdk.length;index++){
  const data=await session.sdk[index].evaluate(id=>({events:window.suiteHostProbe.events.filter(e=>e.type==='log'&&(e.detail?.id===id||e.detail?.roll?.startsWith(id))),result:window.suiteHostProbe.results.find(result=>result.data.rollId===id)?.data,error:window.__diceSequenceSubmitError}),rollId);
  assert.equal(data.error,undefined,'Submission failed');assert(data.result,'Real result missing');
  const overlay=await collectOverlay(session.overlays[index],rollId),release=data.events.find(e=>e.event==='render-release'),complete=data.events.find(e=>e.event==='render-complete'&&e.detail.roll===rollId);
  assert(release&&complete,'Actual release/completion events missing');assert(overlay.rolls.length>0,'Authoritative trajectory missing');assert(!overlay.probe.requiresRendererRecreation,'Fatal Three interruption requires new renderer: '+overlay.probe.fatalReason);assert.deepEqual(overlay.faults,[],'Actual product renderer reported failure');assert.equal(overlay.activeCount,0,'Dice remain after real completion');assert.deepEqual(overlay.probe.syncCalls?.hit,{},'Runtime added synchronous GPU query/readback to hot-hit timing');assert(overlay.probe.resources.peakTargets<=1,'More than one ground target allocated');assert.equal(overlay.probe.resources.liveTargets,0,'Final empty frame retained ground target');
  assert(overlay.rolls.every(roll=>roll.fps===120&&roll.frames>1&&roll.poseBytes===roll.frames*roll.kinds.length*7*4),'Invalid real Jolt trace shape');
  const terminal=overlay.rendererEvents.filter(event=>event.event==='render-complete').at(-1);assert(terminal,'Product drawFrame completion missing');
  const finalFrame=overlay.frames.find(frame=>frame.at<=terminal.observedAt&&frame.finishedAt>=terminal.observedAt);assert(finalFrame,'Complete event not enclosed in a finished drawFrame');
  const timings=summarizeFrames(overlay.frames,submittedAt,release.detail.actual,finalFrame.finishedAt),retimes=overlay.rendererEvents.filter(event=>event.event==='render-retimed');
  row.clients.push({index,ready:session.ready[index],release:release.detail,completionObservedAt:complete.observedAt,productCompletionAt:terminal.observedAt,finalFrameSubmittedAt:finalFrame.finishedAt,retimes,result:data.result,rolls:overlay.rolls,probe:overlay.probe,renderPaths:{hits:overlay.probe.hits,originalFrames:overlay.probe.frames-overlay.probe.hits,buildFrames:overlay.probe.builds,failedHitFallbacks:overlay.probe.fallbacks},timings,events:data.events});
  assert.deepEqual(data.events.filter(e=>['error','render-frame-retry','render-cancelled','render-unavailable'].includes(e.event)),[],'Product render failed');
 }
 if(mode!=='cache')for(const client of row.clients)assert.equal(client.probe.hits,0,'Disabled baseline unexpectedly used cache');
 if(scenario.id==='single-control')for(const client of row.clients)assert.equal(client.probe.hits,0,'Single-die control must remain below timing threshold');
 row.transport= session.transport;row.consoleErrors=session.consoleErrors;report.timing.push(row);save();await closeSession(session);
 console.log(JSON.stringify({phase:'timing',scenario:scenario.id,round,mode,clients:row.clients.map(client=>({wallMs:client.timings.releaseToCompletionMs,p95Ms:client.timings.frameIntervalP95Ms,wholeJsMs:client.timings.wholeJsTotalMs,hits:client.probe.hits,builds:client.probe.builds,retimes:client.retimes.length}))}));return row;
}
function preserveImages(prefix,row){for(const image of row.images||[]){assert(image.png.startsWith('data:image/png;base64,'));const filename=prefix+'-'+image.name+'.png';writeFileSync(resolve(out,filename),Buffer.from(image.png.split(',')[1],'base64'));image.file=filename;delete image.png;}}
async function correctnessStep(session,params){
 const row=await session.overlays[0].evaluate(params=>window.__diceSequenceCorrectness.run(params),params);
 preserveImages('correctness-'+report.correctness.length+'-'+params.name,row);report.correctness.push(row);save();
 assert(row.pass,'Strict candidate-first RGBA/cue comparison failed: '+params.name+' '+JSON.stringify(row.rgba));return row;
}
async function correctness(){
 const id='ground-sequence-correct-20d6',session=await openSession({clients:1,enabled:true,seed:7,rollId:id,fixedClock:true,minBodies:1});
 await submit(session,'20d6',id,7);await waitActive(session,id);await session.overlays[0].evaluate(installCorrectnessHarness);
 const plan=await session.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),id);assert.equal(plan.physicalCount,20);assert.equal(plan.fps,120);
 const age=plan.settled+.12;
 // Candidate cache sees moving poses before its settled positive-control sequence.
 for(const [index,at] of [0,.08,.3,Math.max(.31,plan.settled-.1)].entries())await correctnessStep(session,{name:'moving-pose-'+index,id,age:at,capture:index===2});
 for(let i=0;i<5;i++)await correctnessStep(session,{name:'settled-warm-'+i,id,age,capture:i===4});
 const positive=report.correctness.at(-1);assert(positive.statsAfter.hits>positive.statsBefore.hits,'20d6 positive control never exercised cache hit');
 await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.negative(true));
 const negative=await correctnessStep(session,{name:'zero-alpha-hit-negative-control',id,age,negative:true,capture:true});
 assert(negative.statsAfter.hits>negative.statsBefore.hits,'Negative control did not exercise hit');
 await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.negative(false));await correctnessStep(session,{name:'after-negative-control',id,age});
 const mutations=['body-position','body-presence','hidden-parent','body-cast-shadow','body-layer','camera-world','camera-projection','camera-layer','scene-world','light-position','light-target','light-intensity','shadow-intensity','shadow-bias','shadow-normal-bias','shadow-radius','shadow-resolution','shadow-frame-extents','shadow-viewport','shadow-map-dispose','ground-opacity','ground-position','ground-geometry-position','ground-geometry-normal','ground-geometry-index','viewport','dpr','same-size-canvas','clear'];
 for(const mutation of mutations){
  await session.overlays[0].evaluate(name=>window.__diceSequenceCorrectness.mutate(name),mutation);
  // First invalidation output and stable/rejected follow-up are both checked.
  await correctnessStep(session,{name:mutation+'-first',id,age});
  for(let i=0;i<3;i++)await correctnessStep(session,{name:mutation+'-stable-'+i,id,age});
  await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.mutate('none'));
  await correctnessStep(session,{name:mutation+'-restored',id,age});
 }
 await session.pages[0].setViewportSize({width:1100,height:740});
 await session.overlays[0].waitForFunction(()=>window.__diceProfileRenderer.projection.width===1100,null,{timeout:10000});
 await correctnessStep(session,{name:'actual-resize',id,age,capture:true});
 await session.pages[0].setViewportSize({width:1280,height:800});
 await session.overlays[0].waitForFunction(()=>window.__diceProfileRenderer.projection.width===1280,null,{timeout:10000});
 for(let i=0;i<4;i++)await correctnessStep(session,{name:'resize-restored-'+i,id,age});
 // True extension-driven generation loss; product listeners compile and resume.
 await session.overlays[0].evaluate(()=>{const gl=window.__diceProfileRenderer.gl.getContext(),extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('Required WEBGL_lose_context extension missing');window.__diceSequenceLoseContext=extension;extension.loseContext();});
 await session.overlays[0].waitForFunction(()=>window.__diceProfileRenderer.contextLost,null,{timeout:10000});
 await session.overlays[0].evaluate(()=>window.__diceSequenceLoseContext.restoreContext());
 await session.overlays[0].waitForFunction(()=>window.__diceSequenceProfile.events.some(event=>event.event==='render-context-restored'),null,{timeout:120000,polling:100});
 for(let i=0;i<5;i++)await correctnessStep(session,{name:'context-restored-'+i,id,age,capture:i===4});
 const afterRestore=report.correctness.at(-1);assert(afterRestore.statsAfter.contextGeneration>positive.statsAfter.contextGeneration,'Runtime did not observe actual context generation');
 if(plan.firstReveal)await correctnessStep(session,{name:'result-cue-gathering',id,age:(plan.firstBeam+plan.firstReveal)/2,capture:true});
 const empty=await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.end());preserveImages('correctness-final-empty',empty);report.correctness.push(empty);save();assert(empty.pass,'Final empty frame retained pixels');
 // New real roll in the SAME renderer and cache instance after the previous exit.
 const nextId='ground-sequence-correct-next20d6';await submit(session,'20d6',nextId,7);await waitActive(session,nextId);
 const next=await session.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),nextId);
 for(let i=0;i<5;i++)await correctnessStep(session,{name:'new-roll-'+i,id:nextId,age:next.settled+.12});
 const secondEmpty=await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.end());preserveImages('correctness-second-empty',secondEmpty);report.correctness.push(secondEmpty);save();assert(secondEmpty.pass);
 await closeSession(session);
 // Actual seed-2 clamp, not an invented mesh or a synthetic onFrame substitute.
 const clampId='ground-sequence-correct-clamp2',clamp=await openSession({clients:1,enabled:true,seed:2,rollId:clampId,fixedClock:true,minBodies:1});
 await submit(clamp,'max(2d6,6)',clampId,2);await waitActive(clamp,clampId);await clamp.overlays[0].evaluate(installCorrectnessHarness);
 const clampPlan=await clamp.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),clampId);assert(clampPlan.clamps.length>0,'Seed 2 did not produce true Jolt clamp episode');
 for(const [index,episode] of clampPlan.clamps.entries()){
  const row=await correctnessStep(clamp,{name:'actual-seed2-clamp-'+index,id:clampId,age:(episode.start+episode.end)/2,capture:true});
  assert(row.unknownVisibleDrawables.length>0,'Actual clamp step failed to expose visible 3D FX/depth masks');assert.equal(row.statsAfter.hits,row.statsBefore.hits,'Visible real clamp FX must fail open');assert(row.statsAfter.lastRecord?.reason,'Clamp fallback has no recorded reason');
 }
 const clampEmpty=await clamp.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.end());preserveImages('correctness-clamp-empty',clampEmpty);report.correctness.push(clampEmpty);save();assert(clampEmpty.pass);await closeSession(clamp);
}
try{
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding',...(report.softwareGPURequested?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
 report.browser=await browser.version();
 const scenarios=[{id:'single-20d6',clients:1,expression:'20d6',seed:7},{id:'two-client-20d6',clients:2,expression:'20d6',seed:7},{id:'single-control',clients:1,expression:'1d20',seed:7}];
 for(let round=0;round<rounds;round++)for(const scenario of scenarios){const legs=[];for(const mode of ['baseline-before','cache','baseline-after'])legs.push(await timingLeg(scenario,round,mode));assertSameAuthority(legs);report.pairedComparisons.push({scenario:scenario.id,round,clients:summarizeAba(legs)});save();}
 await correctness();report.success=true;report.summary={timingLegs:report.timing.length,strictSteps:report.correctness.length,allExactExceptRequiredNegative:report.correctness.every(row=>row.pass),speedThresholdApplied:false,cacheAcceptedForProduction:false};save();console.log(JSON.stringify(report.summary));
}catch(error){report.error=String(error.stack||error);if(live){report.errors.push(...live.errors);report.failureContext={consoleErrors:live.consoleErrors,overlayDiagnostics:await Promise.all(live.overlays.map(frame=>frame.evaluate(()=>({probe:window.__diceGroundLiveProbe?.snapshot(),events:window.__diceSequenceProfile?.events,frames:window.__diceSequenceProfile?.frames})).catch(error=>({error:String(error)})))),diagnostics:await Promise.all(live.pages.map(page=>page.evaluate(()=>({fixture:window.fixture,frames:[...document.querySelectorAll('iframe')].map(frame=>({url:frame.src,events:frame.contentWindow?.suiteHostProbe?.events?.slice(-50)}))})).catch(error=>({error:String(error)}))))};}save();throw error;}
finally{if(live)await live.context.close();if(browser)await browser.close();if(server.listening)await new Promise(done=>server.close(done));}
