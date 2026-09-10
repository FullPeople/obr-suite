import assert from "node:assert/strict";
import { ModuleLifecycle } from "../src/utils/moduleLifecycle";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  await run();
  console.log(`PASS ${++passed}: ${name}`);
}

await test("a disable during setup is applied without another settings event", async () => {
  const gate = deferred();
  const calls: string[] = [];
  const life = new ModuleLifecycle({ a: {
    async setup() { calls.push("setup"); await gate.promise; },
    async teardown() { calls.push("teardown"); },
  }});
  const done = life.setDesired({ a: true });
  await flush();
  void life.setDesired({ a: false });
  gate.resolve();
  await done;
  assert.deepEqual(calls, ["setup", "teardown"]);
  assert.equal(life.snapshot()[0].status, "off");
});

await test("enable during teardown restarts once, never concurrently", async () => {
  const gate = deferred();
  let setups = 0;
  const life = new ModuleLifecycle({ a: {
    async setup() { setups++; }, async teardown() { await gate.promise; },
  }});
  await life.setDesired({ a: true });
  const done = life.setDesired({ a: false });
  await flush();
  void life.setDesired({ a: true });
  void life.setDesired({ a: true });
  gate.resolve();
  await done;
  assert.equal(setups, 2);
  assert.equal(life.snapshot()[0].status, "on");
});

await test("later modules use latest intent, with original registration order", async () => {
  const gate = deferred();
  const calls: string[] = [];
  const life = new ModuleLifecycle({
    a: { async setup() { calls.push("a"); await gate.promise; }, async teardown() {} },
    b: { async setup() { calls.push("b"); }, async teardown() {} },
    c: { async setup() { calls.push("c"); }, async teardown() {} },
  });
  const done = life.setDesired({ a: true, b: true, c: true });
  await flush();
  void life.setDesired({ a: true, b: false, c: true });
  gate.resolve();
  await done;
  assert.deepEqual(calls, ["a", "c"]);
});

await test("failed partial setup cleans up, reports error, then manual retry works", async () => {
  let fail = true, listeners = 0, peak = 0;
  const life = new ModuleLifecycle({ a: {
    async setup() { listeners++; peak = Math.max(peak, listeners); if (fail) throw Error("network"); },
    async teardown() { listeners = 0; },
  }}, { retryDelays: [] });
  await life.setDesired({ a: true });
  assert.equal(life.snapshot()[0].status, "error");
  assert.equal(listeners, 0);
  fail = false;
  await life.retry("a");
  assert.equal(life.snapshot()[0].status, "on");
  assert.equal(peak, 1);
});

await test("automatic retry is bounded even with intermittently failing cleanup", async () => {
  let setups = 0, cleanups = 0;
  const life = new ModuleLifecycle({ a: {
    async setup() { setups++; throw Error("setup failed"); },
    async teardown() { cleanups++; if (cleanups % 2) throw Error("cleanup failed"); },
  }}, { retryDelays: [0, 0] });
  await life.setDesired({ a: true });
  assert.equal(setups, 3);
  assert.equal(life.snapshot()[0].status, "error");
  assert.equal(life.snapshot()[0].attempts, 3);
  assert.equal(cleanups, 5);
});

await test("failed teardown cannot start a second copy; retry cleans before setup", async () => {
  let fail = true;
  const calls: string[] = [];
  const life = new ModuleLifecycle({ a: {
    async setup() { calls.push("setup"); },
    async teardown() { calls.push("teardown"); if (fail) throw Error("cleanup"); },
  }}, { retryDelays: [] });
  await life.setDesired({ a: true });
  await life.setDesired({ a: false });
  assert.equal(life.snapshot()[0].status, "error");
  await life.setDesired({ a: true });
  assert.deepEqual(calls, ["setup", "teardown", "teardown"]);
  fail = false;
  await life.retry("a");
  assert.deepEqual(calls, ["setup", "teardown", "teardown", "teardown", "setup"]);
});

await test("disabling a clean failed module cancels pending automatic retry", async () => {
  let setups = 0;
  const life = new ModuleLifecycle({ a: {
    async setup() { setups++; throw Error("failed"); }, async teardown() {},
  }}, { retryDelays: [10] });
  await life.setDesired({ a: true });
  await life.setDesired({ a: false });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(setups, 1);
  assert.equal(life.snapshot()[0].status, "off");
});

await test("a failed module does not stop later independent modules", async () => {
  const life = new ModuleLifecycle({
    a: { async setup() { throw Error("failed"); }, async teardown() {} },
    b: { async setup() {}, async teardown() {} },
  }, { retryDelays: [] });
  await life.setDesired({ a: true, b: true });
  assert.deepEqual(life.snapshot().map(s => s.status), ["error", "on"]);
});

await test("scene pause keeps registered modules and defers work to fresh settings", async () => {
  const calls: string[] = [];
  const life = new ModuleLifecycle({ a: {
    async setup() { calls.push("setup"); }, async teardown() { calls.push("teardown"); },
  }});
  await life.setDesired({ a: true });
  await life.setPaused(true);
  await life.setDesired({ a: false });
  assert.deepEqual(calls, ["setup"]);
  await life.setPaused(false);
  assert.deepEqual(calls, ["setup", "teardown"]);
});

await test("synchronous reentrant settings notifications cannot duplicate hooks", async () => {
  let setups = 0;
  const life = new ModuleLifecycle({ a: {
    async setup() { setups++; void life.setDesired({ a: false }); }, async teardown() {},
  }});
  await life.setDesired({ a: true });
  assert.equal(setups, 1);
  assert.equal(life.snapshot()[0].status, "off");
});

await test("slow setup is reported without falsely cancelling an active hook", async () => {
  const gate = deferred();
  const life = new ModuleLifecycle({ a: {
    async setup() { await gate.promise; }, async teardown() {},
  }}, { slowAfterMs: 1 });
  const done = life.setDesired({ a: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(life.snapshot()[0].slow, true);
  assert.equal(life.snapshot()[0].status, "starting");
  gate.resolve();
  await done;
  assert.equal(life.snapshot()[0].status, "on");
  assert.equal(life.snapshot()[0].slow, false);
});

await test("intent arriving between drain and finalization settles before its returned promise", async () => {
  let setups = 0;
  const life = new ModuleLifecycle({ a: {
    async setup() { setups++; }, async teardown() {},
  }});
  void life.setPaused(true);
  // The paused drain has returned, but the worker has not finalized yet.
  await Promise.resolve();
  const done = life.setDesired({ a: true });
  void life.setPaused(false);
  await done;
  assert.equal(setups, 1, "awaited lifecycle completion ran ahead of module setup");
  assert.equal(life.snapshot()[0].status, "on");
});

await test("slow failed-setup cleanup clears its progress flag before reporting error", async () => {
  const cleanup = deferred();
  let lastSlow = false;
  const life = new ModuleLifecycle({ a: {
    async setup() { throw Error("partial startup"); },
    async teardown() { await cleanup.promise; },
  }}, { retryDelays: [], slowAfterMs: 1, onChange: (snapshots) => { lastSlow = snapshots[0].slow; } });
  const done = life.setDesired({ a: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(life.snapshot()[0].status, "stopping");
  assert.equal(lastSlow, true);
  cleanup.resolve(); await done;
  assert.equal(life.snapshot()[0].status, "error");
  assert.equal(lastSlow, false, "final error notification retained an active slow-operation flag");
});

console.log(`${passed} lifecycle regressions passed`);
