"""Verify the spell-name patch, its two prerequisites, and parsers in isolation.

Requires both earlier packages beside this directory and openpyxl for read-only
workbook tests. Creates a new evidence directory; never saves a workbook or
changes the input parser, a prior package, or a running service.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from unittest.mock import patch

import apply_parser_patch as delivery


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--parser", type=Path, required=True)
    cli.add_argument("--xlsx-dir", type=Path, required=True)
    cli.add_argument("--out-dir", type=Path, required=True, help="New, non-existing evidence directory")
    args = cli.parse_args()
    manifest = delivery.load_manifest()
    current = args.parser.read_bytes()
    after_shield = delivery.transform(current, "reverse")
    assert delivery.transform(after_shield, "apply") == current

    expected_packages = ("sheet-aliases-20260908", "shield-input-20260908")
    if tuple(manifest["prerequisite_packages"]) != expected_packages:
        raise delivery.IntegrityError("Unexpected prerequisite package chain")
    prior_files = {}
    for package, entries in manifest["prerequisite_packages"].items():
        directory = delivery.HERE.parent / package
        prior_files[package] = {}
        for name, digest in entries.items():
            if Path(name).name != name:
                raise delivery.IntegrityError("Invalid prerequisite filename")
            data = (directory / name).read_bytes()
            if delivery.sha256(data) != digest:
                raise delivery.IntegrityError(f"Previous package changed: {package}/{name}")
            prior_files[package][name] = data
    alias_dir = delivery.HERE.parent / expected_packages[0]
    shield_dir = delivery.HERE.parent / expected_packages[1]
    shield = load(shield_dir / "apply_parser_patch.py", "spell_prior_shield_delivery")
    after_alias = shield.transform(after_shield, "reverse")
    assert shield.transform(after_alias, "apply") == after_shield
    alias = load(alias_dir / "apply_parser_patch.py", "spell_prior_alias_delivery")
    baseline = alias.transform(after_alias, "reverse")
    assert alias.transform(baseline, "apply") == after_alias

    workbooks = []
    for entry in manifest["workbooks"]:
        name = entry["name"]
        if Path(name).name != name:
            raise delivery.IntegrityError("Invalid workbook filename")
        path = args.xlsx_dir / name
        if delivery.sha256(path.read_bytes()) != entry["sha256"]:
            raise delivery.IntegrityError(f"Unexpected original workbook: {path}")
        workbooks.append((path, entry["sha256"]))
    tests = {}
    for entry in manifest["tests"]:
        name = entry["file"]
        if Path(name).name != name or not name.startswith("test_") or not name.endswith(".py"):
            raise delivery.IntegrityError("Invalid test filename")
        data = (delivery.HERE / name).read_bytes()
        if delivery.sha256(data) != entry["sha256"] or len(data) != entry["bytes"]:
            raise delivery.IntegrityError(f"Spell test changed: {name}")
        tests[name] = data

    # Bind all source bytes before creating the new evidence directory.
    out = args.out_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    for name, data in (("baseline", baseline), ("after_alias", after_alias),
                       ("after_shield", after_shield), ("current", current)):
        directory = out / name
        directory.mkdir()
        (directory / "parser.py").write_bytes(data)
    target = out / "current"
    for name, data in tests.items():
        (target / name).write_bytes(data)
    for name in ("test_sheet_aliases.py", "test_auto_resources.py"):
        (target / name).write_bytes(prior_files[expected_packages[0]][name])
    (target / "test_shield_input.py").write_bytes(prior_files[expected_packages[1]]["test_shield_input.py"])

    guards_module = load(alias_dir / "verify_delivery.py", "spell_prior_guards")
    guards_module.delivery = delivery
    # The reusable CLI guards expect baseline/parser.py to be THIS patch's
    # input, whereas the complete three-step chain starts two versions earlier.
    guard_out = out / "integrity-guards"
    (guard_out / "baseline").mkdir(parents=True)
    (guard_out / "baseline/parser.py").write_bytes(after_shield)
    with patch.dict(os.environ, {"PYTHONUTF8": "1"}):
        guards = guards_module.guard_checks(guard_out, after_shield, current)
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
                   "OBR_SPELL_ALIAS_PARSER": str(target / "parser.py"),
                   "OBR_SPELL_ALIAS_BASELINE": str(out / "after_shield/parser.py"),
                   "OBR_SPELL_ALIAS_PUBLIC": str(args.xlsx_dir.resolve()),
                   "OBR_SHIELD_PARSER": str(target / "parser.py"),
                   "OBR_SHIELD_BASELINE": str(out / "after_alias/parser.py"),
                   "OBR_SHIELD_PUBLIC": str(args.xlsx_dir.resolve()),
                   "OBR_ALIAS_BASELINE": str(out / "baseline/parser.py"),
                   "OBR_ALIAS_PUBLIC": str(args.xlsx_dir.resolve())}
    counts = {}
    suites = (("spell-alias", [Path(name).stem for name in tests], manifest["expected_tests"]),
              ("shield", ["test_shield_input"], 12),
              ("sheet-alias-resource", ["test_sheet_aliases", "test_auto_resources"], 26))
    for label, modules, expected in suites:
        command = [sys.executable, "-B", "-X", "utf8", "-W", "ignore::DeprecationWarning", "-m", "unittest", "-v", *modules]
        result = subprocess.run(command, cwd=target, env=environment, capture_output=True, text=True, encoding="utf-8")
        for stream in ("stdout", "stderr"):
            (out / f"{label}.{stream}.log").write_text(getattr(result, stream), encoding="utf-8", newline="\n")
        if result.returncode:
            raise RuntimeError(f"{label} failed; inspect {out}")
        count = re.search(r"Ran (\d+) tests", result.stderr)
        assert count and int(count[1]) == expected
        counts[label] = int(count[1])

    assert args.parser.read_bytes() == current
    assert all(delivery.sha256(path.read_bytes()) == digest for path, digest in workbooks)
    for package, entries in prior_files.items():
        assert all((delivery.HERE.parent / package / name).read_bytes() == data for name, data in entries.items())
    assert all((delivery.HERE / name).read_bytes() == data for name, data in tests.items())
    for name, data in (("baseline", baseline), ("after_alias", after_alias), ("after_shield", after_shield), ("current", current)):
        assert (out / name / "parser.py").read_bytes() == data
    report = {"before_sha256": delivery.sha256(after_shield), "after_sha256": delivery.sha256(current),
              "patch_sha256": manifest["patch_sha256"], "line_endings": "LF",
              "three_patch_chain_apply_reverse_exact": True, "tests_passed": counts,
              "integrity_guards": guards, "workbooks_unchanged": True,
              "input_parser_unchanged": True, "previous_packages_unchanged": True,
              "deployed": False, "excel_recalculation_verified": False}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
