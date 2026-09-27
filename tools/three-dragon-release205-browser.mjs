// Actual production bundles and public HTTPS/WSS service. Only Owlbear identity,
// discovery and iframe host transport are fixtures; no game views are mocked.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve('../web/package.json'))('@playwright/test');
const live=process.argv.includes('--live'),origin='https://obr.dnd.center',out='D:/Temp/DND-card-release205-storage/release205';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),actors=[],errors=[],broadcasts=[],checks=[];let metadata={};
const key='com.fullpeople/three-dragon-ante/server-v1',channel='workbench-panel-frame/v1';
const wait=async(check,label,timeout=30000)=>{const end=Date.now()+timeout;while(!await check()){if(Date.now()>end)throw Error('Timed out '+label);await new Promise(r=>setTimeout(r,30));}};
const patch=(v,p)=>{const next={...v,...p.set};for(const k of p.remove)delete next[k];return next;};
async function emit(a,event,name,data){await a.page.evaluate(({event,name,data,embedded,channel})=>{document.querySelector('iframe')?.contentWindow.postMessage(embedded?{channel,event,name,data}:event==='roomMetadata'?{id:'OBR_ROOM_METADATA_EVENT_CHANGE',data:{metadata:data}}:{id:'OBR_BROADCAST_MESSAGE_'+name,data},location.origin);},{event,name,data,embedded:a.embedded,channel});}
const mapping={OBR_ROOM_GET_METADATA:['room.getMetadata','metadata'],OBR_ROOM_SET_METADATA:['room.setMetadata'],OBR_PLAYER_GET_ID:['player.getId','id'],OBR_PLAYER_GET_NAME:['player.getName','name'],OBR_PLAYER_GET_ROLE:['player.getRole','role'],OBR_PLAYER_GET_CONNECTION_ID:['player.getConnectionId','connectionId'],OBR_PARTY_GET_PLAYERS:['party.getPlayers','players'],OBR_BROADCAST_SEND_MESSAGE:['broadcast.sendMessage']};
try{
 for(let i=0;i<3;i++){
  const actor={id:'release205-'+i,connectionId:'release205-connection-'+i,name:i===0?'发布检查主持':i===1?'发布检查玩家':'发布检查 DM',role:i===1?'PLAYER':'GM',embedded:i===1};actors.push(actor);
  const context=actor.context=await browser.newContext({viewport:i===1?{width:390,height:844}:{width:1440,height:960},hasTouch:i===1,reducedMotion:'reduce'}),page=actor.page=await context.newPage();context.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',ws=>{ws.on('framereceived',event=>{try{const m=JSON.parse(String(event.payload));if(m.type==='view')actor.view=m.view;else if(m.type==='patch')actor.view={...patch(actor.view,m.patch),game:m.gamePatch?patch(actor.view.game,m.gamePatch):m.game};}catch{}});});
  await context.addInitScript(({fallback})=>{localStorage.setItem('three-dragon-ante/language','zh');const Native=WebSocket;window.__tdaSockets=[];window.WebSocket=class extends Native{constructor(...args){super(...args);window.__tdaSockets.push(this);}};if(fallback){const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...args){return t==='webgl'||t==='webgl2'?null:old.call(this,t,...args);};}},{fallback:i!==0});
  if(!live)await context.route(origin+'/**',route=>{
   const path=decodeURIComponent(new URL(route.request().url()).pathname),roots={'/suite-dev/':resolve('dist-workbench-dev'),'/three-dragon-ante-dev/':resolve('extensions/three-dragon-ante/dist')},prefix=Object.keys(roots).find(k=>path.startsWith(k));
   if(!prefix)return route.continue();const base=resolve(roots[prefix]),file=resolve(base,path.slice(prefix.length));if(!file.startsWith(base+'\\')||!existsSync(file))return route.fulfill({status:404});return route.fulfill({contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream',body:readFileSync(file)});
  });
  await page.exposeBinding('__hostCall',async(_,{method,args=[]})=>{
   if(method==='init')return {roomId:'release205-fixture',playerId:actor.id,preferences:{}};
   if(['subscribe','notification.show','dispose'].includes(method))return;
   if(method==='room.getMetadata')return structuredClone(metadata);
   if(method==='room.setMetadata'){metadata={...metadata,...args[0]};await Promise.all(actors.map(a=>emit(a,'roomMetadata',null,metadata)));return;}
   if(method==='party.getPlayers')return actors.filter(a=>a!==actor).map(({id,connectionId,name,role})=>({id,connectionId,name,role}));
   const field={'player.getId':'id','player.getName':'name','player.getRole':'role','player.getConnectionId':'connectionId'}[method];if(field)return actor[field];
   if(method==='broadcast.sendMessage'){const [name,data,options]=args;broadcasts.push(name);const targets=options.destination==='LOCAL'?[actor]:actors;await Promise.all(targets.map(a=>emit(a,'broadcast',name,{connectionId:actor.connectionId,data})));return;}
   throw Error('Unexpected host call '+method);
  });
  const target=actor.embedded?'/suite-dev/workbench-panels/table.html':'/three-dragon-ante-dev/index.html?obrref='+Buffer.from(origin+' release205-fixture').toString('base64');
  const parent=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0}iframe{width:100%;height:100%;border:0}</style><script>
  const embedded=${actor.embedded},channel=${JSON.stringify(channel)},mapping=${JSON.stringify(mapping)};function send(v){document.querySelector('iframe').contentWindow.postMessage(v,location.origin)};
  addEventListener('message',async e=>{if(e.source!==document.querySelector('iframe').contentWindow)return;const m=e.data;try{
   if(embedded&&m.channel===channel&&m.id){const result=await __hostCall({method:m.method,args:m.args});send({channel,id:m.id,result});}
   else if(!embedded&&m.nonce){const spec=mapping[m.id];if(!spec)throw Error('Unknown SDK call '+m.id);const args=m.id==='OBR_ROOM_SET_METADATA'?[m.data.update]:m.id==='OBR_BROADCAST_SEND_MESSAGE'?[m.data.channel,m.data.data,m.data.options]:[];const result=await __hostCall({method:spec[0],args});send({id:m.id+'_RESPONSE'+m.nonce,data:spec[1]?{[spec[1]]:result}:{}});}
  }catch(error){send(embedded?{channel,id:m.id,error:String(error)}:{id:m.id+'_ERROR'+m.nonce,data:String(error)});}});</script><iframe src="${target}" onload="${actor.embedded?'':`send({id:'OBR_READY',data:{ref:'fixture',userId:'${actor.id}'}})`}"></iframe>`;
  await page.route(origin+'/release205-fixture',r=>r.fulfill({contentType:'text/html',body:parent}));await page.goto(origin+'/release205-fixture',{timeout:120000});actor.frame=page.frames().find(f=>f.parentFrame());await actor.frame.getByRole('button',{name:'创建牌桌',exact:true}).waitFor();
 }
 const [host,guest,dm]=actors;await host.frame.getByRole('button',{name:'创建牌桌',exact:true}).click();await wait(()=>metadata[key]&&actors.every(a=>a.view?.table),'real public room');
 await wait(()=>!guest.view.message,'verified guest admission');await guest.frame.getByRole('button',{name:'加入牌桌',exact:true}).click();await wait(()=>host.view.table.seats.length===2,'join');
 await host.frame.locator('#deck-choice').selectOption('wheel-of-fate-v1');await host.frame.getByRole('button',{name:'开始游戏',exact:true}).click();await wait(()=>host.view.game?.hand?.length&&guest.view.game?.hand?.length,'deal');
 checks.push('Production standalone host and embedded mobile player share a real server game and private hands');
 await wait(()=>dm.view.role==='GM','GM verification');await dm.frame.locator('#omniscient-toggle').click();await wait(()=>dm.view.game?.omniscient,'GM view');assert.equal(guest.view.game.privateHands,undefined);
 for(const actor of [guest,host]){await wait(()=>actors.every(a=>a.view.game.revision===guest.view.game.revision),'previous action delivered to all clients');const rev=actor.view.game.revision;if(actor.embedded){await actor.frame.locator('#hand [data-card]').first().focus();}else await actor.frame.locator('#table-stage').focus();await actor.frame.page().keyboard.press('Space');await actor.frame.page().keyboard.press('Enter');await wait(()=>actor.view.game.revision>rev,'real public ante');}
 checks.push('Both production renderers submit real antes through public WSS; no Owlbear gameplay broadcast');
 assert.equal(broadcasts.filter(name=>!name.includes('server-grant')).length,0);
 await wait(()=>guest.view.game.revision===host.view.game.revision,'both views caught up after ante');
 const saved={revision:guest.view.game.revision,hand:[...guest.view.game.hand]};guest.view=null;await guest.frame.evaluate(()=>window.__tdaSockets.forEach(ws=>ws.close()));await wait(()=>guest.view?.game,'socket recovery');assert.equal(guest.view.game.revision,saved.revision);assert.deepEqual(guest.view.game.hand,saved.hand);checks.push('Interrupted WebSocket automatically reconnects to the same persisted hand');
 for(const actor of [host,guest]){assert.equal(await actor.frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await actor.page.screenshot({path:join(out,(live?'live':'candidate')+'-205-'+(actor.embedded?'mobile':'desktop')+'.png')});}
 assert.deepEqual(errors,[]);writeFileSync(join(out,(live?'live':'candidate')+'-browser.json'),JSON.stringify({checks,errors,testRoomIds:[metadata[key].id],scope:'Unmodified production frontend + public HTTPS/WSS and SQLite; Owlbear identity and iframe host simulated. Not a real Owlbear room.'},null,2));console.log(checks.join('\n'));
}catch(error){for(const actor of actors)await actor.page.screenshot({path:join(out,(live?'live':'candidate')+'-failure-'+actor.id+'.png')}).catch(()=>{});writeFileSync(join(out,(live?'live':'candidate')+'-failure.json'),JSON.stringify({error:String(error),errors,testRoomIds:metadata[key]?[metadata[key].id]:[]},null,2));throw error;}
finally{await browser.close();}
