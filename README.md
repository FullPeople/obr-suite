# Full Suite

<p align="center">
  <img src="docs/screenshots/hero.png" alt="Full Suite" width="900" />
</p>

An [Owlbear Rodeo](https://owlbear.rodeo) extension that bundles nine modules behind a single manifest: dynamic fog, dice, initiative tracker, bestiary, character cards, global search, time stop, sync viewport, and portals.

```
https://obr.dnd.center/suite/manifest.json
```

<sub>Testing channel (may break, not for tables you care about): `https://obr.dnd.center/suite-dev/manifest-dev.json` — install one or the other, never both in the same room.</sub>

Stable **1.3.0** and Dev **1.0.152-dev** are deployed from the same reviewed source. This release fixes live settings refresh, advances the short-rest clock in discrete steps, simplifies vision ownership, changes module defaults, and presents a collapsible changelog. See the [release record and short test checklist](docs/RELEASE_20260909_SUITE_1_3_0.md).

Standalone **Three-Dragon Ante 0.3.1-dev** is deployed with a round 3D table, aligned ante/flight regions for 2–6 players and supplied gold/silver coins directly over each player's ante card. Cards retain their original proportions and single-dragon vector backs; the top-right preview shows the enlarged front only. Creators can configure initial gold and hand size, and the simplified two-page guide explains the full game and core rules. The 100 supplied fronts, approved printed-rule differences, live ability explanations, round banners and staged scoring remain. Everyone refreshes; existing 0.3.0 tables remain compatible. [Install the optional card table](https://obr.dnd.center/three-dragon-ante-dev/manifest.json) and use its [release record and test checklist](docs/RELEASE_20260910_THREE_DRAGON_0_3_1.md). Music Studio remains online. Complete English XLSX downloads and character-server parser patches remain outside this release.

---

## <img src="docs/icons/translate.svg" width="16" align="center" /> Documentation

| | |
|---|---|
| <img src="docs/icons/translate.svg" width="14" align="center" /> 中文 | [README.zh.md](./README.zh.md) |
| <img src="docs/icons/translate.svg" width="14" align="center" /> English | [README.en.md](./README.en.md) |

Verified running versions as of 2026-09-08: stable **1.2.2**, dev **1.0.148-dev**. See the [source and deployment baseline](./docs/DEPLOYMENT_BASELINE_20260908.md) for reproduced build fingerprints and the distinction between installed and unreleased changes.

The [product review and roadmap](./docs/PRODUCT_REVIEW_20260908.md) covers loading and interface improvements, party vision, Boss bars, Three-Dragon Ante, English localization, music, transitions, and longer-term research. The user has canceled shared pointers and moved Three-Dragon Ante into an independent extension. Proposed features are explicitly marked as unimplemented.

---

## License

[GNU General Public License v3.0](./LICENSE) — strong copyleft. Copy / modify / redistribute / use commercially, provided derivative works keep the GPL-3.0 license and source.

Copyright © 2026 FullPeople — [github.com/FullPeople](https://github.com/FullPeople)

The `bubbles` module is informed by [Stat Bubbles for D&D](https://github.com/SeamusFinlayson/Bubbles-for-Owlbear-Rodeo) by Seamus Finlayson, also under GPL-3.0.
