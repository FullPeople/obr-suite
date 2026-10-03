// Synthetic room transport, real production standalone/Suite table entries and
// real Three.js rendering. This does not claim native Owlbear-room coverage.
import {build} from 'rolldown';
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync,existsSync,mkdtempSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve('.'),base=join(root,'extensions/three-dragon-ante/src/game'),out=resolve('.local-evidence/three-dragon-seat-exit');mkdirSync(out,{recursive:true});
const tmp=mkdtempSync(join(tmpdir(),'tda-browser-seat-exit-')),origin='https://three-dragon-fixture.invalid';
const checks=[],errors=[];
const entry=`import{mountTableStage}from ${JSON.stringify(join(base,'stage/index.ts'))};import{createGame,projectSeat,projectPublic}from ${JSON.stringify(join(base,'rules/index.ts'))};
const surface=mountTableStage(document.querySelector('canvas'),{quality:'low'});window.h={surface,set(n,self){const state=createGame({id:'same-game-'+n,seed:7341,seats:Array.from({length:n},(_,i)=>({id:'s'+i,name:['Very long player name '.repeat(5),'一位名字特别长的玩家'.repeat(7),'Cyra','Dorian','Elara','Finn'][i]}))});const view=self===null?projectPublic(state):projectSeat(state,'s'+self);surface.update({view,language:'zh',connected:true,animate:false,reducedMotion:true});}};h.set(5,0);`;
const probe=`window.__seatNames=()=>{scene.updateMatrixWorld(true);camera.updateMatrixWorld();const rect=canvas.getBoundingClientRect();return infoGroup.children.filter(o=>o.userData.seatName).map(o=>{const points=[[-.5,-80/768],[.5,-80/768],[-.5,80/768],[.5,80/768]].map(([x,y])=>new THREE.Vector3(x,y,0).applyMatrix4(o.matrixWorld).project(camera)).map(p=>({x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}));return{id:o.userData.seatName,x:o.position.x,z:o.position.z,left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};});};return handle;`;
await build({input:'fixture',plugins:[{name:'stage-fixture',resolveId(id){if(id==='fixture')return '\0fixture.ts';},load(id){if(id==='\0fixture.ts')return entry;},transform(code,id){if(id.replaceAll('\\','/').endsWith('/stage/index.ts')){assert.equal(code.split('return handle;').length,2);return code.replace('return handle;',probe);}}}],output:{file:join(tmp,'stage.js'),format:'esm',codeSplitting:false},logLevel:'warn'});
await build({input:'rules',platform:'node',plugins:[{name:'rules',resolveId(id){if(id==='rules')return '\0rules.ts';},load(id){if(id==='\0rules.ts')return `export{createGame,projectSeat,projectPublic}from ${JSON.stringify(join(base,'rules/index.ts'))};export{packSeat,packPublic}from ${JSON.stringify(join(base,'wire.ts'))};`;}}],output:{file:join(tmp,'rules.mjs'),format:'esm',codeSplitting:false},logLevel:'warn'});
const {createGame,projectSeat,projectPublic,packSeat,packPublic}=await import(pathToFileURL(join(tmp,'rules.mjs')));
if(process.argv.includes('--prepare-only')){console.log('Prepared browser fixtures: '+tmp);process.exit(0);}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.env.CHROME_PATH||undefined,headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
await context.tracing.start({screenshots:true,snapshots:true});
try{
 const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
 await page.route(origin+'/**',route=>{const pathname=new URL(route.request().url()).pathname;if(pathname==='/stage.js')return route.fulfill({contentType:'text/javascript',body:readFileSync(join(tmp,'stage.js'))});if(pathname.startsWith('/art/')){const file=resolve(base,pathname.slice(1));return route.fulfill(existsSync(file)?{body:readFileSync(file),contentType:'image/webp'}:{status:404});}return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script type="module" src="/stage.js"></script>'});});
 await page.goto(origin);await page.waitForFunction(()=>window.h?.surface.diagnostics().frames>0);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:960});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  for(let n=2;n<=6;n++)for(const self of [null,...Array.from({length:n},(_,i)=>i)]){
   await page.evaluate(({n,self})=>h.set(n,self),{n,self});const labels=await page.evaluate(()=>__seatNames());assert.equal(labels.length,n-(self===null?0:1));
   for(const a of labels){assert.ok(a.left>=0&&a.top>=0&&a.right<=width&&a.bottom<=(width===390?844:960),`${n}/${self}: ${a.id} is visible`);for(const b of labels)if(a!==b)assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,`${n}/${self}: ${a.id}/${b.id} nameplates overlap`);}
   if(self===0&&[5,6].includes(n))await page.screenshot({path:join(out,`seats-${n}-${width}.png`)});
  }
 }
 checks.push('Actual WebGL nameplanes are visible and non-overlapping at 1440/390px for 2–6 players and every viewpoint, with long Latin/Chinese names');await page.close();
 const room={version:1,id:'a'.repeat(32),joinKey:'b'.repeat(64)},channel='workbench-panel-frame/v1';
 for(const mode of ['standalone','suite'])for(const owner of [true,false]){
  const member=owner?'s0':'s1',state=createGame({id:'completed-test',seed:7341,seats:Array.from({length:5},(_,i)=>({id:'s'+i,name:'玩家 '+i}))});state.stage='ended';state.winners=['s0'];
  const wire={actionReceiptVersion:1,table:{version:1,id:room.id,hostPlayerId:'s0',hostConnectionId:'server',hostName:'玩家 0',stage:'ended',revision:0,seats:state.seats.map(s=>({playerId:s.id,seatId:s.id,name:s.name}))},selfPlayerId:member,isHost:owner,role:'PLAYER',connected:true,pending:false,game:packSeat(projectSeat(state,member))};
  const publicWire={...wire,table:{...wire.table,seats:wire.table.seats.filter(s=>s.playerId!==member)},game:packPublic(projectPublic(state))};
  const actor=await browser.newContext({viewport:{width:owner?1440:390,height:owner?960:844},reducedMotion:'reduce'});
  await actor.addInitScript(({room,wire,member})=>{
   localStorage.setItem('three-dragon-ante/language','zh');localStorage.setItem('three-dragon-server-session:'+room.id+':'+member,JSON.stringify({roomId:room.id,memberId:member,token:'c'.repeat(64),role:'PLAYER',owner:wire.isHost}));
   class Socket extends EventTarget{static OPEN=1;readyState=0;bufferedAmount=0;constructor(){super();window.__socket=this;this.messages=[];queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}receive(value){this.onmessage?.({data:JSON.stringify(value)});}send(text){const m=JSON.parse(text);this.messages.push(m);if(m.type==='auth')this.receive({type:'view',seq:1,view:wire});}close(){this.readyState=3;this.onclose?.();}}
   window.WebSocket=Socket;
  },{room,wire,member});
  const p=await actor.newPage();p.on('pageerror',e=>errors.push(mode+': '+String(e)));
  const roots={'/three-dragon-ante-dev/':resolve('extensions/three-dragon-ante/dist'),'/suite-dev/':resolve('dist-workbench-dev')};
  await p.route(origin+'/**',route=>{
   const pathname=new URL(route.request().url()).pathname,prefix=Object.keys(roots).find(k=>pathname.startsWith(k));
   if(prefix){const file=resolve(roots[prefix],pathname.slice(prefix.length));if(!file.replaceAll('\\','/').startsWith(roots[prefix].replaceAll('\\','/')+'/')||!existsSync(file))return route.fulfill({status:404});return route.fulfill({body:readFileSync(file),contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});}
   const embedded=mode==='suite',source=embedded?'/suite-dev/workbench-panels/table.html':'/three-dragon-ante-dev/index.html?obrref='+Buffer.from(origin+' fixture-room').toString('base64');
   return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}iframe{width:100%;height:100%;border:0}</style><script>
   const embedded=${embedded},channel=${JSON.stringify(channel)},wire=${JSON.stringify(wire)},room=${JSON.stringify(room)},member=${JSON.stringify(member)};function send(value){document.querySelector('iframe').contentWindow.postMessage(value,location.origin)};
   addEventListener('message',event=>{if(event.source!==document.querySelector('iframe').contentWindow)return;const m=event.data;let method=m.method,args=m.args||[],field;const map={OBR_ROOM_GET_METADATA:['room.getMetadata','metadata'],OBR_PLAYER_GET_ID:['player.getId','id'],OBR_PLAYER_GET_NAME:['player.getName','name'],OBR_PLAYER_GET_ROLE:['player.getRole','role'],OBR_PLAYER_GET_CONNECTION_ID:['player.getConnectionId','connectionId'],OBR_PARTY_GET_PLAYERS:['party.getPlayers','players'],OBR_BROADCAST_SEND_MESSAGE:['broadcast.sendMessage']};if(!embedded){const spec=map[m.id];if(!spec)return;[method,field]=spec;}let result;if(method==='init')result={roomId:'fixture-room',playerId:member,preferences:{}};else if(method==='room.getMetadata')result={'com.fullpeople/three-dragon-ante/server-v1':room};else if(method==='player.getId')result=member;else if(method==='player.getName')result='玩家';else if(method==='player.getRole')result='PLAYER';else if(method==='player.getConnectionId')result='connection-'+member;else if(method==='party.getPlayers')result=[];send(embedded?{channel,id:m.id,result}:{id:m.id+'_RESPONSE'+m.nonce,data:field?{[field]:result}:{}});});
   </script><iframe src="${source}" onload="${embedded?'':"send({id:'OBR_READY',data:{ref:'fixture',userId:member}})"}"></iframe>`});
  });
  await p.goto(origin+'/host');const frame=p.frames().find(f=>f.parentFrame());await frame.getByRole('button',{name:'离开座位',exact:true}).waitFor();
  await frame.waitForFunction(()=>document.getElementById('table-app')?.dataset.renderer==='webgl');
  const leave=frame.getByRole('button',{name:'离开座位',exact:true});
  const reachability=await leave.evaluate(button=>{const rect=button.getBoundingClientRect(),toolbar=document.getElementById('toolbar').getBoundingClientRect(),dock=document.querySelector('.player-dock').getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return{renderer:document.getElementById('table-app').dataset.renderer,viewport:{width:innerWidth,height:innerHeight},button:rect.toJSON(),toolbar:toolbar.toJSON(),dock:dock.toJSON(),hit:hit?.outerHTML.slice(0,300),clickable:!!hit&&button.contains(hit)};});
  const endControls=await frame.evaluate(()=>[...document.querySelectorAll('.table-header button,#toolbar button')].filter(button=>!button.disabled&&button.getBoundingClientRect().width>0).map(button=>{const rect=button.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return{text:button.textContent,clickable:!!hit&&button.contains(hit)};}));
  writeFileSync(join(out,`${mode}-${owner?'owner':'guest'}-ended-hit.json`),JSON.stringify({...reachability,endControls},null,2));
  await p.screenshot({path:join(out,`${mode}-${owner?'owner':'guest'}-ended.png`)});
  assert.equal(reachability.clickable,true,'completed-game Leave must be a real unobstructed pointer target');
  assert.ok(endControls.every(control=>control.clickable),'all visible enabled end-screen controls must remain unobstructed');
  if(reachability.dock.height>0)assert.ok(reachability.toolbar.bottom<=reachability.dock.top,'ended controls occupy a row clear of the hand dock');
  await leave.click();assert.equal(await frame.locator('#lobby').isVisible(),true,'main screen visible while ACK is deliberately withheld');assert.equal(await frame.locator('#stage-host').isVisible(),false);assert.deepEqual(await frame.evaluate(()=>window.__socket.messages.filter(m=>m.type==='command').map(m=>m.command.type)),['leave'],'exit must not reset or delete the room');
  await frame.evaluate(publicWire=>{const socket=window.__socket;socket.receive({type:'view',seq:2,view:publicWire});socket.receive({type:'ack',id:socket.messages.findLast(m=>m.type==='command').id,ok:true});},publicWire);
  await frame.getByRole('button',{name:'加入牌桌',exact:true}).waitFor();assert.equal(await frame.locator('#lobby').isVisible(),true);
  await p.screenshot({path:join(out,`${mode}-${owner?'owner':'guest'}-left.png`)});await p.reload();const reopened=p.frames().find(f=>f.parentFrame());await reopened.waitForFunction(()=>window.__socket?.messages.some(m=>m.type==='auth'));await reopened.locator('#lobby').waitFor({state:'visible'});assert.equal(await reopened.locator('#stage-host').isVisible(),false);
  checks.push(`${mode} ${owner?'owner':'guest'} production entry: Leave shows main screen before ACK and remains there after refresh`);await actor.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(out,'results.json'),JSON.stringify({passed:true,checks,errors,scope:'Synthetic transport/identity; actual entry bundles and WebGL rendering. No live room or player data.'},null,2));console.log(checks.join('\n'));
}catch(error){writeFileSync(join(out,'results.json'),JSON.stringify({passed:false,error:String(error),checks,errors},null,2));throw error;}
finally{await context.tracing.stop({path:join(out,'trace.zip')});await browser.close();}
