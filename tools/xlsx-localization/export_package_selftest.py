"""Audit-only tests using both real packages and explicitly synthetic derivatives.

The independent check below compares XML trees/whole part bytes without calling
the writer's patch_parts/verify functions. No native spreadsheet engine is used.
"""
from __future__ import annotations

from copy import copy, deepcopy
from dataclasses import replace
import io
import json
from pathlib import Path
import re
import tempfile
import time
import warnings
import xml.etree.ElementTree as ET
import zipfile

import export_package as p

p.BASE.mkdir(parents=True, exist_ok=True)
RUN = Path(tempfile.mkdtemp(prefix="selftest-", dir=p.BASE))
OUTPUTS = RUN / "outputs"
RESULTS = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    RESULTS.append({"label": label, "pass": True})
    print("PASS " + label, flush=True)


def reject(label, action, message=None):
    try:
        action()
    except (p.Rejected, ValueError, KeyError, FileExistsError, zipfile.BadZipFile) as error:
        if message and not re.search(message, str(error), re.I):
            raise AssertionError(f"{label}: wrong rejection: {error}") from error
        RESULTS.append({"label": label, "pass": True, "rejection": str(error)[:250]})
        print("PASS " + label + " [rejected]", flush=True)
    else:
        raise AssertionError(label + ": accepted invalid input")


def repack(base_raw, updates=None, delete=(), extra=()):
    updates = updates or {}
    target = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base_raw)) as original, zipfile.ZipFile(target, "w") as result:
        result.comment = original.comment
        for info in original.infolist():
            if info.filename not in delete:
                result.writestr(copy(info), updates.get(info.filename, original.read(info)))
        for name, payload in extra:
            info = zipfile.ZipInfo(name, (2026, 9, 8, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            result.writestr(info, payload)
    return target.getvalue()


def file_new(name, raw):
    path = RUN / name
    p.write_new(path, raw)
    return path


def prepared_existing(version):
    filename, digest = p.SOURCES[version]
    return p.prepare(p.REPO / "public" / filename, digest, OUTPUTS / version)


def tree_equal(a, b):
    return ET.tostring(a) == ET.tostring(b)


def independent_check(prepared, output):
    version = output.name.split("-")[0]
    with zipfile.ZipFile(io.BytesIO(prepared.raw)) as oldzip, zipfile.ZipFile(output) as newzip:
        old = {n: oldzip.read(n) for n in oldzip.namelist()}
        new = {n: newzip.read(n) for n in newzip.namelist()}
    plan = json.loads(prepared.plan_file.read_text("utf-8"))
    main = prepared.package.main_part
    helper = prepared.allocation["part"]
    check(set(new) - set(old) == {helper} and not (set(old) - set(new)), version + " exactly one added package part")
    changed = {n for n in old if old[n] != new[n]}
    check(changed == {main, p.WORKBOOK, p.RELS, p.CONTENT, p.APP}, version + " exactly five changed original payloads")
    for name in old:
        if name not in changed:
            assert old[name] == new[name]
    check(True, version + " every unrelated part byte exact, including shared strings/styles/media/external links")
    before_main = ET.fromstring(old[main])
    after_main = ET.fromstring(new[main])
    before_cells = {c.attrib["r"]: c for c in before_main.iter(p.q("c"))}
    after_cells = {c.attrib["r"]: c for c in after_main.iter(p.q("c"))}
    check(before_cells.keys() == after_cells.keys(), version + " original Main cell addresses unchanged")
    check(tree_equal(before_cells["AS41"], after_cells["AS41"]), version + " AS41 semantics and raw cache untouched")
    oldav = before_cells["AV1"]
    newav = after_cells["AV1"]
    check(oldav.find(p.q("v")).text == newav.find(p.q("v")).text, version + " exact old AV1 cached string retained")
    check(newav.find(p.q("f")).text == plan["replace_cell"]["formula"][1:], version + " AV1 matches self-generated plan")
    newav.find(p.q("f")).text = oldav.find(p.q("f")).text
    check(tree_equal(before_main, after_main), version + " complete Main XML tree identical after reverting AV1 formula")
    oldbook = ET.fromstring(old[p.WORKBOOK])
    newbook = ET.fromstring(new[p.WORKBOOK])
    newsheets = newbook.find(p.q("sheets"))
    added = newsheets[-1]
    check(added.attrib == {"name": "Export", "sheetId": str(prepared.allocation["sheetId"]), "state": "hidden", "{" + p.RNS + "}id": prepared.allocation["rId"]}, version + " hidden Export appended with unique IDs")
    newsheets.remove(added)
    newcalc = newbook.find(p.q("calcPr"))
    check(all(newcalc.get(k) == v for k, v in {"fullCalcOnLoad":"1", "calcOnSave":"1", "calcCompleted":"0"}.items()), version + " native recalculation requested")
    newcalc.attrib.clear()
    newcalc.attrib.update(oldbook.find(p.q("calcPr")).attrib)
    check(tree_equal(oldbook, newbook), version + " workbook names/definedNames/hidden states/views unchanged")
    for name, attribute, value in [(p.RELS, "Id", prepared.allocation["rId"]), (p.CONTENT, "PartName", "/" + helper)]:
        oldroot = ET.fromstring(old[name])
        newroot = ET.fromstring(new[name])
        selected = [c for c in newroot if c.get(attribute) == value]
        assert len(selected) == 1
        newroot.remove(selected[0])
        check(tree_equal(oldroot, newroot), version + " original " + name + " tree unchanged")
    appq = lambda n: "{" + p.APPNS + "}" + n
    vtq = lambda n: "{" + p.VTNS + "}" + n
    oldapp = ET.fromstring(old[p.APP])
    newapp = ET.fromstring(new[p.APP])
    titles = newapp.find(appq("TitlesOfParts")).find(vtq("vector"))
    check(titles[-1].text == "Export" and int(titles.get("size")) == len(prepared.package.sheets)+1, version + " app properties sheet inventory consistent")
    titles.remove(titles[-1])
    titles.set("size", str(len(prepared.package.sheets)))
    newapp.find(appq("HeadingPairs")).find(vtq("vector"))[1][0].text = str(len(prepared.package.sheets))
    check(tree_equal(oldapp, newapp), version + " other application properties unchanged")
    helperroot = ET.fromstring(new[helper])
    helpercells = list(helperroot.iter(p.q("c")))
    check(len(helpercells) == len(plan["add_sheet"]["cells"]) and not list(helperroot.iter(p.q("v"))), version + " all helper formulas present with zero authored caches")
    check(all(len(c) == 1 and c[0].tag == p.q("f") and c[0].text == row["formula"][1:] for c,row in zip(helpercells,plan["add_sheet"]["cells"])), version + " packaged helper formulas exactly match plan")
    count = sum(len(list(ET.fromstring(old[s["part"]]).iter(p.q("c")))) for s in prepared.package.sheets)
    fcount = sum(len(list(ET.fromstring(old[s["part"]]).iter(p.q("f")))) for s in prepared.package.sheets)
    report = json.loads((OUTPUTS / "preservation-report.json").read_text("utf-8"))[version]
    check(count == report["original_cells"] and fcount == report["original_formula_cells"], version + " independent original cell/formula counts agree")
    check(p.sha(prepared.source.read_bytes()) == prepared.source_sha, version + " authoritative original remains unchanged")


def plan_tests(prepared):
    plan, stats = p.current_plan(prepared)
    def invalid(label, mutate, message):
        modified = deepcopy(plan)
        mutate(modified)
        reject(label, lambda:p.validate_plan(modified, prepared.snapshot, plan), message)
    invalid("duplicate helper rejected", lambda v:v["add_sheet"]["cells"].append(deepcopy(v["add_sheet"]["cells"][0])), "Duplicate helper")
    invalid("missing helper rejected", lambda v:v["add_sheet"]["cells"].pop(0), "Missing helper")
    invalid("illegal column XFE rejected", lambda v:v["add_sheet"]["cells"][0].update(cell="XFE1"), "reference|cell")
    invalid("illegal row zero rejected", lambda v:v["add_sheet"]["cells"][0].update(cell="A0"), "reference|cell")
    invalid("illegal row past Excel limit rejected", lambda v:v["add_sheet"]["cells"][0].update(cell="A1048577"), "reference|cell")
    invalid("noncanonical absolute helper address rejected", lambda v:v["add_sheet"]["cells"][0].update(cell="$A$1"), "canonical")
    invalid("formula UTF16 budget enforced", lambda v:v["add_sheet"]["cells"][0].update(formula='="'+'x'*8192+'"'), "UTF-16 budget")
    invalid("helper count budget enforced", lambda v:v["add_sheet"].update(cells=[{"cell":f"A{i}","formula":"=0"} for i in range(1,4098)]), "count.*budget")
    invalid("direct dependency cycle rejected", lambda v:v["add_sheet"]["cells"][0].update(formula="=A1"), "Cycle")
    invalid("unreachable two-cell cycle rejected", lambda v:v["add_sheet"]["cells"].extend([{"cell":"B1","formula":"=IF(0,B2,0)"},{"cell":"B2","formula":"=B1"}]), "Cycle")
    invalid("AV1-helper cycle rejected", lambda v:v["add_sheet"]["cells"][0].update(formula="='主要'!AV1"), "Cycle")
    invalid("unapproved original cell reference rejected", lambda v:v["add_sheet"]["cells"][0].update(formula="='主要'!XFD1048576"), "Unapproved")
    invalid("external workbook reference rejected", lambda v:v["add_sheet"]["cells"][0].update(formula="='[other.xlsx]主要'!A1"), "External|external")
    invalid("unsupported formula function rejected", lambda v:v["add_sheet"]["cells"][0].update(formula="=WEBSERVICE(\"https://example.invalid\")"), "Unsupported")
    invalid("over 255 function arguments rejected", lambda v:v["add_sheet"]["cells"][0].update(formula="=SUM("+",".join(["1"]*256)+")"), "over-budget")
    invalid("source-prose rename rejected", lambda v:v.update(rename_prerequisites={"主要":"Main"}), "renaming")
    invalid("visible helper sheet rejected", lambda v:v["add_sheet"].update(state="visible"), "placement")
    invalid("arbitrary output cell rejected", lambda v:v["replace_cell"].update(cell="AS41"), "Only main AV1")
    invalid("altered equivalent-looking plan rejected", lambda v:v["add_sheet"]["cells"][0].update(purpose="tampered annotation"), "fresh reviewed-generator")
    old_budget = p.MAX_FORMULA_BYTES
    try:
        p.MAX_FORMULA_BYTES = 8
        reject("aggregate new-formula budget enforced", lambda:p.validate_plan(plan,prepared.snapshot,plan), "Total new-formula")
    finally:
        p.MAX_FORMULA_BYTES = old_budget
    reject("duplicate JSON keys rejected", lambda:p.strict_json(b'{"schema":1,"schema":2}'), "Duplicate JSON")
    reject("nonfinite JSON rejected", lambda:p.strict_json(b'{"value":NaN}'), "Nonfinite")
    reject("oversize plan file rejected", lambda:p.strict_json(b" "*(p.MAX_PLAN_BYTES+1)), "byte budget")
    return plan, stats


def package_rejection_tests(prepared, plan, stats):
    raw = prepared.raw
    parts = prepared.package.parts
    reject("not a ZIP workbook rejected", lambda:p.read_package(b"not a workbook"), "Invalid ZIP")
    reject("compressed package budget enforced", lambda:p.read_package(b"x"*(p.MAX_PACKAGE_BYTES+1)), "byte budget")
    old_budget = p.MAX_PACKAGE_BYTES
    try:
        p.MAX_PACKAGE_BYTES = len(raw)+1
        reject("expanded package budget enforced", lambda:p.read_package(raw), "Expanded package")
    finally:
        p.MAX_PACKAGE_BYTES = old_budget
    with warnings.catch_warnings():
        warnings.simplefilter("ignore",UserWarning)
        duplicate = repack(raw, extra=[(p.WORKBOOK,parts[p.WORKBOOK])])
    reject("duplicate ZIP member rejected", lambda:p.read_package(duplicate), "Duplicate ZIP")
    reject("unsafe ZIP traversal rejected", lambda:p.read_package(repack(raw,extra=[("../escape.xml",b"x")])), "Unsafe ZIP")
    reject("case-ambiguous ZIP name rejected", lambda:p.read_package(repack(raw,extra=[("XL/WORKBOOK.XML",parts[p.WORKBOOK])])), "Case-ambiguous")
    reject("signed package rejected", lambda:p.read_package(repack(raw,extra=[("_xmlsignatures/sig1.xml",b"<signature/>")])), "Signed OOXML")
    reject("missing workbook relationship file rejected", lambda:p.read_package(repack(raw,delete=[p.RELS])), "Missing workbook")
    rel = re.search(rb'<Relationship\b[^>]*\bId="rId2"[^>]*/>',parts[p.RELS])[0]
    missing = parts[p.RELS].replace(rel,b"",1)
    reject("missing Main relationship rejected", lambda:p.read_package(repack(raw,{p.RELS:missing})), "worksheet relationship")
    repeat = parts[p.RELS].replace(b"</Relationships>",rel+b"</Relationships>")
    reject("duplicate relationship ID rejected", lambda:p.read_package(repack(raw,{p.RELS:repeat})), "Duplicate relationship")
    escape = parts[p.RELS].replace(rel,rel.replace(b'Target="worksheets/sheet2.xml"',b'Target="../../outside.xml"'))
    reject("escaping internal relationship rejected", lambda:p.read_package(repack(raw,{p.RELS:escape})), "Unsafe ZIP|Dangling")
    external = parts[p.RELS].replace(rel,rel.replace(b'Target="worksheets/sheet2.xml"',b'Target="https://example.invalid/card.xml" TargetMode="External"'))
    reject("external Main worksheet rejected without fetching", lambda:p.read_package(repack(raw,{p.RELS:external})), "External/unsafe worksheet")
    dupeid = parts[p.WORKBOOK].replace(b'sheetId="2"',b'sheetId="17"',1)
    reject("duplicate sheetId rejected", lambda:p.read_package(repack(raw,{p.WORKBOOK:dupeid})), "Duplicate sheetId")
    chain = f'<calcChain xmlns="{p.NS}"><c r="AV1" i="2"/></calcChain>'.encode()
    reject("orphaned calcChain rejected", lambda:p.read_package(repack(raw,extra=[("xl/calcChain.xml",chain)])), "Orphaned")
    candidate = (OUTPUTS / "2014-AV1-engineering-candidate.xlsx").read_bytes()
    candidate_parts = p.read_package(candidate).parts
    def tamper(label,name,modified):
        reject(label,lambda:p.verify(prepared,repack(candidate,{name:modified}),plan,stats),"byte-change whitelist|Missing|Invalid")
    main = prepared.package.main_part
    av1 = p.cells_of(candidate_parts[main])["AV1"]
    cache = p.VALUE.search(av1)[0]
    changed_av1 = av1.replace(cache,cache.replace(b"<v>",b"<v> ",1))
    tamper("changed retained AV1 cache rejected",main,candidate_parts[main].replace(av1,changed_av1,1))
    other = next(c for name,c in p.cells_of(candidate_parts[main]).items() if name != "AV1" and b"</c>" in c)
    tamper("unrelated original cell mutation rejected",main,candidate_parts[main].replace(other,other.replace(b"</c>",b"<v>123</v></c>"),1))
    tamper("defined-name mutation rejected",p.WORKBOOK,candidate_parts[p.WORKBOOK].replace(b"</definedNames>",b'<definedName name="unexpected">0</definedName></definedNames>'))
    tamper("unrelated sheet hidden-state mutation rejected",p.WORKBOOK,candidate_parts[p.WORKBOOK].replace(b'state="hidden"',b'state="veryHidden"',1))
    image = next(n for n in candidate_parts if n.startswith("xl/media/") and not n.endswith("/"))
    tamper("image payload mutation rejected",image,candidate_parts[image]+b"x")
    external_rel = next(n for n in candidate_parts if n.startswith("xl/externalLinks/_rels/") and n.endswith(".rels"))
    tamper("existing external-link relationship mutation rejected",external_rel,candidate_parts[external_rel].replace(b"</Relationships>",b" \n</Relationships>"))
    helper = prepared.allocation["part"]
    tamper("invented helper cache rejected",helper,candidate_parts[helper].replace(b"</f>",b"</f><v>0</v>",1))
    tamper("helper formula mutation rejected",helper,candidate_parts[helper].replace(b"</f>",b"+0</f>",1))
    tamper("stale application title count rejected",p.APP,candidate_parts[p.APP].replace(b'<vt:i4>18</vt:i4>',b'<vt:i4>17</vt:i4>'))


def external_tamper_tests(prepared):
    modified_plan = file_new("tampered-plan.json",prepared.plan_file.read_bytes()+b" ")
    item = replace(prepared,plan_file=modified_plan)
    target = RUN/"must-not-exist-plan.xlsx"
    reject("on-disk plan tampering aborts before output",lambda:p.build(item,target),"Plan file changed")
    check(not target.exists(),"no workbook output after plan-tamper rejection")
    changed_source = file_new("tampered-source.bin",prepared.raw+b"tampered")
    target = RUN/"must-not-exist-source.xlsx"
    reject("source changed after planning aborts before output",lambda:p.build(replace(prepared,source=changed_source),target),"Source workbook changed")
    check(not target.exists(),"no workbook output after source-tamper rejection")
    snapshot = file_new("tampered-snapshot.bin",prepared.raw+b"tampered")
    reject("frozen input changed after planning rejected",lambda:p.current_plan(replace(prepared,snapshot_file=snapshot)),"snapshot changed")
    normalized = p.GENERATOR.read_bytes().replace(b"\r\n", b"\n")
    lf = file_new("generator-lf.py", normalized)
    crlf = file_new("generator-crlf.py", normalized.replace(b"\n", b"\r\n"))
    check(p.generator_bytes(lf) == p.generator_bytes(crlf) == normalized, "LF and CRLF generator checkouts compile the same pinned bytes")
    generator = file_new("tampered-generator.py",p.GENERATOR.read_bytes()+b"\n# external change\n")
    reject("unreviewed generator bytes rejected",lambda:p.generator_bytes(generator),"generator changed")
    reject("incorrect input pin rejected",lambda:p.prepare(prepared.source,"0"*64,RUN/"wrong-pin"),"before planning")
    reject("output outside audit directory rejected",lambda:p.allowed_path(p.REPO/"public/must-not-be-written.xlsx"),"outside the audit")
    reject("existing workbook output not overwritten",lambda:p.build(prepared,OUTPUTS/"2014-AV1-engineering-candidate.xlsx"),"overwrite")
    target = RUN/"mid-build-source-tamper.xlsx"
    source = file_new("mutable-fixture-source.bin",prepared.raw)
    item = replace(prepared,source=source)
    original_verify = p.verify
    def changed_during_verification(*args,**kwargs):
        report = original_verify(*args,**kwargs)
        # Deliberate mutation of an audit fixture only; never an original file.
        source.write_bytes(prepared.raw+b"changed during verification")
        return report
    try:
        p.verify = changed_during_verification
        reject("source changed during verification prevents output",lambda:p.build(item,target),"Source workbook changed")
    finally:
        p.verify = original_verify
    check(not target.exists(),"no workbook after late external-source change")


def derived_prepare(name,raw):
    source = file_new(name+"-source.bin",raw)
    return p.prepare(source,p.sha(raw),RUN/(name+"-plan"))


def derived_packages(prepared):
    raw = prepared.raw
    parts = prepared.package.parts
    # A calculation chain is optional in OOXML. Actual originals have none;
    # this derivative proves paired part/relationship/content-type removal.
    chain_name = "xl/calcChain.xml"
    chain = f'<calcChain xmlns="{p.NS}"><c r="AV1" i="2"/><c r="AS41"/></calcChain>'.encode()
    rel = f'<Relationship Id="rId77" Type="{p.RNS}/calcChain" Target="calcChain.xml"/>'.encode()
    content = f'<Override PartName="/{chain_name}" ContentType="{p.CHAIN_TYPE}"/>'.encode()
    chainraw = repack(raw,{p.RELS:parts[p.RELS].replace(b"</Relationships>",rel+b"</Relationships>"),p.CONTENT:parts[p.CONTENT].replace(b"</Types>",content+b"</Types>")},extra=[(chain_name,chain)])
    item = derived_prepare("with-chain",chainraw)
    target = RUN/"with-chain-output.bin"
    result = p.build(item,target)
    new = p.read_package(target.read_bytes())
    check(chain_name not in new.parts and not any(r["attributes"].get("Type","").endswith("/calcChain") for r in new.relationships) and p.CHAIN_TYPE.encode() not in new.parts[p.CONTENT],"synthetic calcChain part/relationship/content-type all removed")
    check(result["original_cells_byte_exact_except_AV1_formula"] == 63114,"synthetic calcChain removal preserves every original cell except AV1 formula")
    orphan = repack(chainraw,{p.RELS:parts[p.RELS]})
    reject("typed calcChain without relationship rejected",lambda:p.read_package(orphan),"Orphaned")
    extra_chain = repack(chainraw, extra=[("audit/calcChain.xml", chain)])
    reject("registered chain plus an unregistered conventionally named chain rejected",lambda:p.read_package(extra_chain),"Orphaned/ambiguous conventionally named")
    # Occupy Export, the next physical worksheet number, and the next rId.
    nextpart = prepared.allocation["part"]
    sheet = f'<sheet name="Export" sheetId="99" state="hidden" r:id="{prepared.allocation["rId"]}"/>'.encode()
    rel = f'<Relationship Id="{prepared.allocation["rId"]}" Type="{p.RNS}/worksheet" Target="{nextpart.removeprefix("xl/")}"/>'.encode()
    content = f'<Override PartName="/{nextpart}" ContentType="{p.WORKSHEET_TYPE}"/>'.encode()
    helper = f'<worksheet xmlns="{p.NS}"><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>'.encode()
    updates = {p.WORKBOOK:parts[p.WORKBOOK].replace(b"</sheets>",sheet+b"</sheets>"),p.RELS:parts[p.RELS].replace(b"</Relationships>",rel+b"</Relationships>"),p.CONTENT:parts[p.CONTENT].replace(b"</Types>",content+b"</Types>"),p.APP:p.append_app_sheet(parts[p.APP],[s["name"] for s in prepared.package.sheets],"Export")}
    item = derived_prepare("collisions",repack(raw,updates,extra=[(nextpart,helper)]))
    check(item.allocation == {"name":"Export_2","sheetId":100,"rId":"rId27","part":"xl/worksheets/sheet19.xml"},"sheet name/sheetId/rId/physical path collisions allocate unique values")
    target = RUN/"collisions-output.bin"
    result = p.build(item,target)
    new = p.read_package(target.read_bytes())
    check(new.parts[nextpart] == helper and new.sheets[-2]["name"] == "Export" and new.sheets[-1]["name"] == "Export_2","pre-existing Export content preserved and new Export_2 hidden")
    # Preserve macro bytes and their associations without executing anything.
    # This is an opaque synthetic payload, not a claim of a valid VBA project.
    macro_name = "xl/vbaProject.bin"
    macro = b"synthetic opaque VBA association preservation fixture\x00\xff"
    rel = b'<Relationship Id="rId88" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>'
    content = b'<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>'
    macroct = parts[p.CONTENT].replace(b"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",b"application/vnd.ms-excel.sheet.macroEnabled.main+xml")
    item = derived_prepare("opaque-macro",repack(raw,{p.RELS:parts[p.RELS].replace(b"</Relationships>",rel+b"</Relationships>"),p.CONTENT:macroct.replace(b"</Types>",content+b"</Types>")},extra=[(macro_name,macro)]))
    target = RUN/"opaque-macro-output.bin"
    p.build(item,target)
    new = p.read_package(target.read_bytes())
    check(new.parts[macro_name] == macro and rel in new.parts[p.RELS] and content in new.parts[p.CONTENT] and b"macroEnabled.main+xml" in new.parts[p.CONTENT],"synthetic opaque macro bytes/relationship/content types retained")
    # Existing calculation preferences are not silently forced to auto.
    originalcalc = re.search(rb"<calcPr\b[^>]*/>",parts[p.WORKBOOK])[0]
    calc = b'<calcPr calcId="191029" calcMode="manual" iterate="1" iterateCount="23" iterateDelta="0.005" fullPrecision="0" forceFullCalc="0" fullCalcOnLoad="0" calcOnSave="0" calcCompleted="1"/>'
    updated = p.calc_properties(parts[p.WORKBOOK].replace(originalcalc,calc))
    attrs = ET.fromstring(updated).find(p.q("calcPr")).attrib
    check(attrs == {"calcId":"191029","calcMode":"manual","iterate":"1","iterateCount":"23","iterateDelta":"0.005","fullPrecision":"0","forceFullCalc":"0","fullCalcOnLoad":"1","calcOnSave":"1","calcCompleted":"0"},"existing calculation mode/iteration/precision preserved; only three recalc flags changed")
    absent = p.calc_properties(parts[p.WORKBOOK].replace(originalcalc,b""))
    check(ET.fromstring(absent).find(p.q("calcPr")).attrib == {"fullCalcOnLoad":"1","calcOnSave":"1","calcCompleted":"0"},"missing calcPr gets a bounded full-recalculation request")
    maximum = parts[p.WORKBOOK].replace(b'sheetId="32"',b'sheetId="2147483647"',1)
    reject("exhausted sheetId budget rejected",lambda:p.choose_ids(p.read_package(repack(raw,{p.WORKBOOK:maximum}))),"fresh sheetId")


def main():
    started = time.monotonic()
    originals = {}
    package_reports = {}
    for version in p.SOURCES:
        originals[version] = prepared_existing(version)
        package_reports[version] = p.build(originals[version], OUTPUTS/f"{version}-AV1-engineering-candidate.xlsx")
    p.json_new(OUTPUTS/"preservation-report.json", package_reports)
    for version in p.SOURCES:
        independent_check(originals[version], OUTPUTS/f"{version}-AV1-engineering-candidate.xlsx")
    selected = originals["2014"]
    plan,stats = plan_tests(selected)
    package_rejection_tests(selected,plan,stats)
    external_tamper_tests(selected)
    derived_packages(selected)
    report = {"passed":len(RESULTS),"failed":0,"seconds":round(time.monotonic()-started,2),"tests":RESULTS,"run_directory":str(RUN),"package_tool_sha256":p.sha(Path(p.__file__).read_bytes()),"test_sha256":p.sha(Path(__file__).read_bytes()),"generator_sha256":p.GENERATOR_SHA,"native_engine_used":False,"source_originals_unchanged":{v:p.sha(x.source.read_bytes()) == x.source_sha for v,x in originals.items()}}
    p.json_new(RUN/"result.json",report)
    print(json.dumps({"passed":len(RESULTS),"report":str(RUN/"result.json")},ensure_ascii=False),flush=True)


if __name__ == "__main__":
    main()
