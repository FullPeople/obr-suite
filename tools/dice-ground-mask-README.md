# Tools-only ground fragment mask probe

Base Suite: `2e2ddb1f642e1375cffda45efad9584b33100008`. Paired Web: `05dcfdb645339cac9f68d1f6009f44b7e63d5c25`.

This is a bounded experiment, not a product patch. No production file, render resolution, 2048 PCF map, antialiasing setting, render-call count, target, texture, warm render or GPU barrier is changed. The only new render resource is the candidate ground material/program and its uniforms. No cache, FBO or tiled scene rerender is used.

## Build / harness boundary

Add `groundMaskTransform()` from `tools/dice-ground-mask-transform.mjs` as a Vite pre-plugin. Select `globalThis.__diceGroundMaskMode = 'baseline' | 'candidate'` before constructing the renderer. Default is baseline.

- Baseline uses the untouched original `DiceRenderRegion` and original ground material/shader. It never installs a shader hook. Timings must use separate baseline/candidate contexts.
- Candidate installs its same-state material clone before the existing `compileAsync`, warm render and finish. Those exact existing calls remain unchanged. The original material is retained without a mask hook.
- `globalThis.__diceGroundMask.setEnabled(false)` disables the mask branch but retains the candidate shader. This is a correctness control, not the timing baseline.
- `setOriginalMaterial(true)` selects the real original shader and copies current ordinary material properties/callbacks for fair pixel comparison. `false` restores the candidate and returns the former selector. Externally replaced materials remain untouched. These toggles can compile a reference variant and must not be used in baseline timing or before first-visible measurements.
- `snapshot()` exposes mode, installation, current eligibility/reason, fallback kind/retirement, enabled/original selector, active rectangle count, logical `rects` (`{x,y,width,height}`), `physicalRects` (`[x,y,right,top]`), compile count and actual masked-material ground draw count. Uniforms and both material references are public for correctness-only negative/depth controls.
- Main frame still ends with `withRenderRegion(this.gl,groundMaskRegion,()=>{this.gl.render(this.scene,this.camera);});`. Inclusive CPU bounds cost includes `renderRegion.get` plus `groundMask.update`, not just uniform writes. Instrumentation must not replace the renderer's own methods or mutate material callbacks.

## Conservative geometry and fallback

The source transform preserves the original region module as an exact prefix. It appends an instrumented clone with exact-match source boundaries. That clone collects a body-plus-shadow rectangle from the same projected points used by the original global region; it never repeats bounds work and never shrinks to shadow-only or relies on a final pose. Each rectangle uses the original PCF/bias/normalBias world padding and original `4 + 2 / pixelRatio` screen padding. Physical coordinates round outward. The union's global bounding rectangle is asserted equal to the original result across current pose, parent transform, camera, light, presence and multi-body transitions.

Collector validity, rectangles and lights reset at every `get` entry. Only a successful complete calculation publishes bounds. More than 64 bodies disables the mask without trimming. A cached Three GPU fragment-uniform budget of at least 64 + 128 vectors and the exact native two-directional/one-hemisphere topology is required. Unsupported topology or render/material state routes to the original material with current state preserved; external replacement material is never overwritten. Unsupported collection conditions leave zero active rectangles and execute original shader math. The extra guard shares the existing scene traversal.

The guard admits native current transforms/poses and rejects unproved state: other casters, unknown drawables, geometry changes, skinned/morphed/instanced/displaced casters, custom draw/shadow callbacks, changed receiver transform, nonblack receiver color, nonfinite properties, fog/background/override material, wrong target/viewport/color pipeline, camera/layer changes, nonstock shadow-camera projection/methods, stale-map autoUpdate settings, nonsquare/non2048 PCF maps or altered PCF filtering/wrapping. Native first-allocation shadow-camera projection is recognized because Three updates it inside the existing first warm render.

If context restoration begins while a true-original/external fallback is active, that instance conservatively retires its candidate mask. Its existing restoration compilation covers the current original material, and later eligibility cannot silently compile the candidate on a visible frame. `setEnabled(true)` and `setOriginalMaterial(false)` cannot undo retirement. Normal candidate restoration uses the unchanged existing compilation and no added render/barrier.

## Alpha and depth semantics

The injected condition appears after the unchanged log-depth chunk and before `getShadowMask`. Interior shader source is unchanged byte for byte. Outside the proved union, the native black ShadowMaterial's original result is transparent black under native ACES/SRGB and no fog; the candidate writes the same `vec4(0)` and returns. It does **not** discard, disable the mesh, or change depthWrite/depthTest/blending. Thus ordinary fragment depth is still written exactly where the original transparent receiver writes it. This source-level argument still needs a real GPU depth witness and strict RGBA checks; Node tests cannot establish those.

## Local validation

- `node tools/dice-ground-mask-selftest.mjs`: 13 Node checks, including baseline identity, native pre-warm installation, exact original interior GLSL, 120 randomized 20-body union comparisons, all-entry invalidation, recovery, 64/65 capacity, fractional DPR, unsupported-state fallback, current material/callback preservation and native PCF sampling guards.
- `node tools/dice-render-region-selftest.mjs`: existing 18 checks and 88,694 actual-model contained sample points.
- `node_modules/.bin/tsc --ignoreConfig --noEmit --skipLibCheck --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2023,DOM tools/dice-ground-mask-runtime.ts`: focused runtime typecheck.

Actual GPU/browser validation is centralized in CI. The separate sequence harness owns strict candidate-first RGBA, moving/birth/exit/hop/new-roll/resize/unknown transitions, alpha-zero/depth witnesses, warm-shader draw proof, cold-ready/first-visible costs and complete frame timings. This probe is not accepted merely because steady fixed-pose ground work decreases. Any strict-pixel failure, startup/first-visible regression or lack of net whole-frame gain rejects this bounded candidate; no further cache/prewarm/tile expansion is implied.
