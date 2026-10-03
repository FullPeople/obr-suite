# Workbench monster lifecycle repair — 2026-10-03

Initial base: dev `c8397b04192ac26c4e954de813501c67acfdd783`. The final candidate absorbs the subsequently advanced official dev `e12a6ab9320b7257979021a51c05c9bf8972b071`, preserving release 236 and its resource-dashboard changes. The paired Web includes official main `4ef1eb37c4c8ea34291b06d39a21c586ff5e6866`. This is an independent review candidate; official branches, deployments and old automatic bestiary popovers remain untouched. Earlier green runs are retained as historical evidence and the integrated candidate is revalidated.

## Scope

- Native token owner and GM retain monster access regardless of global library-search visibility; existing foreign-token restrictions remain.
- `card:<id>` and `monster:<token id>` provide separate authorized targets for dual bindings. Raw token IDs retain their legacy character-first behavior.
- Character reads bypass monster overrides. A removed bestiary link cannot revive its old override or stat block; an explicitly disabled HP component cannot be kept alive by leftover HP metadata.
- Component/owner/lock identity changes retrigger selection and revoke warm cache grants. Pending reads recheck access, scene epoch and monster identity before publication; token writes recheck ownership and binding inside the SDK callback.
- Condition receipts always provide array runtime. Resource/condition operations preserve their identity while the monster overview keeps its compatible row type for HP-only tokens.

## Evidence

The dedicated `tools/workbench-monster-lifecycle-selftest.mjs` executes production host functions with synthetic SDK, storage and transport boundaries. It covers dual targets, owner/nonowner/GM, unbinding, legacy HP metadata, disabled modules, pending-read races, selection replacement, condition ACKs and write-time permission changes. It joins the existing aggregate verification runner. Web browser regressions exercise the production App with a synthetic host; exact paired Web SHA is pinned in the CI workflow.

No authenticated live-room, deployment or player-data modification is claimed. Current main's unrelated announcement-test expectation is corrected in the paired Web candidate, preserving the actual current and archived notice contents.
