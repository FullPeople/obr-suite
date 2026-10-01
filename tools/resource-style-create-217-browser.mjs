// Production background + installed SDK over real iframe postMessage. Synthetic room only.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=resolve(process.env.SUITE_ROOT||'.');
const webRoot=resolve(process.env.WEB_ROOT||'../DND-card-web');
const deps=resolve(process.env.SUITE_DEPS||root);
const requireSuite=createRequire(join(deps,'package.json')),requireWeb=createRequire(join(webRoot,'package.json'));
const {build}=await import(pathToFileURL(requireWeb.resolve('rolldown')).href);
const {chromium}=requireWeb('@playwright/test');
const out=resolve(process.env.PROFILE_OUT||'workbench-test-output/cache-push-217');mkdirSync(out,{recursive:true});
const source=readFileSync(process.env.PROFILE_SOURCE||join(root,'src/workbench/background.ts'),'utf8');
const counts='{catalog:0,hydrate:0,refresh:0,refreshSelection:0,reconcileRuntime:0}';
let profiled=source.replace('const shared=sharedDocuments(relay)', 'const shared=sharedDocuments(relay)');
for(const name of ['catalog','hydrate','refresh','refreshSelection','reconcileRuntime'])profiled=profiled.replace(new RegExp('(async function '+name+'\\([^\\n]*?\\)\\{)'),`$1(window as any).probeCounts.${name}++;`);
const expose=`const originalSharedRead=shared.read;shared.read=async(...args:any[])=>{if((window as any).blockShared)await new Promise(resolve=>setTimeout(resolve,900));return originalSharedRead(...args);};Object.assign(window,{probe:{catalog,access,snapshot,hydrate,refresh,refreshSelection,observation,activate(){child=window.parent;},choice(){return chosen;},request(m:any){return receive({protocol,session,...m});},resetCounts(){(window as any).probeCounts=${counts};},select(id:string){return receive({protocol,session,type:'select',itemId:id});}}});`;
profiled=profiled.replace("setInterval(()=>send('pong',{at:Date.now()}),10000);",'').replace('setInterval(()=>{changed();scheduleInventoryRepair();},4000);',expose);
if(!profiled.includes(expose))throw Error('Production profiling hook no longer matches');
const entry=join(out,'entry.ts');writeFileSync(entry,`import OBR from '@owlbear-rodeo/sdk';import {setupWorkbench} from '${join(root,'src/workbench/background.ts').replaceAll('\\','/')}';(window as any).probeCounts=${counts};(window as any).wbMock={metadata:{},settings:{},emit(){}};OBR.onReady(()=>setupWorkbench());(window as any).moduleReady=true;`);
await build({input:entry,plugins:[{name:'production-sdk-fixture',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/workbench/background.ts'))code=profiled;return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');},resolveId(id){if(['./state','../state','../../state','../modules/bestiary/data'].includes(id))return join(root,'tools/fixtures/workbench-modules.ts');if(!id.startsWith('.')&&!id.startsWith('/')&&!/^[A-Z]:/i.test(id)&&!id.startsWith('\0'))try{return requireSuite.resolve(id==='events'?'events/':id);}catch{try{return requireWeb.resolve(id);}catch{}}}}],output:{file:join(out,'profile.js'),format:'esm',codeSplitting:false}});
const total=3,port=Number(process.env.PORT||5635),webUrl=process.env.WEB_URL||'http://127.0.0.1:5238';
const list=Array.from({length:total},(_,i)=>({id:'hero'+i,name:'Synthetic '+i,owner_ids:['me'],visibility:'public',locked:false}));
list[1].owner_ids=['other'];list[1].locked=true;list[1].visibility='owners';list[2].owner_ids=['other'];
const runtime={stats:{health:20,'max health':30,'temporary health':0,'armor class':15},conditions:[],resources:{}};
const BIND='com.character-cards/boundCardId',BASE='com.obr-suite/workbench/runtime-baseline',HP='com.obr-suite/bubbles/data';
const items=Array.from({length:3},(_,i)=>({id:'token'+i,name:'Token '+i,type:'IMAGE',layer:'CHARACTER',createdUserId:'me',position:{x:i,y:i},metadata:i<total?{[BIND]:list[i].id,[HP]:runtime.stats,[BASE]:{version:1,cardId:list[i].id,revision:1,value:runtime}}:{'test:data':'x'.repeat(1500)}}));
const scene={'com.character-cards/list':list,'com.obr-suite/workbench/shared':{id:'profile',revision:0}},room={'com.obr-suite/workbench/cards':list,'com.obr-suite/workbench/owner-roles':{me:'PLAYER'}};
const docs=Object.fromEntries(list.map(c=>[c.id,{schema_version:'0.3',_suiteRevision:1,identity:{character_name:c.name},core_stats:{hp:{current:20,max:30,temp:0},ac:15},inventory:{},features:{},background:{},classes:[],portrait:'x'.repeat(50000)}]));
items[1].createdUserId='other';items[2].createdUserId='other';
const widget={style:'ring',x:0,y:0,w:4,h:2,page:0};
for(const doc of Object.values(docs)){doc.dnd_card_web={runtime:{hp:20,resources:{visible:{id:'visible',name:'授权可见资源',type:'number',current:3,max:7}}},quickbarLayout:{widgets:{visible:{...widget,privateNote:'must-not-cross'},hiddenResource:{...widget,style:'icon'}}}};}
const parentScript=`window.state=${JSON.stringify({items,scene,room})};window.results=[];window.metrics=[];window.player={id:'me',connectionId:'connection',name:'Synthetic DM',color:'#50525B',role:'PLAYER',metadata:{},selection:['token0'],syncView:false};
window.emit=(id,data)=>document.querySelector('iframe').contentWindow.postMessage({id,data},location.origin);
window.choose=id=>{player.selection=id?[id]:[];emit('OBR_PLAYER_EVENT_CHANGE',{player});};
window.addEventListener('message',event=>{const m=event.data;if(m.protocol==='full-suite-workbench/v1'){results.push(m);return;}if(!m.id||!m.nonce)return;metrics.push({id:m.id});
const s=state,d=m.data;let value={};switch(m.id){
case 'OBR_PLAYER_GET_ID':value={id:player.id};break;case 'OBR_PLAYER_GET_CONNECTION_ID':value={connectionId:player.connectionId};break;case 'OBR_PLAYER_GET_ROLE':value={role:player.role};break;case 'OBR_PLAYER_GET_NAME':value={name:player.name};break;case 'OBR_PLAYER_GET_COLOR':value={color:player.color};break;case 'OBR_PLAYER_GET_SELECTION':value={selection:player.selection};break;case 'OBR_PLAYER_GET_METADATA':value={metadata:player.metadata};break;case 'OBR_PARTY_GET_PLAYERS':value={players:[]};break;
case 'OBR_SCENE_IS_READY':value={ready:true};break;case 'OBR_SCENE_GET_METADATA':value={metadata:s.scene};break;case 'OBR_ROOM_GET_METADATA':value={metadata:s.room};break;case 'OBR_SCENE_ITEMS_GET_ALL_ITEMS':value={items:s.items};break;case 'OBR_SCENE_ITEMS_GET_ITEMS':value={items:s.items.filter(i=>d.ids.includes(i.id))};break;
case 'OBR_SCENE_SET_METADATA':Object.assign(s.scene,d.update);emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:s.scene});break;case 'OBR_ROOM_SET_METADATA':Object.assign(s.room,d.update);emit('OBR_ROOM_METADATA_EVENT_CHANGE',{metadata:s.room});break;case 'OBR_SCENE_ITEMS_UPDATE_ITEMS':for(const u of d.updates)Object.assign(s.items.find(i=>i.id===u.id),u);emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:s.items});break;
case 'OBR_VIEWPORT_GET_WIDTH':value={width:1200};break;case 'OBR_VIEWPORT_GET_HEIGHT':value={height:900};break;case 'OBR_VIEWPORT_GET_SCALE':value={scale:1};break;case 'OBR_VIEWPORT_GET_POSITION':value={position:{x:0,y:0}};break;case 'OBR_SCENE_GRID_GET_DPI':value={dpi:150};break;
}event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:value},event.origin);});`;
const shared=new Map();let requests=0,documentWrites=0,slowId='',slowDelay=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<script>'+parentScript+'</script><iframe src="/child?obrref='+Buffer.from('http://127.0.0.1:'+port+' profile-room').toString('base64')+'"></iframe>');return;}if(u.pathname==='/child'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/profile.js"></script>');return;}if(u.pathname==='/profile.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,'profile.js')));return;}if(u.pathname.startsWith('/characters/')){requests++;const id=u.pathname.split('/')[3];if(id===slowId)await new Promise(r=>setTimeout(r,slowDelay));res.end(JSON.stringify(docs[id]));return;}if(u.pathname==='/suite-dev/relay'){if(req.method==='GET'){setTimeout(()=>{if(!res.destroyed)res.end('[]');},20000);return;}const parts=[];for await(const p of req)parts.push(p);let bytes=Buffer.concat(parts);if(req.headers['content-encoding']==='gzip')bytes=(await import('node:zlib')).gunzipSync(bytes);const body=JSON.parse(bytes);if(body.saveCard){const s=body.saveCard,doc=docs[s.card];if(createHash('sha256').update(JSON.stringify(doc)).digest('hex')!==s.expected){res.writeHead(409);res.end('{"error":"conflict"}');return;}for(const c of s.changes){let target=doc;for(const part of c.path.slice(0,-1))target=target[part]??=(typeof part==='number'?[]:{});const key=c.path.at(-1);if(c.remove)delete target[key];else target[key]=c.after;}documentWrites++;}if(body.sharedDocument){const d=body.sharedDocument,old=shared.get(d.key)||{revision:0,data:null};if(d.operation==='write'){if(d.expected!==old.revision){res.writeHead(409);res.end('{"error":"conflict"}');return;}shared.set(d.key,{revision:old.revision+1,data:d.data});}res.end(JSON.stringify(shared.get(d.key)||old));return;}res.end('{}');return;}res.writeHead(404);res.end('{}');}catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}});await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']}),reports=[],errors=[];
try{
const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:'+port+'/');let frame=page.frames().find(f=>f.url().includes('/child'));await frame.waitForFunction(()=>window.moduleReady);await page.evaluate(()=>emit('OBR_READY',{ref:'test',userId:'me'}));await frame.waitForFunction(()=>window.probe);
await frame.evaluate(async()=>{await window.probe.hydrate();window.probe.activate();await window.probe.refreshSelection();await window.probe.refresh();});await page.waitForFunction(()=>results.some(r=>r.type==='catalog'));await page.waitForTimeout(150);

const assert=(await import('node:assert/strict')).default;
const actual=await frame.evaluate(async()=>await window.probe.catalog());
assert.deepEqual(actual.cards.map(c=>c.id).sort(),['hero0','hero2']);
for(const card of actual.cards){assert.deepEqual(card.resourceWidgets,{visible:widget});assert.equal(card.resources.length,1);}
const wire=await page.evaluate(()=>results.filter(m=>m.type==='catalog'||m.type==='directory'));
assert(wire.some(m=>m.type==='catalog'));assert(wire.some(m=>m.type==='directory'));
for(const message of wire){assert(!message.cards.some(c=>c.id==='hero1'));for(const card of message.cards)if(card.resourceWidgets)assert.deepEqual(card.resourceWidgets,{visible:widget});}
const finalWire=wire.filter(m=>m.cards.some(c=>c.resourceWidgets?.visible)).at(-1);assert(finalWire);
const ui=await browser.newPage({viewport:{width:1200,height:900}});
await ui.route('**/resource-presentation217?*',route=>route.fulfill({contentType:'text/html',body:'<div id="test-root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/e2e/resourceBurst182.harness.jsx"></script>'}));
await ui.goto(webUrl+'/resource-presentation217?mode=overview#suite=resource-burst182&bridge='+encodeURIComponent(webUrl));
await ui.waitForFunction(()=>window.resource182?.ready);
for(const type of ['directory','catalog']){
 await ui.evaluate(({wire,type})=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{...wire,protocol:'full-suite-workbench/v1',session:'resource-burst182',hostStarted:182,type,sequence:type==='directory'?10000:10001,inventory:undefined,enabled:{inventory:false,resourceTracker:true}}})),{wire:finalWire,type});
 await ui.locator('.compact-resource.widget-ring[data-resource-id="visible"]').first().waitFor();
 assert.equal(await ui.locator('.compact-resource.widget-ring[data-resource-id="visible"]').count(),2);
 assert.equal(await ui.locator('[data-resource-target="hero1"]').count(),0);
 assert.equal(await ui.locator('.compact-resource[data-resource-id="hiddenResource"]').count(),0);
 assert(await ui.getByRole('button',{name:'管理Synthetic 2资源',exact:true}).isDisabled());
 reports.push({name:type+' real SDK projection to actual overview',passed:true,visibleCards:2,ringStyles:2,hiddenCardAbsent:true,hiddenWidgetAbsent:true,otherOwnerReadonly:true});
}

let uiSeq=11000;
async function syncUi(){await frame.evaluate(()=>window.probe.refresh());await page.waitForFunction(()=>results.some(m=>m.type==='catalog'));const wire=await page.evaluate(()=>results.filter(m=>m.type==='catalog').at(-1));assert(wire);await ui.evaluate(({wire,sequence})=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{...wire,session:'resource-burst182',hostStarted:182,sequence}})),{wire,sequence:++uiSeq});return wire;}
async function hostRequest(m){const clean={...m};delete clean.protocol;delete clean.session;await frame.evaluate(m=>window.probe.request(m),clean);await page.waitForFunction(id=>results.some(r=>r.type==='ack'&&r.requestId===id),m.requestId);return page.evaluate(id=>results.find(r=>r.type==='ack'&&r.requestId===id),m.requestId);}
async function confirmUi(){await ui.waitForFunction(()=>resource182.pending.length>0);const request=await ui.evaluate(()=>resource182.pending.shift());const ack=await hostRequest(request);assert.equal(ack.ok,true,JSON.stringify(ack));await ui.evaluate(ack=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{...ack,session:'resource-burst182',hostStarted:182}})),ack);await syncUi();return request;}
await ui.getByRole('button',{name:'管理Synthetic 0资源',exact:true}).click();
await ui.getByRole('textbox',{name:'资源名称',exact:true}).fill('新建星火');
await ui.getByRole('button',{name:'图标块',exact:false}).click();
await ui.getByRole('button',{name:'保存',exact:true}).click();
const own=await confirmUi();assert.equal(own.presentation.style,'icon');assert.equal(documentWrites,1);
assert.equal(docs.hero0.dnd_card_web.quickbarLayout.widgets[own.resourceId].style,'icon');assert.equal(docs.hero0.dnd_card_web.runtime.resources[own.resourceId].name,'新建星火');assert.equal(docs.hero0.web_resource_widgets,undefined);
await ui.locator(`.compact-resource.widget-icon[data-resource-id="${own.resourceId}"]`).waitFor();
const beforeReadonly=JSON.stringify(docs.hero2);const denied=await hostRequest({type:'resource',requestId:'unauthorized-style-create',itemId:'card:hero2',resourceId:'evil',expected:null,resource:{id:'evil',name:'不得创建',current:1,max:1,type:'count'},presentation:{style:'ring'}});assert.equal(denied.ok,false);assert.equal(JSON.stringify(docs.hero2),beforeReadonly);assert(await ui.getByRole('button',{name:'管理Synthetic 2资源',exact:true}).isDisabled());
// Recreate the host and UI from persisted documents, not their in-memory roster.
await page.reload();frame=page.frames().find(f=>f.url().includes('/child'));await frame.waitForFunction(()=>window.moduleReady);await page.evaluate(()=>emit('OBR_READY',{ref:'test',userId:'me'}));await frame.waitForFunction(()=>window.probe);await frame.evaluate(async()=>{await window.probe.hydrate();window.probe.activate();await window.probe.refreshSelection();});
await ui.reload();await ui.waitForFunction(()=>window.resource182?.ready);await syncUi();await ui.locator(`.compact-resource.widget-icon[data-resource-id="${own.resourceId}"]`).waitFor();
await ui.screenshot({path:join(out,'own-style-created-refresh.png'),fullPage:true});
reports.push({name:'actual overview create style -> authoritative SDK transaction -> ACK -> host/UI reload; other owner blocked',passed:true,writes:documentWrites,resourceId:own.resourceId});
// Legacy documents receive only a compatibility display field; no partial native card.
delete docs.hero0.dnd_card_web;docs.hero0.web_resources={legacy:{id:'legacy',name:'旧卡资源',current:1,max:4,type:'count'}};
await page.reload();frame=page.frames().find(f=>f.url().includes('/child'));await frame.waitForFunction(()=>window.moduleReady);await page.evaluate(()=>emit('OBR_READY',{ref:'test',userId:'me'}));await frame.waitForFunction(()=>window.probe);await frame.evaluate(async()=>{await window.probe.hydrate();window.probe.activate();await window.probe.refreshSelection();});await syncUi();
const legacy=await hostRequest({type:'resource',requestId:'legacy-style',itemId:'card:hero0',resourceId:'legacy',expected:docs.hero0.web_resources.legacy,resource:docs.hero0.web_resources.legacy,presentation:{style:'square'}});assert.equal(legacy.ok,true,JSON.stringify(legacy));assert.equal(docs.hero0.dnd_card_web,undefined);assert.equal(docs.hero0.web_resource_widgets.legacy.style,'square');await syncUi();await ui.locator('.compact-resource.widget-square[data-resource-id="legacy"]').waitFor();
reports.push({name:'legacy transaction uses compatible field without partial native; real catalog renders style',passed:true});
// The same public resource editor writes through the existing inventory CAS.
await page.evaluate(()=>{player.role='GM';state.room['com.obr-suite/workbench/owner-roles'].me='GM';emit('OBR_PLAYER_EVENT_CHANGE',{player});});await frame.evaluate(async()=>{await window.probe.hydrate();await window.probe.refreshSelection();});await syncUi();
await ui.getByRole('button',{name:'＋ 资源',exact:true}).click();await ui.getByRole('textbox',{name:'资源名称',exact:true}).fill('公共方阵');await ui.getByRole('button',{name:'方形',exact:false}).click();await ui.getByRole('button',{name:'保存',exact:true}).click();const stock=await confirmUi();assert.equal(stock.operation.row.presentation.style,'square');await ui.locator('.public-resources .compact-resource.widget-square').waitFor();
await page.reload();frame=page.frames().find(f=>f.url().includes('/child'));await frame.waitForFunction(()=>window.moduleReady);await page.evaluate(()=>{player.role='GM';state.room['com.obr-suite/workbench/owner-roles'].me='GM';emit('OBR_READY',{ref:'test',userId:'me'});});await frame.waitForFunction(()=>window.probe);await frame.evaluate(async()=>{await window.probe.hydrate();window.probe.activate();await window.probe.refreshSelection();});
await ui.reload();await ui.waitForFunction(()=>window.resource182?.ready);await syncUi();await ui.locator('.public-resources .compact-resource.widget-square').waitFor();
reports.push({name:'public GM create style -> real inventory CAS ACK -> host and UI reload',passed:true});
await ui.screenshot({path:join(out,'style-created-refresh.png'),fullPage:true});
await page.evaluate(()=>{player.role='PLAYER';state.room['com.obr-suite/workbench/owner-roles'].me='PLAYER';emit('OBR_PLAYER_EVENT_CHANGE',{player});});await frame.evaluate(async()=>{await window.probe.hydrate();await window.probe.refreshSelection();});const playerWire=await syncUi();await ui.getByRole('button',{name:'＋ 资源',exact:true}).waitFor({state:'detached'});const stockBefore=JSON.stringify([...shared.entries()]);const container=playerWire.inventory.containers[stock.operation.container];const deniedStock=await hostRequest({type:'inventory',requestId:'player-style-denied',operation:{action:'update',operationId:'player-style-denied-op',container:container.id,id:stock.operation.row.id,expected:{[container.id]:container.revision},patch:{presentation:{style:'icon'}}}});assert.equal(deniedStock.ok,false);assert.equal(JSON.stringify([...shared.entries()]),stockBefore);reports.push({name:'public player cannot create or modify presentation; authoritative ledger unchanged',passed:true});
writeFileSync(join(out,'results.json'),JSON.stringify({actualSdk:true,actualCrossWindow:true,syntheticData:true,realRoomVerified:false,reports,errors},null,2));console.log(JSON.stringify({passed:reports.length,reports,errors}));assert.equal(errors.length,0);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
