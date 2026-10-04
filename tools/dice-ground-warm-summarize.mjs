// Summarize existing reports without running a browser or changing evidence.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function summarizeWarmProfile(report){
 const rows=[];
 for(const leg of report.timing||[])for(const client of leg.clients||[]){
  const records=client.probe?.records||[],builds=records.filter(r=>r.built||r.warmBuild);
  for(const build of builds){const firstHit=records.find(r=>r.hit&&r.frame>build.frame),trace=build.warmBuild;
   rows.push({scenario:leg.scenario,mode:leg.mode,client:client.index,readyMs:client.ready?.readyMs,buildFrame:build.frame,buildTotalSubmitMs:build.buildTotalSubmitMs,captureSubmitMs:build.buildSubmitMs,compileSubmitMs:build.compileSubmitMs,
    unsegmentedResidualMs:build.buildTotalSubmitMs-build.buildSubmitMs-build.compileSubmitMs,
    residualMeaning:'Includes state snapshot, allocation, CPU setup, restore1/restore2 and instrumentation gaps; it is not solely pre-capture time.',
    firstHit:firstHit?{frame:firstHit.frame,totalSubmitMs:firstHit.totalSubmitMs,renderSubmitMs:firstHit.renderSubmitMs,signatureMs:firstHit.signatureMs}:null,
    spans:trace?.spans??null,queriesInOrder:trace?.queries??null,queriesByWallCost:trace?.queries?[...trace.queries].sort((a,b)=>b.cpuWallMs-a.cpuWallMs):null,
    syncCounts:client.probe.syncCalls,addedGPUCalls:client.probe.warmProfile?.addedGPUCalls??null});
  }
 }
 return{schema:'dice-ground-cold-build-summary.v1',source:report.source,experimentCompleted:report.success,measures:'CPU wall intervals only. A slow GL call can include waiting, scheduling and driver work; this does not measure GPU duration or prove queue-drain causality.',speedClaim:false,cacheAcceptance:false,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Usage: node tools/dice-ground-warm-summarize.mjs result.json');console.log(JSON.stringify(summarizeWarmProfile(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));}
