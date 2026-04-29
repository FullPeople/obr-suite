# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-04-29

Quality-of-life improvements after the public 1.0.0 launch.

### Added

- **Character card refresh** — every card row in the cc-panel side list now has a `↻` button that re-opens a file picker for the same xlsx. The server's new `/api/character/refresh` endpoint overwrites the existing card's `data.json` + rendered HTML in place, and broadcasts to other clients so all open card iframes reload simultaneously. Replaces the delete-and-re-upload workaround. (FSA-based persistent handles attempted then dropped — cross-origin iframes block the API.)
- **Bestiary "auto-add to initiative on spawn" toggle** — Settings → 怪物图鉴 now exposes `bestiaryAutoInitiative` (default ON, persisted in scene metadata). When OFF, freshly-spawned monsters skip the initiative metadata so the DM can pre-stage tokens during prep without polluting the initiative bar.
- **Token bestiary bind / replace / unbind context menus** — right-click any token to attach (or detach) a bestiary monster reference, automatically rewriting bubbles HP / AC / name / DEX modifier.
- **Backers credits block** — Support tab lists named Afdian backers as rainbow-glowing chips, animation phase staggered by index so the row ripples instead of pulsing in lockstep.

### Fixed

- Dice `refreshBadges()` was double-counting un-wrapped dice (1d20 displayed badge "2") because the backward-compat shim aliased `parsed.plain` to `outerPlain` for zero-segment expressions. Iterates `segments[*].plain` + `outerPlain` explicitly now.
- One-shot legacy portal item migration: portals created when `ICON_SIZE` was 96 are silently bumped to the current 64×64 on bestiary tool setup, killing the "content size 96 does not match image size 64" OBR warning.

### Removed

- Hidden-iframe HTTP-cache prewarm experiment for 不全书 — the site is fronted by a Cloudflare bot challenge, the prewarm iframe never finishes booting (CSP violations + 404s on the challenge's scripts), and the cache never gets primed. Reverted to honest cold-loading on every cc-panel open.

### Distribution

- Submitted to the OBR Extension Showcase via [PR owlbear-rodeo/extensions#142](https://github.com/owlbear-rodeo/extensions/pull/142). Awaiting review.

## [1.0.0] — 2026-04-28

First public release. Renamed from "枭熊插件 / Owl Suite" (working title) to **Full Suite**.

### Modules

- **Dice** — top-left action popover panel. Expression parser supporting `adv`, `dis`, `max`, `min`, `reset`, `burst`, `same`, `repeat`, with independent multi-segment parsing (`adv(1d6)+adv(1d4)` rolls two separate advantage rolls). Per-token quick rolls via 5etools tag click handlers. Right-click context menu: Roll / Dark Roll / Advantage / Disadvantage / Add to Tray. Dice history popover (bottom-left) with player rows, click-to-detail, and click-to-replay speech bubbles above involved tokens. Web Audio sample playback (`dice.mp3` per die, `cartoon.mp3` for the climax punch) plus synthesized SFX for the rest of the animation pipeline. Cross-iframe SFX broadcast so the action panel iframe can play sounds when the dice-effect modal can't.
- **Initiative Tracker** — top-anchored horizontal strip with combat start, turn cycling, automatic camera focus, owner-aware roll and end-turn for player-owned tokens, optional Dice+ integration with local-roll fallback.
- **Bestiary** — DM-only side panel with 5etools monster search and one-click spawn. Auto-popup monster info on token select. Right-click context menu on tokens: Bind Monster (no slug) / Replace Monster (has slug) / Unbind Monster, with bubbles HP/AC and name auto-rewritten on bind.
- **Character Cards** — xlsx upload, parsed to a web view via the bundled Chinese D&D community 悲灵 v1.0.12 template, owner-aware quick rolls on ability scores, skills, weapon attack and damage, and clickable Trait / Feat / Spell chips that fill the global search input.
- **Global Search** — top-right floating popover over the kiwee.top 5etools mirror. Hover-to-preview right pane, click-to-pin. Settings → Libraries supports adding custom data sources following the same `search/index.json` + `data/*.json` layout.
- **Time Stop** — DM right-click action that disables player canvas input and fades cinematic black bars in/out for everyone.
- **Sync Viewport** — DM-triggered camera pan that moves every player's view to a target point or selected token, with confirmation chime.
- **Portals** — left-rail tool. Drag-circle creates a scene portal; same-tag portals teleport multi-selected tokens in a hex spiral. Editing popover provides name and tag input with localStorage-backed presets. Token light metadata is snapshot, removed during the position update, and restored 1:1 afterward to bypass the Dynamic Fog extension's light-source rejection. Drag-end detection only — programmatic position changes from teleport itself are suppressed via a 700 ms `recentlyTeleported` window so the destination doesn't immediately re-trigger the portal panel.

### UI

- Cluster popover (bottom-right) with module toggles, language switch, and inline action shortcuts.
- Settings popover (centered, tabbed) for module enable/disable, data version (2014 / 2024 / all), language, sound, support links, and library management.
- Bilingual UI throughout (CN / EN), per-client localStorage preference.
- All Chinese-character UI icons replaced with vector SVG glyphs.

### Tooling and infrastructure

- Vite build with manualChunks-isolated `vendor` chunk to avoid circular ESM dep between the OBR SDK runtime and user code.
- Self-hosted at `obr.dnd.center` (Alibaba Cloud) with Let's Encrypt HTTPS and an nginx config that disables HTML caching to prevent stale references to old hashed JS chunks after redeploys.
- License: PolyForm Noncommercial 1.0.0.
