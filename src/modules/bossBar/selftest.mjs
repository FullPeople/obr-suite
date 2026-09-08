// Run from the repository root. Uses actual modules with delayed SDK drafts,
// plus Chromium DOM/layout verification. No real Owlbear room is simulated as UAT.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { rolldown } from "rolldown";

const root = resolve(process.cwd()), out = mkdtempSync(join(tmpdir(), "boss-bar-selftest-"));
const KEY = "com.obr-suite/boss-bar/config", HP = "com.obr-suite/bubbles/data", EXT = "com.owlbear-rodeo-bubbles-extension/metadata";
const STATE = "com.obr-suite/boss-bar/state", READY = "com.obr-suite/boss-bar/ready", PREFS = "com.obr-suite/boss-bar/preferences-changed";
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const token = (id, hp = 80, metadata = {}) => ({ id, type: "IMAGE", layer: "CHARACTER", visible: true, name: id, createdUserId: "gm",
  position: { x: 0, y: 0 }, rotation: 0, metadata: { [KEY]: { enabled: true, order: 1 }, [HP]: { health: hp, "max health": 100 }, ...metadata } });

function environment() {
  const listeners = new Map(), storage = new Map();
  const listen = (key, fn) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); return () => listeners.get(key).delete(fn); };
  const env = { items: [token("A")], role: "GM", ready: true, reads: 0, opens: [], closes: [], messages: [], writes: [], menus: new Map(), notifications: [],
    readGate: null, writeGate: null, openGate: null, emit: (key, value) => { for (const fn of [...(listeners.get(key) ?? [])]) void fn(value); } };
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.window = { addEventListener: (key, fn) => listen(`window:${key}`, fn), removeEventListener: (key, fn) => listeners.get(`window:${key}`)?.delete(fn) };
  globalThis.__BOSS_SDK__ = {
    player: { getRole: async () => env.role, onChange: fn => listen("role", fn) },
    scene: { isReady: async () => env.ready, onReadyChange: fn => listen("scene", fn), items: {
      getItems: async ids => { env.reads++; const copy = structuredClone(env.items.filter(item => !ids || ids.includes(item.id))); const gate = env.readGate; if (gate) await gate.promise; return copy; },
      onChange: fn => listen("items", fn), updateItems: async (ids, fn) => { env.writes.push(ids); if (env.writeGate) await env.writeGate.promise;
        const drafts = structuredClone(env.items.filter(item => ids.includes(item.id))); fn(drafts); for (const draft of drafts) env.items[env.items.findIndex(item => item.id === draft.id)] = draft; env.snapshot(); } } },
    broadcast: { onMessage: (key, fn) => listen(key, fn), sendMessage: async (key, data) => { env.messages.push({ key, data: structuredClone(data) }); env.emit(key, { data }); } },
    viewport: { getWidth: async () => 1280 }, popover: { open: async value => { env.opens.push(value); if (env.openGate) await env.openGate.promise; },
      close: async id => { env.closes.push(id); }, setHeight: async () => {} },
    contextMenu: { create: async menu => { env.menus.set(menu.id, menu); }, remove: async id => { env.menus.delete(id); } },
    notification: { show: async value => { env.notifications.push(value); } },
  };
  env.snapshot = () => env.emit("items", structuredClone(env.items));
  env.lastState = () => env.messages.filter(message => message.key === STATE).at(-1)?.data;
  return env;
}

let serial = 0;
async function bundle(entry, mutation) {
  let changed = false;
  const build = await rolldown({ input: join(root, `src/modules/bossBar/${entry}.ts`), platform: entry === "index" ? "node" : "browser", plugins: [{ name: "boss-test-boundaries",
    resolveId(source) {
      if (source === "@owlbear-rodeo/sdk") return "mock:sdk";
      if (source.endsWith("/state")) return "mock:state";
      if (source.endsWith("/asset-base")) return "mock:asset";
      if (source.endsWith("/viewportAnchor")) return "mock:viewport";
      if (source.endsWith(".css")) return "mock:css";
    },
    load(id) {
      if (id === "mock:sdk") return "export default globalThis.__BOSS_SDK__;";
      if (id === "mock:state") return "export const getLocalLang=()=>globalThis.__BOSS_LANG__||'zh';";
      if (id === "mock:asset") return "export const assetUrl=x=>x;";
      if (id === "mock:viewport") return "export const onViewportResize=()=>()=>{};";
      if (id === "mock:css") return "";
      if (mutation && id.replaceAll("\\", "/").endsWith(mutation.file)) { const text = readFileSync(id, "utf8").replaceAll("\r\n", "\n"); assert.ok(text.includes(mutation.from), mutation.name); changed = true; return text.replace(mutation.from, mutation.to); }
    },
  }] });
  const file = join(out, `${entry}-${serial++}.mjs`);
  await build.write({ file, format: "esm", codeSplitting: false }); await build.close();
  if (mutation) assert.ok(changed, mutation.name);
  return file;
}

async function controllerTest(file) {
  const env = environment(), module = await import(pathToFileURL(file).href);
  env.readGate = deferred(); const boot = module.setupBossBar(); await settle();
  assert.equal(env.reads, 1);
  env.items[0].visible = false; env.snapshot(); env.readGate.resolve(); env.readGate = null;
  await boot; await settle(); assert.equal(env.opens.length, 0, "late initial read must not reveal hidden Boss");
  env.items[0].visible = true; env.snapshot(); await settle();
  assert.equal(env.opens.length, 1); assert.equal(env.opens[0].height, 60); assert.equal(env.opens[0].width, 600);
  assert.equal(env.lastState().bosses[0].ratio, .8); assert.equal("numbers" in env.lastState().bosses[0], false, "default payload must omit HP numbers");
  const reads = env.reads, messages = env.messages.length;
  for (let i = 0; i < 100; i++) { env.items[0].position.x++; env.items[0].metadata.unrelated = i; env.snapshot(); }
  await settle(); assert.equal(env.reads, reads); assert.equal(env.messages.length, messages); assert.equal(env.writes.length, 0);
  env.items[0].metadata[HP].health = 36; env.snapshot(); await settle();
  assert.equal(env.lastState().bosses[0].ratio, .36); assert.equal(env.opens.length, 1, "HP updates must retain the iframe");
  env.items[0].metadata[KEY].exact = true; env.snapshot(); await settle(); assert.deepEqual(env.lastState().bosses[0].numbers, { hp: 36, max: 100 });
  env.emit(READY, { data: { session: env.lastState().session, requestId: "late-page" } }); await settle();
  assert.equal(env.lastState().replay, "late-page", "late/reloaded page receives authoritative replay");
  await module.setBossPreferences({ hidden: true }); await settle(); assert.ok(env.closes.includes("com.obr-suite/boss-bar/overlay"));
  const beforeRestore = env.opens.length; await module.setBossPreferences({ hidden: false }); await settle(); assert.equal(env.opens.length, beforeRestore + 1);
  env.items = [token("A"), token("B"), token("C"), token("D", 10, { [KEY]: { enabled: false } })]; env.snapshot(); await settle();
  const beforeCap = env.writes.length; env.menus.get("com.obr-suite/boss-bar/show").onClick({ items: [env.items[3]] }); await settle();
  assert.equal(env.writes.length, beforeCap); assert.equal(env.notifications.length, 1, "fourth Boss rejected with feedback");
  env.items[3].metadata[KEY].enabled = true; env.snapshot(); await settle(); assert.equal(env.lastState().bosses.length, 3);
  env.items[0].metadata[HP].hide = true; env.items[1].visible = false; env.items = env.items.filter(item => item.id !== "C"); env.snapshot(); await settle();
  assert.deepEqual(env.lastState().bosses.map(item => item.id), ["D"], "hidden and deleted tokens never appear even for GM");
  env.items = [token("E", 10, { [KEY]: { enabled: false } })]; env.snapshot(); await settle();
  const before = structuredClone(env.items[0].metadata); env.writeGate = deferred();
  env.menus.get("com.obr-suite/boss-bar/show").onClick({ items: [env.items[0]] }); await settle();
  env.role = "PLAYER"; env.emit("role", { role: "PLAYER" }); await settle(); env.writeGate.resolve(); env.writeGate = null; await settle();
  assert.deepEqual(env.items[0].metadata, before, "role revoked before SDK draft must prevent mutation");
  env.role = "GM"; env.emit("role", { role: "GM" }); await settle();
  env.menus.get("com.obr-suite/boss-bar/show").onClick({ items: [env.items[0]] }); await settle();
  assert.equal(env.items[0].metadata[KEY].enabled, true); assert.deepEqual(env.items[0].metadata[HP], before[HP], "Boss toggle must never change health");
  assert.equal(env.lastState().bosses[0].id, "E");
  env.ready = false; env.emit("scene", false); await settle(); assert.deepEqual(env.lastState().bosses, []);
  await module.teardownBossBar(); assert.equal(env.menus.size, 0);

  const second = env; second.items = [token("A")]; second.role = "GM"; second.ready = true; second.opens = []; second.writes = []; second.closes = [];
  second.openGate = deferred(); const boot2 = module.setupBossBar(); await settle();
  assert.equal(second.opens.length, 1); second.ready = false; second.emit("scene", false); const stop = module.teardownBossBar();
  second.openGate.resolve(); await Promise.all([boot2, stop]); await settle();
  assert.ok(second.closes.includes("com.obr-suite/boss-bar/overlay"), "late open must converge to closed after scene exit");
  assert.equal(second.writes.length, 0);
}

async function modelTest(file) {
  const { publicBosses } = await import(pathToFileURL(file).href);
  const legacy = token("Legacy"); delete legacy.metadata[HP]; legacy.metadata[EXT] = { health: 7, "max health": 10 };
  assert.equal(publicBosses([legacy])[0].ratio, .7);
  const invalid = token("invalid"); invalid.metadata[HP].health = NaN;
  assert.deepEqual(publicBosses([invalid]), []);
  const own = token("own", 22, { [EXT]: { health: 99, "max health": 100 } }); assert.equal(publicBosses([own])[0].ratio, .22);
  const bound = token("bound", 50, { "com.character-cards/boundCardId": "card", "com.bestiary/slug": "dragon" }); assert.equal(publicBosses([bound])[0].ratio, .5);
  assert.equal(publicBosses([token("zero", 0)])[0].ratio, 0);
}

// Runs inside Chromium before the actual page module loads.
function browserMock() {
  window.__BOSS_LANG__ = new URLSearchParams(location.search).get("lang") || "zh";
  const handlers = new Map();
  const on = (key, fn) => { if (!handlers.has(key)) handlers.set(key, new Set()); handlers.get(key).add(fn); return () => handlers.get(key).delete(fn); };
  const env = window.testBoss = { messages: [], writes: [], items: [], ready: true, role: "GM", deferredWrite: null,
    emit: (key, value) => { for (const fn of [...(handlers.get(key) || [])]) fn(value); },
    deliver: (bosses, version, extra = {}) => { env.emit("com.obr-suite/boss-bar/state", { data: { session: "test", version, bosses,
      replay: env.messages.filter(message => message.key === "com.obr-suite/boss-bar/ready").at(-1)?.data.requestId, ...extra } }); } };
  window.__BOSS_SDK__ = {
    onReady: fn => { queueMicrotask(fn); }, player: { getRole: async () => env.role, onChange: fn => on("role", fn) },
    scene: { isReady: async () => env.ready, onReadyChange: fn => on("scene", fn), items: { getItems: async ids => structuredClone(env.items.filter(item => ids.includes(item.id))),
      onChange: fn => on("items", fn), updateItems: async (ids, fn) => { env.writes.push(ids); if (env.deferredWrite) await env.deferredWrite;
        const drafts = structuredClone(env.items.filter(item => ids.includes(item.id))); fn(drafts); for (const draft of drafts) env.items[env.items.findIndex(item => item.id === draft.id)] = draft; } } },
    broadcast: { onMessage: on, sendMessage: async (key, data) => { env.messages.push({ key, data }); if (key.endsWith("preferences-changed")) env.emit(key, { data }); } },
    popover: { close: async () => {} }, notification: { show: async () => {} },
  };
}

async function browserTest(pageFile) {
  const runtime = process.env.CODEX_PLAYWRIGHT_DIR || "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
  const { chromium } = await import(pathToFileURL(join(runtime, "index.mjs")).href);
  const css = readFileSync(join(root, "src/modules/bossBar/style.css"), "utf8");
  const html = readFileSync(join(root, "boss-bar.html"), "utf8").replace('<script type="module" src="/src/modules/bossBar/page.ts"></script>', '<script type="module" src="/page.js"></script>').replace("</head>", `<style>${css}</style></head>`);
  const server = createServer((request, response) => { response.setHeader("content-type", request.url === "/page.js" ? "text/javascript" : "text/html"); response.end(request.url === "/page.js" ? readFileSync(pageFile) : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.BOSS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 600, height: 60 }, deviceScaleFactor: 2 });
  const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(String(error)));
  await page.addInitScript(browserMock);
  const sample = { id: "A", name: "烬冠古龙 · 阿兹瑞恩", ratio: .72, phase: "第二阶段 · 灰烬王座", segments: 3 };
  try {
    await page.goto(`${base}/?session=test`); await page.waitForFunction(() => testBoss.messages.some(message => message.key.endsWith("/ready")));
    assert.equal(await page.locator(".boss").count(), 0, "page starts blank until authoritative replay");
    await page.evaluate(sample => testBoss.deliver([sample], 1), sample);
    await page.locator(".bossName").waitFor(); assert.equal(await page.locator(".bossName").textContent(), sample.name); assert.equal(await page.locator(".numbers").textContent(), "");
    await page.screenshot({ path: join(out, "boss-single-zh.png"), omitBackground: true });
    const damage = await page.evaluate(sample => { testBoss.deliver([{ ...sample, ratio: .35 }], 2, { replay: undefined });
      return [document.querySelector(".fill").style.width, document.querySelector(".trail").style.width]; }, sample);
    assert.deepEqual(damage, ["35%", "72%"]);
    await page.waitForFunction(() => document.querySelector(".trail").style.width === "35%");
    await page.evaluate(sample => testBoss.deliver([{ ...sample, ratio: .99 }], 1, { replay: undefined }), sample);
    assert.equal(await page.locator(".fill").evaluate(node => node.style.width), "35%", "old packet cannot undo damage");
    await page.evaluate(() => { window.mutationCount = 0; new MutationObserver(changes => window.mutationCount += changes.length).observe(document.getElementById("bossBars"), { subtree: true, childList: true, attributes: true, characterData: true }); });
    await page.evaluate(sample => { for (let i = 0; i < 100; i++) testBoss.deliver([{ ...sample, ratio: .35 }], 3 + i, { replay: undefined }); }, sample);
    assert.equal(await page.evaluate(() => window.mutationCount), 0, "identical public updates must not repaint");
    await page.setViewportSize({ width: 600, height: 144 });
    await page.evaluate(sample => testBoss.deliver([sample, { ...sample, id: "B", name: "The Hollow Sovereign", ratio: .48, phase: "Phase II", numbers: { hp: 144, max: 300 }, segments: 4 },
      { ...sample, id: "C", name: "不眠守门人", ratio: 0, phase: "", segments: 1 }], 103, { replay: undefined }), sample);
    assert.equal(await page.locator(".boss").count(), 3);
    assert.ok(await page.locator("#bossBars").evaluate(node => node.getBoundingClientRect().bottom <= 144));
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: join(out, "boss-three-zh-en.png"), omitBackground: true });
    await page.setViewportSize({ width: 288, height: 144 }); await page.screenshot({ path: join(out, "boss-narrow.png"), omitBackground: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 288, "narrow layout must not overflow");
    await page.evaluate(() => { testBoss.ready = false; testBoss.emit("scene", false); }); assert.equal(await page.locator(".boss").count(), 0);
    await page.evaluate(sample => { testBoss.ready = true; testBoss.emit("scene", true); testBoss.deliver([sample], 104, { replay: undefined }); }, sample);
    assert.equal(await page.locator(".boss").count(), 0, "old-scene unsolicited packet cannot repopulate new scene");
    await page.evaluate(sample => testBoss.deliver([sample], 105), sample); assert.equal(await page.locator(".boss").count(), 1);
    await page.evaluate(() => { testBoss.role = "PLAYER"; testBoss.emit("role", { role: "PLAYER" }); }); assert.equal(await page.locator(".boss").count(), 0);
    await page.evaluate(sample => testBoss.deliver([sample], 105), sample); assert.equal(await page.locator(".boss").count(), 1);
    await page.locator("#localHide").click(); assert.equal(await page.locator(".boss").count(), 0);
    await page.evaluate(() => { localStorage.setItem("obr-suite/boss-bar/preferences", JSON.stringify({ hidden: false, reducedMotion: true })); testBoss.emit("com.obr-suite/boss-bar/preferences-changed", {}); });
    await page.evaluate(sample => testBoss.deliver([{ ...sample, ratio: .2 }], 106, { replay: undefined }), sample);
    assert.equal(await page.locator(".trail").evaluate(node => node.style.width), "20%");
    assert.equal(await page.locator(".fill").evaluate(node => getComputedStyle(node).transitionDuration), "0s");

    // Real config DOM with a write delayed until after scene/permission revocation.
    await page.addInitScript(item => { testBoss.items = [item]; }, token("A"));
    await page.setViewportSize({ width: 320, height: 302 }); await page.goto(`${base}/?mode=config&itemId=A&lang=en`);
    await page.waitForFunction(() => !document.getElementById("optionsFields").disabled);
    await page.locator("#phase").fill("The Last Ember"); await page.locator("#exact").check(); await page.locator("#segments").selectOption("3");
    await page.screenshot({ path: join(out, "boss-options-en.png") });
    assert.ok(await page.locator("#hpHint").evaluate(node => node.getBoundingClientRect().bottom <= 302));
    await page.evaluate(() => { testBoss.deferredWrite = new Promise(resolve => { window.releaseWrite = resolve; }); });
    await page.locator("#save").click(); await page.waitForFunction(() => testBoss.writes.length === 1);
    await page.evaluate(() => { testBoss.role = "PLAYER"; testBoss.emit("role", { role: "PLAYER" }); releaseWrite(); });
    await page.waitForTimeout(20);
    assert.equal(await page.evaluate(key => testBoss.items[0].metadata[key].exact, KEY), undefined, "role change before delayed draft prevents config write");
    assert.equal(await page.locator("#optionsFields").evaluate(node => node.disabled), true);
    assert.equal(await page.locator("#save").isDisabled(), true);
    await page.goto(`${base}/?mode=config&itemId=A&lang=en`);
    await page.waitForFunction(() => !document.getElementById("optionsFields").disabled);
    await page.locator("#phase").fill("The Last Ember"); await page.locator("#exact").check(); await page.locator("#segments").selectOption("3");
    await page.locator("#save").click(); await page.waitForFunction(() => document.getElementById("saveStatus").textContent === "Saved");
    assert.deepEqual(await page.evaluate(key => testBoss.items[0].metadata[key], KEY), { enabled: true, exact: true, phase: "The Last Ember", segments: 3, order: 1 });
    assert.deepEqual(await page.evaluate(key => testBoss.items[0].metadata[key], HP), { health: 80, "max health": 100 });
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

try {
  await controllerTest(await bundle("index")); await modelTest(await bundle("model"));
  const mutations = [
    { name: "late-read", file: "bossBar/index.ts", from: "request === readVersion) publish(items)", to: "true) publish(items)" },
    { name: "visibility", file: "bossBar/model.ts", from: 'item.visible === true && !stats.hide', to: 'true' },
    { name: "numeric-leak", file: "bossBar/model.ts", from: '...(config.exact ? { numbers:', to: '...(true ? { numbers:' },
    { name: "draft-role", file: "bossBar/index.ts", from: 'if (!current()) return;\n      for (const item of drafts)', to: 'for (const item of drafts)' },
  ];
  for (const mutation of mutations) { let failed = false; try { await controllerTest(await bundle("index", mutation)); } catch (error) { if (error.code !== "ERR_ASSERTION") throw error; failed = true; } assert.ok(failed, `surviving mutation: ${mutation.name}`); }
  await browserTest(await bundle("page"));
  console.log(`Boss selftest PASS: late join/read, visibility/deletion, legacy HP, stable iframe, 100 idle events, permissions, teardown, 4/4 mutations; Chromium DOM/layout/animation/config race PASS. Screenshots: ${out}`);
  // Screenshots intentionally remain outside the source tree for visual review.
  for (let i = 0; i < serial; i++) for (const entry of ["index", "model", "page"]) { const file = join(out, `${entry}-${i}.mjs`); if (existsSync(file)) rmSync(file); }
} catch (error) {
  console.error(error); console.error(`Artifacts: ${out}`); process.exitCode = 1;
}
