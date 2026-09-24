import {build} from 'rolldown';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const file=resolve('workbench-test-output/inventory-sync.js');await build({input:resolve('src/workbench/inventory.ts'),output:{file,format:'esm'}});
const {inventoryDocuments,inventoryProjection,inventoryReflected}=await import(pathToFileURL(file));
const native=(selections=[],coins={gp:0})=>({selections,inventory:{coins}});
const entry=(id,kind='item')=>({id,name:id,english:id,kind,source:'TEST',raw:{weight:2},entries:['Test']});
const selection=(id,kind='item')=>({id,entry:entry(id,kind),quantity:1,level:1,equipped:false});
async function setup(selections=[]){let value={revision:0,data:null};const relay={send:async({sharedDocument:m})=>{if(m.operation==='write'){if(value.revision!==m.expected)throw Object.assign(Error('conflict'),{status:409});value={revision:value.revision+1,data:structuredClone(m.data)};}return structuredClone(value);}};const api=inventoryDocuments(relay,'test');await api.ensure([{id:'card:hero',name:'Hero',kind:'card',write:true,document:{dnd_card_web:native(selections)}}]);return {api,rows:async()=>(await api.read(true)).data.containers['card:hero'].items};}

const scene=await setup(),status=selection('suite-status:poisoned','condition');status.entry.raw._suiteStatusId='poisoned';
await scene.api.syncNative('card:hero',native([status]),native());
assert.equal((await scene.rows()).filter(r=>r.kind==='condition').length,0);
console.log('PASS a scene-only condition can be removed without inventing stock');

const own=await setup(),added=selection('wiki:poison','condition');
await own.api.syncNative('card:hero',native(),native([added]));
const hydrated=structuredClone(added);hydrated.entry.raw._suiteStatusId='poisoned';
await own.api.syncNative('card:hero',native([hydrated]),native());
await own.api.syncNative('card:hero',native([hydrated]),native());
assert.equal((await own.rows()).filter(r=>r.kind==='condition').length,0);
console.log('PASS adding and removing an annotated Wiki condition is repeatable');

const original=selection('sword'),items=await setup([original]),changed={...original,quantity:2};
await items.api.syncNative('card:hero',native([original]),native([changed]));
await items.api.syncNative('card:hero',native([original]),native([changed]));
assert.equal((await items.rows()).find(r=>r.id==='sword').quantity,2);
await items.api.syncNative('card:hero',native([changed]),native());
await items.api.syncNative('card:hero',native([changed]),native());
assert(!(await items.rows()).some(r=>r.id==='sword'));
await assert.rejects(()=>items.api.syncNative('card:hero',native([changed]),native([{...changed,quantity:3}])),/转移/);
console.log('PASS acknowledged item updates/removals are idempotent but moved-item edits stay rejected');

const repeat=await setup(),newItem=selection('new');
await repeat.api.syncNative('card:hero',native(),native([newItem],{gp:10}));
await repeat.api.syncNative('card:hero',native(),native([newItem],{gp:10}));
assert.equal((await repeat.rows()).filter(r=>r.id==='new').length,1);assert.equal((await repeat.rows()).find(r=>r.coin==='gp').quantity,10);
console.log('PASS retried additions and currency writes do not duplicate or fail');

const independent=await setup([original]);
await independent.api.syncNative('card:hero',native([original]),native([{...original,equipped:true}]));
await independent.api.syncNative('card:hero',native([original]),native([{...original,quantity:3}]));
const combined=(await independent.rows()).find(r=>r.id==='sword');assert.equal(combined.quantity,3);assert.equal(combined.equipped,true);
await assert.rejects(()=>independent.api.syncNative('card:hero',native([original]),native([{...original,quantity:4}])),/修改|更新/);
console.log('PASS independent fields merge and concurrent quantity edits remain conflicts');

const gift=selection('gift','condition');gift.entry.raw._suiteStatusId='poisoned';
const granted=await setup();const auth={gm:true,read:new Set(['card:hero']),write:new Set(['card:hero']),give:new Set(['card:hero'])};const grant=async(api,row)=>api.command({action:'add',operationId:crypto.randomUUID(),container:'card:hero',expected:{'card:hero':(await api.read(true)).data.containers['card:hero'].revision},row:{...row,kind:'condition',name:row.entry.name,revision:1,slot:0}},auth);await grant(granted.api,gift);const observed=selection('suite-status:poisoned','condition');observed.entry.raw._suiteStatusId='poisoned';
await granted.api.syncNative('card:hero',native([observed]),native());assert.equal((await granted.rows()).filter(r=>r.kind==='condition').length,0);
console.log('PASS clearing a received condition also retires its matching grant');
const exhaustion={...gift,level:4};const projected=await setup();await grant(projected.api,gift);const ledger=(await projected.api.read(true)).data,box=ledger.containers['card:hero'];assert(!inventoryReflected(native(),box,ledger.projections['card:hero']));const filled=native([gift]);assert(!inventoryReflected(filled,box,ledger.projections['card:hero']));filled.inventory.positions=Object.fromEntries(box.items.map(row=>[row.id,row.slot]));assert(inventoryReflected(filled,box,ledger.projections['card:hero']));
assert.equal(inventoryProjection({dnd_card_web:native([exhaustion])},box,['gift']).dnd_card_web.selections.find(r=>r.entry.id==='gift').level,4);
console.log('PASS inventory projection preserves runtime condition levels');

const imported=await setup([status]);assert(!(await imported.rows()).some(r=>r.kind==='condition'));console.log('PASS importing runtime states does not allocate inventory slots');

const alias={...observed,level:4},aliasedDoc={dnd_card_web:native([alias]),web_conditions:[alias.entry]};
const grantedDoc=inventoryProjection(aliasedDoc,box,['gift'],[gift.entry]);
assert.equal(grantedDoc.dnd_card_web.selections.filter(s=>s.entry.kind==='condition').length,1);assert.equal(grantedDoc.dnd_card_web.selections.find(s=>s.entry.kind==='condition').level,4);
const emptyBox={...box,items:box.items.filter(row=>row.kind!=='condition')};
const clearedDoc=inventoryProjection(aliasedDoc,emptyBox,['gift'],[gift.entry]);
assert.equal(clearedDoc.dnd_card_web.selections.length,0);assert.equal(clearedDoc.web_conditions.length,0);
console.log('PASS aliased grants project and retire one runtime state without resetting levels');
