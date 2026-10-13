/** Bounded FIFO storage lanes. Parsing and control messages do not borrow these slots. */
export function storageLane(concurrency, maxQueued = 16, waitMs = 4000) {
  let active = 0;
  const waiting = [];
  function lease() {
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      while (active < concurrency && waiting.length) {
        const next = waiting.shift();
        next.cleanup();
        if (next.signal?.aborted) { next.resolve(null); continue; }
        next.resolve(lease());
      }
    };
  }
  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.resolve(null);
      if (active < concurrency) return Promise.resolve(lease());
      if (waiting.length >= maxQueued) return Promise.resolve(null);
      return new Promise(resolve => {
        const finish = () => {
          const index = waiting.indexOf(entry);
          if (index < 0) return;
          waiting.splice(index, 1);
          entry.cleanup();
          resolve(null);
        };
        const timer = setTimeout(finish, waitMs);
        const entry = {resolve, signal, cleanup() {clearTimeout(timer); signal?.removeEventListener('abort', finish);}};
        waiting.push(entry);
        signal?.addEventListener('abort', finish, {once: true});
      });
    },
    stats() {return {active, queued: waiting.length};}
  };
}
