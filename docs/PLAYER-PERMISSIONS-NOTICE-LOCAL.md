# DM player permissions notice — local candidate

2026-10-03. Based on the paired 240 release. No release/version change, push, merge or deployment.

## Behavior

- The paired Web workbench has one bold red “关于玩家分配卡和权限” button immediately after “音乐板”, visible only to GMs until acknowledged. No duplicate entry was added to the floating native toolbar.
- The button opens the dedicated Suite notice through the GM-only workbench console bridge. It reuses the original bilingual Owner guide and images from `announcement-important.ts`; the ordinary release announcement remains unchanged and collapsed by default.
- The dedicated modal requires a visible paint, settled image loading, current GM status and the actual bottom of its scroll container. Short content with no scrollbar qualifies after visible layout. Scrolling alone, opening, closing/dismissing and failed storage never acknowledge it.
- Only an explicit “我真的知道了” click (English: “I really understand”) writes its own per-browser/channel preference. It does not update release/daily acknowledgment keys. The Web entry reads host status at startup/reconnect, same-origin storage changes and focus/visibility return; it never writes a speculative read flag.
- Language changes reset the reading position. Content growth, scroll-away, hidden documents and revoked roles disable acknowledgment. Back/Forward restoration rechecks role and visible paint before enabling the button again.

## Verification

- `node tools/permission-notice-selftest.mjs`: 13 production-controller scenarios pass using deterministic DOM, storage and SDK boundaries.
- Paired Web `npx vitest run tests/playerPermissionNotice.test.ts`: 6 cases pass. The initial run failed before the new status implementation existed; its later run passed.
- Existing `startup-announcement-selftest.mjs`: 49 assertions pass; `announcement-inline-selftest.mjs`: 9; `announcement-scope-selftest.mjs` with the exact paired Web checkout: 45.
- Suite TypeScript check passes. Combined/final Web typecheck and builds are recorded in the parent task's final validation because other permissions changes share the worktree.
- `tools/permission-notice-browser-selftest.mjs` compiles the real Web navigation JSX, notice button and Suite modal successfully. It contains wide/narrow placement, player/GM role changes, early click/dismiss, scroll acknowledgment/persistence, language/content growth, short content and release-announcement regression scenarios.

## Limits

Browser execution could not start: local Chromium fails with `socket() failed: Operation not permitted`, including the reviewed escalated attempt. The cloud browser also rejected the local preview with `net::ERR_BLOCKED_BY_CLIENT`. No restriction workaround was used. Therefore this batch has no verified browser screenshots, DOM geometry or live Owlbear room/real-phone result; the browser cases are prepared, not reported as passed. The controller tests are simulated boundaries, not browser or room evidence.

To run the browser companion in a supported environment, set `DND_CARD_WEB_ROOT` to the exact paired Web checkout and `CHROMIUM_PATH` to an installed Chromium executable, then run `node tools/permission-notice-browser-selftest.mjs`. Artifacts are written to the ignored `.local-evidence/permission-notice` directory. `NOTICE_PREVIEW=1` serves the same compiled fixture for manual review.
