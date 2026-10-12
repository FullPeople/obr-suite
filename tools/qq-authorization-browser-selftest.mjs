import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const out=resolve('.local-evidence/'+(process.env.QQ_AUTHORIZATION_RUN_LABEL||'qq-authorization-browser'));mkdirSync(out,{recursive:true});
const priorBackground=process.env.QQ_AUTHORIZATION_PRIOR_BACKGROUND;
const plugins=[{name:'fixture',load(id){if(priorBackground&&id===resolve('src/workbench/background.ts'))return readFileSync(priorBackground,'utf8');},resolveId(id){if(id==='@owlbear-rodeo/sdk')return resolve('tools/fixtures/workbench-sdk.ts');if(['./state','../state','../../state','../modules/bestiary/data'].includes(id))return resolve('tools/fixtures/workbench-modules.ts');},transform(code){return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV','false');}}];
await build({input:resolve('src/workbench/background.ts'),plugins,output:{file:join(out,'background.mjs'),format:'esm',codeSplitting:false}});
const server=createServer((req,res)=>{if(req.url==='/background.mjs'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,'background.mjs')));}else if(req.url==='/host'){res.setHeader('Content-Type','text/html');res.end('<script type="module">import {setupWorkbench} from "/background.mjs";await setupWorkbench();window.hostReady=true;</script>');}else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<iframe id="host" src="/host"></iframe>');}else if(req.url?.includes('/relay')){res.setHeader('Content-Type','application/json');res.end(req.method==='GET'?'[]':'{}');}else{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const web=process.env.DND_CARD_WEB_ROOT||resolve('../web-phase2'),{chromium}=createRequire(join(web,'package.json'))('@playwright/test');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true}),context=await browser.newContext(),errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
await context.addInitScript(()=>{
 if(location.protocol!=='http:')return;
 const card={id:'cloud',name:'Cloud fixture',owner_ids:['me'],visibility:'public',qqOwner:'owner',qqCardId:'original',locked:false,qqEditors:[],qqRoom:{id:'00000000-0000-4000-8000-000000000001',capability:'synthetic-proof'}};
 localStorage.setItem('dnd-qq-plugin',JSON.stringify({token:'synthetic-token-not-a-real-account',accountId:'owner',expiresAt:Date.now()+600000,nickname:'Fixture'}));
 sessionStorage.setItem('workbench-test-world',JSON.stringify({items:[],selection:[],metadata:{},roomMetadata:{'com.obr-suite/qq-cards':[card]},settings:{enabled:{dice:false,inventory:false}}}));
 window.answers=[];window.addEventListener('message',event=>window.answers.push(event.data));
 const fixture=window.cloudFixture={write:false,owner:false,holdPattern:null,pending:[],events:[],putCount:0};
 const original=window.fetch.bind(window),body=()=>({id:card.qqRoom.id,cardId:'original',name:'Cloud fixture',revision:1,owner:fixture.owner,write:fixture.write,locked:!fixture.write,editors:[],document:{schema_version:'0.3',_suiteRevision:1,identity:{character_name:'Cloud fixture'},meta:{ruleset:'2024'},abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(key=>[key,{total:12}])),classes:[],core_stats:{hp:{current:20,max:30,temp:0},ac:10},features:{},background:{},inventory:{},defenses:{},combat:{}}});
 window.fetch=async(url,init={})=>{
  if(!String(url).startsWith('https://dnd.center/api/'))return original(url,init);
  const parsed=new URL(url),kind=parsed.pathname.endsWith('/changes')?'notice':parsed.pathname.endsWith('/session')?'session':'room',method=init.method||'GET';
  fixture.events.push({at:performance.now(),kind,method,conditional:parsed.searchParams.has('since')});
  if(kind==='notice')return new Promise((resolve,reject)=>{init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  if(kind==='session')return new Response(JSON.stringify({authenticated:true,account:{id:'owner'},csrf:'synthetic-csrf'}));
  if(method!=='GET'){fixture.putCount++;return new Response(JSON.stringify({message:'Fixture forbids writes'}),{status:403});}
  const value=body(),conditional=parsed.searchParams.has('since');
  if(fixture.holdPattern===String(conditional)){fixture.holdPattern=null;return new Promise((resolve,reject)=>{const pending={resolve:(status=200)=>resolve(new Response(JSON.stringify(status===200?value:{message:'Old denied read'}),{status})),aborted:false};fixture.pending.push(pending);init.signal?.addEventListener('abort',()=>{pending.aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});});}
  return new Response(JSON.stringify(value));
 };
});
const results=[];
try{
 const page=await context.newPage();await page.goto(origin);const host=page.frames().find(frame=>frame.url().endsWith('/host'));await host.waitForFunction(()=>window.hostReady);
 await page.evaluate(async()=>{const credentials=JSON.parse(localStorage.getItem('workbench:v2:test-room:me')),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credentials.hostKey));window.bridge={protocol:'full-suite-workbench/v1',session:[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join(''),clientInstance:'authorization-fixture'};document.querySelector('#host').contentWindow.postMessage({...window.bridge,type:'hello'},location.origin);});
 await page.waitForFunction(()=>window.answers.some(answer=>answer.type==='ready'));await host.waitForFunction(()=>window.cloudFixture.events.some(row=>row.kind==='room'));
 const start=async(type,extra={})=>{const id=crypto.randomUUID();await page.evaluate(({type,id,extra})=>document.querySelector('#host').contentWindow.postMessage({...window.bridge,type,itemId:'card:cloud',requestId:id,patch:{health:19},...extra},location.origin),{type,id,extra});return id;};
 const answer=async id=>{await page.waitForFunction(id=>window.answers.some(answer=>answer.type==='ack'&&answer.requestId===id),id);return page.evaluate(id=>window.answers.find(answer=>answer.type==='ack'&&answer.requestId===id),id);};
 const catalog=async()=>{const response=await answer(await start('refreshCatalog'));assert(response.ok,response.message);return response.result.catalog.cards.find(card=>card.id==='cloud');};
 const hold=async(conditional,write)=>{await host.evaluate(({conditional,write})=>{window.cloudFixture.write=write;window.cloudFixture.holdPattern=String(conditional);}, {conditional,write});};
 const release=async(status=200)=>host.evaluate(status=>window.cloudFixture.pending.shift().resolve(status),status);
 const pending=async()=>host.waitForFunction(()=>window.cloudFixture.pending.length>0);
 const deniedWrite=async()=>{const response=await answer(await start('stats'));assert.equal(response.ok,false);assert.equal(await host.evaluate(()=>window.cloudFixture.putCount),0);};
 async function check(name,run){const began=Date.now();await run();results.push({name,elapsedMs:Date.now()-began,passed:true});console.log('PASS',results.length,name);}
 await check('Old loadCard grant cannot replace a newer cloudInfo denial at the same revision',async()=>{
  await hold(true,true);const old=await start('refreshCard');await pending();await host.evaluate(()=>window.cloudFixture.write=false);assert((await answer(await start('cloudInfo'))).ok);assert.equal((await catalog()).write,false);await release();await answer(old);assert.equal((await catalog()).write,false);await deniedWrite();
 });
 await check('Old cloudInfo grant cannot replace a newer loadCard denial at the same revision',async()=>{
  await hold(false,true);const old=await start('cloudInfo');await pending();await host.evaluate(()=>window.cloudFixture.write=false);await answer(await start('refreshCard'));await release();assert.equal((await answer(old)).ok,false);assert.equal((await catalog()).write,false);await deniedWrite();
 });
 await check('An old cloudInfo HTTP denial cannot revoke a more recent loadCard grant',async()=>{
  await hold(false,false);const old=await start('cloudInfo');await pending();await host.evaluate(()=>window.cloudFixture.write=true);await answer(await start('refreshCard'));assert.equal((await catalog()).write,true);await release(403);assert.equal((await answer(old)).ok,false);assert.equal((await catalog()).write,true);
 });
 await check('Foreground invalidation blocks writes before and after an older loadCard reply until a new read completes',async()=>{
  await hold(true,true);const old=await start('refreshCard');await pending();await host.evaluate(()=>{window.cloudFixture.write=false;window.dispatchEvent(new Event('focus'));});assert.equal((await catalog()).write,false);await deniedWrite();await host.evaluate(()=>window.cloudFixture.holdPattern='true');await release();await pending();assert.equal((await catalog()).write,false);await host.evaluate(()=>window.cloudFixture.write=true);await release();await answer(old);assert.equal((await catalog()).write,false);await answer(await start('cloudInfo'));assert.equal((await catalog()).write,true);
 });
 await check('A newer cloudInfo denial fences the cloudEditors preflight before any editor mutation',async()=>{
  await host.evaluate(()=>window.cloudFixture.owner=true);await hold(false,true);const old=await start('cloudEditors',{accountId:'00000000-0000-4000-8000-000000000002'});await pending();await host.evaluate(()=>{window.cloudFixture.owner=false;window.cloudFixture.write=false;});await answer(await start('cloudInfo'));await release();assert.equal((await answer(old)).ok,false);assert.equal((await catalog()).write,false);assert.equal(await host.evaluate(()=>window.cloudFixture.putCount),0);
 });
 assert.deepEqual(errors,[]);results.push({name:'No browser runtime errors',passed:true});
 const sources=Object.fromEntries(['src/workbench/background.ts','src/modules/characterCards/authorization-lease.ts','src/modules/characterCards/qq-account.ts','tools/fixtures/workbench-sdk.ts'].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
 writeFileSync(join(out,'result.json'),JSON.stringify({checks:results.length,results,sources,events:await host.evaluate(()=>window.cloudFixture.events),browser:await browser.version(),syntheticSDK:true,syntheticHTTP:true,actualProductionHost:true,realQQ:false,realRoom:false,published:false},null,2)+'\n');
}finally{await context.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
