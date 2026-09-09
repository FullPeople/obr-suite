#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "rolldown";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const require=createRequire(import.meta.url);
const {chromium}=require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out=mkdtempSync(join(tmpdir(),"cluster-row-sync-"));
const sourceFiles=["src/state.ts","src/cluster-row.ts","src/settings.ts","tools/fixtures/cluster-row-sync-sdk.ts","tools/cluster-row-sync-selftest.entry.ts","tools/cluster-row-sync-selftest.mjs"];
const pins=()=>Object.fromEntries(sourceFiles.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
const before=pins();
const mutation=process.env.CLUSTER_SYNC_MUTANT;
let mutated=false;
await build({input:resolve("tools/cluster-row-sync-selftest.entry.ts"),platform:"browser",plugins:[{name:"two-document-sdk",resolveId(id,importer){
  if(id==="@owlbear-rodeo/sdk")return resolve("tools/fixtures/cluster-row-sync-sdk.ts");
  if(id==="./modules/bubbles"&&importer?.replaceAll("\\","/").endsWith("/src/settings.ts"))return "\0unused-repair";
},load(id){if(id==="\0unused-repair")return "export async function repairLegacyHiddenBubbles(){return 0;}";},transform(code,id){
  if(mutation==="missing-local-subscription"&&id.replaceAll("\\","/").endsWith("/src/state.ts")){
    const from="  OBR.broadcast.onMessage?.(BROADCAST_STATE_CHANGED, requestRefresh);";assert.equal(code.split(from).length,2);code=code.replace(from,"");mutated=true;
  }
  if(mutation==="stale-initial-role"&&id.replaceAll("\\","/").endsWith("/src/cluster-row.ts")){
    const from="      if (!rowAlive || revision !== roleRevision) return;";assert.equal(code.split(from).length,2);code=code.replace(from,"");mutated=true;
  }
  return code.replaceAll("import.meta.env.BASE_URL",'"/"');
}}],output:{dir:out,entryFileNames:"entry.js",format:"esm"}});
if(mutation&&!mutated)throw Error("Mutation was not applied");
const hostScript=`window.syncHost={metadata:{'com.obr-suite/state':{enabled:{timeStop:true,focus:true,musicBoard:true,transitions:true,bestiary:true,characterCards:true}}},roomMetadata:{},role:'GM',ready:true,clients:{},reads:{row:0,settings:0},sent:[],dropSceneFor:['row'],delayRowRole:false,failWrite:false,
emitScene(){for(const [name,c]of Object.entries(this.clients))if(!this.dropSceneFor.includes(name))for(const fn of c.scene)fn(structuredClone(this.metadata));},
emitRoom(){for(const c of Object.values(this.clients))for(const fn of c.room)fn(structuredClone(this.roomMetadata));},
broadcast(channel,data){for(const c of Object.values(this.clients))for(const fn of c.channels.get(channel)||[])fn({connectionId:'local-connection',data:structuredClone(data)});},
changeRole(role){this.role=role;for(const c of Object.values(this.clients))for(const fn of c.player)fn({role,id:'local-player',connectionId:'local-connection'});},
sceneReady(ready){this.ready=ready;for(const c of Object.values(this.clients))for(const fn of c.ready)fn(ready);}};localStorage.setItem('obr-suite/lang','en');`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,"http://local").pathname;
  if(path.endsWith(".js")){res.setHeader("Content-Type","application/javascript");try{res.end(readFileSync(join(out,path.slice(1))));}catch{res.statusCode=404;res.end();}}
  else if(path.endsWith("announcement.md")){res.end("# Test announcement\n");}
  else if(path==="/host"){res.setHeader("Content-Type","text/html");res.end(`<!doctype html><style>body{margin:0;background:#15161c}iframe{border:0;width:100%;display:block}#row{height:72px}#settings{height:760px}</style><script>${hostScript}</script><iframe id="row" src="/cluster-row"></iframe><iframe id="settings" src="/settings"></iframe>`);}
  else{const name=path.includes("cluster-row")?"cluster-row":"settings";res.setHeader("Content-Type","text/html;charset=utf-8");res.end(readFileSync(`${name}.html`,"utf8").replace(`/src/${name}.ts`,"/entry.js"));}
});
for(;;){try{await new Promise((done,fail)=>{const error=e=>{server.off("listening",listen);fail(e);};const listen=()=>{server.off("error",error);done();};server.once("error",error);server.once("listening",listen);server.listen(20000+Math.floor(Math.random()*30000),"127.0.0.1");});break;}catch(e){if(e.code!=="EADDRINUSE")throw e;}}
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:"msedge"});
const checks=[],errors=[];
try{
  const page=await browser.newPage({viewport:{width:1050,height:850}});page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>route.request().url().startsWith(base)?route.continue():route.fulfill({status:200,contentType:"application/json",body:"{}"}));
  await page.goto(`${base}/host`);
  const row=page.frameLocator("#row"),settings=page.frameLocator("#settings");
  await row.locator("#btnMusic").waitFor();await row.locator("#btnTransitions").waitFor();await settings.locator('[data-tab="musicBoard"]').waitFor();
  const rowNonce=await page.evaluate(()=>document.querySelector("#row").contentWindow.mountNonce);
  const mark=label=>{checks.push(label);console.log(`PASS ${checks.length}: ${label}`);};
  for(const [module,button] of [["musicBoard","btnMusic"],["transitions","btnTransitions"],["timeStop","btnTimeStop"],["focus","btnFocus"],["bestiary","btnBestiaryPopup"],["characterCards","btnCharCardPopup"]]){
    await settings.locator(`[data-tab="${module}"]`).click();await settings.locator(`.tog[data-mod="${module}"]`).click();
    // The parent intentionally drops every scene event for the row iframe.
    await page.waitForFunction(id=>!document.querySelector("#row").contentDocument.getElementById(id),button,{timeout:1800}).catch(()=>{throw Error(`LOCAL module disable did not remove ${button} without reopening`);});
    await settings.locator(`.tog[data-mod="${module}"]`).click();await row.locator(`#${button}`).waitFor();
    assert.equal(await page.evaluate(()=>document.querySelector("#row").contentWindow.mountNonce),rowNonce);
  }
  mark("six module buttons immediately disappear/return through actual settings and row documents despite lost row metadata events");
  await page.screenshot({path:join(out,"settings-and-open-row.png")});
  await page.evaluate(()=>{const w=document.querySelector("#row").contentWindow;w.syncPort.holdNextRead=true;void w.syncState.refreshFromScene();});
  await page.waitForFunction(()=>document.querySelector("#row").contentWindow.syncPort.heldReads.length===1);
  await settings.locator('[data-tab="musicBoard"]').click();await settings.locator('.tog[data-mod="musicBoard"]').click();await page.waitForFunction(()=>!document.querySelector("#row").contentDocument.getElementById("btnMusic"));
  await page.evaluate(()=>document.querySelector("#row").contentWindow.syncPort.heldReads.shift()());await page.waitForTimeout(80);
  assert.equal(await row.locator("#btnMusic").count(),0,"Delayed old read cannot restore disabled music");mark("new LOCAL hint invalidates delayed old scene read");
  await settings.locator('.tog[data-mod="musicBoard"]').click();await row.locator("#btnMusic").waitFor();

  await page.evaluate(()=>{const w=document.querySelector("#row").contentWindow;window.syncHost.broadcast('com.obr-suite/state-changed',{enabled:{musicBoard:false,transitions:false}});w.syncState.startSceneSync();w.syncState.startSceneSync();});
  await page.waitForTimeout(70);assert.equal(await row.locator("#btnMusic").count(),1);assert.equal(await row.locator("#btnTransitions").count(),1);
  assert.equal(await page.evaluate(()=>window.syncHost.clients.row.channels.get('com.obr-suite/state-changed').size),1);mark("broadcast payload cannot overwrite saved settings; sync subscription stays single");

  await page.evaluate(()=>{window.syncHost.sceneReady(false);window.syncHost.metadata={'com.obr-suite/state':{enabled:{musicBoard:false,transitions:false}}};window.syncHost.sceneReady(true);});
  await page.waitForFunction(()=>!document.querySelector("#row").contentDocument.getElementById("btnMusic")&&!document.querySelector("#row").contentDocument.getElementById("btnTransitions"));mark("scene-ready refreshes new settings even without a metadata event");

  await page.evaluate(()=>{window.syncHost.metadata={};window.syncHost.broadcast('com.obr-suite/state-changed',{});});
  await page.waitForFunction(()=>document.querySelector("#row").contentWindow.syncState.getState().enabled.musicBoard===true);
  const defaults=await page.evaluate(()=>document.querySelector("#row").contentWindow.syncState.getState());
  assert.equal(defaults.enabled.statusTracker,false);assert.equal(defaults.enabled.metadataInspector,false);assert.equal(defaults.enabled.circleImage,false);assert.equal(defaults.fogShareVision,true);
  await page.evaluate(()=>{window.syncHost.metadata={'com.obr-suite/state':{enabled:{statusTracker:true,metadataInspector:true,circleImage:true},fogShareVision:false}};window.syncHost.broadcast('com.obr-suite/state-changed',{});});
  await page.waitForFunction(()=>document.querySelector("#row").contentWindow.syncState.getState().fogShareVision===false);
  const saved=await page.evaluate(()=>document.querySelector("#row").contentWindow.syncState.getState());assert.equal(saved.enabled.statusTracker,true);assert.equal(saved.enabled.metadataInspector,true);assert.equal(saved.enabled.circleImage,true);mark("new missing-field defaults and explicitly saved module/vision values remain distinct");

  await page.evaluate(()=>{window.syncHost.metadata={'com.obr-suite/state':{enabled:{timeStop:true,focus:true,musicBoard:true,transitions:true,bestiary:true,characterCards:true}}};window.syncHost.broadcast('com.obr-suite/state-changed',{});window.syncHost.changeRole('PLAYER');});
  await page.waitForFunction(()=>!document.querySelector("#row").contentDocument.getElementById("btnTransitions"));assert.equal(await row.locator("#btnTimeStop,#btnFocus").count(),0);assert.equal(await row.locator("#btnMusic").count(),1);
  await page.evaluate(()=>window.syncHost.changeRole('GM'));await row.locator("#btnTransitions").waitFor();mark("live role changes remove/restore only GM buttons");

  // Keep settings alive while a new row's original GM read is held back.
  await page.evaluate(()=>{window.syncHost.delayRowRole=true;document.querySelector("#row").src='/cluster-row?role-race=1';});
  await page.waitForFunction(()=>window.syncHost.clients.row.roleReads.length===1);
  await page.evaluate(()=>window.syncHost.changeRole('PLAYER'));
  await page.evaluate(()=>window.syncHost.clients.row.roleReads.shift()());await page.waitForTimeout(100);
  assert.equal(await row.locator("#btnTransitions,#btnTimeStop,#btnFocus").count(),0,"Late initial GM role must not overwrite a newer PLAYER subscription");
  assert.equal(await row.locator("#btnMusic").count(),1);mark("role subscription precedes initial read and late GM result cannot restore forbidden buttons");
  await page.evaluate(()=>window.syncHost.changeRole('GM'));await row.locator("#btnTransitions").waitFor();

  const redraws=await page.evaluate(()=>{const w=document.querySelector("#settings").contentWindow;let reached=0;const a=w.syncState.onStateChange(()=>{throw Error('intentional subscriber failure');});const b=w.syncState.onStateChange(()=>{reached++;});w.testStops=[a,b];w.testNotices=()=>reached;return reached;});
  await settings.locator('[data-tab="musicBoard"]').click();await settings.locator('.tog[data-mod="musicBoard"]').click();await page.waitForFunction(()=>!document.querySelector("#row").contentDocument.getElementById("btnMusic"));
  assert.ok(await page.evaluate(()=>document.querySelector("#settings").contentWindow.testNotices())>redraws);await page.evaluate(()=>document.querySelector("#settings").contentWindow.testStops.forEach(fn=>fn()));mark("one failed subscriber does not block later listeners or cross-iframe broadcast");

  const closing=await page.evaluate(()=>{const w=document.querySelector("#row").contentWindow;w.syncPort.holdNextRead=true;void w.syncState.refreshFromScene();w.dispatchEvent(new PageTransitionEvent('pagehide'));return w.document.getElementById('row').innerHTML;});
  await page.evaluate(()=>{window.syncHost.changeRole('PLAYER');window.syncHost.metadata={'com.obr-suite/state':{enabled:{musicBoard:true}}};window.syncHost.broadcast('com.obr-suite/state-changed',{});document.querySelector("#row").contentWindow.syncPort.heldReads.shift()();});await page.waitForTimeout(100);
  assert.equal(await row.locator("#row").innerHTML(),closing,"Closed row must not render from late settings or role callbacks");mark("closed row ignores late reads and unsubscribes UI listeners");
  assert.deepEqual(errors,[]);assert.deepEqual(pins(),before,"Source freeze throughout two-page run");
  writeFileSync(join(out,"result.json"),JSON.stringify({browser:browser.version(),checks,sourcePins:before,errors,mutation:mutation??null,scope:"Actual settings.ts, cluster-row.ts, state.ts in separate live iframe documents; SDK host transport/metadata/roles simulated, including deliberate missed scene event. Not live Owlbear UAT."},null,2));
  console.log(`CLUSTER_ROW_SYNC ${checks.length} groups PASS. Evidence: ${out}`);
}catch(error){writeFileSync(join(out,"failure.json"),JSON.stringify({error:String(error.stack),checks,errors,sourcePins:before,mutation:mutation??null},null,2));console.error(`Evidence: ${out}`);throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
