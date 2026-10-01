# 219 scoped dice hotfix candidate

2026-10-01. The user authorized automatic verification and deployment of only two fixes: clicking Action dice history keeps Action open; initiative rolls use the existing background 3D engine and report submission failures. The user explicitly deferred live Owlbear browser operation.

This isolated checkout starts at published Suite 217, 79e0c46f3d86078946426ccdad4e2a03ced2c34f. The separate Web notice checkout starts at runtime 217, 023feb6256dd5a1d85d92e9fe338b45fe8f280f0; its reviewed notice commit is 5256d4fcce19e3ebbbe5d1a3cd293581a21cf044. Suite version is 1.0.219-dev, while standalone remains 217. Pending 218 resource, migration, history limit and column-width changes are excluded.

## Confirmed causes and changes

- Embedded Action history reused the floating-history dismissal path. Action now toggles replay locally without requesting dismissal; explicit close and legacy floating behavior remain covered.
- The production adapter imported the controller-owning module into initiative iframes. Reopening panels started additional workers and overlays for the same connection. Child frames now submit through a LOCAL bridge to the persistent background owner. The bridge filters connection identity, deduplicates repeated request IDs and cancels queued work on teardown.
- Initiative submission failures were swallowed while a six-second timer could still write a value. Failures now show a readable error and leave initiative unchanged; the fallback starts only after the background accepted and produced a roll result.
- Plain SDK rejection objects now expose their message/code or serialized detail instead of [object Object]. The screenshot alone does not reveal its original objects, so this does not claim every network or maintenance error has the same cause.

## Completed checks

- Action history: original bug reproduced; 3 regression cases passed, including explicit close and floating-history compatibility.
- Dice bridge: 9 tests; initiative callback: 3 tests; existing lifecycle: 5 tests, all passed.
- Isolated Edge with real physics workers/renderers and synthetic SDK transport: 3 dual-client cases passed (GM, player authority, private advantage after reopening). Each client kept one worker/overlay; UI frames owned none; no browser errors.
- Full Suite TypeScript check passed. Independent review confirmed pending microtasks cannot restart a disposed owner.
- Web notice: TypeScript, 7 unit tests, 8 content comparisons, production integrated build and 1440/390 px Edge checks passed. All seven older Suite batches remain collapsed; standalone notes are unchanged.
- Production Suite build passed: 258 files, 52 root HTML entries, 56 pinned assets and 1044 static references. Historical build-release217.mjs is deliberately reused; the outer packaging receipt identifies 219.
- Deployment/archive tooling: 51 offline checks passed; no production writes were performed by those checks.

Evidence is retained under F:/DND-card-dice-hotfix219-evidence-20261001. Early fixture/configuration failures and corrected runs are retained. A result/deployment receipt will follow; this candidate document does not assert successful publication.

## Validation boundary

Live logged-in Owlbear rooms, actual multi-user permissions and the reported players' original SDK errors were not exercised. No real player or room data was used. Cross-host dice stacking, unrelated performance work and pending 218 changes are outside this hotfix. Publication targets only suite-dev and its corresponding notice/source downloads, with the existing 217 tree retained for recovery.
