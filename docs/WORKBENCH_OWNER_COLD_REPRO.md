# Cold PLAYER owner-sync regression evidence

## Scope and verified failure

The existing selection-223 and cache-push-217 browser fixtures begin as GM and call `hydrate()`, force the child window, and manually refresh before their assertions. They cannot establish a truly cold PLAYER startup.

The new `tools/workbench-owner-cold-sdk-selftest.mjs` starts with the PLAYER role, performs the real discover/hello handshake, and never calls the host's catalog/hydrate/selection helpers. It bundles the installed Owlbear SDK and production host. VM mode supplies a synthetic message, HTTP, timer and browser-global boundary. It is not a real browser or live-room test.

A concrete cold-load failure was reproduced against Suite `c66ce15`: after ready, losing the first outgoing relay selection leaves the host's last-selection signature marked delivered. A normal four-second refresh does not resend it. The test observes no replacement selection after 5.2 seconds without a new hello or DM action. Healthy cold startup, missing directory mirrors, delayed shared/inventory work, initially unavailable scenes, native owner events and first-time ownership grants all pass on that baseline.

The publication recovery change clears the failed publication's deduplication marker. The existing refresh rebuilds the selection under current permissions and sends it again, about four seconds later. This establishes a failure mode consistent with the reported loading symptom; it does not claim direct observation of the user's original room/network failure.

A second reproduced gap is a native-owner revocation while document hashing or wire compression is suspended. The baseline still posts one document mutation. The candidate's fresh pre-send guard rejects both with zero document posts. A separately queued command is denied after revocation as well.

## Results

- Initial focused matrix: baseline 10/12, candidate 12/12; first selection retransmitted in 4.018 seconds on the candidate.
- Expanded matrix with queue and compression boundaries: baseline 11/14, candidate 14/14. The three baseline failures are dropped-first-selection recovery, digest-time revocation, and compression-time revocation. The queued command itself was already denied on the baseline.
- Publication unit matrix: 11/11. Covers each failed view type, stale publication failures, replacement viewers, warm snapshot isolation, bounded bookkeeping, direct-post failure, and no automatic replay of acknowledgements or mutation-shaped traffic.
- TypeScript no-emit and diff whitespace checks passed.

The recovery lane is limited to selection/access/directory/catalog/cacheSnapshot publication signatures. It does not retry data mutations or acknowledgements. Late failure from an older viewer or superseded publication cannot erase the newer publication's state.

## Repeatable commands

From the Suite checkout, set WEB_ROOT to the corresponding Web checkout:

```sh
WEB_ROOT=../web OWNER_VM_ONLY=1 EXPECT_PASS=1 node tools/workbench-owner-cold-sdk-selftest.mjs
node tools/workbench-view-delivery-selftest.mjs
```

Run the historical red comparison without EXPECT_PASS:

```sh
WEB_ROOT=../web OWNER_BASELINE_REF=c66ce15 OWNER_VM_ONLY=1 PROFILE_OUT=../owner-cold-baseline-vm node tools/workbench-owner-cold-sdk-selftest.mjs
```

The VM output is `vm-results.json` in PROFILE_OUT (default `../owner-cold-sdk-evidence`). It explicitly records `actualBrowser:false`, `vmMessageBoundary:true`, `manualHydrate:false`, `gmActivation:false`, and `realRoomVerified:false`.

The same fixture retains a Playwright mode and a served browser-page mode:

```sh
WEB_ROOT=../web PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium node tools/workbench-owner-cold-sdk-selftest.mjs
WEB_ROOT=../web OWNER_SERVE_ONLY=1 node tools/workbench-owner-cold-sdk-selftest.mjs
```

Served mode executes its cold checks in the fixture page and renders results into the DOM, without browser-tool script injection. It saves `browser-results.json` on completion. It covers the browser cold-start/event subset, not every VM fault-injection case.

## Verification limits

This environment could not launch a new Chromium process because its required socket operation returned EPERM. The existing cloud browser also refused the loopback fixture URL with ERR_BLOCKED_BY_CLIENT. Neither is recorded as a browser pass, and no workaround bypassed that restriction. No real Owlbear room, player data, user computer, production service, push, merge or deployment was used.

The installed SDK confirms `Item.createdUserId` and full `data.items` payloads for the scene-items change callback. Its scene-ready event is `OBR_SCENE_EVENT_READY_CHANGE`. The synthetic VM implements these actual SDK boundary names rather than invoking observer callbacks directly.
