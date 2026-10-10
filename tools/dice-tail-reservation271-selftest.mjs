import {build} from 'rolldown';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const output=process.env.DND_DICE_EVIDENCE||'.cache/dice-tail-reservation271';mkdirSync(output,{recursive:true});
await build({input:'tools/dice-tail-reservation271.test.ts',platform:'node',external:[/^node:/],output:{file:output+'/selftest.mjs',format:'esm'}});
const report=execFileSync(process.execPath,[output+'/selftest.mjs'],{encoding:'utf8'});
writeFileSync(output+'/result.json',report);console.log(report);
