"""Apply reviewed static patch 210 with rollback; leave host programs/data intact."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tarfile,tempfile
root=Path('/var/www/obr-plugins').resolve()
archives=Path(os.environ.get('DND_RELEASE_ARCHIVES','/tmp')).resolve()
targets={'card':('release.json','standalone-1.0.209','standalone-1.0.210'),'suite-dev':('manifest-dev.json','1.0.209-dev','1.0.210-dev'),'suite':('manifest.json','1.3.13','1.3.14')}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def validate(folder,files):
 for name,digest in files.items():
  p=(folder/name).resolve();assert p.is_relative_to(folder.resolve()) and p.is_file() and sha(p)==digest,name
def tree(folder):return {p.relative_to(folder).as_posix():sha(p) for p in folder.rglob('*') if p.is_file()}
def active(name):return subprocess.check_output(['systemctl','is-active',name],text=True).strip()
def started(name):return subprocess.check_output(['systemctl','show',name,'-p','ActiveEnterTimestampMonotonic'],text=True).strip()
for name,(manifest,old,_) in targets.items():assert json.loads((root/name/manifest).read_text())['version']==old,(name,'version changed')
backups={name:root/(name+'-before-210') for name in targets}
assert all(not p.exists() and not (root/(name+'-failed-210')).exists() for name,p in backups.items())
protected=[Path('/opt/obr-workbench-relay-dev')/n for n in ['server.mjs','documents.mjs','patches.mjs']]+[Path('/opt/obr-three-dragon/server.mjs'),Path('/etc/nginx/sites-enabled/obr-plugins').resolve(),root/'three-dragon-ante-dev/manifest.json']
protected_hashes={str(p):sha(p) for p in protected}
services=['obr-three-dragon','obr-workbench-relay-dev'];service_starts={name:started(name) for name in services}
assert all(active(name)=='active' for name in services)
original={name:tree(root/name) for name in ['suite','suite-dev']}
stages={};manifests={};unchanged={}
for name,(manifest,_,version) in targets.items():
 stage=Path(tempfile.mkdtemp(prefix='.release210-'+name+'-',dir=root)).resolve()
 # Both Suite targets are overlays: unchanged dice, map and host assets survive byte for byte.
 if name in original:shutil.copytree(root/name,stage,dirs_exist_ok=True)
 with tarfile.open(archives/(name+'-210.tar.gz')) as tar:
  for member in tar.getmembers():
   p=(stage/member.name).resolve();assert p.is_relative_to(stage) and (member.isfile() or member.isdir()),member.name
   if name in original:
    assert member.name.startswith(('card-viewer/',)+(('workbench/',) if name=='suite-dev' else ())) or member.name in ['manifest.json','announcement.md','source.zip','suite-source.zip','release-hashes.json']+(['manifest-dev.json'] if name=='suite-dev' else []),member.name
  tar.extractall(stage,filter='data')
 files=json.loads((stage/'release-hashes.json').read_text());validate(stage,files)
 assert json.loads((stage/manifest).read_text())['version']==version
 for p in stage.rglob('*'):os.chmod(p,0o755 if p.is_dir() else 0o644)
 os.chmod(stage,0o755)
 if name=='card':
  for folder in ['assets','downloads']:
   for old in (root/name/folder).rglob('*'):
    if old.is_file():
     new=stage/folder/old.relative_to(root/name/folder)
     if not new.exists():new.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(old,new)
 if name in original:
  unchanged[name]={n:h for n,h in original[name].items() if n not in files and n!='release-hashes.json'}
  validate(stage,unchanged[name])
 stages[name]=stage;manifests[name]=files
moved=[]
try:
 for name,stage in stages.items():(root/name).rename(backups[name]);moved.append(name);stage.rename(root/name)
 for name,files in manifests.items():validate(root/name,files)
 for name,files in unchanged.items():validate(root/name,files)
 assert {str(p):sha(p) for p in protected}==protected_hashes
 assert all(active(name)=='active' and started(name)==service_starts[name] for name in services)
except BaseException:
 for name in reversed(moved):
  if (root/name).exists():(root/name).rename(root/(name+'-failed-210'))
  backups[name].rename(root/name)
 raise
record={'versions':{n:c[2] for n,c in targets.items()},'verifiedFiles':{n:len(f) for n,f in manifests.items()},'unchangedSuiteFiles':{n:len(f) for n,f in unchanged.items()},'backups':{n:str(p) for n,p in backups.items()},'threeDragonRestarted':False,'relayRestarted':False,'nginxUnchanged':True,'servicesUnchanged':True,'playerDataManuallyModified':False,'realOwlbearRoomVerified':False}
(root/'release210-deployment.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
