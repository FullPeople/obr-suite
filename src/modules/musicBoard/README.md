# Music board restoration / 音乐板恢复

## Suite integration

`background.ts` registers `setupMusicBoard()` / `teardownMusicBoard()` with the existing suite module lifecycle. Both **GM and PLAYER** have a quick-bar button and a settings entry. The module defaults on for new settings; explicitly saved disabled flags remain respected and can be enabled on the Music Board tab. The existing `com.obr-suite/music-board:toggle` LOCAL command toggles only this client's control panel. `com.obr-suite/music-board:state-active` reports its local open state.

Keep the music runtime alive across ordinary scene changes when the feature remains enabled: it is a room session, while the existing suite module switch may be scene-scoped. A full module stop shuts down this client's audio/transport and closes its panel, but **never** clears room state. Re-enabling restores saved tracks, queue and playback anchor; sound activation may be needed again for a new AudioContext.

The existing Vite input `music-board.html` is retained. Both deployment manifests declare the [documented autoplay permission](https://docs.owlbear.rodeo/extensions/reference/manifest/):

```json
{"name":"autoplay","reason":"Play shared music in the persistent background after the player enables sound."}
```

`src/music-board-page.ts` remains the existing HTML entry, but is now controls only. Declaring autoplay permission does not replace each person's initial sound-enabling gesture or guarantee identical behavior across browsers. These are source changes, not a production deployment.

## Architecture and retained sources

- `audio.ts`: one local background playback engine, current BGM plus at most four SFX, WebAudio limiter, local gain, SFX ducking, short fades. No perpetual animation loop; native audio events drive progress. Panel closing, drag, resizing or reopening do not destroy the engine.
- `room.ts`: room snapshot and one elected command executor (online GM first, then stable connection ID). Commands from all players are serially applied by that writer. Sender authority comes from the SDK broadcast `connectionId` matched to party/player information, not claimed payload roles. Default `allowPlayers=true`; the GM checkbox can restrict shared controls. The last 36 command IDs are remembered for retransmission deduplication. Role/party information is rechecked after reads and before writes.
- `model.ts`: persistent `com.obr-suite/music-board:session` v2 contains current BGM, playback ID and time anchor, 32-track room library, queue (32), four SFX slots, shared bus gain, policy and revision. Room metadata has a **total 16 kB SDK limit**; updates are rejected before writing if the combined room payload approaches it. Existing other extension keys and existing playlists are not truncated to make space. This music snapshot additionally caps itself to 10.5 kB so LOCAL status messages remain bounded.
- Old `com.obr-suite/music-board:state` scene data is read only when no v2 room snapshot exists. BGM is offered paused at its stored position, SFX tracks can be retained in the library, historical one-shots are not replayed. **No old scene key is deleted or cleared.** Migration is only persisted with a later explicit valid operation.
- `peer.ts`: the existing PeerJS 1.5.4 Studio command protocol and `obr-music-XXXXXX` pairing are retained. Only commands cross PeerJS; clients still download the HTTP(S) media URL themselves. A connection close/error never sends stop or blank room metadata. Retries are bounded with backoff and stale connections are invalidated. High-frequency Studio volume changes are coalesced.
- The full existing Studio is untouched: IndexedDB library, OPUS encoding/trimming, tags, BGM/SFX decks, source links, defaults and share-code export still exist at the linked Studio page. Native controls also accept its `obrm1:` UTF-8 share codes, browse the same `https://obr.dnd.center/music/manifest.json`, and add selected tracks to the shared room library. Default browsing does not copy the entire catalog into room metadata.
- The old Studio has **no remote upload service**: its local files/encoded blobs live only in IndexedDB and its share UI already requires a public direct URL. This restoration does not pretend blob URLs are shareable or add an external upload service. URL-backed playback and existing encoding workflows remain available.

## Reconnection and concurrency limits

Studio 1.x reconnect snapshots have no room/session revision. On automatic reconnect the connection is restored but its unversioned bootstrap is held; **Use Studio playback / 采用网页当前播放** explicitly adopts incoming Studio controls. The paired code is remembered. This avoids guessing a time window and silently replacing newer room operations. Opening/closing/resizing the control panel no longer causes this reconnect path. Disconnecting Studio or its controlling room client leaves the room playback and queue intact.

The SDK provides metadata merge writes and ephemeral broadcasts, not compare-and-swap or server locks. Deterministic election and serial commands prevent ordinary same-membership concurrent writes; this is not a claim of distributed consensus under partitions or delayed server writes from a former leader. A missing/failed elected client yields a visible unacknowledged-command timeout. Real room testing must include party transitions and reconnect timing. The elected writer learns native media duration from metadata and advances the queue on the shared playback deadline, even without enabling its own sound. This adds at most one duration update per loaded playback, without periodic room writes. A stale deadline cannot advance a replaced, paused, looping or newly sought-back track. Unknown/unavailable media duration and browser background timer suspension still require manual Next; there is no server clock or server playback process.

Local BGM/SFX volume and mute use the existing `obr-music-board:local-volumes` storage key and LOCAL messages only. They never change shared music gain. The Studio's bus volume controls continue to be shared commands, matching the existing protocol. A completed one-shot is remembered locally; old one-shots more than three seconds late are skipped instead of bursting on sound enable or late join. Looping ambient SFX can resume.

## Browser evidence and boundaries

Official references checked: [Manifest permissions](https://docs.owlbear.rodeo/extensions/reference/manifest/), [Broadcast identity/16 kB messages](https://docs.owlbear.rodeo/extensions/apis/broadcast/), [Room metadata/16 kB total](https://docs.owlbear.rodeo/extensions/apis/room/), [Chrome autoplay and iframe delegation](https://developer.chrome.com/blog/autoplay/).

The control panel has a one-time sound-enable button and displays browser refusal/media failure. A click is a request, not a promise that browser policy can be bypassed. No parent-frame DOM access, activation spoofing or autoplay-policy bypass flags are used by the product.

Three dedicated checks run from the repository root:

```
node src/modules/musicBoard/selftest.mjs
node src/modules/musicBoard/autoplay-selftest.mjs
node src/modules/musicBoard/browser-selftest.mjs
```

1. Actual RoomMusic instances with delayed SDK boundaries: simultaneous writers, command deduplication, role/connection authorization, handoff/late join, storage rejection without destructive changes, old-data import; actual MusicAudio with controlled media boundaries: sound consent, 100 equal snapshots without replay, one-shot deduplication, fade cancellation; actual Peer class: disconnect/reconnect/old listeners. Three mutations must fail assertions (deduplication, serialization, permission).
2. Actual Chrome, real Audio/AudioContext, distinct-origin parent with same-origin hidden background and control iframe. With no gesture it reports blocked/position zero. After clicking the control iframe the background becomes ready and progresses; removing controls leaves it playing. Both delegated and explicitly non-delegated autoplay fixtures were observed to activate from that same-origin user gesture in this Chrome run. This observation is not generalized to every browser.
3. Actual background module + actual HTML/CSS/control module in the same iframe arrangement, with only the SDK storage/message/UI boundary replaced: native metadata loading and automatic next while no AudioContext exists and all local media remain paused, exactly two room writes (duration and transition); sound enable; shrink/close/reopen keeping the same current native Audio instance; local volume without room writes; pause/resume; Chinese/English DOM and screenshots. Hidden iframe polling uses timers, since requestAnimationFrame is suspended there.

The room-capacity refusal check preserves the entire pre-existing music snapshot. Its expected raw log is `[music-board] room command rejected { type: 'add', error: 'roomFull' }`; the test does not dismiss it as a successful add. Automatic duration/deadline maintenance remains writer-only even under GM-only controls, allowing an existing queue to continue after the last GM leaves.

Scripts print artifact directories under the OS temporary folder. Playwright uses the bundled runtime path and installed Chrome; override `CODEX_PLAYWRIGHT_DIR` and `BOSS_CHROME` when needed. The fixture generates its own short test tone and makes no external music requests.

**Not real Owlbear multiplayer UAT.** Still verify DM + players with the actual SDK, manifests and serving headers; speakers/headphones and user volume; published media CORS/decoding and expired URLs; Studio over real PeerJS signaling; slow links; loss of the elected writer; scene switches; role changes; multiple tabs; Chrome/Edge/Firefox/Safari/iOS activation; and room payload limits with other extensions. No real room performance or audible human acceptance is claimed.
