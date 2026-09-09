# English spellcasting ability inputs

The parser previously selected the Charisma row for an English `Intelligence` or
`Wisdom` input. This patch recognizes those English names and `Charisma`, ignoring
case, while retaining the player's entered display text. Existing explicit layout
keys take precedence. Chinese values, unknown inputs and physical abilities retain
their previous behavior; no DC is invented for unsupported spellcasting rows.

This is the fifth parser-only increment. Apply the preceding packages in order:
`sheet-aliases-20260908`, `shield-input-20260908`, `spell-aliases-20260908`, then
`main-fields-20260909`. The required preceding parser hash is
`9272d4edda9cab30aa1acf9ed7b06b9d9192ff248144654307f33e62c553b7d4`;
the result is `2512a21b5d760447887ce323eac3aababcda439e714c71062706186a4e9dce06`.
No server installation or deployment is performed by verification.

```text
python -B -X utf8 verify_delivery.py --source <main-fields-result/parser.py> --xlsx-dir <original-card-directory> --out-dir <new-evidence-directory>
python -B -X utf8 apply_parser_patch.py --help
```

Keep the five package directories together. Verification needs Python and
openpyxl, plus the two pinned Chinese originals listed in `manifest.json`. It
checks the exact forward/reverse chain and integrity guards in an isolated
directory, then runs seven parser test groups. Tests read original cards and use
in-memory views; they never save workbooks. Legacy coverage uses the actual old
coordinate configuration with seeded values, not an original v1.0.0 workbook.

This package does not translate remaining card content or fix workbook formula
caches. Full English downloads, save/reopen/upload and actual room acceptance
remain separate work.
