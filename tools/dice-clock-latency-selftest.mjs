import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const baseline=process.env.DICE_LATENCY_BASELINE;
const output=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-clock-latency');mkdirSync(output,{recursive:true});
await build({input:'tools/dice-clock-latency.test.ts',platform:'node',external:[/^node:/],plugins:[...(baseline?[{name:'immutable-clock-baseline',load(id){const relative=id.replaceAll('\\','/').match(/(?:extensions\/workbench-dice3d\/src\/controller|src\/workbench\/dice-broadcast)\.ts$/)?.[0];if(relative)return execFileSync('git',['show',baseline+':'+relative],{encoding:'utf8'});}}]:[]),{name:'dice-sdk-test-double',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/dice-clock-sdk-stub.ts');}}],output:{file:join(output,'clock-selftest.mjs'),format:'esm'}});
execFileSync(process.execPath,[join(output,'clock-selftest.mjs')],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:output}});
