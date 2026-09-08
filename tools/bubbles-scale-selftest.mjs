// Actual setup/sync/build/teardown with real SDK builders, mocked host transport.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';

globalThis.window = new EventTarget();
const store = new Map();
globalThis.localStorage = {getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
const delay = ms => new Promise(done=>setTimeout(done,ms));
async function until(predicate,label){const end=Date.now()+1500;while(!predicate()){assert.ok(Date.now()<end,label);await delay(3);}}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const outputRoot=resolve(tmpdir()),out=mkdtempSync(join(outputRoot,'bubbles-scale-test-'));
const mutations = process.argv.includes('--mutations') ? [
  {name:'relative anchor omitted',from:'layoutAnchorSignature(layout, it.position),',to:'/* omitted relative anchor */'},
  {name:'world position causes move rebuilds',from:'point.x - tokenPosition.x',to:'point.x'},
  {name:'old session remains current',from:'session === own && own.ready && own.initialized',to:'own.ready && own.initialized'},
  {name:'late add skips cleanup',from:'await OBR.scene.local.deleteItems(toAdd.map((it) => it.id)).catch(() => {});',to:'/* late items survive */'},
  {name:'late add cleanup deletes newer session items',from:'toAdd.map((it) => it.id)',to:'(await OBR.scene.local.getItems()).map((it) => it.id)'},
  {name:'old read blocks new session worker',from:'if (syncOwner === own) {',to:'if (syncOwner) {'},
  {name:'stale initial GM snapshot overrides player event',from:'if (own.roleRevision === initialRoleRevision) role = next',to:'role = next'},
  {name:'stale initial ready snapshot overrides closed scene',from:'if (own.sceneRevision === initialSceneRevision) own.ready = ready',to:'own.ready = ready'},
  {name:'late shared font write skips final guard',from:'await OBR.scene.items.updateItems(targetIds, (drafts) => {\n      if (!shouldApply()) return;',to:'await OBR.scene.items.updateItems(targetIds, (drafts) => {'},
] : [];
let passed=0;
try {
  async function run(mutation){
    let mutationApplied=!mutation;
    const bundle=join(out,`${mutation?.name??'baseline'}.mjs`);
    await build({input:resolve('tools/bubbles-scale-selftest.entry.ts'),plugins:[{
      name:'bubbles-host-boundary',
      resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/bubbles-scale-sdk.ts');},
      transform(code,id){
        const path=id.replaceAll('\\','/');
        if(path.endsWith('/asset-base.ts'))code=code.replaceAll('import.meta.env.BASE_URL','"/"');
        if(mutation&&path.endsWith('/modules/bubbles/index.ts')){code=code.replaceAll('\r\n','\n');assert.ok(code.includes(mutation.from),`Mutation missing: ${mutation.name}`);code=code.replace(mutation.from,mutation.to);mutationApplied=true;}
        return code;
      },buildEnd(){assert.ok(mutationApplied);},
    }],output:{file:bundle,format:'esm'},logLevel:'silent'});
    const {fixture:f,setupBubbles,teardownBubbles}=await import(pathToFileURL(bundle).href);
    const token=()=>({id:'token',type:'IMAGE',layer:'CHARACTER',visible:true,createdUserId:'fixture-gm',position:{x:1000,y:1000},rotation:0,scale:{x:1,y:1},image:{width:150,height:300},grid:{dpi:150,offset:{x:75,y:150}},metadata:{'com.obr-suite/hp-bar/enabled':true,'com.obr-suite/bubbles/data':{health:30,'max health':40,'temporary health':0,'armor class':16,locked:false}}});
    const bg=()=>[...f.local.values()].find(it=>it.metadata['com.obr-suite/bubbles/role']==='hp-bg');
    async function fresh(overhead=false){await teardownBubbles();f.readGate=null;f.addGate=null;f.failNextAdd=false;f.ready=true;f.role='GM';f.local.clear();f.items=[token()];f.metadata={'com.obr-suite/bubbles/settings':{verticalOffset:-20,overheadMode:overhead}};store.clear();await setupBubbles();await until(()=>f.local.size===5,'initial actual SDK builders should add five objects');await delay(30);f.resetCounts();}
    async function changed(){f.emitItems();await delay(50);}
    async function check(name,fn){await fn();if(!mutation){passed++;console.log(`ok ${passed} - ${name}`);}}
    try {
      await check('initial builders retain inheritance/hit policy and no shader',async()=>{await fresh();assert.ok([...f.local.values()].every(it=>it.disableHit===true&&it.attachedTo==='token'&&it.disableAttachmentBehavior.includes('SCALE')&&it.disableAttachmentBehavior.includes('ROTATION')));assert.ok([...f.local.values()].every(it=>it.type!=='EFFECT'));assert.equal(f.counts.sharedWrites,0);});
      await check('twenty ordinary translations cause no local rebuild',async()=>{await fresh();for(let i=0;i<20;i++){f.items[0].position.x+=0.33333;f.items[0].position.y+=0.75;await changed();}assert.equal(f.counts.add,0);assert.equal(f.counts.remove,0);assert.equal(f.counts.update,0);assert.equal(f.counts.sharedWrites,0);});
      await check('unrelated scene events cause no visual writes',async()=>{await fresh();for(let i=0;i<40;i++)f.emitItems();await delay(65);assert.equal(f.counts.add,0);assert.equal(f.counts.remove,0);assert.equal(f.counts.update,0);});
      for(const overhead of [false,true])await check(`height-only resize rebuilds ${overhead?'overhead':'standard'} anchor once`,async()=>{await fresh(overhead);const oldY=bg().position.y;f.items[0].scale.y=2;await changed();assert.equal(bg().position.y,oldY+(overhead?-150:150));assert.equal(f.counts.add,1);assert.equal(f.counts.remove,1);assert.equal(f.local.size,5);await changed();assert.equal(f.counts.add,1);});
      await check('off-centre horizontal flip rebuilds correct anchor',async()=>{await fresh();f.items[0].grid.offset={x:0,y:0};await changed();const oldX=bg().position.x;f.resetCounts();f.items[0].scale.x=-1;await changed();assert.equal(bg().position.x,oldX-150);assert.equal(f.counts.add,1);});
      await check('off-centre quarter-turn rebuilds correct anchor',async()=>{await fresh();f.items[0].grid.offset={x:0,y:0};await changed();f.resetCounts();f.items[0].rotation=90;await changed();assert.equal(bg().position.x,777);assert.equal(bg().position.y,1183);assert.equal(f.counts.add,1);});
      await check('centred rotation preserves unchanged layout',async()=>{await fresh();f.items[0].rotation=90;await changed();assert.equal(f.counts.add,0);});
      await check('ordinary teardown removes items and all subscriptions',async()=>{await fresh();await teardownBubbles();assert.equal(f.local.size,0);assert.equal(f.listenerCount(),0);f.emitItems();await delay(40);assert.equal(f.local.size,0);});
      await check('delayed item read cannot rebuild after teardown',async()=>{await fresh();const gate=deferred();f.readGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.reads>0,'read must begin');await teardownBubbles();gate.resolve();f.readGate=null;await delay(70);assert.equal(f.local.size,0);assert.equal(f.counts.add,0);});
      await check('late local add is removed after teardown',async()=>{await fresh();const gate=deferred();f.addGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.add>0,'add must begin');await teardownBubbles();gate.resolve();f.addGate=null;await delay(70);assert.equal(f.local.size,0);});
      await check('scene-ready delay cannot resurrect after teardown',async()=>{await fresh();f.setReady(true);await teardownBubbles();await delay(320);assert.equal(f.local.size,0);assert.equal(f.counts.add,0);});
      await check('restart renders before an old read settles and rejects its result',async()=>{await fresh();const gate=deferred();f.readGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.reads>0,'old read must begin');await teardownBubbles();f.readGate=null;f.items=[{...token(),position:{x:1400,y:1000}}];await setupBubbles();await until(()=>f.local.size===5,'new session must render while old read is pending');const ids=[...f.local.keys()].sort();gate.resolve();await delay(70);assert.deepEqual([...f.local.keys()].sort(),ids);assert.equal(bg().position.x,1327);});
      await check('restart survives cleanup of an old pending add with same token id',async()=>{await fresh();const gate=deferred();f.addGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.add>0,'old add must begin');await teardownBubbles();f.addGate=null;f.items=[{...token(),position:{x:1400,y:1000}}];await setupBubbles();await until(()=>f.local.size===5,'new session must render while old add is pending');const ids=[...f.local.keys()].sort();gate.resolve();await delay(70);assert.deepEqual([...f.local.keys()].sort(),ids);assert.equal(bg().position.x,1327);});
      await check('closed scene rejects a pending read until next ready cycle',async()=>{await fresh();const gate=deferred();f.readGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.reads>0,'scene read must begin');f.setReady(false);gate.resolve();f.readGate=null;await delay(70);assert.equal(f.local.size,0);f.items=[token()];f.setReady(true);await until(()=>f.local.size===5,'next ready cycle restores current scene');});
      await check('role change rejects obsolete full-info render',async()=>{await fresh();f.items[0].createdUserId='another-player';f.items[0].metadata['com.obr-suite/bubbles/data'].locked=true;const gate=deferred();f.readGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.reads>0,'GM render read must begin');f.setRole('PLAYER');gate.resolve();f.readGate=null;await until(()=>f.local.size===0,'locked idle player should receive no full-info bar');assert.equal(f.counts.add,0);});
      await check('failed add retains prior items and retries only on a later real event',async()=>{await fresh();const ids=[...f.local.keys()].sort();f.failNextAdd=true;f.items[0].scale.y=2;await changed();assert.deepEqual([...f.local.keys()].sort(),ids);assert.equal(f.counts.add,1);await delay(80);assert.equal(f.counts.add,1);await changed();assert.equal(bg().position.y,1258);assert.equal(f.counts.add,2);assert.equal(f.local.size,5);});
      await check('role event during initial read overrides the stale GM snapshot',async()=>{await fresh();await teardownBubbles();f.items[0].createdUserId='another-player';f.items[0].metadata['com.obr-suite/bubbles/data'].locked=true;f.resetCounts();const gate=deferred();f.roleGate=gate.promise;const pending=setupBubbles();await until(()=>f.counts.roleReads>0,'initial role read must begin');f.setRole('PLAYER');gate.resolve();f.roleGate=null;await pending;await delay(65);assert.equal(f.local.size,0);assert.equal(f.counts.add,0);});
      await check('scene event during initial readiness read overrides the stale ready snapshot',async()=>{await fresh();await teardownBubbles();f.resetCounts();const gate=deferred();f.readyGate=gate.promise;const pending=setupBubbles();await until(()=>f.counts.readyReads>0,'initial ready read must begin');f.setReady(false);gate.resolve();f.readyGate=null;await pending;await delay(65);assert.equal(f.local.size,0);assert.equal(f.counts.add,0);});
      await check('unchanged player event does not discard an active geometry refresh',async()=>{await fresh();const gate=deferred();f.readGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.reads>0,'read must begin');f.setRole('GM');gate.resolve();f.readGate=null;await delay(65);assert.equal(bg().position.y,1258);assert.equal(f.counts.add,1);});
      for(const reason of ['teardown','role'])await check(`pending shared font callback is inert after ${reason}`,async()=>{await fresh();f.items[0].text={style:{fontSize:999}};const gate=deferred();f.sharedWriteGate=gate.promise;f.setMetadata({'com.obr-suite/bubbles/settings':{verticalOffset:-20,autoScaleText:true}});await until(()=>f.counts.sharedWrites>0,'font write must be dispatched');if(reason==='teardown')await teardownBubbles();else f.setRole('PLAYER');gate.resolve();f.sharedWriteGate=null;await delay(65);assert.equal(f.items[0].text.style.fontSize,999);});
    } finally {f.readGate=null;f.addGate=null;f.roleGate=null;f.readyGate=null;f.sharedWriteGate=null;await teardownBubbles();await delay(30);}
  }
  await run();
  for(const mutation of mutations){let rejected=false;try{await run(mutation);}catch(error){if(error.code!=='ERR_ASSERTION')throw new Error(`Mutation failed for an unexpected reason: ${mutation.name}`,{cause:error});rejected=true;console.log(`killed - ${mutation.name}`);}assert.ok(rejected,`Surviving mutation: ${mutation.name}`);}
  console.log(`${passed} behavior checks passed; ${mutations.length} source mutations rejected. Host rendering and gesture smoothness remain unverified.`);
} finally {assert.equal(dirname(out),outputRoot);rmSync(out,{recursive:true,force:true});}
