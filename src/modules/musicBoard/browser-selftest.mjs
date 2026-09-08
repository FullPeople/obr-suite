// Real module + real control DOM + real WebAudio in sibling iframes under a
// different-origin parent. SDK is a message/storage boundary fixture, not a room.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { rolldown } from "rolldown";
const out = mkdtempSync(join(tmpdir(), "music-ui-"));
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
function installFixture() {
  const callbacks = new Map();
  const on = (key, fn) => { if (!callbacks.has(key)) callbacks.set(key,new Set()); callbacks.get(key).add(fn); return ()=>callbacks.get(key).delete(fn); };
  const emit = (key,value)=>{window.fixture?.events.push({key,value});for(const fn of [...(callbacks.get(key)||[])]) fn(value);};
  const channel = new BroadcastChannel("music-integration"), send=(key,data)=>{emit(key,{data,connectionId:"test"});channel.postMessage({key,data});};
  channel.onmessage=event=>emit(event.data.key,{data:event.data.data,connectionId:"test"});
  window.addEventListener("message",event=>{if(event.data?.kind==="toggle")emit("com.obr-suite/music-board:toggle",{data:{},connectionId:"test"});});
  const track={id:"one",url:location.origin+"/tone.wav",name:"月下的旅人 · The Moonlit Road",bus:"bgm",loop:true,duration:8};
  const state={version:2,revision:1,author:"test",allowPlayers:true,tracks:[track,{...track,id:"two",name:"Silent City",url:location.origin+"/tone.wav?two"}],queue:["two"],bgm:{track:{...track,loop:false,duration:0},playbackId:"first",position:0,startedAt:Date.now(),paused:false},sfx:[],bus:{bgm:.8,sfx:1},recent:[],ts:Date.now()};
  const metadata={"com.obr-suite/music-board:session":state};
  window.fixture={metadata,writes:0,voices:[],contexts:[],events:[],role:"GM"};
  const NativeAudio=window.Audio; window.Audio=function(url){const voice=new NativeAudio(url);fixture.voices.push(voice);return voice;};
  const NativeContext=window.AudioContext;window.AudioContext=class extends NativeContext{constructor(){super();fixture.contexts.push(this);}};
  window.__MUSIC_SDK__={
    onReady:fn=>queueMicrotask(fn), player:{getId:async()=>"gm",getConnectionId:async()=>"test",getRole:async()=>fixture.role,onChange:fn=>on("player",fn)},
    party:{getPlayers:async()=>[],onChange:fn=>on("party",fn)},
    room:{getMetadata:async()=>structuredClone(metadata),setMetadata:async patch=>{fixture.writes++;Object.assign(metadata,structuredClone(patch));emit("metadata",structuredClone(metadata));},onMetadataChange:fn=>on("metadata",fn)},
    scene:{isReady:async()=>true,getMetadata:async()=>({})},
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
const runtime=process.env.CODEX_PLAYWRIGHT_DIR||"C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const{chromium}=await import(pathToFileURL(join(runtime,"index.mjs")).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.BOSS_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies"]});
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
  await control.locator("#bgmVolume").fill("28");await control.locator("#bgmVolume").dispatchEvent("input");
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
  await control.locator("#name").filter({hasText:"Silent City"}).waitFor();await control.locator("summary").filter({hasText:"Library"}).click();
  await page.screenshot({path:join(out,"music-library-en.png")});
  const voices=await background.evaluate(()=>fixture.voices.length);assert.equal(voices,voiceCount);
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,"results.json"),JSON.stringify({beforeClose,afterClose,voices,errors,roomWrites:await background.evaluate(()=>fixture.writes)},null,2));
  console.log("Music browser PASS: real backend+DOM+Audio, metadata-based automatic next without local sound consent, resize/close/reopen preserve current Audio instance, own volume no room writes, pause/resume, Chinese/English UI. Artifacts: "+out);
}catch(error){
  const bg=page.frames().find(frame=>frame.url().endsWith("/background"));
  if(bg)console.log(JSON.stringify(await bg.evaluate(()=>({voices:fixture.voices.map(a=>({src:a.src,paused:a.paused,time:a.currentTime,error:a.error?.message})),contexts:fixture.contexts.map(c=>c.state),events:fixture.events.slice(-6)})),null,2));
  console.log(errors);throw error;
}finally{await context.close();await browser.close();await new Promise(resolve=>host.close(resolve));await new Promise(resolve=>child.close(resolve));}
