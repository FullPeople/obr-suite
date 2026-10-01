"""217 -> 219 Suite-only hotfix. Default read-only preflight; --apply performs atomic cutover.
Card, stable/independent apps, backends and player data are outside this deployment.
"""
from pathlib import Path, PurePosixPath
import argparse, ctypes, hashlib, json, os, re, shutil, subprocess, sys, tarfile, tempfile, zipfile

BASE_COMMITS = {'web': '023feb6256dd5a1d85d92e9fe338b45fe8f280f0', 'suite': '79e0c46f3d86078946426ccdad4e2a03ced2c34f'}
BASELINE_HASHES = {
    'suite-dev/manifest-dev.json': '657b1dedf671bb7377a49256cce5299d56203a63489fec465eb91eafc63e38b7',
    'suite-dev/release217-hashes.json': '1aee47d04bb803d05a92a25cfa1c8b58998e7719f91226c5ddb9f19cfc55a413',
    'suite-dev/suite-source.zip': 'd94deeaa1fc01bde91408b1fbfa726f0a4e0d5362bf46a0cedc8cdaf9a9e024d',
    'card/release.json': '194ceb43965ff07f8db7d44b8f57839260b1f3c408dd7149840f2c85ea1ead55',
    'card/release217-hashes.json': '5059710c9be605d9532af7a20b0be3b0cd64650b3f49d57d11d28964b5733b1b',
    'card/source.zip': '0f4fdf5bafeb4afe61bce2baf9df5e6bd759dec783f682f094b4085c0763cb43',
}
SUITE_VERSION = '1.0.219-dev'
RUNTIME_BUILD = 'suite-3d-3'
REPLACEMENTS = ['dice3d', 'workbench-dice']
HASH_MANIFEST = 'release219-hashes.json'
SOURCE_COPIES = {'source.zip': ['source.zip', 'workbench/source.zip'], 'suite-source.zip': ['suite-source.zip', 'workbench/suite-source.zip', 'card-viewer/suite-source.zip']}


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


def archive_files(archive_path, target):
    require(sha(archive_path) == target['sha256'], 'Archive SHA mismatch')
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()
        names = [safe_name(member.name) for member in members]
        require(len(names) == len(set(names)), 'Duplicate archive member')
        require(all(member.isfile() for member in members), 'Only regular files accepted')
        require(all(suite_allowed(name) for name in names), 'Path outside Suite hotfix scope')
        version = json.loads(archive.extractfile('manifest-dev.json').read().decode('utf-8'))['version']
        require(version == SUITE_VERSION, 'Archived Suite manifest version mismatch')
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


def validate_source_archives(archive_path, files, receipt):
    require(set(receipt['sources']) == set(SOURCE_COPIES), 'Unexpected source ZIP set')
    with tarfile.open(archive_path) as archive:
        for name, copies in SOURCE_COPIES.items():
            source = receipt['sources'][name]
            expected = receipt['webCommit'] if name == 'source.zip' else receipt['suiteCommit']
            require(source['commit'] == expected and all(files.get(path) == source['sha256'] for path in copies), 'Source ZIP copies/commit differ')
            require(sorted(path for path in files if PurePosixPath(path).name == name) == sorted(copies), 'Unexpected source ZIP copy')
            member = archive.getmember(name)
            require(member.size == source['bytes'], 'Source ZIP byte count differs')
            with archive.extractfile(member) as stream, zipfile.ZipFile(stream) as source_zip:
                names = [item for item in source_zip.namelist() if not item.endswith('/')]
                require(source_zip.comment.decode('ascii') == expected and source_zip.testzip() is None, 'Source ZIP commit/CRC mismatch')
                require(len(names) == len(set(names)) == source['files'] and 'LICENSE' in names, 'Source ZIP file set mismatch')
                for path in names:
                    safe_name(path)


def retained_files(original, new_files):
    return {path: digest for path, digest in original.items() if path not in new_files and path != HASH_MANIFEST and not any(path.startswith(prefix + '/') for prefix in REPLACEMENTS)}


def prepare_stage(root, archive_path, files, original, archive_sha):
    require(sha(archive_path) == archive_sha, 'Archive changed after preflight')
    stage = Path(tempfile.mkdtemp(prefix='.release219-suite-dev-', dir=root)).resolve()
    require(stage.parent == root.resolve(), 'Stage escaped static root')
    shutil.copytree(root / 'suite-dev', stage, dirs_exist_ok=True)
    for subtree in REPLACEMENTS:
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
    unchanged = retained_files(original, files)
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


def cutover(root, stage, verify, exchange=atomic_exchange):
    live, backup, failed = [root / name for name in ['suite-dev', 'suite-dev-before-219', 'suite-dev-failed-219']]
    require(not backup.exists() and not failed.exists(), 'Recovery path exists')
    require(stage.parent.resolve() == root.resolve() and stage != live, 'Invalid stage path')
    exchanged = False
    old_path = stage
    try:
        exchange(live, stage)
        exchanged = True
        stage.rename(backup)
        old_path = backup
        return verify()
    except BaseException:
        if exchanged:
            exchange(live, old_path)
            old_path.rename(failed)
        raise


def started(name):
    return subprocess.check_output(['systemctl', 'show', name, '-p', 'ActiveEnterTimestampMonotonic'], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--archives', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    root = Path('/var/www/obr-plugins').resolve()
    require(root == Path('/var/www/obr-plugins') and root.is_dir(), 'Unexpected server static root')
    receipt = read_json(args.archives / 'package-receipt.json')
    require(receipt.get('release') == 219 and receipt.get('runtimeBuild') == RUNTIME_BUILD, 'Wrong release/runtime receipt')
    require(receipt.get('baselineCommits') == BASE_COMMITS and receipt.get('baselineHashes') == BASELINE_HASHES and receipt.get('replaceSuiteSubtrees') == REPLACEMENTS, 'Baseline/replacement policy changed')
    require(receipt.get('announcementOnlyWeb') is True and receipt.get('announcementVersion') == '0.1.19' and receipt.get('cardWebCommit') == BASE_COMMITS['web'], 'Web change must be Suite-announcement-only')
    web_changes = receipt['reviewedChanges']['web']
    require(all(name in ['src/platform/announcement.ts', 'src/platform/releaseNotes.ts'] or name.startswith('docs/') and name.endswith(('.md', '.txt')) for name in web_changes), 'Receipt includes unrelated Web changes')
    require(all(receipt.get(name) is False for name in ['relayChanged', 'playerDataChanged', 'standaloneChanged']), 'Outside static hotfix scope')
    require(set(receipt['targets']) == {'suite-dev'} and receipt['targets']['suite-dev']['version'] == SUITE_VERSION, 'Only Suite 219 may be published')
    require(receipt['builder']['tool'] == 'tools/build-release217.mjs' and receipt['builder']['receiptRelease'] == 217, 'Historical builder receipt must be explicit')
    for commit in [receipt['suiteCommit'], receipt['webCommit']]:
        require(bool(re.fullmatch('[0-9a-f]{40}', commit)), 'Full reviewed source commit required')
    require(read_json(root / 'suite-dev/manifest-dev.json')['version'] == '1.0.217-dev', 'Live Suite no longer 217')
    card = read_json(root / 'card/release.json')
    require(card['version'] == 'standalone-1.0.217' and card['sourceCommit'] == BASE_COMMITS['web'], 'Live card no longer reviewed 217')
    validate(root, BASELINE_HASHES)
    for name in ['suite-dev', 'card']:
        validate(root / name, read_json(root / name / 'release217-hashes.json'))
    for name, commit in [('suite-dev/suite-source.zip', BASE_COMMITS['suite']), ('card/source.zip', BASE_COMMITS['web'])]:
        with zipfile.ZipFile(root / name) as archive:
            require(archive.comment.decode('ascii') == commit, 'Live source ZIP commit differs')
    for name in ['suite-dev-before-219', 'suite-dev-failed-219', 'release219-deployment.json', '.release219-deployment.json.tmp']:
        require(not (root / name).exists(), 'Recovery/receipt path exists: ' + name)
    require(not list(root.glob('.release219-suite-dev-*')), 'Incomplete 219 stage exists; inspect it first')
    services = ['obr-workbench-relay-dev', 'obr-three-dragon']
    starts = {name: started(name) for name in services}
    protected_paths = [Path('/opt/obr-workbench-relay-dev') / name for name in ['server.mjs', 'documents.mjs', 'patches.mjs']] + [Path('/etc/nginx/sites-enabled/obr-plugins').resolve(), Path('/opt/obr-three-dragon/server.mjs')]
    protected = {str(path): sha(path) for path in protected_paths}
    sites = {name: tree(root / name) for name in ['card', 'suite', 'dice-lab-dev', 'three-dragon-ante-dev']}
    original = tree(root / 'suite-dev')
    archive_path = args.archives / 'suite-dev-219.tar.gz'
    target = receipt['targets']['suite-dev']
    files = archive_files(archive_path, target)
    require(all(name in files for name in ['manifest-dev.json', 'workbench/index.html', 'workbench/sw.js']), 'Missing final manifest/integrated announcement build')
    for subtree in REPLACEMENTS:
        require(any(path.startswith(subtree + '/') for path in files), 'Missing dice replacement: ' + subtree)
    for asset in receipt['retainedPublicAssets']:
        validate(root / 'suite-dev', {asset['path']: asset['sha256']})
    validate_source_archives(archive_path, files, receipt)
    exchange_api()
    if not args.apply:
        print(json.dumps({'release': 219, 'preflightPassed': True, 'writes': False, 'requiresExplicitApply': True, 'files': len(files), 'protectedSites': {name: len(items) for name, items in sites.items()}, 'cardRemains217': True, 'announcementOnlyWeb': True, 'atomicExchangeApiAvailable': True}, indent=2))
        return
    stage, unchanged = prepare_stage(root, archive_path, files, original, target['sha256'])
    require(read_json(stage / 'manifest-dev.json')['version'] == SUITE_VERSION, 'Staged version mismatch')
    require(tree(root / 'suite-dev') == original, 'Concurrent publication; abort before cutover')
    def verify():
        expected = {**unchanged, **files, HASH_MANIFEST: target['manifestSha256']}
        require(tree(root / 'suite-dev') == expected, 'Live tree differs from stage')
        require(tree(root / 'suite-dev-before-219') == original, 'Recovery point differs from preflight')
        for name in REPLACEMENTS:
            expected_subtree = {path[len(name) + 1:]: digest for path, digest in files.items() if path.startswith(name + '/')}
            require(tree(root / 'suite-dev' / name) == expected_subtree, 'Incomplete/obsolete dice subtree: ' + name)
        require(all(tree(root / name) == items for name, items in sites.items()), 'Protected site changed')
        require(all(sha(Path(path)) == digest for path, digest in protected.items()), 'Service/nginx changed')
        require(all(started(name) == stamp for name, stamp in starts.items()), 'Service restarted')
        record = {'release': 219, 'suiteVersion': SUITE_VERSION, 'suiteCommit': receipt['suiteCommit'], 'webAnnouncementCommit': receipt['webCommit'], 'cardWebCommit': BASE_COMMITS['web'], 'verifiedFiles': len(files), 'unchangedSuiteFiles': len(unchanged), 'protectedSites': {name: len(items) for name, items in sites.items()}, 'backup': str(root / 'suite-dev-before-219'), 'atomicCutover': 'renameat2 RENAME_EXCHANGE', 'baselineHashes': BASELINE_HASHES, 'cardRemains217': True, 'announcementOnlyWeb': True, 'servicesUnchanged': True, 'nginxUnchanged': True, 'deploymentWritesPlayerData': False, 'realOwlbearRoomVerified': False, 'crossHostDicePriorityFixed': False}
        temporary = root / '.release219-deployment.json.tmp'
        with temporary.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(record, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        temporary.rename(root / 'release219-deployment.json')
        return record
    print(json.dumps(cutover(root, stage, verify), indent=2))


if __name__ == '__main__':
    main()
