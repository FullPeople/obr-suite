"""Install the isolated game service. Never touches the existing card relay or game DB."""
from pathlib import Path
import hashlib, json, subprocess, sys

root=Path(__file__).resolve().parent.parent
bundle=Path(sys.argv[1])
evidence=Path(sys.argv[2]);evidence.mkdir(parents=True,exist_ok=True)
host='root@47.120.61.255'
options=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15']
unit=root/'server/three-dragon/obr-three-dragon.service'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for file,name in [(bundle,'server.mjs'),(unit,'obr-three-dragon.service')]:
 subprocess.run(['scp',*options,str(file),host+':/tmp/tda203-stage/'+name],check=True)
remote=r'''
from pathlib import Path
import hashlib,json,subprocess,shutil,time,urllib.request,os
expected=EXPECTED
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
nginx=Path('/etc/nginx/sites-enabled/obr-plugins')
assert sha(nginx)=='fc00af890bf7441b957fa06769a60dace5c91fd8a23bc10db052385aea4ade49','Nginx changed since inspection'
target=Path('/opt/obr-three-dragon');unit=Path('/etc/systemd/system/obr-three-dragon.service')
assert not target.exists() and not unit.exists(),'Service already exists; use a reviewed upgrade instead'
stage=Path('/tmp/tda203-stage')
for name,digest in expected.items():assert sha(stage/name)==digest,name
relay=Path('/opt/obr-workbench-relay-dev')
relay_hashes={name:sha(relay/name) for name in ['server.mjs','documents.mjs','patches.mjs']}
relay_status=['systemctl','show','obr-workbench-relay-dev','-p','ActiveEnterTimestampMonotonic']
relay_start=subprocess.check_output(relay_status,text=True)
card=Path('/var/www/obr-plugins/card/release.json');card_hash=sha(card)
backup=Path('/etc/nginx/rollback/obr-plugins-before-three-dragon-203.conf')
backup.parent.mkdir(exist_ok=True);assert not backup.exists();shutil.copy2(nginx,backup)
block='''+repr('''    # Server-authoritative Three-Dragon Ante, separate from the card relay.
    location ^~ /three-dragon-api/v1/ {
        proxy_pass http://127.0.0.1:5013;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 90s;
        proxy_send_timeout 30s;
        proxy_buffering off;
        client_max_body_size 16k;
        add_header Cache-Control "no-store" always;
    }

''')+r'''
try:
 target.mkdir(mode=0o755);shutil.copy2(stage/'server.mjs',target/'server.mjs');os.chmod(target/'server.mjs',0o644)
 shutil.copy2(stage/'obr-three-dragon.service',unit);os.chmod(unit,0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True)
 subprocess.run(['systemctl','enable','--now','obr-three-dragon'],check=True)
 for attempt in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:5013/three-dragon-api/v1/health',timeout=2) as r:assert json.load(r)['ok']
   break
  except Exception:
   if attempt==19:raise
   time.sleep(.25)
 text=nginx.read_text();anchor='    # Isolated development workbench reconnect transport.';assert text.count(anchor)==1
 nginx.write_text(text.replace(anchor,block+anchor))
 subprocess.run(['nginx','-t'],check=True)
 subprocess.run(['systemctl','reload','nginx'],check=True)
 assert {name:sha(relay/name) for name in relay_hashes}==relay_hashes
 assert subprocess.check_output(relay_status,text=True)==relay_start and sha(card)==card_hash
except BaseException:
 shutil.copy2(backup,nginx);subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'])
 subprocess.run(['systemctl','disable','--now','obr-three-dragon'])
 if unit.exists():unit.rename(unit.with_name('obr-three-dragon.service.failed-203'))
 if target.exists():target.rename(target.with_name('obr-three-dragon.failed-203'))
 subprocess.run(['systemctl','daemon-reload']);raise
record={'service':'obr-three-dragon','port':5013,'hashes':expected,'nginxBackup':str(backup),'nginxAfter':sha(nginx),'relayRestarted':False,'cardReleaseUnchanged':True,'database':'/var/lib/obr-three-dragon/game.sqlite','active':subprocess.check_output(['systemctl','is-active','obr-three-dragon'],text=True).strip()}
Path('/var/www/obr-plugins/three-dragon-service203-deployment.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record,indent=2))
'''
remote=remote.replace('EXPECTED',repr({'server.mjs':sha(bundle),'obr-three-dragon.service':sha(unit)}))
result=subprocess.run(['ssh',*options,host,'python3 -'],input=remote,text=True,encoding='utf8',capture_output=True)
(evidence/'service-deployment.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf8')
print(result.stdout);print(result.stderr);result.check_returncode()
(evidence/'service-deployment.json').write_text(result.stdout,encoding='utf8')
