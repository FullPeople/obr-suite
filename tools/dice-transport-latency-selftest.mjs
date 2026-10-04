import {build} from 'rolldown';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const baseline=process.env.DICE_LATENCY_BASELINE;
const output=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-transport-latency');mkdirSync(output,{recursive:true});
await build({input:'tools/dice-transport-latency.test.ts',platform:'node',external:[/^node:/],plugins:baseline?[{name:'immutable-controller-baseline',load(id){const relative=id.replaceAll('\\','/').match(/extensions\/workbench-dice3d\/src\/controller\.ts$/)?.[0];if(relative)return execFileSync('git',['show',baseline+':'+relative],{encoding:'utf8'});}}]:[],output:{file:join(output,'transport-selftest.mjs'),format:'esm'}});
const scenarios=[{name:'warm',rolls:3},{name:'rate-retry',rolls:1,rate:1},{name:'unknown-start',rolls:1,unknown:true},{name:'slow-ack',rolls:1,ack:400}];
const reports=[];for(const scenario of scenarios.filter(s=>!process.env.DICE_TRANSPORT_SCENARIO||s.name===process.env.DICE_TRANSPORT_SCENARIO)){
 execFileSync(process.execPath,[join(output,'transport-selftest.mjs')],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:output,PROBE_MODE:scenario.name,PROBE_ROLLS:String(scenario.rolls),PROBE_RATE_ERRORS:String(scenario.rate||0),PROBE_UNKNOWN_START:scenario.unknown?'1':'0',PROBE_ACK_MS:String(scenario.ack||0)}});
 const report=JSON.parse(readFileSync(join(output,scenario.name+'-transport.json'),'utf8'));reports.push({scenario:scenario.name,results:report.results.map(({traffic,scheduled,...row})=>({...row,lead:scheduled?.leadMs,messages:traffic.length}))});
}
writeFileSync(join(output,'summary.json'),JSON.stringify({boundary:'Real production Controller/codec/send queue with virtual transport and stub physics/render. No browser, GPU, or real room.',reports},null,2));
