// Real IndexedDB transactions with authored packs; no room or player data.
import {build} from 'rolldown';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('..',import.meta.url));
const sourceRoot=process.env.DND_LOCAL_CONTENT_ROOT||root;
const compiled=await build({input:'probe',plugins:[{name:'local-content-probe',resolveId(id){if(id==='probe')return '\0probe';},load(id){if(id==='\0probe')return `import * as api from ${JSON.stringify(resolve(sourceRoot,'src/utils/localContent.ts'))}; window.api=api;`;}}],output:{format:'esm'},logLevel:'silent'});
const script=compiled.output.find(row=>row.type==='chunk').code;
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/probe.js'?'text/javascript':'text/html');response.end(request.url==='/probe.js'?script:'<script type="module" src="/probe.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:process.env.CI?undefined:'msedge'});
const failures=[];let passed=0;
const pack=version=>({monster:[{name:`Authored ${version}`,source:'CACHE',hp:{average:version},entries:['Authored cache fixture.']}]});
const md=version=>`---\nname: Authored ${version}\nsource: CACHE\nhp: ${version}\n---\n## Traits\n### Authored\nOriginal fixture.\n`;
async function open(context){const page=await context.newPage();await page.goto(base);await page.waitForFunction(()=>window.api);await page.evaluate(()=>window.api.initLocalContent());return page;}
async function snapshot(page){return page.evaluate(async()=>{await window.api.initLocalContent();const request=indexedDB.open('obr-suite'),db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});let fileKeys;try{fileKeys=await new Promise((resolve,reject)=>{const get=db.transaction('local-content').objectStore('local-content').getAllKeys();get.onsuccess=()=>resolve(get.result.filter(key=>String(key).startsWith('file:')).sort());get.onerror=()=>reject(get.error);});}finally{db.close();}return {files:window.api.getLocalFiles(),rows:window.api.getLocalIndexFile().x,monsters:window.api.getAllLocalMonsters(),fileKeys};});}
async function run(name,work){const context=await browser.newContext();try{await work(context);passed++;console.log('PASS '+name);}catch(error){failures.push({name,error:String(error)});console.error('FAIL '+name+': '+String(error));}finally{await context.close();}}
try{
 for(const method of ['json','md','remote'])for(const fault of [...['file','index'],...(method==='remote'?['subscriptions']:[]),'abort']){
  await run(`${method} replacement preserves the exact previous pack on ${fault} failure`,async context=>{
   let version=1;await context.route('https://cache.test/**',route=>route.fulfill({json:pack(version),headers:{'access-control-allow-origin':'*'}}));
   const page=await open(context);
   assert.equal((await page.evaluate(data=>window.api.importLocalJson('unrelated.json',JSON.stringify(data)),{monster:[{name:'Keep unrelated',source:'KEEP'}]})).ok,true);
   const submit=()=>page.evaluate(async({method,json,markdown})=>method==='json'?window.api.importLocalJson('authored.json',json):method==='md'?window.api.importLocalMd('authored.md',markdown):(window.api.getRemoteSubscriptions().length?window.api.refreshRemoteSubscription('https://cache.test/pack.json'):window.api.addRemoteSubscription('https://cache.test/pack.json')),{method,json:JSON.stringify(pack(version)),markdown:md(version)});
   assert.equal((await submit()).ok,true);const before=await snapshot(page),oldId=before.files.find(row=>row.filename!=='unrelated.json').id;
   await page.evaluate(fault=>{const original=IDBObjectStore.prototype.put;window.restorePut=()=>{IDBObjectStore.prototype.put=original;};IDBObjectStore.prototype.put=function(value,key){const matches=fault==='file'?String(key).startsWith('file:'):String(key)===(fault==='abort'?'index':fault);if(matches){if(fault==='abort'){const request=original.call(this,value,key);this.transaction.abort();return request;}throw new DOMException('Authored storage failure','QuotaExceededError');}return original.call(this,value,key);};},fault);
   version=2;const result=await submit();await page.evaluate(()=>window.restorePut());const failed=await snapshot(page);
   await page.reload();await page.waitForFunction(()=>window.api);const reopened=await snapshot(page);
   assert.equal(result.ok,false,'a failed durable update must report failure');assert.deepEqual(failed,before,'in-memory original must remain intact');assert.deepEqual(reopened,before,'original must survive reopening');
   version=3;assert.equal((await submit()).ok,true);const recovered=await snapshot(page);assert.equal(recovered.files.length,2);assert.deepEqual(recovered.files.find(row=>row.filename==='unrelated.json'),before.files.find(row=>row.filename==='unrelated.json'));assert.deepEqual(recovered.monsters.map(row=>row.name).sort(),['Authored 3','Keep unrelated']);
   if(method==='remote'){assert.equal(recovered.files.find(row=>row.filename!=='unrelated.json').id,oldId,'remote file identity must stay stable');assert.equal((await page.evaluate(()=>window.api.addRemoteSubscription('https://cache.test/pack.json'))).ok,false);}
  });
 }
 for(const reason of ['network','json','unsupported'])await run(`rejected ${reason} refresh preserves the cached pack and retry receipt`,async context=>{
  let failure=false;await context.route('https://cache.test/**',route=>!failure?route.fulfill({json:pack(1),headers:{'access-control-allow-origin':'*'}}):reason==='network'?route.fulfill({status:503,body:'Authored unavailable',headers:{'access-control-allow-origin':'*'}}):reason==='json'?route.fulfill({body:'{',contentType:'application/json',headers:{'access-control-allow-origin':'*'}}):route.fulfill({json:{unrecognized:[]},headers:{'access-control-allow-origin':'*'}}));
  const page=await open(context);assert.equal((await page.evaluate(()=>window.api.addRemoteSubscription('https://cache.test/pack.json'))).ok,true);const before=await snapshot(page);failure=true;
  const rejected=await page.evaluate(()=>window.api.refreshRemoteSubscription('https://cache.test/pack.json'));assert.equal(rejected.ok,false);assert.deepEqual(await snapshot(page),before);
  await page.reload();await page.waitForFunction(()=>window.api);assert.deepEqual(await snapshot(page),before);assert((await page.evaluate(()=>window.api.getRemoteSubscriptions()))[0].lastError);
  failure=false;assert.equal((await page.evaluate(()=>window.api.refreshRemoteSubscription('https://cache.test/pack.json'))).ok,true);assert.equal((await page.evaluate(()=>window.api.getRemoteSubscriptions()))[0].lastError,undefined);
 });
 await run('parallel windows preserve both independently imported packs',async context=>{
  const a=await open(context),b=await open(context);
  const outcomes=await Promise.all([a.evaluate(data=>window.api.importLocalJson('a.json',JSON.stringify(data)),pack(1)),b.evaluate(data=>window.api.importLocalJson('b.json',JSON.stringify(data)),pack(2))]);assert(outcomes.every(row=>row.ok));
  await a.reload();await a.waitForFunction(()=>window.api);assert.deepEqual((await snapshot(a)).monsters.map(row=>row.name).sort(),['Authored 1','Authored 2']);
  // This view has not reloaded the second pack; removal must read durable metadata.
  const stale=await open(context),peer=await open(context);const prior=(await snapshot(stale)).files.find(row=>row.filename==='a.json').id;
  assert.equal((await peer.evaluate(data=>window.api.importLocalJson('c.json',JSON.stringify(data)),pack(3))).ok,true);await stale.evaluate(id=>window.api.removeLocalFile(id),prior);
  await stale.reload();await stale.waitForFunction(()=>window.api);assert.deepEqual((await snapshot(stale)).monsters.map(row=>row.name).sort(),['Authored 2','Authored 3']);
 });
 await run('parallel subscriptions retain successful and failed rows',async context=>{
  await context.route('https://cache.test/**',route=>route.request().url().endsWith('/bad.json')?route.fulfill({status:503,body:'Authored unavailable'}):route.fulfill({json:pack(1),headers:{'access-control-allow-origin':'*'}}));
  const a=await open(context),b=await open(context);const outcomes=await Promise.all([a.evaluate(()=>window.api.addRemoteSubscription('https://cache.test/good.json')),b.evaluate(()=>window.api.addRemoteSubscription('https://cache.test/bad.json'))]);assert.equal(outcomes[0].ok,true);assert.equal(outcomes[1].ok,false);
  await a.reload();await a.waitForFunction(()=>window.api);await snapshot(a);const subs=await a.evaluate(()=>window.api.getRemoteSubscriptions());assert.equal(subs.length,2);assert(subs.find(row=>row.url.endsWith('/bad.json')).lastError);assert.deepEqual((await snapshot(a)).monsters.map(row=>row.name),['Authored 1']);
 });
 await run('an in-flight refresh cannot recreate a removed subscription',async context=>{
  let block=false,release,requested;const started=new Promise(resolve=>{requested=resolve;});
  await context.route('https://cache.test/**',async route=>{if(block){requested();await new Promise(resolve=>{release=resolve;});}await route.fulfill({json:pack(block?2:1),headers:{'access-control-allow-origin':'*'}});});
  const page=await open(context);assert.equal((await page.evaluate(()=>window.api.addRemoteSubscription('https://cache.test/pack.json'))).ok,true);block=true;
  const refresh=page.evaluate(()=>window.api.refreshRemoteSubscription('https://cache.test/pack.json'));await started;await page.evaluate(()=>window.api.removeRemoteSubscription('https://cache.test/pack.json'));release();assert.equal((await refresh).ok,false);
  await page.reload();await page.waitForFunction(()=>window.api);assert.equal((await snapshot(page)).files.length,0);assert.equal((await page.evaluate(()=>window.api.getRemoteSubscriptions())).length,0);
 });
 assert.equal(failures.length,0,JSON.stringify(failures));console.log(`${passed} local-content storage flows passed`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
