# One exploratory stage-one bracket

This branch adds orchestration/tests only. It does not alter any product source
or the existing dice-latency browser/build/fixture tools. Only the new workflow
triggers on `fix/dice-overlay-brackets-20261004`; no existing workflow is changed.

One runner, one job, and exactly this order:

1. Baseline: `2e2ddb1f642e1375cffda45efad9584b33100008`
2. Empty-FX-only stage one: `99e3026cbc7ebfc057372ab1fa7f4f41d35fd1aa`
3. The same baseline again

The stage-one production diff is verified to contain only presentation.ts; its
blob must be `5d31879ff4a12b0098d65bba1d8c1d2a3cb7edd6`, the independently
reviewed empty-surface predicate. The harness comes unchanged from
`c69903ec977d409dd29300f070de6f40b8eb546c`, with paired Web pinned to
`05dcfdb645339cac9f68d1f6009f44b7e63d5c25`.

The current build/browser/fixture-selftest files are copied byte-for-byte into
both source checkouts. Hashes also enforce equal package-lock.json, asset checker
and simulated host template. Dependencies and both builds finish before the
measured bracket. Each build must verify all 59 immutable dice assets. Every run
launches the existing browser tool as a new process, which creates a fresh browser
and context with two clients. No concurrent jobs run inside this workflow.

Flags are fixed: CORE=1, VIDEO=0, SCREENSHOTS=0, SOFTWARE=1, RECOVERY=0. The existing
core fixture runs card-quick-rpc, three warm-single scenarios, and twenty-dice.
Both clients, all scenarios and the two baselines remain separate. Normal timing
samples have no video/screenshots/trace. The existing tool can capture a screenshot
only after failure for diagnostics; failed runs are never included as timing data.

The workflow has a 25-minute cap; the three browser runs are expected to take
roughly 3–5 minutes, excluding installs/builds and depending on runner load.
There is no combined-candidate repeat and no three-round campaign. Do not launch
a local browser or bypass an environment denial.

## Evidence and interpretation

The manifest records exact source/pins, tool and lock hashes, runner/job IDs and
ordering. Original result.json files retain machine CPU/OS, browser, renderer,
cold readiness, actual frame samples, raw SDK/render/audio events, results and
all per-client measurements. Build logs and asset-verification output are kept.
Failures preserve partial runs and the original browser failure artifact.

The pure summary recomputes P50/P95 and first actual GL-submission return from raw
samples, verifies them against the source report, and derives display completion
and end-to-end time from real release/completion events. It counts retime logs.
FirstSubmittedFrameMs is CPU return from WebGL submission, not GPU presentation.
The summary rejects altered outcomes/particle IDs, missing scenes/clients,
capture, mismatched browser/host/Web metadata and malformed/missing timing data.
The same workflow process supplies all measurements, never separate CI runners.

For each scene × client it presents all three absolute measurements, both stage-
one differences and baseline drift. A mixed or non-improving P95 direction for
either twenty-dice client means stop this small candidate. Even if both clients
are below both baselines, that is only a direction in one exploratory bracket.
The result always states stableImprovementEstablished=false. Green correctness
or workflow status is never evidence of a stable product performance gain.

## Local checks

- `node --test tools/dice-overlay-brackets-summary.test.mjs`
- `node tools/dice-latency-fixture-selftest.mjs`
- `node --check tools/dice-overlay-brackets-run.mjs`

These checks do not launch a browser or establish timing. CI runs `prepare`,
builds both source trees, runs `validate-builds`, then `measure`. Raw artifacts
are under `.local-evidence/dice-overlay-brackets/`.
