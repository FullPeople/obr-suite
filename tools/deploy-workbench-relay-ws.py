"""Enable the WebSocket receive path for the dev workbench relay.

Run on the server after `server/workbench-relay/*.mjs` have been copied to
/opt/obr-workbench-relay-dev (the existing deploy-workbench-relay.py does the
copy). This script only adds the Upgrade/Connection headers that nginx needs
to proxy a WebSocket on `location = /suite-dev/relay`, keeps a backup of the
site file, validates the config and reloads nginx. Without these headers the
clients detect the refused upgrade and keep long-polling, so running this is
an optimisation, never a requirement for the relay to work.
"""
import pathlib, re, shutil, subprocess, sys, time
config = pathlib.Path('/etc/nginx/sites-enabled/obr-plugins').resolve()
original = config.read_text()
marker = 'location = /suite-dev/relay {'
if marker not in original:
    sys.exit('relay location block not found; run deploy-workbench-relay.py first')
if 'proxy_set_header Upgrade $http_upgrade;' in original.split(marker, 1)[1].split('}', 1)[0]:
    print('WebSocket upgrade headers already present; nothing to do')
    sys.exit(0)
upgrade = """        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
"""
head, tail = original.split(marker, 1)
block, rest = tail.split('}', 1)
block = re.sub(r'\n\s*proxy_read_timeout [^;]+;', '', block)
patched = head + marker + block.rstrip() + '\n' + upgrade + '    }' + rest
backup = pathlib.Path('/var/backups/obr-plugins-before-relay-ws-%s' % time.strftime('%Y%m%d%H%M%S'))
shutil.copy2(config, backup)
config.write_text(patched)
try:
    subprocess.run(['nginx', '-t'], check=True)
except Exception:
    config.write_text(original)
    raise
subprocess.run(['systemctl', 'restart', 'obr-workbench-relay-dev'], check=True)
subprocess.run(['systemctl', 'is-active', 'obr-workbench-relay-dev'], check=True)
subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
print('relay WebSocket upgrade enabled; backup at', backup)
