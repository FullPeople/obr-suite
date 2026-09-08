"""Rebuild the old parser by reverse patch and verify in a NEW isolated folder.

Requires openpyxl for the packaged source-workbook tests. Leaves evidence in
--out-dir; does not update the input parser, original workbooks or any service.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from unittest.mock import patch

import apply_parser_patch as delivery


def guard_checks(out: Path, before: bytes, after: bytes) -> list[str]:
    passed = []

    def rejects(label, function, expected):
        try:
            function()
        except delivery.IntegrityError as error:
            if expected not in str(error):
                raise AssertionError(f"Unexpected rejection for {label}: {error}") from error
            passed.append(label)
        else:
            raise AssertionError(f"Integrity guard failed: {label}")

    rejects("unrecognised input", lambda: delivery.transform(b"unrelated source\n", "apply"), "Source SHA-256")
    rejects("wrong direction", lambda: delivery.transform(after, "apply"), "Source SHA-256")
    raw_patch = (delivery.HERE / "parser.patch").read_bytes()
    rejects("tampered patch", lambda: delivery.transform(before, "apply", patch_bytes=raw_patch + b"\n"), "Patch SHA-256")
    manifest = delivery.load_manifest()
    wrong_result = {**manifest, "after_sha256": "0" * 64}
    with patch.object(delivery, "load_manifest", return_value=wrong_result):
        rejects("incorrect expected result", lambda: delivery.transform(before, "apply"), "Result SHA-256")
    lines = raw_patch.splitlines(keepends=True)
    context = next(i for i, line in enumerate(lines) if i > 2 and line.startswith(b" "))
    lines[context] = b" altered context\n"
    bad_context = b"".join(lines)
    with patch.object(delivery, "load_manifest", return_value={**manifest, "patch_sha256": delivery.sha256(bad_context), "patch_bytes": len(bad_context)}):
        rejects("incorrect hunk context", lambda: delivery.transform(before, "apply", patch_bytes=bad_context), "context does not match")

    # Exercise actual CLI writes: wrong source and existing/in-place outputs
    # must fail without touching a pre-existing file or creating a new result.
    wrong = out / "unrelated.py"
    wrong.write_bytes(b"unrelated source\n")
    destination = out / "must-not-exist.py"
    command = [sys.executable, "-B", str(delivery.HERE / "apply_parser_patch.py"), "apply"]
    result = subprocess.run(command + ["--source", str(wrong), "--output", str(destination)], capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 2 and "Source SHA-256" in result.stderr and not destination.exists()
    passed.append("CLI wrong-source writes nothing")
    destination.write_bytes(b"keep existing file\n")
    original = out / "baseline" / "parser.py"
    result = subprocess.run(command + ["--source", str(original), "--output", str(destination)], capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 2 and destination.read_bytes() == b"keep existing file\n"
    passed.append("CLI never overwrites output")
    result = subprocess.run(command + ["--source", str(original), "--output", str(original)], capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 2 and "In-place" in result.stderr and original.read_bytes() == before
    passed.append("CLI in-place writes disabled")
    return passed


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--parser", type=Path, required=True, help="Frozen LF target parser.py, read only")
    cli.add_argument("--xlsx-dir", type=Path, required=True, help="Directory containing both pinned original Chinese cards")
    cli.add_argument("--out-dir", type=Path, required=True, help="New, non-existing evidence directory")
    args = cli.parse_args()
    manifest = delivery.load_manifest()
    actual = args.parser.read_bytes()
    baseline = delivery.transform(actual, "reverse")
    rebuilt = delivery.transform(baseline, "apply")
    assert rebuilt == actual
    workbooks = []
    for entry in manifest["workbooks"]:
        path = args.xlsx_dir / entry["name"]
        if delivery.sha256(path.read_bytes()) != entry["sha256"]:
            raise delivery.IntegrityError(f"Source workbook hash does not match: {path}")
        workbooks.append((path, entry["sha256"]))
    for entry in manifest["tests"]:
        if delivery.sha256((delivery.HERE / entry["file"]).read_bytes()) != entry["sha256"]:
            raise delivery.IntegrityError(f"Packaged test hash does not match: {entry['file']}")

    # All input checks above precede creation; never reuse or clean a directory.
    out = args.out_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    old, current = out / "baseline", out / "current"
    old.mkdir(); current.mkdir()
    (old / "parser.py").write_bytes(baseline)
    (current / "parser.py").write_bytes(rebuilt)
    for entry in manifest["tests"]:
        (current / entry["file"]).write_bytes((delivery.HERE / entry["file"]).read_bytes())
    guards = guard_checks(out, baseline, rebuilt)
    environment = {**os.environ, "OBR_ALIAS_BASELINE": str(old / "parser.py"),
                   "OBR_ALIAS_PUBLIC": str(args.xlsx_dir.resolve()), "PYTHONDONTWRITEBYTECODE": "1"}
    commands = [
        ("tests", [sys.executable, "-B", "-X", "utf8", "-W", "ignore::DeprecationWarning", "-m", "unittest", "-v", "test_sheet_aliases", "test_auto_resources"]),
        ("mutations", [sys.executable, "-B", "-X", "utf8", "-W", "ignore::DeprecationWarning", "test_sheet_aliases_mutations.py"]),
    ]
    results = {}
    for name, command in commands:
        result = subprocess.run(command, cwd=current, env=environment, capture_output=True, text=True, encoding="utf-8")
        (out / f"{name}.stdout.log").write_text(result.stdout, encoding="utf-8", newline="\n")
        (out / f"{name}.stderr.log").write_text(result.stderr, encoding="utf-8", newline="\n")
        if result.returncode:
            raise RuntimeError(f"{name} failed with exit {result.returncode}; inspect {out}")
        results[name] = result
    count = re.search(r"Ran (\d+) tests", results["tests"].stderr)
    assert count and int(count[1]) == manifest["expected_tests"]
    mutations = json.loads(results["mutations"].stdout)
    assert mutations["detected"] == mutations["total"] == manifest["expected_mutations"]
    assert len(mutations["mutations"]) == manifest["expected_mutations"] and all(row["detected"] for row in mutations["mutations"])
    assert args.parser.read_bytes() == actual
    assert all(delivery.sha256(path.read_bytes()) == expected for path, expected in workbooks)
    assert (old / "parser.py").read_bytes() == baseline and (current / "parser.py").read_bytes() == rebuilt
    report = {"parser_source": str(args.parser.resolve()), "before_sha256": delivery.sha256(baseline),
              "after_sha256": delivery.sha256(rebuilt), "patch_sha256": manifest["patch_sha256"],
              "apply_reverse_exact": True, "tests_passed": int(count[1]), "mutations_detected": mutations["detected"],
              "integrity_guards": guards, "workbooks_unchanged": True, "input_parser_unchanged": True,
              "deployed": False, "excel_recalculation_verified": False}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
