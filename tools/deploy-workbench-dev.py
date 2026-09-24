"""Deploy the verified development artifact, with web/relay/service rollback."""
import re, argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, time, urllib.request, urllib.error
parser = argparse.ArgumentParser()
parser.add_argument('--version', required=True)
parser.add_argument('--expected', required=True)
args = parser.parse_args()
assert all(c.isdigit() or c == '.' for c in args.version), 'Invalid release version'
version = args.version
base = pathlib.Path('/var/www/obr-plugins')
active = base / 'suite-dev'
backup = base / ('suite-dev-before-workbench-' + version)
relay = pathlib.Path('/opt/obr-workbench-relay-dev')
relay_backup = relay / ('before-' + version)
service = 'obr-workbench-relay-dev'
dropin = pathlib.Path('/etc/systemd/system/' + service + '.service.d/workbench-data.conf')
def digest_tree(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
def relay_ready():
    for _ in range(30):
        try:
            urllib.request.urlopen('http://127.0.0.1:5012/', timeout=2)
        except urllib.error.HTTPError as error:
            if error.code == 401: return
        except (OSError, TimeoutError): pass
        time.sleep(.2)
    raise RuntimeError('Relay did not start')
assert not backup.exists() and not relay_backup.exists(), 'Rollback backup already exists'
assert json.loads((active/'manifest-dev.json').read_text())['version'] == args.expected, 'Live dev version changed'
stable_before = digest_tree(base / 'suite')
staging = pathlib.Path(tempfile.mkdtemp(prefix='.workbench-' + version + '-', dir=base))
with tarfile.open('/tmp/suite-dev-' + version + '.tar.gz') as package:
    for member in package.getmembers():
        dest = (staging / member.name).resolve()
        if not dest.is_relative_to(staging.resolve()) or member.issym() or member.islnk():
            raise RuntimeError('Unsafe archive member')
    package.extractall(staging)
candidate = staging / 'suite-dev'
expected = json.loads((candidate/'release-hashes.json').read_text())
assert all(hashlib.sha256((candidate / name).read_bytes()).hexdigest() == value for name, value in expected.items())
assert json.loads((candidate/'manifest-dev.json').read_text())['version'] == version + '-dev'
assert (candidate/'workbench/index.html').is_file()
new_relay = pathlib.Path('/tmp/workbench-relay-' + version)
for filename in ['server.mjs', 'documents.mjs', 'patches.mjs']:
    subprocess.run(['/usr/local/bin/node', '--check', str(new_relay/filename)], check=True)
relay_backup.mkdir()
for filename in ['server.mjs', 'documents.mjs', 'patches.mjs']:
    if (relay/filename).exists(): shutil.copy2(relay/filename, relay_backup/filename)
if dropin.exists(): shutil.copy2(dropin, relay_backup/'workbench-data.conf')
nginx_config = pathlib.Path('/etc/nginx/sites-enabled/obr-plugins').resolve()
nginx_original = nginx_config.read_text()
nginx_pattern = r'(location\s*=\s*/suite-dev/relay\s*\{[^}]*?proxy_read_timeout\s+)\d+s;'
nginx_updated, replacements = re.subn(nginx_pattern, r'\g<1>90s;', nginx_original)
assert replacements == 1, 'Expected exactly one development relay location'
shutil.copy2(nginx_config, relay_backup/'nginx-config')
web_moved = False
desired_dropin = '[Service]\nStateDirectory=obr-workbench-relay-dev\nStateDirectoryMode=0700\nEnvironment=WORKBENCH_DATA_DIR=/var/lib/obr-workbench-relay-dev\n'
relay_changed = not dropin.exists() or dropin.read_text() != desired_dropin or any(not (relay/name).exists() or (relay/name).read_bytes() != (new_relay/name).read_bytes() for name in ['server.mjs','documents.mjs','patches.mjs'])
try:
    # StateDirectory stays writable under the existing ProtectSystem=strict.
    # Shared room/scene data never enters a public static directory.
    dropin.parent.mkdir(parents=True, exist_ok=True)
    if relay_changed: dropin.write_text(desired_dropin)
    for filename in ['server.mjs','documents.mjs','patches.mjs']:
        if not relay_changed: continue
        temp = relay/(filename+'.new')
        shutil.copyfile(new_relay/filename, temp)
        os.chmod(temp, 0o644)
        os.replace(temp, relay/filename)
    if relay_changed:
        subprocess.run(['systemctl','daemon-reload'], check=True)
        subprocess.run(['systemctl','restart',service], check=True)
    relay_ready()
    if nginx_updated != nginx_original:
        nginx_config.write_text(nginx_updated)
        subprocess.run(['nginx','-t'], check=True)
        subprocess.run(['systemctl','reload','nginx'], check=True)
    os.rename(active, backup)
    web_moved = True
    os.rename(candidate, active)
    assert digest_tree(base/'suite') == stable_before, 'Stable files changed unexpectedly'
    assert all(hashlib.sha256((active/name).read_bytes()).hexdigest() == value for name,value in expected.items())
except BaseException:
    nginx_config.write_text(nginx_original)
    subprocess.run(['nginx','-t'], check=True)
    subprocess.run(['systemctl','reload','nginx'], check=True)
    if web_moved:
        if active.exists(): os.rename(active, staging/'failed-suite-dev')
        os.rename(backup, active)
    for filename in ['server.mjs','documents.mjs','patches.mjs']:
        if (relay_backup/filename).exists(): shutil.copy2(relay_backup/filename, relay/filename)
        else: (relay/filename).unlink(missing_ok=True)
    if (relay_backup/'workbench-data.conf').exists(): shutil.copy2(relay_backup/'workbench-data.conf', dropin)
    else: dropin.unlink(missing_ok=True)
    if relay_changed:
        subprocess.run(['systemctl','daemon-reload'], check=True)
        subprocess.run(['systemctl','restart',service], check=True)
    raise
record = {'version':version+'-dev','verified_files':len(expected),'stable_files_unchanged':len(stable_before),'rollback_directory':str(backup),'relay_backup':str(relay_backup),'relay_sha256':{name:hashlib.sha256((relay/name).read_bytes()).hexdigest() for name in ['server.mjs','documents.mjs','patches.mjs']},'relay_restarted':relay_changed,'relay_proxy_read_timeout_seconds':90,'real_room_verified':False}
(base/('workbench-'+version+'-deployment.json')).write_text(json.dumps(record,indent=2))
print(json.dumps(record))
