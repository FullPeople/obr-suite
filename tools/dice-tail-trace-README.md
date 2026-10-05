# Tail barrier origin trace

This is a diagnostic branch, not a product candidate. Only the new
`dice-tail-trace.yml` single job accepts `test/dice-tail-trace-20261005`.
No legacy workflow allowlist is expanded. The product source is fixed to Suite
`f67516100c1e5af450a4ee6a948241c03286c397`, paired Web
`fb584043c6bed831b9ca92eab783653770c24fe6`.

The existing latency build/browser tools run exactly four independent two-client
cases with `DICE_LATENCY_TAIL=1`: first post-ready 1d20, warm 1d6, warm 9d6, and a
warm 1d6 whose actual final chunk is dropped once while its SDK send still ACKs.
All submissions originate at Player and the normal authority election chooses
Host. This measures the normal remote-request chain. “Cold” means the first roll
in the fresh browser context after the product's required engine/renderer warmup,
not cold asset download; preparation timings are reported separately.

Production behavior is not optimized or bypassed. Vite-only transforms observe
source submission; authority acceptance; actual worker post/response (workerRoundTrip includes IPC
and scheduling; workerPhysicsMs is the worker-reported internal physics span); encode and
SHA completion; SDK receipt versus serial-inbox chunk acceptance; successful SHA,
decode and permission checks; overlay prepared-cache ACK; ready queue/dispatch/ACK;
authority wait count and uploading state; chunk/trailer/start queue/dispatch/ACK;
planned start; overlay start receipt and completion of all renderer.add calls;
actual renderer rAF callback invocation; the original drawFrame release timestamp;
GL render CPU return; and the first
completed, nonempty, changing frame readbacks. The existing trajectory-verified
log is not used as a decode timestamp. Overlay prepared is only a cached Roll;
meshes and audioPlan are created later by renderer.add after start receipt.

The clientFrames summary separates prestart blank frames, first callback after add,
the release callback/GL return, and completed visible readback. Neither the first
callback after add nor its potentially blank GL frame is called visible.

Each event's epoch timestamp is taken where the event happens with
performance.timeOrigin + performance.now(). GL return and readback completion
use their immediately captured timestamps. Synthetic browser-frame callbacks,
planned start, and CPU return are never called display presentation. glReturnMs
ends before readPixels, readbackSpanMs brackets only readPixels, visibleProbeSpanMs
includes the readback and verification work, and legacy renderCpuMs retains the
whole instrumented render/probe span. Only the first three changed poses per roll
are read back. Readback affects these diagnostic frames, so this run cannot be
used as an uncaptured latency benchmark.

The result contains original timelines, not an inferred optimization speedup.
Signed waitZeroToTrailerEnqueue/Dispatch/ACK show whether ready reached zero before
or after each tail boundary. Separate startQueue and startSDK expose the shared
100 ms paced lane and the awaited SDK Promise. All event payloads are restricted
to roll IDs, packet types, sizes, timing and state booleans; packet bodies, room
identifiers, public keys, sessions, wire hashes and identities are not exported.
The existing actual result parity and moving pixel/pose checks still run in memory.

The positive control requires: exactly one actual final chunk dropped; trailer
sees one missing part while unprepared; that trailer enqueues NACK; a targeted
repair chunk is dispatched; then the peer completes SHA, decode, permission check
and cache preparation; only then ready and start can occur. Both clients must be
cache-prepared before authority start, with current inbound/outgoing and live
controller/generation checks. Existing independent-scene observation waits for
empty real controller, renderer and worker state between cases.

Run locally only where browser sockets are permitted:

    export DND_CARD_WEB_ROOT=/path/to/exact/paired/web
    export DICE_LATENCY_TAIL=1 DICE_LATENCY_PIXELS=1
    export DICE_LATENCY_VIDEO=0 DICE_LATENCY_SCREENSHOTS=0
    node --test tools/dice-tail-trace.test.mjs tools/dice-independent-scene.test.mjs
    node tools/dice-tail-source-guard.mjs
    node tools/dice-latency-build.mjs
    node tools/dice-latency-browser.mjs

The guard compares every tracked Git tree entry and working tracked byte
against f675 except seven exactly named diagnostic files (including this README).
All other tools, workflow and build dependencies remain protected by default. It emits the inventory digest and nine selected SHA-256 hashes, checks
the paired Web revision, and type-checks the injected sources using both actual
TypeScript configurations. Boundary tests require exactly one match and fail
closed on reinjection. The build validates all 59 pinned assets.

CI uses real SDK, Jolt WASM, Three WebGL, and a synthetic local two-client host
with 10 ms network delivery and immediate simulated host replies to SDK calls.
It requests Chromium ANGLE SwiftShader at 844×390/DPR 2 and records actual renderer
identity and runner hardware. This is not a real Owlbear room, network, mobile GPU,
or OS presentation measurement. No socket restriction is bypassed locally.

All runtime settings are process/context-local. The browser and context close in
finally; no user room, stored settings or production parameters are changed.
