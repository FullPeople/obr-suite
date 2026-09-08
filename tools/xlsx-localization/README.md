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

The full download still requires all content, dependent formulas/dropdowns,
importer compatibility, complete layout review and actual Excel/WPS recalculation
and upload checks. See `docs/research/xlsx-localization-20260908.md` for evidence.
