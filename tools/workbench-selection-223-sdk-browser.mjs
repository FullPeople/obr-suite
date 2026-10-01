// Production background + installed SDK over real iframe postMessage. Synthetic room only.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=resolve(process.env.SUITE_ROOT||'.');
const webRoot=resolve(process.env.WEB_ROOT||'../web');
const deps=resolve(process.env.SUITE_DEPS||root);
const requireSuite=createRequire(join(deps,'package.json')),requireWeb=createRequire(join(webRoot,'package.json'));
const {build}=await import(pathToFileURL(requireWeb.resolve('rolldown')).href);
const {chromium}=requireWeb('@playwright/test');
const out=resolve(process.env.PROFILE_OUT||'../selection223/sdk-after');mkdirSync(out,{recursive:true});
const source=readFileSync(process.env.PROFILE_SOURCE||join(process.env.SELECTION_BASELINE||root,'src/workbench/background.ts'),'utf8');
const counts='{catalog:0,hydrate:0,refresh:0,refreshSelection:0,reconcileRuntime:0}';
let profiled=source;
for(const name of ['catalog','hydrate','refresh','refreshSelection','reconcileRuntime'])profiled=profiled.replace(new RegExp('(async function '+name+'\\([^\\n]*?\\)\\{)'),`$1(window as any).probeCounts.${name}++;`);
const expose=`Object.assign(window,{probe:{catalog,access,snapshot,hydrate,refresh,refreshSelection,observation,activate(){child=window.parent;},choice(){return chosen;},request(m:any){return receive({protocol,session,...m});},relayRequest(m:any){relayActive=true;relayPeerSeen=Date.now();return receive({protocol,session,...m},true);},wire(){return {protocol,session};},resetCounts(){(window as any).probeCounts=${counts};},select(id:string){return receive({protocol,session,type:'select',itemId:id});}}});`;
profiled=profiled.replace("setInterval(()=>send('pong',{at:Date.now()}),10000);",'').replace('setInterval(()=>{changed();scheduleInventoryRepair();},4000);',expose);
if(!profiled.includes(expose))throw Error('Production profiling hook no longer matches');
const entry=join(out,'entry.ts');writeFileSync(entry,`import OBR from '@owlbear-rodeo/sdk';import {setupWorkbench} from '${join(root,'src/workbench/background.ts').replaceAll('\\','/')}';(window as any).probeCounts=${counts};(window as any).wbMock={metadata:{},settings:{},emit(){}};OBR.onReady(()=>setupWorkbench());(window as any).moduleReady=true;`);
await build({input:entry,plugins:[{name:'production-sdk-fixture',transform(code,id){if(process.env.SELECTION_BASELINE){for(const name of ['observation.ts','group-rolls.ts'])if(id.replaceAll('\\','/').endsWith('/src/workbench/'+name))code=readFileSync(join(process.env.SELECTION_BASELINE,'src/workbench',name),'utf8');}if(id.replaceAll('\\','/').endsWith('/src/workbench/background.ts'))code=profiled;return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');},resolveId(id){if(['./state','../state','../../state','../modules/bestiary/data'].includes(id))return join(root,'tools/fixtures/workbench-modules.ts');if(!id.startsWith('.')&&!id.startsWith('/')&&!/^[A-Z]:/i.test(id)&&!id.startsWith('\0'))try{return requireSuite.resolve(id==='events'?'events/':id);}catch{try{return requireWeb.resolve(id);}catch{}}}}],output:{file:join(out,'profile.js'),format:'esm',codeSplitting:false}});
const total=5,port=5631;
const list=Array.from({length:total},(_,i)=>({id:'hero'+i,name:'Synthetic '+i,owner_ids:['me'],visibility:'public',locked:false}));
const runtime={stats:{health:20,'max health':30,'temporary health':0,'armor class':15},conditions:[],resources:{}};
const BIND='com.character-cards/boundCardId',BASE='com.obr-suite/workbench/runtime-baseline',HP='com.obr-suite/bubbles/data';
const items=Array.from({length:25},(_,i)=>({id:'token'+i,name:'Token '+i,type:'IMAGE',layer:'CHARACTER',createdUserId:'me',position:{x:i,y:i},metadata:i<total?{[BIND]:list[i].id,[HP]:runtime.stats,[BASE]:{version:1,cardId:list[i].id,revision:1,value:runtime}}:{'test:data':'x'.repeat(1500)}}));
const scene={'com.character-cards/list':list,'com.obr-suite/workbench/shared':{id:'profile',revision:0}},room={'com.obr-suite/workbench/cards':list,'com.obr-suite/workbench/owner-roles':{me:'GM'}};
const docs=Object.fromEntries(list.map(c=>[c.id,{schema_version:'0.3',_suiteRevision:1,identity:{character_name:c.name},core_stats:{hp:{current:20,max:30,temp:0},ac:15},inventory:{},features:{},background:{},classes:[],abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(key=>[key,{total:12,modifier:1,save:{bonus:3}}])),portrait:'x'.repeat(50000)}]));
const parentScript=`window.state=${JSON.stringify({items,scene,room})};window.results=[];window.metrics=[];window.player={id:'me',connectionId:'connection',name:'Synthetic DM',color:'#50525B',role:'GM',metadata:{},selection:['token0'],syncView:false};
window.emit=(id,data)=>document.querySelector('iframe').contentWindow.postMessage({id,data},location.origin);
window.choose=id=>{player.selection=id?[id]:[];emit('OBR_PLAYER_EVENT_CHANGE',{player});};
window.addEventListener('message',event=>{const m=event.data;if(m.protocol==='full-suite-workbench/v1'){results.push({at:performance.now(),type:m.type,key:m.state?.key,name:m.state?.name,message:m.message,requestId:m.requestId,ok:m.ok,result:m.result,group:m.group,itemId:m.itemId,followRevision:m.followRevision});return;}if(!m.id||!m.nonce)return;metrics.push({id:m.id});
const s=state,d=m.data;let value={};switch(m.id){
case 'OBR_PLAYER_GET_ID':value={id:player.id};break;case 'OBR_PLAYER_GET_CONNECTION_ID':value={connectionId:player.connectionId};break;case 'OBR_PLAYER_GET_ROLE':value={role:player.role};break;case 'OBR_PLAYER_GET_NAME':value={name:player.name};break;case 'OBR_PLAYER_GET_COLOR':value={color:player.color};break;case 'OBR_PLAYER_GET_SELECTION':value={selection:player.selection};break;case 'OBR_PLAYER_GET_METADATA':value={metadata:player.metadata};break;case 'OBR_PARTY_GET_PLAYERS':value={players:[]};break;
case 'OBR_SCENE_IS_READY':value={ready:true};break;case 'OBR_SCENE_GET_METADATA':value={metadata:s.scene};break;case 'OBR_ROOM_GET_METADATA':value={metadata:s.room};break;case 'OBR_SCENE_ITEMS_GET_ALL_ITEMS':value={items:s.items};break;case 'OBR_SCENE_ITEMS_GET_ITEMS':value={items:s.items.filter(i=>d.ids.includes(i.id))};break;
case 'OBR_SCENE_SET_METADATA':Object.assign(s.scene,d.update);emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:s.scene});break;case 'OBR_ROOM_SET_METADATA':Object.assign(s.room,d.update);emit('OBR_ROOM_METADATA_EVENT_CHANGE',{metadata:s.room});break;case 'OBR_SCENE_ITEMS_UPDATE_ITEMS':for(const u of d.updates)Object.assign(s.items.find(i=>i.id===u.id),u);emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:s.items});break;
case 'OBR_VIEWPORT_GET_WIDTH':value={width:1200};break;case 'OBR_VIEWPORT_GET_HEIGHT':value={height:900};break;case 'OBR_VIEWPORT_GET_SCALE':value={scale:1};break;case 'OBR_VIEWPORT_GET_POSITION':value={position:{x:0,y:0}};break;case 'OBR_SCENE_GRID_GET_DPI':value={dpi:150};break;
}event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:value},event.origin);});`;
const shared=new Map();const relayPosts=[];let requests=0,documentWrites=0,slowId='',slowDelay=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<script>'+parentScript+'</script><iframe src="/child?obrref='+Buffer.from('http://127.0.0.1:'+port+' profile-room').toString('base64')+'"></iframe>');return;}if(u.pathname==='/child'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/profile.js"></script>');return;}if(u.pathname==='/profile.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,'profile.js')));return;}if(u.pathname.startsWith('/characters/')){requests++;const id=u.pathname.split('/')[3];if(id===slowId)await new Promise(r=>setTimeout(r,slowDelay));res.end(JSON.stringify(docs[id]));return;}if(u.pathname==='/suite-dev/relay'){if(req.method==='GET'){setTimeout(()=>{if(!res.destroyed)res.end('[]');},20000);return;}const parts=[];for await(const p of req)parts.push(p);let bytes=Buffer.concat(parts);if(req.headers['content-encoding']==='gzip')bytes=(await import('node:zlib')).gunzipSync(bytes);const body=JSON.parse(bytes);relayPosts.push(body);if(body.saveCard){const s=body.saveCard,doc=docs[s.card];if(createHash('sha256').update(JSON.stringify(doc)).digest('hex')!==s.expected){res.writeHead(409);res.end('{"error":"conflict"}');return;}for(const c of s.changes){let target=doc;for(const part of c.path.slice(0,-1))target=target[part]??=(typeof part==='number'?[]:{});const key=c.path.at(-1);if(c.remove)delete target[key];else target[key]=c.after;}documentWrites++;}if(body.sharedDocument){const d=body.sharedDocument,old=shared.get(d.key)||{revision:0,data:null};if(d.operation==='write'){if(d.expected!==old.revision){res.writeHead(409);res.end('{"error":"conflict"}');return;}shared.set(d.key,{revision:old.revision+1,data:d.data});}res.end(JSON.stringify(shared.get(d.key)||old));return;}res.end('{}');return;}res.writeHead(404);res.end('{}');}catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}});await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true}),reports=[],errors=[];
try{
const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:'+port+'/');const frame=page.frames().find(f=>f.url().includes('/child'));await frame.waitForFunction(()=>window.moduleReady);await page.evaluate(()=>emit('OBR_READY',{ref:'test',userId:'me'}));await frame.waitForFunction(()=>window.probe);
await frame.evaluate(async()=>{await window.probe.hydrate();window.probe.activate();await window.probe.refreshSelection();await window.probe.refresh();});await page.waitForFunction(()=>results.some(r=>r.type==='selection'&&r.key==='profile-room:card:hero0'));await page.waitForTimeout(150);
// These are real SDK event deliveries into the production observation layer.
await page.evaluate(()=>emit('OBR_PARTY_EVENT_CHANGE',{players:[{id:'other',connectionId:'other-c',name:'Other player',role:'PLAYER',color:'#444444',metadata:{},selection:[],syncView:false}]}));await page.waitForTimeout(180);
await frame.evaluate(()=>window.probe.resetCounts());const partyVersion=await frame.evaluate(()=>window.probe.observation.version());
await page.evaluate(()=>{for(let n=0;n<20;n++)emit('OBR_PARTY_EVENT_CHANGE',{players:[{id:'other',connectionId:'other-c',name:'Other player',role:'PLAYER',color:'#444444',metadata:{},selection:['token-'+n],syncView:!!(n%2)}]});});await page.waitForTimeout(150);
const partyCounts=await frame.evaluate(()=>window.probeCounts);reports.push({name:'other-player-selection-does-not-hydrate-or-refresh',passed:partyCounts.hydrate===0&&partyCounts.refresh===0&&(await frame.evaluate(()=>window.probe.observation.version()))===partyVersion,counts:partyCounts});
await frame.evaluate(()=>window.probe.request({type:'hello',clientInstance:'stable-viewer'}));await page.waitForTimeout(300);await page.evaluate(()=>results=[]);
for(let n=0;n<3;n++)await frame.evaluate(()=>window.probe.request({type:'hello',clientInstance:'stable-viewer'}));await page.waitForTimeout(300);
reports.push({name:'repeated-same-client-hello-does-not-resend-warm-portraits',passed:await page.evaluate(()=>results.filter(r=>r.type==='cacheSnapshot').length===0),cacheSnapshots:await page.evaluate(()=>results.filter(r=>r.type==='cacheSnapshot').length)});
await frame.evaluate(()=>window.probe.relayRequest({type:'hello',clientInstance:'stable-viewer'}));await page.waitForTimeout(300);
const wire=await frame.evaluate(()=>window.probe.wire());await page.evaluate(wire=>document.querySelector('iframe').contentWindow.postMessage({...wire,type:'ping',clientInstance:'stable-viewer'},location.origin),wire);await page.waitForTimeout(100);relayPosts.length=0;
await frame.evaluate(()=>window.probe.request({type:'hello',clientInstance:'stable-viewer'}));await page.waitForTimeout(250);
reports.push({name:'healthy-direct-window-does-not-duplicate-view-payloads-through-relay',passed:relayPosts.filter(m=>m.protocol).length===0,relayViewMessages:relayPosts.filter(m=>m.protocol).map(m=>m.type)});
relayPosts.length=0;await frame.evaluate(()=>window.probe.relayRequest({type:'hello',clientInstance:'replacement-viewer'}));await page.waitForTimeout(200);
reports.push({name:'new-relay-viewer-receives-catalog-despite-old-direct-window',passed:relayPosts.some(m=>m.type==='catalog')});
await frame.evaluate(()=>window.probe.request({type:'hello',clientInstance:'stable-viewer'}));
docs.cold={...structuredClone(docs.hero0),identity:{character_name:'Slow group target'}};slowId='cold';slowDelay=1400;
await page.evaluate(BIND=>{state.items.find(i=>i.id==='token22').metadata[BIND]='cold';state.scene['com.character-cards/list'].push({id:'cold',name:'Slow group target',owner_ids:['me'],visibility:'public',locked:false});emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:state.items});emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:state.scene});player.selection=['token1','token22'];emit('OBR_PLAYER_EVENT_CHANGE',{player});results=[];},BIND);await page.waitForTimeout(80);
const pending=await page.evaluate(()=>results.filter(r=>r.type==='groupRollState').at(-1)?.group);reports.push({name:'cold-multiselection-publishes-overview-before-document-arrives',passed:pending?.loading===true&&pending?.selectedCount===2,group:pending});
await page.evaluate(()=>{results=[];choose('token4');});await page.waitForTimeout(180);
reports.push({name:'cached-single-selection-bypasses-pending-group-read',passed:await page.evaluate(()=>results.some(r=>r.type==='selection'&&r.key==='profile-room:card:hero4'))});
await page.evaluate(()=>{results=[];choose('');});await page.waitForTimeout(150);
reports.push({name:'clear-selection-restores-original-card-and-emits-view-restore',passed:await page.evaluate(()=>results.some(r=>r.type==='followEnd'&&r.itemId==='card:hero0')&&results.some(r=>r.type==='selection'&&r.key==='profile-room:card:hero0'))});
await page.waitForTimeout(1500);reports.push({name:'late-group-download-cannot-reopen-cleared-overview',passed:await page.evaluate(()=>!results.some(r=>r.type==='groupRollState'&&r.group))});slowId='';slowDelay=0;
async function expected(name,key,timeout=700){const start=performance.now();let passed=true;try{await page.waitForFunction(key=>results.some(r=>r.type==='selection'&&r.key===key),key,{timeout,polling:10});}catch{passed=false;}reports.push({name,passed,elapsedMs:Math.round(performance.now()-start),chosen:await frame.evaluate(()=>window.probe.choice())});console.log(JSON.stringify(reports.at(-1)));}
await page.evaluate(()=>{results=[];choose('token24');});await page.waitForTimeout(120);
await page.evaluate(BIND=>{results=[];state.items.find(i=>i.id==='token24').metadata[BIND]='hero1';emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:state.items});},BIND);
await expected('same-selection-late-character-binding','profile-room:card:hero1');
await page.evaluate(()=>{choose('token2');});await page.waitForFunction(()=>results.some(r=>r.type==='selection'&&r.key==='profile-room:card:hero2'));
await page.evaluate(BIND=>{results=[];state.items.find(i=>i.id==='token2').metadata[BIND]='hero3';emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:state.items});},BIND);
await expected('same-selection-character-binding-replaced','profile-room:card:hero3');
await page.evaluate(()=>{results=[];choose('token23');});await page.waitForTimeout(100);
await page.evaluate(()=>{results=[];state.items.find(i=>i.id==='token23').metadata['com.bestiary/slug']='TEST::Monster';emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:state.items});});
await expected('same-selection-late-monster-component','profile-room:token:token23:TEST::Monster');
await page.evaluate(()=>{results=[];state.scene['com.bestiary/monsters']={'TEST::Monster':{name:'Synthetic scene monster',source:'TEST',hp:{average:13},ac:[14],str:10,dex:10,con:10,int:10,wis:10,cha:10}};emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:state.scene});});
let sceneMonsterUpdated=true;const sceneUpdateStart=performance.now();try{await page.waitForFunction(()=>results.some(r=>r.type==='selection'&&r.name==='Synthetic scene monster'),null,{timeout:700,polling:10});}catch{sceneMonsterUpdated=false;}
reports.push({name:'selected-monster-late-scene-definition-replaces-library-cache',passed:sceneMonsterUpdated,elapsedMs:Math.round(performance.now()-sceneUpdateStart)});console.log(JSON.stringify(reports.at(-1)));
await page.evaluate(()=>{results=[];delete state.scene['com.bestiary/monsters']['TEST::Monster'];emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:state.scene});});
let sceneMonsterRemoved=true;try{await page.waitForFunction(()=>results.some(r=>r.type==='selection'&&r.name==='测试怪物'),null,{timeout:700,polling:10});}catch{sceneMonsterRemoved=false;}
reports.push({name:'selected-monster-removed-scene-definition-restores-library-source',passed:sceneMonsterRemoved});
// Page/controller activity that only changes selection must not rehydrate all five cards.
await page.waitForTimeout(150);await frame.evaluate(()=>window.probe.resetCounts());let start=performance.now();const httpBefore=requests;
for(let i=0;i<12;i++){const id='token'+(3+i%2);await page.evaluate(id=>{results=[];choose(id);},id);await page.waitForFunction(key=>results.some(r=>r.type==='selection'&&r.key===key),'profile-room:card:hero'+(3+i%2),{polling:10});}
const counters=await frame.evaluate(()=>window.probeCounts);reports.push({name:'twelve-cached-selection-events-five-cards',elapsedMs:Math.round(performance.now()-start),counts:counters,httpReads:requests-httpBefore});console.log(JSON.stringify(reports.at(-1)));
// A pending uncached A cannot win after the user selects cached B.
docs.slow={...structuredClone(docs.hero0),identity:{character_name:'Synthetic slow'}};slowId='slow';slowDelay=1200;
await page.evaluate(()=>{state.scene['com.character-cards/list'].push({id:'slow',name:'Synthetic slow',owner_ids:['me'],visibility:'public',locked:false});emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:state.scene});});
await frame.waitForFunction(async()=>(await window.probe.catalog()).cards.some(c=>c.id==='slow'));
await frame.evaluate(()=>window.probe.select('card:slow'));await page.waitForTimeout(80);await page.evaluate(()=>results=[]);
const switched=performance.now();await frame.evaluate(()=>window.probe.select('card:hero0'));await expected('cached-B-bypasses-pending-A','profile-room:card:hero0',500);
const switchMs=Math.round(performance.now()-switched);await page.waitForTimeout(1300);
reports.push({name:'late-A-never-replaces-new-selection',passed:await page.evaluate(()=>!results.some(r=>r.type==='selection'&&r.key==='profile-room:card:slow')),cachedBMs:switchMs});slowId='';slowDelay=0;
// A name change is a real catalog change even though delivered in a player event.
await page.evaluate(()=>{results=[];player.name='Renamed DM';emit('OBR_PLAYER_EVENT_CHANGE',{player});});await page.waitForTimeout(120);
reports.push({name:'player-profile-event-still-refreshes-catalog',passed:await page.evaluate(()=>results.some(r=>r.type==='catalog'))});
// Leaving follow mode retains an explicit card through map selection and component arrival.
await frame.evaluate(()=>window.probe.request({type:'pin',pinned:true}));await page.waitForTimeout(50);const pinned=await frame.evaluate(()=>window.probe.choice());await page.evaluate(()=>{results=[];choose('token0');});await page.waitForTimeout(120);
reports.push({name:'pinned-selection-retained',passed:(await frame.evaluate(()=>window.probe.choice()))===pinned});
await frame.evaluate(()=>window.probe.request({type:'pin',pinned:false}));await expected('unpin-follows-current-selection','profile-room:card:hero0');
// Actual queued commands persist exactly once and still reject stale field baselines.
const writesBefore=documentWrites;
for(const [i,before,after] of [[1,20,19],[2,19,20]]){
 const requestId='stats-'+i;await frame.evaluate(m=>window.probe.request(m),{type:'stats',requestId,itemId:'card:hero0',key:'profile-room:card:hero0',expected:{health:before},patch:{health:after}});
 await page.waitForFunction(id=>results.some(r=>r.type==='ack'&&r.requestId===id),requestId);
 const ack=await page.evaluate(id=>results.find(r=>r.type==='ack'&&r.requestId===id),requestId);if(!ack.ok)throw Error('Durable stats command failed: '+JSON.stringify(ack));
}
await frame.evaluate(()=>window.probe.request({type:'stats',requestId:'stats-stale',itemId:'card:hero0',key:'profile-room:card:hero0',expected:{health:19},patch:{health:18}}));
await page.waitForFunction(()=>results.some(r=>r.type==='ack'&&r.requestId==='stats-stale'));
reports.push({name:'durable-stats-ack-and-stale-write-guard-preserved',passed:documentWrites-writesBefore===2&&docs.hero0.core_stats.hp.current===20&&await page.evaluate(()=>results.find(r=>r.type==='ack'&&r.requestId==='stats-stale').ok===false),durableWrites:documentWrites-writesBefore});
// Permission revocation remains authoritative and cannot be bypassed by selection recovery.
await page.evaluate(()=>{player.role='PLAYER';player.selection=['token4'];state.items.find(i=>i.id==='token4').createdUserId='other';for(const c of state.scene['com.character-cards/list'])if(c.id==='hero4'){c.owner_ids=['other'];c.visibility='owners';c.locked=true;}emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:state.items});emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:state.scene});emit('OBR_PLAYER_EVENT_CHANGE',{player});});await page.waitForTimeout(150);
const denied=await frame.evaluate(async()=>{try{await window.probe.access('card:hero4');return false;}catch{return true;}});reports.push({name:'permission-revocation-preserved',passed:denied});
await page.evaluate(()=>{results=[];state.items.find(i=>i.id==='token4').createdUserId='me';state.scene['com.character-cards/list'].find(c=>c.id==='hero4').owner_ids=['me'];emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:state.items});emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:state.scene});});
await expected('same-selection-restored-permission-recovers','profile-room:card:hero4');
writeFileSync(join(out,'results.json'),JSON.stringify({sourceSHA256:createHash('sha256').update(source).digest('hex'),actualSdk:true,actualCrossWindow:true,syntheticData:true,baseline:!!process.env.SELECTION_BASELINE,realRoomVerified:false,httpDocumentReads:requests,documentWrites,reports,errors},null,2));
if(process.env.EXPECT_PASS==='1'&&(errors.length||reports.some(r=>r.passed===false)))throw Error('A required behavior failed; inspect results.json');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
