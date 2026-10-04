import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const deps=process.env.DND_SUITE_DEPS||root;
const out=process.env.DND_DICE_EVIDENCE||path.join(root,'.local-evidence/dice-idle-lifecycle');
const req=createRequire(deps+'/package.json');
const {build}=await import(pathToFileURL(req.resolve('rolldown')).href);
mkdirSync(out,{recursive:true});
await build({input:root+'/tools/dice-idle-lifecycle.test.ts',platform:'node',external:[/^node:/],plugins:[{
 name:'test-dependencies',
 resolveId(id){if(!id.startsWith('.')&&!id.includes(':')&&!id.startsWith('/'))return this.resolve(id,deps+'/resolver.js',{skipSelf:true});},
 transform(code,id){const baseline=process.env.DND_DICE_IDLE_BASELINE;if(baseline&&/\/extensions\/workbench-dice3d\/src\/(controller|audio-mixer)\.ts$/.test(id))return readFileSync(path.join(baseline,'extensions',id.split('/extensions/')[1]),'utf8');}
}],output:{file:path.join(out,'selftest.mjs'),format:'esm'}});
execFileSync(process.execPath,[path.join(out,'selftest.mjs')],{stdio:'inherit'});
