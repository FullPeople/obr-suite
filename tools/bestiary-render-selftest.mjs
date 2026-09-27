import {createRequire} from 'node:module';import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {createServer} from 'node:http';import {resolve,extname} from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const {chromium}=createRequire(resolve(process.env.DND_CARD_WEB_ROOT||resolve(root,'../web'),'package.json'))('@playwright/test');
const out=resolve(root,'workbench-test-output/bestiary-render'),dist=resolve(root,process.env.BESTIARY_DIST||'dist-feedback199');mkdirSync(out,{recursive:true});
const prefix=process.env.SUITE_TEST_BASE||'suite',origin=process.env.SUITE_TEST_ORIGIN||'http://127.0.0.1:5640';
const host=`window.state={items:[],scene:{},room:{}};window.addEventListener('message',event=>{const m=event.data;if(!m.id||!m.nonce)return;let value={};const s=state,d=m.data||{};switch(m.id){case 'OBR_PLAYER_GET_ID':value={id:'me'};break;case 'OBR_PLAYER_GET_ROLE':value={role:'GM'};break;case 'OBR_PLAYER_GET_NAME':value={name:'验收'};break;case 'OBR_PLAYER_GET_COLOR':value={color:'#555555'};break;case 'OBR_PLAYER_GET_CONNECTION_ID':value={connectionId:'connection'};break;case 'OBR_PLAYER_GET_SELECTION':value={selection:[]};break;case 'OBR_PLAYER_GET_METADATA':value={metadata:{}};break;case 'OBR_PARTY_GET_PLAYERS':value={players:[]};break;case 'OBR_SCENE_IS_READY':value={ready:true};break;case 'OBR_SCENE_GET_METADATA':value={metadata:s.scene};break;case 'OBR_ROOM_GET_METADATA':value={metadata:s.room};break;case 'OBR_SCENE_ITEMS_GET_ALL_ITEMS':case 'OBR_SCENE_ITEMS_GET_ITEMS':value={items:s.items};break;case 'OBR_SCENE_SET_METADATA':Object.assign(s.scene,d.update);break;case 'OBR_SCENE_ITEMS_ADD_ITEMS':s.items.push(...(d.items||[]));break;case 'OBR_ROOM_SET_METADATA':Object.assign(s.room,d.update);break;case 'OBR_VIEWPORT_GET_WIDTH':value={width:1200};break;case 'OBR_VIEWPORT_GET_HEIGHT':value={height:900};break;case 'OBR_VIEWPORT_GET_POSITION':value={position:{x:0,y:0}};break;case 'OBR_VIEWPORT_GET_SCALE':value={scale:1};break;}event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:value},event.origin);});`;
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain'};
const server=createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<script>'+host+'</script><iframe style="border:0;width:100%;height:96vh" src="'+origin+'/'+prefix+'/'+u.searchParams.get('page')+'?obrref='+Buffer.from('http://127.0.0.1:5640 test-room').toString('base64')+'"></iframe>');return;}const file=resolve(dist,u.pathname.slice(('/'+prefix+'/').length));if(file.startsWith(dist)&&existsSync(file)){res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));return;}res.writeHead(404);res.end();});await new Promise(r=>server.listen(5640,'127.0.0.1',r));
const browser=await chromium.launch({channel:process.env.CI?undefined:'msedge',headless:true}),context=await browser.newContext({viewport:{width:500,height:900},serviceWorkers:'block'}),errors=[],warnings=[];
const baseline=process.argv.includes('--baseline');
const crs=[{cr:'1/2',lair:'1',coven:'2'},0,2,{special:'随施法者等级变化'},{cr:0},{},'1/8'];
const parents=crs.map((cr,i)=>({name:'原型 '+i,ENG_name:'Parent '+i,source:'BASE',cr,size:['M'],type:'beast',ac:[12],hp:{average:12},dex:10,hasToken:false}));
let dataFileReads=0;
let finishFile;const delayedFile=new Promise(resolve=>{finishFile=resolve});
await context.route('https://5e.kiwee.top/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/data/bestiary/index.json')return route.fulfill({headers:{etag:'"bestiary-render-fixture"','access-control-allow-origin':'*','access-control-expose-headers':'ETag'},json:{BASE:'base.json',VARIANT:'variant.json'}});
 if(path.endsWith('/base.json')){dataFileReads++;await new Promise(resolve=>setTimeout(resolve,1200));return route.fulfill({json:{monster:parents}});}
 if(path.endsWith('/variant.json')){dataFileReads++;await delayedFile;return route.fulfill({json:{monster:[{name:'继承变种',ENG_name:'Variant',source:'VARIANT',_copy:{name:'Parent 0',source:'BASE'}}]}});}
 return route.fulfill({json:{}});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))warnings.push(m.text())});
try{
 await page.goto('http://127.0.0.1:5640/?page=bestiary-panel.html');let frame=page.frames()[1];await frame.waitForLoadState();await page.evaluate(origin=>document.querySelector('iframe').contentWindow.postMessage({id:'OBR_READY',data:{ref:'test',userId:'me'}},origin),origin);
 await frame.locator('.card-name').filter({hasText:'原型 0'}).waitFor();
 // Ensure Preact has actually rendered the preview before resolving inheritance.
 const preview=await frame.locator('.card').filter({hasText:'原型 0'}).innerText();finishFile();
 if(baseline){await frame.locator('.bestiary-load-errors').waitFor();await frame.getByText('查看未加载原因',{exact:true}).click();const failure=await frame.locator('.bestiary-load-errors').innerText();assert.match(failure,/Converting circular structure to JSON/);assert.match(failure,/property '__'/);await page.screenshot({path:resolve(out,'circular-before.png')});writeFileSync(resolve(out,'circular-before.json'),JSON.stringify({preview,failure,errors,warnings},null,2));console.log(failure);}
 else{
  await frame.waitForFunction(()=>document.querySelectorAll('.card[aria-disabled=false]').length===8);assert.equal(await frame.locator('.bestiary-load-errors').count(),0);
  const expected=['1/2','0','2','随施法者等级变化','0','?','1/8'];
  for(let i=0;i<expected.length;i++)assert.equal(await frame.locator('.card').filter({has:frame.locator('.card-name',{hasText:'原型 '+i})}).locator('.tag').last().innerText(),'CR '+expected[i]);
  const variant=frame.locator('.card').filter({hasText:'继承变种'});assert.equal(await variant.locator('.tag').last().innerText(),'CR 1/2');await variant.click();
  await page.waitForFunction(()=>Object.values(window.state.scene).some(table=>table&&typeof table==='object'&&Object.values(table).some(m=>m?.name==='继承变种')));
  const saved=await page.evaluate(()=>{const monster=Object.values(window.state.scene).flatMap(table=>table&&typeof table==='object'?Object.values(table):[]).find(m=>m?.name==='继承变种');return JSON.parse(JSON.stringify(monster));});assert.deepEqual(saved.cr,crs[0]);assert(!JSON.stringify(saved).includes('"__"'));
  const refreshedFile=page.waitForResponse(r=>r.url().endsWith('/data/bestiary/base.json'));await frame.locator('.sort-btn').filter({hasText:'⟳'}).click();await refreshedFile;await frame.waitForFunction(()=>document.querySelectorAll('.card[aria-disabled=false]').length===8);assert.equal(await frame.locator('.bestiary-load-errors').count(),0);
  await page.screenshot({path:resolve(out,'circular-after.png')});
  const beforeReload=dataFileReads;await page.reload();frame=page.frames()[1];await frame.waitForLoadState();await page.evaluate(origin=>document.querySelector('iframe').contentWindow.postMessage({id:'OBR_READY',data:{ref:'test',userId:'me'}},origin),origin);await frame.waitForFunction(()=>document.querySelectorAll('.card[aria-disabled=false]').length===8);assert.equal(await frame.locator('.bestiary-load-errors').count(),0);assert.equal(dataFileReads,beforeReload,'reload must reuse persisted monster files');assert.deepEqual(errors,[]);assert(!warnings.some(s=>/circular structure|could not be cloned|list load failed|cache write skipped/.test(s)));
  const record={passed:true,checks:['render preview before inheritance','seven CR shapes displayed as text','inherited CR preserved in shared scene JSON','refresh succeeds','cached reload succeeds'],errors,warnings,dataFileReads,backend:'simulated',production:true};writeFileSync(resolve(out,'circular-after.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
 }
}finally{finishFile();await browser.close();server.close();}
