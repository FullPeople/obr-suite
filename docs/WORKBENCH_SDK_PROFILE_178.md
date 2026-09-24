# SDK boundary profiling, 178

This is a controlled diagnostic, not a claim of real-room acceptance. The installed Owlbear SDK is used without replacing its API methods. Requests cross a real browser iframe/parent boundary; the parent serves synthetic room data after a configurable delay. The host delay is simulated, not a measured Owlbear latency.

## Confirmed implementation facts

`@owlbear-rodeo/sdk/lib/messages/MessageBus.js` sends every `sendAsync` request to `window.parent.postMessage`, waits for a nonce-specific response and defaults to a 5,000 ms timeout. `PlayerApi`, `RoomApi`, `SceneApi` and `SceneItemsApi` do not cache returned values. `getItems(predicate)` retrieves all items and filters them inside the extension. `getItems(ids)` uses the smaller targeted request.

The 177 `catalog()` performs six SDK requests in three sequential rounds. A changed selection traverses four catalogs plus selection retrieval. Hydration re-reads the entire scene separately for each character. Independent calls share no observation snapshot, and every item event starts another selection refresh.

## Measured old background

Fixture: 300 scene items, approximately 484 KB per full scene response, eight character documents; character HTTP responses are local. Tests pin the profiled background source and write its SHA-256 into `results.json`.

| Operation | Parent delay 40 ms | Parent delay 150 ms | SDK requests | Full scene responses |
| --- | ---: | ---: | ---: | ---: |
| Catalog | 149 ms | 480 ms | 6 | 1 |
| Unchanged selection refresh | 477 ms | 1,578 ms | 19 | 3 |
| Changed selection refresh | 622 ms | 2,031 ms | 25 | 4 |
| Bound character roll | 382 ms | 1,258 ms | 12 | 1 |
| Secondary dice quick roll | 568 ms | 1,870 ms | 19 | 2 |
| Hydrate eight characters | 513 ms | 1,835 ms | 22 | 9 |
| Overview refresh | 258 ms | 782 ms | 11 | 1 |

Five item events produced 139 SDK requests, including 26 whole-scene responses totaling 12.63 MB, within 3.5 seconds at a 150 ms parent delay. This is a response-copy and repeated-work measurement, not internet traffic.

While an unrelated character request was deliberately stalled for six seconds, current-character selection took 623 ms and a roll took 383 ms at a 40 ms parent delay. Those measurements match the unstalled baseline. This rejects unrelated character HTTP waiting as the cause of those particular delays; it does not rule out slow downloads of the selected character.

## Read-only server check

On 2026-09-23 around 21:11 local time, the server load average was 0.03 and the relay process used approximately 0.6% CPU. Three public manifest requests from the development machine took 118–130 ms; a server loopback HTTPS request took approximately 5 ms. Relay journal output since 12:45 UTC contained no matching Error/failure/timeout/EPERM/ENOSPC lines. These samples provide no evidence of server overload at that moment and do not measure a user's connection or rule out unlogged failures.

## Reproduction

`tools/workbench-178-sdk-profile.mjs` writes results under `F:/CodexWork/2026-09-20/w-xu/sdk178`. `PROFILE_LABEL` selects the output folder; `PROFILE_SOURCE` can select the pinned baseline background. Profiling disables periodic timers and invokes the same production methods explicitly to isolate stages; it retains real SDK message serialization, event listeners and dice execution. The event burst is delivered through the real SDK event channel.

The next comparison must use the changed production background with the same fixture, 40/150 ms delays and six-second unrelated HTTP stall. Warm character switching should avoid repeated full-scene reads and finish within 150 ms at a 40 ms parent delay. Permission and selection events must invalidate their corresponding cached observations. Final acceptance still requires the user's real room.

## Changed production comparison

The same SDK/iframe fixture was rerun against the final production background, including snapshot access rechecks, ACK ordering, observation version checks and the three-second background HTTP fallback. Its SHA-256 is `05c2273a75e8ae1fc06712d1c697f1641782f4da9e7ae28907fac201f83a1525`, verified against the source again after the run. Results are in `sdk178/release-final/results.json` and `event-checks.json`.

| Operation | New, parent delay 40 ms | New, parent delay 150 ms | SDK requests |
| --- | ---: | ---: | ---: |
| Catalog | 2 ms | 1 ms | 0 |
| Changed selection, through delivery to parent | 25 ms | 5 ms | 0 |
| Bound character roll | 52 ms | 156 ms | 2 broadcasts |
| Secondary dice quick roll | 44 ms | 154 ms | 2 broadcasts |
| Hydrate eight characters | 3 ms | 3 ms | 0 |
| Overview refresh | 20 ms | 2 ms | 0 |

Five item events no longer requested any additional full scene copies. A six-second unrelated HTTP read left selection at 10 ms and rolling at 58 ms. More importantly, an entirely uncached A card began a six-second download; selecting cached B then delivered B to the parent in 6 ms. A's eventual response did not replace B. These selection measurements wait for the actual `selection` message at the parent, rather than treating the asynchronous refresh function's return as delivery.

Four real SDK permission/selection checks also passed: a selection event switches cards; a role downgrade plus changed owner/lock metadata immediately denies private-card access; the player's other card remains accessible; and a private-card HTTP response is rejected when ownership is revoked while that response is pending. Including the late-A race, five event/race checks passed in total.

Dice timings end when the command's broadcast finishes. They do not measure the visible WebGL animation, cold asset downloads, actual Owlbear parent latency or a real player's network. The evidence establishes removal of repeated SDK round trips and stale-selection blocking in these paths, while live room feedback remains the final acceptance gate.
