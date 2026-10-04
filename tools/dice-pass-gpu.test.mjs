import test from 'node:test';
import assert from 'node:assert/strict';
import { installPassBudgetProbe } from './dice-pass-gpu.mjs';

function fixture(options = {}) {
  const clock = { value: 100 };
  const listeners = new Map();
  const events = [];
  const ext = { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 };
  const queries = [];
  const gl = {
    CURRENT_QUERY: 20, QUERY_RESULT_AVAILABLE: 21, QUERY_RESULT: 22,
    lost: false, disjoint: false, current: null,
    isContextLost() { return this.lost; },
    getExtension(name) {
      events.push(['extension', name]);
      return options.extension === false ? null : ext;
    },
    getParameter(name) {
      assert.equal(name, ext.GPU_DISJOINT_EXT);
      events.push(['disjoint']);
      return this.disjoint;
    },
    getQuery(target, name) {
      assert.equal(target, ext.TIME_ELAPSED_EXT);
      assert.equal(name, this.CURRENT_QUERY);
      return this.current;
    },
    createQuery() {
      if (options.allocationFails) return null;
      const query = { id: queries.length, available: false, result: (queries.length + 1) * 1e6 };
      query.circular = query; // A leaked GPU handle would break JSON serialization.
      queries.push(query);
      events.push(['create', query.id]);
      return query;
    },
    beginQuery(target, query) {
      assert.equal(target, ext.TIME_ELAPSED_EXT);
      assert.equal(this.current, null);
      if (options.beginThrows) throw new Error('begin failed');
      this.current = query;
      events.push(['begin', query.id]);
    },
    endQuery(target) {
      assert.equal(target, ext.TIME_ELAPSED_EXT);
      assert.ok(this.current);
      events.push(['end', this.current.id]);
      this.current = null;
    },
    getQueryParameter(query, name) {
      assert.equal(query.deleted, undefined);
      assert.equal(this.lost, false);
      if (name === this.QUERY_RESULT_AVAILABLE) {
        events.push(['available', query.id]);
        return query.available;
      }
      assert.equal(name, this.QUERY_RESULT);
      assert.equal(query.available, true, 'result read before it was available');
      events.push(['result', query.id]);
      if (options.readThrows) throw new Error('result failed');
      return query.result;
    },
    deleteQuery(query) {
      assert.equal(this.lost, false, 'delete after context loss');
      assert.equal(query.deleted, undefined, 'query deleted twice');
      query.deleted = true;
      events.push(['delete', query.id]);
    },
    finish() { assert.fail('synchronous finish is forbidden'); },
    readPixels() { assert.fail('synchronous pixel read is forbidden'); },
  };
  const canvas = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const fn of listeners.get(type) ?? []) fn({ type }); },
    getImageData() { assert.fail('synchronous canvas read is forbidden'); },
  };
  const initial = () => ({ calls: 91, triangles: 182, lines: 13, points: 17, frame: 4 });
  let renderDepth = 0;
  let originalCalls = 0;
  let resetCalls = 0;
  const renderer = {
    getContext: () => gl,
    domElement: canvas,
    info: {
      autoReset: options.autoReset ?? true,
      render: initial(),
      reset() {
        resetCalls++;
        Object.assign(this.render, { calls: 0, triangles: 0, lines: 0, points: 0 });
      },
    },
    render(...args) {
      assert.equal(this, renderer);
      originalCalls++;
      renderDepth++;
      try {
        clock.value += 2;
        // This order matches Three r186 WebGLRenderer.render exactly.
        this.info.render.frame++;
        if (this.info.autoReset) this.info.reset();
        for (let index = 0; index < (options.shadowEntries ?? 1); index++) this.shadowMap.render(...args);
        if (options.nested && renderDepth === 1) this.render('nested');
        options.afterShadow?.({ renderer, gl, canvas });
        clock.value += 5;
        this.info.render.calls += 2;
        this.info.render.triangles += 6;
        this.info.render.lines += 1;
        this.info.render.points += 3;
        if (options.renderThrows) throw new Error('render failed');
        return 'original-result';
      } finally { renderDepth--; }
    },
  };
  function newShadowManager() {
    const manager = {
      render(...args) {
        assert.equal(this, manager);
        clock.value += 3;
        renderer.info.render.calls += 4;
        renderer.info.render.triangles += 12;
        options.inShadow?.({ renderer, gl, canvas, args });
        if (options.shadowThrows) throw new Error('shadow failed');
      },
    };
    return manager;
  }
  renderer.shadowMap = newShadowManager();
  const originalRender = renderer.render;
  const originalShadow = renderer.shadowMap.render;
  const install = opts => installPassBudgetProbe(renderer, { now: () => clock.value, timeOrigin: 1000, ...opts });
  const count = name => events.filter(event => event[0] === name).length;
  const ready = () => queries.forEach(query => { query.available = true; });
  const lose = () => { gl.lost = true; gl.current = null; canvas.dispatch('webglcontextlost'); };
  return { renderer, gl, canvas, clock, queries, events, listeners, install, count, ready, lose,
    originalRender, originalShadow, newShadowManager,
    calls: () => ({ originalCalls, resetCalls }) };
}

const expectedShadow = { calls: 4, triangles: 12, lines: 0, points: 0 };
const expectedMain = { calls: 2, triangles: 6, lines: 1, points: 3 };
const expectedTotal = { calls: 6, triangles: 18, lines: 1, points: 3 };

for (const autoReset of [true, false]) {
  test(`CPU counters use the shadow-entry baseline with autoReset=${autoReset}`, () => {
    const f = fixture({ autoReset });
    const probe = f.install();
    for (let n = 0; n < 2; n++) assert.equal(f.renderer.render(), 'original-result');
    for (const record of probe.records) {
      assert.equal(record.validShape, true);
      assert.deepEqual(record.shadowDraw, expectedShadow);
      assert.deepEqual(record.mainDraw, expectedMain);
      assert.deepEqual(record.totalDraw, expectedTotal);
      assert.equal(record.outerSubmitMs, 10);
      assert.equal(record.preShadowSubmitMs, 2);
      assert.equal(record.shadowSubmitMs, 3);
      assert.equal(record.mainAfterShadowSubmitMs, 5);
      assert.equal(record.gpuStatus, 'unavailable');
      assert.equal(record.gpuReason, 'disabled');
      assert.equal(record.shadowGpuMs, null);
    }
    assert.equal(f.renderer.info.autoReset, autoReset);
    assert.equal(f.calls().resetCalls, autoReset ? 2 : 0);
    assert.equal(f.count('extension'), 0);
    assert.equal(f.count('create'), 0);
    assert.equal(probe.status().pendingCount, 0);
    probe.dispose();
  });
}

test('records preserve frame linkage and are JSON-safe before any GPU result is ready', () => {
  const f = fixture();
  let frame = { index: 42, stage: 'roll' };
  const probe = f.install({ gpu: true, getFrame: () => frame });
  f.renderer.render();
  frame.index = 43;
  const record = probe.records[0];
  assert.equal(record.id, 1);
  assert.equal(record.startedAt, 100);
  assert.equal(record.startedAtEpochMs, 1100);
  assert.deepEqual(record.frame, { index: 42, stage: 'roll' });
  assert.deepEqual(JSON.parse(JSON.stringify(probe.records)), probe.records);
  assert.equal(record.gpuStatus, 'pending');
  assert.equal(f.count('result'), 0);
  assert.equal(f.count('available'), 0);
  assert.equal(probe.status().pendingCount, 1);
  probe.dispose();
});

test('poll reads GPU results asynchronously only after both query results are available', () => {
  const f = fixture();
  const probe = f.install({ gpu: true, getFrame: () => 7 });
  f.renderer.render();
  assert.equal(probe.poll().resolved, 0);
  f.queries[0].available = true;
  assert.equal(probe.poll().pendingCount, 1);
  assert.equal(f.count('result'), 0);
  f.ready();
  const status = probe.poll();
  assert.equal(status.resolved, 1);
  assert.equal(status.pendingCount, 0);
  assert.equal(f.count('result'), 2);
  assert.equal(f.count('delete'), 2);
  assert.equal(probe.records[0].shadowGpuMs, 1);
  assert.equal(probe.records[0].mainAfterShadowGpuMs, 2);
  assert.equal(probe.records[0].gpuValid, true);
  assert.equal(probe.records[0].frame, 7);
  assert.equal(probe.poll().resolved, 0);
  probe.dispose();
});

test('missing timer extension explicitly reports unavailable while keeping CPU data', () => {
  const f = fixture({ extension: false });
  const probe = f.install({ gpu: true });
  f.renderer.render();
  assert.equal(probe.status().gpuSupported, false);
  assert.equal(probe.records[0].gpuReason, 'extension-unavailable');
  assert.equal(probe.records[0].validShape, true);
  assert.equal(f.count('create'), 0);
  assert.equal(probe.poll().pendingCount, 0);
  probe.dispose();
});

test('a WebGL1-style context is unavailable rather than calling missing query APIs', () => {
  const f = fixture();
  delete f.gl.createQuery;
  const probe = f.install({ gpu: true });
  f.renderer.render();
  assert.equal(probe.records[0].gpuReason, 'webgl2-query-api-unavailable');
  assert.equal(f.count('extension'), 0);
  probe.dispose();
});

test('a disjoint event discards every pending pair without reading result values', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.renderer.render();
  f.ready();
  f.gl.disjoint = true;
  assert.equal(probe.poll().discarded, 2);
  assert.equal(probe.status().pendingCount, 0);
  assert.equal(f.count('result'), 0);
  assert.equal(f.count('delete'), 4);
  for (const record of probe.records) {
    assert.equal(record.gpuReason, 'gpu-disjoint');
    assert.equal(record.gpuValid, false);
    assert.equal(record.shadowGpuMs, null);
  }
  probe.dispose();
});

test('disjoint observed at the next render invalidates old and new samples, then recovers', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.gl.disjoint = true;
  f.renderer.render();
  assert.equal(f.queries.length, 2);
  assert.equal(probe.records[0].gpuReason, 'gpu-disjoint');
  assert.equal(probe.records[1].gpuReason, 'gpu-disjoint');
  f.gl.disjoint = false;
  f.renderer.render();
  f.ready();
  assert.equal(probe.poll().resolved, 1);
  assert.equal(probe.records[2].gpuValid, true);
  probe.dispose();
});

test('context loss discards pending handles and restoration rehooks a new shadow manager', () => {
  const f = fixture();
  const oldManager = f.renderer.shadowMap;
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.lose();
  assert.equal(probe.status().pendingCount, 0);
  assert.equal(probe.records[0].gpuReason, 'context-lost');
  assert.equal(f.count('delete'), 0);
  assert.equal(probe.status().epoch, 1);
  f.gl.lost = false;
  const nextManager = f.newShadowManager();
  const nextOriginal = nextManager.render;
  f.renderer.shadowMap = nextManager;
  f.canvas.dispatch('webglcontextrestored');
  assert.equal(oldManager.render, f.originalShadow);
  assert.notEqual(nextManager.render, nextOriginal);
  f.renderer.render();
  f.ready();
  assert.equal(probe.poll().resolved, 1);
  assert.equal(probe.records[1].epoch, 1);
  assert.equal(probe.records[1].validShape, true);
  assert.equal(f.count('extension'), 2);
  probe.dispose();
  assert.equal(nextManager.render, nextOriginal);
  assert.equal(f.renderer.render, f.originalRender);
});

test('poll detects context loss even if the browser event has not arrived', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.gl.lost = true;
  f.gl.current = null;
  assert.equal(probe.poll().discarded, 1);
  assert.equal(probe.records[0].gpuReason, 'context-lost');
  assert.equal(f.count('result'), 0);
  assert.equal(f.count('delete'), 0);
  probe.dispose();
});

test('context loss during a render invalidates its shape and never reads/deletes dead queries', () => {
  const f = fixture({ inShadow: ({ gl, canvas }) => {
    gl.lost = true;
    gl.current = null;
    canvas.dispatch('webglcontextlost');
  } });
  const probe = f.install({ gpu: true });
  f.renderer.render();
  assert.equal(probe.records[0].validShape, false);
  assert.equal(probe.records[0].gpuReason, 'context-lost');
  assert.equal(probe.records[0].totalDraw, null);
  assert.equal(probe.status().pendingCount, 0);
  assert.equal(f.count('delete'), 0);
  probe.dispose();
});

for (const shape of [{ shadowEntries: 0 }, { shadowEntries: 2 }, { nested: true }]) {
  test(`unsupported render shape is discarded: ${JSON.stringify(shape)}`, () => {
    const f = fixture(shape);
    const probe = f.install({ gpu: true });
    f.renderer.render();
    assert.equal(probe.records.length, 1);
    const record = probe.records[0];
    assert.equal(record.validShape, false);
    assert.equal(record.gpuReason, 'invalid-render-shape');
    assert.equal(record.totalDraw, null);
    assert.equal(record.mainDraw, null);
    assert.equal(record.shadowGpuMs, null);
    assert.equal(probe.status().pendingCount, 0);
    assert.equal(f.count('result'), 0);
    assert.equal(f.queries.length, f.count('delete'));
    if (shape.nested) assert.ok(record.invalidReasons.includes('nested-render'));
    probe.dispose();
  });
}

for (const option of ['renderThrows', 'shadowThrows']) {
  test(`renderer errors propagate and queries are discarded: ${option}`, () => {
    const f = fixture({ [option]: true });
    const probe = f.install({ gpu: true });
    assert.throws(() => f.renderer.render(), /failed/);
    assert.equal(probe.records[0].validShape, false);
    assert.ok(probe.records[0].invalidReasons.includes('render-error'));
    assert.equal(probe.status().pendingCount, 0);
    assert.equal(f.queries.length, f.count('delete'));
    assert.equal(f.gl.current, null);
    probe.dispose();
  });
}

test('dispose cleans pending queries, restores exact hooks, removes listeners and is idempotent', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.render();
  const status = probe.dispose();
  assert.equal(status.disposed, true);
  assert.equal(status.pendingCount, 0);
  assert.equal(f.renderer.render, f.originalRender);
  assert.equal(f.renderer.shadowMap.render, f.originalShadow);
  assert.equal(f.count('delete'), 2);
  assert.equal(f.listeners.get('webglcontextlost').size, 0);
  assert.equal(f.listeners.get('webglcontextrestored').size, 0);
  assert.equal(probe.records[0].gpuReason, 'disposed');
  assert.deepEqual(probe.dispose(), status);
  assert.equal(probe.poll().resolved, 0);
  f.renderer.render();
  assert.equal(probe.records.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(status)), status);
});

test('dispose preserves another tool’s later replacement functions', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  const replacementRender = () => {};
  const replacementShadow = () => {};
  f.renderer.render = replacementRender;
  f.renderer.shadowMap.render = replacementShadow;
  probe.dispose();
  assert.equal(f.renderer.render, replacementRender);
  assert.equal(f.renderer.shadowMap.render, replacementShadow);
});

test('an external active timer query is neither ended nor deleted', () => {
  const f = fixture();
  const external = { id: 'external' };
  f.gl.current = external;
  const probe = f.install({ gpu: true });
  f.renderer.render();
  assert.equal(f.gl.current, external);
  assert.equal(f.count('create'), 0);
  assert.equal(f.count('end'), 0);
  assert.equal(f.count('delete'), 0);
  assert.equal(probe.records[0].gpuReason, 'query-busy');
  assert.equal(probe.records[0].validShape, true);
  probe.dispose();
});

for (const option of ['allocationFails', 'beginThrows']) {
  test(`query setup failure does not break CPU rendering: ${option}`, () => {
    const f = fixture({ [option]: true });
    const probe = f.install({ gpu: true });
    assert.equal(f.renderer.render(), 'original-result');
    assert.equal(probe.records[0].validShape, true);
    assert.equal(probe.records[0].gpuValid, false);
    assert.equal(probe.status().pendingCount, 0);
    assert.equal(f.queries.length, f.count('delete'));
    probe.dispose();
  });
}

for (const invalid of [NaN, Infinity, -1, '1000']) {
  test(`invalid GPU result is discarded (${String(invalid)})`, () => {
    const f = fixture();
    const probe = f.install({ gpu: true });
    f.renderer.render();
    f.ready();
    f.queries[0].result = invalid;
    assert.equal(probe.poll().discarded, 1);
    assert.equal(probe.records[0].gpuReason, 'invalid-query-result');
    assert.equal(probe.records[0].shadowGpuMs, null);
    assert.equal(probe.records[0].mainAfterShadowGpuMs, null);
    probe.dispose();
  });
}

test('query read errors discard the pair without breaking subsequent renders', () => {
  const f = fixture({ readThrows: true });
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.ready();
  assert.equal(probe.poll().discarded, 1);
  assert.equal(probe.records[0].gpuReason, 'query-read-failed');
  f.renderer.render();
  assert.equal(probe.records.length, 2);
  probe.dispose();
});

test('a bad frame-tag callback is isolated and cannot leak cyclic data', () => {
  const f = fixture();
  const cycle = {};
  cycle.self = cycle;
  const probe = f.install({ getFrame: () => cycle });
  assert.equal(f.renderer.render(), 'original-result');
  assert.equal(probe.records[0].frame, null);
  assert.equal(typeof probe.records[0].frameError, 'string');
  assert.doesNotThrow(() => JSON.stringify(probe.records));
  probe.dispose();
});

test('disposing from inside a render cannot start another query or leak an active query', () => {
  let probe;
  const f = fixture({ inShadow: () => probe.dispose() });
  probe = f.install({ gpu: true });
  f.renderer.render();
  assert.equal(f.count('create'), 1);
  assert.equal(f.count('delete'), 1);
  assert.equal(f.gl.current, null);
  assert.equal(probe.status().pendingCount, 0);
  assert.equal(probe.records[0].gpuReason, 'disposed');
  assert.equal(probe.records[0].validShape, false);
  assert.equal(f.renderer.render, f.originalRender);
});

test('unexpected timer interference never ends an external query', () => {
  const external = { id: 'external' };
  const f = fixture({ inShadow: ({ gl }) => { gl.current = external; } });
  const probe = f.install({ gpu: true });
  f.renderer.render();
  assert.equal(f.gl.current, external);
  assert.equal(f.count('end'), 0);
  assert.equal(f.count('delete'), 1);
  assert.equal(probe.records[0].gpuReason, 'query-interference');
  probe.dispose();
});

test('counter resets inside the measured interval invalidate the reported draw budget', () => {
  const f = fixture({ autoReset: false, afterShadow: ({ renderer }) => renderer.info.reset() });
  const probe = f.install({ gpu: true });
  f.renderer.render();
  assert.equal(probe.records[0].validShape, false);
  assert.ok(probe.records[0].invalidReasons.includes('invalid-main-counters'));
  assert.equal(probe.records[0].totalDraw, null);
  assert.equal(probe.records[0].gpuValid, false);
  probe.dispose();
});

test('a disjoint flag appearing with availability is rejected before any result read', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.ready();
  const originalGet = f.gl.getQueryParameter;
  f.gl.getQueryParameter = function (query, name) {
    const result = originalGet.call(this, query, name);
    if (name === this.QUERY_RESULT_AVAILABLE) this.disjoint = true;
    return result;
  };
  assert.equal(probe.poll().discarded, 1);
  assert.equal(f.count('result'), 0);
  assert.equal(probe.records[0].gpuReason, 'gpu-disjoint');
  probe.dispose();
});

test('context loss during a result read discards all pending pairs without deleting dead handles', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.renderer.render();
  f.ready();
  const originalGet = f.gl.getQueryParameter;
  f.gl.getQueryParameter = function (query, name) {
    const result = originalGet.call(this, query, name);
    if (name === this.QUERY_RESULT) this.lost = true;
    return result;
  };
  assert.equal(probe.poll().discarded, 2);
  assert.equal(f.count('delete'), 0);
  assert.equal(probe.status().pendingCount, 0);
  for (const record of probe.records) {
    assert.equal(record.gpuReason, 'context-lost');
    assert.equal(record.gpuValid, false);
  }
  probe.dispose();
});

test('a standalone shadow compile/render outside renderer.render is not sampled', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.shadowMap.render('compile');
  assert.equal(probe.records.length, 0);
  assert.equal(f.count('create'), 0);
  f.renderer.render();
  assert.deepEqual(probe.records[0].totalDraw, expectedTotal);
  probe.dispose();
});

test('a restoration event without a delivered loss event still drops stale samples', () => {
  const f = fixture();
  const probe = f.install({ gpu: true });
  f.renderer.render();
  f.canvas.dispatch('webglcontextrestored');
  assert.equal(probe.status().pendingCount, 0);
  assert.equal(probe.records[0].gpuReason, 'context-lost');
  assert.equal(f.count('delete'), 0);
  f.renderer.render();
  f.ready();
  assert.equal(probe.poll().resolved, 1);
  assert.equal(probe.records[1].epoch, 1);
  probe.dispose();
});
