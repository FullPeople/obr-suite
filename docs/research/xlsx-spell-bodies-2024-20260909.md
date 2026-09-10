# 2024 reviewed spell bodies and display follow-up

The 2024 generator applies all 809 reviewed static descriptions at
`法术大全!M3:M811`. Together with the earlier 2014 generator, both sets of built-in
descriptions can now be recreated from the original files. The resulting XLSX
files are engineering copies, not complete English downloads.

## Package scope

The incoming 2024 main-list package is
`f2a1c3556220b0c5c31e36fbd419c34b9cf192f4896f512b2ba01bbc340a5453`.
The resulting body package is
`4f3acdcff3365fb119b653e205944d9f9bdf3f6016e441399639222f9e934e58`.

Only the shared-string part and spell-data worksheet change. The generator
appends 809 strings after the original 10,677 entries and updates the corresponding
M-cell references. All 82,872 existing cells are checked; 82,063 non-target cells
remain byte exact. Original A/N identity keys, three gap rows, fifty custom rows,
styles, validations, names, images, external-link caches and other parts remain.
All 10,683 worksheet formulas still lack cached results.

The 36 rich descriptions retain all 300 ordered runs and their original font,
size, color and bold properties. Most map whole paragraphs between existing
bullet runs. M3 keeps only `Cantrip Upgrade.` bold, with the following space in
the ordinary run. M30 retains its fifteen runs, including the original bold
whitespace and bullet, while Fire Play's visible text remains ordinary. Exactly
36 text nodes gain `xml:space="preserve"` for required whitespace. No visible
emphasis is expanded and no body is flattened.

## Portable tools and checks

`spell_bodies_2024_plan.py` rebuilds the rich inventory directly from the pinned
original and binds the selected formal review records. It does not depend on a
generated global catalog, a stored inventory or historical audit JSON. Unrelated
new translations therefore do not invalidate this plan. The package entrypoint
regenerates the published original-to-main-list pipeline and reads all 3,240 cells
of the separately authored target table against its fresh plan.

Thirty function copies retain the reviewed parsing, rich-mapping and application
syntax trees. Root separately read the new record-selection logic, entrypoints
and complete selftest. All 809 resulting entry objects, including each rich-run
mapping field, agree with the reviewed prototype; only top-level dependency
receipts change to remove the catalog and historical-file requirements.

The prototype passed 17 bounded checks and six valid-XML rejection cases; six of
the checks prove that the test mutations actually change a part. Root then read
the actual original, reviews, authored workbook and candidate independently of
the author's application/verifier. This confirmed the full cell/string/run scope
above. It is not another full linguistic review of the 809 descriptions.

Final portable author verification passed 35 checks with 20 Python CLI calls,
one operation marker and one actual Artifact export. A new source copy contains
only 30 required files and no catalog or historical rich inventory. The successful
inputs remain unchanged. A separate fixture proves that an unrelated review and
unreadable catalog leave the plan unchanged, while a changed selected-source
fingerprint is rejected. The newly authored XLSX has different binary bytes from
the prototype's author file, but the body package is identical. Old core tests
were not repeated or added to these counts.

## Display work and native compatibility

A further 42 spellbook text records are reviewed, including both complete Spell
Points variants and their tables. Formula output labels retain their required
separator spaces. `Level` needs prefix reordering, component labels keep their
V/S/M tests, and conditional-format literals require bilingual matching. These
language reviews alone do not apply those changes to this body-only package.
Two validation messages are already English in the published selector increment;
that current wording is preserved in the separate display work.

Separate name/bibliography copies passed thirteen actual Calc selection cases:
canonical English labels distinguish the two Sanctum records and Holy/Divine
Word, Summon Elemental loses the unwanted prefix, and the corrected 2014
bibliography returns the actual X column. Original Chinese fallback behavior
remains, including the original raw-name prefix and one-space empty result.
These cases do not establish visible dropdown or layout acceptance.

The earlier missing-LF diagnosis now has an upstream explanation. In the exact
LibreOffice 26.8 runtime source, XLSX import enables `IgnoreLineBreaks`, and the
interpreter removes LF/CR from referenced constant/edit text while retaining
formula-result text. This intentionally implemented policy explains the isolated
experiment; it is not evidence that the stored body data is damaged or that
Excel/WPS behave identically. See the [XLSX importer](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/sc/source/filter/oox/excelfilter.cxx)
and [formula interpreter](https://github.com/LibreOffice/core/blob/bce0998afefdbc355585ca324285661a2170ba77/sc/source/core/tool/interpr4.cxx).

A separate display experiment constructs formula results from short quoted
segments and `CHAR(10)`, leaving the original M values intact. All 1,331 projected
formulas round-trip to the reviewed text, with escaped literals limited to 240
UTF-16 units and maximum formula lengths 3,606/4,114. Eight actual full-text
samples preserve paragraphs through direct/INDEX references after saving and
reopening a new blank Calc document. This is a small compatibility experiment;
no full-card mirror or performance claim follows from it.

Original-height Artifact previews still clip the M3/M30 bodies and cannot verify
their lower formatting. Native Excel/WPS interaction, full layout, final cached
exports, server upload and whole-card English content remain outstanding.
Current coverage is 2,419 reviewed records, with 16,474 records / 792,900 source
characters still missing. The whole project goal remains active.

Local evidence is in sibling `_audit/2026-09-09/xlsx-2024-body-package`,
`xlsx-calc-display`, `xlsx-calc-newline-source`, `xlsx-spell-body-display-mirror`
and `_audit/xlsx-spell-bodies-2024`. No public download or server was replaced.
