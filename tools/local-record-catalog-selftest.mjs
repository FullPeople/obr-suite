// Authored packs through the actual local importer, IndexedDB and search page.
import {build} from 'rolldown';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=process.env.DND_LOCAL_CONTENT_ROOT||fileURLToPath(new URL('..',import.meta.url));
const pagePath=resolve(root,'src/modules/search/page.ts').replaceAll('\\','/');
const stubs={sdk:'export default {onReady(){},popover:{async setWidth(){},async setHeight(){}}};',state:'export const getState=()=>({libraries:[],dataVersion:"all",allowPlayerMonsters:false});export const getLocalLang=()=>"zh";export const startSceneSync=()=>{};export const onStateChange=()=>{};export const onLangChange=()=>{};',tags:'export const formatTagsClickable=x=>x;export const resolveClickRollTarget=()=>null;',menu:'export const bindRollableClickPopup=()=>{};',sfx:'export const subscribeToSfx=()=>{};',i18n:'export const applyI18nDom=()=>{};'};
const aliases={'../../state':'state','../dice/tags':'tags','../dice/context-menu':'menu','../dice/sfx-broadcast':'sfx','../../i18n':'i18n'};
const compiled=await build({input:'probe',plugins:[{name:'local-record-browser-probe',resolveId(id,importer){if(id==='probe')return '\0probe';if(id==='@owlbear-rodeo/sdk')return '\0stub:sdk';if(importer?.replaceAll('\\','/')===pagePath&&aliases[id])return '\0stub:'+aliases[id];},load(id){if(id.startsWith('\0stub:'))return stubs[id.slice(6)];if(id==='\0probe')return `import * as api from ${JSON.stringify(resolve(root,'src/utils/localContent.ts'))};import ${JSON.stringify(pagePath)};window.api=api;`;},transform(code,id){if(id.replaceAll('\\','/')===pagePath)return code+'\nwindow.searchApi={loadIndex,findEntryData,renderPreviewFor,search,invalidateSearchContent};';}}],output:{format:'esm'},logLevel:'silent'});
const script=compiled.output.find(row=>row.type==='chunk').code;
const html='<div id="wrap"><input id="q"><button id="clear"></button><div id="count"></div><div id="drop"></div><div id="preview"></div></div><script type="module" src="/probe.js"></script>';
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/probe.js'?'text/javascript':'text/html');response.end(request.url==='/probe.js'?script:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:process.env.CI?undefined:'msedge'});
let passed=0;const failures=[];
const kinds=['baseitem','charoption','facility','magicvariant','object'];
const record=(kind,name='Original authored entry',extra={})=>({name,ENG_name:name,source:'AUTH',entries:[`Original ${kind} body.`],...extra});
const pack=(kind,extra={})=>({_meta:{edition:'one'},[kind]:[record(kind,'Shared authored name',extra)]});
async function open(context){const page=await context.newPage();await page.goto(base);await page.waitForFunction(()=>window.api&&window.searchApi);await page.evaluate(()=>window.api.initLocalContent());return page;}
async function add(page,body,name='authored.json'){return page.evaluate(({body,name})=>window.api.importLocalJson(name,JSON.stringify(body)),{body,name});}
async function rows(page){return page.evaluate(()=>window.searchApi.loadIndex().then(index=>index.x));}
async function run(name,work){const context=await browser.newContext();try{await work(context);passed++;console.log('PASS '+name);}catch(error){failures.push({name,error:String(error)});console.error('FAIL '+name+': '+String(error));}finally{await context.close();}}
try{
 for(const kind of kinds)await run(`pure ${kind} imports, searches and opens its actual body`,async context=>{
  const page=await open(context);assert.equal((await add(page,pack(kind))).ok,true);const entries=await rows(page);assert.equal(entries.length,1);
  assert.equal(entries[0].localRecord.kind,kind);await page.evaluate(entry=>window.searchApi.renderPreviewFor(entry),entries[0]);assert.match(await page.locator('#preview').innerText(),new RegExp(`Original ${kind} body`));
  if(kind==='magicvariant')assert.match(await page.locator('.prev-meta').innerText(),/魔法物品模板/);if(kind==='baseitem')assert.match(await page.locator('.prev-meta').innerText(),/基础物品/);
 });
 await run('mixed packs and existing cached metadata expose every new namespace without deleting the old file',async context=>{
  const page=await open(context),body={_meta:{edition:'one'},monster:[{name:'Original retained monster',source:'AUTH'}]};for(const kind of kinds)body[kind]=[record(kind)];
  const imported=await add(page,body);assert.equal(imported.ok,true);const id=imported.meta.id;
  await page.evaluate(async id=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('obr-suite');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('local-content','readwrite');tx.objectStore('local-content').put({files:[{id,filename:'authored.json',kind:'monster',count:1,addedAt:1}]},'index');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();},id);
  await page.reload();await page.waitForFunction(()=>window.searchApi);await page.evaluate(()=>window.api.initLocalContent());const files=await page.evaluate(()=>window.api.getLocalFiles());assert.equal(files.length,1);assert.equal(files[0].id,id);assert.equal(files[0].count,6);assert.equal((await rows(page)).length,6);
 });
 await run('same names retain pack, namespace, profile and full-definition identities',async context=>{
  const page=await open(context),body={_meta:{edition:'one'},facility:[record('facility','Shared',{entries:['First original body.']}),record('facility','Shared',{entries:['Second original body.']})],object:[record('object','Shared')]};
  assert.equal((await add(page,body,'first.json')).ok,true);assert.equal((await add(page,{_meta:{edition:'classic'},facility:[record('facility','Shared')]},'second.json')).ok,true);
  const entries=await rows(page);assert.equal(entries.length,4);assert.equal(new Set(entries.map(row=>row.u)).size,4);
  const index=await page.evaluate(()=>window.searchApi.loadIndex());const selected=await page.evaluate(index=>window.searchApi.search('Shared',index,{dataVersion:'2024',language:'en',isGM:false,allowPlayerMonsters:false}),index);assert.equal(selected.length,3);
  for(const entry of entries){assert.ok(await page.evaluate(entry=>window.searchApi.findEntryData(entry),entry));}
 });
 await run('adding newly recognized kinds preserves the old primary kind during same-filename replacement',async context=>{
  const page=await open(context),old={monster:[{name:'Original retained monster',source:'AUTH'}]};assert.equal((await add(page,old)).ok,true);
  const saved=await add(page,{...old,baseitem:[record('baseitem')]});assert.equal(saved.ok,true);assert.equal(saved.meta.kind,'monster');
  const files=await page.evaluate(()=>window.api.getLocalFiles());assert.equal(files.length,1);assert.equal(files[0].count,2);
 });
 await run('refreshing a definition invalidates the old exact reference without selecting its namesake',async context=>{
  const page=await open(context);await add(page,pack('object'));const [old]=await rows(page);await add(page,pack('object',{entries:['Changed original object body.']}));
  assert.equal(await page.evaluate(entry=>window.searchApi.findEntryData(entry),old),null);await page.reload();await page.waitForFunction(()=>window.searchApi);const [fresh]=await rows(page);assert.notEqual(fresh.localRecord.fileId,old.localRecord.fileId);await page.evaluate(entry=>window.searchApi.renderPreviewFor(entry),fresh);assert.match(await page.locator('#preview').innerText(),/Changed original object body/);
 });
 await run('magic templates keep conditions, suffix and inherited text without claiming generated equipment',async context=>{
  const page=await open(context);assert.equal((await add(page,pack('magicvariant',{entries:undefined,requires:[{weapon:true}],excludes:{property:['two-handed']},inherits:{nameSuffix:' +4',entries:['Original template inherited text.']}}))).ok,true);
  const [entry]=await rows(page);await page.evaluate(entry=>window.searchApi.renderPreviewFor(entry),entry);const text=await page.locator('#preview').innerText();for(const fragment of ['Original template inherited text',' +4','武器','two-handed','模板'])assert.ok(text.includes(fragment),fragment);
 });
 await run('local copies resolve only a unique same-pack profile; missing, modified or cyclic inheritance stays visible',async context=>{
  const page=await open(context),body={_meta:{edition:'one'},charoption:[record('charoption','Original base'),record('charoption','Original child',{entries:undefined,_copy:{name:'Original base',source:'AUTH'}}),record('charoption','Missing child',{entries:undefined,_copy:{name:'Outside',source:'EXTERNAL'}}),record('charoption','Modified child',{entries:undefined,_copy:{name:'Original base',source:'AUTH',_mod:{entries:{mode:'appendArr',items:['No implicit execution.']}}}}),record('charoption','Cycle',{entries:undefined,_copy:{name:'Cycle',source:'AUTH'}})]};
  assert.equal((await add(page,body)).ok,true);const entries=await rows(page);assert.equal(entries.length,5);for(const entry of entries){await page.evaluate(entry=>window.searchApi.renderPreviewFor(entry),entry);const text=await page.locator('#preview').innerText();if(entry.cn==='Original child'||entry.n==='Original child')assert.match(text,/Original charoption body/);if(['Missing child','Modified child','Cycle'].includes(entry.cn||entry.n))assert.match(text,/继承.*核对|继承.*未/);}
 });
 await run('closed-popover reload and actual search clicks reopen the saved exact body without network',async context=>{
  const page=await open(context);assert.equal((await add(page,pack('facility'))).ok,true);await page.close();const next=await open(context);await next.route('https://**/*',route=>route.abort());
  await next.locator('#q').fill('Shared');await next.locator('#drop .row-item').first().click();await next.locator('.prev-body').waitFor();assert.match(await next.locator('#preview').innerText(),/Original facility body/);
 });
 await run('template source and explicit inherited profile are preserved instead of using an invented default',async context=>{
  const page=await open(context);assert.equal((await add(page,{_meta:{edition:'classic'},magicvariant:[{name:'Original template',requires:[{weapon:true}],inherits:{source:'INNER',edition:'one',entries:['Original inherited source.']}}]})).ok,true);
  const [entry]=await rows(page);assert.equal(entry.s,'INNER');assert.equal(entry.localRecord.edition,'2024');await page.evaluate(entry=>window.searchApi.renderPreviewFor(entry),entry);assert.match(await page.locator('.prev-meta').innerText(),/INNER.*2024/);
 });
 await run('canonical record digests survive object property order and unknown editions remain visible',async context=>{
  const page=await open(context),row=record('charoption');assert.equal((await add(page,{charoption:[row]},'first.json')).ok,true);assert.equal((await add(page,{charoption:[Object.fromEntries(Object.entries(row).reverse())]},'second.json')).ok,true);
  const entries=await rows(page);assert.equal(entries.length,2);assert.equal(entries[0].localRecord.digest,entries[1].localRecord.digest);assert.equal(entries[0].localRecord.edition,'unknown');const index=await page.evaluate(()=>window.searchApi.loadIndex());assert.equal((await page.evaluate(index=>window.searchApi.search('Original',index,{dataVersion:'2024',language:'en',isGM:false,allowPlayerMonsters:false}),index)).length,2);
 });
 await run('an explicit source profile wins over source-code edition guesses without merging the two identities',async context=>{
  const page=await open(context);assert.equal((await add(page,{charoption:[record('charoption','Profile test',{source:'PHB',edition:'one'}),record('charoption','Profile test',{source:'XPHB',edition:'classic'})]})).ok,true);
  const index=await page.evaluate(()=>window.searchApi.loadIndex());for(const version of ['2014','2024']){const found=await page.evaluate(({index,version})=>window.searchApi.search('Profile test',index,{dataVersion:version,language:'en',isGM:false,allowPlayerMonsters:false}),{index,version});assert.equal(found.length,1);assert.equal(found[0].localRecord.edition,version);}
 });
 await run('the same explicit-profile filter also retains existing class records under their declared year',async context=>{
  const page=await open(context);assert.equal((await add(page,{class:[record('class','Profile class',{source:'PHB',edition:'one'}),record('class','Profile class',{source:'XPHB',edition:'classic'})]})).ok,true);
  const index=await page.evaluate(()=>window.searchApi.loadIndex());for(const version of ['2014','2024']){const found=await page.evaluate(({index,version})=>window.searchApi.search('Profile class',index,{dataVersion:version,language:'en',isGM:false,allowPlayerMonsters:false}),{index,version});assert.equal(found.length,1);assert.equal(found[0].localClass.edition,version);}
 });
 await run('unsupported copy modifiers stay visible and parsed details never mutate the saved source',async context=>{
  const page=await open(context);assert.equal((await add(page,{magicvariant:[record('magicvariant','Original changed template',{entries:undefined,_copy:{name:'Outside template',source:'OTHER',_mod:{inherits:{bonusWeapon:'+4'}}}})]})).ok,true);
  const [entry]=await rows(page);const before=await page.evaluate(entry=>JSON.stringify(window.api.getLocalFileEntries(entry.localRecord.fileId,'magicvariant')),entry);const detail=await page.evaluate(entry=>window.api.getLocalRecordData(entry.localRecord,'en'),entry);assert.match(JSON.stringify(detail.entries),/unsupported modifiers/);assert.match(JSON.stringify(detail.entries),/Weapon bonus.*\+4/);assert.equal(await page.evaluate(entry=>JSON.stringify(window.api.getLocalFileEntries(entry.localRecord.fileId,'magicvariant')),entry),before);
 });
 await run('unrecognized content is still rejected and original imported content remains intact',async context=>{
  const page=await open(context);await add(page,{monster:[{name:'Original kept monster',source:'AUTH'}]});assert.equal((await add(page,{authoredUnsupportedContent:[{name:'Original unsupported content',source:'AUTH'}]})).ok,false);assert.equal((await rows(page)).filter(row=>row.c===1).length,1);
 });
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({passed,failed:failures.length,scope:'Authored inputs; real importer, native IndexedDB and search previews. SDK lifecycle stub only, no real room or rule automation.'}));if(failures.length)process.exitCode=1;
