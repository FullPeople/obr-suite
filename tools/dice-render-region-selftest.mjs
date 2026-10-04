import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out=process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-render-region';mkdirSync(out,{recursive:true});
await build({input:'tools/dice-render-region.test.ts',platform:'node',external:[/^node:/],output:{file:out+'/test.mjs',format:'esm'}});
execFileSync(process.execPath,[out+'/test.mjs'],{stdio:'inherit'});
