# Workbench card read and delete recovery candidate

Local-only candidate based on exact dev `0527461faefcc826e1c810ceb537416c7b359f86`, paired with the Web recovery worktree based on `04d8a840`. No version bump, push, merge, deployment or real-card deletion was performed.

## Proven code-level failure modes

- Selection reads threw a generic `error` without the requested target, selection generation or access scope. The Web could keep its pending selection alive and continue its hello loop after an HTTP 404.
- Failed document hydration had no negative cache. Every automatic fresh hydration retried the same absent document, while the catalog retained its metadata entry.
- Catalog resolution merged bound tokens, the room directory, the legacy room list and the scene list in that order. A stale scene URL could override the durable room directory for reads/deletes, even though directory recovery writes already retained the durable directory URL.
- An explicit unsupported or foreign legacy URL silently fell back to the current room. Reads and deletes could therefore address a different document location than the supplied metadata intended.
- After the relay confirmed a durable DELETE, a subsequent SDK metadata failure was still reported as a failed operation. Conversely, a lost DELETE response was not explicitly marked uncertain.
- The observer advanced authority generations for owner/role changes, but not account/connection identity changes. The host's player identity is fixed at startup, so reconnects must not silently reuse its old authority.

These reproductions establish code defects, not a unique diagnosis of the reported live player incident. No failing player's record, network trace or account was inspected. A 404 alone cannot establish whether a record was deleted, moved, has stale metadata, or was hidden upstream. Existing historical `/characters/` storage is static; host read permission checks happen before document access. Native Owner is still the only player write grant.

## Candidate behavior

- `selectionError` carries the requested canonical target, client instance/selection, follow revision, sequence, numeric status and the access snapshot captured at the start of that read. Changed scene or target authority discards old failures. Repeated failures publish once per intent; failed delivery releases that deduplication marker.
- HTTP 400/403/404/410/422 document failures remain cached until an explicit retry, location change or genuine invalidation. Transient failures have a 15-second cooldown. No automatic read performs a deletion or repairs a URL by guessing another origin/room.
- Existing `refreshCard` invalidates the negative cache and performs an explicit fresh read. New `refreshCatalog` refreshes authoritative SDK identity/items plus room/scene metadata and returns the catalog and current access. It does not replay user mutations. Existing GM directory/owner-role metadata recovery remains in the catalog path, so this is not a claim that the complete refresh chain performs no metadata writes.
- Reads/writes/deletes use the same validated same-origin upload location. The durable directory URL wins over stale scene URL mirrors. Missing URLs still use the normal current-room location; legacy upload-room directory, `index.html` and exact `data.json` URLs remain supported. Unsupported explicit paths/origins fail closed.
- Confirmed deletion returns `{ deleted: true, cleanupPending: false }`. SDK cleanup failure preserves successful durable deletion with `{ deleted: true, cleanupPending: true }` and a warning. Status polling reuses the receipt and never resends the delete. A lost response is uncertain. Registration/backoff/pre-send rejection is marked not sent.
- Cleanup stops on changed account/connection/scene/native ownership. It does not re-authorize against the directory entry it has just removed. The existing relay already treats storage DELETE 404 as idempotent success; no separate index-only removal API was added.
- Read/delete diagnostics contain only bounded operation/code/status/time/version/correlation/connection information. They omit raw exceptions, stack traces, tokens, cookies, document bodies and storage URLs. Other legacy diagnostic routes are outside this narrowly scoped host change.

## Safe recovery

For a failed read, refresh the directory and explicitly reread the selected card. If ownership or the Owlbear connection changed, reopen the workbench from the current room and inspect the new grant. A read failure never grants delete permission. An authorized delete can run without first reading the missing document, but it still requires current native-owner/GM checks and refuses a player delete if foreign-owned bindings share that card.

For a confirmed delete with pending cleanup, inspect the refreshed directory. If a stale entry remains, another explicitly confirmed delete uses the existing idempotent storage DELETE contract and can finish cleanup under current authority. For an uncertain delete, inspect the returned request status and fresh directory before deciding whether any new delete is appropriate. No delete is automatically replayed, and a GET 404 is not promoted to proof of a completed delete.

## Verification

- Production-function read/recovery/path tests: exact baseline 6/21; candidate 21/21, then 23/23 after two additional access-identity deduplication regressions.
- Full production host plus the actual installed SDK at synthetic message/HTTP boundaries: 18/18. Includes normal deletion with real observation metadata events (cleanup completes and binding is removed), successful receipt after SDK cleanup error with no replay, cached 404 followed by explicit successful retry, and old-connection deletion transmitting zero requests.
- Actual observation/relay modules: 11 checks, including account/connection authority invalidation, explicit missed room/scene-event recovery and unsent registration failure.
- Existing native Owner policy/controller: 23 checks. Existing monster lifecycle: 27 checks. Existing legacy-location/relay test passes.
- Candidate aggregate runner: 26 groups passed before the final two additional SDK-only tests; the expanded SDK file was then rerun independently with all 18 checks passing.
- The original recovery candidate integrated aggregate passed 27/27 groups. The subsequent online-safe candidate passes 28/28, retaining all 23 recovery checks and adding actual link-entry product inspection; complete stable/paired-dev builds and 12 link checks pass. See `WORKBENCH_RECOVERY_ONLINE_SAFE_LOCAL.md` for exact provenance, source-package validation and the browser boundary.
- TypeScript and dev Vite build passed. Real browser DOM/room/network/device acceptance was not performed by this backend task.

Repeatable gates:

```sh
node tools/workbench-read-recovery-selftest.mjs
node tools/workbench-owner-authority-selftest.mjs
OWNER_VM_ONLY=1 EXPECT_PASS=1 WEB_ROOT=/path/to/paired-web node tools/workbench-owner-cold-sdk-selftest.mjs
DND_CARD_WEB_ROOT=/path/to/paired-web node tools/verify-suite-candidate.mjs
npx tsc --noEmit
DND_CARD_WEB_ROOT=/path/to/paired-web SUITE_BASE=suite-dev SUITE_CHANNEL=dev npx vite build --outDir dist-workbench-dev
```
