import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'.local-evidence/dice-tail-paired');
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const config=read('tools/dice-tail-paired-config.json');
const names=['cold-first-1d20','warm-1d6','warm-9d6','tail-drop-last-1d6'];
const phases=['baseline-before','candidate','baseline-after'].map(name=>({name,result:read(resolve(root,name,'result.json')),guard:read(resolve(root,name,'source-guard.json'))}));
const [before,candidate,after]=phases;
for(const phase of phases){
 const mode=phase===candidate?'candidate':'baseline';
 assert(phase.result.success&&phase.guard.success&&phase.guard.sourceMatchesFrozenPin&&phase.guard.allUnselectedProductionTreeUnchanged,phase.name+' source and browser guards');
 assert.equal(phase.result.tailSourceMode,mode);assert.equal(phase.guard.sourceMode,mode);assert.equal(phase.result.source.suite,phase.guard.diagnosticCommit);assert.equal(phase.result.source.web,config.pairedWeb);
 assert.equal(phase.guard.baseline,config.baseline);assert.equal(phase.guard.reviewedCandidateControllerSHA256,config.productChanges['extensions/workbench-dice3d/src/controller.ts'].candidateSHA256);assert.equal(phase.guard.configurationSHA256,before.guard.configurationSHA256);
 assert.deepEqual(phase.result.cases.map(c=>c.name),names,'exactly the four original cases');
 for(const key of ['viewport','theme','capture','submissionSeedsPerClient'])assert.deepEqual(phase.result[key],before.result[key],key+' identical across same-runner phases');
 assert(phase.result.realSDK&&phase.result.realPhysics&&!phase.result.realOwlbearRoom&&phase.result.capture.synchronousPixelReadback,'same real-engine synthetic-host capture');
 if(mode==='baseline')assert.equal(phase.result.source.suite,config.baseline);
}
const sourceFile=(phase,file)=>phase.guard.selectedFiles.find(f=>f.file===file)?.sha256;
for(const file of ['src/workbench/dice-send-queue.ts','src/workbench/dice-broadcast.ts','extensions/workbench-dice3d/src/wire.mjs','extensions/workbench-dice3d/src/physics.worker.ts','extensions/workbench-dice3d/src/renderer.ts','extensions/workbench-dice3d/src/overlay.ts']){
 assert.equal(sourceFile(candidate,file),sourceFile(before,file),'unmodified '+file);assert.equal(sourceFile(after,file),sourceFile(before,file));
}
const packetCount=c=>c.tail.timeline.filter(e=>e.client===c.tail.authority&&e.event==='send-dispatch'&&['offer','chunk','chunks-done','start'].includes(e.state.type)).length;
const rounded=value=>Number.isFinite(value)?Math.round(value*1000)/1000:value;
const cases=names.map((name,index)=>{
 const rolls=phases.map(p=>p.result.cases[index]),[a,b,a2]=rolls,normal=name!=='tail-drop-last-1d6';
 for(const row of rolls){assert(row.tail.preparedOnBothClients&&row.tail.validGenerationAndPermissions,'full readiness and origin validity checked');assert.equal(row.total,a.total,'fixed-seed result parity across A/B/A');}
 assert.equal(a.tail.promotedTailSlot,false);assert.equal(a2.tail.promotedTailSlot,false);assert.equal(b.tail.promotedTailSlot,normal,'candidate must exercise the intended branch');
 assert.equal(packetCount(a),packetCount(a2),'baseline trajectory/control packet counts stable');assert.equal(packetCount(b),packetCount(a)-(normal?1:0),'candidate saves exactly one existing control packet slot, with no added sends');
 if(!normal)for(const row of rolls){assert.equal(row.injections.lastChunk,1);assert(row.tail.missingTailRecovered,'actual missing tail recovered in every phase');}
 const signedMetrics=['waitZeroToStartDispatch','lastChunkACKToStartDispatch','startOperationQueue'];
 const controlDifferences=Object.fromEntries(signedMetrics.map(key=>{const av=a.tail.measuredMs[key],bv=b.tail.measuredMs[key],a2v=a2.tail.measuredMs[key];assert([av,bv,a2v].every(Number.isFinite),key+' finite');return[key,{baselineBeforeMs:rounded(av),candidateMs:rounded(bv),baselineAfterMs:rounded(a2v),candidateMinusBeforeMs:rounded(bv-av),candidateMinusAfterMs:rounded(bv-a2v),candidateMinusBaselineMidpointMs:rounded(bv-(av+a2v)/2)}]}));
 return{name,normalTailSlotPromotion:normal,expectedSavedControlPacketSlots:normal?1:0,unchangedPacingIntervalMs:100,actualTrajectoryControlPacketCounts:{before:packetCount(a),candidate:packetCount(b),after:packetCount(a2)},controlDifferences,phases:rolls.map((row,i)=>({phase:phases[i].name,rollId:row.rollId,waitZeroWhileUploading:row.tail.waitZeroWhileUploading,startOperation:row.tail.startOperation,measuredMs:row.tail.measuredMs,clientFrames:row.tail.clientFrames})),visibleReadbackIsNotAnAcceptanceMetric:true};
});
const report={success:true,order:phases.map(p=>p.name),baseline:config.baseline,reviewedCandidateControllerSHA256:config.productChanges['extensions/workbench-dice3d/src/controller.ts'].candidateSHA256,candidateDiagnosticCommit:candidate.result.source.suite,pairedWeb:config.pairedWeb,configurationSHA256:before.guard.configurationSHA256,sourceAndGuardParity:true,mechanismAcceptance:'Three real ready-at-tail-slot promotions each remove one actual control packet operation; missing-tail control retains trailer, NACK and repair. Shared pacing queue source is unchanged at 100 ms. Signed timing deltas are observations, not a deterministic speedup guarantee.',measurementLimits:'One sample per case per phase; A/B/A share the runner but use fresh identical browser contexts. Every phase uses the same synchronous readback instrumentation and real Jolt/WebGL with SwiftShader. Readback, frame scheduling and OS presentation are not latency acceptance metrics. SDK uses the original Promise with a synthetic local host ACK and 10 ms delivery; no real room/network/mobile performance claim.',host:candidate.result.host,browser:candidate.result.browser,viewport:candidate.result.viewport,renderer:candidate.result.cold.map(c=>c.renderer),cases};
writeFileSync(resolve(root,'comparison.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({success:true,cases:cases.map(c=>({name:c.name,normalTailSlotPromotion:c.normalTailSlotPromotion,packetCounts:c.actualTrajectoryControlPacketCounts,waitZeroToStartDispatch:c.controlDifferences.waitZeroToStartDispatch}))},null,2));
