import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const output=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-ready-tail-slot');mkdirSync(output,{recursive:true});
const baseline=process.env.DICE_TAIL_BASELINE;
await build({plugins:baseline?[{name:'immutable-tail-baseline',load(id){const path=id.replaceAll('\\','/').match(/(?:extensions\/workbench-dice3d\/src\/controller|src\/workbench\/dice-send-queue)\.ts$/)?.[0];if(path)return execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'});}}]:[],input:'tools/dice-ready-tail-slot.test.ts',platform:'node',external:[/^node:/],output:{file:output+'/selftest.mjs',format:'esm'}});
execFileSync(process.execPath,[output+'/selftest.mjs'],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:output}});
