# Shield equipped input: incremental server patch

This patch corrects the equipped input for the two verified modern character-card layouts. It follows `sheet-aliases-20260908`; it does not replace or modify that package.

The parser changes only after the existing version/ruleset and worksheet-role resolver has accepted a modern layout. An explicit `v1.0.0` title remains on its historical path. All three main-sheet headers must also match:

| Cell | Accepted headers |
| --- | --- |
| AL39 | 盾牌 / Shield |
| AQ39 | AC / Armor Class |
| AS39 | 着装 / Equipped |

Matching trims outer whitespace and ignores English case. Only then does this import receive a copy of its main layout with `shield_equipped=AS40`. The shared layout constant remains AS41. Unknown or missing headers preserve AS41 and its prior value interpretation.

The proven AS40 input accepts 是/否 and Yes/No. Existing affirmative symbols and values (O, Y, ✓, 1, True and the already supported string variants) remain accepted; the patch does not reinterpret unrelated Chinese fields. The prior default for old layouts without any equipped coordinate remains true.

## Exact chain

| State | SHA256 | Bytes |
| --- | --- | ---: |
| Required input: published sheet-alias result | `9791888eddaac50e771baaff0cc7e738ef1b5cb18b52a954344ccd2224512c34` | 78470 |
| Result | `ff02e712b37dd855e1af189969365c6049895d95c93733cb8126fe5610400766` | 78927 |
| Incremental parser.patch | `2e20f623f019475c31e46805f6703ce914b08283e9f90144bde38597739770ec` | 2700 |

Parser input, result, and patch retain UTF-8/LF. The patch has four small hunks: two explanatory comment changes, a ten-line proven-layout override, and the two-line Chinese affirmative handling. It never globally replaces AS41.

## Apply or reverse to a new file

The standard-library applier is byte-identical to the preceding package's applier. It requires exact source, patch, and result hashes and sizes. It rejects unknown input, wrong direction, modified context, CRLF conversion, existing output files, and in-place writes.

```powershell
$py = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$patch = 'U:\枭熊插件\obr-suite\tools\server-patches\shield-input-20260908'
& $py -B -X utf8 "$patch\apply_parser_patch.py" apply --source 'parser-after-aliases.py' --check
& $py -B -X utf8 "$patch\apply_parser_patch.py" apply --source 'parser-after-aliases.py' --output 'parser-after-shield.py'
& $py -B -X utf8 "$patch\apply_parser_patch.py" reverse --source 'parser-after-shield.py' --output 'parser-before-shield.py'
```

These commands create reviewable files only. They do not install or deploy them.

## Isolated verification

Keep the unchanged preceding package beside this one. The verifier checks its required file hashes, reconstructs both older parser states by reverse patch, reapplies both patches byte-for-byte, and runs the real parser against both pinned original workbooks.

```powershell
& $py -B -X utf8 "$patch\verify_delivery.py" --parser 'U:\枭熊插件\character-cards-server\parser.py' --xlsx-dir 'U:\枭熊插件\obr-suite\public' --out-dir 'U:\枭熊插件\_audit\2026-09-08\xlsx-server-shield\another-new-verification'
```

Use a new output directory. The verifier never deletes/reuses evidence. It fixes child Python output to UTF-8 so Windows error paths containing Chinese can be checked without suppressing decoding errors.

The dedicated suite has 12 test groups covering:

- Actual old failures for both versions with 是 and Yes; AS40/AS41 deliberately disagree.
- Both main-sheet names and all Chinese/English header combinations; every missing/unknown header falls back.
- Yes/No, Chinese values, old symbols, blank values, and conflicting inputs.
- Zero/empty shield bonuses, explicit old layouts, missing version evidence, duplicate main roles, and import isolation.
- Complete parse equality except the intended equipped flag, preserved AV1 overlay priority, original AC/weight caches, and the existing missing-AC fallback.
- Unchanged complete results for both original Chinese cards and unchanged original file hashes.

The isolated run also executes the unchanged preceding alias/resource suite: 26 groups. Eight integrity/CLI guards verify rejection paths and no overwrite/in-place writes. Tests use actual source workbooks through read-only views; inputs changed by fixtures exist only in memory.

## Numeric and compatibility boundaries

There is **no new zero/blank AC-bonus gate**. With AS40=Yes and AQ40=0 or blank, the server still reports equipped=true with ac_bonus=0 or null, matching the previous server contract for an affirmative equipped input. The frontend's separate zero/blank behavior is not changed here.

Existing nonzero AC values are not recomputed. In the full-parse tests, the old AV1 AC cache still takes priority: a view with D23=12 and the original AV1 produces AC=10, as before; removing AV1 in the same view produces AC=12. Inventory/weight and export payloads remain equal to the baseline.

When AC is missing or zero and there is no overriding AV1 AC, the existing fallback consumes the corrected equipped flag. A positive shield bonus of 2 therefore raises that fallback result by 2; a zero/blank bonus raises it by 0. This is an explicitly tested consequence of the repaired input, not a change to fallback code or workbook formulas.

No schema fields, attunement handling, AV1 overlay, AC/weight formulas, workbook contents, frontend, or service authentication were changed. This package does not establish Excel/WPS recalculation, upload correctness, or deployment. The workbook's separate AV1 AS41 reference and enum-dependent formulas remain their own pending work.
