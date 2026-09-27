"""Enable HTTP/2 on the existing plugin TLS vhost with tested rollback."""
from pathlib import Path
import hashlib, json, shutil, subprocess

config = Path('/etc/nginx/sites-enabled/obr-plugins').resolve()
original = config.read_text()
assert original.count('listen 443 ssl;') == 1
backup = Path('/etc/nginx/rollback/obr-plugins-before-http2-205.conf')
assert not backup.exists()
backup.parent.mkdir(exist_ok=True)
shutil.copy2(config, backup)
try:
    config.write_text(original.replace('listen 443 ssl;', 'listen 443 ssl http2;', 1))
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except BaseException:
    shutil.copy2(backup, config)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    raise
record = {'backup': str(backup), 'before': hashlib.sha256(original.encode()).hexdigest(), 'after': hashlib.sha256(config.read_bytes()).hexdigest(), 'nginxReloaded': True, 'applicationServicesRestarted': False}
Path('/var/www/obr-plugins/http2-205-deployment.json').write_text(json.dumps(record, indent=2))
print(json.dumps(record))
