#!/usr/bin/env node
// Actual production DOM/CSS in Chromium; only Owlbear SDK and language state
// are substituted. This cannot certify the real Owlbear renderer or room sync.
import { build } from "rolldown";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const outputRoot = resolve(tmpdir());
const out = mkdtempSync(join(outputRoot, "suite-transitions-ui-"));
const shots = resolve(process.env.TRANSITIONS_SCREENSHOT_DIR ?? "../_audit/2026-09-09/rest-cg-visual");
mkdirSync(shots, { recursive: true });
let browser, server;
try {
  for (const name of ["control", "display", "portal", "cg"]) {
    await build({ input: resolve(name === "cg" ? "src/timestop-overlay.ts" : name === "portal" ? "src/modules/portals/edit-page.ts" : `src/modules/transitions/${name}-page.ts`), platform: "browser", plugins: [{
      name: "transition-ui-fixture",
      resolveId(id, importer) {
        if (id === "@owlbear-rodeo/sdk") return resolve(name === "cg" ? "tools/fixtures/timestop-sdk.ts" : "tools/fixtures/transitions-sdk.ts");
        if (id === "../../state" && /\/modules\/(transitions|portals)\//.test(importer?.replaceAll("\\", "/") ?? "")) return resolve("tools/fixtures/transitions-state.ts");
      },
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith('/asset-base.ts')) return code.replaceAll('import.meta.env.BASE_URL', '"/"');
        if (id.replaceAll("\\", "/").endsWith(`/${name}-page.ts`)) return code.replace('import "./style.css";', "");
      },
    }], output: { file: join(out, `${name}.js`), format: "esm" } });
  }
  const css = readFileSync(resolve("src/modules/transitions/style.css"), "utf8");
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (["/control.js", "/display.js", "/portal.js", "/cg.js"].includes(path)) {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(readFileSync(join(out, path.slice(1))));
    } else if (path === "/cg") {
      response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
      response.end(readFileSync(resolve("timestop-overlay.html"), "utf8").replace('/src/timestop-overlay.ts', '/cg.js'));
    } else if (path === "/cg.svg") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#15263b"/><circle cx="850" cy="190" r="80" fill="#e2c18a"/><path d="M0 470 270 200 460 420 600 230 900 530 1100 300 1200 400V700H0" fill="#31495b"/><path d="M0 540 220 420 510 640 730 400 1000 570 1200 470V700H0" fill="#182f39"/><text x="40" y="660" font-family="sans-serif" font-size="22" fill="#cad3ce">Original test image / CG framing check</text></svg>');
    } else if (path === "/portal") {
      response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
      response.end(readFileSync(resolve("portal-edit.html"), "utf8").replace('/src/modules/portals/edit-page.ts', '/portal.js'));
    } else {
      const mode = path.includes("display") ? "display" : "control";
      response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
      response.end(`<!doctype html><meta charset="UTF-8"><style>${css}</style><body><div id="app"></div><script type="module" src="/${mode}.js"></script>`);
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const base = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  const checks = [];
  const clockSamples = [];
  const sourcePins = Object.fromEntries(["src/modules/transitions/style.css", "src/modules/transitions/art.ts", "tools/transitions-ui-selftest.mjs"].map(path => [path, createHash("sha256").update(readFileSync(resolve(path))).digest("hex")]));
  for (const [role, lang] of [["GM", "en"], ["GM", "zh"], ["PLAYER", "en"]]) {
    const page = await browser.newPage({ viewport: { width: 380, height: 500 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ role, lang }) => { window.__transitionInitialRole = role; window.__transitionInitialLang = lang; }, { role, lang });
    await page.goto(`${base}/control`);
    await page.locator("#heading").waitFor();
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#play").isVisible(), role === "GM");
    await page.locator('[data-kind="text"]').click();
    await page.locator("#custom").fill(lang === "zh" ? "翌日清晨，旅途继续。" : "The next morning, the journey continues.");
    await page.locator("#preview").click();
    const sent = await page.evaluate(() => window.__transitionFixture.sent.at(-1));
    assert.equal(sent.data.preview, true); assert.equal(sent.destination, "LOCAL");
    await page.evaluate((requestId) => window.__transitionFixture.emit("com.obr-suite/transitions/status", { requestId, ok: true, preview: true }), sent.data.requestId);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    const height = await page.locator(".control").evaluate((element) => Math.ceil(element.getBoundingClientRect().height));
    await page.setViewportSize({ width: 380, height });
    await page.screenshot({ path: join(shots, `control-${role.toLowerCase()}-${lang}.png`) });
    await page.close();
    checks.push(`control ${role} ${lang}: preview, permission, no overflow`);
  }
  const sample = async (page, fraction, duration) => {
    await page.evaluate(({fraction,duration}) => {
      for(const animation of document.getAnimations()) { animation.pause(); animation.currentTime=duration*fraction; }
    }, {fraction,duration});
    await page.waitForTimeout(30);
  };
  const opacity = (page, selector) => page.locator(selector).evaluate(el => Number(getComputedStyle(el).opacity));
  const box = (page, selector) => page.locator(selector).boundingBox();
  const angle = (page, selector) => page.locator(selector).evaluate(el => {
    const value=getComputedStyle(el).transform, matrix=new DOMMatrixReadOnly(value==="none"?undefined:value);
    return Math.round(Math.atan2(matrix.b,matrix.a)*180/Math.PI*100000)/100000;
  });
  for (const [kind, lang, reduced, width, height] of [
    ["short","zh",false,1280,800],["long","en",false,1280,800],["text","zh",false,1280,800],
    ["long","zh",false,390,844],["short","en",false,740,390],
    ["long","en",true,390,844],["text","en",true,390,844],["short","en",true,390,844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference" });
    page.on("pageerror", (error) => errors.push(error.message));
    const now = Date.now();
    const payload = { version: 1, id: crypto.randomUUID(), sceneKey: "visual", issuedAt: now, expiresAt: now + 12_000, kind,
      text: kind === "text" ? (lang === "zh" ? "翌日清晨，晨雾渐渐散去。\n旅人们收拾行囊，再一次踏上未知的旅途。" : "The morning mist begins to lift.\nThe journey continues.") : "", targets: "all", lang, reduced };
    await page.goto(`${base}/display#${encodeURIComponent(JSON.stringify(payload))}`);
    await page.locator(".rest-stage").waitFor();
    const duration=reduced?3400:kind==="long"?8800:kind==="short"?6000:5800;
    const filename=`rest-${kind}-${lang}-${width}${reduced?"-reduced":""}`;
    assert.deepEqual(await page.locator(".rest-stage").boundingBox(), {x:0,y:0,width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await sample(page,.05,duration); assert.ok(await opacity(page,".rest-veil")>0);
    if(!reduced) assert.equal(await opacity(page,kind==="long"?".rest-tent":".rest-fire"),0);
    if(kind==="long"){
      await sample(page,.32,duration);
      const moon=await box(page,".rest-moon"), tent=await box(page,".rest-tent");
      assert.ok(Math.abs(moon.x+moon.width/2-width/2)<2); assert.ok(moon.y<tent.y);
      assert.equal(await opacity(page,".moon-orbit"),1); assert.equal(await opacity(page,".sun-orbit"),0);
      await page.screenshot({path:join(shots,filename+"-moon.png")});
      if(!reduced){ await sample(page,.48,duration); const moving=await box(page,".rest-moon"); assert.ok(moving.x>moon.x && moving.y>moon.y); }
      await sample(page,.65,duration); assert.equal(await opacity(page,".moon-orbit"),0); assert.equal(await opacity(page,".sun-orbit"),1);
      const sun=await box(page,".rest-sun"); assert.ok(Math.abs(sun.x+sun.width/2-width/2)<2);
      await page.screenshot({path:join(shots,filename+"-sun.png")});
      if(!reduced){await sample(page,.82,duration);assert.ok((await box(page,".rest-sun")).y<sun.y);assert.ok((await box(page,".rest-tent")).y>tent.y);}
    }else{
      await sample(page,.4,duration); const fire=await box(page,".rest-fire"), heading=await box(page,".rest-heading");
      assert.ok(heading.y+heading.height<=fire.y+2,"title and campfire must not overlap");
      if(kind==="short") {
        const clock=await box(page,".rest-clock"); assert.ok(clock.y+clock.height<=heading.y+2,"clock and title must not overlap");
        if(reduced) {
          assert.equal(await page.locator(".clock-hand").evaluate(el=>getComputedStyle(el).animationName),"none");
          assert.equal(await angle(page,".clock-hand"),0,"reduced motion leaves hand still");
        } else {
          const observed=[];
          // Seek the actual browser CSSAnimation, then read the rendered SVG transform.
          // Two samples inside every half-second tick reject continuous interpolation;
          // pre-delay and departure samples reject early movement or end-of-loop reset.
          for(const time of [1000,1390,1410,1680,1880,1910,2180,2380,2410,2680,2880,2910,3180,3380,3410,3680,3880,3910,4180,4380,4410,4700,5200]) {
            await sample(page,time/duration,duration);
            observed.push({time,angle:await angle(page,".clock-hand"),pendulum:await angle(page,".clock-pendulum")});
          }
          clockSamples.push({filename,observed});
          // Preserve raw evidence even if this regression rejects an old stylesheet.
          writeFileSync(join(shots,"clock-samples.json"),JSON.stringify({sourcePins,clockSamples},null,2));
          for(const entry of observed) {
            const expected=entry.time<1400?0:Math.min(36,(Math.floor((entry.time-1400)/500)+1)*6);
            assert.ok(Math.abs(entry.angle-expected)<.001,`clock hand must accumulate discrete forward ticks: ${entry.time}ms expected ${expected}deg, saw ${entry.angle}deg`);
          }
          assert.ok(observed.every((entry,index)=>index===0||entry.angle>=observed[index-1].angle),"clock hand never swings backwards");
          assert.deepEqual([...new Set(observed.map(entry=>Math.round(entry.angle)))],[0,6,12,18,24,30,36]);
          assert.ok(observed.some(entry=>entry.pendulum<-10)&&observed.some(entry=>entry.pendulum>10),"pendulum keeps its existing swing");
          await sample(page,.4,duration);
          checks.push(`${filename}: 23 browser samples, six forward half-second ticks and held exit angle; pendulum unchanged`);
        }
      }
      await page.screenshot({path:join(shots,filename+".png")});
      if(!reduced){ await sample(page,.84,duration); assert.ok((await box(page,".rest-fire")).y>fire.y); }
    }
    if(reduced) assert.equal(await page.locator(".rest-stage").evaluate(el=>el.classList.contains("reduced")),true);
    await page.locator(".rest-close").click();
    await page.waitForTimeout(reduced?140:390);
    assert.equal(await page.locator(".rest-stage").count(),0);
    assert.equal(await page.evaluate(()=>window.__transitionFixture.closed.length>0),true);
    await page.close();
    checks.push(`${filename}: exact animation stages, geometry, departure, close`);
  }
  const expired = await browser.newPage();
  const old = { version: 1, id: crypto.randomUUID(), sceneKey: "visual", issuedAt: Date.now() - 7_000, expiresAt: Date.now() - 1_000, kind: "short", text: "", targets: "all" };
  await expired.goto(`${base}/display#${encodeURIComponent(JSON.stringify(old))}`);
  assert.equal(await expired.locator(".rest-stage").count(), 0);
  await expired.close();
  checks.push("expired rest never displays");
  {
    const page=await browser.newPage(); page.on("pageerror",error=>errors.push(error.message));
    const now=Date.now(), data={version:1,id:crypto.randomUUID(),sceneKey:"test",issuedAt:now,expiresAt:now+12000,kind:"short",text:"",targets:"all",lang:"en"};
    await page.goto(`${base}/display#${encodeURIComponent(JSON.stringify(data))}`); await page.locator(".rest-close").waitFor();
    await page.evaluate(()=>{window.__transitionFixture.close=async()=>{throw Error("host close failed");};});
    await page.locator(".rest-close").click(); await page.locator(".rest-retry").waitFor();
    assert.equal(await page.evaluate(()=>window.__transitionFixture.closed.length),0);
    await page.evaluate(()=>{window.__transitionFixture.close=null;}); await page.locator(".rest-retry").click();
    await page.waitForFunction(()=>window.__transitionFixture.closed.length===1);
    await page.close(); checks.push("rest native close rejection leaves same-page retry");
  }
  {
    const page=await browser.newPage(); page.on("pageerror",error=>errors.push(error.message));
    let release;
    const gate=new Promise(done=>{release=done;});
    await page.route("**/cg.svg",async route=>{await gate;await route.continue();});
    await page.goto(`${base}/cg?window=own-window&lang=en&cg=${encodeURIComponent(base+"/cg.svg")}`);
    await page.waitForFunction(()=>window.__timeStopFixture?.sent.some(v=>v.channel.endsWith("/overlay-ready")));
    const emit=channel=>page.evaluate(channel=>window.__timeStopFixture.emit("com.time-stop/"+channel,{nonce:"own-window"}),channel);
    await emit("overlay-view"); await page.waitForTimeout(620); assert.equal(await opacity(page,"#cgWrap"),0); assert.equal(await opacity(page,".top"),1);
    await emit("overlay-hide"); release(); await page.waitForTimeout(750);
    assert.equal(await opacity(page,"#cgWrap"),0,"late image decode cannot undo hide");
    await page.evaluate(()=>window.__timeStopFixture.emit("com.time-stop/overlay-view",{nonce:"own-window",error:true}));
    await page.waitForTimeout(660); assert.ok(await opacity(page,"#cgWrap")>0,"failed close restores already loaded image");
    await page.close(); checks.push("CG delayed image waits for bars and cannot flash after hide; failed-close restore");
  }
  for(const blocked of [false,true]){
    const page=await browser.newPage(); page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(blocked=>{
      window.__tickEvents=[];
      window.AudioContext=class {
        state=blocked?"suspended":"running";currentTime=0;destination={};
        resume(){return Promise.resolve();} close(){window.__tickEvents.push("closed");return Promise.resolve();}
        createOscillator(){const item={type:"",frequency:{value:0},connect(){},disconnect(){},start(){window.__tickEvents.push(item.frequency.value);},stop(){},onended:null};return item;}
        createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
      };
    },blocked);
    const now=Date.now(),data={version:1,id:crypto.randomUUID(),sceneKey:"audio",issuedAt:now,expiresAt:now+12000,kind:"short",text:"",targets:"all",lang:"en"};
    await page.goto(`${base}/display#${encodeURIComponent(JSON.stringify(data))}`); await page.locator(".rest-stage").waitFor();
    await page.waitForTimeout(4140);
    assert.deepEqual(await page.evaluate(()=>window.__tickEvents.filter(v=>typeof v==="number")),blocked?[]:[900,660,900,660,900,660]);
    await page.locator(".rest-close").click(); await page.waitForTimeout(410);
    assert.ok(await page.evaluate(()=>window.__tickEvents.includes("closed")));
    await page.close();checks.push(`short rest finite six ticks, audio ${blocked?"autoplay blocked":"permitted"}, context disposed (audio API substitute)`);
  }
  for(const [role,lang,reduced,width,height] of [["PLAYER","en",false,1280,800],["GM","zh",false,1280,800],["PLAYER","zh",true,390,844]]){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:reduced?"reduce":"no-preference"});
    page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(role=>{window.__timeStopRole=role;},role);
    await page.goto(`${base}/cg?window=own-window&lang=${lang}&cg=${encodeURIComponent(base+"/cg.svg")}${reduced?"&reduced=1":""}`);
    await page.waitForFunction(()=>window.__timeStopFixture?.sent.some(v=>v.channel.endsWith("/overlay-ready")));
    const emit=async(channel,data={},sender="local-connection")=>page.evaluate(({channel,data,sender})=>window.__timeStopFixture.emit("com.time-stop/"+channel,{nonce:"own-window",...data},sender),{channel,data,sender});
    assert.equal(await opacity(page,"#cgWrap"),0);
    await emit("overlay-view",{},"player-connection"); assert.equal(await opacity(page,"#cgWrap"),0);
    await emit("overlay-view"); await page.waitForTimeout(reduced?50:300);
    assert.equal(await opacity(page,"#cgWrap"),0); assert.ok(await opacity(page,".cinema.top")>0);
    await page.screenshot({path:join(shots,`cg-${role}-${lang}-bars.png`)});
    await page.waitForTimeout(reduced?220:1000);
    assert.ok(Math.abs(await opacity(page,"#cgWrap")-(role==="GM"?.1:1))<.001);
    await page.screenshot({path:join(shots,`cg-${role}-${lang}-image.png`)});
    await emit("overlay-hide"); await page.waitForTimeout(reduced?45:250);
    const fading=await opacity(page,"#cgWrap"); assert.ok(fading>0 && fading<(role==="GM"?.1:1));
    assert.equal(await page.evaluate(()=>window.__timeStopFixture.sent.some(v=>v.channel.endsWith("/overlay-hidden"))),false);
    await page.waitForTimeout(reduced?150:460); assert.equal(await opacity(page,"#cgWrap"),0);
    assert.equal(await page.evaluate(()=>window.__timeStopFixture.sent.some(v=>v.channel.endsWith("/overlay-hidden")&&v.destination==="LOCAL")),true);
    await emit("overlay-view",{error:true}); await page.waitForTimeout(reduced?140:650); assert.equal(await page.locator("#retry").isVisible(),true);
    await page.locator("#retry").click(); assert.equal(await page.evaluate(()=>window.__timeStopFixture.sent.at(-1).destination),"LOCAL");
    const before=await page.evaluate(()=>window.__timeStopFixture.sent.length);
    await page.evaluate(()=>window.dispatchEvent(new Event("pagehide"))); await emit("overlay-hide"); await page.waitForTimeout(160);
    assert.equal(await page.evaluate(()=>window.__timeStopFixture.listenerCount()),0);
    assert.equal(await page.evaluate(()=>window.__timeStopFixture.sent.length),before);
    await page.close(); checks.push(`CG ${role} ${lang} ${reduced}: ready guard, bars before image, fade ACK, failed close retry, unload`);
  }
  for(const failure of ["connection","role"]){
    const page=await browser.newPage({viewport:{width:390,height:844}});page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(failure=>{window.__timeStopRole="PLAYER";window.__timeStopFailConnection=failure==="connection"?1:0;window.__timeStopFailRole=failure==="role"?1:0;},failure);
    await page.goto(`${base}/cg?window=failed-window&lang=${failure==="role"?"zh":"en"}&cg=${encodeURIComponent(base+"/cg.svg")}`);
    await page.locator(".connection-error #retry").waitFor();assert.equal(await opacity(page,"#cgWrap"),0);assert.equal(await opacity(page,".top"),0);
    assert.equal(await page.locator("#exit").isVisible(),true);assert.equal(await page.locator("#cgImg").getAttribute("src"),null);
    await page.screenshot({path:join(shots,"cg-init-"+failure+"-retry.png")});
    await page.locator("#retry").click();await page.waitForFunction(()=>window.__timeStopFixture.sent.some(v=>v.channel.endsWith("/overlay-ready")));
    assert.equal(await opacity(page,"#cgWrap"),0,"retry still needs exact owner confirmation");
    await page.evaluate(()=>window.__timeStopFixture.emit("com.time-stop/overlay-view",{nonce:"failed-window"}));await page.waitForTimeout(1250);
    assert.equal(await opacity(page,"#cgWrap"),1);assert.equal(await page.locator("#exit").isVisible(),false);
    await page.close();checks.push(`CG initial ${failure} rejection: visible retry/exit, no unauthorized image, same-page recovery`);
  }
  {
    const page=await browser.newPage();page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(()=>{window.__timeStopRole="PLAYER";window.__timeStopFailConnection=1;});
    await page.goto(`${base}/cg?window=exit-window&lang=en`);await page.locator(".connection-error #exit").waitFor();
    await page.evaluate(()=>{window.__timeStopFixture.closeWait=async()=>{throw Error("close failed");};});await page.locator("#exit").click();
    await page.waitForFunction(()=>document.getElementById("notice").textContent.includes("Could not close"));assert.equal(await page.locator("#exit").isEnabled(),true);
    await page.evaluate(()=>{window.__timeStopFixture.closeWait=null;});await page.locator("#exit").click();
    assert.equal(await page.evaluate(()=>window.__timeStopFixture.native.filter(v=>v.channel==="OBR_MODAL_CLOSE").at(-1).data.id),"com.time-stop/overlay/exit-window");
    assert.equal(await page.evaluate(()=>window.__timeStopFixture.listenerCount()),0);await page.close();checks.push("CG init error exact-window exit, native rejection remains retryable");
  }
  for (const lang of ["zh", "en"]) {
    const page = await browser.newPage({ viewport: { width: 380, height: 540 } });
    page.on("pageerror", (error) => { errors.push(error.message); console.error("PORTAL_BROWSER", error.message); });
    await page.addInitScript((lang) => { window.__transitionInitialLang = lang; }, lang);
    await page.goto(`${base}/portal?id=portal-one`);
    await page.waitForFunction(() => document.getElementById("portal-effect")?.value === "fade");
    await page.locator("#portal-effect").selectOption("blink");
    await page.locator("#btn-save").click();
    assert.equal(await page.evaluate(() => window.__transitionFixture.portal.metadata["com.obr-suite/portals/data"].effect), "blink");
    assert.equal(await page.evaluate(() => window.__transitionFixture.portal.metadata["com.obr-suite/portals/data"].radius), 70);
    await page.screenshot({ path: join(shots, `portal-edit-${lang}.png`) });
    await page.close();
    checks.push(`portal ${lang}: independent blink effect persists`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(shots,"result.json"),JSON.stringify({checks,errors,sourcePins,clockSamples,scope:"Actual Edge DOM/CSS with isolated SDK host; CSSAnimation seeking measures rendered hand transforms; no real room writes or audio autoplay certification."},null,2));
  console.log(`TRANSITIONS_CG_UI ${checks.length}/${checks.length}; screenshots: ${shots}`);
} finally {
  await browser?.close();
  await new Promise((done) => server ? server.close(done) : done());
  if (dirname(resolve(out)) !== outputRoot) throw Error("Unexpected temporary output path");
  rmSync(out, { recursive: true, force: true });
}
