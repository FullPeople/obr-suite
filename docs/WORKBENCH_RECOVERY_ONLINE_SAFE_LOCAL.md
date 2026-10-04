# Local recovery candidate preserving online-only Three Dragon entries

## Baseline and scope

This new isolated candidate starts from fetched dev `0527461faefcc826e1c810ceb537416c7b359f86`. It carries the reviewed card-read/delete and permission-host changes from `7eb0d780287dc4a4784c09cb90ed3cb5e5ca3a69`, without that old candidate's CI/Web pin. The paired Web runtime is the separately reviewed `8e5987789f8a526256f02f4544eef0b281324370`; CI is pinned to that exact commit. Old worktrees remain unchanged. No remote push, deployment, live card mutation or stable-channel publication has been performed. Local candidate commits are permitted; publication remains pending.

The [public dev source archive](https://obr.dnd.center/suite-dev/three-dragon-link-source-32ed4bb661b1.zip) `three-dragon-link-source-32ed4bb661b1.zip` was read without executing its code. ZIP comment: `32ed4bb661b11587bc74fe78a36ed4971945178d`. SHA-256: `208e64d66729315b0b5aed710a5448605e1d6965a23a7632a8e6cb8f1fe3fe71`. After CRLF normalization, its read/permission core and panel builder are identical to the fetched dev baseline. Only the exact settings website-link block, static website template and local overlay generator are taken from that archive. No whole-archive overwrite, older CI pin or release-document rollback was performed.

The separately published stable archive has a different comment (`3dc4bbd9836279a95dfd1ffba7eac812af1d7321`) and old source baseline (`639c8217`). Its runtime must not be treated as the dev runtime merely because release metadata references the dev overlay source. Stable gameplay/authority implementation is not upgraded by this candidate.

## Build preservation

The published online-only compatibility pages came from a targeted overlay. Its source's ordinary panel builder still compiled the historical game as `workbench-panels/table.html`, so deploying an ordinary full build would undo the website link.

This candidate makes the reviewed static website link part of standard builds:

- Root `three-dragon-ante.html` is the approved link-only template and an explicit Vite input for both local build channels.
- The default panel builder emits `table.html` from that same approved template; it does not bundle the historical game for this public entry.
- The website opens in a new tab with `noopener noreferrer`. The embedded compatibility page can request its own parent close using the existing same-origin frame channel. It has no game imports, SDK, API, WebSocket or iframe.
- Historical rules, controllers, private-hand code and their unit tests are untouched. The old seat/exit browser test now explicitly builds its historical Suite fixture under a temporary/evidence directory. That opt-in fixture cannot be emitted by the default production panel build.
- The explicit source-package whitelist includes the new template, overlay, changed/new validation tools and the historical fixture HTML, so the updated standard build does not depend on an omitted template.

The retained overlay generator is a local file packager; it is not a deployment command. Its independent-repository source metadata is required only when explicitly building that archival overlay. Standard Suite link-page builds do not require the independent Three Dragon repository.

## Verification and limits

The same product inspector rejects the original public root HTML and the actual pre-change panel-builder output. Four additional negative controls inject an old module, iframe, wrong destination or game transport and must fail. The candidate's actual table-only builder passes. Final full-build checks also inspect the emitted stable compatibility entry, dev compatibility entry and dev workbench panel entry.

Final local results for this online-safe candidate:

- Suite aggregate: 28/28 groups passed, including all 23 read-recovery checks, 18 installed-SDK host scenarios, 11 observation/relay authority checks, 16 permission-notice controller and 6 permission-dispatcher scenarios.
- Complete stable host build and complete paired `build:workbench-dev` passed. These are local build checks, not authorization or evidence of a stable deployment.
- Final link-entry inspector: 12/12 checks passed. This includes all three emitted public entries after the full standard build, original root/table rejection by the same inspector, and all four mutated negative controls. The initial unmodified panel build failed the product inspector as expected; its failure log and bytes are retained with local evidence.
- The final `workbench/suite-source.zip` contains all 15 newly required packaging/validation/doc members, each byte-equal to the final source. On this Linux executor the existing tar-based script produces a tar container with the legacy `.zip` filename; this task preserves that existing format.
- Both public-link browser fixture preparation and historical seat/exit fixture preparation passed. No local browser launch was retried, and no browser or real-room pass is claimed.

Commands:

```sh
DND_CARD_WEB_ROOT=/path/to/paired-web node tools/verify-suite-candidate.mjs
DND_CARD_WEB_ROOT=/path/to/paired-web npm run build
DND_CARD_WEB_ROOT=/path/to/paired-web npm run build:workbench-dev
node tools/three-dragon-website-entry-selftest.mjs --built
node tools/three-dragon-website-entry-browser.mjs --prepare-only
node tools/three-dragon-seat-exit-browser.mjs --prepare-only
```

The website browser script runs eight wide/narrow interaction scenarios against actual standard-build HTML when a supported browser environment is available. Its destination and parent-close receiver are explicit fixtures; the paired Web tests cover the actual application toolbar. Historical seat/exit browser coverage is separate from current public-product acceptance. Local browser startup was already restricted, so this task does not repeat it or claim browser/live-room acceptance.
