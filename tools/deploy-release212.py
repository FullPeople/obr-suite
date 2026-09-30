"""Deploy reviewed 212 overlays and relay code with rollback; never restore player data."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tarfile,tempfile,time,urllib.request,urllib.error,secrets
root=Path('/var/www/obr-plugins').resolve();archives=Path('/tmp/dnd-release212').resolve()
receipt=json.loads((archives/'package-receipt.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def tree(folder):return {p.relative_to(folder).as_posix():sha(p) for p in folder.rglob('*') if p.is_file()}
def validate(folder,files):
 for name,digest in files.items():
  p=(folder/name).resolve();assert p.is_relative_to(folder.resolve()) and p.is_file() and sha(p)==digest,name
def started(name):return subprocess.check_output(['systemctl','show',name,'-p','ActiveEnterTimestampMonotonic'],text=True).strip()
def active(name):return subprocess.check_output(['systemctl','is-active',name],text=True).strip()=='active'
targets={'card':('release.json','standalone-1.0.210','standalone-1.0.212'),'suite-dev':('manifest-dev.json','1.0.211-dev','1.0.212-dev')}
for name,(manifest,old,_) in targets.items():assert json.loads((root/name/manifest).read_text())['version']==old,(name,'live version changed')
backups={name:root/(name+'-before-212') for name in targets};service=Path('/opt/obr-workbench-relay-dev');programBackup=Path('/var/backups/obr-workbench-relay-before-212')
assert all(not p.exists() and not (root/(name+'-failed-212')).exists() for name,p in backups.items()) and not programBackup.exists()
assert sha(service/'server.mjs')=='13b39339e746dd8bcfbac562fdd34129121af4b21b93e5b00692534e05d0dec0','Relay changed since review'
assert sha(archives/'relay-212.mjs')==receipt['relaySHA256']
subprocess.run(['/usr/local/bin/node','--check',str(archives/'relay-212.mjs')],check=True)
protectedFiles=[service/'documents.mjs',service/'patches.mjs',Path('/etc/systemd/system/obr-workbench-relay-dev.service'),Path('/etc/nginx/sites-enabled/obr-plugins').resolve(),Path('/opt/obr-three-dragon/server.mjs')]
protected={str(p):sha(p) for p in protectedFiles};protectedSites={n:tree(root/n) for n in ['suite','dice-lab-dev','three-dragon-ante-dev']}
dice={p:sha(root/'suite-dev'/p) for p in tree(root/'suite-dev') if p.startswith(('dice3d/','workbench-dice/'))}
assert active('obr-workbench-relay-dev') and active('obr-three-dragon')
dragonStart=started('obr-three-dragon');relayStart=started('obr-workbench-relay-dev')
original={name:tree(root/name) for name in targets};stages={};manifests={};unchanged={}
for name,(manifest,_,version) in targets.items():
 archive=archives/(name+'-212.tar.gz');assert sha(archive)==receipt['targets'][name]['sha256']
 stage=Path(tempfile.mkdtemp(prefix='.release212-'+name+'-',dir=root)).resolve();shutil.copytree(root/name,stage,dirs_exist_ok=True)
 with tarfile.open(archive) as tar:
  for member in tar.getmembers():
   assert (stage/member.name).resolve().is_relative_to(stage) and (member.isfile() or member.isdir()),member.name
   if name=='suite-dev':assert member.name.startswith(('assets/','workbench/')) or member.name=='card-viewer/suite-source.zip' or '/' not in member.name and (member.name.endswith('.html') or member.name in ['manifest-dev.json','source.zip','suite-source.zip','release212-hashes.json']),member.name
  tar.extractall(stage,filter='data')
 files=json.loads((stage/'release212-hashes.json').read_text());validate(stage,files)
 assert json.loads((stage/manifest).read_text())['version']==version
 unchanged[name]={n:h for n,h in original[name].items() if n not in files and n!='release212-hashes.json'};validate(stage,unchanged[name])
 for p in stage.rglob('*'):os.chmod(p,0o755 if p.is_dir() else 0o644)
 os.chmod(stage,0o755);stages[name]=stage;manifests[name]=files
# Program/data backups are private and never part of either public site.
programBackup.mkdir(mode=0o700)
for name in ['server.mjs','documents.mjs','patches.mjs']:shutil.copy2(service/name,programBackup/name)
shutil.copytree('/var/lib/obr-workbench-relay-dev',programBackup/'data')
assert all(tree(root/name)==before for name,before in original.items()),'Concurrent static publication; stop before cutover'
assert sha(service/'server.mjs')==sha(programBackup/'server.mjs'),'Concurrent relay publication'
def relayProbe():
 host=secrets.token_hex(32);client=secrets.token_hex(32);session=hashlib.sha256(host.encode()).hexdigest();base='http://127.0.0.1:5012/?session='+session
 def request(role,key,data=None):
  req=urllib.request.Request(base+'&role='+role,data=json.dumps(data).encode() if data is not None else None,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=5) as res:return json.loads(res.read())
 assert request('host',host,{'register':True,'clientKey':client})['ok']
 assert request('client',client,{'type':'release-probe','release':212})['ok']
 assert request('host',host)[0]['release']==212
 try:request('client','incorrect-release-probe-key')
 except urllib.error.HTTPError as e:assert e.code==401
 else:raise AssertionError('Authentication was not enforced')
moved=[];relayChanged=False
try:
 for name,stage in stages.items():(root/name).rename(backups[name]);moved.append(name);stage.rename(root/name)
 replacement=service/'server-212.next.mjs';shutil.copy2(archives/'relay-212.mjs',replacement);os.chmod(replacement,0o644);os.replace(replacement,service/'server.mjs');relayChanged=True
 subprocess.run(['systemctl','restart','obr-workbench-relay-dev'],check=True)
 for attempt in range(30):
  try:relayProbe();break
  except (OSError,urllib.error.URLError):
   if attempt==29:raise
   time.sleep(.2)
 for name,files in manifests.items():validate(root/name,files);validate(root/name,unchanged[name])
 validate(root/'suite-dev',dice)
 assert all(tree(root/name)==files for name,files in protectedSites.items()),'Protected site changed'
 assert all(sha(Path(p))==digest for p,digest in protected.items())
 assert active('obr-workbench-relay-dev') and active('obr-three-dragon') and started('obr-three-dragon')==dragonStart
 assert sha(service/'server.mjs')==receipt['relaySHA256']
except BaseException:
 if relayChanged:shutil.copy2(programBackup/'server.mjs',service/'server.mjs');subprocess.run(['systemctl','restart','obr-workbench-relay-dev'],check=True)
 for name in reversed(moved):
  if (root/name).exists():(root/name).rename(root/(name+'-failed-212'))
  backups[name].rename(root/name)
 raise
record={'versions':{n:c[2] for n,c in targets.items()},'webCommit':receipt['webCommit'],'suiteCommit':receipt['suiteCommit'],'verifiedFiles':{n:len(f) for n,f in manifests.items()},'unchangedFiles':{n:len(f) for n,f in unchanged.items()},'preservedDiceFiles':len(dice),'protectedSites':{n:len(f) for n,f in protectedSites.items()},'backups':{n:str(p) for n,p in backups.items()},'relayBackup':str(programBackup),'relaySHA256':receipt['relaySHA256'],'relayRestarted':started('obr-workbench-relay-dev')!=relayStart,'relaySyntheticRegistrationDeliveryAuthPassed':True,'nginxUnchanged':True,'threeDragonRestarted':False,'playerDataManuallyModified':False,'realOwlbearRoomVerified':False}
(root/'release212-deployment.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
