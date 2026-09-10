#!/usr/bin/env node
// Real default image, appearance control and creation functions. Native picker
// request encoding uses the installed SDK; all host messages remain simulated.
import assert from "node:assert/strict";
import { build } from "rolldown";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE??"C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root=resolve(tmpdir()),out=mkdtempSync(join(root,"portal-default-")),report=resolve(process.env.PORTAL_DEFAULT_REPORT_DIR??"../_audit/2026-09-09/portal-default-review");mkdirSync(report,{recursive:true});
const KEY="com.obr-suite/portals/default-image";
let browser,server;
const results=[],errors=[],requests=[];
const sourceFiles=["src/modules/portals/default-image.ts","src/modules/portals/appearance.ts","src/modules/portals/appearance-control.ts","src/modules/portals/index.ts","src/modules/portals/edit-page.ts","tools/portal-default-selftest.mjs","tools/fixtures/portal-default-sdk.ts"];
const sourcePins=()=>Object.fromEntries(sourceFiles.map(path=>[path,createHash("sha256").update(readFileSync(resolve(path))).digest("hex")]));
const startedPins=sourcePins();
const mutations={
 "old-preview-wins":["initialPreview === previewRevision","true"],
 "closed-tab-writes":["alive && section.isConnected && OBR.room.id === room","true"],
 "fallback-loop":["preview.getAttribute(\"src\") !== fallback","true"],
 "reuse-old-editor-instance":["currentEditInstance === request.instance && ","","index.ts"],
 "remote-editor-close":["msg.connectionId !== editorConnectionId","false","index.ts"],
};
const mutant=process.env.PORTAL_DEFAULT_MUTANT;let mutated=false;
try{
 const entry=join(out,"entry.ts");
 writeFileSync(entry,[
  'import {mountPortalDefault,resolveDefaultPortalImage,imageAvailable} from '+JSON.stringify(resolve("src/modules/portals/default-image.ts"))+';',
  'import {mountPortalAppearance} from '+JSON.stringify(resolve("src/modules/portals/appearance-control.ts"))+';',
  'import {__creationAudit} from '+JSON.stringify(resolve("src/modules/portals/index.ts"))+';',
  'window.portalDefaultAPI={mountPortalDefault,resolveDefaultPortalImage,imageAvailable,mountPortalAppearance,...__creationAudit};',
 ].join("\n"));
 await build({input:entry,platform:"browser",plugins:[{name:"portal-default-isolated-host",resolveId(id){
   if(["@owlbear-rodeo/sdk","../../state","../../asset-base","../../utils/panelLayout"].includes(id))return resolve("tools/fixtures/portal-default-sdk.ts");
 },transform(code,id){
   if(mutant&&id.replaceAll("\\","/").endsWith("/portals/"+(mutations[mutant]?.[2]??"default-image.ts"))){
     const [from,to]=mutations[mutant]??[];if(!from||code.split(from).length!==2)throw Error("Mutation must match exactly once");mutated=true;code=code.replace(from,to);
   }
   if(id.replaceAll("\\","/").endsWith("/modules/portals/index.ts"))return code+'\nexport const __creationAudit={createPortal,createLinkedPortalPair,openEditPopover,closeEditPopover,handleEditClose,handleDMSelectionForEdit,reanchorEditPopover,activate:()=>{portalEditorActive=true;portalEditorReady=true;role="GM";editorConnectionId="gm-connection";},invalidate:()=>{portalEffectEpoch++;void closeEditPopover();},teardownPortals};';
   return code;
 }}],output:{file:join(out,"page.js"),format:"iife"}});
 if(mutant&&!mutated)throw Error("Mutation not applied");
 server=createServer((req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;requests.push({method:req.method,path});
  if(path==="/page.js"){res.setHeader("content-type","text/javascript");res.end(readFileSync(join(out,"page.js")));}
  else if(path.endsWith(".svg")){if(path.includes("bad")){res.statusCode=404;res.end("missing");}else{res.setHeader("content-type","image/svg+xml");res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#537a8a"/><circle cx="200" cy="100" r="60" fill="#bfd5db"/></svg>');}}
  else{res.setHeader("content-type","text/html;charset=utf-8");res.end('<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;background:#20232d;color:white"><main id="host"></main><script src="/page.js"></script>');}
 });await new Promise(done=>server.listen(0,"127.0.0.1",done));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,channel:"msedge"});
 const art=name=>({url:base+'/'+name+'.svg',mime:"image/svg+xml",width:400,height:200});
 const item={id:"portal",type:"IMAGE",layer:"PROP",image:art("old"),grid:{dpi:400,offset:{x:200,y:100}},scale:{x:1.4,y:1.4},position:{x:10,y:20},rotation:17,locked:true,visible:true,metadata:{"com.obr-suite/portals/data":{radius:105,tag:"same",effect:"blink"}}};
 async function open(seed={}){const page=await browser.newPage({viewport:{width:380,height:540}});page.on("pageerror",e=>errors.push(e.message));await page.addInitScript(seed=>{window.portalDefaultSeed=seed;},seed);await page.goto(base);await page.waitForFunction(()=>window.portalDefaultAPI);await page.evaluate(()=>window.portalDefaultAPI.activate());return page;}
 async function mount(page,lang="en"){await page.evaluate(lang=>window.portalDefaultAPI.mountPortalDefault(document.getElementById("host"),lang),lang);}
 async function choose(page,image){await page.locator("[data-pick]").click();await page.waitForFunction(()=>window.portalDefaultMock.picker.length===1);await page.evaluate(image=>window.portalDefaultMock.picker.shift()({images:image?[{image}]:[]}),image);await page.waitForFunction(()=>!document.querySelector("[data-pick]").disabled);}
 async function test(name,run){let page;try{page=await open();await run(page);results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}finally{await page?.close();}}
 await test("installed SDK native picker is single-select with host timeout -1; preserves original image content",async page=>{
  await mount(page);await choose(page,art("selected"));
  const v=await page.evaluate(()=>window.portalDefaultMock);
  assert.deepEqual(v.native[0],{channel:"OBR_ASSETS_DOWNLOAD_IMAGES",data:{multiple:false,defaultSearch:undefined,typeHint:undefined},timeout:-1});assert.deepEqual(v.roomWrites,[{[KEY]:art("selected")}]);
  await page.screenshot({path:join(report,"default-image-en-380.png")});
 });
 await test("picker cancellation makes no room write",async page=>{await mount(page);await choose(page,null);assert.equal(await page.evaluate(()=>window.portalDefaultMock.roomWrites.length),0);});
 await test("reset writes null room default without changing scene items",async page=>{await mount(page);await page.locator("[data-reset]").click();await page.waitForFunction(()=>window.portalDefaultMock.roomWrites.length===1);assert.deepEqual(await page.evaluate(()=>window.portalDefaultMock.roomWrites),[{[KEY]:null}]);assert.equal(await page.evaluate(()=>window.portalDefaultMock.itemWrites.length),0);});
 for(const reason of ["tab","pagehide","role","room"])await test(reason+" during native picker prevents late room write",async page=>{
  await mount(page);await page.locator("[data-pick]").click();await page.waitForFunction(()=>window.portalDefaultMock.picker.length===1);
  await page.evaluate(reason=>{const m=window.portalDefaultMock;if(reason==="tab")document.querySelector(".portal-default-art").remove();if(reason==="pagehide")window.dispatchEvent(new Event("pagehide"));if(reason==="role")void m.player("PLAYER");if(reason==="room")m.roomId="other";},reason);
  await page.evaluate(image=>window.portalDefaultMock.picker.shift()({images:[{image}]}),art("selected"));await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.roomWrites.length),0);
  if(reason==="tab"||reason==="pagehide")assert.equal(await page.evaluate(()=>window.portalDefaultMock.count()),0);
 });
 await test("room write failure permits same-page retry with bilingual saved message",async page=>{
  await mount(page,"zh");await page.evaluate(()=>{window.portalDefaultMock.failWrite=true;});await choose(page,art("selected"));assert.match(await page.locator('[role="status"]').textContent(),/重试/);
  await page.evaluate(()=>{window.portalDefaultMock.failWrite=false;});await choose(page,art("selected"));assert.match(await page.locator('[role="status"]').textContent(),/已保存/);
  await page.screenshot({path:join(report,"default-image-zh-380.png")});
 });
 await test("media GET fallback and positive cache; no CORS HEAD probe",async page=>{
  const before=requests.length;
  await page.evaluate(({image,KEY})=>{window.portalDefaultMock.roomMeta={[KEY]:image};}, {image:art("available"),KEY});
  for(let i=0;i<2;i++)assert.deepEqual(await page.evaluate(()=>window.portalDefaultAPI.resolveDefaultPortalImage()),art("available"));
  assert.equal(requests.slice(before).filter(v=>v.path==="/available.svg").length,1);assert.ok(requests.slice(before).every(v=>v.method==="GET"));
  await page.evaluate(({image,KEY})=>{window.portalDefaultMock.roomMeta={[KEY]:image};},{image:art("bad"),KEY});
  const first=await page.evaluate(()=>window.portalDefaultAPI.resolveDefaultPortalImage());assert.ok(first.url.endsWith("/suite/portal-icon.svg"));
  const n=requests.filter(v=>v.path==="/bad.svg").length;await page.evaluate(()=>window.portalDefaultAPI.resolveDefaultPortalImage());assert.equal(requests.filter(v=>v.path==="/bad.svg").length,n);
 });
 await test("bounded media timeout falls back and invalid stored content does not fetch",async page=>{
  await page.route("**/never.svg",()=>{});
  await page.evaluate(({image,KEY})=>{window.portalDefaultMock.roomMeta={[KEY]:image};},{image:art("never"),KEY});
  const start=Date.now(),value=await page.evaluate(()=>window.portalDefaultAPI.resolveDefaultPortalImage());assert.ok(value.url.endsWith("/portal-icon.svg"));assert.ok(Date.now()-start<2500);
  await page.evaluate(KEY=>{window.portalDefaultMock.roomMeta={[KEY]:{url:"javascript:alert(1)",width:3,height:3,mime:"image/png"}};},KEY);
  assert.ok((await page.evaluate(()=>window.portalDefaultAPI.resolveDefaultPortalImage())).url.endsWith("/portal-icon.svg"));
 });
 await test("saved selection wins over late initial room-read preview",async page=>{
  await page.evaluate(()=>{window.portalDefaultMock.holdRoom=true;});await mount(page);await page.waitForFunction(()=>window.portalDefaultMock.roomReads.length===1);await choose(page,art("selected"));
  await page.evaluate(({KEY,image})=>window.portalDefaultMock.roomReads.shift()({[KEY]:image}),{KEY,image:art("old")});await page.waitForTimeout(120);
  assert.equal(await page.locator(".portal-default-art img").getAttribute("src"),art("selected").url);
  assert.deepEqual(await page.evaluate(KEY=>window.portalDefaultMock.roomMeta[KEY],KEY),art("selected"));
 });
 await test("each unavailable selected preview independently falls back",async page=>{
  await mount(page);await choose(page,art("bad-one"));await page.waitForTimeout(100);assert.ok((await page.locator(".portal-default-art img").getAttribute("src")).endsWith("/portal-icon.svg"));
  await choose(page,art("bad-two"));await page.waitForTimeout(100);assert.ok((await page.locator(".portal-default-art img").getAttribute("src")).endsWith("/portal-icon.svg"));
 });
 await test("unavailable bundled fallback stops after one attempt and reports unavailable preview",async page=>{
  let attempts=0;await page.route("**/suite/portal-icon.svg",async route=>{attempts++;await route.fulfill({status:404,body:"missing"});});
  await mount(page);await page.waitForTimeout(200);
  assert.equal(await page.locator(".portal-default-art img").isVisible(),false);assert.equal(attempts,1);assert.match(await page.locator('[role="status"]').textContent(),/unavailable/);
 });
 await test("concurrent default resolution shares a single actual media load",async page=>{
  const before=requests.filter(v=>v.path==="/concurrent.svg").length;
  await page.evaluate(({KEY,image})=>{window.portalDefaultMock.roomMeta={[KEY]:image};},{KEY,image:art("concurrent")});
  const values=await page.evaluate(()=>Promise.all([window.portalDefaultAPI.resolveDefaultPortalImage(),window.portalDefaultAPI.resolveDefaultPortalImage()]));
  assert.deepEqual(values,[art("concurrent"),art("concurrent")]);assert.equal(requests.filter(v=>v.path==="/concurrent.svg").length-before,1);
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.count()),0,"background resolver owns no player or scene subscriptions");
 });
 await test("cross-origin image without CORS headers is available through browser media loading",async page=>{
  const image={...art("cross-origin"),url:art("cross-origin").url.replace("127.0.0.1","localhost")};
  await page.evaluate(({KEY,image})=>{window.portalDefaultMock.roomMeta={[KEY]:image};},{KEY,image});
  assert.deepEqual(await page.evaluate(()=>window.portalDefaultAPI.resolveDefaultPortalImage()),image);
  assert.ok(requests.filter(v=>v.path==="/cross-origin.svg").every(v=>v.method==="GET"));
 });
 await test("late role read cannot override a role event before default write",async page=>{
  await mount(page);await page.evaluate(()=>{window.portalDefaultMock.holdRole=true;});await page.locator("[data-pick]").click();
  await page.evaluate(image=>window.portalDefaultMock.picker.shift()({images:[{image}]}),art("selected"));await page.waitForFunction(()=>window.portalDefaultMock.roles.length===1);
  await page.evaluate(()=>window.portalDefaultMock.player("PLAYER"));await page.evaluate(()=>window.portalDefaultMock.roles.shift()("GM"));await page.waitForTimeout(60);
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.roomWrites.length),0);
 });
 await test("appearance reset reads room artwork and changes only image/grid/scale",async page=>{
  await page.evaluate(({item,KEY,image})=>{const m=window.portalDefaultMock;m.item=item;m.roomMeta={[KEY]:image};window.appearance=window.portalDefaultAPI.mountPortalAppearance(document.getElementById("host"),"portal","en");},{item,KEY,image:art("selected")});
  await page.waitForFunction(()=>!document.querySelector(".portal-art-reset").disabled);await page.locator(".portal-art-reset").click();await page.waitForFunction(()=>window.portalDefaultMock.itemWrites.length===1);
  const next=await page.evaluate(()=>window.portalDefaultMock.item),omit=({image,grid,scale,...rest})=>rest;assert.deepEqual(omit(next),omit(item));assert.equal(next.image.url,art("selected").url);
  await page.evaluate(()=>window.appearance.dispose());assert.equal(await page.evaluate(()=>window.portalDefaultMock.count()),0);
 });
 await test("appearance reset waiting for default respects scene invalidation",async page=>{
  await page.evaluate(item=>{const m=window.portalDefaultMock;m.item=item;m.holdRoom=true;window.appearance=window.portalDefaultAPI.mountPortalAppearance(document.getElementById("host"),"portal","en");},item);
  await page.waitForFunction(()=>!document.querySelector(".portal-art-reset").disabled);await page.locator(".portal-art-reset").click();await page.waitForFunction(()=>window.portalDefaultMock.roomReads.length===1);
  await page.evaluate(()=>window.portalDefaultMock.scene(false));await page.evaluate(({KEY,image})=>window.portalDefaultMock.roomReads.shift()({[KEY]:image}),{KEY,image:art("selected")});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.itemWrites.length),0);
 });
 await test("actual single and pair creation use identical selected artwork with linked tags",async page=>{
  await page.evaluate(({KEY,image})=>{window.portalDefaultMock.roomMeta={[KEY]:image};},{KEY,image:art("selected")});
  await page.evaluate(()=>window.portalDefaultAPI.createPortal({x:5,y:10},70));await page.evaluate(()=>window.portalDefaultAPI.createLinkedPortalPair({x:10,y:10},{x:90,y:90}));
  const added=await page.evaluate(()=>window.portalDefaultMock.adds);assert.equal(added.length,2);assert.equal(added[0][0].image.url,art("selected").url);
  assert.equal(added[1].length,2);assert.ok(added[1].every(v=>v.image.url===art("selected").url));assert.equal(added[1][0].metadata["com.obr-suite/portals/data"].tag,added[1][1].metadata["com.obr-suite/portals/data"].tag);
 });
 for(const kind of ["createPortal","createLinkedPortalPair"])await test(kind+" cancels after default loading when scene generation changes",async page=>{
  await page.evaluate(kind=>{const m=window.portalDefaultMock;m.holdRoom=true;window.creating=kind==="createPortal"?window.portalDefaultAPI.createPortal({x:5,y:10},70):window.portalDefaultAPI.createLinkedPortalPair({x:0,y:0},{x:90,y:90});},kind);
  await page.waitForFunction(()=>window.portalDefaultMock.roomReads.length===1);await page.evaluate(()=>window.portalDefaultAPI.invalidate());
  await page.evaluate(({KEY,image})=>window.portalDefaultMock.roomReads.shift()({[KEY]:image}),{KEY,image:art("selected")});await page.evaluate(()=>window.creating);assert.equal(await page.evaluate(()=>window.portalDefaultMock.adds.length),0);
 });
 await test("late single-portal add acknowledgement does not open an old editor after scene change",async page=>{
  await page.evaluate(()=>{window.portalDefaultMock.holdAdd=true;window.creating=window.portalDefaultAPI.createPortal({x:5,y:10},70);});
  await page.waitForFunction(()=>window.portalDefaultMock.pendingAdds.length===1);
  await page.evaluate(()=>{window.portalDefaultAPI.invalidate();window.portalDefaultMock.pendingAdds.shift()();});await page.evaluate(()=>window.creating);
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.popovers.length),0);
 });
 await test("scene changes during editor viewport read prevent an old editor open",async page=>{
  await page.evaluate(()=>{window.portalDefaultMock.holdViewport=true;window.opening=window.portalDefaultAPI.openEditPopover("portal",true);});
  await page.waitForFunction(()=>window.portalDefaultMock.viewports.length===1);await page.evaluate(()=>{window.portalDefaultAPI.invalidate();window.portalDefaultMock.viewports.shift()();});
  await page.evaluate(()=>window.opening);assert.equal(await page.evaluate(()=>window.portalDefaultMock.popovers.length),0);
 });
 await test("editor role revocation after a viewport await blocks native open",async page=>{
  await page.evaluate(()=>{window.portalDefaultMock.holdViewport=true;window.opening=window.portalDefaultAPI.openEditPopover("portal",true);});
  await page.waitForFunction(()=>window.portalDefaultMock.viewports.length===1);await page.evaluate(()=>{window.portalDefaultMock.role="PLAYER";window.portalDefaultMock.viewports.shift()();});
  await page.evaluate(()=>window.opening);assert.equal(await page.evaluate(()=>window.portalDefaultMock.popovers.length),0);
 });
 await test("pending old editor open is followed by its close before a newer editor opens",async page=>{
  await page.evaluate(()=>{const m=window.portalDefaultMock;m.holdOpen=true;window.first=window.portalDefaultAPI.openEditPopover("old",true);});await page.waitForFunction(()=>window.portalDefaultMock.pendingOpens.length===1);
  await page.evaluate(()=>{window.second=window.portalDefaultAPI.openEditPopover("new",true);});await page.waitForTimeout(40);
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.popoverRequests.filter(v=>v.kind==="open").length),1);
  await page.evaluate(()=>{const m=window.portalDefaultMock;m.holdOpen=false;m.pendingOpens.shift()();});await page.evaluate(()=>Promise.all([window.first,window.second]));
  const calls=await page.evaluate(()=>window.portalDefaultMock.popoverRequests);
  assert.deepEqual(calls.map(v=>v.kind),["open","close","open"]);assert.ok(calls[2].options.url.includes("id=new"));
 });
 await test("new editor intent waits for old close ACK without being cleared by it",async page=>{
  await page.evaluate(()=>window.portalDefaultAPI.openEditPopover("old",true));
  await page.evaluate(()=>{window.portalDefaultMock.holdClose=true;window.closing=window.portalDefaultAPI.closeEditPopover();});await page.waitForFunction(()=>window.portalDefaultMock.pendingCloses.length===1);
  await page.evaluate(()=>{window.next=window.portalDefaultAPI.openEditPopover("new",true);});await page.waitForTimeout(40);assert.equal(await page.evaluate(()=>window.portalDefaultMock.popovers.length),1);
  await page.evaluate(()=>{window.portalDefaultMock.holdClose=false;window.portalDefaultMock.pendingCloses.shift()();});await page.evaluate(()=>Promise.all([window.closing,window.next]));
  assert.ok((await page.evaluate(()=>window.portalDefaultMock.popovers.at(-1).url)).includes("id=new"));
 });
 await test("editor native close failure keeps exact ownership for retry",async page=>{
  await page.evaluate(()=>window.portalDefaultAPI.openEditPopover("old",true));await page.evaluate(()=>{window.portalDefaultMock.failClose=true;});
  const instance=new URL(await page.evaluate(()=>window.portalDefaultMock.popovers.at(-1).url)).searchParams.get("instance");
  await page.evaluate(()=>window.portalDefaultAPI.closeEditPopover());assert.equal(await page.evaluate(()=>window.portalDefaultMock.closed.length),0);assert.ok(await page.evaluate(()=>window.portalDefaultMock.notices.length)>0);
  await page.evaluate(()=>window.portalDefaultAPI.invalidate());await page.waitForFunction(()=>window.portalDefaultMock.notices.length>=2);
  await page.evaluate(()=>{window.portalDefaultMock.failClose=false;});await page.evaluate(instance=>window.portalDefaultAPI.handleEditClose({connectionId:"gm-connection",data:{id:"old",instance}}),instance);assert.equal(await page.evaluate(()=>window.portalDefaultMock.closed.length),1);
 });
 await test("old same-token editor instance and remote close cannot close current editor",async page=>{
  await page.evaluate(()=>window.portalDefaultAPI.openEditPopover("same",true));const first=new URL(await page.evaluate(()=>window.portalDefaultMock.popovers.at(-1).url)).searchParams.get("instance");
  await page.evaluate(()=>window.portalDefaultAPI.closeEditPopover());await page.evaluate(()=>window.portalDefaultAPI.openEditPopover("same",true));const second=new URL(await page.evaluate(()=>window.portalDefaultMock.popovers.at(-1).url)).searchParams.get("instance");assert.notEqual(first,second);
  await page.evaluate(instance=>window.portalDefaultAPI.handleEditClose({connectionId:"gm-connection",data:{id:"same",instance}}),first);
  await page.evaluate(instance=>window.portalDefaultAPI.handleEditClose({connectionId:"other-connection",data:{id:"same",instance}}),second);
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.closed.length),1);
  await page.evaluate(instance=>window.portalDefaultAPI.handleEditClose({connectionId:"gm-connection",data:{id:"same",instance}}),second);assert.equal(await page.evaluate(()=>window.portalDefaultMock.closed.length),2);
 });
 await test("teardown reports native editor close failure and retries ownership",async page=>{
  await page.evaluate(()=>window.portalDefaultAPI.openEditPopover("old",true));await page.evaluate(()=>{window.portalDefaultMock.failClose=true;});
  const error=await page.evaluate(()=>window.portalDefaultAPI.teardownPortals().then(()=>"",e=>e.message));assert.match(error,/cleanup failed/);
  await page.evaluate(()=>{window.portalDefaultMock.failClose=false;});await page.evaluate(()=>window.portalDefaultAPI.teardownPortals());
  assert.equal(await page.evaluate(()=>window.portalDefaultMock.closed.filter(v=>v==="com.obr-suite/portals/edit-popover").length),1);
 });
 await test("close then reopen the same token while old open awaits ACK creates a fresh instance",async page=>{
  await page.evaluate(()=>{window.portalDefaultMock.holdOpen=true;window.old=window.portalDefaultAPI.openEditPopover("same",true);});await page.waitForFunction(()=>window.portalDefaultMock.pendingOpens.length===1);
  const first=new URL(await page.evaluate(()=>window.portalDefaultMock.popoverRequests[0].options.url)).searchParams.get("instance");
  await page.evaluate(()=>{window.closeOld=window.portalDefaultAPI.closeEditPopover();window.new=window.portalDefaultAPI.openEditPopover("same",true);window.portalDefaultMock.holdOpen=false;window.portalDefaultMock.pendingOpens.shift()();});
  await page.evaluate(()=>Promise.all([window.old,window.closeOld,window.new]));
  const calls=await page.evaluate(()=>window.portalDefaultMock.popoverRequests);assert.deepEqual(calls.map(v=>v.kind),["open","close","open"]);
  const second=new URL(calls[2].options.url).searchParams.get("instance");assert.notEqual(first,second);
  await page.evaluate(instance=>window.portalDefaultAPI.handleEditClose({connectionId:"gm-connection",data:{id:"same",instance}}),second);assert.equal(await page.evaluate(()=>window.portalDefaultMock.closed.length),2);
 });
 await test("layout event cannot revive an old scene editor while its close ACK is pending",async page=>{
  await page.evaluate(()=>window.portalDefaultAPI.openEditPopover("old",true));await page.evaluate(()=>{window.portalDefaultMock.holdClose=true;window.portalDefaultAPI.invalidate();});await page.waitForFunction(()=>window.portalDefaultMock.pendingCloses.length===1);
  await page.evaluate(()=>window.portalDefaultAPI.reanchorEditPopover());assert.equal(await page.evaluate(()=>window.portalDefaultMock.popovers.length),1);
  await page.evaluate(()=>{window.portalDefaultMock.holdClose=false;window.portalDefaultMock.pendingCloses.shift()();});await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.portalDefaultMock.popovers.length),1);
  await page.evaluate(()=>window.portalDefaultAPI.openEditPopover("new",true));await page.evaluate(()=>window.portalDefaultAPI.reanchorEditPopover());
  assert.ok((await page.evaluate(()=>window.portalDefaultMock.popovers.at(-1).url)).includes("id=new"));
 });
 assert.deepEqual(sourcePins(),startedPins,"Product/test sources changed during the run; this cannot be sealed validation");
 writeFileSync(join(report,"result.json"),JSON.stringify({sourcePins:startedPins,mutation:mutant??null,results,errors,requests,scope:"Real code + installed AssetsApi/ImageBuilder; fake host, no room writes; index test exposure changes exports only in isolated bundle. activate replaces full module setup; it does not test all native tool registration."},null,2));
 console.log("PORTAL_DEFAULT "+results.filter(v=>v.pass).length+"/"+results.length+"; "+report);for(const failure of results.filter(v=>!v.pass))console.log("FAIL "+failure.name+": "+failure.error);
 assert.deepEqual(errors,[]);assert.ok(results.every(v=>v.pass),"portal default regressions above");
}finally{await browser?.close();await new Promise(done=>server?server.close(done):done());if(dirname(out)!==root)throw Error("Unexpected test path");rmSync(out,{recursive:true,force:true});}
if(process.argv.includes("--mutants"))for(const name of Object.keys(mutations)){
 const childDir=mkdtempSync(join(report,"mutation-"+name+"-"));
 const result=spawnSync(process.execPath,[process.argv[1]],{encoding:"utf8",timeout:60000,env:{...process.env,PORTAL_DEFAULT_MUTANT:name,PORTAL_DEFAULT_REPORT_DIR:childDir}});
 writeFileSync(join(report,name+".log"),(result.stdout??"")+"\n"+(result.stderr??""));
 if(result.error||result.signal||result.status===0||!result.stderr.includes("AssertionError"))throw Error("Invalid or survived mutation "+name+": "+result.stderr);
 const child=JSON.parse(readFileSync(join(childDir,"result.json"),"utf8"));
 assert.deepEqual(child.sourcePins,startedPins,"Mutation must use the same frozen product and test sources");assert.deepEqual(child.errors,[]);
 const expected={"old-preview-wins":["saved selection wins"],"closed-tab-writes":["tab during","pagehide during","room during"],"fallback-loop":["unavailable bundled"],"reuse-old-editor-instance":["close then reopen"],"remote-editor-close":["old same-token"]}[name];
 const failed=child.results.filter(v=>!v.pass);assert.ok(failed.length>0 && failed.every(v=>expected.some(prefix=>v.name.startsWith(prefix))),"Unexpected mutation failure is not valid regression evidence");
 console.log("REJECTED: "+name);
}
