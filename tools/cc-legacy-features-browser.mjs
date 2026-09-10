import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const reportPath = process.env.CC_LEGACY_REPORT || "F:/CodexData/admin/.codex/tmp/obr-feature-display-20260910/static-render/result.json";
const report = JSON.parse(readFileSync(reportPath, "utf8")), checks = [], errors = [];
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
try {
  for (const item of report.cases) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(item.path).href);
    const data = JSON.parse(readFileSync(join(dirname(dirname(item.path)), "data.json"), "utf8"));
    const name = data.identity.display_name || data.identity.character_name;
    assert.equal(await page.locator(".name-cell > .value").textContent(), name); checks.push(`${item.version}/${item.kind}: visible primary name`);
    for (const key of ["fighting_style_feats", "special_abilities"]) {
      const entries = data.features[key] || [], loc = page.locator(`[data-feature-kind="${key}"]`);
      assert.equal(await loc.count(), entries.length);
      for (let i = 0; i < entries.length; i++) {
        const desc = loc.nth(i).locator(".feat-desc");
        assert.equal(await desc.textContent(), entries[i].description);
        assert.ok(await desc.isVisible());
      }
      checks.push(`${item.version}/${item.kind}: ${key} descriptions complete and initially visible`);
    }
    if (item.kind === "seeded") {
      assert.equal(await page.locator("img").count(), 0); assert.ok(!(await page.evaluate(() => window.bad)));
      const first = page.locator('[data-feature-kind="special_abilities"]');
      await first.locator("summary").focus(); await page.keyboard.press("Enter");
      assert.ok(await first.locator(".feat-desc").isHidden());
      await page.keyboard.press("Enter"); assert.ok(await first.locator(".feat-desc").isVisible());
      await first.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dirname(reportPath), `${item.version}-features.png`) });
      checks.push(`${item.version}: escaped markup and keyboard collapse/reopen`);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  const result = { count: checks.length, checks, browser: browser.version(), serverDeployed: false };
  writeFileSync(join(dirname(reportPath), "browser-result.json"), JSON.stringify(result, null, 2));
  console.log(`Legacy feature display: ${checks.length} checks passed.`);
} finally { await browser.close(); }
