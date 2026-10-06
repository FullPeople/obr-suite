# 2026-10-06 Web immutable OIDC subject correction

Read-only Web preflight 37420032431 failed with oidc-scope-denied. The installed helper matched repository source (SHA256 6dae5f7e35dda6f165111ed3e348a78b2cc3d0379d96a98bd4a97ee1db613ca5), but expected the old name-only Web subject. GitHub's read-only repository OIDC configuration has use_immutable_subject=true and prefix repo:FullPeople@166210040/DND-card-web@1378484252. The historical JWT was not retained or printed; this subject diagnosis uses configuration metadata.

The user explicitly authorized this correction, repository/helper/test synchronization, a fixed server-helper update, and a new read-only preflight after complete CI for the final source commit. No production deployment or permission widening is authorized by this change.

The only accepted Web subject is now:

```text
repo:FullPeople@166210040/DND-card-web@1378484252:environment:production-card
```

Suite retains exactly repo:FullPeople/obr-suite:environment:production-suite-dev. The same helper/test copies must be synchronized in Web main and Suite dev/default main so that a later reviewed helper install cannot accidentally restore the obsolete Web policy. Suite product source and paired-Web CI references are not changed by this correction.

The helper uses one literal subject per fixed target. Web's name-only subject, incorrect owner/repository IDs, renamed/case-changed identities, other Environment names, extra ref suffixes, missing claims and cross-target subjects are rejected. All existing signature, issuer/audience, repository/owner IDs, branch/ref type, Environment, event, GitHub-hosted runner, workflow path/ref, source/workflow SHA, token lifetime, exact successful complete CI, current branch, baseline, global lock and protected-state checks continue to apply. Publish/upload/shell/rollback remain denied.

Regression tests pin external subject literals independently of policy data. Existing tests remain, with explicit legacy-subject, wrong-ID, wrong-Environment, missing-claim and unchanged-Suite checks. Final complete Web CI must run on the merged main SHA; the old run's 98d0917c13ee22173d0f923d6db9e32ef9483fa2 and its CI cannot authorize a newer source.

Server install target remains /usr/local/libexec/obr-deploy/server_preflight.py, root-owned 0644. The narrow installer checks the old and new file SHA256, holds the existing /run/lock/obr-static-release.lock, saves the previous public helper source, then atomically replaces only that helper. SSH configuration, authorized keys, sudoers, accounts, firewall, production sites and service configuration are outside the update. Installation records include before/after static-tree and protected-state checks, exact helper hashes and the synthetic authorization regression result; they contain no JWT, token or private key.

Install/rollback package: /root/codex-release-packages/dot-web-oidc-exact-sub-20261006/. Server change receipt: /root/codex-release-receipts/dot-web-oidc-exact-sub-20261006.json. The fixed rollback script requires an explicit --restore-helper argument, exact current corrected-helper hash, original backup hash, unchanged root ownership and the existing global lock. It restores only the prior helper, preserving SSH/sudo restrictions and production state. Restoring the old helper intentionally returns Web preflight to denial under immutable subjects; it is not a fallback authorization method. Do not execute helper rollback unless separately directed. Repository rollback is a normal reviewed revert of the specific correction commit/PR with matching server rollback, never a force push or removal of identity checks.

The new workflow_dispatch must use the current final main SHA's complete successful CI ID plus a freshly read card/release.json SHA256. production-card human approval remains required and cannot be performed by dot. A successful read-only check still does not validate candidate production packages or enable production publishing.

Reference: https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims
