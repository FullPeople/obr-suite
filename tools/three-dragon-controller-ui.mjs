#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "rolldown";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
const require = createRequire(import.meta.url), { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "three-dragon-controller-ui-")), file = join(out, "integration.js");
await build({ input: resolve("tools/three-dragon-controller-ui.entry.ts"), platform: "browser", plugins:[{name:"styles-served-separately",resolveId(id){if(id.endsWith(".css"))return "\0styles";},load(id){if(id==="\0styles")return "";}}], output: { file, format: "esm", codeSplitting: false } });
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/integration.js" ? "application/javascript" : request.url === "/style.css" ? "text/css" : "text/html");
  response.end(request.url === "/integration.js" ? readFileSync(file) : request.url === "/style.css" ? readFileSync("extensions/three-dragon-ante/src/game/style.css","utf8")+"\n"+readFileSync("extensions/three-dragon-ante/src/game/stage-ui.css","utf8") :
    '<!doctype html><link rel="stylesheet" href="/style.css"><main id="host"></main><hr><main id="alice"></main><script type="module" src="/integration.js"></script>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // This legacy integration targets the real DOM fallback; GPU input has its own stage suite.
  await page.addInitScript(() => {const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl'||kind==='webgl2'?null:original.call(this,kind,...args);};});
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.integration?.ready);
  const host = page.locator("#host"), alice = page.locator("#alice");
  assert.equal(await host.getByRole("button", { name: "Create table", exact: true }).isEnabled(), true);
  await host.getByRole("button", { name: "Create table", exact: true }).click();
  await alice.getByRole("button", { name: "Join table", exact: true }).click();
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await page.waitForFunction(() => window.integration.controllers.alice.view.game?.hand?.length === 6);
  assert.equal(await host.locator("#hand [data-option]").count(), 6); assert.equal(await alice.locator("#hand [data-option]").count(), 6);
  const gameId = await page.evaluate(() => window.integration.controllers.host.view.game.id);
  await alice.locator("#hand [data-option]").first().focus(); await page.keyboard.press("Space"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.integration.controllers.alice.view.game?.committedAnte && !window.integration.controllers.alice.view.pending);
  const beforeClose = await page.evaluate(() => window.integration.controllers.alice.view.game);
  await alice.locator("#close").click(); assert.equal(await alice.locator("#hand").count(), 0);
  await page.evaluate(() => window.reopen_alice());
  assert.deepEqual(await page.evaluate(() => window.integration.controllers.alice.view.game), beforeClose);
  assert.equal(await alice.locator("#hand [data-option]").count(), 0, "committed ante has no second legal action");
  assert.equal(await page.evaluate(() => window.integration.controllers.host.view.game.id), gameId);
  const dispatched = await page.evaluate(() => window.integration.commands);
  assert.deepEqual(dispatched.map(item => `${item.player}:${item.type}`), ["host:create", "alice:join", "host:start", "alice:action", "alice:close"]);
  await page.evaluate(() => window.replaceHostWithoutArchive());
  await page.waitForFunction(() => window.integration.controllers.host.view.message === "recoveryMissing");
  assert.equal(await page.evaluate(() => window.integration.room.table.hostConnectionId), "host", "missing archive cannot silently take ownership");
  const nextLabel = await page.evaluate(() => window.integration.labels.newGame);
  await host.getByRole("button", { name: nextLabel, exact: true }).click();
  assert.equal(await host.locator("#reset-dialog").isVisible(), true);
  await host.locator("#cancel-reset").click();
  assert.equal(await page.evaluate(() => window.integration.room.table.hostConnectionId), "host", "cancel leaves lost game untouched");
  await host.getByRole("button", { name: nextLabel, exact: true }).click(); await host.locator("#confirm-reset").click();
  await page.waitForFunction(() => window.integration.controllers.host.view.connected && window.integration.controllers.host.view.table.stage === "lobby" && window.integration.controllers.alice.view.game === null);
  assert.equal(await page.evaluate(() => window.integration.controllers.host.view.game), null, "confirmed missing recovery returns to lobby instead of pretending to restore cards");
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await page.waitForFunction(() => window.integration.controllers.alice.view.game?.hand?.length === 6);
  assert.notEqual(await page.evaluate(() => window.integration.controllers.host.view.game.id), gameId);
  await page.screenshot({ path: join(out, "controller-ui.png"), fullPage: true });
  await page.evaluate(async () => { await Promise.all(Object.values(window.integration.controllers).map(controller => controller.stop())); });
  assert.deepEqual(errors, []);
  console.log(`THREE_DRAGON_CONTROLLER_UI: actual Edge ${browser.version()} DOM fallback keyboard/UI -> real controller/rules/WebCrypto/IndexedDB: empty-room create, private join, start, secret ante, close/reopen; missing archive explicit cancel/confirm -> lobby -> new Start PASS. Foreign archive absence and SDK room transport simulated; no Owlbear UAT. Evidence: ${out}`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
