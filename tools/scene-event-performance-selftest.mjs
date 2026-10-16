import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'rolldown';

const out=resolve('workbench-test-output/scene-event-performance');mkdirSync(out,{recursive:true});
const source=readFileSync('src/modules/initiative/index.ts','utf8').replaceAll('\r\n','\n');
const start=source.indexOf('OBR.scene.items.onChange(async (sceneItems) => {');
const end=source.indexOf('\n      })\n    );',start);
assert(start>0&&end>start,'Production initiative callback boundary changed');
const callback=source.slice(start,end+'\n      })'.length);
const entry=resolve(out,'initiative.ts'),file=resolve(out,'initiative.mjs');
writeFileSync(entry,`export function create(ctx:any){const {OBR,getDragInAutoEnabled,rollLightInitiative}=ctx;const COMBAT_STATE_KEY='combat',METADATA_KEY='initiative',OPTED_OUT_KEY='optout',INIT_DEXMOD_META='dex',WORKBENCH_DEV=true,lastLang='en',t=()=>'';let knownItemIds=new Set<string>(ctx.known),dragInDetectorReady=ctx.ready;${callback};return{known:()=>[...knownItemIds]};}`);
await build({input:entry,output:{file,format:'esm'}});
const {create}=await import(pathToFileURL(file).href);
const token=(id,extra={})=>({id,type:'IMAGE',layer:'CHARACTER',metadata:{},...extra});
function fixture({known=['one'],ready=true,combat=true,auto=true}={}){
 let callback;const calls={reads:0,rolls:[]};
 const ctx={known,ready,getDragInAutoEnabled:()=>auto,rollLightInitiative:async id=>calls.rolls.push(id),OBR:{scene:{getMetadata:async()=>{calls.reads++;return{combat:{inCombat:combat}};},items:{onChange:fn=>{callback=fn;return()=>{};}}}}};
 const state=create(ctx);return{calls,state,emit:items=>callback(items)};
}
const cases=[];
async function test(name,run){await run();cases.push(name);console.log('PASS '+name);}
await test('HP, resources, movement and unrelated shapes issue zero scene metadata RPCs',async()=>{
 const f=fixture();for(let i=0;i<24;i++)await f.emit([token('one',{position:{x:i,y:0},metadata:{hp:i}}),{id:'shape',type:'SHAPE',layer:'PROP',metadata:{seq:i}}]);
 assert.equal(f.calls.reads,0);assert.deepEqual(f.calls.rolls,[]);
});
await test('removal updates the baseline; an inactive-combat re-add is remembered without rolling',async()=>{
 const f=fixture({combat:false});await f.emit([]);assert.deepEqual(f.state.known(),[]);await f.emit([token('one')]);assert.equal(f.calls.reads,1);assert.deepEqual(f.calls.rolls,[]);await f.emit([token('one')]);assert.equal(f.calls.reads,1);
});
await test('a genuine new character during combat rolls once, retaining existing participants',async()=>{
 const f=fixture();await f.emit([token('one'),token('two')]);await f.emit([token('one'),token('two')]);assert.deepEqual(f.calls.rolls,['two']);assert.equal(f.calls.reads,1);
});
await test('a cold scene snapshot never auto-rolls its existing characters',async()=>{
 const f=fixture({known:[],ready:false});await f.emit([token('one'),token('two')]);assert.deepEqual(f.calls.rolls,[]);assert.deepEqual(f.state.known(),['one','two']);
});
await test('disabled auto-add and opted-out tokens remain excluded when later events arrive',async()=>{
 const disabled=fixture({auto:false});await disabled.emit([token('one'),token('two')]);await disabled.emit([token('one'),token('two')]);assert.deepEqual(disabled.calls.rolls,[]);
 const opted=fixture();await opted.emit([token('one'),token('two',{metadata:{optout:true}})]);assert.deepEqual(opted.calls.rolls,[]);
});

const handlers={metadata:new Set(),ready:new Set()},calls={sceneReads:0,roomWrites:[]};
let scene={'com.character-cards/list':[{id:'first'}]},room={},enabled=true;
globalThis.__f7SceneSDK={scene:{isReady:async()=>true,getMetadata:async()=>{calls.sceneReads++;return scene;},setMetadata:async patch=>Object.assign(scene,patch),onMetadataChange:fn=>{handlers.metadata.add(fn);return()=>handlers.metadata.delete(fn);},onReadyChange:fn=>{handlers.ready.add(fn);return()=>handlers.ready.delete(fn);}},room:{getMetadata:async()=>room,setMetadata:async patch=>{calls.roomWrites.push(structuredClone(patch));Object.assign(room,patch);}}};
globalThis.__f7SceneState=()=>({crossSceneSyncCards:enabled});
const crossFile=resolve(out,'cross-scene.mjs');
await build({input:resolve('src/modules/cross-scene-cards.ts'),plugins:[{name:'event-boundary',resolveId(id,importer){if(id==='@owlbear-rodeo/sdk')return'virtual:sdk';if(id==='../state'&&importer?.endsWith('cross-scene-cards.ts'))return'virtual:state';},load(id){if(id==='virtual:sdk')return'export default globalThis.__f7SceneSDK';if(id==='virtual:state')return'export const getState=globalThis.__f7SceneState';}}],output:{file:crossFile,format:'esm'}});
const cross=await import(pathToFileURL(crossFile).href);
await cross.setupCrossSceneCards();calls.sceneReads=0;
const emit=async meta=>{for(const fn of handlers.metadata)await fn(meta);};
await test('scene events use their supplied metadata without a getter and retain the last card list',async()=>{
 await emit({...scene,unrelated:1});assert.equal(calls.sceneReads,0);assert.equal(calls.roomWrites.length,0);
 await emit({'com.character-cards/list':[{id:'second'}]});assert.equal(calls.sceneReads,0);assert.deepEqual(calls.roomWrites.at(-1),{'com.character-cards/list-room':[{id:'second'}]});
});
await test('intentional empty lists mirror once; disabled sync neither reads nor writes',async()=>{
 await emit({'com.character-cards/list':[]});const count=calls.roomWrites.length;await emit({'com.character-cards/list':[]});assert.equal(calls.roomWrites.length,count);assert.deepEqual(calls.roomWrites.at(-1),{'com.character-cards/list-room':[]});enabled=false;await emit({'com.character-cards/list':[{id:'ignored'}]});assert.equal(calls.roomWrites.length,count);assert.equal(calls.sceneReads,0);
});
await cross.teardownCrossSceneCards();assert.equal(handlers.metadata.size,0);assert.equal(handlers.ready.size,0);
writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:cases.length,cases,realOwlbear:false},null,2)+'\n');
