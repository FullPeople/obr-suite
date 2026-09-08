"""Verify this incremental patch and real parsers in a new isolated directory.

Requires the preceding sheet-aliases package beside this package and openpyxl.
Never writes a workbook, changes an input parser, or deploys a service.
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
    baseline = delivery.transform(current, "reverse")
    assert delivery.transform(baseline, "apply") == current

    prior_dir = delivery.HERE.parent / "sheet-aliases-20260908"
    prior_files = {}
    for name, sha in manifest["prerequisite_files"].items():
        if Path(name).name != name:
            raise delivery.IntegrityError("Invalid prerequisite filename")
        raw = (prior_dir / name).read_bytes()
        if delivery.sha256(raw) != sha:
            raise delivery.IntegrityError(f"Previous package changed: {name}")
        prior_files[name] = raw
    prior = load(prior_dir / "apply_parser_patch.py", "shield_prior_delivery")
    before_alias = prior.transform(baseline, "reverse")
    assert prior.transform(before_alias, "apply") == baseline
    workbooks = []
    for entry in manifest["workbooks"]:
        path = args.xlsx_dir / entry["name"]
        if delivery.sha256(path.read_bytes()) != entry["sha256"]:
            raise delivery.IntegrityError(f"Unexpected original workbook: {path}")
        workbooks.append((path, entry["sha256"]))
    test = delivery.HERE / "test_shield_input.py"
    if delivery.sha256(test.read_bytes()) != manifest["tests"][0]["sha256"]:
        raise delivery.IntegrityError("Shield test changed")

    # Hashes and prerequisite checks precede creation. Existing dirs are refused.
    out = args.out_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    for name in ("baseline", "before_alias", "current"):
        (out / name).mkdir()
    (out / "baseline/parser.py").write_bytes(baseline)
    (out / "before_alias/parser.py").write_bytes(before_alias)
    target = out / "current"
    (target / "parser.py").write_bytes(current)
    (target / test.name).write_bytes(test.read_bytes())
    for name in ("test_sheet_aliases.py", "test_auto_resources.py"):
        (target / name).write_bytes(prior_files[name])

    # Reuse the published integrity/CLI checks, with this patch's manifest.
    guards_module = load(prior_dir / "verify_delivery.py", "shield_prior_guards")
    guards_module.delivery = delivery
    # Child CLIs must use the same encoding on Windows, including error paths.
    with patch.dict(os.environ, {"PYTHONUTF8": "1"}):
        guards = guards_module.guard_checks(out, baseline, current)
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
                   "OBR_SHIELD_PARSER": str(target / "parser.py"),
                   "OBR_SHIELD_BASELINE": str(out / "baseline/parser.py"),
                   "OBR_SHIELD_PUBLIC": str(args.xlsx_dir.resolve()),
                   "OBR_ALIAS_BASELINE": str(out / "before_alias/parser.py"),
                   "OBR_ALIAS_PUBLIC": str(args.xlsx_dir.resolve())}
    counts = {}
    for label, tests, expected in (("shield", ["test_shield_input"], manifest["expected_tests"]),
                                   ("alias-resource", ["test_sheet_aliases", "test_auto_resources"], 26)):
        command = [sys.executable, "-B", "-X", "utf8", "-W", "ignore::DeprecationWarning", "-m", "unittest", "-v", *tests]
        result = subprocess.run(command, cwd=target, env=environment, capture_output=True, text=True, encoding="utf-8")
        for stream in ("stdout", "stderr"):
            (out / f"{label}.{stream}.log").write_text(getattr(result, stream), encoding="utf-8", newline="\n")
        if result.returncode:
            raise RuntimeError(f"{label} failed; inspect {out}")
        count = re.search(r"Ran (\d+) tests", result.stderr)
        assert count and int(count[1]) == expected
        counts[label] = int(count[1])

    assert args.parser.read_bytes() == current
    assert all(delivery.sha256(path.read_bytes()) == sha for path, sha in workbooks)
    assert all((prior_dir / name).read_bytes() == raw for name, raw in prior_files.items())
    assert (out / "baseline/parser.py").read_bytes() == baseline
    assert (target / "parser.py").read_bytes() == current
    report = {"before_sha256": delivery.sha256(baseline), "after_sha256": delivery.sha256(current),
              "patch_sha256": manifest["patch_sha256"], "line_endings": "LF",
              "two_patch_chain_apply_reverse_exact": True, "tests_passed": counts,
              "integrity_guards": guards, "workbooks_unchanged": True,
              "input_parser_unchanged": True, "previous_package_unchanged": True,
              "deployed": False, "excel_recalculation_verified": False}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
