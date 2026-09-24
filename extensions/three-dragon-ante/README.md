# Three-Dragon Ante · 三龙牌

Independent Owlbear Rodeo extension using the Legendary Edition base game with the user-supplied card pack's printed values and effects, without expansions. The four intentional rule differences are recorded in [the card-pack notes](../../docs/THREE_DRAGON_CARD_PACK_20260910.md). Full Suite only links to this extension from Settings; it does not load the card engine, subscribe to the table, or provide a second in-suite launcher.

Dev install: `https://obr.dnd.center/three-dragon-ante-dev/manifest.json` (publication is recorded in the repository's current dev release notes).

Browser practice preview: `https://obr.dnd.center/three-dragon-ante-dev/practice.html`. This separate entry needs no Owlbear login or room: it mounts the same local teaching table, with a full game or a direct hand-power exercise. Opponents act automatically. Its session is not saved across reloads; it is not an independent multiplayer service and does not expose the room-only omniscient/history/deck controls. The existing `index.html`, background and launcher remain the multiplayer extension entries.

Once this extension is enabled in the room, any player can create a table. Other players join, and the table creator starts the game with 2–6 seated players. The DM does not need to join or start it. Only the creator can start a game or return it to the lobby. The host-side editor is DM-only: it is offered to a room GM that is also serving the table, because the private hands exist only in that client and are never written to room metadata. Being the room GM grants exactly one extra capability: removing a seat while the table is still in its lobby, which is how an offline player stops blocking the start. The GM still cannot start, reset or otherwise control someone else's table, and the host authorizes every removal from the requester's authenticated connection plus its own room party read rather than from anything the requester claims.

Everyone uses its action button to open their own full-screen table. Closing the table returns to the map and keeps their seat. A compact mode is also available. The creator can also start or reset their table from another connected window; the original browser continues to run and save the game.

## Connection and persistence

- Room seating is stored in Owlbear room metadata. Game messages use Owlbear room broadcasts; no custom game server, WebSocket service, or PeerJS relay is introduced.
- The hosting browser runs the rules and saves the deck, hands and game in IndexedDB. Other seats receive their own encrypted projection using native P-256/HKDF/AES-GCM. Opponents' hand movements expose ordinal positions and card counts only, never private card identifiers or faces.
- Refreshing the host can recover its locally saved table. Closing the host's whole browser makes the table unavailable until that host returns. Clearing its browser storage loses the saved host game; there is no cloud backup or automatic replacement host.
- The website server serves static HTML, scripts, styles and card artwork. A server hosting cost is not a per-game simulation cost. Owlbear connectivity is still required for a shared game.
- The supplied-pack edition uses the `com.fullpeople/three-dragon-ante/pack-20260910` room and message namespace. All players must refresh and create a new table after updating from 0.2.x. Previous tables and local saves are left untouched; clients using different rule editions cannot join the same table.

## Practice and artwork

“How to play” opens a two-page illustrated introduction: game flow, then core rules. Important conditions are bold, with terms explained in the top-right corner. It covers round leadership, ante pricing, compulsory buying and game endings. Its practice entry opens 41 local exercises: a fixed complete game, ten base-rule situations and thirty special-card exercises. Every move goes through the same rules engine as a room game. Opponents act automatically between your choices; you can undo or restart. Practice neither writes room state nor joins an online game.

The round timber table has a bevelled top, padded rail, apron and pedestal, built from Three.js meshes. Widened flight regions carry their labels on the felt; cards overlap while exposing their strength corners. The 100 card fronts use the user's supplied scans, conventionally resized and compressed to WebP. Hovering shows only an enlarged front at its original aspect ratio in the top-right corner. No extra card frames or duplicated rules panels are drawn. The supplied reverse is excluded: every back retains the original single-dragon vector. Gold and silver use manually masked crops from the user's Waterdeep currency reference on extruded coin outlines. No AI-generated images are used. Fronts load only when visible; the background process does not import them. The scans retain their original copyright notices and are not claimed as original artwork. Rules reference: [WizKids Legendary Edition](https://wizkids.com/three-dragon-ante-legendary-edition/).

The creator can set initial gold per player (10–1000) and initial cards (3–10) before starting. Defaults remain players × 10 gold and 6 cards; the hand limit remains 10. The serving controller validates the values and creator permission. Custom currency totals persist for recovery conservation checks; older saves retain their original default budget.

The **本局信息 / table info** surface (public timeline drawer, timeline replay, on-table replay lens, current-card ledger and public action queue) was **removed on 2026-09-14** and is being rebuilt; its projection, protocol and transport plumbing (`history`, `PublicReplayFrame`, `historyPage`) is deliberately still intact so the rebuild starts from the existing verified data path. Its regression runner is parked at `tools/retired/` with the removal recorded. Until it returns, the physical discard pile remains the only public card record on the table: click it to inspect the top card. There is also no user-facing quality switch any more — see the stage README for the bounded automatic profile.

The lobby exposes the reviewed rule set plus either a random pool of 10 from 30 special cards or a host-selected pool of exactly 10. The selected rule/deck version and its summary stay visible while configuring; the selected deck uses lazy-loaded printed-face tiles so the host can review the actual cards without loading the whole pack up front. The choice is frozen into the new game and table summary; it cannot be changed mid-game. The table creator also has a confirmation-gated, local-only omniscient inspection toggle. It shows opponents' hands and hidden antes only in that creator's current browser, never in room metadata, remote messages, public history or player projections, and it cannot bypass legal actions.

Round and turn changes have central animated banners. Scoring shows each public card's contribution, special bonuses and payouts before the next-round announcement. Its immutable public report is shared with players and spectators, without exposing private hands. Reduced motion retains the calculation steps; reconnecting, undoing or reopening does not replay old announcements.

Public flights with three eligible cards receive a restrained combination mark:
same-color, same-strength and all-mortal flights use distinct table silhouettes
and the DOM fallback uses the matching localized badge. A hand card whose
engine-authored hint says its power will trigger also gets a small family mark
and edge treatment; this is silent and finite until the actual power resolves.

## Playing at the table

Drag a card from your hand to your own face-down slot to commit an ante, or to your own face-up flight when it is your turn. There is no betting or ordinary-play confirmation button. A curved guide, lifted card, flip and landing animation show the move. Opponent hover and selection animate anonymous card backs only. Gold transfers follow actual rules results; decorative silver is visual change (ten pieces represent one gold), not another rules currency.

A submitted card waits for the hosting browser's matching action receipt. Normal room updates cannot accept it. After a timeout, retry resends the same action ID and revision; a confirmed rejection returns to the current legal hand. If the table page updates while an old background is still running, it asks for a full Owlbear refresh before playing.

Live multiplayer powers show the card and its full effect to the creator, other players and spectators. Each viewer clicks to close their own explanation. Ordinary metadata/private-hand synchronization and coalesced updates preserve new effects; reconnecting or reopening does not replay old powers. Seats follow clockwise turn order. Instructions identify clockwise or counterclockwise neighbors explicitly, including the previous player's card used for the normal power comparison.

Keyboard: focus the table, use Left/Right to choose, Space to lift, Enter to place in your own slot, and Escape to cancel. Special abilities retain their required choices and confirmation. Without WebGL, an accessible DOM table supports dragging and the same keyboard actions. Reduced motion keeps all rules and input available while suppressing movement.

## Development

From the repository root:

```text
npm ci --ignore-scripts
npm run build:three-dragon
node extensions/three-dragon-ante/src/game/privacy-selftest.mjs
```

The output is `extensions/three-dragon-ante/dist`, with `/three-dragon-ante-dev/` as its default base. Set `THREE_DRAGON_CHANNEL=stable` only for an explicitly intended stable build. Its manifest and background are independent of Full Suite's build. The 3D renderer has a separate table-only bundle; the background does not load it. Tutorials load on demand; hand movements are coalesced to at most eight sends per second and send nothing while idle. Reduced motion disables movement, while cards and legal actions remain available.

`node tools/three-dragon-deployment-smoke.mjs local` serves and checks the actual production output, including desktop/mobile browser practice, legal input, undo, exit/re-entry and no external room requests. Passing an HTTPS base ending in `/three-dragon-ante-dev/` verifies the deployed bytes and repeats those browser checks. This does not replace native Owlbear or physical-device UAT.

The privacy self-test builds the actual rules projections and checks that a host-only omniscient view cannot enter `PublicWire`, `SeatWire`, a LOCAL chunk payload, or the receiver's reconstructed view. It also runs two deliberate allowlist mutations and requires both to fail on named assertions. This is a transport/projection regression gate, not a substitute for two-window network or mobile UAT.

Regression tools in `tools/three-dragon-*` target this directory. The older `src/modules/threeDragonAnte` files are retained as inactive historical source because the requested deletion/move was rejected by automatic approval review; neither Suite build entries nor module registration reference them.

Each seat has a single aligned region pair: ante immediately left of flight, at the same radial depth. Coins sit directly on top of that seat's ante card, with small stable offsets and no extra tray. The far card corners stay exposed; coins do not intercept card inspection. Deck and discard always face the screen, and settled coin faces stay upright. Two-to-six-seat tests populate both flights and antes.
