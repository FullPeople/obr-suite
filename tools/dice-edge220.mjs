import {build} from 'rolldown';import {mkdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';
mkdirSync('.cache/edge220',{recursive:true});
await build({input:'tools/dice-edge220.test.ts',platform:'node',external:[/^node:/],output:{file:'.cache/edge220/queue.mjs',format:'esm'}});
execFileSync(process.execPath,['.cache/edge220/queue.mjs'],{stdio:'inherit'});
