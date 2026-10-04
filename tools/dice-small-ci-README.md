# Small dice browser verification

The workflow `dice-small-resource-profile.yml` runs only on pushes to
`fix/dice-small-resource-combined-20261004`. It has read-only repository permissions,
never deploys, pins paired Web `fb584043c6bed831b9ca92eab783653770c24fe6`, and compares
against Suite `308a7ccf0cb70794055ac75170bf112a36989993`.

Six expanded jobs:

- Three same-runner baseline/candidate/baseline timing jobs: phone portrait,
  phone landscape, tablet portrait, with emulated DPR. Each records 1/2/5/9 and
  10-die control, mixed-nine and percentile-two cases on both clients. No video,
  screenshots, readback, or `gl.finish` is added during timing frames.
- One separate recorded two-client run: full animations, first nonempty GPU
  readback with actual visible meshes, changing poses and changing opaque pixels,
  concurrent/private/GM group results, dropped offer, missing ready, delayed chunks,
  and slow SDK acknowledgement. Videos are uploaded separately from metrics/PNGs;
  both success and failure JSON map video names to Host/Player.
- One exact-pixel and viewport job: 30 baseline/candidate fixed-geometry RGBA
  comparisons cover all five themes, seven geometries, both public/hidden overlay
  textures, and preview rendering. It requires real texture-object counts of
  baseline 19 versus candidate 7, restores the overlay context and checks exact
  pixels/transparent clearing, and checks the preview's existing loss/reopen flow.
  Real clamp timeline/depth masks must be visible and production pixels must equal
  a full-canvas reference. The separate viewport run asserts projected mesh and
  result/nameplate bounds, no label overlap, extreme totals, repeat formulas and
  rotation across five selected theme/viewport/DPR combinations.
- One bounded lifecycle run: 21 consecutive small rolls, 65-second protocol
  retirement, no idle WebGL renders, real context loss/resumption and removal of
  the paused 20 ms audio interval, then two teardown/restart/roll cycles. Logical
  resource counters and CDP heap are descriptive; the test does not claim a
  process/GPU memory total or prove absence of all leaks.

A green run does not mean a latency target has been reached. Inspect every
`comparison.json` and the nine-die row, including baseline drift. CPU render-return
latency and completed GPU readback are separately named. Neither measures the
browser/OS's first displayed frame. SwiftShader on a CI runner, emulated viewport
and synthetic SDK host are not physical phone/tablet or real-room validation.

## Authorized runner commands

Use a regular CI/desktop environment where listening sockets and Chromium are
permitted. Do not retry a denied local browser/server in a restricted environment.
The workflow handles all installs, copies the identical observation harness into
the immutable baseline checkout, builds both sources, and uploads failure data.

For individual replay on an authorized runner:

```sh
export DND_CARD_WEB_ROOT=/absolute/path/to/the/pinned/web
node tools/dice-latency-build.mjs
DICE_LATENCY_SMALL=1 DICE_LATENCY_CORE=1 DICE_LATENCY_SOFTWARE=1 \
  DICE_LATENCY_VIDEO=0 DICE_LATENCY_SCREENSHOTS=0 DICE_LATENCY_PIXELS=0 \
  DICE_LATENCY_WIDTH=390 DICE_LATENCY_HEIGHT=844 DICE_LATENCY_DPR=3 \
  node tools/dice-latency-browser.mjs
DICE_VIEWPORT_COMPACT=1 DICE_LATENCY_SOFTWARE=1 node tools/dice-small-viewport-browser.mjs
node tools/dice-small-preservation-build.mjs
# Build baseline with the same two build scripts first; then:
DICE_BASELINE_BUILD=/absolute/path/to/baseline/.local-evidence/dice-latency/runtime \
  node tools/dice-small-preservation-browser.mjs
node tools/dice-idle-lifecycle-build.mjs
DICE_IDLE_SOFTWARE=1 DICE_IDLE_ROUNDS=21 DICE_IDLE_CYCLES=2 DICE_IDLE_WAIT_MS=1000 \
  node tools/dice-idle-lifecycle-browser.mjs
```

The local preparation validated syntax, YAML, inert probe contracts, candidate and
baseline diagnostic builds with pinned Web, and all 59 runtime asset hashes. No
local browser was run; the first actual browser assertions belong to CI.

Independent sequential cases now wait outside their timed interval until both real
controllers have no held/retained rolls and both physics workers report zero
incumbents/bounds/kinds/groups. The observations are retained in result JSON;
render-complete/result logs alone cannot satisfy the boundary. Concurrent/group
submissions remain concurrent internally. The group fixture explicitly supplies
one public row and one hidden GM row and checks their distinct visibility.

Pixel evidence uploads are split into JSON, baseline/candidate render PNG,
baseline/candidate raw RGBA, and five viewport PNG bundles. This preserves the
first oversized archive on GitHub while making new evidence accessible through
the supported small-file download path. Explicit restored/cleared/reopened PNGs
are retained alongside the normal material-reference images.
