# Boss public health bar

This module is ready for the suite lifecycle to call `setupBossBar()` and `teardownBossBar()`. Add `boss-bar.html` to the existing Vite multi-page input. It does not require a new extension, action slot, modal, service, or third-party assets.

## Behavior / 使用方式

- DM right-clicks a visible character token with current/max HP → **Show as Boss / 显示为 Boss**. The matching Hide command removes it for everyone. **Boss display options / Boss 显示选项** contains only exact HP, an optional phase name, and 1–5 visual segments.
- Every client derives its own presentation from persistent token metadata `com.obr-suite/boss-bar/config`. Late joins/reloads read the scene; a session/version plus nonce replay handshake restores the iframe without depending on old broadcasts.
- The config stores `enabled`, `exact`, `phase`, `segments`, and activation `order`. Current/max HP are read from `com.obr-suite/bubbles/data`, falling back to `com.owlbear-rodeo-bubbles-extension/metadata`. Boss actions never write either HP source. Bound character-card and bestiary tokens work through those same HP fields.
- Default public payload contains name and ratio; current/max numbers are omitted until the DM explicitly enables exact HP. Custom phase text is authored content and is not automatically translated. UI controls are Chinese/English via the existing local language setting.
- Globally invisible tokens (`visible=false`), bubbles `hide`, deleted tokens, non-character items, and invalid/missing max HP do not appear, including on the GM client. This is a deliberately public encounter banner once the DM enables it; fog-of-war occlusion is not a per-player Boss reveal signal. Do not describe this as a dynamic-fog privacy filter.
- Up to **3** bars, in activation order then stable token ID. Enabling a fourth reports the cap. Imported/concurrently authored data over the cap still renders at most 3. Hiding one makes the next eligible configured Boss appear. A single bar is 600×60 px at most; two use 102 px height, three 144 px; width contracts with the viewport.
- Each client retains one overlay iframe. Ordinary HP changes use local messages; unrelated item fields do not publish or read again. There are no per-frame network writes, particles, or idle animation loops. A damage trail waits 180 ms then settles in 420 ms. Reduced motion skips the trail/transition. The system preference is followed until explicitly overridden.
- Closing via × sets the personal hidden preference; the DM’s persistent Boss config is untouched. Module stop and scene exit clear/close display and invalidate pending reads/writes. Role changes refresh public display and invalidate configuration edits. The options page never follows its old token into another scene.

## Settings integration

Import `getBossPreferences()` and `setBossPreferences(patch)` from `preferences.ts` (also re-exported by `index.ts`). Preferences are `{ hidden: boolean, reducedMotion: boolean }`, stored under `obr-suite/boss-bar/preferences`. The setter merges the given fields and broadcasts `com.obr-suite/boss-bar/preferences-changed` to **LOCAL** only. Expose a simple personal restore toggle (`hidden:false`) and reduced-motion checkbox. The room/module switch belongs to the existing suite state.

## Platform limit: transparent does not mean click-through

Checked the installed SDK 3.1.0 `lib/types/Popover.d.ts` and the official [Popover API](https://docs.owlbear.rodeo/extensions/apis/popover/): `hidePaper` removes the colored background; `disableClickAway` keeps the popover open. Neither is a host iframe pointer-events API. CSS inside an iframe cannot make the host iframe rectangle pass clicks through to the map.

This implementation therefore uses only the small top-center rectangle (maximum 600×144), transparent outside the bar artwork, with a personal close control. **That rectangle still intercepts input; full click-through is not claimed.** The [official viewport effect API](https://docs.owlbear.rodeo/extensions/reference/effects/) provides a scene shader alternative but no HTML/text texture API; this module does not synthesize fonts into shaders or open a fullscreen blocking overlay.

## Verification and remaining room acceptance

Run from the project root:

```
node src/modules/bossBar/selftest.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The test bundles the actual controller/model/page with controlled SDK boundaries. It covers late initial read after hiding, late iframe replay, HP source compatibility, no numeric fields in the default payload, 100 unrelated item snapshots with no reads/writes/messages, stable iframe, cap, hide/delete, delayed write after role revoke, scene exit during opening, and stop/restart. Four mutations must fail assertions: stale-read guard removal, visibility filtering removal, forced exact-number leak, and delayed-draft role guard removal.

Actual headless Chrome loads the real HTML/CSS/page module, verifies layout at 600 and 288 px, Chinese/English text, short damage trail/reduced motion, stale packet rejection, scene/role cleanup and replay, local hide/restore, and delayed configuration draft cancellation. It saves screenshots outside the repository under a printed temporary directory. The script uses the bundled Playwright package and installed Chrome, overridable with `CODEX_PLAYWRIGHT_DIR` and `BOSS_CHROME`.

These checks are **not** Owlbear room or multiplayer UAT. Still required after lifecycle/build integration: real DM+player clients, reload/late join, token hide/delete, all HP editors and transforms, scene switch, role switch, close/reopen/restore, browser zoom/resize, visible map input around the compact iframe, and actual device performance. No deployment is performed by this module/test.
