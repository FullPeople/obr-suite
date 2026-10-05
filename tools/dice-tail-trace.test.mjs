import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {instrumentTail,tailSourceFiles,tailEvent,protectedTailInventory} from './dice-tail-trace.mjs';
test('all diagnostic injection sites match the pinned production boundary once and parse as TypeScript',()=>{
 for(const file of tailSourceFiles){const source=readFileSync(file,'utf8'),out=instrumentTail(source,resolve(file));assert(out&&out!==source,file);const parsed=ts.createSourceFile(file,out,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.deepEqual(parsed.parseDiagnostics,[],file);assert.throws(()=>instrumentTail(out,resolve(file)),/Tail trace boundary/,file+' must fail closed on repeated injection');}
});
test('trace payload excludes secrets, identities, packet bodies and hashes',()=>{
 globalThis.__diceTailTrace=[];tailEvent('send-enqueue','test-roll',{type:'chunk',bytes:70,current:true,publicKey:'secret',session:'secret',data:'secret',hash:'secret',room:'secret',source:'secret',name:'secret'});assert.deepEqual(globalThis.__diceTailTrace[0].state,{type:'chunk',bytes:70,current:true});delete globalThis.__diceTailTrace;
});
test('tail browser remains bounded and drops an actual final fragment',()=>{
 const source=readFileSync('tools/dice-latency-browser.mjs','utf8');assert.match(source,/mode==='lost-last-chunk'/);assert.match(source,/packet\.data\.index===totals\.get\(packet\.data\.id\)-1/);assert.match(source,/cold-first-1d20/);assert.match(source,/warm-1d6/);assert.match(source,/warm-9d6/);assert.match(source,/tail-drop-last-1d6/);assert.match(source,/validateTailCase/);
});

test('inventory protects real tools build dependencies and non-diagnostic workflows by default',()=>{
 const row=(hash,file)=>`100644 blob ${hash}\t${file}\0`;
 const baseline=row('a','tools/workbench-dice3d-vite.ts')+row('b','.github/workflows/verify-suite.yml')+row('c','中文路径.ts');
 assert.deepEqual(protectedTailInventory(baseline+row('d','tools/dice-tail-trace.mjs')),protectedTailInventory(baseline));
 assert.notDeepEqual(protectedTailInventory(baseline.replace('blob a','blob z')),protectedTailInventory(baseline));
 assert.equal(protectedTailInventory(baseline).length,3);
});

test('SDK observer returns the original Promise and preserves captured origin timestamps',()=>{
 const transformed=instrumentTail(readFileSync('src/workbench/dice-broadcast.ts','utf8'),resolve('src/workbench/dice-broadcast.ts'));
 assert.match(transformed,/const result=OBR\.broadcast\.sendMessage/);assert.match(transformed,/return result;},valid/);assert.doesNotMatch(transformed,/queue\.send\(async|await OBR\.broadcast/);assert.match(transformed,/void result\.then/);
 globalThis.__diceTailTrace=[];tailEvent('renderer-gl-return','test-roll',{glReturnMs:3},123456);assert.equal(globalThis.__diceTailTrace[0].at,123456);delete globalThis.__diceTailTrace;
});
