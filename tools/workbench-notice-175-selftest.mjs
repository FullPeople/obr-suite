import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
process.env.CARD_READ_BASE=process.env.CARD_WRITE_BASE='http://127.0.0.1:5297';
process.env.PORT='5298';process.env.RELAY_ORIGIN='http://127.0.0.1:5297';
process.env.WORKBENCH_DATA_DIR=resolve('workbench-test-output/shared-'+crypto.randomUUID());
const {server:relayServer}=await import('../server/workbench-relay/server.mjs');
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';


const web=process.env.DND_CARD_WEB_ROOT||'D:/Desktop/DND-card-web',out=resolve('workbench-test-output/notices-175');mkdirSync(out,{recursive:true});
const {chromium,expect}=createRequire(join(web,'package.json'))('@playwright/test');
const define={'import.meta.env.BASE_URL':JSON.stringify('/suite-dev/'),'import.meta.env.DEV':'false'};
const environment={name:'environment',transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}};
const plugins=[environment,{name:'sdk-boundary',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-sdk.ts');if(id==='./state'||id==='../state'||id==='../../state'||id==='../modules/bestiary/data')return resolve('tools/fixtures/workbench-modules.ts');}}];
await build({input:resolve('tools/workbench-notice-175-selftest.entry.ts'),plugins,output:{dir:out,entryFileNames:'background.js',format:'esm'}});
await build({input:resolve('src/workbench/launcher.ts'),plugins,output:{file:join(out,'launcher.js'),format:'esm'}});
await build({input:resolve('src/modules/dice/effect-page.ts'),plugins,output:{file:join(out,'effect.js'),format:'esm'}});
await build({input:resolve('src/resource-toast-page.ts'),plugins:[environment,{name:'toast-sdk',resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-toast-sdk.ts');}}],output:{file:join(out,'toast-test.js'),format:'esm'}});
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'};
let documents,saves=0,failSaves=false,saveDelay=0,previewUrl='';
const server=createServer(async(req,res)=>{const p=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(p==='/test-tone.wav'){const audio=Buffer.alloc(44+16000);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(16000,40);res.setHeader('Content-Type','audio/wav');res.setHeader('Access-Control-Allow-Origin','*');res.end(audio);return;}
 if(p==='/preview'&&previewUrl){res.writeHead(302,{Location:previewUrl});res.end();return;}
 if(p==='/api/character/create-from-json'){let body='';for await(const part of req)body+=part;const id='created-'+crypto.randomUUID();documents[id]=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id,name:documents[id].identity.character_name}));return;}
 if(/^\/(characters|api\/character)\//.test(p)){const id=p.split('/').filter(Boolean)[p.startsWith('/api/')?3:2];res.setHeader('Content-Type','application/json');if(req.method==='DELETE'){delete documents[id];res.end(JSON.stringify({ok:true}));return;}if(req.method==='PUT'){if(failSaves){res.writeHead(503);res.end('{}');return;}let body='';for await(const part of req)body+=part;if(saveDelay)await new Promise(r=>setTimeout(r,saveDelay));documents[id]=JSON.parse(body);saves++;res.end(JSON.stringify({ok:true}));}else res.end(JSON.stringify(documents[id]));return;}
 if(p==='/suite-dev/relay'){const proxy=httpRequest('http://127.0.0.1:5298/'+req.url.slice(req.url.indexOf('?')),{method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});proxy.on('error',()=>{res.writeHead(502);res.end();});req.pipe(proxy);return;}
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<iframe id="bg" src="http://127.0.0.1:5297/background.html"></iframe><iframe id="launcher" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" src="http://127.0.0.1:5297/launcher.html" style="width:420px;height:540px"></iframe>');return;}
 if(p==='/suite-dev/dice-effect.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('dice-effect.html','utf8').replace('/src/modules/dice/effect-page.ts','/effect.js'));return;}
 if(/^\/suite-dev\/d(?:4|6|8|10|12|20|100)\.png$/.test(p)){try{res.setHeader('Content-Type','image/png');res.end(readFileSync(join('public',p.slice('/suite-dev/'.length))));}catch{res.writeHead(404);res.end();}return;}
 if(p==='/toast-test.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('resource-toast.html','utf8').replace('/src/resource-toast-page.ts','/toast-test.js'));return;}
 if(p==='/background.html'){res.setHeader('Content-Type','text/html');res.end('<script type="module" src="/background.js"></script>');return;}
 if(p==='/launcher.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('workbench-launcher.html','utf8').replace('/src/workbench/launcher.ts','/launcher.js'));return;}
 const file=p.startsWith('/suite-dev/workbench-panels/')?join('dist-workbench-dev/workbench-panels',p.slice('/suite-dev/workbench-panels/'.length)):p.startsWith('/suite-dev/workbench-dice/')?join('dist-workbench-dev/workbench-dice',p.slice('/suite-dev/workbench-dice/'.length)):p.startsWith('/suite-dev/workbench/')?join(process.env.DND_WEB_DIST||join(web,'dist'),p.slice('/suite-dev/workbench/'.length)):p.startsWith('/suite-dev/')?join('dist-workbench-dev',p.slice('/suite-dev/'.length)):join(out,p.slice(1));
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(5297,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1500,height:1000}}),errors=[];
await context.addInitScript(()=>{window.sfxStarts=0;for(const constructor of [window.OscillatorNode,window.AudioBufferSourceNode]){const original=constructor.prototype.start;constructor.prototype.start=function(...args){window.sfxStarts++;return original.apply(this,args);};}});
await context.exposeBinding('__recordWorkbenchError',(_,message)=>errors.push(String(message)));await context.addInitScript(()=>window.addEventListener('workbench-error',e=>window.__recordWorkbenchError(typeof e.detail==='string'?e.detail:e.detail.message)));
context.on('page',p=>{p.on('response',response=>{if(response.status()===404)console.log('MISSING ASSET',response.url());});p.on('pageerror',e=>{console.log('RUNTIME ERROR',e.stack);errors.push(e.message);});p.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('BROWSER CONSOLE',m.text());});});
const card=name=>({schema_version:'0.3',identity:{character_name:name},meta:{ruleset:'2024'},abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(a=>[a,{total:12}])),classes:[{name:'法师',level:2}],core_stats:{hp:{current:20,max:30,temp:2},ac:15,passive_perception:12,hit_dice:{die_size:6,max:2,current:2}},features:{},background:{},inventory:{},defenses:{custom:'preserved'},combat:{weapons:[{name:'保留的武器'}]}});
documents={hero:card('阿明'),second:card('贝拉')};
await context.route('https://unused-fixture.invalid/**',r=>{const path=new URL(r.request().url()).pathname;const body=path==='/data/bestiary/index.json'?{test:'bestiary-test.json'}:path.endsWith('/bestiary-test.json')?{monster:['甲','乙'].map((name,i)=>({name:'样本怪物'+name,ENG_name:'Sample '+i,source:'XMM',str:12,dex:10,con:10,int:8,wis:10,cha:8,ac:[12],hp:{average:12},speed:{walk:30},trait:[{name:'样本特性'+name,entries:['只应出现一次的正文。']}],action:[{name:'攻击',entries:['命中 {@hit 2}。']}]}))}:{};return r.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});});
const fixtures={
 'class/index.json':{XPHB:'class-test.json'},'class/class-test.json':{class:[]},'bestiary/index.json':{XMM:'bestiary-test.json'},'bestiary/bestiary-test.json':{monster:[]},
 'spells/index.json':{XPHB:'spells-xphb.json'},'spells/spells-xphb.json':{spell:[{name:'微光术',ENG_name:'Test Glow',source:'XPHB',level:0,entries:['自制法术正文。']}]},
 'races.json':{race:[{name:'测试旅人',ENG_name:'Traveller',source:'XPHB',size:['M'],speed:30,entries:['自制种族正文。']}]},
 'items-base.json':{baseitem:[{name:'铜制罗盘',ENG_name:'Compass',source:'XPHB',weight:2,value:500,entries:['自制罗盘说明。']}]},
 'conditionsdiseases.json':{condition:[{name:'束缚',ENG_name:'Restrained',source:'XPHB',entries:['自制状态说明。']}]}
};await context.route('https://5e.kiwee.top/**',r=>r.fulfill({json:fixtures[new URL(r.request().url()).pathname.replace('/data/','')]||{},headers:{'access-control-allow-origin':'*'}}));
let checks=0;const check=(v,name)=>{assert(v,name);console.log('PASS',++checks,name);};
try{
 const room=await context.newPage();await room.goto('http://localhost:5297/');const launcher=room.frameLocator('#launcher');await launcher.locator('#open[href]').waitFor();const bg=room.frames().find(f=>f.url().includes('background.html')),url=await launcher.locator('#open').getAttribute('href');
 await bg.evaluate(()=>{window.wbMock.party=[{id:'guest',role:'PLAYER',name:'玩家'}];window.wbMock.items.find(i=>i.id==='goblin').createdUserId='guest';window.wbMock.select([]);});const page=await context.newPage(),received=[];page.on('response',async response=>{if(response.url().includes('/relay?')&&response.request().method()==='GET'){try{const data=await response.json();if(Array.isArray(data))received.push(...data);}catch{}}});
 await page.goto(url);await page.locator('.linked').waitFor();
 const command=async(type,extra={})=>{const params=new URLSearchParams(new URL(url).hash.slice(1)),requestId=crypto.randomUUID();await fetch('http://127.0.0.1:5298/?'+new URLSearchParams({session:params.get('suite'),role:'client'}),{method:'POST',headers:{Authorization:'Bearer '+params.get('relay'),'Content-Type':'application/json'},body:JSON.stringify({protocol:'full-suite-workbench/v1',session:params.get('suite'),type,requestId,...extra})});for(let i=0;i<180;i++){const ack=received.find(m=>m.type==='ack'&&m.requestId===requestId);if(ack)return ack;await page.waitForTimeout(50);}throw Error('No ack for '+type);};
 const inventory=()=>{const m=received.filter(m=>m.inventory||m.result?.inventory).at(-1);return m?.inventory||m?.result.inventory;};
 const issue=op=>command('inventory',{operation:{operationId:crypto.randomUUID(),...op}});

 check(await bg.evaluate(()=>window.wbMock.resourceStarts===0),'legacy resource setup is blocked; notices do not rely on it');
 await bg.waitForFunction(()=>typeof window.wbMock.resolveInitialNoticeRole==='function');
 await bg.evaluate(()=>{const m=window.wbMock;m.role='PLAYER';m.emit('player',{role:'PLAYER'});m.resolveInitialNoticeRole();m.emit('com.obr-suite/resources/changed',{connectionId:'remote',data:{noticeId:'stale-gm-fallback',privateFor:['other'],privateSummary:'某人调整了资源',summary:'秘密人物获得秘密资源',tokenId:'secret',resource:{id:'secret',name:'秘密资源',current:1,max:1,type:'count'},delta:1,prevValue:0}});});
 await expect.poll(()=>bg.evaluate(()=>window.wbMock.notifications),{timeout:10000}).toEqual(['某人调整了资源']);check(true,'fallback preserves a newer PLAYER event when initial GM snapshot resolves late');
 await bg.evaluate(()=>{window.wbMock.role='GM';window.wbMock.emit('player',{role:'GM'});});

 await room.evaluate(()=>{const iframe=document.createElement('iframe');iframe.id='toast-test';iframe.src='http://127.0.0.1:5297/toast-test.html';iframe.style.cssText='width:1000px;height:700px';document.body.append(iframe);});
 let toast=room.frameLocator('#toast-test');await toast.locator('#stack').waitFor({state:'attached'});
 await bg.evaluate(()=>{window.wbMock.broadcasts.length=0;});
 const publicId=inventory().publicId,stock={id:'notice-compass',kind:'item',name:'通知罗盘',quantity:2,slot:0,revision:1,unitWeight:2,entry:{id:'custom:notice-compass',kind:'item',name:'通知罗盘',english:'Compass',source:'XPHB',edition:'2024',packId:'test',revision:'1',entries:['通知回归'],raw:{weight:2,value:500}}};
 const add=await issue({action:'add',container:publicId,expected:{[publicId]:inventory().containers[publicId].revision},row:stock});assert(add.ok,add.message);
 await expect(toast.locator('.toast').filter({hasText:'通知罗盘'})).toHaveCount(1);check(true,'warehouse notice renders with resource feature off and no sender echo');
 const first=await bg.evaluate(()=>window.wbMock.broadcasts.find(e=>e.name==='com.obr-suite/resources/changed'));
 check(first.opts.destination==='REMOTE','local delivery is direct; broadcast is remote only');
 await bg.evaluate(notice=>window.wbMock.emit('com.obr-suite/resources/changed',{connectionId:'remote-connection',data:notice}),first.data);await expect(toast.locator('.toast').filter({hasText:'通知罗盘'})).toHaveCount(1);check(true,'duplicate remote echo cannot replay local notice');
 const transfer=await issue({action:'transfer',from:publicId,to:'card:hero',rows:[{id:stock.id,quantity:1}],expected:{[publicId]:inventory().containers[publicId].revision,['card:hero']:inventory().containers['card:hero'].revision}});assert(transfer.ok,transfer.message);
 await expect(toast.locator('.toast').filter({hasText:'阿明拿走了通知罗盘'})).toHaveCount(1);check(true,'warehouse take displays exactly one real toast');
 const held=inventory().containers['card:hero'].items.find(r=>r.name==='通知罗盘');
 const returned=await issue({action:'transfer',from:'card:hero',to:publicId,rows:[{id:held.id,quantity:1}],expected:{[publicId]:inventory().containers[publicId].revision,['card:hero']:inventory().containers['card:hero'].revision}});assert(returned.ok,returned.message);
 await expect(toast.locator('.toast').filter({hasText:'给予了通知罗盘给公共仓库'})).toHaveCount(1);check(true,'warehouse put displays exactly one real toast');
 await bg.evaluate(()=>{window.wbMock.settings.enabled.resourceTracker=true;});
 const resource={id:'notice-points',name:'通知点数',current:3,max:3,type:'count'};let r=await command('resource',{itemId:'card:hero',resourceId:resource.id,expected:null,resource});assert(r.ok,r.message);
 await expect(toast.locator('.toast').filter({hasText:'通知点数'})).toHaveCount(1);r=await command('resource',{itemId:'card:hero',resourceId:resource.id,expected:resource,resource:{...resource,current:1}});assert(r.ok,r.message);
 await expect(toast.locator('.toast').filter({hasText:'通知点数'})).toHaveCount(2);check(true,'resource create/adjust notifications render without legacy module startup');
 check(await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/sfx'&&e.data.name==='resourceToast').length)>=5,'original resource chime is broadcast by actual toast renderer');
 const beforeCount=await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/changed').length);
 const native={schemaVersion:1,id:'hero',name:'阿明',revision:1,edition:'2024',player:'',abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10},baseHp:30,identity:{},answers:{},reviewed:[],notes:'',profile:{enabledSources:['PHB','XPHB'],optional:{feats:true,multiclass:false,legacy:false},exceptions:{}},runtime:{hp:20,tempHp:2,inspiration:0,resources:{'notice-points':{...resource,current:1}}},selections:[{id:'spell-light',entry:{id:'spell:test:light',kind:'spell',name:'回归微光术',english:'Light',source:'XPHB',edition:'2024',packId:'test',revision:'1',entries:['回归微光'],raw:{level:1}}}],spellSettings:{mode:'prepared',prepared:[],slots:{}}};
 let doc=structuredClone(documents.hero);r=await command('save',{itemId:'card:hero',key:'test-room:card:hero',native,data:{...doc,dnd_card_web:native}});assert(r.ok,r.message);
 const save=async mutate=>{const before=structuredClone(documents.hero),next=structuredClone(before.dnd_card_web);mutate(next);next.revision++;return command('save',{itemId:'card:hero',key:'test-room:card:hero',native:next,previous:before.dnd_card_web,data:{...before,dnd_card_web:next},previousData:before});};
 r=await save(c=>c.spellSettings.prepared=['spell-light']);assert(r.ok,r.message);await expect(toast.locator('.toast').filter({hasText:'阿明预备了回归微光术'})).toHaveCount(1);check(true,'successful native save broadcasts preparation by selected spell identity');
 r=await save(c=>c.spellSettings.prepared=[]);assert(r.ok,r.message);await expect(toast.locator('.toast').filter({hasText:'阿明取消预备了回归微光术'})).toHaveCount(1);check(true,'unpreparation broadcasts inverse notice');
 let count=await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/changed').length);r=await save(c=>c.notes='unrelated');assert(r.ok,r.message);check(await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/changed').length)===count,'unrelated saves do not replay preparation or inventory notices');
 failSaves=true;r=await save(c=>c.spellSettings.prepared=['spell-light']);failSaves=false;assert(!r.ok);check(await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/changed').length)===count,'failed persistence produces no preparation notice');
 r=await save(c=>c.selections.push({id:'native-item',quantity:3,entry:{...stock.entry,id:'custom:native-item',name:'随身药瓶'}}));assert(r.ok,r.message);await expect(toast.locator('.toast').filter({hasText:'随身药瓶'})).toHaveCount(1);
 r=await save(c=>c.selections.find(s=>s.id==='native-item').quantity=1);assert(r.ok,r.message);await expect(toast.locator('.toast').filter({hasText:'随身药瓶'})).toHaveCount(2);check(true,'native backpack add/quantity edits each notify once through ordinary character saves');
 count=await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/changed').length);r=await save(c=>c.notes='ack replay check');assert(r.ok,r.message);check(await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/changed').length)===count,'subsequent save does not replay prior stock quantity delta');
 // Same-origin overlay replacement can follow a lost ACK. Replayed ID is
 // acknowledged but must not create a second visual or a second chime.
 const last=await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/changed').at(-1).data);
 await room.evaluate(()=>{document.querySelector('#toast-test').remove();const iframe=document.createElement('iframe');iframe.id='toast-test';iframe.src='http://127.0.0.1:5297/toast-test.html';document.body.append(iframe);});toast=room.frameLocator('#toast-test');await toast.locator('#stack').waitFor({state:'attached'});await room.waitForTimeout(150);
 const beforeSfx=await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/sfx').length);await bg.evaluate(data=>window.wbMock.emit('com.obr-suite/resources/toast-deliver',{connectionId:'connection',data:{id:data.noticeId,data}}),last);await room.waitForTimeout(150);check(await toast.locator('.toast').count()===0&&await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/sfx').length)===beforeSfx,'overlay reload deduplicates acknowledged visuals/sounds across iframe instances');
 await bg.evaluate(()=>{window.wbMock.role='PLAYER';window.wbMock.emit('player',{role:'PLAYER'});window.wbMock.emit('com.obr-suite/resources/changed',{connectionId:'remote',data:{noticeId:'private-prepared',privateFor:['other'],privateSummary:'某人预备了法术',summary:'秘密人物预备了秘密法术',tokenId:'secret',resource:{id:'secret',name:'秘密法术',current:1,max:1,type:'count'},delta:1,prevValue:0}});});await expect(toast.locator('.toast').filter({hasText:'某人预备了法术'})).toBeVisible();check(!await toast.locator('#stack').innerText().then(t=>t.includes('秘密')),'spell sentence and resource details respect private cards');

 const readyBeforeRace=await bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/toast-ready').length);
 await bg.evaluate(()=>{window.wbMock.role='GM';window.wbMock.emit('player',{role:'GM'});window.wbMock.delayToastRole=true;});
 await room.evaluate(()=>{document.querySelector('#toast-test').remove();const iframe=document.createElement('iframe');iframe.id='toast-test';iframe.src='http://127.0.0.1:5297/toast-test.html';document.body.append(iframe);});toast=room.frameLocator('#toast-test');await toast.locator('#stack').waitFor({state:'attached'});
 await bg.waitForFunction(()=>typeof window.wbMock.resolveToastRole==='function');await bg.evaluate(()=>{const m=window.wbMock;m.role='PLAYER';m.emit('player',{role:'PLAYER'});m.resolveToastRole();});
 await expect.poll(()=>bg.evaluate(()=>window.wbMock.broadcasts.filter(e=>e.name==='com.obr-suite/resources/toast-ready').length)).toBeGreaterThan(readyBeforeRace);
 await bg.evaluate(()=>window.wbMock.emit('com.obr-suite/resources/changed',{connectionId:'remote',data:{noticeId:'stale-gm-renderer',privateFor:['other'],privateSummary:'某人取消预备了法术',summary:'秘密人物取消预备了秘密法术',tokenId:'secret',resource:{id:'secret',name:'秘密法术',current:0,max:1,type:'count'},delta:-1,prevValue:1}}));
 await expect(toast.locator('.toast').filter({hasText:'某人取消预备了法术'})).toBeVisible();check(!await toast.locator('#stack').innerText().then(t=>t.includes('秘密')),'real renderer preserves newer demotion while initial GM role read is pending');
 check(errors.length===0,'no browser runtime errors');console.log(JSON.stringify({checks,saves,realRoomVerified:false,legacyResourceStarts:await bg.evaluate(()=>window.wbMock.resourceStarts)}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({documents,errors},null,2));throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));relayServer.closeAllConnections();await new Promise(r=>relayServer.close(r));}
