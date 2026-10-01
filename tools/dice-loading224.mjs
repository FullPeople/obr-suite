import {build} from 'rolldown';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out='.cache/edge224';mkdirSync(out,{recursive:true});
await build({input:'tools/dice-loading224.test.ts',platform:'node',external:[/^node:/],output:{file:out+'/loading.mjs',format:'esm'}});
const result=execFileSync(process.execPath,[out+'/loading.mjs'],{encoding:'utf8'});
writeFileSync(out+'/loading-results.json',result);console.log(result);
