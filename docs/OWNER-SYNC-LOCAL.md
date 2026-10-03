# 2026-10-03 Owlbear cold-load and native Owner synchronization candidate

## Baseline and scope

Isolated Suite branch `fix/owner-sync-20261003` starts from remote dev `c66ce15ae2a1401238ceba84c13a757e8e7ebe15`; paired Web starts from main `112e3d0ed07cf9b2579ec2c62f56594a9ef92134`. Both were fetched and rechecked. The 238/239/240 work and release receipts remain ancestors. Version numbers and announcements were not advanced. No production service, real character record, original working tree or unrelated project was changed. This is a local review candidate, not a deployed release.

## Changes

- A failed first relay selection previously remained marked delivered, so unchanged refreshes could suppress it indefinitely. Failed view publications now release only their own latest-viewer deduplication marker. The next normal refresh rebuilds with current access. No mutation or ACK is automatically replayed.
- The paired Web completes only its explicit latest pending selection from matching authorized warm data. It retries hello with backoff while that request remains loading; it does not issue selection commands that could change map-follow semantics.
- Native OBR `Item.createdUserId` remains the ownership source. Historical importer assignments and custom owner metadata are not new write grants. Authoritative SDK getters recover missed events and run immediately before mutation transmission, after hashing, registration and compression.
- Per-card/per-token grant generations survive revoke-then-regrant transitions. Current role/scene is global; unrelated token ownership changes do not cancel another card's valid edit. Host commands compare against their original issued access and scoped targets, including inventory and condition history participants.
- Saves, inventory synchronization and native metadata writes recheck authorization at asynchronous boundaries. Queued/expired/cancelled unsent intentions are rejected. Known committed writes retain successful receipts with projection warnings; an unlinked newly saved monster document is explicitly uncertain rather than described as never written.
- One bold red DM entry appears to the right of the Web workbench's Music Board. It opens the existing native guide body. Only a visible, image-settled bottom plus the explicit acknowledgment saves the independent browser/channel read flag. Close, unread, role loss and storage failure do not hide it. See [guide scope](PLAYER-PERMISSIONS-NOTICE-LOCAL.md).

## Verification

- Web: 825 unit tests passed, 25 external-data conditional skips; TypeScript and integrated/standalone builds passed.
- Suite: TypeScript, stable host with paired native card viewer, and dev host builds passed. The aggregate runner contains 25 groups, including new authority, cold SDK, delivery recovery and notice controller tests.
- Actual installed SDK with a synthetic Node VM message/HTTP boundary: baseline 11/14, candidate 14/14. The three baseline failures are dropped first selection, revocation during digest and revocation during compression. Healthy cold PLAYER startup already passed on baseline; these tests establish a compatible failure mode, not direct proof of the original room's network cause. Details: [cold reproduction](WORKBENCH_OWNER_COLD_REPRO.md).
- View-publication recovery 11/11; scoped authority 7 checks; notice controller 13/13. Independent adversarial review reached 18/18 host VM scenarios, 39/39 Web focused tests, and a separate 15/15 ABA regression pass. Counts overlap and are not summed.
- Review found and verified fixes for request-epoch loss across earlier reads, unrelated-target cancellation, coalesced revoke/regrant, condition ledger commits after revocation, native updater ABA and active cancellation before/after a durable card commit.
- Final monster partial-commit ACK handling is source-reviewed; full native-resource and condition-history race paths were not independently executed. These limits are retained.

The original browser attempt could not launch Chromium because an AF_UNIX socket operation returned EPERM, including an approved escalation attempt. The existing cloud browser refused the local test page with ERR_BLOCKED_BY_CLIENT. No restriction was bypassed. No browser page execution, wide/narrow screenshot or true GM/player-room acceptance is claimed. Candidate-only CI triggers now include the prepared Web transition browser group, Suite cold SDK browser fixture and guide wide/narrow capture; these have not run remotely because nothing has been pushed.

## Repeatable local gates

```sh
DND_CARD_WEB_ROOT=/path/to/paired-web node tools/verify-suite-candidate.mjs
DND_CARD_WEB_ROOT=/path/to/paired-web npm run build
DND_CARD_WEB_ROOT=/path/to/paired-web SUITE_BASE=suite-dev SUITE_CHANNEL=dev npx vite build --outDir dist-workbench-dev
```

Publication must first be authorized, use the exact paired commit recorded in the candidate workflow, and verify its CI results. Browser/real-room limits remain open until actually exercised; a green unit suite is not a real-room acceptance.
