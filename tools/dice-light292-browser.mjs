import {build} from 'rolldown';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=join(root,'dist-workbench-dev'),fixture=join(root,'.local-evidence/light292');mkdirSync(fixture,{recursive:true});
const sdk=`
const query=new URLSearchParams(location.search),id=query.get('id')||'p1',role=query.get('role')||'PLAYER';
const profile={id,connectionId:id,name:id,color:'#5599cc',role,metadata:{}};
const bus=new BroadcastChannel('fixture-obr-292'),listeners=new Map();
const stats=window.sdkStats={fullReads:0,remote:0,local:0,modals:0,messages:[],held:false};
const receive=m=>listeners.get(m.name)?.forEach(fn=>fn({connectionId:m.connectionId,data:m.data}));bus.onmessage=e=>receive(e.data);
const never=()=>new Promise(()=>{}),change=()=>()=>{};
const sdk={room:{id:'light292-room'},player:{onChange:change,...Object.fromEntries(['Id','ConnectionId','Name','Color','Role','Metadata'].map(k=>['get'+k,async()=>profile[k[0].toLowerCase()+k.slice(1)]]))},
 party:{onChange:change,getPlayers:async()=>['p1','p2','p3','gm'].map(id=>({id,connectionId:id,role:id==='gm'?'GM':'PLAYER'}))},
 scene:{isReady:async()=>true,onReadyChange:change,onMetadataChange:change,getMetadata:()=>{stats.fullReads++;return never();},grid:{getDpi:async()=>100},items:{onChange:change,getItems:async ids=>{if(!Array.isArray(ids)){stats.fullReads++;return never();}return ids.map(id=>({id,visible:true,position:{x:100,y:100},metadata:{},createdUserId:profile.id}));},updateItems:async()=>{}}},
 viewport:{getPosition:async()=>({x:0,y:0}),getScale:async()=>1},notification:{show:async()=>{}},action:{open:async()=>{}},
 modal:{open:async options=>{stats.modals++;const frame=document.createElement('iframe');frame.id='renderer';frame.style.cssText='width:800px;height:600px;border:0';frame.src=options.url;document.body.append(frame);},close:async()=>{}},
 broadcast:{onMessage:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);return()=>listeners.get(name).delete(fn);},sendMessage:(name,data,options)=>{stats.messages.push({name,data,destination:options.destination});if(options.destination==='LOCAL'){stats.local++;receive({name,data,connectionId:id});return Promise.resolve();}stats.remote++;if(stats.held)return never();bus.postMessage({name,data,connectionId:id});return Promise.resolve();}}
};export default sdk;`;
writeFileSync(join(fixture,'sdk.ts'),sdk);
writeFileSync(join(fixture,'dice.ts'),`export const BROADCAST_DICE_ROLL='com.obr-suite/dice-roll';export const isGlobalDarkRollEnabled=()=>false;`);
writeFileSync(join(fixture,'activity.ts'),`export const setupActivityPanel=()=>{};export const ensureActivityPanel=async()=>{};`);
writeFileSync(join(fixture,'state.ts'),`export const getState=()=>({enabled:{dice:true}});`);
writeFileSync(join(fixture,'entry.ts'),`import * as host from '${join(root,'src/workbench/dice.ts').replaceAll('\\','/')}';import {diceRpc} from '${join(root,'src/workbench/dice-light-rpc.ts').replaceAll('\\','/')}';import {calculateLightRoll} from '${join(root,'src/workbench/dice-light-engine.ts').replaceAll('\\','/')}';import {readDiceViewMode} from '${join(root,'src/workbench/dice-view-mode.ts').replaceAll('\\','/')}';window.host={...host,calculateLightRoll,readDiceViewMode};window.formulaRequests=[];window.addEventListener('message',event=>{const m=event.data;if(event.origin!==location.origin||m?.channel!=='workbench-dice-frame/v1'||!m.method)return;if(m.method==='dice2d.submit'||m.method==='broadcast.sendMessage')window.formulaRequests.push(m);void diceRpc(m.method,m.args,{itemId:null}).then(result=>event.source.postMessage({channel:m.channel,id:m.id,result},location.origin));});void host.setupWorkbenchDice().then(()=>window.ready=true);`);
await build({input:join(fixture,'entry.ts'),plugins:[{name:'fixture-sdk',resolveId(id,importer){if(id==='@owlbear-rodeo/sdk')return join(fixture,'sdk.ts');if(id==='../modules/dice')return join(fixture,'dice.ts');if(id==='../state'&&importer?.includes('dice-light-rpc'))return join(fixture,'state.ts');if(id==='./activity-panel'&&importer?.includes('dice-light-runtime'))return join(fixture,'activity.ts');},transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/'));}}],output:{file:join(fixture,'probe.js'),format:'esm'}});
writeFileSync(join(fixture,'index.html'),'<body><script type="module" src="/fixture/probe.js"></script>');
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;const file=path.startsWith('/fixture/')?join(fixture,path.slice(9)):join(out,path.replace(/^\/suite-dev\//,''));if(!existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('content-type',extname(file)==='.js'?'text/javascript':extname(file)==='.html'?'text/html':'image/png');res.end(readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'msedge':undefined)});const context=await browser.newContext();const failures=[],requests=[];
await context.addInitScript(()=>{window.physicsWorkers=0;const Original=window.Worker;window.Worker=class extends Original{constructor(...args){window.physicsWorkers++;throw Error('Physics worker forbidden in 2D test');}};localStorage.setItem('obr-suite/dice/view-mode','3d');});
context.on('request',req=>{if(/jolt|\.wasm|physics-worker|skin-preview|dice3d\//i.test(req.url()))requests.push(req.url());});
try{
 const pages=[];for(const id of ['p1','p2','p3','gm']){const p=await context.newPage();p.on('pageerror',e=>failures.push(e.message));await p.goto(origin+'/fixture/index.html?id='+id+'&role='+(id==='gm'?'GM':'PLAYER'));await p.waitForFunction(()=>window.ready);pages.push(p);}
 const roll=await pages[0].evaluate(()=>window.host.executeRoll({expression:'1d20',commandId:'ordinary-one'}));
 for(const p of pages){await p.waitForFunction(id=>window.host.rollStates.get(id)==='started'||window.host.rollStates.get(id)==='result',roll.rollId);assert.equal(await p.locator('#renderer').contentFrame().locator('iframe').count(),1);}
 const duplicate=await pages[0].evaluate(()=>window.host.executeRoll({expression:'1d20',commandId:'ordinary-one'}));assert.equal(duplicate.rollId,roll.rollId);
 await pages[0].evaluate(p=>{new BroadcastChannel('fixture-obr-292').postMessage({name:'com.obr-suite/dice-roll',data:p,connectionId:'p1'});},roll);
 for(const p of pages)assert.equal(await p.locator('#renderer').contentFrame().locator('iframe').count(),1);
 await pages[0].evaluate(()=>window.sdkStats.held=true);
 const fast=await pages[0].evaluate(()=>window.host.executeRoll({expression:'1d6+2',commandId:'held-network'}));await pages[0].waitForFunction(id=>window.host.rollStates.get(id)==='started',fast.rollId);
 const dark=await pages[3].evaluate(()=>window.host.executeRoll({expression:'2d6',hidden:true,commandId:'dark-one'}));await pages[3].waitForFunction(id=>window.host.rollStates.get(id)==='started',dark.rollId);
 for(const p of pages.slice(0,3))assert.equal(await p.evaluate(id=>window.host.rollStates.has(id),dark.rollId),false);
 const player=await pages[1].evaluate(()=>window.host.executeRoll({expression:'1d4',hidden:true,commandId:'player-hidden'}));assert.equal(player.hidden,false);
 const formulas=['adv(1d20)+5','adv(1d6)+adv(1d4)','repeat(3,1d6+2)','same(2d6)','max(1d6,10)','min(1d6,2)','reset(1d6,1)','resetmin(1d6,3)','resetmax(1d6,4)','burst(1d6)','1d20-1d6+2'];
 for(const expression of formulas){const p=await pages[1].evaluate(expression=>window.host.executeRoll({expression,commandId:crypto.randomUUID()}),expression);assert(Number.isFinite(p.total));const expected=p.dice.filter(d=>!d.loser).reduce((n,d)=>n+(d.subtract?-d.value:d.value),0)+p.modifier*(p.rowStarts?.length||1);assert.equal(p.total,expected);}
 await pages[2].evaluate(()=>{const frame=document.createElement('iframe');frame.id='composer';frame.src='/suite-dev/workbench-dice/index.html';document.body.append(frame);});
 const composer=pages[2].locator('#composer').contentFrame();await composer.locator('body[data-bridge-ready="true"]').waitFor();await composer.locator('#exprInput').fill('1d8+3');await composer.locator('#btnRoll').click();await pages[2].waitForFunction(()=>window.formulaRequests.some(m=>m.method==='dice2d.submit'));
 const submission=await pages[2].evaluate(()=>window.formulaRequests.find(m=>m.method==='dice2d.submit'));assert.equal(submission.args[0].expression,'1d8+3');assert.equal(submission.args[0].dice,undefined);
 for(const p of pages){assert.equal(await p.evaluate(()=>window.sdkStats.fullReads),0);assert.equal(await p.evaluate(()=>window.physicsWorkers),0);assert.equal(await p.evaluate(()=>window.host.readDiceViewMode()),'2d');}
 assert.deepEqual(requests,[]);assert.deepEqual(failures,[]);
 const result={passed:true,syntheticClients:4,ordinaryLocalAndRemote:true,blockedRemoteDoesNotBlockLocal:true,commandAndRollDedup:true,darkVisibility:true,externalComposerFormulaOnly:true,formulas:formulas.length,fullCatalogReads:0,physicsWorkers:0,wasmRequests:0,realOwlbearRoom:false};writeFileSync(join(fixture,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
 const debug={error:String(error),failures,requests,pages:await Promise.all(context.pages().map(async page=>({url:page.url(),state:await page.evaluate(()=>({ready:window.ready,stats:window.sdkStats,rollStates:[...(window.host?.rollStates||[])],frames:[...document.querySelectorAll('iframe')].map(frame=>({url:frame.src,ready:frame.contentDocument?.body?.dataset}))})).catch(error=>({error:String(error)}))}))) };
 writeFileSync(join(fixture,'failure.json'),JSON.stringify(debug,null,2));console.error(JSON.stringify({error:debug.error,failures,pages:debug.pages.map(p=>({url:p.url,ready:p.state.ready,rollStates:p.state.rollStates,frames:p.state.frames}))}));throw error;
}finally{await browser.close();server.close();}
