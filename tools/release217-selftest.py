"""Offline synthetic package/stage/rollback checks. Never accesses the production root."""
from pathlib import Path
import hashlib, importlib.util, io, json, sys, tarfile, tempfile
sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


d = load('deploy-release217')
p = load('package217')
root = Path(tempfile.mkdtemp(prefix='release217-tool-check-', dir='F:/DND-card-217-evidence-20261001/tmp/dice'))
passed = []


def check(name, operation):
    operation()
    passed.append(name)


def rejected(operation):
    try:
        operation()
    except (ValueError, KeyError, RuntimeError):
        return
    raise AssertionError('Unsafe operation was accepted')


def write(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding='utf-8')


def archive(name, content, duplicate=None, link=False):
    path = root / (name + '.tar.gz')
    files = {key: hashlib.sha256(value.encode()).hexdigest() for key, value in content.items()}
    manifest = json.dumps(files).encode()
    with tarfile.open(path, 'w:gz') as output:
        entries = [(key, value.encode()) for key, value in content.items()] + [(d.HASH_MANIFEST, manifest)]
        if duplicate:
            entries.append((duplicate, content[duplicate].encode()))
        for key, value in entries:
            entry = tarfile.TarInfo(key)
            entry.size = len(value)
            output.addfile(entry, io.BytesIO(value))
        if link:
            entry = tarfile.TarInfo('dice3d/link')
            entry.type = tarfile.SYMTYPE
            entry.linkname = '/etc/passwd'
            output.addfile(entry)
    receipt = {'sha256': d.sha(path), 'manifestSha256': hashlib.sha256(manifest).hexdigest(), 'files': len(files), 'bytes': sum(len(value.encode()) for value in content.values())}
    return path, files, receipt


for name in ['../escape', '/etc/passwd', 'C:/escape', 'a\\b', './a', 'a//b']:
    check('reject path ' + name, lambda name=name: rejected(lambda: d.safe_name(name)))
content = {'dice3d/overlay.html': 'new renderer', 'dice3d/assets/new.js': 'R8', 'workbench-dice/index.html': 'new panel', 'assets/new.js': 'new host', 'manifest-dev.json': '{"version":"1.0.217-dev"}'}
tar, hashes, target = archive('valid', content)
check('full archive content and byte count', lambda: d.require(d.archive_files(tar, 'suite-dev', target) == hashes, 'manifest mismatch'))
for label, extra in [('traversal', {'../outside': 'bad'}), ('independent app', {'card-viewer/index.html': 'bad'}), ('service path', {'relay/server.mjs': 'bad'})]:
    bad, _, metadata = archive(label, {**content, **extra})
    check('reject ' + label, lambda bad=bad, metadata=metadata: rejected(lambda: d.archive_files(bad, 'suite-dev', metadata)))
bad, _, metadata = archive('duplicate', content, duplicate='dice3d/overlay.html')
check('reject duplicate member', lambda: rejected(lambda: d.archive_files(bad, 'suite-dev', metadata)))
bad, _, metadata = archive('symlink', content, link=True)
check('reject symlink member', lambda: rejected(lambda: d.archive_files(bad, 'suite-dev', metadata)))
check('reject mismatched archive digest', lambda: rejected(lambda: d.archive_files(tar, 'suite-dev', {**target, 'sha256': '0' * 64})))
live_root = root / 'static'
for name, value in {'dice3d/old.js': 'old renderer', 'workbench-dice/old.js': 'old panel', 'assets/retained.js': 'old referenced host asset', 'card-viewer/index.html': 'independent reader', 'three-dragon/app.js': 'independent app', 'workbench-panels/index.html': 'independent panels', 'manifest-dev.json': '{"version":"1.0.216-dev"}'}.items():
    write(live_root / 'suite-dev' / name, value)
before = d.tree(live_root / 'suite-dev')
stage, unchanged = d.prepare_stage(live_root, 'suite-dev', tar, hashes, before, target['sha256'])
check('stage does not change live', lambda: d.require(d.tree(live_root / 'suite-dev') == before, 'live changed'))
check('complete new dice tree removes old chunks', lambda: d.require(d.tree(stage / 'dice3d') == {'overlay.html': hashes['dice3d/overlay.html'], 'assets/new.js': hashes['dice3d/assets/new.js']} and not (stage / 'workbench-dice/old.js').exists(), 'stale dice retained'))
check('independent applications and unrelated assets preserved', lambda: d.validate(stage, unchanged))
backup = live_root / 'suite-dev-before-217'
check('verification failure rolls back', lambda: rejected(lambda: d.cutover(live_root, {'suite-dev': stage}, {'suite-dev': backup}, lambda: (_ for _ in ()).throw(RuntimeError('synthetic verify failure')))))
check('rollback restores full live tree and retains failed candidate', lambda: d.require(d.tree(live_root / 'suite-dev') == before and (live_root / 'suite-dev-failed-217/dice3d/assets/new.js').is_file() and not backup.exists(), 'rollback mismatch'))
web = root / 'web'
for name in ['src/a.ts', 'public/a.svg', 'tools/build.mjs', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']:
    write(web / name, 'source')
source = p.web_sources(web)
write(web / 'tsconfig.tsbuildinfo', 'generated cache')
check('Web build cache is not a source input', lambda: d.require(p.web_sources(web) == source, 'cache included'))
write(web / 'src/a.ts', 'changed')
check('Web source changes invalidate snapshot', lambda: d.require(p.web_sources(web) != source, 'source change missed'))
result = {'allPassed': True, 'passed': len(passed), 'failed': 0, 'checks': passed, 'fixtureRoot': str(root), 'networkRequests': 0, 'productionWrites': False}
(root / 'results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, indent=2))
