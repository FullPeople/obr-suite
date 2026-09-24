import {build} from 'rolldown';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const output=resolve(process.env.WORKBENCH_TEST_OUTPUT||'workbench-test-output/proxy178');mkdirSync(output,{recursive:true});
for(const name of ['runtime-authority','merge'])await build({input:resolve(`src/workbench/${name}.ts`),output:{file:resolve(output,`${name}.mjs`),format:'esm'}});
const runtime=await import(pathToFileURL(resolve(output,'runtime-authority.mjs'))),merge=await import(pathToFileURL(resolve(output,'merge.mjs')));
// Use the installed SDK class, not an imitation of updateItems: this calls its
// own produceWithPatches and sends the same partial JSON values as production.
const sdkRequire=createRequire(resolve('node_modules/@owlbear-rodeo/sdk/package.json'));
const {default:SceneItemsApi}=await import(pathToFileURL(resolve('node_modules/@owlbear-rodeo/sdk/lib/api/scene/SceneItemsApi.js')));
const immerPackagePath=sdkRequire.resolve('immer/package.json'),immerPackage=JSON.parse(readFileSync(immerPackagePath,'utf8'));
const {produceWithPatches,isDraft}=await import(pathToFileURL(resolve(dirname(immerPackagePath),immerPackage.exports['.'].import.default)));
const versions={sdk:JSON.parse(readFileSync(resolve('node_modules/@owlbear-rodeo/sdk/package.json'),'utf8')).version,immer:immerPackage.version};
const HP='com.obr-suite/bubbles/data',RES='com.obr-suite/resources/data',BUFF='com.obr-suite/status/buffs';
const initial={id:'hero-token',type:'IMAGE',metadata:{[HP]:{health:20,'max health':30,'temporary health':0,'armor class':15},[RES]:[{id:'points',name:'Points',current:2,max:3,style:{color:'#444',marks:[true,false]}}],[BUFF]:['poisoned']}};
let token=structuredClone(initial),sends=[];
const api=new SceneItemsApi({sendAsync:async(type,data)=>{
 if(type==='OBR_SCENE_ITEMS_GET_ITEMS'||type==='OBR_SCENE_ITEMS_GET_ALL_ITEMS')return {items:[structuredClone(token)]};
 assert.equal(type,'OBR_SCENE_ITEMS_UPDATE_ITEMS');sends.push(structuredClone(data));token={...token,...structuredClone(data.updates[0])};return {};
}});
const results=[];async function test(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
const fallback={stats:{health:20,'max health':30,'temporary health':0,'armor class':15},resources:{},conditions:[]};

await test('177 failure reproduced at actual SDK draft resource clone',async()=>{
 await assert.rejects(api.updateItems(['hero-token'],items=>{assert(isDraft(items[0].metadata[RES][0]));items[0].metadata[RES].map(row=>structuredClone(row));}),e=>e.name==='DataCloneError');
 assert.equal(sends.length,0);
});
await test('token projection reads resources inside actual SDK updateItems',async()=>{
 let captured;await api.updateItems(['hero-token'],items=>{captured=runtime.tokenRuntime(items[0].metadata,fallback);captured.stats.health=17;items[0].metadata[HP]={...items[0].metadata[HP],...captured.stats};});
 assert.equal(token.metadata[HP].health,17);assert.equal(captured.resources.points.current,2);assert.deepEqual(structuredClone(captured.resources.points.style),{color:'#444',marks:[true,false]});
 captured.resources.points.style.marks[0]=false;assert.equal(token.metadata[RES][0].style.marks[0],true);
});
await test('a stamped character projection survives resource-bearing Proxy snapshots',async()=>{
 const next={...fallback,stats:{...fallback.stats,health:14},resources:{points:{...initial.metadata[RES][0],current:1}},conditions:[]};
 await api.updateItems(['hero-token'],items=>{const draft=items[0];const observed=runtime.tokenRuntime(draft.metadata,fallback);assert.equal(observed.stats.health,17);draft.metadata[RES]=Object.values(next.resources);draft.metadata[HP]={...draft.metadata[HP],...next.stats};draft.metadata[runtime.RUNTIME_BASELINE]={version:1,cardId:'hero',revision:5,value:next};});
 await api.updateItems(['hero-token'],items=>{const draft=items[0],observed=runtime.tokenRuntime(draft.metadata,fallback);const merged=runtime.mergeTokenRuntime(observed,observed,draft.metadata[runtime.RUNTIME_BASELINE],'hero',5);draft.metadata[HP].health=merged.stats.health-1;});
 assert.equal(token.metadata[HP].health,13);assert.equal(token.metadata[RES][0].current,1);
});
await test('monster live draft merging retains unrelated concurrent edits',async()=>{
 const before=structuredClone(token.metadata);before[RES]=[...before[RES],{id:'other',current:4,max:4}];token.metadata=structuredClone(before);token.metadata[RES][1].current=1;
 const next=structuredClone(before[RES]);next[0].current=0;
 await api.updateItems(['hero-token'],items=>{items[0].metadata=runtime.mergeMonsterMetadata(items[0].metadata,before,{stats:{'armor class':19},resources:next});});
 assert.equal(token.metadata[RES][0].current,0);assert.equal(token.metadata[RES][1].current,1);assert.equal(token.metadata[HP]['armor class'],19);
});
await test('document snapshots and merge additions detach nested draft values',async()=>{
 let snapshot,addition;const native={runtime:{hp:10,tempHp:0,resources:{r:{id:'r',current:2,max:3,style:{marks:[true]}}}},selections:[],spellSettings:{slots:{}}};
 produceWithPatches({document:{core_stats:{hp:{current:10,max:20,temp:0},ac:15},dnd_card_web:native},rows:[{id:'a',nested:{list:[1,2]}}]},draft=>{
  snapshot=runtime.writeRuntime(draft.document,runtime.documentRuntime(draft.document));addition=merge.applyPatch([],[],draft.rows,'metadata.resources');
 });
 assert.equal(structuredClone(snapshot).dnd_card_web.runtime.resources.r.current,2);assert.deepEqual(structuredClone(addition),[{id:'a',nested:{list:[1,2]}}]);
});
const times={base:'2026-09-23T13:06:27.221Z',before:'2026-09-23T13:06:31.019Z',after:'2026-09-23T13:06:33.577Z'};
for(const projected of [false,true])await test(`${projected?'projected':'full'} export timestamps do not conflict or undo a real edit`,()=>{
 const base={meta:{parsed_at:times.base},core_stats:{hp:{current:10,max:20}},dnd_card_web:{revision:8,updatedAt:times.base}},before={meta:{parsed_at:times.before},core_stats:{hp:{current:10,max:20}},dnd_card_web:{revision:6,updatedAt:times.before}},after={meta:{parsed_at:times.after},core_stats:{hp:{current:7,max:20}},dnd_card_web:{revision:7,updatedAt:times.after}};
 const result=projected?merge.applyProjectionPatch(base,before,after,{...before},'owlbear'):merge.applyPatch(base,before,after);
 assert.equal(result.core_stats.hp.current,7);assert.equal(result.meta.parsed_at,times.after);assert.equal(result.dnd_card_web.revision,8);
 const stale=structuredClone(after);stale.meta.parsed_at=times.base;const newest=structuredClone(base);newest.meta.parsed_at=times.after;
 assert.equal((projected?merge.applyProjectionPatch(newest,before,stale,before,'owlbear'):merge.applyPatch(newest,before,stale)).meta.parsed_at,times.after);
});
await test('actual HP and homebrew fields named parsed_at or revision remain conflict checked',()=>{
 for(const field of ['current','parsed_at','revision','updatedAt']){
  assert.throws(()=>merge.applyPatch({[field]:3},{[field]:1},{[field]:2},'metadata.resources[r]'),e=>e.diagnostic?.code==='MERGE_CONFLICT');
  assert.throws(()=>merge.applyProjectionPatch({[field]:3},{[field]:1},{[field]:2},{[field]:1},'native.selections[s].entry.raw'),e=>e.diagnostic?.code==='MERGE_CONFLICT');
 }
});
await test('host document revision cannot be overwritten by client bookkeeping',()=>{
 assert.equal(merge.applyProjectionPatch(8,6,100,6,'owlbear._suiteRevision'),8);
 assert.equal(merge.applyPatch(8,6,1,'_suiteRevision'),8);
 assert.deepEqual(merge.applyPatch({_suiteRevision:8,value:1},{_suiteRevision:8,value:1},{_suiteRevision:100,value:2}),{_suiteRevision:8,value:2});
 assert.deepEqual(merge.applyPatch({meta:{parsed_at:times.after}},{meta:{parsed_at:times.after}},{meta:{parsed_at:times.base}}),{meta:{parsed_at:times.after}});
});
writeFileSync(resolve(output,'results.json'),JSON.stringify({versions,at:new Date().toISOString(),results},null,2));
console.log(`${results.length} passed; SDK ${versions.sdk}, Immer ${versions.immer}`);
