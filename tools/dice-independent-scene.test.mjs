import test from 'node:test';
import assert from 'node:assert/strict';
import {isIndependentSceneEmpty,waitForIndependentScene} from './dice-independent-scene.mjs';
const empty=()=>({clients:[0,1].map(()=>({renderer:{active:0},controller:{heldRolls:0,retainedUntil:0,queued:0,pending:false},workers:[{incumbents:0,bounds:0,kinds:0,groups:0}]}))});
test('requires both controllers, overlays and real worker snapshots to be empty',()=>{
 assert(isIndependentSceneEmpty(empty()));for(const value of [null,{}, {clients:[]}, {clients:[empty().clients[0]]}])assert(!isIndependentSceneEmpty(value));
 for(const field of ['heldRolls','retainedUntil','queued','pending']){const s=empty();s.clients[0].controller[field]=field==='pending'?true:1;assert(!isIndependentSceneEmpty(s),field);}
 for(const field of ['incumbents','bounds','kinds','groups']){const s=empty();s.clients[1].workers[0][field]=1;assert(!isIndependentSceneEmpty(s),field);}
 for(const mutate of [c=>delete c.controller,c=>c.workers=[],c=>delete c.workers[0].incumbents,c=>c.renderer.active=1]){const s=empty();mutate(s.clients[1]);assert(!isIndependentSceneEmpty(s));}
});
test('render-complete and result logs cannot release a held controller or worker body',async()=>{
 for(const retained of ['controller','worker']){const s=empty();s.events=[{event:'render-complete'}];s.results=[{total:20}];if(retained==='controller')s.clients[0].controller.heldRolls=1;else s.clients[1].workers[0].incumbents=1;let submitted=false;await assert.rejects(async()=>{await waitForIndependentScene(async()=>s,{timeoutMs:0});submitted=true;},/not observed empty/);assert.equal(submitted,false);}
});
test('next independent case becomes eligible only after observed physical retirement',async()=>{
 let reads=0;const seen=[];const result=await waitForIndependentScene(async()=>{const s=empty();reads++;if(reads===1)s.clients[0].controller.retainedUntil=1;if(reads===2)s.clients[0].workers[0].incumbents=1;seen.push(isIndependentSceneEmpty(s));return s;},{timeoutMs:1000,intervalMs:0});
 assert.deepEqual(seen,[false,false,true]);assert.equal(reads,3);assert(isIndependentSceneEmpty(result));assert(result.observedAt>0);
});
