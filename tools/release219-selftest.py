"""Synthetic release-219 tool checks. No network, production access or deployment."""
from pathlib import Path
import ast, contextlib, hashlib, importlib.util, io, json, os, shutil, sys, tarfile, tempfile, zipfile
from unittest.mock import patch
sys.dont_write_bytecode = True
if hasattr(hashlib, 'file_digest'):
    delattr(hashlib, 'file_digest')


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


d, p = load('deploy-release219'), load('package219')
evidence = Path(os.environ.get('DND_RELEASE219_TOOL_EVIDENCE', 'F:/DND-card-dice-hotfix219-evidence-20261001/release-tools'))
evidence.mkdir(parents=True, exist_ok=True)
root = Path(tempfile.mkdtemp(prefix='offline-check-', dir=evidence))
passed = []


def check(name, operation):
    operation()
    passed.append(name)


def rejected(operation):
    try:
        operation()
    except (ValueError, KeyError, RuntimeError, OSError):
        return
    raise AssertionError('Unsafe operation accepted')


def write(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding='utf-8')


def archive(name, content, duplicate=None, link=False, corrupt=None):
    path = root / (name + '.tar.gz')
    content = {key: value.encode() if isinstance(value, str) else value for key, value in content.items()}
    files = {key: hashlib.sha256(value).hexdigest() for key, value in content.items()}
    manifest = json.dumps(files).encode()
    with tarfile.open(path, 'w:gz') as output:
        entries = list(content.items()) + [(d.HASH_MANIFEST, manifest)]
        if duplicate:
            entries.append((duplicate, content[duplicate]))
        for key, value in entries:
            entry = tarfile.TarInfo(key)
            payload = b'corrupt' if key == corrupt else value
            entry.size = len(payload)
            output.addfile(entry, io.BytesIO(payload))
        if link:
            entry = tarfile.TarInfo('dice3d/link')
            entry.type, entry.linkname = tarfile.SYMTYPE, '/etc/passwd'
            output.addfile(entry)
    return path, files, {'sha256': d.sha(path), 'manifestSha256': hashlib.sha256(manifest).hexdigest(), 'files': len(files), 'bytes': sum(len(value) for value in content.values())}


def synthetic_exchange(left, right):
    # State-machine fixture only: production always uses one Linux renameat2.
    temporary = left.with_name('.synthetic-exchange')
    rename_original(left, temporary)
    rename_original(right, left)
    rename_original(temporary, right)


rename_original = Path.rename
payload = b'chunk-boundary' * 160000
check('streaming SHA without hashlib.file_digest', lambda: d.require(d.stream_sha256(io.BytesIO(payload)) == hashlib.sha256(payload).hexdigest(), 'digest mismatch'))
for name in ['../escape', '/etc/passwd', 'C:/escape', 'a\\b', './a', 'a//b', '', '.']:
    check('reject path ' + repr(name), lambda name=name: rejected(lambda: d.safe_name(name)))
content = {'dice3d/overlay.html': 'renderer219', 'dice3d/assets/new.js': 'worker219', 'workbench-dice/index.html': 'panel219', 'workbench/index.html': 'announcement only', 'workbench/sw.js': 'cache announcement', 'assets/new.js': 'host219', 'manifest-dev.json': '{"version":"1.0.219-dev"}'}
tar, hashes, target = archive('valid', content)
check('full tar inventory, hashes and bytes', lambda: d.require(d.archive_files(tar, target) == hashes, 'archive mismatch'))
for label, extra in [('traversal', {'../outside': 'bad'}), ('card site', {'card/index.html': 'bad'}), ('stable manifest', {'manifest.json': 'bad'}), ('independent viewer', {'card-viewer/index.html': 'bad'}), ('service', {'relay/server.mjs': 'bad'}), ('prior baseline overwrite', {'release217-hashes.json': 'bad'})]:
    bad, _, metadata = archive(label, {**content, **extra})
    check('reject ' + label, lambda bad=bad, metadata=metadata: rejected(lambda: d.archive_files(bad, metadata)))
for label, kwargs in [('duplicate', {'duplicate': 'dice3d/overlay.html'}), ('symlink', {'link': True}), ('entry corruption', {'corrupt': 'dice3d/overlay.html'})]:
    bad, _, metadata = archive(label, content, **kwargs)
    check('reject ' + label, lambda bad=bad, metadata=metadata: rejected(lambda: d.archive_files(bad, metadata)))
check('reject archive digest mismatch', lambda: rejected(lambda: d.archive_files(tar, {**target, 'sha256': '0' * 64})))
check('reject manifest digest mismatch', lambda: rejected(lambda: d.archive_files(tar, {**target, 'manifestSha256': '0' * 64})))
check('reject byte count mismatch', lambda: rejected(lambda: d.archive_files(tar, {**target, 'bytes': target['bytes'] + 1})))
bad_version, _, version_target = archive('wrong-version', {**content, 'manifest-dev.json': '{"version":"1.0.218-dev"}'})
check('reject archived manifest version even with correct tar hashes', lambda: rejected(lambda: d.archive_files(bad_version, version_target)))

fixture_sources, source_record = dict(content), {'sources': {}, 'webCommit': '1' * 40, 'suiteCommit': '2' * 40}
for name, copies in d.SOURCE_COPIES.items():
    commit = source_record['webCommit' if name == 'source.zip' else 'suiteCommit']
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as output:
        output.comment = commit.encode()
        output.writestr('LICENSE', 'Synthetic fixture only')
        output.writestr('src/example.ts', 'fixture')
    value = buffer.getvalue()
    source_record['sources'][name] = {'commit': commit, 'sha256': hashlib.sha256(value).hexdigest(), 'bytes': len(value), 'files': 2}
    for copy in copies:
        fixture_sources[copy] = value
source_tar, source_files, source_target = archive('source-copies', fixture_sources)
check('source ZIP commits, CRC and all five copies', lambda: d.validate_source_archives(source_tar, source_files, source_record))
bad_record = json.loads(json.dumps(source_record))
bad_record['sources']['suite-source.zip']['commit'] = '3' * 40
check('reject wrong source commit', lambda: rejected(lambda: d.validate_source_archives(source_tar, source_files, bad_record)))
check('reject unequal source copy', lambda: rejected(lambda: d.validate_source_archives(source_tar, {**source_files, 'workbench/suite-source.zip': '0' * 64}, source_record)))
for name in ['src/ui/App.tsx', 'src/ui/styles.css', 'package.json', 'tools/build.mjs', 'docs/hidden.json']:
    check('reject unrelated Web change ' + name, lambda name=name: d.require(not p.web_change_allowed(name), 'Web scope leaked'))
check('accept only announcement source and prose documentation', lambda: d.require(all(p.web_change_allowed(name) for name in ['src/platform/announcement.ts', 'src/platform/releaseNotes.ts', 'docs/RELEASE-219.md']), 'announcement rejected'))


def fixture(label):
    static = root / label
    for name, value in {'dice3d/old.js': 'old', 'workbench-dice/old.js': 'old', 'assets/retained.js': 'retained', 'card-viewer/index.html': 'independent', 'three-dragon/app.js': 'independent', 'workbench-panels/index.html': 'independent', 'workbench/old-217-chunk.js': 'old referenced chunk', 'release217-hashes.json': 'baseline preserved', 'manifest-dev.json': '{"version":"1.0.217-dev"}'}.items():
        write(static / 'suite-dev' / name, value)
    write(static / 'card/index.html', 'card217 unchanged')
    original = d.tree(static / 'suite-dev')
    stage, unchanged = d.prepare_stage(static, tar, hashes, original, target['sha256'])
    return static, original, stage, unchanged


static, before, stage, unchanged = fixture('rollback')
check('staging leaves live and independent card untouched', lambda: d.require(d.tree(static / 'suite-dev') == before and (static / 'card/index.html').read_text() == 'card217 unchanged', 'live changed'))
check('complete dice replacements remove obsolete chunks', lambda: d.require(d.tree(stage / 'dice3d') == {'overlay.html': hashes['dice3d/overlay.html'], 'assets/new.js': hashes['dice3d/assets/new.js']} and not (stage / 'workbench-dice/old.js').exists(), 'stale dice retained'))
check('prior release hashes and unrelated applications preserved', lambda: d.validate(stage, unchanged))
check('verification failure invokes rollback', lambda: rejected(lambda: d.cutover(static, stage, lambda: (_ for _ in ()).throw(RuntimeError('injected post-cutover failure')), exchange=synthetic_exchange)))
check('rollback fully restores live and retains failed candidate', lambda: d.require(d.tree(static / 'suite-dev') == before and (static / 'suite-dev-failed-219/dice3d/assets/new.js').is_file() and not (static / 'suite-dev-before-219').exists(), 'rollback mismatch'))
static2, before2, stage2, _ = fixture('success')
check('successful cutover retains exact before219', lambda: d.require(d.cutover(static2, stage2, lambda: 'verified', exchange=synthetic_exchange) == 'verified' and d.tree(static2 / 'suite-dev-before-219') == before2, 'backup mismatch'))
check('refuse existing recovery point', lambda: rejected(lambda: d.cutover(static2, stage2, lambda: None, exchange=synthetic_exchange)))
static3, before3, stage3, _ = fixture('first-exchange-fails')
check('first exchange failure does not modify live', lambda: rejected(lambda: d.cutover(static3, stage3, lambda: None, exchange=lambda *_: (_ for _ in ()).throw(OSError('synthetic unsupported exchange')))))
check('failed exchange leaves candidate for inspection', lambda: d.require(d.tree(static3 / 'suite-dev') == before3 and stage3.exists(), 'exchange failure lost data'))
static4, before4, stage4, _ = fixture('backup-rename-fails')


def fail_backup_rename(self, destination):
    if self == stage4 and Path(destination).name == 'suite-dev-before-219':
        raise OSError('synthetic backup rename failure')
    return rename_original(self, destination)


with patch.object(Path, 'rename', fail_backup_rename):
    check('backup naming failure rolls back from exchanged stage', lambda: rejected(lambda: d.cutover(static4, stage4, lambda: None, exchange=synthetic_exchange)))
check('backup naming failure preserves original and failed candidate', lambda: d.require(d.tree(static4 / 'suite-dev') == before4 and (static4 / 'suite-dev-failed-219').exists(), 'rollback after rename failed'))

# Exercise the actual CLI entry point with injected filesystem/service adapters.
# The production script still has one fixed root and no test mode or root override.
server = root / 'server-cli-fixture'
static_root = server / 'var/www/obr-plugins'
for name in ['card', 'suite-dev', 'suite', 'dice-lab-dev', 'three-dragon-ante-dev']:
    write(static_root / name / 'preserve.txt', 'original ' + name)
write(static_root / 'card/release.json', json.dumps({'version': 'standalone-1.0.217', 'sourceCommit': d.BASE_COMMITS['web']}))
write(static_root / 'suite-dev/manifest-dev.json', '{"version":"1.0.217-dev"}')
for site, filename, commit in [('card', 'source.zip', d.BASE_COMMITS['web']), ('suite-dev', 'suite-source.zip', d.BASE_COMMITS['suite'])]:
    with zipfile.ZipFile(static_root / site / filename, 'w') as archive_zip:
        archive_zip.comment = commit.encode()
        archive_zip.writestr('LICENSE', 'baseline fixture')
    write(static_root / site / 'release217-hashes.json', json.dumps(d.tree(static_root / site)))
fixture_baseline = {name: d.sha(static_root / name) for name in d.BASELINE_HASHES}
for name in ['opt/obr-workbench-relay-dev/server.mjs', 'opt/obr-workbench-relay-dev/documents.mjs', 'opt/obr-workbench-relay-dev/patches.mjs', 'etc/nginx/sites-enabled/obr-plugins', 'opt/obr-three-dragon/server.mjs']:
    write(server / name, 'protected service fixture')
upload = server / 'upload'
upload.mkdir()
shutil.copy2(source_tar, upload / 'suite-dev-219.tar.gz')
fixture_receipt = {**source_record, 'release': 219, 'runtimeBuild': d.RUNTIME_BUILD, 'baselineCommits': d.BASE_COMMITS, 'baselineHashes': fixture_baseline, 'replaceSuiteSubtrees': d.REPLACEMENTS, 'announcementOnlyWeb': True, 'announcementVersion': '0.1.19', 'cardWebCommit': d.BASE_COMMITS['web'], 'reviewedChanges': {'web': ['src/platform/announcement.ts', 'src/platform/releaseNotes.ts']}, 'relayChanged': False, 'playerDataChanged': False, 'standaloneChanged': False, 'targets': {'suite-dev': {**source_target, 'version': d.SUITE_VERSION}}, 'builder': {'tool': 'tools/build-release217.mjs', 'receiptRelease': 217}, 'retainedPublicAssets': []}
write(upload / 'package-receipt.json', json.dumps(fixture_receipt))
before_cli = d.tree(server)
real_cutover = d.cutover


def fixture_path(value):
    text = str(value)
    return server / text.lstrip('/') if text.startswith(('/var/www/', '/opt/', '/etc/')) else Path(value)


def cli(apply=False):
    arguments = ['deploy-release219.py', '--archives', str(upload)] + (['--apply'] if apply else [])
    output = io.StringIO()
    with patch.object(d, 'Path', fixture_path), patch.object(d, 'BASELINE_HASHES', fixture_baseline), patch.object(d, 'started', lambda name: 'unchanged fixture service ' + name), patch.object(d, 'exchange_api', lambda: None), patch.object(d, 'cutover', lambda base, candidate, verify: real_cutover(base, candidate, verify, exchange=synthetic_exchange)), patch.object(sys, 'argv', arguments), contextlib.redirect_stdout(output):
        d.main()
    return json.loads(output.getvalue())


check('actual CLI default preflight succeeds with writes false', lambda: d.require(cli()['writes'] is False, 'preflight did not report read-only'))
check('actual CLI preflight leaves every fixture file unchanged', lambda: d.require(d.tree(server) == before_cli and not list(static_root.glob('.release219-*')), 'preflight wrote files'))
write(static_root / 'card/preserve.txt', 'concurrent card change')
check('actual CLI rejects changed 217 baseline content', lambda: rejected(lambda: cli()))
write(static_root / 'card/preserve.txt', 'original card')
card_before_cli = d.tree(static_root / 'card')
suite_before_cli = d.tree(static_root / 'suite-dev')
check('actual CLI apply verifies candidate and writes success receipt', lambda: d.require(cli(True)['release'] == 219 and (static_root / 'release219-deployment.json').is_file(), 'apply receipt missing'))
check('actual CLI apply preserves card and exact recovery point', lambda: d.require(d.tree(static_root / 'card') == card_before_cli and d.tree(static_root / 'suite-dev-before-219') == suite_before_cli, 'protected/recovery tree changed'))
for name in ['package219.py', 'deploy-release219.py', 'release219-selftest.py']:
    check('Python 3.9 syntax ' + name, lambda name=name: ast.parse(Path(__file__).with_name(name).read_text(encoding='utf-8'), feature_version=(3, 9)))
result = {'allPassed': True, 'passed': len(passed), 'failed': 0, 'checks': passed, 'fixtureRoot': str(root), 'networkRequests': 0, 'productionWrites': False, 'atomicExchange': 'Windows injected state-machine fixture; production Linux renameat2 not executed'}
(root / 'results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, indent=2))
