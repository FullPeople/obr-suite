# Character-card server: versioned worksheet aliases

This is a reviewed patch delivery for the separate `character-cards-server` parser. It contains no service configuration, database, original workbook, or full original parser. It does not deploy or start a service.

`parser.patch` changes only `parser.py`. It resolves each worksheet role before parsing cells, supports approved Chinese/English and unambiguous mixed titles, and rejects missing required sheets, conflicting versions and duplicate semantic aliases. The JSON schema, overlay behavior, numeric rules, and HTTP/HTML code remain unchanged.

## Exact input and result

| State | SHA-256 | Bytes / line endings |
| --- | --- | --- |
| Original parser | `b7f73c7fc06e11679b696b7b08e528ae9aaf455518a4f03bcb2eb1c645b6c9c1` | 74279 / LF |
| Alias parser | `9791888eddaac50e771baaff0cc7e738ef1b5cb18b52a954344ccd2224512c34` | 78470 / LF |
| Parser-only patch | `6d6adf180d67beb1449757c7f559983d4606fe653df353eaa60d07e03d81fd43` | 10954 / LF |

The earlier local snapshot unnecessarily converted the parser to CRLF (`ee726e…`, 80346 bytes), inflating its combined patch to 176449 bytes. That error was corrected by restoring the original LF endings without changing code text. Old CRLF evidence remains in the local audit archive. The current LF artifact was tested again; old runs are not claimed as evidence for new bytes.

The manifest pins the patch, parser states, test copies, and two original Chinese workbooks. Tests are copied with LF line endings; their original server-file hashes are also recorded. `.gitattributes` keeps this delivery's files LF on checkout.

## Apply or reverse without overwriting a source

The standard-library tool requires the exact input, patch and output hashes. It performs no fuzzy matching or automatic newline conversion, writes only a **new output file**, and rejects in-place/existing-file writes. Create the chosen output directory first. Commands below run from the `obr-suite` repository root:

```powershell
python tools/server-patches/sheet-aliases-20260908/apply_parser_patch.py apply --source 'C:\review\original-parser.py' --check
python tools/server-patches/sheet-aliases-20260908/apply_parser_patch.py apply --source 'C:\review\original-parser.py' --output 'C:\review\alias-parser.py'
python tools/server-patches/sheet-aliases-20260908/apply_parser_patch.py reverse --source 'C:\review\alias-parser.py' --output 'C:\review\restored-original-parser.py'
```

`--check` does the full transformation and result-hash check without writing. Wrong versions, modified inputs, CRLF-converted inputs, patch corruption, mismatched context or unexpected output hashes fail before an output file is opened. Producing a review file does not replace or deploy the running service.

## Independent verification

Requires Python and `openpyxl`. Supply the final LF parser and the directory containing the two pinned original Chinese cards. The output directory must not exist. The verifier reverse-patches the baseline into this new directory, reapplies the patch, copies only parser/tests there, and runs the tests with explicit workbook/baseline paths. It leaves logs and `report.json` for review; it never saves a workbook.

```powershell
python tools/server-patches/sheet-aliases-20260908/verify_delivery.py --parser 'U:\枭熊插件\character-cards-server\parser.py' --xlsx-dir 'U:\枭熊插件\obr-suite\public' --out-dir 'C:\review\alias-verification-new'
```

Result on 2026-09-08: **26 tests, 5 mutations, 8 integrity guards passed**, with exact apply/reverse byte equality. Full parsed output, except the timestamp, matches the prechange parser for the original cards and in-memory English/mixed renames. Spell databases retain 522/808 entries; seeded actual spell text, inventory, HP, AC and ability values also match. Historical layouts use explicit in-memory fixtures, not claimed historical Excel files.

The 26 tests comprise 15 alias tests plus the existing 11 resource-ID regressions. The mutation runner changes only in-memory parser copies; syntax errors, missing anchors or unrelated exceptions are failures, not successful mutation detections. The verifier guards wrong input/direction, tampered patch, wrong result hash, mismatched context, and wrong-source/existing/in-place output writes.

For manual execution in an isolated parser/test directory, set `OBR_ALIAS_PUBLIC` to the original-card directory and `OBR_ALIAS_BASELINE` to the reverse-restored original parser, then run:

```powershell
python -B -X utf8 -W ignore::DeprecationWarning -m unittest -v test_sheet_aliases test_auto_resources
python -B -X utf8 -W ignore::DeprecationWarning test_sheet_aliases_mutations.py
```

This delivers sheet-name compatibility only. Enum/lookup-key migration, AV1 length/escaping, fresh Excel/WPS recalculation, full English text, actual upload, and deployment remain separate work. See the [project research report](../../../docs/research/xlsx-server-sheet-aliases-20260908.md).
