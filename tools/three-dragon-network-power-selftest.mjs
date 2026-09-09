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
const out=mkdtempSync(join(tmpdir(),'tda-network-power-'));
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE??'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sourceFiles=['controller.ts','controller-platform.ts','controller-validation.ts','ui.ts','text.ts','protocol.ts','private-channel.ts','store.ts','wire.ts','rules/engine.ts','rules/projection.ts','style.css','stage-ui.css','power-presentation.ts','power-presentation.css','power-sequence.ts','local-view.ts'];
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sourcePins=Object.fromEntries(sourceFiles.map(f=>[f,sha(join(base,f))]));
const mutant=process.argv.find(a=>a.startsWith('--mutant='))?.slice(9);
const mutations={sync:{file:'/game/controller.ts',from:'      syncing,',to:'      syncing: false,',failure:'dealer, remote seat and public spectator all show a network-triggered power'},gap:{file:'/game/power-sequence.ts',from:'after.revision<=before.revision',to:'after.revision!==before.revision+1',failure:'new public events survive a coalesced LOCAL revision jump'}};
if(mutant)assert.ok(mutations[mutant],'known network power mutant');
let mutated=false;
const ref=p=>JSON.stringify(resolve(root,p).replaceAll('\\','/'));
const entry=`import{TableController}from ${ref('extensions/three-dragon-ante/src/game/controller.ts')};
import{TableStore}from ${ref('extensions/three-dragon-ante/src/game/store.ts')};
import{mountTableUI}from ${ref('extensions/three-dragon-ante/src/game/ui.ts')};
import{ControllerRoom}from ${ref('tools/fixtures/three-dragon-controller-room.ts')};
import{localViewParts,LocalViewReceiver}from ${ref('extensions/three-dragon-ante/src/game/local-view.ts')};
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
 let surface:ReturnType<typeof mountTableUI>,sequence=0,latest;
 const receiver=new LocalViewReceiver(connection),views=[];
 const deliver=view=>{latest=view;views.push(structuredClone(view));if(shared.clients[connection]?.hold)return;
  for(const packet of localViewParts(view,connection,++sequence)){const accepted=receiver.receive(packet);if(accepted)surface?.update(accepted)}
 };
 const realStore=new TableStore(),storage={
  async load(room,table){shared.storage.push({connection,type:'load'});return realStore.load(room,table)},
  async save(value,expected){shared.storage.push({connection,type:'save',expected});return realStore.save(value,expected)},
  close(){return realStore.close()}
 };
 const controller=new TableController(deliver,{storage,creationSettleMs:20,retryMs:150,heartbeatMs:1000,timeoutMs:15000});
 surface=mountTableUI(document.querySelector('#app')!,{language:'en',send:async command=>{shared.commands.push({connection,command:structuredClone(command)});if(command.type==='close'){surface.destroy();return}await controller.command(command)}});
 shared.clients[connection]={controller,surface,views,hold:false,flush(){deliver(latest)},ready:false};
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
await build({input:'owner-ui-entry',platform:'browser',plugins:[{name:'owner-ui-sdk-boundary',resolveId(id){if(id==='owner-ui-entry')return '\0owner-ui.ts';if(id==='@owlbear-rodeo/sdk')return '\0owner-sdk';if(id.endsWith('.css'))return '\0style'},load(id){if(id==='\0owner-ui.ts')return entry;if(id==='\0owner-sdk')return sdk;if(id==='\0style')return ''},transform(code,id){if(!mutant||!id.replaceAll('\\','/').endsWith(mutations[mutant].file))return;const m=mutations[mutant];assert.equal(code.split(m.from).length,2);mutated=true;return code.replace(m.from,m.to)}}],output:{file:join(out,'app.js'),format:'esm',codeSplitting:false},logLevel:'silent'});
if(mutant)assert.ok(mutated,'mutation applied before execution');
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

const ids=['owner','friend','observer'];
async function allReady(){await ready(ids)}
async function move(player,move){
 await page.evaluate(async({player,move})=>{const c=ownerUI.clients[player].controller,g=c.view.game;
  await c.command({type:'action',action:{id:crypto.randomUUID(),revision:g.revision,seatId:g.selfSeatId,...move}});
 },{player,move});await allReady();
}
async function dismiss(id){await show(id);const overlay=frame(id).locator('.power-overlay');let count=0;while(await overlay.isVisible()){await overlay.press('Enter');if(++count>64)throw Error('unbounded overlay queue')}return count}
async function begin(){
 if((await view('owner')).game){await page.evaluate(()=>ownerUI.clients.owner.controller.command({type:'newGame'}));await allReady()}
 await page.evaluate(()=>ownerUI.clients.owner.controller.command({type:'start'}));await allReady();
 const pair=await page.evaluate(()=>{const a=ownerUI.clients.owner.controller.view.game.hand,b=ownerUI.clients.friend.controller.view.game.hand;for(const x of a)for(const y of b)if(x.strength!==y.strength)return[x.id,y.id];throw Error('No unequal antes')});
 await move('owner',{kind:'ante',cardId:pair[0]});await move('friend',{kind:'ante',cardId:pair[1]});
 check('actual network game reaches first play after unequal antes',(await view('owner')).game.phase==='play');
}
async function playNext(){
 const next=await page.evaluate(()=>{for(const id of ['owner','friend']){const g=ownerUI.clients[id].controller.view.game,a=g.actions[0];if(a)return{id,move:a.kind==='choose'?{kind:'choose',choiceId:a.choice.id,optionIds:a.choice.options.slice(0,a.choice.min).map(o=>o.id)}:{kind:a.kind,cardId:a.cardIds[0]}}}throw Error('No legal move')});
 await move(next.id,next.move);return next;
}
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ownerUI);await ready(['owner','friend']);
 await page.evaluate(()=>ownerUI.clients.owner.controller.command({type:'create'}));await ready(['owner','friend']);
 await page.evaluate(()=>ownerUI.clients.friend.controller.command({type:'join'}));await ready(['owner','friend']);
 await page.evaluate(()=>ownerUI.add({id:'public-observer',connection:'observer',name:'Observer',role:'PLAYER'}));await allReady();
 await begin();const first=await playNext();
 check('dealer, remote seat and public spectator all show a network-triggered power',await page.evaluate(()=>Object.values(ownerUI.clients).every(c=>c.surface.presentationBusy())));
 check('real controller emits transient syncing snapshots for dealer and recipient',await page.evaluate(()=>['owner','friend'].every(id=>ownerUI.clients[id].views.some(v=>v.syncing&&!v.connected))));
 for(const id of ids){await show(id);check(id+' displays actual card name and full description',await frame(id).locator('.power-card-name').innerText()===await frame(id).locator('.power-copy h2').innerText()&&(await frame(id).locator('.power-description').innerText()).length>20)}
 await page.waitForTimeout(1700);check('network introduction does not close after 1.5 seconds',await page.evaluate(()=>Object.values(ownerUI.clients).every(c=>c.surface.presentationBusy())));
 await dismiss('observer');check('spectator click only dismisses their own introduction',await page.evaluate(()=>!ownerUI.clients.observer.surface.presentationBusy()&&ownerUI.clients.owner.surface.presentationBusy()&&ownerUI.clients.friend.surface.presentationBusy()));
 for(const id of ['owner','friend'])await dismiss(id);
 await page.evaluate(()=>Object.values(ownerUI.clients).forEach(c=>c.flush()));
 check('duplicate LOCAL snapshots do not replay an acknowledged effect',await page.evaluate(()=>Object.values(ownerUI.clients).every(c=>!c.surface.presentationBusy())));
 await begin();const baseline=(await view('observer')).game.revision;
 await page.evaluate(()=>ownerUI.clients.observer.hold=true);
 await playNext();for(const id of ['owner','friend'])await dismiss(id);
 await playNext();
 check('coalescing fixture skips at least one real game revision',(await view('observer')).game.revision>=baseline+2);
 check('held spectator page has not displayed undelivered powers',!await page.evaluate(()=>ownerUI.clients.observer.surface.presentationBusy()));
 await page.evaluate(()=>{const c=ownerUI.clients.observer;c.hold=false;c.flush()});
 check('new public events survive a coalesced LOCAL revision jump',await page.evaluate(()=>ownerUI.clients.observer.surface.presentationBusy()));
 await show('observer');await page.screenshot({path:join(out,'spectator-network-power.png')});
 const savedPort=await page.evaluate(()=>{ownerUI.oldPort=ownerUI.room.ports.get('owner');ownerUI.room.remove('owner');return true});
 await page.waitForFunction(()=>!ownerUI.clients.observer.controller.view.connected);
 check('actual authority departure clears the spectator introduction',!await page.evaluate(()=>ownerUI.clients.observer.surface.presentationBusy()));
 check('authority departure is not labelled as transient synchronization',!(await view('observer')).syncing);
 await page.evaluate(()=>{ownerUI.room.ports.set('owner',ownerUI.oldPort);ownerUI.room.membersChanged()});await allReady();
 check('a real transport re-handshake does not replay missed history',!await page.evaluate(()=>ownerUI.clients.observer.surface.presentationBusy()));
 const observations=await page.evaluate(()=>({views:Object.fromEntries(Object.entries(ownerUI.clients).map(([id,c])=>[id,c.views.map(v=>({connected:v.connected,syncing:v.syncing,revision:v.game?.revision,events:v.game?.events?.filter(e=>e.code==='POWER_TRIGGERED')}))])),networkKinds:[...new Set(ownerUI.room.traffic.map(t=>t.value.kind))]}));
 await page.evaluate(()=>ownerUI.stop());check('cleanup removes actual controller subscriptions',await page.evaluate(()=>ownerUI.room.listeners===0));
 check('no uncaught browser errors',errors.length===0);
 assert.deepEqual(Object.fromEntries(sourceFiles.map(f=>[f,sha(join(base,f))])),sourcePins);
 if(mutant)throw Error('Mutation survived');
 writeFileSync(join(out,'result.json'),JSON.stringify({passed:checks.length,checks,sourcePins,errors,observations,scope:'Actual controllers, SDK adapter, private WebCrypto, IndexedDB, LOCAL codec and DOM UI; simulated Owlbear room service. No native room UAT claim.'},null,2));console.log(JSON.stringify({passed:checks.length,out}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,sourcePins,errors},null,2));if(mutant&&error.code==='ERR_ASSERTION'&&error.message===mutations[mutant].failure){writeFileSync(join(out,'mutation-result.json'),JSON.stringify({mutant,killed:true,assertion:error.message}));console.log('KILL '+mutant+': '+out)}else throw new Error('Network power verification failed: '+out,{cause:error})}
finally{await page.evaluate(()=>window.ownerUI?.stop()).catch(()=>{});await browser.close();await new Promise(r=>server.close(r))}
