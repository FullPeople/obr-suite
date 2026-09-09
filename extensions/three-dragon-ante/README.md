# Three-Dragon Ante · 三龙牌

Independent Owlbear Rodeo extension using the Legendary Edition base game with the user-supplied card pack's printed values and effects, without expansions. The four intentional rule differences are recorded in [the card-pack notes](../../docs/THREE_DRAGON_CARD_PACK_20260910.md). Full Suite only links to this extension from Settings; it does not load the card engine, subscribe to the table, or provide a second in-suite launcher.

Dev install: `https://obr.dnd.center/three-dragon-ante-dev/manifest.json` (publication is recorded in the repository's current dev release notes).

Once this extension is enabled in the room, any player can create a table. Other players join, and the table creator starts the game with 2–6 seated players. The DM does not need to join or start it. Only the creator can start a game or return it to the lobby; being the room GM does not grant control of someone else's table.

Everyone uses its action button to open their own full-screen table. Closing the table returns to the map and keeps their seat. A compact mode is also available. The creator can also start or reset their table from another connected window; the original browser continues to run and save the game.

## Connection and persistence

- Room seating is stored in Owlbear room metadata. Game messages use Owlbear room broadcasts; no custom game server, WebSocket service, or PeerJS relay is introduced.
- The hosting browser runs the rules and saves the deck, hands and game in IndexedDB. Other seats receive their own encrypted projection using native P-256/HKDF/AES-GCM. Opponents' hand movements expose ordinal positions and card counts only, never private card identifiers or faces.
- Refreshing the host can recover its locally saved table. Closing the host's whole browser makes the table unavailable until that host returns. Clearing its browser storage loses the saved host game; there is no cloud backup or automatic replacement host.
- The website server serves static HTML, scripts, styles and card artwork. A server hosting cost is not a per-game simulation cost. Owlbear connectivity is still required for a shared game.
- The supplied-pack edition uses the `com.fullpeople/three-dragon-ante/pack-20260910` room and message namespace. All players must refresh and create a new table after updating from 0.2.x. Previous tables and local saves are left untouched; clients using different rule editions cannot join the same table.

## Practice and artwork

“How to play” opens a six-page illustrated introduction to the table zones, turn sequence, compulsory buying and game endings. Its practice entry opens 41 local exercises: a fixed complete game, ten base-rule situations and thirty special-card exercises. Every move goes through the same rules engine as a room game. Opponents act automatically between your choices; you can undo or restart. Practice neither writes room state nor joins an online game.

The tavern table, thick double-sided cards, tilted hand fans and bounded gold/silver stacks are actual Three.js meshes. The 100 card fronts use the user's supplied scans, conventionally resized and compressed to WebP. Chinese card names and printed descriptions match that pack; extra rules explanations appear separately. The supplied reverse is excluded: every back retains the original single-dragon vector. No AI-generated images are used. Fronts load only when visible; the background process does not import them. Felt, wood and coins are drawn locally from code. The scans retain their original copyright notices and are not claimed as original artwork. The [publisher's Legendary Edition page](https://wizkids.com/three-dragon-ante-legendary-edition/) remains available in the table help.

Round and turn changes have central animated banners. Scoring shows each public card's contribution, special bonuses and payouts before the next-round announcement. Its immutable public report is shared with players and spectators, without exposing private hands. Reduced motion retains the calculation steps; reconnecting, undoing or reopening does not replay old announcements.

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
```

The output is `extensions/three-dragon-ante/dist`, with `/three-dragon-ante-dev/` as its default base. Set `THREE_DRAGON_CHANNEL=stable` only for an explicitly intended stable build. Its manifest and background are independent of Full Suite's build. The 3D renderer has a separate table-only bundle; the background does not load it. Tutorials load on demand; hand movements are coalesced to at most eight sends per second and send nothing while idle. Reduced motion disables movement, while cards and legal actions remain available.

Regression tools in `tools/three-dragon-*` target this directory. The older `src/modules/threeDragonAnte` files are retained as inactive historical source because the requested deletion/move was rejected by automatic approval review; neither Suite build entries nor module registration reference them.
