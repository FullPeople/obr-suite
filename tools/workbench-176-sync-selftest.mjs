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


const web=process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web',out=resolve('workbench-test-output/sync176');mkdirSync(out,{recursive:true});
const {chromium,expect}=createRequire(join(web,'package.json'))('@playwright/test');
const define={'import.meta.env.BASE_URL':JSON.stringify('/suite-dev/'),'import.meta.env.DEV':'false'};
const environment={name:'environment',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}};
const plugins=[environment,{name:'sdk-boundary',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-sdk.ts');if(id==='./state'||id==='../state'||id==='../../state'||id==='../modules/bestiary/data')return resolve('tools/fixtures/workbench-modules.ts');}}];
await build({input:resolve('tools/workbench-176-sync-selftest.entry.ts'),plugins,output:{dir:out,entryFileNames:'background.js',format:'esm'}});
await build({input:resolve('src/workbench/launcher.ts'),plugins,output:{file:join(out,'launcher.js'),format:'esm'}});
await build({input:resolve('src/modules/dice/effect-page.ts'),plugins,output:{file:join(out,'effect.js'),format:'esm'}});
await build({input:resolve('src/resource-toast-page.ts'),plugins:[environment,{name:'toast-sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-toast-sdk.ts');}}],output:{file:join(out,'toast-test.js'),format:'esm'}});
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'};
let documents,saves=0,failSaves=false,saveDelay=0,previewUrl='',delayedReads=[];
const server=createServer(async(req,res)=>{const p=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(p==='/test-tone.wav'){const audio=Buffer.alloc(44+16000);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(16000,40);res.setHeader('Content-Type','audio/wav');res.setHeader('Access-Control-Allow-Origin','*');res.end(audio);return;}
 if(p==='/preview'&&previewUrl){res.writeHead(302,{Location:previewUrl});res.end();return;}
 if(p==='/api/character/create-from-json'){let body='';for await(const part of req)body+=part;const id='created-'+crypto.randomUUID();documents[id]=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id,name:documents[id].identity.character_name}));return;}
 if(/^\/(characters|api\/character)\//.test(p)){const id=p.split('/').filter(Boolean)[p.startsWith('/api/')?3:2];res.setHeader('Content-Type','application/json');if(req.method==='DELETE'){delete documents[id];res.end(JSON.stringify({ok:true}));return;}if(req.method==='PUT'){if(failSaves){res.writeHead(503);res.end('{}');return;}let body='';for await(const part of req)body+=part;if(saveDelay)await new Promise(r=>setTimeout(r,saveDelay));documents[id]=JSON.parse(body);saves++;res.end(JSON.stringify({ok:true}));}else {const body=JSON.stringify(documents[id]);if(delayedReads.length){const delay=delayedReads.shift();setTimeout(()=>res.end(body),delay);}else res.end(body);}return;}
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
 const a=await connect();await expect.poll(()=>a.bg.evaluate(()=>!!window.wbMock.items.find(i=>i.id==='one').metadata['com.obr-suite/workbench/runtime-baseline'])).toBe(true);check(true,'existing token receives a runtime projection baseline');
 const condition={id:'test-restrained',entry:{id:'rule:restrained',kind:'condition',name:'束缚',english:'Restrained',raw:{_suiteStatusId:'u_restrained'},entries:[]},quantity:1,level:1};
 let ack=await save(a,c=>c.selections.push(condition));assert(ack.ok,ack.message);await expect.poll(()=>a.bg.evaluate(()=>window.wbMock.items.find(i=>i.id==='one').metadata['com.obr-suite/status/buffs'])).toEqual(['u_restrained']);
 const resource={id:'points',name:'点数',current:3,max:3,type:'count'};ack=await a.command('resource',{itemId:'card:hero',resourceId:'points',expected:null,resource});assert(ack.ok,ack.message);
 const detached=await a.bg.evaluate(()=>{const item=structuredClone(window.wbMock.items.find(i=>i.id==='one'));window.wbMock.items=window.wbMock.items.filter(i=>i.id!=='one');window.wbMock.emit('items',window.wbMock.items);return item;});
 ack=await save(a,c=>c.selections=[]);assert(ack.ok,ack.message);ack=await a.command('resource',{itemId:'card:hero',resourceId:'points',expected:resource,resource:{...resource,current:0}});assert(ack.ok,ack.message);const savedRevision=documents.hero._suiteRevision;
 await a.bg.evaluate(item=>{window.wbMock.items.unshift(item);window.wbMock.emit('items',window.wbMock.items);},detached);await expect.poll(()=>a.bg.evaluate(()=>window.wbMock.items.find(i=>i.id==='one').metadata['com.obr-suite/status/buffs'])).toEqual([]);await expect.poll(()=>a.bg.evaluate(()=>window.wbMock.items.find(i=>i.id==='one').metadata['com.obr-suite/resources/data'].find(r=>r.id==='points').current)).toBe(0);
 await sleep(2200);check(documents.hero.dnd_card_web.selections.length===0&&documents.hero.dnd_card_web.runtime.resources.points.current===0,'returning old token cannot resurrect removed condition or spent resources');
 check(documents.hero._suiteRevision===savedRevision,'reprojecting old token does not create spurious document revisions');
 // Real scene edits differ from their baseline and must become durable.
 await a.bg.evaluate(()=>{const item=window.wbMock.items.find(i=>i.id==='one');item.metadata['com.obr-suite/status/buffs']=['u_restrained'];item.metadata['com.obr-suite/resources/data'].find(r=>r.id==='points').current=1;item.metadata['com.obr-suite/bubbles/data'].health=13;window.wbMock.emit('items',window.wbMock.items);});
 await expect.poll(()=>documents.hero.dnd_card_web.runtime.hp).toBe(13);await expect.poll(()=>documents.hero.dnd_card_web.runtime.resources.points.current).toBe(1);check(documents.hero.dnd_card_web.selections.some(s=>s.entry.raw?._suiteStatusId==='u_restrained'||s.entry.id==='suite-condition:u_restrained'),'actual scene edits are imported and survive token removal');
 const baselineBefore=structuredClone(documents.hero);ack=await a.command('stats',{itemId:'card:hero',patch:{health:9},expected:{health:13}});assert(ack.ok,ack.message);ack=await save(a,c=>c.notes='unrelated note from older screen',baselineBefore);assert(ack.ok,ack.message);check(documents.hero.core_stats.hp.current===9,'unrelated old card save never rewrites HP from its old export');
 // A separate host starts with an old un-stamped token and reads the same durable card.
 const secondContext=await browser.newContext({viewport:{width:1200,height:900}});const b=await connect(secondContext);await expect.poll(()=>b.latest('catalog')?.cards.find(c=>c.id==='hero')?.stats.health).toBe(9);check(documents.hero.core_stats.hp.current===9,'second host startup cannot replace modern document with unstamped legacy token');
 const tokenB=await b.bg.evaluate(()=>structuredClone(window.wbMock.items.find(i=>i.id==='one')));ack=await a.command('resource',{itemId:'card:hero',resourceId:'points',expected:documents.hero.dnd_card_web.runtime.resources.points,resource:{...documents.hero.dnd_card_web.runtime.resources.points,current:0}});assert(ack.ok,ack.message);
 await expect.poll(()=>b.latest('catalog')?.cards.find(c=>c.id==='hero')?.resources.find(r=>r.id==='points')?.current,{timeout:8000}).toBe(0);check(documents.hero.dnd_card_web.runtime.resources.points.current===0,'second host catches missed broadcast by freshness read without resource bounce');
 await b.bg.evaluate(item=>{window.wbMock.items[window.wbMock.items.findIndex(i=>i.id==='one')]=item;window.wbMock.emit('items',window.wbMock.items);},tokenB);await sleep(2200);check(documents.hero.dnd_card_web.runtime.resources.points.current===0,'late old metadata snapshot is repaired rather than imported');
 // Read held across a newer save must not poison host document cache.
 delayedReads=[1000];await b.bg.evaluate(()=>window.wbMock.emit('com.obr-suite/cc-card-updated',{data:{cardId:'hero'}}));await sleep(100);ack=await a.command('stats',{itemId:'card:hero',patch:{health:7},expected:{health:9}});assert(ack.ok,ack.message);await expect.poll(()=>b.latest('catalog')?.cards.find(c=>c.id==='hero')?.stats.health,{timeout:8000}).toBe(7);check(true,'delayed stale read converges to latest authoritative runtime');
 const newest=documents.hero._suiteRevision;check(a.latest('catalog').cards.find(c=>c.id==='hero').documentRevision<=newest&&b.latest('catalog').cards.find(c=>c.id==='hero').documentRevision===newest,'catalog transports durable document revisions');

 // A host held in OBR.updateItems must not overwrite another host's later stamp.
 await a.bg.evaluate(()=>window.wbMock.holdNextProjection=true);
 const firstChange=a.command('resource',{itemId:'card:hero',resourceId:'points',expected:documents.hero.dnd_card_web.runtime.resources.points,resource:{...documents.hero.dnd_card_web.runtime.resources.points,current:2}});
 await a.bg.waitForFunction(()=>window.wbMock.projectionHeld===true);
 ack=await b.command('resource',{itemId:'card:hero',resourceId:'points',expected:documents.hero.dnd_card_web.runtime.resources.points,resource:{...documents.hero.dnd_card_web.runtime.resources.points,current:3}});assert(ack.ok,ack.message);
 const sharedLatestToken=await b.bg.evaluate(()=>structuredClone(window.wbMock.items.find(i=>i.id==='one')));
 await a.bg.evaluate(item=>{window.wbMock.items[window.wbMock.items.findIndex(i=>i.id==='one')]=item;window.wbMock.releaseProjection();},sharedLatestToken);assert((await firstChange).ok);
 check(await a.bg.evaluate(()=>window.wbMock.items.find(i=>i.id==='one').metadata['com.obr-suite/resources/data'].find(r=>r.id==='points').current)===3,'delayed old OBR projection cannot overwrite newer host metadata stamp');
 // Inventory status grants must be retired by an actual scene removal, too.
 let currentInventory=a.latest('catalog').inventory,cardContainer=currentInventory.containers['card:hero'];
 ack=await a.command('inventory',{operation:{action:'add',operationId:crypto.randomUUID(),container:'card:hero',expected:{'card:hero':cardContainer.revision},row:{id:'grant-condition',kind:'condition',name:'目盲',entry:{id:'rule:blind',kind:'condition',name:'目盲',english:'Blinded',raw:{_suiteStatusId:'u_blinded'},entries:[]},quantity:1,slot:0,revision:1}}});assert(ack.ok,ack.message);
 await a.bg.evaluate(()=>{const item=window.wbMock.items.find(i=>i.id==='one');item.metadata['com.obr-suite/status/buffs']=item.metadata['com.obr-suite/status/buffs'].filter(id=>id!=='u_blinded');window.wbMock.emit('items',window.wbMock.items);});
 await expect.poll(()=>documents.hero.dnd_card_web.selections.some(s=>s.entry.raw?._suiteStatusId==='u_blinded'||s.entry.id==='suite-condition:u_blinded')).toBe(false);
 await sleep(2400);check(!a.latest('catalog').inventory.containers['card:hero'].items.some(r=>r.id==='grant-condition')&&!documents.hero.dnd_card_web.selections.some(s=>s.entry.raw?._suiteStatusId==='u_blinded'),'scene removal retires inventory grant so repair cannot resurrect it');

 // The monster path uses live metadata rather than character JSON; different
 // resources must merge within the actual OBR draft callback too.
 const monsterA={id:'monster-a',name:'怪物资源 A',current:3,max:3,type:'count'},monsterB={id:'monster-b',name:'怪物资源 B',current:4,max:4,type:'count'};
 for(const resource of [monsterA,monsterB]){ack=await a.command('resource',{itemId:'goblin',resourceId:resource.id,expected:null,resource});assert(ack.ok,ack.message);}
 const sharedMonster=await a.bg.evaluate(()=>structuredClone(window.wbMock.items.find(i=>i.id==='goblin')));await b.bg.evaluate(item=>{window.wbMock.items[window.wbMock.items.findIndex(i=>i.id==='goblin')]=item;},sharedMonster);
 await a.bg.evaluate(()=>window.wbMock.holdNextProjection=true);const oldMonsterUpdate=a.command('resource',{itemId:'goblin',resourceId:monsterA.id,expected:monsterA,resource:{...monsterA,current:0}});await a.bg.waitForFunction(()=>window.wbMock.projectionHeld===true);
 ack=await b.command('resource',{itemId:'goblin',resourceId:monsterB.id,expected:monsterB,resource:{...monsterB,current:1}});assert(ack.ok,ack.message);
 const newestMonster=await b.bg.evaluate(()=>structuredClone(window.wbMock.items.find(i=>i.id==='goblin')));await a.bg.evaluate(item=>{window.wbMock.items[window.wbMock.items.findIndex(i=>i.id==='goblin')]=item;window.wbMock.releaseProjection();},newestMonster);assert((await oldMonsterUpdate).ok);
 const joinedMonster=await a.bg.evaluate(()=>window.wbMock.items.find(i=>i.id==='goblin').metadata['com.obr-suite/resources/data']);check(joinedMonster.find(r=>r.id===monsterA.id).current===0&&joinedMonster.find(r=>r.id===monsterB.id).current===1,'two hosts editing separate monster resources merge through actual delayed OBR callback');
 // Explicit stale inventory projection must be rejected at the same server lock
 // that serializes stock writes, not merely by a client before/after check.
 const keys=await a.bg.evaluate(()=>JSON.parse(localStorage.getItem('workbench:v2:test-room:me'))),session=a.params.get('suite'),host='http://127.0.0.1:5398/?'+new URLSearchParams({session,role:'host'}),hostHeaders={Authorization:'Bearer '+keys.hostKey,'Content-Type':'application/json'},request=async body=>{const r=await fetch(host,{method:'POST',headers:hostHeaders,body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const ledger=(await request({sharedDocument:{key:'inventory_test-room',operation:'read'}})).data;
 const changed=structuredClone(ledger.data);changed.silent=!changed.silent;assert.equal((await request({sharedDocument:{key:'inventory_test-room',operation:'write',expected:ledger.revision,data:changed}})).status,200);
 const {createHash}=await import('node:crypto'),before=structuredClone(documents.hero);const stale=await request({saveCard:{room:'test-room',card:'hero',expected:createHash('sha256').update(JSON.stringify(before)).digest('hex'),data:{...before,dnd_card_web:{...before.dnd_card_web,selections:[condition]}},inventoryGuard:{key:'inventory_test-room',revision:ledger.revision}}});
 check(stale.status===409&&documents.hero._suiteRevision===before._suiteRevision,'stale repair projection is rejected atomically before writing card');
 check(errors.length===0,'no browser runtime errors');console.log(JSON.stringify({checks,saves,realRoomVerified:false,hosts:2}));
}catch(error){for(const c of clients)console.log('HOST STATE',JSON.stringify(await c.bg.evaluate(()=>({writes:window.wbMock.writes,items:window.wbMock.items,room:window.wbMock.roomMetadata})).catch(()=>null)),'events',c.events.length,c.events.slice(-4));writeFileSync(join(out,'failure.json'),JSON.stringify({documents,errors},null,2));throw error;}finally{for(const client of clients)client.stop();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));relayServer.closeAllConnections();await new Promise(r=>relayServer.close(r));}
