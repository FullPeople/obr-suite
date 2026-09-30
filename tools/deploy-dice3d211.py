"""Only new Suite static frontend, overlaying 3D onto live 210. No stable/card/lab writes."""
from pathlib import Path
import hashlib,json,os,shutil,tarfile,tempfile,subprocess
root=Path('/var/www/obr-plugins').resolve();live=root/'suite-dev';backup=root/'suite-dev-before-dice3d211'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def tree(p):return {f.relative_to(p).as_posix():sha(f) for f in p.rglob('*') if f.is_file()}
assert json.loads((live/'manifest-dev.json').read_text())['version']=='1.0.210-dev','Live version changed; stop'
assert not backup.exists(),'Backup exists; stop'
baseline=tree(live);protected={name:tree(root/name) for name in ['suite','card','dice-lab-dev']}
services=['obr-workbench-relay-dev','obr-three-dragon'];starts={s:subprocess.check_output(['systemctl','show',s,'-p','ActiveEnterTimestampMonotonic'],text=True) for s in services}
nginx=sha(Path('/etc/nginx/sites-enabled/obr-plugins').resolve())
delta=Path(tempfile.mkdtemp(prefix='.dice3d211-delta-',dir=root))
with tarfile.open('/tmp/suite-dev-dice3d211.tar.gz') as archive:
 for entry in archive.getmembers():assert (delta/entry.name).resolve().is_relative_to(delta) and (entry.isdir() or entry.isfile()),entry.name
 archive.extractall(delta,filter='data')
files=json.loads((delta/'dice3d211-hashes.json').read_text())
for name,digest in files.items():
 assert (delta/name).resolve().is_relative_to(delta) and sha(delta/name)==digest,name
 assert not name.startswith(('workbench/','card-viewer/')) or name.endswith('/suite-source.zip'),name
assert json.loads((delta/'manifest-dev.json').read_text())['version']=='1.0.211-dev'
assert (delta/'dice3d/overlay.html').is_file()
for folder in ['workbench','card-viewer']:
 target=delta/folder/'suite-source.zip';target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(delta/'suite-source.zip',target);files[folder+'/suite-source.zip']=files['suite-source.zip']
(delta/'dice3d211-hashes.json').write_text(json.dumps(files,indent=2))
stage=Path(tempfile.mkdtemp(prefix='.dice3d211-stage-',dir=root));shutil.copytree(live,stage,dirs_exist_ok=True);shutil.copytree(delta,stage,dirs_exist_ok=True)
# Web 210, reader 210, announcement 210 and every unrelated live file remain exact.
unchanged={name:digest for name,digest in baseline.items() if name not in files and name!='dice3d211-hashes.json'}
for name,digest in unchanged.items():assert sha(stage/name)==digest,name
for file in stage.rglob('*'):os.chmod(file,0o755 if file.is_dir() else 0o644)
os.chmod(stage,0o755)
assert tree(live)==baseline,'Live frontend changed during staging; stop'
live.rename(backup)
try:
 stage.rename(live)
 for name,digest in files.items():assert sha(live/name)==digest,name
 for name,digest in unchanged.items():assert sha(live/name)==digest,name
 assert all(tree(root/name)==data for name,data in protected.items()),'Protected site changed'
 assert sha(Path('/etc/nginx/sites-enabled/obr-plugins').resolve())==nginx
 assert all(subprocess.check_output(['systemctl','show',s,'-p','ActiveEnterTimestampMonotonic'],text=True)==starts[s] for s in services)
except BaseException:
 if live.exists():live.rename(root/'suite-dev-failed-dice3d211')
 backup.rename(live);raise
record={'version':'1.0.211-dev','verifiedFiles':len(files),'unchangedInsideNewPlugin':len(unchanged),'protectedFiles':{n:len(v) for n,v in protected.items()},'backup':str(backup),'servicesUnchanged':True,'nginxUnchanged':True,'web210Preserved':True,'realRoomVerified':False}
(root/'dice3d211-deployment.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
