# One bounded ground-fragment-mask experiment

CI-only diagnostics. Product source, asset files, clocks in timing, SDK, Jolt,
transport, cues, PCF math, output alpha/depth behavior and normal scissor remain
unchanged. No product patch, local browser, publication or production acceptance.

Source is locked to Suite `2e2ddb1f642e1375cffda45efad9584b33100008`, clean paired
Web `05dcfdb645339cac9f68d1f6009f44b7e63d5c25`, Three 0.186.0 and all 59 asset
hashes. The build records every product hash and the experimental tool sources.
The mask runtime/transform are separately owned `dice-ground-mask-*` files;
this harness owns only `dice-ground-mask-sequence-*`.

## Timing

Exactly one serial A/B/A per single 20d6, two-client 20d6 and single 1d20. Each
leg uses a fresh browser context and the same real fixed seed and roll ID. A is
the true original material/shader and original region collector. B installs its
shader before the product's EXISTING startup compile/warm draw. The harness adds
no warmup, FBO, extra render, cache, shader preparation, finish, screenshot,
readback or GPU query during timing. Product startup finishes remain unchanged
and their cost is included. There is no second exploratory round.

Cold navigation-to-ready uses the top page's navigation time origin and the
actual SDK-ready event timestamp; polling delay is separately labeled. Frame
records include the first actual rAF-driven draw, rAF interval P50/P95/MAX,
inclusive drawFrame CPU time, bounds CPU time, renderer submission CPU time,
draw calls, real wall time, retimes, eligibility, rectangle count and diagnostics.
Conservative fragment coverage is rectangle-union postprocessing after timing,
not measured GPU invocations or display presentation time. Authoritative Jolt
pose bytes, results and cue schedules must match A/B/A and both clients.

The following decision rules are fixed before running CI. Cold-ready, first CPU
submission (both submission-to-first and release-to-first), or actual rAF MAX
above the two baselines' mean rejects the direction even when P95 improves.
FirstSubmitted is a CPU submission boundary, not the display's first visible
frame. A separate newly observed JS/driver blocking guard rejects only when the
candidate drawFrame wholeJsMax is strictly greater than 50 ms AND strictly greater
than BOTH baseline wholeJsMax values. This is observed JS/driver submission
duration, not a measured browser LongTask entry.

Net experience benefit requires BOTH real release-to-completion wall time and
rAF P95 strictly below their baseline bracket means. Total JS time need not drop:
smoother playback can draw more frames, and CPU bounds work may trade against
GPU/frame latency. Total JS and JS MAX deltas remain explicit costs, with any
increase marked for review. No whole-system energy or GPU-cost reduction is
claimed. One noisy round can reject but cannot establish production acceptance.
All samples and first outputs remain in the evidence; no outlier deletion.

## Separate strict correctness

A fresh original→original real seed-2 clamp calibrates the explicitly disclosed
Canvas2D hint. Only correctness contexts request `willReadFrequently: true`, only
for the real cue-canvas/research-effects canvases at their FIRST context creation.
Timing, glyph canvases and product sources keep defaults. Prior default readback
showed 19 one-byte RGB differences between original→original first outputs. This
hint is not proof of the browser backend. First output is preserved and every
RGBA channel still has ZERO tolerance.

Candidate is always first, followed by the true original-material bypass at the
same real pose. No hidden warmup or shader branch inflated baseline. Tests cover
moving and settled poses, 29 prior mutations, fractional DPR, real viewport
resize, actual context loss/restore, real clamp FX, empty frames, a new real roll,
and 65 real bodies exceeding the fixed 64-rectangle cap. Every matched normal
pair also requires identical draw calls. Unknown FX and overflow must fall back to the full original PCF formula.
Candidate fallback may retain its warmed shader with mask-valid=false; evidence
distinguishes branch-disabled-original-formula from original-material, and strict
reference always uses the TRUE original shader. No overflow caster is truncated.

The independent depth witness finds a receiver point inside the normal scissor
but outside every mask rectangle. AFTER the ordinary frame, a separate scene
renders a small magenta plane 0.1 world units behind the ground, with autoClear
false and scissor disabled. It never enters mask eligibility. Candidate and
original must leave the full image unchanged and match each other. Temporarily
setting BOTH ground materials' depthWrite=false must make the witness visibly
magenta at its center. This distinguishes alpha-zero depth writes from discard.
Readback, PNG capture and this extra probe pass exist only in correctness.

## Offline commands (no browser)

Run with the reviewed runtime and transform present beside this harness:

```sh
DND_CARD_WEB_ROOT=/path/to/exact-web node tools/dice-ground-mask-sequence-tests.mjs
DND_CARD_WEB_ROOT=/path/to/exact-web node tools/dice-ground-mask-sequence-build.mjs
```

## Minimal CI job fragment

Parent owns branch creation and publication. No triggers, merge or deploy here.
The browser runner refuses unless CI=true; do not set CI locally to bypass that
restriction. Default outputs are `.local-evidence/dice-ground-mask-sequence/`.

```yaml
ground_mask_sequence:
  runs-on: ubuntu-latest
  timeout-minutes: 40
  permissions:
    contents: read
  env:
    DND_CARD_WEB_ROOT: ${{ github.workspace }}/.paired-web
    DICE_GROUND_MASK_SEQUENCE_ROUNDS: 1
    DICE_GROUND_MASK_SEQUENCE_SOFTWARE: 1
  steps:
    - uses: actions/checkout@v6
      with:
        fetch-depth: 0
        persist-credentials: false
    - uses: actions/checkout@v6
      with:
        repository: FullPeople/DND-card-web
        ref: 05dcfdb645339cac9f68d1f6009f44b7e63d5c25
        path: .paired-web
        persist-credentials: false
    - uses: actions/setup-node@v4
      with:
        node-version: 22
    - run: |
        npm ci
        npm --prefix .paired-web ci
        npx playwright install --with-deps chromium
    - name: Offline boundaries and build
      run: |
        node --check tools/dice-ground-mask-sequence-browser.mjs
        node tools/dice-ground-mask-sequence-tests.mjs
        node tools/dice-ground-mask-sequence-build.mjs
    - name: One exploratory sequence and strict pixels
      run: node tools/dice-ground-mask-sequence-browser.mjs
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: dice-ground-mask-sequence-${{ github.sha }}
        include-hidden-files: true
        retention-days: 7
        path: |
          .local-evidence/dice-ground-mask-sequence/results/
          .local-evidence/dice-ground-mask-sequence/runtime/ground-mask-sequence-source.json
```

This host emulates the real SDK boundary; it is not a real Owlbear room, network,
phone, hardware-GPU validation, or performance guarantee. A strict mismatch,
initialization failure, first-use hitch, unsupported positive control or lack of
net benefit is recorded as rejection, not a reason to expand this experiment.

Single-die control is not required to improve: it retains every cold/first/actual-MAX/new-JS-block guard, additionally rejecting P95 above BOTH adjacent baseline values. This is a predeclared no-regression control, not proof of stable equivalence. The 20-dice targets still require lower wall time and P95.
