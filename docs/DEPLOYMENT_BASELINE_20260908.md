# Verified deployment baseline — 2026-09-08

The installed URLs, not an old local checkout or a version label alone, identify the running product. This record was made by downloading the public builds and reproducing them from the recovered Git history. It does not claim a new deployment or a successful multiplayer room test.

| Channel | Installed manifest | Version | Reproduced runtime source |
| --- | --- | --- | --- |
| Stable | https://obr.dnd.center/suite/manifest.json | 1.2.2 | `aea5ebb010dc0b3732d2672a38aad144c1fb69d1` |
| Dev | https://obr.dnd.center/suite-dev/manifest-dev.json | 1.0.148-dev | `68e5f18`, with the deployed manifest version recorded in `9e65f43` |

Stable background: `background-D8XTooCn.js`, SHA-256 `f26efd58f626caef87a38dff9e3c66cecd6c1c90853528ef4b15b54cfa751089`.

Dev background: `background-uO2s4b_z.js`, SHA-256 `bd94e99597a2498c2dbe5873f57695a7508ade41be9050c793dca1dfac5ec8f8`.

The complete HTML-declared and discovered JavaScript/CSS files captured for both channels reproduced byte for byte with the locked dependencies (Vite 8.0.10, Rolldown 1.0.0-rc.17). Of 148 captured stable files, 142 matched byte for byte; five HTML entry files differed only in line endings/blank lines, and the manifest parsed to the same JSON. Of 143 captured dev files, 137 matched byte for byte; the same five HTML files differed only in whitespace, and the old Git manifest said 147-dev although the deployed manifest said 148-dev. The dev metadata-only commit fixes that discrepancy. Two optional local test-page probes per channel returned 404; neither is a runtime entry and neither is counted as a product failure.

Both historical source revisions passed `npm run build` (TypeScript plus Vite). These checks establish source/build provenance, not cold-load latency, visibility safety, audio continuity, or multiplayer acceptance.

The recovered source also contains four later commits through `d9be401` (three runtime optimization commits and one log update) that were not present in the installed stable build. Keep these distinguishable from the deployed baseline until separately validated and released. A shared version number does not establish that two builds contain the same code.

The prior optimization log's opening statement that stable is still 1.2.0 and all optimizations are undeployed is historical. This live verification supersedes it for deployment status. Its measured results and rejected approaches remain useful engineering evidence.

Stable and dev currently share suite metadata/tool IDs by design. Use one channel per room. Do not reintroduce the retired namespace split when moving source between machines; it would make existing authored doors, lights, and settings disappear from the other channel.

Future releases should record the source commit, channel, build time, and asset hashes beside each manifest. GitHub source synchronization and deployment to the installed URLs are separate actions.
