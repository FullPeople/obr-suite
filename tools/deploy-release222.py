"""Static card217 + Suite baseline ->222. Default read-only; --apply atomically exchanges each site.
Never restarts services, alters independent applications, or accesses player records.
"""
from pathlib import Path, PurePosixPath
import argparse, ctypes, hashlib, json, os, re, shutil, subprocess, sys, tarfile, tempfile, zipfile

BASE_COMMITS = {'web': '023feb6256dd5a1d85d92e9fe338b45fe8f280f0', 'suite': 'a0db78b416b3b532c0bc062811a75c5d4117016a'}
BASELINE_HASHES = {
    'suite-dev/manifest-dev.json': 'fc8c387a788f5240dd42d23ece2115fe44dd69dbb51453a38f97b1a6c241c41f',
    'suite-dev/release219-hashes.json': 'd67e5919c03a61f96ca239b093910933032d4281ee0413cfcaf603e90c311bcd',
    'suite-dev/dice3d220-hashes.json': '7e6ab69217685d6154a8f9a7267ef1a5ef229324d4f3bd3d41f327fe448bcf31',
    'suite-dev/suite-source.zip': 'cfe886db690bb0d2d1b230538c429eaf92736beadbfbce58f7d4f26469a94639',
    'suite-dev/source.zip': 'bd60c247b20008a4147843fe2c25b347429ec636719b530e53d3cfcfe24e3802',
    'card/release.json': '194ceb43965ff07f8db7d44b8f57839260b1f3c408dd7149840f2c85ea1ead55',
    'card/release217-hashes.json': '5059710c9be605d9532af7a20b0be3b0cd64650b3f49d57d11d28964b5733b1b',
    'card/source.zip': '0f4fdf5bafeb4afe61bce2baf9df5e6bd759dec783f682f094b4085c0763cb43',
}
BASELINE_MANIFESTS = {'card': ['release217-hashes.json'], 'suite-dev': ['release219-hashes.json', 'dice3d220-hashes.json']}
TARGETS = {'card': ('release.json', 'standalone-1.0.217', 'standalone-1.0.222'), 'suite-dev': ('manifest-dev.json', '1.0.220-dev', '1.0.222-dev')}
RUNTIME_BUILD = 'suite-3d-3'
REPLACEMENTS = ['dice3d', 'workbench-dice']
HASH_MANIFEST = 'release222-hashes.json'
SOURCE_COPIES_BY_TARGET = {'card': {'source.zip': ['source.zip']}, 'suite-dev': {'source.zip': ['source.zip', 'workbench/source.zip'], 'suite-source.zip': ['suite-source.zip', 'workbench/suite-source.zip', 'card-viewer/suite-source.zip']}}
ROOT = Path('/var/www/obr-plugins')


def allowed(target, name):
    if target == 'suite-dev':
        return suite_allowed(name)
    return name.startswith(('assets/', 'dice/', 'support/')) or name == 'downloads/DND-Card-Standalone-222.zip' or name in ['index.html', 'sw.js', 'exe_icon.png', 'favicon.svg', 'owner-step1.png', 'owner-step2.png', 'owner-step3.png', 'source.zip', 'LICENSE.txt', 'third-party-licenses.txt', 'standalone-audit.json', 'release.json', HASH_MANIFEST]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def stream_sha256(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


def sha(path):
    with Path(path).open('rb') as stream:
        return stream_sha256(stream)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def safe_name(name):
    path = PurePosixPath(name)
    require(bool(name) and not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name and path.as_posix() == name and name != '.', 'Unsafe archive path: ' + name)
    return name


def host_allowed(name):
    return name.startswith(('assets/', 'workbench-dice/', 'dice3d/')) or '/' not in name and name.endswith('.html')


def suite_allowed(name):
    return host_allowed(name) or name.startswith('workbench/') or name in ['manifest-dev.json', 'source.zip', 'suite-source.zip', 'card-viewer/suite-source.zip', HASH_MANIFEST]


def tree(folder):
    require(folder.is_dir() and not folder.is_symlink(), 'Missing/linked static directory: ' + str(folder))
    result = {}
    for path in sorted(folder.rglob('*')):
        require(not path.is_symlink(), 'Linked static path: ' + str(path))
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = sha(path)
    return result


def validate(folder, files):
    for name, digest in files.items():
        safe_name(name)
        path = (folder / name).resolve()
        require(path.is_relative_to(folder.resolve()) and path.is_file() and sha(path) == digest, 'Changed/absent file: ' + str(path))


def archive_files(archive_path, name, target):
    require(sha(archive_path) == target['sha256'], 'Archive SHA mismatch')
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()
        names = [safe_name(member.name) for member in members]
        require(len(names) == len(set(names)), 'Duplicate archive member')
        require(all(member.isfile() for member in members), 'Only regular files accepted')
        require(all(allowed(name, path) for path in names), 'Path outside approved static scope')
        version = json.loads(archive.extractfile(TARGETS[name][0]).read().decode('utf-8'))['version']
        require(version == TARGETS[name][2], 'Archived version mismatch')
        manifest = archive.extractfile(HASH_MANIFEST).read()
        require(hashlib.sha256(manifest).hexdigest() == target['manifestSha256'], 'Manifest SHA mismatch')
        files = json.loads(manifest.decode('utf-8'))
        require(len(files) == target['files'] and set(names) == set(files) | {HASH_MANIFEST} and HASH_MANIFEST not in files, 'Archive inventory mismatch')
        count_bytes = 0
        for member in members:
            if member.name == HASH_MANIFEST:
                continue
            require(bool(re.fullmatch('[0-9a-f]{64}', files[member.name])), 'Invalid file digest')
            with archive.extractfile(member) as stream:
                require(stream_sha256(stream) == files[member.name], 'Entry SHA mismatch: ' + member.name)
            count_bytes += member.size
        require(count_bytes == target['bytes'], 'Content byte count mismatch')
    return files


def validate_source_archives(archive_path, name, files, receipt):
    require(set(receipt['sources']) == {'source.zip', 'suite-source.zip'}, 'Unexpected source ZIP set')
    with tarfile.open(archive_path) as archive:
        for filename, copies in SOURCE_COPIES_BY_TARGET[name].items():
            source = receipt['sources'][filename]
            expected = receipt['webCommit'] if filename == 'source.zip' else receipt['suiteCommit']
            require(source['commit'] == expected and all(files.get(path) == source['sha256'] for path in copies), 'Source ZIP copies/commit differ')
            require(sorted(path for path in files if PurePosixPath(path).name == filename) == sorted(copies), 'Unexpected source ZIP copy')
            member = archive.getmember(filename)
            require(member.size == source['bytes'], 'Source ZIP byte count differs')
            with archive.extractfile(member) as stream, zipfile.ZipFile(stream) as source_zip:
                names = [item for item in source_zip.namelist() if not item.endswith('/')]
                require(source_zip.comment.decode('ascii') == expected and source_zip.testzip() is None, 'Source ZIP commit/CRC mismatch')
                require(len(names) == len(set(names)) == source['files'] and 'LICENSE' in names, 'Source ZIP file set mismatch')
                for path in names:
                    safe_name(path)


def retained_files(original, new_files, name):
    return {path: digest for path, digest in original.items() if path not in new_files and path != HASH_MANIFEST and not (name == 'suite-dev' and any(path.startswith(prefix + '/') for prefix in REPLACEMENTS))}


def prepare_stage(root, name, archive_path, files, original, archive_sha):
    require(sha(archive_path) == archive_sha, 'Archive changed after preflight')
    stage = Path(tempfile.mkdtemp(prefix='.release222-' + name + '-', dir=root)).resolve()
    require(stage.parent == root.resolve(), 'Stage escaped static root')
    shutil.copytree(root / name, stage, dirs_exist_ok=True)
    for subtree in (REPLACEMENTS if name == 'suite-dev' else []):
        path = stage / subtree
        require(path.parent.resolve() == stage and path.resolve().is_relative_to(stage) and not path.is_symlink(), 'Replacement escaped stage')
        if path.exists():
            shutil.rmtree(path)
    # Avoid extractall/filter compatibility differences on server Python 3.9.
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            require(member.isfile(), 'Archive became unsafe')
            target = stage / safe_name(member.name)
            require(target.resolve().is_relative_to(stage), 'Extraction escaped stage')
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open('wb') as output:
                shutil.copyfileobj(source, output)
    require(sha(archive_path) == archive_sha, 'Archive changed during staging')
    validate(stage, files)
    unchanged = retained_files(original, files, name)
    validate(stage, unchanged)
    require(tree(stage) == {**unchanged, **files, HASH_MANIFEST: sha(stage / HASH_MANIFEST)}, 'Unexpected staged content')
    for path in stage.rglob('*'):
        os.chmod(path, 0o755 if path.is_dir() else 0o644)
    os.chmod(stage, 0o755)
    return stage, unchanged


def exchange_api():
    require(sys.platform.startswith('linux'), 'Production atomic cutover requires Linux renameat2')
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, 'renameat2', None)
    require(function is not None, 'renameat2 unavailable; no non-atomic fallback')
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    return function


def atomic_exchange(left, right):
    function = exchange_api()
    if function(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(left))


def started(name):
    return subprocess.check_output(['systemctl', 'show', name, '-p', 'ActiveEnterTimestampMonotonic'], text=True).strip()



def recovery_paths(root):
    return {name: {'backup': root / (name + '-before-222'), 'failed': root / (name + '-failed-222')} for name in TARGETS}


def assert_fresh(root):
    for pair in recovery_paths(root).values():
        require(all(not path.exists() for path in pair.values()), 'Recovery path already exists; inspect without overwriting')
    for name in ['release222-deployment.json', '.release222-deployment.json.tmp']:
        require(not (root / name).exists(), 'Release receipt or unfinished receipt exists')
    require(not list(root.glob('.release222-*')), 'Unfinished stage exists; inspect before retrying')


def cutover(root, stages, verify, exchange=atomic_exchange):
    """Per-site atomic swaps, with reverse-order rollback including a failed backup rename."""
    require(set(stages) == set(TARGETS), 'Both reviewed sites must be staged')
    paths = recovery_paths(root)
    for name, stage in stages.items():
        require(stage.parent.resolve() == root.resolve() and stage != root / name, 'Invalid stage path')
        require(all(not path.exists() for path in paths[name].values()), 'Recovery path exists')
    exchanged = []
    old_paths = {}
    try:
        for name in TARGETS:
            stage = stages[name]
            exchange(root / name, stage)
            exchanged.append(name)
            old_paths[name] = stage
            stage.rename(paths[name]['backup'])
            old_paths[name] = paths[name]['backup']
        return verify()
    except BaseException as cause:
        rollback_errors = []
        for name in reversed(exchanged):
            try:
                exchange(root / name, old_paths[name])
                old_paths[name].rename(paths[name]['failed'])
            except BaseException as error:
                rollback_errors.append(name + ': ' + str(error))
        if rollback_errors:
            raise RuntimeError('Rollback incomplete; preserved paths require operator inspection: ' + '; '.join(rollback_errors)) from cause
        raise


def validate_baseline(root):
    require(all(re.fullmatch('[0-9a-f]{40}', value) for value in BASE_COMMITS.values()), 'Baseline has not been finalized')
    require(all(re.fullmatch('[0-9a-f]{64}', value) for value in BASELINE_HASHES.values()), 'Baseline hashes not finalized')
    require(all(any(path.startswith(name + '/') for path in BASELINE_HASHES) for name in TARGETS), 'Both baselines require pinned file hashes')
    validate(root, BASELINE_HASHES)
    for name, (manifest, old, _) in TARGETS.items():
        require(read_json(root / name / manifest)['version'] == old, name + ': live version changed')
        expected = {}
        for baseline_manifest in BASELINE_MANIFESTS[name]:
            expected.update(read_json(root / name / baseline_manifest))
        validate(root / name, expected)
    require(read_json(root / 'card/release.json')['sourceCommit'] == BASE_COMMITS['web'], 'Live Web source changed')
    for path, commit in [('card/source.zip', BASE_COMMITS['web']), ('suite-dev/suite-source.zip', BASE_COMMITS['suite'])]:
        with zipfile.ZipFile(root / path) as archive:
            require(archive.comment.decode('ascii') == commit and archive.testzip() is None, 'Live source ZIP commit/CRC differs: ' + path)


def capture_protected(root):
    services = ['obr-workbench-relay-dev', 'obr-three-dragon']
    paths = [Path('/opt/obr-workbench-relay-dev') / name for name in ['server.mjs', 'documents.mjs', 'patches.mjs']] + [Path('/etc/nginx/sites-enabled/obr-plugins').resolve(), Path('/opt/obr-three-dragon/server.mjs')]
    return {'services': {name: started(name) for name in services}, 'files': {str(path): sha(path) for path in paths}, 'sites': {name: tree(root / name) for name in ['suite', 'dice-lab-dev', 'three-dragon-ante-dev']}}


def validate_protected(root, before):
    require(all(started(name) == value for name, value in before['services'].items()), 'Protected service restarted')
    require(all(sha(Path(path)) == value for path, value in before['files'].items()), 'Backend/nginx changed')
    require(all(tree(root / name) == value for name, value in before['sites'].items()), 'Protected independent site changed')


def preflight(root, archives):
    require(root.resolve() == ROOT.resolve() and root.is_dir(), 'Unexpected server static root')
    receipt = read_json(archives / 'package-receipt.json')
    require(receipt.get('release') == 222 and receipt.get('announcementVersion') == '0.1.20' and receipt.get('runtimeBuild') == RUNTIME_BUILD, 'Wrong release receipt')
    require(receipt.get('baselineCommits') == BASE_COMMITS and receipt.get('baselineHashes') == BASELINE_HASHES and receipt.get('baselineHashManifests') == BASELINE_MANIFESTS, 'Baseline guard differs')
    require(receipt.get('replaceSuiteSubtrees') == REPLACEMENTS and receipt.get('relayChanged') is False and receipt.get('playerDataChanged') is False, 'Not the reviewed static scope')
    require(receipt.get('builder') == {'tool': 'tools/build-release217.mjs', 'receiptRelease': 217}, 'Historical builder contract differs')
    require(set(receipt['targets']) == set(TARGETS), 'Unexpected target set')
    for commit in [receipt['webCommit'], receipt['suiteCommit']]:
        require(bool(re.fullmatch('[0-9a-f]{40}', commit)), 'Full reviewed source SHA required')
    assert_fresh(root)
    validate_baseline(root)
    original = {name: tree(root / name) for name in TARGETS}
    protected = capture_protected(root)
    manifests = {}
    for name, (manifest, _, version) in TARGETS.items():
        target = receipt['targets'][name]
        require(target['version'] == version, 'Unexpected new version')
        archive = archives / (name + '-222.tar.gz')
        files = archive_files(archive, name, target)
        validate_source_archives(archive, name, files, receipt)
        require(manifest in files, 'Version entry absent')
        if name == 'card':
            with tarfile.open(archive) as package:
                card = json.loads(package.extractfile('release.json').read().decode('utf-8'))
                require(card['sourceCommit'] == receipt['webCommit'] and card['announcementVersion'] == '0.1.20', 'Card release binding differs')
                audit = json.loads(package.extractfile('standalone-audit.json').read().decode('utf-8'))
                require(audit['singlePlayer'] is True and audit['multiplayerModules'] == [], 'Standalone contains multiplayer modules')
        else:
            require(all(path in files for path in ['workbench/index.html', 'workbench/sw.js']), 'Integrated build absent')
            for subtree in REPLACEMENTS:
                require(any(path.startswith(subtree + '/') for path in files), 'Fresh dice subtree absent')
        manifests[name] = files
    for asset in receipt['retainedPublicAssets']:
        validate(root / 'suite-dev', {asset['path']: asset['sha256']})
    exchange_api()
    return receipt, original, protected, manifests


def deploy(root, archives, apply=False, exchange=atomic_exchange):
    receipt, original, protected, manifests = preflight(root, archives)
    if not apply:
        return {'release': 222, 'preflightPassed': True, 'writes': False, 'requiresExplicitApply': True, 'files': {name: len(files) for name, files in manifests.items()}, 'atomicExchangeApiAvailable': True}
    stages, unchanged = {}, {}
    for name in TARGETS:
        stages[name], unchanged[name] = prepare_stage(root, name, archives / (name + '-222.tar.gz'), manifests[name], original[name], receipt['targets'][name]['sha256'])
        require(read_json(stages[name] / TARGETS[name][0])['version'] == TARGETS[name][2], 'Staged version differs')
    require(all(tree(root / name) == contents for name, contents in original.items()), 'Concurrent publication detected before cutover')
    validate_protected(root, protected)
    def verify():
        for name, files in manifests.items():
            expected = {**unchanged[name], **files, HASH_MANIFEST: receipt['targets'][name]['manifestSha256']}
            require(tree(root / name) == expected, 'Live files differ from complete staged tree: ' + name)
            require(tree(root / (name + '-before-222')) == original[name], 'Recovery point changed: ' + name)
        for subtree in REPLACEMENTS:
            expected = {path[len(subtree) + 1:]: value for path, value in manifests['suite-dev'].items() if path.startswith(subtree + '/')}
            require(tree(root / 'suite-dev' / subtree) == expected, 'New dice subtree incomplete/contains old chunks')
        validate_protected(root, protected)
        record = {'release': 222, 'versions': {name: values[2] for name, values in TARGETS.items()}, 'webCommit': receipt['webCommit'], 'suiteCommit': receipt['suiteCommit'], 'verifiedFiles': {name: len(files) for name, files in manifests.items()}, 'unchangedFiles': {name: len(files) for name, files in unchanged.items()}, 'protectedSites': {name: len(files) for name, files in protected['sites'].items()}, 'backups': {name: str(root / (name + '-before-222')) for name in TARGETS}, 'atomicCutover': 'per-site renameat2 RENAME_EXCHANGE; reverse-order rollback', 'baselineCommits': BASE_COMMITS, 'baselineHashes': BASELINE_HASHES, 'servicesUnchanged': True, 'nginxUnchanged': True, 'deploymentWritesPlayerData': False, 'realOwlbearRoomVerified': False, 'crossHostDicePriorityFixed': False}
        temporary = root / '.release222-deployment.json.tmp'
        with temporary.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(record, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        temporary.rename(root / 'release222-deployment.json')
        return record
    return cutover(root, stages, verify, exchange)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--archives', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    print(json.dumps(deploy(ROOT, args.archives.resolve(), args.apply), indent=2))


if __name__ == '__main__':
    main()
