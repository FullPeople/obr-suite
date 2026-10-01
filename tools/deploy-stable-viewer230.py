"""Update only the legacy stable read-only viewer after the paired 230 release."""
from pathlib import Path, PurePosixPath
import argparse, ctypes, hashlib, io, json, os, shutil, subprocess, tarfile, tempfile, zipfile
ROOT=Path('/var/www/obr-plugins')
TARGETS=['suite']
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def tree(path):
    assert path.is_dir() and not path.is_symlink()
    result={}
    for p in sorted(path.rglob('*')):
        assert not p.is_symlink(),str(p)
        if p.is_file():result[p.relative_to(path).as_posix()]=sha(p)
    return result
def protected():
    files=[Path('/etc/nginx/sites-enabled/obr-plugins').resolve(),Path('/opt/obr-three-dragon/server.mjs')]+[Path('/opt/obr-workbench-relay-dev')/n for n in ['server.mjs','documents.mjs','patches.mjs']]
    services={}
    for s in ['obr-workbench-relay-dev','obr-three-dragon']:
        assert subprocess.check_output(['systemctl','is-active',s],text=True).strip()=='active'
        services[s]=subprocess.check_output(['systemctl','show',s,'-p','ActiveEnterTimestampMonotonic'],text=True)
    return {'files':{str(p):sha(p) for p in files},'services':services,'sites':{s:tree(ROOT/s) for s in ['card','suite-dev','dice-lab-dev','three-dragon-ante-dev']}}
def exchange(a,b):
    assert a.parent==b.parent and a.parent in [ROOT/n for n in TARGETS]
    lib=ctypes.CDLL(None,use_errno=True)
    if lib.renameat2(-100,os.fsencode(a),-100,os.fsencode(b),2):raise OSError(ctypes.get_errno(),'Viewer exchange failed')
def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--archives',type=Path,default=Path(__file__).parent);a=p.parse_args()
    receipt=json.loads((a.archives/'receipt.json').read_text());assert receipt['release']==230
    archive=a.archives/'viewers230.tar.gz';assert sha(archive)==receipt['sha256'];expected=receipt['hashes']
    with tarfile.open(archive) as t:
        members=t.getmembers();assert len(members)==len(expected) and {m.name for m in members}==set(expected)
        for m in members:
            n=PurePosixPath(m.name);assert m.isfile() and not n.is_absolute() and '..' not in n.parts and '\\' not in m.name and ':' not in m.name and str(n)==m.name
            assert m.name.startswith(('assets/','dice/','support/')) or m.name in ['index.html','sw.js','source.zip','LICENSE','LICENSE.txt','LICENSING.md','third-party-licenses.txt','exe_icon.png','favicon.svg','owner-step1.png','owner-step2.png','owner-step3.png','bridge.js','VIEWER-NOTE.txt','startup-viewer230.json','startup-viewer230-hashes.json'],m.name
            data=t.extractfile(m).read();assert hashlib.sha256(data).hexdigest()==expected[m.name]
            if m.name=='source.zip':
                with zipfile.ZipFile(io.BytesIO(data)) as z:assert z.comment.decode()==receipt['webCommit'] and z.testzip() is None
    assert json.loads((ROOT/'card/release.json').read_text())['sourceCommit']==receipt['webCommit'],'Merged site release not live'
    assert json.loads((ROOT/'suite-dev/manifest-dev.json').read_text())['version']=='1.0.230-dev'
    assert json.loads((ROOT/'suite/manifest.json').read_text())['version']=='1.3.13'
    assert zipfile.ZipFile(ROOT/'suite-dev/source.zip').comment.decode()==receipt['webCommit']
    assert not (ROOT/'startup-viewers230-deployment.json').exists()
    for site in TARGETS:
        baseline=ROOT/site/'card-viewer'
        assert tree(baseline)==receipt['baselineViewerHashes'],'Viewer baseline changed'
    originals={s:tree(ROOT/s) for s in TARGETS};guard=protected()
    for s in TARGETS:assert not (ROOT/s/'card-viewer-before-startup230').exists()
    report={'release':230,'webCommit':receipt['webCommit'],'targets':[s+'/card-viewer' for s in TARGETS],'filesPerViewer':len(expected),'onlyViewersChanged':True,'servicesUnchanged':True,'playerDataWritten':False,'hostManifestUnchanged':True,'realRoomVerified':False}
    if not a.apply:print(json.dumps({**report,'preflightPassed':True,'writes':False},indent=2));return
    stages={};swapped=[]
    try:
        for s in TARGETS:
            stage=Path(tempfile.mkdtemp(prefix='.startup-viewer230-',dir=ROOT/s));stages[s]=stage
            shutil.copytree(ROOT/s/'card-viewer',stage,dirs_exist_ok=True)
            with tarfile.open(archive) as t:
                for m in t.getmembers():
                    dest=stage/m.name;assert dest.resolve().is_relative_to(stage)
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    with t.extractfile(m) as src,dest.open('wb') as dst:shutil.copyfileobj(src,dst)
                    os.chmod(dest,0o644)
            for d in [stage]+[d for d in stage.rglob('*') if d.is_dir()]:os.chmod(d,0o755)
            old={k[len('card-viewer/'):]:v for k,v in originals[s].items() if k.startswith('card-viewer/')}
            assert tree(stage)=={**old,**expected}
        # Stage directories are siblings inside the host root; exclude only our exact stages.
        def host(s):return {k:v for k,v in tree(ROOT/s).items() if not k.startswith(stages[s].name+'/')}
        assert all(host(s)==originals[s] for s in TARGETS),'Concurrent host publication'
        assert protected()==guard
        for s in TARGETS:exchange(ROOT/s/'card-viewer',stages[s]);swapped.append(s)
        assert all(host(s)=={**originals[s],**{'card-viewer/'+k:v for k,v in expected.items()}} for s in TARGETS)
        assert protected()==guard
        for s in TARGETS:
            old={k[len('card-viewer/'):]:v for k,v in originals[s].items() if k.startswith('card-viewer/')}
            assert tree(stages[s])==old
            backup=ROOT/s/'card-viewer-before-startup230';stages[s].rename(backup);stages[s]=backup
        report.update(applied=True,backups={s:str(p) for s,p in stages.items()})
        (ROOT/'startup-viewers230-deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    except BaseException:
        for s in reversed(swapped):exchange(ROOT/s/'card-viewer',stages[s])
        raise
if __name__=='__main__':main()
