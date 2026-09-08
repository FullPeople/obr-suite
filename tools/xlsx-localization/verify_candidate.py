"""Fail-closed static checks for a future translated copy. Does not edit XLSX.

This is not an Excel calculation, visual, import or translation-quality test.
Explicit hash approvals acknowledge exact intentional rewrites for review; they
cannot waive the AV1 schema/ruleset, missing cached JSON or structural checks.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from prepare import CJK, HERE, TEMPLATES, digest, inspect_xlsx


def compare(baseline, candidate, approvals=None, require_english=False, candidate_records=()):
    approvals = approvals or {}
    errors, notes = [], []
    renames = approvals.get("sheet_renames", {})
    accepted = approvals.get("changes", {})

    def check(condition, message):
        if not condition:
            errors.append(message)

    def allow_change(key, before, after):
        if before == after:
            return
        allowed = accepted.get(key)
        check(allowed == {"before": digest(before), "after": digest(after)}, f"Unapproved change: {key}")

    check(baseline["version"] == candidate["version"], "Rule-version context changed")
    expected_names = [renames.get(s["name"], s["name"]) for s in baseline["sheets"]]
    check(len(set(expected_names)) == len(expected_names), "Sheet rename collision")
    check(all(0 < len(n) <= 31 and not any(c in n for c in '[]:*?/\\') for n in expected_names), "Invalid Excel sheet name")
    check(expected_names == [s["name"] for s in candidate["sheets"]], "Sheet names/order differ from approved mapping")
    check(len(baseline["sheets"]) == len(candidate["sheets"]), "Worksheet count changed")
    for before, after in zip(baseline["sheets"], candidate["sheets"]):
        for key in ["state", "part", "cell_count", "cell_addresses_sha256", "formula_count", "merges", "validation_count", "conditional_blocks"]:
            check(before[key] == after[key], f"{before['name']}: {key} changed")
        allow_change("geometry:" + before["name"], before["geometry_sha256"], after["geometry_sha256"])
        known_errors = {(e["cell"], e["error"]) for e in before["cached_errors"]}
        new_errors = {(e["cell"], e["error"]) for e in after["cached_errors"]} - known_errors
        check(not new_errors, f"{before['name']}: new cached Excel errors {sorted(new_errors)}")
    check(set(baseline["parts"]) == set(candidate["parts"]), "OOXML package parts added or removed")
    # Objects, formatting, comments and external relationships must survive.
    # Worksheet/shared-string/workbook text is checked by dedicated inventories;
    # hash approval of these opaque parts does not bypass the checks above.
    for part, before in baseline["parts"].items():
        if part not in candidate["parts"]:
            continue
        if not (part.startswith("xl/worksheets/") and part.endswith(".xml")) and part not in {"xl/sharedStrings.xml", "xl/workbook.xml"}:
            allow_change("part:" + part, before, candidate["parts"][part])
    before_formulas = {(renames.get(f["sheet"], f["sheet"]), f["cell"]): f for f in baseline["formulas"]}
    after_formulas = {(f["sheet"], f["cell"]): f for f in candidate["formulas"]}
    check(set(before_formulas) == set(after_formulas), "Formula cells added, removed or moved")
    for identity in before_formulas.keys() & after_formulas.keys():
        before, after = before_formulas[identity], after_formulas[identity]
        check(before["attributes"] == after["attributes"], f"Formula type/range changed: {identity}")
        allow_change(f"formula:{before['sheet']}!{before['cell']}", before["formula"], after["formula"])
    check(len(baseline["validations"]) == len(candidate["validations"]), "Dropdown/validation count changed")
    for before, after in zip(baseline["validations"], candidate["validations"]):
        check(renames.get(before["sheet"], before["sheet"]) == after["sheet"] and before["index"] == after["index"], "Validation identity changed")
        for key in ["sqref", "type", "operator", "allowBlank", "showErrorMessage"]:
            check(before["attributes"].get(key) == after["attributes"].get(key), f"Validation behavior changed: {before['sheet']} #{before['index']} {key}")
        allow_change(f"validation:{before['sheet']}:{before['index']}", before["formulas"], after["formulas"])
    allow_change("defined_names", baseline["defined_names"], candidate["defined_names"])
    check(baseline["external_relationships"] == candidate["external_relationships"], "External links changed; do not silently reconnect old author files")
    av1 = candidate.get("av1")
    check(bool(av1), "AV1 not resolved on the explicitly selected Main sheet")
    if av1:
        check(not av1["json_error"] and av1["cache_characters"] > 0, "AV1 cached JSON missing/invalid")
        check(av1["schema"] == "obr-suite-card/v1", "AV1 machine schema changed")
        check(av1["ruleset"] == "5E" + baseline["version"], "AV1 ruleset changed")
        check(av1["json_shape"] == baseline["av1"]["json_shape"], "AV1 JSON keys/types changed")
        check(0 < av1["formula_characters"] <= 8192, f"AV1 formula length {av1['formula_characters']} exceeds Excel's 8192-character limit or formula is missing")
        notes.append("Cached JSON was parsed only; its freshness and correspondence to cell inputs are not verified.")
        if av1["sheet"] != "主要" or av1["shield_cells"].get("AL39") != "盾牌":
            notes.append("English Main/Shield labels require updated backend and frontend import aliases; this static checker does not certify those consumers.")
    if require_english:
        # Machine names and font attributes can remain Chinese only after an
        # explicit per-record exemption. Missing visible prose is never hidden
        # by excluding hidden sheets or long strings from the gate.
        exemptions = set(approvals.get("chinese_exemptions", []))
        remaining = [r for r in candidate_records if CJK.search(r["source"]) and r["id"] not in exemptions]
        check(not remaining, f"Chinese text remains in {len(remaining)} context records; no full-English claim")
    notes.append("Excel/WPS recalculation, visual inspection of all visible/hidden sheets and images, dropdown selections and actual upload remain required.")
    return {"static_checks_pass": not errors, "release_ready": False, "errors": errors, "notes": notes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--version", required=True, choices=TEMPLATES)
    parser.add_argument("--approvals", type=Path)
    parser.add_argument("--require-english", action="store_true")
    args = parser.parse_args()
    structures = json.loads((HERE / "structure.json").read_text(encoding="utf-8"))
    baseline = next(s for s in structures if s["version"] == args.version)
    glossary = json.loads((HERE / "glossary.json").read_text(encoding="utf-8"))
    approvals = json.loads(args.approvals.read_text(encoding="utf-8")) if args.approvals else None
    main_sheet = (approvals or {}).get("sheet_renames", {}).get("主要", "主要")
    candidate, records, _ = inspect_xlsx(args.candidate, args.version, glossary, main_sheet)
    result = compare(baseline, candidate, approvals, args.require_english, records)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["static_checks_pass"] else 1)


if __name__ == "__main__":
    main()
