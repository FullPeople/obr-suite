// Pure analysis helpers. Frame intervals include browser scheduling/compositing gaps.
export function distribution(values){const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);const p=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]??null;return{count:sorted.length,median:p(.5),p95:p(.95),max:sorted.at(-1)??null,mean:sorted.length?sorted.reduce((a,b)=>a+b,0)/sorted.length:null};}
function frameSummary(frames,records){const ids=new Set(frames.map(f=>f.index)),gl=records.filter(r=>ids.has(r.frame));return{frames:frames.length,nextFrameMs:distribution(frames.map(f=>f.nextFrameMs)),nextRAFMs:distribution(frames.map(f=>f.nextRAFMs)),wholeJSCpuMs:distribution(frames.map(f=>f.wholeJSCpuMs)),glPassCpuMs:distribution(frames.map(f=>f.glPassCpuMs)),showInclusiveCpuMs:distribution(frames.map(f=>f.showInclusiveCpuMs)),glSubmitCpuMs:distribution(gl.map(r=>r.outerSubmitMs)),shadowSubmitCpuMs:distribution(gl.map(r=>r.shadowSubmitMs)),mainAfterShadowSubmitCpuMs:distribution(gl.map(r=>r.mainAfterShadowSubmitMs)),shadowGpuMs:distribution(gl.filter(r=>r.gpuValid).map(r=>r.shadowGpuMs)),mainAfterShadowGpuMs:distribution(gl.filter(r=>r.gpuValid).map(r=>r.mainAfterShadowGpuMs)),retimes:frames.reduce((n,f)=>n+f.retimes,0),canvas:frames.reduce((layers,f)=>{for(const [name,counts]of Object.entries(f.canvas)){const dst=layers[name]??={attempted:0,executed:0,clearsAttempted:0,clearsExecuted:0,paintAttempted:0,paintExecuted:0};for(const [type,counter] of Object.entries(counts))for(const [method,value]of Object.entries(counter)){dst[type]+=value;dst[(method==='clearRect'?'clears':'paint')+(type==='attempted'?'Attempted':'Executed')]+=value;}}return layers;},{})};}
export function summarizeClient(raw,sdk,id){
  const frames=raw.frames.filter(f=>f.rolls.some(r=>r.id===id||r.id.startsWith(id+':'))),events=sdk.events.filter(e=>e.type==='log'&&(e.detail?.id===id||e.detail?.roll===id||e.detail?.roll?.startsWith(id+':')));
  const release=events.find(e=>e.event==='render-release'),complete=events.find(e=>e.event==='render-complete'&&e.detail.roll===id),phaseNames=['physics','settled-wait','gathering','afterglow-fade','tail-hold','complete'];
  return{completed:!!complete,releaseAt:release?.detail.actual??null,completeObservedAt:complete?.observedAt??null,completionWallMs:complete&&release?complete.observedAt-release.detail.actual:null,plannedCueSeconds:Math.max(...raw.rolls.map(r=>r.cue.diceExit)),audioStarts:raw.audioStarts,audioRestarts:raw.audioRestarts,audioState:raw.audioState,gpuStatus:raw.gpu.status,...frameSummary(frames,raw.gpu.records),phases:Object.fromEntries(phaseNames.map(phase=>[phase,frameSummary(frames.filter(f=>f.rolls.some(r=>r.phase===phase)),raw.gpu.records)]))};
}
// wire.mjs writes exactly these ten contact fields with DataView.setFloat32.
// Preserve every other field verbatim: this is the existing codec, not an epsilon.
export const WIRE_CONTACT_FIELDS=Object.freeze(['t','kind','a','b','seq','x','y','z','speed','impulse']);
export function canonicalWireContacts(contacts){
  return contacts?.map(contact=>{const canonical={...contact};for(const key of WIRE_CONTACT_FIELDS){
    if(!Object.hasOwn(contact,key)||typeof contact[key]!=='number'||!Number.isFinite(contact[key]))throw Error('Invalid authoritative contact field: '+key);
    canonical[key]=Math.fround(contact[key]);
  }return canonical;});
}
function signature(client,wireContacts=false){return{total:client.sdk.results.at(-1)?.data.total,dice:client.sdk.results.at(-1)?.data.dice,rolls:client.raw.rolls.map(r=>({kinds:r.kinds,results:r.results,poseSha256:r.poseSha256,duration:r.duration,fps:r.fps,frames:r.frames,seed:r.seed,contacts:wireContacts?canonicalWireContacts(r.contacts):r.contacts,cue:r.cue}))};}
export function compareCases(cases){
  const timing=cases.filter(c=>!c.trace),mismatches=[],reference=new Map();
  // All measured rolls originate from client 0. Keep its raw doubles strictly
  // invariant across single/dual-client and A/B runs. Only receivers should see
  // the exact wire-rounded values; never round their actual values to excuse drift.
  for(const row of timing)if(!reference.has(row.expression)){
    const sender=row.clients.find(client=>client.index===0);
    if(sender)reference.set(row.expression,{label:row.label,raw:signature(sender),wire:signature(sender,true)});
  }
  for(const row of timing)for(const client of row.clients){
    const ref=reference.get(row.expression),actual=signature(client),comparison=client.index===0?'sender-raw':'receiver-wire-float32';
    const expected=ref?.[client.index===0?'raw':'wire'];
    if(!ref||JSON.stringify(expected)!==JSON.stringify(actual))mismatches.push({reference:ref?.label??null,label:row.label,client:client.index,comparison,expected,actual});
  }
  const paired=[];
  for(const expression of ['20d6','1d20'])for(const repeat of [...new Set(timing.map(c=>c.repeat))]){
    const rows=timing.filter(c=>c.expression===expression&&c.repeat===repeat&&c.clientCount===1),before=rows.find(c=>c.variant==='baseline-before')?.clients[0].summary,after=rows.find(c=>c.variant==='baseline-after')?.clients[0].summary;
    if(!before||!after)continue;
    const drift={frameP95Ms:after.nextFrameMs.p95-before.nextFrameMs.p95,completionWallMs:after.completionWallMs-before.completionWallMs};
    paired.push({expression,repeat,baselineBefore:before,baselineAfter:after,drift,ablations:rows.filter(c=>c.variant.startsWith('no-')).map(c=>({variant:c.variant,summary:c.clients[0].summary,p95DeltaVsBeforeMs:c.clients[0].summary.nextFrameMs.p95-before.nextFrameMs.p95,p95DeltaVsAfterMs:c.clients[0].summary.nextFrameMs.p95-after.nextFrameMs.p95,completionDeltaVsBeforeMs:c.clients[0].summary.completionWallMs-before.completionWallMs,completionDeltaVsAfterMs:c.clients[0].summary.completionWallMs-after.completionWallMs}))});
  }
  return{invariants:{valid:!mismatches.length,contactComparison:{sender:'raw JSON-exact across all client-0 cases',receiver:'actual values must exactly equal sender values encoded as the ten Float32 wire fields; all other fields remain exact',float32Fields:WIRE_CONTACT_FIELDS},mismatches},paired,dualBaselines:timing.filter(c=>c.clientCount===2).map(c=>({expression:c.expression,repeat:c.repeat,clients:c.clients.map(c=>c.summary)})),interpretation:'Diagnostic omitted-visuals experiments only. Compare every ablation with BOTH adjacent baselines and all repetitions; report drift and phase-level intervals. Dual baselines are later on the same runner, not randomized concurrent pairs. CPU submission times do not attribute asynchronous raster/compositor/GPU latency. No result here establishes lossless product improvement.'};
}
