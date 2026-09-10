#!/usr/bin/env node
// Read-only product review: actual settings and quick-bar DOM/state, mocked
// Owlbear transport. Reports geometry instead of assuming room acceptance.
import { build } from "rolldown";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const outputRoot = resolve(tmpdir());
const out = mkdtempSync(join(outputRoot, "suite-wiring-ui-"));
const shots = resolve(process.env.SUITE_WIRING_SCREENSHOT_DIR ?? "../_audit/2026-09-09/wiring-ui"); mkdirSync(shots, { recursive: true });
let browser, server;
try {
 for (const name of ["settings", "cluster-row"]) await build({ input: resolve(`src/${name}.ts`), platform: "browser", plugins: [{
  name: "sdk-boundary",
  resolveId(id, importer) {
    if (id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/suite-wiring-sdk.ts");
    if (id === "./modules/bubbles" && importer?.replaceAll("\\", "/").endsWith("/src/settings.ts")) return "\0unused-repair";
  },
  load(id) { if (id === "\0unused-repair") return "export async function repairLegacyHiddenBubbles() { return 0; }"; },
  transform(code) { if (code.includes("import.meta.env.BASE_URL")) return code.replaceAll("import.meta.env.BASE_URL", '"/"'); },
 }], output: { dir: out, entryFileNames: `${name}.js`, format: "esm" } });
 server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.endsWith(".js")) {
    const file = join(out, path.slice(1));
    response.writeHead(200, { "Content-Type": "application/javascript" });
    try { response.end(readFileSync(file)); } catch { response.end(""); }
  } else if (path.endsWith("announcement.md")) { response.writeHead(200); response.end("# Audit\n"); }
  else {
    const name = path.includes("cluster") ? "cluster-row" : "settings";
    response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    response.end(readFileSync(resolve(`${name}.html`), "utf8").replace(`/src/${name}.ts`, `/${name}.js`));
  }
 });
 await new Promise((done) => server.listen(0, "127.0.0.1", done));
 const base = `http://127.0.0.1:${server.address().port}`;
 browser = await chromium.launch({ headless: true, channel: "msedge" });
 const results = [];
 for (const role of ["GM", "PLAYER"]) for (const lang of ["zh", "en"]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({role,lang}) => { window.__transitionInitialRole = role; localStorage.setItem("obr-suite/lang", lang); }, {role,lang});
  await page.goto(`${base}/settings`);
  await page.locator('[data-tab="bossBar"]').waitFor();
  assert.equal(await page.locator('[data-tab="transitions"]').count(), role === "GM" ? 1 : 0);
  assert.equal(await page.locator('[data-tab="sharedPointer"]').count(), 0);
  if(role === "GM") {
    await page.locator('[data-tab="transitions"]').click(); await page.locator("#openTransitions").click();
    assert.ok(await page.evaluate(() => window.__transitionFixture.sent.some((message) => message.channel === "com.obr-suite/transitions/open" && message.destination === "LOCAL")));
  }
  for (const tab of [...(role === "GM" ? ["transitions"] : []), "bossBar", "dynamicFog", "musicBoard", "threeDragonAnte"]) {
    await page.locator(`[data-tab="${tab}"]`).click(); await page.waitForTimeout(80);
    if (tab !== "threeDragonAnte") assert.equal(await page.locator(".tog[data-mod]").isDisabled(), role !== "GM");
    if (tab === "threeDragonAnte") {
      assert.equal(await page.locator(".tog[data-mod],#openThreeDragon").count(), 0);
      assert.equal(await page.locator('#content a[href$="/three-dragon-ante/manifest.json"]').count(), 1);
    }
    if (tab === "musicBoard") {
      await page.locator("#openMusicBoard").click();
      assert.ok(await page.evaluate(() => window.__transitionFixture.sent.some((message) => message.channel === "com.obr-suite/music-board:toggle" && message.destination === "LOCAL")));
      assert.equal(await page.locator("#content").innerText().then(text => /retired|已停止维护|退役下线/.test(text)), false);
      if (role === "GM") {
        await page.locator('.tog[data-mod="musicBoard"]').click();
        await page.waitForFunction(() => document.querySelector("#openMusicBoard")?.disabled === true);
        await page.locator('.tog[data-mod="musicBoard"]').click();
        await page.waitForFunction(() => document.querySelector("#openMusicBoard")?.disabled === false);
      }
    }
    if (tab === "bossBar") {
      assert.equal(await page.locator('[data-boss-pref="visible"]').count(), 0);
      await page.locator('[data-boss-pref="reducedMotion"]').click();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("obr-suite/boss-bar/preferences")).reducedMotion), true);
      await page.locator('#boss-bottom-inset').fill('200'); await page.locator('#boss-bottom-inset').press('Tab');
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem("obr-suite/boss-bar/preferences")).bottomInset===200);
    }
    if (tab === "dynamicFog") {
      assert.equal(await page.locator('[data-key="fogFilled"]').getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-key="fogShareVision"]').isDisabled(), role !== "GM");
      if (role === "GM") {
        await page.locator('[data-key="fogShareVision"]').click();
        await page.waitForFunction(() => window.__transitionFixture.metadata["com.obr-suite/state"]?.fogShareVision === true);
        await page.waitForFunction(() => document.querySelector('[data-key="fogFilled"]')?.getAttribute("aria-pressed") === "true");
      }
    }
    await page.screenshot({ path: join(shots, `${tab}-${role.toLowerCase()}-${lang}.png`) });
  }
  await page.locator('[data-tab="libraries"]').click();
  const language = page.locator('.lib-row select[data-field="language"]').first();
  assert.equal(await language.inputValue(), "zh", "legacy Chinese preset language should be inferred");
  assert.equal(await language.isDisabled(), role !== "GM");
  if (role === "GM") {
    await page.evaluate(() => { window.__transitionFixture.failSettingsWrite = true; });
    await language.selectOption("en");
    await page.waitForFunction(() => document.querySelector(".lib-language-status")?.textContent.length > 0);
    assert.equal(await language.inputValue(), "zh", "failed language save must restore the persisted selection");
    assert.equal(await language.isDisabled(), false, "failed language save must permit retry without reopening");
    await page.evaluate(() => { window.__transitionFixture.failSettingsWrite = false; });
    await language.selectOption("en");
    await page.waitForFunction(() => window.__transitionFixture.metadata["com.obr-suite/state"]?.libraries?.[0]?.language === "en");
    assert.equal(await language.inputValue(), "en");
    assert.equal(await page.locator(".lib-language-status").first().innerText(), "");
  }
  await page.screenshot({ path: join(shots, `libraries-${role.toLowerCase()}-${lang}.png`) });
  await page.setViewportSize({ width: 380, height: 720 });
  await page.screenshot({ path: join(shots, `settings-narrow-${role.toLowerCase()}-${lang}.png`) });
  results.push({ mode: "settings", role, lang, errors, geometry: await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, contentWidth: document.getElementById("content").getBoundingClientRect().width })) });
  await page.close();
  const row = await browser.newPage({ viewport: { width: 960, height: 56 } });
  const rowErrors = []; row.on("pageerror", error => rowErrors.push(error.message));
  await row.addInitScript(({role,lang}) => { window.__transitionInitialRole = role; localStorage.setItem("obr-suite/lang", lang); }, {role,lang});
  await row.goto(`${base}/cluster-row`); await row.locator("#btnMusic").waitFor(); await row.waitForTimeout(150);
  await row.locator("#btnMusic").click();
  assert.ok(await row.evaluate(() => window.__transitionFixture.sent.some((message) => message.channel === "com.obr-suite/music-board:toggle" && message.destination === "LOCAL")));
  assert.equal(await row.locator("#btnTransitions").count(), role === "GM" ? 1 : 0);
  assert.equal(await row.locator("#btnThreeDragon,#btnSharedPointer").count(),0);
  if(role === "GM") {
    await row.locator("#btnTransitions").click();
    assert.ok(await row.evaluate(() => window.__transitionFixture.sent.some((message) => message.channel === "com.obr-suite/transitions/open" && message.destination === "LOCAL")));
  }
  for (const selector of ["#btnBestiaryPopup", "#btnCharCardPopup"]) {
    assert.ok(await row.locator(selector).evaluate(el=>el.classList.contains("on")),"unset auto-popup preference defaults to enabled");
  }
  for (const width of [960, 640, 380]) {
    await row.setViewportSize({ width, height: 56 });
    const geometry = await row.evaluate(() => ({ naturalWidth: document.getElementById("row").scrollWidth,
      buttons: [...document.querySelectorAll("#row button")].map((button) => { const r = button.getBoundingClientRect(); return { id: button.id, left: r.left, right: r.right, clipped: r.left < 0 || r.right > innerWidth }; }) }));
    results.push({ mode: "quickbar", role, lang, width, geometry, errors: rowErrors });
    for (const side of ["left", "right"]) {
      const reachability = await row.evaluate((side) => {
        document.getElementById("wrap").dataset.handleSide = side;
        const scroller = document.getElementById("row");
        const buttons = [...scroller.querySelectorAll("button")];
        const inaccessible = [];
        for (const button of buttons) {
          button.scrollIntoView({ block: "nearest", inline: "nearest" });
          const r = button.getBoundingClientRect(), clip = scroller.getBoundingClientRect();
          const hit = document.elementFromPoint((r.left+r.right)/2, (r.top+r.bottom)/2);
          if (r.left < clip.left-1 || r.right > clip.right+1 || r.top < 0 || r.bottom > innerHeight || !(hit === button || button.contains(hit))) inaccessible.push(button.id);
        }
        const naturalWidth = scroller.scrollWidth;
        scroller.scrollLeft = 0;
        return { inaccessible, naturalWidth };
      }, side);
      assert.deepEqual(reachability.inaccessible, [], `${role}/${lang}/${width}/${side}: buttons cannot be reached by scrolling`);
      assert.ok(reachability.naturalWidth >= geometry.naturalWidth - 1, "scrolling must not collapse natural width measurement");
    }
    if (width === 380 && geometry.naturalWidth > width) {
      await row.locator("#row").hover();
      await row.mouse.wheel(0, 140);
      await row.waitForFunction(() => document.getElementById("row").scrollLeft > 0);
      await row.evaluate(() => { document.getElementById("row").scrollLeft = 0; });
    }
    await row.screenshot({ path: join(shots, `quickbar-${role.toLowerCase()}-${lang}-${width}.png`) });
  }
  await row.close();
 }
 writeFileSync(join(shots, "review.json"), JSON.stringify(results, null, 2));
 for (const result of results) assert.deepEqual(result.errors, [], `${result.mode}/${result.role}/${result.lang} browser errors`);
 console.log(`SUITE_WIRING_UI: 22 settings tab views + 12 quick-bar widths; GM-only transitions, separate TDA install link, no pointer/runtime TDA entry, default previews, Boss personal settings, music/library retry and scroll/hit targets PASS; ${shots}`);
} finally {
 await browser?.close(); await new Promise(done => server ? server.close(done) : done());
 if (dirname(resolve(out)) !== outputRoot) throw Error("Unexpected temporary output path"); rmSync(out, {recursive:true,force:true});
}
