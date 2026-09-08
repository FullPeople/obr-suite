import assert from "node:assert/strict";
import { build } from "rolldown";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "initiative-edit-"));
const mutant = process.env.INITIATIVE_EDIT_MUTANT;
const mutations = { "draft-ownership": ["if (!allowed(d)) continue;", ""], "scene-lifetime": ["scope.generation === generation", "true"] };
let mutated = false;
await build({ input: resolve("tools/fixtures/initiative-edit-entry.tsx"), platform: "browser", plugins: [{ name: "initiative-edit-host", resolveId(id) {
  if (id === "@owlbear-rodeo/sdk" || /(^|\/)state$|\/dice$|\/dice\/(fixed-roll|sfx-broadcast)$/.test(id)) return resolve("tools/fixtures/initiative-edit-sdk.ts");
}, transform(code, id) {
  code = code.replaceAll("import.meta.env.BASE_URL", '"/"');
  if (mutant && id.replaceAll("\\", "/").endsWith("/hooks/useInitiative.ts")) {
    const [before, after] = mutations[mutant] ?? []; if (!before || !code.includes(before)) throw Error("Mutation anchor missing");
    code = code.replace(before, after); mutated = true;
  }
  return code;
} }], output: { file: join(out, "probe.js"), format: "iife" } });
if (mutant && !mutated) throw Error("Mutation not applied");
const server = createServer((request, response) => { if (request.url === "/probe.js") { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(readFileSync(join(out, "probe.js"))); } else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<meta charset="utf-8"><div id="root"></div><script src="/probe.js"></script>'); } });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: "msedge" }), page = await browser.newPage();
const errors = []; page.on("pageerror", error => errors.push(error.message));
let passed = 0; const checks = [], check = (value, message) => { assert.ok(value, message); passed++; checks.push(message); };
const idle = () => page.waitForTimeout(80);
try {
  // Windows can allocate an ephemeral port blocked by Chromium (observed 6669).
  // Rebind only that transport failure, without relaxing browser restrictions
  // or retrying failed product assertions.
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(`http://127.0.0.1:${server.address().port}`); break; }
    catch (error) {
      if (attempt >= 3 || !String(error).includes("ERR_UNSAFE_PORT")) throw error;
      await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    }
  }
  await page.waitForFunction(() => window.editApi?.items.length === 2).catch(error => { throw new Error(`${error.message}; page errors: ${errors.join("; ")}`); }); await idle();
  check(await page.evaluate(() => !window.editApi.canEdit(window.editApi.items.find(item => item.id === "other"))), "existing count permission denies the other player's token");
  await page.evaluate(() => window.editApi.updateModifier("other", 19)); await idle();
  const forbidden = await page.evaluate(() => window.editMock.writes);
  if (process.argv.includes("--capture-baseline")) {
    check(forbidden.length === 1, "baseline reproduces non-owner modifier write through the actual hook and SDK callback");
    writeFileSync(join(out, "baseline.json"), JSON.stringify({ observedForbiddenWrite: forbidden, hook: "actual useInitiative", sdk: "actual SceneItemsApi + Immer" }, null, 2));
    console.log(`BASELINE: unauthorized modifier write reproduced. Evidence: ${out}`);
  } else {
    check(forbidden.length === 0, "non-owner cannot bypass component permissions by calling the actual hook");
    await page.evaluate(() => window.editApi.updateModifier("owned", 4)); await idle();
    check(await page.evaluate(() => window.editMock.items[0].metadata["com.initiative-tracker/dexMod"]) === 4, "owner modifier update succeeds");
    await page.evaluate(() => { window.editMock.role("GM"); }); await idle(); await page.evaluate(() => window.editApi.updateModifier("other", 5)); await idle();
    check(await page.evaluate(() => window.editMock.items[1].metadata["com.initiative-tracker/dexMod"]) === 5, "GM can edit another player's modifier under the existing count rule");
    await page.evaluate(() => window.editMock.role("PLAYER")); await idle();
    const ownedRow = async () => page.locator(".initiative-item").nth(await page.evaluate(() => window.editApi.items.findIndex(item => item.id === "owned")));
    const otherRow = page.locator(".initiative-item").nth(await page.evaluate(() => window.editApi.items.findIndex(item => item.id === "other")));
    await otherRow.locator(".item-mod").click(); check(await page.locator(".mod-input").count() === 0, "component refuses non-owner modifier editing");
    for (const [button, input, value] of [[".item-count", ".count-input", "21"], [".item-mod", ".mod-input", "7"]]) {
      const beforeEnter = await page.evaluate(() => window.editMock.writes.length);
      await (await ownedRow()).locator(button).click(); await page.locator(input).fill(value); await page.locator(input).press("Enter"); await idle();
      check(await page.evaluate(() => window.editMock.writes.length) === beforeEnter + 1, `${input} Enter plus blur commits exactly once through the real hook/SDK`);
      await (await ownedRow()).locator(button).click(); await page.locator(input).fill("28"); await page.locator(input).press("Escape"); await idle();
      check(await page.evaluate(() => window.editMock.writes.length) === beforeEnter + 1, `${input} Escape plus blur does not save`);
      await (await ownedRow()).locator(button).click(); await page.locator(input).fill("29"); await page.locator(input).press("Enter"); await idle();
      check(await page.evaluate(() => window.editMock.writes.length) === beforeEnter + 2, `${input} a later edit session can save after cancellation`);
    }
    const beforeFailure = await page.evaluate(() => window.editMock.writes.length);
    await page.evaluate(() => { window.editMock.failWrites = true; }); await (await ownedRow()).locator(".item-count").click(); await page.locator(".count-input").fill("35"); await page.locator(".count-input").press("Enter"); await idle();
    check(await page.evaluate(() => window.editMock.writes.length) === beforeFailure, "failed host write is not reported as an applied value");
    await page.evaluate(() => { window.editMock.failWrites = false; }); await (await ownedRow()).locator(".item-count").click(); await page.locator(".count-input").fill("36"); await page.locator(".count-input").press("Enter"); await idle();
    check(await page.evaluate(() => window.editMock.writes.length) === beforeFailure + 1, "a failed session does not permanently disable the next save attempt");
    const beforeUiRevoke = await page.evaluate(() => window.editMock.writes.length);
    await (await ownedRow()).locator(".item-mod").click(); await page.locator(".mod-input").fill("41"); await page.evaluate(() => window.editMock.setOwner("owned", "someone-else")); await idle();
    check(await page.locator(".mod-input").count() === 0 && await page.evaluate(() => window.editMock.writes.length) === beforeUiRevoke, "ownership revoked while editing removes the modifier input without blur-saving its draft");
    await page.evaluate(() => window.editMock.setOwner("owned", "me")); await idle();
    check(await page.locator(".mod-input").count() === 0, "restored ownership does not revive an edit canceled by revocation");
    for (const [method, field] of [["updateCount", "count"], ["updateModifier", "modifier"]]) {
      const before = await page.evaluate(() => window.editMock.writes.length);
      await page.evaluate(method => { const m = window.editMock; m.holdAt = m.reads + 2; window.pendingEdit = window.editApi[method]("owned", 31); }, method);
      await page.waitForFunction(() => window.editMock.pending.length === 1);
      await page.evaluate(() => { window.editMock.setOwner("owned", "someone-else", false); window.editMock.release(); }); await page.evaluate(() => window.pendingEdit); await idle();
      check(await page.evaluate(() => window.editMock.writes.length) === before, `${field} SDK draft rejects ownership revoked after preflight without relying on an items event`);
      await page.evaluate(() => window.editMock.setOwner("owned", "me")); await idle();
    }
    await page.evaluate(() => window.editMock.role("GM")); await idle(); const beforeRole = await page.evaluate(() => window.editMock.writes.length);
    await page.evaluate(() => { const m = window.editMock; m.holdAt = m.reads + 2; window.pendingEdit = window.editApi.updateModifier("other", 32); }); await page.waitForFunction(() => window.editMock.pending.length === 1);
    await page.evaluate(() => { window.editMock.role("PLAYER"); window.editMock.release(); }); await page.evaluate(() => window.pendingEdit); await idle();
    check(await page.evaluate(() => window.editMock.writes.length) === beforeRole, "role revoked while SDK item read is delayed blocks the actual modifier patch");
    const beforeScene = await page.evaluate(() => window.editMock.writes.length);
    await page.evaluate(() => { const m = window.editMock; m.holdAt = m.reads + 2; window.pendingEdit = window.editApi.updateModifier("owned", 33); }); await page.waitForFunction(() => window.editMock.pending.length === 1);
    await page.evaluate(() => { window.editMock.ready(false); window.editMock.ready(true); window.editMock.release(); }); await page.evaluate(() => window.pendingEdit); await idle();
    check(await page.evaluate(() => window.editMock.writes.length) === beforeScene, "scene unload/reopen invalidates only the pending edit generation");
    const beforeRemoval = await page.evaluate(() => window.editMock.writes.length);
    await page.evaluate(() => { const m = window.editMock; m.holdAt = m.reads + 2; window.pendingEdit = window.editApi.updateModifier("owned", 34); }); await page.waitForFunction(() => window.editMock.pending.length === 1);
    await page.evaluate(() => { delete window.editMock.items[0].metadata["com.initiative-tracker/data"]; window.editMock.release(); }); await page.evaluate(() => window.pendingEdit); await idle();
    check(await page.evaluate(() => window.editMock.writes.length) === beforeRemoval, "removing initiative metadata before SDK callback cancels the modifier edit");
    await page.evaluate(() => window.editMock.role("GM")); await idle();
    for (const [lang, label] of [["en", "Initiative"], ["zh", "先攻"]]) {
      await page.evaluate(async lang => { window.editMock.lang = lang; await window.editApi.rollInitiativeLocal("other", "normal"); }, lang);
      const localDice = await page.evaluate(() => window.editMock.dice.at(-1));
      check(localDice.label === label && localDice.itemId === "other" && localDice.rollerName === "Me" && localDice.dice[0].type === "d20", `actual local roll uses current ${lang} label without changing identity or dice structure`);
      await page.evaluate(rollId => window.editMock.broadcast("com.obr-suite/dice-fade-start", { rollId }), localDice.rollId); await idle();
      const beforeDicePlus = await page.evaluate(() => window.editMock.dice.length);
      await page.evaluate(() => window.editMock.broadcast("com.initiative-tracker/roll-result", { rollId: "init-other-99", result: { totalValue: 17 } }));
      await page.waitForFunction(before => window.editMock.dice.length === before + 1, beforeDicePlus);
      const dicePlus = await page.evaluate(() => window.editMock.dice.at(-1));
      check(dicePlus.label === label && dicePlus.itemId === "other" && dicePlus.rollerName === "Me" && dicePlus.dice[0].value === 17, `actual Dice+ listener uses current ${lang} label without changing result or identity`);
    }
    const beforeUnmount = await page.evaluate(() => window.editMock.writes.length);
    await page.evaluate(() => { const m = window.editMock; m.holdAt = m.reads + 2; window.pendingEdit = window.editApi.updateModifier("other", 35); }); await page.waitForFunction(() => window.editMock.pending.length === 1);
    await page.evaluate(() => { window.unmountProbe(); window.editMock.release(); }); await page.evaluate(() => window.pendingEdit); await idle();
    check(await page.evaluate(() => window.editMock.writes.length) === beforeUnmount, "unmounting the actual hook invalidates an in-flight numeric edit");
    check(errors.length === 0, `no unhandled hook errors: ${errors.join("; ")}`);
    writeFileSync(join(out, "result.json"), JSON.stringify({ passed, checks, browser: await browser.version(), actualHook: true, actualSDK: "SceneItemsApi + Immer", realOwlbearUat: false }, null, 2));
    console.log(`PASS: ${passed} real hook/SDK edit checks. Evidence: ${out}`);
  }
} finally { await browser.close(); server.close(); }
