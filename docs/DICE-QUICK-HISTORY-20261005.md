# Quick composer history traffic: isolated candidate

Base: `8e2cd6fd0fe969d36694338457e9e4d3428c1c00`. No publication or deployment is part of this candidate.

## Confirmed source issue

The card mounts a new quick iframe for each compose identity (`DND-card-web/src/ui/Workbench.tsx`, `RollPicker`, `key={roll.id}`). The quick page has no dice-history subscription. Nevertheless the shared facade previously requested `dice3d.history` after every quick page's initialization callback.

The actual host `src/workbench/dice3d.ts` history RPC sends two LOCAL SDK messages per completed, visible history record. `src/workbench/dice-broadcast.ts` puts these on the same `DiceSendQueue` as the physical dice protocol. That queue preserves the shared 100 ms pacing budget. Reopening composers can therefore add unnecessary traffic and interfere with new trajectory packets. Pending host history RPCs are not cancelled when the composer closes.

The warm card-to-host path otherwise dispatches immediately: the card forwards iframe requests through `workbenchRequest`, direct messages or relay POST; the host executes `diceRpc` and `roll` outside the mutation queue. `executeRoll` sets `focus:false`. Separate windows do not establish that either document is hidden. The card's 500 ms loading-status poll is not a pre-submit delay.

## Narrow change

After the page's asynchronous `onReady` callback finishes registering listeners, request history only if the `com.obr-suite/dice-roll` subscription set has at least one listener. The full panel still subscribes and requests history. A removed subscription does not count as a consumer.

No changes to initial snapshots, duplicate init requests, readiness polling, role synchronization, host history filtering, transport pacing, physics, saved data, history limits or controller behavior.

## Local evidence

`node tools/dice-quick-history.test.mjs` executes the actual SDK facade and actual quick-page script in isolated Node VM realms, plus the actual host `dice3dRpc`, visibility policy and production shared send queue. Browser DOM, Owlbear SDK and physics are explicit boundary fixtures. The baseline facade is read from the exact base Git object; all other code, 100 saved records, and critical packet bytes are identical.

- Three quick mounts: baseline 3 history RPCs / 600 LOCAL history messages; candidate 0 / 0.
- The same offer, three chunks and tail use 1500 ms versus 400 ms of the deterministic queue clock. These are queue-mechanism measurements, not browser or user latency.
- The overlapping baseline history requests reach the existing 20-second facade RPC timeout. Candidate quick mounts do not.
- Quick action handlers still submit the requested formula, receive a reply and close.
- A subscribed panel receives 100 saved results, current events and history again after reopening.
- Unsubscribed history listeners do not cause a history request.
- Player events and reconnect snapshots still update facade reads.
- The real host filters GM-only and another player's self-only records for a player.

TypeScript, production quick/full panel build, `git diff --check`, and the existing 11-check `workbench-dice-history-218` suite passed locally.

`tools/dice-quick-history-browser.mjs` builds and exercises the actual production quick/full panels through a routed synthetic host without a local HTTP listener. Its launch explicitly removes Playwright's three default background-throttling/backgrounding-disable flags through `ignoreDefaultArgs`; it remains a headless UI regression and does not test real window visibility or natural background throttling. It covers five real quick mount/click/close cycles, full-panel 100-row history, live results, role demotion/promotion, and reopening. It records this boundary, uses 15-second default timeouts, and saves failure diagnostics/screenshots. It was syntax-checked and its production bundles built locally; the browser run is pending the parent's CI execution.

## Verification boundary

No real Owlbear room, user device, native window visibility, GPU presentation or end-to-end card-window click-to-visible timing is claimed. Earlier `dice-latency-browser.mjs` uses `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`; its card case starts at a direct host `diceRpc` call, and its small-dice tail cases start at `submitDice3d`. Those tests bypass the actual card/quick iframe bridge and do not prove the reported separate-interface latency is resolved. The new browser companion likewise validates panel behavior with a synthetic parent, not the full card-to-Owlbear path.
