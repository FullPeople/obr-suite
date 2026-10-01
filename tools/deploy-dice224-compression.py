"""Scoped binary compression for the already verified dice 224 deployment."""
from pathlib import Path
import argparse,difflib,gzip,hashlib,json,os,shutil,socket,subprocess,time,urllib.request

parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
config=Path('/etc/nginx/sites-enabled/obr-plugins').resolve()
backup=Path('/etc/nginx/obr-plugins-before-dice224-gzip.conf')
root=Path('/var/www/obr-plugins/suite-dev')
before=config.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(before)=='b28cfd9aaef35b53d41e94350396ab69be550e477d05c69ce73e81e1550c9158','Nginx configuration changed'
assert json.loads((root/'manifest-dev.json').read_text())['version']=='1.0.224-dev','Live version changed'
assert not backup.exists() or backup.read_bytes()==before,'Recovery point differs'
marker='    # Cache other static assets\n'
rule='''    # Dice 224: compress immutable engine/model/audio/font bytes on transfer.
    # Scope excludes other apps; browser decoding preserves the pinned SHA-256.
    location ~* ^/suite-dev/dice3d/.*\\.(wasm|glb|wav|ttf)$ {
        gzip_types *;
        try_files $uri =404;
    }

'''
text=before.decode();assert text.count(marker)==1;after=text.replace(marker,rule+marker).encode()
if not args.apply:
 print(''.join(difflib.unified_diff(text.splitlines(True),after.decode().splitlines(True),fromfile=str(config),tofile='dice224 scoped compression')))
 raise SystemExit(0)

subprocess.run(['nginx','-t'],check=True)
services=['obr-workbench-relay-dev','obr-three-dragon']
starts={n:subprocess.check_output(['systemctl','show',n,'-p','ActiveEnterTimestampMonotonic'],text=True) for n in services}
if not backup.exists():shutil.copy2(config,backup)
temporary=config.parent.parent/'obr-plugins-dice224-gzip.tmp'
def replace(content):
 temporary.write_bytes(content);shutil.copymode(backup,temporary);os.replace(temporary,config)

original=socket.getaddrinfo
def local(host,port,*a,**kw):return original('127.0.0.1' if host=='obr.dnd.center' else host,port,*a,**kw)
socket.getaddrinfo=local
client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
 assert config.read_bytes()==before,'Nginx changed before replacement'
 replace(after);subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
 files=sorted(p for p in (root/'dice3d').rglob('*') if p.suffix.lower() in ['.wasm','.glb','.wav','.ttf'])
 checks=[]
 for path in files:
  name=path.relative_to(root).as_posix();expected=path.read_bytes()
  request=urllib.request.Request('https://obr.dnd.center/suite-dev/'+name+'?gzip-verify=224',headers={'Accept-Encoding':'gzip'})
  # reload returns before replacement workers necessarily accept new connections.
  for attempt in range(20):
   with client.open(request,timeout=30) as response:
    encoded=response.read();headers=response.headers;assert response.status==200,name
   if headers.get('Content-Encoding')=='gzip':break
   time.sleep(.25)
  assert headers.get('Content-Encoding')=='gzip',(name,dict(headers))
  assert 'Accept-Encoding' in headers.get('Vary',''),name
  assert headers.get('Access-Control-Allow-Origin')=='*',name
  assert sha(gzip.decompress(encoded))==sha(expected),name
  checks.append({'file':name,'originalBytes':len(expected),'transferBytes':len(encoded)})
 assert all(subprocess.check_output(['systemctl','show',n,'-p','ActiveEnterTimestampMonotonic'],text=True)==v for n,v in starts.items()),'Application service changed'
except BaseException:
 replace(before);subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True);raise

report={'success':True,'version':'1.0.224-dev','configBefore':sha(before),'configAfter':sha(after),'backup':str(backup),'scope':'/suite-dev/dice3d/*.wasm,*.glb,*.wav,*.ttf','nginxGracefullyReloaded':True,'applicationServicesUnchanged':True,'sourceAssetBytesUnchanged':True,'checks':checks}
(root.parent/'dice3d224-transfer.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
