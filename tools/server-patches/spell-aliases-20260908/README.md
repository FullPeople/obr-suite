# English spell names: incremental server patch

Entering `Acid Splash` in the character card previously preserved the name but
lost the spell's description and metadata. This patch resolves a unique English
name from column N to its original name in column A and the corresponding body
in column M, within the same imported workbook. It follows the sheet-role and
shield-input packages and changes only parser.py.

Original names remain the first lookup choice. The original database keys,
values and size stay unchanged; aliases belong to this import and are not cached
across workbooks. All existing spell groups use the same lookup, and the entered
display name is preserved. English aliases trim outer whitespace and ignore
case. Repeated English names, repeated original-name rows and aliases colliding
with an existing original key are omitted instead of choosing a body arbitrarily.

The supplied 2024 workbook really contains two distinct rows called
`Sanctum of the Flock` in N452 and N646. An English-only lookup for that ambiguous
name remains unenriched. Its original names still follow the existing behavior.
The patch does not replace ambiguous names, rewrite source content, or add fields
to the imported JSON.

## Exact patch chain

| State | SHA256 | Bytes |
| --- | --- | ---: |
| Required input: shield-input result | `ff02e712b37dd855e1af189969365c6049895d95c93733cb8126fe5610400766` | 78927 |
| Result | `a07204634e7f6b5a306ed444c6fbc5ef699c53a2b95331f6f2de3b729de7febe` | 80109 |
| parser.patch | `8532cbff8efbc96999802c945e57f3a40302d0d2f173262a337c0eabc456e389` | 3155 |

Input, patch, result and tests retain UTF-8/LF. The standard-library applier is
byte-identical to the prior packages. It verifies source, patch and result hashes
and sizes, refuses in-place writes and existing outputs, and never fuzzily applies
a patch to a different server version.

```powershell
$py = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$patch = 'U:\枭熊插件\obr-suite\tools\server-patches\spell-aliases-20260908'
& $py -B -X utf8 "$patch\apply_parser_patch.py" apply --source 'parser-after-shield.py' --check
& $py -B -X utf8 "$patch\apply_parser_patch.py" apply --source 'parser-after-shield.py' --output 'parser-after-spell-aliases.py'
& $py -B -X utf8 "$patch\apply_parser_patch.py" reverse --source 'parser-after-spell-aliases.py' --output 'parser-before-spell-aliases.py'
```

These commands create reviewable files. They do not install or deploy them.

## Isolated verification

Keep both unchanged prerequisite packages beside this directory. The verifier
checks their complete file hashes, reverses all three patches, reapplies the chain
byte-for-byte, and runs actual parser functions against the two pinned original
workbooks through read-only views. openpyxl is used only for reading and in-memory
fixtures; no workbook is saved or recalculated.

```powershell
& $py -B -X utf8 "$patch\verify_delivery.py" --parser 'U:\枭熊插件\character-cards-server\parser.py' --xlsx-dir 'U:\枭熊插件\obr-suite\public' --out-dir 'U:\枭熊插件\_audit\2026-09-08\xlsx-server-spell-alias\another-new-verification'
```

Use a new output directory. The checks include 14 spell-name test groups, the
unchanged 12 shield groups, 26 sheet-role/resource groups, and eight patch/CLI
integrity guards. Original Chinese full-import results are compared with the
preceding parser, excluding only the existing volatile timestamp. Tests cover
all spell groups, actual English worksheet aliases, duplicates and collisions,
alternating versions, old layouts, missing names/bodies, and unchanged cached
levels. Logs and results remain separate from native workbook acceptance.

The first integration attempt put the oldest parser in the reusable guards'
`baseline` path. Its in-place-write check correctly failed because the source
hash was for the wrong patch stage. The final verifier gives those guards their
own directory containing this patch's immediate input. It passed in a fresh
directory without changing any parser or weakening the guard.

## Remaining workbook work

This fixes server-side association only. The returned body keeps the language
currently stored in M. Workbook dropdowns, P77 level lookup and dependent
concentration/ritual formulas still require their own English migration. Neither
the old AV1 overlay priority nor the existing source-column/header filtering is
changed. A missing cache stays missing; the server does not synthesize a new
Excel result. Full-English downloads, native recalculation and actual uploads
remain separate work. No service deployment is included.
