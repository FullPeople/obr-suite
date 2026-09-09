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
- `model.ts`: persistent `com.obr-suite/music-board:session` v2 contains current BGM, playback ID and time anchor, 32-track room library, queue (32), four SFX slots, shared bus gain, policy and revision. Room metadata has a **total 16 kB SDK limit**. If the combined payload approaches that limit or this snapshot exceeds the 10.5 kB room allocation, the complete music snapshot is persisted in scene metadata under a room-specific key. Other extensions, room settings and existing playlists are never truncated. Clients read both stores before publishing initial playback, and prefer the newest revision. The current writer carries scene-backed music to a newly opened scene once; closing the control panel leaves audio intact. Each music snapshot remains bounded at 48 kB for LOCAL messages. The fallback needs an open scene; genuine save failures reject the command without claiming persistence.
- Old `com.obr-suite/music-board:state` scene data is read only when no v2 room snapshot exists. BGM is offered paused at its stored position, SFX tracks can be retained in the library, historical one-shots are not replayed. **No old scene key is deleted or cleared.** Migration is only persisted with a later explicit valid operation.
- `peer.ts`: PeerJS 1.5.4 and `obr-music-XXXXXX` pairing are retained. Negotiated v2 carries commands/ACKs and confirmed BGM/SFX/bus snapshots in both directions; clients download HTTP(S) media URLs themselves. No audio samples, local speaker gain/mute or periodic playback ticks cross PeerJS. A connection close/error never stops or clears the room. Retries have backoff and stale connections are invalidated; volume changes are coalesced.
- The full Studio keeps its IndexedDB library, OPUS encoding/trimming, tags, BGM/SFX decks, source links, defaults and share-code export. Its paired decks now display confirmed room state, including pause/seek/loop/stop and SFX removal. Native controls also accept `obrm1:` UTF-8 share codes and browse `https://obr.dnd.center/music/manifest.json`. Default browsing does not copy the entire catalog into room metadata.
- The old Studio has **no remote upload service**: its local files/encoded blobs live only in IndexedDB and its share UI already requires a public direct URL. This restoration does not pretend blob URLs are shareable or add an external upload service. URL-backed playback and existing encoding workflows remain available.

## Reconnection and concurrency limits

Studio 1.x reconnect snapshots have no room/session revision. On automatic reconnect the connection is restored but its unversioned bootstrap is held; **Use Studio playback / 采用网页当前播放** explicitly adopts incoming Studio controls. The paired code is remembered. This avoids guessing a time window and silently replacing newer room operations. Opening/closing/resizing the control panel no longer causes this reconnect path. Disconnecting Studio or its controlling room client leaves the room playback and queue intact.

The updated Studio advertises `studio-ready` protocol 2. A fresh connection receives a random session ID and increasing state sequence; only that connection/session may submit `studio-command`. Its ID is passed unchanged to RoomMusic, so an ACK lost after persistence can retry without replaying a load. At most 16 commands are pending and each retries at most three sends; Studio gain drags coalesce at 120 ms. ACKs follow the room promise and failures restore the confirmed state with a message. Both control pages attach the observed playback ID to pause/resume/seek/loop/stop; a delayed command cannot operate on a replacement track. Shared loop changes retain the current playback ID and paused state.

With updated peers, existing room state wins on pairing/reconnect, including a deliberate stop. Only an explicitly paired, revision-zero empty room adopts the Studio's current playback; paused bootstrap is one atomic load. A modern reconnect needs no Adopt button. Old Studio/plugin combinations retain the legacy one-way fallback and cannot provide bidirectional state until both assets are updated.

Website mute controls only its WebAudio master gain. It never sends a room volume, pause or stop and remains muted during transport loss. The website's BGM/SFX gain bars remain **shared** gain controls; the Owlbear panel's My volume/Mute for me remain private to that Owlbear client. Browser autoplay refusal is local: logical room playback continues to drive the website controls even if its own AudioContext is suspended. The local sound button requests activation; there is no autoplay bypass.

The SDK provides metadata merge writes and ephemeral broadcasts, not compare-and-swap or server locks. Deterministic election and serial commands prevent ordinary same-membership concurrent writes; this is not a claim of distributed consensus under partitions or delayed server writes from a former leader. A missing/failed elected client yields a visible unacknowledged-command timeout. Real room testing must include party transitions and reconnect timing. The elected writer learns native media duration from metadata and advances the queue on the shared playback deadline, even without enabling its own sound. This adds at most one duration update per loaded playback, without periodic room writes. A stale deadline cannot advance a replaced, paused, looping or newly sought-back track. Unknown/unavailable media duration and browser background timer suspension still require manual Next; there is no server clock or server playback process.

Local BGM/SFX volume and mute use the existing `obr-music-board:local-volumes` storage key and LOCAL messages only. They never change shared music gain. The Studio's bus volume controls continue to be shared commands, matching the existing protocol. A completed one-shot is remembered locally; old one-shots more than three seconds late are skipped instead of bursting on sound enable or late join. Looping ambient SFX can resume.

## Browser evidence and boundaries

Official references checked: [Manifest permissions](https://docs.owlbear.rodeo/extensions/reference/manifest/), [Broadcast identity/16 kB messages](https://docs.owlbear.rodeo/extensions/apis/broadcast/), [Room metadata/16 kB total](https://docs.owlbear.rodeo/extensions/apis/room/), [Chrome autoplay and iframe delegation](https://developer.chrome.com/blog/autoplay/).

The control panel has a one-time sound-enable button and displays browser refusal/media failure. A click is a request, not a promise that browser policy can be bypassed. No parent-frame DOM access, activation spoofing or autoplay-policy bypass flags are used by the product.

Dedicated checks run from the repository root:

```
node src/modules/musicBoard/selftest.mjs
node src/modules/musicBoard/autoplay-selftest.mjs
node src/modules/musicBoard/browser-selftest.mjs
node src/modules/musicBoard/studio-selftest.mjs
```

1. Actual RoomMusic instances with delayed SDK boundaries: simultaneous writers, command deduplication, role/connection authorization, handoff/late join, storage rejection without destructive changes, old-data import; actual MusicAudio with controlled media boundaries: sound consent, 100 equal snapshots without replay, one-shot deduplication, fade cancellation; actual Peer class: disconnect/reconnect/old listeners. Three mutations must fail assertions (deduplication, serialization, permission).
2. Actual Chrome, real Audio/AudioContext, distinct-origin parent with same-origin hidden background and control iframe. With no gesture it reports blocked/position zero. After clicking the control iframe the background becomes ready and progresses; removing controls leaves it playing. Both delegated and explicitly non-delegated autoplay fixtures were observed to activate from that same-origin user gesture in this Chrome run. This observation is not generalized to every browser.
3. Actual background module + actual HTML/CSS/control module in the same iframe arrangement, with only the SDK storage/message/UI boundary replaced: native metadata loading and automatic next while no AudioContext exists and all local media remain paused, exactly two room writes (duration and transition); sound enable; shrink/close/reopen keeping the same current native Audio instance; local volume without room writes; pause/resume; Chinese/English DOM and screenshots. Hidden iframe polling uses timers, since requestAnimationFrame is suspended there.
4. Actual Studio app/HTML/IndexedDB plus the above background/panel and real browser Audio/AudioContext. Only SDK and PeerJS transport boundaries are fixtures. Covers two-way playback, seek, paused loop changes, website-only master gain with zero room writes, lost ACK deduplication, reconnect and stale state/close callbacks, URL library load, SFX removal and an already-playing one-shot across the late-join cutoff, and closing either controller. The server supports HTTP byte ranges so seek checks use a seekable real WAV. Unit checks additionally cover actual RoomMusic stale-target refusal, persistence-before-ACK, session isolation, queued dispatch cancellation and 50 volume events coalescing into one command.

Before this change, the actual online Studio `app.js` and `index.html` matched this checkout byte for byte (SHA256 `85646149cf8630602f942c91722a5dcb61d3823fc91c096d72ba2eea9b354296` / `10e9763de4b8680d235613db845100026494142e6e5c311c85c8aeedb07eff53`). They had no incoming `conn.on("data")`; progress clicks only sought the website, and loop changes sent a new `bgm-load`. Online dev was `1.0.149-dev`, stable remained `1.2.2`. The fix requires publishing the updated suite **and** `tools/music-studio/{app.js,room-sync.js,i18n.js}` together; this work does not deploy either site. [PeerJS documents bidirectional DataConnection send/data](https://peerjs.com/client/getting-started#data-connections).

The full-room regression now verifies a successful scene-backed add, preservation of every unrelated room/scene key, carry-over to a new scene and cold join without briefly applying stale room playback. The separately forced persistence failure remains an actual failed command. Automatic duration/deadline maintenance remains writer-only even under GM-only controls, allowing an existing queue to continue after the last GM leaves.

Scripts print artifact directories under the OS temporary folder. Playwright uses the bundled runtime path and installed Chrome; override `CODEX_PLAYWRIGHT_DIR` and `BOSS_CHROME` when needed. The fixture generates its own short test tone and makes no external music requests.

**Not real Owlbear multiplayer UAT.** Still verify DM + players with the actual SDK, manifests and serving headers; speakers/headphones and user volume; published media CORS/decoding and expired URLs; Studio over real PeerJS signaling; slow links; loss of the elected writer; scene switches; role changes; multiple tabs; Chrome/Edge/Firefox/Safari/iOS activation; and room payload limits with other extensions. No real room performance or audible human acceptance is claimed.

## 2026-09-10 runtime fixes

Fresh pairing adopts BGM, SFX and shared bus gain in one `studio-load` operation. Adding tracks or changing volume does not count as a previous playback decision; an explicit stop does. A failed adoption does not send an empty room snapshot back as a stop. Studio ends that failed pairing and restores its local output while its audio continues; the room connection does not retry the rejected adoption endlessly. New capability negotiation preserves older Studio/plugin handshakes. Old room-session v2 values remain readable, including deliberately stopped sessions.

`node src/modules/musicBoard/studio-selftest.mjs --fresh-full` exercises the actual browser sequence: open controls, add from default catalog in a nearly full room, start website audio, pair, and control both directions. Add `--reject-adoption` to force persistence failure and verify continuing audible website playback. Media uses a generated test tone; SDK/Peer signaling are fixtures, not native Owlbear UAT.
