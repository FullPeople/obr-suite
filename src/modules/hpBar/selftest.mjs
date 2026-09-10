// Run from the repository root: node src/modules/hpBar/selftest.mjs
// Exercises the actual background/page modules with delayed SDK responses.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const root = resolve(process.cwd());
const out = mkdtempSync(join(tmpdir(), "hp-bar-selftest-"));
const HP = "com.obr-suite/bubbles/data";
const EXT = "com.owlbear-rodeo-bubbles-extension/metadata";
const FLAG = "com.obr-suite/hp-bar/enabled";
const TARGET = "com.obr-suite/hp-bar/target";
const READY = "com.obr-suite/hp-bar/ready";
const PIN = "obr-suite/hp-bar-pinned";
const settle = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const token = (id, hp = 10, metadata = {}) => ({ id, type: "IMAGE", layer: "CHARACTER", name: id,
  createdUserId: "gm", position: { x: 0, y: 0 }, metadata: { [FLAG]: true, [HP]: { health: hp, "max health": 20 }, ...metadata } });

function environment() {
  const listeners = new Map();
  const listen = (key, fn) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); return () => listeners.get(key).delete(fn); };
  const emit = (key, value) => { for (const fn of [...(listeners.get(key) ?? [])]) void fn(value); };
  const env = { items: [token("A"), token("B", 15)], selection: [], role: "GM", playerId: "gm", ready: true,
    reads: [], selectionReads: 0, opens: [], closes: 0, messages: [], writes: [], paints: 0,
    readGate: null, writeGate: null, openGate: null, roleGate: null, emit };
  class Element {
    constructor(field) { this.dataset = field ? { field } : {}; this.handlers = new Map(); this.style = { setProperty: () => { env.paints++; } };
      this.classList = { add() {}, remove() {}, toggle() {} }; this.disabled = false; this.value = "0"; this.textContent = ""; this.title = ""; }
    setAttribute() {}
    addEventListener(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); }
    fire(type, extra = {}) { for (const fn of this.handlers.get(type) ?? []) void fn({ preventDefault() {}, stopPropagation() {}, ...extra }); }
    focus() { document.activeElement = this; this.fire("focus"); }
    blur() { document.activeElement = null; this.fire("blur"); }
    select() {}
  }
  const fields = ["health", "max health", "temporary health", "armor class"];
  env.inputs = fields.map(field => new Element(field));
  env.nodes = Object.fromEntries(["dragHandle", "hpPill", "lockBtn", "panelPinBtn", "resetBtn", "nameRow"].map(id => [id, new Element()]));
  globalThis.document = { activeElement: null, body: new Element(), getElementById: id => env.nodes[id], querySelectorAll: () => env.inputs };
  globalThis.location = { search: "?session=test" };
  globalThis.window = { addEventListener: (key, fn) => listen(`window:${key}`, fn) };
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const readyCallbacks = [];
  globalThis.__HP_SDK__ = {
    onReady: fn => readyCallbacks.push(fn),
    player: { getRole: async () => { if (env.roleGate) await env.roleGate.promise; return env.role; }, getId: async () => env.playerId,
      getSelection: async () => { env.selectionReads++; return [...env.selection]; }, onChange: fn => listen("player", fn) },
    scene: { isReady: async () => env.ready, onReadyChange: fn => listen("scene", fn),
      getMetadata: async () => env.metadata ?? {}, onMetadataChange: fn => listen("metadata", fn),
      items: { getItems: async ids => { env.reads.push(ids); const copy = structuredClone(env.items.filter(item => !ids || ids.includes(item.id)));
        const gate = env.readGate; if (gate && (!gate.id || ids?.includes(gate.id))) await gate.promise; return copy; },
        updateItems: async (ids, fn) => { env.writes.push([...ids]); if (env.writeGate) await env.writeGate.promise;
          const drafts = structuredClone(env.items.filter(item => ids.includes(item.id))); fn(drafts);
          for (const draft of drafts) env.items[env.items.findIndex(item => item.id === draft.id)] = draft; },
        onChange: fn => listen("items", fn) } },
    broadcast: { onMessage: (key, fn) => listen(key, fn), sendMessage: async (key, data) => {
      env.messages.push({ key, data: structuredClone(data) }); emit(key, { data: structuredClone(data) }); } },
    popover: { open: async value => { env.opens.push(value); if (env.openGate) await env.openGate.promise; }, close: async () => { env.closes++; } },
    viewport: { getWidth: async () => 1280, getHeight: async () => 720 },
    contextMenu: { create: async () => {}, remove: async () => {} }, notification: { show: async () => {} },
  };
  env.boot = async () => { await Promise.all(readyCallbacks.map(fn => fn())); await settle(); };
  env.select = ids => { env.selection = ids; emit("player", { id: env.playerId, role: env.role, selection: [...ids] }); };
  env.snapshot = () => emit("items", structuredClone(env.items));
  env.target = (id, version, pending = false) => emit(TARGET, { data: { session: "test", version, itemId: id, pending } });
  return env;
}

const stubs = {
  state: "export const getLocalLang=()=> 'zh';",
  "asset-base": "export const assetUrl=x=>x;",
  viewportAnchor: "export const onViewportResize=()=>()=>{};",
  panelLayout: "export const PANEL_IDS={hpBar:'hp-bar'};export const getPanelOffset=()=>({dx:0,dy:0});export const registerPanelBbox=()=>{};export const BC_PANEL_DRAG_END='drag';export const BC_PANEL_RESET='reset';",
  debugOverlay: "export const installDebugOverlay=()=>{};",
  panelDrag: "export const bindPanelDrag=()=>{};",
  panelZoom: "export const installPanelZoom=()=>{};",
};
let serial = 0;
async function bundle(mode, mutation) {
  const entry = mode === "background" ? "src/modules/hpBar/index.ts" : "src/hp-bar-page.ts";
  let changed = false;
  const build = await rolldown({ input: "virtual:entry", platform: "node", plugins: [{ name: "sdk-faults",
    resolveId(source) {
      if (source === "virtual:entry" || source.startsWith("mock:")) return source;
      if (source === "@owlbear-rodeo/sdk") return "mock:sdk";
      const name = source.split("/").pop();
      if (stubs[name]) return `mock:${name}`;
    },
    load(id) {
      if (id === "virtual:entry") return `export * from ${JSON.stringify(join(root, entry))};export {writeHpStats} from ${JSON.stringify(join(root, "src/modules/hpBar/edit.ts"))};export {patchBubbles} from ${JSON.stringify(join(root, "src/utils/statEdit.ts"))};`;
      if (id === "mock:sdk") return "export default globalThis.__HP_SDK__;";
      if (id.startsWith("mock:")) return stubs[id.slice(5)];
      if (mutation && id.replaceAll("\\", "/").endsWith(mutation.file)) {
        const source = readFileSync(id, "utf8");
        assert.ok(source.includes(mutation.from), `mutation target missing: ${mutation.name}`);
        changed = true;
        return source.replace(mutation.from, mutation.to);
      }
    },
  }] });
  const file = join(out, `${serial++}.mjs`);
  await build.write({ file, format: "esm" });
  await build.close();
  if (mutation) assert.ok(changed);
  return file;
}

async function backgroundTests(file) {
  const env = environment();
  const api = await import(pathToFileURL(file));
  await api.setupHpBar();
  env.readGate = { ...deferred(), id: "A" };
  env.select(["A"]); await settle();
  env.select(["B"]); await settle();
  env.readGate.resolve(); await settle();
  assert.equal(env.messages.filter(message => message.key === TARGET).at(-1).data.itemId, "B", "late A selection must not reopen A");
  assert.equal(env.opens.length, 1);
  env.readGate = null;
  const beforeReads = env.reads.length;
  const beforeSelection = env.selectionReads;
  for (let i = 0; i < 100; i++) { env.items[0].position.x++; env.snapshot(); }
  await settle();
  assert.equal(env.reads.length, beforeReads, "unrelated full snapshots do not re-read token");
  assert.equal(env.selectionReads, beforeSelection, "unrelated full snapshots do not re-read selection");
  env.select(["A"]); await settle();
  assert.equal(env.opens.length, 1, "eligible A/B switches reuse iframe");
  assert.equal(env.closes, 0);
  const latest = env.messages.filter(message => message.key === TARGET).at(-1).data;
  await globalThis.__HP_SDK__.broadcast.sendMessage(READY, { session: latest.session });
  assert.deepEqual(env.messages.at(-1).data, latest, "late iframe gets current state by handshake");
  env.items[1].metadata["com.character-cards/boundCardId"] = "card";
  localStorage.setItem(PIN, "1");
  env.select(["B"]); await settle();
  assert.equal(env.closes, 0, "pinned editor survives ineligible bound selection");
  env.items = env.items.filter(item => item.id !== "A"); env.snapshot(); await settle();
  assert.equal(env.closes, 1, "pin does not preserve a deleted target");
  await api.teardownHpBar();
  localStorage.setItem(PIN, "0");
  env.items = [token("A"), token("B")]; env.selection = [];
  await api.setupHpBar();
  env.readGate = { ...deferred(), id: "A" };
  env.select(["A"]); await settle(); env.select([]); await settle();
  env.readGate.resolve(); await settle(); env.readGate = null;
  assert.equal(env.opens.length, 1, "late selected read cannot reopen after deselect");
  env.openGate = deferred();
  env.select(["A"]); await settle();
  env.select(["B"]); await settle(); env.select([]); await settle();
  env.ready = false; env.emit("scene", false); await settle();
  env.openGate.resolve(); await settle(); env.openGate = null;
  assert.equal(env.opens.length, 2, "one in-flight open is shared across rapid changes");
  assert.equal(env.closes, 2, "an in-flight open is closed when the scene disappears");
  await api.teardownHpBar();
}

async function pageTests(file) {
  const env = environment();
  const api = await import(pathToFileURL(file));
  await env.boot();
  assert.ok(env.inputs.every(input => input.disabled), "no URL/unknown target writes");
  env.readGate = { ...deferred(), id: "A" };
  env.target("A", 1); await settle();
  env.target("B", 2); await settle();
  env.readGate.resolve(); await settle(); env.readGate = null;
  assert.equal(env.inputs[0].value, "15", "late A data must not repaint B");
  env.target("A", 1); await settle();
  assert.equal(env.inputs[0].value, "15", "out-of-order target message ignored");
  const beforeReads = env.reads.length, beforePaints = env.paints;
  for (let i = 0; i < 100; i++) { env.items[0].position.x++; env.items[1].rotation = i; env.snapshot(); }
  await settle();
  assert.equal(env.reads.length, beforeReads, "page consumes only relevant event fields");
  assert.equal(env.paints, beforePaints, "dragging/unrelated metadata does not repaint");
  env.inputs[0].focus(); env.inputs[0].value = "+5";
  env.target("A", 3); await settle(); env.inputs[0].blur(); await settle();
  assert.equal(env.writes.length, 0, "B draft blur after switching to A must not write either token");
  env.writeGate = deferred();
  env.inputs[0].focus(); env.inputs[0].value = "3"; env.inputs[0].blur(); await settle();
  assert.equal(env.writes.length, 1);
  env.target("B", 4); await settle();
  env.writeGate.resolve(); await settle(); env.writeGate = null;
  assert.equal(env.items.find(item => item.id === "A").metadata[HP].health, 10, "late SDK draft is cancelled on A -> B");
  assert.equal(env.inputs[0].value, "15");
  env.inputs[0].focus(); env.inputs[0].value = "7"; env.inputs[0].blur(); await settle();
  assert.equal(env.items.find(item => item.id === "B").metadata[HP].health, 7, "current target edit still commits");
  env.readGate = { ...deferred(), id: "A" };
  env.target("A", 5); await settle();
  env.items.find(item => item.id === "A").metadata[HP].health = 2;
  env.snapshot(); await settle();
  env.readGate.resolve(); await settle(); env.readGate = null;
  assert.equal(env.inputs[0].value, "2", "new event beats an older same-target read");
  env.emit("scene", false); env.snapshot(); await settle();
  assert.ok(env.inputs.every(input => input.disabled), "late snapshots cannot enable a departed scene");
  // Existing namespace/clamp contract: compare the new guarded writer with the
  // unchanged shared writer for real legacy metadata, not a duplicate oracle.
  const legacy = token("C", 19, { [EXT]: { health: 19, "max health": 20, "dm only": true, name: "keep" } });
  env.items = [structuredClone(legacy)];
  await api.patchBubbles("C", { "max health": 8, "temporary health": -2 });
  const expected = structuredClone(env.items[0]);
  env.items = [structuredClone(legacy)];
  await api.writeHpStats("C", { "max health": 8, "temporary health": -2 }, () => true);
  assert.deepEqual(env.items[0], expected, "guarded editor preserves shared clamp and external fields");
}

async function earlyTargetTest(file) {
  const env = environment();
  env.roleGate = deferred();
  await import(pathToFileURL(file));
  const boot = env.boot();
  env.target("B", 1); await settle();
  assert.ok(env.inputs.every(input => input.disabled));
  env.roleGate.resolve(); await boot;
  assert.equal(env.inputs[0].value, "15");
  assert.ok(env.inputs.every(input => !input.disabled), "target received before identity resolves becomes usable");
}

const mutations = [
  { name: "selection generation removed", mode: "background", file: "hpBar/index.ts", from: "version === selectionVersion", to: "true" },
  { name: "target switches recreate iframe", mode: "background", file: "hpBar/index.ts", from: "currentItemId = itemId;", to: "if (popoverOpen && currentItemId !== itemId) { await OBR.popover.close(POPOVER_ID); popoverOpen = false; } currentItemId = itemId;" },
  { name: "draft target guard removed", mode: "page", file: "hpBar/edit.ts", from: "if (!current()) return;", to: "/* guard removed */" },
  { name: "read generation removed", mode: "page", file: "hpBar/target.ts", from: "return () => lease.current() && request === this.request;", to: "return () => true;" },
  { name: "position forces repaint", mode: "page", file: "hpBar/target.ts", from: "item.metadata[CC_BIND_KEY], item.metadata[BUBBLES_NAME_KEY],", to: "item.position, item.rotation, item.metadata[CC_BIND_KEY], item.metadata[BUBBLES_NAME_KEY]," },
];

try {
  await backgroundTests(await bundle("background"));
  await pageTests(await bundle("page"));
  await earlyTargetTest(await bundle("page"));
  let killed = 0;
  for (const mutation of mutations) {
    const file = await bundle(mutation.mode, mutation);
    let failed = false;
    try { await (mutation.mode === "page" ? pageTests : backgroundTests)(file); }
    catch (error) { if (!(error instanceof assert.AssertionError)) throw error; failed = true; }
    assert.ok(failed, `surviving mutation: ${mutation.name}`);
    killed++;
  }
  console.log(`HP selftest PASS: delayed target/read/write, stable iframe, 100 irrelevant snapshots, pin/binding, ready replay, legacy merge; mutations killed ${killed}/${mutations.length}`);
} finally {
  if (dirname(resolve(out)) === resolve(tmpdir()) && basename(out).startsWith("hp-bar-selftest-")) rmSync(out, { recursive: true, force: true });
}
