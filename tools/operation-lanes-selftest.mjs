import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve('workbench-test-output/operation-lanes');mkdirSync(out,{recursive:true});
const file=resolve(out,'lanes.mjs');await build({input:'src/workbench/operation-lanes.ts',output:{file,format:'esm'}});
const {operationLanes}=await import(pathToFileURL(file).href);
const hold=()=>{let release;const promise=new Promise(resolve=>release=resolve);return{promise,release};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const cases=[];async function test(name,run){await run();cases.push(name);console.log('PASS '+name);}
await test('a slow character does not block another character or reverse edits on the same character',async()=>{
 const q=operationLanes(),wait=hold(),events=[];
 const a=q.run(['card:a'],async()=>{events.push('a1');await wait.promise;events.push('a1-done');});
 const a2=q.run(['card:a'],async()=>events.push('a2'));
 await q.run(['card:b'],async()=>events.push('b'));assert.deepEqual(events,['a1','b']);wait.release();await Promise.all([a,a2]);assert.deepEqual(events,['a1','b','a1-done','a2']);
});
await test('a multi-target operation waits for every conflicting lane without deadlocking reversed targets',async()=>{
 const q=operationLanes(),a=hold(),b=hold(),events=[];
 const first=q.run(['a'],()=>a.promise),second=q.run(['b'],()=>b.promise);
 const both=q.run(['b','a','b'],async()=>events.push('both'));
 const next=q.run(['a','b'],async()=>events.push('next'));a.release();await first;await tick();assert.deepEqual(events,[]);b.release();await Promise.all([second,both,next]);assert.deepEqual(events,['both','next']);
});
await test('room-wide writes wait for prior entities and prevent later entities from overtaking',async()=>{
 const q=operationLanes(),one=hold(),barrier=hold(),events=[];
 const first=q.run(['a'],async()=>{await one.promise;events.push('first');});
 const global=q.run(null,async()=>{events.push('global');await barrier.promise;});
 const next=q.run(['b'],async()=>events.push('next'));await tick();assert.deepEqual(events,[]);one.release();await first;await tick();assert.deepEqual(events,['first','global']);barrier.release();await Promise.all([global,next]);assert.deepEqual(events,['first','global','next']);
});
await test('failure and cancellation do not poison later work, including an exclusive barrier',async()=>{
 const q=operationLanes();await assert.rejects(q.run(['a'],async()=>{throw Error('cancelled');}),/cancelled/);assert.equal(await q.run(['a'],async()=>42),42);await assert.rejects(q.run(null,async()=>{throw Error('failed');}),/failed/);assert.equal(await q.run(['b'],async()=>7),7);
});
await test('queued work runs its own current permission check after an earlier edit finishes',async()=>{
 const q=operationLanes(),wait=hold();let allowed=true,writes=0;
 const first=q.run(['a'],()=>wait.promise);
 const next=q.run(['a'],async()=>{if(!allowed)throw Error('revoked');writes++;});allowed=false;wait.release();await first;await assert.rejects(next,/revoked/);assert.equal(writes,0);
});
console.log(JSON.stringify({controlled:true,passed:cases.length}));
