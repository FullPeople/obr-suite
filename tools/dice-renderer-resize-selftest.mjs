import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const baseline=process.env.DICE_RESIZE_BASELINE;
const output=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-renderer-resize');mkdirSync(output,{recursive:true});
await build({input:'tools/dice-renderer-resize.test.ts',platform:'node',external:[/^node:/],plugins:baseline?[{name:'immutable-renderer-baseline',load(id){if(id.replaceAll('\\','/').endsWith('/extensions/workbench-dice3d/src/renderer.ts'))return execFileSync('git',['show',baseline+':extensions/workbench-dice3d/src/renderer.ts'],{encoding:'utf8'});}}]:[],output:{file:join(output,'selftest.mjs'),format:'esm'}});
execFileSync(process.execPath,[join(output,'selftest.mjs')],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:output}});
