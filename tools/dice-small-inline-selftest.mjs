import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const output=process.env.DND_DICE_EVIDENCE||'.cache/dice-small-inline';mkdirSync(output,{recursive:true});
const baseline=process.env.DICE_SMALL_BASELINE;
await build({input:'tools/dice-small-inline.test.ts',platform:'node',external:[/^node:/],plugins:baseline?[{name:'exact-controller-baseline',load(id){const file=id.replaceAll('\\','/').match(/extensions\/workbench-dice3d\/src\/(controller|types)\.ts$/)?.[0];if(file)return execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'});}}]:[],output:{file:output+'/selftest.mjs',format:'esm'}});
execFileSync(process.execPath,[output+'/selftest.mjs'],{stdio:'inherit'});
