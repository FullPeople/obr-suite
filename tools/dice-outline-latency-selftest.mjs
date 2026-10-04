import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out=process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-outline';mkdirSync(out,{recursive:true});
const base=process.env.DICE_LATENCY_BASELINE;
await build({input:'tools/dice-outline-latency.test.ts',platform:'node',external:[/^node:/],plugins:base?[{name:'immutable-baseline',transform(code,id){const name=id.replaceAll('\\','/').match(/extensions\/workbench-dice3d\/src\/(?:dice-materials|dynamic-decorations)\.ts$/)?.[0];if(name)return execFileSync('git',['show',base+':'+name],{encoding:'utf8'});}}]:[],output:{file:out+'/test.mjs',format:'esm'}});
execFileSync(process.execPath,[out+'/test.mjs'],{stdio:'inherit'});
