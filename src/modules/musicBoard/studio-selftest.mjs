// Real module + real control DOM + real WebAudio in sibling iframes under a
// different-origin parent. SDK is a message/storage boundary fixture, not a room.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { rolldown } from "rolldown";
const freshMode=process.argv.includes("--fresh-full"), rejectAdoption=process.argv.includes("--reject-adoption");
const out = mkdtempSync(join(tmpdir(), "music-studio-sync-"));
for (const [entry, name] of [["src/modules/musicBoard/index.ts","background"],["src/music-board-page.ts","page"]]) {
  const build = await rolldown({ input: resolve(entry), platform: "browser", plugins: [{ name: "fixture-boundaries",
    resolveId(source) {
      if (source === "@owlbear-rodeo/sdk") return "mock:sdk";
      if (source.endsWith("/state")) return "mock:state";
      if (source.endsWith("/asset-base")) return "mock:asset";
      if (source.endsWith("/viewportAnchor")) return "mock:viewport";
      if (source.endsWith("/panelLayout")) return "mock:layout";
      if (source.endsWith("/panelDrag")) return "mock:drag";
      if (source.endsWith(".css")) return "mock:css";
    },
    load(id) {
      if (id === "mock:sdk") return "export default globalThis.__MUSIC_SDK__;";
      if (id === "mock:state") return "export const getLocalLang=()=>localStorage.getItem('obr-suite/lang')||'zh';export const onLangChange=()=>()=>{};";
      if (id === "mock:asset") return "export const assetUrl=x=>x;";
      if (id === "mock:viewport") return "export const onViewportResize=()=>()=>{};";
      if (id === "mock:layout") return "export const PANEL_IDS={musicBoard:'music-board'};export const getPanelOffset=()=>({dx:0,dy:0});export const registerPanelBbox=()=>{};export const BC_PANEL_DRAG_END='drag-end';export const BC_PANEL_RESET='reset';";
      if (id === "mock:drag") return "export const bindPanelDrag=()=>{};";
      if (id === "mock:css") return "";
    },
  }] }); await build.write({ file: join(out, name + ".js"), format: "esm" }); await build.close();
}
function installFixture(fresh = false, reject = false) {
  const callbacks = new Map();
  const on = (key, fn) => { if (!callbacks.has(key)) callbacks.set(key,new Set()); callbacks.get(key).add(fn); return ()=>callbacks.get(key).delete(fn); };
  const emit = (key,value)=>{window.fixture?.events.push({key,value});for(const fn of [...(callbacks.get(key)||[])]) fn(value);};
  const channel = new BroadcastChannel("music-integration"), send=(key,data)=>{emit(key,{data,connectionId:"test"});channel.postMessage({key,data});};
  channel.onmessage=event=>emit(event.data.key,{data:event.data.data,connectionId:"test"});
  window.addEventListener("message",event=>{if(event.data?.kind==="toggle")emit("com.obr-suite/music-board:toggle",{data:{},connectionId:"test"});});
  const track={id:"one",url:location.origin+"/tone.wav",name:"月下的旅人 · The Moonlit Road",bus:"bgm",loop:true,duration:60};
  const state={version:2,revision:1,author:"test",allowPlayers:true,tracks:[track,{...track,id:"two",name:"Silent City",url:location.origin+"/tone.wav?two"}],queue:["two"],bgm:{track:{...track,loop:true,duration:60},playbackId:"first",position:0,startedAt:Date.now(),paused:false},sfx:[],bus:{bgm:.8,sfx:1},recent:[],ts:Date.now()};
  const metadata=fresh?{unrelatedExtension:"x".repeat(15800)}:{"com.obr-suite/music-board:session":state};
  const sceneMetadata={unrelatedScene:{keep:true}};
  window.fixture={metadata,sceneMetadata,sceneWrites:0,writes:0,voices:[],contexts:[],events:[],role:"GM"};
  const NativeAudio=window.Audio; window.Audio=function(url){const voice=new NativeAudio(url);fixture.voices.push(voice);return voice;};
  const NativeContext=window.AudioContext;window.AudioContext=class extends NativeContext{constructor(){super();fixture.contexts.push(this);}};
  window.__MUSIC_SDK__={
    onReady:fn=>queueMicrotask(fn), player:{getId:async()=>"gm",getConnectionId:async()=>"test",getRole:async()=>fixture.role,onChange:fn=>on("player",fn)},
    party:{getPlayers:async()=>[],onChange:fn=>on("party",fn)},
    room:{id:"music-browser-room",getMetadata:async()=>structuredClone(metadata),setMetadata:async patch=>{fixture.writes++;Object.assign(metadata,structuredClone(patch));emit("metadata",structuredClone(metadata));},onMetadataChange:fn=>on("metadata",fn)},
    scene:{isReady:async()=>true,getMetadata:async()=>structuredClone(sceneMetadata),onReadyChange:fn=>on("scene-ready",fn),onMetadataChange:fn=>on("scene-meta",fn),setMetadata:async patch=>{if(reject)throw Error("scene quota exceeded");fixture.sceneWrites++;Object.assign(sceneMetadata,structuredClone(patch));emit("scene-meta",structuredClone(sceneMetadata))}},
    viewport:{getWidth:async()=>900,getHeight:async()=>760},
    broadcast:{sendMessage:async(key,data)=>send(key,data),onMessage:on},
    popover:{open:async args=>{parent.postMessage({kind:"open",url:args.url,width:args.width,height:args.height},"*");},close:async()=>{parent.postMessage({kind:"close"},"*");}},
    notification:{show:async text=>{fixture.notice=text;}},
  };
}
const css=readFileSync(resolve("src/modules/musicBoard/style.css"),"utf8");
const pageHtml=readFileSync(resolve("music-board.html"),"utf8").replace('./src/music-board-page.ts','/page.js').replace("</head>","<style>"+css+"</style><script>("+installFixture.toString()+")("+freshMode+","+rejectAdoption+");</script></head>");
const samples=44100*60,wav=Buffer.alloc(44+samples*2);
wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/44100)*1800),44+i*2);
function studioFixture() {
  window.fixture={voices:[],contexts:[],gains:[]};
  const AudioNative=window.Audio; window.Audio=function(url){const a=new AudioNative(url);fixture.voices.push(a);return a;};
  const ContextNative=window.AudioContext;window.AudioContext=class extends ContextNative{constructor(){super();fixture.contexts.push(this);}createGain(){const gain=super.createGain();fixture.gains.push(gain);return gain;}};
}
const studioBase=resolve("tools/music-studio");
const studioHtml=readFileSync(join(studioBase,"index.html"),"utf8").replace("</head>","<script>("+studioFixture.toString()+")();</script></head>");
const peerModule=`
const bus=new BroadcastChannel('music-studio-peer-test');
const peers=new Map();globalThis.peerFixture={sent:[],received:[],connections:[],dropAcks:0};
class Emitter{handlers=new Map();on(k,f){if(!this.handlers.has(k))this.handlers.set(k,[]);this.handlers.get(k).push(f);}emit(k,v){for(const f of this.handlers.get(k)||[])f(v);}}
class Connection extends Emitter{open=false;constructor(owner,remote,id){super();this.owner=owner;this.peer=remote;this.id=id;peerFixture.connections.push(this);}send(data){peerFixture.sent.push(structuredClone(data));if(data.type==='studio-ack'&&peerFixture.dropAcks>0){peerFixture.dropAcks--;return;}bus.postMessage({kind:'data',target:this.peer,source:this.owner.id,id:this.id,data});}close(){if(!this.open)return;this.open=false;bus.postMessage({kind:'close',target:this.peer,source:this.owner.id,id:this.id});this.emit('close');}}
export default class Peer extends Emitter{constructor(id){super();this.id=id||crypto.randomUUID();this.connections=new Map();peers.set(this.id,this);queueMicrotask(()=>this.emit('open',this.id));}connect(remote){const c=new Connection(this,remote,crypto.randomUUID());this.connections.set(c.id,c);bus.postMessage({kind:'connect',target:remote,source:this.id,id:c.id});return c;}destroy(){for(const c of this.connections.values())c.close();peers.delete(this.id);}}
bus.onmessage=({data:m})=>{const p=peers.get(m.target);if(!p)return;if(m.kind==='connect'){const c=new Connection(p,m.source,m.id);p.connections.set(c.id,c);p.emit('connection',c);c.open=true;c.emit('open');bus.postMessage({kind:'accepted',target:m.source,source:p.id,id:m.id});return;}const c=p.connections.get(m.id);if(!c)return;if(m.kind==='accepted'){c.open=true;c.emit('open');}if(m.kind==='data'){peerFixture.received.push(structuredClone(m.data));c.emit('data',m.data);}if(m.kind==='close'){c.open=false;c.emit('close');}};
`;
const child=createServer((request,response)=>{
  response.setHeader("Content-Type","text/html; charset=utf-8");
  if(request.url?.startsWith("/studio/")){
    const name=decodeURIComponent(request.url.split("?")[0].slice(8))||"index.html";
    if(!/^[a-z0-9.-]+$/.test(name)){response.statusCode=404;response.end();return;}
    response.setHeader("Content-Type",name.endsWith("js")?"text/javascript; charset=utf-8":name.endsWith("css")?"text/css; charset=utf-8":"text/html; charset=utf-8");
    response.end(name==="index.html"?studioHtml:readFileSync(join(studioBase,name)));return;
  }
  if(request.url?.startsWith("/tone.wav")){response.setHeader("Content-Type","audio/wav");response.setHeader("Access-Control-Allow-Origin","*");response.setHeader('Accept-Ranges','bytes');const range=/bytes=(\d+)-(\d*)/.exec(request.headers.range||'');if(range){const start=Number(range[1]),end=Math.min(wav.length-1,range[2]?Number(range[2]):wav.length-1);response.statusCode=206;response.setHeader('Content-Range',`bytes ${start}-${end}/${wav.length}`);response.setHeader('Content-Length',end-start+1);response.end(wav.subarray(start,end+1));}else{response.setHeader('Content-Length',wav.length);response.end(wav);}}
  else if(request.url==="/background.js"||request.url==="/page.js"){response.setHeader("Content-Type","text/javascript");response.end(readFileSync(join(out,request.url.slice(1))));}
  else if(request.url==="/background"){response.end('<script>('+installFixture.toString()+')('+freshMode+','+rejectAdoption+');</script><script type="module">import {setupMusicBoard} from "/background.js";await setupMusicBoard();__MUSIC_SDK__.broadcast.sendMessage("com.obr-suite/music-board:toggle",{},{});window.booted=true;</script>');}
  else response.end(pageHtml);
});
async function listenSafe(server){for(let i=0;i<20;i++){try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(20000+Math.floor(Math.random()*30000),'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});return;}catch(error){if(error.code!=='EADDRINUSE')throw error;}}throw Error('No available test port');}
await listenSafe(child);const childUrl="http://127.0.0.1:"+child.address().port;
const host=createServer((request,response)=>response.end('<style>body{background:#334352;font:16px system-ui}iframe{border:0}#control{position:absolute;left:80px;top:70px}</style><button id="reopen">Open music</button><iframe id="background" style="display:none" allow="autoplay" src="'+childUrl+'/background"></iframe><script>document.getElementById("reopen").onclick=()=>document.getElementById("background").contentWindow.postMessage({kind:"toggle"},"'+childUrl+'");window.addEventListener("message",event=>{if(event.origin!=="'+childUrl+'")return;if(event.data.kind==="open"){document.getElementById("control")?.remove();const f=document.createElement("iframe");f.id="control";f.allow="autoplay";f.src="'+childUrl+'/"+event.data.url;f.width=event.data.width;f.height=event.data.height;document.body.append(f);}if(event.data.kind==="close")document.getElementById("control")?.remove();});</script>'));
await listenSafe(host);
const runtime=process.env.CODEX_PLAYWRIGHT_DIR||"C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const{chromium}=await import(pathToFileURL(join(runtime,"index.mjs")).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.BOSS_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies"]});
const context=await browser.newContext({viewport:{width:1200,height:900},deviceScaleFactor:1}),page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(String(error)));

await context.route("https://esm.sh/peerjs@1.5.4",route=>route.fulfill({status:200,contentType:"text/javascript",body:peerModule,headers:{"Access-Control-Allow-Origin":"*"}}));
const checks=[];function ok(name){checks.push(name);console.log("PASS "+name);}
async function freshRoom(){
 await page.goto("http://127.0.0.1:"+host.address().port);await page.locator("#control").waitFor();
 const background=page.frames().find(frame=>frame.url().endsWith('/background')),control=page.frameLocator('#control');
 await background.waitForFunction(()=>window.booted,null,{polling:50});await control.locator('#enable').click();
 if(!rejectAdoption){
  await context.route('https://obr.dnd.center/music/manifest.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tracks:[{id:'default-tone',url:childUrl+'/tone.wav?default',name:'默认曲库测试曲',bus:'bgm',loop:true,duration:60}]})}));
  await control.locator('summary').filter({hasText:'曲库与音效'}).click();await control.locator('#defaults').click();await control.locator('#catalogTracks button').click();
  await background.waitForFunction(()=>fixture.sceneMetadata['com.obr-suite/music-board:room-music-browser-room']?.tracks.length===1,null,{polling:50});
  assert.equal(await background.evaluate(()=>fixture.writes),0);assert.equal(await background.evaluate(()=>fixture.metadata.unrelatedExtension.length),15800);
  ok('default-library add succeeds in an otherwise full room without changing unrelated metadata');
 }
 const studio=await context.newPage();studio.on('pageerror',e=>errors.push(String(e)));await studio.goto(childUrl+'/studio/');await studio.waitForFunction(()=>fixture.voices.length===5);
 await studio.locator('#addUrlBtn').click();await studio.locator('#urlInput').fill(childUrl+'/tone.wav?fresh');await studio.locator('#urlName').fill('Fresh Studio track');await studio.locator('#urlAddBtn').click();await studio.locator('.lib-card').filter({hasText:'Fresh Studio track'}).dblclick();
 await studio.waitForFunction(()=>!fixture.voices[0].paused&&fixture.voices[0].currentTime>0);
 await studio.locator('#pairBtn').click();await studio.locator('#pairCodeValue').filter({hasText:/[A-Z2-9]{6}/}).waitFor();
 await control.locator('summary').filter({hasText:'网页音乐台'}).click();await control.locator('#pairCode').fill(await studio.locator('#pairCodeValue').textContent());await control.locator('#pair').click();
 if(rejectAdoption){
  await studio.waitForFunction(()=>peerFixture.received.some(m=>m.type==='studio-ack'&&!m.ok));
  await studio.waitForFunction(()=>document.querySelector('#pairBtn')?.classList.contains('hidden')===false);
  assert.equal(await studio.evaluate(()=>fixture.voices[0].paused),false);await studio.waitForFunction(()=>fixture.gains[0].gain.value===1);assert.equal(await studio.evaluate(()=>fixture.gains[0].gain.value),1);
  await studio.waitForTimeout(1300);assert.equal(await background.evaluate(()=>peerFixture.connections.length),1);
  assert.equal(await background.evaluate(()=>fixture.sceneWrites),0);assert.equal(await studio.evaluate(()=>peerFixture.received.filter(m=>m.type==='room-state').length),1);
  ok('failed initial adoption leaves website audio playing, unmutes it and does not publish an empty stop snapshot');
 }else{
  await background.waitForFunction(()=>fixture.sceneMetadata['com.obr-suite/music-board:room-music-browser-room']?.bgm?.track.name==='Fresh Studio track',null,{polling:50});
  await studio.waitForFunction(()=>peerFixture.received.some(m=>m.type==='studio-ack'&&m.ok));
  assert.equal(await studio.evaluate(()=>peerFixture.sent.filter(m=>m.type==='studio-command'&&m.command.type==='studio-load').length),1);
  assert.equal(await studio.evaluate(()=>peerFixture.sent.filter(m=>m.type==='studio-command'&&m.command.type==='volume').length),0);
  assert.equal(await studio.locator('#localMuteBanner').getAttribute('data-muted'),'1');
  await background.waitForFunction(()=>fixture.voices.some(v=>!v.paused&&v.src.includes('?fresh')),null,{polling:50});
  assert.equal(await background.evaluate(()=>fixture.metadata.unrelatedExtension.length),15800);assert.deepEqual(await background.evaluate(()=>fixture.sceneMetadata.unrelatedScene),{keep:true});
  ok('fresh pairing after adding library tracks adopts playback atomically via scene persistence and keeps room audio audible');
  await studio.locator('.bgm-deck [data-act="play"]').click();await background.waitForFunction(()=>fixture.sceneMetadata['com.obr-suite/music-board:room-music-browser-room'].bgm.paused,null,{polling:50});
  await control.locator('#play').click();await studio.locator('.bgm-deck [data-act="play"].is-playing').waitFor();
  ok('both directions still pause and resume after storage fallback');
 }
 await studio.screenshot({path:join(out,rejectAdoption?'failed-adoption-keeps-playing.png':'fresh-full-room.png')});
}
try{
 if(freshMode){await freshRoom();}else{
  await page.goto("http://127.0.0.1:"+host.address().port);await page.locator("#control").waitFor();
  const background=page.frames().find(frame=>frame.url().endsWith("/background"));
  const waitBackground=background.waitForFunction.bind(background);
  background.waitForFunction=(fn,arg,options)=>waitBackground(fn,arg,{polling:50,...options}); // hidden background has no animation frames
  let control=page.frameLocator("#control");await control.locator("#name").filter({hasText:"Moonlit"}).waitFor();
  await control.locator("#enable").click();await background.waitForFunction(()=>!fixture.voices[0].paused);
  const studio=await context.newPage();studio.on("pageerror",error=>{errors.push(String(error));console.error('STUDIO',error);});studio.on('console',msg=>{if(msg.type()==='error')console.error('STUDIO console',msg.text());});await studio.goto(childUrl+"/studio/");
  await studio.waitForFunction(()=>fixture.voices.length===5);
  await studio.locator("#pairBtn").click();await studio.locator("#pairCodeValue").filter({hasText:/[A-Z2-9]{6}/}).waitFor();
  const code=await studio.locator("#pairCodeValue").textContent();
  await control.locator("summary").filter({hasText:"网页音乐台"}).click();await control.locator("#pairCode").fill(code);await control.locator("#pair").click();
  await studio.locator('.bgm-deck [data-tt-name]').filter({hasText:"Moonlit"}).waitFor();
  await studio.waitForFunction(()=>peerFixture.received.some(m=>m.type==='room-state'));
  assert.equal(await studio.locator("#localMuteBanner").getAttribute("data-muted"),"1");
  assert.equal(await background.evaluate(()=>fixture.metadata['com.obr-suite/music-board:session'].bus.bgm),.8);
  ok("pair receives existing room track without overwriting it; website-only auto mute");
  const revision=()=>background.evaluate(()=>fixture.metadata['com.obr-suite/music-board:session'].revision);
  const paused=expected=>background.waitForFunction(v=>fixture.metadata['com.obr-suite/music-board:session'].bgm?.paused===v,expected);
  await control.locator("#play").click();await paused(true);await studio.locator('.bgm-deck [data-act="play"]:not(.is-playing)').waitFor();
  assert.equal(await studio.evaluate(()=>fixture.voices[0].paused),true);ok("Owlbear pause updates website control and real audio");
  await studio.locator('.bgm-deck [data-act="play"]').click();await paused(false);await studio.locator('.bgm-deck [data-act="play"].is-playing').waitFor();
  ok("website play uses logical room state even with locally suspended audio");
  await studio.locator('.bgm-deck [data-act="play"]').click();await paused(true);
  await studio.locator("#loopToggle").click();await background.waitForFunction(()=>!fixture.metadata['com.obr-suite/music-board:session'].bgm.track.loop);
  assert.equal(await background.evaluate(()=>fixture.metadata['com.obr-suite/music-board:session'].bgm.paused),true);ok("website loop edit keeps paused playback ID and pause state");
  await studio.waitForFunction(()=>fixture.voices[0].duration===60);
  const bar=studio.locator('.bgm-deck [data-tt-bar]');const box=await bar.boundingBox();await bar.click({position:{x:box.width/2,y:box.height/2}});
  await background.waitForFunction(()=>Math.abs(fixture.metadata['com.obr-suite/music-board:session'].bgm.position-30)<1);
  assert.equal(await background.evaluate(()=>fixture.metadata['com.obr-suite/music-board:session'].bgm.paused),true);ok("website seek reaches room and preserves pause");
  const beforeMute=await revision();await studio.locator("#lmbToggle").click();await studio.waitForTimeout(200);
  assert.equal(await studio.evaluate(()=>fixture.gains[0].gain.value),1);await studio.locator("#lmbToggle").click();await studio.waitForTimeout(200);
  assert.equal(await studio.evaluate(()=>fixture.gains[0].gain.value),0);assert.equal(await revision(),beforeMute);
  assert.equal(await background.evaluate(()=>fixture.metadata['com.obr-suite/music-board:session'].bus.bgm),.8);ok("website mute/unmute changes real master gain only, zero room revision writes");
  await control.locator("#play").click();await paused(false);await background.waitForFunction(()=>!fixture.voices[0].paused);
  assert.equal(await studio.evaluate(()=>fixture.gains[0].gain.value),0);ok("muted website follows Owlbear resume while Owlbear stays audible");
  // Drop only first transport ACK, preserving successful metadata. Same ID retry
  // must not replay a load/SFX or increment room state twice.
  await background.evaluate(()=>peerFixture.dropAcks=1);const beforeRetry=await revision();
  await studio.locator('.bgm-deck [data-act="play"]').click();await paused(true);await studio.waitForTimeout(2800);
  assert.equal(await revision(),beforeRetry+1);const messages=await studio.evaluate(()=>peerFixture.sent.filter(m=>m.type==='studio-command').slice(-2));
  assert.equal(messages[0].requestId,messages[1].requestId);ok("lost ACK retries same action ID and causes exactly one room transition");
  const beforeVolume=await revision();const vol=studio.locator("#bgmVvBar");const vb=await vol.boundingBox();await vol.click({position:{x:vb.width/2,y:vb.height*.7}});
  await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].bus.bgm<.4);
  await studio.waitForTimeout(200);assert.ok(await revision()<=beforeVolume+1);ok("shared Studio bus gain is distinct from website mute and coalesced");
  await control.locator("#seek").evaluate(el=>{el.value='12';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await studio.waitForFunction(()=>Math.abs(fixture.voices[0].currentTime-12)<1);ok("Owlbear seek returns to website audio");
  // Disconnect preserves room and mute. An old connection callback after the
  // new connection opens cannot clear its UI or reset shared playback.
  const beforeReconnect=await revision();await background.evaluate(()=>peerFixture.connections.at(-1).close());
  await studio.waitForFunction(()=>peerFixture.received.filter(m=>m.type==='room-state').length>2);
  await background.waitForFunction(()=>peerFixture.connections.length>=2);
  await studio.locator('.bgm-deck [data-tt-name]').filter({hasText:"Moonlit"}).waitFor();await studio.waitForTimeout(250);
  assert.equal(await revision(),beforeReconnect);assert.equal(await studio.locator("#localMuteBanner").getAttribute("data-muted"),"1");
  await studio.evaluate(()=>peerFixture.connections[0].emit('close'));
  assert.equal(await studio.locator("#pairLiveChip").evaluate(e=>!e.classList.contains('hidden')),true);ok("reconnect accepts room snapshot, no legacy bootstrap or stale-close overwrite");
  const snapshot=await studio.evaluate(()=>peerFixture.received.filter(m=>m.type==='room-state').at(-1));
  await studio.evaluate(m=>peerFixture.connections.at(-1).emit('data',{...m,sequence:m.sequence-1,state:{...m.state,bgm:null}}),snapshot);
  assert.match(await studio.locator('.bgm-deck [data-tt-name]').textContent(),/Moonlit/);ok("older state sequence cannot clear new website state");
  await control.locator("#stop").click();await background.waitForFunction(()=>!fixture.metadata['com.obr-suite/music-board:session'].bgm);
  await studio.waitForFunction(()=>!fixture.voices[0].src);ok("Owlbear stop clears website audio and deck without echoing stop back");
  // Website URL library is real IndexedDB, and the real load control starts BGM.
  await studio.locator("#addUrlBtn").click();await studio.locator("#urlInput").fill(childUrl+"/tone.wav?studio");await studio.locator("#urlName").fill("Studio track");
  await studio.locator("#urlAddBtn").click();await studio.locator(".lib-card").filter({hasText:"Studio track"}).waitFor();
  const card=studio.locator(".lib-card").filter({hasText:"Studio track"});await card.dblclick();
  await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].bgm?.track.name==='Studio track');
  ok("existing website URL library load reaches room and keeps background ownership");
  await studio.locator('.bgm-deck [data-act="stop"]').click();await background.waitForFunction(()=>!fixture.metadata['com.obr-suite/music-board:session'].bgm);
  await card.dblclick();await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].bgm?.track.name==='Studio track');
  ok("website stop reaches Owlbear and the same library track can be started again");
  await studio.locator("#addUrlBtn").click();await studio.locator("#urlInput").fill(childUrl+"/tone.wav?sfx");await studio.locator("#urlName").fill("Studio bell");
  await studio.locator('#urlBusSeg [data-bus="sfx"]').click();await studio.locator('#urlLoopChk').uncheck();await studio.locator("#urlAddBtn").click();await studio.locator('.lib-card').filter({hasText:'Studio bell'}).dblclick();
  await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].sfx.length===1);
  await studio.locator('.sfx-pad [data-tt-name]').filter({hasText:'Studio bell'}).waitFor();
  await studio.waitForTimeout(3200);await studio.locator('.bgm-deck [data-act="play"]').click();await paused(true);
  await studio.locator('.sfx-pad [data-tt-name]').filter({hasText:'Studio bell'}).waitFor();assert.equal(await studio.evaluate(()=>fixture.voices[1].paused),false);
  ok("already-playing one-shot survives unrelated state updates after late-join cutoff");
  await studio.locator('.bgm-deck [data-act="play"]').click();await paused(false);
  await control.locator('#clearSfx').click();await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].sfx.length===0);
  await studio.waitForFunction(()=>fixture.voices.slice(1).every(a=>!a.src));ok("website SFX trigger and Owlbear clear synchronize all real decks");
  await control.locator("#close").click();await page.locator("#control").waitFor({state:"detached"});
  await studio.locator('.bgm-deck [data-act="play"]').click();await paused(true);
  await studio.locator('.bgm-deck [data-act="play"]').click();await paused(false);
  await background.waitForFunction(()=>fixture.voices.some(a=>a.src.includes('?studio')&&!a.paused));ok("closing Owlbear controller leaves bidirectional website controls and audio running");
  await studio.screenshot({path:join(out,"studio-synced-muted.png"),fullPage:false});
  await studio.evaluate(()=>window.onbeforeunload=null);studio.on('dialog',dialog=>dialog.accept());await studio.close();
  assert.equal(await background.evaluate(()=>fixture.metadata['com.obr-suite/music-board:session'].bgm.paused),false);ok("closing website cannot stop room background playback");
 }
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,"result.json"),JSON.stringify({checks,errors,artifacts:out,scope:"Real Studio DOM, RoomMusic/MusicAudio, browser media; SDK/PeerJS transport fixtures, not a real Owlbear room"},null,2));
  console.log("Music Studio integration PASS: "+checks.length+" checks; artifacts "+out);
}catch(error){console.error(error);for(const p of context.pages())try{console.error(await p.evaluate(()=>({url:location.href,toasts:document.querySelector('#toastStack')?.textContent,code:document.querySelector('#pairCodeValue')?.textContent,voices:window.fixture?.voices?.length,peers:window.peerFixture?.connections?.length,ready:document.readyState})));}catch{}console.error("Artifacts: "+out);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>host.close(r));await new Promise(r=>child.close(r));}
