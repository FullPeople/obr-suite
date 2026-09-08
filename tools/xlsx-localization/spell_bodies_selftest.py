"""Actual isolated 2014 body CLI + Artifact export checks, not core audit replays.

Pass bundled Node, its node_modules directory, and the spreadsheet operation
marker explicitly. The successful fixture contains only required source files;
no historical audit path or prebuilt target/seed workbook is copied into it.
"""
import argparse
from datetime import datetime,timezone
import hashlib,io,json,os,re,shutil,subprocess,sys,tempfile,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
BASE=REPO.parent/"_audit/xlsx-spell-bodies"
TOOLS=("export_formula.py","export_package.py","shield_package.py","spell_identity.py",
       "spell_lookup_plan.py","spell_selection_plan.py","spell_package.py",
       "spell_main_lists_plan.py","spell_main_lists_package.py","prepare.py",
       "spell_bodies_plan.py","spell_bodies_package.py","author_targets.mjs")
ORIGINALS=("DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx","DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx")
EXPECTED="84333210fcf8788159e57f44b4c1b2ebc01718f764d39ab1aab3020fe351d663"
EXPECTED_SEED="27103d8af79de8a3dfd0bf1af02d785e69f2f3848d158c3a156dbfc2d7d84ece"
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node",type=Path,required=True)
    parser.add_argument("--node-modules",type=Path,required=True)
    parser.add_argument("--artifact-marker",type=Path,required=True)
    args=parser.parse_args()
    for path in (args.node,args.node_modules,args.artifact_marker):
        if not path.exists():raise ValueError("Missing explicit bundled runtime input: "+str(path))
    output=BASE/("portable-selftest-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    output.mkdir(parents=True,exist_ok=False)
    success=output/"successful-isolation/obr-suite"
    failure=output/"rejection-isolation/obr-suite"
    checks=[];commands=[];author_commands=[]
    def check(name,condition):
        if not condition:raise AssertionError(name)
        checks.append(name)
    def snapshot(repository):
        return {p.relative_to(repository).as_posix():sha(p.read_bytes()) for p in repository.rglob("*") if p.is_file()}
    data=[HERE/"reviewed.jsonl",HERE/"glossary.json",*sorted((HERE/"reviews").glob("2014-*.jsonl"))]
    expected_files={"tools/xlsx-localization/"+name for name in TOOLS}|{"public/"+name for name in ORIGINALS}|{
        "tools/xlsx-localization/"+path.relative_to(HERE).as_posix() for path in data}
    def copy_repository(target):
        (target/"tools/xlsx-localization/reviews").mkdir(parents=True,exist_ok=False)
        (target/"public").mkdir()
        for name in TOOLS:shutil.copyfile(HERE/name,target/"tools/xlsx-localization"/name)
        for name in ORIGINALS:shutil.copyfile(REPO/"public"/name,target/"public"/name)
        for path in data:shutil.copyfile(path,target/"tools/xlsx-localization"/path.relative_to(HERE))
    copy_repository(success);copy_repository(failure)
    original_snapshot=snapshot(success)
    check("isolation contains only required tools, 2014 review data, glossary and two originals",set(original_snapshot)==expected_files)
    check("rejection isolation starts with identical inputs",snapshot(failure)==original_snapshot)
    def cli(repository,tool,arguments=(),needle=None,python_options=()):
        command=[sys.executable,"-B","-X","utf8",*python_options,str(repository/"tools/xlsx-localization"/tool),"--repo",str(repository),*map(str,arguments)]
        result=subprocess.run(command,cwd=output,capture_output=True,text=True,encoding="utf8")
        commands.append({"command":command,"returncode":result.returncode,"stdout":result.stdout,"stderr":result.stderr,"expectedRejection":needle})
        if needle:
            if result.returncode==0 or needle not in result.stderr:raise AssertionError((tool,needle,result.returncode,result.stderr))
        elif result.returncode:raise AssertionError((tool,result.returncode,result.stderr))
        return result
    planned=json.loads(cli(success,"spell_bodies_plan.py").stdout.strip().splitlines()[-1])
    check("standalone plan contains all 522 bodies and writes no workbook",planned["entries"]==522 and planned["workbookWritten"] is False)
    plan_path=Path(planned["plan"])
    fresh_plan=json.loads(plan_path.read_bytes())
    check("plan is bound to actual isolated review bytes",all(sha((success/path).read_bytes())==pin for path,pin in fresh_plan["review_hashes"].items()))
    # The repository/audit may be on SMB, where NTFS junction creation fails.
    # Only the isolated runtime helper lives on local temporary storage.
    author_dir=Path(tempfile.mkdtemp(prefix="obr-spell-bodies-artifact-"))
    builder=author_dir/"author_targets.mjs"
    shutil.copyfile(success/"tools/xlsx-localization/author_targets.mjs",builder)
    junction=author_dir/"node_modules"
    if os.name=="nt":
        linked=subprocess.run(["cmd","/d","/c","mklink","/J",str(junction),str(args.node_modules.resolve())],capture_output=True)
        if linked.returncode:raise RuntimeError("Could not create isolated bundled node_modules junction: "+linked.stderr.decode(errors="replace"))
    else:junction.symlink_to(args.node_modules.resolve(),target_is_directory=True)
    authored=output/"2014-authored-targets.xlsx"
    # One marker immediately before this run's first actual Artifact authoring.
    for label,command in (
        ("artifact-operation-marker",[str(args.node),str(args.artifact_marker),"--operation-kind","create","--expected-output-count","1","--output-format","xlsx"]),
        ("actual-artifact-authoring",[str(args.node),str(builder),str(plan_path),str(authored)])):
        result=subprocess.run(command,cwd=author_dir,capture_output=True,text=True,encoding="utf8")
        author_commands.append({"label":label,"command":command,"returncode":result.returncode,"stdout":result.stdout,"stderr":result.stderr})
        if result.returncode:raise AssertionError((label,result.returncode,result.stderr))
    check("unchanged actual author helper exported an inspected workbook",authored.is_file() and Path(str(authored)+".inspect.ndjson").is_file() and builder.read_bytes()==(HERE/"author_targets.mjs").read_bytes())
    built=json.loads(cli(success,"spell_bodies_package.py",["--authored-targets",authored]).stdout.strip().splitlines()[-1])
    check("actual exported A:D values were read back completely",built["authoredRowsReadBack"]==522 and built["authoredCellsReadBack"]==2092)
    check("author file identity is actual bytes, not a historical binary pin",built["authoredTargetsSha256"]==sha(authored.read_bytes()) and Path(built["authoredTargets"])==authored)
    check("fresh candidate matches audited 2014 package exactly",sha(Path(built["candidate"]).read_bytes())==EXPECTED==built["outputSha256"])
    seed=Path(built["input"])
    check("main-list seed is freshly generated inside this isolation",sha(seed.read_bytes())==EXPECTED_SEED and (success.parent/"_audit/xlsx-spell-main-lists").resolve() in seed.resolve().parents and seed.parent==Path(built["mainListsOutput"]))
    check("earlier original-to-selection stage is also isolated",(success.parent/"_audit/xlsx-spell-package").resolve() in Path(built["phase20Output"]).resolve().parents)
    check("standalone and package-regenerated plans are byte identical",plan_path.read_bytes()==(Path(built["output"])/"2014-body-plan.json").read_bytes())
    check("package retains engineering-only status",built["nativeCalculated"] is False and built["uploadReady"] is False)
    audit=built["preservation"]
    check("preservation report covers original cells, SST and rich runs",audit["allCellsCompared"]==69116 and audit["oldSSTNodesPreserved"]==6381 and audit["newSSTClones"]==522 and audit["richRunPropertiesByteExact"] is True and audit["formulaCellsWithoutCache"]==8778)
    for label,record,prefix in (("plan",planned,"spell-bodies-plan-"),("package",built,"spell-bodies-candidate-")):
        dest=Path(record["output"])
        check(label+" writes exclusively below selected repository audit root",dest.parent==(success.parent/"_audit/xlsx-spell-bodies").resolve() and dest.name.startswith(prefix))
    for tool in ("spell_bodies_plan.py","spell_bodies_package.py"):
        cli(failure,tool,["--help"],"Optimization mode is unsupported; verification requires assertions",("-O",))
        check(tool+" rejects optimization before dependency loading",True)
    for tool,prefix,extra in (("spell_bodies_plan.py","spell-bodies-plan-",[]),("spell_bodies_package.py","spell-bodies-candidate-",["--authored-targets",authored])):
        cli(failure,tool,[*extra,"--output",failure/"public"],"Output must be an exclusive child directory")
        cli(failure,tool,[*extra,"--output",failure.parent/"_audit/xlsx-spell-bodies"],"Output must be an exclusive child directory")
        cli(failure,tool,[*extra,"--output",failure.parent/"_audit/xlsx-spell-bodies/wrong-prefix"],"Output directory name must start with")
        occupied=failure.parent/"_audit/xlsx-spell-bodies"/(prefix+"existing")
        occupied.mkdir(parents=True);marker=occupied/"preserved.txt";marker.write_bytes(b"do not overwrite")
        cli(failure,tool,[*extra,"--output",occupied],"FileExistsError")
        check(tool+" refuses root, repository, wrong prefix and occupied outputs",marker.read_bytes()==b"do not overwrite")
    for dependency in ("prepare.py","spell_bodies_plan.py","spell_main_lists_package.py"):
        target=failure/"tools/xlsx-localization"/dependency;previous=target.read_bytes()
        target.write_bytes(previous+b"\n# deliberate rejection-only drift\n")
        cli(failure,"spell_bodies_package.py",["--authored-targets",authored],"Frozen dependency changed: "+dependency)
        target.write_bytes(previous)
        check("modified "+dependency+" rejected before application",True)
    original=failure/"public"/ORIGINALS[0];original_bytes=original.read_bytes()
    original.write_bytes(original_bytes+b"deliberate source drift")
    cli(failure,"spell_bodies_plan.py",[],"Source workbook changed before planning")
    cli(failure,"spell_bodies_package.py",["--authored-targets",authored],"Frozen input changed:")
    original.write_bytes(original_bytes)
    check("both entrypoints reject original workbook drift",True)
    # A valid-XML rejection fixture only: swap the actual D2 value to D3. This is
    # not an alternative authoring path or a candidate-generation implementation.
    bad_author=output/"rejection-authored-targets.xlsx"
    original_author=authored.read_bytes()
    with zipfile.ZipFile(io.BytesIO(original_author)) as z:
        parts={i.filename:z.read(i) for i in z.infolist()};infos=z.infolist();comment=z.comment
    sheet_parts=[n for n in parts if re.fullmatch(r"xl/worksheets/[^/]+\.xml",n)]
    check("actual author export has one worksheet for the targeted fixture",len(sheet_parts)==1)
    part=sheet_parts[0];raw=parts[part]
    root=ET.fromstring(raw);ns="{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    matches={ref:[c for c in root.iter(ns+"c") if c.get("r")==ref] for ref in ("D2","D3")}
    check("author fixture has two unique actual string targets",all(len(v)==1 for v in matches.values()) and all(v[0].get("t")=="str" for v in matches.values()))
    a,b=matches["D2"][0],matches["D3"][0]
    va,vb=a.findall(ns+"v"),b.findall(ns+"v")
    check("author fixture replaces one differing actual value",len(va)==len(vb)==1 and va[0].text!=vb[0].text)
    before_values={c.get("r"):ET.tostring(c) for c in root.iter(ns+"c")}
    va[0].text=vb[0].text
    after_values={c.get("r"):ET.tostring(c) for c in root.iter(ns+"c")}
    check("only D2 changes semantically in the valid-XML fixture",[ref for ref in before_values if before_values[ref]!=after_values[ref]]==["D2"])
    updated=ET.tostring(root,encoding="utf-8")
    ET.fromstring(updated);parts[part]=updated
    with zipfile.ZipFile(bad_author,"x") as z:
        z.comment=comment
        for info in infos:z.writestr(info,parts[info.filename])
    cli(failure,"spell_bodies_package.py",["--authored-targets",bad_author],"Authored target row mismatch: 2")
    check("parseable wrong authored row is rejected specifically",True)
    check("successful source tree remains byte unchanged",snapshot(success)==original_snapshot)
    check("canonical copied tools remain byte unchanged",all(sha((HERE/n).read_bytes())==original_snapshot["tools/xlsx-localization/"+n] for n in TOOLS))
    check("canonical originals remain byte unchanged",all(sha((REPO/"public"/n).read_bytes())==original_snapshot["public/"+n] for n in ORIGINALS))
    check("successful output and actual author file survive all rejection tests",sha(Path(built["candidate"]).read_bytes())==EXPECTED and authored.read_bytes()==original_author)
    record={"checks":len(checks),"checkNames":checks,"cliCalls":len(commands),"commands":commands,"artifactCommands":author_commands,"artifactWorkingDirectory":str(author_dir),
            "successfulSource":str(success),"successfulSourceHashes":original_snapshot,"successfulOutput":built["output"],"rejectionSource":str(failure),
            "packageResult":built,"planResult":planned,"newToolHashes":{n:sha((HERE/n).read_bytes()) for n in ("spell_bodies_plan.py","spell_bodies_package.py",Path(__file__).name)},
            "native":False,"oldAuditTestsRerun":False,"wrapperAuthorVerification":True}
    with (output/"result.json").open("x",encoding="utf8",newline="\n") as f:f.write(json.dumps(record,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"checks":len(checks),"cliCalls":len(commands),"result":str(output/"result.json"),"successfulSource":str(success),"successfulOutput":built["output"]},ensure_ascii=False))


if __name__=="__main__":main()
