# First sketch outline program lifetime probe

Tools-only diagnostic, pinned to Suite `8e2cd6fd0fe969d36694338457e9e4d3428c1c00` and Web `46dd3287d11866bff057a428baeac9336c57a978`. Existing tracked baseline files, including all production code, assets, package/lock files, build adapters and existing workflows, must remain byte-identical. Installed Three 0.186.0 renderer/build bytes are also guarded.

The sole workflow runs only on `test/dice-outline-program-20261005`, in one read-only-token job. It builds the real SDK/controller/renderer and Jolt/WASM using the existing synthetic-host fixture. One fresh browser context and one Host execute exactly one first `ink_sketch` `1d6` roll. There is no warm roll, matrix, product patch, publication, or program-retention behavior. Current catalog has five skins; only sketch outlines are sampled. Retired comic/flowing/rune styles and resin are outside the inference scope.

## Evidence

The InitScript wraps the owning native WebGL prototype method once. A per-context/method depth guard avoids duplicate accounting when a WebGL2 override delegates to an inherited method. Each wrapper forwards the same receiver/arguments, returns the native value, preserves thrown exceptions, and performs no extra WebGL query. Program and shader IDs are object identities scoped to a context. `shaderSource` records the exact linked strings; analysis hashes and compares their full bytes, not merely a potentially colliding fingerprint. Native create/link/compile/delete ordering and CPU call durations are recorded. Existing `getProgramParameter` calls are passively aggregated by program and pname (calls, total/max CPU time, and the existing LINK_STATUS boolean result); there are no additional queries.

Checkpoints cover warm compile, render, the existing finish immediately before disposal, post-disposal, renderer ready, add start/prepared, first native roll draw, first native outline draw (also separately by shell/line role), first frame return after both outlines have naturally drawn, and natural roll completion. Native draw return is not GPU/display presentation. A warm material maps through `renderer.properties.has` and only then `get(...).programs/currentProgram`; unknown materials remain unmapped. Actual active outline draw attribution requires that native program to match the active decoration's Three currentProgram. Previously observed Three wrapper references retain its usedTimes/native-handle/listed state after disposal without recreating material properties. This JS observation does not retain GPU programs in Three's ownership cache.

Both shell and line programs are reported separately. A same-source recreation requires: fourteen prewarmed material owners, the last owner reaching usedTimes zero, actual native delete during the dispose window, absence from the live program list at ready, a different native identity created/linked after add starts, exact linked vertex/fragment source equality, successful LINK_STATUS observed from the production query, and a real nonzero native geometry draw of that mapped program. Browser console errors also fail the run.

No synchronous readPixels, fence, extra finish, forced compile, extra render, seed/time override, mesh visibility/culling override, screenshot, or video is inserted into the first-roll interval. A screenshot is taken only after the naturally completed roll. The renderer's two original initialization finish calls are unchanged. This probe intentionally is not a first-visible latency benchmark.

## Local verification and CI

Set `DND_CARD_WEB_ROOT` to the exact clean paired checkout (an untracked node_modules link is allowed). Run:

    node tools/dice-outline-program-sourceguard.mjs
    node --test tools/dice-outline-program-test.mjs
    npx tsc --noEmit -p extensions/workbench-dice3d/tsconfig.json
    node tools/dice-outline-program-build.mjs

Only the authorized CI environment should run the browser in this investigation:

    DICE_LATENCY_SOFTWARE=1 node tools/dice-outline-program-browser.mjs

Outputs under `.local-evidence/dice-outline-program/`: sourceguard.json, build.json, raw.json with source strings, result.json, after-complete.png; failure.json when possible. The workflow uploads JSON/PNG without publishing the runtime or changing the site.

Delete/create/link establishes WebGL object lifetime and submitted work. It cannot establish full GPU recompilation: drivers may retain internal shader caches. CPU call durations are submission costs only. SwiftShader, synthetic host and one sample limit applicability; no hardware-GPU, real-room, first-visible, other-skin or net-benefit claim is supported. Any program-retention candidate needs a separate authorized bounded A/B.
