# Three-Dragon Ante · 三龙牌

Independent Owlbear Rodeo extension for the Legendary Edition base game, without expansions. Full Suite only links to this extension from Settings; it does not load the card engine, subscribe to the table, or provide a second in-suite launcher.

Dev install: `https://obr.dnd.center/three-dragon-ante-dev/manifest.json` (publication is recorded in the repository's current dev release notes).

The GM installs it in the room. Everyone uses its action button to open their own full-screen table. Closing the table returns to the map and keeps their seat. A compact mode is also available. The first table creator hosts the rules; this may be a different person from the room GM.

## Connection and persistence

- Room seating is stored in Owlbear room metadata. Game messages use Owlbear room broadcasts; no custom game server, WebSocket service, or PeerJS relay is introduced.
- The hosting browser runs the rules and saves the deck, hands and game in IndexedDB. Other seats receive their own encrypted projection using native P-256/HKDF/AES-GCM. Opponents' hand movements expose ordinal positions and card counts only, never private card identifiers or faces.
- Refreshing the host can recover its locally saved table. Closing the host's whole browser makes the table unavailable until that host returns. Clearing its browser storage loses the saved host game; there is no cloud backup or automatic replacement host.
- The website server serves static HTML, scripts, styles and original vector artwork. A server hosting cost is not a per-game simulation cost. Owlbear connectivity is still required for a shared game.
- The separate extension uses `com.fullpeople/three-dragon-ante` and its own IndexedDB name. Old Full Suite tables are not migrated into it; finish or reset those old games before starting a new table here.

## Practice and artwork

“Learn by playing” opens 41 local exercises: a fixed complete game, ten base-rule situations and thirty special-card exercises. Every move goes through the same rules engine as a room game. Step through opponents, choose your own cards, undo or restart. Practice neither writes room state nor joins an online game.

The tavern table, tilted card fans, vector engravings and animations are original code and artwork. No publisher card scans, rulebook pages or commercial illustrations are bundled. Rule descriptions are original summaries; the [publisher's Legendary Edition page](https://wizkids.com/three-dragon-ante-legendary-edition/) remains available in the table help.

## Development

From the repository root:

```text
npm ci --ignore-scripts
npm run build:three-dragon
```

The output is `extensions/three-dragon-ante/dist`, with `/three-dragon-ante-dev/` as its default base. Set `THREE_DRAGON_CHANNEL=stable` only for an explicitly intended stable build. Its manifest and background are independent of Full Suite's build. Tutorials load on demand; hand movements are coalesced to at most eight sends per second and send nothing while idle. Reduced motion disables movement, while cards and legal actions remain available.

Regression tools in `tools/three-dragon-*` target this directory. The older `src/modules/threeDragonAnte` files are retained as inactive historical source because the requested deletion/move was rejected by automatic approval review; neither Suite build entries nor module registration reference them.
