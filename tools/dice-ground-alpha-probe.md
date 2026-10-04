# Ground alpha cache: diagnostic feasibility probe

This is an isolated fixed-pose experiment on baseline
`2e2ddb1f642e1375cffda45efad9584b33100008`. It changes no product files,
adds no product flag, and does not implement persistent caching or an invalidator.
No push, merge, deployment, or local Chromium launch is performed by these files.

## Call from the existing browser evaluator

The regular diagnostic build already exposes `__diceProfileRenderer` and
`__diceProfileThree`. Import `probeGroundAlphaCache` from this module in the Node
runner, and pass it directly to `overlay.evaluate(probeGroundAlphaCache,
{samples:5,warmup:2})`. The function is self-contained and serializable.

Before calling, in that overlay:

1. Wait for an active roll, cancel its `frameHandle`, and set it to zero.
2. Set `r.projection.pixelsPerDie=r.targetPixelsPerDie` and call `r.layout()`.
3. Set `window.__diceProfileTime=r.active[0].start+age*1000`, with `age` before
   `cue.diceExit`. Leave the product shader and conservative scissor untouched.
4. Save returned JSON with scenario/theme/age/seed/browser/GPU metadata.

Suggested first cases: `ink_sketch/20d6`, `royal_ember_resin/20d6`, and a 1-die
control at age 1.5, then stage calibration and DPR 1.5. A moving-phase pose at .6
is useful for coverage, but remains frozen during each probe. Unknown rule FX
must return a rejection, not silently bypass a drawing layer.

For a Node-runner example:

    import {probeGroundAlphaCache} from './dice-ground-alpha-probe.mjs';
    await overlay.evaluate(age => {
      const r=window.__diceProfileRenderer;
      cancelAnimationFrame(r.frameHandle);r.frameHandle=0;
      r.projection.pixelsPerDie=r.targetPixelsPerDie;r.layout();
      window.__diceProfileTime=r.active[0].start+age*1000;
    },1.5);
    const result=await overlay.evaluate(probeGroundAlphaCache,{samples:5,warmup:2});

The caller owns restarting RAF/clock if it wants to continue using the fixture.
Use a fresh/disposable diagnostic browser context. The function restores render
configuration/materials and disposes its resources; on rejection it may leave
the last diagnostic image in the drawing buffer until the next original draw.
The production reference material is rendered and compared before any success.

## Exact experiment

- Original `drawFrame()` sets the fixed real pose, builds the shadow map, and
  preserves the existing production scissor, geometry, depth and transparent
  ordering. The reference must be nonempty and every warmed baseline must be
  byte-stable.
- Global and per-light shadow `autoUpdate` and `needsUpdate` are held false only
  after the existing map has been built. No resolution/filter change is made.
- One full-drawing-buffer, **single-sample R32F** target is cleared to zero.
  Only the original ground is drawn into it, with the original camera/world
  transform and lights/map. Its capture clone is white, has the original opacity
  and NormalBlending, and disables tone mapping/fog. Thus R becomes intrinsic
  fragment alpha, without color encoding or resolved MSAA coverage. Three r186
  also disables renderer tone mapping for an ordinary render target; the explicit
  flag avoids relying on that implicit special case. The cache has NoColorSpace.
- The Float32 readback uses the implementation's legal RED/FLOAT or RGBA/FLOAT
  path. The latter is only a verification readback: storage remains R32F. Neither
  RGBA8 nor half-float fallback is allowed. Float blending support is required
  separately from float renderability. Target framebuffer completeness and GL
  errors are checked.
- The original scene keeps the **same ground object/geometry/world transform,
  material type, black color, opacity property, depth flags, blending,
  transparent ordering and default-framebuffer MSAA**. Only a cloned
  ShadowMaterial's alpha expression is replaced by nearest `texelFetch` of R at
  `ivec2(gl_FragCoord.xy)`. Fragment shadow-map/mask chunks are removed so the
  hit path does not execute PCF. Its harmless gain uniform stays one for timing.
- Shader compilation and actual ground draw callbacks are counted. Setting
  only the fetched-alpha gain to zero must visibly change the RGBA image; then
  gain one must restore every byte. This rejects an unexercised cache/empty
  shadow, even when a casual A/B comparison would look equal.
- No hardware GPU-time claim is made. Baseline and hit each include complete
  product `drawFrame()` plus `gl.finish()` and full RGBA synchronous readback.
  Build timing includes capture and Float32 readback; first-hit compilation is
  reported separately. A conservative amortization estimate includes both.

## Why MSAA remains a rejection risk

The cache stores intrinsic per-fragment alpha, **not** a resolved multisample
shadow image, so the original geometry's hit draw supplies coverage only once.
However, single-sample capture can miss an edge pixel whose center is outside
its triangle while some default-framebuffer samples are covered. Fragment
interpolation/invocation placement can also differ by implementation. There is
no assumption that the two rasterizers match: any changed RGBA byte rejects the
candidate. Transparent resin composition must pass the same exact test. The
report includes per-channel counts and first differing pixel coordinates.

A passing fixed pose is evidence only for that scenario/GPU. It is not proof of
portable MSAA equivalence, animation correctness, or production readiness.

## Hard rejection / invalidation boundaries

Reject on unsupported extensions/framebuffer/readback, pre-existing GL errors,
custom ground hooks, unknown visible drawables/FX/lights, multiple ShadowMaterial
grounds or shadow-casting lights, fog/background/override/clipping, view offsets,
non-full viewport, XR, missing maps, empty/nonfinite/out-of-domain alpha,
unstable baseline, inactive cache path, any RGBA-byte mismatch, any state
restoration failure, or non-positive median whole-frame saving. No tolerance
increase, precision downgrade, or reinterpretation of a failed probe is allowed.

This probe compares current pose/camera/light/ground identities and matrices
between repeated frames, but does **not** implement a production invalidator.
A real cache would need to invalidate on at least caster geometry/deformation,
world transform/presence/material shadow behavior, shadow-map content/version,
all relevant light transforms/parameters, shadow camera/matrix/filter/bias,
ground geometry/world transform/material/opacity, viewport/target/drawing size,
DPR, camera/view/projection, scene ownership/FX, and context generation. A lost
or restored context rejects this run; cached render targets must never be
reused across restoration. A separate first-restored-frame test would still be
required for any later persistent implementation.

R32F color storage is `width*height*4` bytes (4.096 MB at 1280x800); the diagnostic
capture also allocates a depth attachment. Do not mistake `colorBytes` for total
GPU allocation. Capture compilation/build/readback may erase the benefit when
poses do not remain reusable long enough.

## Local checks (no browser)

Run `node --check tools/dice-ground-alpha-probe.mjs` and
`node tools/dice-ground-alpha-probe.test.mjs` after installing the existing repo
dependencies. In this diagnostic worktree, tests can resolve the already
installed baseline dependencies read-only with:

    DICE_GROUND_ALPHA_PACKAGE_JSON=/workspace/shared/suite-dice-latency-recovered/package.json node tools/dice-ground-alpha-probe.test.mjs

The ten tests use real Three classes/shader source and a mocked GL renderer
for success/negative control, byte mismatch, inactive cache, missing float
blend, incomplete target, empty capture, unknown drawable, initially invisible newly admitted dice, unexpected renderer exceptions, and active RAF. PNG capture and rejection/infra classification are also checked.
These are control-flow checks only. Actual pixel/latency verification is
explicitly pending the parent's authorized CI browser run.

## Minimal real-browser runner

`node tools/dice-ground-alpha-browser.mjs` uses the existing diagnostic build and
SDK host fixture. It launches three fresh single-client contexts: ink_sketch
1d20/seed 7, ink_sketch 20d6/seed 7, and max(2d6,6)/seed 2. Every case samples
timeline-derived settled and active-beam gathering phases. The formula case
also samples its real clamp midpoint and must observe visible vortex/depth-mask
geometry and a specific unsafe-drawable rejection. Phases run chronologically.

Outputs go to `.local-evidence/dice-ground-alpha/` by default, overridable by
`DICE_GROUND_ALPHA_OUT`. They include per-pose JSON, partial/final reports,
original fixture PNGs, and (when reached) reference/cache-hit/negative-control/
restored PNGs. Byte equality still uses raw RGBA arrays; PNGs are inspection
artifacts only. The cache retains Float32 storage throughout.

A completed experiment writes `success:true` even when every candidate is
rejected for missing float support, pixel mismatch, or no benefit. It always
writes `cacheAccepted:false`: successful fixed-pose results are not production
acceptance. Missing SDK/Jolt data, invalid/empty original frames, unstable
baselines, unexpected JavaScript/probe exceptions, failed cleanup, or failure
to exercise a real clamp make the runner exit nonzero and write `failure.json`.
Console errors are preserved separately because an expected unsupported GPU
path must not be relabeled a fixture failure. See the adjacent CI snippet.
