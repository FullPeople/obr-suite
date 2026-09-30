"""Version-guarded 216 static overlays. No server code, service restart or player-data writes."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tarfile,tempfile
root=Path('/var/www/obr-plugins').resolve();archives=Path(__file__).resolve().parent
receipt=json.loads((archives/'package-receipt.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def tree(folder):return {p.relative_to(folder).as_posix():sha(p) for p in folder.rglob('*') if p.is_file()}
def validate(folder,files):
 for name,digest in files.items():
  p=(folder/name).resolve();assert p.is_relative_to(folder.resolve()) and p.is_file() and sha(p)==digest,name
def started(name):return subprocess.check_output(['systemctl','show',name,'-p','ActiveEnterTimestampMonotonic'],text=True).strip()
targets={'card':('release.json','standalone-1.0.215','standalone-1.0.216'),'suite-dev':('manifest-dev.json','1.0.215-dev','1.0.216-dev')}
for name,(manifest,old,_) in targets.items():assert json.loads((root/name/manifest).read_text())['version']==old,(name,'Live changed; merge and review first')
backups={name:root/(name+'-before-216') for name in targets}
assert all(not p.exists() and not (root/(name+'-failed-216')).exists() for name,p in backups.items()),'Recovery path exists'
services=['obr-workbench-relay-dev','obr-three-dragon'];starts={name:started(name) for name in services}
protectedFiles=[Path('/opt/obr-workbench-relay-dev')/name for name in ['server.mjs','documents.mjs','patches.mjs']]+[Path('/etc/nginx/sites-enabled/obr-plugins').resolve(),Path('/opt/obr-three-dragon/server.mjs')]
protected={str(p):sha(p) for p in protectedFiles};protectedSites={n:tree(root/n) for n in ['suite','dice-lab-dev','three-dragon-ante-dev']}
dice=tree(root/'suite-dev/dice3d')
assert len(dice)==80, 'Deployed dice renderer changed; review before publication'
original={name:tree(root/name) for name in targets};stages={};manifests={};unchanged={}
for name,(manifest,_,version) in targets.items():
 archive=archives/(name+'-216.tar.gz');assert sha(archive)==receipt['targets'][name]['sha256']
 stage=Path(tempfile.mkdtemp(prefix='.release216-'+name+'-',dir=root)).resolve();shutil.copytree(root/name,stage,dirs_exist_ok=True)
 with tarfile.open(archive) as tar:
  for member in tar.getmembers():
   assert (stage/member.name).resolve().is_relative_to(stage) and (member.isfile() or member.isdir()),member.name
   if name=='suite-dev':assert member.name.startswith(('assets/','workbench/','workbench-dice/')) or member.name=='card-viewer/suite-source.zip' or '/' not in member.name and (member.name.endswith('.html') or member.name in ['manifest-dev.json','source.zip','suite-source.zip','release216-hashes.json']),member.name
  tar.extractall(stage,filter='data')
 files=json.loads((stage/'release216-hashes.json').read_text());validate(stage,files)
 assert json.loads((stage/manifest).read_text())['version']==version
 unchanged[name]={n:h for n,h in original[name].items() if n not in files and n!='release216-hashes.json'};validate(stage,unchanged[name])
 for p in stage.rglob('*'):os.chmod(p,0o755 if p.is_dir() else 0o644)
 os.chmod(stage,0o755);stages[name]=stage;manifests[name]=files
assert all(tree(root/name)==before for name,before in original.items()),'Concurrent publication; stop before cutover'
moved=[]
try:
 for name,stage in stages.items():(root/name).rename(backups[name]);moved.append(name);stage.rename(root/name)
 for name,files in manifests.items():validate(root/name,files);validate(root/name,unchanged[name])
 assert tree(root/'suite-dev/dice3d')==dice,'214 dice renderer changed'
 assert all(tree(root/name)==files for name,files in protectedSites.items()),'Protected site changed'
 assert all(sha(Path(p))==digest for p,digest in protected.items())
 assert all(started(name)==stamp for name,stamp in starts.items()),'A service restarted'
except BaseException:
 for name in reversed(moved):
  if (root/name).exists():(root/name).rename(root/(name+'-failed-216'))
  backups[name].rename(root/name)
 raise
record={'versions':{n:c[2] for n,c in targets.items()},'webCommit':receipt['webCommit'],'suiteCommit':receipt['suiteCommit'],'verifiedFiles':{n:len(f) for n,f in manifests.items()},'unchangedFiles':{n:len(f) for n,f in unchanged.items()},'preserved214DiceFiles':len(dice),'protectedSites':{n:len(f) for n,f in protectedSites.items()},'backups':{n:str(p) for n,p in backups.items()},'servicesUnchanged':True,'nginxUnchanged':True,'deploymentWritesPlayerData':False,'realOwlbearRoomVerified':False}
(root/'release216-deployment.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
