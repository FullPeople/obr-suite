// Descriptive same-runner calibration, not a physical-phone performance threshold.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]||'.local-evidence/small-paired');
const labels=['baseline-before','candidate','baseline-after'],runs=Object.fromEntries(labels.map(label=>[label,JSON.parse(readFileSync(resolve(root,label,'result.json'),'utf8'))]));
for(const run of Object.values(runs)){assert(run.success&&run.smallCountMatrix&&run.realSDK&&run.realPhysics);assert.equal(run.capture.video,false);assert.equal(run.capture.screenshots,false);assert.equal(run.capture.synchronousPixelReadback,false);}
assert.equal(runs['baseline-before'].source.suite,runs['baseline-after'].source.suite);for(const run of Object.values(runs)){assert.deepEqual(run.viewport,runs.candidate.viewport);assert.equal(run.theme,runs.candidate.theme);assert.equal(run.source.web,runs.candidate.source.web);assert.equal(run.browser,runs.candidate.browser);assert.equal(run.host.node,runs.candidate.host.node);assert.deepEqual(run.submissionSeedsPerClient,runs.candidate.submissionSeedsPerClient);}
const rows=[];for(const name of ['small-count-1','small-count-2','small-count-5','small-count-9','small-count-10','small-mixed-nine','small-percentile-two'])for(const client of [0,1]){
 const selected=Object.fromEntries(labels.map(label=>{const c=runs[label].cases.find(c=>c.name===name);assert(c,name+' missing');return[label,c.clients[client]];}));
 for(const label of labels){assert.equal(selected[label].result.total,selected.candidate.result.total,name+' total differs between sources');assert.deepEqual(selected[label].result.dice,selected.candidate.result.dice,name+' authoritative dice differ between sources');assert(Number.isFinite(selected[label].firstSubmittedFrameMs)&&selected[label].firstSubmittedFrameMs>=0,name+' has invalid submission timing');}
 const first=Object.fromEntries(labels.map(label=>[label,selected[label].firstSubmittedFrameMs])),frameP95=Object.fromEntries(labels.map(label=>[label,selected[label].frameP95Ms]));
 rows.push({name,client,firstSubmittedFrameMs:first,frameP95Ms:frameP95,baselineDriftMs:first['baseline-after']-first['baseline-before'],candidateVsBaselineMidpointMs:first.candidate-(first['baseline-before']+first['baseline-after'])/2});
}
const result={success:true,boundary:'CPU render submission only; no GPU readback, video, physical-device or screen-presentation timing. Each scenario is a paired observation, not a statistical significance claim. A green workflow certifies assertions; inspect reported values and baseline drift before concluding improvement.',source:Object.fromEntries(labels.map(label=>[label,runs[label].source])),viewport:runs.candidate.viewport,theme:runs.candidate.theme,rows};writeFileSync(resolve(root,'comparison.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
