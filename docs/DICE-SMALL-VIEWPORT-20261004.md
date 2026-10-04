# Small dice viewport candidate, 2026-10-04

Base: Suite `308a7ccf0cb70794055ac75170bf112a36989993`. Local candidate only; no push, merge, deployment, real-browser or physical-device acceptance is asserted here.

## Verified defects and bounded fixes

- A released roll retained its old pixels-per-die immediately after a viewport contraction. An initial 600-transition production-code probe with actual Jolt settled poses clipped 277 cases; the existing target projection fitted every case. A viewport contraction now applies that safe target immediately. Expansion and same-size roll changes retain the original easing.
- A transient 1px layer could subtract the fixed 8px border into a negative camera scale. The border shrinks only for such tiny layers.
- Long negative or multiplied results exceeded phone width. Canvas text fitting retains all digits and existing pulse timing. Unconstrained desktop text keeps its original metrics.
- Five-row formulas could clip a lower nameplate or the modifier's recoil. Result slots account for the full existing plate, number pulse, fixed 31px modifier recoil, and recoil flare/glyph bounds. An alternate compact grid is used only when it improves constrained fit; the original desktop grid is retained on ties.
- Orientation changes formerly eased old result slots into a newly sized grid, temporarily overlapping nameplates. Viewport reflow now snaps the result slots; same-viewport roll add/remove keeps easing.
- In-view token-anchored compact totals/captions now stay readable at an edge. Intrinsic text metrics are retained when they fit, and offscreen token anchors are not pulled onscreen. Modifier text uses its actual head's available viewport width.

The launch, hulls, poses, materials, physics, authoritative values, network authority, cue timing, particles, beam strength, sound, and full-screen impact effects are unchanged. Text/layout responsiveness does not reduce shader, texture, geometry, shadow or effect quality.

## Reproducible Node evidence

Run `node tools/dice-small-viewport-selftest.mjs`.

- 45 real locked-Jolt rolls: counts 1/2/5/9/10, mixed shapes and d20, four source sizes, plus d100 (two physical dice), negative/multiplied totals and five-row FormulaShow recipes.
- 4,320 settled actual-model resize/DPR combinations, 8,826,624 actual GLTF vertex samples, 1,617,040 collision-hull projection samples.
- Eight destination sizes: 320×568, 390×844, 568×320, 844×390, 768×1024, 1024×768, 1366×1024, and reduced usable area 750×335. DPR 1/1.5/2/3 for model/resize checks.
- Initial offscreen entry is recorded separately. No steady hull re-clipping after first fully visible entry in this matrix. The 2.5 CSS px outline allowance is conservative for the unchanged current outlines.
- 187 focused checks pass. Running the same assertions with `DICE_VIEWPORT_BASELINE=308a7cc DND_DICE_EVIDENCE=.local-evidence/dice-small-viewport-baseline node tools/dice-small-viewport-selftest.mjs` yields 138 baseline failures / 49 passes.
- Production FormulaShow executes with modeled DOM/Canvas calls, including actual transformed nameplate rectangles, recoil-boundary draws, long totals, viewport reflow, and in-view/center/offscreen anchored cases. Text metrics in this Node fixture are modeled, not real raster/font proof.
- Additional existing checks: resize 13, core 36, render-region 18; extension TypeScript and production Vite build pass. Vite retains the existing large-chunk warning.

Independent review reran the candidate checks and separate production draw probes. Its 144-case viewport/count/modifier sweep found no plate overlaps or modifier recoil lower-edge breaches. Review found and prompted correction of desktop coordinate drift, omitted modifier recoil space, transient reflow overlap, and anchored text boundaries before acceptance.

### Pose-entry timing, not click-to-visible latency

For seed 123456, mixed/d20, the four source sizes, and the unchanged 120Hz authoritative tracks:

| Physical dice | First actual GLTF vertex inside viewport | First complete hull inside | Every hull inside |
| --- | --- | --- | --- |
| 1 | 0–33.3 ms | 0–91.7 ms | 0–91.7 ms |
| 2 | 0–16.7 ms | 0–91.7 ms | 0–116.7 ms |
| 5 | 0 ms | 0–58.3 ms | 83.3–125 ms |
| 9 | 0 ms | 0–58.3 ms | 100–141.7 ms |
| 10 | 0 ms | 0–58.3 ms | 108.3–141.7 ms |

These are sampled geometric ages after scheduled playback starts, not measured browser display/GPU presentation times, and one seed is not a distributional guarantee.

## Browser fixture and remaining boundaries

`tools/dice-small-viewport-browser.mjs` is prepared and syntax-checked only. Build this exact checkout using the existing `tools/dice-latency-build.mjs` with an explicit paired `DND_CARD_WEB_ROOT`, then run the new fixture in an authorized browser-capable environment. It uses the real SDK → worker → overlay → FormulaShow path in a simulated solo room; captures collecting, recoil, settled/result and immediate-rotation frames; measures real Canvas text/plate bounds and real WebGL model projections. It does not modify or replace the parent's latency fixture.

No browser launch was attempted in this candidate task after the parent's verified Chromium socket EPERM restriction. Node results are not physical mobile/browser proof. Physical phone/tablet input, safe-area/notch behavior, browser toolbar geometry, rendered font pixels, real-room synchronization and original user device latency remain unverified. The 750×335 case models a reduced usable container only.

The separate persistent `.token-result-layer` DOM in `overlay.ts` was read, not changed. Its outer 180px maximum width does not itself guarantee long `strong` totals fit. That separate label path must not be reported as fixed by this cue candidate.
