"""Verify the four-patch chain and actual corrected parser in a fresh directory.

Reads the exact preceding parser; writes isolated review copies only. No service
installation, XLSX save, recalculation or public download replacement occurs.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from unittest.mock import patch

import apply_parser_patch as delivery

if not __debug__:
    raise RuntimeError("Verification requires assertions; do not use -O")


def load(path, name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require(ok, message):
    if not ok:
        raise delivery.IntegrityError(message)


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--source",type=Path,required=True,help="Unchanged spell-aliases result parser")
    cli.add_argument("--xlsx-dir",type=Path,required=True)
    cli.add_argument("--out-dir",type=Path,required=True,help="New evidence directory")
    args=cli.parse_args()
    manifest=delivery.load_manifest()
    before=args.source.read_bytes()
    after=delivery.transform(before,"apply")
    require(delivery.transform(after,"reverse")==before,"Current patch round-trip differs")
    packages=("sheet-aliases-20260908","shield-input-20260908","spell-aliases-20260908")
    require(tuple(manifest["prerequisite_packages"])==packages,"Unexpected prerequisite chain")
    frozen={}
    for name,entries in manifest["prerequisite_packages"].items():
        for file,digest in entries.items():
            require(Path(file).name==file,"Invalid prerequisite filename")
            path=delivery.HERE.parent/name/file
            raw=path.read_bytes()
            require(delivery.sha256(raw)==digest,"Changed prerequisite: "+str(path))
            frozen[path]=raw
    chain=[before]
    for index,name in enumerate(reversed(packages)):
        prior=load(delivery.HERE.parent/name/"apply_parser_patch.py",f"main_prior_{index}")
        previous=prior.transform(chain[-1],"reverse")
        require(prior.transform(previous,"apply")==chain[-1],"Prerequisite round-trip differs")
        chain.append(previous)
    for entry in manifest["workbooks"]:
        require(Path(entry["name"]).name==entry["name"],"Invalid workbook filename")
        path=args.xlsx_dir/entry["name"]
        raw=path.read_bytes()
        require(delivery.sha256(raw)==entry["sha256"],"Unknown original workbook")
        frozen[path]=raw
    require(len(manifest["tests"])==1 and manifest["tests"][0]["file"]=="test_main_fields.py","Unexpected test list")
    for entry in manifest["tests"]:
        path=delivery.HERE/entry["file"];raw=path.read_bytes()
        require(delivery.sha256(raw)==entry["sha256"] and len(raw)==entry["bytes"],"Changed packaged tests")
        frozen[path]=raw
    # Verify every delivered file, including this verifier, before any output.
    for line in (delivery.HERE/"files.sha256").read_text(encoding="utf-8").splitlines():
        digest,name=line.split("  ",1)
        require(Path(name).name==name and re.fullmatch(r"[0-9a-f]{64}",digest),"Invalid delivery index")
        path=delivery.HERE/name;raw=path.read_bytes()
        require(delivery.sha256(raw)==digest,"Changed delivered file: "+name)
        frozen[path]=raw
    out=args.out_dir.resolve()
    out.mkdir(parents=True,exist_ok=False)
    (out/"baseline").mkdir();(out/"current").mkdir()
    (out/"baseline/parser.py").write_bytes(before)
    (out/"current/parser.py").write_bytes(after)
    for index,raw in enumerate(chain[1:],1):
        (out/f"prior-{index}.py").write_bytes(raw)
    guards=load(delivery.HERE.parent/packages[0]/"verify_delivery.py","main_prior_guards")
    guards.delivery=delivery
    with patch.dict(os.environ,{"PYTHONUTF8":"1"}):
        guard_results=guards.guard_checks(out,before,after)
    env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1","OBR_MAIN_FIELDS_PARSER":str(out/"current/parser.py"),
         "OBR_MAIN_FIELDS_BASELINE":str(out/"baseline/parser.py"),"OBR_MAIN_FIELDS_PUBLIC":str(args.xlsx_dir.resolve())}
    command=[sys.executable,"-B","-X","utf8","-W","ignore::DeprecationWarning",str(delivery.HERE/"test_main_fields.py")]
    result=subprocess.run(command,env=env,capture_output=True,text=True,encoding="utf-8",timeout=180)
    for stream in ("stdout","stderr"):
        (out/f"tests.{stream}.log").write_text(getattr(result,stream),encoding="utf-8",newline="\n")
    require(result.returncode==0,f"Actual parser tests failed; inspect {out}")
    count=re.search(r"Ran (\d+) tests",result.stderr)
    require(count and int(count[1])==manifest["expected_tests"],"Unexpected test count")
    require(args.source.read_bytes()==before,"Input parser changed")
    require(all(path.read_bytes()==raw for path,raw in frozen.items()),"Frozen source changed")
    require((out/"current/parser.py").read_bytes()==after,"Review parser changed")
    report={"before_sha256":delivery.sha256(before),"after_sha256":delivery.sha256(after),
            "four_patch_chain_apply_reverse_exact":True,"tests_passed":int(count[1]),
            "integrity_guards":guard_results,"source_parser_unchanged":True,"workbooks_unchanged":True,
            "prior_packages_unchanged":True,"deployed":False,"xlsx_recalculation_verified":False}
    (out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
