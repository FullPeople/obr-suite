import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {groundMaskTransform} from './dice-ground-mask-transform.mjs';
const out=process.env.DND_DICE_GROUND_MASK_EVIDENCE||'.local-evidence/dice-ground-mask';mkdirSync(out,{recursive:true});
await build({input:'tools/dice-ground-mask.test.ts',platform:'node',plugins:[groundMaskTransform()],external:[/^node:/],output:{file:out+'/test.mjs',format:'esm'}});
execFileSync(process.execPath,[out+'/test.mjs'],{stdio:'inherit'});
