/**
 * Optional, diagnostic-only instrumentation for Three r186 WebGLRenderer.
 * Install after renderer initialization/compilation. No production source changes.
 *
 * GPU queries are opt-in: installPassBudgetProbe(renderer, { gpu: true }).
 * Call poll() in a later animation frame/task; it only reads QUERY_RESULT after
 * QUERY_RESULT_AVAILABLE. There is no fence, flush, finish, pixel read, or wait.
 * The main interval starts when shadowMap.render returns and ends when render
 * returns. It includes all work after shadows, not just opaque-object drawing.
 *
 * r186 resets info.render BEFORE shadowMap.render (WebGLRenderer.js), so the
 * shadow-entry baseline is correct with either value of info.autoReset. Never
 * subtract the previous frame's counters or change the caller's reset setting.
 * GPU handles stay private; records/poll/status/dispose are JSON-safe.
 */
export function installPassBudgetProbe(renderer, {
  gpu = false,
  getFrame = null,
  now = () => performance.now(),
  timeOrigin = globalThis.performance?.timeOrigin ?? Date.now(),
} = {}) {
  if (!renderer || typeof renderer.render !== 'function' ||
      typeof renderer.getContext !== 'function') {
    throw new TypeError('A WebGLRenderer with render() and getContext() is required');
  }
  if (getFrame !== null && typeof getFrame !== 'function') {
    throw new TypeError('getFrame must be a function or null');
  }

  const records = [];
  const pending = new Set();
  const hooks = [];
  const canvas = renderer.domElement;
  const originalRender = renderer.render;
  const counterNames = ['calls', 'triangles', 'lines', 'points'];
  let gl = renderer.getContext();
  let ext = null;
  let unsupportedReason = gpu ? 'extension-unavailable' : 'disabled';
  let epoch = 0;
  let sequence = 0;
  let depth = 0;
  let active = null;
  let disposed = false;
  let observedLost = false;
  let lastManager = null;

  const isLost = () => Boolean(gl?.isContextLost?.());
  const stats = () => {
    const values = renderer.info?.render;
    if (!values || counterNames.some(key => !Number.isFinite(values[key]) || values[key] < 0)) return null;
    return Object.fromEntries(counterNames.map(key => [key, values[key]]));
  };
  const delta = (end, start) => {
    if (!end || !start) return null;
    const result = Object.fromEntries(counterNames.map(key => [key, end[key] - start[key]]));
    return counterNames.some(key => result[key] < 0) ? null : result;
  };
  const invalidate = (state, reason) => {
    if (!state.record.invalidReasons.includes(reason)) state.record.invalidReasons.push(reason);
  };
  const gpuFailure = (state, reason, error) => {
    state.gpuReason ??= reason;
    if (error) state.record.gpuError = String(error);
  };

  function discoverExtension() {
    ext = null;
    unsupportedReason = gpu ? 'extension-unavailable' : 'disabled';
    if (!gpu) return; // CPU-only runs do not even request the extension.
    const methods = ['getExtension', 'getParameter', 'getQuery', 'createQuery',
      'beginQuery', 'endQuery', 'getQueryParameter', 'deleteQuery'];
    if (!gl || methods.some(key => typeof gl[key] !== 'function')) {
      unsupportedReason = 'webgl2-query-api-unavailable';
      return;
    }
    try {
      ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) unsupportedReason = null;
    } catch {
      unsupportedReason = 'extension-query-failed';
    }
  }

  function endTimer(state) {
    const open = state.open;
    state.open = null;
    if (!open || isLost()) return;
    try {
      // Never end a query belonging to the app or another diagnostic.
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== open) {
        gpuFailure(state, 'query-interference');
        return;
      }
      gl.endQuery(ext.TIME_ELAPSED_EXT);
    } catch (error) {
      gpuFailure(state, 'query-error', error);
    }
  }

  function releaseQueries(state, contextGone = false) {
    if (!contextGone) endTimer(state);
    state.open = null;
    if (!contextGone && !isLost()) {
      for (const { query } of state.queries) {
        try { gl.deleteQuery(query); } catch { /* diagnostics must not break rendering */ }
      }
    }
    state.queries.length = 0;
  }

  function discard(state, reason, contextGone = false) {
    releaseQueries(state, contextGone);
    pending.delete(state);
    state.record.gpuValid = false;
    state.record.gpuStatus = 'discarded';
    state.record.gpuReason = reason;
    state.record.shadowGpuMs = null;
    state.record.mainAfterShadowGpuMs = null;
  }

  function loseContext() {
    if (!observedLost) epoch++;
    observedLost = true;
    for (const state of pending) discard(state, 'context-lost', true);
    if (active) {
      invalidate(active, 'context-lost');
      gpuFailure(active, 'context-lost');
      releaseQueries(active, true);
    }
  }

  function checkDisjoint() {
    if (!ext || isLost()) return false;
    let reason;
    try {
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) return false;
      reason = 'gpu-disjoint';
    } catch {
      reason = 'disjoint-query-failed';
    }
    for (const state of pending) discard(state, reason);
    if (active) gpuFailure(active, reason);
    return true;
  }

  function startTimer(state, part) {
    if (!ext || state.gpuReason || disposed || isLost()) return;
    let query = null;
    try {
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
        gpuFailure(state, 'query-busy');
        return;
      }
      query = gl.createQuery();
      if (!query) {
        gpuFailure(state, 'query-allocation-failed');
        return;
      }
      state.queries.push({ part, query });
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== query) {
        gpuFailure(state, 'query-begin-failed');
        return;
      }
      state.open = query;
    } catch (error) {
      gpuFailure(state, 'query-error', error);
      // If beginQuery took effect before throwing, retain ownership for cleanup.
      try {
        if (query && gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) === query) state.open = query;
      } catch { /* context may be gone */ }
    }
  }

  function installShadow() {
    const manager = renderer.shadowMap;
    if (manager === lastManager) return;
    // Three recreates shadowMap on context restoration. Restore old instances too.
    for (const hook of hooks) {
      if (hook.manager.render === hook.wrapper) hook.manager.render = hook.original;
    }
    lastManager = manager;
    if (!manager || typeof manager.render !== 'function') return;
    const original = manager.render;
    function wrapper(...args) {
      const state = active;
      if (!state || depth !== 1) return original.apply(this, args);
      const record = state.record;
      record.shadowEntries++;
      const began = now();
      const before = stats();
      if (record.shadowEntries === 1) {
        state.beforeShadow = before;
        record.preShadowSubmitMs = began - record.startedAt;
        startTimer(state, 'shadow');
      } else {
        invalidate(state, 'multiple-shadow-entries');
        endTimer(state);
      }
      try {
        return original.apply(this, args);
      } finally {
        endTimer(state);
        state.afterShadow = stats();
        state.shadowEndedAt = now();
        record.shadowSubmitMs += state.shadowEndedAt - began;
        record.shadowDraw = delta(state.afterShadow, state.beforeShadow);
        if (!record.shadowDraw) invalidate(state, 'invalid-shadow-counters');
        if (record.invalidReasons.length === 0) startTimer(state, 'main-after-shadow');
      }
    }
    manager.render = wrapper;
    hooks.push({ manager, original, wrapper });
  }

  function wrappedRender(...args) {
    if (depth) {
      if (active) invalidate(active, 'nested-render');
      depth++;
      try { return originalRender.apply(this, args); } finally { depth--; }
    }
    if (disposed) return originalRender.apply(this, args);
    if (isLost()) loseContext();
    installShadow();
    const startedAt = now();
    const record = {
      id: ++sequence, epoch, startedAt, startedAtEpochMs: timeOrigin + startedAt,
      frame: null, rendererInfoAutoReset: renderer.info?.autoReset === true,
      shadowEntries: 0, preShadowSubmitMs: null, shadowSubmitMs: 0,
      outerSubmitMs: null, mainAfterShadowSubmitMs: null,
      shadowDraw: null, mainDraw: null, totalDraw: null,
      validShape: false, invalidReasons: [],
      gpuRequested: Boolean(gpu), gpuSupported: Boolean(ext), gpuValid: false,
      gpuStatus: ext ? 'pending' : 'unavailable', gpuReason: unsupportedReason,
      shadowGpuMs: null, mainAfterShadowGpuMs: null,
    };
    if (getFrame) {
      try {
        const value = getFrame();
        record.frame = value === undefined ? null : JSON.parse(JSON.stringify(value));
      } catch (error) {
        record.frameError = String(error);
      }
    }
    const state = { record, queries: [], open: null, gpuReason: null,
      beforeShadow: null, afterShadow: null, shadowEndedAt: null };
    active = state;
    depth = 1;
    if (isLost()) {
      invalidate(state, 'context-lost');
      gpuFailure(state, 'context-lost');
    } else {
      checkDisjoint();
    }
    try {
      return originalRender.apply(this, args);
    } catch (error) {
      record.error = String(error);
      invalidate(state, 'render-error');
      throw error;
    } finally {
      endTimer(state);
      const endedAt = now();
      record.outerSubmitMs = endedAt - startedAt;
      if (state.shadowEndedAt !== null) record.mainAfterShadowSubmitMs = endedAt - state.shadowEndedAt;
      if (record.shadowEntries !== 1) invalidate(state, 'expected-one-shadow-entry');
      if (isLost() || record.epoch !== epoch) invalidate(state, 'context-lost');
      if (disposed) invalidate(state, 'disposed');
      record.mainDraw = delta(stats(), state.afterShadow);
      record.totalDraw = delta(stats(), state.beforeShadow);
      if (!record.mainDraw || !record.totalDraw) invalidate(state, 'invalid-main-counters');
      record.validShape = record.invalidReasons.length === 0;
      if (!record.validShape) {
        record.shadowDraw = record.mainDraw = record.totalDraw = null;
      }
      records.push(record);
      if (ext && (!record.validShape || state.gpuReason || state.queries.length !== 2)) {
        discard(state, state.gpuReason ?? (!record.validShape ? 'invalid-render-shape' : 'incomplete-query-pair'), isLost());
      } else if (ext) {
        pending.add(state);
      }
      active = null;
      depth = 0;
    }
  }

  function restored() {
    // A restore without a delivered loss event must also invalidate stale handles.
    loseContext();
    observedLost = false;
    gl = renderer.getContext();
    discoverExtension();
    installShadow();
  }

  function status() {
    return {
      disposed, contextLost: isLost(), epoch, recordCount: records.length,
      pendingCount: pending.size, renderActive: depth > 0,
      gpuRequested: Boolean(gpu), gpuSupported: Boolean(ext),
      gpuStatus: disposed ? 'disposed' : isLost() ? 'context-lost' : ext ? 'available' : 'unavailable',
      gpuReason: unsupportedReason,
      gpuScope: 'shadowMap.render and render-after-shadow; excludes pre-shadow work',
    };
  }

  function poll() {
    let resolved = 0;
    let discarded = 0;
    if (disposed || active) return { ...status(), resolved, discarded };
    function rejectInvalidEpoch() {
      const before = pending.size;
      if (isLost()) loseContext();
      else if (!checkDisjoint()) return false;
      discarded += before - pending.size;
      return true;
    }
    if (rejectInvalidEpoch()) return { ...status(), resolved, discarded };
    for (const state of pending) {
      if (state.record.epoch !== epoch || !state.record.validShape) {
        discard(state, 'invalid-render-shape');
        discarded++;
        continue;
      }
      try {
        if (!state.queries.every(({ query }) => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) continue;
        // The GPU can lose its context/become disjoint while this JS task runs.
        // Recheck after availability and before publishing any accepted values.
        if (rejectInvalidEpoch()) break;
        const times = state.queries.map(({ query }) => gl.getQueryParameter(query, gl.QUERY_RESULT));
        if (rejectInvalidEpoch()) break;
        if (times.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
          discard(state, 'invalid-query-result');
          discarded++;
          continue;
        }
        state.record.shadowGpuMs = times[0] / 1e6;
        state.record.mainAfterShadowGpuMs = times[1] / 1e6;
        state.record.gpuValid = true;
        state.record.gpuStatus = 'valid';
        state.record.gpuReason = null;
        releaseQueries(state);
        pending.delete(state);
        resolved++;
      } catch (error) {
        if (rejectInvalidEpoch()) break;
        state.record.gpuError = String(error);
        discard(state, 'query-read-failed');
        discarded++;
      }
    }
    return { ...status(), resolved, discarded };
  }

  function dispose() {
    if (disposed) return status();
    disposed = true;
    if (renderer.render === wrappedRender) renderer.render = originalRender;
    for (const hook of hooks) {
      if (hook.manager.render === hook.wrapper) hook.manager.render = hook.original;
    }
    canvas?.removeEventListener?.('webglcontextlost', loseContext);
    canvas?.removeEventListener?.('webglcontextrestored', restored);
    for (const state of pending) discard(state, 'disposed', isLost());
    if (active) {
      invalidate(active, 'disposed');
      gpuFailure(active, 'disposed');
      releaseQueries(active, isLost());
    }
    return status();
  }

  discoverExtension();
  renderer.render = wrappedRender;
  installShadow();
  canvas?.addEventListener?.('webglcontextlost', loseContext);
  canvas?.addEventListener?.('webglcontextrestored', restored);
  return { records, poll, status, dispose };
}
