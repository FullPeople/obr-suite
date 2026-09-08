#!/usr/bin/env node
// Actual production DOM/CSS in Chromium; only Owlbear SDK and language state
// are substituted. This cannot certify the real Owlbear renderer or room sync.
import { build } from "rolldown";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const outputRoot = resolve(tmpdir());
const out = mkdtempSync(join(outputRoot, "suite-transitions-ui-"));
const shots = resolve(process.env.TRANSITIONS_SCREENSHOT_DIR ?? "../_audit/2026-09-08/transitions");
mkdirSync(shots, { recursive: true });
let browser, server;
try {
  for (const name of ["control", "display", "portal"]) {
    await build({ input: resolve(name === "portal" ? "src/modules/portals/edit-page.ts" : `src/modules/transitions/${name}-page.ts`), platform: "browser", plugins: [{
      name: "transition-ui-fixture",
      resolveId(id, importer) {
        if (id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/transitions-sdk.ts");
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
    if (path === "/control.js" || path === "/display.js" || path === "/portal.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(readFileSync(join(out, path.slice(1))));
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
  }
  for (const [kind, lang, reduced] of [["short", "zh", false], ["long", "en", true], ["text", "zh", false]]) {
    const height = kind === "text" ? 220 : 142;
    const page = await browser.newPage({ viewport: { width: 420, height } });
    page.on("pageerror", (error) => errors.push(error.message));
    const now = Date.now();
    const payload = { version: 1, id: crypto.randomUUID(), sceneKey: "visual", issuedAt: now, expiresAt: now + 6_000, kind,
      text: kind === "text" ? "翌日清晨，晨雾渐渐散去。远方的钟声从群山间传来，旅人们收拾行囊，再一次踏上未知的旅途。" : "", targets: "all", lang, reduced };
    await page.goto(`${base}/display#${encodeURIComponent(JSON.stringify(payload))}`);
    await page.locator(".banner").waitFor();
    await page.waitForTimeout(450);
    if (reduced) assert.equal(await page.locator(".banner").evaluate((element) => getComputedStyle(element).animationName), "none");
    await page.screenshot({ path: join(shots, `display-${kind}-${lang}.png`) });
    await page.locator(".close").click();
    assert.equal(await page.locator(".banner").count(), 0);
    await page.close();
  }
  const expired = await browser.newPage();
  const old = { version: 1, id: crypto.randomUUID(), sceneKey: "visual", issuedAt: Date.now() - 7_000, expiresAt: Date.now() - 1_000, kind: "short", text: "", targets: "all" };
  await expired.goto(`${base}/display#${encodeURIComponent(JSON.stringify(old))}`);
  assert.equal(await expired.locator(".banner").count(), 0);
  await expired.close();
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
  }
  assert.deepEqual(errors, []);
  console.log(`TRANSITIONS_UI 9/9; screenshots: ${shots}`);
} finally {
  await browser?.close();
  await new Promise((done) => server ? server.close(done) : done());
  if (dirname(resolve(out)) !== outputRoot) throw Error("Unexpected temporary output path");
  rmSync(out, { recursive: true, force: true });
}
