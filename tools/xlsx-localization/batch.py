"""Export located source text for a bounded translation batch, then merge exact IDs.

This never changes a workbook. A translation batch is separate from the later
formula/lookup/layout review, and cannot grant itself application approval.
"""
import argparse
import json
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET

from prepare import HERE, ROOT, TEMPLATES, apply_reviewed, digest, q, rich_text, value_of


def catalog():
    return [json.loads(line) for line in (HERE / "catalog.jsonl").read_text(encoding="utf-8").splitlines()]


def cell_order(row):
    match = re.fullmatch(r"([A-Z]+)([0-9]+)", row["occurrences"][0]["location"])
    return (int(match[2]), match[1]) if match else (0, row["id"])


def export(args):
    records = [row for row in catalog() if row["version"] == args.version and row["sheet"] == args.sheet
               and row["kind"] == "cell_text" and row["status"] == "missing" and len(row["source"]) >= args.min_length]
    records.sort(key=cell_order)
    selected, length = [], 0
    for row in records:
        if len(selected) >= args.count or selected and length + len(row["source"]) > args.characters:
            break
        selected.append(row)
        length += len(row["source"])
    path = ROOT / "public" / TEMPLATES[args.version]
    source_hash = digest(path.read_bytes())
    values, formulas = {}, {}
    with zipfile.ZipFile(path) as archive:
        shared = [rich_text(si) for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall(q("si"))]
        for part in {item["part"] for row in selected for item in row["occurrences"]}:
            tree = ET.fromstring(archive.read(part))
            cells = tree.findall(".//" + q("sheetData") + "/" + q("row") + "/" + q("c"))
            values[part] = {cell.get("r"): value_of(cell, shared) for cell in cells}
            formulas[part] = {cell.get("r"): cell.find(q("f")).text or "" for cell in cells if cell.find(q("f")) is not None}
    entries = []
    for row in selected:
        first = row["occurrences"][0]
        line = re.search(r"\d+$", first["location"])[0]
        context = {ref: value for ref, value in values[first["part"]].items()
                   if ref.endswith(line) and re.search(r"\d+$", ref)[0] == line and value and len(value) <= 180}
        nearby_formulas = {ref: formula for ref, formula in formulas[first["part"]].items()
                          if re.search(r"\d+$", ref)[0] == line}
        entries.append({**row, "source_sha256": digest(row["source"]), "workbook_sha256": source_hash,
                        "nearby_row_values": context, "nearby_row_formulas": nearby_formulas})
    payload = {"schema": "obr-xlsx-translation-batch/v1", "batch": args.batch, "version": args.version,
               "sheet": args.sheet, "source_characters": length, "remaining_matching_records": len(records),
               "context_note": "Nearby formula values are saved caches. A compressed dropdown/index column can refer to another record; inspect its formula before using it as this row's identity.",
               "entries": entries}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(entries)} located records / {length} source characters to {args.output}")


def merge(args):
    batch = json.loads(args.source.read_text(encoding="utf-8"))
    assert batch["schema"] == "obr-xlsx-translation-batch/v1"
    targets = json.loads(args.translations.read_text(encoding="utf-8"))
    assert isinstance(targets, list) and len(targets) == len(batch["entries"]), "Translate every requested entry in full"
    assert len({row["id"] for row in targets}) == len(targets), "Duplicate translated ID"
    by_id = {row["id"]: row for row in targets}
    assert set(by_id) == {row["id"] for row in batch["entries"]}, "Translation IDs differ from the exported batch"
    rows, existing = catalog(), set()
    for row in rows:
        if row["status"] == "reviewed": existing.add(row["id"])
    current = {row["id"]: row for row in rows}
    reviews = []
    for source in batch["entries"]:
        assert source["id"] not in existing, "Batch overlaps an already reviewed record"
        row = current[source["id"]]
        assert source["source_sha256"] == digest(row["source"]) and source["version"] == row["version"], "Source changed since export"
        assert source["workbook_sha256"] == digest((ROOT / "public" / TEMPLATES[row["version"]]).read_bytes()), "Workbook changed since export"
        translation = by_id[row["id"]]
        assert translation.get("note"), "A translation needs its contextual review note"
        review = {"id": row["id"], "version": row["version"], "source_sha256": source["source_sha256"],
                  "source": row["source"], "kind": row["kind"], "sheet": row["sheet"], "context": row["context"],
                  "locations": [o["location"] for o in row["occurrences"]], "workbook_sha256": source["workbook_sha256"],
                  "target": translation["target"], "reviewed_by": args.reviewer, "batch": batch["batch"],
                  "note": translation["note"], "dependency_review": "pending", "application_approved": False}
        reviews.append(review)
    apply_reviewed(rows, reviews)
    assert not args.output.exists(), "Do not silently overwrite an existing batch"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in reviews), encoding="utf-8")
    print(f"Merged {len(reviews)} complete, located translations to {args.output}; workbook dependencies still pending")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    make = commands.add_parser("export")
    make.add_argument("--version", choices=TEMPLATES, required=True)
    make.add_argument("--sheet", required=True)
    make.add_argument("--batch", required=True)
    make.add_argument("--count", type=int, default=30)
    make.add_argument("--characters", type=int, default=16000)
    make.add_argument("--min-length", type=int, default=101)
    make.add_argument("--output", type=Path, required=True)
    join = commands.add_parser("merge")
    join.add_argument("--source", type=Path, required=True)
    join.add_argument("--translations", type=Path, required=True)
    join.add_argument("--reviewer", required=True)
    join.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    (export if options.operation == "export" else merge)(options)
