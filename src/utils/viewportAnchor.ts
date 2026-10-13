// Viewport-resize re-anchoring for OBR popovers.
//
// Problem: every popover that anchors to a viewport edge or center stores
// its anchor at popover-open time as `{ left: vw - X, top: vh - Y }`.
// OBR doesn't expose a `popover.setPosition()` API, and there's no
// `OBR.viewport.onChange` event either — so when the user resizes the
// browser window or maximises it, the popovers stay at their original
// pixel positions and visually drift away from the corner they should be
// hugging.
//
// Solution: poll `OBR.viewport.getWidth/getHeight` from the background
// iframe (where every module's setup code lives). When either dimension
// changes, fire registered callbacks. Each module's callback re-opens
// its popover with the recomputed anchor — same id + same url means OBR
// updates the popover in place rather than spawning a duplicate.
//
// The poll only runs while there's at least one registered listener; an
// idle plugin pays nothing.

import OBR from "@owlbear-rodeo/sdk";

export type ViewportListener = (vw: number, vh: number) => void | Promise<void>;

const listeners = new Set<ViewportListener>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastVW = 0;
let lastVH = 0;
let primed = false;
let reading=false,nextReadAt=0,failures=0,pollGeneration=0;

const POLL_INTERVAL_MS = 500;

async function tick(): Promise<void> {
  if (listeners.size === 0||reading||Date.now()<nextReadAt) return;
  reading=true;const generation=pollGeneration;
  let vw: number;
  let vh: number;
  try {
    const results = await Promise.allSettled([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const rejection=results.find(result=>result.status==='rejected');
    if(rejection?.status==='rejected')throw rejection.reason;
    [vw,vh]=results.map(result=>result.status==='fulfilled'?result.value:0);
    failures=0;nextReadAt=0;
  } catch {
    failures++;nextReadAt=Date.now()+Math.min(8000,1000*2**Math.min(failures,3));
    return;
  } finally {
    reading=false;
  }
  if(generation!==pollGeneration||listeners.size===0||!Number.isFinite(vw)||!Number.isFinite(vh)||vw<=0||vh<=0)return;
  if (!primed) {
    // First successful read just records the baseline so we don't fire
    // a spurious "resize" on initial subscribe.
    primed = true;
    lastVW = vw;
    lastVH = vh;
    return;
  }
  if (vw === lastVW && vh === lastVH) return;
  lastVW = vw;
  lastVH = vh;
  for (const fn of Array.from(listeners)) {
    try { await fn(vw, vh); } catch (e) {
      console.warn("[obr-suite/viewportAnchor] listener threw", e);
    }
  }
}

function ensurePoll(): void {
  if (pollTimer || listeners.size === 0) return;
  pollTimer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
}

function maybeStopPoll(): void {
  if (pollTimer && listeners.size === 0) {
    clearInterval(pollTimer);
    pollTimer = null;
    primed = false;
    pollGeneration++;nextReadAt=0;failures=0;
  }
}

/**
 * Register a callback that fires whenever the OBR viewport size changes.
 * Returns an unsubscribe function — caller is responsible for invoking
 * it on teardown so the poll can stop when no one is listening.
 */
export function onViewportResize(fn: ViewportListener): () => void {
  listeners.add(fn);
  ensurePoll();
  return () => {
    listeners.delete(fn);
    maybeStopPoll();
  };
}
