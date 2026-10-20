// Authored collections exercise the actual catalog and selected-token reader.
import {build} from 'rolldown';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const web=process.env.DND_CARD_WEB_ROOT||resolve(root,'../web');
const {chromium}=createRequire(resolve(web,'package.json'))('@playwright/test');
const result=await build({input:'probe',plugins:[{
 name:'homebrew-fixture',resolveId(id,importer){
  if(id==='probe')return '\0probe';
  if(!/\/bestiary\/(?:data|detail-data)\.ts$/.test(importer?.replaceAll('\\','/')??''))return;
  if(id==='../../state')return '\0state';
  if(id==='../../utils/localContent')return '\0local';
  if(id==='./contentCache')return '\0cache';
 },load(id){
  if(id==='\0probe')return `import {loadAllMonsters,clearMonsterCache} from ${JSON.stringify(resolve(root,'src/modules/bestiary/data.ts'))};import {fetchLocalizedMonster,clearMonsterDetailCache} from ${JSON.stringify(resolve(root,'src/modules/bestiary/detail-data.ts'))};import {collectionMonsterSearchIndex} from ${JSON.stringify(resolve(root,'src/utils/monsterSourceIndex.ts'))};window.reload=async()=>{clearMonsterCache();let progress;const rows=await loadAllMonsters(p=>progress=p);return {rows,progress};};window.detail=(slug='BREW::Variant')=>{clearMonsterDetailCache();return fetchLocalizedMonster(slug);};window.sourceSearch=async()=>{const failures=[];const idx=await collectionMonsterSearchIndex({indexPath:'_generated/index-sources.json',disabledSources:new Set((window.blocked??['HIDDEN']).map(s=>s.toLowerCase()))},async path=>{const r=await fetch('https://brew.test/'+path);if(!r.ok)throw Error('HTTP '+r.status);return r.json();},(path,error)=>failures.push({path,error:String(error)}));return {idx,failures};};`;
  if(id==='\0state')return `export const getState=()=>({libraries:[{id:'core',enabled:true,baseUrl:'https://core.test',language:'zh'},{id:'brew',enabled:window.brewEnabled!==false,baseUrl:'https://brew.test',language:'zh',indexPath:'_generated/index-sources.json',indexFormat:'monster-source-index',disabledSources:window.blocked??['HIDDEN']}]});export const getLocalLang=()=> 'zh';`;
  if(id==='\0local')return 'export const initLocalContent=async()=>{};export const getAllLocalMonsters=()=>[];export const getLocalContentSignature=()=> "fixture";';
  if(id==='\0cache')return 'export const readContentMeta=async()=>null,readContentFiles=async()=>null,writeContentCache=async()=>{},dropContentCache=async()=>{};';
 }
}],output:{format:'esm',codeSplitting:false},logLevel:'silent'});
const code=result.output.find(c=>c.type==='chunk').code;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/probe.js'?'text/javascript':'text/html');res.end(req.url==='/probe.js'?code:'<script type="module" src="/probe.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:process.env.CI?undefined:'msedge',headless:true});
try{
 const page=await browser.newPage(),errors=[],requests=[];let fail=false,invalidTarget=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://core.test/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/bestiary/index.json'))return route.fulfill({json:{CORE:'base.json'}});
  return route.fulfill({json:{monster:[{name:'Base',source:'CORE',ac:[16],hp:{average:25},size:['M'],type:'beast',dex:12,cr:'1',damageTags:['F','P']}]}});
 });
 await page.route('https://brew.test/**',route=>{
  const path=decodeURIComponent(new URL(route.request().url()).pathname);requests.push(path);
  if(path==='/_generated/index-sources.json')return route.fulfill({json:{BREW:'packs/Two Books.json',ALIAS:'packs/Two Books.json',HIDDEN:'packs/Two Books.json',RACE:'race/Other.json',BAD:'../escape.json',ABS:'https://other.test/leak.json'}});
  if(path==='/_generated/index-props.json')return route.fulfill({json:{monster:{'packs/Two Books.json':'monster','../escape.json':'monster','https://other.test/leak.json':'monster'}}});
  if(path==='/packs/Two Books.json')return fail?route.fulfill({status:503,body:'authored outage'}):route.fulfill({json:{_meta:{sources:[{json:'BREW',full:'Authored Brew'},{json:'HIDDEN'}]},monster:[{name:'Variant',source:'BREW',_copy:{name:'Base',source:'CORE',_mod:{damageTags:[{mode:'replaceArr',replace:invalidTarget?'ABSENT':'F',items:'C'},{mode:'removeArr',names:['P']}]}}},{name:'Hidden Variant',source:'HIDDEN',_copy:{name:'Base',source:'CORE'}}]}});
  return route.fulfill({status:404,body:'authored missing'});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.reload);
 let output=await page.evaluate(()=>window.reload());
 assert.deepEqual(output.rows.map(r=>r.engName).sort(),['Base','Variant']);
 assert.equal(output.rows.find(r=>r.engName==='Variant').ac,16);assert.equal(output.progress.failedFiles,0);
 assert.equal(requests.filter(p=>p==='/packs/Two Books.json').length,1);
 assert(!requests.some(p=>p.includes('escape')||p.includes('Other.json')||p.includes('bestiary')));
 console.log('PASS source aliases load one safe monster collection, resolve core inheritance and hide disabled books');
 const detail=await page.evaluate(()=>window.detail());assert.equal(detail.name,'Variant');assert.equal(detail.ac[0],16);assert.equal(detail._suiteContent.libraryId,'brew');assert.deepEqual(detail.damageTags,['C']);const original=await page.evaluate(()=>window.detail('CORE::Base'));assert.deepEqual(original.damageTags,['F','P']);
 console.log('PASS selected-token details use the same source-index collection and provenance');
 const search=await page.evaluate(()=>window.sourceSearch());assert.equal(search.idx.x.length,1);assert.equal(search.idx.x[0].n,'Variant');assert.equal(search.idx.x[0].collectionPath,'packs/Two Books.json');assert.equal(search.failures.length,0);
 console.log('PASS search keeps the real collection path and excludes disabled records from a shared pack');
 await page.evaluate(()=>{window.brewEnabled=false;});requests.length=0;output=await page.evaluate(()=>window.reload());assert.equal(output.rows.length,1);assert.equal(requests.length,0);
 console.log('PASS disabled library performs no remote request');
 await page.evaluate(()=>{window.brewEnabled=true;window.blocked=['BREW','ALIAS','HIDDEN'];});requests.length=0;output=await page.evaluate(()=>window.reload());assert.equal(output.rows.length,1);assert(!requests.includes('/packs/Two Books.json'));
 console.log('PASS disabling all aliases avoids fetching their collection');
 await page.evaluate(()=>{window.blocked=['HIDDEN'];});fail=true;output=await page.evaluate(()=>window.reload());assert.equal(output.rows.length,1);assert(output.progress.failures.some(f=>f.path.includes('Two Books.json')&&f.message.includes('503')));
 const unavailable=await page.evaluate(()=>window.sourceSearch());assert.equal(unavailable.idx.x.length,0);assert.equal(unavailable.failures.length,1);assert(unavailable.failures[0].error.includes('503'));
 fail=false;output=await page.evaluate(()=>window.reload());assert.equal(output.rows.length,2);assert.equal(output.progress.failedFiles,0);
 console.log('PASS unavailable collection is reported and explicit retry recovers');
 invalidTarget=true;output=await page.evaluate(()=>window.reload());assert.equal(output.rows.length,1);assert(output.progress.failures.some(f=>f.kind==='dependency'&&f.path.includes('Variant')));
 invalidTarget=false;output=await page.evaluate(()=>window.reload());assert.equal(output.rows.length,2);assert.equal(output.progress.failedFiles,0);
 console.log('PASS primitive array edits preserve their parent and missing targets remain unavailable until corrected');assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
