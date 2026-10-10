// Real module + real control DOM + real WebAudio in sibling iframes under a
// different-origin parent. SDK is a message/storage boundary fixture, not a room.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { rolldown } from "rolldown";
const out = resolve(process.env.MUSIC_EVIDENCE || ".local-evidence/music-board"); mkdirSync(out,{recursive:true});
for (const [entry, name] of [["src/modules/musicBoard/index.ts","background"],["src/music-board-page.ts","page"]]) {
  const build = await rolldown({ input: resolve(entry), platform: "browser", plugins: [{ name: "fixture-boundaries",
    resolveId(source) {
      if (source === "@owlbear-rodeo/sdk") return "mock:sdk";
      if (source.endsWith("/state")) return "mock:state";
      if (source.endsWith("/asset-base")) return "mock:asset";
      if (source.endsWith("/viewportAnchor")) return "mock:viewport";
      if (source.endsWith("/panelLayout")) return "mock:layout";
      if (source.endsWith("/panelDrag")) return "mock:drag";
      if (source.endsWith("/workbench/channel")) return "mock:channel";
      if (source.endsWith("/panelObstacles")) return "mock:obstacles";
      if (source.endsWith(".css")) return "mock:css";
    },
    load(id) {
      if (id === "mock:sdk") return "export default globalThis.__MUSIC_SDK__;";
      if (id === "mock:state") return "export const getLocalLang=()=>localStorage.getItem('obr-suite/lang')||'zh';export const onLangChange=()=>()=>{};";
      if (id === "mock:asset") return "export const assetUrl=x=>x;";
      if (id === "mock:viewport") return "export const onViewportResize=()=>()=>{};";
      if (id === "mock:layout") return "export const PANEL_IDS={musicBoard:'music-board'};export const getPanelOffset=()=>({dx:0,dy:0});export const registerPanelBbox=()=>{};export const BC_PANEL_DRAG_END='drag-end';export const BC_PANEL_RESET='reset';";
      if (id === "mock:drag") return "export const bindPanelDrag=()=>{};";
      if (id === "mock:channel") return "export const WORKBENCH_DEV=false;";
      if (id === "mock:obstacles") return "export const setPanelOpen=()=>{};";
      if (id === "mock:css") return "";
    },
  }] }); await build.write({ file: join(out, name + ".js"), format: "esm" }); await build.close();
}
function installFixture() {
  const callbacks = new Map();
  const on = (key, fn) => { if (!callbacks.has(key)) callbacks.set(key,new Set()); callbacks.get(key).add(fn); return ()=>callbacks.get(key).delete(fn); };
  const emit = (key,value)=>{window.fixture?.events.push({key,value});for(const fn of [...(callbacks.get(key)||[])]) fn(value);};
  const channel = new BroadcastChannel("music-integration"), send=(key,data)=>{if(new TextEncoder().encode(JSON.stringify(data)).length>16384)throw Error("Fixture SDK broadcast exceeds 16 KB");emit(key,{data,connectionId:"test"});channel.postMessage({key,data});};
  channel.onmessage=event=>emit(event.data.key,{data:event.data.data,connectionId:"test"});
  window.addEventListener("message",event=>{if(event.data?.kind==="toggle")emit("com.obr-suite/music-board:toggle",{data:{},connectionId:"test"});});
  const track={id:"one",url:location.origin+"/tone.wav",name:"月下的旅人 · The Moonlit Road",bus:"bgm",loop:true,duration:8};
  const state={version:2,revision:1,author:"test",allowPlayers:true,tracks:[track,{...track,id:"two",name:"Silent City",url:location.origin+"/tone.wav?two"}],queue:["two"],bgm:{track:{...track,loop:false,duration:0},playbackId:"first",position:0,startedAt:Date.now(),paused:false},sfx:[],bus:{bgm:.8,sfx:1},recent:[],ts:Date.now()};
  const metadata={"com.obr-suite/music-board:session":state};
  window.fixture={metadata,sceneMetadata:{},writes:0,voices:[],contexts:[],events:[],role:"GM",emit};
  const NativeAudio=window.Audio; window.Audio=function(url){const voice=new NativeAudio(url);fixture.voices.push(voice);return voice;};
  const NativeContext=window.AudioContext;window.AudioContext=class extends NativeContext{constructor(){super();fixture.contexts.push(this);}};
  window.__MUSIC_SDK__={
    onReady:fn=>queueMicrotask(fn), player:{getId:async()=>"gm",getConnectionId:async()=>"test",getRole:async()=>fixture.role,onChange:fn=>on("player",fn)},
    party:{getPlayers:async()=>[],onChange:fn=>on("party",fn)},
    room:{id:"music-browser-room",getMetadata:async()=>structuredClone(metadata),setMetadata:async patch=>{fixture.writes++;Object.assign(metadata,structuredClone(patch));emit("metadata",structuredClone(metadata));},onMetadataChange:fn=>on("metadata",fn)},
    scene:{isReady:async()=>true,getMetadata:async()=>structuredClone(fixture.sceneMetadata),onReadyChange:fn=>on("scene-ready",fn),onMetadataChange:fn=>on("scene-meta",fn),setMetadata:async patch=>{fixture.writes++;Object.assign(fixture.sceneMetadata,structuredClone(patch));emit("scene-meta",structuredClone(fixture.sceneMetadata));}},
    viewport:{getWidth:async()=>900,getHeight:async()=>760},
    broadcast:{sendMessage:async(key,data)=>send(key,data),onMessage:on},
    popover:{open:async args=>{parent.postMessage({kind:"open",url:args.url,width:args.width,height:args.height},"*");},close:async()=>{parent.postMessage({kind:"close"},"*");}},
    notification:{show:async text=>{fixture.notice=text;}},
  };
}
const css=readFileSync(resolve("src/modules/musicBoard/style.css"),"utf8");
const pageHtml=readFileSync(resolve("music-board.html"),"utf8").replace('./src/music-board-page.ts','/page.js').replace("</head>","<style>"+css+"</style><script>("+installFixture.toString()+")();</script></head>");
const samples=44100*8,wav=Buffer.alloc(44+samples*2);
wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/44100)*1800),44+i*2);
const child=createServer((request,response)=>{
  response.setHeader("Content-Type","text/html; charset=utf-8");
  if(request.url?.startsWith("/tone.wav")){response.setHeader("Content-Type","audio/wav");response.setHeader("Access-Control-Allow-Origin","*");response.end(wav);}
  else if(request.url==="/background.js"||request.url==="/page.js"){response.setHeader("Content-Type","text/javascript");response.end(readFileSync(join(out,request.url.slice(1))));}
  else if(request.url==="/background"){response.end('<script>('+installFixture.toString()+')();</script><script type="module">import {setupMusicBoard} from "/background.js";await setupMusicBoard();__MUSIC_SDK__.broadcast.sendMessage("com.obr-suite/music-board:toggle",{},{});window.booted=true;</script>');}
  else response.end(pageHtml);
});
await new Promise(resolve=>child.listen(0,"127.0.0.1",resolve));const childUrl="http://127.0.0.1:"+child.address().port;
const host=createServer((request,response)=>response.end('<style>body{background:#334352;font:16px system-ui}iframe{border:0}#control{position:absolute;left:80px;top:70px}</style><button id="reopen">Open music</button><iframe id="background" style="display:none" allow="autoplay" src="'+childUrl+'/background"></iframe><script>document.getElementById("reopen").onclick=()=>document.getElementById("background").contentWindow.postMessage({kind:"toggle"},"'+childUrl+'");window.addEventListener("message",event=>{if(event.origin!=="'+childUrl+'")return;if(event.data.kind==="open"){document.getElementById("control")?.remove();const f=document.createElement("iframe");f.id="control";f.allow="autoplay";f.src="'+childUrl+'/"+event.data.url;f.width=event.data.width;f.height=event.data.height;document.body.append(f);}if(event.data.kind==="close")document.getElementById("control")?.remove();});</script>'));
await new Promise(resolve=>host.listen(0,"127.0.0.1",resolve));
const {chromium}=await import('@playwright/test');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{}),args:["--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies"]});
const context=await browser.newContext({viewport:{width:900,height:760},deviceScaleFactor:1}),page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(String(error)));
try{
  await page.goto("http://127.0.0.1:"+host.address().port);await page.locator("#control").waitFor();
  const background=page.frames().find(frame=>frame.url().endsWith("/background"));
  let control=page.frameLocator("#control");await control.locator("#name").filter({hasText:"Moonlit"}).waitFor();
  await background.waitForFunction(()=>fixture.metadata["com.obr-suite/music-board:session"].bgm.track.duration===8,null,{polling:50});
  assert.equal(await background.evaluate(()=>fixture.contexts.length),0);
  await background.waitForFunction(()=>fixture.metadata["com.obr-suite/music-board:session"].bgm.track.id==="two",null,{polling:50});
  assert.equal(await background.evaluate(()=>fixture.contexts.length),0,"automatic next must not need the elected writer to enable its sound");
  assert.equal(await background.evaluate(()=>fixture.writes),2,"metadata duration plus one queue transition; no periodic room writes");
  assert.equal(await background.evaluate(()=>fixture.voices.every(a=>a.paused)),true);
  await control.locator("#enable").click();await background.waitForFunction(()=>!fixture.voices.at(-1).paused&&fixture.voices.at(-1).currentTime>0,null,{polling:50});
  const voiceCount=await background.evaluate(()=>fixture.voices.length);await control.locator("#soundNotice").waitFor({state:"hidden"});
  await page.screenshot({path:join(out,"music-full-zh.png")});
  const beforeVolume=await background.evaluate(()=>fixture.writes);
  await control.locator(".volume-details summary").click();await control.locator("#bgmVolume").fill("28");await control.locator("#bgmVolume").dispatchEvent("input");
  assert.equal(await background.evaluate(()=>fixture.writes),beforeVolume,"local volume cannot change room metadata");
  await control.locator("#mini").click();await page.waitForFunction(()=>document.getElementById("control")?.src.includes("mini=1"));
  control=page.frameLocator("#control");await control.locator("#name").filter({hasText:"Silent City"}).waitFor();
  assert.equal(await background.evaluate(()=>fixture.voices.length),voiceCount,"minimizing must not recreate audio");
  await page.screenshot({path:join(out,"music-mini-zh.png")});
  const beforeClose=await background.evaluate(()=>fixture.voices.at(-1).currentTime);
  await control.locator("#close").click();await page.locator("#control").waitFor({state:"detached"});await page.waitForTimeout(400);
  const afterClose=await background.evaluate(()=>fixture.voices.at(-1).currentTime);
  assert.ok(afterClose!==beforeClose);assert.equal(await background.evaluate(()=>fixture.voices.at(-1).paused),false);
  assert.equal(await background.evaluate(()=>fixture.writes),beforeVolume);
  await page.locator("#reopen").click();control=page.frameLocator("#control");await control.locator("#name").filter({hasText:"Silent City"}).waitFor();
  await control.locator("#mini").click();await page.waitForFunction(()=>document.getElementById("control")?.src.includes("mini=0"));
  control=page.frameLocator("#control");await control.locator("#name").filter({hasText:"Silent City"}).waitFor();
  await control.locator("#play").click();await background.waitForFunction(()=>fixture.voices.at(-1).paused,null,{polling:50});
  await control.locator("#play").click();await background.waitForFunction(()=>!fixture.voices.at(-1).paused,null,{polling:50});
  const frame=page.frames().find(frame=>frame.url().includes("music-board.html"));await frame.evaluate(()=>localStorage.setItem("obr-suite/lang","en"));
  await page.locator("#reopen").click();await page.locator("#control").waitFor({state:"detached"});await page.locator("#reopen").click();control=page.frameLocator("#control");
  await control.locator("#name").filter({hasText:"Silent City"}).waitFor();await control.locator("#library").waitFor();
  await page.screenshot({path:join(out,"music-library-en.png")});
  const voices=await background.evaluate(()=>fixture.voices.length);assert.equal(voices,voiceCount);

  // Production editor and import path, with the actual elected-writer reducer.
  await control.locator('#addTrack').click();
  await control.locator('#trackName').fill('<img src=x onerror=alert(1)> Rain');
  await control.locator('#trackUrl').fill(childUrl+'/tone.wav?rain');
  await control.locator('#trackBus [data-bus=sfx]').click();
  await control.locator('#trackGroup').fill('Weather');
  await control.locator('#trackTags').fill('forest, rain');
  await control.locator('#trackVolume').fill('45');
  await control.locator('#saveTrack').click();await control.locator('#trackDialog').waitFor({state:'hidden'});
  await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].tracks.length===3);
  let tracks=await background.evaluate(()=>fixture.metadata['com.obr-suite/music-board:session'].tracks);
  const rain=tracks.find(t=>t.group==='Weather');assert.equal(rain.bus,'sfx');assert.equal(rain.loop,false);assert.equal(rain.volume,.45);assert.deepEqual(rain.tags,['forest','rain']);
  assert.equal(await control.locator('#library img').count(),0,'names render as plain text');
  await control.locator('#search').fill('forest');assert.equal(await control.locator('.track-card').count(),1);
  await control.locator('.favorite-button').click();await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].tracks.some(t=>t.favorite));
  await control.locator('#search').fill('');
  await control.locator('#openImport').click();
  const beforeImport=await background.evaluate(()=>fixture.writes);
  await control.locator('#importText').fill('https://example.invalid/new.ogg\nfile:///private.ogg');
  await control.locator('#previewImport').click();assert.equal(await control.locator('#applyImport').isVisible(),false);
  assert.equal(await background.evaluate(()=>fixture.writes),beforeImport);
  await control.locator('#importText').fill(JSON.stringify({format:'obr-music-library',version:1,tracks:[rain,{url:childUrl+'/tone.wav?forest',name:'Forest',tags:['forest'],group:'Journey'}]}));
  await control.locator('#previewImport').click();assert.equal(await control.locator('#importList li').count(),2);
  assert.equal(await background.evaluate(()=>fixture.writes),beforeImport,'preview cannot mutate room');
  await control.locator('#applyImport').click();await control.locator('#importDialog').waitFor({state:'hidden'});
  await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].tracks.length===4);
  assert.equal(await background.evaluate(()=>fixture.writes),beforeImport+1,'merge is one atomic write and skips duplicate URL');
  const downloadWait=page.waitForEvent('download');await control.locator('#export').click();const download=await downloadWait;
  const exported=join(out,'exported-library.json');await download.saveAs(exported);const library=JSON.parse(readFileSync(exported,'utf8'));assert.equal(library.format,'obr-music-library');assert.equal(library.tracks.length,4);assert.equal(library.tracks.find(t=>t.group==='Weather').favorite,true);
  const beforeRestore=await background.evaluate(()=>fixture.writes);
  await control.locator('#backup').click();await control.locator('#importPreview').waitFor();assert.equal(await control.locator('#importList li').count(),3);
  assert.equal(await background.evaluate(()=>fixture.writes),beforeRestore,'backup restoration opens preview first');
  await control.locator('#importMode [data-mode=replace]').click();await control.locator('#replaceHint').waitFor();await control.locator('#applyImport').click();await control.locator('#importDialog').waitFor({state:'hidden'});
  await background.waitForFunction(()=>fixture.metadata['com.obr-suite/music-board:session'].tracks.length===3);
  assert.equal(await background.evaluate(()=>fixture.voices.length),voiceCount,'library edits and restore never replace the playing voice');
  const backup=await background.evaluate(()=>JSON.parse(localStorage.getItem('obr-music-board:library-backup:music-browser-room')));
  assert.equal(backup.current.tracks.length,3);assert.equal(backup.previous.tracks.length,4);
  await control.locator('#close').click();await page.locator('#control').waitFor({state:'detached'});await page.locator('#reopen').click();control=page.frameLocator('#control');await control.locator('.track-card').nth(2).waitFor();
  assert.equal(await control.locator('select').count(),0);assert.equal(await control.locator('a').count(),0);
  const layoutFrame=page.frames().find(f=>f.url().includes('music-board.html'));await layoutFrame.evaluate(()=>localStorage.setItem('obr-suite/lang','zh'));
  await control.locator('#close').click();await page.locator('#control').waitFor({state:'detached'});await page.locator('#reopen').click();control=page.frameLocator('#control');await control.locator('.track-card').nth(2).waitFor();
  await control.locator(`[data-track="${rain.id}"] .track-actions button`).filter({hasText:'编辑'}).click();await control.locator('#trackName').fill('林间雨声');await control.locator('#saveTrack').click();await control.locator('#trackDialog').waitFor({state:'hidden'});
  // Fixed controls and contained scrolling at native, narrow and desktop sizes.
  for(const [width,height] of [[1100,700],[380,560],[320,480]]){
    await page.locator('#control').evaluate((f,size)=>{f.width=size[0];f.height=size[1];f.style.left='0';f.style.top='0';},[width,height]);await page.waitForTimeout(80);
    const before=await control.locator('.music-deck').boundingBox();await control.locator('.library-pane').evaluate(el=>el.scrollTop=el.scrollHeight);
    const after=await control.locator('.music-deck').boundingBox();assert.equal(before.y,after.y);
    assert.ok(await control.locator('html').evaluate(el=>el.scrollWidth-el.clientWidth)<=1,'no horizontal overflow');
    await control.locator('.library-pane').evaluate(el=>el.scrollTop=0);
    const frame=page.frames().find(f=>f.url().includes('music-board.html'));
    await frame.evaluate(()=>document.documentElement.dataset.suiteNight='false');await control.locator('.music-app').screenshot({path:join(out,`music-${width}x${height}-light.png`)});
    await frame.evaluate(()=>document.documentElement.dataset.suiteNight='true');await control.locator('.music-app').screenshot({path:join(out,`music-${width}x${height}-dark.png`)});
  }

  const large=Array.from({length:110},(_,i)=>({url:`https://audio.example/large-${i}.ogg`,name:`林间行旅曲目 ${i}`,group:'长曲库',tags:['测试','旅途']}));
  await control.locator('#openImport').click();await control.locator('#importText').fill(JSON.stringify({tracks:large}));await control.locator('#previewImport').click();await control.locator('#applyImport').click();await control.locator('#importDialog').waitFor({state:'hidden'});
  await control.locator('.track-card').nth(112).waitFor();assert.equal(await control.locator('.track-card').count(),113);
  assert.ok(await background.evaluate(()=>fixture.events.some(e=>e.key==='com.obr-suite/music-board:command:part')),'large import uses bounded fragments');
  assert.ok(await background.evaluate(()=>fixture.events.some(e=>e.key==='com.obr-suite/music-board:view:part')),'large library view arrives completely');
  await control.locator('.track-card').nth(3).locator('.favorite-button').click();await control.locator('#feedback').filter({hasText:'已保存'}).waitFor();
  await control.locator('#backup').click();await control.locator('#importPreview').waitFor();assert.equal(await control.locator('#importList li').count(),113);
  assert.ok(await background.evaluate(()=>fixture.events.some(e=>e.key==='com.obr-suite/music-board:backup:part')),'large backup response uses bounded fragments');
  await control.locator('[data-close=importDialog]').click();
  await background.evaluate(()=>{fixture.role='PLAYER';fixture.metadata['com.obr-suite/music-board:session'].allowPlayers=false;for(const state of Object.values(fixture.sceneMetadata))if(state?.version===2)state.allowPlayers=false;fixture.emit('player',{id:'gm',connectionId:'test',role:'PLAYER',name:'Test'});fixture.emit('metadata',structuredClone(fixture.metadata));fixture.emit('scene-meta',structuredClone(fixture.sceneMetadata));});
  await control.locator('#readOnly').waitFor();assert.equal(await control.locator('#addTrack').isDisabled(),true);assert.equal(await control.locator('#export').isEnabled(),true);
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,"results.json"),JSON.stringify({beforeClose,afterClose,voices,errors,roomWrites:await background.evaluate(()=>fixture.writes)},null,2));
  console.log("Music browser PASS: real backend+DOM+Audio, metadata-based automatic next without local sound consent, resize/close/reopen preserve current Audio instance, own volume no room writes, pause/resume, Chinese/English UI, native editing/filtering/favorites, atomic import preview/merge, JSON export, rolling backup/restore, persistent reopen, role gating, fixed controls and 320px light/dark layouts. Artifacts: "+out);
}catch(error){
  const bg=page.frames().find(frame=>frame.url().endsWith("/background"));
  if(bg)console.log(JSON.stringify(await bg.evaluate(()=>({voices:fixture.voices.map(a=>({src:a.src,paused:a.paused,time:a.currentTime,error:a.error?.message})),contexts:fixture.contexts.map(c=>c.state),events:fixture.events.slice(-6)})),null,2));
  console.log(errors);throw error;
}finally{await context.close();await browser.close();await new Promise(resolve=>host.close(resolve));await new Promise(resolve=>child.close(resolve));}
