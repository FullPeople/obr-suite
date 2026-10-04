// Fixed local git object only; no network or fetch is needed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),deps=process.env.DND_SUITE_DEPS||root;
const baseline='308a7ccf0cb70794055ac75170bf112a36989993';
const out=resolve(process.env.DND_DICE_EVIDENCE||resolve(root,'.cache/dice-legacy-wire-parity'));mkdirSync(out,{recursive:true});
const req=createRequire(resolve(deps,'package.json')),{build}=await import(pathToFileURL(req.resolve('rolldown')).href);
const reports={};
for(const [label,ref] of [['baseline',baseline],['candidate',process.env.DICE_WIRE_CANDIDATE]]){
 const target=resolve(out,label+'.mjs');
 await build({input:resolve(root,'tools/dice-legacy-wire-parity.test.ts'),platform:'node',external:[/^node:/],plugins:[{
  name:'fixed-controller-source',resolveId(id){if(!id.startsWith('.')&&!id.includes(':')&&!id.startsWith('/'))return this.resolve(id,resolve(deps,'resolver.js'),{skipSelf:true});},
  load(id){const file=id.replaceAll('\\','/').match(/extensions\/workbench-dice3d\/src\/(controller|types)\.ts$/)?.[0];if(ref&&file)return execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'});}
 }],output:{file:target,format:'esm',codeSplitting:false}});
 const raw=execFileSync(process.execPath,[target],{cwd:root,encoding:'utf8'});writeFileSync(resolve(out,label+'.json'),raw);reports[label]=JSON.parse(raw);
}
assert.equal(reports.candidate.checks,19);assert.deepEqual(reports.candidate,reports.baseline,'Legacy manifest/chunk bytes or authoritative results differ from released 245');
const controller='extensions/workbench-dice3d/src/controller.ts',source=process.env.DICE_WIRE_CANDIDATE?execFileSync('git',['show',process.env.DICE_WIRE_CANDIDATE+':'+controller],{cwd:root}):readFileSync(resolve(root,controller));
const summary={checks:19,passed:19,failed:0,baseline,candidateControllerSha256:createHash('sha256').update(source).digest('hex'),boundary:'Production Controller and codec, synthetic trajectories and modeled transport/render acknowledgements. Exact wire payload parity; no browser, real network, or latency claim.'};
writeFileSync(resolve(out,'result.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
