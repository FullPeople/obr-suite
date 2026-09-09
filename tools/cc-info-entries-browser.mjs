// Real compact card, editors and CSS; only Owlbear/dice/layout boundaries are simulated.
import assert from "node:assert/strict";
import { build } from "rolldown";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = resolve(process.env.CC_ENTRIES_OUT || "F:/CodexData/admin/.codex/tmp/obr-feature-display-20260910/browser");
mkdirSync(out, { recursive: false });
const errors = [], checks = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const prior = execFileSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "show", "c83cc53:src/modules/characterCards/info-page.ts"], { encoding: "utf8" });
for (const baseline of [true, false]) {
  await build({ input: resolve("src/modules/characterCards/info-page.ts"), platform: "browser", plugins: [{ name: "card-host", resolveId(id) {
    if (id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/cc-info-integrated-sdk.ts");
    if (/^(\.\.\/)+state$/.test(id) || ["../../utils/debugOverlay", "../dice/tags", "../dice/context-menu", "../dice/sfx-broadcast", "../../utils/panelDrag", "../../utils/panelLayout", "../../utils/panelZoom"].includes(id)) return resolve("tools/cc-info-dom-components.ts");
  }, transform(_code, id) { if (baseline && id.replaceAll("\\", "/").endsWith("/characterCards/info-page.ts")) return prior; } }],
  output: { file: join(out, baseline ? "before.js" : "after.js"), format: "iife" } });
}
const inputs = {
  "2014": JSON.parse(readFileSync("tools/fixtures/cc-imported-2014.json", "utf8")),
  "2024": JSON.parse(readFileSync("tools/fixtures/cc-imported-2024.json", "utf8")),
};
const en = 'First "quoted" line \\ 中文\nSecond line\tTabbed\n<img src=x onerror="window.bad=true">';
const zh = "第一行：保留原文。\n第二行\t保留制表符。";
const seeded = structuredClone(inputs["2024"]);
seeded.features = {
  class_features: [{ name: "自定义职业特性", description: "职业原文" }],
  race_features: [{ name: "自定义种族特性", description: "种族原文" }],
  fighting_style_feats: [{ name: "战斗风格甲", name_en: "Authored fighting style", description: zh, description_en: en }],
  special_abilities: [{ name: "特殊能力甲", name_en: "Authored special ability", description: zh, description_en: en }, { name: "Long description", description: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}\n${"unbroken".repeat(30)}`).join("\n\n") }],
  feats: [{ name: "Only search" }, { name: "Only English", name_en: "Only English", description_en: "English text is explicitly supplied." }],
};
seeded.spellcasting = { prepared: [{ name: "法术甲", name_en: "Authored spell", description_en: en }], always_known: [{ name: "法术甲", name_en: "Authored spell", description_en: en }] };
let browser;
async function open(data, baseline = false) {
  const page = await browser.newPage({ viewport: { width: 320, height: 460 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent(readFileSync("cc-info.html", "utf8").replace(/<script type="module"[^>]*><\/script>/, ""));
  await page.evaluate(data => {
    window.ccMock = { lang: "en", role: "GM", roomId: "r1", ready: true, listeners: {}, languageCallbacks: new Set(),
      metadata: { "com.character-cards/list": [{ id: "a", visibility: "owners", owner_ids: ["player"] }] }, cards: { "r1:a": data },
      items: { one: { id: "one", createdUserId: "gm", position: { x: 0, y: 0 }, text: { plainText: "" }, metadata: { "com.character-cards/boundCardId": "a", "com.obr-suite/bubbles/data": { health: 21, "max health": 30 }, "com.obr-suite/resources/data": [] } } },
      fetches: [], sent: [], writes: [], writeCallbacks: 0, heights: [], heldItems: [], heldFetch: [], heldUpdates: [], dragUnbind: 0, zoomUnbind: 0 };
  }, data);
  await page.addScriptTag({ path: join(out, baseline ? "before.js" : "after.js") });
  await page.evaluate(() => window.ccMock.show("a", "one"));
  await page.waitForSelector(".name");
  return page;
}
try {
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
  const before = await open(seeded, true);
  check(!(await before.locator("#root").textContent()).includes("Authored special ability") && !(await before.locator("#root").textContent()).includes("Authored fighting style"), "Prior app omits both kinds");
  check(await before.locator(".cc-entry-body").count() === 0, "Prior app has no local description reader");
  await before.close();
  for (const [version, data] of Object.entries(inputs)) {
    const page = await open(data);
    const entry = page.locator('[data-entry-group="specialAbilities"] .cc-entry').first();
    await entry.locator("summary").click();
    check(await entry.locator(".cc-entry-body").textContent() === data.features.special_abilities[0].description, `${version}: native saved/imported special description is complete`);
    check(await entry.locator(".cc-entry-body").isVisible(), `${version}: description actually visible`);
    check(await page.evaluate(() => window.ccMock.writes.length === 0), `${version}: reading writes no token/card data`);
    await page.close();
  }
  const page = await open(seeded), entry = page.locator('[data-entry-id="specialAbilities:0"]');
  check(await page.locator("[data-entry-group]").count() === 5, "All five feature/spell groups appear");
  check(await page.locator('[data-entry-group="spells"] summary').count() === 1, "Repeated spell keeps one entry");
  await entry.locator("summary").focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-entry-id="specialAbilities:0"]')?.open);
  check(await entry.locator(".cc-entry-body").textContent() === en, "Keyboard opens complete explicitly translated text");
  check(await page.locator("#root img").count() === 0 && !(await page.evaluate(() => window.bad)), "Description markup remains literal text");
  check(await page.evaluate(() => !window.ccMock.sent.some(event => event.topic === "com.obr-suite/search-query")), "Opening a description does not send a search");
  await page.evaluate(() => window.ccLang("zh"));
  check(await entry.getAttribute("open") !== null && await entry.locator(".cc-entry-body").textContent() === zh, "Language switch retains expanded entry and shows authored Chinese");
  check((await page.locator("[data-entry-group] .srch-sect-h").allTextContents()).includes("战斗风格"), "New section titles translate");
  await page.screenshot({ path: join(out, "compact-zh.png") });
  await page.evaluate(() => window.ccLang("en"));
  await entry.locator("button[data-q]").click();
  check(await page.evaluate(() => window.ccMock.sent.some(event => event.topic === "com.obr-suite/search-query" && event.data.q === "Authored special ability")), "Explicit search forwards the translated name");
  await page.getByRole("button", { name: "Only search", exact: true }).click();
  check(await page.evaluate(() => window.ccMock.sent.some(event => event.topic === "com.obr-suite/search-query" && event.data.q === "Only search")), "Entry without a description retains direct search");
  const long = page.locator('[data-entry-id="specialAbilities:1"]');
  await long.locator("summary").click();
  check(await long.locator(".cc-entry-body").textContent() === seeded.features.special_abilities[1].description, "Long custom description is not abbreviated");
  check(await page.evaluate(() => { const root = document.querySelector("#root"); return root.scrollWidth <= root.clientWidth + 1 && root.scrollHeight > root.clientHeight; }), "Long text wraps within 320px and scrolls vertically");
  await long.locator(".cc-entry-actions").scrollIntoViewIfNeeded();
  check(await long.locator("button").isVisible(), "End of long description stays reachable");
  await long.locator("summary").focus(); await page.keyboard.press("Space");
  await page.waitForFunction(() => !document.querySelector('[data-entry-id="specialAbilities:1"]')?.open);
  check(await long.locator(".cc-entry-body").isHidden(), "Keyboard collapses description");
  await entry.locator("summary").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(out, "compact-en.png") });
  check(await page.evaluate(() => window.ccMock.writes.length === 0 && window.ccMock.fetches.length === 1), "Reading/search/language changes do not write data or refetch the card");
  await page.evaluate(() => { const m = window.ccMock; m.role = "PLAYER"; m.metadata["com.character-cards/list"][0].owner_ids = ["other"]; m.emit("player", { role: "PLAYER" }); m.emit("metadata", m.metadata); });
  await page.waitForSelector(".err");
  check(await page.locator(".cc-entry").count() === 0, "Revoking visibility removes expanded private descriptions");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  check(await page.evaluate(() => Object.values(window.ccMock.listeners).every(set => set.size === 0) && window.ccMock.languageCallbacks.size === 0), "Teardown leaves no SDK/language subscriptions");
  await page.close();
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ checks, count: checks.length, browser: browser.version(), nativeSavedCards: 2, realOwlbearRoom: false }, null, 2));
  console.log(`Character entry browser: ${checks.length} checks passed. ${out}`);
} catch (error) {
  writeFileSync(join(out, "failed.json"), JSON.stringify({ completedChecks: checks, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); }
