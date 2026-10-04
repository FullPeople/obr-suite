// Pure analysis of the existing core browser fixture. No browser imports or execution.
export const CORE_SCENES=['card-quick-rpc','warm-single-0','warm-single-1','warm-single-2','twenty-dice'];
export const ORDER=['baseline-before','stage1','baseline-after'];
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??null;};
function requireValue(condition,message){if(!condition)throw Error(message);}
function metric(scene,client){
  const release=client.events.find(e=>e.event==='render-release'),complete=client.events.find(e=>e.event==='render-complete'&&e.detail.roll===scene.rollId);
  requireValue(Number.isFinite(release?.detail.actual)&&Number.isFinite(complete?.observedAt),scene.name+': actual release/completion missing');
  requireValue(client.frameSamples?.rAF?.length>1&&client.frameSamples?.renderSubmitted?.length>0,scene.name+': actual frame samples missing');
  const intervals=client.frameSamples.rAF.slice(1).map((at,index)=>at-client.frameSamples.rAF[index]);
  requireValue(intervals.every(value=>Number.isFinite(value)&&value>=0),scene.name+': invalid frame clock');
  const p50=percentile(intervals,.5),p95=percentile(intervals,.95),first=client.frameSamples.renderSubmitted[0]-scene.submittedAt;
  requireValue(p50===client.frameP50Ms&&p95===client.frameP95Ms&&first===client.firstSubmittedFrameMs,scene.name+': reported metrics differ from raw samples');
  return{firstSubmittedFrameMs:first,frameP50Ms:p50,frameP95Ms:p95,maxFrameMs:Math.max(...intervals),releaseCommandMs:release.detail.actual-scene.submittedAt,completionWallMs:complete.observedAt-release.detail.actual,endToEndMs:complete.observedAt-scene.submittedAt,retimeCount:client.events.filter(e=>e.event==='render-retimed').length,audioStartEvents:client.events.filter(e=>e.event==='audio-roll-start').length,frameIntervals:intervals.length,renderSubmissions:client.frameSamples.renderSubmitted.length};
}
function outcome(scene,client){return{rollId:scene.rollId,total:scene.total,result:{rollId:client.result?.rollId,expression:client.result?.expression,total:client.result?.total,dice:client.result?.dice,visibility:client.result?.visibility}};}
export function analyzeBracket(runs){
  requireValue(runs.length===3&&runs.every((run,index)=>run.condition===ORDER[index]),'Exactly one ordered baseline→stage1→baseline bracket is required');
  const first=runs[0].report,reference=new Map(),rows=[];
  for(const run of runs){const report=run.report;
    requireValue(report.success===true&&report.coreOnly===true,'Only successful core fixtures are comparable');
    requireValue(report.capture?.video===false&&report.capture?.screenshots===false,'Capture must be disabled');
    requireValue(report.realSDK===true&&report.realPhysics===true&&report.realOwlbearRoom===false,'Fixture scope changed');
    requireValue(report.softwareWebGLRequested===true&&report.deterministicParticleRollIds===true,'GPU/particle settings changed');
    for(const key of ['host','browser','viewport','submissionSeedsPerClient','virtualOneWayNetworkMs'])requireValue(JSON.stringify(report[key])===JSON.stringify(first[key]),'Same-runner fixture metadata changed: '+key);
    requireValue(report.source.web===first.source.web,'Paired Web source changed');
    requireValue(JSON.stringify(report.cases.map(scene=>scene.name))===JSON.stringify(CORE_SCENES),'Core scenario order changed');
    requireValue(report.errors.length===0,'Browser errors present');
    for(const scene of report.cases){requireValue(JSON.stringify(scene.clients.map(client=>client.index))==='[0,1]',scene.name+': both clients must be retained');for(const client of scene.clients){const key=scene.name+':'+client.index,signature=JSON.stringify(outcome(scene,client));if(reference.has(key))requireValue(signature===reference.get(key),key+': authoritative outcomes or deterministic particle ID changed');else reference.set(key,signature);rows.push({condition:run.condition,scene:scene.name,client:client.index,source:report.source.suite,metrics:metric(scene,client)});}}
  }
  const comparisons=[];
  for(const scene of CORE_SCENES)for(const client of [0,1]){
    const selected=Object.fromEntries(ORDER.map(condition=>[condition,rows.find(row=>row.condition===condition&&row.scene===scene&&row.client===client).metrics]));
    const before=selected['baseline-before'],stage=selected.stage1,after=selected['baseline-after'];
    const delta=(a,b)=>Object.fromEntries(Object.keys(a).map(key=>[key,a[key]-b[key]]));
    const versusBefore=stage.frameP95Ms-before.frameP95Ms,versusAfter=stage.frameP95Ms-after.frameP95Ms;
    const direction=versusBefore<0&&versusAfter<0?'lower-than-both-baselines':versusBefore>=0&&versusAfter>=0?'not-lower-than-either-baseline':'mixed-against-bracketing-baselines';
    comparisons.push({scene,client,...selected,stage1MinusBefore:delta(stage,before),stage1MinusAfter:delta(stage,after),baselineDrift:delta(after,before),p95Direction:direction});
  }
  const twenty=comparisons.filter(row=>row.scene==='twenty-dice'),bothLower=twenty.every(row=>row.p95Direction==='lower-than-both-baselines');
  return{exploratory:true,brackets:1,independentRepetitions:1,stableImprovementEstablished:false,successMeaning:'All fixture/provenance/outcome checks passed. This does not establish a product performance improvement.',measurements:rows,comparisons,twentyDiceDecision:bothLower?'Both clients are lower than both adjacent baselines in this one exploratory bracket; no stability claim.':'At least one client has no P95 improvement or inconsistent direction. Stop this small candidate; do not claim improvement.',limitations:['A single bracket does not establish a stable effect or statistical significance.','No client, scene or repeated warm roll is averaged away.','FirstSubmittedFrameMs is the CPU return from actual WebGL submission, not GPU presentation.','End-to-end completion is the actual SDK completion observation; raw events remain authoritative.','Retimes are counted from renderer-event logs, without changing the clock.','Compare only these three runs from this one CI runner; never substitute a different runner or earlier job.']};
}
