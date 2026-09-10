import assert from "node:assert/strict";
import { build } from "rolldown";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "portal-appearance-"));
const mutations = {
  "custom-art-migration": ["appearance.ts", "return ownOrigin && bundledPath &&", "return"],
  "display-size": ["appearance.ts", "const cells = oldEdge / item.grid.dpi;", "const cells = oldEdge / item.grid.dpi * 2;"],
  "stale-write": ["appearance-control.ts", "if (!valid()) return;", "if (false) return;"],
};
const mutation = process.env.PORTAL_APPEARANCE_MUTANT; let applied = false;
await build({ input: resolve("src/modules/portals/edit-page.ts"), platform: "browser", plugins: [{ name: "portal-appearance-sdk", resolveId(id) {
  if (["@owlbear-rodeo/sdk", "../../state", "../../asset-base", "../../utils/panelDrag", "../../utils/panelLayout"].includes(id)) return resolve("tools/fixtures/portal-appearance-sdk.ts");
}, transform(code, id) {
  if (!mutation) return;
  const [file, before, after] = mutations[mutation] ?? [];
  if (!file) throw Error("Unknown mutation");
  if (!id.replaceAll("\\", "/").endsWith(`/portals/${file}`)) return;
  if (code.split(before).length !== 2) throw Error(`Mutation ${mutation} no longer matches exactly once`);
  applied = true; return code.replace(before, after);
} }], output: { file: join(out, "edit.js"), format: "iife" } });
if (mutation && !applied) throw Error("Mutation was not applied");
const html = readFileSync("portal-edit.html", "utf8").replace('/src/modules/portals/edit-page.ts', '/edit.js');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect x="4" y="4" width="392" height="192" rx="90" fill="#394057"/><ellipse cx="200" cy="100" rx="150" ry="68" fill="#3ca8c5"/><ellipse cx="200" cy="100" rx="100" ry="42" fill="#162136"/></svg>';
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/edit.js" ? "text/javascript" : req.url?.endsWith(".svg") ? "image/svg+xml" : "text/html"); res.end(req.url === "/edit.js" ? readFileSync(join(out, "edit.js")) : req.url?.endsWith(".svg") ? svg : html); });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const picked = { name: "Library gate", image: { url: `${base}/library-art.svg`, mime: "image/svg+xml", width: 400, height: 200 }, grid: { dpi: 7, offset: { x: 0, y: 0 } }, scale: { x: 30, y: 20 }, rotation: 90, visible: true, locked: false, text: { plainText: "Must not overwrite" } };
let browser, passed = 0;
const check = (actual, label) => { assert.ok(actual, label); passed++; };
async function open(seed = {}, width = 380, height = 540) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(seed => { window.portalSeed = seed; }, seed); await page.goto(`${base}/portal-edit.html?id=portal&instance=fixture-instance`);
  await page.waitForSelector(".portal-art-pick"); return page;
}
async function select(page, images = [picked]) {
  await page.locator(".portal-art-pick").click(); await page.waitForFunction(() => window.portalMock.pendingPicker.length === 1);
  await page.evaluate(images => window.portalMock.choose(images), images);
  await page.waitForFunction(() => !document.querySelector(".portal-art-pick").disabled);
}
const state = page => page.evaluate(() => window.portalMock.item);
try {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await open(); await page.waitForFunction(() => !document.querySelector(".portal-art-pick").disabled);
  const original = await state(page); await select(page);
  const next = await state(page), omitted = ({ image, grid, scale, ...other }) => other;
  assert.deepEqual(omitted(next), omitted(original)); passed++;
  check(await page.evaluate(() => window.portalMock.patches[0].every(patch => ["image", "grid", "scale"].includes(patch.path[1]))), "actual Immer write patches touch only artwork geometry");
  check(next.image.url === picked.image.url && next.grid.dpi === 400 && next.grid.offset.x === 200 && next.grid.offset.y === 100, "native image content is centered without importing the asset's name/grid/rotation/visibility");
  check(next.scale.x === 1.4 && next.scale.y === 1.4 && next.image.width / next.image.height === 2, "new image preserves aspect ratio and old longest display edge");
  assert.deepEqual(await page.evaluate(() => window.portalMock.pickerCalls), [[false]]); passed++;
  await select(page, []); check(await page.evaluate(() => window.portalMock.writes.length) === 1, "canceling native picker does not write");
  const reopened = await open({ item: next }); await reopened.waitForFunction(() => !document.querySelector(".portal-art-pick").disabled);
  check(await reopened.locator(".portal-art-preview").getAttribute("src") === picked.image.url, "reopening uses item-persisted artwork");
  check(await reopened.evaluate(() => !window.portalMock.needsMigration(window.portalMock.item)), "startup legacy migration does not overwrite library image");
  await reopened.locator(".portal-art-reset").click(); await reopened.waitForFunction(() => window.portalMock.writes.length === 1);
  const reset = await state(reopened); assert.deepEqual(omitted(reset), omitted(original)); passed++;
  check(reset.image.url.endsWith("/suite/portal-icon.svg") && reset.image.width === 64 && reset.grid.offset.x === 32, "restore default writes native default artwork without changing portal behavior");
  const migration = await page.evaluate(() => {
    const m = window.portalMock, old = structuredClone(m.item); old.image = { ...old.image, url: "/suite-dev/portal-icon.svg", width: 96, height: 96 };
    const fixed = m.migrate(old), custom = structuredClone(m.item); custom.image.url = "https://other.example/portal-icon.svg"; custom.image.width = 96;
    const before = JSON.stringify(custom); m.migrate(custom);
    return [fixed.image.width, fixed.image.url.endsWith("/suite/portal-icon.svg"), JSON.stringify(custom) === before, m.validImage({ ...m.item.image, url: "javascript:alert(1)" }) === null, m.validImage({ ...m.item.image, width: Infinity }) === null];
  }); assert.deepEqual(migration, [64, true, true, true, true]); passed++;
  await page.locator(".portal-art-pick").click(); await page.evaluate(() => window.portalMock.setRole("PLAYER")); await page.evaluate(image => window.portalMock.choose([image]), picked);
  await page.waitForTimeout(30); check(await page.evaluate(() => window.portalMock.writes.length) === 1 && await page.locator(".portal-art-pick").isDisabled(), "role downgrade during native picker rejects late image");
  await page.close();

  const delayed = await open(); await delayed.waitForFunction(() => !document.querySelector(".portal-art-pick").disabled);
  await delayed.evaluate(() => { window.portalMock.holdWrites = true; }); await delayed.locator(".portal-art-pick").click(); await delayed.evaluate(image => window.portalMock.choose([image]), picked);
  await delayed.waitForFunction(() => window.portalMock.pendingWrites.length === 1);
  await delayed.evaluate(() => { delete window.portalMock.item.metadata["com.obr-suite/portals/data"]; window.portalMock.flush(); });
  await delayed.waitForTimeout(30); check(await delayed.evaluate(() => window.portalMock.writes.length) === 0, "write callback rechecks current portal metadata even without an item event");
  await delayed.close();
  const staleWrite = await open(); await staleWrite.waitForFunction(() => !document.querySelector(".portal-art-pick").disabled);
  await staleWrite.evaluate(() => { window.portalMock.holdWrites = true; }); await staleWrite.locator(".portal-art-pick").click(); await staleWrite.evaluate(image => window.portalMock.choose([image]), picked);
  await staleWrite.waitForFunction(() => window.portalMock.pendingWrites.length === 1);
  await staleWrite.evaluate(() => { window.portalMock.scene(false); window.portalMock.flush(); }); await staleWrite.waitForTimeout(30);
  check(await staleWrite.evaluate(() => window.portalMock.writes.length) === 0, "scene unload during delayed native update rejects the actual write callback"); await staleWrite.close();

  for (const reason of ["scene", "close", "delete"]) {
    const stopped = await open(); await stopped.waitForFunction(() => !document.querySelector(".portal-art-pick").disabled); await stopped.locator(".portal-art-pick").click();
    await stopped.evaluate(reason => { const m = window.portalMock; if (reason === "scene") m.scene(false); else if (reason === "close") document.querySelector("#btn-cancel").click(); else { m.item = undefined; m.items(); } }, reason);
    await stopped.waitForTimeout(30); const count = await stopped.evaluate(() => window.portalMock.writes.length);
    await stopped.evaluate(image => window.portalMock.choose([image]), picked); await stopped.waitForTimeout(30);
    check(await stopped.evaluate(() => window.portalMock.writes.length) === count, `${reason} invalidates pending image selection`);
    await stopped.close();
  }
  const failed = await open(); await failed.waitForFunction(() => !document.querySelector(".portal-art-pick").disabled);
  await failed.evaluate(() => { window.portalMock.failWrite = true; }); await select(failed);
  check((await failed.locator(".portal-art-status").textContent()).includes("Try again") && (await state(failed)).image.url.endsWith("/suite/portal-icon.svg"), "write failure shows retry state and leaves persistent image unchanged");
  await failed.evaluate(() => { window.portalMock.failWrite = false; window.portalMock.lang("zh"); }); await select(failed);
  check((await failed.locator(".portal-art-status").textContent()).includes("已保存") && (await failed.locator(".portal-art-reset").textContent()) === "恢复默认", "retry and all added UI work in Chinese"); await failed.close();
  const videoPage = await open(); await videoPage.waitForFunction(() => !document.querySelector('.portal-art-pick').disabled);
  await select(videoPage, [{...picked, image:{...picked.image, mime:'video/mp4',url:`${base}/library-video.mp4`}}]);
  check((await state(videoPage)).image.mime === 'video/mp4' && await videoPage.locator('video.portal-art-preview').evaluate(video => video.paused && !video.autoplay), 'native video image content is accepted without automatic preview playback');
  await videoPage.close();
  const loadingFailed = await open({ failRoleReads: 1 }); await loadingFailed.locator('.portal-art-retry:visible').waitFor();
  await loadingFailed.locator('.portal-art-retry').click();
  await loadingFailed.waitForFunction(() => !document.querySelector('.portal-art-pick').disabled);
  await select(loadingFailed);
  check((await state(loadingFailed)).image.url.endsWith('/library-art.svg'), 'initial read failure can retry in place and use the native picker');
  await loadingFailed.close();
  const early = await open({ holdRole: true }); await early.waitForFunction(() => window.portalMock.pendingRoles.length > 0);
  await early.evaluate(() => { const m = window.portalMock; m.setRole("PLAYER"); m.holdRole = false; m.pendingRoles.splice(0).forEach(fn => fn()); }); await early.waitForTimeout(30);
  check(await early.locator(".portal-art-pick").isDisabled(), "late initial GM read cannot override a live role downgrade"); await early.close();
  for (const width of [380, 320]) {
    await reopened.setViewportSize({ width, height: 540 });
    check(await reopened.locator(".body").evaluate(el => el.scrollWidth <= el.clientWidth), `no horizontal clipping at ${width}px`);
    const footer = await reopened.locator(".btn-row").boundingBox(); check(footer.y + footer.height <= 540, `Save/Cancel remain inside ${width}px host panel`);
  }
  await reopened.setViewportSize({ width: 380, height: 540 }); await reopened.screenshot({ path: join(out, "portal-editor.png") });
  await reopened.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  check(await reopened.evaluate(() => [...window.portalMock.listeners.values()].every(group => group.size === 0)), "appearance lifecycle releases all SDK subscriptions"); await reopened.close();
  const closeRetry=await open();await closeRetry.waitForFunction(()=>!document.querySelector('.portal-art-pick').disabled);
  await closeRetry.evaluate(()=>{window.portalMock.failBroadcast=true;});await closeRetry.locator('#btn-save').click();await closeRetry.locator('[role="alert"]').waitFor();
  check((await closeRetry.locator('[role="alert"]').textContent()).includes('Could not close'), 'failed local close message leaves visible same-page retry');
  await closeRetry.evaluate(()=>{window.portalMock.failBroadcast=false;});await closeRetry.locator('#btn-save').click();
  await closeRetry.waitForFunction(()=>window.portalMock.messages.some(v=>v.channel==='com.obr-suite/portals/edit-close'));
  assert.deepEqual(await closeRetry.evaluate(()=>window.portalMock.messages.find(v=>v.channel==='com.obr-suite/portals/edit-close')), {channel:'com.obr-suite/portals/edit-close',data:{id:'portal',instance:'fixture-instance'},destination:'LOCAL'});passed++;
  check(await closeRetry.evaluate(()=>window.portalMock.nativeCloses.length)===0,'editor iframe never directly closes a newer native window');await closeRetry.close();
  console.log(`Portal appearance: ${passed} assertions passed in Edge ${browser.version()}; native library and SDK endpoints simulated, not Owlbear UAT`);
  console.log(`Visual/artifacts: ${out}`);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
if (process.argv.includes("--mutants")) {
  for (const name of Object.keys(mutations)) {
    const result = spawnSync(process.execPath, [process.argv[1]], { env: { ...process.env, PORTAL_APPEARANCE_MUTANT: name }, encoding: "utf8", timeout: 30000 });
    writeFileSync(join(out, `${name}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    if (result.error || result.signal || result.status === 0 || !result.stderr.includes("AssertionError")) throw Error(`Mutation ${name} did not fail with a runtime assertion: ${result.stderr}`);
    console.log(`KILLED: ${name}`);
  }
}
