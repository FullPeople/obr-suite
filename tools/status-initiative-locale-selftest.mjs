import assert from "node:assert/strict";
import { build } from "rolldown";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "status-initiative-locale-"));
const mutant = process.env.STATUS_INITIATIVE_LOCALE_MUTANT;
const mutations = {
  "custom-signature": ["/statusTracker/localization.ts", "equalValue(buff, originals.get(buff.id))", "buff.name === originals.get(buff.id)?.name"],
  "mutable-signature": ["/statusTracker/localization.ts", "structuredClone(buff)", "buff"],
  "language-closes-draft": ["/status-tracker-page.ts", "const offLanguage = onLangChange(refreshLanguage);", "const offLanguage = onLangChange(() => { refreshLanguage(); render(); });"],
  "duplicate-commit": ["/components/InitiativeItem.tsx", "if (!countSession.current) return;", ""],
};
let mutated = false;
const pages = { palette: ["src/status-tracker-page.ts", "status-tracker.html"], manage: ["src/status-tracker-manage-page.ts", "status-tracker-manage.html"], capture: ["src/status-tracker-capture-page.ts", "status-tracker-capture.html"], initiative: ["src/modules/initiative/panel-page.tsx", "initiative-panel.html"] };
const fixture = resolve("tools/fixtures/status-initiative-locale-sdk.ts"), html = {};
for (const [name, [entry, original]] of Object.entries(pages)) {
  await build({ input: resolve(entry), platform: "browser", plugins: [{ name: "locale-host", resolveId(id) {
    if (id === "@owlbear-rodeo/sdk" || /(^|\/)state$|utils\/(debugOverlay|panelZoom|panelDrag|panelLayout|visualEffects)$|dice\/sfx-broadcast$|hooks\/useInitiative$/.test(id)) return fixture;
    if (id.endsWith(".css")) return "\0locale-css";
  }, load(id) { if (id === "\0locale-css") return ""; }, transform(code, id) {
    code = code.replaceAll("import.meta.env.BASE_URL", '"/"');
    if (mutant) { const [suffix, before, after] = mutations[mutant] ?? []; if (!suffix) throw Error("Unknown mutation");
      if (id.replaceAll("\\", "/").endsWith(suffix)) { if (!code.includes(before)) throw Error("Mutation anchor missing"); code = code.replace(before, after); mutated = true; }
    } return code;
  } }], output: { file: join(out, `${name}.js`), format: "iife", name: "LocalePage" } });
  html[name] = readFileSync(original, "utf8").replace(`/${entry}`, `/${name}.js`).replace(/<link[^>]*https:\/\/fonts[^>]*>/g, "");
  if (name === "initiative") html[name] = html[name].replace("</head>", '<link rel="stylesheet" href="/initiative.css"></head>');
}
if (mutant && !mutated) throw Error("Mutation not applied");
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname.slice(1);
  if (path.endsWith(".html") && html[path.slice(0, -5)]) { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html[path.slice(0, -5)]); }
  else if (Object.keys(pages).some(name => path === `${name}.js`)) { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(readFileSync(join(out, path))); }
  else if (path === "initiative.css") { response.setHeader("Content-Type", "text/css"); response.end(readFileSync("src/modules/initiative/styles/initiative.css")); }
  else { response.statusCode = 204; response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
let passed = 0; const errors = [], checks = [];
function check(value, message) { assert.ok(value, message); passed++; checks.push(message); }
async function open(name, seed = {}, query = "") {
  const page = await browser.newPage({ viewport: { width: name === "initiative" ? 720 : 340, height: name === "initiative" ? 180 : 544 } });
  page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
  await page.addInitScript(seed => { window.localeSeed = seed; }, seed);
  await page.goto(`${base}/${name}.html${query}`); await page.waitForFunction(() => !!window.localeMock); return page;
}
const lang = async (page, value) => { await page.evaluate(value => window.localeMock.lang(value), value); await page.waitForTimeout(70); };
const catalog = page => page.evaluate(() => JSON.parse(localStorage.getItem("obr-suite/status/buff-catalog")));
try {
  const palette = await open("palette"); await palette.locator('.bubble[data-id="u_paralyzed"]').waitFor();
  check((await palette.locator('.bubble[data-id="u_paralyzed"]').innerText()).trim() === "Paralyzed", "palette displays an unchanged built-in in English");
  check(await palette.evaluate(() => window.localeMock.mutableDefaultDisplay()) === "麻痹 ⚡", "a shallow-copy palette edit cannot mutate the immutable default signature and hide customization");
  check((await palette.locator('.cat-btn[data-g="异常"]').innerText()) === "Conditions", "unchanged built-in group uses English display with its original filter key");
  check(!/[\p{Script=Han}]/u.test(await palette.locator("#grid").innerText()), "all 12 fresh built-in status labels are English");
  const original = await catalog(palette); await lang(palette, "zh");
  check((await palette.locator('.bubble[data-id="u_paralyzed"]').innerText()).trim() === "麻痹", "Chinese built-in display remains supported");
  await palette.screenshot({ path: join(out, "palette-zh.png") }); await lang(palette, "en");
  assert.deepEqual(await catalog(palette), original); passed++;
  await palette.screenshot({ path: join(out, "palette-en.png") });
  await palette.locator('.bubble[data-id="u_paralyzed"]').click();
  check(await palette.evaluate(() => window.localeMock.broadcasts.findLast(message => message.channel.endsWith("/select-apply"))?.data.buff.name === "麻痹 ⚡"), "English display sends original buff definition to the canvas, not a translated save");
  await palette.locator("#btnEdit").click(); await palette.locator('.bubble[data-id="u_paralyzed"]').click();
  await palette.locator(".pop-name").fill("Unfinished draft");
  await palette.evaluate(() => { window.draftNode = document.querySelector(".pop-name"); window.draftNode.setSelectionRange(3, 8); });
  await lang(palette, "zh");
  check(await palette.evaluate(() => document.activeElement === window.draftNode && document.querySelector(".pop-name") === window.draftNode && window.draftNode.value === "Unfinished draft" && window.draftNode.selectionStart === 3 && window.draftNode.selectionEnd === 8), "palette language switch retains popup input node, draft, focus and selection");
  check((await palette.locator(".pop-save").innerText()) === "保存", "open popup buttons translate without remounting its editor");
  assert.deepEqual(await catalog(palette), original); passed++;
  await palette.locator(".pop-cancel").click(); await lang(palette, "en");
  await palette.locator('.bubble[data-id="u_paralyzed"]').click();
  check(await palette.locator(".pop-name").inputValue() === "Paralyzed", "unmodified built-in editor opens with English display name");
  await palette.locator(".pop-save").click(); check((await catalog(palette)).buffs.find(buff => buff.id === "u_paralyzed").name === "麻痹 ⚡", "saving an unchanged English display preserves the original catalog name");
  await palette.locator("#cat-add-btn").click(); await palette.locator("#cat-add-input").fill("Draft category");
  await palette.evaluate(() => { window.catNode = document.querySelector("#cat-add-input"); window.catNode.setSelectionRange(2, 5); }); await lang(palette, "zh");
  check(await palette.evaluate(() => document.activeElement === window.catNode && window.catNode === document.querySelector("#cat-add-input") && window.catNode.value === "Draft category" && window.catNode.selectionStart === 2), "category draft and focus survive language change without blur-commit");
  check(!(await catalog(palette)).groupOrder.includes("Draft category"), "language switch does not accidentally save an inline category");
  await palette.locator("#cat-add-input").press("Escape");
  await palette.evaluate(() => window.dispatchEvent(new Event("pagehide"))); check(await palette.evaluate(() => window.localeMock.listenerCount()) === 0, "palette detaches the added locale listener on page exit"); await palette.close();

  const custom = await open("palette", { custom: true }); await custom.locator('.bubble[data-id="u_paralyzed"]').waitFor();
  check((await custom.locator('.bubble[data-id="u_stunned"]').innerText()).trim() === "作者眩晕", "renamed built-in keeps its author label");
  check((await custom.locator('.bubble[data-id="u_bardic"]').innerText()).trim() === "诗人激励", "same-name built-in with customized color is not masked by automatic translation");
  check((await custom.locator('.bubble[data-id="u_hex"]').innerText()).trim() === "侵扰", "customized built-in effect is recognized even with the original name");
  check((await custom.locator('.bubble[data-id="custom-identical-name"]').innerText()).trim() === "麻痹", "custom id with a built-in-looking name remains author content");
  const customOriginal = await catalog(custom); await lang(custom, "zh"); await lang(custom, "en"); assert.deepEqual(await catalog(custom), customOriginal); passed++; await custom.close();

  const manage = await open("manage", { custom: true }, "?token=token"); await manage.locator('.bubble[data-id="u_paralyzed"]').waitFor();
  check((await manage.locator('.bubble[data-id="u_paralyzed"]').innerText()) === "Paralyzed 3", "management page translates default name and preserves rounds");
  check((await manage.locator('.bubble[data-id="u_hex"]').innerText()) === "侵扰", "management projection retains the full source's customization decision");
  await lang(manage, "zh"); check((await manage.locator('.bubble[data-id="u_paralyzed"]').innerText()) === "麻痹 3", "open management page responds to language changes");
  check((await manage.locator("#title").innerText()).includes("Author Token"), "management title preserves the author's token name");
  await lang(manage, "en"); await manage.locator('.bubble[data-id="u_paralyzed"]').dispatchEvent("pointerdown", { button: 0 });
  check(await manage.evaluate(() => window.localeMock.broadcasts.at(-1).data.buff.name === "麻痹 ⚡"), "management transfer keeps the original status payload");
  await manage.locator("#btnClose").click(); check(await manage.evaluate(() => window.localeMock.windows.at(-1)[0]) === "close", "management close behavior remains available after locale changes"); await manage.close();

  for (const [kind, expected] of [["clear", "Clear all statuses"], ["manage", "Manage statuses"], ["preset", "Preset"]]) {
    const capture = await open("capture", {}, `?kind=${kind}&mode=click-place`); check((await capture.locator("#cursor").innerText()) === expected, `${kind} capture label uses English`);
    await lang(capture, "zh"); check(/[\p{Script=Han}]/u.test(await capture.locator("#cursor").innerText()), `${kind} active capture label updates in Chinese`); await capture.close();
  }

  const gate = await open("initiative", { holdReady: true }); await gate.locator(".loading-state").waitFor();
  check((await gate.locator(".loading-state").innerText()) === "Loading...", "initiative initial loading gate honors English before SDK ready");
  await lang(gate, "zh"); check((await gate.locator(".loading-state").innerText()) === "加载中...", "initial loading gate responds to local language changes");
  await gate.evaluate(() => window.localeMock.ready()); await gate.locator(".item-count").first().waitFor(); await lang(gate, "en");
  check((await gate.locator(".roll-dis").first().getAttribute("title")) === "Disadvantage (2d20, use the lower result)", "roll button tooltip is English");
  check((await gate.locator(".roll-adv").first().getAttribute("aria-label")) === "Advantage", "roll accessibility label is English");
  await gate.locator(".item-count").first().click(); await gate.locator(".count-input").fill("27");
  await gate.evaluate(() => { window.countNode = document.querySelector(".count-input"); }); await lang(gate, "zh");
  check(await gate.evaluate(() => document.activeElement === window.countNode && document.querySelector(".count-input") === window.countNode && window.countNode.value === "27"), "initiative count editor retains its actual node, focus and draft during language switch");
  check(await gate.evaluate(() => window.localeMock.commands.length) === 0, "language-only rerender does not commit initiative changes");
  await gate.locator(".count-input").press("Enter"); const commits = await gate.evaluate(() => window.localeMock.commands.filter(command => command[0] === "count"));
  check(commits.length === 1, `normal explicit initiative commit still fires exactly once: ${JSON.stringify(commits)}`);
  await gate.screenshot({ path: join(out, "initiative-zh.png") }); await lang(gate, "en"); await gate.screenshot({ path: join(out, "initiative-en.png") });
  await gate.locator(".btn-reorder").click(); check((await gate.locator(".reorder-catch").first().getAttribute("title")) === "Click to pick up this card", "reorder pickup hint uses English");
  await gate.locator(".reorder-catch").first().click(); check((await gate.locator(".reorder-slot.active").first().getAttribute("title")) === "Place here", "reorder target hint uses English");
  await lang(gate, "zh"); check((await gate.locator(".reorder-catch").first().getAttribute("title")) === "再次点击取消", "reorder selection survives locale change with translated cancel hint"); await gate.close();

  const player = await open("initiative", { role: "PLAYER" }); await player.locator(".item-count").first().waitFor();
  check(await player.locator(".item-count.locked").count() === 1, "non-owner initiative value stays locked");
  await lang(player, "zh"); await lang(player, "en"); check(await player.locator(".item-count.locked").count() === 1 && await player.locator(".btn-reorder").count() === 0, "locale changes do not unlock another player's item or GM reorder controls");
  await player.evaluate(() => window.localeMock.model({ combatState: { preparing: false, inCombat: true, round: 2 } })); await player.locator(".end-turn-btn").waitFor();
  check((await player.locator(".end-turn-btn").getAttribute("title")) === "End the current turn and advance to the next", "owner end-turn tooltip is translated"); await player.close();
  check(errors.length === 0, `actual page JavaScript has no unhandled errors: ${errors.join("; ")}`);
  writeFileSync(join(out, "result.json"), JSON.stringify({ passed, checks, browser: await browser.version(), realPages: Object.keys(pages), boundary: "SDK/state and initiative model hooks are fixtures; actual page/components/i18n and status display logic", realOwlbearUat: false }, null, 2));
  console.log(`PASS: ${passed} actual DOM locale checks. Evidence: ${out}`);
} finally { await browser.close(); server.close(); }
