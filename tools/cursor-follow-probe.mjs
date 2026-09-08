// Research-only boundary probe. Does not connect to an Owlbear room or modify product modules.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { rolldown } from "rolldown";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), out = mkdtempSync(join(tmpdir(), "cursor-follow-probe-"));
const sdkRoot = join(root, "node_modules/@owlbear-rodeo/sdk/lib");
const results = { kind: "research-only; SDK message boundary, synthetic budget and browser isolation; NOT Owlbear UAT", sdk: JSON.parse(readFileSync(join(sdkRoot,"../package.json"),"utf8")).version };
const build = await rolldown({ input: "probe:sdk", platform: "node", plugins: [{ name: "actual-installed-sdk", resolveId(id) { if (id === "probe:sdk") return id; }, load(id) {
  if (id !== "probe:sdk") return;
  return `export {default as ToolApi} from ${JSON.stringify(join(sdkRoot,"api/ToolApi.js"))};
export {default as InteractionApi} from ${JSON.stringify(join(sdkRoot,"api/InteractionApi.js"))};
export {PointerBuilder} from ${JSON.stringify(join(sdkRoot,"builders/PointerBuilder.js"))};`;
} }] });
await build.write({ file: join(out,"sdk.mjs"), format: "esm" }); await build.close();
const { ToolApi, InteractionApi, PointerBuilder } = await import(pathToFileURL(join(out,"sdk.mjs")).href);

class Bus {
  handlers = new Map(); sent = [];
  on(type, callback) { if (!this.handlers.has(type)) this.handlers.set(type,new Set()); this.handlers.get(type).add(callback); }
  off(type, callback) { this.handlers.get(type)?.delete(callback); }
  send(type, data) { this.sent.push({ type, data: structuredClone(data) }); }
  async sendAsync(type,data) { this.send(type,data); return { id: "fixture-interaction" }; }
  emit(type,data) { for (const callback of this.handlers.get(type) || []) callback(data); }
}
const toolBus = new Bus(), tool = new ToolApi(toolBus); let moves = 0, accepted = 0, enabled = true;
await tool.createMode({ id: "probe/shared-move", icons: [{icon:"https://example.invalid/probe.svg",label:"Probe"}], preventDrag: {}, onToolMove() { moves++; if(enabled) accepted++; }, onToolClick: () => true });
const event = {pointerPosition:{x:100,y:200},target:{id:"token",locked:false},altKey:false,shiftKey:false,ctrlKey:false,metaKey:false};
toolBus.emit("OBR_TOOL_MODE_EVENT_TOOL_MOVE",{id:"rodeo.owlbear.tools/move",context:{},event}); assert.equal(moves,0);
toolBus.emit("OBR_TOOL_MODE_EVENT_TOOL_MOVE",{id:"probe/shared-move",context:{activeMode:"probe/shared-move"},event}); assert.equal(moves,1);
toolBus.emit("OBR_TOOL_MODE_EVENT_TOOL_CLICK",{id:"probe/shared-move",context:{},event}); await Promise.resolve();
assert.ok(toolBus.sent.some(message => message.type === "OBR_PLAYER_SELECT"));
assert.deepEqual(toolBus.sent.find(message => message.type === "OBR_TOOL_MODE_CREATE").data.preventDrag,{});
enabled=false;await tool.removeMode("probe/shared-move"); toolBus.emit("OBR_TOOL_MODE_EVENT_TOOL_MOVE",{id:"probe/shared-move",context:{},event});
assert.equal(moves,2,"SDK 3.1.0 removes the tool record, leaving the mode callback reachable by a late host message");assert.equal(accepted,1,"application lifetime guard rejects that late message");
results.tool = { modeIdRoutingVerified:true, defaultClickDelegationVerified:true, preventDragForwarded:true, rawCallbackAfterRemove:true, guardedLateMessageIgnored:true,
  limit:"Host active-mode routing and native drag fallback are documented but not executed by this fake bus." };

const interactionBus = new Bus(), interaction = new InteractionApi(interactionBus);
const pointer = new PointerBuilder({id:"fixture-player"}).position({x:0,y:0}).disableHit(true).build();
const [update, stop] = await interaction.startItemInteraction(pointer);
for (let i=1;i<=120;i++) update(draft=>{draft.position={x:i,y:i};});
const beforeIdle = interactionBus.sent.length;
for (let i=0;i<120;i++) update(()=>{});
const idle = interactionBus.sent.slice(beforeIdle); assert.equal(idle.length,120); assert.ok(idle.every(message=>message.data.patches.length===0));
stop(); const beforeStale = interactionBus.sent.length; update(draft=>{draft.position.x++;});
assert.equal(interactionBus.sent.length,beforeStale+1,"caller must cancel stale updates itself; SDK stop is a host message");
assert.ok(interactionBus.sent.every(message=>!message.type.startsWith("OBR_SCENE")));
results.interaction = { movingUpdateMessages:120, idleEmptyPatchMessages:idle.length, updateAfterStopStillSent:true, explicitSceneWrites:0,
  limit:"These are SDK-to-host messages, not server packets. No host interpolation, 30-second expiry or implicit persistence is simulated." };

// Compare batching eight items through the actual SDK dispatcher.
async function batchCost(grouped) {
  const bus = new Bus(), api = new InteractionApi(bus), items = Array.from({length:8},(_,i)=>({...pointer,id:`follower-${i}`}));
  const handles = grouped ? [await api.startItemInteraction(items)] : await Promise.all(items.map(item=>api.startItemInteraction(item)));
  for (let frame=1;frame<=300;frame++) for (const [dispatch] of handles) dispatch(draft=>{
    for (const item of Array.isArray(draft)?draft:[draft]) item.position={x:frame,y:frame/2};
  });
  for (const [,end] of handles) end();
  const messages=bus.sent.filter(message=>message.type==="OBR_INTERACTION_UPDATE_ITEM_INTERACTION");
  return {updatesFor10SecondsAt30Hz:messages.length,jsonBytes:messages.reduce((sum,message)=>sum+Buffer.byteLength(JSON.stringify(message)),0)};
}
results.batch = { eightSeparate:await batchCost(false), eightTogether:await batchCost(true) };
assert.equal(results.batch.eightSeparate.updatesFor10SecondsAt30Hz,2400);assert.equal(results.batch.eightTogether.updatesFor10SecondsAt30Hz,300);

// A proposed latest-wins sender budget, deliberately independent of production code.
function cursorBudget(sendDelayMs) {
  const sent=[];let nextAt=0,busyUntil=0,pending=null,last=null,maxPending=0;
  for(let now=0;now<=14000;now++) {
    if(now<10000&&now%8===0) pending={v:1,scene:"fixture-scene",seq:now,x:Math.round(now*.2),y:Math.round(Math.sin(now/700)*200)};
    if(pending&&now>=nextAt&&now>=busyUntil) {
      if(!last||Math.hypot(pending.x-last.x,pending.y-last.y)>=2) {sent.push({at:now,payload:pending});last=pending;nextAt=now+84;busyUntil=now+sendDelayMs;}
      pending=null;
    }
    maxPending=Math.max(maxPending,Number(!!pending));
  }
  for(let i=1;i<sent.length;i++) assert.ok(sent[i].at-sent[i-1].at>=84);
  assert.equal(maxPending,1);assert.ok(sent.length<=121);assert.ok(sent.at(-1).at<10200);
  const bytes=sent.reduce((sum,entry)=>sum+Buffer.byteLength(JSON.stringify(entry.payload)),0);
  return {inputSamples:1250,sent:sent.length,payloadBytes:bytes,maxQueued:1,lastSendMs:sent.at(-1).at,afterMotionAndDrainMessages:0};
}
results.cursorBudget = {fastBoundary:cursorBudget(0),slowBoundary120ms:cursorBudget(120)};

function distance(path){return path.slice(1).reduce((total,p,i)=>total+Math.hypot(p.x-path[i].x,p.y-path[i].y),0);}
function along(path,d){for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(d<=length)return{x:a.x+(b.x-a.x)*d/length,y:a.y+(b.y-a.y)*d/length};d-=length;}return path.at(-1);}
const sparse=[{x:0,y:0},{x:300,y:0},{x:300,y:150}],dense=[{x:0,y:0},{x:75,y:0},{x:150,y:0},{x:225,y:0},{x:300,y:0},{x:300,y:75},{x:300,y:150}];
assert.equal(distance(sparse),distance(dense)); for(const d of [0,40,170,320,400,450])assert.deepEqual(along(sparse,d),along(dense,d));
results.path = {distancePx:distance(sparse),speedPxPerSecond:300,durationSeconds:distance(sparse)/300,resamplingInvariant:true,
  oldTwoPointDurationMs:150,oldTwoPoint1500pxSpeedPxPerSecond:10000,limit:"Arc-length timing only. No wall routing, pet behaviour or attachment renderer is simulated."};

// Real Chrome pointer isolation: small iframe beside the map, never a capture overlay.
const child = createServer((request,response)=>{response.setHeader("Content-Type","text/html; charset=utf-8");response.end('<body style="margin:0;background:#b8d4ca">Extension iframe<script>window.moves=0;window.raf=0;window.ticks=0;document.addEventListener("pointermove",()=>moves++);try{parent.document;window.parentAccessDenied=false}catch{window.parentAccessDenied=true}function frame(){raf++;requestAnimationFrame(frame)}requestAnimationFrame(frame);setInterval(()=>ticks++,16);window.ready=true;</script>');});
await new Promise(resolve=>child.listen(0,"127.0.0.1",resolve));const childUrl="http://127.0.0.1:"+child.address().port;
const host=createServer((request,response)=>{response.setHeader("Content-Type","text/html; charset=utf-8");response.end('<body style="margin:0"><div id="map" style="width:500px;height:400px;background:#52616b">Map area</div><iframe id="panel" src="'+childUrl+'" style="position:absolute;left:520px;top:0;width:200px;height:150px"></iframe><iframe id="background" src="'+childUrl+'" style="display:none"></iframe><script>window.moves=0;window.clicks=0;document.getElementById("map").addEventListener("pointermove",()=>moves++);document.getElementById("map").addEventListener("click",()=>clicks++);</script>');});
await new Promise(resolve=>host.listen(0,"127.0.0.1",resolve));
let browser;
try {
  const runtime=process.env.CODEX_PLAYWRIGHT_DIR||"C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
  const {chromium}=await import(pathToFileURL(join(runtime,"index.mjs")).href);
  browser=await chromium.launch({headless:true,executablePath:process.env.BOSS_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe"});
  const page=await browser.newPage({viewport:{width:760,height:440}});await page.goto("http://127.0.0.1:"+host.address().port);
  const panel=await (await page.$("#panel")).contentFrame(),background=await (await page.$("#background")).contentFrame();
  await panel.waitForFunction(()=>window.ready);await background.waitForFunction(()=>window.ready,null,{polling:50});
  for(let i=0;i<20;i++)await page.mouse.move(30+i*15,100);await page.mouse.click(160,120);await page.waitForTimeout(300);
  const beforePanel={parent:await page.evaluate(()=>({moves,clicks})),panel:await panel.evaluate(()=>moves),background:await background.evaluate(()=>({moves,parentAccessDenied,raf,ticks}))};
  assert.ok(beforePanel.parent.moves>=20);assert.equal(beforePanel.parent.clicks,1);assert.equal(beforePanel.panel,0);assert.equal(beforePanel.background.moves,0);assert.equal(beforePanel.background.parentAccessDenied,true);
  await page.mouse.move(580,70);assert.ok(await panel.evaluate(()=>moves)>0);assert.equal(await background.evaluate(()=>moves),0);
  results.browser={browser:await browser.version(),...beforePanel,panelReceivesOwnPointerOnly:true,noOverlay:true,limit:"Real browser document isolation; the parent is a fixture, not Owlbear. Short timer observation cannot promise hidden-tab 60 FPS."};
  await page.close();
} finally { await browser?.close();await new Promise(resolve=>host.close(resolve));await new Promise(resolve=>child.close(resolve)); }
writeFileSync(join(out,"results.json"),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));console.log("Cursor/follow probe PASS. Research artifacts: "+out);
