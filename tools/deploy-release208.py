"""Run on the existing deployment host after uploading reviewed 208 artifacts."""
from pathlib import Path
import hashlib,json,os,shutil,sqlite3,subprocess,tarfile,tempfile,time,urllib.request

root=Path('/var/www/obr-plugins').resolve()
targets={'card':('release.json','standalone-1.0.207','standalone-1.0.208'),'suite-dev':('manifest-dev.json','1.0.207-dev','1.0.208-dev'),'three-dragon-ante-dev':('manifest.json','0.7.19-dev','0.7.20-dev'),'suite':('manifest.json','1.3.11','1.3.12')}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def validate(folder,files):
 for name,digest in files.items():
  p=(folder/name).resolve();assert p.is_relative_to(folder.resolve()) and p.is_file() and sha(p)==digest,name
def active(name):return subprocess.check_output(['systemctl','is-active',name],text=True).strip()
def started(name):return subprocess.check_output(['systemctl','show',name,'-p','ActiveEnterTimestampMonotonic'],text=True).strip()
for name,(manifest,old,_) in targets.items():assert json.loads((root/name/manifest).read_text())['version']==old,(name,'version changed')
backups={name:root/(name+'-before-208') for name in targets}
assert all(not p.exists() and not (root/(name+'-failed-208')).exists() for name,p in backups.items())
relay=Path('/opt/obr-workbench-relay-dev');relay_hashes={n:sha(relay/n) for n in ['server.mjs','documents.mjs','patches.mjs']};relay_started=started('obr-workbench-relay-dev')
nginx=Path('/etc/nginx/sites-enabled/obr-plugins').resolve();nginx_hash=sha(nginx)
legacy_files={p.relative_to(root/'suite').as_posix():sha(p) for p in (root/'suite').rglob('*') if p.is_file()}
assert active('obr-three-dragon')==active('obr-workbench-relay-dev')=='active'
stages={};manifests={}
for name,(manifest,_,version) in targets.items():
 stage=Path(tempfile.mkdtemp(prefix='.release208-'+name+'-',dir=root)).resolve()
 if name=='suite':shutil.copytree(root/name,stage,dirs_exist_ok=True)
 with tarfile.open('/tmp/'+name+'-208.tar.gz') as tar:
  for member in tar.getmembers():
   p=(stage/member.name).resolve();assert p.is_relative_to(stage) and (member.isfile() or member.isdir()),member.name
   if name=='suite':assert member.name.startswith('card-viewer/') or member.name in ['manifest.json','announcement.md','source.zip','suite-source.zip','release-hashes.json'],member.name
  tar.extractall(stage,filter='data')
 files=json.loads((stage/'release-hashes.json').read_text());validate(stage,files)
 assert json.loads((stage/manifest).read_text())['version']==version
 for p in stage.rglob('*'):os.chmod(p,0o755 if p.is_dir() else 0o644)
 os.chmod(stage,0o755)
 # Keep hashed assets requested by tabs that loaded the previous HTML.
 for folder in ['assets','card-viewer/assets']+(['workbench/assets','workbench-panels','workbench-dice'] if name=='suite-dev' else ['downloads'] if name=='card' else []):
  for old in (root/name/folder).rglob('*'):
   if old.is_file():
    new=stage/folder/old.relative_to(root/name/folder)
    if not new.exists():new.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(old,new)
 stages[name]=stage;manifests[name]=files
legacy_untouched={n:h for n,h in legacy_files.items() if n not in manifests['suite'] and n!='release-hashes.json'}
validate(stages['suite'],legacy_untouched)
service=Path('/opt/obr-three-dragon');new_service=Path('/tmp/three-dragon-service-208.mjs');expected=Path('/tmp/three-dragon-service-208.sha256').read_text().strip();assert sha(new_service)==expected
subprocess.run(['/usr/local/bin/node','--check',str(new_service)],check=True)
service_backup=service/'before-208';assert not service_backup.exists();service_backup.mkdir(mode=0o700)
old_service_hash=sha(service/'server.mjs');shutil.copy2(service/'server.mjs',service_backup/'server.mjs')
# SQLite online backup is consistent even when a player is taking a turn.
database=Path('/var/lib/obr-three-dragon/game.sqlite')
with sqlite3.connect(str(database)) as source,sqlite3.connect(str(service_backup/'game.sqlite')) as destination:
 source.backup(destination)
 db_schema=source.execute("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
os.chmod(service_backup/'game.sqlite',0o600)
moved=[];restarted=False
def health():
 for attempt in range(40):
  try:
   with urllib.request.urlopen('http://127.0.0.1:5013/three-dragon-api/v1/health',timeout=2) as response:
    if json.load(response).get('ok'):return
  except OSError:pass
  time.sleep(.25)
 raise RuntimeError('Three Dragon service failed health check')
try:
 shutil.copy2(new_service,service/'server.mjs.new');os.chmod(service/'server.mjs.new',0o644);os.replace(service/'server.mjs.new',service/'server.mjs')
 restarted=True;subprocess.run(['systemctl','restart','obr-three-dragon'],check=True);health()
 for name,stage in stages.items():(root/name).rename(backups[name]);moved.append(name);stage.rename(root/name)
 for name,files in manifests.items():validate(root/name,files)
 validate(root/'suite',legacy_untouched)
 assert {n:sha(relay/n) for n in relay_hashes}==relay_hashes and started('obr-workbench-relay-dev')==relay_started
 assert sha(nginx)==nginx_hash and sha(service/'server.mjs')==expected
 with sqlite3.connect(str(database)) as db:assert db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()==db_schema
except BaseException:
 for name in reversed(moved):
  if (root/name).exists():(root/name).rename(root/(name+'-failed-208'))
  backups[name].rename(root/name)
 shutil.copy2(service_backup/'server.mjs',service/'server.mjs')
 if restarted:subprocess.run(['systemctl','restart','obr-three-dragon'],check=True)
 # Never restore the game backup automatically: that would discard newer turns.
 raise
record={'versions':{n:c[2] for n,c in targets.items()},'verifiedFiles':{n:len(f) for n,f in manifests.items()},'legacyUnchangedFiles':len(legacy_untouched),'backups':{n:str(p) for n,p in backups.items()},'serviceBackup':str(service_backup),'serviceHashBefore':old_service_hash,'serviceHashAfter':expected,'threeDragonRestarted':True,'relayRestarted':False,'nginxUnchanged':True,'databaseSchemaUnchanged':True,'playerDataManuallyModified':False,'realOwlbearRoomVerified':False}
(root/'release208-deployment.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
