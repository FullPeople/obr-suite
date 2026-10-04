// Pure reporting and acceptance checks: never imply presentation/GPU timing.
import assert from 'node:assert/strict';
export function percentile(values,p){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];}
export function summarizeFrames(frames,submittedAt,releaseAt,completeAt){
 const included=frames.filter(f=>f.finishedAt>=releaseAt&&f.at<=completeAt),intervals=included.slice(1).map((f,i)=>(f.rafAt??f.at)-(included[i].rafAt??included[i].at));
 assert(included.length>0,'No actual drawFrame submissions in the release/completion window');
 const costs=key=>{const values=included.map(f=>f[key]).filter(Number.isFinite);return {samples:values.length,totalMs:values.reduce((a,b)=>a+b,0),p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:values.length?Math.max(...values):null};};
 return {cpuBounds:costs('boundsMs'),cpuRenderSubmission:costs('renderMs'),submittedFrameCount:included.length,firstSubmittedFrameMs:included[0].finishedAt-submittedAt,releaseToFirstSubmittedMs:included[0].finishedAt-releaseAt,submissionToCompletionMs:completeAt-submittedAt,releaseToCompletionMs:completeAt-releaseAt,wholeJsTotalMs:included.reduce((sum,f)=>sum+f.wholeJsMs,0),wholeJsP50Ms:percentile(included.map(f=>f.wholeJsMs),.5),wholeJsP95Ms:percentile(included.map(f=>f.wholeJsMs),.95),wholeJsMaxMs:Math.max(...included.map(f=>f.wholeJsMs)),frameIntervalP50Ms:percentile(intervals,.5),frameIntervalP95Ms:percentile(intervals,.95),frameIntervalMaxMs:intervals.length?Math.max(...intervals):null,frames:included};
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
 assert.deepEqual(legs.map(leg=>leg.mode),['baseline-before','candidate','baseline-after']);
 return legs[1].clients.map((client,index)=>{const before=legs[0].clients[index],after=legs[2].clients[index],metrics={};
  const keys=['coldNavigationToReadyMs','firstSubmittedFrameMs','releaseToFirstSubmittedMs','releaseToCompletionMs','submissionToCompletionMs','wholeJsTotalMs','wholeJsP50Ms','wholeJsP95Ms','wholeJsMaxMs','frameIntervalP50Ms','frameIntervalP95Ms','frameIntervalMaxMs'];
  for(const key of keys){const a=before.timings[key],b=client.timings[key],c=after.timings[key];assert([a,b,c].every(Number.isFinite),'Missing finite timing '+key);const bracket=(a+c)/2;metrics[key]={before:a,candidate:b,after:c,baselineBracketMean:bracket,candidateMinusBracket:b-bracket,ratioToBracket:bracket?b/bracket:null};}
  const hardGuards=['coldNavigationToReadyMs','firstSubmittedFrameMs','releaseToFirstSubmittedMs','frameIntervalMaxMs'];
  const regressions=hardGuards.filter(key=>metrics[key].candidateMinusBracket>0);
  const jsMax=metrics.wholeJsMaxMs,newJsDriverLongBlock=jsMax.candidate>50&&jsMax.candidate>jsMax.before&&jsMax.candidate>jsMax.after;
  if(newJsDriverLongBlock)regressions.push('newJsDriverLongBlock');
  const controlOnly=legs[1].scenario==='single-control';
  const controlP95Regression=controlOnly&&metrics.frameIntervalP95Ms.candidate>Math.max(metrics.frameIntervalP95Ms.before,metrics.frameIntervalP95Ms.after);
  if(controlP95Regression)regressions.push('singleControlP95AboveBothBaselines');
  const netBenefit=metrics.releaseToCompletionMs.candidateMinusBracket<0&&metrics.frameIntervalP95Ms.candidateMinusBracket<0;
  const cpuCostReview={wholeJsTotalDeltaMs:metrics.wholeJsTotalMs.candidateMinusBracket,wholeJsMaxDeltaMs:jsMax.candidateMinusBracket,required:metrics.wholeJsTotalMs.candidateMinusBracket>0||jsMax.candidateMinusBracket>0,note:'Additional CPU/driver submission work is a reported cost requiring review; smoother playback may submit more frames. This is not a whole-system energy or GPU-cost measurement.'};
  return {client:index,metrics,regressions,netBenefit,controlOnly,benefitRequired:!controlOnly,controlP95Regression,newJsDriverLongBlock,cpuCostReview,criteria:{control:'single-control does not require benefit; reject P95 above BOTH bracketing baselines in addition to all existing hard guards',netBenefit:'releaseToCompletionMs and frameIntervalP95Ms each strictly below A/B/A baseline bracket mean',hardGuards,newJsDriverLongBlock:'candidate wholeJsMaxMs > 50 and strictly greater than BOTH baseline wholeJsMaxMs values',firstFrameBoundary:'CPU submission return, not first visible display presentation',jsBlockBoundary:'Observed drawFrame JS/driver submission duration, not a browser LongTask entry'},observedDecision:regressions.length?'reject-observed-cold-first-or-max-regression':controlOnly?'control-within-predeclared-guards-not-stability-proof':!netBenefit?'reject-no-net-benefit':'exploratory-benefit-not-production-acceptance',eligibleFrames:client.probe.eligibleFrames,fallbackFrames:client.probe.fallbackFrames,retimeCount:client.retimes.length,drawCallValues:[...new Set(client.timings.frames.map(frame=>frame.drawCalls))],acceptance:'Predeclared for one exploratory A/B/A: reject cold-ready, first CPU-submission or actual rAF MAX regression versus bracket mean, or newly observed JS/driver blocking >50ms and greater than both baseline JS maxima. For the 20-dice targets require real release-to-completion wall time and rAF P95 improvements; the single-die control requires no extra benefit and cannot exceed both baseline P95 values. Report CPU total/MAX increases separately for review; no display-presentation, GPU-execution or energy claim.'};
 });
}

/** CPU postprocessing AFTER timing. Exact union area of conservative rectangles,
 * not a measured GPU fragment invocation count or per-sample MSAA work estimate. */
export function fragmentCoverage(record,width=1280,height=800,dpr=1){
 const r=record.mainRegion,clip=r?[r.x*dpr,r.y*dpr,(r.x+r.width)*dpr,(r.y+r.height)*dpr]:[0,0,width*dpr,height*dpr],area=Math.max(0,clip[2]-clip[0])*Math.max(0,clip[3]-clip[1]);
 const active=record.eligible&&record.enabled&&!record.originalMaterial;
 const rects=active?(record.physicalRects||[]).map(q=>[Math.max(q[0],clip[0]),Math.max(q[1],clip[1]),Math.min(q[2],clip[2]),Math.min(q[3],clip[3])]).filter(q=>q[2]>q[0]&&q[3]>q[1]):[clip];
 const xs=[...new Set(rects.flatMap(q=>[q[0],q[2]]))].sort((a,b)=>a-b);let union=0;
 for(let i=1;i<xs.length;i++){const spans=rects.filter(q=>q[0]<xs[i]&&q[2]>xs[i-1]).map(q=>[q[1],q[3]]).sort((a,b)=>a[0]-b[0]);let length=0,end=-Infinity;for(const [low,high] of spans){length+=Math.max(0,high-Math.max(low,end));end=Math.max(end,high);}union+=(xs[i]-xs[i-1])*length;}
 return {estimatedScissoredReceiverPixels:area,estimatedPCFBoundingPixels:union,estimatedPCFBoundingCoverage:area?union/area:null,estimatedEarlyAlphaZeroPixels:Math.max(0,area-union),measurement:'Post-timing conservative rectangle union only; not GPU invocation or MSAA sample counts'};
}
