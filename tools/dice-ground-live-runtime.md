# Live ground-alpha reuse experiment

Diagnostic tools only, based on `9aa0a2537e621dcd7b5c9bcd52ba559dbf658b7f`.
No product file, clock, cue, physics, animation speed, resolution, filter, or
main shadow-map update policy is changed. Not production-ready.

## Install contract

The self-contained `installGroundLiveProbe` export can be serialized into the
existing real diagnostic renderer. Install after renderer initialization, before
the sequence, from a verified baseline build. The wrapper replaces only
`r.gl.render`, which the unchanged product calls after pose/presence/onFrame
updates, inside its existing `withRenderRegion` full-clear transaction.

    const probe = installGroundLiveProbe({
      r, T, enabled: false, minBodies: 20, stableFrames: 3,
      trust: {
        source: 'verified baseline factory/build identity',
        exclusiveRenderer: true,
        rendererRender: r.gl.render,
        bodyMaterialHooks: [{onBeforeCompile, customProgramCacheKey}],
        geometries: [/* verified factory body BufferGeometry references */],
        decorationShaders: [{vertexShader, fragmentShader}]
      }
    });

The evaluator must extract the trust manifest from the verified material and
geometry factory/warmup path, before arbitrary runtime mutation. A style name,
`userData.diceDecoration` flag, or an arbitrary callback's current source string
is NOT proof of provenance. Body hook identity pairs must match the manifest;
known decoration GLSL must match exactly. Cloned body materials retain the
trusted factory hook references. Empty/untrusted manifests fail open.

`exclusiveRenderer:true` additionally asserts that no independent code mutates
raw WebGL state, writes shadow GPU resources directly, replaces renderer/state
internals, or invokes this render boundary outside the product clear contract.
Those uses are unsupported; do not assert exclusive ownership for them. Normal
geometry updates must use Three's attribute versions, as the stock renderer
requires. This is not a defense against arbitrary monkey-patching of JavaScript
or unannounced raw GPU writes.

## Algorithm and narrow domain

- Disabled by default. The experimental default threshold is **20 effective
  visible/layer-enabled, material-visible shadow casters**, not 20 allocated or
  future-birth dice. `stableFrames` defaults to three consecutive equal keys.
  A single-die control must not build with defaults. Change thresholds only as
  explicit experiment parameters; fixed-pose evidence does not select them.
- The exact key is built from the actual current scene, never `cue.settled`.
  The wrapper updates scene/camera matrices with the stock Three order. It
  does not update orphan light targets beyond what the product normally does.
- Every miss draws the full original frame first. Only after the real shadow
  pass has updated its matrices/map can the post-render key advance stability
  and build an offscreen cache. The build frame never substitutes the ground.
- A build freezes shadow updates ONLY during its isolated capture, draws the
  original ground white with original opacity into full-size single-sample
  Float32 **R32F**, then restores the scene and precompiles a cloned black
  ShadowMaterial using `texelFetch` for alpha. No build readback or `finish`.
- Subsequent equal-key hits draw the complete original scene with that one
  alpha expression replaced. Geometry, depth, ordering, MSAA, outlines and
  ongoing body/2D/DOM animation remain in the normal pipeline. The main shadow
  map still updates normally for dice receivers.
- Only ordinary opaque trusted static built-in body shaders are accepted.
  Resin/transmission/alpha/displacement/clipping/stencil/wireframe, unknown
  callbacks or visible FX, instancing/skinning/morphs, manual matrix mode,
  alternate cameras, shadow atlases, and nonstandard depth modes fall back.
- Ground is a single ordinary black FrontSide ShadowMaterial on the original
  exact four-corner plane. Its projected quad must contain the entire viewport
  plus one physical pixel, with no near/far clipping. This narrows a known
  single-sample versus MSAA boundary hazard; real strict RGBA tests remain
  mandatory. Fractional physical viewport/scissor boundaries are unsupported,
  avoiding Three's round/floor ambiguity at fractional DPR.

## Dependencies and resource lifetime

The key includes object/parent/roll/mesh identities; actual local/world matrices,
transforms, ancestor visibility, layers, cast/receive state and culling bounds;
all geometry attribute/index identities and versions, topology/draw range;
ground material/depth/blend/opacity; camera world/inverse/projection and layers;
light/target transforms, actual shadow intensity, bias/normalBias/radius,
shadow camera/projection/map dimensions, actual depth-texture identity/version
and sampling state; viewport/scissor/DPR/drawing size; renderer shadow/output
settings; clear color/alpha and mirrored depth/stencil clear values; and context
and resource generations. Nonfinite dependencies are rejected, with the valid
unbounded draw-range sentinel encoded explicitly.

Roll `start` and logical time are intentionally excluded: retiming without any
actual scene change does not change ground alpha. New active/roll/mesh identities
still invalidate replay or new dice. Built-in decorative time uniforms are
excluded only because the verified decorations do not cast shadows and the
verified body vertex/depth path is rigid and opaque. Their actual current draw
still runs and provides the current depth/coverage.

Dispose listeners invalidate geometry, material, map and texture generations.
Invalidation during a candidate draw defers resource disposal until its temporary
state is restored; the returned frame must also pass the generation check.
Context loss/restoration discards caches and refreshes extension/state mirrors.
At most one cache target is live after an ordinary transaction; previous targets
are released before constructing replacements. No cache is retained per roll.

`stats.resources` counts target creation/disposal/current/peak counts, exact
R32F color bytes, and conservative 4-byte-per-pixel depth estimates. Each build
records actual color/depth dimensions and queried depth bit count. GPU depth
allocation padding is implementation-defined: the estimate is not a hardware
memory measurement. At 1280×800 the nominal color+depth estimate is 8.192 MB.

## State and failure contract

Original material, visibility, ground local/world/model-view/normal matrices,
viewport/scissor/target, clear color/alpha, captured write masks/clear values,
shadow flags and `info.autoReset` are restored in `finally`. `info.render.frame`
is never rolled back. Capture adds its draw to the original frame's draw count.
The original outer `withRenderRegion` clear is never skipped.

Unsupported/preparation/eligibility failures retain the original path. A
completed candidate draw whose resource/context generation changed restores
state and repeats the full clear plus original render inside the same product
transaction. A bounded recovery of an ordinary state-restoration failure is
attempted; failed resources are released even when cleanup itself throws.

**An exception inside Three `render` or `compile` is different.** Three r186's
private render stacks are not exception-safe. Such a fault disables the
candidate, records `requiresRendererRecreation` and `fatalReason`, releases the
cache, restores public state as far as possible, and throws. The evaluator must
fail/terminate that fixture and recreate its renderer or browser context. It
must not count a same-renderer retry as a safe green fallback. The first fatal
error survives secondary cleanup errors. Reentrant rendering is such a fault.

## No hot-path GPU synchronization

The probe makes no `getError`, `getParameter`, framebuffer query, extension query,
`finish`, `readPixels`, or context query on steady hits. It uses Three CPU getters,
known exclusive ownership and context/resource events. Depth/stencil clear
setters and state locks are mirrored in CPU state; unknown state resets disable
eligibility until a fresh context/mirror. Raw GL mutation is outside this domain.

Extension/initial-state queries occur only on installation/restoration. Capture
framebuffer/mask/error checks occur only on builds. `stats.syncCalls` separately
counts the probe's `init`, `build`, and `hit` queries; `hit` must remain empty.
These counters cover this probe, not calls inside stock Three itself. Correctness
readback belongs to the external sequence evaluator and must be excluded from
real timed animation. GPU error detection is therefore not claimed in the timed
hit loop; external strict correctness checks retain that responsibility.

## API and evidence

- `setEnabled(bool)`: invalidate, then select baseline or candidate mode.
- `snapshot()`: JSON-safe counters and bounded per-frame records.
- `withOriginal(callback)`: synchronous correctness-only reference draw using
  the original renderer while preserving candidate cache/counters. The callback
  must not change scene state or render foreign scenes. No async callback.
- `setAlphaGain(0|1)`: correctness-only negative control on the sampled alpha;
  use one for all timing. A visible zero-alpha difference proves the hit path.
- `invalidate(reason)`: explicit diagnostic lifecycle/mutation invalidation.
- `inspect()`: CPU-only eligibility/key inspection at the render boundary.
- `dispose()`: remove wrapper/listeners/mirrors and dispose all cache resources.

Records include signature, original-render submission, capture submission,
compile submission, total build submission and total wrapper submission wall
costs, hit/build/stability/caster counts, reasons and resource dimensions. These
are CPU wall/submission metrics, not completed GPU time. Decide net benefit from
complete real single- and multi-client sequences with build costs included.

Run `node tools/dice-ground-live-runtime.test.mjs` with normal repo dependencies.
In the isolated worktree, `DICE_GROUND_LIVE_PACKAGE_JSON` may point read-only to
the already-installed baseline `package.json`. The tests use real Three classes
and mocked GL. They establish dependency/control-flow contracts, not pixels,
MSAA equivalence, browser recovery, or performance. Actual strict sequence and
end-to-end evidence must come from the separately authorized CI browser run.
