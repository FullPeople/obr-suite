"""Build a partial text candidate while preserving the original OOXML package.

artifact-tool authors the English text workbook first. This adapter supplies the
native-structure preservation it demonstrably lacks for our reference workbooks.
Only explicitly selected, context-reviewed cell text is applied. This is an audit
candidate, never an English release or a formula/dependency approval.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from copy import copy
import json
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

from prepare import HERE, ROOT, TEMPLATES, apply_reviewed, digest, q, rich_text, value_of


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_lines(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def make_plan(review_paths):
    review_paths = [path.resolve() for path in review_paths]
    catalog = read_lines(HERE / "catalog.jsonl")
    reviews = [row for path in review_paths for row in read_lines(path)]
    require(bool(reviews), "Select a nonempty reviewed text batch")
    apply_reviewed(catalog, reviews)
    by_id = {row["id"]: row for row in catalog}
    entries, occupied, hashes = [], set(), {}
    for review in reviews:
        row = by_id[review["id"]]
        require(row["kind"] == "cell_text", "This candidate builder handles cell text only")
        version = row["version"]
        if version not in hashes:
            hashes[version] = digest((ROOT / "public" / TEMPLATES[version]).read_bytes())
        require(review["workbook_sha256"] == hashes[version], "The reference workbook has changed")
        require(len(row["target"]) <= 32767, "Translation exceeds an Excel cell's text limit")
        for location in row["occurrences"]:
            identity = (version, location["part"], location["location"])
            require(identity not in occupied, "Two translations target the same cell")
            occupied.add(identity)
            entries.append({"id": row["id"], "version": version, "sheet": row["sheet"],
                            "part": location["part"], "cell": location["location"],
                            "source": row["source"], "target": row["target"]})
    return {"schema": "obr-xlsx-partial-text-candidate/v1", "workbook_hashes": hashes,
            "review_hashes": {path.relative_to(HERE).as_posix(): digest(path.read_bytes()) for path in review_paths},
            "entries": entries, "release_ready": False,
            "limitations": ["Partial text only; formula/lookup and importer dependencies are not approved.",
                            "Original caches are preserved and may be stale after translated inputs.",
                            "No Excel/WPS recalculation or full-workbook visual acceptance."]}


def target_values(path, entries):
    """Read back artifact-tool's actual export, not an unverified JSON bypass."""
    with zipfile.ZipFile(path) as z:
        shared = ([rich_text(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(q("si"))]
                  if "xl/sharedStrings.xml" in z.namelist() else [])
        tree = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        cells = {cell.get("r"): cell for cell in tree.iter(q("c"))}
        results = []
        for index, entry in enumerate(entries, 2):
            values = []
            for column in "ABCD":
                cell = cells.get(f"{column}{index}")
                require(cell is not None and cell.find(q("f")) is None, "Authored target is missing or contains a formula")
                values.append(value_of(cell, shared))
            expected = [entry["id"], entry["version"], f"{entry['sheet']}!{entry['cell']}", entry["target"]]
            require(values == expected, f"Authored text differs from the located review: row {index}")
            results.append(values[3])
    return results


SI = re.compile(rb"<si\b[^>]*>.*?</si>", re.S)
CELL = re.compile(rb"<c\b[^>]*\br=\"([^\"]+)\"[^>]*?(?:/>|>.*?</c>)", re.S)
VALUE = re.compile(rb"<v\b[^>]*>.*?</v>", re.S)


def translated_string(original, source, target):
    # The first real prose batches use one unformatted <t>. Varied rich runs
    # need located run translations; never discard their emphasis to proceed.
    parsed = ET.fromstring(b'<root xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + original + b'</root>')[0]
    require(rich_text(parsed) == source, "Source shared string no longer matches its review")
    require(len(parsed) == 1 and parsed[0].tag == q("t"), "Rich text requires a separate run-level translation")
    text = escape(target).replace("\r", "&#13;").encode("utf-8")
    replaced, count = re.subn(rb"<t\b[^>]*>.*?</t>", lambda _: b'<t xml:space="preserve">' + text + b'</t>', original, flags=re.S)
    require(count == 1, "Unexpected shared-string representation")
    return replaced


def patch_package(source_path, output_path, entries, expected_hash):
    raw = source_path.read_bytes()
    require(digest(raw) == expected_hash, "The original workbook changed after planning")
    require(output_path.resolve() != source_path.resolve(), "Never replace the original workbook")
    require(not output_path.exists(), "Use a new candidate path; do not overwrite an existing candidate")
    with zipfile.ZipFile(source_path) as source_zip:
        original = {name: source_zip.read(name) for name in source_zip.namelist()}
        require(len(original) == len(source_zip.namelist()), "Duplicate ZIP parts")
        source_strings = original["xl/sharedStrings.xml"]
        nodes = list(SI.finditer(source_strings))
        parsed_strings = ET.fromstring(source_strings).findall(q("si"))
        require(len(nodes) == len(parsed_strings), "Unsupported shared-string XML representation")
        modified = dict(original)
        additions, changes = [], []
        per_part = defaultdict(dict)
        for entry in entries:
            require(entry["cell"] not in per_part[entry["part"]], "Duplicate cell in candidate plan")
            per_part[entry["part"]][entry["cell"]] = entry
        for part, targets in per_part.items():
            require(part in original and part.startswith("xl/worksheets/"), "Missing target worksheet")
            tree = ET.fromstring(original[part])
            cells = {cell.get("r"): cell for cell in tree.iter(q("c"))}
            replacements = {}
            for ref, entry in targets.items():
                cell = cells.get(ref)
                require(cell is not None and cell.get("t") == "s" and cell.find(q("f")) is None,
                        f"Only original shared text cells may change: {entry['sheet']}!{ref}")
                values = cell.findall(q("v"))
                require(len(values) == 1 and (values[0].text or "").isdigit(), "Invalid source shared-string index")
                index = int(values[0].text)
                require(index < len(nodes), "Source shared-string index is out of range")
                additions.append(translated_string(nodes[index].group(), entry["source"], entry["target"]))
                replacements[ref] = len(nodes) + len(additions) - 1
                changes.append({"sheet": entry["sheet"], "cell": ref, "id": entry["id"], "old_index": index,
                                "new_index": replacements[ref], "source_sha256": digest(entry["source"]),
                                "target_sha256": digest(entry["target"])})
            applied = set()
            def replace_cell(match):
                ref = match[1].decode("ascii")
                if ref not in replacements:
                    return match.group()
                require(ref not in applied, "Duplicate source cell XML")
                applied.add(ref)
                replacement, count = VALUE.subn(lambda _: f"<v>{replacements[ref]}</v>".encode("ascii"), match.group())
                require(count == 1, "Unexpected value element in source cell")
                return replacement
            modified[part] = CELL.sub(replace_cell, original[part])
            require(applied == set(replacements), "Not every selected cell was patched")
        require(bool(additions), "No text selected for this version")
        require(source_strings.count(b"</sst>") == 1, "Unexpected shared-string root")
        strings = source_strings.replace(b"</sst>", b"".join(additions) + b"</sst>")
        def update_unique(match):
            header = match.group()
            if re.search(rb'\buniqueCount="\d+"', header):
                return re.sub(rb'\buniqueCount="\d+"', f'uniqueCount="{len(nodes)+len(additions)}"'.encode("ascii"), header)
            return header[:-1] + f' uniqueCount="{len(nodes)+len(additions)}">'.encode("ascii")
        strings, root_count = re.subn(rb"<sst\b[^>]*>", update_unique, strings, count=1)
        require(root_count == 1, "Missing shared-string root")
        modified["xl/sharedStrings.xml"] = strings
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_path, "w") as target_zip:
            target_zip.comment = source_zip.comment
            for info in source_zip.infolist():
                target_zip.writestr(copy(info), modified[info.filename])
    # Reopen what was written and check byte preservation outside exact changes.
    with zipfile.ZipFile(output_path) as candidate_zip:
        candidate = {name: candidate_zip.read(name) for name in candidate_zip.namelist()}
    require(candidate == modified, "Written package bytes differ from the patch plan")
    for part in original.keys() - per_part.keys() - {"xl/sharedStrings.xml"}:
        require(candidate[part] == original[part], f"Unrelated OOXML part changed: {part}")
    final_strings = ET.fromstring(candidate["xl/sharedStrings.xml"]).findall(q("si"))
    require([ET.tostring(s) for s in final_strings[:len(parsed_strings)]] == [ET.tostring(s) for s in parsed_strings],
            "An original shared string was changed; unselected references must remain intact")
    for entry in entries:
        tree = ET.fromstring(candidate[entry["part"]])
        cell = next(c for c in tree.iter(q("c")) if c.get("r") == entry["cell"])
        require(value_of(cell, [rich_text(s) for s in final_strings]) == entry["target"], "Candidate target text mismatch")
    return {"source_sha256": digest(raw), "candidate_sha256": digest(output_path.read_bytes()),
            "changed_parts": [part for part in original if candidate[part] != original[part]],
            "preserved_parts": sum(candidate[p] == original[p] for p in original),
            "original_shared_strings_preserved": len(parsed_strings), "changes": changes, "release_ready": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    plan = commands.add_parser("plan")
    plan.add_argument("--reviews", type=Path, nargs="+", required=True)
    plan.add_argument("--output", type=Path, required=True)
    build = commands.add_parser("build")
    build.add_argument("--plan", type=Path, required=True)
    build.add_argument("--authored-targets", type=Path, required=True)
    build.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.operation == "plan":
        result = make_plan(args.reviews)
        require(not args.output.exists(), "Use a new plan path")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Located {len(result['entries'])} reviewed text cells; candidate only")
        return
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    require(plan["schema"] == "obr-xlsx-partial-text-candidate/v1", "Unknown candidate schema")
    require(make_plan([HERE / path for path in plan["review_hashes"]]) == plan, "Translation reviews changed since planning")
    target_values(args.authored_targets, plan["entries"])
    results = {}
    for version, source_hash in plan["workbook_hashes"].items():
        selected = [entry for entry in plan["entries"] if entry["version"] == version]
        results[version] = patch_package(ROOT / "public" / TEMPLATES[version],
            args.output_dir / f"{version}-partial-text-candidate.xlsx", selected, source_hash)
    result = {"release_ready": False, "plan_sha256": digest(args.plan.read_bytes()),
              "authored_targets_sha256": digest(args.authored_targets.read_bytes()),
              "versions": results, "limitations": plan["limitations"]}
    (args.output_dir / "preservation-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"versions": {version: len(r['changes']) for version, r in results.items()}, "release_ready": False}))


if __name__ == "__main__":
    main()
