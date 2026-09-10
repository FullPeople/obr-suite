# Boss health display

The DM enables a visible character token with valid current/max HP using its Boss context menu. Up to three Bosses appear in deterministic order. Configuration still offers explicit exact HP, phase text and one to five visual segments; these actions do not modify HP or resource data.

## Display and input

The display is a fullscreen transparent **host modal** with `hidePaper:true`, `hideBackdrop:true` and `disablePointerEvents:true`, matching the existing Time Stop GM overlay and resource toast. This uses the [official Modal API](https://docs.owlbear.rodeo/extensions/apis/modal/) mouse/touch pass-through option. It no longer uses a display popover, whose official API has no host pass-through option. CSS inside an iframe is not the mechanism claimed to forward host input.

Artwork sits at bottom center, at most 600 pixels wide, with a default 104-pixel bottom inset. No close button or interactive control appears on the display. The old personal `hidden` field is ignored so previously hidden Bosses are visible again. Configuration remains a separate interactive popover.

The name prioritizes the native `Item.name` (the Accessibility name). Legacy bubbles-name metadata is only a fallback when that name is empty. Image painted text is not substituted for the native name.

Locked non-owner players receive exactly the same ceiling-step ratio policy as traditional HP bars, including threshold 0 and 100. The scene `com.obr-suite/bubbles/settings.playerThreshold` is shared; no second room threshold is added. GM, owner and unlocked views retain precise progress. The pre-existing explicit per-Boss exact-number option remains an intentional DM disclosure. Boss activation remains an explicit public encounter banner, not a new combat/fog gate.

## Ordinary bar replacement

Only IDs actually acknowledged as visible by the current Boss page replace their ordinary HP background/fill/text. AC indicators remain. Non-Boss tokens are unaffected. Suppression is local in-memory presentation state, never token metadata or HP data.

Session/version validation rejects stale page acknowledgements. Stop, scene exit, removal and an obstructed Boss layout release suppression. A presentation revision invalidates pending normal-bar reads/adds; late dispatched SDK additions are cleaned using their own IDs. Already-dispatched SDK operations cannot be cancelled.

## Root integration

`setupBossBar()` / `teardownBossBar()` retain the existing lifecycle contract. `setBossBarObstacles(rectangles)` accepts the current open host panels as `{left,top,width,height}` in viewport pixels. Do not feed all registered panel bboxes: several existing providers return expected rectangles even when closed. Artwork moves above intersecting rectangles; if no space remains it temporarily disappears and restores the ordinary HP bar. This updates page state without reopening its modal.

`getBossPreferences()` / `setBossPreferences(patch)` retain the local broadcast/storage contract. `bottomInset` defaults to 104 and is clamped to 88–360. `reducedMotion` follows the OS until overridden. The old `hidden` field remains readable for compatibility but has no display effect. Root owns actual open-panel/temporary-toast obstacle reporting and settings wiring; the module does not infer visibility from unrelated layout-editor registrations.

## Verification

From the canonical repository:

```
node src/modules/bossBar/selftest.mjs
node tools/boss-bubbles-selftest.mjs
node tools/bubbles-scale-selftest.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The Boss test exercises actual controller/model/page modules with controlled SDK transport, delayed reads/writes/open calls, page replay, metadata/name/threshold behavior, 100 irrelevant snapshots, cleanup and 6 uniquely applied source mutations. Compilation and missing mutation anchors happen outside mutation behavior acceptance. Chromium loads the real HTML/CSS, tests narrow/wide layout, transparency, damage/reduced-motion updates, removal of the close button, old-hidden preference compatibility, obstacles and config write cancellation. A separate **host-iframe fixture** implements the documented pointer-events contract and verifies real mouse clicks on the map beneath the Boss artwork, another control and wheel delivery. This fixture is not the native Owlbear host.

The actual SDK-builder integration test has 6 cases for HP-only suppression, preserved AC/ordinary tokens, 100 identical presentations with zero visual writes, restoration, a late normal-bar add and teardown. The unchanged scale/lifecycle suite passes 22 behavior checks. TypeScript passes. No new claim is made about live token gesture smoothness.

Current screenshots are printed by the test and kept outside the repository. Real DM/player Owlbear-room verification remains necessary for host modal coexistence/focus, actual lower-panel obstacle wiring, touch/device behavior and visual performance. There is no deployment or commit by this module task.
