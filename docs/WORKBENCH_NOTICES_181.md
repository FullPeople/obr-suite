# Workbench notification lifecycle — local 181 evidence

Date: 2026-09-24 (Asia/Shanghai). Local source only; no deployment or live Owlbear room validation.

## Observed cause and change

The previous host opened the toast iframe only after a notice arrived, awaited `modal.close` before opening it, and closed it 5.6 seconds after the queue became empty. The next notice repeated iframe download/startup and SDK initialization. `modal.open` completion was treated as renderer readiness even though it does not prove that the renderer has installed its broadcast listener. The renderer also waited for an animation frame before acknowledging an already accepted notice.

`src/workbench/notices.ts` now prewarms the overlay as soon as the scene and local connection identity are available. The transparent overlay remains mounted until scene close. An empty renderer has no toasts and no CSS animations; there is no idle heartbeat or rendering loop. A slow initial role read no longer blocks prewarm; the default role remains PLAYER until confirmed and a newer role event wins over a stale initial read.

The modal options are supported by the [official Owlbear modal API](https://docs.owlbear.rodeo/extensions/apis/modal/): `fullScreen`, `hideBackdrop`, `hidePaper`, and `disablePointerEvents`. The SDK's type declaration was also checked locally. The noninteractive overlay approach was already used by the stable resource tracker; its dev open/close paths are gated by `WORKBENCH_DEV`, so that lifecycle does not close this overlay.

Host delivery waits for an authenticated, instance-matched READY. A one-shot probe recovers a lost READY. Pending delivery retries the same notice ID at 500ms intervals; after three unsuccessful intervals it rebuilds the renderer once. At six unsuccessful intervals it falls back to Owlbear's native notification only for IDs absent from the renderer's recent receipt record. Rebuilds use the existing ID-only sessionStorage receipt list; no private contents are persisted there. ACK loss therefore does not replay the visual or sound, including complete ACK loss followed by fallback. If browser storage is unavailable, fallback remains best effort under complete acknowledgement failure.

Modal open/close mutations are serialized. A slow open from an old scene cannot complete after a new scene's modal and then close the new one. Closing the scene clears delivery work and closes the overlay.

`src/resource-toast-page.ts` acknowledges DOM acceptance immediately rather than waiting for rAF. The first sound initialization is deferred until after the notification's first frame, so AudioContext construction does not block DOM acceptance/ACK. It still dispatches sound once per accepted notice. Stable-build delivery behavior is retained.

## Focused browser probe

Run from the Suite root:

```powershell
$env:TEMP='F:/CodexWork/2026-09-20/w-xu/temp178'
$env:TMP=$env:TEMP
$env:GOMAXPROCS='2'
node tools/workbench-notice-181-selftest.mjs
```

The probe bundles the actual host and renderer, creates real same-origin browser iframes through an SDK boundary fixture, and checks:

1. Prewarm before the first notice, no rebuild after 6.1 seconds idle, zero empty-layer animations, and clickable underlying room controls.
2. Lost READY recovery without recreating the iframe.
3. Lost ACK retries plus iframe reconstruction: one visual and one sound.
4. Modal failure → native fallback with current-role privacy, no secret payload in remote broadcasts, recovery on the next notice, no replay of fallback.
5. Complete ACK loss: one visual, one sound, no duplicate native notification.
6. PLAYER role event wins over a delayed initial GM result in the renderer.
7. Rapid scene close/reopen while modal opening is delayed, followed by complete scene-close cleanup.

Final result: **7/7 passed**, zero browser errors. Last measured publish-to-DOM first notice **41.5ms**, after-idle notice **0.8ms**. The prior run measured **33.8ms / 1.1ms**. These are local renderer-path measurements, not real Owlbear SDK/server/network latency guarantees.

Artifacts: `workbench-test-output/notices-181/results.json` and `first-notice.png`.

The initial full TypeScript check found no notification-file errors, but reported unrelated concurrent edits at `src/workbench/background.ts:133` (`baseline` possibly undefined) and `src/workbench/inventory.ts:30` (string indexing CoinValues). Their owning agents were notified; this task did not edit either file.

## Existing 179 integration regression

The first root-run `node tools/workbench-notice-179-selftest.mjs` stopped at warehouse notice assertion 3. `workbench-test-output/notices-179/failure.json` records this pre-correction failure, with no browser runtime errors. The cause was the older fixture manually mounting `/toast-test.html` without the `noticeInstance` from the host's actual `modal.open` URL. Its renderer announced READY with an empty instance, which the production host correctly rejected.

Only test code was corrected: all renderer mounts/reloads now preserve the modal's actual instance URL, and the deliberate replay carries that same instance. The shared toast SDK fixture now unregisters its host-side broadcast callbacks when an iframe is removed, matching real iframe disconnection; REMOTE broadcasts no longer echo locally. The production instance/connection validation was retained unchanged.

Re-run command: `node tools/workbench-notice-179-selftest.mjs`. Exit code **0**; **32/32 checks passed**, **23 saves**, **0 legacy resource module starts**, **0 browser runtime errors**, `realRoomVerified: false`. This includes warehouse give/take, resource create/edit, condition add/transfer/undo, HP changes, spell prepare/unprepare, duplicate broadcasts, iframe reload deduplication, privacy/demotion, and intentionally rejected/partial writes. HTTP 400/409/503 console messages from the rejection/concurrency paths did not represent runtime exceptions; their corresponding assertions passed. No production source changed for this regression repair.

Root subsequently confirmed the owning agents fixed the unrelated TypeScript issues and the full type check passed.
