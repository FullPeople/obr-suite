// Pure reporting and acceptance checks: never imply presentation/GPU timing.
import assert from 'node:assert/strict';
export function percentile(values,p){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];}
export function summarizeFrames(frames,submittedAt,releaseAt,completeAt){
 const included=frames.filter(f=>f.finishedAt>=releaseAt&&f.at<=completeAt),intervals=included.slice(1).map((f,i)=>f.at-included[i].at);
 assert(included.length>0,'No actual drawFrame submissions in the release/completion window');
 return {submittedFrameCount:included.length,firstSubmittedFrameMs:included[0].finishedAt-submittedAt,releaseToFirstSubmittedMs:included[0].finishedAt-releaseAt,submissionToCompletionMs:completeAt-submittedAt,releaseToCompletionMs:completeAt-releaseAt,wholeJsTotalMs:included.reduce((sum,f)=>sum+f.wholeJsMs,0),wholeJsP50Ms:percentile(included.map(f=>f.wholeJsMs),.5),wholeJsP95Ms:percentile(included.map(f=>f.wholeJsMs),.95),wholeJsMaxMs:Math.max(...included.map(f=>f.wholeJsMs)),frameIntervalP50Ms:percentile(intervals,.5),frameIntervalP95Ms:percentile(intervals,.95),frameIntervalMaxMs:intervals.length?Math.max(...intervals):null,frames:included};
}
export function authoritativeProjection(roll){return {requestId:roll.requestId,seed:roll.seed,poseSha256:roll.poseSha256,poseBytes:roll.poseBytes,kinds:roll.kinds,results:roll.results,fps:roll.fps,frames:roll.frames,duration:roll.duration,births:roll.births,clamps:roll.clamps,schedule:roll.schedule};}
export function assertSameAuthority(cases){
 const reference=cases[0].clients[0].rolls.map(authoritativeProjection);
 for(const leg of cases)for(const client of leg.clients)assert.deepEqual(client.rolls.map(authoritativeProjection),reference,'Authoritative poses/results or relative presentation schedules changed between A/B/A or clients');
 return true;
}
export function compareBytes(before,after,width){
 assert.equal(before.length,after.length,'Pixel buffer lengths changed');
 let differentChannels=0,differentPixels=0,maxDelta=0;const perChannel=[0,0,0,0],firstDifferences=[];
 for(let i=0;i<before.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(before[i+c]-after[i+c]);if(delta){changed=true;differentChannels++;perChannel[c]++;maxDelta=Math.max(maxDelta,delta);}}if(changed){differentPixels++;if(firstDifferences.length<8)firstDifferences.push({x:(i/4)%width,y:Math.floor(i/4/width),candidate:Array.from(before.slice(i,i+4)),original:Array.from(after.slice(i,i+4))});}}
 return {exact:differentChannels===0,differentChannels,differentPixels,maxDelta,perChannel,firstDifferences};
}

export function summarizeAba(legs){
 assert.deepEqual(legs.map(leg=>leg.mode),['baseline-before','cache','baseline-after']);
 return legs[1].clients.map((client,index)=>{const before=legs[0].clients[index],after=legs[2].clients[index],metrics={};
  for(const key of ['releaseToCompletionMs','submissionToCompletionMs','wholeJsTotalMs','wholeJsP95Ms','wholeJsMaxMs','frameIntervalP95Ms','frameIntervalMaxMs']){const a=before.timings[key],b=client.timings[key],c=after.timings[key],bracket=(a+c)/2;metrics[key]={before:a,cache:b,after:c,baselineBracketMean:bracket,cacheMinusBracket:b-bracket,ratioToBracket:bracket?b/bracket:null};}
  const buildIds=new Set(client.probe.records.filter(record=>record.built).map(record=>record.frame));
  const buildFrames=client.timings.frames.filter(frame=>buildIds.has(frame.probeFrame));
  return {client:index,metrics,buildFrames,buildFrameWholeJsMaxMs:buildFrames.length?Math.max(...buildFrames.map(frame=>frame.wholeJsMs)):null,hits:client.probe.hits,builds:client.probe.builds,invalidations:client.probe.invalidations,retimeCount:client.retimes.length,peakResources:client.probe.resources,acceptance:'Descriptive paired comparison only; no speed threshold and no GPU execution/presentation claim'};
 });
}
