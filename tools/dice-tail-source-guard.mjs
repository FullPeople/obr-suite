import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {instrumentTail,tailSourceFiles,tailMutableFiles,protectedTailInventory} from './dice-tail-trace.mjs';
const configBytes=readFileSync('tools/dice-tail-paired-config.json'),paired=JSON.parse(configBytes),base=paired.baseline,web=paired.pairedWeb;
assert.equal(base,'be3b13df39477491dda0b6ec152b1bf836e22b4a');assert.equal(web,'2bfc832916896e85aa22b4f36f3ba66a7bae6749');
const mode=process.env.DICE_TAIL_SOURCE_MODE||'baseline';assert(['baseline','candidate'].includes(mode),'explicit source mode');
const changedFiles=Object.keys(paired.productChanges);assert.deepEqual(changedFiles,['extensions/workbench-dice3d/src/controller.ts'],'only frozen controller delta is approved');
if(mode==='candidate'){for(const pin of Object.values(paired.productChanges)){assert(/^[0-9a-f]{64}$/.test(pin.candidateSHA256||''),'reviewed candidate SHA-256 must be pinned');assert(/^[0-9a-f]{40}$/.test(pin.candidateGitBlob||''),'reviewed candidate Git blob must be pinned')}assert.deepEqual(Object.keys(paired.candidateTests).sort(),['tools/dice-ready-tail-slot-selftest.mjs','tools/dice-ready-tail-slot.test.ts'],'both exact candidate regression test files must be pinned');}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});
const sha=data=>createHash('sha256').update(data).digest('hex');
const inventory=ref=>protectedTailInventory(git('ls-tree','-rz',ref));
git('diff','--exit-code',base,'--','.',...[...tailMutableFiles,...(mode==='candidate'?changedFiles:[])].map(file=>':(exclude,literal)'+file));
const baseline=inventory(base),selected=inventory('HEAD'),expected=baseline.map(entry=>{const file=entry.slice(entry.indexOf('\t')+1),pin=paired.productChanges[file];if(mode!=='candidate'||!pin)return entry;assert(/^[0-9a-f]{40}$/.test(pin.candidateGitBlob||''),'candidate Git blob must be frozen');assert(entry.includes(' '+pin.baselineGitBlob+'\t'),'baseline blob matches frozen comparison');return entry.replace(' '+pin.baselineGitBlob+'\t',' '+pin.candidateGitBlob+'\t')});
assert.deepEqual(selected,expected,'every tracked entry must match the pinned source; only exact diagnostic paths and frozen candidate controller delta may differ');
const selectedFiles=[...tailSourceFiles,'src/workbench/dice-send-queue.ts','extensions/workbench-dice3d/src/wire.mjs','extensions/workbench-dice3d/src/physics.worker.ts','extensions/workbench-dice3d/src/types.ts'].map(file=>{const original=execFileSync('git',['show',base+':'+file],{maxBuffer:64*1024*1024}),current=readFileSync(file);const pin=paired.productChanges[file];if(pin)assert.equal(sha(original),pin.baselineSHA256,'baseline source hash: '+file);const expectedSHA256=mode==='candidate'&&pin?pin.candidateSHA256:sha(original);assert.equal(sha(current),expectedSHA256,'selected source bytes match frozen pin: '+file);return{file,sha256:sha(current),bytes:current.length}});
const candidateTests=mode==='candidate'?Object.entries(paired.candidateTests).map(([file,pin])=>{assert(['tools/dice-ready-tail-slot.test.ts','tools/dice-ready-tail-slot-selftest.mjs'].includes(file),'exact candidate test path');const digest=sha(readFileSync(file));assert.equal(digest,pin,'frozen candidate tests: '+file);return{file,sha256:digest}}):[];
assert(process.env.DND_CARD_WEB_ROOT,'exact paired Web checkout required');assert.equal(git('-C',process.env.DND_CARD_WEB_ROOT,'rev-parse','HEAD').trim(),web,'exact paired Web SHA');
for(const configFile of ['tsconfig.json','extensions/workbench-dice3d/tsconfig.json']){
 const config=ts.readConfigFile(configFile,ts.sys.readFile);assert(!config.error);const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve(configFile,'..'),{noEmit:true});
 const host=ts.createCompilerHost(parsed.options),read=host.readFile.bind(host);host.readFile=file=>{const code=read(file);return code===undefined?code:instrumentTail(code,file)??code};
 const program=ts.createProgram(parsed.fileNames,parsed.options,host),diagnostics=ts.getPreEmitDiagnostics(program);if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));throw Error('Instrumented TypeScript check failed: '+configFile)}
}
const out=resolve(process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-tail/browser');mkdirSync(out,{recursive:true});
const report={success:true,baseline:base,diagnosticCommit:git('rev-parse','HEAD').trim(),pairedWeb:web,sourceMode:mode,reviewedCandidateControllerSHA256:paired.productChanges[changedFiles[0]].candidateSHA256,configurationSHA256:sha(configBytes),sourceMatchesFrozenPin:true,allUnselectedProductionTreeUnchanged:true,allProductionTreeUnchanged:mode==='baseline',mutableFiles:[...tailMutableFiles],productionEntryCount:baseline.length,baselineProductionInventorySHA256:sha(baseline.join('\0')),allProductionInventorySHA256:sha(selected.join('\0')),selectedFiles,candidateTests,instrumentedTypeChecks:['suite','dice-extension']};writeFileSync(out+'/source-guard.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
