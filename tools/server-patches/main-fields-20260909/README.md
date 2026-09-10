# Correct main-card input positions

The server previously read armor names and item quantities from the adjacent
skills area, money from currency labels, and only the first part of the class
features table. In the 2014 card, special abilities also entered the fighting
style list while familiar fields entered the special-ability list.

This fourth incremental parser patch recognizes each section using its known
Chinese or English headers and actual merged input ranges. It runs only after
the existing role resolver accepts a modern card and a 2014/2024 ruleset marker.
Unknown sections retain their previous coordinates. The explicit v1.0.0 path
and shared layout dictionaries remain unchanged.

| Field | Recognized current-card source |
| --- | --- |
| Selected armor name | L40; custom armor display name R40 remains separate |
| Wondrous items | Ten rows, 42–51; one item per row because this table has no quantity input |
| Consumable quantity | AP53–AP57, the left quantity; secondary AS is unchanged |
| GP / PP / EP / SP / CP | AI59 / AP59 / AI60 / AI61 / AI62 |
| Class features | 2014 rows 14–77; 2024 rows 17–77 |
| Special abilities | 2014 rows 33–37; 2024 rows 40–44 |
| Fighting style feats | Empty in the recognized 2014 special-ability section; 2024 rows 33–37 |
| Racial / species traits | Rows 6–15, excluding creature type, size and speed metadata |
| Shield equipped input | Existing guarded AS40 correction also recognizes the short English caption `Worn` |

No field is renamed in the JSON. Existing numeric conversion, cached total
wealth, other combat fields, spell lookups and backpack behavior remain. The
existing AV1 overlay accepts selected stats and identity fields; it does **not**
override inventory or features. This patch preserves that contract.

## Apply to a review copy

Keep `sheet-aliases-20260908`, `shield-input-20260908` and
`spell-aliases-20260908` beside this directory. The required immediate input is
the spell-alias result, SHA256
`a07204634e7f6b5a306ed444c6fbc5ef699c53a2b95331f6f2de3b729de7febe`.
Exact result, patch and prerequisite hashes are in `manifest.json`.

```powershell
$py = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$patch = 'U:\枭熊插件\obr-suite\tools\server-patches\main-fields-20260909'
& $py -B -X utf8 "$patch\apply_parser_patch.py" apply --source 'parser-after-spell-aliases.py' --check
& $py -B -X utf8 "$patch\apply_parser_patch.py" apply --source 'parser-after-spell-aliases.py' --output 'parser-after-main-fields.py'
& $py -B -X utf8 "$patch\apply_parser_patch.py" reverse --source 'parser-after-main-fields.py' --output 'parser-before-main-fields.py'
```

The byte-identical standard-library applier checks source, patch and result
before writing. It refuses unknown input, fuzzy application, in-place writes
and existing output files. All files retain UTF-8/LF.

## Verification

The verifier needs openpyxl to read the two pinned original cards. It reverses
and reapplies all four patches, checks delivered and prerequisite file hashes,
runs eight integrity guards and 14 actual-parser test groups in isolation.
Tests cover all current rows and their last entries, empty rows, adjacent
skills, numeric policy, English captions, section-local fallback, alternating
versions, explicit legacy override, full-import field differences and existing
AV1 behavior. An AST comparison also checks every unrelated function and
module-level statement against the preceding parser.

```powershell
& $py -B -X utf8 "$patch\verify_delivery.py" --source 'U:\枭熊插件\character-cards-server\parser.py' --xlsx-dir 'U:\枭熊插件\obr-suite\public' --out-dir 'U:\枭熊插件\_audit\2026-09-09\xlsx-server-main-fields\another-new-verification'
```

Use a new output directory. Source workbooks are opened without saving and
test edits use read-only views. No cache is generated. Installing the result
in a running service and actual browser upload acceptance are separate steps.
The public Chinese cards and unfinished English engineering cards are not
replaced by this package. Armor weight and other unproven coordinates remain
outside this correction.
