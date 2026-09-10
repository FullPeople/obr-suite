/** One pool per iframe, shared by all content loaders in that iframe. */
export const CONTENT_REQUEST_LIMIT = 6;
export const CONTENT_REQUEST_TIMEOUT_MS = 10_000;

export interface JsonResource<T = any> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

export function createContentRequests(
  limit = CONTENT_REQUEST_LIMIT,
  timeoutMs = CONTENT_REQUEST_TIMEOUT_MS,
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid request limit");
  let active = 0;
  const queue: Array<() => void> = [];
  function drain() {
    while (active < limit && queue.length) queue.shift()!();
  }

  return function request<T = any>(url: string, init: RequestInit = {}): Promise<JsonResource<T>> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let started = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        init.signal?.removeEventListener("abort", abort);
      };
      const finish = (error?: unknown, value?: JsonResource<T>) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (started) active--;
        else {
          const index = queue.indexOf(start);
          if (index >= 0) queue.splice(index, 1);
        }
        if (error !== undefined) reject(error);
        else resolve(value!);
        drain();
      };
      const abort = () => {
        const error = init.signal?.reason ?? new DOMException("Content request cancelled", "AbortError");
        controller.abort(error);
        finish(error);
      };
      const start = () => {
        if (settled) return;
        started = true;
        active++;
        // The deadline measures network/body work. Healthy requests must not
        // time out merely because other libraries are ahead in the queue.
        timer = setTimeout(() => {
          const error = new Error(`Content request timed out after ${timeoutMs}ms: ${url}`);
          error.name = "TimeoutError";
          controller.abort(error);
          finish(error);
        }, timeoutMs);
        // Hold the slot until JSON has been read, not just until headers arrive.
        void (async () => {
          try {
            const response = await fetcher(url, { ...init, signal: controller.signal });
            let data: T;
            if (response.ok) data = await response.json() as T;
            else {
              // HTTP failures still reach callers so case/source fallbacks work.
              void response.body?.cancel().catch(() => {});
              data = undefined as T;
            }
            finish(undefined, { ok: response.ok, status: response.status, json: async () => data });
          } catch (error) {
            finish(error);
          }
        })();
      };
      if (init.signal?.aborted) {
        abort();
        return;
      }
      init.signal?.addEventListener("abort", abort, { once: true });
      queue.push(start);
      drain();
    });
  };
}

export const fetchContentJson = createContentRequests();

/** Check after every await before allowing an old request to paint. */
export function createContentRequestGuard() {
  let generation = 0;
  return {
    next() { const own = ++generation; return () => own === generation; },
    invalidate() { generation++; },
  };
}

/** Large healthy libraries may run as long as they continue making progress. */
export function createContentIdleDeadline(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort(parent?.reason);
  const progress = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (!controller.signal.aborted) {
      timer = setTimeout(() => controller.abort(new Error("Content source stopped making progress")), timeoutMs);
    }
  };
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  progress();
  return {
    signal: controller.signal,
    progress,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener("abort", cancel);
    },
  };
}

/** Preserve input order while preventing one source from filling the queue. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid worker limit");
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await fn(items[index], index);
    }
  }));
  return result;
}
