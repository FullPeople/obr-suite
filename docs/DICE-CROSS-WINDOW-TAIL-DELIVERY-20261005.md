# Combined dice delivery, 2026-10-05

This review branch combines the cross-window fixes with the existing ready-tail candidate. It is not merged into dev/main or deployed.

## Exact inputs

- Cross-window input: `d3e744943dafba6fe5443e71027a844261965099`, based on Suite dev `8e2cd6fd0fe969d36694338457e9e4d3428c1c00` (release 246 runtime).
- Ready-tail input: `a23de258f7dd8bd4a541a9e58dfba355a574411f`, based on the same release 246 runtime `be3b13df39477491dda0b6ec152b1bf836e22b4a`.
- Paired Web: `46dd3287d11866bff057a428baeac9336c57a978`. No Web runtime changes are needed by this candidate.

The merge preserves both input histories. Its only product-code conflict is resolved by retaining the ready-tail branch's two-phase whole-group invalidation on session restart and using the cross-window branch's `dropInbound(id)` timer cleanup. No source is taken wholesale over the other side.

## Included behavior

1. Quick composers no longer request saved history that they never consume; full dice-panel history remains available.
2. Validated clock replies wake already-prepared receivers immediately, with one bounded fallback timer and cancellation/session/disposal cleanup.
3. The ready-tail optimization may reuse the already-queued trailer slot for authenticated public single rolls with fewer than 10 physical dice only after every required receiver is prepared. It preserves fallback delivery, clock lead, audience rules and identical physical trajectories.

## Validation and boundaries

The standalone cross-window input passed [CI 37261492999](https://github.com/FullPeople/obr-suite/actions/runs/37261492999), including real separate card/opener windows, visible-but-unfocused card, actual hidden host tab and return, 100 saved full-panel records and repeated quick clicks. The browser uses a fresh default Chromium context through public `connectOverCDP(..., {noDefaults:true})`; it neither forces visibility nor uses Playwright's focus-emulation capture handle.

The combined branch reruns those cases and related controller/clock/history/group/disposal/timeout/transport checks. A bounded four-case synthetic two-client run additionally uses the actual Owlbear SDK, Jolt WASM, trajectory codec and Three renderer: 1d20, 9d6, private self 1d6, and a lost-last-chunk repair. Each case requires matching authorized results and completed moving opaque-pixel readbacks on both clients. The private result remains absent from the unauthorized client.

This last physics/renderer harness uses synthetic room transport, fixed 10 ms delivery and software WebGL. It retains its existing background-rendering test flags so both synthetic clients can render. It is a compatibility check, not natural-background behavior or a new performance comparison. The separate opener test covers natural visibility. Neither establishes real-user hardware click-to-first-visible latency or proves that all fewer-than-10-dice immediacy issues are solved.

Use the exact combined commit's completed CI result before merging. No automatic merge, deployment, release-number change, character data or unrelated game data is included.
