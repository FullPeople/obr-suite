import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {instrumentTail,tailSourceFiles,tailMutableFiles,protectedTailInventory} from './dice-tail-trace.mjs';
const base='f67516100c1e5af450a4ee6a948241c03286c397',web='fb584043c6bed831b9ca92eab783653770c24fe6';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});
const sha=data=>createHash('sha256').update(data).digest('hex');
const inventory=ref=>protectedTailInventory(git('ls-tree','-rz',ref));
git('diff','--exit-code',base,'--','.',...[...tailMutableFiles].map(file=>':(exclude,literal)'+file));
const baseline=inventory(base),selected=inventory('HEAD');assert.deepEqual(selected,baseline,'every protected tree entry must equal f675; only seven exactly named diagnostic files may differ');
const selectedFiles=[...tailSourceFiles,'src/workbench/dice-send-queue.ts','extensions/workbench-dice3d/src/wire.mjs','extensions/workbench-dice3d/src/physics.worker.ts','extensions/workbench-dice3d/src/types.ts'].map(file=>{const original=execFileSync('git',['show',base+':'+file],{maxBuffer:64*1024*1024}),current=readFileSync(file);assert.deepEqual(current,original,'source bytes unchanged: '+file);return{file,sha256:sha(current),bytes:current.length}});
assert(process.env.DND_CARD_WEB_ROOT,'exact paired Web checkout required');assert.equal(git('-C',process.env.DND_CARD_WEB_ROOT,'rev-parse','HEAD').trim(),web,'exact paired Web SHA');
for(const configFile of ['tsconfig.json','extensions/workbench-dice3d/tsconfig.json']){
 const config=ts.readConfigFile(configFile,ts.sys.readFile);assert(!config.error);const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve(configFile,'..'),{noEmit:true});
 const host=ts.createCompilerHost(parsed.options),read=host.readFile.bind(host);host.readFile=file=>{const code=read(file);return code===undefined?code:instrumentTail(code,file)??code};
 const program=ts.createProgram(parsed.fileNames,parsed.options,host),diagnostics=ts.getPreEmitDiagnostics(program);if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));throw Error('Instrumented TypeScript check failed: '+configFile)}
}
const out=resolve(process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-tail/browser');mkdirSync(out,{recursive:true});
const report={success:true,baseline:base,diagnosticCommit:git('rev-parse','HEAD').trim(),pairedWeb:web,allProductionTreeUnchanged:true,mutableFiles:[...tailMutableFiles],productionEntryCount:baseline.length,allProductionInventorySHA256:sha(baseline.join('\0')),selectedFiles,instrumentedTypeChecks:['suite','dice-extension']};writeFileSync(out+'/source-guard.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
