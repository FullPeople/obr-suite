# CI-only live ground-alpha experiment

This is an isolated diagnostic, not a product optimization or acceptance claim.
Only new `tools/dice-ground-sequence-*` files are owned by this harness. It consumes
`tools/dice-ground-live-runtime.mjs`, supplied and reviewed separately.

## Source and trust boundary

`dice-ground-sequence-build.mjs` refuses tracked product changes from Suite
`2e2ddb1f642e1375cffda45efad9584b33100008` and refuses a paired Web checkout other
than clean `05dcfdb645339cac9f68d1f6009f44b7e63d5c25`. It records SHA-256 hashes
for every product file and the separate experimental runtime. Instrumentation is
applied in memory by Vite; no production source file, asset, configuration or
clock is written. Its exact transform markers fail closed when the source moves.

The cache trust registry comes only from real `renderer.init()` warm meshes,
created by the hash-verified built-in factories, before their disposal. It
captures sketch material-hook identities, exact decoration shader strings and
factory geometry references. It never promotes arbitrary live-scene hooks to
trusted status simply because they exist. Three, SDK, Jolt, original cues,
transport, physics trajectories and render-region implementation remain real.

The host emulates the Owlbear SDK messaging boundary. This is not a real Owlbear
room, real internet latency, a phone, a device-wide GPU benchmark, or a production
end-to-end acceptance test.

## Timing phase

For each round, run these serial cases in a fresh browser context for EACH leg:

1. Single-client 20d6: baseline-before, cache, baseline-after.
2. Two-client 20d6: baseline-before, cache, baseline-after.
3. Single-client 1d20 control: baseline-before, cache, baseline-after.

The request ID, seed, viewport, theme and expression are identical across A/B/A.
The two clients communicate through the real SDK/transport with a 10 ms
simulated one-way delivery delay, which is recorded rather than asserted as
exact. Clients render concurrently inside that case; cases and modes do not.
Jolt byte hashes, physical counts/results, births/clamps and relative cue
schedules must match across A/B/A and both clients. Absolute starts and retimes
are recorded; elapsed animation duration is not forced to a nominal schedule.

Default threshold is **20 effective casters**, stableFrames 3. The single-die
control cannot build/hit. One round is exploratory; request three rounds via
`DICE_GROUND_SEQUENCE_ROUNDS=3` for repetition. This runner does not demand a
speedup. A slowdown, few hits or no timing hits is valid evidence; the separate
correctness positive control must prove a hit on real 20d6.

The normal timing phase performs no screenshots, videos, pixel readback,
`gl.finish`, or GPU timestamp queries. The renderer's normal startup may already
use `finish`; it occurs before submission. The runtime initializes a GL-state mirror and checks framebuffer/GL state on
cold construction; its cost is included. Hot-hit synchronous GPU-query counters
must remain empty. The final empty frame must free the sole retained target. CPU driver submission and software-GPU/CPU
contention are not presented as GPU execution or display presentation.

Reported per client:

- Actual submission, release, first submitted frame, renderer completion event,
  and final completed drawFrame timestamps.
- Frame interval median/p95/max, whole drawFrame JS median/p95/max and summed JS.
- Real release-to-final-frame and submission-to-final-frame wall times, including
  cold cache construction/compilation and any retiming that those costs cause.
- Full runtime per-frame records: signature, build, compile, render and total
  submission costs; invalidations, hit/build/fallback counts and allocation peak.
- Actual authoritative pose SHA-256, result payload, starts, retimes and schedules.

The full build frame stays in the frame samples and wall-clock denominator. No
warm-up builds, dropped outliers, theoretical amortization or readback-derived
speed estimates are substituted for real animation results.

## Separate strict correctness phase

A new context freezes only its test clock and RAF. Every step first draws the
candidate as it stands, reads RGBA, then draws the original through a synchronous
`withOriginal` bypass that does not invalidate, rebuild or destroy the candidate
cache. Comparison is strict zero tolerance on ALL RGBA channels and also all
2D cue-canvas channels. PNGs are preserved only in this phase. This avoids an
original-first reference pass silently repairing stale candidate state.

The verifier exercises real falling and settled poses, a mandatory 20d6 hit,
a zero-cached-alpha negative control that must itself hit and change visible
pixels, recovery after that control, and first/stable/restored outputs for:

- Body position, presence, hidden parent, caster toggle and layers.
- Main camera world transform, projection/zoom and layers; scene transform.
- Light transform, target, intensity; shadow intensity, bias, normalBias, radius,
  resolution, numeric frame extents/viewport and explicit shadow-map disposal.
- Ground opacity, transform, position/normal/index attribute versions.
- Non-full viewport, DPR, same-size canvas backing-store reset and clear state.

It then exercises actual browser viewport resize, a true `WEBGL_lose_context`
loss and restoration through the product's own listeners, normal result cues,
empty final frames and a new real roll in the same renderer/cache instance.
A separate seed-2 `max(2d6,6)` roll must contain an actual clamp episode and refuse
cache hits while its 3D rule FX are visible. Correctness uses minBodies 1 for this
specific safety test; it does not extend timing/performance eligibility to 1 die.

Unknown or unsupported mutations may reject caching and render normally. Such
fallback must still be pixel exact. A pixel mismatch never receives a tolerance
allowance. A genuine Three render/compile JS interruption is a fatal fixture
failure (`requiresRendererRecreation`), not a safe restored fallback; the context
is terminated and diagnostics preserved. The runtime cannot prove restoration
of Three's private interrupted render stacks.

## Explicit remaining borders

This deliberately bounded fixture does not certify arbitrary shader hooks,
custom materials, manual matrices, new lights/cameras, foreign render targets,
other Three versions, arbitrary extreme aspect ratios, every asset/theme,
multiple GPUs, Safari/Firefox, real room networking or arbitrary internal Three
exceptions. Those are unsupported/rejected by the runtime where detectable,
not blanket product guarantees. Audio is real but waveform equality is not
measured. RGBA checks cover WebGL and 2D cue canvases, not browser compositor
text antialiasing or display scanout. PNG exports themselves are not timing data.

## Commands

Run offline checks and build (no browser):

```sh
DND_CARD_WEB_ROOT=/path/to/exact-web node tools/dice-ground-sequence-tests.mjs
DND_CARD_WEB_ROOT=/path/to/exact-web node tools/dice-ground-sequence-build.mjs
```

Only authorized CI may run `node tools/dice-ground-sequence-browser.mjs`.
The script refuses unless `CI=true`. Do not set that variable to bypass local
browser restrictions. Default output is
`.local-evidence/dice-ground-sequence/results/result.json` plus correctness PNGs.

## Minimal job fragment for parent integration

This fragment does not define a branch trigger, publish, merge or deploy action.
The parent owns publication and monitoring. Use a new diagnostic-only branch.

```yaml
ground_live_sequence:
  runs-on: ubuntu-latest
  timeout-minutes: 35
  permissions:
    contents: read
  env:
    DND_CARD_WEB_ROOT: ${{ github.workspace }}/.paired-web
    DICE_GROUND_SEQUENCE_ROUNDS: 1
    DICE_GROUND_SEQUENCE_MIN_BODIES: 20
    DICE_GROUND_SEQUENCE_SOFTWARE: 1
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
    - name: Install exact dependencies and official Chromium
      run: |
        npm ci
        npm --prefix .paired-web ci
        npx playwright install --with-deps chromium
    - name: Offline runtime and harness checks
      run: |
        node --check tools/dice-ground-sequence-browser.mjs
        node tools/dice-ground-live-runtime.test.mjs
        node tools/dice-ground-sequence-tests.mjs
    - name: Build hash-verified real SDK and Jolt fixture
      run: node tools/dice-ground-sequence-build.mjs
    - name: Serial A-B-A timing and separate strict dynamic pixels
      run: node tools/dice-ground-sequence-browser.mjs
    - name: Preserve complete diagnostic evidence
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: dice-ground-live-sequence-${{ github.sha }}
        include-hidden-files: true
        retention-days: 7
        path: |
          .local-evidence/dice-ground-sequence/results/
          .local-evidence/dice-ground-sequence/runtime/ground-sequence-source.json
```

For three rounds, increase the CI job timeout to 60 minutes. No performance
threshold is an acceptance gate; exact pixels, exercised controls, real trace
identity and absence of fatal fixture faults are.


## Investigating first-read Canvas2D instability

CI run 37196413964 on bbd03c2 completed nine timing legs and reached the real
seed-2 clamp with zero WebGL differences and zero cue-canvas differences. The
first research-effects pair differed in 19 RGB channels by one byte; alpha was
identical. The runtime took the original fallback (`unknown body child`), with
zero builds and zero hits in that context. This does **not** establish that the
cache caused the difference, nor prove an internal browser backend switch.

The 2D rule-label draw happens before the WebGL runtime interception. The first
`getImageData` lies between the two equal-age drawings. A first-read or rendering
backend effect is a falsifiable hypothesis, not an accepted explanation.

For the next authorized CI diagnostic, use:

```sh
DICE_GROUND_SEQUENCE_MODE=clamp-diagnostic node tools/dice-ground-sequence-browser.mjs
```

This short mode creates four fresh real seed-2 clamp contexts:

1. Default Canvas2D creation, disabled cache, original bypass → original bypass.
2. Default Canvas2D creation, candidate first → original bypass.
3. Explicit `willReadFrequently: true`, disabled cache, original → original.
4. The same explicit hint, candidate first → original bypass.

Each context records three consecutive pairs. Pair zero contains its FIRST
output: there is no preparation draw, discarded read, hidden warm-up or
replacement of a failing first output by a later stable frame. Any mismatch
keeps `pass: false`; diagnostic mode collects the remaining evidence and then
fails the job if any pair differs. It also verifies real clamp FX, zero cache
builds/hits, unchanged logical canvas inputs and the same authoritative trace
across contexts. The hint is not proof of the browser's internal CPU/GPU backend.

Every differing 2D surface now exports candidate and reference PNGs made directly
from the exact observed RGBA bytes with a lossless Node PNG encoder. No extra
Canvas2D redraw/re-encoding can erase a translucent one-byte difference. The
report includes raw-RGBA SHA-256, context attributes, individual channel counts,
first differing pixels and logical draw inputs. PNG bytes have an independent
Pillow decoding test, including the actual [20,33,43,78]/[20,33,42,78] counterexample.

`DICE_GROUND_SEQUENCE_MODE=correctness-only` skips timing but retains the complete
strict sequence. The default is still `full`, with normal Canvas2D creation.
Only an explicitly configured correctness context may use
`DICE_GROUND_SEQUENCE_2D_READBACK=frequent`. That option affects only cue-canvas
and research-effects at their FIRST getContext; glyph textures, WebGL and all
normal timing contexts remain unchanged. Reports identify this boundary and do
not claim equivalence to the unmodified browser backend. No hint becomes the
accepted default merely because it makes a failing comparison pass.

A short diagnostic or correctness-only pass is never a full-suite pass. After
the cause and any legitimate fixture policy are established, rerun the entire
A/B/A timing and strict sequence. Zero RGBA tolerance and the real FX assertions
remain mandatory in all modes.
