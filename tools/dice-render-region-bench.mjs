import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out=process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-render-region';mkdirSync(out,{recursive:true});
await build({input:'tools/dice-render-region-bench.ts',platform:'node',external:[/^node:/],output:{file:out+'/bench.mjs',format:'esm'}});
execFileSync(process.execPath,['--expose-gc',out+'/bench.mjs'],{stdio:'inherit',env:{...process.env,BENCH_OUT:process.env.BENCH_OUT||out+'/bench.json'}});
