// Actual info-page + shared HP/resource editors + i18n; only host/dice/layout boundaries mocked.
import assert from "node:assert/strict";
import { build } from "rolldown";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "cc-info-integrated-"));
const actual = new Set(), errors = [];
await build({ input: resolve("src/modules/characterCards/info-page.ts"), platform: "browser", plugins: [{ name: "integrated-ports", resolveId(id) {
  if (id === "@owlbear-rodeo/sdk") return resolve("tools/fixtures/cc-info-integrated-sdk.ts");
  if (/^(\.\.\/)+state$/.test(id) || ["../../utils/debugOverlay", "../dice/tags", "../dice/context-menu", "../dice/sfx-broadcast", "../../utils/panelDrag", "../../utils/panelLayout", "../../utils/panelZoom"].includes(id)) return resolve("tools/cc-info-dom-components.ts");
}, transform(_code, id) { actual.add(id.replaceAll("\\", "/")); } }], output: { file: join(out, "info.js"), format: "iife" } });
for (const source of ["/characterCards/info-page.ts", "/utils/statBanner.ts", "/utils/statEdit.ts", "/resourceTracker/panel.ts", "/resourceTracker/storage.ts", "/resourceTracker/interaction.ts", "/src/i18n.ts"]) {
  assert.ok([...actual].some(path => path.endsWith(source)), `Real component must be bundled: ${source}`);
}
const BUB = "com.obr-suite/bubbles/data", RS = "com.obr-suite/resources/data";
const resource = (id, type, current, max, icon) => ({ id, name: { slots: "Arcane charges", ki: "Ki points", luck: "Luck" }[id], type, current, max, icon, legacyId: `keep-${id}` });
const item = (id, cardId, hp, ki) => ({ id, name: id, createdUserId: "gm", position: { x: 0, y: 0 }, text: { plainText: "" }, metadata: { "com.character-cards/boundCardId": cardId,
  [BUB]: { health: hp, "max health": 30, "temporary health": 2, "armor class": 15, locked: true },
  "com.owlbear-rodeo-bubbles-extension/metadata": { health: hp, "max health": 30, "name plate": true, name: "Keep external name" },
  [RS]: [resource("slots", "count", 2, 3, "gem"), resource("ki", "bar", ki, 6, "lightning"), resource("luck", "number", 1, 3, "starFour")] } });
const card = name => ({ identity: { display_name: name, race: { name: "精灵" } }, classes: [{ name: "法师", level: 3 }], total_level: 3,
  core_stats: { hp: { current: 20, max: 30, temp: 2 }, ac: 15, speed: 30, initiative: 2, passive_perception: 13, proficiency_bonus: 2 },
  abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((key, index) => [key, { total: 10 + index * 2, modifier: index, save: { bonus: index } }])),
  skills: [{ name: "巧手", ability: "敏捷", total: 4 }, { name: "奥秘", ability: "int", total: 6 }],
  combat: { weapons: [{ name: "长剑", attack_bonus: "+4", damage: "1d8+2", damage_type: "挥砍", properties: "灵巧, 精通：缓速" }] },
  features: { class_features: [{ name: "Custom feature", name_en: "Custom feature" }] } });
let browser, passed = 0;
const check = (value, label) => { assert.ok(value, label); passed++; };
const hp = page => page.locator('.stat-input[data-field="health"]');
async function show(page, token = "one", cardId = "a") {
  await page.evaluate(({ token, cardId }) => window.ccMock.show(cardId, token), { token, cardId });
  const value = await page.evaluate(({ token, BUB }) => window.ccMock.items[token].metadata[BUB].health, { token, BUB });
  await page.waitForFunction(value => { const el = document.querySelector('.stat-input[data-field="health"]'); return el?.value === String(value) && !el.disabled; }, value);
  await page.waitForSelector('.rt-row[data-id="ki"]');
}
async function newPage(role = "GM") {
  const page = await browser.newPage({ viewport: { width: 320, height: 560 } }); page.on("pageerror", error => errors.push(error.message));
  await page.setContent(readFileSync("cc-info.html", "utf8").replace(/<script type="module"[^>]*><\/script>/, ""));
  await page.evaluate(({ cards, items, role }) => { window.ccMock = { lang: "en", role, roomId: "r1", ready: true, listeners: {}, languageCallbacks: new Set(),
    metadata: { "com.character-cards/list": [{ id: "a", name: "Arin", visibility: "owners", owner_ids: ["player"] }, { id: "b", name: "Bela", visibility: "owners", owner_ids: ["player"] }] },
    cards, items, fetches: [], sent: [], writes: [], writeCallbacks: 0, heights: [], heldItems: [], heldFetch: [], heldUpdates: [], dragUnbind: 0, zoomUnbind: 0 }; },
  { cards: { "r1:a": card("Arin"), "r1:b": card("Bela") }, items: { one: item("one", "a", 21, 4), two: item("two", "a", 7, 2), three: item("three", "b", 13, 5) }, role });
  await page.addScriptTag({ path: join(out, "info.js") }); await show(page); return page;
}
async function resourceTab(page) { await page.locator('[data-rt-tab="res"]').click(); await page.waitForSelector('.rt-row[data-id="ki"] .rt-bar-num', { state: "visible" }); }
async function settlePane(page, pane) {
  await page.waitForFunction(pane => { const element = document.querySelector(`.rt-pane[data-pane="${pane}"]`); return element && Math.abs(new DOMMatrix(getComputedStyle(element).transform).m41) < 0.1 && getComputedStyle(element).opacity === "1"; }, pane);
  check(await page.locator(`.rt-pane[data-pane="${pane}"]`).evaluate(element => { const box = element.getBoundingClientRect(), root = document.querySelector("#root").getBoundingClientRect(); return box.x >= root.x - 1 && box.right <= root.right + 1; }), `settled ${pane} pane lies inside the actual 320px card`);
}
async function editHp(page, value) { await hp(page).focus(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await hp(page).fill(value); }
async function editResource(page, value) { await resourceTab(page); await page.locator('.rt-row[data-id="ki"] .rt-bar-num').click(); await page.locator('.rt-value-input').fill(value); }
async function noNewWrite(page, before, label) { await page.waitForTimeout(40); check(await page.evaluate(() => window.ccMock.writes.length) === before, label); }
try {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await newPage();
  check(await page.locator(".stat-input").count() === 4 && await page.locator(".rt-row").count() === 3, "actual HP/max/temp/AC fields and all three real resource styles are mounted");
  for (const language of ["en", "zh"]) {
    await page.evaluate(lang => window.ccLang(lang), language); await page.locator('[data-rt-tab="attr"]').click();
    await settlePane(page, "attr");
    await page.screenshot({ path: join(out, `${language}-attributes.png`) });
    await resourceTab(page); await settlePane(page, "res"); await page.screenshot({ path: join(out, `${language}-resources.png`) });
    check(await page.locator('.stat-input[data-field="health"]').getAttribute("aria-label") === (language === "en" ? "Hit points" : "生命值"), `${language} actual shared stat labels localize`);
    check(await page.locator("#root").evaluate(el => el.scrollWidth <= el.clientWidth), `${language} real combined panel fits 320px without horizontal overflow`);
  }
  await editHp(page, "+5"); await hp(page).evaluate(el => { window.savedHpInput = el; });
  const writesBeforeLanguage = await page.evaluate(() => window.ccMock.writes.length);
  await page.evaluate(() => window.ccLang("en"));
  check(await hp(page).evaluate(el => el === window.savedHpInput && document.activeElement === el && el.value === "+5"), "info host language render preserves actual HP node, focus and draft");
  await noNewWrite(page, writesBeforeLanguage, "language switch does not blur-commit HP"); await hp(page).press("Escape");
  await editResource(page, "max-"); await page.locator(".rt-value-input").evaluate(el => { window.savedResourceInput = el; });
  await page.evaluate(() => window.ccLang("zh"));
  check(await page.locator(".rt-value-input").evaluate(el => el === window.savedResourceInput && document.activeElement === el && el.value === "max-"), "info host language render preserves actual resource expression and focus");
  await noNewWrite(page, writesBeforeLanguage, "language switch does not commit resource draft");
  await page.evaluate(({ RS }) => { const m = window.ccMock; m.items.one.metadata[RS][1].current = 5; m.emit("items", Object.values(m.items)); }, { RS });
  await page.waitForTimeout(40);
  check(await page.locator(".rt-value-input").inputValue() === "max-", "real resource echo preserves focused expression through info host"); await page.locator(".rt-value-input").press("Escape");
  await show(page, "two"); check(await hp(page).inputValue() === "7", "same card token B receives its own HP");
  await resourceTab(page); check((await page.locator('.rt-row[data-id="ki"] .rt-bar-num').textContent()).includes("2 / 6"), "same card token B receives its own real resource state");
  check(await page.evaluate(() => window.ccMock.fetches.length) === 1, "same-card token switch reuses character card data");
  await page.evaluate(() => { window.ccMock.holdItems = true; window.ccMock.show("a", "one"); }); await page.waitForFunction(() => window.ccMock.heldItems.length > 0);
  await page.evaluate(() => { window.ccMock.holdItems = false; window.ccMock.show("a", "two"); }); await page.waitForFunction(() => document.querySelector('.stat-input[data-field="health"]')?.value === "7");
  await page.evaluate(() => window.ccMock.releaseItems()); await page.waitForTimeout(40);
  check(await hp(page).inputValue() === "7" && (await page.locator('.rt-row[data-id="ki"] .rt-bar-num').textContent()).includes("2 / 6"), "old same-card target read cannot replace either actual editor");

  // Ensure real editors can write normally, so later no-write checks cannot pass from disabled/stub controls.
  await editHp(page, "+3"); await hp(page).press("Enter"); await page.waitForFunction(({ BUB }) => window.ccMock.items.two.metadata[BUB].health === 10, { BUB });
  check(await page.evaluate(() => window.ccMock.writes.at(-1).ids[0]) === "two", "actual HP parser/storage commits to B");
  await editResource(page, "max-1"); await page.locator(".rt-value-input").press("Enter"); await page.waitForFunction(({ RS }) => window.ccMock.items.two.metadata[RS][1].current === 5, { RS });
  check(await page.evaluate(({ RS }) => window.ccMock.items.two.metadata[RS][1].legacyId, { RS }) === "keep-ki", "real resource expression/storage commits and preserves unknown resource fields");
  check(await page.evaluate(() => window.ccMock.items.two.metadata["com.owlbear-rodeo-bubbles-extension/metadata"]["name plate"]) === true, "real HP storage preserves external metadata");
  await page.close();

  for (const editor of ["hp", "resource"]) for (const invalidation of ["target", "permission", "scene"]) {
    // Keep PLAYER unchanged for ownership revocation: this must be rejected by
    // the actual info-page access target, not just the shared role-change guard.
    const delayed = await newPage(invalidation === "permission" ? "PLAYER" : "GM");
    if (editor === "hp") await editHp(delayed, "+5"); else await editResource(delayed, "max-1");
    await delayed.evaluate(() => { window.ccMock.holdUpdates = true; });
    await (editor === "hp" ? hp(delayed) : delayed.locator(".rt-value-input")).press("Enter");
    await delayed.waitForFunction(() => window.ccMock.heldUpdates.length === 1);
    if (invalidation === "target") await show(delayed, "two");
    else if (invalidation === "permission") {
      await delayed.evaluate(() => { const m = window.ccMock; m.role = "PLAYER"; m.metadata["com.character-cards/list"][0].owner_ids = ["other"]; m.emit("player", { role: "PLAYER" }); m.emit("metadata", m.metadata); });
      await delayed.waitForSelector(".err");
    } else { await delayed.evaluate(() => { window.ccMock.ready = false; window.ccMock.emit("ready", false); }); await delayed.waitForFunction(() => !document.querySelector(".stat-input")); }
    await delayed.evaluate(() => window.ccMock.flushUpdates());
    await noNewWrite(delayed, 0, `${editor} actual delayed SDK callback is canceled after ${invalidation}`);
    check(await delayed.evaluate(({ BUB, RS }) => window.ccMock.items.one.metadata[BUB].health === 21 && window.ccMock.items.one.metadata[RS][1].current === 4 && window.ccMock.items.two.metadata[BUB].health === 7 && window.ccMock.items.two.metadata[RS][1].current === 2, { BUB, RS }), `${editor}/${invalidation} preserves A and B metadata`);
    check(await delayed.evaluate(() => !window.ccMock.sent.some(message => message.topic === "com.obr-suite/resources/changed")), `${editor}/${invalidation} sends no false resource-change notice`);
    await delayed.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    check(await delayed.evaluate(() => Object.values(window.ccMock.listeners).every(set => set.size === 0) && window.ccMock.languageCallbacks.size === 0), `${editor}/${invalidation} combined teardown releases all listeners`);
    await delayed.close();
  }
  assert.deepEqual(errors, []);
  const result = { assertions: passed, browser: browser.version(), actualModules: [...actual].filter(path => /\/src\//.test(path)), artifacts: out, sdkHostSimulated: true, realOwlbearUat: false };
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(`CC INFO INTEGRATED: ${passed} assertions passed in Edge ${browser.version()}. Real info/HP/resource/i18n and Immer; host SDK simulated, not Owlbear UAT.`);
  console.log(`Bilingual 320px screenshots and evidence: ${out}`);
} finally { await browser?.close(); }
