"""Build audit-only shield workbooks from pinned originals and the published exporter.

Clears worksheet formula caches; external-link caches remain untouched. Outputs
need native recalculation, save/reopen and import acceptance before distribution.
Only standard-library ZIP/XML editing is used here; the pinned exporter provides
its existing formula compiler. No library resaves a workbook.
"""
from __future__ import annotations

import argparse
from copy import copy, deepcopy
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

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
EXPORTER_SHA = "f9a0c5cc4078eea9d5085a6c25b7644054a4366fb28737202aba9ee7f5ab3b12"
SEED_SHA = {"2014": "3045eec5ab406618a8f03c553ccf78b3ead699c8226ae3fd3672f676e5cae0cc",
            "2024": "fcefe3bad35613e52eeeb3d0fba34f7ef90e91e948c253f80b8a20732fb37231"}
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def require(ok, message):
    if not ok: raise ValueError(message)


def exporter_bytes(path):
    raw = Path(path).read_bytes().replace(b"\r\n", b"\n")
    require(sha(raw) == EXPORTER_SHA, "Published export_package source changed")
    return raw


def load_exporter(path=HERE / "export_package.py"):
    raw = exporter_bytes(path)
    module = types.ModuleType("_shield_published_exporter")
    module.__file__ = str(Path(path).resolve())
    sys.modules[module.__name__] = module
    exec(compile(raw, module.__file__, "exec"), module.__dict__)
    return module


p = load_exporter()
g, q = p.g, p.q
VALUE = re.compile(rb'<v\b[^>]*?(?:/>|>.*?</v>)', re.S)
FORMULA = re.compile(rb'<f\b[^>]*?(?:/>|>.*?</f>)', re.S)
DV = re.compile(rb'<dataValidation\b[^>]*?(?:/>|>.*?</dataValidation>)', re.S)


def elements(raw, local):
    """Independent XML-parser offsets, including a parent ending in <f .../>."""
    parser = expat.ParserCreate(namespace_separator="}"); stack = []; found = []
    def start(tag, attrs):
        begin = parser.CurrentByteIndex; end = begin; quote = None
        while end < len(raw):
            value = raw[end]
            if quote is not None:
                if value == quote: quote = None
            elif value in (34, 39): quote = value
            elif value == 62: break
            end += 1
        require(end < len(raw), "Unterminated XML start tag")
        stack.append((tag, attrs, begin, end + 1, raw[end - 1:end] == b"/"))
    def end(tag):
        opened, attrs, begin, head_end, closed = stack.pop()
        require(opened == tag, "XML stack mismatch")
        finish = head_end if closed else raw.index(b">", parser.CurrentByteIndex) + 1
        if tag.rsplit("}", 1)[-1] == local: found.append((attrs, raw[begin:finish], begin, finish))
    parser.StartElementHandler = start; parser.EndElementHandler = end
    parser.Parse(raw, True)
    return found


def without(raw, local):
    for _, _, a, b in reversed(elements(raw, local)): raw = raw[:a] + raw[b:]
    return raw


def bounds(ref):
    tokens = ref.split(":"); require(len(tokens) in (1, 2), "Unsupported range")
    def point(value):
        _, normalized = g.reference(value, "sheet")
        match = re.fullmatch(r"([A-Z]+)([0-9]+)", normalized)
        col = 0
        for char in match[1]: col = col * 26 + ord(char) - 64
        return col, int(match[2])
    a, b = point(tokens[0]), point(tokens[-1])
    require(a[0] <= b[0] and a[1] <= b[1], "Reversed range")
    return (*a, *b)


def formula_changes(version):
    require(version in SEED_SHA, "Unsupported rules version")
    return {("主要", "D23"): ('SUM(AF40,AI40,G23,+IF(AS40="是",AQ40,0))', 'SUM(AF40,AI40,G23,+IF(OR(AS40="是",AS40="Yes"),AQ40,0))'),
            ("数据表", "AN56" if version == "2014" else "AO58"): ('IF(主要!AS40="否","",6)', 'IF(OR(主要!AS40="否",主要!AS40="No"),"",6)'),
            ("Export", "A178"): ("'主要'!$AS$41&\"\"", "'主要'!$AS$40&\"\"")}


def check_array_followers(raw):
    root = p.xml(raw, "worksheet"); cells = list(root.iter(q("c"))); spans = []
    for cell in cells:
        f = cell.find(q("f"))
        if f is not None and f.get("t") in ("array", "dataTable"):
            spans.append(bounds(f.get("ref", "")))
    for cell in cells:
        if cell.find(q("f")) is None and cell.find(q("v")) is not None:
            col, row, _, _ = bounds(cell.get("r"))
            require(not any(c1 <= col <= c2 and r1 <= row <= r2 for c1, r1, c2, r2 in spans),
                    "Array/data-table follower cache needs separate policy")
    return len(spans)


def split_validation(raw):
    blocks = list(DV.finditer(raw))
    matches = [m for m in blocks if "AS40:AT40" in ET.fromstring(m[0]).get("sqref", "").split()]
    require(len(matches) == 1, "Shield validation must be unique")
    match = matches[0]; node = ET.fromstring(match[0]); tokens = node.get("sqref").split()
    require(node.findtext("formula1") == '"是,否"' and tokens.count("AS40:AT40") == 1 and len(tokens) > 1, "Unexpected shield validation")
    remaining = " ".join(t for t in tokens if t != "AS40:AT40")
    old = re.sub(rb'sqref="[^"]*"', lambda _: b'sqref="' + remaining.encode() + b'"', match[0], count=1)
    new = re.sub(rb'sqref="[^"]*"', b'sqref="AS40:AT40"', match[0], count=1)
    new, count = re.subn(rb'<formula1>.*?</formula1>', b'<formula1>"Yes,No"</formula1>', new, flags=re.S)
    require(count == 1, "Unsupported validation formula")
    raw = raw[:match.start()] + old + new + raw[match.end():]
    headers = list(re.finditer(rb'<dataValidations\b[^>]*>', raw)); require(len(headers) == 1, "Unexpected DV container")
    header = headers[0]; count = re.search(rb'\bcount="([0-9]+)"', header[0])
    require(count is not None and int(count[1]) == len(blocks), "DV count differs")
    replacement = header[0][:count.start(1)] + str(len(blocks) + 1).encode() + header[0][count.end(1):]
    return raw[:header.start()] + replacement + raw[header.end():]


def append_style(raw, old_index):
    section = re.search(rb'<cellXfs\b[^>]*>.*?</cellXfs>', raw, re.S)
    require(section is not None, "Missing cellXfs")
    entries = list(re.finditer(rb'<xf\b[^>]*?(?:/>|>.*?</xf>)', section[0], re.S))
    table = p.xml(raw, "styles").find(q("cellXfs"))
    require(len(entries) == len(table) and 0 <= old_index < len(table), "Invalid original style index")
    clone = entries[old_index][0]; alignment = re.search(rb'<alignment\b[^>]*/>', clone)
    require(alignment is not None and b'wrapText="1"' in alignment[0] and b'shrinkToFit=' not in alignment[0], "Unexpected shield alignment")
    new = alignment[0].replace(b'wrapText="1"', b'wrapText="0"').replace(b'/>', b' shrinkToFit="1"/>')
    clone = clone[:alignment.start()] + new + clone[alignment.end():]
    changed = section[0].replace(b'</cellXfs>', clone + b'</cellXfs>')
    changed, count = re.subn(rb'\bcount="[0-9]+"', b'count="' + str(len(entries) + 1).encode() + b'"', changed, count=1)
    require(count == 1, "Missing style count")
    return raw[:section.start()] + changed + raw[section.end():], len(entries)


def patch_parts(version, package):
    changes = formula_changes(version); parts = dict(package.parts)
    shared = ["".join(t.text or "" for t in si.iter(q("t"))) for si in p.xml(parts["xl/sharedStrings.xml"], "strings")]
    original_input = ET.fromstring(p.cells_of(parts[package.main_part])["AS40"])
    old_style = int(original_input.get("s"))
    parts["xl/styles.xml"], new_style = append_style(parts["xl/styles.xml"], old_style)
    removed = {}; arrays = {}; edited = set()
    for sheet in package.sheets:
        name, part = sheet["name"], sheet["part"]; raw = parts[part]
        arrays[name] = check_array_followers(raw); p.cells_of(raw); total = 0
        def cell(match):
            nonlocal total
            ref = match[1].decode(); body = match[0]; node = ET.fromstring(body); f = node.find("f")
            if (name, ref) == ("主要", "AS40"):
                v = node.find("v")
                require(node.get("t") == "s" and f is None and v is not None and shared[int(v.text)] == "否" and [n.tag for n in node] == ["v"], "Unexpected AS40 input")
                body = body.replace(b't="s"', b't="inlineStr"', 1)
                body, count = VALUE.subn(b'<is><t>No</t></is>', body); require(count == 1, "Unexpected AS40 value")
                body, count = re.subn(rb'\bs="[0-9]+"', b's="' + str(new_style).encode() + b'"', body, count=1)
                require(count == 1, "Missing AS40 style")
            if (name, ref) in changes:
                before, after = changes[name, ref]
                require(f is not None and not f.attrib and f.text == before, "Unexpected target formula")
                body, count = FORMULA.subn(lambda _: b'<f>' + escape(after).encode() + b'</f>', body)
                require(count == 1, "Unexpected formula count"); edited.add((name, ref))
            if f is not None:
                require(node.find("is") is None and len(node.findall("v")) <= 1, "Unsupported formula cache")
                body, count = VALUE.subn(b'', body); total += count
            return body
        parts[part] = p.CELL.sub(cell, raw)
        if name == "主要": parts[part] = split_validation(parts[part])
        removed[name] = total
    require(edited == changes.keys(), "Missing migration formula")
    return parts, {"removed_worksheet_formula_v": removed, "array_ranges": arrays, "old_style": old_style, "new_style": new_style}


def zip_bytes(package, parts):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.comment = package.comment
        for info in package.infos: archive.writestr(copy(info), parts[info.filename])
    return stream.getvalue()


def signature(node, skip=()):
    return (node.tag, tuple(sorted((k, v) for k, v in node.attrib.items() if k not in skip)), node.text, tuple(signature(c) for c in node))


def dv_coverage(raw):
    result = {}
    for node in p.xml(raw, "worksheet").iter(q("dataValidation")):
        rule = signature(node, ("sqref",))
        for token in node.get("sqref", "").split():
            c1, r1, c2, r2 = bounds(token)
            require((c2 - c1 + 1) * (r2 - r1 + 1) <= 100000, "DV coverage budget exceeded")
            for row in range(r1, r2 + 1):
                for col in range(c1, c2 + 1): result.setdefault((col, row), []).append(rule)
    return result


def verify(version, seed_raw, output_raw):
    require(sha(seed_raw) == SEED_SHA[version], "Unreviewed seed bytes")
    before, after = p.read_package(seed_raw), p.read_package(output_raw)
    require(before.sheets == after.sheets and list(before.parts) == list(after.parts) and before.comment == after.comment, "Package/sheet inventory changed")
    fields = ('date_time', 'compress_type', 'comment', 'extra', 'create_system', 'create_version', 'extract_version', 'internal_attr', 'external_attr', 'flag_bits')
    require(all(getattr(x, k) == getattr(y, k) for x, y in zip(before.infos, after.infos) for k in fields), "ZIP metadata changed")
    sheets = {s["part"] for s in before.sheets}
    require(all(before.parts[k] == after.parts[k] for k in before.parts if k not in sheets | {"xl/styles.xml"}), "Unrelated part changed (including external caches)")
    old_styles, new_styles = before.parts["xl/styles.xml"], after.parts["xl/styles.xml"]
    old_table, new_table = p.xml(old_styles, "styles").find(q("cellXfs")), p.xml(new_styles, "styles").find(q("cellXfs"))
    old_section, new_section = elements(old_styles, "cellXfs")[0][1], elements(new_styles, "cellXfs")[0][1]
    old_xfs, new_xfs = elements(old_section, "xf"), elements(new_section, "xf")
    require(len(new_table) == len(old_table) + 1 and len(new_xfs) == len(old_xfs) + 1, "Wrong style increment")
    require([x[1] for x in old_xfs] == [x[1] for x in new_xfs[:-1]], "Original xf changed")
    attrs = dict(old_table.attrib); attrs["count"] = str(len(new_table))
    require(new_table.attrib == attrs and without(old_styles, "cellXfs") == without(new_styles, "cellXfs"), "Unrelated style/count changed")
    changes = formula_changes(version); count = removed = formulas = error_caches = new_users = 0
    for sheet in before.sheets:
        name, part = sheet["name"], sheet["part"]; old, new = before.parts[part], after.parts[part]
        old_cells = {a["r"]: body for a, body, _, _ in elements(old, "c")}
        new_cells = {a["r"]: body for a, body, _, _ in elements(new, "c")}
        require(old_cells.keys() == new_cells.keys(), "Cell addresses changed")
        check_array_followers(old)
        for ref, raw in old_cells.items():
            actual = new_cells[ref]; a, b = ET.fromstring(raw), ET.fromstring(actual); f, nf = a.find("f"), b.find("f")
            if b.get("s") is not None:
                idx = int(b.get("s")); require(0 <= idx < len(new_table), "Invalid cell style reference")
                if idx == len(old_table): new_users += 1; require((name, ref) == ("主要", "AS40"), "New style leaked")
            if (name, ref) == ("主要", "AS40"):
                attrs = dict(a.attrib); attrs.update(t="inlineStr", s=str(len(old_table)))
                require(b.attrib == attrs and len(b) == 1 and b[0].tag == "is" and len(b[0]) == 1 and b[0][0].tag == "t" and b[0][0].text == "No", "AS40 change differs")
                expected = deepcopy(old_table[int(a.get("s"))]); alignment = expected.find(q("alignment"))
                require(alignment is not None, "Missing original alignment")
                alignment.set("wrapText", "0"); alignment.set("shrinkToFit", "1")
                require(signature(expected) == signature(new_table[-1]), "Unexpected dedicated style")
            elif f is not None:
                formulas += 1; removed += len(a.findall("v")); error_caches += a.get("t") == "e" and a.find("v") is not None
                require(nf is not None and f.attrib == nf.attrib and not b.findall("v"), "Formula/cache representation differs")
                require(without(without(raw, "v"), "f") == without(actual, "f"), "Unapproved formula-cell change")
                require((f.text, nf.text) == changes[name, ref] if (name, ref) in changes else f.text == nf.text, "Unapproved formula text")
            else: require(raw == actual, "Unrelated input cell changed")
            count += 1
        outside_a, outside_b = without(old, "c"), without(new, "c")
        if name == "主要":
            require(without(outside_a, "dataValidations") == without(outside_b, "dataValidations"), "Main surroundings changed")
            ar, br = p.xml(old, "main").find(q("dataValidations")), p.xml(new, "main").find(q("dataValidations"))
            attrs = dict(ar.attrib); attrs["count"] = str(int(attrs["count"]) + 1)
            require(br.attrib == attrs and len(br) == len(ar) + 1, "DV container changed")
            ca, cb = dv_coverage(old), dv_coverage(new); require(ca.keys() == cb.keys(), "DV addresses changed")
            original = next(n for n in ar if "AS40:AT40" in n.get("sqref", "").split())
            english = deepcopy(original); english.find(q("formula1")).text = '"Yes,No"'
            for key in ca:
                require(cb[key] == ([signature(english, ("sqref",))] if key in ((45, 40), (46, 40)) else ca[key]), "DV rule changed outside shield")
        else: require(outside_a == outside_b, "Worksheet surroundings changed")
    require(new_users == 1, "Dedicated style not exclusive")
    return {"cells_compared": count, "formula_cells": formulas, "removed_worksheet_formula_v": removed,
            "removed_original_error_caches_not_repaired": error_caches, "old_declared_xfs": int(old_table.get("count")),
            "old_actual_xfs": len(old_table), "new_xfs": len(new_table), "output_sha256": sha(output_raw)}


def provenance(version, prepared, seed_raw):
    require(version in SEED_SHA and prepared.source_sha == p.SOURCES[version][1], "Unreviewed source version")
    require(sha(seed_raw) == SEED_SHA[version], "Unreviewed seed bytes")
    plan, _ = p.current_plan(prepared); snapshot = prepared.snapshot
    source_refs = [n for n in g.walk(g.Formula(snapshot["formula"]).tree) if n.op == "ref" and g.reference(n.value, snapshot["main_sheet"]) == ("主要", "AS41")]
    helper_refs = [c for c in plan["add_sheet"]["cells"] if any(n.op == "ref" and g.reference(n.value, "Export") == ("主要", "AS41") for n in g.walk(g.Formula(c["formula"]).tree))]
    require(len(source_refs) == 1 and len(helper_refs) == 1 and helper_refs[0]["cell"] == "A178" and helper_refs[0]["formula"] == "='主要'!$AS$41&\"\"", "Shield source is not unique")
    values = dict(snapshot["values"]); values["主要", "AS41"] = "__SHIELD_PROVENANCE__"
    original = json.loads(g.evaluate(g.Formula(snapshot["formula"]).tree, values, snapshot["main_sheet"]))
    baseline = json.loads(g.evaluate_plan(plan, values)); require(original == baseline, "Seed model mismatch")
    require(baseline["combat"]["shield"]["equipped"] == "__SHIELD_PROVENANCE__" and json.dumps(baseline).count("__SHIELD_PROVENANCE__") == 1, "Shield JSON provenance differs")
    migrated = deepcopy(plan)
    next(c for c in migrated["add_sheet"]["cells"] if c["cell"] == "A178")["formula"] = "='主要'!$AS$40&\"\""
    values["主要", "AS40"] = "No"
    actual = json.loads(g.evaluate_plan(migrated, values)); baseline["combat"]["shield"]["equipped"] = "No"
    require(actual == baseline, "Full JSON migration changed other fields")


def allocate(directory=None):
    directory = p.allowed_path(directory or p.BASE / datetime.now(timezone.utc).strftime("shield-candidate-%Y%m%dT%H%M%S%fZ"))
    require(directory != p.BASE and directory.name.startswith("shield-candidate-"), "Require a new shield-candidate directory")
    directory.parent.mkdir(parents=True, exist_ok=True)
    directory.mkdir(exist_ok=False)
    return directory


def run(directory=None):
    directory = allocate(directory); reports = {}
    for version, (filename, digest) in p.SOURCES.items():
        prepared = p.prepare(p.REPO / "public" / filename, digest, directory / version)
        seed_path = directory / f"{version}-seed-AV1-engineering.xlsx"
        seed_report = p.build(prepared, seed_path); seed_raw = seed_path.read_bytes()
        provenance(version, prepared, seed_raw)
        package = p.read_package(seed_raw); parts, stats = patch_parts(version, package)
        raw = zip_bytes(package, parts); checked = verify(version, seed_raw, raw)
        output = directory / f"{version}-shield-NO-CACHE-NOT-FOR-UPLOAD.xlsx"
        p.current_plan(prepared); exporter_bytes(HERE / "export_package.py")
        p.write_new(output, raw)
        require(output.read_bytes() == raw, "Output changed during write")
        p.current_plan(prepared)
        reports[version] = {**checked, "source_sha256": digest, "seed_sha256": sha(seed_raw), "seed_output": str(seed_path),
                            "output": str(output), "native_recalculated": False, "upload_ready": False,
                            "external_link_caches": "preserved byte exact", "seed_report": seed_report,
                            "cache_removal_by_sheet": stats["removed_worksheet_formula_v"]}
    p.json_new(directory / "shield-report.json", reports)
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, help="Exclusive new shield-candidate-* directory below the exporter's audit root")
    args = parser.parse_args()
    print(json.dumps(run(args.output_dir), ensure_ascii=False))


if __name__ == "__main__": main()
