"""Portable main-card dropdown engineering package; no native calculation/upload."""
import argparse
from datetime import datetime,timezone
import hashlib
import io
import json
from pathlib import Path
import sys
import types
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
import zipfile

sys.dont_write_bytecode=True
if not __debug__:
    raise RuntimeError("Optimization mode is unsupported; verification requires assertions")

def find_repo(explicit=None):
    selected=Path(explicit).resolve() if explicit else Path(__file__).resolve().parents[2]
    if not (selected/"tools/xlsx-localization/spell_identity.py").is_file():
        raise ValueError("Repository must contain the published localization tools")
    return selected


_bootstrap=argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--repo")
REPO=find_repo(_bootstrap.parse_known_args()[0].repo)
TOOL_ROOT=REPO/"tools/xlsx-localization"
BASE=REPO.parent/"_audit/xlsx-spell-main-lists"


def allowed_output(directory,prefix):
    target=Path(directory).resolve();root=BASE.resolve()
    if target==root or root not in target.parents:
        raise ValueError("Output must be an exclusive child directory of "+str(root))
    if not target.name.startswith(prefix):
        raise ValueError("Output directory name must start with "+prefix)
    return target

PORTABLE=TOOL_ROOT/"spell_package.py"
PORTABLE_SHA="f9c3ba44ddf808a45de099ec0655d746761c835be5d7ef76c4858ae2fe8c37cc"
PLAN_FILE=TOOL_ROOT/"spell_main_lists_plan.py"
PLAN_SHA="7d5eec5bb3d096d805b51afaa16296f1e9183309798f7cb4c873c75c3f4dc431"
INPUT_SHA={"2014":"a12a0f5edcb85cb1cfd114468e7a74f65f08f3a0f3f9434c9edc0a8e5966bef4","2024":"1a8df21c9aa7d54037e48df9bf6153b9b86e710a56457410825218a15eceb59c"}
sha=lambda b:hashlib.sha256(b).hexdigest()

def load(path,pin,name):
    raw=path.read_bytes().replace(b"\r\n",b"\n")
    assert sha(raw)==pin,(str(path),"frozen code changed")
    module=types.ModuleType(name);module.__file__=str(path);sys.modules[name]=module
    exec(compile(raw,str(path),"exec"),module.__dict__)
    return module


p=load(PORTABLE,PORTABLE_SHA,"main_list_portable")
s,l=p.load_tools();sel=p.load_selection(l)
sys.modules["spell_selection_plan"]=sel
planner=load(PLAN_FILE,PLAN_SHA,"main_list_planner")
q=p.q


def append_helpers(raw,definitions):
    existing={a["r"]:b for a,b,_,_ in p.spans(raw,"c")}
    assert not existing.keys() & {d["cell"] for d in definitions}
    generated=p.serialize_sheet(definitions)
    additions={a["r"]:b for a,b,_,_ in p.spans(generated,"c")}
    byrow={}
    for address,body in additions.items():byrow.setdefault(p.coordinate(address)[1],[]).append((p.coordinate(address)[0],body))
    _,data,a,b=p.spans(raw,"sheetData")[0]
    rows={int(attrs["r"]):body for attrs,body,_,_ in p.spans(data,"row")}
    assert p.without(data,"row")==b"<sheetData></sheetData>","Unexpected generated row surroundings"
    for row,entries in byrow.items():
        newcells=b"".join(body for _,body in sorted(entries))
        if row in rows:
            prior=p.spans(rows[row],"c")
            assert all(attrs=={"r":str(row)} for attrs,_,_,_ in p.spans(rows[row],"row"))
            assert min(col for col,_ in entries)>max(p.coordinate(attrs["r"])[0] for attrs,_,_,_ in prior)
            rows[row]=rows[row][:-6]+newcells+b"</row>"
        else:rows[row]=f'<row r="{row}">'.encode()+newcells+b"</row>"
    updated=b"<sheetData>"+b"".join(body for _,body in sorted(rows.items()))+b"</sheetData>"
    result=raw[:a]+updated+raw[b:]
    addresses=list(existing)+list(additions)
    maxcol=max(p.coordinate(c)[0] for c in addresses);maxrow=max(p.coordinate(c)[1] for c in addresses)
    letters="";remaining=maxcol
    while remaining:remaining,r=divmod(remaining-1,26);letters=chr(65+r)+letters
    _,dimension,a,b=p.spans(result,"dimension")[0]
    result=result[:a]+p.set_attrs(dimension,"dimension",{"ref":"A1:"+letters+str(maxrow)})+result[b:]
    return result


def apply(version,source,raw,plan):
    assert sha(raw)==INPUT_SHA[version] and sha(source)==plan["source"]["sha256"]
    with zipfile.ZipFile(io.BytesIO(source)) as original:
        for edit in plan["validationEdits"]:
            body=original.read(edit["part"])
            assert sha(body)==edit["sourcePartSha256"] and body.count(edit["oldXML"].encode())==1
    package=s.p.read_package(raw);parts=dict(package.parts)
    select=next(sheet for sheet in package.sheets if sheet["name"]==plan["appendToSheet"])
    parts[select["part"]]=append_helpers(parts[select["part"]],plan["helperCells"])
    for name in plan["definedNames"]:parts[s.p.WORKBOOK]=p.add_name(parts[s.p.WORKBOOK],name)
    for edit in plan["validationEdits"]:
        old=edit["oldXML"].encode();assert sha(old)==edit["oldXMLSha256"]
        assert parts[edit["part"]].count(old)==1,"DV receipt missing from actual candidate"
        formula=p.spans(old,"formula1");assert len(formula)==1
        _,_,a,b=formula[0]
        updated=old[:a]+b"<formula1>"+escape(edit["formula1"]).encode()+b"</formula1>"+old[b:]
        parts[edit["part"]]=parts[edit["part"]].replace(old,updated,1)
    return p.package_bytes(package,parts,[]),select["part"]


def verify(version,before_raw,after_raw,plan,select_part):
    before,after=s.p.read_package(before_raw),s.p.read_package(after_raw)
    assert sha(before_raw)==INPUT_SHA[version]
    assert before.parts.keys()==after.parts.keys() and before.sheets==after.sheets
    props=('date_time','compress_type','comment','extra','create_system','create_version','extract_version','internal_attr','external_attr','flag_bits')
    assert before.comment==after.comment and all(getattr(a,k)==getattr(b,k) for a,b in zip(before.infos,after.infos) for k in props)
    touched={select_part,s.p.WORKBOOK}|{e["part"] for e in plan["validationEdits"]}
    assert all(before.parts[k]==after.parts[k] for k in before.parts if k not in touched),"Unrelated part changed"
    added={c["cell"]:c for c in plan["helperCells"]}
    assert len(added)==(402 if version=="2014" else 2)
    compared=0;formula_count=0
    for sheet in before.sheets:
        old,new=before.parts[sheet["part"]],after.parts[sheet["part"]]
        a={attrs["r"]:raw for attrs,raw,_,_ in p.spans(old,"c")}
        b={attrs["r"]:raw for attrs,raw,_,_ in p.spans(new,"c")}
        assert len(b)==len(list(ET.fromstring(new).iter(q("c")))),"Duplicate actual cell"
        if sheet["part"]==select_part:
            assert b.keys()==a.keys()|added.keys() and not a.keys()&added.keys()
            for address,definition in added.items():
                node=ET.fromstring(b[address]);f=node.find("f")
                assert node.attrib=={"r":address} and len(node)==1 and f is not None and not f.attrib and f.text==definition["formula"],"Wrong appended helper/cache"
            # Remove only new cells, then newly introduced empty rows, then
            # restore old dimension; exact old generated sheet bytes must result.
            restored=new
            for attrs,body,start,end in reversed(p.spans(restored,"c")):
                if attrs["r"] in added:restored=restored[:start]+restored[end:]
            oldrows={attrs["r"] for attrs,_,_,_ in p.spans(old,"row")}
            for attrs,body,start,end in reversed(p.spans(restored,"row")):
                if attrs["r"] not in oldrows:
                    assert not list(ET.fromstring(body)),"New row retained unexpected child"
                    restored=restored[:start]+restored[end:]
            old_dim=p.spans(old,"dimension")[0][1]
            _,_,start,end=p.spans(restored,"dimension")[0]
            restored=restored[:start]+old_dim+restored[end:]
            assert restored==old,"Old Select sheet bytes changed"
            maxrow=max(p.coordinate(c)[1] for c in b)
            assert ET.fromstring(new).find(q("dimension")).attrib=={"ref":"A1:N"+str(maxrow)},"New dimension incorrect"
        else:
            assert a.keys()==b.keys()
            assert p.without(p.without(old,"c"),"dataValidations")==p.without(p.without(new,"c"),"dataValidations"),"Worksheet surroundings changed"
        assert all(a[c]==b[c] for c in a),"Old cell bytes changed"
        compared+=len(a)
        for body in b.values():
            cell=ET.fromstring(body)
            if cell.find("f") is not None:
                assert cell.find("v") is None,"Formula cache fabricated"
                formula_count+=1
    for part in {e["part"] for e in plan["validationEdits"]}:
        old,new=before.parts[part],after.parts[part]
        old_nodes=p.spans(old,"dataValidation");new_nodes=p.spans(new,"dataValidation")
        assert len(old_nodes)==len(new_nodes)
        expected={e["sqref"]:e for e in plan["validationEdits"] if e["part"]==part}
        for (oldattrs,oldxml,_,_),(newattrs,newxml,_,_) in zip(old_nodes,new_nodes):
            assert oldattrs==newattrs,"DV attributes or coverage changed"
            if oldattrs["sqref"] not in expected:assert oldxml==newxml
            else:
                edit=expected[oldattrs["sqref"]]
                assert oldxml.decode()==edit["oldXML"] and ET.fromstring(newxml).findtext("formula1")==edit["formula1"],"Wrong DV formula"
                assert p.without(oldxml,"formula1")==p.without(newxml,"formula1"),"DV other children changed"
        assert p.without(old,"dataValidation")==p.without(new,"dataValidation"),"DV parent or surroundings changed"
    restored=after.parts[s.p.WORKBOOK]
    for definition in plan["definedNames"]:
        matches=[(attrs,body) for attrs,body,_,_ in p.spans(restored,"definedName") if attrs.get("name")==definition["name"]]
        assert len(matches)==1 and matches[0][0]=={"name":definition["name"],"hidden":"1"},"Defined name registration changed"
        assert ET.fromstring(matches[0][1]).text==definition["formula"],"Wrong defined-name formula"
        restored=restored.replace(matches[0][1],b"",1)
    assert restored==before.parts[s.p.WORKBOOK],"Unrelated workbook metadata changed"
    return {"version":version,"inputSha256":sha(before_raw),"outputSha256":sha(after_raw),"originalCellsByteCompared":compared,
            "addedHelperCells":len(added),"validationFormulaEdits":len(plan["validationEdits"]),"addedNames":len(plan["definedNames"]),"allWorksheetFormulaCellsWithoutCache":formula_count,
            "unchangedFAndK":True,"unchangedInputStyleAndCoverage":True,"externalCachesRetained":True,"nativeCalculated":False,"uploadReady":False}



def run(directory=None):
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output=allowed_output(directory or BASE/("main-lists-candidate-"+stamp),"main-lists-candidate-")
    output.mkdir(parents=True,exist_ok=False)
    # Published phase20 owns the fresh original -> AV1 -> shield -> selection
    # pipeline and its own exclusive output directory. Its globals are not changed.
    upstream=p.run()
    reports={}
    for version in ("2014","2024"):
        plan=planner.build(version)
        base=sel.build_plan(version);assert sha(sel.canonical(base))==plan["selectionPlanSha256"]
        original=REPO/"public"/plan["source"]["filename"];source=original.read_bytes()
        incoming=Path(upstream["versions"][version]["output"]);raw=incoming.read_bytes()
        candidate,select_part=apply(version,source,raw,plan)
        result=verify(version,raw,candidate,plan,select_part)
        assert plan==planner.build(version) and original.read_bytes()==source and incoming.read_bytes()==raw
        target=output/f"{version}-MAIN-LISTS-NO-CACHE-NOT-FOR-UPLOAD.xlsx"
        with target.open("xb") as f:f.write(candidate)
        assert target.read_bytes()==candidate
        with (output/f"{version}-plan.json").open("x",encoding="utf8",newline="\n") as f:f.write(json.dumps(plan,ensure_ascii=False,indent=2)+"\n")
        reports[version]={**result,"input":str(incoming),"output":str(target),"selectPart":select_part,"source":plan["source"],"planSha256":sha(sel.canonical(plan))}
    with (output/"report.json").open("x",encoding="utf8",newline="\n") as f:f.write(json.dumps(reports,ensure_ascii=False,indent=2)+"\n")
    return {"output":str(output),"phase20Output":upstream["output"],"reports":reports,"nativeCalculated":False,"uploadReady":False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo")
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    print(json.dumps(run(args.output),ensure_ascii=False))


if __name__=="__main__":main()
