# Three.js table stage

Updated 2026-09-10. This is the implemented renderer contract and its bounded test
coverage, not a release, deployment, hardware-performance or multiplayer-UAT claim.
Fronts use the user's supplied card pack; backs retain the original vector dragon.

## Files and contract

- `index.ts`: WebGL scene, finite motion, picking, pending-card reconciliation,
  responsive projection and resource lifecycle.
- `types.ts`: the complete public API; this is the authoritative interface.
- `layout.ts`: seats, physical card locations, anonymous backs and coin display.
- `currency.ts`: supplied gold/silver crops, extruded outlines and owned textures.
- `textures.ts`: lazily loaded supplied card fronts, original vector backs, labels
  and runtime paper, wood and felt materials.
- `stage-selftest.mjs`: actual renderer behavior/pixel checks and three targeted
  mutation modes.

`mountTableStage(canvas, options): StageHandle` consumes `StageModel`, containing
only `PublicView | SeatView | null`, language, connection/motion flags and selected
card IDs. It does not receive the host's private GameState, RNG, deck ordering,
controller, SDK, transport, storage or game-command functions. The renderer has no
pointer-input listeners. `onQuality` reports WebGL availability; `onInspect` is a
reserved option, not an installed input callback. The `low` quality type is reserved;
it is not evidence of an implemented automatic performance tier.

The actual handle exposes:

```ts
update(model: StageModel): void;
hitTest(clientX: number, clientY: number): StageHit | null;
getAnchor(query: StageAnchorQuery): StageAnchor | null;
setDrag(value: { cardId: string; x: number; y: number } | null): void;
releaseDrag(options?: { pending?: boolean; zone?: 'ante' | 'flight' }): void;
resolvePending(accepted: boolean): void;
gesture(seatId: string, value: HandGesture | null): void;
suspend(): void;
resume(): void;
destroy(): void;
diagnostics(): StageDiagnostics;
```

Hit testing, drag coordinates and anchors use browser **client CSS pixels**. The
renderer subtracts its canvas rectangle. Callers must not subtract it again or
multiply input by device pixel ratio. `getAnchor` returns `{x,y,visible}` or null;
it does not return a DOMRect. The outer UI adapts that point for onboarding.

Zones are `hand`, `ante`, `flight`, `deck`, `discard`, `stakes`. A drop target must
also match the acting seat: the central public ante area is not the player's own
face-down slot. ResizeObserver belongs to the renderer; there is no public
`resize()` or historical `play(cues)` method.

## Appearance and visible information

The table, card thickness, both card sides and coins are actual WebGL meshes.
The table is rotationally symmetric with a bevelled timber edge, padded rail,
apron and pedestal. Regions rotate in the same direction as their cards. Flight
regions are wider and carry labels on the felt. Overlapping cards expose the top
strength corner, which is also their inspection anchor.

Fronts use the 100 approved WebP scans with their portrait proportions and unlit
materials to preserve their printed colors. Backs use the original single-dragon
Canvas paths, not the supplied pack's reverse. Paper, wood grain and felt are
generated locally by code. The two coin faces are conventionally cropped from the
user's reference and mapped to extruded outlines. No AI images are used. Textures request one
frame after loading, cancel late callbacks on disposal, and do not create an idle
render loop. CanvasTexture remains the GPU texture format.

A directional shadow and warm fill illuminate the table. The current renderer
caps DPR at 1.75 and requests shadow updates only while rendering. There is no
post-processing chain, orbit loop or continuously changing material. The local
mesh hand keeps a useful foreground size on portrait displays. `getAnchor` points
to a hand card's exposed strength corner, which remains a raycast target even where
physical cards overlap. Small public cards use the caller's inspection and
accessible-list UI for detail.

Only visible physical locations create fronts: the current private hand, public
flights, public antes and the discard top. Committed antes remain face down.
Opponents use anonymous indexed backs, never hidden card IDs. The informational
`revealed` list does not duplicate physical cards. Changing a private seat to a
spectator cancels private pending visuals immediately. The repayment pool `hole`
is shown accurately by the outer DOM summary, not a separate current stage mesh.

## Submission is not acceptance

Dragging and `releaseDrag({pending:true, zone})` never mean host acceptance. There
is one mesh per card ID, retained while a projection can arrive before its receipt.
The outer integration calls `resolvePending` only after matching the exact action,
table and game receipt against an applied authoritative projection. Both acceptance
and rejection reconcile to the current authoritative location; rejection never
invents a hand card absent from the current projection.

The integrated UI requires `TableView.actionReceiptVersion === 1`. An older live
background without this marker cannot submit game commands through the new UI;
the page explains the refresh requirement while preserving viewing and exit.
`pending=false`, a resolved send Promise and another player's revision change are
not fallback success signals. Controller-generated success receipts follow valid
host snapshots; local rejection receipts are identified separately. The tutorial
uses its actual isolated engine result, not a timer, to produce the same outcome
contract.

Timeout or failed LOCAL delivery preserves the immutable original action for
retry. A retry cannot change its action ID, contents or submitted revision. The
renderer itself knows none of that transport and must not send a retry.

New games, changed seats, explicit reconnect snapshots and disconnection clear
old drag state. `animate:false` requests direct placement. Revision gaps do not
replay old transitions. No event-history list is replayed: finite movements come
only from successive projections. Current motion is a bounded 470 ms pose
interpolation with a raised arc, finite flip and landing, not the older proposed
CubicBezier cue API. It cannot reconstruct every intermediate ability effect from
a final projection.

## Decorative silver convention

Rules still use integer gold, debt, stakes and repayment values. Ten decorative
silver pieces represent **one gold**. `coinDenominations(n)` decomposes a positive
integer into `n-1` gold and ten silver pieces; zero has no coins. This replaces the
initial unimplemented silver-1/gold-5 proposal. There is no silver rules account,
fractional bet, currency-exchange action or draggable wagering interface.

Visible piles are bounded representative stacks: at most 24 gold meshes and ten
silver meshes per pile, plus the exact integer-gold label. Transfer animation pairs
only observed net deficits and gains, with at most twelve transient meshes. It does
not claim to reconstruct unseen intermediate transfers or infer a hidden card.

## Lifecycle and test boundary

Rendering is requested on change and while finite movements run. There is no idle
RAF or continuous light loop. Hidden/suspended surfaces stop rendering. Resize
recalculates projection; context loss reports unavailability to the DOM fallback,
and restoration reuses the canvas. Destroy releases materials, textures,
geometries, instance resources and the WebGL context. A late callback cannot
restart a destroyed surface. Reduced motion places cards without the finite arc.

Run from the repository root:

```text
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs --mutant=idle
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs --mutant=pending
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs --mutant=privacy
```

The recorded stage baseline is **36 behavior/pixel checks** in installed Chrome,
using actual Three.js WebGL through ANGLE SwiftShader. It uses the real rules
engine for the ante test; later display cases are explicit projection fixtures.
Visibility uses an explicit DOM lifecycle signal. The baseline covers actual
geometry/pixels, picking, pending/projection ordering, privacy, motion settling,
coin representation, gestures, reduced motion, revision gaps, pause/resume,
portrait foreground, language texture disposal, spectator changes, context loss
and final cleanup. The vector-only final source must receive its own fresh run;
a previous bitmap-request assertion cannot certify the final art choice.

Each mutation requires a unique source anchor, successful compilation and its
named runtime assertion. Build errors and unrelated failures do not count as
kills. Motion completion waits for the finite animation state, bounded at ten
seconds for software rendering. Each runner prints a fresh evidence directory
and writes source hashes; use those records for exact runs rather than treating
this documentation update as a test execution.

The stage's explicit `resolvePending` calls test renderer behavior only. Real
controller receipt handling has separate tests in
`tools/three-dragon-action-receipt-selftest.mjs`; pointer lifecycle has
`tools/three-dragon-drag-selftest.mjs`. UI, onboarding and LE rules have their own
suites and counts. Do not combine them into a stage-only number.

This evidence is not native Owlbear integration, hardware frame-time measurement,
final two/six-seat screen acceptance, or multi-client UAT. The final integration
still needs real pointer/keyboard/touch interaction, correct lift/flip/flat landing,
private-choice handling, old-background refusal, authoritative ACK/retry ordering,
window recreation, fallback and device-performance checks. No deployment or
version promise follows from these renderer tests.

Deck and discard tops sit on bounded physical paper-edge stacks. Only public counts determine height; two instanced meshes hold at most sixteen representative layers. A single card rests on the felt. The existing owned-instance cleanup also disposes those stacks.

Each seat has a single aligned region pair: ante immediately left of flight, at the same radial depth. Coins sit directly on top of that seat's ante card, with small stable offsets and no extra tray. The far card corners stay exposed; coins do not intercept card inspection. Deck and discard always face the screen, and settled coin faces stay upright. Two-to-six-seat tests populate both flights and antes.
