# Workbench 179: remote card refresh races

2026-09-23. The investigation began after users reported that a card left open
did not always show another player's condition changes, while switching away
and back eventually refreshed it.

## Confirmed causes

The previous hydration loop serialized every character download behind one
global `hydrating` flag. A notification received while any unrelated card was
downloading only cleared a timestamp; the concurrent hydration call returned.
The selected snapshot still read the cached document. Even after the unrelated
download finished, the already-visited selected card was not revisited.

Separately, an invalidation received while that card's own GET was in flight
joined the older GET. Its response restored the freshness timestamp, losing the
invalidation. An immediate following hydration pass consequently did no GET.

Commit notifications also used to be emitted by selected command endings.
Runtime condition/stat writes through `persistDocument` did not all notify
other hosts. Notifications are now emitted by the successful durable commit
itself, before token projection and notice delivery. The lost-write-ACK readback
confirmation follows the same path. The payload contains only card ID, room ID,
and revision, not private document contents.

The proposed token-ID mismatch was rejected: bound token selections already
canonicalize to `card:<id>` in both selection paths. `observation.ts` subscribes
before its first read and guards initial getter results with event versions;
no change to that cache was necessary for these reproductions.

## Changes

- Each card has a deduplicated hydration job. Two background downloads may run
  concurrently; the selected card can start independently or promote its queued
  job. Selecting/invalidating a card no longer waits for an unrelated download.
- Each invalidation advances a generation. An in-flight GET for an older
  generation is aborted, then the shared read promise continues with the new
  request. This internal cancellation is not surfaced as a user error.
- Late responses cannot clear newer dirtiness. Superseded response bodies are
  cancelled. Existing revision guards still prevent an older GET overwriting a
  locally committed document. Access is still checked after awaited reads.
- Repeated notifications for an already-cached or already-requested revision
  coalesce and return without rebuilding the catalog or triggering hydration.
  Legacy notifications without a revision still invalidate, including
  those from another extension frame sharing this player's connection ID.
- Scene events reuse fresh documents. The selected card retains a 3-second
  fallback freshness window; other cards use 30 seconds. Explicit invalidations
  bypass both windows. Token reconciliation still reads current observations
  and respects the stamped runtime baseline.

## Reproduction and validation

Run `node tools/workbench-live-179-cache-probe.mjs` from the Suite repository.
The probe bundles the production background module and the actual installed
Owlbear SDK. Browser iframe messages pass through that SDK. HTTP storage and the
Owlbear parent are controlled fixtures; this is not a live room certification.

The initial failing reproduction was preserved outside the repository at:

`F:/CodexWork/2026-09-20/w-xu/workbench-live-179-cache/before-results.json`

It records selected revision 1 both while an unrelated GET was blocked and after
its release, until another hydration pass. Its second scenario records revision
2 marked fresh after a revision-3 notification; the next immediate pass made no
request and remained on revision 2.

The corrected probe result is `results.json` in the same directory. Local run:

| Scenario | Result |
| --- | --- |
| Remote revision 2 while unrelated GET remains blocked | Selected revision 2 delivered in 9.2 ms |
| Remote revision 3 while its own older GET remains blocked | Old request aborted; selected revision 3 delivered in 5.9 ms, before releasing the old server response |
| 20 identical revision notifications during an older GET | Exactly 1 replacement GET |
| Legacy notification from the same connection ID | Refreshed; observed within 16.4 ms including polling |
| 40 unchanged scene item events | 0 document GETs |
| Two actual SDK hosts, real `stats` command through durable commit | Other host received HP 7/revision 6 in 9.2 ms after broadcast, while the writer command still awaited its token-projection ACK |

The final two-host check calls the real command/persistence path; it does not
manually inject its card-updated broadcast. The writer's own committed-revision
notification now returns without starting redundant hydration. The final probe
records the writer command still waiting while the other host already updated.
The withheld SDK request is explicitly checked to contain HP 7 and revision 6;
the command must also resolve successfully with revision 6. A command failure or
an unrelated blocked projection cannot satisfy those assertions.

Final Web and Suite typechecks and the complete local production bundle pass.
These local timings isolate application scheduling; remote HTTP latency and
actual Owlbear delivery remain part of real-room UAT.
