"""Plan exact spell-lookup edits against pinned originals; JSON only.

The generated helper sheet is a concrete formula design, not an applied or
recalculated workbook. Dynamic selection, dropdowns, custom editing, conditional
formatting, import metadata, and translated bodies remain separate work.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

from openpyxl.formula.tokenizer import Tokenizer
from openpyxl.formula.translate import Translator
from openpyxl.utils.cell import range_boundaries

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import spell_identity as identity

REPO = Path(__file__).resolve().parents[2]
BASE = REPO.parent / "_audit" / "xlsx-spell-lookup"
MAP_SHEET = "_OBRSpellMap"
NS = identity.NS
RNS = identity.RNS
require = identity.require
sha = identity.sha
canonical = identity.canonical


def quote_sheet(name):
    return "'" + name.replace("'", "''") + "'"


def token_spans(formula):
    """Keep raw character spans, including whitespace discarded by Tokenizer."""
    require(not formula.startswith("="), "Expected OOXML formula without equals prefix")
    result = []
    offset = 0
    try:
        tokens = Tokenizer("=" + formula).items
    except Exception as error:
        raise identity.Rejected("Unsupported formula tokenization: " + str(error)) from error
    for token in tokens:
        start = offset
        if token.type == "WHITE-SPACE":
            while offset < len(formula) and formula[offset].isspace():
                offset += 1
            require(offset > start, "Tokenizer whitespace mismatch")
        else:
            require(formula.startswith(token.value, offset), "Tokenizer changed formula spelling")
            offset += len(token.value)
        result.append((token, start, offset))
    require(offset == len(formula), "Tokenizer did not consume complete formula")
    return result


def lookup_calls(formula):
    tokens = token_spans(formula)
    found = []
    for i, (token, start, _) in enumerate(tokens):
        if token.type != "FUNC" or token.subtype != "OPEN" or token.value.upper() != "VLOOKUP(":
            continue
        depth = 0
        arg_start = tokens[i][2]
        args = []
        for child, child_start, child_end in tokens[i + 1:]:
            if child.type in ("FUNC", "PAREN", "ARRAY") and child.subtype == "OPEN":
                depth += 1
            elif child.type in ("FUNC", "PAREN", "ARRAY") and child.subtype == "CLOSE":
                if depth == 0:
                    args.append(formula[arg_start:child_start])
                    found.append({"start": start, "end": child_end, "args": args,
                                  "original": formula[start:child_end]})
                    break
                depth -= 1
            elif child.type == "SEP" and child.subtype == "ARG" and depth == 0:
                args.append(formula[arg_start:child_start])
                arg_start = child_end
        else:
            raise identity.Rejected("Unclosed VLOOKUP")
    return found


def dictionary_table(text):
    match = re.fullmatch(r"(?:'法术大全'|法术大全)!(\$?A)(\$?[1-9][0-9]*)?:(\$?[A-Z]+)(\$?[1-9][0-9]*)?", text.strip())
    if match is None:
        return None
    require(bool(match[2]) == bool(match[4]), "Mixed table coordinates")
    address = text.strip().rsplit("!", 1)[1].replace("$", "")
    c1, r1, c2, r2 = range_boundaries(address)
    require(c1 == 1 and c2 <= 26 and (r1 is None or r1 <= r2), "Unexpected dictionary bounds")
    return {"firstRow": r1 or 1, "lastRow": r2 or 1048576, "width": c2}


def read_original(path, expected):
    raw = path.read_bytes()
    require(sha(raw) == expected, "Original fingerprint mismatch")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(len(archive.namelist()) == len(set(archive.namelist())), "Duplicate ZIP part")
        parts = {n: archive.read(n) for n in archive.namelist()}

    def xml(part):
        data = parts[part]
        require(b"<!DOCTYPE" not in data.upper() and b"<!ENTITY" not in data.upper(), "Unsupported XML declaration")
        return ET.fromstring(data)

    rels = {n.get("Id"): n for n in xml("xl/_rels/workbook.xml.rels")}
    sheets = []
    for node in xml("xl/workbook.xml").find(NS + "sheets"):
        rel = rels[node.get(RNS + "id")]
        require(rel.get("TargetMode") != "External", "External worksheet")
        target = rel.get("Target")
        part = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
        require(part.startswith("xl/") and part in parts, "Invalid worksheet relationship")
        sheets.append({"name": node.get("name"), "part": part, "root": xml(part), "partSha256": sha(parts[part])})
    require(MAP_SHEET.casefold() not in {s["name"].casefold() for s in sheets}, "Helper sheet name already exists")
    return sheets


def formula_cells(sheet):
    cells = [c for c in sheet["root"].iter(NS + "c") if c.find(NS + "f") is not None]
    masters = {}
    for cell in cells:
        f = cell.find(NS + "f")
        if f.get("t") == "shared" and f.text:
            require(f.get("si") not in masters, "Duplicate shared-formula master")
            masters[f.get("si")] = (cell.get("r"), f.text, f.get("ref"))
    for cell in cells:
        f = cell.find(NS + "f")
        formula = f.text
        address = cell.get("r")
        origin = None
        if f.get("t") == "shared" and not formula:
            require(f.get("si") in masters, "Missing shared-formula master")
            origin, source, area = masters[f.get("si")]
            require(area is not None, "Missing shared-formula master range")
            c1, r1, c2, r2 = range_boundaries(area)
            col, row, _, _ = range_boundaries(address)
            require(c1 <= col <= c2 and r1 <= row <= r2, "Shared follower outside master range")
            formula = Translator("=" + source, origin=origin).translate_formula(address)[1:]
        require(isinstance(formula, str), "Empty non-shared formula")
        yield {"id": sheet["name"] + "!" + address, "sheet": sheet["name"], "cell": address,
               "part": sheet["part"], "formula": formula, "rawFormula": f.text,
               "formulaAttributes": dict(f.attrib), "sharedOrigin": origin}


def helper_formula(qualified_input, first, last):
    # New labels are literal. Escaping is applied to input, not to the labels.
    # Original VLOOKUP is retained unchanged for every legacy fallback.
    literal = 'SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(' + qualified_input + ',"~","~~"),"*","~*"),"?","~?")'
    lookup = f"MATCH({literal},{quote_sheet(MAP_SHEET)}!$B${first}:$B${last},0)+{first - 1}"
    return f'IFERROR(IF(AND(ISTEXT({qualified_input}),LEN({qualified_input})>0),{lookup},0),0)'


def edit_formula(record, dictionary, helpers):
    source = record["formula"]
    edits = []
    for call in lookup_calls(source):
        args = call["args"]
        if len(args) < 2:
            continue
        table = dictionary_table(args[1])
        if table is None:
            # A recognized dictionary table must not silently disappear from scope.
            require("法术大全!" not in args[1] and "'法术大全'!" not in args[1], "Unsupported dictionary table expression")
            continue
        require(len(args) == 4 and args[3].strip().upper() in ("FALSE", "0"), "Only original exact VLOOKUP is supported")
        require(re.fullmatch(r"[1-9][0-9]*", args[2].strip()) is not None, "Nonconstant result column")
        column = int(args[2].strip())
        input_ref = args[0].strip()
        if not re.fullmatch(r"\$?[A-Z]+\$?[1-9][0-9]*", input_ref):
            edits.append({**call, "status": "deferred", "reason": "DYNAMIC_OR_NONCELL_INPUT", "table": table})
            continue
        first = max(dictionary["firstRow"], table["firstRow"])
        last = min(dictionary["lastRow"], table["lastRow"])
        require(first <= last, "Lookup range excludes spell rows")
        # Deduplicate only identical qualified inputs and eligible row intervals.
        key = (record["sheet"], input_ref.replace("$", ""), first, last)
        if key not in helpers:
            helper_cell = "G" + str(len(helpers) + 3)
            qualified_input = quote_sheet(record["sheet"]) + "!" + input_ref
            helpers[key] = {"cell": helper_cell, "inputSheet": record["sheet"], "inputCell": input_ref,
                            "firstRow": first, "lastRow": last, "consumers": [],
                            "formula": helper_formula(qualified_input, first, last)}
        helper = helpers[key]
        helper["consumers"].append({"id": record["id"], "start": call["start"]})
        absolute = quote_sheet(MAP_SHEET) + "!$G$" + helper["cell"][1:]
        row_expr = absolute if table["firstRow"] == 1 else f"{absolute}-{table['firstRow'] - 1}"
        replacement = f"IF({absolute}=0,{call['original']},INDEX({args[1]},{row_expr},{args[2]}))"
        edits.append({**call, "status": "planned", "helperCell": helper["cell"], "table": table,
                      "resultColumn": column, "retainedSourceColumnError": column > table["width"],
                      "replacement": replacement})
    edits.sort(key=lambda e: e["start"])
    require(all(a["end"] <= b["start"] for a, b in zip(edits, edits[1:])), "Nested dictionary lookups require separate design")
    if not edits:
        return None
    # Defer the entire consumer if any targeted call is dynamic.
    if any(e["status"] == "deferred" for e in edits):
        return {**record, "status": "deferred", "edits": edits, "candidateFormula": None}
    pieces = []
    previous = 0
    for edit in edits:
        pieces.extend((source[previous:edit["start"]], edit["replacement"]))
        previous = edit["end"]
    pieces.append(source[previous:])
    candidate = "".join(pieces)
    require(len(candidate.encode("utf-16-le")) // 2 <= 8192, "Excel formula length exceeded")
    token_spans(candidate)
    return {**record, "status": "planned", "edits": edits, "candidateFormula": candidate}


def build_plan(version, source_path=None):
    filename, expected = identity.SOURCES[version]
    path = Path(source_path) if source_path is not None else REPO / "public" / filename
    rows = identity.build_plan(version, path)
    sheets = read_original(path, expected)
    helpers = {}
    consumers = []
    counts = Counter()
    for sheet in sheets:
        for record in formula_cells(sheet):
            counts["formulaCells"] += 1
            if record["formulaAttributes"].get("t") == "shared":
                counts["sharedFormulaCells"] += 1
            if "VLOOKUP" not in record["formula"].upper():
                continue
            item = edit_formula(record, rows["dictionary"], helpers)
            if item:
                consumers.append(item)
    require(len(consumers) == 1003, "Pinned source spell-consumer count changed")
    counts.update({"consumers": len(consumers), "planned": sum(c["status"] == "planned" for c in consumers),
                   "deferred": sum(c["status"] == "deferred" for c in consumers), "helpers": len(helpers),
                   "lookupCalls": sum(len(c["edits"]) for c in consumers)})
    map_cells = []
    for row in rows["rows"]:
        n = row["row"]
        for column, value in (("A", row["identity"]), ("B", row["display"]["label"]),
                              ("C", row["original"]["A"]), ("D", n), ("E", row["fieldsSha256"])):
            map_cells.append({"cell": column + str(n), "value": value, "type": "n" if column == "D" else "inlineStr"})
    require(sha(path.read_bytes()) == expected, "Original changed while planning")
    return {"schema": "obr-suite-spell-lookup-plan/v1", "version": version, "source": rows["source"],
            "identityPlanSha256": sha(canonical(rows)), "counts": dict(counts),
            "sourceSheets": [{k: s[k] for k in ("name", "part", "partSha256")} for s in sheets],
            "helperSheet": {"name": MAP_SHEET, "state": "veryHidden", "cells": map_cells, "helpers": list(helpers.values()),
                            "policy": "Static pinned labels only; original row identities and dictionary fields are retained."},
            "consumers": consumers, "identityDiagnostics": rows["diagnostics"],
            "remaining": ["Apply package relationships, shared-formula expansion and cache invalidation with byte-preservation validation",
                          "Replace spellbook dropdown source with compact labels, including sparse and future custom slots",
                          "Resolve active-cell INDIRECT/CELL behavior in spellbook C3 and all downstream details",
                          "Migrate Chinese spell-name conditional-format rules without changing relative references",
                          "Define custom-slot edits and label collisions after the pinned snapshot",
                          "Carry identities and English details through XLSX upload and JSON export",
                          "Apply reviewed full-body translations and validate layout",
                          "Native Excel/WPS recalculation, selection, saving and upload acceptance"],
            "workbookWritten": False, "nativeCalculated": False, "releaseReady": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", choices=["2014", "2024", "both"], default="both")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    destination = (args.output or BASE / ("lookup-plan-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))).resolve()
    require(destination.is_relative_to(BASE.resolve()) and destination != BASE.resolve(), "Output must be a new child of the lookup audit directory")
    require(not destination.exists(), "Output already exists")
    versions = ["2014", "2024"] if args.version == "both" else [args.version]
    plans = {v: build_plan(v) for v in versions}
    destination.mkdir(parents=True, exist_ok=False)
    for version, plan in plans.items():
        with (destination / (version + "-lookup-plan.json")).open("xb") as target:
            target.write(json.dumps(plan, ensure_ascii=False, indent=2).encode("utf8") + b"\n")
    print(json.dumps({"output": str(destination), "versions": {v: p["counts"] for v, p in plans.items()}, "workbookWritten": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
