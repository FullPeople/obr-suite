# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.7] — 2026-04-29

Polish pass on the bestiary group-saves popover (introduced in 1.0.6).

### Added

- **Right-click context menu on each ability button.** Right-clicking 力量 / 敏捷 / 体质 / 智力 / 感知 / 魅力 (or Str / Dex / Con / Int / Wis / Cha in EN) opens the suite's standard rollable context menu in a new "groupSave" mode: 投掷 / 暗骰 / 优势 / 劣势 (the 添加到骰盘 entry is intentionally hidden because each token has a different per-bonus expression and a single tray entry can't represent the group). The menu broadcasts to a new `BC_GROUP_SAVE_FIRE` channel that carries `{ ability, hidden?, advMode? }`; the bestiary group-saves bg module receives the broadcast and fires per-token rolls with each monster's own save bonus, propagating the dark-roll / advantage flags through the existing `fireQuickRoll → handleQuickRoll → broadcastDiceRoll` pipeline.

### Changed

- **Full ability names instead of one-character abbreviations.** Buttons used to show a single ZH character (力 / 敏 / 体 / 智 / 感 / 魅) — the popover is wide enough to show the full word, so the labels now read 力量 / 敏捷 / 体质 / 智力 / 感知 / 魅力. EN labels stay at the standard three-letter abbreviation (Str / Dex / Con / Int / Wis / Cha) which is the canonical D&D form. The hint line changed to "左键投掷 · 右键更多" / "left-click roll · right-click more" so the new gesture is discoverable.
- **Bigger border-radius + safer corner padding to match the suite's rounded popover host.** Bumped `.box` border-radius from 10 → 16 px (cluster uses 14, the suite's host clips at ~12-14, so 16 leaves a margin on both sides), inset the box 1px so the host's own border doesn't eat our edge, and bumped `.row` padding from 6 → 8/10 px so the bottom-corner buttons sit clear of the 16px arc.

### Fixed

- **`dice-rollable-menu.html` now respects a `?groupSave=1&ability=<key>` mode.** When the URL carries those params, the menu drops the 添加到骰盘 / Add to Tray item and routes 投掷 / 暗骰 / 优势 / 劣势 clicks to `BC_GROUP_SAVE_FIRE` instead of `BC_QUICK_ROLL`. Single-roll callers (bestiary monster info, character card info, search preview) are unaffected.

## [1.0.6] — 2026-04-29

### Added

- **Bestiary group-saves popover.** When the GM selects 2+ tokens that are ALL bound to bestiary monsters, a 360×96 popover auto-shows just below the initiative tracker's collapsed position (top=95, centered) with six ability buttons (STR / DEX / CON / INT / WIS / CHA). Clicking any ability fires a collective save: each selected token rolls 1d20 + its OWN save bonus (proficient saves use the listed `m.save.<ability>`, otherwise the floor((score-10)/2) modifier). All N rolls share one collectiveId so they appear as one collective row in the dice history popover. Popover hides automatically when the selection changes to anything other than ≥2 monsters.
  - New module `src/modules/bestiary/group-saves.ts` (paired lifecycle with the bestiary module's setup/teardown).
  - New iframe `bestiary-group-saves.html` (inline ESM script, reads `localStorage["obr-suite/lang"]` for ZH / EN labels). Wired into Vite's `rollupOptions.input`.

### Changed

- **Dice panel collective camera focus skips zoom-to-fit when the bbox already fits in the viewport.** Earlier every multi-target roll called `OBR.viewport.animateToBounds(bbox)`, which yanked the GM's framing closer even when they were already zoomed wide enough to see everything. Now the focus path projects the bbox corners through the current viewport transform; if they all land inside `[0, vw] × [0, vh]` (with 2px slack), the camera stays put. Only fires `animateToBounds` when at least one target sits off-screen or partially clipped — i.e. when the user genuinely needs the camera to move.

## [1.0.5] — 2026-04-29

Redesign of the collective-roll display in the dice history popover, reverting 1.0.4's aggregate-total approach.

### Changed

- **Collective rolls now render as one independent pill per member.** 1.0.4 concatenated every member's dice into one strip with a sum-of-totals on the right. Per user feedback that's not the right mental model — each token's roll should stand on its own. Rebuilt as a `.member-strip` flex-wrap container holding one `.member-card` per token, each showing that token's own dice + modifier + total in a small bordered box. The strip wraps when there are too many cards to fit on one line. No aggregate total. Same layout used in BOTH the popover row (each player's latest collective) and the detail view's collective entry.
- **Collective entries in the detail view now use the standard `.entry` chrome** (with a green left-border `.coll-entry` modifier) instead of the bespoke `.coll-box / .coll-head / .coll-members / .entry-tight` structure. The `.entry` click-to-replay handler picks them up automatically — no special wiring needed.

### Fixed

- **Detail-view collective entries used to render as 0-height non-clickable items.** The previous `.coll-box > .coll-members > .entry-tight × N` structure had a layout interaction with the recent `.formula > .dice-list + .total` split that collapsed the inner rows. Replacing it with the unified `.entry.coll-entry > .body > .member-strip` structure both fixes the layout and routes clicks through the existing `.entry` handler so each collective is reliably clickable to fire the replay overlay.

## [1.0.4] — 2026-04-29

### Changed

- **Dice history popover row now aggregates collective rolls.** Previously a 4-token collective showed only the head token's dice on the popover row (e.g. "🎲6 = 6"), forcing the user to click into the detail view to see the other 3 tokens' results. Now collective rows concatenate every member's dice into one strip and display the sum-of-totals on the right with a "∑" prefix and green tint, so a 4-token 1d6 collective reads as "🎲6 🎲4 🎲2 🎲5 ∑ = 17" at a glance. Per-member modifiers are intentionally not shown separately — they're already baked into each member's total, and stacking "+5 +5 +5 +5" would be visual noise. Solo rolls keep the existing per-entry formula.
- **Dice chips wrap to multiple lines when crowded, total stays right-anchored.** Restructured the `.formula` row into a `.dice-list` (flex-wrapping) + `.total` (sticky right) two-column flex layout. Earlier the row used `flex-wrap:nowrap; overflow:hidden; white-space:nowrap`, which silently clipped long dice strips (e.g. a `repeat(5, 2d20)` rolled across multiple targets). Now the strip wraps to as many lines as it needs while the sum/total stays pinned to the right edge of the row.

## [1.0.3] — 2026-04-29

### Fixed

- **Dice history detail-view crash on collective rolls.** Clicking a player row whose latest roll was part of a collective threw `Cannot read properties of null (reading 'collectiveId')` and froze the slide-in detail view, leaving the user staring at the popover row's single head-token formula with no way to inspect every member of the group. Root cause was a long-standing logic bug in `renderDetail`: it tracked "already-grouped" entries by setting them to `null` in the local `entries` array, but the outer `while (i < entries.length)` loop didn't skip nullified positions, so the next iteration crashed on `entries[i].collectiveId`. Replaced with a `Set<number>` of consumed indices that both loops respect — entries array stays untouched, no null state to trip over.

## [1.0.2] — 2026-04-29

UI English-localization sweep. The cluster + Settings + Initiative panels were already bilingual since 1.0.0; this pass closes the remaining gaps so the EN-mode user no longer sees Chinese chrome in the dice / portal / character-card / search / bestiary popovers.

### Added

- ~100 new translation keys in `src/i18n.ts` covering: dice panel (tabs, dice hint, expression-rules guide × 10 lines, examples, action buttons, combo card buttons, history empty/all, formatAgo, shake reasons, prompts), dice history popover (title, dark/collective tags, player, back, empty states, formatAgo), dice rollable context menu, dice replay overlay hint, portal edit (title, name/tag inputs, presets, delete confirm), portal destination modal (title, sub line, empty, hidden tag, cancel), portal tool labels and `(unnamed)` fallback, character-card bind modal (title, unbind, loading, footer hint, current/deleted), character-card panel (download template, choose-file button, refresh hint, empty states, upload/refresh status messages, timeAgo), search-bar aria-label, bestiary panel (DM-only, picker hint, search placeholder, sort title, empty, loading).
- New `applyI18nDom(lang, root?)` helper in `i18n.ts` that walks the DOM and translates elements carrying `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-title` / `data-i18n-aria` attributes. Iframes apply translations once at startup and re-apply via `onLangChange` so toggling the language in Settings updates open popovers immediately.
- HTML files annotated with `data-i18n*` attributes. Inline-script iframes (`dice-rollable-menu`, `portal-destination`, `dice-replay`) read `localStorage["obr-suite/lang"]` directly to translate before the OBR SDK boots, since they import OBR via the esm.sh CDN and can't reach the bundled `i18n.ts`.

### Fixed

- EN-mode users no longer see Chinese in: dice panel tabs ("投掷"/"组合"/"历史"), dice expression rules block, dice rollable right-click menu, dice history popover ("投骰记录" / "暗" / "集体" / "← 返回"), portal create/edit popover ("传送门" title / "新建传送门" / "删除传送门"), portal destination modal ("选择目的地（N 个单位）"), character-card bind modal, character-card panel side rail (download/upload hints, refresh tooltips), bestiary panel (search placeholder / sort / empty / picker hint), search-bar aria-label.
- Dynamic strings produced by `panel-page.ts` / `history-page.ts` / `edit-page.ts` (combo names, history filter buttons, "刚刚" / "min 前" relative timestamps, error toasts, confirm prompts) now go through `t(lang, key)` instead of hardcoded Chinese.

### Notes

- Data-layer text (5etools tag rendering, monster stat-block labels in `monster-info-page.ts`, character-card stat labels in `info-page.ts`, search category names) intentionally NOT translated — those describe game data semantics, not suite chrome.
- The default portal name presets (`一楼/二楼/三楼/地下室`) live in localStorage on first use and are user-editable, so they're left as-is rather than being i18n'd.

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
