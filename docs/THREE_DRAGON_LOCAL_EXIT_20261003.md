# Three Dragon completed-game navigation and stale Leave protection

## Scope and behavior

- Current server-backed standalone and Suite tables immediately show the local main/lobby surface when Leave is clicked on a completed game. The actual Leave command still performs existing server seat/ownership handling. Rejection restores the result. Confirmed dismissal survives same-tab refresh; Join reopens the result.
- Existing pack-legacy games can finish while `legacy-page.ts` remains mounted. Suite can also continue its historical stable table through `stable-legacy-page.ts` and `src/modules/threeDragonAnte/page.ts`. All three reachable paths now handle completed Leave/Join locally. They deliberately send no completed Leave command to the historical host.
- Historical table seats are archive identities and must remain aligned with `game.seats` for private-save recovery. Local exit does **not** remove room membership or archived seats. It does not reset, migrate, hand over or rewrite the game, deck, private hands, history or other players' views.
- Closing/unmounting preserves the tab-local dismissal. Reopening an ended legacy table follows its original transport so the result can be rejoined. Normal duplicate snapshots do not reopen it. A new lobby or new game clears the dismissal and displays that shared activity normally; historical membership remains intact.
- Active-game Leave, ordinary Close, retry and other commands retain their existing controller behavior. No legacy save validator was weakened.

## Delayed-command safety

The server client cancels a pending completed-game exit as soon as a replacement game is received, before reconnect retry can resend it. A late old acknowledgement is ignored.

`server/three-dragon/service.mjs` additionally checks an explicitly supplied Leave `gameId` before any seat or host mutation. Matching game IDs and a null lobby ID remain valid. Historical clients omitting the field retain their old behavior. This server guard is necessary for an already in-flight command whose client has not yet seen the replacement game. Publishing frontend files alone does not provide that server-side protection; the service source must be published separately under deployment authorization.

## Verification

- `node tools/three-dragon-seat-exit-selftest.mjs`: layout viewpoints, owner/nonowner navigation, retry/reconnect, failure rollback and superseded-game/late-ACK handling.
- `node tools/three-dragon-legacy-exit-selftest.mjs`: actual page router and both historical adapters with real LOCAL codecs, across standalone pack, Suite pack and Suite stable; owner/nonowner; playing-to-ended and reopened-ended entry. Covers repeat/normal snapshots, local rejoin, next game, Close and archive preservation. SDK, visual mount and document are synthetic.
- `node tools/three-dragon-stale-leave-selftest.mjs`: actual service authentication/command handlers with native SQLite; transport is an EventEmitter fixture. Covers delayed old Leave after reset/start, unchanged replacement state, matching current IDs, omitted IDs and null lobby IDs.
- `node tools/three-dragon-seat-exit-browser.mjs`: production standalone/Suite server-backed entries plus real WebGL nameplane bounds and screenshots. Requires Chromium and built outputs.

No native Owlbear-room or physical-device verification is claimed by these fixtures. No deployment or player-data changes are performed by these tests.
