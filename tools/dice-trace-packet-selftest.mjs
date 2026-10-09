import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const output=process.env.DND_DICE_EVIDENCE||'.cache/dice-trace-packet';mkdirSync(output,{recursive:true});
await build({input:'tools/dice-trace-packet.test.ts',platform:'node',external:[/^node:/],output:{file:output+'/selftest.mjs',format:'esm'}});
execFileSync(process.execPath,[output+'/selftest.mjs'],{stdio:'inherit'});
