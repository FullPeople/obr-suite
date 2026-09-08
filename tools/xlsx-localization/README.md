# Complete English character cards

The Chinese 2014 and 2024 workbooks in `public/` are the source of truth. This
directory contains reproducible inventories, located translations, and the
adapter used to preserve their native workbook structure. It does not yet supply
a complete English download.

## Rebuild and check

From the repository root, using Python 3.11 or newer:

```text
python -X utf8 tools/xlsx-localization/prepare.py
python -X utf8 tools/xlsx-localization/prepare.py --verify
python -X utf8 tools/xlsx-localization/selftest.py
python -X utf8 tools/xlsx-localization/candidate_selftest.py
```

`catalog.jsonl` and `structure.json` are generated from the original workbooks and
review records; they are excluded from Git because they duplicate about 16 MB of
source text and structure. `coverage.json` is the compact tracked progress record.
`reviewed.jsonl` holds the first 222 label reviews; `reviews/*.jsonl` contains the
full prose batches. Never edit the generated catalog to mark work complete.

Each reviewed passage retains the original text, source hash, rule version,
worksheet, exact occurrences, English text, reviewer and notes. A language review
does not establish that lookup keys, formula literals, sheet references, import
consumers or the English layout have been validated. Known source ambiguities are
recorded rather than silently replaced with rules from another edition.

## Translate the next batch

```text
python -X utf8 tools/xlsx-localization/batch.py export --version 2014 --sheet 法术大全 --batch 2014-spells-next --count 110 --characters 22000 --output <source.json>
python -X utf8 tools/xlsx-localization/batch.py merge --source <source.json> --translations <translations.json> --reviewer "Reviewer and scope" --output tools/xlsx-localization/reviews/<batch>.jsonl
python -X utf8 tools/xlsx-localization/prepare.py
```

The translation input/output is an array of `{id, target, note}`. Translate the
complete supplied passage, including restrictions, examples, tables and numerical
values. A spell's English name cannot replace its description. Every requested ID
must occur exactly once, and every note must describe its review. Treat adjacent
formula values as cached results, not automatically as a row's identity: the 2024
background sheet's A column is a compressed dropdown directory, while B contains
the background record key. The exporter includes nearby formulas for this reason.

## Preserve a reviewed text sample

```text
python -X utf8 tools/xlsx-localization/candidate.py plan --reviews tools/xlsx-localization/reviews/2014-background-001.jsonl tools/xlsx-localization/reviews/2024-background-001.jsonl --output <plan.json>
node <bundled-runtime-workdir>/author_targets.mjs <plan.json> <authored-targets.xlsx>
python -X utf8 tools/xlsx-localization/candidate.py build --plan <plan.json> --authored-targets <authored-targets.xlsx> --output-dir <audit-directory>
```

Use the bundled `@oai/artifact-tool` runtime for `author_targets.mjs`: copy that
single builder into a task-specific working directory and point its `node_modules`
junction at the bundled packages. Do not add the authoring library to the app's
dependencies. The target export is read back and checked against every planned
cell before any candidate is written.

The original workbooks cannot be used as whole-book import/export round trips in
the current artifact runtime: a measured trial lost hidden states, external links
and workbook parts, and replaced thousands of formula caches with errors. The
preservation adapter starts from the original ZIP package. It clones only selected
shared strings and changes only the selected cells' indexes. All original shared
strings remain intact for other references. Formulas, cached results, styles,
images, names, relationships and unrelated package parts remain unchanged.
Different rich-text runs require a separate run-level translation and are rejected
by this first adapter. It never flattens emphasis to make a sample pass.

These samples are explicitly partial and belong in an audit directory, outside
`public/`. They preserve old calculation caches, which can be stale after inputs
change. `verify_candidate.py` checks native structure and original errors but never
claims release readiness. The 2024 source already has an 8,663-character AV1
formula, above Excel's limit, and this text-only step preserves that issue.

## Package the AV1 formula plan

```text
python -X utf8 tools/xlsx-localization/export_package.py
python -X utf8 tools/xlsx-localization/export_package_selftest.py
```

The first command creates fresh timestamped engineering copies under the
repository's sibling `_audit/xlsx-export-package` directory and prints both output
paths. An explicit `--output-dir` must remain inside that audit root. Existing
files and public originals are never overwritten. The selftest creates its own
fresh inputs/outputs; it does not depend on an earlier manual generation.

This separate adapter replaces only AV1's formula and appends a hidden Export
worksheet, with required relationships, content type, sheet inventory and bounded
recalculation flags. It verifies every original cell and unrelated part, retains
the old AV1 cache only after exact reference-model agreement, and writes no helper
caches. Plans are regenerated from the pinned source and checked for cycles,
missing helpers, invalid references, tampering and budgets. The generator pin
normalizes Git LF/CRLF before both hashing and compiling the same text.

The copies preserve existing content and the original AS41 export semantics.
They are not English templates and have not been opened or recalculated in
Excel/WPS. See `docs/research/xlsx-export-package-20260908.md` for scope and evidence.

## Package the shield input migration

```text
python -B -X utf8 tools/xlsx-localization/shield_package.py
python -B -X utf8 tools/xlsx-localization/selftest_shield_package.py
```

This additional adapter starts from pinned originals through the unchanged AV1
packager, checks the generated seed bytes, then migrates only the AS40 shield
input, its validation and three dependent formulas. It accepts Chinese yes/no
alongside English Yes/No and exports the real AS40 as the existing equipped string.
A dedicated alignment style keeps Yes/No on one line without changing the shared
style, font, row height, column widths or other cells. Existing style nodes stay
byte exact; the appended index and count use the actual old node count.

Outputs use exclusive `shield-candidate-*` directories under the same sibling
audit root. Worksheet formula caches are removed so old values are not presented
as newly calculated results; external-link caches remain unchanged. The report
and filenames mark the copies as not natively recalculated and not ready for
upload. No source workbook, public download or prior audit file is overwritten.
See `docs/research/xlsx-shield-workbook-20260908.md` for the whitelist, tests,
preview evidence and native recalculation limits.

The full download still requires all content, dependent formulas/dropdowns,
importer compatibility, complete layout review and actual Excel/WPS recalculation
and upload checks. See `docs/research/xlsx-localization-20260908.md` for evidence.

## Plan spell identities and lookup migration

```text
python -B -X utf8 tools/xlsx-localization/spell_identity.py
python -B -X utf8 tools/xlsx-localization/spell_identity_selftest.py
python -B -X utf8 tools/xlsx-localization/spell_lookup_plan.py
python -B -X utf8 tools/xlsx-localization/spell_lookup_plan_selftest.py
```

These read pinned originals and create JSON in new sibling audit directories.
They preserve version, source fingerprint, original row and complete fields, and
derive distinct human labels for duplicate English names. The lookup plan binds
English choices directly to the original row, with shared positioning helpers
and unchanged legacy VLOOKUP fallback. It plans 1,002 of 1,003 consumer formulas
per workbook; the active-cell C3 expression is explicitly deferred.

No workbook is written. The plans are static snapshots and do not implement
future custom-slot edits, dropdown compaction, conditional formatting, import
metadata or native recalculation. Identity JSON consistency checks are not
authentication for foreign plans. The lookup CLI regenerates from the actual
original instead. See `docs/research/xlsx-spell-identity-20260909.md` for actual
source conflicts, the missing English label and the remaining complete-card work.
