# 2026-10-07 stable follow-up 1.3.16

Base: main bd1c44f007e3b2e34ccae3d1df88b98196380587, preserving the deployed 1.3.15 and its receipt. Applies the latest attachment's stable fog menu retirement only. The persistent menu ID is removed at startup and teardown, without creating new role listeners or mutating scenes. The settings page and complete dynamic-fog engine suffix are unchanged.

The existing stable viewer adapter is rebuilt against the exact verified new Web source, carrying the tool-choice projection and responsive spell-icon fix. Original JSON export, stable XLSX and unrelated stable functionality are retained. Stable has no workbench-dice3d module; the cold-start patch applies only to dev.

Seven actual module cleanup regression cases pass locally. Exact paired full CI, types, host build and the real stable viewer browser tests must pass before merging. Notice history is preserved with only the newest batch expanded. Recover via the fresh complete /suite/ backup and guarded coordinated publisher receipt; no player data or backend is part of this release.
