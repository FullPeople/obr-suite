// Offline harness tests only. No browser launch or GPU equivalence claim.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sourceEvidence,probePlugin,once,SAFE_SUITE,SAFE_WEB} from './dice-ground-sequence-build.mjs';
import {fixtureHTML,installSequenceFixture,installSequenceContext} from './dice-ground-sequence-fixture.mjs';
import {inflateSync} from 'node:zlib';
import {encodeRgbaPng} from './dice-ground-sequence-pixels.mjs';
import {compareBytes,summarizeFrames,assertSameAuthority} from './dice-ground-sequence-metrics.mjs';
const root=resolve('.'),plugin=probePlugin(root);
for(const file of ['extensions/workbench-dice3d/src/controller.ts','src/workbench/dice3d.ts','src/workbench/dice3d-verify.ts','extensions/workbench-dice3d/src/renderer.ts']){
 const original=readFileSync(file,'utf8'),output=plugin.transform(original,resolve(file));assert(output&&output!==original,'Missing in-memory instrumentation: '+file);
 assert.throws(()=>plugin.transform(output,resolve(file)),/Probe boundary changed/,'Repeated transforms must not silently double-instrument');
}
assert.throws(()=>once('a a','a','b'),/Probe boundary changed/);assert.throws(()=>once('a','z','b'),/Probe boundary changed/);
const renderer=plugin.transform(readFileSync('extensions/workbench-dice3d/src/renderer.ts','utf8'),resolve('extensions/workbench-dice3d/src/renderer.ts'));
assert(renderer.indexOf('const trustedSketch')<renderer.indexOf('for(const m of warm){disposeDiceDecorations'));
assert(renderer.includes('verified-baseline-build:'+SAFE_SUITE));assert(renderer.includes('rendererRender:this.gl.render'));
assert(renderer.includes('trustedSketch.map(m=>({onBeforeCompile:m.material.onBeforeCompile'));
assert(!renderer.includes('geometries:this.active'),'Trust must never be inferred from arbitrary live objects');
assert.equal(SAFE_WEB,'05dcfdb645339cac9f68d1f6009f44b7e63d5c25');
const html=fixtureHTML('http://127.0.0.1:5242',{single:true});assert(html.includes('single=true'));assert(html.includes("frame('extensions/workbench-dice3d/sdk-verify.html'"));assert(html.includes("'com.obr-suite/dice/3d-theme':'ink_sketch'"));assert(!html.includes('physics-stub'));
let pixels=compareBytes([1,2,3,4,5,6,7,8],[1,2,3,4,5,6,7,8],2);assert.equal(pixels.exact,true);
pixels=compareBytes([1,2,3,4,5,6,7,8],[1,2,3,5,5,5,7,8],2);assert.equal(pixels.exact,false);assert.equal(pixels.differentChannels,2);assert.equal(pixels.differentPixels,2);assert.equal(pixels.maxDelta,1);assert.deepEqual(pixels.perChannel,[0,1,0,1]);assert.throws(()=>compareBytes([1],[1,2],2));
const frames=[{at:95,finishedAt:105,wholeJsMs:10},{at:110,finishedAt:115,wholeJsMs:5},{at:120,finishedAt:125,wholeJsMs:5}];
const summary=summarizeFrames(frames,90,100,125);assert.equal(summary.wholeJsTotalMs,20);assert.equal(summary.firstSubmittedFrameMs,15);assert.equal(summary.releaseToCompletionMs,25);assert.equal(summary.wholeJsMaxMs,10);
assert.throws(()=>summarizeFrames([],0,1,2),/No actual/);
const roll={requestId:'x',seed:7,poseSha256:'abc',poseBytes:84,kinds:['d6'],results:[2],fps:120,frames:3,duration:1,births:null,clamps:[],schedule:{diceExit:3}};
assertSameAuthority([{clients:[{rolls:[roll]}]},{clients:[{rolls:[{...roll,physicsMs:1000}]}]}]);
assert.throws(()=>assertSameAuthority([{clients:[{rolls:[roll]}]},{clients:[{rolls:[{...roll,poseSha256:'changed'}]}]}]),/Authoritative/);
assert.throws(()=>assertSameAuthority([{clients:[{rolls:[roll]}]},{clients:[{rolls:[{...roll,schedule:{diceExit:4}}]}]}]),/Authoritative/);
const fixture=readFileSync('tools/dice-ground-sequence-fixture.mjs','utf8');
for(const banned of ['.readPixels(','.finish(','.getQueryParameter(','.toDataURL(','setAlphaGain('])assert(!fixture.includes(banned),'Timing fixture contains readback/query/capture: '+banned);
const browser=readFileSync('tools/dice-ground-sequence-browser.mjs','utf8');assert(browser.includes("assert.equal(process.env.CI,'true'"));assert(!browser.includes('.screenshot('));assert(!browser.includes('recordVideo:'));
assert(browser.includes("['baseline-before','cache','baseline-after']"));assert(browser.includes('DICE_GROUND_SEQUENCE_ROUNDS||1'));assert(browser.includes('DICE_GROUND_SEQUENCE_MIN_BODIES||20'));
const correctness=readFileSync('tools/dice-ground-sequence-correctness.mjs','utf8');assert(correctness.indexOf('const before=compact();if(originalOnly)')<correctness.indexOf('let reference,referenceInputs;p.withOriginal(()=>{draw();reference=read();'));assert(correctness.includes('exact:differentChannels===0'));assert(!correctness.includes('maxDelta<='));
const raw=Buffer.from([20,33,43,78,20,33,42,78,255,0,128,1,0,0,0,0]),png=encodeRgbaPng({width:2,height:2,rgba:raw});
assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);let offset=8;const chunks=[];while(offset<png.length){const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);chunks.push({type,data:png.subarray(offset+8,offset+8+length)});offset+=length+12;}
assert.deepEqual(chunks.map(chunk=>chunk.type),['IHDR','IDAT','IEND']);assert.equal(chunks[0].data[9],6);const decoded=inflateSync(chunks[1].data);assert.deepEqual(Buffer.concat([decoded.subarray(1,9),decoded.subarray(10,18)]),raw,'Evidence PNG changed translucent RGB by even one byte');assert.throws(()=>encodeRgbaPng({width:2,height:2,rgba:[0]}),/RGBA length/);
assert(browser.includes("mode==='clamp-diagnostic'"));assert(browser.includes('for(let pair=0;pair<3;pair++)'));assert(browser.includes('assert(report.baselineDiagnostics.every(row=>row.pass)'));assert(correctness.includes('rgbaBase64:base64(layer.rgba)'));assert(correctness.includes('record.logicalInputsSame'));
const priorCanvas=globalThis.HTMLCanvasElement,priorConfig=globalThis.__diceSequenceConfig,priorSeed=globalThis.__diceSequenceSeed,priorId=globalThis.__diceSequenceRollId;
try{
 const calls=[];class Canvas{constructor(className){this.classList={contains:name=>name===className};}getContext(...args){calls.push(args);return {args};}}globalThis.HTMLCanvasElement=Canvas;const native=Canvas.prototype.getContext;
 installSequenceContext({fixedClock:false,readback2D:'frequent',seed:7});assert.equal(Canvas.prototype.getContext,native,'Timing must not install any Canvas2D readback override');
 installSequenceContext({fixedClock:true,readback2D:'default',seed:7});assert.equal(Canvas.prototype.getContext,native,'Default correctness context must retain normal Canvas2D creation');
 installSequenceContext({fixedClock:true,readback2D:'frequent',seed:7});new Canvas('research-effects').getContext('2d',{alpha:true});assert.deepEqual(calls.at(-1),['2d',{alpha:true,willReadFrequently:true}]);new Canvas('glyph-mask').getContext('2d');assert.deepEqual(calls.at(-1),['2d']);new Canvas('cue-canvas').getContext('webgl2',{alpha:true});assert.deepEqual(calls.at(-1),['webgl2',{alpha:true}]);
}finally{globalThis.HTMLCanvasElement=priorCanvas;globalThis.__diceSequenceConfig=priorConfig;globalThis.__diceSequenceSeed=priorSeed;globalThis.__diceSequenceRollId=priorId;}
const savedGlobals={config:globalThis.__diceSequenceConfig,renderer:globalThis.__diceProfileRenderer,three:globalThis.__diceProfileThree,profile:globalThis.__diceSequenceProfile,probe:globalThis.__diceGroundLiveProbe};
try{
 globalThis.__diceSequenceConfig={enabled:true,minBodies:20,stableFrames:3};let emitted=0,drew=0,receivedTrust;
 const probe={stats:{frames:0}},r={active:[],gl:{info:{render:{calls:9,triangles:30}}},emit(){emitted++;},add(roll,start){this.active.push({roll,start,cue:{diceExit:3},births:[0]});return 42;},drawFrame(){drew++;probe.stats.frames++;},wake(){}};
 installSequenceFixture(r,{REVISION:'186'},options=>{receivedTrust=options;return probe;},{source:'known-factory'});
 assert.equal(receivedTrust.enabled,true);assert.equal(receivedTrust.minBodies,20);assert.equal(receivedTrust.trust.source,'known-factory');
 r.emit('render-ready',{});assert.equal(emitted,1);assert.equal(globalThis.__diceSequenceProfile.events.length,1);
 assert.equal(r.add({request:{id:'real'}},12),42);assert.equal(globalThis.__diceSequenceProfile.rolls.length,1);r.drawFrame();assert.equal(drew,1);assert.equal(globalThis.__diceSequenceProfile.frames.length,1);assert.equal(globalThis.__diceSequenceProfile.frames[0].probeFrame,1);
 assert.throws(()=>installSequenceFixture(r,{REVISION:'185'},()=>probe,{}),/requires Three r186/);
}finally{globalThis.__diceSequenceConfig=savedGlobals.config;globalThis.__diceProfileRenderer=savedGlobals.renderer;globalThis.__diceProfileThree=savedGlobals.three;globalThis.__diceSequenceProfile=savedGlobals.profile;globalThis.__diceGroundLiveProbe=savedGlobals.probe;}
if(process.env.DND_CARD_WEB_ROOT){const evidence=sourceEvidence(root,resolve(process.env.DND_CARD_WEB_ROOT));assert.deepEqual(evidence.productChanges,[]);assert(evidence.productFileCount>50);console.log(JSON.stringify({sourceGuard:'PASS',productFiles:evidence.productFileCount,productTreeSha256:evidence.productTreeSha256}));}
console.log('ground-sequence harness: PASS (offline boundaries, source trust, strict RGBA, A/B/A authority, inclusive timing; no browser/GPU run)');
