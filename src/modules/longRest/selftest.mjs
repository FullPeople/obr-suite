// Run from the repository root: node src/modules/longRest/selftest.mjs
//
// Exercises the long-rest recovery end to end:
//   • recover.ts planning (HP + long-rest resources, both bubbles
//     namespaces, badge detection);
//   • applyLongRest writes (dual-namespace HP merge, resource
//     spread-merge, excluded units, idempotence);
//   • the transitions wiring — a GM long-rest run message must apply
//     the recovery BEFORE the cutscene broadcast, honour the picker's
//     excluded list, and leave previews / non-GM runs / short rests
//     with untouched scene data.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const root = resolve(process.cwd());
const out = mkdtempSync(join(tmpdir(), "long-rest-selftest-"));
const HP = "com.obr-suite/bubbles/data";
const EXT = "com.owlbear-rodeo-bubbles-extension/metadata";
const NAME = "com.owlbear-rodeo-bubbles-extension/name";
const RES = "com.obr-suite/resources/data";
const CARD = "com.character-cards/boundCardId";
const BEST = "com.bestiary/slug";
const RUN = "com.obr-suite/transitions/run";
const PLAY = "com.obr-suite/transitions/play";
const STATUS = "com.obr-suite/transitions/status";
const SCENE_KEY = "com.obr-suite/transitions/scene-key";
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

const token = (id, health, maxHealth, metadata = {}) => ({
  id, type: "IMAGE", layer: "CHARACTER", name: id, createdUserId: "gm",
  position: { x: 0, y: 0 },
  metadata: { [HP]: { health, "max health": maxHealth }, ...metadata },
});

const resource = (id, name, current, max, longRest = false, extra = {}) => ({
  id, name, type: "count", current, max, icon: "gem",
  ...(longRest ? { longRest: true } : {}), ...extra,
});

function environment() {
  const listeners = new Map();
  const bootFns = [];
  const listen = (key, fn) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); return () => listeners.get(key).delete(fn); };
  const emit = (key, value) => { for (const fn of [...(listeners.get(key) ?? [])]) void fn(value); };
  const env = {
    items: [], role: "GM", playerId: "gm-1", connection: "conn-gm", ready: true,
    metadata: {}, messages: [], writes: [], opens: [], order: [],
    listen, emit,
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.window = {
    addEventListener: (key, fn) => listen(`window:${key}`, fn),
    removeEventListener: () => {},
  };
  globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.__LR_SDK__ = {
    onReady: (fn) => bootFns.push(fn),
    player: {
      getConnectionId: async () => env.connection,
      getId: async () => env.playerId,
      getRole: async () => env.role,
      getSelection: async () => [],
      onChange: (fn) => listen("player", fn),
    },
    party: { getPlayers: async () => [{ id: env.playerId, name: "GM", role: env.role }] },
    scene: {
      isReady: async () => env.ready,
      onReadyChange: (fn) => listen("scene", fn),
      getMetadata: async () => env.metadata ?? {},
      setMetadata: async (patch) => { env.metadata = { ...env.metadata, ...patch }; },
      items: {
        getItems: async (ids) => structuredClone(env.items.filter((i) => !ids || ids.includes(i.id))),
        updateItems: async (ids, fn) => {
          env.order.push("write");
          env.writes.push([...ids]);
          const drafts = structuredClone(env.items.filter((i) => ids.includes(i.id)));
          fn(drafts);
          for (const draft of drafts) {
            const index = env.items.findIndex((i) => i.id === draft.id);
            if (index >= 0) env.items[index] = draft;
          }
        },
        onChange: (fn) => listen("items", fn),
      },
    },
    broadcast: {
      onMessage: (key, fn) => listen(key, fn),
      sendMessage: async (key, data) => {
        env.order.push(key);
        env.messages.push({ key, data: structuredClone(data) });
      },
    },
    modal: { open: async (value) => { env.opens.push(value); }, close: async () => {} },
    popover: {
      open: async () => {}, close: async () => {},
      setHeight: async () => {}, setWidth: async () => {},
    },
    viewport: { getWidth: async () => 1280, getHeight: async () => 720 },
    notification: { show: async () => {} },
  };
  env.boot = async () => { for (const fn of bootFns) await fn(); await settle(); };
  return env;
}

const stubs = {
  state: "export const getLocalLang=()=> 'zh';export const onLangChange=()=>()=>{};",
  "asset-base": "export const assetUrl=x=>x;",
  "screen-effect": "export const removeOrphanScreenTransitions=async()=>{};export const stopScreenTransition=async()=>{};",
  channel: "export const WORKBENCH_DEV=false;",
};

let serial = 0;
async function bundle(mutation) {
  const entry = "virtual:entry";
  let changed = false;
  const build = await rolldown({
    input: entry, platform: "node",
    plugins: [{
      name: "long-rest-selftest",
      resolveId(source) {
        if (source === entry || source.startsWith("mock:")) return source;
        if (source === "@owlbear-rodeo/sdk") return "mock:sdk";
        const name = source.split("/").pop();
        if (stubs[name]) return `mock:${name}`;
      },
      load(id) {
        if (id === entry) {
          return `export * from ${JSON.stringify(join(root, "src/modules/longRest/recover.ts"))};`
            + `export {setupTransitions,teardownTransitions} from ${JSON.stringify(join(root, "src/modules/transitions/index.ts"))};`;
        }
        if (id === "mock:sdk") {
          // Lazy proxy: the stub object is swapped per test environment,
          // and one import must serve all of them.
          return "export default new Proxy({}, { get: (_target, key) => globalThis.__LR_SDK__[key] });";
        }
        if (id.startsWith("mock:")) return stubs[id.slice(5)];
        if (mutation && id.replaceAll("\\", "/").endsWith(mutation.file)) {
          const source = readFileSync(id, "utf8");
          assert.ok(source.includes(mutation.from), `mutation target missing: ${mutation.name}`);
          changed = true;
          return source.replace(mutation.from, mutation.to);
        }
      },
    }],
  });
  const file = join(out, `${serial++}.mjs`);
  await build.write({ file, format: "esm" });
  await build.close();
  if (mutation) assert.ok(changed, `mutation not applied: ${mutation.name}`);
  return file;
}

/** Drive a local run message through the wired transitions module. */
async function playLongRest(env, data) {
  env.emit(RUN, { data: { kind: "long", requestId: "r1", issuedAt: Date.now(), ...data }, connectionId: env.connection });
  await settle();
}

async function planningTests(api) {
  // HP below max plans a top-up; full HP plans nothing.
  const hurt = token("A", 23, 45);
  assert.deepEqual(api.planRestore(hurt), { resources: [], hp: { from: 23, to: 45 } });
  assert.equal(api.planRestore(token("B", 45, 45)), null);

  // External-namespace bubbles are planned too (read precedence).
  const external = { id: "C", name: "C", metadata: { [EXT]: { health: 3, "max health": 12 } } };
  assert.deepEqual(api.planRestore(external), { resources: [], hp: { from: 3, to: 12 } });

  // Only resources flagged longRest come back, and only when spent.
  const slots = token("D", 10, 10, {
    [RES]: [
      resource("s1", "一环法术位", 1, 4, true),
      resource("s2", "灵感", 0, 3, false),
      resource("s3", "二环法术位", 2, 2, true),
    ],
  });
  const plan = api.planRestore(slots);
  assert.deepEqual(plan.resources, [{ id: "s1", name: "一环法术位", from: 1, to: 4 }]);

  // Candidates skip units with nothing to recover and keep badges.
  const items = [
    token("A", 23, 45, { [CARD]: "card-1" }),
    token("B", 45, 45),
    { id: "E", name: "", metadata: { [HP]: { health: 1, "max health": 9 }, [BEST]: "goblin", [NAME]: "小妖精" } },
    { id: "F", name: "", metadata: {} },
  ];
  const candidates = api.collectCandidates(items);
  assert.deepEqual(candidates.map((c) => c.item.id), ["A", "E"]);
  assert.equal(candidates[0].name, "A");
  assert.equal(candidates[0].card, true);
  assert.equal(candidates[0].bestiary, false);
  assert.equal(candidates[1].name, "小妖精", "bubbles name is the fallback when item name is empty");
  assert.equal(candidates[1].bestiary, true);
  assert.equal(candidates[1].card, false);
}

async function writeTests(api) {
  const env = environment();
  env.items = [
    token("A", 23, 45, {
      [EXT]: { health: 23, "max health": 45, "dm only": true, name: "keep-me" },
      [RES]: [resource("s1", "一环法术位", 1, 4, true), resource("s2", "灵感", 0, 3, false, { order: 7 })],
    }),
    token("B", 5, 20),
  ];
  const candidates = api.collectCandidates(env.items);
  const written = await api.applyLongRest(candidates, new Set(["B"]));
  assert.equal(written, 1, "only the checked unit is written");
  const a = env.items[0];
  assert.equal(a.metadata[HP].health, 45, "own namespace HP topped");
  assert.equal(a.metadata[EXT].health, 45, "external namespace HP merged");
  assert.equal(a.metadata[EXT]["dm only"], true, "external foreign fields survive");
  assert.equal(a.metadata[EXT].name, "keep-me", "external name survives");
  const slots = a.metadata[RES];
  assert.equal(slots[0].current, 4, "long-rest resource topped");
  assert.equal(slots[1].current, 0, "non-flagged resource untouched");
  assert.equal(slots[1].order, 7, "resource unknown fields survive the merge");
  assert.equal(env.items[1].metadata[HP].health, 5, "excluded unit keeps its HP");

  // Idempotence: the rested unit drops out of the candidate list, and
  // re-applying to the same selection writes nothing.
  const again = api.collectCandidates(env.items);
  assert.deepEqual(again.map((c) => c.item.id), ["B"], "rested unit no longer needs recovery");
  assert.equal(await api.applyLongRest(again, new Set(["B"])), 0, "nothing left to write");
  assert.equal(env.items[0].metadata[HP].health, 45, "rested unit untouched by the second pass");
}

async function wiringTests(api) {
  const env = environment();
  env.metadata = { [SCENE_KEY]: "scene-1" };
  env.items = [
    token("A", 23, 45, { [CARD]: "card-1", [RES]: [resource("s1", "一环法术位", 1, 4, true)] }),
    token("B", 5, 20),
    token("C", 45, 45),
  ];
  await api.setupTransitions();
  await env.boot();

  // GM long rest, B excluded: recovery first, then the cutscene broadcast.
  await playLongRest(env, { text: "翌日清晨", targets: "all", preview: false, longRest: { excluded: ["B"] } });
  assert.equal(env.items[0].metadata[HP].health, 45, "checked unit HP topped");
  assert.equal(env.items[0].metadata[RES][0].current, 4, "checked unit spell slots topped");
  assert.equal(env.items[1].metadata[HP].health, 5, "excluded unit untouched");
  assert.equal(env.writes.length, 1, "one atomic write for the selection");
  assert.ok(env.order.indexOf("write") < env.order.indexOf(PLAY), "recovery lands before the cutscene");
  const play = env.messages.find((m) => m.key === PLAY);
  assert.ok(play && play.data.kind === "long", "cutscene broadcast for players");
  const ok = env.messages.find((m) => m.key === STATUS);
  assert.ok(ok && ok.data.ok === true, "GM gets an ack");

  // Preview never touches scene data.
  env.writes = []; env.order = [];
  await playLongRest(env, { text: "", targets: "all", preview: true, longRest: { excluded: [] } });
  assert.equal(env.writes.length, 0, "preview writes nothing");
  assert.equal(env.items[0].metadata[HP].health, 45);

  // A non-GM run degrades to a preview: no writes, no remote broadcast.
  env.writes = []; env.messages = [];
  env.role = "PLAYER";
  await playLongRest(env, { text: "", targets: "all", preview: false, longRest: { excluded: [] } });
  assert.equal(env.writes.length, 0, "player run writes nothing");
  assert.ok(!env.messages.some((m) => m.key === PLAY), "player run never broadcasts to others");

  // Short rest ignores any longRest payload.
  env.role = "GM"; env.writes = []; env.messages = [];
  env.items[1].metadata[HP].health = 5;
  env.emit(RUN, { data: { kind: "short", requestId: "r2", issuedAt: Date.now(), preview: false, longRest: { excluded: [] } }, connectionId: env.connection });
  await settle();
  assert.equal(env.writes.length, 0, "short rest recovers nothing");
  assert.equal(env.items[1].metadata[HP].health, 5);

  await api.teardownTransitions();
}

async function negativeTests(file) {
  const env = environment();
  env.metadata = { [SCENE_KEY]: "scene-1" };
  env.items = [
    token("A", 23, 45, { [EXT]: { health: 23, "max health": 45, "dm only": true } }),
    token("B", 5, 20),
  ];
  const api = await import(pathToFileURL(file));
  await api.setupTransitions();
  await env.boot();
  await playLongRest(env, { text: "", targets: "all", preview: false, longRest: { excluded: ["B"] } });
  assert.equal(env.items[0].metadata[HP].health, 45, "mutation run: recovery still applied to the checked unit");
  assert.equal(env.items[0].metadata[EXT].health, 45, "mutation run: external namespace still merged");
  assert.equal(env.items[1].metadata[HP].health, 5, "mutation run: excluded unit still untouched");
  await api.teardownTransitions();
}

const mutations = [
  {
    name: "long-rest recovery removed from the run handler",
    file: "src/modules/transitions/index.ts",
    from: "if (event.kind === \"long\") {",
    to: "if (false) {",
  },
  {
    name: "excluded list ignored by applyLongRest",
    file: "src/modules/longRest/recover.ts",
    from: "candidates.filter((candidate) => !excluded.has(candidate.item.id))",
    to: "candidates.filter(() => true)",
  },
  {
    name: "external bubbles namespace left stale",
    file: "src/modules/longRest/recover.ts",
    from: "meta[EXTERNAL_BUBBLES_META_KEY] = { ...extPrev, health: plan.hp.to };",
    to: "/* external left stale */",
  },
];

try {
  const api = await import(pathToFileURL(await bundle()));
  await planningTests(api);
  await writeTests(api);
  await wiringTests(api);
  let killed = 0;
  for (const mutation of mutations) {
    const file = await bundle(mutation);
    let failed = false;
    try { await negativeTests(file); }
    catch (error) { if (!(error instanceof assert.AssertionError)) throw error; failed = true; }
    assert.ok(failed, `surviving mutation: ${mutation.name}`);
    killed++;
  }
  console.log(`Long-rest selftest PASS: planning, dual-namespace writes, resource merge, excluded units, wiring order, preview/player guards; mutations killed ${killed}/${mutations.length}`);
} finally {
  if (dirname(resolve(out)) === resolve(tmpdir()) && basename(out).startsWith("long-rest-selftest-")) rmSync(out, { recursive: true, force: true });
}
