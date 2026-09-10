"""Portable packager integration checks using separate success/failure copies.

No historical audit inputs. The successful isolated source tree remains intact.
This tests packaging and provenance, not native spreadsheet calculation or UI.
"""
from __future__ import annotations
from datetime import datetime,timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
BASE=REPO.parent/"_audit"/"xlsx-spell-package"
TOOLS=("spell_package.py","shield_package.py","export_package.py","export_formula.py","spell_identity.py","spell_lookup_plan.py","spell_selection_plan.py")
EXPECTED={"2014":"a12a0f5edcb85cb1cfd114468e7a74f65f08f3a0f3f9434c9edc0a8e5966bef4",
          "2024":"1a8df21c9aa7d54037e48df9bf6153b9b86e710a56457410825218a15eceb59c"}
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def require(ok,message):
    if not ok:raise AssertionError(message)


def main():
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output=BASE/("portable-selftest-"+stamp)
    output.mkdir(parents=True,exist_ok=False)
    success=output/"successful-isolation"/"obr-suite"
    failed=output/"rejection-isolation"/"obr-suite"
    functions=[]; commands=[]
    def check(label,ok):require(ok,label);functions.append(label)
    def copy_repo(target):
        (target/"tools/xlsx-localization").mkdir(parents=True,exist_ok=False)
        (target/"public").mkdir()
        for name in TOOLS:shutil.copyfile(HERE/name,target/"tools/xlsx-localization"/name)
        for name in ("DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx","DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx"):
            shutil.copyfile(REPO/"public"/name,target/"public"/name)
    copy_repo(success);copy_repo(failed)
    frozen={str(p.relative_to(success)):sha(p.read_bytes()) for p in success.rglob("*") if p.is_file()}
    expected_files={"tools/xlsx-localization/"+name for name in TOOLS}|{"public/DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx","public/DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx"}
    check("isolated source contains only seven tools and two originals",{p.replace("\\","/") for p in frozen} == expected_files)
    def cli(repository,args=(),expected=0,needle=None):
        process=subprocess.run([sys.executable,"-B","-X","utf8",str(repository/"tools/xlsx-localization/spell_package.py"),"--repo",str(repository),*map(str,args)],cwd=output,capture_output=True,text=True)
        commands.append({"repository":str(repository),"args":list(map(str,args)),"returncode":process.returncode,"stdout":process.stdout,"stderr":process.stderr})
        require((process.returncode == 0) if expected == 0 else (process.returncode != 0),"Unexpected CLI outcome")
        if needle:require(needle in process.stderr,"Missing expected refusal: "+needle)
        return process
    process=cli(success)
    result=json.loads(process.stdout.strip().splitlines()[-1])
    check("successful default CLI declares no native/upload acceptance",result["nativeCalculated"] is False and result["uploadReady"] is False)
    success_output=Path(result["output"])
    check("default output is absolute and beneath isolated audit",success_output.is_absolute() and (success.parent/"_audit/xlsx-spell-package").resolve() in success_output.resolve().parents)
    for version,report in result["versions"].items():
        actual=Path(report["output"])
        check(version+" absolute output path",actual.is_absolute() and actual.parent == success_output)
        check(version+" matches final audit engineering bytes",sha(actual.read_bytes()) == EXPECTED[version] == report["outputSha256"])
        check(version+" original source still pinned",sha((success/"public"/report["source"]["filename"]).read_bytes()) == report["source"]["sha256"])
    failure_base=failed.parent/"_audit/xlsx-spell-package"
    cli(failed,["--output",failed/"public"],1,"Output must be an exclusive child directory")
    cli(failed,["--output",failure_base/"wrong-prefix"],1,"Output directory name must start")
    occupied=failure_base/"spell-candidate-already-exists";occupied.mkdir(parents=True)
    marker=occupied/"preserved.bin";marker.write_bytes(b"existing output untouched")
    cli(failed,["--output",occupied],1,"FileExistsError")
    check("exclusive-output refusal retains pre-existing file",marker.read_bytes() == b"existing output untouched")
    identity=failed/"tools/xlsx-localization/spell_identity.py";identity_before=identity.read_bytes()
    identity.write_bytes(identity_before+b"\n# deliberate rejection-test drift\n")
    cli(failed,[],1,"Frozen dependency changed: spell_identity.py")
    identity.write_bytes(identity_before)
    original=failed/"public/DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx";original_before=original.read_bytes()
    original.write_bytes(original_before+b"deliberate source drift")
    cli(failed,[],1,"Source workbook changed before planning")
    # Failure isolation is deliberately left with its source-drift evidence.
    check("successful isolated source tree unchanged after all checks",frozen == {str(p.relative_to(success)):sha(p.read_bytes()) for p in success.rglob("*") if p.is_file()})
    check("canonical tools unchanged",all(sha((HERE/name).read_bytes()) == frozen[str(Path("tools/xlsx-localization")/name)] for name in TOOLS))
    check("canonical originals unchanged",all(sha((REPO/name).read_bytes()) == digest for name,digest in frozen.items() if name.startswith("public")))
    for version,report in result["versions"].items():check(version+" final output bytes still exact",sha(Path(report["output"]).read_bytes()) == EXPECTED[version])
    record={"checks":len(functions),"checkNames":functions,"cliCalls":len(commands),"commands":commands,"successfulSource":str(success),"successfulOutput":str(success_output),"successfulSourceHashes":frozen,
            "rejectionSource":str(failed),"sourceHashes":{p.name:sha(p.read_bytes()) for p in (HERE/"spell_package.py",Path(__file__))},"result":result,"native":False,"visualAccepted":False}
    (output/"result.json").write_text(json.dumps(record,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(json.dumps({"checks":len(functions),"cliCalls":len(commands),"result":str(output/"result.json"),"successfulSource":str(success),"successfulOutput":str(success_output)},ensure_ascii=False))


if __name__ == "__main__":main()
