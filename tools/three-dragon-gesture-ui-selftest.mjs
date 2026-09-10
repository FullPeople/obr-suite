#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "rolldown";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "three-dragon-gesture-ui-"));
await build({ input: resolve("tools/three-dragon-gesture-ui-selftest.entry.ts"), platform: "browser",plugins:[{name:'css-served-in-dom',resolveId(id){if(id.endsWith('.css'))return '\0test-css';},load(id){if(id==='\0test-css')return '';}}], output: { file: join(out, "app.js"), format: "esm", codeSplitting: false } });
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Content-Type", url.pathname === "/app.js" ? "application/javascript" : url.pathname === "/style.css" ? "text/css" : "text/html");
  res.end(url.pathname === "/app.js" ? readFileSync(join(out, "app.js")) : url.pathname === "/style.css" ? ["style.css","stage-ui.css"].map(name=>readFileSync(`extensions/three-dragon-ante/src/game/${name}`,"utf8")).join("\n") : url.pathname === "/client"
    ? '<!doctype html><link rel="stylesheet" href="/style.css"><main id="app"></main><script type="module" src="/app.js"></script>'
    : '<!doctype html><style>body{margin:0;display:flex}iframe{width:50vw;height:100vh;border:0;box-sizing:border-box}iframe+iframe{border-left:3px solid #d9b77b}</style><script type="module" src="/app.js"></script>');
});
// Avoid Windows ephemeral ports that Chromium intentionally blocks.
for (;;) { try { await new Promise((done, fail) => { const error = e => { server.off("listening", listen); fail(e); }; const listen = () => { server.off("error", error); done(); }; server.once("error", error); server.once("listening", listen); server.listen(20000 + Math.floor(Math.random() * 30000), "127.0.0.1"); }); break; } catch (e) { if (e.code !== "EADDRINUSE") throw e; } }
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.integration?.clients.host?.ready && window.integration.clients.alice?.ready);
  const host = page.frameLocator("#host"), alice = page.frameLocator("#alice");
  const mark = label => results.push(label);
  assert.equal(await host.locator('#app').getAttribute('data-renderer'),'dom');assert.equal(await alice.locator('#app').getAttribute('data-renderer'),'dom');
  assert.ok(await page.evaluate(()=>Object.values(window.integration.clients).every(client=>client.controller.view.actionReceiptVersion===1)));
  mark('Both actual iframe UIs use the WebGL-unavailable DOM fallback and real capability-1 controller views');
  await host.getByRole("button", { name: "Create table", exact: true }).click();
  await alice.getByRole("button", { name: "Join table", exact: true }).click();
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await page.waitForFunction(() => window.integration.clients.alice.controller.view.game?.hand?.length === 6);
  const initial = await page.evaluate(() => {
    const { host, alice } = window.integration.clients;
    return { gameId: host.controller.view.game.id, revision: host.controller.view.game.revision,
      seat: alice.controller.view.game.selfSeatId, ids: alice.controller.view.game.hand.map(c => c.id) };
  });
  const backs = host.locator(`.seat[data-seat="${initial.seat}"] [data-slot]`);
  assert.equal(await backs.count(), 6); mark("Two iframe UIs create/join/start through real controllers, rules, WebCrypto and IndexedDB");
  assert.equal(await host.locator('#confirm-action').count(),0);assert.equal(await alice.locator('#confirm-action').count(),0);mark('Ante keeps inspect/select gestures without a removed confirmation-button dependency');
  const baseline = await backs.first().evaluate(e => new DOMMatrix(getComputedStyle(e).transform).m42);
  // Actual mouse entry into an exposed fan face, not an injected gesture payload.
  await alice.locator("#hand [data-card]").first().hover();
  await page.waitForFunction(seat => document.querySelector("#host").contentDocument.querySelector(`.seat[data-seat="${seat}"] [data-slot="0"]`).classList.contains("hovered"), initial.seat);
  await page.waitForTimeout(220);
  const hovered = await backs.first().evaluate(e => new DOMMatrix(getComputedStyle(e).transform).m42);
  assert.ok(hovered < baseline - 10, `opponent back actually lifts: ${baseline} -> ${hovered}`);
  assert.equal(await host.locator(".card-back.hovered").count(), 1);
  assert.equal(await host.locator(".self .card-back").count(), 0);
  mark("Real pointer hover lifts exactly the opponent ordinal back in computed CSS");
  await alice.locator("#hand [data-card]").first().focus();await page.keyboard.press('Space');
  await page.waitForFunction(seat => document.querySelector("#host").contentDocument.querySelector(`.seat[data-seat="${seat}"] [data-slot="0"]`).classList.contains("selected"), initial.seat);
  await page.waitForTimeout(220);
  const selected = await backs.first().evaluate(e => new DOMMatrix(getComputedStyle(e).transform).m42);
  assert.ok(selected < baseline - 15); assert.equal(await host.locator(".card-back.selected").count(), 1);
  await page.screenshot({ path: join(out, "two-clients-selected.png") });
  mark("Keyboard-held card persists beyond the 125 ms gesture throttle and lifts only the opponent back; screenshot captures both actual iframe surfaces");
  const hostHTML = await host.locator("#app").innerHTML();
  for (const id of initial.ids) assert.ok(!hostHTML.includes(`data-card="${id}"`), `private card ${id} absent from receiver DOM`);
  assert.equal(await backs.locator("[data-card],svg,img,button").count(), 0);
  const gesturePackets = await page.evaluate(() => window.integration.room.traffic.filter(t => t.value.kind === "gesture").map(t => t.value.gesture));
  assert.ok(gesturePackets.length > 0);
  for (const g of gesturePackets) assert.deepEqual(Object.keys(g).sort(), ["count", "gameId", "hover", "revision", "selected", "sequence"]);
  assert.equal(await page.evaluate(() => window.integration.clients.host.controller.view.game.revision), initial.revision);
  assert.deepEqual(await page.evaluate(() => window.integration.commands.map(c => c.type)), ["create", "join", "start"]);
  mark("Receiver DOM and gesture payload contain no opponent card identities; hover/hold issue no rules action or revision");
  // Cancel the held card then leave the hand; both ordinal effects must disappear.
  await page.keyboard.press('Escape');
  await alice.locator("#title").click();
  await page.waitForFunction(() => !document.querySelector("#host").contentDocument.querySelector(".card-back.hovered,.card-back.selected"));
  const count = await page.evaluate(() => window.integration.room.traffic.filter(t => t.value.kind === "gesture").length);
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.integration.room.traffic.filter(t => t.value.kind === "gesture").length), count);
  mark("Escape cancel + real pointer exit clears backs and has no idle gesture sends");
  await alice.locator("#hand [data-card]").first().focus();await page.keyboard.press('Space');
  await page.waitForFunction(() => !!document.querySelector("#host").contentDocument.querySelector(".card-back.selected"));
  await alice.locator("#close").click();
  await page.waitForFunction(() => !document.querySelector("#alice").contentDocument.querySelector("#hand") && !document.querySelector("#host").contentDocument.querySelector(".card-back.hovered,.card-back.selected"));
  assert.equal(await page.evaluate(() => window.integration.clients.host.controller.view.game.revision), initial.revision);
  await page.evaluate(() => window.integration.clients.alice.reopen());
  assert.equal(await alice.locator("#hand [data-card]").count(), 6);
  mark("Close clears held-card indication on the other UI; reopened UI retains the same actual hand/game without an implicit action");
  await alice.locator("#hand [data-card]").first().focus();await page.keyboard.press('Space');
  await page.waitForFunction(() => !!document.querySelector("#host").contentDocument.querySelector(".card-back.selected"));
  await host.getByRole("button", { name: await page.evaluate(() => window.integration.newGameLabel), exact: true }).click();
  await host.locator("#confirm-reset").click();
  await page.waitForFunction(() => window.integration.clients.alice.controller.view.game === null);
  assert.equal(await host.locator(".card-back.hovered,.card-back.selected").count(), 0);
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await page.waitForFunction(() => window.integration.clients.alice.controller.view.game?.hand?.length === 6);
  assert.notEqual(await page.evaluate(() => window.integration.clients.host.controller.view.game.id), initial.gameId);
  assert.equal(await host.locator(".card-back.hovered,.card-back.selected").count(), 0);
  mark("Confirmed new game clears old gestures and the next game starts with plain backs");
  await alice.locator("#hand [data-card]").first().focus();await page.keyboard.press('Space');
  await page.waitForFunction(() => !!document.querySelector("#host").contentDocument.querySelector(".card-back.selected"));
  await page.evaluate(() => window.integration.clients.alice.disconnect());
  await page.waitForFunction(() => !document.querySelector("#host").contentDocument.querySelector(".card-back.hovered,.card-back.selected"));
  await page.screenshot({ path: join(out, "after-disconnect.png") });
  mark("Actual controller stop plus SDK membership departure clears the remaining UI");
  await page.evaluate(() => window.integration.clients.host.controller.stop());
  assert.deepEqual(errors, []);
  const sources = ["tools/three-dragon-gesture-ui-selftest.entry.ts", "tools/three-dragon-gesture-ui-selftest.mjs", ...["controller.ts", "gesture.ts", "ui.ts", "style.css", "stage-ui.css", "interaction/drag-controller.ts"].map(f => `extensions/three-dragon-ante/src/game/${f}`)];
  writeFileSync(join(out, "result.json"), JSON.stringify({ browser: browser.version(), checks: results, sources: Object.fromEntries(sources.map(f => [f, createHash("sha256").update(readFileSync(f)).digest("hex")])), errors, scope: "Two same-origin iframe documents, actual DOM-fallback UI/controller/rules/crypto/IDB. WebGL unavailable via canvas capability port; no GPU coverage. SDK room transport and panel close adapter simulated; not actual page LOCAL/index nor real Owlbear multiplayer UAT." }, null, 2));
  console.log(`THREE_DRAGON_GESTURE_UI ${results.length} groups PASS. Evidence: ${out}`);
} catch (error) { writeFileSync(join(out, "failure.txt"), String(error.stack)); console.error(`Evidence: ${out}`); throw error; }
finally { await browser.close(); await new Promise(done => server.close(done)); }
