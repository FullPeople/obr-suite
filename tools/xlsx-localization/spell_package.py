"""Portable engineering spell workbook packager. No native recalculation/upload.

Fresh pinned originals -> published AV1/shield builder -> fixed shield seed ->
regenerated lookup plan. No external JSON plan is accepted for applying edits.
"""
from __future__ import annotations
import argparse
from collections import defaultdict, Counter
from copy import copy
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import types
import xml.etree.ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape
import zipfile
from openpyxl.formula.tokenizer import Tokenizer

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
def find_repo(explicit=None):
    selected = Path(explicit).resolve() if explicit else HERE.parents[1]
    require_marker = selected / "tools/xlsx-localization/spell_identity.py"
    if not require_marker.is_file(): raise ValueError("Repository must contain the published localization tools")
    return selected


_bootstrap = argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--repo")
REPO = find_repo(_bootstrap.parse_known_args()[0].repo)
BASE = REPO.parent / "_audit" / "xlsx-spell-package"
TOOL_ROOT = REPO / "tools/xlsx-localization"
PINS = {"shield_package.py": "a7fb51da1c50178dd55688cdd449d9eb09d3974fa92ca997abe23b100c14a333",
        "spell_identity.py": "aa56f587f88d27890e04df97bfe95349c33fcfd67e3347c26f6112d2655cf33f",
        "spell_lookup_plan.py": "54d4fe2c63b283bac0c773e48d6c02c1e2a485ca1f45c2f320267f6c5f6dcb03"}
SEEDS = {"2014": "9e0acea5dfc9566ccc07f25fdad0e80b3d985069a1dbd8fe1062134fbad9f9b7",
         "2024": "5b119fbdf295225b7c9207858f3eea5076d3c6180c7a43b8f9e83f82eb652255"}
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
q = lambda name: "{" + NS + "}" + name
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def require(ok, message):
    if not ok: raise ValueError(message)


def pinned_bytes(name):
    raw = (TOOL_ROOT / name).read_bytes().replace(b"\r\n", b"\n")
    require(sha(raw) == PINS[name], "Frozen dependency changed: " + name)
    return raw


def load_tools():
    modules = {}
    for filename, module_name in (("spell_identity.py", "spell_identity"), ("shield_package.py", "spell_package_shield"), ("spell_lookup_plan.py", "spell_package_lookup")):
        raw = pinned_bytes(filename)
        module = types.ModuleType(module_name); module.__file__ = str(TOOL_ROOT / filename)
        sys.modules[module_name] = module
        exec(compile(raw, module.__file__, "exec"), module.__dict__)
        modules[filename] = module
    return modules["shield_package.py"], modules["spell_lookup_plan.py"]


def spans(raw, tag):
    """Independent Expat cell boundaries for preservation verification."""
    parser = expat.ParserCreate(namespace_separator="}"); stack = []; result = []
    def start(name, attrs):
        begin = parser.CurrentByteIndex; pos = begin; quote = None
        while pos < len(raw):
            c = raw[pos]
            if quote is not None:
                if c == quote: quote = None
            elif c in (34, 39): quote = c
            elif c == 62: break
            pos += 1
        require(pos < len(raw), "Unterminated tag")
        stack.append((name, attrs, begin, pos + 1, raw[pos - 1:pos] == b"/"))
    def end(name):
        opened, attrs, begin, end_head, closed = stack.pop()
        require(name == opened, "XML stack mismatch")
        finish = end_head if closed else raw.index(b">", parser.CurrentByteIndex) + 1
        if name.rsplit("}", 1)[-1] == tag: result.append((attrs, raw[begin:finish], begin, finish))
    parser.StartElementHandler = start; parser.EndElementHandler = end
    parser.Parse(raw, True)
    return result


def without(raw, tag):
    for _, _, a, b in reversed(spans(raw, tag)): raw = raw[:a] + raw[b:]
    return raw


def coordinate(address):
    m = re.fullmatch(r"\$?([A-Z]+)\$?([1-9][0-9]*)", address)
    require(m is not None, "Invalid cell address: " + address)
    col = 0
    for c in m[1]: col = col * 26 + ord(c) - 64
    require(col <= 16384 and int(m[2]) <= 1048576, "Cell exceeds Excel bounds")
    return col, int(m[2])


def sheet_cells(plan):
    cells = [dict(c) for c in plan["helperSheet"]["cells"]]
    cells += [{"cell": h["cell"], "formula": h["formula"]} for h in plan["helperSheet"]["helpers"]]
    require(len(cells) == len({c["cell"] for c in cells}), "Duplicate helper cell")
    return cells


def serialize_sheet(cells):
    rows = defaultdict(list)
    require(cells, "Empty generated sheet")
    for c in sorted(cells, key=lambda c: coordinate(c["cell"])[::-1]):
        address = c["cell"]; _, row = coordinate(address)
        if "formula" in c:
            formula = c["formula"]
            require(isinstance(formula, str) and formula and not formula.startswith("="), "Expected OOXML formula text")
            require(len(formula.encode("utf-16-le")) // 2 <= 8192, "Formula exceeds limit")
            body = f'<c r="{address}"><f>{escape(formula)}</f></c>'
        elif c["value"] is None:
            body = f'<c r="{address}"/>'
        elif c["type"] == "n":
            require(isinstance(c["value"], int) and not isinstance(c["value"], bool), "Expected integer constant")
            body = f'<c r="{address}" t="n"><v>{c["value"]}</v></c>'
        else:
            require(c["type"] == "inlineStr" and isinstance(c["value"], str), "Unsupported helper value")
            body = f'<c r="{address}" t="inlineStr"><is><t xml:space="preserve">{escape(c["value"])}</t></is></c>'
        rows[row].append(body)
    largest_col = max(coordinate(c["cell"])[0] for c in cells)
    letters = ""; n = largest_col
    while n: n, m = divmod(n - 1, 26); letters = chr(65 + m) + letters
    dimension = "A1:" + letters + str(max(rows))
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="{NS}">'
            f'<dimension ref="{dimension}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>'
            '<sheetFormatPr defaultRowHeight="15"/><sheetData>' + ''.join(f'<row r="{r}">{"".join(b)}</row>' for r, b in sorted(rows.items())) + '</sheetData></worksheet>').encode()


def allocate_sheet(package, name):
    require(name.casefold() not in {s["name"].casefold() for s in package.sheets}, "New sheet name collides")
    ids = {r["attributes"]["Id"] for r in package.relationships if r["part"] == "xl/_rels/workbook.xml.rels"}
    rid = 1
    while f"rId{rid}" in ids: rid += 1
    part_number = 1
    while f"xl/worksheets/sheet{part_number}.xml".casefold() in {n.casefold() for n in package.parts}: part_number += 1
    return {"name": name, "sheetId": max(s["sheetId"] for s in package.sheets) + 1, "rId": f"rId{rid}",
            "part": f"xl/worksheets/sheet{part_number}.xml", "state": "veryHidden"}


def append_sheet(p, package, parts, allocation, content):
    name = allocation["name"]
    parts[p.WORKBOOK] = p.splice_once(parts[p.WORKBOOK], b"</sheets>",
        f'<sheet name="{escape(name)}" sheetId="{allocation["sheetId"]}" state="veryHidden" r:id="{allocation["rId"]}"/>'.encode())
    parts[p.RELS] = p.splice_once(parts[p.RELS], b"</Relationships>",
        f'<Relationship Id="{allocation["rId"]}" Type="{p.RNS}/worksheet" Target="{allocation["part"].removeprefix("xl/")}"/>'.encode())
    parts[p.CONTENT] = p.splice_once(parts[p.CONTENT], b"</Types>",
        f'<Override PartName="/{allocation["part"]}" ContentType="{p.WORKSHEET_TYPE}"/>'.encode())
    if p.APP in parts: parts[p.APP] = p.append_app_sheet(parts[p.APP], [s["name"] for s in package.sheets], name)
    require(allocation["part"] not in parts, "New part collides")
    parts[allocation["part"]] = content


def package_bytes(package, parts, additions):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.comment = package.comment
        for info in package.infos: archive.writestr(copy(info), parts[info.filename])
        template = next(i for i in package.infos if i.filename == package.main_part)
        for part in additions:
            info = zipfile.ZipInfo(part, template.date_time); info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = template.create_system; info.external_attr = template.external_attr
            archive.writestr(info, parts[part])
    return data.getvalue()


def apply_lookup(shield, version, seed, plan):
    require(sha(seed) == SEEDS[version], "Shield seed fingerprint mismatch")
    p = shield.p; package = p.read_package(seed); parts = dict(package.parts)
    edits = {(c["sheet"], c["cell"]): c for c in plan["consumers"] if c["status"] == "planned"}
    require(len(edits) == 1002 and Counter(tuple(sorted(c["formulaAttributes"].items())) for c in edits.values()) == {(): 991, (("ca", "1"),): 11}, "Unexpected current formula edit scope")
    changed = set()
    for sheet in package.sheets:
        def patch(m):
            address = m[1].decode(); item = edits.get((sheet["name"], address))
            if item is None: return m[0]
            old = ET.fromstring(m[0]); f = old.find("f")
            require(f is not None and f.text == item["formula"] and f.attrib == item["formulaAttributes"] and old.find("v") is None, "Seed formula does not match regenerated plan")
            replacements = list(re.finditer(rb'<f\b[^>]*>.*?</f>', m[0], re.S))
            require(len(replacements) == 1, "Expected one formula span")
            hit = replacements[0]; header = hit[0][:hit[0].index(b">") + 1]
            after = header + escape(item["candidateFormula"]).encode() + b"</f>"
            changed.add((sheet["name"], address))
            return m[0][:hit.start()] + after + m[0][hit.end():]
        parts[sheet["part"]] = p.CELL.sub(patch, parts[sheet["part"]])
    require(changed == edits.keys(), "Missing consumer edit")
    allocation = allocate_sheet(package, plan["helperSheet"]["name"])
    generated = sheet_cells(plan)
    append_sheet(p, package, parts, allocation, serialize_sheet(generated))
    raw = package_bytes(package, parts, [allocation["part"]])
    return raw, allocation


def verify_lookup(shield, version, seed, candidate, plan, allocation):
    p = shield.p; before, after = p.read_package(seed), p.read_package(candidate)
    require(sha(seed) == SEEDS[version], "Verifier seed mismatch")
    require(after.sheets[:-1] == before.sheets and after.sheets[-1]["name"] == allocation["name"] and after.sheets[-1]["state"] == "veryHidden", "Sheet inventory differs")
    require(list(after.parts) == list(before.parts) + [allocation["part"]], "Unexpected package parts/order")
    metadata = ('date_time','compress_type','comment','extra','create_system','create_version','extract_version','internal_attr','external_attr','flag_bits')
    require(before.comment == after.comment and all(getattr(a, k) == getattr(b, k) for a, b in zip(before.infos, after.infos) for k in metadata), "Old ZIP metadata differs")
    edits = {(c["sheet"], c["cell"]): c for c in plan["consumers"] if c["status"] == "planned"}
    old_sheets = {s["part"] for s in before.sheets}
    registers = {p.WORKBOOK, p.RELS, p.CONTENT, p.APP}
    require(all(before.parts[k] == after.parts[k] for k in before.parts if k not in old_sheets | registers), "Unrelated package part changed")
    compared = edited = formula_count = 0
    for sheet in before.sheets:
        old, new = before.parts[sheet["part"]], after.parts[sheet["part"]]
        a = {attrs["r"]: raw for attrs, raw, _, _ in spans(old, "c")}
        b = {attrs["r"]: raw for attrs, raw, _, _ in spans(new, "c")}
        require(a.keys() == b.keys(), "Original cell address inventory changed")
        require(len(a) == len(list(ET.fromstring(old).iter(q("c")))) and len(b) == len(list(ET.fromstring(new).iter(q("c")))), "Duplicate cell or boundary mismatch")
        for address, raw in a.items():
            item = edits.get((sheet["name"], address)); node = ET.fromstring(b[address])
            if item:
                f = node.find("f")
                require(f is not None and f.text == item["candidateFormula"] and f.attrib == item["formulaAttributes"], "Wrong replacement formula")
                require(without(raw, "f") == without(b[address], "f"), "Unapproved target attributes/value/style change")
                edited += 1
            else: require(raw == b[address], "Unrelated cell changed")
            if node.find("f") is not None:
                formula_count += 1
                require(node.find("v") is None, "Worksheet formula cache was fabricated")
            compared += 1
        require(without(old, "c") == without(new, "c"), "Worksheet surroundings changed")
    require(edited == 1002, "Wrong formula edit count")
    # Removing exactly the newly registered child must reproduce each original
    # registration part byte for byte. Other metadata is never reserialized.
    new_sheet = next(body for attrs, body, _, _ in spans(after.parts[p.WORKBOOK], "sheet") if attrs.get("name") == allocation["name"])
    require(after.parts[p.WORKBOOK].replace(new_sheet, b"", 1) == before.parts[p.WORKBOOK], "Unrelated workbook metadata changed")
    for part, tag, attr, value in ((p.RELS, "Relationship", "Id", allocation["rId"]), (p.CONTENT, "Override", "PartName", "/" + allocation["part"])):
        added = [body for attrs, body, _, _ in spans(after.parts[part], tag) if attrs.get(attr) == value]
        require(len(added) == 1 and after.parts[part].replace(added[0], b"", 1) == before.parts[part], "Registration whitelist differs")
    if p.APP in before.parts:
        require(after.parts[p.APP] == p.append_app_sheet(before.parts[p.APP], [s["name"] for s in before.sheets], allocation["name"]), "App title inventory differs")
    expected = {c["cell"]: c for c in sheet_cells(plan)}
    actual = {c.get("r"): c for c in ET.fromstring(after.parts[allocation["part"]]).iter(q("c"))}
    require(actual.keys() == expected.keys(), "New sheet cell inventory differs")
    for address, definition in expected.items():
        node = actual[address]; f = node.find(q("f"))
        if "formula" in definition:
            require(f is not None and f.text == definition["formula"] and not f.attrib and node.find(q("v")) is None and node.attrib == {"r": address}, "Invalid new helper formula/cache")
        elif definition["value"] is None: require(node.attrib == {"r": address} and len(node) == 0, "Null map cell not blank")
        elif definition["type"] == "n": require(node.findtext(q("v")) == str(definition["value"]) and f is None, "Numeric map constant differs")
        else: require(node.get("t") == "inlineStr" and ''.join(t.text or '' for t in node.iter(q("t"))) == definition["value"] and f is None, "Map string differs")
    names = {s["name"] for s in after.sheets}; reference_count = 0
    for formula in [c["candidateFormula"] for c in plan["consumers"] if c["status"] == "planned"] + [h["formula"] for h in plan["helperSheet"]["helpers"]]:
        for token in Tokenizer("=" + formula).items:
            if token.type != "OPERAND" or token.subtype != "RANGE": continue
            ref = token.value
            if "!" in ref:
                sheet, ref = ref.rsplit("!", 1)
                sheet = sheet[1:-1].replace("''", "'") if sheet.startswith("'") else sheet
                require(sheet in names, "Formula references missing worksheet")
            for endpoint in ref.split(":"):
                if re.fullmatch(r"\$?[A-Z]+", endpoint): endpoint += "1"
                coordinate(endpoint)
            reference_count += 1
    return {"cellsCompared": compared, "oldFormulaCellsWithoutCache": formula_count, "editedFormulas": edited,
            "newMapCells": len(actual), "formulaReferencesChecked": reference_count, "outputSha256": sha(candidate),
            "externalCaches": "old bytes preserved", "nativeRecalculated": False, "uploadReady": False,
            "selectionApplied": False, "dynamicC3": "retained unchanged; selection plan pending"}



# Selection package component; preserved core AST from the frozen audit.
import argparse
from collections import Counter
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import sys
import types
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, quoteattr
import zipfile
m = sys.modules[__name__]

HERE = Path(__file__).resolve().parent
SELECTION_FILE = m.TOOL_ROOT / "spell_selection_plan.py"
SELECTION_SHA = "247d792c7123b7f43370e0e1dde82ba71c5a5d9303011aba8a51e4db331aa9ec"
STYLES = "xl/styles.xml"
require, sha, spans, without = m.require, m.sha, m.spans, m.without
q = m.q


def load_selection(lookup):
    raw = SELECTION_FILE.read_bytes().replace(b"\r\n", b"\n")
    require(sha(raw) == SELECTION_SHA, "Selection tool changed or not frozen")
    module = types.ModuleType("spell_package_selection")
    module.__file__ = str(SELECTION_FILE)
    sys.modules["spell_lookup_plan"] = lookup
    sys.modules[module.__name__] = module
    exec(compile(raw, str(SELECTION_FILE), "exec"), module.__dict__)
    return module


def set_attrs(raw, tag, values, remove=()):
    # Edit only the requested header; keep unmodified attribute spelling/order.
    match = re.match(rb"<" + tag.encode() + rb"\b[^>]*?/?>", raw)
    require(match is not None, "Missing expected element header")
    head = match[0]
    for name in remove:
        head, count = re.subn(rb'\s' + name.encode() + rb'="[^"]*"', b"", head)
        require(count == 1, "Missing removal attribute: " + name)
    for name, value in values.items():
        pattern = rb'\b' + name.encode() + rb'="[^"]*"'
        replacement = (name + "=" + quoteattr(str(value))).encode()
        if re.search(pattern, head): head, count = re.subn(pattern, lambda _: replacement, head)
        else:
            ending = b"/>" if head.endswith(b"/>") else b">"
            head = head[:-len(ending)] + b" " + replacement + ending
            count = 1
        require(count == 1, "Repeated attribute")
    return head + raw[match.end():]


def clone_style(raw, definition):
    require(sha(raw) == definition["oldXMLSha256"] and raw.decode() == definition["oldXML"], "Source xf differs")
    result = set_attrs(raw, "xf", definition["setAttributes"])
    if definition.get("purpose") == "label-fit":
        require(definition.get("alignmentSetAttributes") == {"wrapText":"0","shrinkToFit":"1"} and definition.get("preserveProtection") is True and "protection" not in definition and not definition["setAttributes"], "Unexpected label-fit policy")
        alignments = spans(result,"alignment"); require(len(alignments) == 1,"Label style needs one original alignment")
        _, body, a, b = alignments[0]
        return result[:a] + set_attrs(body,"alignment",definition["alignmentSetAttributes"]) + result[b:]
    require(definition["protection"] == {"locked":"0"} and definition["setAttributes"] == {"applyProtection":"1"}, "Unexpected unlock policy")
    protections = spans(result, "protection")
    require(len(protections) <= 1, "Multiple protection children")
    if protections:
        _, body, a, b = protections[0]
        result = result[:a] + set_attrs(body, "protection", definition["protection"]) + result[b:]
    else:
        child = ("<protection " + " ".join(k + "=" + quoteattr(v) for k,v in definition["protection"].items()) + "/>").encode()
        if result.endswith(b"/>"): result = result[:-2] + b">" + child + b"</xf>"
        else: result = result[:-5] + child + b"</xf>"
    return result


def append_styles(raw, definitions):
    parent = spans(raw, "cellXfs")
    require(len(parent) == 1, "Missing cellXfs")
    _, body, a, b = parent[0]
    children = spans(body, "xf")
    require(len(children) == int(ET.fromstring(body).get("count")), "Shield seed cellXfs count mismatch")
    symbols = {}; added = []
    for definition in definitions:
        source = definition["sourceStyleIndex"]
        require(0 <= source < len(children) and definition["symbol"] not in symbols, "Invalid/duplicate style clone")
        added.append(clone_style(children[source][1], definition))
        symbols[definition["symbol"]] = len(children) + len(added) - 1
    updated = set_attrs(body, "cellXfs", {"count": len(children) + len(added)})
    require(updated.endswith(b"</cellXfs>"), "Unexpected style container")
    updated = updated[:-10] + b"".join(added) + b"</cellXfs>"
    return raw[:a] + updated + raw[b:], symbols


def source_cell_expected(definition):
    raw = definition["oldXML"].encode()
    require(sha(raw) == definition["oldXMLSha256"], "Invalid planned old cell hash")
    # Published shield clears all worksheet formula caches. Inputs retain v.
    return without(raw, "v") if ET.fromstring(raw).find("f") is not None else raw


def apply_cell(raw, definition, symbols):
    require(raw == source_cell_expected(definition), "Selection source cell changed")
    values = {}
    if "styleRef" in definition: values["s"] = symbols[definition["styleRef"]]
    if "replaceChildren" in definition: values["t"] = definition["replaceChildren"]["type"]
    result = set_attrs(raw, "c", values, definition.get("removeAttributes", ()))
    if "replaceChildren" in definition:
        replacement = definition["replaceChildren"]
        require(replacement["type"] == "inlineStr", "Unsupported literal type")
        head = result[:result.index(b">") + 1]
        if head.endswith(b"/>"): head = head[:-2] + b">"
        result = head + b'<is><t xml:space="preserve">' + escape(replacement["value"]).encode() + b"</t></is></c>"
    return result


def validation_xml(definition):
    if definition["operation"] == "replace":
        raw = definition["oldXML"].encode()
        require(sha(raw) == definition["oldXMLSha256"], "Planned validation hash differs")
        raw = set_attrs(raw, "dataValidation", definition["setAttributes"])
        hits = spans(raw, "formula1"); require(len(hits) == 1, "Missing DV formula")
        _, _, a, b = hits[0]
        return raw[:a] + b"<formula1>" + escape(definition["formula1"]).encode() + b"</formula1>" + raw[b:]
    require(definition["operation"] == "add", "Unknown DV edit")
    return ("<dataValidation " + " ".join(k + "=" + quoteattr(v) for k,v in definition["attributes"].items()) + "><formula1>" + escape(definition["formula1"]) + "</formula1></dataValidation>").encode()


def apply_validations(raw, plan):
    old = plan["validationParent"]["oldXML"].encode()
    require(sha(old) == plan["validationParent"]["oldXMLSha256"] and raw.count(old) == 1, "Source validation parent changed")
    result = old; added = []
    for definition in plan["validationEdits"]:
        new = validation_xml(definition)
        if definition["operation"] == "replace":
            former = definition["oldXML"].encode()
            require(result.count(former) == 1, "Original DV not unique")
            result = result.replace(former, new, 1)
        else: added.append(new)
    count = len(spans(old, "dataValidation"))
    require(int(ET.fromstring(old).get("count")) == count, "Old DV count inconsistent")
    result = set_attrs(result, "dataValidations", {"count": count + len(added)})
    result = result[:-18] + b"".join(added) + b"</dataValidations>"
    return raw.replace(old, result, 1)


def map_cells(lookup_plan, selection_plan):
    cells = {c["cell"]: dict(c) for c in m.sheet_cells(lookup_plan)}
    for change in selection_plan["mapOverrides"]:
        require(change["sheet"] == lookup_plan["helperSheet"]["name"], "Unexpected map target")
        former = cells.get(change["cell"])
        require(former == change["expectedLookupCell"] and sha(m.json.dumps(former, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()) == change["expectedLookupCellSha256"], "Map override precondition differs")
        require(change["replaceWith"]["cell"] == change["cell"], "Map override coordinate differs")
        cells[change["cell"]] = dict(change["replaceWith"])
    return list(cells.values())


def add_name(raw, definition):
    existing = [a for a, _, _, _ in spans(raw, "definedName")]
    require(definition["name"].casefold() not in {a["name"].casefold() for a in existing}, "Name collision")
    require(definition["scope"] == "workbook" and definition["hidden"] is True, "Unexpected name policy")
    child = ('<definedName name=' + quoteattr(definition["name"]) + ' hidden="1">' + escape(definition["formula"]) + '</definedName>').encode()
    require(raw.count(b"</definedNames>") == 1, "Expected existing names container")
    return raw.replace(b"</definedNames>", child + b"</definedNames>", 1)


def verify_plan_source(source, lookup_plan, selection_plan):
    require(selection_plan["identityPlanSha256"] == lookup_plan["identityPlanSha256"], "Identity plan fingerprint differs")
    require(selection_plan["source"] == lookup_plan["source"] and selection_plan["lookupPlanSha256"] == sha(json.dumps(lookup_plan, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()), "Lookup plan fingerprint differs")
    require(sha(source) == selection_plan["source"]["sha256"], "Original source differs")
    with zipfile.ZipFile(io.BytesIO(source)) as archive:
        for part, digest in selection_plan["sourceParts"].items(): require(sha(archive.read(part)) == digest, "Original planned source part differs")
        book = archive.read(selection_plan["spellbook"]["part"])
        for definition in selection_plan["spellbook"]["cells"]:
            require(book.count(definition["oldXML"].encode()) == 1, "Planned source cell not present")


def apply(shield, version, source, seed, lookup_plan, selection_plan):
    verify_plan_source(source, lookup_plan, selection_plan)
    looked, map_allocation = m.apply_lookup(shield, version, seed, lookup_plan)
    p = shield.p; package = p.read_package(looked); parts = dict(package.parts)
    parts[STYLES], symbols = append_styles(parts[STYLES], selection_plan["styleClones"])
    book_plan = selection_plan["spellbook"]
    edits = {c["cell"]: c for c in book_plan["cells"]}
    require(len(edits) == len(book_plan["cells"]), "Duplicate cell edit")
    changed = set()
    def replace(match):
        address = match[1].decode()
        if address not in edits: return match[0]
        changed.add(address)
        return apply_cell(match[0], edits[address], symbols)
    parts[book_plan["part"]] = p.CELL.sub(replace, parts[book_plan["part"]])
    require(changed == edits.keys(), "Missing cell replacement")
    parts[book_plan["part"]] = apply_validations(parts[book_plan["part"]], book_plan)
    parts[map_allocation["part"]] = m.serialize_sheet(map_cells(lookup_plan, selection_plan))
    allocation = m.allocate_sheet(package, selection_plan["helperSheet"]["name"])
    m.append_sheet(p, package, parts, allocation, m.serialize_sheet(selection_plan["helperSheet"]["cells"]))
    parts[p.WORKBOOK] = add_name(parts[p.WORKBOOK], selection_plan["definedName"])
    return m.package_bytes(package, parts, [allocation["part"]]), {"map": map_allocation, "selection": allocation, "styles": symbols}


def verify(shield, version, seed, candidate, look, select, allocations):
    """Separate Expat-boundary/ElementTree validation, starting from seed bytes."""
    p = shield.p; old, new = p.read_package(seed), p.read_package(candidate)
    require(sha(seed) == m.SEEDS[version], "Verifier requires fixed seed")
    additions = [allocations[k] for k in ("map", "selection")]
    require(new.sheets[:-2] == old.sheets, "Old sheet inventory changed")
    require(list(new.parts) == list(old.parts) + [a["part"] for a in additions], "Part/order whitelist differs")
    for a, sheet in zip(additions, new.sheets[-2:]):
        require(all(sheet[k] == a[k] for k in ("name", "sheetId", "rId", "part", "state")) and sheet["state"] == "veryHidden", "New sheet registration differs")
    zip_fields = ('date_time','compress_type','comment','extra','create_system','create_version','extract_version','internal_attr','external_attr','flag_bits')
    require(old.comment == new.comment and all(getattr(a,k) == getattr(b,k) for a,b in zip(old.infos, new.infos) for k in zip_fields), "ZIP metadata changed")
    touched = {p.WORKBOOK,p.RELS,p.CONTENT,p.APP,STYLES} | {s["part"] for s in old.sheets}
    require(all(old.parts[k] == new.parts[k] for k in old.parts if k not in touched), "Unrelated part changed")
    book = select["spellbook"]; selectors = {c["cell"]: c for c in book["cells"]}
    edits = {(c["sheet"],c["cell"]):c for c in look["consumers"] if c["status"] == "planned"}
    require(not ({(book["sheet"],a) for a in selectors} & edits.keys()), "Conflicting cell edits")
    cells = original_formulas = rewritten = selector_count = 0
    clone_uses = Counter()
    for sheet in old.sheets:
        before, after = old.parts[sheet["part"]], new.parts[sheet["part"]]
        a = {attrs["r"]:raw for attrs,raw,_,_ in spans(before,"c")}
        b = {attrs["r"]:raw for attrs,raw,_,_ in spans(after,"c")}
        require(a.keys() == b.keys() and len(a) == len(list(ET.fromstring(before).iter(q("c")))) and len(b) == len(list(ET.fromstring(after).iter(q("c")))), "Original raw cell inventory differs")
        for address, former in a.items():
            actual = b[address]; prev, node = ET.fromstring(former), ET.fromstring(actual)
            edit = edits.get((sheet["name"],address))
            selector = selectors.get(address) if sheet["name"] == book["sheet"] else None
            if edit:
                f = node.find("f")
                require(f is not None and f.text == edit["candidateFormula"] and f.attrib == edit["formulaAttributes"], "Wrong lookup formula")
                require(without(former,"f") == without(actual,"f"), "Lookup target extra change")
                rewritten += 1
            elif selector:
                expected_attrs = dict(prev.attrib)
                if "styleRef" in selector:
                    expected_attrs["s"] = str(allocations["styles"][selector["styleRef"]])
                    clone_uses[selector["styleRef"]] += 1
                for attr in selector.get("removeAttributes",()): expected_attrs.pop(attr)
                if "replaceChildren" in selector: expected_attrs["t"] = "inlineStr"
                require(node.attrib == expected_attrs, "Selector attribute whitelist differs")
                if "replaceChildren" in selector:
                    require(len(node) == 1 and node[0].tag == "is" and len(node[0]) == 1 and node[0][0].tag == "t" and node[0][0].attrib == {"{http://www.w3.org/XML/1998/namespace}space":"preserve"} and (node[0][0].text or "") == selector["replaceChildren"]["value"], "Selector text/children differ")
                else: require([ET.tostring(c) for c in prev] == [ET.tostring(c) for c in node], "Selector old children changed")
                selector_count += 1
            else: require(former == actual, "Unrelated original cell changed")
            if node.find("f") is not None:
                require(node.find("v") is None, "Formula cache present")
                original_formulas += 1
            cells += 1
        if sheet["name"] == book["sheet"]:
            require(without(without(before,"c"),"dataValidations") == without(without(after,"c"),"dataValidations"), "Spellbook surroundings/merge/protection changed")
        else: require(without(before,"c") == without(after,"c"), "Other sheet surroundings changed")
    unlocked = sum(clone_uses[d["symbol"]] for d in select["styleClones"] if d.get("purpose") != "label-fit")
    label_fit = sum(clone_uses[d["symbol"]] for d in select["styleClones"] if d.get("purpose") == "label-fit")
    require(rewritten == 1002 and selector_count == len(selectors) and unlocked == 64 and label_fit == (1 if version == "2024" else 0) and set(clone_uses) == set(allocations["styles"]), "Edit totals/clone usage differs")
    # Style append: old entries raw-identical, only parent count and appended xfs.
    old_xfs = spans(old.parts[STYLES],"cellXfs")[0]
    new_xfs = spans(new.parts[STYLES],"cellXfs")[0]
    former_xf = spans(old_xfs[1],"xf"); actual_xf = spans(new_xfs[1],"xf")
    require(len(actual_xf) == len(former_xf) + len(select["styleClones"]) and int(ET.fromstring(new_xfs[1]).get("count")) == len(actual_xf), "Style count differs")
    require([x[1] for x in former_xf] == [x[1] for x in actual_xf[:len(former_xf)]], "Old xf changed")
    restored_xfs = new_xfs[1]
    for _, body, begin, finish in reversed(actual_xf[len(former_xf):]):
        require(restored_xfs[begin:finish] == body, "Appended xf boundary differs")
        restored_xfs = restored_xfs[:begin] + restored_xfs[finish:]
    restored_xfs = set_attrs(restored_xfs,"cellXfs",{"count":len(former_xf)})
    require(restored_xfs == old_xfs[1], "Style parent/surrounding bytes changed")
    require(old.parts[STYLES][:old_xfs[2]] == new.parts[STYLES][:new_xfs[2]] and old.parts[STYLES][old_xfs[3]:] == new.parts[STYLES][new_xfs[3]:], "Unrelated style container changed")
    for index, definition in enumerate(select["styleClones"],len(former_xf)):
        require(allocations["styles"][definition["symbol"]] == index, "Style index collision")
        before, after = ET.fromstring(definition["oldXML"]), ET.fromstring(actual_xf[index][1])
        require(after.attrib == {**before.attrib,**definition["setAttributes"]}, "Clone attributes changed")
        if definition.get("purpose") == "label-fit":
            require(definition.get("preserveProtection") is True and "protection" not in definition, "Label style must retain protection")
            a,b = before.find("alignment"),after.find("alignment")
            require(a is not None and b is not None and b.attrib == {**a.attrib,**definition["alignmentSetAttributes"]} and len(a) == len(b) == 0, "Label alignment differs")
            require([ET.tostring(c) for c in before if c.tag != "alignment"] == [ET.tostring(c) for c in after if c.tag != "alignment"], "Label font/border/protection changed")
            continue
        prev_protect = before.find("protection")
        protect = after.find("protection")
        require(protect is not None and protect.attrib == {**({} if prev_protect is None else prev_protect.attrib),**definition["protection"]}, "Clone protection changed")
        require([ET.tostring(c) for c in before if c.tag != "protection"] == [ET.tostring(c) for c in after if c.tag != "protection"], "Clone font/alignment/border changed")
    # Original DV properties/coverage preserved except planned text and formula.
    old_dv = spans(old.parts[book["part"]],"dataValidation")
    new_dv = spans(new.parts[book["part"]],"dataValidation")
    replacements = [d for d in book["validationEdits"] if d["operation"] == "replace"]
    added = [d for d in book["validationEdits"] if d["operation"] == "add"]
    require(len(replacements) == 1 and len(added) == 1 and len(new_dv) == len(old_dv)+1, "DV total differs")
    replaced = replacements[0]
    expected_attrs = {**ET.fromstring(replaced["oldXML"]).attrib,**replaced["setAttributes"]}
    target_dv = [ET.fromstring(body) for attrs,body,_,_ in new_dv if attrs.get("sqref") == replaced["sqref"]]
    require(len(target_dv) == 1 and target_dv[0].attrib == expected_attrs and len(target_dv[0]) == 1 and target_dv[0].findtext("formula1") == replaced["formula1"], "Existing DV behavior/coverage differs")
    new_input = [ET.fromstring(body) for attrs,body,_,_ in new_dv if attrs.get("sqref") == "C3"]
    require(len(new_input) == 1 and new_input[0].attrib == added[0]["attributes"] and len(new_input[0]) == 1 and new_input[0].findtext("formula1") == added[0]["formula1"], "C3 DV differs")
    parent_attrs = ET.fromstring(spans(new.parts[book["part"]],"dataValidations")[0][1]).attrib
    old_attrs = ET.fromstring(spans(old.parts[book["part"]],"dataValidations")[0][1]).attrib
    require(parent_attrs == {**old_attrs,"count":str(len(new_dv))}, "DV parent attributes differ")
    # Strip only approved registration additions to reconstruct original bytes.
    for part, tag, key, values in ((p.WORKBOOK,"sheet","name",{a["name"] for a in additions}),
                                   (p.RELS,"Relationship","Id",{a["rId"] for a in additions}),
                                   (p.CONTENT,"Override","PartName",{"/"+a["part"] for a in additions})):
        restored = new.parts[part]
        children = [body for attrs,body,_,_ in spans(restored,tag) if attrs.get(key) in values]
        require(len(children) == 2, "Registration additions not exact")
        for child in children: restored = restored.replace(child,b"",1)
        if part == p.WORKBOOK:
            definitions = [(attrs,body) for attrs,body,_,_ in spans(restored,"definedName") if attrs.get("name") == select["definedName"]["name"]]
            require(len(definitions) == 1 and definitions[0][0] == {"name":select["definedName"]["name"],"hidden":"1"} and ET.fromstring(definitions[0][1]).text == select["definedName"]["formula"], "Defined name differs")
            restored = restored.replace(definitions[0][1],b"",1)
        require(restored == old.parts[part], "Unrelated registration metadata changed")
    app = old.parts[p.APP]; names = [s["name"] for s in old.sheets]
    for a in additions:
        app = p.append_app_sheet(app,names,a["name"]); names.append(a["name"])
    require(new.parts[p.APP] == app, "App sheet titles differ")
    formula_inventory = []
    for allocation, definitions in ((allocations["map"],map_cells(look,select)),(allocations["selection"],select["helperSheet"]["cells"])):
        root = ET.fromstring(new.parts[allocation["part"]])
        require(root.tag == q("worksheet") and not root.attrib and [c.tag for c in root] == [q(t) for t in ("dimension","sheetViews","sheetFormatPr","sheetData")], "New sheet structure differs")
        rows = list(root.find(q("sheetData")))
        require(all(row.tag == q("row") and row.attrib == {"r":str(int(row.get("r")))} and all(c.tag == q("c") and m.coordinate(c.get("r"))[1] == int(row.get("r")) for c in row) for row in rows), "New sheet row attributes/cells differ")
        require([int(r.get("r")) for r in rows] == sorted({int(r.get("r")) for r in rows}), "New sheet row order/uniqueness differs")
        found = {c.get("r"):c for c in root.iter(q("c"))}; expected = {d["cell"]:d for d in definitions}
        require(len(found) == len(list(root.iter(q("c")))) and found.keys() == expected.keys(), "New sheet cell inventory differs")
        for address, definition in expected.items():
            node = found[address]
            if "formula" in definition:
                f = node.find(q("f"))
                require(node.attrib == {"r":address} and len(node) == 1 and f is not None and f.text == definition["formula"] and not f.attrib, "New sheet formula/cache differs")
                formula_inventory.append((allocation["name"],definition["formula"]))
            elif definition["value"] is None: require(node.attrib == {"r":address} and len(node) == 0, "Map blank differs")
            elif definition["type"] == "n": require(node.attrib == {"r":address,"t":"n"} and len(node) == 1 and node.findtext(q("v")) == str(definition["value"]), "Map row constant differs")
            else: require(node.attrib == {"r":address,"t":"inlineStr"} and len(node) == 1 and ''.join(t.text or '' for t in node.iter(q("t"))) == definition["value"] and node.find(q("f")) is None, "Map text differs")
    formula_inventory += [(c["sheet"],c["candidateFormula"]) for c in look["consumers"] if c["status"] == "planned"]
    existing_sheets = {s["name"] for s in new.sheets}
    refs = 0
    for context, formula in formula_inventory:
        require(len(formula.encode("utf-16-le"))//2 <= 8192, "Formula too long")
        for token in m.Tokenizer("="+formula).items:
            if token.type != "OPERAND" or token.subtype != "RANGE": continue
            ref = token.value; sheet = context
            if "!" in ref:
                sheet,ref = ref.rsplit("!",1)
                sheet = sheet[1:-1].replace("''", "'") if sheet.startswith("'") else sheet
            require(sheet in existing_sheets, "New formula references missing sheet")
            for endpoint in ref.split(":"):
                if re.fullmatch(r"\$?[A-Z]+",endpoint): endpoint += "1"
                m.coordinate(endpoint)
            refs += 1
    return {"version":version,"outputSha256":sha(candidate),"seedSha256":sha(seed),"originalCellsCompared":cells,
            "lookupFormulaEdits":rewritten,"selectionCellEdits":selector_count,"unlockedExistingCells":unlocked,"labelFitCells":label_fit,
            "appendedStyles":len(select["styleClones"]),"totalStyles":len(actual_xf),"remainingOriginalFormulaCellsNoCache":original_formulas,
            "newSheetFormulaCount":len(formula_inventory)-rewritten,"generatedFormulaReferencesChecked":refs,
            "oldExternalCacheBytesRetained":True,"oldMetadataPartRetained":True,"nativeCalculated":False,"uploadReady":False}


def run(directory=None):
    shield, lookup = m.load_tools(); selection = load_selection(lookup)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = allowed_output(directory if directory is not None else BASE/("spell-candidate-"+stamp))
    output.mkdir(parents=True,exist_ok=False)
    scratch = shield.p.BASE/("shield-candidate-spell-integrated-"+stamp)
    seed_reports = shield.run(scratch)
    reports = {}
    for version, report in seed_reports.items():
        filename, digest = lookup.identity.SOURCES[version]
        source_path = m.REPO/"public"/filename
        source = source_path.read_bytes(); require(sha(source) == digest,"Source changed")
        seed = Path(report["output"]).read_bytes()
        look = lookup.build_plan(version,source_path); select = selection.build_plan(version,source_path)
        raw, allocations = apply(shield,version,source,seed,look,select)
        checked = verify(shield,version,seed,raw,look,select,allocations)
        require(look == lookup.build_plan(version,source_path) and select == selection.build_plan(version,source_path) and source_path.read_bytes() == source,"Source/plan changed before writing")
        for filename in m.PINS: m.pinned_bytes(filename)
        require(sha(SELECTION_FILE.read_bytes().replace(b"\r\n",b"\n")) == SELECTION_SHA,"Selection tool changed before writing")
        target = output/f"{version}-SPELL-SELECTION-NO-CACHE-NOT-FOR-UPLOAD.xlsx"
        for path, content in ((target,raw),(output/f"{version}-seed-shield-NOT-FOR-UPLOAD.xlsx",seed)):
            with path.open("xb") as stream: stream.write(content)
            require(path.read_bytes() == content,"Written bytes differ")
        for suffix, obj in (("lookup-plan",look),("selection-plan",select)):
            with (output/f"{version}-{suffix}.json").open("x",encoding="utf8") as stream: stream.write(json.dumps(obj,ensure_ascii=False,indent=2)+"\n")
        reports[version] = {**checked,"output":str(target),"source":look["source"],"allocations":allocations,"lookupPlanSha256":sha(lookup.canonical(look)),"selectionPlanSha256":sha(lookup.canonical(select))}
    with (output/"report.json").open("x",encoding="utf8") as stream: stream.write(json.dumps(reports,ensure_ascii=False,indent=2)+"\n")
    return {"output":str(output),"seedScratch":str(scratch),"versions":reports,"nativeCalculated":False,"uploadReady":False}



def allowed_output(directory):
    target = Path(directory).resolve()
    root = BASE.resolve()
    if target == root or root not in target.parents:
        raise ValueError("Output must be an exclusive child directory of " + str(root))
    if not target.name.startswith("spell-candidate-"):
        raise ValueError("Output directory name must start with spell-candidate-")
    return target


def main():
    parser = argparse.ArgumentParser(description="Generate pinned engineering spell workbook copies; native calculation and upload are not enabled.")
    parser.add_argument("--repo", help="Repository containing the published tools and two pinned originals")
    parser.add_argument("--output", type=Path, help="New spell-candidate directory beneath the repository's sibling _audit/xlsx-spell-package")
    args = parser.parse_args()
    print(json.dumps(run(args.output),ensure_ascii=False))


if __name__ == "__main__": main()
