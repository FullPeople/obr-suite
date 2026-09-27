import {build} from 'rolldown';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const out=mkdtempSync(join(tmpdir(),'time-dragon-rules-')),file=join(out,'test.mjs');
await build({input:resolve('tools/three-dragon-time-dragon-selftest.entry.ts'),platform:'node',output:{file,format:'esm',codeSplitting:false},logLevel:'warn'});
execFileSync(process.execPath,[file],{stdio:'inherit'});
console.log('Time Dragon rules and controller checks passed: '+out);
