# SDK rate recovery after the 2026-10-13 incident

The previous multiplayer batch was withdrawn after players reported inventory failures, slow legacy token panels and music opening announcements. Rollback restored both inventories and the announcement routing according to user feedback. Black screens and dragged-token synchronization recovery remain unconfirmed.

The browser log separately confirms Owlbear SDK `RateLimitHit`. Relay HTTP 429/503 and SDK rejection are separate evidence; neither proves all symptoms have one cause.

This release restores the 287-dev / 1.3.26 workbench background, relay client and inventory implementation. Dev Relay server and memory regression source also return to that baseline. The live Relay service remains on its rollback runtime; frontend publication does not restart it.

Small shared fixes:
- Closed music panels do not publish forced UI snapshots. Visible snapshots coalesce at 400 ms with one send in flight; SDK rejection uses bounded 1/2/4/8-second backoff. Commands, acknowledgements and authoritative room state do not use this queue.
- Party selection updates still update the party identity cache, but do not reread scene ownership unless the elected writer changes.
- Viewport polling waits for both dimension reads and never overlaps read pairs. Failures back off; teardown discards late callbacks.

`tools/sdk-rate-recovery289.test.mjs` bundles actual music index and viewport code at mocked SDK boundaries. It covers 500 hidden/visible updates, fresh trailing permission, nested RateLimitHit, cancellation and no command replay; viewport reads delayed by 1.2 seconds stay at one pair. Music selftest adds 200 selection-only party changes and retains permission, handoff, deduplication and scene quota scenarios. These are isolated regression checks, not real multiplayer acceptance.

The withdrawn admission/concurrency experiment remains in history and unused tests for investigation. It is not this release's production gate.
