# Dice pass-budget diagnostic

This is a **test-build-only visual ablation experiment**, based on Suite
`2e2ddb1f642e1375cffda45efad9584b33100008` and Web
`05dcfdb645339cac9f68d1f6009f44b7e63d5c25`. Product source, protocol,
authoritative physics/results, playback clock, and cue schedule are not changed.
Faster omitted-visuals samples are **not product improvements** or proof that a
lossless optimization is possible.

## Run

- `node --test tools/dice-pass-*.test.mjs`
- `DND_CARD_WEB_ROOT=/exact/paired/web node tools/dice-pass-build.mjs`
- `DND_CARD_WEB_ROOT=/exact/paired/web node tools/dice-pass-browser.mjs`

The build enforces the exact Web SHA, no tracked product/dependency differences
from the Suite base, all seven exact instrumentation boundaries, and 59 immutable
asset locks. It preserves original renderer warmup, including the two existing
initialization-only GL synchronization calls. No browser is required for the
build or self-tests. Never bypass a local browser permission failure.

Browser execution uses official Playwright Chromium and a local mock Owlbear
host with the actual SDK, Jolt worker, verified WASM/assets and renderer. It does
not join a real room. `DICE_PASS_REPEATS` defaults to 3. The narrowly scoped push
workflow initially requests **one exploratory round**, to fit an approximately
10–15 minute browser budget (initialization/platform variance can increase it).
Repeat at least three bracketed rounds before claiming a stable direction.
The workflow has one runner/job and only triggers on
`fix/dice-pass-budget-20261004`; it has no publication/deployment step.

Every round runs these in order, 20d6 then 1d20 for each condition:

1. baseline-before
2. no-GL-pass
3. no-2D-raster
4. no-detached-DOM
5. no-GL+no-2D
6. baseline-after

Each case creates a fresh context, with seed 123456 and a fixed per-expression
roll ID (the particle noise depends on that ID). Both init and measured roll are
real. A two-client baseline for both expressions follows the single-client
rounds, to inspect resource competition. The two-client pages share one context,
as in the existing fixture. The two-client block runs later, so temporal drift
still limits attribution. Tests record exact browser flags, host CPU/OS,
renderer/vendor, dimensions, source SHAs, shader/GPU query availability and
context/visibility failures.

## Exact boundaries

- no-GL-pass skips the entire `withRenderRegion` call, including full clear and
  region derivation. Mesh interpolation, presence/material updates, FormulaShow,
  cue, results and all completion callbacks still run.
- no-2D-raster wraps only the two shared `cue-canvas`/`research-effects` contexts.
  It suppresses clearRect, fillRect, strokeRect, fill, stroke, text, drawImage,
  putImageData and drawFocusIfNeeded. Paths, properties, transforms, sizing,
  slot smoothing, FormulaShow and timing still run. This diagnoses raster plus
  compositing, not all Canvas command CPU. Intrinsic canvas resize remains part
  of normal sizing; initial allocation is not removed.
- no-detached-DOM suppresses only FormulaShow's **per-frame** detached-card note,
  chip, title, total, class and animation work. Constructor creation is retained.
  It preserves `latest`/`finished`, super.draw and actual research Canvas FX.
  A connected card remains untouched; token-result labels are never intercepted.

Node tests cover boundaries, real transformed FormulaShow with a fake DOM/Canvas,
attached-card safety, research-FX and bookkeeping preservation, combined runtime
omission behavior, summary invariants, and optional GPU-query lifecycle faults.
These tests do not establish real-browser operation or pixel equivalence.

## Measurements and artifacts

`build.json` records source, transformed modules and lock verification.
`browser/metadata.json` records provenance. Each case has a full raw `.json`, or
`.failure.json` with partial frames, SDK events, authoritative result, fixture
state and errors. `partial.json` survives later-case failure. `result.json`
contains paired baseline drift, phase summaries, and cross-case invariants.
Failures do not prevent later independent conditions from being attempted.

Every drawFrame records callback time/rAF timestamp and next-frame interval,
post-retime logical age, phase, slot, entire drawFrame JS CPU, inclusive show CPU,
whole GL-pass CPU, submitted/attempted per-layer 2D paint/clear counts, retimes,
audio schedule starts/restarts, and last show transition state. The separate
render hook records main/shadow GL draw counters and CPU submission spans.
Authoritative pose SHA-256, actual outcomes, contacts and complete cue schedules
must match across conditions. Completion is checked from actual SDK events and
results, with zero active rolls, no context loss and no render faults.

Phases are physics (<settled), settled-wait (<firstBeam), gathering
(<finalReveal), afterglow-fade (<finalBeamEnd + 0.28, including central fade), and
tail-hold (until diceExit). The final sampled frame is complete. Its missing
next-frame interval remains null, never zero. A next-frame gap belongs to the
phase of the frame preceding that gap.

All CPU times are submission-side and do **not** measure asynchronous GPU,
raster or compositor work. Show CPU includes 2D API calls and detached DOM;
it is not an exclusive pass budget. Instrumentation has nonzero overhead, equal
across A/B conditions; optional queries themselves can perturb a driver.
`DICE_PASS_GPU=0` disables GPU queries without disabling CPU counters.
When enabled, `EXT_disjoint_timer_query_webgl2` queries are read asynchronously,
only after availability. Disjoint/context loss/invalid nesting discard samples.
Missing extension, pending queries and discarded samples are explicit, never
reported as zero GPU work. The GPU intervals cover shadow rendering and the
remainder of WebGLRenderer.render after shadows, excluding the preceding region
and clear work. No finish, readPixels or getImageData enters timed animation.

No video or screenshots are captured. `DICE_PASS_TRACE=1` adds a separate baseline
20d6 case excluded from A/B comparisons; its first 10 seconds use CDP categories
`devtools.timeline,blink.user_timing,cc,viz,gpu`, low-frequency frame marks, and
ReturnAsStream to a gzipped trace. Trace overhead is explicitly separate. An
absent trace category is unknown, not evidence of zero cost.

## Local verification boundary

Syntax, transform tests, fake GL/DOM tests and build/asset checks can run locally.
The local environment prohibits Chromium AF_UNIX startup. Browser results remain
unverified until the authorized CI run. No permission bypass or local browser
launch belongs in this change.
