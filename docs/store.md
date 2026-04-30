---
title: Full Suite
description: All-in-one TRPG extension bundling dice, initiative tracker, bestiary, character cards, global search, time stop, sync viewport, and portals — designed for D&D 5e play in Chinese / English.
author: FullPeople
image: https://raw.githubusercontent.com/FullPeople/obr-suite/main/docs/screenshots/hero.png
icon: https://obr.dnd.center/suite/exe_icon.png
tags:
  - dice
  - combat
  - tool
  - automation
  - content-pack
manifest: https://obr.dnd.center/suite/manifest.json
learn-more: https://github.com/FullPeople/obr-suite
---

# Full Suite

Full Suite is an all-in-one TRPG extension that ships eight modules under a single manifest install. Designed for D&D 5e play, fully bilingual (Chinese / English, switchable per-client), and self-hosted at [obr.dnd.center](https://obr.dnd.center).

![hero](https://raw.githubusercontent.com/FullPeople/obr-suite/main/docs/screenshots/hero.png)

## Modules

- **Dice** — Expression-based rolls with advantage / disadvantage, max / min clamps, triggered rerolls, exploding-on-max bursts, repeat blocks, and freely nestable wrappers. Multi-target rolls, dark rolls, click-to-replay history, synthesised SFX plus dice / cartoon samples for impact.
- **Initiative Tracker** — Top-anchored horizontal initiative strip with combat start, turn cycling, automatic camera focus, owner-aware roll and end-turn for player-owned tokens, and optional Dice+ integration with local-roll fallback.
- **Bestiary** — D&D 5e monster search with one-click spawn. Auto-popup stat-block on selection. Right-click any token to bind / replace / unbind a monster, with bubbles HP / AC / name auto-rewritten on bind.
- **Character Cards** — Parses Chinese D&D community xlsx character sheets (悲灵 v1.0.12 template) into a click-to-roll web view; the side popover surfaces when a bound token is selected. ↻ button on each card row re-imports the latest xlsx without re-uploading.
- **Global Search** — Top-right floating popover over the full 5etools data set. Hover to preview, click to pin. Custom data sources can be added under Settings → Libraries.
- **Time Stop** — DM-only freeze of player canvas input with cinematic letterbox bars.
- **Sync Viewport** — Pan every player's camera to a chosen point or the selected token, with a confirmation chime.
- **Portals** — Drag-circle scene portals. Same-tag portals are linked; dragging a token into one opens a destination picker that gathers every selected token to the chosen portal in a hex spiral. Bypasses Dynamic Fog's light-source rejection during the position update.

## Screenshots

![Dice](https://raw.githubusercontent.com/FullPeople/obr-suite/main/docs/screenshots/dice_roll.png)

![Initiative tracker](https://raw.githubusercontent.com/FullPeople/obr-suite/main/docs/screenshots/initiative.png)

![Character card](https://raw.githubusercontent.com/FullPeople/obr-suite/main/docs/screenshots/card.png)

![Portal](https://raw.githubusercontent.com/FullPeople/obr-suite/main/docs/screenshots/portal.png)

## Dice expression syntax

```
Basic              2d6 + 1d20 + 5
Advantage          adv(1d20)              roll twice, keep higher
Disadvantage       dis(1d20)              roll twice, keep lower
Elven Accuracy     adv(1d20, 2)           roll three times, keep highest
Floor              max(1d20, 10)          value not below 10
Ceiling            min(1d20, 15)          value not above 15
Triggered reroll   reset(1d20, 1)         reroll once when value equals 1
Burst              burst(2d6)             max-roll explodes; chain length 5
Repeat             repeat(3, 1d20+5)      3 independent rows, each its own total
Independent seg    adv(1d6) + adv(1d4)    two independent advantage rolls
Nested             adv(max(1d20, 10) + 5)
```

## 5etools tag integration

`{@dice}`, `{@damage}`, `{@hit}`, `{@d20}`, `{@chance}`, `{@scaledice}`, `{@scaledamage}`, `{@recharge}` are all click-to-roll inside search previews, monster panels, and character cards. Monster panels: left-click rolls open, right-click opens a context menu (Roll / Dark Roll / Advantage / Disadvantage / Add to Tray).

## License

Released under [GNU GPL-3.0](https://github.com/FullPeople/obr-suite/blob/main/LICENSE). Strong copyleft — view, modify, redistribute (including commercially); derivative works must keep GPL-3.0 and ship source. The `bubbles` module derives from [Stat Bubbles for D&D](https://github.com/SeamusFinlayson/Bubbles-for-Owlbear-Rodeo) by Seamus Finlayson, also GPL-3.0.

## Support

- Source code: [github.com/FullPeople/obr-suite](https://github.com/FullPeople/obr-suite)
- Issues: <1763086701@qq.com>
- The extension is self-hosted at obr.dnd.center on Alibaba Cloud, with continuous updates and bug fixes funded by Ko-fi / Afdian backers.
