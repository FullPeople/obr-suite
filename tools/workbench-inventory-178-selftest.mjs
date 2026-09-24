import {build} from 'rolldown';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=resolve(process.env.WORKBENCH_TEST_OUTPUT||'workbench-test-output/inventory178');mkdirSync(out,{recursive:true});
for(const name of ['inventory','merge'])await build({input:resolve(`src/workbench/${name}.ts`),output:{file:resolve(out,name+'.mjs'),format:'esm'}});
const {inventoryDocuments,nativeInventoryChanged,inventoryProjection,inventoryReflected}=await import(pathToFileURL(resolve(out,'inventory.mjs')));
const {applyProjectionPatch}=await import(pathToFileURL(resolve(out,'merge.mjs')));
const results=[];async function test(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
const selection=(id,kind='item')=>({id,entry:{id,kind,name:id,entries:['test'],raw:{weight:2}},quantity:1,equipped:false,attuned:false,level:1});
const native=(rows=[])=>({selections:rows,inventory:{coins:{gp:3}},runtime:{hp:20,tempHp:0,resources:{}},abilities:{str:10},portrait:{data:'small-image'},revision:1});
const sword=selection('sword'),potion=selection('potion'),old=native([sword,potion]);

await test('cold no-op path performs zero ledger calls for HP, resources, portrait, ability and feature changes',async()=>{
 let calls=0;const api=inventoryDocuments({send:async()=>{calls++;throw Error('Unrelated edit must not access the ledger');}},'noop');
 const changes=[{runtime:{...old.runtime,hp:7}},{runtime:{...old.runtime,resources:{r:{current:1,max:3}}}},{portrait:{data:'another-image'}},{abilities:{str:18}},{selections:[...old.selections,selection('class-feature','feature')]},{selections:[...old.selections,selection('poisoned','condition')]},{selections:[...old.selections].reverse()}];
 for(const patch of changes){const after={...structuredClone(old),...patch,revision:2};assert.equal(nativeInventoryChanged(old,after),false);assert.deepEqual(await api.syncNative('card:hero',old,after),{});}
 assert.equal(calls,0);
});
await test('condition identity and missing defaults distinguish actual removals from presentation changes',()=>{
 const condition=selection('poison','condition'),before=native([condition]),after=structuredClone(before);after.selections[0].id='new-runtime-row';after.selections[0].level=5;after.selections[0].entry.id='other-data-source';
 const identify=()=> 'poisoned';assert.equal(nativeInventoryChanged(before,after,identify),false);assert.equal(nativeInventoryChanged(before,native(),identify),true);
 const sparse=native([{id:'sword',entry:sword.entry}]);assert.equal(nativeInventoryChanged(sparse,native([sword])),false);
 assert.equal(nativeInventoryChanged({...old,inventory:{}},{...old,inventory:{coins:{gp:0}}}),false);
});
await test('all stock fields, item identity and supported coins trigger ledger synchronization',()=>{
 for(const field of ['quantity','equipped','attuned','entry','id']){const after=structuredClone(old);after.selections[0][field]=field==='quantity'?2:field==='entry'?{...sword.entry,name:'renamed'}:field==='id'?'other-id':true;assert(nativeInventoryChanged(old,after),field);}
 for(const coin of ['cp','sp','ep','gp','pp']){const after=structuredClone(old);after.inventory.coins[coin]=7;assert(nativeInventoryChanged(old,after),coin);}
 assert(nativeInventoryChanged(old,native([sword])));assert(nativeInventoryChanged(old,native([...old.selections,selection('new')])));
});

let stored={revision:0,data:null},reads=0,writes=0;
const relay={send:async({sharedDocument:m})=>{if(m.operation==='read'){reads++;return structuredClone(stored);}writes++;if(m.expected!==stored.revision)throw Object.assign(Error('CAS conflict'),{status:409});stored={revision:stored.revision+1,data:structuredClone(m.data)};return structuredClone(stored);}};
const local=inventoryDocuments(relay,'race'),remote=inventoryDocuments(relay,'race');
await local.ensure([{id:'card:hero',name:'Hero',kind:'card',write:true,document:{dnd_card_web:old}},{id:'public',name:'Public',kind:'public',write:true}]);
const auth={gm:true,read:new Set(['card:hero','public']),write:new Set(['card:hero','public']),give:new Set(['card:hero','public'])};
await test('unrelated save after a concurrent transfer neither reads stock nor resurrects it nor clears its projection',async()=>{
 const live=await remote.read(true);await remote.command({action:'transfer',operationId:'remote-transfer',from:'card:hero',to:'public',expected:{'card:hero':live.data.containers['card:hero'].revision},rows:[{id:'sword',quantity:1,newId:'moved-sword'}]},auth);
 const ledgerBefore=structuredClone(stored),count={reads,writes},after={...structuredClone(old),runtime:{...old.runtime,hp:7}};
 assert.deepEqual(await local.syncNative('card:hero',old,after),{});assert.deepEqual({reads,writes},count);assert.deepEqual(stored,ledgerBefore);
 assert(!stored.data.containers['card:hero'].items.some(row=>row.id==='sword'));assert(stored.data.containers.public.items.some(row=>row.id==='moved-sword'));
 const box=stored.data.containers['card:hero'],projection=stored.data.projections['card:hero'];assert(projection);assert(!inventoryReflected(after,box,projection));
 // Transfer still pending: the document save retains HP and the pending ledger
 // projection subsequently removes the old stock. It is never acknowledged by
 // a no-op save. Transfer already projected: the three-way save retains removal.
 const pending=applyProjectionPatch(old,old,after,old,'native'),projected=inventoryProjection({dnd_card_web:pending},box,projection.conditions,projection.entries).dnd_card_web;
 assert.equal(projected.runtime.hp,7);assert(!projected.selections.some(row=>row.id==='sword'));
 const remoteDoc=inventoryProjection({dnd_card_web:old},box,projection.conditions,projection.entries).dnd_card_web;
 const merged=applyProjectionPatch(remoteDoc,old,after,old,'native');assert.equal(merged.runtime.hp,7);assert(!merged.selections.some(row=>row.id==='sword'));
});
await test('pending grants survive a local non-inventory save and are applied afterward',async()=>{
 const condition=selection('poison-grant','condition');condition.entry.raw._suiteStatusId='poisoned';const live=await remote.read(true);
 await remote.command({action:'add',operationId:'grant-condition',container:'card:hero',expected:{'card:hero':live.data.containers['card:hero'].revision},row:{...condition,name:condition.entry.name,kind:'condition',slot:8,revision:1}},auth);
 const ledgerBefore=structuredClone(stored),count={reads,writes},after={...structuredClone(old),abilities:{str:18}};assert.deepEqual(await local.syncNative('card:hero',old,after),{});assert.deepEqual({reads,writes},count);assert.deepEqual(stored,ledgerBefore);
 const box=stored.data.containers['card:hero'],projection=stored.data.projections['card:hero'];const projected=inventoryProjection({dnd_card_web:after},box,projection.conditions,projection.entries).dnd_card_web;
 assert.equal(projected.abilities.str,18);assert(projected.selections.some(row=>row.entry.raw?._suiteStatusId==='poisoned'));assert(!projected.selections.some(row=>row.id==='sword'));
});
await test('real inventory edits still read latest authority and reject editing transferred stock',async()=>{
 const after=structuredClone(old);after.selections[0].quantity=3;const count={reads,writes};await assert.rejects(local.syncNative('card:hero',old,after),/转移/);assert(reads>count.reads);assert.equal(writes,count.writes);
 const next=structuredClone(old);next.selections[1].quantity=2;const result=await local.syncNative('card:hero',old,next);assert(Number.isInteger(result.ledgerRevision));assert.equal(result.container.items.find(row=>row.id==='potion').quantity,2);assert(!result.container.items.some(row=>row.id==='sword'));assert(result.projection);
});
await test('removing an aliased runtime status still retires its ledger grant',async()=>{
 const alias=selection('suite-runtime:poisoned','condition');alias.entry.raw._suiteStatusId='poisoned';const result=await local.syncNative('card:hero',native([alias]),native());assert(Number.isInteger(result.ledgerRevision));assert(!result.container.items.some(row=>row.kind==='condition'));
});
writeFileSync(resolve(out,'results.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(`${results.length} passed`);
