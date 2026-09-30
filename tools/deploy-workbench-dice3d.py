"""Version-guarded new-plugin-only static delta. Never change stable/card/lab/services."""
from pathlib import Path
import hashlib,json,os,shutil,tarfile,tempfile,subprocess,sys
previous,release=map(int,sys.argv[1:3]);assert 0<previous<release<100000
root=Path('/var/www/obr-plugins').resolve();live=root/'suite-dev';backup=root/f'suite-dev-before-dice3d{release}'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def tree(p):return {f.relative_to(p).as_posix():sha(f) for f in p.rglob('*') if f.is_file()}
assert json.loads((live/'manifest-dev.json').read_text())['version']==f'1.0.{previous}-dev','Live version changed; stop'
assert not backup.exists(),'Backup exists; stop'
baseline=tree(live);protected={name:tree(root/name) for name in ['suite','card','dice-lab-dev']}
services=['obr-workbench-relay-dev','obr-three-dragon'];starts={s:subprocess.check_output(['systemctl','show',s,'-p','ActiveEnterTimestampMonotonic'],text=True) for s in services}
nginx=sha(Path('/etc/nginx/sites-enabled/obr-plugins').resolve());delta=Path(tempfile.mkdtemp(prefix=f'.dice3d{release}-delta-',dir=root))
with tarfile.open(f'/tmp/suite-dev-dice3d{release}.tar.gz') as archive:
 for entry in archive.getmembers():assert (delta/entry.name).resolve().is_relative_to(delta) and (entry.isdir() or entry.isfile()),entry.name
 archive.extractall(delta,filter='data')
files=json.loads((delta/f'dice3d{release}-hashes.json').read_text())
for name,digest in files.items():
 assert (delta/name).resolve().is_relative_to(delta) and sha(delta/name)==digest,name
 assert not name.startswith(('workbench/','card-viewer/')) or name.endswith('/suite-source.zip'),name
assert json.loads((delta/'manifest-dev.json').read_text())['version']==f'1.0.{release}-dev'
for folder in ['workbench','card-viewer']:
 target=delta/folder/'suite-source.zip';target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(delta/'suite-source.zip',target);files[folder+'/suite-source.zip']=files['suite-source.zip']
(delta/f'dice3d{release}-hashes.json').write_text(json.dumps(files,indent=2))
stage=Path(tempfile.mkdtemp(prefix=f'.dice3d{release}-stage-',dir=root));shutil.copytree(live,stage,dirs_exist_ok=True);shutil.copytree(delta,stage,dirs_exist_ok=True)
unchanged={name:digest for name,digest in baseline.items() if name not in files and name!=f'dice3d{release}-hashes.json'}
for name,digest in unchanged.items():assert sha(stage/name)==digest,name
for file in stage.rglob('*'):os.chmod(file,0o755 if file.is_dir() else 0o644)
os.chmod(stage,0o755);assert tree(live)==baseline,'Live changed during staging; stop';live.rename(backup)
try:
 stage.rename(live)
 for name,digest in files.items():assert sha(live/name)==digest,name
 for name,digest in unchanged.items():assert sha(live/name)==digest,name
 assert all(tree(root/name)==data for name,data in protected.items()),'Protected site changed'
 assert sha(Path('/etc/nginx/sites-enabled/obr-plugins').resolve())==nginx
 assert all(subprocess.check_output(['systemctl','show',s,'-p','ActiveEnterTimestampMonotonic'],text=True)==starts[s] for s in services)
except BaseException:
 if live.exists():live.rename(root/f'suite-dev-failed-dice3d{release}')
 backup.rename(live);raise
record={'version':f'1.0.{release}-dev','verifiedFiles':len(files),'unchangedInsideNewPlugin':len(unchanged),'protectedFiles':{n:len(v) for n,v in protected.items()},'backup':str(backup),'servicesUnchanged':True,'nginxUnchanged':True,'realRoomVerified':False}
(root/f'dice3d{release}-deployment.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
