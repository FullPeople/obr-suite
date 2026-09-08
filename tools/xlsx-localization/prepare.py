"""Read-only OOXML inventory and translation preparation; never writes an XLSX.

Use the bundled Python runtime. XML inspection is intentional: it preserves exact
formula/cache/validation evidence without importing and recalculating a workbook.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
LITERAL = re.compile(r'"((?:[^"]|"")*)"')
TEMPLATES = {
    "2014": "DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx",
    "2024": "DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx",
}


def q(name):
    return f"{{{NS}}}{name}"


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def rich_text(element):
    # Phonetic guides (rPh) are not displayed cell content.
    return "".join(n.text or "" for n in element.findall(q("t")) + element.findall(q("r") + "/" + q("t")))


def literal_tokens(formula):
    return [m.group(1).replace('""', '"') for m in LITERAL.finditer(formula)]


def value_of(cell, shared):
    raw = cell.find(q("v"))
    text = raw.text or "" if raw is not None else ""
    if cell.get("t") == "s":
        return shared[int(text)]
    if cell.get("t") == "inlineStr":
        inline = cell.find(q("is"))
        return rich_text(inline) if inline is not None else ""
    return text


def seed(source, version, kind, glossary):
    if kind == "sheet_name":
        return glossary["sheets"].get(version, {}).get(source), "sheet_name"
    # Names, references, formatting codes and formula constants need dependency
    # review, even when the same visible term has an English translation.
    if kind not in {"cell_text", "comment", "drawing_text", "validation_message"}:
        return None, None
    terms = {**glossary["terms"], **glossary["versionTerms"].get(version, {})}
    if source in terms:
        return terms[source], "exact_glossary"
    # Fully matched number/unit values only; never segment or concatenate prose.
    m = re.fullmatch(r"(\d+)(尺|分钟|小时|轮|级)", source)
    if m:
        number, unit = m.groups()
        if unit == "级":
            return f"Level {number}", "number_unit"
        singular = {"尺": "ft.", "分钟": "minute", "小时": "hour", "轮": "round"}[unit]
        return f"{number} {singular}{'s' if number != '1' and unit != '尺' else ''}", "number_unit"
    return None, None


def inspect_xlsx(path, version, glossary, main_sheet="主要"):
    raw_file = path.read_bytes()
    records, grouped, sheet_info, formulas, names, validations, english_pairs = [], {}, [], [], [], [], []
    plain_cell_texts = []

    def add(kind, sheet, part, location, source, *, context="", target=None, evidence=None, rich=False):
        if not source or not CJK.search(source):
            return
        # Different rule version, sheet, source-book/record context and surface
        # retain separate IDs. Text equality alone is never a translation key.
        identity = [version, kind, sheet, context, source]
        entry_id = digest(identity)[:24]
        if entry_id not in grouped:
            seeded, method = seed(source, version, kind, glossary)
            grouped[entry_id] = {
                "id": entry_id, "version": version, "kind": kind, "sheet": sheet,
                "context": context, "source": source, "target": target or seeded,
                "status": "seed" if target or seeded else "missing",
                "method": "existing_english_column" if target else method,
                "evidence": evidence, "occurrences": [],
                "requires_dependency_review": kind in {"sheet_name", "formula_literal", "defined_name", "validation_literal", "conditional_literal", "format_literal", "xml_attribute"},
            }
        entry = grouped[entry_id]
        # Conflicting English cells never silently select one spelling.
        if target and entry["target"] and target != entry["target"]:
            entry["target"] = None
            entry["status"] = "missing"
            entry["method"] = "conflicting_english_candidates"
        entry["occurrences"].append({"part": part, "location": location, **({"rich_text": True} if rich else {})})

    with zipfile.ZipFile(path) as z:
        parts = {n: digest(z.read(n)) for n in z.namelist() if not n.endswith("/")}
        shared_root = ET.fromstring(z.read("xl/sharedStrings.xml")) if "xl/sharedStrings.xml" in parts else ET.Element("none")
        shared_items = shared_root.findall(q("si"))
        shared = [rich_text(s) for s in shared_items]
        shared_used = set()
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        av1 = None
        for sheet in wb.findall(q("sheets") + "/" + q("sheet")):
            name = sheet.get("name")
            target = rels[sheet.get(f"{{{REL}}}id")]
            part = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            tree = ET.fromstring(z.read(part))
            cells = {c.get("r"): c for c in tree.findall(".//" + q("sheetData") + "/" + q("row") + "/" + q("c"))}
            values = {r: value_of(c, shared) for r, c in cells.items()}
            info = {"name": name, "part": part, "state": sheet.get("state", "visible"), "dimension": tree.find(q("dimension")).get("ref") if tree.find(q("dimension")) is not None else None,
                    "cell_count": len(cells), "formula_count": 0, "cached_errors": [], "formulas_without_cache": [], "merges": [x.get("ref") for x in tree.findall(q("mergeCells") + "/" + q("mergeCell"))],
                    "validation_count": 0, "conditional_blocks": len(tree.findall(q("conditionalFormatting"))), "rich_text_cells": 0,
                    "cell_addresses_sha256": digest(sorted(cells)),
                    "geometry_sha256": digest({
                        "rows": [n.attrib for n in tree.findall(q("sheetData") + "/" + q("row"))],
                        "columns": [n.attrib for n in tree.findall(q("cols") + "/" + q("col"))],
                        "styles": [(ref, c.get("s")) for ref, c in cells.items()],
                        "views": ET.tostring(tree.find(q("sheetViews")), encoding="unicode") if tree.find(q("sheetViews")) is not None else None,
                    })}
            add("sheet_name", name, "xl/workbook.xml", name, name)
            source_col = next((re.sub(r"\d", "", r) for r, v in values.items() if r.endswith("2") and v == "出处"), None) if name == "法术大全" else None
            for ref, c in cells.items():
                text = values[ref]
                f = c.find(q("f"))
                if c.get("t") == "s":
                    shared_used.add(int(c.find(q("v")).text))
                if c.get("t") == "e":
                    info["cached_errors"].append({"cell": ref, "error": text})
                rich = c.get("t") == "s" and bool(shared_items[int(c.find(q("v")).text)].findall(q("r")))
                info["rich_text_cells"] += int(rich)
                row = re.sub(r"\D", "", ref)
                col = re.sub(r"\d", "", ref)
                # Explicit English-name column paired only with this spell's A
                # cell. Never reuse another row's name or substitute its prose.
                pair = values.get("N" + row, "") if name == "法术大全" and col == "A" and int(row) > 2 else ""
                valid_pair = bool(pair and len(pair) <= 100 and re.search(r"[A-Za-z]{3}", pair) and not CJK.search(pair) and "\n" not in pair)
                context = f"column:{col}"
                if name == "法术大全" and int(row) > 2:
                    context += f";spell:{values.get('N'+row, '')};book:{values.get((source_col or '')+row, '')};level:{values.get('B'+row, '')}"
                if f is not None:
                    formula = f.text or ""
                    info["formula_count"] += 1
                    if not text:
                        info["formulas_without_cache"].append(ref)
                    formulas.append({"sheet": name, "cell": ref, "attributes": f.attrib, "sha256": digest(formula), "formula": formula})
                    for i, token in enumerate(literal_tokens(formula)):
                        add("formula_literal", name, part, f"{ref}:literal:{i}", token, context=f"cell:{ref}")
                elif c.get("t") in {"s", "inlineStr", "str"}:
                    if CJK.search(text):
                        plain_cell_texts.append(text)
                    add("cell_text", name, part, ref, text, context=context, target=pair if valid_pair else None,
                        evidence={"sheet": name, "cell": "N" + row, "book_cell": (source_col or "") + row, "book": values.get((source_col or "") + row, "")} if valid_pair else None, rich=rich)
                    if valid_pair and CJK.search(text):
                        english_pairs.append({"sheet": name, "cell": ref, "source": text, "english_cell": "N" + row, "english": pair, "source_book": values.get((source_col or "") + row, "")})
                if name == main_sheet and ref == "AV1":
                    try:
                        parsed = json.loads(text)
                        parse_error = None
                    except (ValueError, TypeError) as e:
                        parsed, parse_error = {}, str(e)
                    av1 = {"sheet": name, "part": part, "cell": ref, "formula_sha256": digest(f.text or "") if f is not None else None,
                           "formula_characters": len(f.text or "") if f is not None else 0, "cache_sha256": digest(text), "cache_characters": len(text), "json_error": parse_error,
                           "schema": parsed.get("schema"), "ruleset": parsed.get("meta", {}).get("ruleset"), "json_shape": json_shape(parsed),
                           "shield_cells": {r: values.get(r) for r in ["AL39", "AQ40", "AS40"]}}
            # Both standard and x14 validation forms: local-name matching is
            # deliberate, because extension rules can use a different namespace.
            for index, dv in enumerate(n for n in tree.iter() if n.tag.rsplit("}", 1)[-1] == "dataValidation"):
                info["validation_count"] += 1
                record = {"sheet": name, "index": index, "attributes": dv.attrib, "formulas": []}
                for key in ["prompt", "promptTitle", "error", "errorTitle"]:
                    add("validation_message", name, part, f"validation:{index}:{key}", dv.get(key, ""))
                for n in dv.iter():
                    if n.tag.rsplit("}", 1)[-1] in {"formula1", "formula2", "f"} and n.text:
                        record["formulas"].append(n.text)
                        for i, token in enumerate(literal_tokens(n.text)):
                            add("validation_literal", name, part, f"validation:{index}:literal:{i}", token, context=f"validation:{index}")
                validations.append(record)
            for index, cf in enumerate(tree.findall(q("conditionalFormatting"))):
                for j, f in enumerate(cf.findall(".//" + q("formula"))):
                    for k, token in enumerate(literal_tokens(f.text or "")):
                        add("conditional_literal", name, part, f"conditional:{index}:{j}:literal:{k}", token, context=f"conditional:{index}")
            sheet_info.append(info)
        for index, n in enumerate(wb.findall(q("definedNames") + "/" + q("definedName"))):
            names.append({"attributes": n.attrib, "value": n.text or ""})
            add("defined_name", "", "xl/workbook.xml", f"definedName:{index}", n.get("name", ""))
            for i, token in enumerate(literal_tokens(n.text or "")):
                add("formula_literal", "", "xl/workbook.xml", f"definedName:{index}:literal:{i}", token, context=f"definedName:{index}")
        for index, si in enumerate(shared_items):
            if index not in shared_used:
                add("unused_shared_string", "", "xl/sharedStrings.xml", f"si:{index}", shared[index])
        # Comments/drawings/VML may contain text not present in worksheet cells.
        # Font names, author names and arbitrary Chinese XML attributes are only
        # inventoried for review; never automatically renamed or deleted.
        for part in sorted(parts):
            if not part.endswith((".xml", ".vml")) or not (part.startswith("xl/comments") or part.startswith("xl/drawings/") or part == "xl/styles.xml"):
                continue
            tree = ET.fromstring(z.read(part))
            for index, node in enumerate(tree.iter()):
                local = node.tag.rsplit("}", 1)[-1]
                if part.startswith("xl/comments") and local == "comment":
                    text = node.find(q("text"))
                    if text is not None:
                        add("comment", "", part, node.get("ref", f"node:{index}"), rich_text(text))
                elif not part.startswith("xl/comments") and local in {"t", "div", "font"} and node.text:
                    add("drawing_text", "", part, f"node:{index}", node.text)
                for key, value in node.attrib.items():
                    if CJK.search(value):
                        add("format_literal" if local == "numFmt" and key == "formatCode" else "xml_attribute", "", part, f"node:{index}:@{key}", value)
        external_relationships = []
        for part in sorted(parts):
            if part.endswith(".rels"):
                for r in ET.fromstring(z.read(part)):
                    if r.get("TargetMode") == "External":
                        external_relationships.append({"part": part, "type": r.get("Type", "").rsplit("/", 1)[-1], "target": r.get("Target")})
        structure = {
            "version": version, "file": str(path.relative_to(ROOT)).replace("\\", "/") if path.is_relative_to(ROOT) else path.name,
            "sha256": digest(raw_file), "bytes": len(raw_file), "parts": parts,
            "sheets": sheet_info, "defined_names": names, "validations": validations,
            "formula_count": len(formulas), "formula_signature": digest(formulas), "formulas": formulas,
            "shared_strings": len(shared), "unused_shared_strings": len(shared) - len(shared_used),
            "av1": av1, "external_relationships": external_relationships,
            "calc_properties": wb.find(q("calcPr")).attrib if wb.find(q("calcPr")) is not None else {},
            "existing_english_spell_names": english_pairs,
            "cell_only": {"occurrences": len(plain_cell_texts), "unique_texts": len(set(plain_cell_texts)), "unique_characters": sum(map(len, set(plain_cell_texts)))},
        }
    records = sorted(grouped.values(), key=lambda e: (e["version"], e["kind"], e["sheet"], e["id"]))
    return structure, records, set(plain_cell_texts)


def json_shape(value, prefix=""):
    """JSON keys/types are the import contract; authored strings are not keys."""
    if isinstance(value, dict):
        return {k: json_shape(v, prefix + "/" + k) for k, v in sorted(value.items())}
    if isinstance(value, list):
        # Include every element shape without counting content-dependent length.
        return {"array_shapes": sorted({json.dumps(json_shape(v), sort_keys=True) for v in value})}
    return type(value).__name__


def validate_catalog(records):
    ids = set()
    for r in records:
        assert r["id"] not in ids, f"Duplicate ID: {r['id']}"
        ids.add(r["id"])
        expected = digest([r["version"], r["kind"], r["sheet"], r["context"], r["source"]])[:24]
        assert expected == r["id"], f"Identity changed: {r['id']}"
        assert r["occurrences"], f"Unlocated text: {r['id']}"
        assert r["status"] in {"missing", "seed", "reviewed"}, f"Unknown translation status: {r['id']}"
        assert (r["status"] == "missing") == (r["target"] is None), f"False translation status: {r['id']}"
        if r["target"]:
            assert not CJK.search(r["target"]), f"Chinese left in seed: {r['id']}"
            assert r["method"] in {"sheet_name", "exact_glossary", "number_unit", "existing_english_column", "context_reviewed"}
            if r["status"] != "reviewed":
                assert len(r["source"]) <= 100, f"Unreviewed prose was seeded: {r['id']}"
            else:
                assert r["method"] == "context_reviewed" and r.get("review"), f"Review provenance missing: {r['id']}"
                assert r.get("dependency_review") == "pending" and r.get("requires_dependency_review") is True, f"Linguistic review lost pending dependencies: {r['id']}"
                assert r.get("application_approved") is False, f"Linguistic review cannot authorize workbook writes: {r['id']}"
        if r["method"] == "existing_english_column":
            assert r["sheet"] == "法术大全" and r["evidence"] and r["evidence"]["cell"].startswith("N")
            assert all(re.fullmatch(r"A\d+", o["location"]) for o in r["occurrences"]), "English-name seed applied to non-name field"


def apply_reviewed(records, reviews):
    """Merge only explicit per-context reviews; never match prose by name alone."""
    by_id, used = {r["id"]: r for r in records}, set()
    for review in reviews:
        entry_id = review.get("id")
        assert entry_id in by_id and entry_id not in used, f"Unknown/duplicate review ID: {entry_id}"
        used.add(entry_id)
        r = by_id[entry_id]
        assert review.get("version") == r["version"] and review.get("source_sha256") == digest(r["source"]), f"Stale/cross-version review: {entry_id}"
        assert review.get("reviewed_by") and review.get("note"), f"Review author/context required: {entry_id}"
        assert isinstance(review.get("target"), str) and review["target"].strip() and not CJK.search(review["target"]), f"Incomplete English review: {entry_id}"
        # This file reviews language, not workbook dependencies. In particular,
        # cell_text labels may be lookup keys or importer discriminators even
        # though the original surface-level classification was false.
        assert review.get("dependency_review") == "pending" and review.get("application_approved") is False, f"Translation review must keep application pending: {entry_id}"
        for field in ("source", "kind", "sheet", "context"):
            assert field not in review or review[field] == r[field], f"Review context mismatch ({field}): {entry_id}"
        r.update(target=review["target"], status="reviewed", method="context_reviewed", review=review,
                 dependency_review="pending", requires_dependency_review=True, application_approved=False)


def create_outputs():
    glossary = json.loads((HERE / "glossary.json").read_text(encoding="utf-8"))
    structures, records, all_texts = [], [], set()
    for version, filename in TEMPLATES.items():
        structure, rows, texts = inspect_xlsx(ROOT / "public" / filename, version, glossary)
        structures.append(structure)
        records.extend(rows)
        all_texts.update(texts)
    review_files = [HERE / "reviewed.jsonl", *sorted((HERE / "reviews").glob("*.jsonl"))]
    reviews = [json.loads(line) for path in review_files if path.exists()
               for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if reviews:
        apply_reviewed(records, reviews)
    validate_catalog(records)
    by_version = {}
    for version in TEMPLATES:
        rows = [r for r in records if r["version"] == version]
        by_version[version] = coverage(rows)
    summary = {"schema": "obr-xlsx-localization-preparation/v1", "workbooks_unchanged": True,
               "release_ready": False, "translation_status": "Linguistic reviews retain pending dependencies; unreviewed seeds and untranslated long prose remain.",
               "cell_only_combined_unique_texts": len(all_texts), "cell_only_combined_unique_characters": sum(map(len, all_texts)),
               "all_surfaces": coverage(records), "by_version": by_version,
               "limitations": ["No workbook edits, formula recalculation, Excel rendering, backend upload or multiplayer validation.",
                               "XML surface inventory cannot recognize Chinese raster image pixels; every media part needs visual review before a full-English claim.",
                               "Existing English spell names are same-row candidates only, not verified official spell translations.",
                               "Neither seeds nor linguistic reviews authorize workbook writes; formula, dropdown/lookup, sheet, importer and layout dependencies remain pending."]}
    return {
        "catalog.jsonl": "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in records),
        "structure.json": json.dumps(structures, ensure_ascii=False, indent=2) + "\n",
        "coverage.json": json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
    }


def coverage(rows):
    missing = [r for r in rows if not r["target"]]
    long_missing = [r for r in missing if len(r["source"]) > 100]
    return {"context_records": len(rows), "occurrences": sum(len(r["occurrences"]) for r in rows),
            "seed_records": sum(r["status"] == "seed" for r in rows), "reviewed_records": sum(r["status"] == "reviewed" for r in rows), "missing_records": len(missing),
            "missing_characters": sum(len(r["source"]) for r in missing),
            "long_missing_records": len(long_missing), "long_missing_characters": sum(len(r["source"]) for r in long_missing),
            "by_kind": dict(sorted(Counter(r["kind"] for r in rows).items())),
            "seed_methods": dict(sorted(Counter(r["method"] for r in rows if r["target"]).items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Read originals and compare regenerated outputs byte-for-byte; no writes.")
    args = parser.parse_args()
    outputs = create_outputs()
    for name, text in outputs.items():
        path = HERE / name
        if args.verify:
            assert path.read_bytes() == text.encode("utf-8"), f"Stale inventory: {path.name}. Review source changes before regeneration."
        else:
            path.write_text(text, encoding="utf-8", newline="\n")
    print(outputs["coverage.json"])
    print("Verified original-file fingerprints and deterministic inventory." if args.verify else "Prepared translation seeds and missing-content catalog. Original XLSX files were only read.")


if __name__ == "__main__":
    main()
