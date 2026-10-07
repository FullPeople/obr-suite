# 2026-10-07 incremental dev follow-up

Base: dev c37cdd4e96dd1d600cffb075466f3bbceb6fb7bf, preserving the deployed 250 source and its subsequent receipt. Applies the verified latest attachment's dev fog-entry removal and cumulative dice product patch. Settings page and the complete dynamic fog implementation suffix are byte-identical to the base. Startup always removes the persistent legacy menu ID; no role listener, menu creation or scene mutation remains in that entry.

The dice overlay starts font loading, audio warmup and renderer initialization in parallel, then requires all three and a usable context before initial ready. A restored WebGL context cannot override pending/failed initial resources. Errors remain observable. Local evidence: 36 readiness unit passes, seven fog cleanup passes, three genuine WebGL scenarios with two completed recovered throws; the immutable unsafe font-only control produces six expected unit failures and three premature-ready browser cases. The product file matches the attachment's final overlay SHA-256 a187787af48c688ac3c0ce6ca075537bf89ef123a851876a4a5e14d004dcfd02.

The SDK fixture uses real browser WebGL and physics with synthetic room messages. This is not physical-device or actual room acceptance. No hot throwing latency improvement is claimed. Full candidate, cross-window, four resource groups and the new startup readiness workflow must pass at the exact final SHA, with the new paired Web pinned before deployment.

Manifest advances to 1.0.251-dev. Stable main is handled on its own branch; this dev source is not merged wholesale into stable. Rollback uses fresh full /suite-dev/ backup and the coordinated three-target publisher receipt, preserving backend, players and independent Three-Dragon sites.
