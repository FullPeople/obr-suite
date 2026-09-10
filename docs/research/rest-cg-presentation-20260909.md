# Rest transitions and cinematic image presentation

This batch uses original inline SVG and finite CSS transform/opacity sequences in Owlbear's native `fullScreen` modal. It does not request browser fullscreen, copy card/art assets, poll a service, or introduce continuous network animation. The screen-effect helper shared with portals is unchanged.

- Short rest: black fades in, a campfire rises and a clock drops, then both return along their incoming paths. Six alternating local ticks span the three-second hold. Total sequence: 6 seconds.
- Long rest: tent rises, moon follows a clockwise arc around the lower center and pauses, sun follows while moon departs, then sun exits upward and tent exits downward. Total: 8.8 seconds.
- Custom text: original campfire with escaped text above it; text leaves upward and fire downward. Total: 5.8 seconds.
- Reduced motion: stationary crossfades, including the moon-to-sun change; no clock oscillation or audio. A newly enabled OS reduction preference stops movement/audio. Event expiry is bounded at 12 seconds and still uses sender, recipient, scene, arrival-time and replay checks. Natural completion happens before this expiry.

The CG menu accepts one actual scene `IMAGE` except the `CHARACTER` layer. Callback snapshots are re-read by ID and permission is rechecked before a write. Remote ON/OFF messages are only refresh hints from current GM connections; their image/active payloads are never authoritative. Scene metadata remains the existing time-stop state format.

CG windows use individual native IDs and local nonces. A newly opened iframe waits for its owner to confirm it is current; the bars begin first, then a successfully loaded image fades in after 550 ms. Initial identity/role-read rejection shows localized connection retry and an exact-window Return to map action; no CG is shown under unknown identity. Exit rejection stays visible and retryable. Hide fades the image/bars before the local acknowledgement and native close, with a finite fallback when an iframe never answers. A failed close remains owned and teardown reports failure for the module manager's existing retry. A displayed player overlay offers same-page close retry; the GM's overlay retains the existing faint, pointer-through presentation. GM native pointer-through also means its inline error button cannot capture map input; module disable/retry still performs exact-window cleanup. No claim is made that a host refusing all close requests can be forcibly removed.

Player drag interruption locks only originally unlocked selected items, tags only those temporary locks, and restores only its own tag in the same scene. An existing locked token remains locked. Delayed selection/update callbacks and scene changes invalidate old work. This local guard does not create a cross-client CAS guarantee, nor can an already sent host RPC be retracted.

## Validation

- `node tools/transitions-selftest.mjs`: 20 cases. Previous 19 permission/replay/portal-owner cases plus native close failure retained for teardown retry.
- `node tools/transitions-selftest.mjs --mutations`: 10 compiling semantic mutants rejected by assertions.
- `node tools/timestop-selftest.mjs`: 15 cases against the actual module and installed SDK `ContextMenuApi`/`ModalApi`, with fake host transport. Includes layer policy, stale source/role/scene work, private window callbacks, fade acknowledgement/deadline, close/remove recovery, delayed open, and temporary locks.
- `node tools/timestop-selftest.mjs --mutations`: 6 compiling semantic mutants rejected, including stale metadata and original-lock regressions.
- `node tools/transitions-ui-selftest.mjs`: 23 actual Edge DOM/CSS scenarios. Includes Chinese/English, 1280×800, 390×844 and 740×390; exact animation-stage geometry; slow image completion during hide; close failure retry; unload; local six-tick lifetime with permitted/blocked AudioContext substitutes; initial role/connection rejection, retry and failed-exit recovery; original control and independent portal-effect checks.
- TypeScript `--noEmit`: passed after final product edits.

Screenshots and structured results are in `_audit/2026-09-09/rest-cg-visual` outside the repository. Short, long moon/sun, text, landscape, narrow and CG staged screenshots were visually inspected. Transparent areas are white in the isolated browser screenshot; in Owlbear these expose the room map. The test CG is an original synthetic framing image, not a downloaded asset.

The installed SDK context-menu `create()` dispatches its host request without awaiting that internal promise; this test does not pretend to certify a remote menu-registration ACK. Native room rendering, actual GM/player devices, autoplay permissions, and cross-client timing still need real-room acceptance. No real room API writes, deployment, commit or push were performed by this task.
