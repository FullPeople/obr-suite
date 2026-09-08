import assert from "node:assert/strict";
import {
  createContentRequests, createContentRequestGuard, createContentIdleDeadline, mapWithConcurrency,
} from "../src/utils/contentRequests";
import { clearMonsterCache, getRawMonster, loadAllMonsters, searchMonsters } from "../src/modules/bestiary/data";
import { getState } from "../src/state";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let passed = 0;
async function test(name: string, run: () => Promise<void> | void) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}

await test("request limit includes delayed JSON bodies", async () => {
  let active = 0, maximum = 0;
  const request = createContentRequests(2, 500, (async () => {
    active++;
    maximum = Math.max(maximum, active);
    return { ok: true, status: 200, json: async () => {
      await sleep(5);
      active--;
      return { loaded: true };
    } } as Response;
  }) as typeof fetch);
  const results = await Promise.all(Array.from({ length: 9 }, (_, i) => request(`https://library/${i}`)));
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.deepEqual(await results[8].json(), { loaded: true });
});

await test("stalled JSON times out, aborts and releases the queue", async () => {
  let first = true, firstSignal: AbortSignal | undefined;
  const request = createContentRequests(1, 25, (async (_url, init) => {
    if (!first) return json({ recovered: true });
    first = false;
    firstSignal = init?.signal as AbortSignal;
    return { ok: true, status: 200, json: () => new Promise(() => {}) } as Response;
  }) as typeof fetch);
  await assert.rejects(request("https://library/stall"), { name: "TimeoutError" });
  assert.equal(firstSignal?.aborted, true);
  assert.deepEqual(await (await request("https://library/retry")).json(), { recovered: true });
});

await test("cancelled queued requests never start", async () => {
  const held = deferred<Response>();
  const calls: string[] = [];
  const request = createContentRequests(1, 500, (async (url) => {
    calls.push(String(url));
    return held.promise;
  }) as typeof fetch);
  const first = request("https://library/first");
  const controller = new AbortController();
  const queued = request("https://library/cancelled", { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, { name: "AbortError" });
  held.resolve(json({ done: true }));
  await first;
  assert.deepEqual(calls, ["https://library/first"]);
});

await test("healthy queued requests retain their full network timeout", async () => {
  const request = createContentRequests(1, 80, (async () => {
    await sleep(30);
    return json({ loaded: true });
  }) as typeof fetch);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => request(`https://library/${i}`)));
  assert.equal(results.length, 5); // Total queue duration exceeds 80ms.
});

await test("HTTP failures retain status without attempting JSON parsing", async () => {
  const request = createContentRequests(1, 500, (async () => new Response("challenge", { status: 403 })) as typeof fetch);
  const result = await request("https://library/protected");
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

await test("bounded workers preserve source order despite response order", async () => {
  let active = 0, maximum = 0;
  const values = await mapWithConcurrency([8, 1, 5, 2], 2, async (ms, index) => {
    active++;
    maximum = Math.max(maximum, active);
    await sleep(ms);
    active--;
    return index;
  });
  assert.deepEqual(values, [0, 1, 2, 3]);
  assert.equal(maximum, 2);
});

await test("late preview and idle callbacks cannot repaint a newer selection", async () => {
  const requests = createContentRequestGuard();
  const slow = deferred<void>();
  const old = requests.next();
  const painted: string[] = [];
  const pending = slow.promise.then(() => { if (old()) painted.push("old"); });
  const latest = requests.next();
  if (latest()) painted.push("new");
  slow.resolve();
  await pending;
  requests.invalidate();
  if (latest()) painted.push("after-close");
  assert.deepEqual(painted, ["new"]);
});

await test("progress extends a source beyond its original idle deadline", () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let now = 0, next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  globalThis.setTimeout = ((run: () => void, ms: number) => {
    const id = ++next;
    timers.set(id, { at: now + ms, run });
    return id;
  }) as any;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any;
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.run(); }
  };
  try {
    const deadline = createContentIdleDeadline(30);
    for (let i = 0; i < 5; i++) {
      advance(20);
      assert.equal(deadline.signal.aborted, false);
      deadline.progress();
    }
    assert.equal(now, 100); // More than three original deadlines, still healthy.
    advance(31);
    assert.equal(deadline.signal.aborted, true);
    deadline.dispose();
    assert.equal(timers.size, 0);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

const originalFetch = globalThis.fetch;
const originalLibraries = getState().libraries;
const originalWarn = console.warn;
const warnings: unknown[][] = [];
console.warn = (...args) => { warnings.push(args); };
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(), key: () => null, get length() { return storage.size; },
};
const configure = (bases: string[]) => {
  clearMonsterCache();
  getState().libraries = bases.map((baseUrl, i) => ({
    id: String(i), name: String(i), baseUrl, enabled: true, builtin: false,
  }));
};
const baseMonster = (name: string, source = "OK") => ({
  name, ENG_name: name, source, hp: { average: 40 }, ac: [15], dex: 14, cr: "2", size: ["M"], type: "beast",
});

try {
  await test("fast preview is available before slow parent; final copy data is complete", async () => {
    configure(["https://fast", "https://slow"]);
    const parent = deferred<Response>();
    const previewReady = deferred<void>();
    const incompletePreviewNames: string[] = [];
    const independent = baseMonster("Independent");
    const child = { name: "Child", ENG_name: "Child", source: "CH", _copy: {
      name: "Parent", source: "PA", _mod: { trait: { mode: "appendArr", items: [{ name: "Child trait" }] } },
    } };
    globalThis.fetch = (async (url) => {
      const path = String(url);
      if (path === "https://fast/data/bestiary/index.json") return json({ f: "fast.json" });
      if (path === "https://slow/data/bestiary/index.json") return json({ p: "parent.json" });
      if (path.endsWith("fast.json")) return json({ monster: [independent, child] });
      if (path.endsWith("parent.json")) return parent.promise;
      return json({}, 404);
    }) as typeof fetch;
    const loading = loadAllMonsters((progress) => {
      if (progress.preview.some((monster) => monster.name === "Independent")) previewReady.resolve();
      // Production deliberately isolates listener exceptions. Record evidence
      // here and assert outside the callback so failures cannot be swallowed.
      if (!getRawMonster("CH::Child")) incompletePreviewNames.push(...progress.preview.map((monster) => monster.name));
    });
    await previewReady.promise;
    assert.equal(getRawMonster("CH::Child"), null);
    parent.resolve(json({ monster: [{ ...baseMonster("Parent", "PA"), hp: { average: 88 }, trait: [{ name: "Parent trait" }] }] }));
    const result = await loading;
    assert.equal(result.find((monster) => monster.name === "Child")?.hp, 88);
    assert.deepEqual(getRawMonster("CH::Child").trait.map((trait: any) => trait.name), ["Parent trait", "Child trait"]);
    assert.equal(incompletePreviewNames.includes("Child"), false);
    globalThis.fetch = (async () => { throw new Error("Warm cache must not fetch"); }) as typeof fetch;
    assert.equal(await loadAllMonsters(), result);
  });

  await test("broken source leaves healthy entries usable and reports failure", async () => {
    configure(["https://broken", "https://healthy"]);
    let failed = 0;
    globalThis.fetch = (async (url) => String(url).startsWith("https://broken")
      ? json({}, 403)
      : String(url).endsWith("index.json") ? json({ ok: "healthy.json" })
      : json({ monster: [baseMonster("Healthy")] })) as typeof fetch;
    const result = await loadAllMonsters((progress) => { failed = progress.failedFiles; });
    assert.deepEqual(result.map((monster) => monster.name), ["Healthy"]);
    assert.ok(failed > 0);
  });

  await test("large healthy library finishes after multiple source idle periods", async () => {
    configure(["https://large"]);
    const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
    let now = 0, next = 0;
    const timers = new Map<number, { at: number; run: () => void }>();
    globalThis.setTimeout = ((run: () => void, ms: number) => {
      const id = ++next;
      timers.set(id, { at: now + ms, run });
      return id;
    }) as any;
    globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any;
    try {
      globalThis.fetch = (async (url) => {
        if (String(url).endsWith("index.json")) return json(Object.fromEntries(
          Array.from({ length: 16 }, (_, i) => [String(i), `file-${i}.json`]),
        ));
        await sleep(8_000); // Valid progress before either request or idle expiry.
        return json({ monster: [baseMonster(String(url))] });
      }) as typeof fetch;
      let done = false;
      const pending = loadAllMonsters();
      void pending.finally(() => { done = true; });
      for (let tick = 0; tick < 100 && !done; tick++) {
        // Flush JSON/worker continuations before advancing virtual time.
        for (let microtask = 0; microtask < 30; microtask++) await Promise.resolve();
        now += 1_000;
        for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.run(); }
      }
      assert.equal(done, true);
      assert.equal((await pending).length, 16);
      assert.ok(now > 60_000, "Healthy total duration must exceed two original idle periods");
      assert.equal(timers.size, 0);
    } finally {
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    }
  });

  await test("missing inherited parent is never offered as a zero-stat monster", async () => {
    configure(["https://missing"]);
    globalThis.fetch = (async (url) => String(url).endsWith("index.json")
      ? json({ child: "child.json" })
      : json({ monster: [{ name: "Missing child", source: "CH", _copy: { source: "NO", name: "Parent" } }] })) as typeof fetch;
    assert.deepEqual(await loadAllMonsters(), []);
    assert.equal(getRawMonster("CH::Missing child"), null);
  });

  await test("malformed source data cannot poison other valid files", async () => {
    configure(["https://mixed"]);
    let failed = 0;
    globalThis.fetch = (async (url) => String(url).endsWith("index.json")
      ? json({ bad: "bad.json", good: "good.json" })
      : String(url).endsWith("bad.json") ? json({ monster: "challenge page" })
      : json({ monster: [baseMonster("Still valid")] })) as typeof fetch;
    const result = await loadAllMonsters((progress) => { failed = progress.failedFiles; });
    assert.deepEqual(result.map((monster) => monster.name), ["Still valid"]);
    assert.equal(failed, 1);
  });

  await test("cache invalidation cancels old load and protects the new raw table", async () => {
    configure(["https://old"]);
    const entered = deferred<void>(), late = deferred<Response>();
    globalThis.fetch = (async (url) => {
      if (String(url).startsWith("https://old")) { entered.resolve(); return late.promise; }
      return String(url).endsWith("index.json") ? json({ n: "new.json" }) : json({ monster: [baseMonster("New")] });
    }) as typeof fetch;
    const oldLoad = loadAllMonsters();
    await entered.promise;
    configure(["https://new"]);
    const result = await loadAllMonsters();
    late.resolve(json({ old: "old.json" }));
    await oldLoad;
    assert.deepEqual(result.map((monster) => monster.name), ["New"]);
    assert.ok(getRawMonster("OK::New"));
    assert.equal(getRawMonster("OK::Old"), null);
  });

  await test("existing bestiary result limit remains 200", async () => {
    configure(["https://many"]);
    globalThis.fetch = (async (url) => String(url).endsWith("index.json") ? json({ all: "all.json" }) : json({
      monster: Array.from({ length: 250 }, (_, i) => baseMonster(`Monster ${i}`)),
    })) as typeof fetch;
    const result = await loadAllMonsters();
    assert.equal(result.length, 250);
    assert.equal(searchMonsters(result, "", false).length, 200);
  });
  assert.ok(warnings.length > 0, "Failure paths must retain diagnostics");
} finally {
  clearMonsterCache();
  getState().libraries = originalLibraries;
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
}
console.log(`CONTENT_LOADING_SELFTEST ${passed}/${passed}`);
