// Actual Bubbles setup/build/teardown with real SDK builders and host transport fixture.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
globalThis.window=new EventTarget();
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const out=mkdtempSync(join(tmpdir(),'boss-bubbles-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const settle=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const until=async(fn,label)=>{const end=Date.now()+1800;while(!fn()){assert.ok(Date.now()<end,label);await delay(3);}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const root=process.cwd();let checks=0;
try{
 const file=join(out,'entry.mjs');
 await build({input:'boss-bubbles-entry',plugins:[{name:'boundary',resolveId(id){if(id==='boss-bubbles-entry')return id;if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/bubbles-scale-sdk.ts');},load(id){if(id==='boss-bubbles-entry')return `export {setupBubbles,teardownBubbles} from ${JSON.stringify(resolve('src/modules/bubbles/index.ts'))};export * from ${JSON.stringify(resolve('src/modules/bossBar/suppression.ts'))};export {fixture} from ${JSON.stringify(resolve('tools/fixtures/bubbles-scale-sdk.ts'))};`;},transform(code,id){if(id.replaceAll('\\','/').endsWith('/asset-base.ts'))return code.replaceAll('import.meta.env.BASE_URL','"/"');}}],output:{file,format:'esm'},logLevel:'silent'});
 const {fixture:f,setupBubbles,teardownBubbles,setPresentedBosses}=await import(pathToFileURL(file).href);
 const token=id=>({id,type:'IMAGE',layer:'CHARACTER',visible:true,createdUserId:'fixture-gm',position:{x:1000,y:1000},rotation:0,scale:{x:1,y:1},image:{width:150,height:300},grid:{dpi:150,offset:{x:75,y:150}},metadata:{'com.obr-suite/hp-bar/enabled':true,'com.obr-suite/bubbles/data':{health:30,'max health':40,'armor class':16,locked:false}}});
 const owned=id=>[...f.local.values()].filter(it=>it.metadata['com.obr-suite/bubbles/owner']===id);
 const hasHp=id=>owned(id).some(it=>it.metadata['com.obr-suite/bubbles/role'].startsWith('hp-'));
 try{
  f.ready=true;f.role='GM';f.items=[token('boss'),token('ordinary')];f.metadata={};await setupBubbles();await until(()=>f.local.size===10,'initial ten actual builder items');await delay(30);f.resetCounts();checks++;
  setPresentedBosses(['boss']);await until(()=>owned('boss').length===2,'Boss HP hidden, AC retained');assert.equal(hasHp('boss'),false);assert.equal(owned('ordinary').length,5);assert.equal(f.counts.sharedWrites,0);checks++;
  await delay(30);f.resetCounts();for(let i=0;i<100;i++)setPresentedBosses(['boss']);await delay(40);assert.equal(f.counts.add,0);assert.equal(f.counts.remove,0);assert.equal(f.counts.sharedWrites,0);checks++;
  setPresentedBosses([]);await until(()=>owned('boss').length===5,'normal HP restored');checks++;
  await delay(30);f.resetCounts();const gate=deferred();f.addGate=gate.promise;f.items[0].scale.y=2;f.emitItems();await until(()=>f.counts.add>0,'old normal-bar add dispatched');setPresentedBosses(['boss']);gate.resolve();f.addGate=null;await settle();
  await until(()=>owned('boss').length===2,'old render cannot restore duplicate HP');assert.equal(hasHp('boss'),false);assert.equal(owned('ordinary').length,5);checks++;
  await teardownBubbles();assert.equal(f.local.size,0);assert.equal(f.listenerCount(),0);setPresentedBosses([]);await delay(45);assert.equal(f.local.size,0);checks++;
 }finally{f.addGate=null;await teardownBubbles();setPresentedBosses([]);}
 console.log(`${checks} actual-builder Boss/ordinary-bar integration checks passed; no host rendering claim.`);
}finally{rmSync(out,{recursive:true,force:true});}
