# English main-card headings and resource defaults

This sixth parser patch accepts the English main-card metadata headings and the
singular `Special Ability` section title. It keeps the existing layout and merged
range guards. The resource tracker skips the English `Special Ability` default,
including case and surrounding whitespace, so nine unused inputs do not become
nine resources. Real names such as `Name`, `Speed` and `Special Ability: Rage`
remain valid resource names.

Apply only after these packages, in order: `sheet-aliases-20260908`,
`shield-input-20260908`, `spell-aliases-20260908`, `main-fields-20260909`,
`ability-inputs-20260909`. The exact input hash is
`2512a21b5d760447887ce323eac3aababcda439e714c71062706186a4e9dce06`.
The output hash is
`457449293fd32bc45a409a8dd6109c34244ec53194d3bbb5b061969576479d03`.
The two original public XLSX templates are test inputs and must remain unchanged.

Use `verify_delivery.py --source <fifth-result-parser.py> --xlsx-dir <original-public-dir>
--out-dir <new-evidence-dir>` with Python and openpyxl to reproduce the six-package
forward/reverse chain, integrity guards and eight actual parser tests. The source
parser is read only. No running service is installed or restarted. The verifier
creates isolated parser copies and never saves a spreadsheet.

`apply_parser_patch.py --help` describes the separate exact-hash apply/reverse
operations. Unknown inputs, modified patches and existing output files are
rejected. This package is reviewable source, not evidence of server deployment
or of recalculated downloadable English cards.
