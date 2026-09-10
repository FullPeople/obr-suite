"""Read-only species text/dependency audit; never author or approve a workbook.

The reference cards are pinned to the completed background increment. Linguistic
reviews are checked against original located records, not matched by name alone.
The report deliberately includes unresolved records and all validation formulas.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as E
import zipfile

import prepare
from main_ability_inputs import tabs
from main_toggle_fields import ORIGINALS

if not __debug__:
    raise RuntimeError("Verification requires assertions")

PINS = {
    "2014": "2c13b2f4cc36d983e31f1f82af8d29cabf3fa3cb8917d318f0611e25f034defb",
    "2024": "cf33cdb2dd8e5c162c3f1daf30996218a3a340ee93ceb016b413fa6239ab949f",
}
N = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read(path):
    with zipfile.ZipFile(path) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    strings = [prepare.rich_text(si) for si in E.fromstring(parts["xl/sharedStrings.xml"])]
    names = tabs(parts)
    cells = {}
    for sheet, part in names.items():
        cells[sheet] = {}
        for node in E.fromstring(parts[part]).iter(N + "c"):
            formula = node.find(N + "f")
            value = node.findtext(N + "v")
            cells[sheet][node.get("r")] = {
                "value": strings[int(value)] if node.get("t") == "s" else value,
                "formula": (formula.text or "") if formula is not None else None,
                "formula_attributes": formula.attrib if formula is not None else None,
            }
    return parts, names, cells


def semantic(cell):
    if cell is None:
        return None
    if cell["formula"] is not None:
        return {"formula": cell["formula"], "attributes": cell["formula_attributes"]}
    return cell["value"]


def audit(inputs):
    files = [prepare.HERE / "reviewed.jsonl", *sorted((prepare.HERE / "reviews").glob("*.jsonl"))]
    reviews = [json.loads(line) for path in files for line in path.read_text(encoding="utf8").splitlines()]
    assert len({r["id"] for r in reviews}) == len(reviews), "Duplicate review ID"
    by_id = {r["id"]: r for r in reviews}
    glossary = json.loads((prepare.HERE / "glossary.json").read_text(encoding="utf8"))
    result = {"schema": "obr-species-reference-audit/v1", "workbooks_unchanged": True,
              "application_approved": False, "release_ready": False, "versions": {}}
    for version, path in inputs.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == PINS[version], "Unexpected reference card"
        filename, expected_hash = ORIGINALS[version]
        original = prepare.ROOT / "public" / filename
        assert hashlib.sha256(original.read_bytes()).hexdigest() == expected_hash, "Original card changed"
        _, records, _ = prepare.inspect_xlsx(original, version, glossary)
        selected = [r for r in records if r["sheet"] == "种族" and r["kind"] in ["cell_text", "formula_literal"]]
        parts, names, cells = read(path)
        _, _, original_cells = read(original)
        source_cells = cells["种族"]
        assert all(semantic(source_cells.get(ref)) == semantic(original_cells["种族"].get(ref))
                   for ref in source_cells.keys() | original_cells["种族"].keys()), "Species source semantics changed"
        used, missing, targets = [], [], {}
        for row in selected:
            review = by_id.get(row["id"])
            if review is None:
                missing.append({"id": row["id"], "source": row["source"], "kind": row["kind"],
                                "context": row["context"], "locations": [o["location"] for o in row["occurrences"]]})
                continue
            assert all(review[k] == row[k] for k in ["version", "source", "kind", "sheet", "context"])
            assert review["locations"] == [o["location"] for o in row["occurrences"]]
            assert review["workbook_sha256"] == expected_hash and review["source_sha256"] == prepare.digest(row["source"])
            assert review["dependency_review"] == "pending" and review["application_approved"] is False
            assert review["reviewed_by"] and review["note"] and review["target"] and not prepare.CJK.search(review["target"])
            used.append(review)
            if row["kind"] == "cell_text":
                for occurrence in row["occurrences"]:
                    targets[occurrence["location"]] = (row["source"], review["target"])
        collisions = []
        for column in ["A", "E"]:
            grouped = defaultdict(list)
            for ref, (source, target) in targets.items():
                if ref.rstrip("0123456789") == column:
                    grouped[target.casefold()].append({"cell": ref, "source": source, "target": target})
            collisions += [{"column": column, "entries": entries} for entries in grouped.values()
                           if len({e["source"] for e in entries}) > 1]
        assert not collisions, "Translated species lookup keys collide"
        # Titles are exact-match keys for the trait selector. Report collisions
        # within a species' header row, even if the two Chinese labels differed.
        trait_collisions = []
        title_rows = defaultdict(list)
        min_row = 54 if version == "2014" else 2
        min_col = "M" if version == "2014" else "L"
        max_col = "AW" if version == "2014" else "AV"
        def colnum(col):
            value = 0
            for char in col:
                value = value * 26 + ord(char) - 64
            return value
        for ref, pair in targets.items():
            col = ref.rstrip("0123456789"); row = int(ref[len(col):])
            if row >= min_row and row % 2 == 0 and colnum(min_col) <= colnum(col) <= colnum(max_col):
                title_rows[row].append((ref, *pair))
        for row, entries in title_rows.items():
            grouped = defaultdict(list)
            for ref, source, target in entries:
                grouped[target.casefold()].append({"cell": ref, "source": source, "target": target})
            trait_collisions += [{"row": row, "entries": items} for items in grouped.values()
                                 if len({i["source"] for i in items}) > 1]
        validations, incoming = [], []
        for sheet, part in names.items():
            for node in E.fromstring(parts[part]).iter():
                if node.tag.rsplit("}", 1)[-1] == "dataValidation":
                    xml = E.tostring(node, encoding="unicode")
                    if sheet == "种族" or "种族" in xml:
                        validations.append({"sheet": sheet, "xml": xml, "attributes": node.attrib})
            if sheet != "种族":
                incoming += [{"sheet": sheet, "cell": ref, "formula": cell["formula"]}
                             for ref, cell in cells[sheet].items() if "种族" in (cell["formula"] or "")]
        formula_rows = [{"cell": ref, "formula": cell["formula"], "attributes": cell["formula_attributes"]}
                        for ref, cell in source_cells.items() if cell["formula"] is not None]
        read_main = [r for r in formula_rows if "主要!" in r["formula"]]
        result["versions"][version] = {
            "input": str(path), "sha256": PINS[version], "source_semantics_match_original": True,
            "reviewed_records": len(used), "reviewed_occurrences": sum(len(r["locations"]) for r in used),
            "reviewed_kinds": dict(Counter(r["kind"] for r in used)), "remaining_records": len(missing),
            "remaining": missing, "name_collisions": collisions, "trait_title_collisions": trait_collisions,
            "species_formula_count": len(formula_rows), "formulas": formula_rows,
            "main_input_consumers": read_main, "incoming_cell_formulas": incoming,
            "validations": validations,
            "paragraph_cells": [ref for ref, (_, target) in targets.items() if any(c in target for c in "\r\n\t")],
            "review_digest": prepare.digest(sorted(used, key=lambda r: r["id"])),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-2014", type=Path, required=True)
    parser.add_argument("--input-2024", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists(), "Use a new audit output path"
    result = audit({"2014": args.input_2014, "2024": args.input_2024})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    print(json.dumps({"output": str(args.output), "versions": {
        v: {k: r[k] for k in ["reviewed_records", "reviewed_occurrences", "remaining_records",
                              "species_formula_count", "name_collisions", "trait_title_collisions"]}
        for v, r in result["versions"].items()}, "release_ready": False}, ensure_ascii=False, indent=2))
    assert all(not r["trait_title_collisions"] for r in result["versions"].values()), "Translated trait titles collide"


if __name__ == "__main__":
    main()
