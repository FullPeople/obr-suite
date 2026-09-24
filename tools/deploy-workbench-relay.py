import pathlib, shutil, subprocess
root=pathlib.Path('/opt/obr-workbench-relay-dev');root.mkdir(exist_ok=True)
source=pathlib.Path('/tmp/workbench-relay-164.mjs')
subprocess.run(['/usr/local/bin/node','--check',str(source)],check=True)
for old in [root/'server.mjs',pathlib.Path('/etc/systemd/system/obr-workbench-relay-dev.service')]:
    if old.exists():shutil.copy2(old,str(old)+'.before-164')
shutil.copy2(source,root/'server.mjs')
shutil.copy2('/tmp/obr-workbench-relay-dev.service','/etc/systemd/system/obr-workbench-relay-dev.service')
config=pathlib.Path('/etc/nginx/sites-enabled/obr-plugins').resolve()
original=config.read_text()
location="""    # Isolated development workbench reconnect transport.
    location = /suite-dev/relay {
        proxy_pass http://127.0.0.1:5012;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 35s;
        proxy_buffering off;
        add_header Cache-Control "no-store" always;
    }

"""
if 'location = /suite-dev/relay' not in original:
    backup=pathlib.Path('/var/backups/obr-plugins-before-workbench-164');assert not backup.exists(),'Backup already exists'
    shutil.copy2(config,backup);config.write_text(original.replace('    # API reverse proxy to Flask',location+'    # API reverse proxy to Flask',1))
    try:subprocess.run(['nginx','-t'],check=True)
    except:config.write_text(original);raise
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','obr-workbench-relay-dev'],check=True)
subprocess.run(['systemctl','restart','obr-workbench-relay-dev'],check=True)
subprocess.run(['systemctl','is-active','obr-workbench-relay-dev'],check=True)
subprocess.run(['nginx','-t'],check=True)
subprocess.run(['systemctl','reload','nginx'],check=True)
print('dev relay installed on loopback 5012; original character API unchanged')
