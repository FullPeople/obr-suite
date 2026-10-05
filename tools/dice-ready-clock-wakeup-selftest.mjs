import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const out=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-ready-clock');mkdirSync(out,{recursive:true});
const baseline=process.env.DICE_READY_CLOCK_BASELINE;
await build({input:'tools/dice-ready-clock-wakeup.test.ts',platform:'node',external:[/^node:/],plugins:baseline?[{name:'immutable-ready-clock-baseline',load(id){if(id.replaceAll('\\','/').endsWith('/extensions/workbench-dice3d/src/controller.ts'))return execFileSync('git',['show',baseline+':extensions/workbench-dice3d/src/controller.ts'],{encoding:'utf8'});}}]:[],output:{file:out+'/selftest.mjs',format:'esm'}});
execFileSync(process.execPath,[out+'/selftest.mjs'],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:out}});
