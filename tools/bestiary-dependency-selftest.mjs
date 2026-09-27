// Original fixtures exercise the actual loader; no upstream rule snapshots.
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
 name:'fixture-boundary',resolveId(id,importer){
  if(id==='probe')return '\0probe';
  if(!importer?.replaceAll('\\','/').endsWith('/bestiary/data.ts'))return;
  if(id==='../../state')return '\0state';
  if(id==='../../utils/localContent')return '\0local';
  if(id==='./contentCache')return '\0cache';
 },load(id){
  if(id==='\0probe')return `import {loadAllMonsters,clearMonsterCache} from ${JSON.stringify(resolve(root,'src/modules/bestiary/data.ts'))};window.reload=async()=>{clearMonsterCache();let progress;const rows=await loadAllMonsters(p=>progress=p);return {rows,progress};};`;
  if(id==='\0state')return `export const getState=()=>({libraries:[{id:'fixture',enabled:true,baseUrl:'https://fixture.test',language:'zh',disabledSources:['BASE','CHAIN']}]});export const getLocalLang=()=> 'zh';`;
  if(id==='\0local')return 'export const initLocalContent=async()=>{};export const getAllLocalMonsters=()=>[];';
  if(id==='\0cache')return 'export const readContentMeta=async()=>null,readContentFiles=async()=>null,writeContentCache=async()=>{},dropContentCache=async()=>{};';
 }
}],output:{format:'esm',codeSplitting:false},logLevel:'silent'});
const code=result.output.find(c=>c.type==='chunk').code;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/probe.js'?'text/javascript':'text/html');res.end(req.url==='/probe.js'?code:'<script type="module" src="/probe.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:process.env.CI?undefined:'msedge',headless:true});
try{
 const page=await browser.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 let fail=false,missing=false;
 await page.route('https://fixture.test/**',route=>{
  const path=new URL(route.request().url()).pathname;requests.push(path);
  if(path.endsWith('/bestiary/index.json'))return route.fulfill({json:{BASE:'base.json',CHAIN:'chain.json',VISIBLE:'visible.json'}});
  if(path.endsWith('/base.json')&&fail)return route.fulfill({status:503,body:'fixture outage'});
  const monster=path.endsWith('/base.json')?[{name:'基础原型',source:'BASE',ac:[17],hp:{average:23},size:['M'],type:'beast',dex:12,cr:'1',hasToken:false}]
   :path.endsWith('/chain.json')?[{name:'中间原型',source:'CHAIN',_copy:{name:'基础原型',source:'BASE'}}]
   :[{name:'可用变种',source:'VISIBLE',_copy:{name:missing?'不存在的原型':'中间原型',source:'CHAIN'}}];
  return route.fulfill({json:{monster}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.reload);
 let output=await page.evaluate(()=>window.reload());
 assert.equal(output.rows.length,1);assert.equal(output.rows[0].name,'可用变种');assert.equal(output.rows[0].ac,17);assert.equal(output.rows[0].hp,23);assert.equal(output.progress.failedFiles,0);
 assert.equal(requests.filter(p=>p.endsWith('/base.json')).length,1);assert.equal(requests.filter(p=>p.endsWith('/chain.json')).length,1);
 console.log('PASS disabled parent chain resolves while all disabled entries remain hidden');
 fail=true;output=await page.evaluate(()=>window.reload());
 assert.equal(output.rows.length,0);assert(output.progress.failures.some(f=>f.kind==='download'&&f.path.endsWith('/base.json')&&f.message.includes('503')));
 assert(output.progress.failures.some(f=>f.kind==='dependency'&&f.path.includes('可用变种')));
 console.log('PASS failed dependency reports its file, HTTP status and affected entry');
 fail=false;output=await page.evaluate(()=>window.reload());assert.equal(output.progress.failedFiles,0);assert.equal(output.rows.length,1);
 console.log('PASS retry recovers after the dependency becomes available');
 missing=true;output=await page.evaluate(()=>window.reload());assert.equal(output.rows.length,0);assert(output.progress.failures.some(f=>f.message.includes('不存在的原型')));
 console.log('PASS invalid inheritance stays visible as a failure');assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
