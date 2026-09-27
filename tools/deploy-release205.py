from pathlib import Path
import json,hashlib,os,shutil,subprocess,tarfile,tempfile,sys
root=Path('/var/www/obr-plugins').resolve()
targets={'card':('release.json','standalone-1.0.200','standalone-1.0.205'),'suite-dev':('manifest-dev.json','1.0.203-dev','1.0.205-dev'),'three-dragon-ante-dev':('manifest.json','0.7.17-dev','0.7.18-dev')}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def validate(folder,files):
 for name,value in files.items():
  path=(folder/name).resolve();assert path.is_relative_to(folder.resolve()) and path.is_file() and digest(path)==value,name
versions={name:json.loads((root/name/config[0]).read_text())['version'] for name,config in targets.items()}
if '--inspect' in sys.argv:
 print(json.dumps({'versions':versions,'cardSource':json.loads((root/'card/release.json').read_text()).get('sourceCommit'),'root':str(root)}));sys.exit(0)
for name,(_,expected,_) in targets.items():assert versions[name]==expected,(name,versions[name])
backups={name:root/(name+'-before-205') for name in targets}
assert all(not p.exists() for p in backups.values()),'Backup exists'
assert all(not (root/(name+'-failed-205')).exists() for name in targets),'Failure directory exists'
card_hash=digest(root/'card/release.json')
stable_hash=digest(root/'suite/manifest.json')
stable_files={p.relative_to(root/'suite').as_posix():digest(p) for p in (root/'suite').rglob('*') if p.is_file()}
assert subprocess.check_output(['systemctl','is-active','obr-three-dragon'],text=True).strip()=='active'
relay=Path('/opt/obr-workbench-relay-dev');relay_hashes={n:digest(relay/n) for n in ['server.mjs','documents.mjs','patches.mjs']}
nginx=Path('/etc/nginx/sites-enabled/obr-plugins').resolve();nginx_hash=digest(nginx)
service=['systemctl','show','obr-workbench-relay-dev','-p','ActiveEnterTimestampMonotonic'];started=subprocess.check_output(service,text=True).strip()
stages={};manifests={};retained={}
for name,(config,_,version) in targets.items():
 stage=Path(tempfile.mkdtemp(prefix='.release205-'+name+'-',dir=root)).resolve()
 with tarfile.open('/tmp/'+name+'-205.tar.gz') as tar:
  for member in tar.getmembers():
   path=(stage/member.name).resolve();assert path.is_relative_to(stage) and (member.isfile() or member.isdir()),member.name
  tar.extractall(stage,filter='data')
 files=json.loads((stage/'release-hashes.json').read_text());validate(stage,files)
 assert json.loads((stage/config).read_text())['version']==version,(name,version)
 for p in stage.rglob('*'):os.chmod(p,0o755 if p.is_dir() else 0o644)
 os.chmod(stage,0o755)
 retained[name]=[]
 folders=['assets','card-viewer/assets']+(['workbench/assets','workbench-panels','workbench-dice'] if name=='suite-dev' else ['downloads'] if name=='card' else [])
 for folder in folders:
  for old in (root/name/folder).rglob('*'):
   if old.is_file():
    new=stage/folder/old.relative_to(root/name/folder)
    if not new.exists():new.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(old,new);retained[name].append(new.relative_to(stage).as_posix())
 stages[name]=stage;manifests[name]=files
relay_backup=relay/'before-205';assert not relay_backup.exists();relay_backup.mkdir()
new_relay=Path('/tmp/workbench-relay-205')
for name in relay_hashes:
 subprocess.run(['/usr/local/bin/node','--check',str(new_relay/name)],check=True)
 shutil.copy2(relay/name,relay_backup/name)
moved=[]
try:
 for name in relay_hashes:
  shutil.copy2(new_relay/name,relay/(name+'.new'));os.chmod(relay/(name+'.new'),0o644);os.replace(relay/(name+'.new'),relay/name)
 subprocess.run(['systemctl','restart','obr-workbench-relay-dev'],check=True)
 import time,urllib.request,urllib.error
 ready=False
 for attempt in range(30):
  try:urllib.request.urlopen('http://127.0.0.1:5012/',timeout=2)
  except urllib.error.HTTPError as e:
   if e.code==401:ready=True;break
  except OSError:pass
  time.sleep(.2)
 assert ready,'relay not ready'

 for name,stage in stages.items():
  (root/name).rename(backups[name]);moved.append(name);stage.rename(root/name)
 for name,files in manifests.items():validate(root/name,files)
 assert all(digest(relay/n)==digest(new_relay/n) for n in relay_hashes)
 assert json.loads((root/'card/release.json').read_text())['version']=='standalone-1.0.205'
 assert {p.relative_to(root/'suite').as_posix():digest(p) for p in (root/'suite').rglob('*') if p.is_file()}==stable_files
 assert digest(nginx)==nginx_hash
 assert subprocess.check_output(['systemctl','is-active','obr-workbench-relay-dev'],text=True).strip()=='active'
except BaseException:
 for name in relay_hashes:shutil.copy2(relay_backup/name,relay/name)
 subprocess.run(['systemctl','restart','obr-workbench-relay-dev'],check=True)
 for name in reversed(moved):
  if (root/name).exists():(root/name).rename(root/(name+'-failed-205'))
  backups[name].rename(root/name)
 raise
record={'versions':{n:json.loads((root/n/c[0]).read_text())['version'] for n,c in targets.items()},'verifiedFiles':{n:len(f) for n,f in manifests.items()},'backups':{n:str(p) for n,p in backups.items()},'retainedFiles':{n:len(f) for n,f in retained.items()},'relayHashesBefore':relay_hashes,'relayHashesAfter':{n:digest(relay/n) for n in relay_hashes},'legacyVerifiedFiles':len(stable_files),'relayRestarted':True,'relayBackup':str(relay_backup),'nginxUnchanged':True,'characterDataChanged':False,'realRoomVerified':False,'cardReleaseUnchanged':False,'legacySuiteUnchanged':True,'serverService':'obr-three-dragon'}
(root/'release205-deployment.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
