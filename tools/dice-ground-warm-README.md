# Cold build attribution, not a faster cache

This tools-only experiment is based on `bbd03c2fddb5e5f40b9a5622409d425ef3cbfe0b`.
It adds CPU wall timing around existing operations. It changes no visual,
resource size/precision, state check, render order, clock, or cache policy.
It does not implement prewarming or claim production acceptance.

## What the existing result actually shows

For bbd03c2's three building clients, build total / capture / compile were:

- Single 20d6: 203.1 / 16.8 / 1.7 ms, residual 184.6 ms
- Two-client Host: 466.5 / 47.8 / 1.1 ms, residual 417.6 ms
- Two-client Player: 263.0 / 104.7 / 1.6 ms, residual 156.7 ms

That residual includes the initial `state(true)` query bundle, allocation and
snapshot setup, **both restoration passes**, and other small CPU gaps. Existing
fields do not isolate its cause. The first GL state query draining prior queued
work is a hypothesis, not an established finding.

There is a second cold-path issue: the very first cache-hit original-render
submission costs 100.4 / 139.7 / 139.4 ms respectively, despite approximately
1 ms reported `compile()`. This may be deferred shader/driver work or another
submission wait; the existing data does not separate them. A future preparation
contract cannot equate `compile()` returning with the first real draw being warm.

## Exact observation transform

`dice-ground-warm-transform.mjs` requires the original runtime SHA-256:

    e0b93c4795bf547c24efd12721775a022ca0bd6086f57d52dac3fa762f65d033

Source drift fails closed before generating an instrumented module. Exact
single-occurrence boundaries are checked as well. The profile preserves all
existing `gpu(name, ...args)` invocations, arguments, order, returns and throws.
It only records CPU monotonic start/end timestamps for each one, and spans for:

- state(true)
- resource allocation/material/matrix/visibility snapshots
- setRenderTarget(R32F), including Three's native resource setup
- capture clear and capture render
- restore1 before compile
- cache compile
- restore2 finally and its recovery retry, if entered

Nested query costs are included in their enclosing spans; do not sum them twice.
The query list is chronological as well as sortable by wall cost. This localizes
blocking sites but is not a GPU timestamp, OS scheduler trace, or proof of why a
call blocked. No new `getError`, `getParameter`, FBO check, readback, finish,
shader-status poll, or fence operation is introduced.

Instrumentation allocates small records and samples the CPU clock. Treat these
runs as attribution evidence, not a speed comparison. The original first-hit
and complete-sequence metrics remain available so a large delay cannot disappear
between named build spans.

## Small CI scope

The browser wrapper derives a pinned copy of the existing real SDK/Jolt runner
(SHA-256 `58f1c619cb5f26ca74e6c0f9605a387cb72f9012e0b9fc5a30dfe2255ea2ae20`).
It runs exactly one candidate single-client 20d6 sequence and one candidate
two-client 20d6 sequence. It does not repeat the nine A/B/A legs, and does not run
strict pixels: it explicitly reports `strictPixelsNotRun:true`, `speedClaim:false`
and `cacheAcceptedForProduction:false`. Existing fixture/engine/lifecycle/resource
checks remain. Source drift in the parent runner also fails closed rather than
silently changing the experiment. No local browser is permitted.

After the existing locked dependency/official Chromium and pinned paired-Web
setup, the integration commands are:

    node tools/dice-ground-warm-tests.mjs
    node tools/dice-ground-warm-prepare.mjs
    DICE_GROUND_LIVE_RUNTIME="$PWD/.local-evidence/dice-ground-warm/profile-runtime.mjs" DICE_GROUND_SEQUENCE_BUILD="$PWD/.local-evidence/dice-ground-warm/runtime" node tools/dice-ground-sequence-build.mjs
    DICE_GROUND_SEQUENCE_BUILD="$PWD/.local-evidence/dice-ground-warm/runtime" node tools/dice-ground-warm-browser.mjs
    node tools/dice-ground-warm-summarize.mjs .local-evidence/dice-ground-warm/results/result.json > .local-evidence/dice-ground-warm/summary.json

The browser command requires actual CI (`CI=true`). Upload the entire
`.local-evidence/dice-ground-warm/` directory with `if: always()`. Summarization
can also inspect the older report without changing it. New JSON fields are
`client.probe.warmProfile` and each build record's `warmBuild`.

Local validation runs only Node source/control tests. They compare the full
existing GL call sequence, arguments and count for original versus instrumented
runtime using the same real-Three/mock-GL fixture, including fatal paths. They
also verify runtime/runner drift rejection and the reduced case selection.
These tests are not browser, pixel, cold-start or performance evidence.

## Later preparation options: design only

1. First identify which existing calls actually block, including restoration and
   first real cache draw. Simply removing the first synchronizing query may move
   its wait to FBO validation, allocation, first sampling, or browser presentation.
2. A strictly owned CPU state mirror could remove redundant live state queries,
   but only after proving all required state is mirrored. It does not solve the
   other synchronization sites by itself. Do not delete checks to make charts
   look faster.
3. A future ready-only path could reuse a full-size, context-valid R32F/depth
   target and an exactly matching shader variant already allocated, validated
   and actually drawn during existing initialization work. Its validation must
   cover target size/format/depth/context and all shader/light/output variants.
   Resize/context/variant mismatch means ordinary rendering, with no synchronous
   cold repair during an active roll.
4. Any preparation merged into existing initialization must be measured from
   truly cold navigation through ready and first visible/first-roll latency,
   under single and simultaneous clients. Existing `compileAsync` and `finish`
   waits are possible integration points, not evidence that additional work is
   free or hidden in parallel. Preserve the original ready gate; never delay it
   and then omit that delay from the reported animation.
5. Opportunistic idle preparation is not inherently safe: a GL call can block
   beyond a requestIdleCallback budget and overlap an incoming roll. If resources
   are not already safely ready, remain on the original path. Do not speculate
   that an idle callback guarantees zero input/first-roll penalty.
6. Progressive ground-only filling could be considered only after allocation,
   validation and shader first-use are already solved. It would retain the full
   original frame every time, publish only a complete cache, and require one
   unchanged dependency signature across all portions. It does not fix a single
   blocking driver call, and it must not recreate the rejected multi-region
   whole-scene render scheme. No such implementation is included here.

## Stop / rejection conditions

- Any strict RGBA/state/lifecycle mismatch or unverified source/context domain
- A visible cold-build or first-hit hitch, even if overall P95 improves
- Waiting merely moving to a different driver call or presentation boundary
- Worse cold-ready, first visible, first-roll, input or single-die control latency
- Extra hidden startup work that is omitted from end-to-end accounting
- Resource/shader validation missing or stale, live synchronization required to
  repair it, or more than the accepted full-resolution memory footprint

When these cannot be excluded, keep the cache experimental or restrict it to
independently proven already-ready resources. The separate 2D clamp 1-LSB finding
remains an unresolved correctness question; this experiment does not alter its
threshold or use it to justify cache acceptance.
