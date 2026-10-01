"""Offline release223 safeguards. Uses synthetic data only; never contacts production."""
from pathlib import Path
import ast, contextlib, copy, hashlib, importlib.util, io, json, os, sys, tarfile, tempfile, zipfile
from unittest.mock import patch
sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


d, p = load('deploy-release223'), load('package223')
evidence = Path(os.environ.get('DND_RELEASE223_TOOL_EVIDENCE', Path(__file__).resolve().parents[2] / 'release223' / 'offline-tools'))
evidence.mkdir(parents=True, exist_ok=True)
root = Path(tempfile.mkdtemp(prefix='check-', dir=evidence))
passed = []


def check(name, operation):
    operation()
    passed.append(name)
    print('PASS ' + name)


def rejected(operation):
    try:
        operation()
    except (ValueError, KeyError, RuntimeError, OSError):
        return
    raise AssertionError('Unsafe operation accepted')


def write(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(contents, bytes):
        path.write_bytes(contents)
    else:
        path.write_text(contents, encoding='utf-8')


def encoded(contents):
    return contents if isinstance(contents, bytes) else contents.encode('utf-8')


def archive(folder, target_name, content, duplicate=None, link=False, corrupt=None):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (target_name + '-223.tar.gz')
    content = {key: encoded(value) for key, value in content.items()}
    hashes = {name: hashlib.sha256(value).hexdigest() for name, value in content.items()}
    manifest = json.dumps(hashes).encode()
    with tarfile.open(path, 'w:gz') as output:
        entries = list(content.items()) + [(d.HASH_MANIFEST, manifest)]
        if duplicate:
            entries.append((duplicate, content[duplicate]))
        for key, value in entries:
            member = tarfile.TarInfo(key)
            payload = b'corrupt' if key == corrupt else value
            member.size = len(payload)
            output.addfile(member, io.BytesIO(payload))
        if link:
            member = tarfile.TarInfo('assets/link')
            member.type, member.linkname = tarfile.SYMTYPE, '/etc/passwd'
            output.addfile(member)
    record = {'version': d.TARGETS[target_name][2], 'sha256': d.sha(path), 'manifestSha256': hashlib.sha256(manifest).hexdigest(), 'files': len(hashes), 'bytes': sum(len(value) for value in content.values())}
    return path, hashes, record


def source_zip(commit):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as output:
        output.comment = commit.encode()
        output.writestr('LICENSE', 'Synthetic release fixture')
        output.writestr('src/example.ts', 'fixture')
    return stream.getvalue()


rename = Path.rename


def exchange(left, right):
    # Models state transitions only, not Linux system-call atomicity.
    temporary = left.with_name('.synthetic-exchange')
    rename(left, temporary)
    rename(right, left)
    rename(temporary, right)


for path in ['../escape', '/etc/passwd', 'C:/escape', 'a\\b', './a', 'a//b', '', '.']:
    check('reject unsafe path ' + repr(path), lambda path=path: rejected(lambda: d.safe_name(path)))
for filename in ['deploy-release223.py', 'package223.py']:
    check('Python 3.9 syntax ' + filename, lambda filename=filename: ast.parse(Path(__file__).with_name(filename).read_text(encoding='utf-8'), feature_version=(3, 9)))
payload = b'chunk' * 500000
check('stream SHA compatible with Python 3.9', lambda: d.require(d.stream_sha256(io.BytesIO(payload)) == hashlib.sha256(payload).hexdigest(), 'SHA differs'))

web_commit, suite_commit = '1' * 40, '2' * 40
sources = {}
source_payloads = {}
for name, commit in [('source.zip', web_commit), ('suite-source.zip', suite_commit)]:
    body = source_zip(commit)
    source_payloads[name] = body
    sources[name] = {'commit': commit, 'bytes': len(body), 'files': 2, 'sha256': hashlib.sha256(body).hexdigest()}
content = {
    'card': {'index.html': 'new card', 'sw.js': 'new cache', 'release.json': json.dumps({'version': 'standalone-1.0.223', 'announcementVersion': '0.1.21', 'sourceCommit': web_commit}), 'standalone-audit.json': '{"singlePlayer":true,"multiplayerModules":[]}', 'source.zip': source_payloads['source.zip']},
    'suite-dev': {'manifest-dev.json': '{"version":"1.0.223-dev"}', 'assets/new.js': 'new host', 'dice3d/overlay.html': 'new renderer', 'dice3d/assets/new.js': 'new worker', 'workbench-dice/index.html': 'new panel', 'workbench/index.html': 'new integrated card', 'workbench/sw.js': 'new integrated cache'}
}
for filename, copies in d.SOURCE_COPIES_BY_TARGET['suite-dev'].items():
    for path in copies:
        content['suite-dev'][path] = source_payloads[filename]
ready = root / 'valid'
records, hashes, archives = {}, {}, {}
for name in d.TARGETS:
    archives[name], hashes[name], records[name] = archive(ready, name, content[name])
    check('full tar inventory hashes and bytes ' + name, lambda name=name: d.require(d.archive_files(archives[name], name, records[name]) == hashes[name], 'tar mismatch'))
receipt_base = {'release': 223, 'announcementVersion': '0.1.21', 'runtimeBuild': 'suite-3d-3', 'webCommit': web_commit, 'suiteCommit': suite_commit, 'targets': records, 'sources': sources, 'replaceSuiteSubtrees': d.REPLACEMENTS, 'relayChanged': False, 'playerDataChanged': False, 'builder': {'tool': 'tools/build-release217.mjs', 'receiptRelease': 217}, 'retainedPublicAssets': []}
for name in d.TARGETS:
    check('source ZIP CRC SHA copies and commit ' + name, lambda name=name: d.validate_source_archives(archives[name], name, hashes[name], receipt_base))
for label, extra in [('traversal', {'../outside': 'bad'}), ('stable manifest', {'manifest.json': 'bad'}), ('independent viewer', {'card-viewer/index.html': 'bad'}), ('backend', {'relay/server.mjs': 'bad'}), ('old hash manifest', {'release219-hashes.json': 'bad'})]:
    bad, _, metadata = archive(root / label, 'suite-dev', {**content['suite-dev'], **extra})
    check('reject ' + label, lambda bad=bad, metadata=metadata: rejected(lambda: d.archive_files(bad, 'suite-dev', metadata)))
for label, kwargs in [('duplicate', {'duplicate': 'dice3d/overlay.html'}), ('symlink', {'link': True}), ('entry corruption', {'corrupt': 'dice3d/overlay.html'})]:
    bad, _, metadata = archive(root / label, 'suite-dev', content['suite-dev'], **kwargs)
    check('reject ' + label, lambda bad=bad, metadata=metadata: rejected(lambda: d.archive_files(bad, 'suite-dev', metadata)))
for field, value in [('sha256', '0' * 64), ('manifestSha256', '0' * 64), ('bytes', 1)]:
    check('reject incorrect ' + field, lambda field=field, value=value: rejected(lambda: d.archive_files(archives['suite-dev'], 'suite-dev', {**records['suite-dev'], field: value})))
bad, _, metadata = archive(root / 'wrongversion', 'suite-dev', {**content['suite-dev'], 'manifest-dev.json': '{"version":"1.0.219-dev"}'})
check('reject incorrect version despite matching tar hashes', lambda: rejected(lambda: d.archive_files(bad, 'suite-dev', metadata)))
wrong = copy.deepcopy(receipt_base)
wrong['sources']['suite-source.zip']['commit'] = '3' * 40
check('reject wrong source commit', lambda: rejected(lambda: d.validate_source_archives(archives['suite-dev'], 'suite-dev', hashes['suite-dev'], wrong)))
check('reject source ZIP copy differs', lambda: rejected(lambda: d.validate_source_archives(archives['suite-dev'], 'suite-dev', {**hashes['suite-dev'], 'workbench/source.zip': '0' * 64}, receipt_base)))


def fixture(label):
    static = root / label
    for name in d.TARGETS:
        prior = {'index.html': 'old-' + name, 'assets/retained.js': 'old retained', d.TARGETS[name][0]: json.dumps({'version': d.TARGETS[name][1], **({'sourceCommit': 'a' * 40} if name == 'card' else {})})}
        if name == 'suite-dev':
            prior.update({'dice3d/old.js': 'old renderer', 'workbench-dice/old.js': 'old panel', 'card-viewer/index.html': 'independent viewer', 'workbench/old.js': 'old cache chunk', 'suite-source.zip': source_zip('b' * 40)})
        else:
            prior['source.zip'] = source_zip('a' * 40)
        for path, value in prior.items():
            write(static / name / path, value)
        write(static / name / ('old-' + name + '-hashes.json'), json.dumps(d.tree(static / name)))
    for name in ['suite', 'dice-lab-dev', 'three-dragon-ante-dev']:
        write(static / name / 'preserved.txt', 'independent site')
    write(static / 'player-data-do-not-access/private.json', 'synthetic private data')
    original = {name: d.tree(static / name) for name in d.TARGETS}
    return static, original


def staged(label):
    static, original = fixture(label)
    stages, unchanged = {}, {}
    for name in d.TARGETS:
        stages[name], unchanged[name] = d.prepare_stage(static, name, archives[name], hashes[name], original[name], records[name]['sha256'])
    return static, original, stages, unchanged


static, original, stages, unchanged = staged('success')
check('staging changes neither live target', lambda: d.require(all(d.tree(static / name) == original[name] for name in d.TARGETS), 'live changed'))
check('fresh complete dice subtrees discard obsolete chunks', lambda: d.require(not (stages['suite-dev'] / 'dice3d/old.js').exists() and not (stages['suite-dev'] / 'workbench-dice/old.js').exists(), 'old chunks remain'))
check('retained apps chunks and private sentinel unchanged', lambda: d.require((stages['suite-dev'] / 'card-viewer/index.html').read_text() == 'independent viewer' and (static / 'player-data-do-not-access/private.json').read_text() == 'synthetic private data', 'protected content changed'))
check('two-site atomic exchange successful', lambda: d.require(d.cutover(static, stages, lambda: 'ok', exchange) == 'ok', 'bad result'))
check('both backups match originals exactly', lambda: d.require(all(d.tree(static / (name + '-before-223')) == original[name] for name in d.TARGETS), 'backup differs'))
check('existing recovery path refuses overwrite', lambda: rejected(lambda: d.cutover(static, stages, lambda: None, exchange)))

static, original, stages, _ = staged('second-exchange-fails')
calls = []


def fail_second(left, right):
    calls.append(left.name)
    if len(calls) == 2:
        raise OSError('injected second-site cutover failure')
    exchange(left, right)


check('second target cutover failure rolls first back', lambda: rejected(lambda: d.cutover(static, stages, lambda: None, fail_second)))
check('both live originals restored after second-site failure', lambda: d.require(all(d.tree(static / name) == original[name] for name in d.TARGETS) and calls == ['card', 'suite-dev', 'card'], 'rollback mismatch'))
static, original, stages, _ = staged('post-verification-fails')
calls = []


def tracked_exchange(left, right):
    calls.append(left.name)
    exchange(left, right)


check('post-switch verification failure restores in reverse order', lambda: rejected(lambda: d.cutover(static, stages, lambda: (_ for _ in ()).throw(RuntimeError('injected verification failure')), tracked_exchange)))
check('reverse rollback preserves failed candidates and originals', lambda: d.require(calls == ['card', 'suite-dev', 'suite-dev', 'card'] and all(d.tree(static / name) == original[name] and (static / (name + '-failed-223')).is_dir() for name in d.TARGETS), 'reverse rollback differs'))
static, original, stages, _ = staged('backup-rename-fails')


def fail_backup(self, destination):
    if self == stages['suite-dev'] and Path(destination).name == 'suite-dev-before-223':
        raise OSError('injected backup rename failure')
    return rename(self, destination)


with patch.object(Path, 'rename', fail_backup):
    check('second backup rename failure restores both sites', lambda: rejected(lambda: d.cutover(static, stages, lambda: None, exchange)))
check('backup rename failure retains originals', lambda: d.require(all(d.tree(static / name) == original[name] for name in d.TARGETS), 'rename failure lost original'))

# Execute the actual preflight / deployment path with isolated synthetic baseline constants.
static, original = fixture('cli-path')
baseline_commits = {'web': 'a' * 40, 'suite': 'b' * 40}
baseline_manifests = {name: ['old-' + name + '-hashes.json'] for name in d.TARGETS}
baseline_hashes = {name + '/' + relative: d.sha(static / name / relative) for name in d.TARGETS for relative in [d.TARGETS[name][0], baseline_manifests[name][0], 'source.zip' if name == 'card' else 'suite-source.zip']}
receipt = {**receipt_base, 'baselineCommits': baseline_commits, 'baselineHashes': baseline_hashes, 'baselineHashManifests': baseline_manifests}
write(ready / 'package-receipt.json', json.dumps(receipt))
protected = {'services': {}, 'files': {}, 'sites': {name: d.tree(static / name) for name in ['suite', 'dice-lab-dev', 'three-dragon-ante-dev']}}
with patch.object(d, 'ROOT', static), patch.object(d, 'BASE_COMMITS', baseline_commits), patch.object(d, 'BASELINE_MANIFESTS', baseline_manifests), patch.object(d, 'BASELINE_HASHES', baseline_hashes), patch.object(d, 'exchange_api', lambda: True), patch.object(d, 'capture_protected', lambda _: protected):
    # Suite220 is a pure overlay on219, with older chunks deliberately retained.
    write(static / 'suite-dev/assets/overlay-new.js', 'new overlay asset')
    write(static / 'suite-dev/assets/retained.js', 'overlay overrides old retained asset')
    overlay_name = 'new-overlay-hashes.json'
    overlay = {path: d.sha(static / 'suite-dev' / path) for path in ['assets/overlay-new.js', 'assets/retained.js']}
    write(static / 'suite-dev' / overlay_name, json.dumps(overlay))
    baseline_manifests['suite-dev'].append(overlay_name)
    baseline_hashes['suite-dev/' + overlay_name] = d.sha(static / 'suite-dev' / overlay_name)
    write(ready / 'package-receipt.json', json.dumps(receipt))
    check('ordered overlay supersedes old entry and retains old chunks', lambda: d.validate_baseline(static))
    write(static / 'suite-dev/assets/retained.js', 'tampered')
    check('overlay superseded-file corruption refused', lambda: rejected(lambda: d.validate_baseline(static)))
    write(static / 'suite-dev/assets/retained.js', 'overlay overrides old retained asset')
    write(static / 'suite-dev/dice3d/old.js', 'tampered old retained chunk')
    check('overlay retained old-file corruption refused', lambda: rejected(lambda: d.validate_baseline(static)))
    write(static / 'suite-dev/dice3d/old.js', 'old renderer')
    before = d.tree(static)
    result = d.deploy(static, ready)
    check('default preflight executes with exactly zero file changes', lambda: d.require(result['writes'] is False and d.tree(static) == before, 'preflight wrote files'))
    write(static / 'suite-dev/index.html', 'concurrent bad content')
    check('preflight rejects changed baseline contents', lambda: rejected(lambda: d.deploy(static, ready)))
    write(static / 'suite-dev/index.html', 'old-suite-dev')
    write(static / 'suite-dev/manifest-dev.json', '{"version":"1.0.999-dev"}')
    check('preflight rejects changed live version', lambda: rejected(lambda: d.deploy(static, ready)))
    write(static / 'suite-dev/manifest-dev.json', json.dumps({'version': d.TARGETS['suite-dev'][1]}))
    check('explicit apply creates both verified backups and receipt', lambda: d.require(d.deploy(static, ready, True, exchange)['release'] == 223 and (static / 'release223-deployment.json').is_file(), 'apply failed'))
    check('deployment receipt parses and binds reviewed commits', lambda: d.require(d.read_json(static / 'release223-deployment.json')['suiteCommit'] == suite_commit, 'receipt invalid'))
    check('independent and private sentinel survived full apply', lambda: d.require(all(d.tree(static / name) == tree for name, tree in protected['sites'].items()) and (static / 'player-data-do-not-access/private.json').read_text() == 'synthetic private data', 'protected paths changed'))
    check('duplicate apply refuses existing receipt and backups', lambda: rejected(lambda: d.deploy(static, ready, True, exchange)))

report = {'release': 223, 'passed': len(passed), 'failed': 0, 'productionWrites': False, 'networkRequests': 0, 'realLinuxAtomicSyscallTested': False, 'checks': passed}
write(root / 'report.json', json.dumps(report, indent=2))
print(json.dumps({'passed': len(passed), 'report': str(root / 'report.json'), 'productionWrites': False}))
