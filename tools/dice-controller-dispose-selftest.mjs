// Bundles the production Controller; browser, Worker and network boundaries are modeled in the test.
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),deps=process.env.DND_SUITE_DEPS||root;
const out=resolve(process.env.DND_DICE_EVIDENCE||resolve(root,'.cache/dice-controller-dispose'));mkdirSync(out,{recursive:true});
const req=createRequire(resolve(deps,'package.json')),{build}=await import(pathToFileURL(req.resolve('rolldown')).href);
await build({input:resolve(root,'tools/dice-controller-dispose.test.ts'),platform:'node',external:[/^node:/],plugins:[{
 name:'controller-dispose-dependencies',resolveId(id){if(!id.startsWith('.')&&!id.includes(':')&&!id.startsWith('/'))return this.resolve(id,resolve(deps,'resolver.js'),{skipSelf:true});},
 load(id){if(process.env.DICE_DISPOSE_BASELINE&&id.replaceAll('\\','/').endsWith('/extensions/workbench-dice3d/src/controller.ts'))return execFileSync('git',['show',process.env.DICE_DISPOSE_BASELINE+':extensions/workbench-dice3d/src/controller.ts'],{cwd:root,encoding:'utf8'});}
}],output:{file:resolve(out,'selftest.mjs'),format:'esm',codeSplitting:false}});
execFileSync(process.execPath,[resolve(out,'selftest.mjs')],{stdio:'inherit',cwd:root,env:{...process.env,DND_DICE_EVIDENCE:out}});
