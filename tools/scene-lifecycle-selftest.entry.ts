import assert from "node:assert/strict";
import { ModuleLifecycle, SceneModuleCoordinator } from "../src/utils/moduleLifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  await run(); console.log(`PASS ${++passed}: ${name}`);
}
function fixture(openCluster: () => Promise<void>, overrides: {
  refreshSettings?: () => Promise<unknown>;
  settingsRetryDelays?: readonly number[];
  onSettingsUnavailable?: () => void;
} = {}) {
  const calls: string[] = [];
  const errors: string[] = [];
  let announcements = 0;
  const lifecycle = new ModuleLifecycle({ a: {
    async setup() { calls.push("setup"); }, async teardown() { calls.push("teardown"); },
  }});
  void lifecycle.setPaused(true);
  const coordinator = new SceneModuleCoordinator({
    lifecycle, openCluster,
    async closeCluster() { calls.push("close"); },
    syncModules: () => lifecycle.setDesired({ a: true }),
    // A resolved refresh may have been superseded and simply returned cache.
    async refreshSettings() { calls.push("read"); },
    async onReady() { announcements++; },
    onError: (operation) => { errors.push(operation); },
    ...overrides,
  });
  return { calls, errors, coordinator, announcements: () => announcements };
}

await test("module registration waits for cluster opening even when settings arrive first", async () => {
  const opening = deferred();
  const f = fixture(() => opening.promise);
  f.coordinator.handleReady(true);
  f.coordinator.settingsRefreshed();
  await flush();
  assert.deepEqual(f.calls, ["read"]);
  opening.resolve(); await flush();
  assert.deepEqual(f.calls, ["read", "setup"]);
  f.coordinator.settingsRefreshed(); f.coordinator.settingsRefreshed(); await flush();
  assert.equal(f.announcements(), 1);
});

await test("a superseded refresh completion cannot start modules from cached old settings", async () => {
  const f = fixture(async () => {});
  f.coordinator.handleReady(true); await flush();
  assert.deepEqual(f.calls, ["read"]);
  // The later, authoritative read finally finishes; no retry/poll loop needed.
  f.coordinator.settingsRefreshed(); await flush();
  assert.deepEqual(f.calls, ["read", "setup"]);
});

await test("closing during a delayed open runs close after it and never resumes stale work", async () => {
  const opening = deferred();
  const f = fixture(() => opening.promise);
  f.coordinator.handleReady(true); f.coordinator.settingsRefreshed(); await flush();
  f.coordinator.handleReady(false);
  f.coordinator.settingsRefreshed(); // ignored while there is no ready scene
  opening.resolve(); await flush();
  assert.deepEqual(f.calls, ["read", "close"]);
  assert.equal(f.announcements(), 0);
});

await test("rapid A-close-B switching waits for B's own cluster and fresh settings", async () => {
  const first = deferred(); const second = deferred(); let opens = 0;
  const f = fixture(() => (++opens === 1 ? first.promise : second.promise));
  f.coordinator.handleReady(true); f.coordinator.settingsRefreshed(); await flush();
  f.coordinator.handleReady(false); f.coordinator.handleReady(true);
  first.resolve(); await flush();
  assert.equal(opens, 2);
  assert.deepEqual(f.calls, ["read", "read"]);
  second.resolve(); await flush();
  assert.deepEqual(f.calls, ["read", "read"], "A's readiness leaked into B");
  f.coordinator.settingsRefreshed(); await flush();
  assert.deepEqual(f.calls, ["read", "read", "setup"]);
  assert.equal(f.announcements(), 1);
});

await test("an explicitly failed cluster open is reported and does not disable every module", async () => {
  const f = fixture(async () => { throw Error("popover failed"); });
  f.coordinator.handleReady(true); f.coordinator.settingsRefreshed(); await flush();
  assert.deepEqual(f.errors, ["cluster"]);
  assert.deepEqual(f.calls, ["read", "setup"]);
});

await test("settings retries are bounded, show final failure, and a later valid update recovers", async () => {
  const unavailable = deferred(); let reads = 0, notices = 0;
  const f = fixture(async () => {}, {
    async refreshSettings() { reads++; f.coordinator.settingsFailed(Error("read failed")); },
    settingsRetryDelays: [0, 0],
    onSettingsUnavailable: () => { notices++; unavailable.resolve(); },
  });
  f.coordinator.handleReady(true);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      unavailable.promise,
      new Promise<void>((_resolve, reject) => { timeout = setTimeout(() => reject(new assert.AssertionError({ message: "unbounded settings retries" })), 1000); }),
    ]);
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
  assert.equal(reads, 3);
  assert.equal(notices, 1);
  assert.ok(!f.calls.includes("setup"), "failed settings fell back to default module startup");
  f.coordinator.settingsFailed(Error("another metadata read failed"));
  assert.equal(notices, 1, "failure notification repeated indefinitely");
  f.coordinator.settingsRefreshed(); await flush();
  assert.ok(f.calls.includes("setup"), "later valid metadata did not resume paused startup");
});

await test("scene close cancels pending settings retry; reopening starts a fresh attempt", async () => {
  let reads = 0, recovered = false;
  const f = fixture(async () => {}, {
    async refreshSettings() {
      reads++;
      if (recovered) f.coordinator.settingsRefreshed();
      else f.coordinator.settingsFailed(Error("read failed"));
    },
    settingsRetryDelays: [15],
  });
  f.coordinator.handleReady(true); f.coordinator.handleReady(false);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(reads, 1, "old scene's retry read the replacement scene");
  assert.ok(!f.calls.includes("setup"));
  recovered = true; f.coordinator.handleReady(true); await flush();
  assert.equal(reads, 2);
  assert.ok(f.calls.includes("setup"));
});

console.log(`${passed} scene lifecycle regressions passed`);
