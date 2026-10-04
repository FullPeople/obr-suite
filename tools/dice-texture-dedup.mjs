import {build} from 'rolldown';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out='.cache/dice-texture-dedup';mkdirSync(out,{recursive:true});
await build({input:'tools/dice-texture-dedup.test.ts',platform:'node',external:[/^node:/],output:{file:out+'/test.mjs',format:'esm'}});
const result=execFileSync(process.execPath,[out+'/test.mjs'],{encoding:'utf8'});
writeFileSync(out+'/results.json',result);console.log(result);
