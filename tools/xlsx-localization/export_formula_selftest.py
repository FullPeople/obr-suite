"""Bounded AV1 compiler tests against both actual, untouched reference files.

Only JSON plans and an evaluation report are written, under --output-dir.
This exercises generated formulas with a reference evaluator; it does not claim
that Excel/WPS recalculated anything. Independent expectations use the originals'
valid JSON structure and Python JSON's string semantics, not the escape builder.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from unittest.mock import patch

sys.dont_write_bytecode = True
import export_formula as exporter
from export_formula import (Compiler, ExcelError, Formula, MAX_FORMULA, MAX_TEXT,
                            NS, OVERFLOW, Rejected, evaluate, evaluate_plan,
                            make_plan, read_original, utf16len, walk)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AUDIT = ROOT.parent / "_audit/2026-09-08/xlsx-export-formula"
HASHES = {
    "2014": "94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6",
    "2024": "264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04",
}


def expect_reject(fn, contains=None):
    try:
        fn()
    except (Rejected, json.JSONDecodeError) as error:
        if contains:
            assert contains in str(error), str(error)
        return
    raise AssertionError("Expected an explicit refusal")


def strings(value, replace):
    if isinstance(value, dict):
        return {key: strings(v, replace) for key, v in value.items()}
    if isinstance(value, list):
        return [strings(v, replace) for v in value]
    if isinstance(value, str):
        for before, after in replace.items():
            value = value.replace(before, after)
    return value


def run_version(version, path, output):
    source = read_original(path)
    assert source["sha256"] == HASHES[version], "Reference changed: re-audit, do not bless a different source"
    tree = Formula(source["formula"]).tree
    plan = make_plan(source["formula"], main_sheet=source["main_sheet"], sheet_names=source["sheet_names"])
    inputs, main = source["values"], source["main_sheet"]
    cases = []
    original = lambda values: json.loads(evaluate(tree, values, main))
    actual = lambda values, p=plan: json.loads(evaluate_plan(p, values))

    assert original(inputs) == source["cached_json"]
    assert actual(inputs) == source["cached_json"]
    assert source["cached_json"]["schema"] == "obr-suite-card/v1"
    assert source["cached_json"]["meta"]["ruleset"] == "5E" + version
    cases.append("actual original AST, existing AV1 JSON, and new formula plan agree field by field")

    # Out-of-grid references can look like a harmless empty source cell in a
    # model, while Excel cannot represent them. Exercise real AV1 substitutions.
    assert source["formula"].count("&E3&") == 1
    for cell in ["XFE1", "A1048577", "$XFE$1", "XFD1048577", "A0"]:
        expect_reject(lambda cell=cell: make_plan(source["formula"].replace("&E3&", "&" + cell + "&"),
                      main_sheet=main, sheet_names=source["sheet_names"]))
    for cell in ["XFD1", "A1048576", "$XFD$1048576"]:
        bounded = make_plan(source["formula"].replace("&E3&", "&" + cell + "&"),
                            main_sheet=main, sheet_names=source["sheet_names"])
        values = dict(inputs); values[main, cell.replace("$", "")] = "Valid boundary"
        assert json.loads(evaluate_plan(bounded, values))["identity"]["character_name"] == "Valid boundary"
    cases.append("invalid Excel row/column references rejected; XFD and 1048576 boundaries retain source values")

    secondary = next(s for s in source["sheet_names"] if s != main)
    for bad in [*("Review" + chr(c) + "Name" for c in range(32)),
                "Review\ufffeName", "Review\ud800Name", "😀" * 16]:
        expect_reject(lambda bad=bad: make_plan(source["formula"], main_sheet=main,
                      sheet_names=source["sheet_names"], export_sheet=bad))
        expect_reject(lambda bad=bad: make_plan(source["formula"], main_sheet=main,
                      sheet_names=source["sheet_names"], sheet_map={secondary: bad}))
    edge_name = "R" * 31
    named = make_plan(source["formula"], main_sheet=main, sheet_names=source["sheet_names"], export_sheet=edge_name)
    assert json.loads(evaluate_plan(named, inputs)) == source["cached_json"]
    cases.append("invalid sheet-name scalars explicitly rejected before formula encoding; 31-unit name accepted")

    # Corrupt shared-string indices must never use Python negative indexing.
    # The malformed ZIP and its fake path exist only in memory, never on disk.
    original_bytes = path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(original_bytes)) as z:
        entries = {info.filename: z.read(info) for info in z.infolist()}
    q = lambda name: "{" + NS + "}" + name
    string_count = len(ET.fromstring(entries["xl/sharedStrings.xml"]))
    original_zip, original_read = zipfile.ZipFile, Path.read_bytes
    fake = output / (version + "-memory-only-shared-index.xlsx")
    assert not fake.exists()
    for index in ["-1", str(string_count), "1.5", "no", "9" * 20, "0", str(string_count - 1)]:
        sheet_root = ET.fromstring(entries[source["av1_part"]])
        cell = sheet_root.find(f".//{q('c')}[@r='E3']")
        assert cell is not None
        for child in list(cell): cell.remove(child)
        cell.set("t", "s"); ET.SubElement(cell, q("v")).text = index
        modified = {**entries, source["av1_part"]: ET.tostring(sheet_root, encoding="utf-8")}
        memory = io.BytesIO()
        with original_zip(memory, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in modified.items(): z.writestr(name, data)
        raw = memory.getvalue()
        with patch.object(Path, "read_bytes", lambda p: raw if p == fake else original_read(p)), \
             patch.object(exporter.zipfile, "ZipFile", lambda p, *a, **k: original_zip(io.BytesIO(raw) if p == fake else p, *a, **k)):
            if index in ("0", str(string_count - 1)):
                assert isinstance(read_original(fake)["values"][main, "E3"], str)
            else:
                expect_reject(lambda: read_original(fake))
    assert not fake.exists() and path.read_bytes() == original_bytes
    cases.append("in-memory malformed shared-string indices rejected; first/last entries accepted; originals unchanged")

    # JSON placeholders permit an independent oracle for *every* string field,
    # including gated rows and fields concatenating multiple cell values.
    active = dict(inputs)
    tokens = {}
    for index, entry in enumerate(plan["escaped_sources"]):
        key = entry["sheet"], entry["cell"]
        token = f"__REF_{index:04d}__"
        active[key] = token
        tokens[key] = token
    expected_structure = original(active)
    assert actual(active) == expected_structure
    assert len(expected_structure["classes"]) == 3
    assert len(expected_structure["combat"]["weapons"]) == 5
    assert len(expected_structure["special_resources"]) == 9
    assert len(expected_structure["wondrous"]) == 11
    assert len(expected_structure["consumables"]) == 5
    assert len(expected_structure["features"]["special_abilities"]) == 6
    if version == "2024":
        assert len(expected_structure["features"]["fighting_style"]) == 5
        assert "mastery_effect" in expected_structure["combat"]["weapons"][0]
    else:
        assert "fighting_style" not in expected_structure["features"]
        assert "mastery_effect" not in expected_structure["combat"]["weapons"][0]
    cases.append("all optional classes/array rows and version-specific fields preserved")

    payload = '  C:\\notes\\new "quoted"\r\nline\t' + "😀中文" + ' _x000A_ \\u001f  '
    injected = dict(active)
    for key in tokens: injected[key] = payload
    expected_injected = strings(expected_structure, {t: payload for t in tokens.values()})
    assert actual(injected) == expected_injected
    cases.append(f"all {len(tokens)} dynamic string sources roundtrip paths/quotes/CRLF/tab/Unicode/literal OOXML-like text")

    controls = "|".join(chr(n) for n in range(1, 32)) + "\x7f"
    for payload in [controls, "a\rb\nc\r\nd\te\bf\fg", '\\"\\\\n', "=SUM(A1:A2)&<>  "]:
        values = dict(inputs)
        values[main, "E3"] = payload
        got = actual(values)
        assert got["identity"]["character_name"] == payload
        expected = copy.deepcopy(source["cached_json"])
        expected["identity"]["character_name"] = payload
        assert got == expected
    cases.append("every CHAR(1..31), DEL, distinct CR/LF/CRLF and formula-like ordinary text preserved without CLEAN")

    # Reproduce the real original defect instead of only asserting our helpers.
    for payload in ['A"B', "a\r\nb"]:
        values = dict(inputs); values[main, "E3"] = payload
        expect_reject(lambda: original(values))
    values = dict(inputs); values[main, "E3"] = r"C:\notes"
    assert original(values)["identity"]["character_name"] != r"C:\notes"
    assert actual(values)["identity"]["character_name"] == r"C:\notes"
    cases.append("original quote/CRLF failures and silent backslash corruption reproduced")

    for value in [None, "", "12", True, False, 12, -7, 12.5]:
        values = dict(active)
        values[main, "O6"] = value
        values[main, "R22"] = value
        values[main, "AN60"] = value
        got = actual(values)
        assert got == original(values)
        expected = value if type(value) in (int, float) else 0
        assert got["classes"][0]["level"] == expected
        assert got["core_stats"]["hp"]["current"] == expected
        assert got["currency"]["pp"] == expected
    values = dict(active)
    values[main, "E7"] = ""
    values[main, "B33"] = ""
    values[main, "BT41"] = ""
    values[main, "BZ41"] = ExcelError("#N/A")
    assert actual(values) == original(values)
    values[main, "E7"] = ExcelError("#VALUE!")
    expect_reject(lambda: actual(values), "Error in formula condition")
    cases.append("number/bool/text/blank coercion, zero defaults, filtered rows and inactive errors retain original behavior")

    for value in ["是", "否", "Yes", "No", "custom equipped"]:
        values = dict(inputs)
        values[main, "AS41"] = value
        values[main, "AS40"] = "conflicting input must be ignored by AV1"
        assert actual(values)["combat"]["shield"]["equipped"] == value
    assert '""schema"":""obr-suite-card/v1""' in plan["replace_cell"]["formula"]
    assert re.search(r'""ruleset"":""(5E2014|5E2024)""', plan["replace_cell"]["formula"])[1] == "5E" + version
    with zipfile.ZipFile(path) as z:
        links = []
        for name in z.namelist():
            if name.startswith("xl/worksheets/") and name.endswith(".xml"):
                cell = ET.fromstring(z.read(name)).find(f".//{{{NS}}}c[@r='B8']/{{{NS}}}f")
                if cell is not None and cell.text == "主要!$AV$1": links.append(name)
        assert len(links) == 1, "Expected actual old WebImport B8 direct AV1 reference"
    cases.append("AV1 schema/ruleset literal fallback, old AS41 type/source, actual WebImport B8 reference preserved")

    mapping = {main: "Main", ("背景" if version == "2014" else "起源"): "Hero's Profile"}
    renamed = make_plan(source["formula"], main_sheet=main, sheet_names=source["sheet_names"], sheet_map=mapping)
    renamed_inputs = {(mapping.get(s, s), c): v for (s, c), v in injected.items()}
    assert actual(renamed_inputs, renamed) == expected_injected
    assert renamed["replace_cell"]["sheet"] == "Main"
    assert any("Hero''s Profile" in c["formula"] for c in renamed["add_sheet"]["cells"])
    cases.append("explicit Main and apostrophe-containing cross-sheet rename prerequisites preserve references and values")

    values = dict(inputs); values[main, "E3"] = ""
    base_size = utf16len(evaluate_plan(plan, values))
    for size in [32766, 32767, 32768]:
        values[main, "E3"] = "x" * (size - base_size)
        if size <= MAX_TEXT:
            result = evaluate_plan(plan, values)
            assert utf16len(result) == size
            assert json.loads(result)["identity"]["character_name"] == values[main, "E3"]
        else:
            expect_reject(lambda: evaluate_plan(plan, values), "OBR_EXPORT_OUTPUT_TOO_LONG")
    values[main, "E3"] = "\\" * 32767
    expect_reject(lambda: evaluate_plan(plan, values), "OBR_EXPORT_OUTPUT_TOO_LONG")
    values[main, "E3"] = "x" * 32768
    expect_reject(lambda: evaluate_plan(plan, values), "Source cell exceeds")
    for invalid in ["x\0y", "\ud800", "\udfff", "\ufffe", "\uffff"]:
        values[main, "E3"] = invalid
        expect_reject(lambda: evaluate_plan(plan, values), "Unrepresentable text")
    values[main, "E3"] = {"unexpected": "object"}
    expect_reject(lambda: evaluate_plan(plan, values), "Unsupported scalar")
    cases.append("32766/32767 exact output accepted, 32768/escape expansion rejected; NUL and unsupported Unicode refused")

    expect_reject(lambda: make_plan(source["formula"].replace("_xlfn.TEXTJOIN", "UNKNOWN", 1), main_sheet=main, sheet_names=source["sheet_names"]), "Unsupported")
    mismatch = source["formula"].replace('IF(E7="","",', 'IF(E7="","""",', 1)
    expect_reject(lambda: make_plan(mismatch, main_sheet=main, sheet_names=source["sheet_names"]), "branches disagree")
    expect_reject(lambda: make_plan(source["formula"], main_sheet=main, sheet_names=source["sheet_names"] + ["export"]), "already exists")
    expect_reject(lambda: make_plan(source["formula"], main_sheet=main, sheet_names=source["sheet_names"], sheet_map={main: "Unknown"}), "identifiable")
    cases.append("unknown functions, branch boundary mismatch, new-sheet collision and unidentifiable main fail closed")

    # Independent assertions must catch real regressions, not just pass counts.
    unsafe = copy.deepcopy(plan)
    entry = next(c for c in unsafe["add_sheet"]["cells"] if c["purpose"] == f"JSON escape {main}!E3: value")
    entry["formula"] = "='主要'!$E$3&\"\""
    expect_reject(lambda: actual(injected, unsafe))
    numeric_mutant = copy.deepcopy(plan)
    needle = "IF(ISNUMBER('主要'!$O$6),'主要'!$O$6,0)"
    entry = next(c for c in numeric_mutant["add_sheet"]["cells"] if c["purpose"] == "original numeric guard: value" and needle in c["formula"])
    entry["formula"] = entry["formula"].replace(needle, "0")
    values = dict(inputs); values[main, "O6"] = 12
    assert actual(values, numeric_mutant) != original(values)
    cases.append("mutations removing string escaping or replacing a valid numeric value with zero are detected")

    formulas = plan["add_sheet"]["cells"] + [plan["replace_cell"]]
    assert len({c["cell"] for c in plan["add_sheet"]["cells"]}) == len(plan["add_sheet"]["cells"])
    assert plan["add_sheet"]["state"] == "hidden" and plan["add_sheet"]["position"] == "append"
    assert all(utf16len(c["formula"]) <= MAX_FORMULA for c in formulas)
    assert all("CHAR(0)" not in c["formula"] and "CLEAN(" not in c["formula"] and "LET(" not in c["formula"] and "LAMBDA(" not in c["formula"] for c in formulas)
    assert all("cached_value" not in c and "value" not in c for c in formulas)
    trees = [Formula(c["formula"]).tree for c in formulas]
    functions = {str(n.value) for tree in trees for n in walk(tree) if n.op == "fn"}
    def depth(node):
        return int(node.op == "fn") + max((depth(a) for a in node.args), default=0)
    max_depth = max(depth(tree) for tree in trees)
    max_arguments = max(len(n.args) for tree in trees for n in walk(tree) if n.op == "fn")
    assert max_depth <= 64 and max_arguments <= 255
    assert functions <= {"IF", "ISNUMBER", "_xlfn.TEXTJOIN", "SUBSTITUTE", "LEN", "CHAR", "SUM"}
    assert hashlib.sha256(path.read_bytes()).hexdigest() == source["sha256"]
    cases.append("every new cell declared, formula budgets/functions checked, zero caches authored and original SHA unchanged")

    plan["source_workbook_sha256"] = source["sha256"]
    plan["source_av1_part"] = source["av1_part"]
    plan["reference_model_baseline_equals_existing_json"] = True
    output.mkdir(parents=True, exist_ok=True)
    for tag, data in [(version, plan), (version + "-Main", renamed)]:
        dest = output / (tag + "-formula-plan.json")
        dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"version": version, "original_sha256": source["sha256"], "original_formula_characters": len(source["formula"]),
            "av1_formula_utf16_units": utf16len(plan["replace_cell"]["formula"]),
            "max_new_formula_utf16_units": max(utf16len(c["formula"]) for c in formulas),
            "max_nested_functions": max_depth, "max_function_arguments": max_arguments,
            "new_helper_formula_cells": len(plan["add_sheet"]["cells"]),
            "escaped_sources": len(tokens), "passed_groups": cases, "mutations_detected": 2}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output-dir", type=Path, default=DEFAULT_AUDIT)
    args = ap.parse_args()
    # This fixture writes audit JSON only, never accepts a workbook destination.
    output = args.output_dir.resolve()
    assert output == DEFAULT_AUDIT.resolve() or DEFAULT_AUDIT.resolve() in output.parents
    rows = [run_version(v, next((ROOT / "public").glob(p)), output)
            for v, p in [("2014", "DND5E*.xlsx"), ("2024", "DND5R*.xlsx")]]
    report = {"scope": "Actual original OOXML + existing cached precedents, generated Excel formula reference evaluation; NOT Excel/WPS recalculation.",
              "xlsx_written": False, "cache_values_authored": False, "results": rows,
              "remaining": ["Actual desktop Excel/WPS recalculation, internal formula token-byte validation and CHAR control support.",
                            "Web Excel CHAR restrictions are not resolved by this desktop prototype.",
                            "Package preservation validation for the new hidden sheet; dependency and importer integration remain separate."]}
    (output / "selftest-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
