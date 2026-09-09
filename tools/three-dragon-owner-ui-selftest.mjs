// Actual controller + SDK adapter + UI in independent iframe documents.
// Only room/SDK delivery is simulated. WebCrypto and IndexedDB are native.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),base=join(root,'extensions/three-dragon-ante/src/game');
const out=mkdtempSync(join(tmpdir(),'tda-owner-ui-'));
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE??'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sourceFiles=['controller.ts','controller-platform.ts','controller-validation.ts','ui.ts','text.ts','protocol.ts','private-channel.ts','store.ts','wire.ts','rules/engine.ts','rules/projection.ts','style.css','stage-ui.css','power-presentation.ts','power-presentation.css'];
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sourcePins=Object.fromEntries(sourceFiles.map(f=>[f,sha(join(base,f))]));
const ref=p=>JSON.stringify(resolve(root,p).replaceAll('\\','/'));
const entry=`import{TableController}from ${ref('extensions/three-dragon-ante/src/game/controller.ts')};
import{TableStore}from ${ref('extensions/three-dragon-ante/src/game/store.ts')};
import{mountTableUI}from ${ref('extensions/three-dragon-ante/src/game/ui.ts')};
import{ControllerRoom}from ${ref('tools/fixtures/three-dragon-controller-room.ts')};
const w=window as any;
const original=HTMLCanvasElement.prototype.getContext;
(HTMLCanvasElement.prototype as any).getContext=function(type,...args){if(type==='webgl'||type==='webgl2'||type==='experimental-webgl')return null;return Reflect.apply(original,this,[type,...args])};
if(window===window.parent){
 const room=new ControllerRoom();room.roomId='owner-ui-'+crypto.randomUUID();
 w.ownerUI={room,specs:{},clients:{},commands:[],storage:[],sdkWrites:[],roleReads:[],
  port(connection){let p=room.ports.get(connection);if(!p){const spec=this.specs[connection];p=room.port(spec.id,connection);p.member={...p.member,name:spec.name,role:spec.role};room.membersChanged()}return p},
  add(spec){this.specs[spec.connection]=spec;const iframe=document.createElement('iframe');iframe.id=spec.connection;iframe.title=spec.connection;iframe.src='/client?connection='+spec.connection;iframe.hidden=true;document.body.append(iframe)},
  show(connection){for(const frame of document.querySelectorAll('iframe'))frame.hidden=frame.id!==connection},
  async stop(){for(const client of Object.values(this.clients) as any[]){await client.controller.stop();client.surface.destroy()}}
 };
 for(const spec of [{id:'player-creator',connection:'owner',name:'松岚',role:'PLAYER'},{id:'player-friend',connection:'friend',name:'Bram',role:'PLAYER'}])w.ownerUI.add(spec);
 w.ownerUI.show('owner');
}else{
 const shared=(window.parent as any).ownerUI,connection=new URLSearchParams(location.search).get('connection')!;
 let surface:ReturnType<typeof mountTableUI>;
 const realStore=new TableStore(),storage={
  async load(room,table){shared.storage.push({connection,type:'load'});return realStore.load(room,table)},
  async save(value,expected){shared.storage.push({connection,type:'save',expected});return realStore.save(value,expected)},
  close(){return realStore.close()}
 };
 const controller=new TableController(view=>surface?.update(view),{storage,creationSettleMs:20,retryMs:150,heartbeatMs:1000,timeoutMs:15000});
 surface=mountTableUI(document.querySelector('#app')!,{language:'en',send:async command=>{shared.commands.push({connection,command:structuredClone(command)});if(command.type==='close'){surface.destroy();return}await controller.command(command)}});
 shared.clients[connection]={controller,surface,ready:false};
 await controller.start();shared.clients[connection].ready=true;
}
`;
// Exercise sdkTablePlatform itself: its getId/getConnectionId/getName and
// metadata/broadcast callbacks use this exact SDK-shaped boundary.
const sdk=`
const shared=()=>window.parent.ownerUI;
const connection=()=>new URLSearchParams(location.search).get('connection');
const port=()=>shared().port(connection());
const key='com.fullpeople/three-dragon-ante/table',channel='com.fullpeople/three-dragon-ante/network';
export default{
 room:{get id(){return port().roomId},async getMetadata(){return{[key]:await port().readTable()}},async setMetadata(meta){if(Object.keys(meta).join()!==key)throw Error('unexpected metadata write');shared().sdkWrites.push({connection:connection(),value:structuredClone(meta[key])});await port().writeTable(meta[key])},onMetadataChange(fn){return port().onTable(value=>fn({[key]:value}))}},
 player:{async getId(){return port().member.id},async getConnectionId(){return port().member.connectionId},async getName(){return port().member.name},async getRole(){shared().roleReads.push(connection());return port().member.role},onChange(fn){return port().onSelf(fn)}},
 party:{getPlayers(){return port().players()},onChange(fn){return port().onPlayers(fn)}},
 broadcast:{async sendMessage(name,value,options){if(name!==channel||options?.destination!=='REMOTE')throw Error('unexpected network scope');await port().send(value)},onMessage(name,fn){if(name!==channel)throw Error('unexpected network subscription');return port().onMessage((data,connectionId)=>fn({data,connectionId}))}}
};`;
await build({input:'owner-ui-entry',platform:'browser',plugins:[{name:'owner-ui-sdk-boundary',resolveId(id){if(id==='owner-ui-entry')return '\0owner-ui.ts';if(id==='@owlbear-rodeo/sdk')return '\0owner-sdk';if(id.endsWith('.css'))return '\0style'},load(id){if(id==='\0owner-ui.ts')return entry;if(id==='\0owner-sdk')return sdk;if(id==='\0style')return ''}}],output:{file:join(out,'app.js'),format:'esm',codeSplitting:false},logLevel:'silent'});
const css=['style.css','stage-ui.css','power-presentation.css'].map(f=>readFileSync(join(base,f),'utf8')).join('\n');
const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(readFileSync(join(out,'app.js')))}res.setHeader('Content-Type','text/html;charset=utf-8');res.end(url.pathname==='/client'?`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main id="app"></main><script type="module" src="/app.js"></script></html>`:'<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}iframe{width:100vw;height:100dvh;border:0;display:block}iframe[hidden]{display:none}</style><script type="module" src="/app.js"></script></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'msedge'}),checks=[],errors=[],requests=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
const page=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:'reduce'});
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const frame=id=>page.frameLocator('#'+id);
const show=async id=>{await page.evaluate(id=>ownerUI.show(id),id);return frame(id)};
const view=id=>page.evaluate(id=>ownerUI.clients[id].controller.view,id);
const ready=ids=>page.waitForFunction(ids=>ids.every(id=>ownerUI.clients[id]?.ready&&ownerUI.clients[id].controller.view.connected&&!ownerUI.clients[id].controller.view.pending),ids,{timeout:15000});
const noOwnerControls=async id=>{const texts=await frame(id).locator('#toolbar button').allTextContents();return !texts.some(t=>['Start game','开始游戏','Prepare new game','准备新局'].includes(t))};
async function resetVia(id){await show(id);await frame(id).getByRole('button',{name:'Prepare new game',exact:true}).click();await frame(id).locator('#confirm-reset').click();await page.waitForFunction(()=>Object.values(ownerUI.clients).every(c=>!c.controller.view.game&&c.controller.view.table?.stage==='lobby'));await ready(Object.keys(await page.evaluate(()=>ownerUI.clients)).filter(Boolean))}
async function inspectLayout(id,language,width,label){
 await show(id);await page.setViewportSize({width,height:820});await page.evaluate(({id,language})=>ownerUI.clients[id].surface.language(language),{id,language});
 await frame(id).locator('#lobby').scrollIntoViewIfNeeded();
 const metrics=await frame(id).locator('body').evaluate(()=>{const nodes=[...document.querySelectorAll('#toolbar button,#close,.seat-chips>span')];return{width:innerWidth,scroll:document.documentElement.scrollWidth,items:nodes.map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,x:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}),lobby:document.querySelector('#lobby').textContent}});
 check(`${label}/${language}/${width}: visible controls and identity chips fit width`,metrics.scroll<=width+1&&metrics.items.every(m=>m.width>0&&m.x>=-1&&m.right<=width+1));
 check(`${label}/${language}/${width}: creator badge names creator, not room role`,metrics.lobby.includes(language==='zh'?'牌桌创建者':'Table creator')&&!metrics.lobby.includes(language==='zh'?'主持人':'Host'));
 const creator=await frame(id).locator('.seat-chips>span').filter({hasText:'松岚'}).innerText();
 check(`${label}/${language}/${width}: creator marker stays on original player name`,creator.includes(language==='zh'?'牌桌创建者':'Table creator')&&(id==='owner-second'?creator.includes(language==='zh'?'(你)':'(You)'):true));
 await page.screenshot({path:join(out,`${label}-${language}-${width}.png`)});
}
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ownerUI);await ready(['owner','friend']);
 check('both initial SDK players are ordinary PLAYERs and no GM exists',await page.evaluate(()=>[...ownerUI.room.ports.values()].length===2&&[...ownerUI.room.ports.values()].every(p=>p.member.role==='PLAYER')));
 check('ordinary PLAYER sees an enabled Create table button',await frame('owner').getByRole('button',{name:'Create table',exact:true}).isEnabled());
 check('English empty-table copy explicitly needs no DM',(await frame('owner').locator('#lobby').innerText()).includes('Any player can create a table')&&(await frame('owner').locator('#lobby').innerText()).includes('No DM is needed'));
 await page.evaluate(()=>ownerUI.clients.owner.surface.language('zh'));
 check('Chinese empty-table copy explicitly permits any player without DM',(await frame('owner').locator('#lobby').innerText()).includes('任何玩家都可以创建牌桌')&&(await frame('owner').locator('#lobby').innerText()).includes('无需 DM 参与'));
 await frame('owner').getByRole('button',{name:'创建牌桌',exact:true}).click();await ready(['owner','friend']);
 await page.waitForFunction(()=>ownerUI.clients.owner.controller.view.table?.seats.length===1);
 check('PLAYER creation records the real player and original connection',await page.evaluate(()=>{const v=ownerUI.clients.owner.controller.view;return v.isHost&&v.table.hostPlayerId==='player-creator'&&v.table.hostConnectionId==='owner'&&v.table.seats.length===1&&!v.game}));
 check('one seat keeps the creator start button disabled',await frame('owner').getByRole('button',{name:'开始游戏',exact:true}).isDisabled());
 check('one-seat lobby states the two-player minimum',(await frame('owner').locator('#lobby').innerText()).includes('至少两位玩家'));
 await show('friend');check('non-creator PLAYER can only join, not start or reset',await frame('friend').getByRole('button',{name:'Join table',exact:true}).isEnabled()&&await noOwnerControls('friend'));
 await frame('friend').getByRole('button',{name:'Join table',exact:true}).click();await page.waitForFunction(()=>ownerUI.clients.owner.controller.view.table?.seats.length===2);await ready(['owner','friend']);
 check('seated non-creator has Leave but still no start or new-game controls',await frame('friend').getByRole('button',{name:'Leave seat',exact:true}).count()===1&&await noOwnerControls('friend'));
 check('non-creator waiting copy names the table creator',(await frame('friend').locator('#lobby').innerText()).includes('Waiting for the table creator to start'));
 await show('owner');check('two seated PLAYERs enable creator start without any GM',await frame('owner').getByRole('button',{name:'开始游戏',exact:true}).isEnabled());
 check('creator ready copy explicitly offers dealing',(await frame('owner').locator('#lobby').innerText()).includes('你是牌桌创建者，可以点击'));
 await frame('owner').getByRole('button',{name:'开始游戏',exact:true}).click();await page.waitForFunction(()=>['owner','friend'].every(id=>ownerUI.clients[id].controller.view.game?.hand?.length===6));await ready(['owner','friend']);
 const firstGame=(await view('owner')).game.id;
 check('actual UI creates a real game and six private cards for both ordinary players',await page.evaluate(()=>{const a=ownerUI.clients.owner.controller.view,b=ownerUI.clients.friend.controller.view;return a.table.stage==='playing'&&a.game.id===b.game.id&&a.game.selfSeatId!==b.game.selfSeatId&&a.game.hand.length===6&&b.game.hand.length===6}));
 check('non-creator cannot reset the running game',await noOwnerControls('friend'));
 check('SDK adapter never requests GM role to create or start',await page.evaluate(()=>ownerUI.roleReads.length===0));
 await page.evaluate(()=>ownerUI.clients.owner.surface.language('en'));
 await frame('owner').getByRole('button',{name:'Prepare new game',exact:true}).click();await frame('owner').locator('#cancel-reset').click();
 check('cancelling creator reset leaves actual game intact',(await view('owner')).game.id===firstGame);
 await resetVia('owner');check('confirmed creator reset keeps both seats',(await view('owner')).table.seats.length===2);
 await page.evaluate(()=>ownerUI.add({id:'player-gm',connection:'gm',name:'GM Visitor',role:'GM'}));await ready(['owner','friend','gm']);await show('gm');
 check('SDK GM who did not create this table has Join but no host controls',await frame('gm').getByRole('button',{name:'Join table',exact:true}).isEnabled()&&await noOwnerControls('gm')&&!(await view('gm')).isHost);
 await frame('gm').getByRole('button',{name:'Join table',exact:true}).click();await page.waitForFunction(()=>ownerUI.clients.owner.controller.view.table?.seats.length===3);await ready(['owner','friend','gm']);
 check('joining as GM does not acquire start or reset controls',await noOwnerControls('gm')&&!(await view('gm')).isHost);
 await page.evaluate(()=>ownerUI.add({id:'player-creator',connection:'owner-second',name:'松岚',role:'PLAYER'}));await ready(['owner','friend','gm','owner-second']);await show('owner-second');
 check('second connection recognizes creator identity without adding a seat',(await view('owner-second')).isHost&&(await view('owner-second')).table.seats.length===3);
 check('second creator connection can start the same lobby',await frame('owner-second').getByRole('button',{name:'Start game',exact:true}).isEnabled());
 check('second creator copy says they may start, not wait for a host',(await frame('owner-second').locator('#lobby').innerText()).includes('You created this table. Click Start game to deal'));
 for(const language of ['en','zh'])for(const width of [1000,390]){
  await inspectLayout('owner-second',language,width,'creator-second');
  await inspectLayout('gm',language,width,'noncreator-gm');
  check(`GM/${language}/${width}: localization never creates owner controls`,await noOwnerControls('gm'));
 }
 await page.setViewportSize({width:1100,height:900});await show('owner-second');await page.evaluate(()=>ownerUI.clients['owner-second'].surface.language('en'));
 const beforeWrites=await page.evaluate(()=>ownerUI.storage.filter(e=>e.connection==='owner'&&e.type==='save').length);
 await frame('owner-second').getByRole('button',{name:'Start game',exact:true}).click();await page.waitForFunction(()=>Object.values(ownerUI.clients).every(c=>c.controller.view.game?.hand?.length===6));await ready(['owner','friend','gm','owner-second']);
 const secondGame=(await view('owner-second')).game.id;
 check('second creator UI starts via real encrypted controller request',secondGame!==firstGame&&await page.evaluate(()=>ownerUI.commands.some(c=>c.connection==='owner-second'&&c.command.type==='start')));
 check('original connection remains authority and alone writes the game',await page.evaluate(before=>ownerUI.room.table.hostConnectionId==='owner'&&ownerUI.storage.filter(e=>e.connection==='owner'&&e.type==='save').length>before&&ownerUI.storage.filter(e=>e.connection==='owner-second').length===0,beforeWrites));
 check('both creator connections receive the same own seat and same hand',await page.evaluate(()=>{const a=ownerUI.clients.owner.controller.view.game,b=ownerUI.clients['owner-second'].controller.view.game;return a.id===b.id&&a.selfSeatId===b.selfSeatId&&JSON.stringify(a.hand)===JSON.stringify(b.hand)}));
 check('both non-creators remain unable to reset after second-connection start',await noOwnerControls('friend')&&await noOwnerControls('gm'));
 await frame('owner-second').getByRole('button',{name:'Prepare new game',exact:true}).click();
 check('second creator reset still requires visible confirmation',await frame('owner-second').locator('#reset-dialog').evaluate(e=>e.matches(':modal'))&&(await view('owner-second')).game.id===secondGame);
 await frame('owner-second').locator('#cancel-reset').click();check('cancelling second-connection reset sends no reset command',(await view('owner-second')).game.id===secondGame&&await page.evaluate(()=>!ownerUI.commands.some(c=>c.connection==='owner-second'&&c.command.type==='newGame')));
 await resetVia('owner-second');
 check('confirmed remote creator reset returns everyone to lobby without stealing authority',await page.evaluate(()=>Object.values(ownerUI.clients).every(c=>!c.controller.view.game&&c.controller.view.table.hostConnectionId==='owner'&&c.controller.view.table.seats.length===3)&&ownerUI.storage.filter(e=>e.connection==='owner-second').length===0));
 check('no non-creator start or reset command was generated by real UI',await page.evaluate(()=>!ownerUI.commands.some(c=>['friend','gm'].includes(c.connection)&&['start','newGame'].includes(c.command.type))));
 check('all metadata writes stay on the original creator connection',await page.evaluate(()=>ownerUI.sdkWrites.length>0&&ownerUI.sdkWrites.every(e=>e.connection==='owner')));
 const observations=await page.evaluate(()=>({commands:ownerUI.commands,storage:ownerUI.storage,roleReads:ownerUI.roleReads,members:[...ownerUI.room.ports.values()].map(p=>p.member),table:ownerUI.room.table,networkKinds:[...new Set(ownerUI.room.traffic.map(t=>t.value.kind))]}));
 await page.evaluate(()=>ownerUI.stop());check('all controller SDK subscriptions are removed on stop',await page.evaluate(()=>ownerUI.room.listeners===0));
 check('no external request or uncaught browser error',errors.length===0&&requests.every(url=>url.startsWith('http://127.0.0.1:')));
 const afterPins=Object.fromEntries(sourceFiles.map(f=>[f,sha(join(base,f))]));assert.deepEqual(afterPins,sourcePins,'product source stayed fixed through the run');
 const result={scope:'Actual Edge iframe UIs, controller, sdkTablePlatform, rules, native WebCrypto and IndexedDB. SDK room/membership/message delivery is controlled. DOM fallback selected by WebGL capability; no GPU or real Owlbear host/multiplayer UAT claimed.',passed:checks.length,checks,sourcePins,toolSHA256:sha(import.meta.filename),compiledSHA256:sha(join(out,'app.js')),browser:browser.version(),observations,errors};
 writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,out,sourcePins}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,sourcePins,errors},null,2));await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw new Error('Owner UI verification failed: '+out,{cause:error})}
finally{await page.evaluate(()=>window.ownerUI?.stop()).catch(()=>{});await browser.close();await new Promise(r=>server.close(r));}
