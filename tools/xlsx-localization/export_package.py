"""Build preserved AV1 engineering copies. No workbook library saves or native calculation.

All writes stay below the sibling _audit/xlsx-export-package directory. The only generator accepted is
the reviewed SHA below. External plans are never accepted on their own: the plan
is structurally checked, then compared with a fresh deterministic generation.
"""
from __future__ import annotations

import argparse
from collections import deque
from copy import copy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import posixpath
import re
import sys
import types
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
import zipfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BASE = REPO.parent / "_audit" / "xlsx-export-package"
GENERATOR = HERE / "export_formula.py"
GENERATOR_SHA = "1f64dc873e1c748857f3aa908ff449d6038d66d90af96609cfcf40afcf84c2a2"
SOURCES = {
    "2014": ("DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx", "94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6"),
    "2024": ("DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx", "264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04"),
}
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PNS = "http://schemas.openxmlformats.org/package/2006/relationships"
CNS = "http://schemas.openxmlformats.org/package/2006/content-types"
APPNS = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
VTNS = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
WORKBOOK = "xl/workbook.xml"
RELS = "xl/_rels/workbook.xml.rels"
CONTENT = "[Content_Types].xml"
APP = "docProps/app.xml"
WORKSHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
CHAIN_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
MAX_PLAN_BYTES = 16 * 1024 * 1024
MAX_HELPERS = 4096
MAX_FORMULA_BYTES = 8 * 1024 * 1024
CELL = re.compile(rb'<c\b[^>]*\br="([^"]+)"[^>]*?(?:/>|>.*?</c>)', re.S)
FORMULA = re.compile(rb"<f\b[^>]*>.*?</f>", re.S)
VALUE = re.compile(rb"<v\b[^>]*>.*?</v>", re.S)


class Rejected(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Rejected(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def q(name):
    return "{" + NS + "}" + name


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def allowed_path(path):
    path = Path(path).resolve()
    require(path.is_relative_to(BASE), "Output is outside the audit directory")
    return path


def write_new(path, data):
    path = allowed_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as target:
        target.write(data)


def json_new(path, value):
    write_new(path, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")


def generator_bytes(path=GENERATOR):
    # Git checkouts can use either LF or CRLF; bind the actual compiled text.
    raw = Path(path).read_bytes().replace(b"\r\n", b"\n")
    require(sha(raw) == GENERATOR_SHA, "Reviewed formula generator changed")
    return raw


def load_generator():
    # Compile the exact bytes checked above, not a second, potentially changed read.
    raw = generator_bytes()
    module = types.ModuleType("audited_export_formula")
    module.__file__ = str(GENERATOR)
    sys.modules[module.__name__] = module
    exec(compile(raw, str(GENERATOR), "exec"), module.__dict__)
    return module


g = load_generator()


def xml(raw, name):
    require(b"<!DOCTYPE" not in raw.upper() and b"<!ENTITY" not in raw.upper(), f"DTD/entity is unsupported: {name}")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as error:
        raise Rejected(f"Invalid XML: {name}") from error


def safe_part(name):
    require(isinstance(name, str) and name and "\\" not in name and not name.startswith("/"), "Unsafe ZIP part name")
    trimmed = name[:-1] if name.endswith("/") else name
    require(trimmed and posixpath.normpath(trimmed) == trimmed and not trimmed.startswith("../"), "Unsafe ZIP part path")
    require(not any(ord(c) < 32 for c in name), "Control character in ZIP part")
    return name


def target_part(rel_part, target):
    require(isinstance(target, str) and target and "\\" not in target, "Invalid relationship target")
    parsed = urlsplit(target)
    require(not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment, "Nonlocal internal relationship")
    target = unquote(parsed.path)
    if target.startswith("/"):
        resolved = target[1:]
    else:
        base = "" if rel_part == "_rels/.rels" else posixpath.dirname(posixpath.dirname(rel_part))
        resolved = posixpath.normpath(posixpath.join(base, target))
    return safe_part(resolved)


@dataclass
class Package:
    parts: dict
    infos: list
    comment: bytes
    sheets: list
    main_part: str
    chains: list
    relationships: list
    names: set


def read_package(raw):
    require(len(raw) <= MAX_PACKAGE_BYTES, "ZIP file exceeds prototype byte budget")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise Rejected("Invalid ZIP workbook") from error
    with archive:
        infos = archive.infolist()
        require(0 < len(infos) <= 512, "Package part count exceeds prototype budget")
        names = [safe_part(info.filename) for info in infos]
        require(len(names) == len(set(names)), "Duplicate ZIP part")
        require(len(names) == len({name.casefold() for name in names}), "Case-ambiguous ZIP part")
        require(sum(info.file_size for info in infos) <= MAX_PACKAGE_BYTES, "Expanded package exceeds budget")
        require(not any(info.flag_bits & 1 for info in infos), "Encrypted ZIP entries are unsupported")
        require(all(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) for info in infos), "Unsupported ZIP compression")
        require(not any("_xmlsignatures/" in name.lower() for name in names), "Signed OOXML cannot be edited without invalidating its signature")
        parts = {name: archive.read(name) for name in names}
        comment = archive.comment
    require({WORKBOOK, RELS, CONTENT} <= parts.keys(), "Missing workbook/relationship/content-type part")
    workbook = xml(parts[WORKBOOK], WORKBOOK)
    require(workbook.tag == q("workbook"), "Unsupported workbook namespace")
    require(parts[WORKBOOK].count(b"</sheets>") == 1, "Unsupported sheets XML representation")
    all_relationships = []
    for name, body in parts.items():
        if not name.endswith(".rels"):
            continue
        root = xml(body, name)
        require(root.tag == "{" + PNS + "}Relationships", "Unsupported relationship namespace")
        ids = []
        for relation in root:
            require(relation.tag == "{" + PNS + "}Relationship", "Unknown relationship element")
            rid = relation.get("Id")
            require(isinstance(rid, str) and rid, "Missing relationship ID")
            ids.append(rid)
            external = relation.get("TargetMode") == "External"
            resolved = None if external else target_part(name, relation.get("Target"))
            if resolved is not None:
                require(resolved in parts, f"Dangling internal relationship: {name} -> {resolved}")
            all_relationships.append({"part": name, "attributes": dict(relation.attrib), "resolved": resolved})
        require(len(ids) == len(set(ids)), f"Duplicate relationship ID: {name}")
    book_rels = {r["attributes"]["Id"]: r for r in all_relationships if r["part"] == RELS}
    sheet_parent = workbook.findall(q("sheets"))
    require(len(sheet_parent) == 1, "Missing/duplicate sheets element")
    sheets = []
    for element in sheet_parent[0]:
        require(element.tag == q("sheet"), "Unexpected sheets child")
        rid = element.get("{" + RNS + "}id")
        relation = book_rels.get(rid)
        require(relation is not None and relation["attributes"].get("Type") == RNS + "/worksheet", "Missing/invalid worksheet relationship")
        require(relation["resolved"] and relation["resolved"].startswith("xl/worksheets/"), "External/unsafe worksheet")
        sheet_id = element.get("sheetId", "")
        require(sheet_id.isascii() and sheet_id.isdigit() and 0 < int(sheet_id) <= 2147483647, "Invalid sheetId")
        sheets.append({"name": element.get("name"), "sheetId": int(sheet_id), "rId": rid,
                       "state": element.get("state", "visible"), "part": relation["resolved"], "attributes": dict(element.attrib)})
    require(len({s["sheetId"] for s in sheets}) == len(sheets), "Duplicate sheetId")
    require(all(isinstance(s["name"], str) for s in sheets), "Missing sheet name")
    require(len({s["name"].casefold() for s in sheets}) == len(sheets), "Duplicate sheet name")
    require(len({s["part"] for s in sheets}) == len(sheets), "Two sheet entries share one worksheet")
    mains = [s for s in sheets if s["name"] in ("主要", "Main")]
    require(len(mains) == 1, "Require one identifiable main worksheet")
    types_root = xml(parts[CONTENT], CONTENT)
    require(types_root.tag == "{" + CNS + "}Types", "Unsupported ContentTypes namespace")
    overrides = [c for c in types_root if c.tag == "{" + CNS + "}Override"]
    override_names = [c.get("PartName") for c in overrides]
    require(len(override_names) == len(set(override_names)), "Duplicate content-type override")
    chain_rels = [r for r in all_relationships if r["attributes"].get("Type") == RNS + "/calcChain"]
    chain_types = [c for c in overrides if c.get("ContentType") == CHAIN_TYPE]
    named_chains = [name for name in names if name.lower().endswith("/calcchain.xml")]
    require(len(chain_rels) <= 1 and len(chain_types) <= 1, "Multiple calculation chains")
    chains = []
    if chain_rels or chain_types or named_chains:
        require(len(chain_rels) == len(chain_types) == 1, "Orphaned/ambiguous calculation chain")
        relation = chain_rels[0]
        part = relation["resolved"]
        require(relation["part"] == RELS and part and chain_types[0].get("PartName") == "/" + part, "Invalid calculation-chain relationship")
        require(not named_chains or set(named_chains) == {part}, "Orphaned/ambiguous conventionally named calculation-chain parts")
        require(xml(parts[part], part).tag == q("calcChain"), "Invalid calculation-chain root")
        require(sum(r["resolved"] == part for r in all_relationships) == 1, "Calculation chain has unexpected inbound relationships")
        chain_rels_part = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
        require(chain_rels_part not in parts, "Calculation chain with child relationships is unsupported")
        chains = [{"part": part, "rId": relation["attributes"]["Id"]}]
    return Package(parts, infos, comment, sheets, mains[0]["part"], chains, all_relationships, set(names))


def cells_of(body):
    root = xml(body, "worksheet")
    require(root.tag == q("worksheet"), "Unsupported worksheet namespace")
    parsed = list(root.iter(q("c")))
    raw = {}
    for match in CELL.finditer(body):
        ref = match[1].decode("ascii")
        _, normalized = g.reference(ref, "sheet")
        require(ref == normalized and ref not in raw, "Duplicate/noncanonical source cell address")
        raw[ref] = match.group()
    require(len(parsed) == len(raw) and {c.get("r") for c in parsed} == raw.keys(), "Unsupported source cell XML representation")
    return raw


def choose_ids(package):
    names = {s["name"].casefold() for s in package.sheets}
    export = "Export"
    suffix = 2
    while export.casefold() in names:
        export = f"Export_{suffix}"
        suffix += 1
    sheet_id = max(s["sheetId"] for s in package.sheets) + 1
    require(sheet_id <= 2147483647, "No supported fresh sheetId")
    used = {r["attributes"]["Id"].casefold() for r in package.relationships if r["part"] == RELS}
    number = 1
    while f"rid{number}" in used:
        number += 1
    rid = f"rId{number}"
    lower_parts = {p.casefold() for p in package.parts}
    number = 1
    while f"xl/worksheets/sheet{number}.xml".casefold() in lower_parts:
        number += 1
    return {"name": export, "sheetId": sheet_id, "rId": rid, "part": f"xl/worksheets/sheet{number}.xml"}


def generated_plan(snapshot, export_name):
    plan = g.make_plan(snapshot["formula"], main_sheet=snapshot["main_sheet"], sheet_names=snapshot["sheet_names"], export_sheet=export_name)
    plan["source_workbook_sha256"] = snapshot["sha256"]
    plan["source_av1_part"] = snapshot["av1_part"]
    plan["reference_model_baseline_equals_existing_json"] = True
    return plan


def validate_plan(plan, snapshot, expected):
    require(type(plan) is dict and type(plan.get("add_sheet")) is dict, "Malformed plan")
    require(plan.get("rename_prerequisites") == {}, "Sheet renaming is outside this prototype")
    require(plan["add_sheet"].get("state") == "hidden" and plan["add_sheet"].get("position") == "append", "Invalid helper-sheet placement")
    rows = plan["add_sheet"].get("cells")
    require(type(rows) is list and 0 < len(rows) <= MAX_HELPERS, "Helper count exceeds budget")
    export = plan["add_sheet"].get("name")
    require(isinstance(export, str), "Missing helper-sheet name")
    formulas = {}
    bytes_used = 0
    for row in rows:
        require(type(row) is dict and type(row.get("cell")) is str, "Invalid helper record")
        sheet, cell = g.reference(row["cell"], export)
        require(sheet == export and cell == row["cell"], "Illegal/noncanonical helper cell")
        require((sheet, cell) not in formulas, "Duplicate helper cell")
        formulas[sheet, cell] = row.get("formula")
    dest = plan.get("replace_cell")
    require(type(dest) is dict and dest.get("sheet") == snapshot["main_sheet"] and dest.get("cell") == "AV1", "Only main AV1 may be replaced")
    formulas[snapshot["main_sheet"], "AV1"] = dest.get("formula")
    source_refs = {g.reference(node.value, snapshot["main_sheet"]) for node in g.walk(g.Formula(snapshot["formula"]).tree) if node.op == "ref"}
    edges = {}
    allowed_functions = {"IF", "ISNUMBER", "TEXTJOIN", "_xlfn.TEXTJOIN", "SUBSTITUTE", "CHAR", "LEN", "SUM"}
    for key, formula in formulas.items():
        require(type(formula) is str and formula.startswith("="), "Missing helper formula")
        g.valid_text(formula)
        require(g.utf16len(formula) <= g.MAX_FORMULA, "New formula exceeds UTF-16 budget")
        bytes_used += len(formula.encode("utf-16-le"))
        require(bytes_used <= MAX_FORMULA_BYTES, "Total new-formula byte budget exceeded")
        tree = g.Formula(formula).tree
        dependencies = set()
        for node in g.walk(tree):
            if node.op == "fn":
                require(node.value in allowed_functions and len(node.args) <= 255, "Unsupported/over-budget formula function")
            if node.op != "ref":
                continue
            ref = g.reference(node.value, key[0])
            if ref in formulas:
                dependencies.add(ref)
            else:
                require(ref[0] != export, f"Missing helper dependency: {ref}")
                require(ref in source_refs, f"Unapproved/external source reference: {ref}")
        edges[key] = dependencies
    counts = {key: len(deps) for key, deps in edges.items()}
    followers = {key: [] for key in formulas}
    for key, deps in edges.items():
        for dep in deps:
            followers[dep].append(key)
    pending = deque(key for key, count in counts.items() if count == 0)
    visited = 0
    while pending:
        key = pending.popleft()
        visited += 1
        for child in followers[key]:
            counts[child] -= 1
            if counts[child] == 0:
                pending.append(child)
    require(visited == len(formulas), "Cycle in helper/AV1 dependency graph")
    require(canonical(plan) == canonical(expected), "Plan differs from fresh reviewed-generator output")
    model = g.evaluate(g.Formula(snapshot["formula"]).tree, snapshot["values"], snapshot["main_sheet"])
    result = g.evaluate_plan(plan, snapshot["values"])
    require(model == result and json.loads(result) == snapshot["cached_json"], "Exact baseline reference-model/cache mismatch")
    return {"helpers": len(rows), "graph_nodes": len(formulas), "graph_edges": sum(map(len, edges.values())),
            "new_formula_utf16_bytes": bytes_used, "max_formula_utf16_units": max(g.utf16len(f) for f in formulas.values()),
            "av1_utf16_units": g.utf16len(dest["formula"]), "baseline_output": result}


def strict_json(raw):
    require(len(raw) <= MAX_PLAN_BYTES, "Plan file exceeds byte budget")
    def pairs(entries):
        result = {}
        for key, value in entries:
            require(key not in result, "Duplicate JSON object key")
            result[key] = value
        return result
    return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(Rejected("Nonfinite JSON number")))


@dataclass
class Prepared:
    source: Path
    source_sha: str
    raw: bytes
    snapshot_file: Path
    snapshot: dict
    package: Package
    allocation: dict
    plan_file: Path
    plan_sha: str


def prepare(source, expected_hash, directory):
    source = Path(source).resolve()
    raw = source.read_bytes()
    require(sha(raw) == expected_hash, "Source workbook changed before planning")
    package = read_package(raw)
    allocation = choose_ids(package)
    directory = allowed_path(directory)
    # The generator reads this byte-identical snapshot, not a mutable source path.
    frozen = directory / "source-package.bin"
    write_new(frozen, raw)
    snapshot = g.read_original(frozen)
    require(snapshot["sha256"] == expected_hash and frozen.read_bytes() == raw, "Snapshot changed while being read")
    plan = generated_plan(snapshot, allocation["name"])
    validate_plan(plan, snapshot, plan)
    plan_file = directory / "formula-plan.json"
    json_new(plan_file, plan)
    generator_bytes()
    require(sha(source.read_bytes()) == expected_hash, "Source workbook changed during planning")
    return Prepared(source, expected_hash, raw, frozen, snapshot, package, allocation, plan_file, sha(plan_file.read_bytes()))


def current_plan(prepared):
    generator_bytes()
    require(sha(prepared.source.read_bytes()) == prepared.source_sha, "Source workbook changed after planning")
    require(prepared.snapshot_file.read_bytes() == prepared.raw, "Input snapshot changed after planning")
    plan_raw = prepared.plan_file.read_bytes()
    require(sha(plan_raw) == prepared.plan_sha, "Plan file changed after planning")
    plan = strict_json(plan_raw)
    expected = generated_plan(prepared.snapshot, prepared.allocation["name"])
    stats = validate_plan(plan, prepared.snapshot, expected)
    return plan, stats


def splice_once(raw, closing, addition):
    require(raw.count(closing) == 1, "Ambiguous XML insertion point")
    return raw.replace(closing, addition + closing, 1)


def self_closing_elements(raw, tag, namespace):
    matches = list(re.finditer(rb"<" + tag.encode() + rb"\b[^>]*/>", raw))
    root = xml(raw, tag)
    require(len(matches) == sum(c.tag == "{" + namespace + "}" + tag for c in root), f"Unsupported {tag} XML representation")
    return matches


def remove_exact_element(raw, tag, namespace, attribute, value):
    found = []
    for match in self_closing_elements(raw, tag, namespace):
        element = ET.fromstring(b'<root xmlns="' + namespace.encode() + b'">' + match.group() + b"</root>")[0]
        if element.get(attribute) == value:
            found.append(match)
    require(len(found) == 1, f"Missing/duplicate {tag} for removal")
    match = found[0]
    return raw[:match.start()] + raw[match.end():]


def calc_properties(raw):
    matches = list(re.finditer(rb"<calcPr\b[^>]*/>", raw))
    parsed = xml(raw, WORKBOOK).findall(q("calcPr"))
    require(len(matches) == len(parsed) <= 1, "Unsupported calculation properties XML")
    changes = {"fullCalcOnLoad": "1", "calcOnSave": "1", "calcCompleted": "0"}
    if matches:
        match = matches[0]
        node = match.group()
        for key, value in changes.items():
            attr = re.compile(rb"\b" + key.encode() + rb'="[^"]*"')
            if attr.search(node):
                node = attr.sub(f'{key}="{value}"'.encode(), node)
            else:
                node = node[:-2] + f' {key}="{value}"/>'.encode()
        return raw[:match.start()] + node + raw[match.end():]
    node = b'<calcPr fullCalcOnLoad="1" calcOnSave="1" calcCompleted="0"/>'
    following = re.search(rb"<(?:oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b", raw)
    if following:
        return raw[:following.start()] + node + raw[following.start():]
    return splice_once(raw, b"</workbook>", node)


def append_app_sheet(raw, old_names, new_name):
    # Both actual originals contain exactly one worksheet heading vector.
    root = xml(raw, APP)
    appq = lambda name: "{" + APPNS + "}" + name
    vtq = lambda name: "{" + VTNS + "}" + name
    heading = root.find(appq("HeadingPairs"))
    titles = root.find(appq("TitlesOfParts"))
    require(heading is not None and titles is not None, "Unsupported application sheet inventory")
    hv = heading.find(vtq("vector"))
    tv = titles.find(vtq("vector"))
    require(hv is not None and len(hv) == 2 and hv.get("size") == "2", "Ambiguous application heading groups")
    require(hv[0].find(vtq("lpstr")) is not None and hv[0][0].text in ("工作表", "Worksheets"), "Not a worksheet heading group")
    count = hv[1].find(vtq("i4"))
    require(count is not None and count.text == str(len(old_names)), "Application sheet count is inconsistent")
    require(tv is not None and tv.get("size") == str(len(old_names)) and [x.text for x in tv] == old_names, "Application sheet titles are inconsistent")
    heading_raw = re.search(rb"<HeadingPairs>.*?</HeadingPairs>", raw, re.S)
    titles_raw = re.search(rb"<TitlesOfParts>.*?</TitlesOfParts>", raw, re.S)
    require(heading_raw and titles_raw, "Unsupported application properties XML")
    old_count = f"<vt:i4>{len(old_names)}</vt:i4>".encode()
    require(heading_raw.group().count(old_count) == 1, "Ambiguous application sheet count")
    new_heading = heading_raw.group().replace(old_count, f"<vt:i4>{len(old_names)+1}</vt:i4>".encode())
    new_titles = titles_raw.group()
    old_size = f'size="{len(old_names)}"'.encode()
    require(new_titles.count(old_size) == 1, "Ambiguous title vector size")
    new_titles = new_titles.replace(old_size, f'size="{len(old_names)+1}"'.encode(), 1)
    new_titles = splice_once(new_titles, b"</vt:vector>", b"<vt:lpstr>" + escape(new_name).encode() + b"</vt:lpstr>")
    return raw.replace(heading_raw.group(), new_heading, 1).replace(titles_raw.group(), new_titles, 1)


def worksheet_xml(plan):
    rows = plan["add_sheet"]["cells"]
    # Only generated formula cells are authored. No <v>, shared-string additions,
    # new styles, authorship notes, or invented formula results are introduced.
    body = []
    for row in rows:
        ref = row["cell"]
        row_number = re.search(r"[0-9]+$", ref)[0]
        body.append(f'<row r="{row_number}"><c r="{ref}"><f>{escape(row["formula"][1:])}</f></c></row>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<worksheet xmlns="{NS}"><dimension ref="A1:A{len(rows)}"/>'
            '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
            '<sheetFormatPr defaultRowHeight="15"/><sheetData>' + "".join(body) + "</sheetData></worksheet>").encode()


def patch_parts(prepared, plan, stats):
    package = prepared.package
    old = package.parts
    updated = dict(old)
    allocation = prepared.allocation
    main = package.main_part
    raw_cells = cells_of(old[main])
    require("AV1" in raw_cells, "Missing AV1")
    av1 = raw_cells["AV1"]
    parsed = xml(b'<worksheet xmlns="' + NS.encode() + b'">' + av1 + b"</worksheet>", "AV1")[0]
    fs = parsed.findall(q("f"))
    vs = parsed.findall(q("v"))
    require(len(fs) == len(vs) == 1 and not fs[0].attrib and parsed.get("t") == "str", "Unsupported AV1 formula/cache representation")
    require(vs[0].text == stats["baseline_output"], "AV1 raw cache differs from the exact planned baseline")
    replacements = list(FORMULA.finditer(av1))
    require(len(replacements) == 1 and replacements[0].group().startswith(b"<f>"), "Unsupported AV1 formula XML")
    new_f = b"<f>" + escape(plan["replace_cell"]["formula"][1:]).encode("utf-8") + b"</f>"
    new_av1 = FORMULA.sub(lambda _: new_f, av1, count=1)
    require(old[main].count(av1) == 1, "Ambiguous AV1 source bytes")
    updated[main] = old[main].replace(av1, new_av1, 1)
    sheet_entry = (f'<sheet name="{escape(allocation["name"], {chr(34): "&quot;"})}" sheetId="{allocation["sheetId"]}"'
                   f' state="hidden" r:id="{allocation["rId"]}"/>').encode()
    updated[WORKBOOK] = calc_properties(splice_once(old[WORKBOOK], b"</sheets>", sheet_entry))
    new_relation = (f'<Relationship Id="{allocation["rId"]}" Type="{RNS}/worksheet"'
                    f' Target="{allocation["part"].removeprefix("xl/")}"/>').encode()
    rels = old[RELS]
    content = old[CONTENT]
    for chain in package.chains:
        rels = remove_exact_element(rels, "Relationship", PNS, "Id", chain["rId"])
        content = remove_exact_element(content, "Override", CNS, "PartName", "/" + chain["part"])
        del updated[chain["part"]]
    updated[RELS] = splice_once(rels, b"</Relationships>", new_relation)
    override = f'<Override PartName="/{allocation["part"]}" ContentType="{WORKSHEET_TYPE}"/>'.encode()
    updated[CONTENT] = splice_once(content, b"</Types>", override)
    if APP in old:
        updated[APP] = append_app_sheet(old[APP], [s["name"] for s in package.sheets], allocation["name"])
    require(allocation["part"].casefold() not in {name.casefold() for name in updated}, "Allocated worksheet path collides")
    updated[allocation["part"]] = worksheet_xml(plan)
    return updated


def zip_bytes(package, parts, new_part):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.comment = package.comment
        for info in package.infos:
            if info.filename in parts:
                archive.writestr(copy(info), parts[info.filename])
        reference = next(info for info in package.infos if info.filename == package.main_part)
        extra = zipfile.ZipInfo(new_part, reference.date_time)
        extra.compress_type = zipfile.ZIP_DEFLATED
        extra.create_system = reference.create_system
        extra.external_attr = reference.external_attr
        archive.writestr(extra, parts[new_part])
    return output.getvalue()


def verify(prepared, candidate_raw, plan, stats):
    old = prepared.package
    candidate = read_package(candidate_raw)
    allocation = prepared.allocation
    expected = patch_parts(prepared, plan, stats)
    require(candidate.parts == expected, "Written package differs from exact byte-change whitelist")
    removed = {x["part"] for x in old.chains}
    changed = {WORKBOOK, RELS, CONTENT, old.main_part} | ({APP} if APP in old.parts else set())
    require(candidate.names == (old.names - removed) | {allocation["part"]}, "Unexpected package additions/removals")
    require(candidate.sheets[:-1] == old.sheets, "Original sheet names/IDs/relationships/hidden state changed")
    require(candidate.sheets[-1]["name"] == allocation["name"] and candidate.sheets[-1]["state"] == "hidden"
            and candidate.sheets[-1]["part"] == allocation["part"], "New sheet was not appended hidden")
    require(not candidate.chains, "Stale calculation chain remains")
    preserved_cells = 0
    original_formulas = 0
    original_cached_errors = 0
    sheet_counts = []
    for sheet in old.sheets:
        before = cells_of(old.parts[sheet["part"]])
        after = cells_of(candidate.parts[sheet["part"]])
        require(before.keys() == after.keys(), "Original worksheet cell set changed")
        for ref, raw in before.items():
            original_formulas += bool(FORMULA.search(raw) or b"<f " in raw)
            original_cached_errors += bool(re.search(rb'\bt="e"', raw))
            if sheet["part"] == old.main_part and ref == "AV1":
                require(FORMULA.sub(b"", after[ref]) == FORMULA.sub(b"", raw), "AV1 cache/style/other attributes changed")
            else:
                require(after[ref] == raw, f"Original cell bytes changed: {sheet['name']}!{ref}")
                preserved_cells += 1
        sheet_counts.append({"name": sheet["name"], "cells": len(before), "part": sheet["part"], "state": sheet["state"]})
    helper_root = xml(candidate.parts[allocation["part"]], allocation["part"])
    helpers = list(helper_root.iter(q("c")))
    require(len(helpers) == len(plan["add_sheet"]["cells"]), "Helper-cell count changed")
    for cell, expected_cell in zip(helpers, plan["add_sheet"]["cells"]):
        require(cell.attrib == {"r": expected_cell["cell"]} and len(cell) == 1 and cell[0].tag == q("f")
                and not cell[0].attrib and cell[0].text == expected_cell["formula"][1:], "Helper formula/cache representation differs")
    old_rels = [r for r in old.relationships if not (r["part"] == RELS and r["attributes"]["Id"] in {c["rId"] for c in old.chains})]
    new_rels = [r for r in candidate.relationships if not (r["part"] == RELS and r["attributes"]["Id"] == allocation["rId"])]
    require(old_rels == new_rels, "An unrelated relationship changed")
    zip_fields = ("date_time", "compress_type", "comment", "extra", "create_system", "create_version",
                  "extract_version", "internal_attr", "external_attr", "flag_bits")
    new_infos = {i.filename: i for i in candidate.infos}
    for info in old.infos:
        if info.filename in removed:
            continue
        require(all(getattr(info, field) == getattr(new_infos[info.filename], field) for field in zip_fields), "Original ZIP entry metadata changed")
    require(candidate.comment == old.comment, "ZIP archive comment changed")
    differences = []
    for name in old.parts:
        if name in removed:
            differences.append({"part": name, "change": "removed stale calculation chain", "before_sha256": sha(old.parts[name]), "after_sha256": None})
        elif candidate.parts[name] != old.parts[name]:
            require(name in changed, "Changed part is outside whitelist")
            differences.append({"part": name, "change": "patched", "before_bytes": len(old.parts[name]), "after_bytes": len(candidate.parts[name]),
                                "before_sha256": sha(old.parts[name]), "after_sha256": sha(candidate.parts[name])})
    differences.append({"part": allocation["part"], "change": "new hidden helper worksheet", "after_bytes": len(candidate.parts[allocation["part"]]), "after_sha256": sha(candidate.parts[allocation["part"]])})
    result = {k: v for k, v in stats.items() if k != "baseline_output"}
    result.update({"source_sha256": prepared.source_sha, "output_sha256": sha(candidate_raw), "output_bytes": len(candidate_raw),
                   "generator_sha256": GENERATOR_SHA, "plan_sha256": prepared.plan_sha, "allocation": allocation,
                   "original_parts": len(old.parts), "candidate_parts": len(candidate.parts),
                   "unchanged_part_payloads": sum(name in candidate.parts and old.parts[name] == candidate.parts[name] for name in old.parts),
                   "original_cells": preserved_cells + 1, "original_cells_byte_exact_except_AV1_formula": preserved_cells,
                   "original_formula_cells": original_formulas, "original_cached_error_cells_preserved": original_cached_errors,
                   "sheets": sheet_counts, "byte_change_whitelist": differences,
                   "av1_original_cache_retained_byte_exact": True, "av1_original_cache_equals_reference_model_exactly": True,
                   "helper_cache_values_authored": 0, "native_recalculation_performed": False, "release_ready": False,
                   "calculation_request": {"fullCalcOnLoad": "1", "calcOnSave": "1", "calcCompleted": "0", "other_attributes": "preserved"},
                   "zip_note": "Uncompressed part payloads and original ZipInfo metadata are checked; ZIP compression streams/central-directory offsets are regenerated."})
    return result


def build(prepared, output):
    output = allowed_path(output)
    require(output != prepared.source and not output.exists(), "Refusing to overwrite workbook/output")
    plan, stats = current_plan(prepared)
    parts = patch_parts(prepared, plan, stats)
    raw = zip_bytes(prepared.package, parts, prepared.allocation["part"])
    report = verify(prepared, raw, plan, stats)
    current_plan(prepared)  # Recheck external files after patching and verification.
    write_new(output, raw)
    try:
        require(output.read_bytes() == raw, "Output changed during write")
        current_plan(prepared)
    except Exception:
        output.unlink()  # Only this just-created, explicitly bounded file.
        raise
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, help="New output directory below sibling _audit/xlsx-export-package; defaults to a unique UTC timestamp.")
    args = parser.parse_args()
    directory = allowed_path(args.output_dir or BASE / datetime.now(timezone.utc).strftime("candidate-%Y%m%dT%H%M%S%fZ"))
    results = {}
    for version, (filename, digest) in SOURCES.items():
        prepared = prepare(REPO / "public" / filename, digest, directory / version)
        output = directory / f"{version}-AV1-engineering-candidate.xlsx"
        report = build(prepared, output)
        report["output"] = str(output)
        results[version] = report
    json_new(directory / "preservation-report.json", results)
    print(json.dumps({v: {"output": r["output"], "helpers": r["helpers"], "original_cells": r["original_cells"], "output_sha256": r["output_sha256"]}
                      for v, r in results.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
