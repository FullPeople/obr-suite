# Reviewed spell bodies and the 2014 engineering copy

All static built-in spell descriptions are now translated and reviewed: 522 in
the 2014 card and 809 in the 2024 card. This is not a completed English character
card. Other worksheets, spell fields, display rules, native interaction and the
download/import workflow still need work.

## Translation coverage

The last three 2024 batches add 214 complete descriptions, covering 47,359 source
characters. The originals, original A/N spell keys and public downloads stay
unchanged. Reviews are bound to the original workbook, exact row context, text
fingerprint and occurrence locations.

- Batch 008: 69 records. Root checked every actual source binding and 36 exact
  reuse chains from reviewed 2014 text, and read 18 complete pairs. The other
  reviewer read all 33 new bodies plus one reused body. Root accepted two narrow
  wording corrections: the optional selection in M714 and the activation trigger
  in M681. Two per-record number differences preserve repeated/implicit wording;
  they are not a general rule for ignoring numerals.
- Batch 009: 80 short records. Root read all 80 complete pairs. Three corrections
  clarify each ally's own hit, movement into an area, and the embedded spelling
  Magic Missile. The spelling has exact A127/N127 evidence in the same original;
  Jim's Magic Missile at row 156 is a different identity.
- Batch 010: 65 records. Root read all 65 complete pairs, including all five
  tables, six turn/die bands and six rich-text bodies. Frozen targets were used
  without changes. M735 expresses the source's two repetitions of one zero-HP
  event as one sentence; the single removed zero token is bound to full text
  fingerprints and exact clauses. Other numeral multisets and all 57 ordered
  dice expressions agree.

The source's edition-specific rules and unresolved wording remain documented.
Examples include Teleport's fixed `2d12 li` deviation, the reversed-looking aging
save outcomes, Symbol's six options, all seven Wish alternatives and its strain,
and the caster-next-turn Violet save. Translation does not silently replace them
with remembered rules from another edition.

There are 2,377 reviewed context records across the cards. A further 16,516
records, representing 795,491 source characters, remain untranslated; 2,616 are
long records containing 607,909 characters. The common localization selftest
passed 17 checks after these three batches. These counts describe reviewed text,
not whole-workbook application or native compatibility.

## 2014 body application

The engineering increment applies only the reviewed static values at
`法术大全!M3:M524`. It starts from the main-card dropdown copy, whose complete
SHA-256 is `27103d8af79de8a3dfd0bf1af02d785e69f2f3848d158c3a156dbfc2d7d84ece`.

The actual 522 target rows are authored in a separate workbook using
`author_targets.mjs`. The preservation adapter reads that real XLSX through its
worksheet relationship and compares all A:D identities, locations and full
target strings with a freshly generated plan. It does not import and re-export
the original character card through a general spreadsheet writer.

Only the shared-string part and spell-data worksheet change. The adapter appends
522 clones after the original 6,381 strings and changes the 522 M-cell indices.
All 69,116 existing cells are compared; 68,594 non-target cells remain byte exact.
Styles, images, names, validations, external links, custom-slot formulas, map and
selection sheets, and ZIP metadata remain. The hidden map E column continues to
record original source-field provenance; it is not relabeled as a fingerprint of
the translated current fields.

M209 is the only rich body in the 2014 set. Its four runs are bullet, full
paragraph, bullet, full paragraph. Both Courier New bullet properties and both
FangSong paragraph properties retain their exact original bytes. The reviewed
English is divided into those same four runs without losing its newline.

The actual engineering output has SHA-256
`84333210fcf8788159e57f44b4c1b2ebc01718f764d39ab1aab3020fe351d663`.
It contains 147,966 source characters replaced by 415,714 reviewed English
characters; its longest target is 3,466 UTF-16 code units. All 8,778 worksheet
formula cells still have no cached result. External-link caches remain unchanged.
The inherited SST declared reference count is 14,889 while actual references in
the incoming and resulting engineering copies are 14,885; this increment does
not silently repair the earlier inline-string count difference.

## Verification and limits

The audit prototype passed 13 positive checks and 15 rejection cases, including
10 cases with valid XML. A separate reviewer independently parsed the actual
originals, 12 review files, authored XLSX and output package without calling the
author's plan/application/verifier. That review also rejected three valid XML
changes: a body pointing to another English spell, a changed rich font, and a
changed original A key. The two reviewers' counts are not combined.

Direct body consumers at main-card R84, data-sheet BH12 and spellbook C23 still
resolve column M. This is static dependency evidence. Interactive dropdowns,
full-body visibility, save/reopen, upload and Excel/WPS compatibility remain
separate checks. Small Artifact previews of M3/M209 show clipped text in both
original and candidate; they do not establish complete layout acceptance.

The 2024 card has 36 rich body cells and 300 runs. Their separate application is
being prepared, including the bold cantrip heading and the multi-run Fire Play
paragraph. They must retain run properties and paragraph structure, rather than
be flattened into plain text.

The original 2014 spellbook O8 formula requests column 26 from the 24-column A:X
range. X2 and actual source rows establish X as the bibliography column; the
printed X1 value of 26 is not a physical column number. A separate one-cell audit
copy changes both lookup branches to column 24. It is not included in the body
increment above. Original N337's prefix also remains in C8's raw-name display,
despite the corrected selection label. Both display issues remain distinct from
successful translation and package preservation.

## Portable generation

`spell_bodies_plan.py` and `spell_bodies_package.py` select a checkout with
`--repo`. Outputs are new, prefixed child directories of the checkout's sibling
`_audit/xlsx-spell-bodies`. The plan reads the original and actual reviewed text;
the package regenerates that plan and the complete published original-to-main-list
pipeline. It accepts the newly authored target XLSX, not a saved external plan or
historical seed. All 2,092 A:D cells are checked against the fresh plan. The author
file's actual binary hash is recorded, rather than fixed to an old export.

The 17 retained core functions have identical syntax trees to the reviewed audit
prototype. Root separately reviewed the new entrypoints and selftest. Final wrapper
author verification passed 32 checks with 18 Python CLI calls, one operation marker
and one actual Artifact export. The successful copy contains only 28 required files,
including 13 tools, reviewed data, the glossary and both originals. Those inputs
remain unchanged. Its new authored workbook has a different binary hash from the
earlier export, while the generated body package reproduces `84333210...` exactly.

The checks cover exclusive output boundaries, disabled-assertion rejection,
dependency/source drift, full authored-table matching and an actual valid-XML
wrong-row rejection. Earlier incomplete runs stopped on a shared-drive junction
limitation and two rejection-fixture errors; only the final completed run is
counted. Existing prototype and independent-review test counts are not repeated.
Commands are documented in `tools/xlsx-localization/README.md`.

## Actual Calc diagnosis

An isolated LibreOffice 26.8.0.3 runtime loaded the original, body candidate and
the separate O8-only candidate. The files were read only and never saved. Macros
and link updates were disabled, no interactions were requested, and all three
file hashes remained unchanged. This is actual Calc calculation, not Excel/WPS
or visible dropdown acceptance. Read-only mode controls the UI and still permits
API edits, so only the candidates' C3 selectors were changed in memory.
See the [LibreOffice media descriptor documentation](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1document_1_1MediaDescriptor.html).

Single local loads took about 1.0 seconds and candidate recalculations about
0.07 seconds; these are not cold-start benchmarks. Acid Splash, Vortex Warp and
Summon Elemental resolved to the intended rows. All three O8 results fail with
`#REF!` in the unchanged body increment and return the exact source bibliography
after the one-cell correction. C8 still exposes the raw `术Summon Elemental`
prefix. The original has 78 race-sheet errors plus five circular-reference errors;
the selector candidate retains the 78 race errors. Their causes remain separate.

For the same three spells, source M values retain the full reviewed English, but
the C23 results lose 1, 1 and 21 line-feed characters respectively. String, data
array and paragraph reads all show that difference. A separate new empty Calc
document reproduces it: two source modes (literal multiline text and a CHAR(10)
formula) each feed six direct/INDEX/VLOOKUP expressions, including IFERROR forms.
Before save, all retain three line feeds. After saving only that new sample as
XLSX and reopening it, the six literal-source references lose line feeds; the
literal source itself and all CHAR(10)-source references remain complete. Explicit
recalculation gives the same result. The actual saved XML retains the line feeds
in both source strings and inspected formula caches.

This isolates a behavior of this Calc version when loading/evaluating XLSX;
it does not establish Excel/WPS behavior or yet prove the internal cause. No
CHAR(10) conversion or content workaround was applied to the engineering card.
Both Calc experiments returned successful process exits, but office stderr
retains a Python-library-path warning. No warning-free or full-layout acceptance
is claimed. Exact scripts, versions, values and limitations are in the local
`xlsx-calc-body` and `xlsx-calc-newline` evidence directories.

Local evidence is under sibling `_audit/2026-09-09/xlsx-spell-body`,
`xlsx-translation-batches`, `xlsx-2024-rich-body-plan`, and
`xlsx-spell-display-corrections`. Engineering copies are deliberately named
`NO-CACHE-NOT-FOR-UPLOAD`; they are not replacements for the public downloads.
