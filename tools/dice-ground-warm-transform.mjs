// Exact-source observation only. No GPU call, check, or render is removed/reordered.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const RUNTIME_SHA256='e0b93c4795bf547c24efd12721775a022ca0bd6086f57d52dac3fa762f65d033';
export const BROWSER_SHA256='58f1c619cb5f26ca74e6c0f9605a387cb72f9012e0b9fc5a30dfe2255ea2ae20';
export const sha=source=>createHash('sha256').update(source).digest('hex');
function once(source,from,to,label=from){assert.equal(source.split(from).length-1,1,'Warm probe boundary changed: '+label);return source.replace(from,to);}
export function instrumentGroundWarmRuntime(source){
 assert.equal(sha(source),RUNTIME_SHA256,'Live runtime source drift; refuse timing transform');
 source=once(source,"  function gpu(name,...args){const counts=stats.syncCalls[gpuPhase];counts[name]=(counts[name]||0)+1;return gl[name](...args);}",
 `  let warmBuild=null;
  stats.warmProfile={runtimeSourceSha256:${JSON.stringify(RUNTIME_SHA256)},observationOnly:true,addedGPUCalls:0,calls:[]};
  function warmSpan(name,callback){const began=performance.now();try{return callback();}finally{if(warmBuild)warmBuild.spans.push({name,startOffsetMs:began-warmBuild.began,cpuWallMs:performance.now()-began});}}
  function gpu(name,...args){const counts=stats.syncCalls[gpuPhase];counts[name]=(counts[name]||0)+1;const began=performance.now();let threw=false;try{return gl[name](...args);}catch(error){threw=true;throw error;}finally{const item={phase:gpuPhase,frame:stats.frames,name,args:args.map(value=>typeof value==='number'?('0x'+value.toString(16)):value),at:performance.timeOrigin+began,cpuWallMs:performance.now()-began,threw};stats.warmProfile.calls.push(item);if(warmBuild)warmBuild.queries.push({...item,startOffsetMs:began-warmBuild.began});}}
 `,'existing gpu helper');
 source=once(source,"gpuPhase='build';const buildBegan=performance.now();","gpuPhase='build';const buildBegan=performance.now();warmBuild=record.warmBuild={began:buildBegan,spans:[],queries:[]};");
 source=once(source,"check(p.shadow.map,'shadow map not yet populated');const s=state(true);","check(p.shadow.map,'shadow map not yet populated');const s=warmSpan('state(true)',()=>state(true));const warmAllocationBegan=performance.now();");
 source=once(source,"const began=performance.now();let good=false,restored=false;","warmBuild.spans.push({name:'resource-allocation-and-snapshots',startOffsetMs:warmAllocationBegan-warmBuild.began,cpuWallMs:performance.now()-warmAllocationBegan});\n    const began=performance.now();let good=false,restored=false;");
 source=once(source,"renderer.setRenderTarget(target);renderer.setScissorTest(false);","warmSpan('setRenderTarget(R32F)',()=>renderer.setRenderTarget(target));renderer.setScissorTest(false);");
 source=once(source,"renderer.clear(true,true,true);engineCall(originalRender,[scene,camera],'capture render');","warmSpan('capture clear',()=>renderer.clear(true,true,true));warmSpan('capture render',()=>engineCall(originalRender,[scene,camera],'capture render'));");
 source=once(source,"p.shadow.needsUpdate=shadowFlags[1];restore(s);","p.shadow.needsUpdate=shadowFlags[1];warmSpan('restore1-before-compile',()=>restore(s));");
 source=once(source,"engineCall(originalCompile,[scene,camera],'cache compile');","warmSpan('cache compile',()=>engineCall(originalCompile,[scene,camera],'cache compile'));");
 source=once(source,"try{try{restore(s);restored=true;}catch(error){good=false;try{restore(s);restored=true;}catch{}throw error;}}", "try{try{warmSpan('restore2-finally',()=>restore(s));restored=true;}catch(error){good=false;try{warmSpan('restore2-retry',()=>restore(s));restored=true;}catch{}throw error;}}");
 source=once(source,"record.buildTotalSubmitMs=performance.now()-buildBegan;gpuPhase='hit';","record.buildTotalSubmitMs=performance.now()-buildBegan;warmBuild.doneWallMs=record.buildTotalSubmitMs;gpuPhase='hit';");
 source=once(source,"}finally{gpuPhase='hit';busy=false;", "}finally{warmBuild=null;gpuPhase='hit';busy=false;");
 return source;
}

/** Derive the two-case observation runner from the immutable existing fixture. */
export function instrumentGroundWarmBrowser(source){
 assert.equal(sha(source),BROWSER_SHA256,'Sequence runner drift; refuse warm-profile reduction');
 source=once(source,"schema:'dice-ground-live-sequence.v1'", "schema:'dice-ground-cold-build-profile.v1'");
 source=once(source,"assert([1,2,3].includes(rounds),'Use one exploratory round, at most three repeated rounds');", "assert.equal(rounds,1,'Cold-build localization runs exactly one round');");
 source=once(source,"const scenarios=[{id:'single-20d6',clients:1,expression:'20d6',seed:7},{id:'two-client-20d6',clients:2,expression:'20d6',seed:7},{id:'single-control',clients:1,expression:'1d20',seed:7}];", "const scenarios=[{id:'single-20d6',clients:1,expression:'20d6',seed:7},{id:'two-client-20d6',clients:2,expression:'20d6',seed:7}];");
 source=once(source,"for(let round=0;round<rounds;round++)for(const scenario of scenarios){const legs=[];for(const mode of ['baseline-before','cache','baseline-after'])legs.push(await timingLeg(scenario,round,mode));assertSameAuthority(legs);report.pairedComparisons.push({scenario:scenario.id,round,clients:summarizeAba(legs)});save();}", "for(const scenario of scenarios){await timingLeg(scenario,0,'cache');save();}");
 source=once(source,"await correctness();report.success=true;report.summary={timingLegs:report.timing.length,strictSteps:report.correctness.length,allExactExceptRequiredNegative:report.correctness.every(row=>row.pass),speedThresholdApplied:false,cacheAcceptedForProduction:false};save();console.log(JSON.stringify(report.summary));", "report.success=true;report.summary={timingLegs:report.timing.length,strictPixelsNotRun:true,observationOnly:true,speedClaim:false,cacheAcceptedForProduction:false};save();console.log(JSON.stringify(report.summary));");
 return source;
}
