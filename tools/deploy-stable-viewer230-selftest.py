"""Synthetic viewer publication transitions; no production access or player data."""
from pathlib import Path
import contextlib, hashlib, importlib.util, io, json, sys, tarfile, tempfile, zipfile
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('viewer230', Path(__file__).with_name('deploy-stable-viewer230.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
commit = 'a' * 40
passed = []


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())


def exchange(left, right):
    temporary = left.with_name('.synthetic-exchange')
    left.rename(temporary)
    right.rename(left)
    temporary.rename(right)


def case(name, apply=False, mutation=None, fails=False, late=None):
    with tempfile.TemporaryDirectory(prefix='viewer230-') as folder:
        base = Path(folder)
        root, archive = base / 'sites', base / 'package'
        write(root / 'card/release.json', json.dumps({'sourceCommit': commit}))
        write(root / 'suite-dev/manifest-dev.json', '{"version":"1.0.230-dev"}')
        write(root / 'suite/manifest.json', '{"version":"1.3.13"}')
        write(root / 'suite/host.js', 'unchanged stable host')
        write(root / 'suite/card-viewer/index.html', 'old viewer')
        write(root / 'suite/card-viewer/assets/old.js', 'cached viewer asset')
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            z.comment = commit.encode()
            z.writestr('LICENSE', 'synthetic')
        source = stream.getvalue()
        write(root / 'suite-dev/source.zip', source)
        files = {'index.html': b'new viewer', 'assets/new.js': b'new chunk', 'source.zip': source, 'VIEWER-NOTE.txt': b'read-only'}
        if mutation == 'traversal': files['../host.js'] = b'bad'
        if mutation == 'host': files['host.js'] = b'bad'
        if mutation == 'source':
            other = io.BytesIO()
            with zipfile.ZipFile(other, 'w') as z:
                z.comment = ('b' * 40).encode()
                z.writestr('LICENSE', 'synthetic')
            files['source.zip'] = other.getvalue()
        archive.mkdir()
        tar = archive / 'viewers230.tar.gz'
        with tarfile.open(tar, 'w:gz') as t:
            for key, value in files.items():
                member = tarfile.TarInfo(key)
                member.size = len(value)
                t.addfile(member, io.BytesIO(value))
        hashes = {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}
        receipt = {'release': 230, 'webCommit': commit, 'sha256': d.sha(tar), 'hashes': hashes, 'baselineViewerHashes': d.tree(root / 'suite/card-viewer')}
        if mutation == 'hash': receipt['sha256'] = '0' * 64
        write(archive / 'receipt.json', json.dumps(receipt))
        if mutation == 'baseline': write(root / 'suite/card-viewer/index.html', 'unexpected edit')
        if mutation == 'version': write(root / 'suite/manifest.json', '{"version":"1.3.14"}')
        if mutation == 'backup': write(root / 'suite/card-viewer-before-startup230/old', 'recovery')
        before = d.tree(root)
        writes = 0

        def guarded_exchange(left, right):
            nonlocal writes
            writes += 1
            if late == 'exchange' and writes == 1: raise OSError('simulated exchange failure')
            exchange(left, right)

        guards = 0

        def guard():
            nonlocal guards
            guards += 1
            if late == 'after' and guards == 3: return {'guard': 'changed'}
            return {'guard': 'fixed'}

        error = None
        with patch.object(d, 'ROOT', root), patch.object(d, 'protected', guard), patch.object(d, 'exchange', guarded_exchange), patch.object(sys, 'argv', ['viewer', '--archives', str(archive)] + (['--apply'] if apply else [])), contextlib.redirect_stdout(io.StringIO()):
            try: d.main()
            except (AssertionError, OSError) as e: error = e
        assert bool(error) == fails, (name, error)
        after = d.tree(root)
        if not apply or fails:
            # Failed staging may retain its evidence directory, but active sites must recover.
            active = {k: v for k, v in after.items() if '/.startup-viewer230-' not in k}
            assert active == before, name
        else:
            assert (root / 'suite/host.js').read_text() == 'unchanged stable host'
            assert (root / 'suite/card-viewer/index.html').read_text() == 'new viewer'
            assert (root / 'suite/card-viewer/assets/old.js').read_text() == 'cached viewer asset'
            assert d.tree(root / 'suite/card-viewer-before-startup230') == receipt['baselineViewerHashes']
            assert d.tree(root / 'card') == {'release.json': before['card/release.json']}
        passed.append(name)
        print('PASS ' + name)


case('read-only preflight leaves all files unchanged')
case('viewer-only publication preserves host and cached assets', apply=True)
for mutation in ['traversal', 'host', 'source', 'hash', 'baseline', 'version', 'backup']:
    case('reject ' + mutation, apply=True, mutation=mutation, fails=True)
case('failed exchange leaves active viewer unchanged', apply=True, fails=True, late='exchange')
case('post-exchange guard failure restores active viewer', apply=True, fails=True, late='after')
print(json.dumps({'passed': len(passed), 'productionAccess': False, 'linuxAtomicityVerified': False}))
