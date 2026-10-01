# Dice and group workbench changes (217 candidate)

This is an uncommitted candidate. No deployment or real player mutation was performed by the dice task. Runtime protocol build: `suite-3d-3`. Rebuild both the Suite host (Controller/physics worker) and `dice3d` overlay; the 216 dice3d directory must not be carried forward unchanged.

## Behavior

- History uses the existing SDK action document with home/history tabs, the existing history store and notice renderer. New activity opens history at its newest entry; empty startup does not open it. Stable-plugin history is unchanged.
- GM group saves, checks and initiative use one physical prediction frontier. Per-target visibility is preserved with private/public trajectory slices and a common playback barrier. Public slices have no master random seed or diagnostics. No hidden target is made public, and public targets remain public.
- Group results reach the DM before animation completion. The overview group area locks after rolling, survives selection changes, supports hide/show, and settles without closing. Explicit close clears labels and restores the prior workbench page/scroll through the Web integration.
- The overlay anchors numbers and labels above tokens, without names. History clicks use already-authorized results rather than replaying physics. Click/control permissions and lifecycle cleanup are enforced locally.
- The existing 100-physical-die budget permits up to 100 normal targets, or 50 advantage/disadvantage targets. The previous new blanket 50-target cap has been removed. An oversized selection is explicitly blocked; it is never silently truncated. The original pre-roll and settlement HP / Max HP / AC decrease, increase and set controls are preserved. Only decrease uses DC half-on-success in settlement; only HP decrease consumes temporary HP. Combat preparation defaults to group initiative. Settlement retries preserve the original parameters, never reapply successful/uncertain writes, and recheck the stable character binding. Initiative rechecks binding/scene before writing.
- Playback retains unplayed time through suspension; transient presentation faults do not kill the RAF chain. WebGL loss revokes readiness and restoration resumes the same results. Persistent loss is reported explicitly. Three consecutive global frame errors cancel the failed presentation instead of hanging indefinitely.
- Full-resolution 2048px glyph atlases now use the sampled red channel only, with the original filtering. Temporary decode images are released. Logical cue surfaces share two 2D canvases rather than allocating two viewport surfaces for every target.

## Validation recorded on 2026-10-01

- Suite type check passed using the existing Node 22/dependency installation.
- `tools/workbench-group-217-selftest.mjs`: 29 passed (common physical frontier; group lifecycle; hide/show; settled-vs-closed; uncertain writes; scene changes; late close and old async completions; actual dice-budget acceptance and pre-mutation rejection; 100 mixed-visibility slices sharing one start; public-slice seed isolation; entire-barrier cancellation; receive timeout and authorized late abort; initiative value/binding; combat-preparation defaults; pre-roll repeated field edits; partial edit retry/selection lock).
- `tools/workbench-dice-lifecycle-217.mjs`: 5 passed, actual workbench/token/3D orchestration modules with SDK/engine boundaries mocked. Pending reads and an old rejected initialization cannot revive or tear down a newer service; foreign history clicks are ignored.
- Web `tests/groupRoll217.test.ts`: 4 passed (revision ordering, close, host advance, disconnect, authoritative reconnect snapshot).
- Web `tests/e2e/groupRoll217.spec.ts`: 1 Edge flow passed through the actual UI with synthetic host/cards: overview, immediate DC, follow-selection protection, hide/show, settlement retention, close restoring original card, and immediate mode-dependent 100-normal/50-advantage/disadvantage enable/disable messaging. The added locator initially used an exact label that did not match the select accessible name; correcting only the test locator gave a full pass (5.2 seconds).
- Three isolated Edge clients with actual Jolt/WebGL: mixed public/private non-authority GM group passed; consecutive 12 + 20 target groups completed on all clients with one start per group, all authoritative results and at most three canvases. Freeze/resume, a one-frame callback fault and explicit WebGL loss/restore completed the same rolls without rerolling. Background pages were throttled near 1 FPS and took longer; this is not a claim of foreground frame rate. The additional 100-normal/50-advantage budget cases used formula/host/protocol fixtures, not a new 100-die GPU pressure run; they prove acceptance and a shared frontier, not 100-target smoothness.
- Single-client final probe: all 4,194,304 atlas red samples matched (16,777,216 RGBA bytes to 4,194,304 R8 bytes), fixed label hide/show/close and DOM reuse passed, all five existing skins completed with token cue anchors, and context loss/restoration toggled readiness correctly. No page errors. Screenshots and private JSON remain outside the repository.
- Action boundary browser probe passed: history action opens and follows the newest entry without opening the former floating history surface.

The initial three-client pressure run failed before throwing: ANGLE reported Texture2D allocation `GL_OUT_OF_MEMORY`/`0x8007000E`, then all three contexts were lost. Full-machine memory pressure was present, not proven to be solely caused by this extension. The old RGBA glyph set was approximately 555 MiB including mipmaps per client; R8 uses one quarter of those glyph bytes. The same three-client flow passed after that change. Original failure evidence is retained.

## Reproduction and release input

Set `DND_SUITE_DEPS` to the existing Suite dependency checkout and `DND_DICE_EVIDENCE` to a scratch directory with adequate disk space. Then run the two selftest scripts above. No dependency copy is needed.

`tools/workbench-dice217-server.mjs` starts the isolated renderer fixture on port 5219. `DND_DICE_FS_ALLOW` can contain semicolon-separated real dependency junction targets. `tools/workbench-dice217-browser.mjs` additionally uses `DND_WEB_ROOT` for Playwright and optionally `DND_DICE_URL`; it uses synthetic clients, never a real room.

For a fresh production overlay build set `DND_DICE3D_OUT` to a new absolute directory and run `node tools/build-workbench-dice3d-release.mjs`. It refuses an existing output directory. Package its complete result at `/suite-dev/dice3d/` together with the newly built Suite host. Existing pinned asset hashes remain unchanged; the runtime JS/CSS and build protocol changed.

## Remaining acceptance boundaries

Real Owlbear action behavior, physical token alignment while the real viewport moves, multi-user mixed permissions and full production animation still require the root team's real-room acceptance after a separately authorized release. No synthetic fixture is claimed as that result. Host overlay z-index remains the previously confirmed SDK limitation: this work does not claim the pointer-transparent overlay sits above every native host dialog/action. Browser/driver refusal to restore a lost WebGL context cannot be repaired by a local z-index change; it is surfaced rather than silently treated as ready.
