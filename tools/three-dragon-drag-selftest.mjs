#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "rolldown";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "three-dragon-drag-"));
const sources = ["extensions/three-dragon-ante/src/game/interaction/drag-controller.ts", "extensions/three-dragon-ante/src/game/stage/types.ts", "tools/three-dragon-drag-selftest.entry.ts", "tools/three-dragon-drag-selftest.mjs"];
const pins = () => Object.fromEntries(sources.map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
const before = pins();
await build({ input: resolve("tools/three-dragon-drag-selftest.entry.ts"), platform: "browser", output: { file: join(out, "app.js"), format: "esm", codeSplitting: false } });
const html = `<!doctype html><style>body{margin:0;background:#112029;color:#eee;font:16px system-ui}#stage{position:relative;width:850px;height:600px;touch-action:none;user-select:none}aside{position:absolute;border:2px dashed #718b97;text-align:center;padding-top:20px;box-sizing:border-box}.card{border-style:solid;background:#20383c}#ghost{position:absolute;left:10px;top:15px}h1{font-size:16px;position:absolute;top:65px;left:95px}</style><main id="stage" tabindex="0"><h1>Input harness — own ante / flight, opponent zones, no gameplay renderer</h1><div id="ghost"></div><aside style="left:90px;top:180px;width:195px;height:150px">Own ante</aside><aside style="left:310px;top:180px;width:195px;height:150px">Own flight</aside><aside class="card" style="left:540px;top:180px;width:110px;height:150px">Opponent public card</aside><aside style="left:675px;top:180px;width:125px;height:150px">Other ante</aside><aside class="card" style="left:50px;top:410px;width:110px;height:130px">Black 3</aside><aside class="card" style="left:175px;top:410px;width:110px;height:130px">Gold 13</aside></main><script type="module" src="/app.js"></script>`;
const server = createServer((req,res) => { res.setHeader("Content-Type",req.url === "/app.js" ? "application/javascript" : "text/html");res.end(req.url === "/app.js" ? readFileSync(join(out,"app.js")) : html); });
for(;;){try{await new Promise((done,fail)=>{const error=e=>{server.off("listening",listen);fail(e);};const listen=()=>{server.off("error",error);done();};server.once("error",error);server.once("listening",listen);server.listen(20000+Math.floor(Math.random()*30000),"127.0.0.1");});break;}catch(e){if(e.code!=="EADDRINUSE")throw e;}}
const browser = await chromium.launch({headless:true,channel:"msedge"});
const results = [], errors = [];
try {
  const page = await browser.newPage({viewport:{width:900,height:650},hasTouch:true});
  page.on("pageerror", e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.dragAudit);
  const cdp = await page.context().newCDPSession(page);
  const snap = () => page.evaluate(()=>window.dragAudit.snapshot());
  const reset = patch => page.evaluate(p=>window.dragAudit.reset(p),patch ?? {});
  const start = async()=>{await page.mouse.move(100,460);await page.mouse.down();};
  const moving = async()=>{await start();await page.mouse.move(160,350);await page.waitForTimeout(35);};
  const mark = label => {results.push(label);console.log(`PASS ${results.length}: ${label}`);};
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent",{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:1,radiusY:1,force:1}))});
  await moving();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide")));
  assert.equal((await snap()).log.cancels,1,"Pagehide cancels immediately before a pointerup can mask the failure");await page.mouse.up();assert.equal((await snap()).log.cancels,1);assert.equal((await snap()).log.drops.length,0);mark("pagehide cancels without a false drop");

  await reset();await start();await page.mouse.up();
  assert.deepEqual((await snap()).log.inspections,[{cardId:"black-3",pinned:true}]);assert.equal((await snap()).log.drops.length,0);
  await page.mouse.click(590,240);assert.equal((await snap()).log.inspections.at(-1).cardId,"white-5");mark("tap inspects own hand and public cards without submission");

  for(const [kind,x,zone] of [["ante",180,"ante"],["play",400,"flight"]]){
    await reset({kind});await start();await page.mouse.move(x,240);await page.mouse.up();await page.waitForTimeout(35);
    const s=await snap();assert.equal(s.log.drops.length,1);assert.deepEqual(s.log.drops[0],{tableId:"table",gameId:"game",seatId:"self",revision:1,kind,cardId:"black-3",zone});assert.equal(s.log.cancels,0);
    assert.ok(s.log.trusted>=3);assert.equal(s.captured.length,0);
  }mark("native captured mouse drops once into each legal own zone");

  for(const [x,y] of [[400,240],[730,240],[830,570],[550,100]]){
    await reset();await moving();await page.mouse.move(x,y);await page.mouse.up();const s=await snap();assert.equal(s.log.drops.length,0);assert.equal(s.log.cancels,1);
  }mark("wrong zone, opponent zone, public ownerless ante and outside drop all return the card");

  await reset();await page.evaluate(()=>window.dragAudit.submit(false));await moving();await page.mouse.move(180,240);await page.mouse.up();
  assert.equal((await snap()).log.drops.length,1);assert.equal((await snap()).log.cancels,1);mark("local submission rejection returns drag; true is only submission, no invented acceptance");

  await reset();await moving();await page.evaluate(()=>window.dragAudit.patch({revision:9}));await page.mouse.move(180,240);await page.mouse.up();
  assert.equal((await snap()).log.drops[0].revision,9);assert.equal((await snap()).log.cancels,0);mark("concurrent legal ante uses newest revision without cancelling the same intent");

  for(const patch of [{tableId:"new-table"},{gameId:"new-game"},{seatId:"new-seat"},{kind:"play"},{locked:true},{legalCardIds:["gold-13"]},{scopeId:"new-page"}]){
    await reset({scopeId:"page"});await moving();await page.evaluate(p=>window.dragAudit.patch(p),patch);await page.mouse.move(180,240);await page.mouse.up();
    assert.equal((await snap()).log.drops.length,0,`No cross-identity/illegal drop: ${JSON.stringify(patch)}`);assert.equal((await snap()).log.cancels,1);
  }mark("in-place identity/kind/permission/scope changes cancel moving input");

  for(const patch of [{gameId:"new-game"},{locked:true},{legalCardIds:[]}]){
    await reset();await start();await page.evaluate(p=>window.dragAudit.patch(p),patch);await page.mouse.up();assert.equal((await snap()).log.inspections.length,0,"Obsolete pre-drag press cannot inspect stale card");assert.equal((await snap()).log.drops.length,0);
  }mark("refresh also invalidates a held tap before it starts moving");

  await reset({kind:null,legalCardIds:[]});await start();await page.mouse.up();assert.equal((await snap()).log.inspections.length,1);
  await start();await page.mouse.move(180,240);await page.mouse.up();assert.equal((await snap()).log.drops.length,0);mark("out-of-turn cards remain inspectable but cannot be dragged into play");

  for(const reason of ["blur","lost","escape","pointercancel"]){
    await reset();await moving();
    if(reason==="lost")await page.evaluate(()=>window.dragAudit.release());
    else if(reason==="escape")await page.keyboard.press("Escape");
    else await page.evaluate(r=>r==="blur"?window.dispatchEvent(new Event("blur")):document.querySelector("#stage").dispatchEvent(new PointerEvent("pointercancel",{pointerId:window.dragAudit.snapshot().log.pointerIds.at(-1),bubbles:true})),reason);
    await page.mouse.up();const s=await snap();assert.equal(s.log.drops.length,0);assert.equal(s.log.cancels,1,`${reason} cancels once`);assert.equal(s.log.hovers.at(-1),null);
  }mark("blur, actual lost capture, Escape and cancel clean up exactly once");

  await reset();await touch("touchStart",[[1,100,460]]);await page.waitForTimeout(460);
  assert.equal((await snap()).log.inspections.length,1,"Touch long press inspects once");
  await touch("touchMove",[[1,180,240]]);await touch("touchEnd",[]);
  assert.equal((await snap()).log.drops.length,0,"Long press inspection cannot turn into a later accidental drop");assert.equal((await snap()).log.inspections.length,1);mark("trusted touch long-press inspects once and consumes that gesture");

  await reset();await touch("touchStart",[[1,100,460]]);await touch("touchMove",[[1,160,350]]);await page.waitForTimeout(35);
  await touch("touchStart",[[1,160,350],[2,250,460]]);await touch("touchMove",[[1,180,240],[2,250,460]]);await touch("touchEnd",[]);
  assert.equal((await snap()).log.drops.length,0,"Second touch cancels the first drag, never commits a pinch");assert.equal((await snap()).log.cancels,1);mark("two real simultaneous touch contacts cancel single-card dragging");

  await reset();await touch("touchStart",[[1,100,460]]);await page.evaluate(()=>window.dragAudit.patch({gameId:"changed-before-longpress"}));await page.waitForTimeout(460);await touch("touchEnd",[]);
  assert.equal((await snap()).log.inspections.length,0);assert.equal((await snap()).log.drops.length,0);mark("invalidated long-press timer never opens an old game's card");

  await reset();await start();await page.evaluate(()=>window.dragAudit.burst(250));await page.waitForTimeout(40);
  const coalesced=await snap();assert.equal(coalesced.log.drags.length,1,"A burst of pointer moves has one visual frame update");assert.equal(coalesced.log.drags[0].value.x,164.9);
  await page.evaluate(()=>{window.dragAudit.burst(250);const id=window.dragAudit.snapshot().log.pointerIds.at(-1);document.querySelector("#stage").dispatchEvent(new PointerEvent("pointerup",{pointerId:id,pointerType:"mouse",isPrimary:true,clientX:180,clientY:240,bubbles:true}));});
  await page.waitForTimeout(40);await page.mouse.up();const finalBurst=await snap();assert.equal(finalBurst.log.drops.length,1);assert.equal(finalBurst.log.drags.length,2,"Up flush cancels queued RAF; no visual update after submission");mark("250 moves coalesce; final pointerup flush has no delayed duplicate visual");

  await reset();await page.evaluate(()=>window.dragAudit.captureFailure(true));await start();await page.mouse.move(180,240);await page.mouse.up();
  assert.equal((await snap()).log.drops.length,0,"Failed capture cannot leave an active half-drag");
  await reset();await moving();await page.evaluate(()=>window.dragAudit.releaseFailure(true));await page.evaluate(()=>window.dispatchEvent(new Event("blur")));await page.mouse.up();
  assert.equal((await snap()).log.cancels,1);assert.equal((await snap()).log.drops.length,0);mark("capture and release exceptions leave no stale drag or unhandled browser error");

  await reset();await moving();await page.evaluate(()=>window.dragAudit.destroy());await page.mouse.move(180,240);await page.mouse.up();await page.waitForTimeout(450);
  const destroyed=await snap();assert.equal(destroyed.log.cancels,1);assert.equal(destroyed.log.drops.length,0);const frozen=JSON.stringify(destroyed.log);
  await page.mouse.click(100,460);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide")));
  // Fixture's independent pointer recorder still runs; compare actual ports.
  const afterDestroy=await snap();assert.deepEqual(afterDestroy.log.drops,destroyed.log.drops);assert.deepEqual(afterDestroy.log.inspections,destroyed.log.inspections);assert.deepEqual(afterDestroy.log.drags,destroyed.log.drags);assert.deepEqual(afterDestroy.log.hovers,destroyed.log.hovers);mark("destroy cancels RAF/timer/capture and detaches input lifecycle callbacks");
  assert.deepEqual(errors,[]);assert.deepEqual(pins(),before,"Frozen source throughout run");
  writeFileSync(join(out,"result.json"),JSON.stringify({browser:browser.version(),checks:results,errors,sourcePins:before,scope:"Real Edge native mouse/touch and pointer capture with actual input module; injected lifecycle events and high-frequency move burst; hit-test/render/drop ports simulated. No actual 3D renderer, rules transport or Owlbear UAT."},null,2));
  console.log(`DRAG_INPUT ${results.length} groups PASS. Evidence: ${out}`);
}catch(error){writeFileSync(join(out,"failure.json"),JSON.stringify({error:String(error.stack),checks:results,errors,sourcePins:before},null,2));console.error(`Evidence: ${out}`);throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
