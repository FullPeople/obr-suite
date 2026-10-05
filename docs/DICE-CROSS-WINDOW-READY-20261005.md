# Cross-window dice readiness, 2026-10-05

## Scope and release boundary

This candidate is based on Suite dev `8e2cd6fd0fe969d36694338457e9e4d3428c1c00`, whose runtime remains release 246 (`be3b13df39477491dda0b6ec152b1bf836e22b4a`). Its paired Web is `46dd3287d11866bff057a428baeac9336c57a978`, whose runtime is `2bfc832916896e85aa22b4f36f3ba66a7bae6749`.

It does **not** include the separately published ready-tail candidate `a23de258f7dd8bd4a541a9e58dfba355a574411f`. Neither merge nor deployment is part of this change. No physics results, audience/permission rules, render quality, background rendering policy, focus behavior, or non-dice product data are changed.

## Source findings

- Character-card and Owlbear interfaces can be separate visible windows. The renderer uses its own `document.hidden` and WebGL context state, not window blur. Prepared trajectory acknowledgements are not gated on animation frames.
- The warm Web `RollPicker`/`DiceFrame` → `platform/workbench` → Suite dice RPC path posts immediately. It does not deliberately wait for the next 500 ms readiness poll or enter the ordinary document-write queue.
- Each quick-popup mount nevertheless requested the entire dice history despite having no history subscription. With 100 completed results, each mount created 200 unnecessary LOCAL SDK messages on the same paced queue as new trajectory traffic. Closing that popup did not cancel the host's already-started replay.
- A prepared receiver with an uncalibrated peer clock checked readiness on a 150 ms timer. A valid pong updated the clock without waking that ready check. Background timer delay could extend this otherwise unnecessary wait.

## Changes

1. Ask for bootstrap history only after the page's ready callback has installed a nonempty `com.obr-suite/dice-roll` subscription. The full panel keeps its history request; quick composers skip it.
2. A fully validated pong immediately wakes the matching prepared inbound traces. Each trace retains one fallback timer bounded by the existing 30/120 second inbound lifetime; completion, cancellation, session replacement and disposal clear its timer. The receive lane does not wait for the ready-send SDK acknowledgement.

## Deterministic evidence

- The same ready-clock harness against the immutable base fails the expected event-wakeup/cleanup assertions; the candidate passes 18/18. Nonce, timestamp, wrong-sender, unprepared renderer, pending role validation, session restart, cancellation, duplicate pong, delayed SDK acknowledgement and disposal boundaries are covered.
- The actual SDK facade and actual quick-page script, host `dice3dRpc` history policy and production paced queue execute in a controlled VM. With 100 saved results and three quick mounts, unused history RPCs fall from 3 to 0 and LOCAL replay messages from 600 to 0. The same-byte offer + three-chunk + tail sequence occupies 1500 ms in the baseline virtual clock versus 400 ms after the fix. These are queue-model observations, **not device latency measurements**.
- Existing clock (27 checks), controller disposal (48 checks), idle lifecycle, history and dice-controller tests plus root/3D TypeScript checks pass locally.

## Bounded browser checks

`dice-quick-history-browser.mjs` runs the actual compiled quick and full-panel DOM against a synthetic parent RPC host. It checks repeated quick click/close, 100-record full history, current results, role filtering and reopening.

`dice-cross-window-browser.mjs` builds the actual paired Web `RollPicker`, `DiceFrame`, and `platform/workbench` code. A separate browser window opens through `window.open`; quick clicks travel through its real iframe bridge to a synthetic Owlbear host. The headed CI case arranges both windows side by side and records their visibility/focus independently. It also covers a hidden host tab with a visible card window, returning visible without duplicate submission, full history, and rejection of a sibling's forged iframe message. This covers the real client/opener bridge, **not** a real Owlbear room, authoritative physical simulation or first-visible-die timing.

Both browser runners explicitly remove Playwright's three default flags that disable background timer throttling/renderer backgrounding. Local browser execution is not claimed; the exact published commit's CI result is required.

## Prior evidence limitation

The earlier general latency runner used `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`; its “card-quick-rpc” case invoked the host RPC directly, bypassing the external card, iframe initialization and opener/relay bridge. Those results cannot establish natural cross-window click-to-visible-die latency. This candidate removes two code-proven waits/traffic sources; it does not establish that the user's complete immediate-display requirement is now met on every device.
