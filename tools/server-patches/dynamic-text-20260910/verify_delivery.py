"""Verify the parser patch chain and native saved-card regression in isolation."""
import argparse,hashlib,importlib.util,json,os,re,subprocess,sys
from pathlib import Path
import apply_parser_patch as delivery
if not __debug__:raise RuntimeError('Verification requires assertions')
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def main():
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--source',type=Path,required=True);cli.add_argument('--saved-result',type=Path,required=True);cli.add_argument('--out-dir',type=Path,required=True);args=cli.parse_args()
    metadata=delivery.load_manifest();before=args.source.read_bytes();after=delivery.transform(before,'apply');assert delivery.transform(after,'reverse')==before
    pinned={}
    for line in (delivery.HERE/'files.sha256').read_text(encoding='utf8').splitlines():
        digest,name=line.split('  ',1);assert Path(name).name==name;file=delivery.HERE/name;pinned[file]=file.read_bytes();assert hashlib.sha256(pinned[file]).hexdigest()==digest
    packages=[]
    for name,digests in metadata['prerequisite_packages'].items():
        for file,digest in digests.items():
            path=delivery.HERE.parent/name/file;pinned[path]=path.read_bytes();assert hashlib.sha256(pinned[path]).hexdigest()==digest
        packages.append(load(delivery.HERE.parent/name/'apply_parser_patch.py',name))
    source=before
    for package in reversed(packages):source=package.transform(source,'reverse')
    assert hashlib.sha256(source).hexdigest()=='b7f73c7fc06e11679b696b7b08e528ae9aaf455518a4f03bcb2eb1c645b6c9c1'
    for package in packages:source=package.transform(source,'apply')
    assert source==before
    guards=[]
    for label,input_bytes,direction,patch_bytes in [('wrong source',before+b'\n','apply',None),('wrong result',after+b'\n','reverse',None),('altered patch',before,'apply',(delivery.HERE/'parser.patch').read_bytes()+b'\n')]:
        try:delivery.transform(input_bytes,direction,patch_bytes=patch_bytes)
        except delivery.IntegrityError:guards.append(label)
        else:raise AssertionError('Accepted '+label)
    native=json.loads(args.saved_result.read_bytes());saved={Path(r['savedPath']):r['savedSha256'] for r in native['versions'].values()}
    assert len(saved)==2 and all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in saved.items())
    output=args.out_dir.resolve();output.mkdir(parents=True,exist_ok=False)
    (output/'before.py').write_bytes(before);(output/'parser.py').write_bytes(after)
    env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','OBR_DYNAMIC_PARSER':str(output/'parser.py'),'OBR_DYNAMIC_BASELINE':str(output/'before.py'),'OBR_DYNAMIC_SAVED_RESULT':str(args.saved_result.resolve()),'OBR_DYNAMIC_NATIVE_REPORT':str(output/'native-parser-regression.json')}
    cmd=[sys.executable,'-B','-X','utf8','-W','ignore::DeprecationWarning',str(delivery.HERE/'test_dynamic_text.py')]
    run=subprocess.run(cmd,env=env,capture_output=True,text=True,encoding='utf8',timeout=120)
    for name in ['stdout','stderr']:(output/('tests.'+name)).write_text(getattr(run,name),encoding='utf8')
    count=re.search(r'Ran (\d+) tests',run.stderr);assert run.returncode==0 and count and int(count[1])==metadata['expected_tests'],run.stderr
    assert all(p.read_bytes()==b for p,b in pinned.items()) and args.source.read_bytes()==before
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in saved.items())
    result={'sevenPatchChainExact':True,'guards':guards,'tests':int(count[1]),'beforeSha256':hashlib.sha256(before).hexdigest(),'afterSha256':hashlib.sha256(after).hexdigest(),'sourceAndSavedFilesUnchanged':True,'deployed':False}
    (output/'report.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8');print(json.dumps(result))
if __name__=='__main__':main()
