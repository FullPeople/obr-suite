// CI ONLY: serial real-SDK/Jolt timing A/B/A, then separate strict pixel contexts.
// Never launch this runner locally. Browser work is reserved for authorized CI.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {cpus,availableParallelism,totalmem,release} from 'node:os';
import {createHash} from 'node:crypto';
import {encodeRgbaPng} from './dice-ground-sequence-pixels.mjs';
import {fixtureHTML,installSequenceContext} from './dice-ground-mask-sequence-fixture.mjs';
import {installCorrectnessHarness} from './dice-ground-mask-sequence-correctness.mjs';
import {summarizeFrames,assertSameAuthority,summarizeAba,fragmentCoverage} from './dice-ground-mask-sequence-metrics.mjs';
assert.equal(process.env.CI,'true','This browser runner is CI-only; local browser execution is not authorized');
const root=resolve(process.env.DICE_GROUND_MASK_SEQUENCE_BUILD||'.local-evidence/dice-ground-mask-sequence/runtime');
const out=resolve(process.env.DICE_GROUND_MASK_SEQUENCE_OUT||'.local-evidence/dice-ground-mask-sequence/results');
const port=Number(process.env.DICE_GROUND_MASK_SEQUENCE_PORT||5242),origin='http://127.0.0.1:'+port;
const mode=process.env.DICE_GROUND_MASK_SEQUENCE_MODE||'full',readback2D='frequent';
assert.equal(mode,'full','Only one bounded full experiment is authorized');
const rounds=Number(process.env.DICE_GROUND_MASK_SEQUENCE_ROUNDS||1);assert.equal(rounds,1,'Only one exploratory round is authorized');
mkdirSync(out,{recursive:true});const source=JSON.parse(readFileSync(resolve(root,'ground-mask-sequence-source.json'),'utf8'));
const report={schema:'dice-ground-mask-sequence.v1',success:false,source,mode,correctnessReadback2D:readback2D,correctnessReadbackDisclosure:'Only correctness cue-canvas/research-effects use willReadFrequently:true at first getContext; timing and glyph/default product canvases unchanged; no warmup/discarded first output; zero RGBA tolerance',rounds,realSDK:true,realJolt:true,realWebGL:true,realOwlbearRoom:false,productionClaim:false,softwareGPURequested:process.env.DICE_GROUND_MASK_SEQUENCE_SOFTWARE!=='0',viewport:{width:1280,height:800,dpr:1},timingBoundary:'CPU drawFrame return and real wall-clock completion. No GPU timestamp/presentation claim. All initialization and original startup shader compilation are included in cold navigation-to-ready; per-frame bounds and render costs remain inside drawFrame and wall time.',contextIsolation:'Fresh browser context per leg, same browser process/runner; not whole-process cold boot',normalCapture:{screenshots:false,video:false,readPixels:false,finish:false,gpuTimestampQueries:false},host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,availableParallelism:availableParallelism(),memoryBytes:totalmem(),osRelease:release(),arch:process.arch,node:process.version},timing:[],pairedComparisons:[],baselineDiagnostics:[],correctness:[],errors:[]};
const save=()=>writeFileSync(resolve(out,'result.json'),JSON.stringify(report,null,2));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf'};
const server=createServer((req,res)=>{try{const u=new URL(req.url,origin);if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixtureHTML(origin,{single:u.searchParams.get('single')==='1'}));return;}if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}const file=resolve(root,decodeURIComponent(u.pathname).replace(/^\/suite-dev\//,''));if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch(error){res.writeHead(404);res.end(String(error));}});
let browser,live;
async function openSession({clients=1,enabled=false,seed=7,rollId,fixedClock=false,readback2D:readbackPolicy=readback2D}){
 const context=await browser.newContext({viewport:{width:report.viewport.width,height:report.viewport.height},deviceScaleFactor:1});
 await context.addInitScript(installSequenceContext,{enabled,seed,rollId,fixedClock,readback2D:fixedClock?readbackPolicy:'default'});
 const session={context,pages:[],sdk:[],overlays:[],errors:[],consoleErrors:[],consoleWarnings:[],ready:[],transport:[]};live=session;
 for(const name of ['Host','Player'].slice(0,clients)){
  const page=await context.newPage();session.pages.push(page);page.on('pageerror',error=>session.errors.push({client:name,error:String(error)}));page.on('console',message=>{if(message.type()==='error')session.consoleErrors.push({client:name,text:message.text()});if(fixedClock&&message.type()==='warning'&&/Canvas2D|readback|willReadFrequently/i.test(message.text()))session.consoleWarnings.push({client:name,text:message.text()});});
  await page.exposeBinding('sendRemote',async({page:sender},packet)=>{for(const other of session.pages)if(other!==sender){const queued=Date.now();setTimeout(()=>{session.transport.push({type:packet.data?.type,queuedAt:queued,deliveredAt:Date.now()});void other.evaluate(value=>window.deliver?.(value),packet).catch(error=>session.errors.push({transportError:String(error)}));},10);}});
  const began=Date.now();await page.goto(origin+'/fixture?name='+name+'&single='+(clients===1?'1':'0'));
  await page.waitForFunction(()=>document.querySelector('#background')?.contentWindow?.suiteHostProbe?.events.filter(e=>e.type==='state').at(-1)?.state.ready,null,{timeout:120000,polling:100});
  const sdk=page.frames().find(frame=>frame.url().includes('sdk-verify')),overlay=page.frames().find(frame=>frame.url().includes('/overlay.html'));assert(sdk&&overlay,'Real SDK/overlay frame missing');
  session.sdk.push(sdk);session.overlays.push(overlay);
  await overlay.waitForFunction(()=>window.__diceGroundMaskSequenceProbe&&window.__diceProfileRenderer?.ready,null,{timeout:120000,polling:100});
  const navigationStartedAt=await page.evaluate(()=>performance.timeOrigin),ready=await sdk.evaluate(()=>({state:window.suiteHostProbe.events.find(e=>e.type==='state'&&e.state.ready)?.observedAt,renderer:window.suiteHostProbe.events.find(e=>e.event==='renderer-ready')}));
  assert(Number.isFinite(ready.state),'Actual SDK ready observation missing');
  session.ready.push({name,coldNavigationToReadyMs:ready.state-navigationStartedAt,navigationStartedAt,readyObservedAt:ready.state,harnessPollCompletionMs:Date.now()-began,renderer:ready.renderer});
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
 return {rolls,frames:profile.frames,rendererEvents:profile.events.filter(event=>event.detail?.roll?.startsWith(id)),probe:window.__diceGroundMaskSequenceProbe.snapshot(),startupMask:profile.startupMask,faults:profile.events.filter(event=>['error','render-frame-retry','render-cancelled','render-unavailable'].includes(event.event)),activeCount:r.active.length};
 },rollId);}
async function timingLeg(scenario,round,mode){
 report.currentPhase={phase:'timing',scenario:scenario.id,round,mode,startedAt:Date.now()};save();
 const rollId='ground-sequence-'+scenario.id+'-r'+round,session=await openSession({...scenario,enabled:mode==='candidate',rollId});
 const submittedAt=await submit(session,scenario.expression,rollId,scenario.seed);
 for(const frame of session.sdk)await frame.waitForFunction(id=>window.__diceSequenceSubmitError||window.suiteHostProbe.events.some(e=>e.event==='render-complete'&&e.detail.roll===id),rollId,{timeout:180000,polling:100});
 for(const frame of session.sdk)await frame.waitForFunction(id=>window.suiteHostProbe.results.some(result=>result.data.rollId===id),rollId,{timeout:15000,polling:50});
 const row={scenario:scenario.id,round,mode,rollId,seed:scenario.seed,expression:scenario.expression,submittedAt,ready:session.ready,clients:[]};
 for(let index=0;index<session.sdk.length;index++){
  const data=await session.sdk[index].evaluate(id=>({events:window.suiteHostProbe.events.filter(e=>e.type==='log'&&(e.detail?.id===id||e.detail?.roll?.startsWith(id))),result:window.suiteHostProbe.results.find(result=>result.data.rollId===id)?.data,error:window.__diceSequenceSubmitError}),rollId);
  assert.equal(data.error,undefined,'Submission failed');assert(data.result,'Real result missing');
  const overlay=await collectOverlay(session.overlays[index],rollId),release=data.events.find(e=>e.event==='render-release'),complete=data.events.find(e=>e.event==='render-complete'&&e.detail.roll===rollId);
  assert(release&&complete,'Actual release/completion events missing');assert(overlay.rolls.length>0,'Authoritative trajectory missing');assert(!overlay.probe.requiresRendererRecreation,'Fatal Three interruption requires new renderer: '+overlay.probe.fatalReason);assert.deepEqual(overlay.faults,[],'Actual product renderer reported failure');assert.equal(overlay.activeCount,0,'Dice remain after real completion');assert(overlay.probe.records.every(record=>record.mode===(mode==='candidate'?'candidate':'baseline')),'Runtime mode changed within timing');
  assert(overlay.rolls.every(roll=>roll.fps===120&&roll.frames>1&&roll.poseBytes===roll.frames*roll.kinds.length*7*4),'Invalid real Jolt trace shape');
  for(const record of overlay.probe.records)record.fragmentCoverage=fragmentCoverage(record,report.viewport.width,report.viewport.height,report.viewport.dpr);
  const terminal=overlay.rendererEvents.filter(event=>event.event==='render-complete').at(-1);assert(terminal,'Product drawFrame completion missing');
  const finalFrame=overlay.frames.find(frame=>frame.at<=terminal.observedAt&&frame.finishedAt>=terminal.observedAt);assert(finalFrame,'Complete event not enclosed in a finished drawFrame');
  const timings={...summarizeFrames(overlay.frames,submittedAt,release.detail.actual,finalFrame.finishedAt),coldNavigationToReadyMs:session.ready[index].coldNavigationToReadyMs},retimes=overlay.rendererEvents.filter(event=>event.event==='render-retimed');
  row.clients.push({index,ready:session.ready[index],release:release.detail,completionObservedAt:complete.observedAt,productCompletionAt:terminal.observedAt,finalFrameSubmittedAt:finalFrame.finishedAt,retimes,result:data.result,rolls:overlay.rolls,probe:overlay.probe,startupMask:overlay.startupMask,renderPaths:{eligibleFrames:overlay.probe.eligibleFrames,fallbackFrames:overlay.probe.fallbackFrames},timings,events:data.events});
  assert.deepEqual(data.events.filter(e=>['error','render-frame-retry','render-cancelled','render-unavailable'].includes(e.event)),[],'Product render failed');
 }
 if(mode==='candidate')for(const client of row.clients){assert(client.probe.eligibleFrames>0,'Candidate never activated mask during timed playback');assert(client.startupMask.installed&&client.startupMask.compileCount>=1&&client.startupMask.shaderDrawCount>=1,'Candidate shader was not compiled/drawn by existing startup warm pass');}
 if(mode!=='candidate')for(const client of row.clients){assert.equal(client.probe.eligibleFrames,0,'Baseline unexpectedly used mask');assert.equal(client.probe.installed,false,'Baseline has a modified shader');}
 row.transport= session.transport;row.consoleErrors=session.consoleErrors;report.timing.push(row);save();await closeSession(session);
 console.log(JSON.stringify({phase:'timing',scenario:scenario.id,round,mode,clients:row.clients.map(client=>({wallMs:client.timings.releaseToCompletionMs,p95Ms:client.timings.frameIntervalP95Ms,wholeJsMs:client.timings.wholeJsTotalMs,coldReadyMs:client.timings.coldNavigationToReadyMs,firstFrameMs:client.timings.firstSubmittedFrameMs,maxMs:client.timings.frameIntervalMaxMs,eligibleFrames:client.probe.eligibleFrames,retimes:client.retimes.length}))}));return row;
}
function preserveImages(prefix,row){for(const image of row.images||[]){
 const filename=prefix+'-'+image.name+'.png';
 if(image.rgbaBase64){const rgba=Buffer.from(image.rgbaBase64,'base64');writeFileSync(resolve(out,filename),encodeRgbaPng({width:image.width,height:image.height,rgba}));image.rawRgbaSha256=createHash('sha256').update(rgba).digest('hex');delete image.rgbaBase64;}
 else{assert(image.png.startsWith('data:image/png;base64,'));writeFileSync(resolve(out,filename),Buffer.from(image.png.split(',')[1],'base64'));delete image.png;}
 image.file=filename;
}}
async function correctnessStep(session,params,{allowMismatch=false,target=report.correctness}={}){
 const row=await session.overlays[0].evaluate(params=>window.__diceSequenceCorrectness.run(params),params);
 preserveImages((target===report.correctness?'correctness-':'baseline-diagnostic-')+target.length+'-'+params.name,row);target.push(row);save();
 assert(row.logicalInputsSame,'Logical draw inputs changed within strict pair: '+params.name);
 if(!allowMismatch)assert(row.pass,'Strict RGBA comparison failed: '+params.name+' '+JSON.stringify({webgl:row.rgba,layers:row.layers.filter(layer=>!layer.exact)}));return row;
}
async function calibrateClampReadback(){
 report.currentPhase={phase:'readback-calibration',startedAt:Date.now()};save();
 const id='ground-mask-calibration-clamp2',session=await openSession({clients:1,enabled:false,seed:2,rollId:id,fixedClock:true});
 await submit(session,'max(2d6,6)',id,2);await waitActive(session,id);await session.overlays[0].evaluate(installCorrectnessHarness);
 const plan=await session.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),id);assert(plan.clamps.length>0,'Readback calibration needs actual clamp');
 const episode=plan.clamps[0];
 // First output is retained. This is ORIGINAL→ORIGINAL, in its own fresh context.
 const row=await correctnessStep(session,{name:'frequent-hint-original-first-calibration',id,age:(episode.start+episode.end)/2,originalOnly:true,capture:true},{target:report.baselineDiagnostics});
 assert(row.layers.every(layer=>layer.contextAttributes?.willReadFrequently===true),'Readback hint not applied at first 2D context creation');assert.equal(row.statsAfter.installed,false,'Calibration baseline has modified shader');
 report.readbackCalibration={firstOutputRetained:true,originalToOriginalExact:row.pass,policy:'willReadFrequently:true on cue-canvas and research-effects only, correctness only',defaultOriginalInstability:'Previously verified 19 RGB one-byte first-read differences; no tolerance adopted',backendSwitchProven:false};
 await closeSession(session);
}
async function correctness(){
 report.currentPhase={phase:'strict-correctness',startedAt:Date.now()};save();
 const id='ground-sequence-correct-20d6',session=await openSession({clients:1,enabled:true,seed:7,rollId:id,fixedClock:true});
 await submit(session,'20d6',id,7);await waitActive(session,id);await session.overlays[0].evaluate(installCorrectnessHarness);
 const plan=await session.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),id);assert.equal(plan.physicalCount,20);assert.equal(plan.fps,120);
 const age=plan.settled+.12;
 // No warmup: retain and compare the FIRST candidate output at each real moving pose.
 for(const [index,at] of [0,.08,.3,Math.max(.31,plan.settled-.1),age].entries())await correctnessStep(session,{name:'moving-and-settled-pose-'+index,id,age:at,capture:index===2||index===4});
 const positive=report.correctness.at(-1);assert(positive.statsAfter.eligibleFrames>positive.statsBefore.eligibleFrames,'20d6 positive control never exercised mask');
 const witness=await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.depthWitness());preserveImages('depth-witness',witness);report.correctness.push(witness);save();assert(witness.pass,'Depth witness failed or negative control not visible');
 const mutations=['body-position','body-presence','hidden-parent','body-cast-shadow','body-layer','camera-world','camera-projection','camera-layer','scene-world','light-position','light-target','light-intensity','shadow-intensity','shadow-bias','shadow-normal-bias','shadow-radius','shadow-resolution','shadow-frame-extents','shadow-viewport','shadow-map-dispose','ground-opacity','ground-position','viewport','dpr','same-size-canvas','clear'];
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
 const beforeLoss=report.correctness.at(-1);assert(beforeLoss.statsAfter.lastRecord.masked,'Normal context-loss test must begin with active mask');
 // True extension-driven generation loss; product listeners compile and resume.
 await session.overlays[0].evaluate(()=>{const gl=window.__diceProfileRenderer.gl.getContext(),extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('Required WEBGL_lose_context extension missing');window.__diceSequenceLoseContext=extension;extension.loseContext();});
 await session.overlays[0].waitForFunction(()=>window.__diceProfileRenderer.contextLost,null,{timeout:10000});
 await session.overlays[0].evaluate(()=>window.__diceSequenceLoseContext.restoreContext());
 await session.overlays[0].waitForFunction(()=>window.__diceSequenceProfile.events.some(event=>event.event==='render-context-restored'),null,{timeout:120000,polling:100});
 for(let i=0;i<5;i++)await correctnessStep(session,{name:'context-restored-'+i,id,age,capture:i===4});
 const afterRestore=report.correctness.at(-1);assert(afterRestore.statsAfter.lastRecord.masked,'Normal context restoration never re-enabled mask');assert(afterRestore.statsAfter.contextGeneration>positive.statsAfter.contextGeneration,'Runtime did not observe actual context generation');
 if(plan.firstReveal)await correctnessStep(session,{name:'result-cue-gathering',id,age:(plan.firstBeam+plan.firstReveal)/2,capture:true});
 const empty=await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.end());preserveImages('correctness-final-empty',empty);report.correctness.push(empty);save();assert(empty.pass,'Final empty frame retained pixels');
 // New real roll in the SAME renderer after the previous exit.
 const nextId='ground-sequence-correct-next20d6';await submit(session,'20d6',nextId,7);await waitActive(session,nextId);
 const next=await session.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),nextId);
 for(let i=0;i<5;i++)await correctnessStep(session,{name:'new-roll-'+i,id:nextId,age:next.settled+.12});
 assert(report.correctness.at(-1).statsAfter.lastRecord.masked,'New real roll never exercised active mask');
 // Attribute version changes are irreversible trust invalidations even when bytes
 // are restored. Run these only AFTER the live-mask restore/new-roll checks.
 for(const mutation of ['ground-geometry-position','ground-geometry-normal','ground-geometry-index']){await session.overlays[0].evaluate(name=>window.__diceSequenceCorrectness.mutate(name),mutation);await correctnessStep(session,{name:mutation+'-first',id:nextId,age:next.settled+.12});for(let i=0;i<3;i++)await correctnessStep(session,{name:mutation+'-stable-'+i,id:nextId,age:next.settled+.12});await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.mutate('none'));await correctnessStep(session,{name:mutation+'-restored-original-fallback',id:nextId,age:next.settled+.12});}
 const secondEmpty=await session.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.end());preserveImages('correctness-second-empty',secondEmpty);report.correctness.push(secondEmpty);save();assert(secondEmpty.pass);
 await closeSession(session);
 // Actual seed-2 clamp, not an invented mesh or a synthetic onFrame substitute.
 const clampId='ground-sequence-correct-clamp2',clamp=await openSession({clients:1,enabled:true,seed:2,rollId:clampId,fixedClock:true});
 await submit(clamp,'max(2d6,6)',clampId,2);await waitActive(clamp,clampId);await clamp.overlays[0].evaluate(installCorrectnessHarness);
 const clampPlan=await clamp.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),clampId);assert(clampPlan.clamps.length>0,'Seed 2 did not produce true Jolt clamp episode');
 for(const [index,episode] of clampPlan.clamps.entries()){
  const row=await correctnessStep(clamp,{name:'actual-seed2-clamp-'+index,id:clampId,age:(episode.start+episode.end)/2,capture:true});
  assert(row.unknownVisibleDrawables.length>0,'Actual clamp step failed to expose visible 3D FX/depth masks');assert.equal(row.statsAfter.eligibleFrames,row.statsBefore.eligibleFrames,'Visible real clamp FX must use original fallback');assert.equal(row.statsAfter.lastRecord.masked,false,'Real clamp must disable mask');assert(row.statsAfter.lastRecord?.reason,'Clamp fallback has no recorded reason');
 }
 const clampEmpty=await clamp.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.end());preserveImages('correctness-clamp-empty',clampEmpty);report.correctness.push(clampEmpty);save();assert(clampEmpty.pass);await closeSession(clamp);
 // The normal request path accepts up to 100 physical dice. Capacity is fixed at 64.
 const capId='ground-mask-correct-capacity65',capacity=await openSession({clients:1,enabled:true,seed:7,rollId:capId,fixedClock:true});
 await submit(capacity,'65d6',capId,7);await waitActive(capacity,capId);await capacity.overlays[0].evaluate(installCorrectnessHarness);
 const capPlan=await capacity.overlays[0].evaluate(id=>window.__diceSequenceCorrectness.getPlan(id),capId);assert.equal(capPlan.physicalCount,65,'Capacity case did not create 65 actual Jolt bodies');
 const capRow=await correctnessStep(capacity,{name:'capacity-65-original-fallback',id:capId,age:capPlan.settled+.12,capture:true});
 assert.equal(capRow.statsAfter.eligibleFrames,capRow.statsBefore.eligibleFrames,'Rectangle overflow was masked');assert.equal(capRow.statsAfter.lastRecord.reason,'rectangle-capacity','High-count fallback was not the cap guard');assert.equal(capRow.statsAfter.lastRecord.masked,false,'Overflow must disable mask');assert.equal(capRow.statsAfter.lastRecord.valid,false,'Overflow must run complete original formula');assert(['original-material','branch-disabled-original-formula'].includes(capRow.statsAfter.lastRecord.fallbackKind),'Overflow fallback kind missing');
 const capEmpty=await capacity.overlays[0].evaluate(()=>window.__diceSequenceCorrectness.end());preserveImages('capacity-empty',capEmpty);report.correctness.push(capEmpty);save();assert(capEmpty.pass);await closeSession(capacity);

}
try{
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding',...(report.softwareGPURequested?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
 report.browser=await browser.version();
 const scenarios=[{id:'single-20d6',clients:1,expression:'20d6',seed:7},{id:'two-client-20d6',clients:2,expression:'20d6',seed:7},{id:'single-control',clients:1,expression:'1d20',seed:7}];
 for(let round=0;round<rounds;round++)for(const scenario of scenarios){const legs=[];for(const mode of ['baseline-before','candidate','baseline-after'])legs.push(await timingLeg(scenario,round,mode));assertSameAuthority(legs);report.pairedComparisons.push({scenario:scenario.id,round,clients:summarizeAba(legs)});save();}
 await calibrateClampReadback();await correctness();report.success=true;const comparisons=report.pairedComparisons.flatMap(row=>row.clients);report.summary={timingLegs:report.timing.length,strictSteps:report.correctness.length,fullSuiteCompleted:true,allExactExceptRequiredNegative:report.correctness.every(row=>row.pass),drawCallsUnchangedAtMatchedPoses:report.correctness.filter(row=>row.drawCalls).every(row=>row.drawCalls.candidate===row.drawCalls.original),observedDecision:comparisons.every(row=>row.observedDecision==='exploratory-benefit-not-production-acceptance')?'exploratory-benefit-requires-independent-review':'reject',oneExploratoryRoundComplete:true,furtherRoundsAuthorized:false,productionAccepted:false};save();console.log(JSON.stringify(report.summary));

}catch(error){report.summary={observedDecision:'reject',productionAccepted:false,furtherRoundsAuthorized:false};report.failedAt=new Date().toISOString();report.failedPhaseElapsedMs=report.currentPhase?Date.now()-report.currentPhase.startedAt:null;report.error=String(error.stack||error);if(live){report.errors.push(...live.errors);report.failureContext={consoleErrors:live.consoleErrors,overlayDiagnostics:await Promise.all(live.overlays.map(frame=>frame.evaluate(()=>({probe:window.__diceGroundMaskSequenceProbe?.snapshot(),events:window.__diceSequenceProfile?.events,frames:window.__diceSequenceProfile?.frames})).catch(error=>({error:String(error)})))),diagnostics:await Promise.all(live.pages.map(page=>page.evaluate(()=>({fixture:window.fixture,frames:[...document.querySelectorAll('iframe')].map(frame=>({url:frame.src,events:frame.contentWindow?.suiteHostProbe?.events?.slice(-50)}))})).catch(error=>({error:String(error)}))))};}save();throw error;}
finally{if(live)await live.context.close();if(browser)await browser.close();if(server.listening)await new Promise(done=>server.close(done));}
