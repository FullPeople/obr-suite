# Strict Canvas2D visual/lifecycle gate

Test-only fixture for the two prospective 2D optimizations. It never edits product source and does not measure performance.

## Pins and fail-closed boundary

- Baseline is immutable `2e2ddb1f642e1375cffda45efad9584b33100008`.
- Candidate defaults to `HEAD`, immediately resolved to its full commit SHA. `DICE_CANVAS_CANDIDATE` can instead supply an explicit full SHA. A short SHA, missing git object, baseline-only candidate, unknown product change, or unreviewed product blob fails before building/launching.
- Reviewed candidate identity is the exact three product **Git blob IDs**, not the original local commit ID. Recreating the reviewed commits through an API/CI checkout therefore works. Both the empty-effects-only state and the combined dirty-layer state are accepted; adding a new implementation requires deliberate review and updating `REVIEWED_BLOBS`.
- `build.json` records actual checkout HEAD, resolved candidate SHA, all three product blob IDs, SHA-256 of every loaded baseline/candidate source, and pinned asset hashes.
- Every relative production dependency is read with `git show` from its side's pinned revision. Missing imports cannot fall back to the working tree. TypeScript syntax is transpiled; product branches/expressions are not transformed. Both revisions run in the same page and Chromium build.
- The checkout must contain full baseline and candidate history. No network fetch is performed by these tools.

## Build and Node checks (no browser)

From the Suite checkout, with its existing dependencies installed:

```sh
# On an integrated reviewed candidate checkout, no override is needed.
export DICE_CANVAS_CANDIDATE=HEAD
node --test tools/dice-canvas-visual-*.test.mjs
node tools/dice-canvas-visual-build.mjs
node --check tools/dice-canvas-visual-browser.mjs
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck \
  --target ES2022 --module ESNext --moduleResolution bundler --allowJs \
  --lib ES2023,DOM,DOM.Iterable tools/dice-canvas-visual-runtime.ts
```

On the original independent diagnostic worktree, select the local candidate explicitly:

```sh
export DICE_CANVAS_CANDIDATE=bc540f722f2bec431443d09c45fd0ec284466e6e
```

The 15 Node tests cover source pin/closure rejection, exact RGBA comparison (including one-LSB and transparent RGB differences), and actual production parsing/evaluation of all ten formula fixtures. They do not prove browser rendering correctness.

## Browser gate (run only on a browser-capable runner)

Install the locked Playwright Chromium through the normal CI setup, then:

```sh
node tools/dice-canvas-visual-browser.mjs
```

Defaults: all 24 cases at actual browser DPR 1 and 2. The resize case changes actual Chromium device metrics on the same live surfaces through DPR 2, 1.25, and 1. The final gate exits nonzero for a failed invariant, screenshot difference, page error, request failure, or launch failure. Build and runner must select the same candidate.

Optional environment variables:

- `DICE_CANVAS_BUILD`: build directory, default `.local-evidence/dice-canvas-visual/runtime`
- `DICE_CANVAS_EVIDENCE`: browser evidence directory, default `.local-evidence/dice-canvas-visual/browser`
- `DICE_CANVAS_DPRS`: comma-separated values from `1,1.25,1.5,2`, default `1,2`
- `DICE_CANVAS_CASES`: comma-separated exact case IDs, for diagnosis only; a subset is marked `fullMatrix: false`
- `PLAYWRIGHT_EXECUTABLE_PATH`: optional existing Chromium executable

No browser was launched in the restricted authoring environment. Its known AF_UNIX restriction is not bypassed. Local build/type/Node results and a future browser result must be reported separately.

## What is compared

The real production `FormulaShow`, `CueRenderer`, shared overlay allocator, formula parser/evaluator, cue builder and rule-timeline builder are used. Production `research.css` and all seven chip images are pinned to the baseline. The supported optimization does not alter those assets/styles.

- Detached scene containers receive explicit viewport dimensions; these getters replace unavailable detached layout, not canvas behavior. Each surface is a real browser Canvas2D with its actual backing size and context state.
- Both sides receive identical deterministic physical outcomes and recorded diagnostic pose/hop samples. These samples are not Jolt/real-room evidence. No authoritative result, card mutation, or moving-slot update is omitted.
- Every scheduled 60 Hz replay frame, plus exact before/at/after cue boundaries, compares **all RGBA channels with zero tolerance**. Absent effects layers normalize to transparent pixels at the other side's exact backing extent. Existing surfaces must have matching dimensions.
- Every frame records both RGBA SHA-256 hashes, changed-pixel/channel counts, maximum channel delta, alpha coverage, actual card DOM hashes, and both moving-slot positions. Formula/cue plans are also checked for equality.
- Each sequence captures separate baseline/candidate/diff PNGs for both layers and the browser's DOM composition. The same DOM tree and surfaces are temporarily mounted at the same location, then detached again. Research cards are shown in appropriate formula cases; Suite-style detached cards retain their actual state but are not inserted just for a screenshot.
- Screenshot comparison is also zero tolerance, using decoded RGBA. Playwright settles finite CSS/WAAPI animations only for these composition snapshots; animation timing is not tested. The diagnostic replay clock controls slot interpolation equally on both sides and is not a product timing change.
- Final clear and pending-peer frames independently require zero nontransparent pixels on both sides. Final release requires no remaining canvas elements. This guards against an equal ghost on both sides passing the A/B comparison.

## Coverage

Formula cases: `plain-20d6`, `maximum-impact`, `advantage-discard`, `disadvantage-natural-one`, `reroll`, `sequential-clamps`, `same-value`, `burst`, `arithmetic`, `repeat-overlap`.

Lifecycle cases:

- `shared-cue` and `shared-effects`: multiple same-frame contributors; one surface per kind; duplicate release; old painted roll leaves while surviving owner has not started; new replay after all refs release
- `anchors`: missing/moving/disappearing anchors and zero appearance
- `resize-dpr`: live container dimensions and actual browser DPR changes
- `independent-containers`: one scene painting/releasing while another remains pending
- Eight `exception-{cue-canvas|research-effects}-{before|after}-{paint|clear}` cases: instrument one actual native primitive with a synchronous exception before or after execution; remove the wrapper; compare partial output, retry clear, retry paint, and final release
- `synthetic-context-events`: a previously clean layer, actual backing-store reset, diagnostic magenta sentinel paint, explicitly synthetic `contextlost`/`contextrestored` events, and retry that must clear the sentinel

There is no standard Canvas2D force-loss API used here. Synthetic events have `isTrusted: false`; `isContextLost()` is recorded where present. The report explicitly says **genuine context loss/restoration was not induced or verified**. Do not describe this test as real context restoration.

## Evidence and interpretation

Upload the entire browser evidence directory even on failure. It contains build/runner metadata, per-case JSON, a progressively written `partial.json`, final `result.json` (or `failure.json`), and PNG triples. A failing frame captures available pixel evidence before ending its case; other cases still run.

A full pass proves strict equality for the specified Chromium/DPR/fixture matrix only. It does not establish visual identity on all browsers/platforms, real-room end-to-end behavior, genuine context-loss recovery, full animation timing, physics, audio, WebGL, GPU cost, or lower latency. Readback and screenshots perturb rendering; use the separate uninstrumented performance gate for any speed claim.
