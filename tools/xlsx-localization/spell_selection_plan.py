"""Plan spellbook selection against pinned originals; never write an XLSX.

This increment depends on the exact identity and lookup plans it regenerates.
Native calculation, UI layout and upload identity are separate acceptance gates.
"""
from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from xml.parsers import expat
import zipfile

sys.dont_write_bytecode = True


def find_repo(explicit=None):
    chosen = explicit or os.environ.get("OBR_SUITE_ROOT")
    if chosen:
        result = Path(chosen).resolve()
        if not (result / "tools/xlsx-localization/spell_identity.py").is_file():
            raise ValueError("Explicit tool repository does not contain spell_identity.py")
        return result
    candidates = []
    for parent in Path(__file__).resolve().parents:
        candidates.extend([parent, parent / "obr-suite"])
    for candidate in candidates:
        if (candidate / "tools/xlsx-localization/spell_identity.py").is_file():
            return candidate.resolve()
    raise ValueError("Cannot locate the existing identity/lookup tools; pass --repo")


_bootstrap = argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--repo")
REPO = find_repo(_bootstrap.parse_known_args()[0].repo)
sys.path.insert(0, str(REPO / "tools/xlsx-localization"))
import spell_identity as identity
import spell_lookup_plan as lookup

NS = identity.NS
require, sha, canonical = identity.require, identity.sha, identity.canonical
SELECT_SHEET = "_OBRSpellSelect"
CHOICES_NAME = "_OBRSpellChoices"
INPUT_SQREF = "X3:X52 AC3:AC52 AH3:AH52 AM3:AM52"
SCHEMA = "obr-suite-spell-selection-plan/v1"


def raw_elements(data):
    """Capture exact original element bytes, including self-closing elements."""
    require(b"<!DOCTYPE" not in data.upper() and b"<!ENTITY" not in data.upper(), "Unsupported XML declarations")
    parser = expat.ParserCreate(namespace_separator="}")
    stack, records = [], []

    def tag_end(start):
        quote = None
        for i in range(start, len(data)):
            char = data[i]
            if quote is not None:
                if char == quote:
                    quote = None
            elif char in (34, 39):
                quote = char
            elif char == 62:
                return i + 1
        raise identity.Rejected("Unclosed XML start tag")

    def start(name, attrs):
        offset = parser.CurrentByteIndex
        end = tag_end(offset)
        path = tuple(n["name"] for n in stack) + (name.rsplit("}", 1)[-1],)
        stack.append({"name": path[-1], "path": path, "attrs": attrs, "start": offset,
                      "openEnd": end, "selfClosing": data[offset:end].rstrip().endswith(b"/>")})

    def end(_name):
        record = stack.pop()
        stop = record["openEnd"] if record["selfClosing"] else tag_end(parser.CurrentByteIndex)
        raw = data[record["start"]:stop]
        records.append({"path": record["path"], "attributes": record["attrs"],
                        "oldXML": raw.decode("utf8"), "oldXMLSha256": sha(raw)})

    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    return records


def receipt(record):
    return {k: record[k] for k in ("oldXML", "oldXMLSha256")}


def only(records, path, **attrs):
    matches = [r for r in records if r["path"] == tuple(path.split("/")) and
               all(r["attributes"].get(k) == v for k, v in attrs.items())]
    require(len(matches) == 1, "Expected one original XML element: " + path + str(attrs))
    return matches[0]


def qualified(sheet, address):
    return lookup.quote_sheet(sheet) + "!" + address


def formula_text(text):
    return '"' + text.replace('"', '""') + '"'


def escape_match(text):
    return f'SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({text},"~","~~"),"*","~*"),"?","~?")'


def custom_formulas(row, ordinal):
    """Current authored name remains authoritative; no custom body is overwritten.

    A hidden status explains omitted invalid names. Excel's legacy 255-unit
    lookup-string bound includes wildcard escaping. CLEAN/TRIM are conservative
    text limits, not a claim to validate every Unicode collation in Excel.
    """
    name = qualified("法术大全", "$A$" + str(row))
    suffix = formula_text(f" [Custom spell {ordinal}]")
    label = name + "&" + suffix
    status = (f'IFERROR(IF({name}="","",IF(NOT(ISTEXT({name})),"Name must be text",'
              f'IF(LEN(TRIM({name}))=0,"Name is blank",IF(CLEAN({name})<>{name},'
              f'"Name contains a control character",IF(LEN({escape_match(label)})>255,'
              f'"Name is too long for an exact lookup","OK"))))),"Source name has an error")')
    # The companion status is in the separate selection sheet, never in a user-facing label.
    state = qualified(SELECT_SHEET, "$C$" + str(row))
    return {"label": f'IF({state}="OK",{label},"")', "status": status,
            "originalName": f'IFERROR(IF({name}="","",{name}),"")'}


def helper_cells(last, custom_start):
    cells = [{"cell": "D1", "formula": "$B$" + str(last), "type": "n"}]
    mapped = qualified(lookup.MAP_SHEET, "$B$3:$B$" + str(last))
    for row in range(3, last + 1):
        raw = qualified(lookup.MAP_SHEET, "$B$" + str(row))
        previous = "0" if row == 3 else "$B$" + str(row - 1)
        cells.append({"cell": "B" + str(row), "formula": f'{previous}+IF(LEN({raw})>0,1,0)', "type": "n"})
        rank = str(row - 2)
        cells.append({"cell": "A" + str(row), "formula":
                      f'IF({rank}<=$D$1,INDEX({mapped},MATCH({rank},$B$3:$B${last},0)),"")', "type": "str"})
        if row >= custom_start:
            cells.append({"cell": "C" + str(row), "formula": custom_formulas(row, row - custom_start + 1)["status"], "type": "str"})
    return cells


def text_value(cell, strings):
    if cell.get("t") == "s":
        value = cell.findtext(NS + "v")
        require(value is not None and value.isdigit() and int(value) < len(strings), "Invalid shared string index")
        item = strings[int(value)]
        require(item.find(NS + "r") is None, "Rich-text label needs a separate run-preserving plan")
        return item.findtext(NS + "t") or ""
    return cell.findtext(NS + "is/" + NS + "t") or cell.findtext(NS + "v") or ""


def build_plan(version, source_path=None):
    filename, expected = identity.SOURCES[version]
    path = Path(source_path) if source_path is not None else REPO / "public" / filename
    ident = identity.build_plan(version, path)
    look = lookup.build_plan(version, path)
    require(look["identityPlanSha256"] == sha(canonical(ident)), "Identity/lookup dependency changed")
    sheets = lookup.read_original(path, expected)
    with zipfile.ZipFile(io.BytesIO(path.read_bytes())) as archive:
        parts = {n: archive.read(n) for n in archive.namelist()}
    by_name = {s["name"]: s for s in sheets}
    book = by_name["法术书"]
    raw = raw_elements(parts[book["part"]])
    cells = {c.get("r"): c for c in book["root"].iter(NS + "c")}
    workbook = ET.fromstring(parts["xl/workbook.xml"])
    names = workbook.find(NS + "definedNames")
    require(SELECT_SHEET.casefold() not in {s["name"].casefold() for s in sheets}, "Selection helper already exists")
    require(names is None or CHOICES_NAME.casefold() not in {n.get("name", "").casefold() for n in names}, "Choice name already exists")
    merge = only(raw, "worksheet/mergeCells/mergeCell", ref="C3:R6")
    protection = only(raw, "worksheet/sheetProtection")
    require(protection["attributes"].get("sheet") == "1", "Unexpected spellbook protection")
    c3 = cells["C3"]
    f = c3.find(NS + "f")
    require(f is not None and f.get("t") == "array" and f.get("ref") == "C3" and c3.get("cm") == "1", "C3 array ownership changed")
    require('INDIRECT(CELL("address"))' in (f.text or ""), "C3 is no longer the active-cell selector")
    metadata = ET.fromstring(parts["xl/metadata.xml"])
    buckets = metadata.find(NS + "cellMetadata")
    require(buckets is not None and len(buckets) >= 1, "Missing C3 metadata bucket")
    rc = buckets[0].find(NS + "rc")
    require(rc is not None and rc.attrib == {"t": "1", "v": "0"}, "C3 metadata mapping changed")
    types = metadata.find(NS + "metadataTypes")
    require(types is not None and types[0].get("name") == "XLDAPR", "C3 is not dynamic-array metadata")
    dyn = metadata.find(NS + "futureMetadata")
    require(dyn is not None and dyn.get("name") == "XLDAPR" and any(x.tag.endswith("}dynamicArrayProperties") and x.get("fDynamic") == "1" for x in dyn.iter()), "Dynamic metadata proof changed")

    style_raw = raw_elements(parts["xl/styles.xml"])
    style_nodes = ET.fromstring(parts["xl/styles.xml"]).find(NS + "cellXfs")
    raw_xfs = [r for r in style_raw if r["path"] == ("styleSheet", "cellXfs", "xf")]
    require(style_nodes is not None and len(style_nodes) == len(raw_xfs), "Style count mismatch")
    style_clones, edits, missing = {}, [], []
    for row in range(3, 7):
        for code in range(ord("C"), ord("R") + 1):
            address = chr(code) + str(row)
            if address not in cells:
                missing.append(address)
                continue
            cell = cells[address]
            original_style = int(cell.get("s", "0"))
            base = style_nodes[original_style]
            require(base.find(NS + "protection") is None, "Merged input style protection changed")
            symbol = "spell-selector-unlocked-" + str(original_style)
            if symbol not in style_clones:
                style_clones[symbol] = {"symbol": symbol, "sourceStyleIndex": original_style,
                    **receipt(raw_xfs[original_style]), "setAttributes": {"applyProtection": "1"},
                    "protection": {"locked": "0"}, "preserveAllOtherAttributesAndChildren": True}
            entry = {"sheet": book["name"], "part": book["part"], "cell": address,
                     **receipt(only(raw, "worksheet/sheetData/row/c", r=address)),
                     "styleRef": symbol, "preserveOtherAttributes": True, "preserveChildren": address != "C3"}
            if address == "C3":
                entry.update({"removeAttributes": ["cm"], "replaceChildren": {"type": "inlineStr", "value": ""},
                              "removeFormulaAndCache": True})
            else:
                require(cell.find(NS + "f") is None and cell.find(NS + "v") is None, "Merged follower has content")
            edits.append(entry)
    require(not missing, "Missing merged selector cells need an explicitly reviewed creation plan")

    strings = list(ET.fromstring(parts["xl/sharedStrings.xml"]))
    label_defs = [("C2", "法术查询↓", "Spell details"), ("U2", "法术列表↓", "Spell list")]
    if version == "2014":
        label_defs.append(("Z2", "绿：专注 蓝：仪式", "Green: Concentration  Blue: Ritual"))
    else:
        label_defs.extend([("Z2", "选中法术，按下F9即可查看法术详述", "Choose a spell on the left to see its details."),
                           ("AJ2", "绿：专注 蓝：仪式", "Green: Conc.  Blue: Ritual")])
    for address, original, target in label_defs:
        require(text_value(cells[address], strings) == original, "Original label changed: " + address)
        label_edit = {"sheet": book["name"], "part": book["part"], "cell": address,
                      **receipt(only(raw, "worksheet/sheetData/row/c", r=address)),
                      "originalText": original, "replaceChildren": {"type": "inlineStr", "value": target},
                      "preserveOtherAttributes": True, "preserveStyle": True}
        if version == "2024" and address == "AJ2":
            original_style = int(cells[address].get("s", "0"))
            alignment = style_nodes[original_style].find(NS + "alignment")
            require(alignment is not None and alignment.get("wrapText") == "1" and alignment.get("shrinkToFit") is None,
                    "Legend alignment differs from the reviewed clipped label")
            symbol = "spell-legend-fit-" + str(original_style)
            style_clones[symbol] = {"symbol": symbol, "purpose": "label-fit", "sourceStyleIndex": original_style,
                **receipt(raw_xfs[original_style]), "setAttributes": {},
                "alignmentSetAttributes": {"wrapText": "0", "shrinkToFit": "1"},
                "preserveProtection": True, "preserveAllOtherAttributesAndChildren": True}
            label_edit.pop("preserveStyle")
            label_edit.update({"styleRef": symbol, "stylePurpose": "label-fit",
                               "preserveVisualStyleExcept": ["alignment.wrapText", "alignment.shrinkToFit"]})
        edits.append(label_edit)

    dv = only(raw, "worksheet/dataValidations/dataValidation", sqref=INPUT_SQREF)
    dv_root = book["root"].find(NS + "dataValidations")
    require(dv_root is not None and len(dv_root) == 1, "Unexpected spellbook validation ownership")
    old_formula = dv_root[0].findtext(NS + "formula1")
    last, custom_start = ident["dictionary"]["lastRow"], ident["dictionary"]["customStart"]
    expected_formula = f'OFFSET(法术大全!$A$3,,,SUMPRODUCT(N(LEN(法术大全!$A$3:$A${last})>0)),)'
    require(old_formula == expected_formula, "Original sparse dropdown changed")
    translated_dv = {"errorTitle": "Spell not found", "error": "The name may have changed, or this source may not be included."}
    dv_attributes = {k: translated_dv[k] for k in translated_dv if k in dv["attributes"]}
    validations = [dict(operation="replace", **receipt(dv), sqref=INPUT_SQREF, formula1=CHOICES_NAME,
                        setAttributes=dv_attributes, preserveOtherAttributes=True),
                   {"operation": "add", "attributes": {"type": "list", "allowBlank": "1", "showInputMessage": "1",
                       "promptTitle": "Spell details", "prompt": "Select a spell to view its details", "sqref": "C3"},
                    "formula1": CHOICES_NAME, "preserveExistingInputAndErrorBehavior": True}]

    existing_map = {c["cell"]: c for c in look["helperSheet"]["cells"]}
    overrides = []
    builtins = [r["display"]["label"] for r in ident["rows"] if r["kind"] == "builtin" and r["display"]["label"]]
    require(not any(re.search(r" \[Custom spell (?:[1-9]|[1-4][0-9]|50)\]$", label, re.I) for label in builtins), "Builtin uses reserved custom suffix")
    for row in range(custom_start, last + 1):
        formulas = custom_formulas(row, row - custom_start + 1)
        for col, kind in (("B", "label"), ("C", "originalName")):
            address = col + str(row)
            previous = existing_map[address]
            if col == "B":
                require(previous["value"] is None, "Lookup already assigns a custom label")
            overrides.append({"sheet": lookup.MAP_SHEET, "cell": address,
                              "expectedLookupCell": previous, "expectedLookupCellSha256": sha(canonical(previous)),
                              "replaceWith": {"cell": address, "formula": formulas[kind], "type": "str"}})

    downstream = [c for c in look["consumers"] if c["sheet"] == "法术书" and
                  any(re.search(r"(?<![A-Z0-9_])\$?C\$?3(?![0-9])", e["original"]) for e in c["edits"])]
    require(len(downstream) == 11 and all(c["status"] == "planned" for c in downstream), "C3 downstream lookup coverage changed")
    c3_consumer = [c for c in look["consumers"] if c["sheet"] == "法术书" and c["cell"] == "C3"]
    require(len(c3_consumer) == 1 and c3_consumer[0]["status"] == "deferred", "Lookup now owns C3; re-review increment")
    chain = main_chain(sheets, parts)
    helper = {"name": SELECT_SHEET, "state": "veryHidden", "cells": helper_cells(last, custom_start),
              "purpose": {"A": "Compact nonempty displayed names", "B": "Cumulative count through every original slot",
                          "C": "Custom-name validation status; never included in dropdown", "D1": "Total valid names"}}
    defined_name = {"name": CHOICES_NAME, "scope": "workbook", "hidden": True,
                    "formula": qualified(SELECT_SHEET, "$A$3") + ":INDEX(" +
                    qualified(SELECT_SHEET, f"$A$3:$A${last}") + ",MAX(1," + qualified(SELECT_SHEET, "$D$1") + "))"}
    for cell in helper["cells"] + [o["replaceWith"] for o in overrides]:
        require(len(cell["formula"].encode("utf-16-le")) // 2 <= 8192, "Generated formula too long")
        lookup.token_spans(cell["formula"])
    require(sha(path.read_bytes()) == expected, "Original changed while planning")
    return {"schema": SCHEMA, "version": version, "source": ident["source"],
            "identityPlanSha256": sha(canonical(ident)), "lookupPlanSha256": sha(canonical(look)),
            "dependencies": {"applyAfter": "Regenerated, byte-bound lookup plan and optional shield style clones",
                "mapIncrementPolicy": "Replace ONLY exact expectedLookupCell records after matching lookupPlanSha256; retain all other map cells/helpers.",
                "C3LookupConflict": "Supersedes the one deferred dynamic C3 consumer only; do not reapply it.",
                "symbolicStyles": "Append clones after existing package mutations; resolve symbols from actual cellXfs count, never fixed final indexes."},
            "revision": "v3-2024-short-legend",
            "sourceParts": {p: sha(parts[p]) for p in (book["part"], "xl/styles.xml", "xl/metadata.xml", "xl/workbook.xml", "xl/sharedStrings.xml")},
            "spellbook": {"sheet": book["name"], "part": book["part"], "cells": edits,
                "preserveMerge": {"ref": "C3:R6", **receipt(merge)}, "preserveSheetProtection": receipt(protection),
                "existingMergedCells": 64, "newMergedCells": [], "newVisibleInputs": ["C3"],
                "existingInputRanges": INPUT_SQREF, "validationEdits": validations,
                "validationParent": receipt(only(raw, "worksheet/dataValidations")),
                "preserveAllOtherCells": True},
            "styleClones": list(style_clones.values()), "helperSheet": helper, "definedName": defined_name,
            "mapOverrides": overrides,
            "metadataPolicy": {"removeOnly": {"sheet": "法术书", "cell": "C3", "attribute": "cm", "expectedValue": "1"},
                "proof": "cm=1 -> cellMetadata[0]/rc(t=1,v=0) -> metadataTypes[0] XLDAPR and dynamic-array futureMetadata[0]; old C3 array ref=C3 is replaced by input.",
                "retainPartByteExact": "xl/metadata.xml", "retainOtherCellsMetadata": True},
            "customPolicy": {"firstRow": custom_start, "lastRow": last, "slots": 50,
                "suffix": " [Custom spell 1] through [Custom spell 50]", "numbersAre": "Human-readable custom slot ordinals, not dictionary row or identity IDs",
                "validate": "Text, nonblank after ASCII-space TRIM, unchanged by CLEAN, escaped MATCH length <=255 legacy UTF-16 units; IFERROR status distinguishes source errors.",
                "invalidNames": "Original authored cell/body retained; label omitted, reason in hidden C status. Visible author feedback/validation remains pending.",
                "preserveBuiltinMapB": True, "quotesAndWildcards": "Quotes are source cell data; existing lookup helper escapes ~ * ? before exact MATCH.",
                "originalAFallbackCollision": "Known A/display and future custom original-name collisions remain ambiguous for manually entered old names; dropdown labels resolve B to their exact row.",
                "snapshotIdentityFields": "Map A identity, D row and E source fingerprint remain the pinned snapshot; dynamic custom B/C do not assert a new content hash."},
            "downstream": {"C3PlannedLookupCells": [c["cell"] for c in downstream], "sourceConsumerReceipts": [{"cell": c["cell"], "formula": c["formula"], "candidateFormula": c["candidateFormula"]} for c in downstream], "mainCardChain": chain},
            "unmodifiedSpellNameConditionalFormatting": [
                {"sheet": s["name"], "part": s["part"], **receipt(r)}
                for s in sheets if s["name"] in ("法术书", "主要")
                for r in raw_elements(parts[s["part"]])
                if r["path"] == ("worksheet", "conditionalFormatting") and
                any(name in r["oldXML"] for name in ("繁彩球", "火球术", "识破隐形", "隐形术"))],
            "counts": {"visibleExistingInputs": 200, "newVisibleInputs": 1, "customSlots": 50,
                "builtinLabels": len(builtins), "reservedGaps": [r["row"] for r in ident["rows"] if r["kind"] == "reserved-gap"],
                "mergedExistingCellsUnlocked": 64, "selectorStyleClones": 9,
                "labelFitStyleClones": 1 if version == "2024" else 0,
                "styleClones": len(style_clones), "mapOverrides": len(overrides),
                "helperFormulaCells": len(helper["cells"]), "C3DownstreamLookups": len(downstream)},
            "retainedSourceDiagnostics": ident["diagnostics"],
            "retainedFormulaAnomalies": ([{"sheet": "法术书", "cell": "O8", "issue": "Original VLOOKUP table A:X has 24 columns but returns column 26. The existing lookup plan preserves that source error; this selection increment does not repair it."}] if version == "2014" else []),
            "remaining": ["Apply package relationships, actual style indexes, precise cell/DV changes and all relevant formula cache invalidation; validate unrelated parts byte-exact.",
                "Main F/K list formulas and their empty/blank behavior are recorded dependencies, not changed by this increment.",
                "Localize Chinese literal labels in detail formulas and the original 2024 name-specific conditional formatting without changing coordinates.",
                "Provide visible feedback for invalid future custom names and re-review collisions if builtins are edited; Python matching is not Excel locale collation.",
                "Carry spell identities, suffixed custom labels and translated bodies through the existing upload/JSON contract; current AV1 does not export known/prepared spell lists.",
                "Native Excel/WPS dropdown interaction, protected merged-cell editing, recalculation, save/reopen and text-fit acceptance remain unverified."],
            "workbookWritten": False, "nativeCalculated": False, "releaseReady": False}


def main_chain(sheets, parts):
    """Read actual dependency formulas and validation nodes; make no F/K edits."""
    result = []
    for sheet in sheets:
        if sheet["name"] not in ("主要", "数据表"):
            continue
        records = lookup.formula_cells(sheet)
        selected = []
        if sheet["name"] == "数据表":
            ranges = {"B": (2, 301), "F": (2, 301), "H": (2, 59), "K": (1, 59)}
            for cell in records:
                match = re.fullmatch(r"([A-Z]+)([0-9]+)", cell["cell"])
                if match and match[1] in ranges and ranges[match[1]][0] <= int(match[2]) <= ranges[match[1]][1]:
                    selected.append(cell)
        raw = raw_elements(parts[sheet["part"]])
        guards = []
        if sheet["name"] == "数据表":
            # The 2024 F array starts at rank 2 because B1 is a nonempty heading;
            # K's 2024 range also extends beyond the 58 currently mirrored inputs.
            for r in raw:
                if r["path"] == ("worksheet", "sheetData", "row", "c") and r["attributes"].get("r") in {"B1", "H1", *["H" + str(n) for n in range(60, 69)]}:
                    guards.append({"cell": r["attributes"]["r"], **receipt(r)})
        dvs = [dict(attributes=r["attributes"], **receipt(r)) for r in raw if r["path"] == ("worksheet", "dataValidations", "dataValidation") and
               ("数据表!$F$" in r["oldXML"] or "数据表!$K$" in r["oldXML"] or "$K$1:$K$59" in r["oldXML"])]
        result.append({"sheet": sheet["name"], "part": sheet["part"], "partSha256": sheet["partSha256"],
                       "formulaRecords": selected, "premiseCellReceipts": guards,
                       "validations": dvs, "plannedEdits": []})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--version", choices=["2014", "2024", "both"], default="both")
    parser.add_argument("--source", type=Path, help="One pinned source; requires a single --version")
    parser.add_argument("--output", type=Path, required=True, help="New audit output directory")
    args = parser.parse_args()
    require(args.repo is None or find_repo(args.repo) == REPO, "Use OBR_SUITE_ROOT to select another tool repository")
    require(args.source is None or args.version != "both", "--source requires a single version")
    destination = args.output.resolve()
    require(not destination.exists(), "Refusing to overwrite output")
    require(not destination.is_relative_to(REPO), "Audit output must be outside the repository")
    versions = ["2014", "2024"] if args.version == "both" else [args.version]
    plans = {v: build_plan(v, args.source) for v in versions}
    destination.mkdir(parents=True, exist_ok=False)
    for version, plan in plans.items():
        (destination / (version + "-selection-plan.json")).write_bytes(json.dumps(plan, ensure_ascii=False, indent=2).encode("utf8") + b"\n")
    print(json.dumps({"output": str(destination), "versions": {v: p["counts"] for v, p in plans.items()}, "workbookWritten": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
