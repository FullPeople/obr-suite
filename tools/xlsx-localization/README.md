# Complete English character cards

The Chinese 2014 and 2024 workbooks in `public/` are the source of truth. This
directory contains reproducible inventories, located translations, and the
adapter used to preserve their native workbook structure. It does not yet supply
a complete English download.

## Generate English feet units

```text
python -B -X utf8 tools/xlsx-localization/number_format_package.py --input-2014 <remaining-main-2014.xlsx> --input-2024 <remaining-main-2024.xlsx> --prepare
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format xlsx
node tools/xlsx-localization/author_number_format_targets.mjs <reported-plan.json> <new-authored-targets.xlsx> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/number_format_package.py --input-2014 <remaining-main-2014.xlsx> --input-2024 <remaining-main-2024.xlsx> --authored-targets <new-authored-targets.xlsx>
```

Requires `382cce1b… / c86f98a3…`. Only number format 176 changes from a Chinese
feet suffix to `0" ft."`. Its complete user set is checked: four merged inputs
per workbook, covering main darkvision/speed and two companion speed fields.
All values, formulas, input rules and geometry stay intact. The two located
reviews and complete 12-cell author table are verified before output. New
`format-plan-` / `format-candidate-` directories belong under sibling
`_audit/xlsx-number-formats`; optimization mode is rejected. Native verification
covers nine input cases per version, exact exports and actual unit display.
No saved cache or public download is produced. See
`docs/research/xlsx-number-formats-20260909.md`.

## Generate the remaining English main-card fields

```text
python -B -X utf8 tools/xlsx-localization/main_remaining_package.py --input-2014 <lookup-labels-2014.xlsx> --input-2024 <lookup-labels-2024.xlsx> --prepare
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format xlsx
node tools/xlsx-localization/author_remaining_targets.mjs <reported-plan.json> <new-authored-targets.xlsx> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/main_remaining_package.py --input-2014 <lookup-labels-2014.xlsx> --input-2024 <lookup-labels-2024.xlsx> --authored-targets <new-authored-targets.xlsx>
```

Requires the preceding lookup-label pair `30189963… / 2ee05231…`. Applies the 49
remaining static labels/defaults, English ammunition and size lists, carrying
status and spell preview components/classes. The original dictionaries stay
intact; an M:N alias table in the existing hidden Export sheet preserves their
price, weight and size calculations. Ten formulas and five list rules change.
Ten compact captions expose their full reviewed names. The existing class list
is partitioned to add hints without losing validation on any of its 335 cells.

The 500-cell author table and all located reviews are bound to the pinned source.
Only T/AI/AO/AT widths and the affected styles change; the class list wraps.
Outputs are new `remaining-plan-` or `remaining-candidate-` directories under
sibling `_audit/xlsx-main-remaining`. Actual Calc checks cover 51 / 43 cases,
followed by a separate visual check of the final layout. Public templates and
saved formula caches are unchanged. Number formats, dynamic content and other
pages still require work; this is not a full English download. The sixth parser
patch is in `tools/server-patches/main-remaining-20260909`, with scope and evidence
in `docs/research/xlsx-main-remaining-20260909.md`.

## Generate the English main-card lookup labels

```text
python -B -X utf8 tools/xlsx-localization/main_lookup_package.py --input-2014 <ability-input-2014.xlsx> --input-2024 <ability-input-2024.xlsx> --prepare
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format xlsx
node tools/xlsx-localization/author_lookup_targets.mjs <reported-plan.json> <new-authored-targets.xlsx> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/main_lookup_package.py --input-2014 <ability-input-2014.xlsx> --input-2024 <ability-input-2024.xlsx> --authored-targets <new-authored-targets.xlsx>
```

Requires the preceding ability-input pair `a8e797c2… / d4676e66…`. This increment
translates both sets of six ability labels and the 18 original 2014 skill labels.
A bounded K:L alias table in the existing hidden Export sheet keeps old Chinese
lookup inputs working. The 39 consumers retain their original return columns and
error behavior. No extra worksheet or player action is introduced. One appended
font/style per workbook and the E column width make the full names readable.

The complete 544-cell author table, pinned inputs, originals and 30 located
reviews are checked before generating output. New output directories belong in
sibling `_audit/xlsx-main-lookup-labels`, prefixed `lookup-plan-` or
`lookup-candidate-`. Optimization mode is rejected. Native checks cover 30 / 24
cases, plus all 30 labels in actual before/after PDF previews. The separate
unchanged parser preserves its complete result for both default and seeded input
views. These engineering copies still lack saved formula caches and full English
content. See `docs/research/xlsx-main-lookup-labels-20260909.md` for the initial
diagnostic failure, resume, preservation checks and remaining work.

## Generate the English ability-input increment

```text
python -B -X utf8 tools/xlsx-localization/main_ability_package.py --input-2014 <main-toggle-2014.xlsx> --input-2024 <main-toggle-2024.xlsx> --prepare
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format xlsx
node tools/xlsx-localization/author_ability_targets.mjs <reported-plan.json> <new-authored-targets.xlsx> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/main_ability_package.py --input-2014 <main-toggle-2014.xlsx> --input-2024 <main-toggle-2024.xlsx> --authored-targets <new-authored-targets.xlsx>
```

This increment requires the pinned main-toggle pair `1c21afed… / 133a58fe…`.
It translates the spell ability and top-three-weapon override inputs and their
dropdowns, preserving original Chinese lookup keys and previous invalid-input
behavior. Two input styles and the N/AC column widths are adjusted so long English
names remain readable. Existing styles are preserved; only two appended styles
are selected. No original card is imported into the authoring library.

The explicit inputs, original cards, formal reviews and complete 84-cell author
table are verified before creating a candidate. Output directories must be new
children of sibling `_audit/xlsx-main-ability-inputs`, with `ability-plan-` or
`ability-candidate-` prefixes. Python optimization mode is rejected. Native Calc
checks cover 24 cases per version and the four long input values; they do not
establish Excel/WPS, save/reopen, upload or full-card English completion. Parser
compatibility is delivered separately in `tools/server-patches/ability-inputs-20260909`.
See `docs/research/xlsx-main-ability-inputs-20260909.md` for evidence and limitations.

## Generate the integrated spell-display copies

The latest display entry point rebuilds both cards from the repository originals
and selected formal reviews, through the existing identity, dropdown and body
generators. It includes canonical display names, the corrected 2014 sourcebook
column, spellbook labels, 3,993 F/G/L fields, and 1,331 hidden body formulas that
retain paragraphs in Calc. It also applies all reviewed sourcebook, school and
material text (3,384 positions) and eight bilingual school comparisons. No
historical audit directory or saved seed is needed.

From the repository root, using Python 3.11 or newer:

```text
python -B -X utf8 tools/xlsx-localization/spell_display_package.py --prepare
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 6 --output-format xlsx
node tools/xlsx-localization/author_display_targets.mjs <reported-plan-directory> <new-author-directory> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/spell_display_package.py --author-directory <new-author-directory>
```

The author directory's parent must exist. The Node dependency directory is the
bundled runtime root containing `node_modules`, with `@oai/artifact-tool` installed;
it is not a new app dependency. The author script creates six separate XLSX
tables, never imports a card, and validates all written values and body formulas.
The package adapter rechecks actual author files against freshly verified source
and reviews before building. A full offline reconstruction takes several minutes.

`--repo` selects another checkout containing the same pinned inputs. `--output`
must be a new child of its sibling `_audit/xlsx-spell-display`, prefixed
`display-plan-` or `display-candidate-` for the respective mode. Originals and old
outputs are never overwritten. These tools reject Python optimization mode.

The reproducibility and input-guard check creates its own isolated source copy
and six new author files:

```text
python -B -X utf8 tools/xlsx-localization/spell_display_selftest.py --node <bundled-node-executable> --artifact-runtime <bundled-node-dependency-directory> --marker <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs
```

It checks the actual final package bytes against the independently reviewed,
natively computed engineering copies. This does not repeat native calculation.
The files remain partial English, without formula caches, and marked
`NO-CACHE-NOT-FOR-UPLOAD`; they are not public downloads. Full scope, actual Calc
results and remaining acceptance are in
`docs/research/xlsx-spell-display-20260909.md` and
`docs/research/xlsx-spell-reference-fields-20260909.md`.

## Add the reviewed main-card captions

The next display stage takes the two exact outputs of the spell-display build
above. It adds 433 reviewed main-card labels and 21 original input messages.
Long labels use readable short captions with 204 complete English input hints;
only five narrow columns widen. Formula-dependent inputs remain unchanged.

```text
python -B -X utf8 tools/xlsx-localization/main_display_package.py --prepare
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 2 --output-format xlsx
node tools/xlsx-localization/author_main_targets.mjs <reported-plan-directory> <new-author-directory> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/main_display_package.py --input-2014 <2014-spell-display.xlsx> --input-2024 <2024-spell-display.xlsx> --author-directory <new-author-directory>
```

The separate label and caption author tables contain 1,632 and 1,820 cells,
including headers. Every actual value is checked before any candidate directory
is created. Run the entry point from the desired checkout; it derives its source
root from that file. Explicit workbook inputs must match the reviewed upstream
hashes. No historical audit path or generated catalog is read.

`--output` must be a new child of sibling `_audit/xlsx-main-display`, prefixed
`main-plan-` or `main-candidate-`. Originals, prior outputs, formula caches,
drawings, comments and user values are not rewritten. Existing shared strings
and styles remain intact; selected captions use appended strings and styles.

The two final files reproduce the actual Calc/PDF-checked main-card layout.
This is partial English and remains `NO-CACHE-NOT-FOR-UPLOAD`. The 90 deferred
main-card locations include lookup keys and editable defaults; other workbook
content, Excel/WPS interaction, saving and upload still need work. Exact native
validation qualifications are in
`docs/research/xlsx-main-display-20260909.md`.

## Correct the main-card export fields

Use the exact main-display outputs above as inputs for this additional stage.
It fixes the original export's wrong special-ability rows, header-as-item row,
quantities read from adjacent skills, and currency references to labels instead
of amount inputs. The prior AS40 shield correction remains in place.

```text
python -B -X utf8 tools/xlsx-localization/main_export_package.py --prepare
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 2 --output-format xlsx
node tools/xlsx-localization/author_export_targets.mjs <reported-plan-directory> <new-author-directory> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/main_export_package.py --input-2014 <2014-main-display.xlsx> --input-2024 <2024-main-display.xlsx> --author-directory <new-author-directory>
python -B -X utf8 tools/xlsx-localization/main_export_fields_selftest.py
```

The author tables contain literal formula text and never import a native card.
Every actual value is checked before writing a candidate. The existing hidden
Export sheet and main AV1 formula are the only changed parts; visible layout,
other formulas, inputs, styles, images and comments remain intact. The unchanged,
hash-checked compiler retains JSON escaping, numeric guards and overflow handling.

Outputs stay in fresh sibling `_audit/xlsx-main-export` directories prefixed
`export-plan-` or `export-candidate-`. Run from the desired checkout; explicit
input files must match the reviewed preceding stage. Existing outputs and public
files are never overwritten, and Python optimization mode is rejected.

Native Calc verified the corrected field locations and row behavior in both
versions. Dynamic multiline/tab user text exposed a separate Calc compatibility
failure: those characters do not yet survive export intact. This stage still has
no caches and is not ready for upload or public download. It does not patch the
server parser's separate layout mappings. See
`docs/research/xlsx-main-export-20260909.md` for precise evidence and remaining work.

## Use English Yes/No main-card controls

This next increment takes the exact main-export outputs above. It translates
five existing defaults: average Hit Dice and Heroic Inspiration in both cards,
plus the 2014 Jack of All Trades switch. The 2024 O/X switch and prior shield
control retain their existing behavior. Only the main worksheet changes.

```text
python -B -X utf8 tools/xlsx-localization/main_toggle_package.py --prepare --input-2014 <2014-main-export.xlsx> --input-2024 <2024-main-export.xlsx>
node <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format xlsx
node tools/xlsx-localization/author_toggle_targets.mjs <reported-plan.json> <new-author.xlsx> <bundled-node-dependency-directory>
python -B -X utf8 tools/xlsx-localization/main_toggle_package.py --input-2014 <2014-main-export.xlsx> --input-2024 <2024-main-export.xlsx> --authored-targets <new-author.xlsx>
```

The single separate author table has 29 entries and 120 actual cells. Formula
expressions are stored as text. The adapter checks all targets against the
originals, formal reviews and both pinned inputs before creating candidates.
Output directories must be new children of sibling `_audit/xlsx-main-toggles`,
prefixed `toggle-plan-` or `toggle-candidate-`; Python optimization is rejected.

The dropdowns offer Yes/No with the original strict validation settings. Twenty
calculation formulas and two conditional predicates also recognize legacy Chinese
values. Existing styles, objects, other inputs, helper sheets and AV1 remain.
Actual Calc compared HP branches, all 18 affected skills and complete JSON output
against the preceding cards; five longer Yes values were checked in actual PDFs.
This is still partial English without caches. Dynamic multiline text, remaining
lookups, full content, Excel/WPS and upload acceptance remain unfinished. See
`docs/research/xlsx-main-toggles-20260909.md`.

The server's separate layout corrections are delivered in four incremental
packages under `tools/server-patches/`; the latest is `main-fields-20260909`.
Applying a workbook stage does not install a server patch.

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
source conflicts, the precisely reviewed N337 display correction, and remaining
complete-card work. The identity/lookup tools themselves remain plan-only;
selection and package application are separate increments.

## Plan the explicit spell selector

```text
python -B -X utf8 tools/xlsx-localization/spell_selection_plan.py --output <new-audit-directory>
python -B -X utf8 tools/xlsx-localization/spell_selection_plan_selftest.py --output <new-audit-result.json>
```

The selection plan replaces the original active-cell/F9 C3 expression with an
explicit input. Its protected C3:R6 merge keeps all 64 existing cells and visual
styles; nine dedicated style clones unlock just this input. The existing 200
spellbook inputs share a compact list with C3. All 50 original custom slots are
included dynamically, with distinct human labels and literal wildcard handling.
A separate 2024 AJ2 alignment clone keeps the translated color legend on one line.

Plans regenerate the pinned originals and identity/lookup dependencies. The
packager must match exact source cells, styles and validation nodes before
applying them. Main-card F/K lists, name-specific conditional formatting, body
translations and importer identity remain separate work. Native selection,
recalculation and layout are not established by the finite formula model.
See `docs/research/xlsx-spell-selection-20260909.md` for the engineering copy scope.

## Generate the spell-selection engineering copies

```text
python -B -X utf8 tools/xlsx-localization/spell_package.py
python -B -X utf8 tools/xlsx-localization/spell_package_selftest.py
```

The packager creates a new `spell-candidate-*` directory under the repository's
sibling `_audit/xlsx-spell-package`. `--repo` selects another checkout containing
the same pinned tools and original files; `--output` must stay inside that audit
root and must be a new directory. It rebuilds AV1 and shield seeds from the actual
originals, then applies the regenerated lookup and selection plans. No historical
audit script or saved seed is required, and no external plan JSON is accepted.

The new helper sheets, names, input validation and style clones are registered
without altering unrelated data. Both final files explicitly remain uncalculated
engineering copies and are not ready for upload. The integration selftest keeps
its successful minimal source copy intact; deliberate rejection inputs use a
separate directory. It checks package reproduction and output boundaries, not
native Excel/WPS interaction or formula performance.

## Generate the main-card spell dropdown copies

```text
python -B -X utf8 tools/xlsx-localization/spell_main_lists_plan.py
python -B -X utf8 tools/xlsx-localization/spell_main_lists_package.py
python -B -X utf8 tools/xlsx-localization/spell_main_lists_selftest.py
```

The separate increment connects the main card's existing known/prepared spell
inputs to bounded lists. It preserves all F/K producer formulas and the original
input coverage. Existing compact output is reused; only the 2014 known list needs
an additional compaction. Duplicates and order remain, and empty lists retain a
one-cell range. It adds 402 / 2 hidden helper formulas and changes only 3 / 2 data
validation formula texts, without changing their error behavior or attributes.

`--repo` selects the checkout. New plan and workbook directories must be exclusive
children of sibling `_audit/xlsx-spell-main-lists`, with `main-lists-plan-*` and
`main-lists-candidate-*` prefixes respectively. The package generator rebuilds the
published spell-selection input from the actual originals, then regenerates and
applies the main-card plan. No historical seed or external JSON plan is loaded.
Both entrypoints reject Python optimization mode, which would disable assertions
in the pinned verification core.

The actual copies preserve all previous cells, styles and unrelated package parts.
Their finite-model and package checks do not establish native dropdown operation,
recalculation cost, full English content, save/reopen or upload. See
`docs/research/xlsx-spell-main-lists-20260909.md` for the exact scope and evidence.

## Generate the 2014 reviewed spell-body copy

```text
python -B -X utf8 tools/xlsx-localization/spell_bodies_plan.py --repo <checkout>
node author_targets.mjs <reported-plan-path> <new-authored-targets.xlsx>
python -B -X utf8 tools/xlsx-localization/spell_bodies_package.py --repo <checkout> --authored-targets <new-authored-targets.xlsx>
```

Run the unchanged `author_targets.mjs` from a new local runtime directory with
access to the bundled Node dependencies. Follow the spreadsheet skill's operation
marker requirement before authoring. The separate target XLSX contains an A:D
table; the packager checks all 2,092 cells against a freshly generated plan.

The package rebuilds the published main-list pipeline from both pinned originals,
then applies 522 reviewed 2014 descriptions only. It appends shared-string clones
and preserves M209's four rich runs, other cells, original spell keys, styles,
custom slots and unrelated package parts. No old audit plan, authored workbook
or historical candidate is required. New output directories must be exclusive
children of sibling `_audit/xlsx-spell-bodies`, prefixed `spell-bodies-plan-` or
`spell-bodies-candidate-`. Both entrypoints reject Python optimization mode.

The complete isolated authoring/package check is available as:

```text
python -B -X utf8 tools/xlsx-localization/spell_bodies_selftest.py --node <bundled-node> --node-modules <bundled-node-modules> --artifact-marker <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs
```

It creates new source copies and authoring outputs, invokes the operation marker,
and keeps the local dependency junction off shared drives. The resulting workbook
still has no formula caches and is not a public English download or upload-ready
card. Actual Calc diagnostics identified separate bibliography, raw-name and
multiline-reference issues; the body-only increment does not repair them. Scope
and evidence are in `docs/research/xlsx-spell-bodies-20260909.md`.

## Generate the 2024 reviewed spell-body copy

```text
python -B -X utf8 tools/xlsx-localization/spell_bodies_2024_plan.py --repo <checkout>
node author_targets.mjs <reported-plan-path> <new-authored-targets.xlsx>
python -B -X utf8 tools/xlsx-localization/spell_bodies_2024_package.py --repo <checkout> --authored-targets <new-authored-targets.xlsx>
```

Use the same separate authoring runtime and operation marker described above.
This version applies 809 descriptions and preserves 36 rich cells with 300 runs.
The original rich structure is read directly from the pinned workbook; only
selected source/review records are bound. No generated catalog or historical
audit inventory is required. The package reads all 3,240 authored A:D cells and
rebuilds the upstream main-list copy from the originals.

Exclusive output directories are under sibling `_audit/xlsx-spell-bodies-2024`,
prefixed `spell-bodies-2024-plan-` or `spell-bodies-2024-candidate-`.

```text
python -B -X utf8 tools/xlsx-localization/spell_bodies_2024_selftest.py --node <bundled-node> --node-modules <bundled-node-modules> --artifact-marker <spreadsheet-skill>/container_tools/mark_artifact_operation_started.mjs
```

The selftest authors a new target table and generates the candidate from a small
source copy, including checks that unrelated catalog/review changes do not affect
the selected plan. This still produces an uncalculated engineering workbook.
See `docs/research/xlsx-spell-bodies-2024-20260909.md` for preservation, actual
Calc findings and remaining English-card work.
