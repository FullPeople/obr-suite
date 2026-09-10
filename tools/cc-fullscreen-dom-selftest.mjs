import { build } from "rolldown";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), { chromium } = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out = mkdtempSync(join(tmpdir(), "cc-fullscreen-dom-")); let browser, passed = 0;
const check = (value, name) => { if (!value) throw Error(`ASSERTION: ${name}`); passed++; };
const character = (name = "玩家自己取名") => ({ identity: { display_name: name, race: { name: "精灵" }, alignment: "中立善良", languages: ["通用语"], tool_proficiencies: ["盗贼工具"] }, classes: [{ name: "法师", level: 4 }], core_stats: { hp: { current: 20, max: 30 }, ac: 15, size: "中型", speed: 30 }, abilities: { dex: { total: 14, modifier: 2 }, int: { total: 18, modifier: 4 } }, skills: [{ name: "巧手", ability: "敏捷", total: 4 }], defenses: { resistances: ["火焰"], immunities: ["魅惑"] }, combat: { weapons: [{ name: "长剑", damage: "1d8", damage_type: "挥砍", properties: "灵巧, 投掷(射程20，60), Weapon Mastery: Nick", mastery: "Nick" }] }, spellcasting: { spellcasting_ability: "智力", prepared: [{ name: "火球术" }, { name: "冰刃", source: "PHB" }, { name: "原创法术", name_en: "Authored name", description: "保留玩家自写正文", meta: { school: "塑能", duration: "1分钟" } }] }, features: { feats: [{ name: "自创专长", name_en: "Provided feat name", description: "不改作者文字" }] }, background: { personality_traits: "保留背景草稿" } });
async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on("pageerror", error => { throw error; });
  await page.route("https://test.local/**", route => route.fulfill({ contentType: "text/html", body: readFileSync("cc-fullscreen.html", "utf8").replace(/<script type="module"[^>]*><\/script>/, "") }));
  await page.goto("https://test.local/cc-fullscreen.html?room=r1&card=a");
  await page.evaluate(({ card, options }) => {
    const lib = (id, language, indexPath = "search/index.json") => ({ id, language, indexPath, name: id, enabled: true, baseUrl: `https://${id}.test`, disabledSources: [] });
    const m = window.fullMock = { lang: "en", langListeners: new Set(), stateListeners: new Set(), state: { libraries: [lib("cn", "zh"), lib("en", "en", "search/custom.json")], dataVersion: "all" }, listeners: {}, card, requests: [], sent: [], patches: [], rolls: [], held: [], hold: "", fail: "", confirms: 0, confirmResult: true };
    Object.assign(m, options);
    m.language = value => { m.lang = value; for (const callback of m.langListeners) callback(value); };
    m.configure = patch => { Object.assign(m.state, patch); for (const callback of m.stateListeners) callback(m.state); };
    m.remote = (data = { cardId: "a", roomId: "r1" }) => { for (const callback of m.listeners["com.obr-suite/cc-card-updated"] ?? []) callback({ data }); };
    window.confirm = () => { m.confirms++; return m.confirmResult; }; window.alert = () => {};
    window.fetch = async (value, init = {}) => {
      const url = String(value); m.requests.push({ url, method: init.method ?? "GET", body: init.body });
      const en = url.startsWith("https://en.test"); let body;
      if (url.includes("/characters/")) body = structuredClone(m.card);
      else if (init.method === "PUT") body = { name: "Saved" };
      else if (url.endsWith("search/index.json") || url.endsWith("search/custom.json")) body = { m: { s: { PHB: 1, XPHB: 2 } }, x: [{ c: 2, n: "Fireball", cn: en ? "" : "火球术", s: 1 }, { c: 2, n: "Fireball", cn: en ? "" : "火球术", s: 2 }, { c: 2, n: "Ice Knife", cn: en ? "" : "冰刃", s: 1 }] };
      else if (url.endsWith("data/spells/index.json")) body = { PHB: "spells-phb.json", XPHB: "spells-xphb.json" };
      else if (url.includes("data/spells/spells-")) { const source = url.endsWith("spells-xphb.json") ? "XPHB" : "PHB"; body = { spell: ["Fireball", "Ice Knife"].map(name => ({ name: en ? name : name === "Fireball" ? "火球术" : "冰刃", ENG_name: name, source, school: "V", time: [{ number: 1, unit: "bonus" }], range: { type: "point", distance: { type: "feet", amount: 60 } }, components: { v: true, m: { text: "A test component", cost: 100, consume: true } }, duration: [{ type: "timed", concentration: true, duration: { type: "minute", amount: 1, upTo: true } }], entries: [`${en ? "English full spell body" : "中文法术完整正文"} ${source} ${name}`, { type: "list", items: ["Nested option"] }, { type: "table", colLabels: ["Roll", "Result"], rows: [["1", "Safe <script>alert(1)</script>"]] }], entriesHigherLevel: [{ name: en ? "At Higher Levels" : "升环施法", entries: ["Additional body"] }] })) }; }
      else throw Error(`Unexpected fetch ${url}`);
      if (m.invalid && url.includes(m.invalid)) body = { x: "invalid" };
      const status = m.fail && url.includes(m.fail) ? 503 : 200;
      if (m.hold && url.includes(m.hold)) return await new Promise(resolve => m.held.push(() => resolve(new Response(JSON.stringify(body), { status }))));
      return new Response(JSON.stringify(body), { status });
    };
    m.release = () => { for (const done of m.held.splice(0)) done(); };
  }, { card: character(), options });
  await page.addScriptTag({ path: join(out, "fullscreen.js") });
  await page.locator(".cc-head-name").waitFor(); return page;
}
const text = page => page.locator("#app").innerText();
const tab = (page, name) => page.locator(".cc-tab:visible").filter({ hasText: name }).click();
const refresh = page => page.locator(".cc-head-right button").filter({ hasText: /^(Refresh|刷新)$/ }).click();
const edit = page => page.locator(".cc-head-right button").filter({ hasText: /(?:Edit|编辑)/ }).first().click();
try {
  await build({ input: resolve("src/modules/characterCards/fullscreen-page.tsx"), plugins: [{ name: "fullscreen-fixture", resolveId(id) { if (id === "@owlbear-rodeo/sdk" || id === "../../state" || id === "../dice/tags" || id === "../dice/sfx-broadcast" || id === "../../utils/statEdit" || id === "./xlsx-shield-state") return resolve("tools/cc-fullscreen-dom-fixture.ts"); }, transform(code, id) {
    if (!process.env.CC_FULLSCREEN_MUTANT || !id.replaceAll('\\', '/').endsWith('/characterCards/fullscreen-page.tsx')) return;
    const mutations = { 'raw-draft': ['draft.current.focused && draft.current.dirty ? draft.current.value : props.value', 'props.value'], 'stale-read': ['if (!current()) return false;', 'if (false) return false;'], 'weapon-terms': ['fullProperties(w, _lang)', 'String(w.properties ?? "")'] };
    const [from, to] = mutations[process.env.CC_FULLSCREEN_MUTANT] ?? []; if (!from || !code.includes(from)) throw Error('Mutation target missing'); return code.replace(from, to);
  } }], output: { file: join(out, "fullscreen.js"), format: "iife" } });
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
  const page = await open();
  check((await text(page)).includes("Elf") && (await text(page)).includes("Wizard") && (await text(page)).includes("Neutral Good"), "identity fixed terms are English");
  check((await text(page)).includes("Sleight of Hand") && (await text(page)).includes("DEX"), "Chinese ability and skill keys are shown in English");
  check((await text(page)).includes("Thieves' Tools") && (await text(page)).includes("Charmed"), "languages tools and defense terms are English");
  check((await text(page)).includes("Longsword") && (await text(page)).includes("Slashing") && (await text(page)).includes("Thrown(range 20，60)"), "weapon terms and parentheses are translated without splitting ranges");
  check((await text(page)).match(/Mastery: Nick/g)?.length === 1, "dedicated mastery does not duplicate prefixed property");
  check((await text(page)).includes("玩家自己取名") && await page.evaluate(() => fullMock.patches.length === 0 && fullMock.requests.every(r => r.method === "GET")), "localization does not rewrite author names or data");
  const hp = page.locator(".stat-cell.hp .stat-input").first(); await hp.fill("+5"); await page.evaluate(() => fullMock.language("zh"));
  check(await hp.inputValue() === "+5" && await hp.evaluate(e => document.activeElement === e), "HP raw draft and focus survive language change");
  await page.evaluate(() => fullMock.remote()); await page.locator(".cc-sync-notice").waitFor();
  check(await hp.inputValue() === "+5" && await page.evaluate(() => fullMock.requests.filter(r => r.url.includes('/characters/')).length === 1), "remote notification defers loading while HP draft exists");
  await page.evaluate(() => { fullMock.confirmResult = false; }); await refresh(page);
  check(await page.evaluate(() => fullMock.confirms === 1) && await hp.inputValue() === "5", "explicit reload can be cancelled and committed input remains");
  await page.evaluate(() => { fullMock.confirmResult = true; fullMock.language('en'); fullMock.card = { ...fullMock.card, identity: { ...fullMock.card.identity, display_name: 'Reloaded' } }; }); await refresh(page); await page.waitForFunction(() => document.querySelector('.cc-head-name').textContent.includes('Reloaded'));
  check(await page.evaluate(() => fullMock.requests.filter(r => r.url.includes('/characters/')).length === 2), "own reload broadcast does not cause duplicate read");
  await edit(page); const score = page.locator('.abl-total.cc-edit-num').first(); await score.fill(''); await page.evaluate(() => fullMock.language('zh'));
  check(await score.inputValue() === '' && await score.evaluate(e => document.activeElement === e), "blank numeric draft survives full tree language render");
  await page.evaluate(() => fullMock.language('en')); await tab(page, 'Spells');
  await page.locator('.spell-group-h .cc-add-tag').first().click(); const search = page.locator('.cc-modal input'); await search.fill('火球');
  await page.waitForFunction(() => document.querySelectorAll('.cc-modal-row:not(.cc-modal-row-free)').length === 2);
  check((await page.locator('.cc-modal-list').innerText()).includes('PHB') && (await page.locator('.cc-modal-list').innerText()).includes('XPHB'), "same spell retains both 2014 and 2024 source options");
  check(await page.evaluate(() => fullMock.requests.some(r => r.url === 'https://en.test/search/custom.json')), "custom index path is respected");
  await page.evaluate(() => fullMock.configure({ dataVersion: '2024' })); await page.waitForFunction(() => document.querySelectorAll('.cc-modal-row:not(.cc-modal-row-free)').length === 1);
  check(await search.inputValue() === '火球' && await search.evaluate(e => document.activeElement === e), "version change retains picker query and focus");
  await page.locator('.cc-modal-row:not(.cc-modal-row-free)').click(); await page.locator('.cc-head-right button').filter({ hasText: /^💾Save$/ }).click();
  check(await page.evaluate(() => fullMock.requests.some(r => r.method === 'PUT' && JSON.parse(r.body).spellcasting.cantrips_known[0].source === 'XPHB')), "explicit spell pick preserves source in saved reference");
  await edit(page); await page.locator('.spell-name').filter({ hasText: '冰刃' }).click(); await page.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('English full spell body PHB Ice Knife'));
  check((await page.locator('.spell-detail').innerText()).includes('At Higher Levels') && (await page.locator('.spell-detail').innerText()).includes('Nested option'), "source-specific full body and higher-level structured entries render");
  check(await page.locator('.spell-detail script').count() === 0, "library markup renders as inert text");
  check((await page.locator('.spell-detail').innerText()).includes('1 bonus action') && (await page.locator('.spell-detail').innerText()).includes('60 feet'), "mechanical casting time and range accompany full spell body");
  check((await page.locator('.spell-detail').innerText()).includes('Material value: 1 gp') && (await page.locator('.spell-detail').innerText()).includes('Material is consumed') && (await page.locator('.spell-detail').innerText()).includes('up to'), "material cost consumption and duration qualifiers are retained");
  const before = await page.evaluate(() => fullMock.requests.length); await page.locator('.spell-name').filter({ hasText: 'Authored name' }).click();
  check((await page.locator('.spell-detail').innerText()).includes('保留玩家自写正文') && (await page.locator('.spell-detail').innerText()).includes('1 min.'), "authored body stays intact while fixed metadata is English");
  check(await page.evaluate(() => fullMock.requests.length) === before, "authored description never triggers replacement library fetch");
  await page.locator('.spell-name').filter({ hasText: '冰刃' }).click(); await page.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('English full spell body'));
  check(await page.evaluate(() => fullMock.requests.length) === before, "reopening details reuses bounded successful cache");
  await page.evaluate(() => fullMock.language('zh')); await page.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('中文法术完整正文 PHB'));
  check((await page.locator('.spell-detail').innerText()).includes('升环施法'), "language change reloads entire body from matching source language");
  await page.evaluate(() => fullMock.configure({ libraries: [] })); await page.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('暂未找到'));
  check(await page.evaluate(() => fullMock.requests.every(r => !r.url.includes('5e.kiwee.top'))), "disabling all libraries never silently enables a fallback library");
  await page.close();

  const race = await open(); await race.evaluate(() => { fullMock.hold = '/characters/'; fullMock.card.identity.display_name = 'Old reply'; fullMock.remote(); }); await race.waitForFunction(() => fullMock.held.length > 0);
  await race.evaluate(() => { fullMock.hold = ''; fullMock.card.identity.display_name = 'New reply'; fullMock.remote(); }); await race.waitForFunction(() => document.querySelector('.cc-head-name').textContent.includes('New reply'));
  await race.evaluate(() => fullMock.release()); check((await text(race)).includes('New reply') && !(await text(race)).includes('Old reply'), "out-of-order reads cannot overwrite latest server data");
  const count = await race.evaluate(() => fullMock.requests.length); await race.evaluate(() => fullMock.remote({ cardId: 'a', roomId: 'another-room' }));
  check(await race.evaluate(() => fullMock.requests.length) === count, "same card ID in another room does not trigger a read");
  await race.evaluate(() => { fullMock.hold = '/characters/'; fullMock.remote(); }); await race.waitForFunction(() => fullMock.held.length > 0); await edit(race); const weapon = race.locator('.weap-edit input').first(); await weapon.fill('正在编辑的武器'); await race.evaluate(() => fullMock.release());
  check(await weapon.inputValue() === '正在编辑的武器' && await race.locator('.cc-sync-notice').count() === 1, "local edit invalidates pending server read and keeps update notice visible");
  await race.evaluate(() => { fullMock.fail = '/characters/'; fullMock.hold = ''; }); await refresh(race); await race.locator('.cc-sync-notice').waitFor();
  check(await weapon.inputValue() === '正在编辑的武器', "failed explicit reload keeps loaded sheet and unsaved draft mounted");
  await race.evaluate(() => { fullMock.fail = ''; fullMock.hold = '/characters/'; }); await refresh(race); await race.waitForFunction(() => fullMock.held.length > 0); await race.evaluate(() => { window.dispatchEvent(new Event('pagehide')); fullMock.release(); });
  check(await race.locator('#app').innerText() === '' && await race.evaluate(() => fullMock.langListeners.size === 0 && fullMock.stateListeners.size === 0), "pagehide unmounts controls, subscriptions and ignores late reads");
  await race.close();

  const details = await open(); await tab(details, 'Spells'); await details.locator('.spell-name').filter({ hasText: '火球术' }).click();
  await details.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('Choose the spell source'));
  check(await details.locator('.spell-detail button').count() === 2, "legacy source-less spell asks instead of silently choosing another edition");
  await details.locator('.spell-detail button').filter({ hasText: 'XPHB' }).click(); await details.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('English full spell body XPHB'));
  check(!(await details.locator('.spell-detail').innerText()).includes('English full spell body PHB'), "explicit source choice fetches exactly its edition");
  await details.evaluate(() => { fullMock.hold = 'https://en.test/data/spells/spells-phb'; }); await details.locator('.spell-name').filter({ hasText: '冰刃' }).click(); await details.waitForFunction(() => fullMock.held.length > 0);
  await details.evaluate(() => fullMock.language('zh')); await details.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('中文法术完整正文 PHB'));
  await details.evaluate(() => fullMock.release()); check(!(await details.locator('.spell-detail').innerText()).includes('English full spell body'), "late English detail cannot repaint after language switch");
  await details.evaluate(() => { fullMock.hold = ''; fullMock.configure({ libraries: fullMock.state.libraries.map(lib => ({ ...lib, disabledSources: ['phb'] })) }); }); await details.waitForFunction(() => document.querySelector('.spell-detail')?.textContent.includes('暂未找到'));
  check(!(await details.locator('.spell-detail').innerText()).includes('完整正文'), "source revocation invalidates already displayed cached body");
  await details.close();

  const retry = await open(); await retry.evaluate(() => { fullMock.invalid = 'search/'; }); await edit(retry); await tab(retry, 'Spells'); await retry.locator('.spell-group-h .cc-add-tag').first().click(); await retry.locator('.cc-modal-msg button').waitFor();
  await retry.evaluate(() => { fullMock.invalid = ''; }); await retry.locator('.cc-modal-msg button').click(); await retry.waitForFunction(() => document.querySelectorAll('.cc-modal-row').length === 3);
  check(await retry.evaluate(() => fullMock.requests.filter(r => r.url.includes('/search/')).length === 4), "invalid index is not cached and same-page retry recovers");
  const query = retry.locator('.cc-modal input'); await query.fill('Ice');
  await retry.evaluate(() => fullMock.configure({ libraries: fullMock.state.libraries.map(lib => ({ ...lib, baseUrl: lib.baseUrl + '/v2', indexPath: 'search/custom.json' })) })); await retry.waitForFunction(() => fullMock.requests.some(r => r.url.includes('/v2/search/custom.json')));
  check(await query.inputValue() === 'Ice' && await query.evaluate(e => document.activeElement === e), "changing library URLs invalidates cache without losing modal draft");
  if (process.env.CC_FULLSCREEN_SCREENSHOT) { await retry.locator('.cc-modal-foot button').click(); await edit(retry); await tab(retry, 'Overview'); await retry.screenshot({ path: process.env.CC_FULLSCREEN_SCREENSHOT }); }
  await retry.close();

  const translatedCard = character();
  translatedCard.features.feats = [{ name: '提供的英文专长', name_en: 'English-only feature', description_en: 'An authored English description without a Chinese body.' }];
  const translated = await open({ card: translatedCard }); await tab(translated, 'Features');
  await translated.locator('.feat-h').filter({ hasText: 'English-only feature' }).waitFor();
  check((await translated.locator('.feat-body').innerText()).includes('An authored English description'), 'provided English-only feature body is visible without a base description');
  await translated.close();

  const settings = await open({ holdSettings: true }); await edit(settings); await tab(settings, 'Spells'); await settings.locator('.spell-group-h .cc-add-tag').first().click(); await settings.waitForFunction(() => document.querySelector('.cc-modal-msg')?.textContent.includes('Library settings'));
  check(await settings.evaluate(() => fullMock.requests.every(request => !request.url.includes('/search/'))), "no default libraries are fetched before authoritative room settings arrive");
  await settings.evaluate(() => { fullMock.holdSettings = false; }); await settings.locator('.cc-modal-msg button').click(); await settings.waitForFunction(() => document.querySelectorAll('.cc-modal-row').length === 3);
  check(await settings.locator('.cc-modal-row').count() === 3, "same-page settings retry enables configured spell sources");
  await settings.evaluate(() => { for (const callback of fullMock.sceneListeners) callback(false); }); await settings.waitForFunction(() => document.querySelectorAll('.cc-modal-row').length === 0);
  check((await settings.locator('.cc-modal-msg').innerText()).includes('Library settings'), "scene closure revokes old configured library results");
  await settings.evaluate(() => { fullMock.state.libraries = []; for (const callback of fullMock.sceneListeners) callback(true); }); await settings.waitForFunction(() => document.querySelector('.cc-modal-msg')?.textContent.includes('No spells are available'));
  check(await settings.locator('.cc-modal-row').count() === 0, "new scene with all libraries disabled stays empty after settings refresh");
  console.log(`PASS ${passed} fullscreen DOM / delayed content assertions`);
} finally { await browser?.close(); rmSync(out, { recursive: true, force: true }); }
