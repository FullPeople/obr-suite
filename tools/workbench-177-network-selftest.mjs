import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
process.env.CARD_READ_BASE=process.env.CARD_WRITE_BASE='http://127.0.0.1:5397';
process.env.PORT='5398';process.env.RELAY_ORIGIN='http://127.0.0.1:5397';
process.env.WORKBENCH_DATA_DIR=resolve('workbench-test-output/shared-'+crypto.randomUUID());
const {server:relayServer}=await import('../server/workbench-relay/server.mjs');
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';


const web=process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web',out=resolve('workbench-test-output/sync177');mkdirSync(out,{recursive:true});
const {chromium,expect}=createRequire(join(web,'package.json'))('@playwright/test');
const define={'import.meta.env.BASE_URL':JSON.stringify('/suite-dev/'),'import.meta.env.DEV':'false'};
const environment={name:'environment',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}};
const plugins=[environment,{name:'sdk-boundary',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-sdk.ts');if(id==='./state'||id==='../state'||id==='../../state'||id==='../modules/bestiary/data')return resolve('tools/fixtures/workbench-modules.ts');}}];
await build({input:resolve('tools/workbench-177-network-selftest.entry.ts'),plugins,output:{dir:out,entryFileNames:'background.js',format:'esm'}});
await build({input:resolve('src/workbench/launcher.ts'),plugins,output:{file:join(out,'launcher.js'),format:'esm'}});
await build({input:resolve('src/modules/dice/effect-page.ts'),plugins,output:{file:join(out,'effect.js'),format:'esm'}});
await build({input:resolve('src/resource-toast-page.ts'),plugins:[environment,{name:'toast-sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-toast-sdk.ts');}}],output:{file:join(out,'toast-test.js'),format:'esm'}});
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'};
let documents,saves=0,failSaves=false,saveDelay=0,previewUrl='',delayedReads=[]; const reads={}, bytes={get:0,put:0}; let slowId='',slowDelay=0;
const server=createServer(async(req,res)=>{const p=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(p==='/test-tone.wav'){const audio=Buffer.alloc(44+16000);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(16000,40);res.setHeader('Content-Type','audio/wav');res.setHeader('Access-Control-Allow-Origin','*');res.end(audio);return;}
 if(p==='/preview'&&previewUrl){res.writeHead(302,{Location:previewUrl});res.end();return;}
 if(p==='/api/character/create-from-json'){let body='';for await(const part of req)body+=part;const id='created-'+crypto.randomUUID();documents[id]=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id,name:documents[id].identity.character_name}));return;}
 if(/^\/(characters|api\/character)\//.test(p)){const id=p.split('/').filter(Boolean)[p.startsWith('/api/')?3:2];res.setHeader('Content-Type','application/json');if(req.method==='DELETE'){delete documents[id];res.end(JSON.stringify({ok:true}));return;}if(req.method==='PUT'){if(failSaves){res.writeHead(503);res.end('{}');return;}let body='';for await(const part of req)body+=part;if(saveDelay)await new Promise(r=>setTimeout(r,saveDelay));documents[id]=JSON.parse(body);saves++;res.end(JSON.stringify({ok:true}));}else {reads[id]=(reads[id]||0)+1;const body=JSON.stringify(documents[id]);bytes.get+=Buffer.byteLength(body);if(slowId===id&&slowDelay){await new Promise(r=>setTimeout(r,slowDelay));}if(delayedReads.length){const delay=delayedReads.shift();setTimeout(()=>res.end(body),delay);}else res.end(body);}return;}
 if(p==='/suite-dev/relay'){const proxy=httpRequest('http://127.0.0.1:5398/'+req.url.slice(req.url.indexOf('?')),{method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});proxy.on('error',()=>{res.writeHead(502);res.end();});req.pipe(proxy);return;}
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<iframe id="bg" src="http://127.0.0.1:5397/background.html"></iframe><iframe id="launcher" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" src="http://127.0.0.1:5397/launcher.html" style="width:420px;height:540px"></iframe>');return;}
 if(p==='/suite-dev/dice-effect.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('dice-effect.html','utf8').replace('/src/modules/dice/effect-page.ts','/effect.js'));return;}
 if(/^\/suite-dev\/d(?:4|6|8|10|12|20|100)\.png$/.test(p)){try{res.setHeader('Content-Type','image/png');res.end(readFileSync(join('public',p.slice('/suite-dev/'.length))));}catch{res.writeHead(404);res.end();}return;}
 if(p==='/toast-test.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('resource-toast.html','utf8').replace('/src/resource-toast-page.ts','/toast-test.js'));return;}
 if(p==='/background.html'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/background.js"></script>');return;}
 if(p==='/launcher.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('workbench-launcher.html','utf8').replace('/src/workbench/launcher.ts','/launcher.js'));return;}
 const file=p.startsWith('/suite-dev/workbench-panels/')?join('dist-workbench-dev/workbench-panels',p.slice('/suite-dev/workbench-panels/'.length)):p.startsWith('/suite-dev/workbench-dice/')?join('dist-workbench-dev/workbench-dice',p.slice('/suite-dev/workbench-dice/'.length)):p.startsWith('/suite-dev/workbench/')?join(process.env.DND_WEB_DIST||join(web,'dist'),p.slice('/suite-dev/workbench/'.length)):p.startsWith('/suite-dev/')?join('dist-workbench-dev',p.slice('/suite-dev/'.length)):join(out,p.slice(1));
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(5397,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1500,height:1000}}),errors=[];
await context.addInitScript(()=>{window.sfxStarts=0;for(const constructor of [window.OscillatorNode,window.AudioBufferSourceNode]){const original=constructor.prototype.start;constructor.prototype.start=function(...args){window.sfxStarts++;return original.apply(this,args);};}});
await context.exposeBinding('__recordWorkbenchError',(_,message)=>errors.push(String(message)));await context.addInitScript(()=>window.addEventListener('workbench-error',e=>window.__recordWorkbenchError(typeof e.detail==='string'?e.detail:e.detail.message)));
context.on('page',p=>{p.on('response',response=>{if(response.status()===404)console.log('MISSING ASSET',response.url());});p.on('pageerror',e=>{console.log('RUNTIME ERROR',e.stack);errors.push(e.message);});p.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('BROWSER CONSOLE',m.text());});});
const card=name=>({schema_version:'0.3',identity:{character_name:name},meta:{ruleset:'2024'},abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(a=>[a,{total:12}])),classes:[{name:'法师',level:2}],core_stats:{hp:{current:20,max:30,temp:2},ac:15,passive_perception:12,hit_dice:{die_size:6,max:2,current:2}},features:{},background:{},inventory:{},defenses:{custom:'preserved'},combat:{weapons:[{name:'保留的武器'}]}});
documents={hero:card('阿明'),second:card('贝拉')};
for(const [id,doc] of Object.entries(documents))doc.dnd_card_web={schemaVersion:1,id,name:doc.identity.character_name,revision:1,runtime:{hp:doc.core_stats.hp.current,tempHp:2,resources:{}},selections:[],inventory:{coins:{}},spellSettings:{mode:'prepared',prepared:[],slots:{}},notes:''};
await context.route('https://unused-fixture.invalid/**',r=>{const path=new URL(r.request().url()).pathname;const body=path==='/data/bestiary/index.json'?{test:'bestiary-test.json'}:path.endsWith('/bestiary-test.json')?{monster:['甲','乙'].map((name,i)=>({name:'样本怪物'+name,ENG_name:'Sample '+i,source:'XMM',str:12,dex:10,con:10,int:8,wis:10,cha:8,ac:[12],hp:{average:12},speed:{walk:30},trait:[{name:'样本特性'+name,entries:['只应出现一次的正文。']}],action:[{name:'攻击',entries:['命中 {@hit 2}。']}]}))}:{};return r.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});});
const fixtures={
 'class/index.json':{XPHB:'class-test.json'},'class/class-test.json':{class:[]},'bestiary/index.json':{XMM:'bestiary-test.json'},'bestiary/bestiary-test.json':{monster:[]},
 'spells/index.json':{XPHB:'spells-xphb.json'},'spells/spells-xphb.json':{spell:[{name:'微光术',ENG_name:'Test Glow',source:'XPHB',level:0,entries:['自制法术正文。']}]},
 'races.json':{race:[{name:'测试旅人',ENG_name:'Traveller',source:'XPHB',size:['M'],speed:30,entries:['自制种族正文。']}]},
 'items-base.json':{baseitem:[{name:'铜制罗盘',ENG_name:'Compass',source:'XPHB',weight:2,value:500,entries:['自制罗盘说明。']}]},
 'conditionsdiseases.json':{condition:[{name:'束缚',ENG_name:'Restrained',source:'XPHB',entries:['自制状态说明。']}]}
};await context.route('https://5e.kiwee.top/**',r=>r.fulfill({json:fixtures[new URL(r.request().url()).pathname.replace('/data/','')]||{},headers:{'access-control-allow-origin':'*'}}));

let checks=0;const check=(v,name)=>{assert(v,name);console.log('PASS',++checks,name);};
const clients=[];
async function connect(ctx=context){
 const room=await ctx.newPage();await room.goto('http://localhost:5397/');const launcher=room.frameLocator('#launcher');await launcher.locator('#open[href]').waitFor();const bg=room.frames().find(f=>f.url().includes('background.html')),url=await launcher.locator('#open').getAttribute('href'),params=new URLSearchParams(new URL(url).hash.slice(1)),events=[],base='http://127.0.0.1:5398/?'+new URLSearchParams({session:params.get('suite'),role:'client'}),headers={Authorization:'Bearer '+params.get('relay'),'Content-Type':'application/json'};
 let stopped=false;const loop=(async()=>{while(!stopped){try{const r=await fetch(base,{headers,signal:AbortSignal.timeout(21000)});const messages=await r.json();if(Array.isArray(messages))events.push(...messages);}catch{if(!stopped)await new Promise(r=>setTimeout(r,100));}}})();
 const post=async(type,extra={})=>{await fetch(base,{method:'POST',headers,body:JSON.stringify({protocol:'full-suite-workbench/v1',session:params.get('suite'),type,...extra})});};
 const command=async(type,extra={})=>{const requestId=crypto.randomUUID();await post(type,{requestId,...extra});await expect.poll(()=>events.some(e=>e.type==='ack'&&e.requestId===requestId),{timeout:20000}).toBe(true);return events.find(e=>e.type==='ack'&&e.requestId===requestId);};
 const latest=type=>events.filter(e=>e.type===type).at(-1);await post('hello');await expect.poll(()=>!!latest('catalog'),{timeout:20000}).toBe(true);
 const client={room,bg,url,params,post,command,latest,events,stop(){stopped=true;}};clients.push(client);return client;
}
const KEY='test-room:card:hero',BASE='com.obr-suite/workbench/runtime-baseline',BUFFS='com.obr-suite/status/buffs',RES='com.obr-suite/resources/data';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function save(client,mutate,before=structuredClone(documents.hero)){
 const native=structuredClone(before.dnd_card_web);mutate(native);native.revision++;const data={...before,dnd_card_web:native};
 return client.command('save',{itemId:'card:hero',key:KEY,native,previous:before.dnd_card_web,data,previousData:before});
}

try{
 // Cold start: no legacy CharacterCards/Dice module is initialized in this fixture.
 slowId='second';slowDelay=12000;const cold=Date.now(),a=await connect();await expect.poll(()=>a.latest('selection')?.state.cardId,{timeout:4000}).toBe('hero');
 check(Date.now()-cold<5000,'cold standalone host selects first card while unrelated card read is stalled 12 s');
 await expect.poll(()=>reads.second||0).toBeGreaterThan(0);slowDelay=0;
 await expect.poll(()=>a.bg.evaluate(()=>window.wbMock.popovers.some(p=>p.id==='com.obr-suite/dice-history'&&p.url.endsWith('?mode=all')))).toBe(true);check(true,'standalone dev opens original bottom-right dice history in persistent mode');
 const choose=Date.now();await a.post('select',{itemId:'goblin'});await expect.poll(()=>a.latest('selection')?.state.itemId,{timeout:3500}).toBe('goblin');
 check(Date.now()-choose<3500,'monster selection bypasses unrelated card and inventory hydration');
 await a.post('select',{itemId:'card:hero'});await expect.poll(()=>a.latest('selection')?.state.cardId).toBe('hero');
 const resource={id:'points',name:'点数',current:3,max:3,type:'count'};
 let ack=await a.command('resource',{itemId:'card:hero',resourceId:'points',expected:null,resource});assert(ack.ok,ack.message);
 // A slow committing write does not block selection, console, or healthy heartbeats.
 saveDelay=18000;const start=Date.now(),flight=a.command('resource',{itemId:'card:hero',resourceId:'points',expected:resource,resource:{...resource,current:2}});
 await sleep(100);await a.post('select',{itemId:'goblin'});await expect.poll(()=>a.latest('selection')?.state.itemId,{timeout:3500}).toBe('goblin');check(Date.now()-start<4000,'card selection remains responsive during an 18 s durable write');
 const toggle=Date.now();ack=await a.command('console',{action:'portalEffects',value:false});assert(ack.ok,ack.message);check(Date.now()-toggle<2000,'console setting bypasses the character write queue');
 const silentStart=Date.now();ack=await a.command('inventory',{operation:{action:'silent',operationId:crypto.randomUUID(),value:true}});assert(ack.ok,ack.message);check(Date.now()-silentStart<2500,'DM message toggle does not wait for unrelated character write');
 const duplicateId=crypto.randomUUID(),settingCount=await a.bg.evaluate(()=>{window.wbMock.settingDelay=350;return window.wbMock.settingWrites||0;});await Promise.all([a.post('console',{requestId:duplicateId,action:'portalEffects',value:true}),a.post('console',{requestId:duplicateId,action:'portalEffects',value:true})]);await expect.poll(()=>a.events.some(e=>e.type==='ack'&&e.requestId===duplicateId)).toBe(true);check(await a.bg.evaluate(()=>window.wbMock.settingWrites)===settingCount+1,'overlapping duplicate fast-lane requests execute exactly once');await a.bg.evaluate(()=>window.wbMock.settingDelay=0);
 const expired=crypto.randomUUID();await a.post('resource',{requestId:expired,expiresAt:Date.now()-1,itemId:'card:hero',resourceId:'points',expected:{...resource,current:2},resource:{...resource,current:1}});
 await expect.poll(()=>a.events.some(e=>e.type==='pong'&&e.at>start),{timeout:12000}).toBe(true);check(true,'host heartbeat continues while long write is pending');
 const saved=await flight;assert(saved.ok,saved.message);saveDelay=0;
 await expect.poll(()=>a.events.find(e=>e.type==='ack'&&e.requestId===expired),{timeout:4000}).toBeTruthy();check(!a.events.find(e=>e.type==='ack'&&e.requestId===expired).ok&&documents.hero.dnd_card_web.runtime.resources.points.current===2,'expired queued intention never executes or rolls back the newer value');
 const completedId=a.events.filter(e=>e.type==='ack'&&e.ok&&e.result?.snapshot?.state.resources?.some(r=>r.id==='points'&&r.current===2)).at(-1).requestId;
 const beforeReceipt=documents.hero._suiteRevision;await a.post('requestStatus',{requestId:completedId});await expect.poll(()=>a.events.filter(e=>e.type==='ack'&&e.requestId===completedId).length,{timeout:4000}).toBeGreaterThanOrEqual(2);check(documents.hero._suiteRevision===beforeReceipt,'lost confirmation recovery returns same receipt without replaying write');
 // Transaction confirmation must not wait on card projection / large card read.
 await expect.poll(()=>a.latest('catalog')?.inventory?.containers['card:hero']).toBeTruthy();
 let inv=a.latest('catalog').inventory;const pub=inv.publicId;
 ack=await a.command('inventory',{operation:{action:'add',operationId:crypto.randomUUID(),container:pub,expected:{[pub]:inv.containers[pub].revision},row:{id:'test-stock',kind:'item',name:'罗盘',entry:{id:'item:compass',kind:'item',name:'罗盘',entries:[]},quantity:1,slot:0,revision:1}}});assert(ack.ok,ack.message);inv=ack.result.inventory;
 slowId='hero';slowDelay=12000;const transfer=Date.now();ack=await a.command('inventory',{operation:{action:'transfer',operationId:crypto.randomUUID(),from:pub,to:'card:hero',expected:{[pub]:inv.containers[pub].revision},rows:[{id:'test-stock',quantity:1,newId:'my-compass'}]}});assert(ack.ok,ack.message);
 check(Date.now()-transfer<2500&&ack.result.inventory.containers['card:hero'].items.some(r=>r.id==='my-compass'),'inventory confirms atomic ledger without waiting 12 s on card mirror');
 slowDelay=0;slowId='';
 // New commands must see durable container locks, not trust a stale UI authority.
 inv=ack.result.inventory;ack=await a.command('inventory',{operation:{action:'containerLock',operationId:crypto.randomUUID(),container:pub,expected:{[pub]:inv.containers[pub].revision},locked:true}});assert(ack.ok,ack.message);check(ack.result.inventory.containers[pub].locked,'warehouse lock is persisted with the inventory document');
 await a.bg.evaluate(()=>{window.wbMock.role='PLAYER';window.wbMock.emit('player',{role:'PLAYER'});});
 ack=await a.command('inventory',{operation:{action:'add',operationId:crypto.randomUUID(),container:pub,expected:{[pub]:ack.result.inventory.containers[pub].revision},row:{id:'blocked-stock',kind:'item',name:'不能添加',entry:{id:'blocked',kind:'item',name:'不能添加'},quantity:1,slot:0,revision:1}}});check(!ack.ok,'player cannot mutate locked public warehouse even with previously editable catalog');
 await a.bg.evaluate(()=>{window.wbMock.role='GM';window.wbMock.emit('player',{role:'GM'});});
 // An old stable card can be bound before its room/scene list is hydrated.
 await a.bg.evaluate(()=>{window.wbMock.metadata['com.character-cards/list']=window.wbMock.metadata['com.character-cards/list'].filter(c=>c.id!=='second');window.wbMock.roomMetadata['com.obr-suite/workbench/cards']=window.wbMock.roomMetadata['com.obr-suite/workbench/cards'].filter(c=>c.id!=='second');window.wbMock.select(['two']);});
 await expect.poll(()=>a.latest('selection')?.state.cardId,{timeout:4000}).toBe('second');check(true,'bound legacy card loads without waiting for stable plugin list initialization');
 await a.post('select',{itemId:'card:hero'});await expect.poll(()=>a.latest('selection')?.state.cardId).toBe('hero');
 // Stale catalog observation reproducer: keep a pre-change token snapshot across
 // another slow card; user adds/removes status while hydration waits.
 slowId='second';slowDelay=12000;await a.bg.evaluate(()=>window.wbMock.emit('com.obr-suite/cc-card-updated',{data:{cardId:'second'}}));
 const condition={id:'temporary-state',entry:{id:'rule:restrained',kind:'condition',name:'束缚',raw:{_suiteStatusId:'u_restrained'},entries:[]},quantity:1,level:1};
 ack=await save(a,c=>c.selections.push(condition));assert(ack.ok,ack.message);ack=await save(a,c=>c.selections=c.selections.filter(s=>s.id!==condition.id));assert(ack.ok,ack.message);
 await sleep(13000);check(!documents.hero.dnd_card_web.selections.some(s=>s.entry.kind==='condition')&&!(await a.bg.evaluate(()=>window.wbMock.items.find(i=>i.id==='one').metadata['com.obr-suite/status/buffs'])).length,'hydration after delayed unrelated read cannot resurrect an added-then-removed status');

 // Keep the same WindowProxy while its Owlbear host iframe reloads.
 await context.route('http://127.0.0.1:5397/direct-reconnect.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>direct bridge probe</title>'}));
 const popupEvent=context.waitForEvent('page');await a.bg.evaluate(()=>window.open('/direct-reconnect.html','direct-reconnect-probe'));const direct=await popupEvent;await direct.waitForLoadState('domcontentloaded');
 await direct.evaluate(session=>{window.directMessages=[];window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.session===session)window.directMessages.push(event.data);});window.opener.postMessage({protocol:'full-suite-workbench/v1',session,type:'hello'},location.origin);},a.params.get('suite'));
 await expect.poll(()=>direct.evaluate(()=>window.directMessages.some(m=>m.type==='ready'))).toBe(true);
 await Promise.all([a.bg.waitForNavigation({waitUntil:'domcontentloaded'}),a.bg.evaluate(()=>{const m=window.wbMock;sessionStorage.setItem('workbench-test-world',JSON.stringify({items:m.items,metadata:m.metadata,roomMetadata:m.roomMetadata,selection:m.selection,role:m.role,settings:m.settings}));location.reload();})]);await a.bg.waitForFunction(()=>window.wbMock?.listeners?.has('com.obr-suite/cc-card-updated'));
 await direct.evaluate(()=>window.directMessages=[]);await direct.evaluate(session=>window.opener.postMessage({protocol:'full-suite-workbench/v1',session,type:'ping'},location.origin),a.params.get('suite'));
 await expect.poll(()=>direct.evaluate(()=>window.directMessages.some(m=>m.type==='pong')),{timeout:3000}).toBe(true);check(true,'same WindowProxy reconnects to reloaded host with ping without 30 s expiry');
 const directRequest=crypto.randomUUID();await direct.evaluate(({session,requestId})=>{window.opener.postMessage({protocol:'full-suite-workbench/v1',session,type:'ping'},location.origin);window.opener.postMessage({protocol:'full-suite-workbench/v1',session,type:'console',requestId,action:'portalEffects',value:false},location.origin);},{session:a.params.get('suite'),requestId:directRequest});await expect.poll(()=>direct.evaluate(id=>window.directMessages.some(m=>m.type==='ack'&&m.requestId===id&&m.ok),directRequest),{timeout:3000}).toBe(true);check(true,'first edit after host reload receives its direct confirmation');await direct.close();
 check(errors.length===0,'no browser runtime errors');console.log(JSON.stringify({checks,saves,reads,bytes,realRoomVerified:false,coldStandalone:true}));
}finally{for(const c of clients)c.stop();await browser.close();server.closeAllConnections();relayServer.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>relayServer.close(r))]);}
