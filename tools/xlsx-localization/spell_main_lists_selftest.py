"""Phase21 CLI relocation evidence; not a replay of audit formula tests."""
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
BASE=REPO.parent/"_audit/xlsx-spell-main-lists"
TOOLS=("export_formula.py","export_package.py","shield_package.py","spell_identity.py","spell_lookup_plan.py","spell_selection_plan.py","spell_package.py","spell_main_lists_plan.py","spell_main_lists_package.py")
ORIGINALS=("DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx","DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx")
EXPECTED={"2014":"27103d8af79de8a3dfd0bf1af02d785e69f2f3848d158c3a156dbfc2d7d84ece","2024":"f2a1c3556220b0c5c31e36fbd419c34b9cf192f4896f512b2ba01bbc340a5453"}
PHASE20={"2014":"a12a0f5edcb85cb1cfd114468e7a74f65f08f3a0f3f9434c9edc0a8e5966bef4","2024":"1a8df21c9aa7d54037e48df9bf6153b9b86e710a56457410825218a15eceb59c"}
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
    output=BASE/("portable-selftest-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    output.mkdir(parents=True,exist_ok=False)
    success=output/"successful-isolation/obr-suite"
    failure=output/"rejection-isolation/obr-suite"
    checks=[];commands=[]
    def check(name,condition):
        if not condition:raise AssertionError(name)
        checks.append(name)
    def snapshot(repository):return {p.relative_to(repository).as_posix():sha(p.read_bytes()) for p in repository.rglob("*") if p.is_file()}
    def copy_repository(target):
        (target/"tools/xlsx-localization").mkdir(parents=True,exist_ok=False)
        (target/"public").mkdir()
        for name in TOOLS:shutil.copyfile(HERE/name,target/"tools/xlsx-localization"/name)
        for name in ORIGINALS:shutil.copyfile(REPO/"public"/name,target/"public"/name)
    copy_repository(success);copy_repository(failure)
    original_snapshot=snapshot(success)
    check("isolated source has only nine tools and two originals",len(original_snapshot)==11 and set(original_snapshot)=={"tools/xlsx-localization/"+n for n in TOOLS}|{"public/"+n for n in ORIGINALS})
    def cli(repository,tool,args=(),needle=None,python_options=()):
        result=subprocess.run([sys.executable,"-B","-X","utf8",*python_options,str(repository/"tools/xlsx-localization"/tool),"--repo",str(repository),*map(str,args)],cwd=output,capture_output=True,text=True)
        commands.append({"repository":str(repository),"tool":tool,"args":list(map(str,args)),"pythonOptions":list(python_options),"returncode":result.returncode,"stdout":result.stdout,"stderr":result.stderr})
        if needle:
            if result.returncode==0 or needle not in result.stderr:raise AssertionError((tool,needle,result.returncode,result.stderr))
        elif result.returncode:raise AssertionError((tool,result.returncode,result.stderr))
        return result
    planned=json.loads(cli(success,"spell_main_lists_plan.py").stdout.strip().splitlines()[-1])
    built=json.loads(cli(success,"spell_main_lists_package.py").stdout.strip().splitlines()[-1])
    check("plan CLI is JSON-only",planned["workbookWritten"] is False and set(planned["versions"])=={"2014","2024"})
    check("package CLI retains engineering status",built["nativeCalculated"] is False and built["uploadReady"] is False and set(built["reports"])=={"2014","2024"})
    expected_base=(success.parent/"_audit/xlsx-spell-main-lists").resolve()
    for label,record,prefix in (("plan",planned,"main-lists-plan-"),("package",built,"main-lists-candidate-")):
        dest=Path(record["output"])
        check(label+" default exclusive audit output",dest.is_absolute() and dest.parent==expected_base and dest.name.startswith(prefix))
    for version,report in built["reports"].items():
        final=Path(report["output"]);seed=Path(report["input"])
        check(version+" exact frozen audit package bytes",sha(final.read_bytes())==EXPECTED[version]==report["outputSha256"])
        check(version+" phase20 source was freshly generated in this isolation",sha(seed.read_bytes())==PHASE20[version] and Path(built["phase20Output"])==seed.parent and (success.parent/"_audit/xlsx-spell-package").resolve() in seed.resolve().parents)
        generated_plan=Path(built["output"])/(version+"-plan.json")
        check(version+" separate plan CLI agrees with applied regenerated plan",generated_plan.read_bytes()==Path(planned["versions"][version]["output"]).read_bytes())
        check(version+" original source unchanged",sha((success/"public"/report["source"]["filename"]).read_bytes())==report["source"]["sha256"])
    for tool in ("spell_main_lists_plan.py","spell_main_lists_package.py"):
        cli(failure,tool,["--help"],"Optimization mode is unsupported; verification requires assertions",("-O",))
    cli(failure,"spell_main_lists_package.py",["--output",failure/"public"],"Output must be an exclusive child directory")
    occupied=failure.parent/"_audit/xlsx-spell-main-lists/main-lists-candidate-existing"
    occupied.mkdir(parents=True);marker=occupied/"preserved.txt";marker.write_bytes(b"do not overwrite")
    cli(failure,"spell_main_lists_package.py",["--output",occupied],"FileExistsError")
    check("existing output survives refused overwrite",marker.read_bytes()==b"do not overwrite")
    for tool in ("spell_package.py","spell_main_lists_plan.py"):
        target=failure/"tools/xlsx-localization"/tool;previous=target.read_bytes()
        target.write_bytes(previous+b"\n# deliberate rejection-only drift\n")
        cli(failure,"spell_main_lists_package.py",[],"frozen code changed")
        target.write_bytes(previous)
    original=failure/"public"/ORIGINALS[0]
    original.write_bytes(original.read_bytes()+b"deliberate source drift")
    cli(failure,"spell_main_lists_package.py",[],"Source workbook changed before planning")
    # Preserve successful source bytes permanently. Deliberate source drift is
    # retained only in the separate rejection isolation for audit inspection.
    check("successful source tree untouched after rejection tests",snapshot(success)==original_snapshot)
    check("canonical tools unchanged",all(sha((HERE/n).read_bytes())==original_snapshot["tools/xlsx-localization/"+n] for n in TOOLS))
    check("canonical original workbooks unchanged",all(sha((REPO/"public"/n).read_bytes())==original_snapshot["public/"+n] for n in ORIGINALS))
    for version,report in built["reports"].items():check(version+" final successful output bytes intact",sha(Path(report["output"]).read_bytes())==EXPECTED[version])
    record={"checks":len(checks),"checkNames":checks,"cliCalls":len(commands),"commands":commands,"successfulSource":str(success),"successfulSourceHashes":original_snapshot,"successfulOutput":built["output"],"rejectionSource":str(failure),"packageResult":built,"planResult":planned,
            "newToolHashes":{n:sha((HERE/n).read_bytes()) for n in ("spell_main_lists_plan.py","spell_main_lists_package.py",Path(__file__).name)},"native":False,"oldAuditTestsRerun":False}
    with (output/"result.json").open("x",encoding="utf8",newline="\n") as f:f.write(json.dumps(record,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"checks":len(checks),"cliCalls":len(commands),"result":str(output/"result.json"),"successfulSource":str(success),"successfulOutput":built["output"]},ensure_ascii=False))


if __name__=="__main__":main()
