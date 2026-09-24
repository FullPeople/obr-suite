# 177 live failure: SDK draft cloning and export timestamp conflicts

177 remains a failed user acceptance baseline for latency and synchronization.
The 177 simulated release checks did not cover the SDK's Immer draft boundary;
their passing status must not be presented as evidence that these failures were
fixed or that real-room latency is acceptable.

## Received production evidence

All reports identify `1.0.177-dev` and `background-DM_JYH9q.js`:

| UTC time | Request | Phase | Evidence |
| --- | --- | --- | --- |
| 2026-09-23 13:03:20.027 | stats / 8b087e12-6e8b-4360-aec9-bc8d15eeeba8 | authorize | DataCloneError: Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned. Array.map -> ci, bundle 2:8593 / 3:68002 -> Immer produce |
| 2026-09-23 13:05:48.385 | save / b04e743c-8baf-40ea-82ca-e0b8756772ab | sync-token | Same DataCloneError and call chain |
| 2026-09-23 13:06:33.577 | save / 517c59eb-56e7-475c-877b-af855baa3fa3 | merge-owlbear | MERGE_CONFLICT / owlbear.meta.parsed_at; before 2026-09-23T13:06:31.019Z, remote 2026-09-23T13:06:27.221Z |

The user also reports slow card switching, slow rolls, and persistent stalls.
The fixes below address the exact exceptions, not the whole transport problem.

## Confirmed causes and changes

`SceneItemsApi.updateItems` in the installed Owlbear SDK 3.1.0 uses
`produceWithPatches` from the resolved Immer 10.2.0. Its callback values are
Proxy drafts. `tokenRuntime` mapped resource rows through `structuredClone`
inside that callback, which is forbidden for a Proxy. This also happens during
authorization because `access` performs hydration/projection. A save can reach
this error after its character document has already been durably committed.

Runtime and merge snapshots now copy the JSON metadata by reading its values
into plain containers. They no longer pass Proxy values to structuredClone.
No error is swallowed and no resource row is discarded. This helper deliberately
implements the JSON metadata contract, not a general clone of arbitrary objects.
The workbench clone audit also checked panel/dice JSON RPC, inventory ledger,
document delta and projection calls: those receive plain serialized values.

`applyProjectionPatch` had no exception for generated export metadata, although
the older full merge did. Both now treat complete documented bookkeeping paths
consistently. Timestamps keep the newest valid value; native revision cannot
decrease; the host document revision is never accepted from a client. Fields
named `parsed_at`, `updatedAt`, or `revision` within resources or rule entries
remain normal conflict-checked business data.

## Reproduction and verification

Run `node tools/workbench-proxy-178-selftest.mjs`. It instantiates the installed
SDK `SceneItemsApi` directly with a message-bus boundary and runs its actual
update method. It first reproduces 177's DataCloneError, then verifies the fixed
character and monster callbacks, nested draft detachment, both merge paths,
strict business-field conflicts and host revision ownership. All 9 checks pass.
Results: `workbench-test-output/proxy178/results.json`.

The shared browser fixture now uses `produceWithPatches` as well. Inputs and
outputs cross cloned message boundaries; its world store is not an Immer draft.
This ensures later host integration tests encounter real callback proxies.

`node tools/workbench-merge-selftest.mjs`: 8 checks pass.
`node node_modules/typescript/bin/tsc --noEmit`: passes.
The older runtime-176 script initially stalled because its test awaited a second
coalesced read before releasing the first. That test now explicitly checks one
shared in-flight request followed by a fresh read. All 13 runtime/cache/monster
checks pass; the separate inventory model regression also passes.

## Unrelated saves no longer consult the stock ledger

Every `syncNative` previously forced a ledger read even when changing only HP,
abilities, portraits or ordinary features. `nativeInventoryChanged` now compares
the exact fields consumed by stock synchronization: item identity and stock
fields, removed condition identity, and supported currency amounts. An unchanged
inventory returns no container, projection, or guard and makes zero ledger calls.
Adding or changing a runtime condition never invents an inventory row; removing
one still consults stock to retire a corresponding grant.

`node tools/workbench-inventory-178-selftest.mjs`: 7 checks pass. They verify zero
calls with a cold cache, actual inventory edits and conflicts, and transfers or
grants racing an unrelated save. The unchanged path neither resurrects a moved
item nor clears pending projection records. Three-way document merging retains
already projected removals; a still-pending projection applies after the unrelated
save while preserving the changed HP/ability. Original inventory sync regression:
9 checks pass. Results: `workbench-test-output/inventory178/results.json`.

No deployment or real-room verification was performed by this focused subtask.

## Independent review of the 178 changes

The review identified and the root implementation corrected three further paths:
an empty resource notice still reading the ledger; permissions captured before a
slow document download; and post-commit SDK failures being reported as failed
mutations. `tools/workbench-review-178-selftest.mjs` uses the actual installed SDK
and a browser parent RPC responder. Its 10 checks pass, including held initial
responses racing newer events, scene reload, injected token-projection failures
after stats/resource/save commits, inventory broadcast failure after commit,
partial inventory commit before a rejected character CAS, permission changes
during a slow read, and rejecting forged internal commit markers. These assertions
check actual `receive` acknowledgements and authoritative stored data, not only
whether an internal helper throws. No character mutation was replayed after a
successful commit.

The review also reproduced an ordering bug in the real Web transport module:
a catalog can acquire a later sequence after awaiting unrelated work while still
holding old character data. A delayed ACK with a newer durable revision then
updated the active sheet but was discarded for overview cards. The corrected
implementation orders durable character runtime by revision, keeps catalog
permissions, and tracks monster ordering by individual item. The Web test file
`tests/e2e/sync-recovery-178.spec.ts` passes all 5 tests, also covering independent
inventory/catalog delivery and serial character writes with the 80 ms debounce.
