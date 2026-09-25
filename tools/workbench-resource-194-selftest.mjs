// Resource regression: actual installed SDK + actual iframe boundary; synthetic HTTP room.
// Only the SDK host RPC/HTTP boundary is simulated. Production queues and notices run unchanged.
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const out=process.env.WORKBENCH_RESOURCE194_OUT||'F:/CodexWork/2026-09-20/w-xu/fixes194/host-results';mkdirSync(out,{recursive:true});
const source=readFileSync(process.env.PROFILE_SOURCE||'src/workbench/background.ts','utf8');
writeFileSync(join(out,'background-baseline.ts'),source);
const expose=`Object.assign(window,{liveProbe:{invalidateCard,catalog,snapshot,hydrate,refreshSelection,command,request(m){void receive({...m,protocol,session});},activate(){child=window.parent;chosen='card:hero';lastSelection='["one"]';},expire(){documentTimes.clear();},cache(){return {revision:documents.get('profile-room:card:hero')?._suiteRevision,time:documentTimes.get('profile-room:card:hero'),flight:cardReads.has('profile-room:card:hero'),chosen};}}});`;
const profiled=source.replace("setInterval(()=>send('pong',{at:Date.now()}),10000);",'').replace('setInterval(()=>{changed();scheduleInventoryRepair();},4000);',expose);
if(!profiled.includes(expose))throw Error('Probe hook no longer matches background');
const entry=resolve('tools/workbench-resource-194-entry.ts');
writeFileSync(entry,`import OBR from '@owlbear-rodeo/sdk';import {setupWorkbench} from '../src/workbench/background';(window as any).wbMock={metadata:{},settings:{},emit(){}};OBR.onReady(()=>setupWorkbench());(window as any).profileModuleReady=true;`);
try{await build({input:entry,plugins:[{name:'probe-boundary',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/workbench/background.ts'))code=profiled;return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');},resolveId(id){if(id==='./state'||id==='../state'||id==='../../state'||id==='../modules/bestiary/data')return resolve('tools/fixtures/workbench-modules.ts');}}],output:{file:join(out,'probe.js'),format:'esm',codeSplitting:false}});}finally{unlinkSync(entry);}
const list=Array.from({length:3},(_,i)=>({id:i?'hero'+i:'hero',name:'卡'+i,owner_ids:['other'],visibility:'public',locked:false,...(i?{}:{url:'http://127.0.0.1:5604/characters/upload-room/hero/data.json'})}));
const runtime={stats:{health:20,'max health':30,'temporary health':0,'armor class':15},conditions:[],resources:{}};
const items=list.map((c,i)=>({id:i?'token'+i:'one',name:c.name,type:'IMAGE',layer:'CHARACTER',createdUserId:'other',position:{x:i,y:i},metadata:{'com.character-cards/boundCardId':c.id,'com.obr-suite/bubbles/data':runtime.stats,'com.obr-suite/workbench/runtime-baseline':{version:1,cardId:c.id,revision:1,value:runtime}}}));
const scene={'com.character-cards/list':list,'com.obr-suite/workbench/shared':{id:'profile',revision:0}},room={'com.obr-suite/workbench/cards':list,'com.obr-suite/workbench/owner-roles':{me:'PLAYER',other:'PLAYER'}};
const docs=Object.fromEntries(list.map(c=>[c.id,{schema_version:'0.3',_suiteRevision:1,identity:{character_name:c.name},core_stats:{hp:{current:20,max:30,temp:0},ac:15},inventory:{},features:{},background:{},classes:[],web_conditions:[]}]));
const parentScript=`window.state=${JSON.stringify({items,scene,room})};window.results=[];window.rpc=[];window.blockProjection=false;window.projectionBlocked=[];window.projectionEvents=[];window.broadcasts=[];window.blockNoticeResponse=false;window.noticeBlocked=[];
window.addEventListener('message',event=>{const m=event.data,writer=event.source===document.querySelector('#writer')?.contentWindow;if(m.protocol==='full-suite-workbench/v1'){results.push({...m,at:performance.now(),writer,type:m.type,key:m.state?.key,revision:m.document?._suiteRevision,conditions:m.document?.web_conditions,health:m.document?.core_stats?.hp?.current,document:m.document});return;}if(!m.id||!m.nonce)return;rpc.push(m.id);const s=state,d=m.data;let value={};switch(m.id){
case 'OBR_PLAYER_GET_ID':value={id:writer?'writer':'me'};break;case 'OBR_PLAYER_GET_CONNECTION_ID':value={connectionId:writer?'writer-connection':'local-connection'};break;case 'OBR_PLAYER_GET_ROLE':value={role:'GM'};break;case 'OBR_PLAYER_GET_NAME':value={name:writer?'写入者':'只读玩家'};break;case 'OBR_PLAYER_GET_COLOR':value={color:'#50525B'};break;case 'OBR_PLAYER_GET_SELECTION':value={selection:['one']};break;case 'OBR_PLAYER_GET_METADATA':value={metadata:{}};break;case 'OBR_PARTY_GET_PLAYERS':value={players:[]};break;
case 'OBR_SCENE_IS_READY':value={ready:true};break;case 'OBR_SCENE_GET_METADATA':value={metadata:s.scene};break;case 'OBR_ROOM_GET_METADATA':value={metadata:s.room};break;case 'OBR_SCENE_ITEMS_GET_ALL_ITEMS':value={items:s.items};break;case 'OBR_SCENE_ITEMS_GET_ITEMS':value={items:s.items.filter(i=>d.ids.includes(i.id))};break;
case 'OBR_SCENE_SET_METADATA':Object.assign(s.scene,d.update);event.source.postMessage({id:'OBR_SCENE_METADATA_EVENT_CHANGE',data:{metadata:s.scene}},event.origin);break;case 'OBR_ROOM_SET_METADATA':Object.assign(s.room,d.update);event.source.postMessage({id:'OBR_ROOM_METADATA_EVENT_CHANGE',data:{metadata:s.room}},event.origin);break;
case 'OBR_SCENE_ITEMS_UPDATE_ITEMS':{const apply=(respond=true)=>{for(const u of d.updates)Object.assign(s.items.find(i=>i.id===u.id),u);for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items:s.items}},location.origin);if(respond)event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:{}},event.origin);};if(blockProjection&&writer){const responseOnly=blockProjection==='response';blockProjection=false;if(responseOnly)apply(false);const update=d.updates.find(u=>u.id==='one'),entry={at:performance.now(),revision:update?.metadata?.['com.obr-suite/workbench/runtime-baseline']?.revision,resource:update?.metadata?.['com.obr-suite/resources/data']?.find(r=>r.id==='points')?.current,released:false};projectionEvents.push(entry);projectionBlocked.push(()=>{entry.released=true;entry.releasedAt=performance.now();if(responseOnly)event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:{}},event.origin);else apply();});return;}apply();return;}
case 'OBR_BROADCAST_SEND_MESSAGE':broadcasts.push({at:performance.now(),writer,...d});for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_BROADCAST_MESSAGE_'+d.channel,data:{connectionId:writer?'writer-connection':'local-connection',data:d.data}},location.origin);if(blockNoticeResponse&&d.channel==='com.obr-suite/resources/changed'){blockNoticeResponse=false;noticeBlocked.push(()=>event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:{}},event.origin));return;}break;
}event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:value},event.origin);});`;
const currentRoomCopies=structuredClone(docs);const writesSeen=[],sharedDocs=new Map();let blockedId='',release,waiting=false;const reads=[];let readDelay=0;
const server=createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<script>'+parentScript+'</script><iframe src="/child?obrref='+Buffer.from('http://127.0.0.1:5604 profile-room').toString('base64')+'"></iframe>');return;}if(u.pathname==='/child'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/probe.js"></script>');return;}if(u.pathname==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,'probe.js')));return;}
if(u.pathname.startsWith('/characters/')){if(readDelay)await new Promise(resolve=>setTimeout(resolve,readDelay));const room=u.pathname.split('/')[2],id=u.pathname.split('/')[3],stored=room==='upload-room'?docs:currentRoomCopies,body=JSON.stringify(stored[id]);res.setHeader('ETag','same-second-same-length');if(req.headers['if-none-match']==='same-second-same-length'){res.writeHead(304);res.end();return;}reads.push({id,revision:docs[id]?._suiteRevision,at:Date.now()});if(id===blockedId){blockedId='';waiting=true;await new Promise(r=>release=r);waiting=false;}res.end(body);return;}
if(u.pathname==='/suite-dev/relay'){if(req.method==='GET'){setTimeout(()=>{if(!res.destroyed)res.end('[]');},20000).unref();return;}let parts=[];for await(const p of req)parts.push(p);let bytes=Buffer.concat(parts);if(req.headers['content-encoding']==='gzip')bytes=(await import('node:zlib')).gunzipSync(bytes);const body=JSON.parse(bytes);if(body.saveCard){const s=body.saveCard;writesSeen.push({room:s.room,card:s.card,inventoryRoom:s.inventoryRoom,paths:s.changes.map(c=>c.path)});const doc=(s.room==='upload-room'?docs:currentRoomCopies)[s.card];if(createHash('sha256').update(JSON.stringify(doc)).digest('hex')!==s.expected){res.writeHead(409);res.end('{"error":"conflict"}');return;}for(const c of s.changes){let target=doc;for(const part of c.path.slice(0,-1))target=target[part]??=(typeof part==='number'?[]:{});const key=c.path.at(-1);if(c.remove)delete target[key];else target[key]=c.after;}}
if(body.sharedDocument){const request=body.sharedDocument,previous=sharedDocs.get(request.key)||{revision:0,data:null};if(request.operation==='write'){if(request.expected!==previous.revision){res.writeHead(409);res.end('{"error":"conflict"}');return;}sharedDocs.set(request.key,{revision:previous.revision+1,data:request.data});}res.end(JSON.stringify(sharedDocs.get(request.key)||previous));}else res.end('{}');return;}res.writeHead(404);res.end('{}');});await new Promise(r=>server.listen(5604,'127.0.0.1',r));
const {chromium}=createRequire('D:/Desktop/DND-card-web/package.json')('@playwright/test'),browser=await chromium.launch({channel:'msedge',headless:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reports=[];
try{
const page=await browser.newPage();await page.goto('http://127.0.0.1:5604/');const frame=page.frames().find(f=>f.url().includes('/child'));await frame.waitForFunction(()=>window.profileModuleReady);await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({id:'OBR_READY',data:{ref:'test',userId:'me'}},location.origin));await frame.waitForFunction(()=>window.liveProbe);

const RES='com.obr-suite/resources/data',BASE='com.obr-suite/workbench/runtime-baseline',KEY='profile-room:card:hero';
const resource={id:'points',name:'点数',type:'count',current:2,max:2};
docs.hero.web_resources={points:structuredClone(resource)};
docs.hero.dnd_card_web={schemaVersion:1,id:'hero',name:'卡0',revision:1,selections:[],runtime:{hp:20,tempHp:0,resources:{points:structuredClone(resource)}},inventory:{coins:{}},spellSettings:{mode:'prepared',prepared:[],slots:{}}};
currentRoomCopies.hero=structuredClone(docs.hero);
await page.evaluate(({RES,BASE,resource})=>{const hero=state.items[0];hero.metadata[RES]=[resource];hero.metadata[BASE].value.resources={points:resource};for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items:state.items}},location.origin);},{RES,BASE,resource});
await frame.evaluate(()=>{window.liveProbe.activate();return window.liveProbe.refreshSelection();});await frame.waitForFunction(()=>window.liveProbe.cache().revision===1);
await page.evaluate(()=>{const f=document.createElement('iframe');f.id='writer';f.src=document.querySelector('iframe').src;document.body.append(f);});await page.waitForFunction(()=>!!document.querySelector('#writer')?.contentWindow?.profileModuleReady);const writer=page.frames().at(-1);await page.evaluate(()=>document.querySelector('#writer').contentWindow.postMessage({id:'OBR_READY',data:{ref:'test',userId:'writer'}},location.origin));await writer.waitForFunction(()=>window.liveProbe);await writer.evaluate(()=>{window.liveProbe.activate();return window.liveProbe.snapshot('card:hero');});
async function request(target,before,after,id=crypto.randomUUID()){
 await target.evaluate(m=>window.liveProbe.request(m),{type:'resource',requestId:id,itemId:'card:hero',key:KEY,resourceId:'points',expected:{...resource,current:before},resource:{...resource,current:after}});
 return id;
}
async function acknowledgement(id){await page.waitForFunction(id=>results.some(r=>r.type==='ack'&&r.requestId===id),id);const ack=await page.evaluate(id=>results.find(r=>r.type==='ack'&&r.requestId===id),id);assert(ack.ok,JSON.stringify(ack));assert(!ack.result?.warning,JSON.stringify(ack.result));return ack;}
async function noticeValues(){return page.evaluate(()=>broadcasts.filter(r=>r.channel==='com.obr-suite/resources/changed').map(r=>({delta:r.data.delta,current:r.data.resource?.current})));}

// Two commands have genuine successive baselines, and enter the actual receive queue.
// A UI submitting an empty delta for the second click is tested in the web suite.
const beforeWrites=writesSeen.length;
const first=await request(writer,2,1),second=await request(writer,1,2);
await acknowledgement(first);await acknowledgement(second);assert.deepEqual(await noticeValues(),[{delta:-1,current:1},{delta:1,current:2}]);
assert.equal(docs.hero.dnd_card_web.runtime.resources.points.current,2);
assert.equal(writesSeen.length,beforeWrites+2);
reports.push({name:'queued-2-to-1-to-2-persists-two-durable-resource-writes',resource:2,revision:docs.hero._suiteRevision,notices:await noticeValues()});

// Hold the OLD SDK-generated full metadata payload before the room applies it.
// Another actual SDK host commits and projects a newer value before it arrives.
await page.evaluate(()=>blockProjection=true);
const held=await request(writer,2,1);
await page.waitForFunction(()=>projectionBlocked.length===1);
const oldRevision=docs.hero._suiteRevision;
await frame.waitForFunction(revision=>window.liveProbe.cache().revision>=revision,oldRevision);
const newer=await request(frame,1,2);await acknowledgement(newer);
const newest=docs.hero._suiteRevision;
await page.waitForFunction(({BASE,newest})=>state.items[0].metadata[BASE].revision===newest,{BASE,newest});
const savesBeforeRelease=writesSeen.length;
await page.evaluate(()=>projectionBlocked.shift()());
await acknowledgement(held);
await page.waitForFunction(({BASE,newest,RES})=>state.items[0].metadata[BASE].revision===newest&&state.items[0].metadata[RES][0].current===2,{BASE,newest,RES});
await frame.evaluate(()=>window.liveProbe.hydrate('hero'));await writer.evaluate(()=>window.liveProbe.hydrate('hero'));
assert.equal(docs.hero.dnd_card_web.runtime.resources.points.current,2);
assert.equal(docs.hero._suiteRevision,newest);
assert.equal(writesSeen.length,savesBeforeRelease,'late projection must not cause a compensating document write');
reports.push({name:'late-old-full-metadata-projection-repairs-scene-without-reverting-resource-document',oldRevision,newest,documentWritesAfterLateProjection:writesSeen.length-savesBeforeRelease,notices:await noticeValues()});

// The room already applied the first projection; only its SDK response is slow.
// Durable saves and both notices must not wait on this scene rendering response.
await page.evaluate(()=>blockProjection='response');
const noticeStart=(await noticeValues()).length,at=Date.now();
const slow=await request(writer,2,1);
await page.waitForFunction(()=>projectionBlocked.length===1);
const fast=await request(writer,1,2);
await sleep(350);
const whileBlocked={acknowledgements:await page.evaluate(ids=>results.filter(r=>r.type==='ack'&&ids.includes(r.requestId)).length,[slow,fast]),notices:(await noticeValues()).slice(noticeStart),resource:docs.hero.dnd_card_web.runtime.resources.points.current,elapsedMs:Date.now()-at};
reports.push({name:'slow-sdk-projection-response-does-not-block-next-resource-command',...whileBlocked});
await page.evaluate(()=>projectionBlocked.shift()());
await acknowledgement(slow);await acknowledgement(fast);
assert.equal(whileBlocked.acknowledgements,2,'durable ACKs must not await a token projection response');assert.deepEqual(whileBlocked.notices,[{delta:-1,current:1},{delta:1,current:2}]);assert.equal(whileBlocked.resource,2);
await page.waitForFunction(({BASE,RES})=>state.items[0].metadata[RES][0].current===2&&state.items[0].metadata[BASE].value.resources.points.current===2,{BASE,RES});

// Resource, HP, full-save and condition commands share the same committed-card
// projection path. They all remain responsive while one SDK reply is held.
await page.evaluate(()=>blockProjection='response');
const sharedSlow=await request(writer,2,1);await page.waitForFunction(()=>projectionBlocked.length===1);
const statsId=crypto.randomUUID();await writer.evaluate(m=>window.liveProbe.request(m),{type:'stats',requestId:statsId,itemId:'card:hero',key:KEY,expected:{health:20},patch:{health:17}});
await acknowledgement(statsId);
const previous=structuredClone(docs.hero),native=structuredClone(previous.dnd_card_web);native.runtime.resources.points.current=0;native.revision++;
const saved={...previous,dnd_card_web:native},saveId=crypto.randomUUID();await writer.evaluate(m=>window.liveProbe.request(m),{type:'save',requestId:saveId,itemId:'card:hero',key:KEY,previous:previous.dnd_card_web,native,previousData:previous,data:saved,observed:previous});
await acknowledgement(saveId);
const conditionId=crypto.randomUUID(),condition={id:'restrained',name:'束缚',entry:{id:'suite-condition:restrained',kind:'condition',name:'束缚',english:'Restrained',source:'IMPORTED',edition:'both',packId:'imported',revision:'1',entries:[],raw:{_suiteStatusId:'restrained'}},level:1};
await writer.evaluate(m=>window.liveProbe.request(m),{type:'condition',requestId:conditionId,itemId:'card:hero',action:'add',condition});await acknowledgement(conditionId);await acknowledgement(sharedSlow);
assert.equal(await page.evaluate(()=>projectionBlocked.length),1,'test must still be holding the actual first SDK reply');
assert.equal(docs.hero.core_stats.hp.current,17);assert.equal(docs.hero.dnd_card_web.runtime.resources.points.current,0);assert(docs.hero.dnd_card_web.selections.some(row=>row.entry.raw._suiteStatusId==='restrained'));
const latestRevision=docs.hero._suiteRevision;await page.evaluate(()=>projectionBlocked.shift()());
await page.waitForFunction(({BASE,RES,latestRevision})=>state.items[0].metadata[BASE].revision===latestRevision&&state.items[0].metadata[RES][0].current===0&&state.items[0].metadata['com.obr-suite/bubbles/data'].health===17,{BASE,RES,latestRevision});
reports.push({name:'resource-stats-save-condition-ack-before-projection-response-and-converge-to-latest',acknowledgements:4,latestRevision,resource:0,health:17,condition:'restrained'});

// Broadcast delivery already happened; a delayed sender receipt must not hold
// the next durable change or manufacture duplicate notices.
await page.evaluate(()=>blockNoticeResponse=true);
const noticeBaseline=(await noticeValues()).length;
const noticeSlow=await request(writer,0,1);await page.waitForFunction(()=>noticeBlocked.length===1);
const noticeFast=await request(writer,1,0);await sleep(350);
const whileNoticeBlocked={acknowledgements:await page.evaluate(ids=>results.filter(r=>r.type==='ack'&&ids.includes(r.requestId)).length,[noticeSlow,noticeFast]),notices:(await noticeValues()).slice(noticeBaseline),resource:docs.hero.dnd_card_web.runtime.resources.points.current};
reports.push({name:'slow-notice-sdk-response-does-not-block-next-resource-command',...whileNoticeBlocked});
await page.evaluate(()=>noticeBlocked.shift()());await acknowledgement(noticeSlow);await acknowledgement(noticeFast);
assert.equal(whileNoticeBlocked.acknowledgements,2);assert.deepEqual(whileNoticeBlocked.notices,[{delta:1,current:1},{delta:-1,current:0}]);assert.equal(whileNoticeBlocked.resource,0);
const notices=await page.evaluate(()=>broadcasts.filter(r=>r.channel==='com.obr-suite/resources/changed').map(r=>r.data.noticeId));assert.equal(new Set(notices).size,notices.length,'each committed action emits one unique notice');

// A monster has no durable card document: its metadata write is the commit,
// so acknowledging it early would be false success.
await page.evaluate(({RES,resource})=>{state.items.push({id:'monster',name:'测试怪物',type:'IMAGE',createdUserId:'writer',metadata:{'com.bestiary/slug':'TEST::Monster','com.obr-suite/bubbles/data':{health:10,'max health':10},[RES]:[resource]}});for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items:state.items}},location.origin);blockProjection='response';},{RES,resource});
const monsterId=crypto.randomUUID();await writer.evaluate(m=>window.liveProbe.request(m),{type:'resource',requestId:monsterId,itemId:'monster',resourceId:'points',expected:resource,resource:{...resource,current:1}});
await page.waitForFunction(()=>projectionBlocked.length===1);await sleep(120);
assert.equal(await page.evaluate(id=>results.filter(r=>r.type==='ack'&&r.requestId===id).length,monsterId),0);
await page.evaluate(()=>projectionBlocked.shift()());await acknowledgement(monsterId);
reports.push({name:'monster-metadata-only-mutation-awaits-actual-sdk-commit',earlyAcknowledgements:0});

// A real native edit after a current projection still flows to the document.
await page.evaluate(({RES})=>{state.items[0].metadata[RES][0].current=1;for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items:state.items}},location.origin);},{RES});
await frame.waitForFunction(()=>window.liveProbe.cache().revision>0);
for(let i=0;i<100&&docs.hero.dnd_card_web.runtime.resources.points.current!==1;i++)await sleep(30);
assert.equal(docs.hero.dnd_card_web.runtime.resources.points.current,1);
reports.push({name:'current-native-token-resource-edit-remains-supported',resource:1,revision:docs.hero._suiteRevision});
// A genuine unrelated native edit while a document projection is queued must
// survive coalescing. It is imported by reconciliation, never painted over.
await page.evaluate(()=>blockProjection='response');
const overlapFirst=await request(writer,1,0);await page.waitForFunction(()=>projectionBlocked.length===1);await acknowledgement(overlapFirst);
const overlapSecond=await request(writer,0,1);await acknowledgement(overlapSecond);
await page.evaluate(()=>{state.items[0].metadata['com.obr-suite/bubbles/data'].health=14;for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items:state.items}},location.origin);});
await page.evaluate(()=>projectionBlocked.shift()());await sleep(80);
assert.equal(await page.evaluate(()=>state.items[0].metadata['com.obr-suite/bubbles/data'].health),14,'latest resource projection must not erase an unrelated native HP edit');
await writer.evaluate(()=>window.liveProbe.hydrate('hero'));
assert.equal(docs.hero.core_stats.hp.current,14);assert.equal(docs.hero.dnd_card_web.runtime.resources.points.current,1);
reports.push({name:'coalesced-projection-preserves-uncommitted-native-hp-edit',resource:1,health:14});

// A slow full-card download must not precede the next mutation after our own
// durable write. CAS at the server still protects against an unseen remote edit.
await writer.evaluate(()=>window.liveProbe.snapshot('card:hero'));
readDelay=1800;
const burstA=await request(writer,1,0);await sleep(450);
const firstFast=await page.evaluate(id=>results.find(r=>r.type==='ack'&&r.requestId===id),burstA);
assert(firstFast?.ok,'warm resource write redundantly waits for a full-card GET');
const burstB=await request(writer,0,1);await sleep(450);
const secondFast=await page.evaluate(id=>results.find(r=>r.type==='ack'&&r.requestId===id),burstB);
assert(secondFast?.ok,'second resource write redundantly waits for a full-card GET');
readDelay=0;
reports.push({name:'own-committed-card-cache-does-not-redownload-before-each-burst-write',firstHostMs:firstFast.timing.hostMs,secondHostMs:secondFast.timing.hostMs});

// A remote write whose invalidation has not arrived must still fail CAS,
// never overwrite that authority with our cached document.
await writer.evaluate(()=>window.liveProbe.snapshot('card:hero'));
docs.hero.web_resources.points.current=2;docs.hero.dnd_card_web.runtime.resources.points.current=2;docs.hero._suiteRevision++;
const unseen=await request(writer,1,0);await page.waitForFunction(id=>results.some(r=>r.type==='ack'&&r.requestId===id),unseen);
const rejected=await page.evaluate(id=>results.find(r=>r.type==='ack'&&r.requestId===id),unseen);
assert.equal(rejected.ok,false);assert.equal(docs.hero.dnd_card_web.runtime.resources.points.current,2);
reports.push({name:'unannounced-remote-edit-is-protected-by-authority-CAS',rejected:true,remoteValue:2});

// DM imports retain the DM owner, but the assigned token grants its player
// editing even while the card is locked. A reassignment revokes that grant.
async function changePlayer(role){await page.evaluate(role=>{for(const f of document.querySelectorAll('iframe')){const writer=f.id==='writer';f.contentWindow.postMessage({id:'OBR_PLAYER_EVENT_CHANGE',data:{player:{id:writer?'writer':'me',role,name:'验收玩家',selection:['one'],metadata:{},color:'#555555',connectionId:writer?'writer-connection':'local-connection'}}},location.origin);}},role);}
await page.evaluate(()=>{state.items[0].createdUserId='writer';for(const row of state.scene['com.character-cards/list'])if(row.id==='hero'){row.owner_ids=['dm-importer'];row.locked=true;row.visibility='owners';}for(const f of document.querySelectorAll('iframe')){f.contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items:state.items}},location.origin);f.contentWindow.postMessage({id:'OBR_SCENE_METADATA_EVENT_CHANGE',data:{metadata:state.scene}},location.origin);}});
await changePlayer('PLAYER');await sleep(50);
const ownerView=await writer.evaluate(()=>window.liveProbe.catalog());const owned=ownerView.cards.find(c=>c.id==='hero');assert.equal(owned?.write,true);assert(owned.owner_ids.includes('writer'));assert(!ownerView.cards.find(c=>c.id==='hero1')?.write);
const privateView=await frame.evaluate(()=>window.liveProbe.catalog());assert(!privateView.cards.some(c=>c.id==='hero'));
await writer.evaluate(()=>{window.liveProbe.invalidateCard('hero');return window.liveProbe.hydrate('hero');});
const ownerBefore=structuredClone(docs.hero),ownerNative=structuredClone(ownerBefore.dnd_card_web);ownerNative.name='玩家成功修改';ownerNative.revision++;
const ownerSave=crypto.randomUUID();await writer.evaluate(m=>window.liveProbe.request(m),{type:'save',requestId:ownerSave,itemId:'card:hero',key:KEY,previous:ownerBefore.dnd_card_web,native:ownerNative,previousData:ownerBefore,data:{...ownerBefore,identity:{...ownerBefore.identity,character_name:ownerNative.name},dnd_card_web:ownerNative},observed:ownerBefore});await acknowledgement(ownerSave);assert.equal(docs.hero.dnd_card_web.name,'玩家成功修改');
const writesBeforeRecheck=writesSeen.length;docs.hero.dnd_card_web.player='fresh-read-marker';docs.hero._suiteRevision++;
const recheckId=crypto.randomUUID();await writer.evaluate(m=>window.liveProbe.request(m),{type:'refreshCard',requestId:recheckId,itemId:'card:hero'});const recheck=await acknowledgement(recheckId);assert.equal(recheck.result.snapshot.document.dnd_card_web.player,'fresh-read-marker');assert.equal(writesSeen.length,writesBeforeRecheck,'recheck must not replay a save');
reports.push({name:'sync-recheck-fetches-authority-without-replaying-mutation',writes:0});
await page.evaluate(()=>{state.items[0].createdUserId='next-player';for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({id:'OBR_SCENE_ITEMS_EVENT_CHANGE',data:{items:state.items}},location.origin);});await sleep(40);
const revoked=await writer.evaluate(()=>window.liveProbe.catalog());assert(!revoked.cards.some(c=>c.id==='hero'),'old token owner must lose access after reassignment');
await assert.rejects(()=>writer.evaluate(()=>window.liveProbe.command({type:'stats',itemId:'card:hero',patch:{health:1},expected:{health:14}})));
reports.push({name:'DM-import-assigned-token-grants-real-player-save-and-reassignment-revokes',savedName:docs.hero.dnd_card_web.name});
await changePlayer('GM');await sleep(40);
const noNoticesBefore=(await noticeValues()).length;
const hpId=crypto.randomUUID();await writer.evaluate(m=>window.liveProbe.request(m),{type:'stats',requestId:hpId,itemId:'monster',expected:{health:10,'max health':10,'temporary health':undefined},patch:{health:6,'max health':12,'temporary health':3}});await acknowledgement(hpId);
assert.equal((await noticeValues()).length,noNoticesBefore,'monster HP must not broadcast notices');
assert.equal(await page.evaluate(()=>state.items.find(i=>i.id==='monster').metadata['com.obr-suite/bubbles/data'].health),6);
reports.push({name:'monster-current-max-and-temp-hp-commit-without-notification',notices:0});

const result={sourceSHA256:createHash('sha256').update(source).digest('hex'),noticeSourceSHA256:createHash('sha256').update(readFileSync('src/workbench/notices.ts')).digest('hex'),actualSdk:true,actualCrossWindow:true,simulatedBackend:true,realRoomVerified:false,reports,reads,writesSeen,rpc:await page.evaluate(()=>rpc),broadcasts:await page.evaluate(()=>broadcasts),acks:await page.evaluate(()=>results.filter(r=>r.type==='ack'))};writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,reads:result.reads.length,writesSeen:result.writesSeen.length,rpc:result.rpc.length,broadcasts:result.broadcasts.length,acks:result.acks.length},null,2));
}finally{if(release)release();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
