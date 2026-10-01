// Production background + installed SDK over real iframe postMessage. Synthetic room only.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer,request} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=resolve(process.env.SUITE_ROOT||'.');
const webRoot=resolve(process.env.WEB_ROOT||'../web');
const deps=resolve(process.env.SUITE_DEPS||root);
const requireSuite=createRequire(join(deps,'package.json')),requireWeb=createRequire(join(webRoot,'package.json'));
const {build}=await import(pathToFileURL(requireWeb.resolve('rolldown')).href);
const {chromium}=requireWeb('@playwright/test');
const out=resolve(process.env.PROFILE_OUT||'../selection223/small-relay-after');mkdirSync(out,{recursive:true});
const source=readFileSync(process.env.PROFILE_SOURCE||join(process.env.SELECTION_BASELINE||root,'src/workbench/background.ts'),'utf8');
const counts='{catalog:0,hydrate:0,refresh:0,refreshSelection:0,reconcileRuntime:0}';
let profiled=source;
for(const name of ['catalog','hydrate','refresh','refreshSelection','reconcileRuntime'])profiled=profiled.replace(new RegExp('(async function '+name+'\\([^\\n]*?\\)\\{)'),`$1(window as any).probeCounts.${name}++;`);
const expose=`Object.assign(window,{probe:{wire(){return {protocol,session,clientKey:credentials.clientKey};},health(){return {relayAge:Date.now()-relayPeerSeen,chosen,cards:documents.size};}}});`;
profiled=profiled.replace("setInterval(()=>send('pong',{at:Date.now()}),10000);",expose+"setInterval(()=>send('pong',{at:Date.now()}),10000);");
if(!profiled.includes(expose))throw Error('Production hook no longer matches');
const entry=join(out,'entry.ts');writeFileSync(entry,`import OBR from '@owlbear-rodeo/sdk';import {setupWorkbench} from '${join(root,'src/workbench/background.ts').replaceAll('\\','/')}';(window as any).probeCounts=${counts};(window as any).wbMock={metadata:{},settings:{},emit(){}};OBR.onReady(()=>setupWorkbench());(window as any).moduleReady=true;`);
await build({input:entry,plugins:[{name:'production-sdk-fixture',transform(code,id){if(process.env.SELECTION_BASELINE){for(const name of ['observation.ts','group-rolls.ts'])if(id.replaceAll('\\','/').endsWith('/src/workbench/'+name))code=readFileSync(join(process.env.SELECTION_BASELINE,'src/workbench',name),'utf8');}if(id.replaceAll('\\','/').endsWith('/src/workbench/background.ts'))code=profiled;return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');},resolveId(id){if(['./state','../state','../../state','../modules/bestiary/data'].includes(id))return join(root,'tools/fixtures/workbench-modules.ts');if(!id.startsWith('.')&&!id.startsWith('/')&&!/^[A-Z]:/i.test(id)&&!id.startsWith('\0'))try{return requireSuite.resolve(id==='events'?'events/':id);}catch{try{return requireWeb.resolve(id);}catch{}}}}],output:{file:join(out,'profile.js'),format:'esm',codeSplitting:false}});
const total=5,port=5632,relayPort=5634;
const list=Array.from({length:total},(_,i)=>({id:'hero'+i,name:'Synthetic '+i,owner_ids:['me'],visibility:'public',locked:false}));
const runtime={stats:{health:20,'max health':30,'temporary health':0,'armor class':15},conditions:[],resources:{}};
const BIND='com.character-cards/boundCardId',BASE='com.obr-suite/workbench/runtime-baseline',HP='com.obr-suite/bubbles/data';
const items=Array.from({length:25},(_,i)=>({id:'token'+i,name:'Token '+i,type:'IMAGE',layer:'CHARACTER',createdUserId:'me',position:{x:i,y:i},metadata:i<total?{[BIND]:list[i].id,[HP]:runtime.stats,[BASE]:{version:1,cardId:list[i].id,revision:1,value:runtime}}:{'com.bestiary/slug':'TEST::Monster'}}));
const scene={'com.character-cards/list':list,'com.obr-suite/workbench/shared':{id:'profile',revision:0}},room={'com.obr-suite/workbench/cards':list,'com.obr-suite/workbench/owner-roles':{me:'GM'}};
const docs=Object.fromEntries(list.map(c=>[c.id,{schema_version:'0.3',_suiteRevision:1,identity:{character_name:c.name},core_stats:{hp:{current:20,max:30,temp:0},ac:15},inventory:{},features:{},background:{},classes:[],abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(key=>[key,{total:12,modifier:1,save:{bonus:3}}]))}]));
const parentScript=`window.state=${JSON.stringify({items,scene,room})};window.results=[];window.metrics=[];window.player={id:'me',connectionId:'connection',name:'Synthetic DM',color:'#50525B',role:'GM',metadata:{},selection:[],syncView:false};
window.emit=(id,data)=>document.querySelector('iframe').contentWindow.postMessage({id,data},location.origin);
window.choose=id=>{player.selection=id?[id]:[];emit('OBR_PLAYER_EVENT_CHANGE',{player});};
window.addEventListener('message',event=>{const m=event.data;if(m.protocol==='full-suite-workbench/v1'){results.push({at:performance.now(),type:m.type,key:m.state?.key,name:m.state?.name,message:m.message,requestId:m.requestId,ok:m.ok,result:m.result,group:m.group,itemId:m.itemId,followRevision:m.followRevision});return;}if(!m.id||!m.nonce)return;metrics.push({id:m.id});
const s=state,d=m.data;let value={};switch(m.id){
case 'OBR_PLAYER_GET_ID':value={id:player.id};break;case 'OBR_PLAYER_GET_CONNECTION_ID':value={connectionId:player.connectionId};break;case 'OBR_PLAYER_GET_ROLE':value={role:player.role};break;case 'OBR_PLAYER_GET_NAME':value={name:player.name};break;case 'OBR_PLAYER_GET_COLOR':value={color:player.color};break;case 'OBR_PLAYER_GET_SELECTION':value={selection:player.selection};break;case 'OBR_PLAYER_GET_METADATA':value={metadata:player.metadata};break;case 'OBR_PARTY_GET_PLAYERS':value={players:[]};break;
case 'OBR_SCENE_IS_READY':value={ready:true};break;case 'OBR_SCENE_GET_METADATA':value={metadata:s.scene};break;case 'OBR_ROOM_GET_METADATA':value={metadata:s.room};break;case 'OBR_SCENE_ITEMS_GET_ALL_ITEMS':value={items:s.items};break;case 'OBR_SCENE_ITEMS_GET_ITEMS':value={items:s.items.filter(i=>d.ids.includes(i.id))};break;
case 'OBR_SCENE_SET_METADATA':Object.assign(s.scene,d.update);emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:s.scene});break;case 'OBR_ROOM_SET_METADATA':Object.assign(s.room,d.update);emit('OBR_ROOM_METADATA_EVENT_CHANGE',{metadata:s.room});break;case 'OBR_SCENE_ITEMS_UPDATE_ITEMS':for(const u of d.updates)Object.assign(s.items.find(i=>i.id===u.id),u);emit('OBR_SCENE_ITEMS_EVENT_CHANGE',{items:s.items});break;
case 'OBR_VIEWPORT_GET_WIDTH':value={width:1200};break;case 'OBR_VIEWPORT_GET_HEIGHT':value={height:900};break;case 'OBR_VIEWPORT_GET_SCALE':value={scale:1};break;case 'OBR_VIEWPORT_GET_POSITION':value={position:{x:0,y:0}};break;case 'OBR_SCENE_GRID_GET_DPI':value={dpi:150};break;
}event.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:value},event.origin);});`;
// The relay, SDK, host background, and Web bridge below are production code.
// Only Owlbear's parent and card storage are controlled synthetic fixtures.
const clientEntry=join(out,'client.ts');
writeFileSync(clientEntry,`import React from 'react';import {createRoot} from 'react-dom/client';import {useWorkbench,getWorkbench,chooseWorkbench,workbenchDiagnostics} from '${join(webRoot,'src/platform/workbench.ts').replaceAll('\\','/')}';import {useGroupRoll} from '${join(webRoot,'src/platform/groupRoll.ts').replaceAll('\\','/')}';Object.assign(window,{getWorkbench,chooseWorkbench,workbenchDiagnostics,events:[]});for(const type of ['workbench-follow-selection','workbench-group-roll-state'])window.addEventListener(type,e=>(window as any).events.push({type,detail:(e as CustomEvent).detail,at:Date.now()}));function View(){const s=useWorkbench(),g=useGroupRoll();return React.createElement('main',{'data-key':s.target?.key,'data-online':String(s.online),'data-group':String(!!g)},s.target?.name||s.message,g?' | group:'+g.targets.length:'');}createRoot(document.getElementById('root')!).render(React.createElement(View));`);
await build({input:clientEntry,plugins:[{name:'web-production',transform(code,id){if(process.env.WEB_BASELINE&&id.replaceAll('\\','/').endsWith('/src/platform/workbench.ts'))return readFileSync(join(process.env.WEB_BASELINE,'src/platform/workbench.ts'),'utf8');},resolveId(id){if(!id.startsWith('.')&&!id.startsWith('/')&&!/^[A-Z]:/i.test(id)&&!id.startsWith('\0'))try{return requireWeb.resolve(id);}catch{}}}],output:{file:join(out,'client.js'),format:'esm',codeSplitting:false}});
const origin='http://127.0.0.1:'+port,traffic=[],http=[],reports=[],errors=[];let reads=0;
const server=createServer(async(req,res)=>{const u=new URL(req.url,origin);
 if(u.pathname==='/suite-dev/relay'){const row={at:Date.now(),role:u.searchParams.get('role'),method:req.method};http.push(row);res.on('finish',()=>Object.assign(row,{elapsedMs:Date.now()-row.at,status:res.statusCode}));
  const chunks=[];req.on('data',p=>chunks.push(p));req.on('end',async()=>{if(req.method==='POST'){try{let b=Buffer.concat(chunks);if(req.headers['content-encoding']==='gzip')b=(await import('node:zlib')).gunzipSync(b);const m=JSON.parse(b);traffic.push({at:Date.now(),role:u.searchParams.get('role'),type:m.type||(m.register?'register':m.sharedDocument?'sharedDocument':m.saveCard?'saveCard':'operation'),itemId:m.itemId,key:m.state?.key});}catch{}}});
  const proxy=request({hostname:'127.0.0.1',port:relayPort,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});proxy.on('error',e=>{if(!res.headersSent)res.writeHead(502);res.end(String(e));});res.on('close',()=>proxy.destroy());req.pipe(proxy);return;
 }
 if(u.pathname.startsWith('/characters/')){reads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(docs[u.pathname.split('/')[3]]));return;}
 if(u.pathname.startsWith('/api/')){res.writeHead(405);res.end('{"error":"read-only fixture"}');return;}
 if(u.pathname==='/client.js'||u.pathname==='/profile.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,u.pathname.slice(1))));return;}
 if(u.pathname.endsWith('/sound.js')){res.setHeader('Content-Type','text/javascript');res.end('export const prime=()=>{};export const play=()=>{};');return;}
 if(u.pathname.endsWith('.js')){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html');
 if(u.pathname==='/')res.end('<script>'+parentScript+'</script><iframe src="/child?obrref='+Buffer.from(origin+' profile-room').toString('base64')+'"></iframe>');
 else if(u.pathname==='/child')res.end('<script type="module" src="/profile.js"></script>');
 else res.end('<!doctype html><title>Five cards / twenty monsters relay fixture</title><div id="root"></div><script type="module" src="/client.js"></script>');
});
process.env.PORT=String(relayPort);process.env.RELAY_ORIGIN=origin;process.env.WORKBENCH_DATA_DIR=join(out,'relay-data');process.env.CARD_READ_BASE=origin;process.env.CARD_WRITE_BASE=origin;
const {server:relayServer}=await import(pathToFileURL(join(root,'server/workbench-relay/server.mjs')).href);
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const virtual=process.env.VIRTUAL_IDLE==='1';const context=await browser.newContext(),page=await context.newPage();if(virtual)await page.clock.install();page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin+'/');const frame=page.frames().find(f=>f.url().includes('/child'));await frame.waitForFunction(()=>window.moduleReady);await page.evaluate(()=>emit('OBR_READY',{ref:'test',userId:'me'}));await frame.waitForFunction(()=>window.probe);const wire=await frame.evaluate(()=>window.probe.wire());
 const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(String(e)));await viewer.goto(origin+'/suite-dev/workbench/#suite='+wire.session+'&bridge='+encodeURIComponent(origin)+'&relay='+wire.clientKey);await viewer.waitForFunction(()=>window.getWorkbench?.().cards.length===5&&window.getWorkbench().target?.cardId==='hero0');
 await frame.waitForFunction(()=>window.probe.health().cards===5);await viewer.evaluate(()=>window.chooseWorkbench('card:hero0'));await page.waitForTimeout(300);
 const started=Date.now(),initialTraffic=traffic.length;console.log(JSON.stringify({phase:'idle-start',cards:5,monsters:20,transport:await viewer.evaluate(()=>window.workbenchDiagnostics().transport)}));
 // Playwright's clock belongs to the context. Advance both pages exactly once in
 // one-second steps while real SDK/HTTP requests continue between steps.
 if(virtual){const anchor=Date.now()+5000;await page.clock.pauseAt(anchor);
  let steps=0;for(;steps<90;steps++){await page.clock.runFor(1000);await new Promise(r=>setTimeout(r,60));if(process.env.WEB_BASELINE?(await frame.evaluate(()=>window.probe.health().relayAge))>=46000:steps>=59){steps++;break;}}
  console.log(JSON.stringify({phase:'virtual-idle',simulatedMs:steps*1000,health:await frame.evaluate(()=>window.probe.health())}));
 }else while(Date.now()-started<46500){await page.waitForTimeout(Math.min(10000,46500-(Date.now()-started)));console.log(JSON.stringify({phase:'idle',elapsedMs:Date.now()-started,health:await frame.evaluate(()=>window.probe.health())}));}
 const health=await frame.evaluate(()=>window.probe.health());let switched=Date.now();await page.evaluate(()=>choose('token1'));let arrived=true;try{await viewer.waitForFunction(()=>window.getWorkbench().target?.cardId==='hero1',null,{timeout:1000,polling:10});}catch{arrived=false;}
 reports.push({name:'idle-small-room-single-card-arrives-within-one-second',passed:arrived,elapsedMs:Date.now()-switched,hostBeforeSelection:health,client:await viewer.evaluate(()=>({online:window.getWorkbench().online,key:window.getWorkbench().target?.key})),idleClientMessages:traffic.slice(initialTraffic).filter(m=>m.role==='client').map(m=>({type:m.type,afterMs:m.at-started}))});console.log(JSON.stringify(reports.at(-1)));
 // Complete recovery before independent monster/multiple/clear assertions.
 if(virtual){await page.clock.resume();}await viewer.waitForFunction(()=>window.getWorkbench().target?.cardId==='hero1',null,{timeout:20000});
 switched=Date.now();await page.evaluate(()=>choose('token5'));await viewer.waitForFunction(()=>window.getWorkbench().target?.kind==='monster',null,{timeout:1500,polling:10});reports.push({name:'single-monster-arrives',passed:true,elapsedMs:Date.now()-switched});
 await page.evaluate(()=>{player.selection=['token1','token5'];emit('OBR_PLAYER_EVENT_CHANGE',{player});});await viewer.waitForFunction(()=>document.querySelector('main')?.dataset.group==='true',null,{timeout:1500});reports.push({name:'two-target-group-arrives',passed:true});
 await page.evaluate(()=>choose(''));await viewer.waitForFunction(()=>document.querySelector('main')?.dataset.group==='false',null,{timeout:1500});await page.waitForTimeout(150);
 reports.push({name:'clear-restores-original-card',passed:await viewer.evaluate(()=>window.getWorkbench().target?.cardId==='hero0'),actual:await viewer.evaluate(()=>window.getWorkbench().target?.key)});
 await viewer.screenshot({path:join(out,'small-room-final.png')});reports.push({name:'no-page-errors',passed:errors.length===0,errors});
 const result={room:{cards:5,monsters:20},virtualIdle:virtual,reports,reads,traffic,http,errors};writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:reports.filter(r=>r.passed).length,failed:reports.filter(r=>!r.passed).length,out}));if(process.env.EXPECT_PASS!=='0'&&reports.some(r=>!r.passed))process.exitCode=1;
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),reports,traffic,http,errors},null,2));throw error;}finally{await browser.close();server.closeAllConnections();relayServer.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>relayServer.close(r))]);}
