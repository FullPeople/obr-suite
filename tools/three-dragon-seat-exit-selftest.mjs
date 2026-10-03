import {build} from 'rolldown';
import {mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const mutant=process.argv.find(v=>v.startsWith('--mutant='))?.split('=')[1];
const mutations={
 'angle-label':['stage/layout.ts','name: { x: seatX + normalX * 1.45, z: seatZ + normalZ * 1.45 }','name: { x: normalX * 7.5, z: normalZ * 7.5 }'],
 'hide-exit':['server-client.ts','if(endedExit)this.dismiss(this.wire.game.id,false);','if(false)this.dismiss(this.wire.game.id,false);'],
 'restore-rejection':['server-client.ts','this.dismiss(packet.ok?this.dismissedGameId:pending.dismissalBefore||undefined)','this.dismiss(this.dismissedGameId)'],
};
if(mutant)assert.ok(mutations[mutant],'known mutation');let applied=false;
const out=join(mkdtempSync(join(tmpdir(),'tda-seat-exit-')),'selftest.mjs');
await build({input:resolve('tools/three-dragon-seat-exit-selftest.entry.ts'),platform:'node',plugins:[{name:'transport-only-fixture',resolveId(id,importer){if(id==='./server-session'&&importer?.endsWith('/server-client.ts'))return '\0session';},load(id){if(id==='\0session')return "export const serverBase='http://unit-test.invalid';";},transform(code,id){if(!mutant||!id.replaceAll('\\','/').endsWith(mutations[mutant][0]))return;const [,from,to]=mutations[mutant];assert.equal(code.split(from).length,2,'unique mutation');applied=true;return code.replace(from,to);}}],output:{file:out,format:'esm',codeSplitting:false},logLevel:'warn'});
if(mutant)assert.ok(applied,'mutation applied');await import(pathToFileURL(out));
