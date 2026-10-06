# dot read-only requests - reviewed permission boundary

This proposal is prepared on an isolated branch. It must not be merged or enabled until the user explicitly confirms the new Actions permission. It does not authorize production publication.

The existing platform GitHub connector can open issues but does not expose first workflow_dispatch. A manual issue request supplies this missing path without another PAT, GitHub App or SSH identity. GitHub's ephemeral GITHUB_TOKEN is scoped to its own repository; only the request job asks for contents:read and actions:write. It can dispatch the one fixed workflow selected by repository identity. No Environment secrets or OIDC token are available to this router. The broader Actions permission could affect own-repository workflows if this trusted router code were changed, so review changes to this path carefully. It grants no cross-repository dispatch, server account, firewall or SSH permission.

When enabled on default main, Dot readonly request (.github/workflows/dot-readonly-request.yml) reacts only to newly opened issues with exact title `dot: readonly request`, authored and triggered by FullPeople, numeric user/owner ID 166210040. Other senders and production operations are denied. Edited issues, comments and reruns cannot dispatch. Requests expire after 30 minutes. The body must be one JSON object without Markdown fences, URLs, arbitrary refs/targets/paths/commands or credentials.

| Repository | Fixed dispatch | Fixed ref | Consequence |
| --- | --- | --- | --- |
| FullPeople/DND-card-web | dot-deploy-preflight.yml | main | Existing full-CI and server read-only preflight, production-card approval remains |
| FullPeople/obr-suite | dot-deploy-preflight.yml | dev | Existing three full-CI gates and server read-only preflight, production-suite-dev approval remains |
| FullPeople/dnd5e-automation-data | build.yml | main | Complete validate and pipeline jobs, generated Actions artifacts, no server deployment |

Web example (replace SHA, CI ID and release hash with fresh verified values):

```json
{"operation":"preflight","sha":"<40 hex current main SHA>","ci_run_ids":["<successful exact-SHA Web run ID>"],"expected_release_sha256":"<64 hex current card release hash>"}
```

Suite uses the same fields with current dev SHA, three string run IDs for verify-suite.yml, dice-cross-window-ready.yml and dice-release246-profile.yml, and the current suite-dev release hash. Missing, skipped, failed, foreign or stale CI is rejected; all paginated jobs must succeed. The server independently revalidates CI, branch head, OIDC and the online baseline.

Data example:

```json
{"operation":"validate","sha":"<40 hex current Data main SHA>"}
```

The router checks the current allowed branch SHA immediately before dispatch. Check the downstream run's exact SHA as well: branch movement around dispatch must not be mistaken for acceptance of the requested revision. Data adoption into Web is a separate reviewed PR using the existing importer and source lock. Data does not receive DEPLOY_SSH_KEY.

Find Dot readonly request in Actions for the issue event. Its `dot-request-<run-id>` artifact contains request.json, with the expected SHA, fixed workflow/ref and dispatch receipt. A successful router run means a request was submitted, not that its downstream checks or deployment succeeded. Find the resulting workflow_dispatch run; verify head SHA, complete successful jobs and the sanitized result artifact. For Web/Suite, the user approves the Environment in GitHub before the server job can run. The router has no approval endpoint and cannot remove that gate.

This is a persistent manual request entry, not a push/merge/schedule production trigger. Existing CI gates and existing scheduled Data validation remain unchanged. First production release, artifact validation, fixed production/rollback entry and future automatic triggering conditions require their separate confirmation. Disable this entry by disabling the router workflow or removing it through a normal reviewed PR; existing protected server access remains unchanged.
