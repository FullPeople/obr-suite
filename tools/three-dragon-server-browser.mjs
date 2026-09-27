import {build} from 'rolldown';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve('.'),base=join(root,'extensions/three-dragon-ante/src/game'),out=mkdtempSync('D:/Temp/tda-browser203-');
const {createTableService}=await import(pathToFileURL('D:/Temp/DND-card-release203-storage/server/service.mjs'));
const {chromium}=createRequire(new URL('../../web/package.json',import.meta.url))('@playwright/test');
const staticServer=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(join(out,'app.js')));return;}
 if(path.startsWith('/art/')){const file=resolve(base,path.slice(1));if(file.startsWith(base)&&existsSync(file)){res.setHeader('Content-Type',extname(file)==='.png'?'image/png':'image/webp');res.end(readFileSync(file));return;}res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="table-app"></main><script type="module" src="/app.js"></script>');
});await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+staticServer.address().port,service=createTableService({database:join(out,'game.sqlite'),origin});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
const api='http://127.0.0.1:'+service.server.address().port+'/three-dragon-api/v1';
await build({input:join(base,'page.ts'),plugins:[{name:'fixture-sdk',resolveId(id,importer){if(id==='@owlbear-rodeo/sdk')return '\0sdk.js';if(id.endsWith('.css'))return '\0css:'+resolve(dirname(importer),id)+'.js';},load(id){if(id==='\0sdk.js')return 'export default window.__tdaSDK;';if(id.startsWith('\0css:'))return 'const s=document.createElement("style");s.textContent='+JSON.stringify(readFileSync(id.slice(5,-3),'utf8'))+';document.head.append(s);';},transform(code){return code.replaceAll('import.meta.env?.VITE_TDA_API',JSON.stringify(api)).replaceAll('import.meta.env.BASE_URL',JSON.stringify('/')).replaceAll('import.meta.env.DEV','false').replace(/declare const __TDA_BUILD__: string;/g,'').replaceAll('__TDA_BUILD__',JSON.stringify('203 browser test'));}}],output:{file:join(out,'app.js'),format:'esm',codeSplitting:false},logLevel:'warn'});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),actors=[],errors=[],broadcasts=[],checks=[];let metadata={};
async function emit(actor,key,value){if(!actor.page||actor.page.isClosed())return;await actor.page.evaluate(({key,value})=>{for(const fn of window.__tdaEvents.get(key)||[])fn(value);},{key,value});}
function state(){const row=service.db.prepare('SELECT state FROM rooms ORDER BY updated DESC LIMIT 1').get();return row?JSON.parse(row.state):null;}
const wait=async(check,label,ms=12000)=>{const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw Error('Timed out '+label);await new Promise(r=>setTimeout(r,25));}};
const pass=s=>{checks.push(s);console.log('PASS '+s);};
try{
 for(let i=0;i<4;i++){
  const actor={id:'browser-'+i,connectionId:'browser-connection-'+i,role:i===0||i===3?'GM':'PLAYER',name:'Player '+i};actors.push(actor);
  const context=actor.context=await browser.newContext({viewport:i===2?{width:390,height:844}:{width:1280,height:900},hasTouch:i===2,isMobile:i===2,reducedMotion:'reduce'});
  await context.exposeBinding('__tdaCall',async(_,{method,args})=>{
   if(method==='room.getMetadata')return structuredClone(metadata);
   if(method==='room.setMetadata'){metadata={...metadata,...args[0]};await Promise.all(actors.map(a=>emit(a,'roomMetadata',metadata)));return;}
   if(method==='party.getPlayers')return actors.filter(a=>a!==actor).map(({id,connectionId,role,name})=>({id,connectionId,role,name}));
   const field={'player.getId':'id','player.getConnectionId':'connectionId','player.getRole':'role','player.getName':'name'}[method];if(field)return actor[field];
   if(method==='broadcast.sendMessage'){const [name,data,options]=args;broadcasts.push({name,from:actor.id});const targets=options.destination==='LOCAL'?[actor]:options.destination==='REMOTE'?actors.filter(a=>a!==actor):actors;await Promise.all(targets.map(a=>emit(a,'broadcast:'+name,{connectionId:actor.connectionId,data})));return;}
   if(method==='notification.show')return;
   throw Error('Unexpected SDK method: '+method);
  });
  await context.addInitScript(({fallback})=>{
   const events=window.__tdaEvents=new Map(),on=(key,fn)=>{if(!events.has(key))events.set(key,new Set());events.get(key).add(fn);return()=>events.get(key).delete(fn);},call=(method,...args)=>window.__tdaCall({method,args});
   window.__tdaSDK={onReady:fn=>void Promise.resolve().then(fn),room:{id:'browser-fixture-room',getMetadata:()=>call('room.getMetadata'),setMetadata:v=>call('room.setMetadata',v),onMetadataChange:fn=>on('roomMetadata',fn)},player:{getId:()=>call('player.getId'),getConnectionId:()=>call('player.getConnectionId'),getRole:()=>call('player.getRole'),getName:()=>call('player.getName')},party:{getPlayers:()=>call('party.getPlayers')},broadcast:{onMessage:(name,fn)=>on('broadcast:'+name,fn),sendMessage:(...args)=>call('broadcast.sendMessage',...args)},notification:{show:(...args)=>call('notification.show',...args)}};
   if(fallback){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:original.call(this,type,...args);};}
  },{fallback:i!==0});
  const page=actor.page=await context.newPage();page.on('pageerror',e=>errors.push(actor.id+': '+e.message));await page.goto(origin);await page.getByRole('button',{name:'创建牌桌',exact:true}).waitFor();
 }
 await actors[0].page.getByRole('button',{name:'创建牌桌',exact:true}).click();
 await wait(()=>state()?.table.seats.length===1,'server table created');
 for(const actor of actors.slice(1,3)){await actor.page.getByRole('button',{name:'加入牌桌',exact:true}).waitFor();await wait(()=>service.db.prepare("SELECT role FROM members WHERE external_id=? AND role!='PENDING'").get(actor.id),'authenticated admission');await actor.page.getByRole('button',{name:'加入牌桌',exact:true}).click();}
 await wait(()=>state().table.seats.length===3,'three seated');
 await actors[0].page.locator('#deck-choice').selectOption('wheel-of-fate-v1');await actors[0].page.getByRole('button',{name:'开始游戏',exact:true}).click();await wait(()=>state()?.game?.variant.deckId==='wheel-of-fate-v1','81-card game');
 const initial=state().game;assert.equal(initial.deck.length+initial.seats.reduce((n,s)=>n+s.hand.length,0),81);
 for(const actor of actors.slice(0,3))await actor.page.locator('#hand [data-card]').first().waitFor({state:'attached'});pass('real browser create, verified admission, join and 81-card deal through server');
 await wait(()=>service.db.prepare('SELECT role FROM members WHERE external_id=?').get(actors[3].id)?.role==='GM','GM grant');
 await actors[3].page.locator('#omniscient-toggle').click();await actors[3].page.waitForFunction(()=>document.getElementById('table-app').dataset.omniscient==='true');
 assert.equal(await actors[1].page.locator('#omniscient-toggle').isVisible(),false);pass('unseated DM inspection works; ordinary player has no omniscient control');
 const oldBroadcastCount=broadcasts.length;
 // DOM keyboard path works on narrow touch layout; all sends go through the real UI command handlers.
 for(const actor of actors.slice(1,3)){
  const revision=state().game.revision;await actor.page.locator('#hand [data-card]').first().focus();await actor.page.keyboard.press('Space');await actor.page.keyboard.press('Enter');await wait(()=>state().game.revision>revision,'browser ante');await actor.page.waitForFunction(()=>document.getElementById('table-app').dataset.pendingAction==='false');
 }
 // WebGL keyboard selection is on the board rather than the hidden DOM hand.
 const revision=state().game.revision;await actors[0].page.locator('#table-stage').focus();await actors[0].page.keyboard.press('Space');await actors[0].page.keyboard.press('Enter');await wait(()=>state().game.revision>revision,'WebGL ante');
 assert.equal(broadcasts.slice(oldBroadcastCount).filter(m=>!m.name.includes('server-grant')).length,0);pass('actual desktop WebGL and mobile DOM submit antes with no Owlbear gameplay broadcasts');
 const savedRevision=state().game.revision,hand=state().game.seats.find(s=>s.id===service.db.prepare('SELECT id FROM members WHERE external_id=?').get(actors[1].id).id).hand;
 await actors[1].page.reload();await actors[1].page.locator('#hand [data-card]').first().waitFor();assert.equal(state().game.revision,savedRevision);assert.equal(await actors[1].page.locator('#hand [data-card]').count(),hand.length);pass('browser refresh recovers the same seat and persisted hand without redealing');
 for(const actor of [actors[0],actors[2]]){assert.equal(await actor.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await actor.page.screenshot({path:join(out,actor.id+'.png'),fullPage:true});}
 assert.deepEqual(errors,[]);writeFileSync(join(out,'result.json'),JSON.stringify({checks,errors,broadcasts,scope:'Real browser UI, WebSocket and SQLite; SDK identity/room discovery fixture. Not a real Owlbear room.'},null,2));console.log(out);
}catch(error){for(const a of actors)if(a.page)await a.page.screenshot({path:join(out,a.id+'-failure.png')}).catch(()=>{});writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),errors,broadcasts,metadataKeys:Object.keys(metadata)},null,2));console.log(out);throw error;}
finally{await browser.close();await service.close();await new Promise(r=>staticServer.close(r));}
