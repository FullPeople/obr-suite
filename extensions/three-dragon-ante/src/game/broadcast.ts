import { describeError, diag, throttle } from "./diagnostics";

/** Owlbear rejects broadcasts with `RateLimitHit: Too many requests`, and it
 *  counts messages, not bytes. One view used to cost sixteen LOCAL messages —
 *  the LOCAL channel carries the public history, which grows all session — so a
 *  late game tripped the limiter, every part failed, the page never received a
 *  complete view, and the controller's own private sends were refused with it
 *  ("no result arrived"). Every broadcast now goes through one serial queue with
 *  a fixed spacing, and a refusal is waited out instead of retried immediately,
 *  which is what made the limiter angry in the first place. */
const SPACING_MS = 150;
const MAX_PENALTY_MS = 6000;
const logRate = throttle(2000);

let chain: Promise<unknown> = Promise.resolve();
let nextAt = 0, penalty = 0, inFlight = 0;

const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const limited = (error: unknown): boolean => { const text = describeError(error); return text.includes("RateLimit") || text.includes("Too many requests") || text.includes("too many"); };

/** Runs one broadcast, spaced from the previous one. Rate-limit refusals are
 *  retried inside the queue with exponential backoff, so a caller either gets
 *  its message delivered or a non-rate error. */
export function sendQueued<T>(run: () => Promise<T>): Promise<T> {
  inFlight++;
  const task = chain.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, nextAt - Date.now());
      if (wait) await delay(wait);
      nextAt = Date.now() + SPACING_MS + penalty;
      try { return await run(); }
      catch (error) {
        if (limited(error) && attempt < 3) {
          penalty = Math.min(penalty ? penalty * 2 : 600, MAX_PENALTY_MS);
          if (logRate("limited")) diag("rate", "broadcast refused, backing off", { attempt: attempt + 1, penalty, queued: inFlight, error: describeError(error) });
          continue;
        }
        throw error;
      }
    }
  }).finally(() => {
    inFlight--;
    // A quiet queue clears the penalty, so a burst does not slow the next turn.
    if (!inFlight && penalty) void delay(1000).then(() => { if (!inFlight) penalty = 0; });
  });
  chain = task.then(() => {}, () => {});
  return task;
}

/** Diagnostics only: what the queue is doing right now. */
export function queueState(): { queued: number; penalty: number } { return { queued: inFlight, penalty }; }
