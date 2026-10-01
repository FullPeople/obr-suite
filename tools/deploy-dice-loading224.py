"""Verified 223 -> 224 dice static overlay. Default checks only; --apply switches atomically."""
from pathlib import Path
import argparse,ctypes,hashlib,json,os,shutil,subprocess,tarfile,tempfile,zipfile
parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
root=Path('/var/www/obr-plugins').resolve();live=root/'suite-dev';backup=root/'suite-dev-before-dice3d224'
archive=Path('/tmp/suite-dev-dice3d224.tar.gz');package=json.loads(Path('/tmp/diceedge224-package.json').read_text())
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
 return h.hexdigest()
def tree(p):return {f.relative_to(p).as_posix():sha(f) for f in p.rglob('*') if f.is_file()}
assert json.loads((live/'manifest-dev.json').read_text())['version']=='1.0.223-dev','Live version changed'
with zipfile.ZipFile(live/'suite-source.zip') as source:
 assert source.comment.decode()=='2d9769dbedbe3e26a55d276b4b7113b7c5e91e9c','Live Suite source changed'
assert not backup.exists() and not (root/'dice3d224-deployment.json').exists(),'Recovery point already exists'
assert sha(archive)==package['archiveSHA256'],'Archive hash mismatch'
baseline=tree(live);protected={n:tree(root/n) for n in ['suite','card','dice-lab-dev','three-dragon-ante-dev'] if (root/n).exists()}
services=['obr-workbench-relay-dev','obr-three-dragon']
starts={n:subprocess.check_output(['systemctl','show',n,'-p','ActiveEnterTimestampMonotonic'],text=True) for n in services}
nginx=Path('/etc/nginx/sites-enabled/obr-plugins').resolve();nginx_before=sha(nginx)
delta=Path(tempfile.mkdtemp(prefix='.diceedge224-delta-',dir=root))
with tarfile.open(archive) as tar:
 for member in tar.getmembers():
  target=(delta/member.name).resolve();assert target.is_relative_to(delta) and (member.isfile() or member.isdir()),member.name
 for member in tar.getmembers():tar.extract(member,delta)
files=json.loads((delta/'dice3d224-hashes.json').read_text())
for name,digest in files.items():
 assert (delta/name).resolve().is_relative_to(delta) and sha(delta/name)==digest,name
 assert name=='manifest-dev.json' or name=='suite-source.zip' or '/' not in name and name.endswith('.html') or name.startswith(('assets/','dice3d/','workbench-dice/')),name
assert json.loads((delta/'manifest-dev.json').read_text())['version']=='1.0.224-dev'
locks={**json.loads((delta/'dice3d/asset-hashes.json').read_text()),**{'vendor/'+n:d for n,d in json.loads((delta/'dice3d/vendor/lock.json').read_text())['files'].items()}}
for name,digest in locks.items():assert sha(delta/'dice3d'/name)==digest,name
with zipfile.ZipFile(delta/'suite-source.zip') as source:
 assert source.comment.decode()==package['sourceCommit'],'Source commit mismatch'
 assert source.testzip() is None,'Source archive CRC error'
for folder in ['workbench','card-viewer']:
 target=delta/folder/'suite-source.zip';target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(delta/'suite-source.zip',target);files[folder+'/suite-source.zip']=files['suite-source.zip']
(delta/'dice3d224-hashes.json').write_text(json.dumps(files,indent=2))
unchanged={n:d for n,d in baseline.items() if n not in files and n!='dice3d224-hashes.json'}
report={'version':'1.0.224-dev','sourceCommit':package['sourceCommit'],'archiveSHA256':package['archiveSHA256'],'verifiedFiles':len(files),'lockedDiceAssets':len(locks),'unchangedInsideNewPlugin':len(unchanged),'protectedFiles':{n:len(t) for n,t in protected.items()},'realRoomVerified':False}
if not args.apply:
 report['preflightPassed']=True;report['applied']=False;print(json.dumps(report,indent=2));raise SystemExit(0)
stage=Path(tempfile.mkdtemp(prefix='.diceedge224-stage-',dir=root));shutil.copytree(live,stage,dirs_exist_ok=True);shutil.copytree(delta,stage,dirs_exist_ok=True)
for name,digest in unchanged.items():assert sha(stage/name)==digest,name
for p in stage.rglob('*'):os.chmod(p,0o755 if p.is_dir() else 0o644)
os.chmod(stage,0o755)
libc=ctypes.CDLL(None,use_errno=True);exchange=libc.renameat2;exchange.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
def swap():
 assert live.resolve().parent==root and stage.resolve().parent==root
 if exchange(-100,os.fsencode(live),-100,os.fsencode(stage),2)!=0:raise OSError(ctypes.get_errno(),'Atomic directory exchange failed')
assert tree(live)==baseline,'Live changed during staging'
swap()
try:
 for name,digest in files.items():assert sha(live/name)==digest,name
 for name,digest in unchanged.items():assert sha(live/name)==digest,name
 assert tree(stage)==baseline,'Recovery point mismatch'
 assert all(tree(root/n)==t for n,t in protected.items()),'Protected site changed'
 assert sha(nginx)==nginx_before,'Nginx changed'
 assert all(subprocess.check_output(['systemctl','show',n,'-p','ActiveEnterTimestampMonotonic'],text=True)==s for n,s in starts.items()),'Service changed'
except BaseException:
 swap();stage.rename(root/'suite-dev-failed-dice3d224');raise
stage.rename(backup);report.update(applied=True,backup=str(backup),servicesUnchanged=True,nginxUnchanged=True)
(root/'dice3d224-deployment.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
