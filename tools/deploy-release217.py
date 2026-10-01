"""216 -> 217 static deployment. Default is read-only preflight; --apply enables cutover.
Run only after separately authorized publication. Never restarts services or writes player data.
"""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, os, re, shutil, subprocess, tarfile, tempfile, zipfile

TARGETS = {'card': ('release.json', 'standalone-1.0.216', 'standalone-1.0.217'), 'suite-dev': ('manifest-dev.json', '1.0.216-dev', '1.0.217-dev')}
BASE_COMMITS = {'web': '4e1d74356d1db927a2e6054fe7536287c6ff2484', 'suite': '6ff0b11c42c96bdc64427510b6e8f1862ce30e27'}
REPLACEMENTS = ['dice3d', 'workbench-dice']
HASH_MANIFEST = 'release217-hashes.json'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def stream_sha256(stream):
    # hashlib.file_digest is unavailable on the production server's older Python.
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


def suite_allowed(name):
    return name.startswith(('assets/', 'workbench/', 'workbench-dice/', 'dice3d/')) or name == 'card-viewer/suite-source.zip' or '/' not in name and (name.endswith('.html') or name in ['manifest-dev.json', 'source.zip', 'suite-source.zip', HASH_MANIFEST])


def tree(folder):
    require(folder.is_dir() and not folder.is_symlink(), 'Missing or linked static directory: ' + str(folder))
    result = {}
    for path in sorted(folder.rglob('*')):
        require(not path.is_symlink(), 'Linked static path is outside this deployment contract: ' + str(path))
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = sha(path)
    return result


def validate(folder, files):
    for name, digest in files.items():
        safe_name(name)
        path = (folder / name).resolve()
        require(path.is_relative_to(folder.resolve()) and path.is_file() and sha(path) == digest, 'Changed or absent file: ' + str(path))


def started(name):
    return subprocess.check_output(['systemctl', 'show', name, '-p', 'ActiveEnterTimestampMonotonic'], text=True).strip()


def archive_files(archive_path, name, target):
    require(sha(archive_path) == target['sha256'], 'Archive SHA mismatch: ' + str(archive_path))
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()
        names = [safe_name(member.name) for member in members]
        require(len(names) == len(set(names)), 'Duplicate archive member')
        require(all(member.isfile() for member in members), 'Only ordinary files are accepted; links/devices/directories are rejected')
        require(name != 'suite-dev' or all(suite_allowed(path) for path in names), 'Unapproved Suite path')
        manifest = archive.extractfile(HASH_MANIFEST).read()
        require(hashlib.sha256(manifest).hexdigest() == target['manifestSha256'], 'File manifest SHA differs from package receipt')
        files = json.loads(manifest.decode('utf-8'))
        require(len(files) == target['files'] and set(names) == set(files) | {HASH_MANIFEST}, 'Archive inventory differs from manifest/receipt')
        count_bytes = 0
        for member in members:
            if member.name == HASH_MANIFEST:
                continue
            safe_name(member.name)
            require(bool(re.fullmatch('[0-9a-f]{64}', files[member.name])), 'Invalid digest')
            with archive.extractfile(member) as stream:
                digest = stream_sha256(stream)
            require(digest == files[member.name], 'Archive entry SHA mismatch: ' + member.name)
            count_bytes += member.size
        require(count_bytes == target['bytes'], 'Archive content byte count differs')
    return files


def retained_files(original, new_files, name):
    return {path: digest for path, digest in original.items() if path not in new_files and path != HASH_MANIFEST and not (name == 'suite-dev' and any(path.startswith(prefix + '/') for prefix in REPLACEMENTS))}


def prepare_stage(root, name, archive_path, files, original, archive_sha):
    require(sha(archive_path) == archive_sha, 'Archive changed after preflight')
    stage = Path(tempfile.mkdtemp(prefix='.release217-' + name + '-', dir=root)).resolve()
    require(stage.parent == root.resolve(), 'Stage escaped static root')
    shutil.copytree(root / name, stage, dirs_exist_ok=True)
    if name == 'suite-dev':
        for subtree in REPLACEMENTS:
            path = stage / subtree
            require(path.parent.resolve() == stage and path.resolve().is_relative_to(stage) and not path.is_symlink(), 'Replacement target escaped isolated stage')
            if path.exists():
                shutil.rmtree(path)
    with tarfile.open(archive_path) as archive:
        require(all(member.isfile() and safe_name(member.name) for member in archive.getmembers()), 'Archive became unsafe')
        archive.extractall(stage, filter='data')
    validate(stage, files)
    unchanged = retained_files(original, files, name)
    validate(stage, unchanged)
    # Exact tree comparison rejects accidental extra/missing paths, including obsolete dice chunks.
    expected = {**unchanged, **files, HASH_MANIFEST: sha(stage / HASH_MANIFEST)}
    require(tree(stage) == expected, 'Unexpected staged content')
    for path in stage.rglob('*'):
        os.chmod(path, 0o755 if path.is_dir() else 0o644)
    os.chmod(stage, 0o755)
    return stage, unchanged


def cutover(root, stages, backups, verify):
    moved = []
    try:
        for name, stage in stages.items():
            (root / name).rename(backups[name])
            moved.append(name)
            stage.rename(root / name)
        return verify()
    except BaseException:
        for name in reversed(moved):
            if (root / name).exists():
                (root / name).rename(root / (name + '-failed-217'))
            backups[name].rename(root / name)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Explicitly authorize this invocation to stage and switch the reviewed static package')
    parser.add_argument('--archives', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    root = Path('/var/www/obr-plugins').resolve()
    require(root == Path('/var/www/obr-plugins') and root.is_dir(), 'Unexpected server static root')
    receipt = read_json(args.archives / 'package-receipt.json')
    require(receipt.get('release') == 217 and receipt.get('announcementVersion') == '0.1.19' and receipt.get('runtimeBuild') == 'suite-3d-3', 'Wrong release receipt')
    require(receipt.get('baselineCommits') == BASE_COMMITS and receipt.get('replaceSuiteSubtrees') == REPLACEMENTS, 'Unreviewed baseline/replacement policy')
    require(receipt.get('relayChanged') is False and receipt.get('playerDataChanged') is False, 'Not a static-only package')
    require(set(receipt['targets']) == set(TARGETS), 'Unexpected target set')
    for commit in [receipt['webCommit'], receipt['suiteCommit']]:
        require(bool(re.fullmatch('[0-9a-f]{40}', commit)), 'A full reviewed commit is required')
    for name, (manifest, old, new) in TARGETS.items():
        require(read_json(root / name / manifest)['version'] == old, name + ': live version changed; review before publication')
        require(receipt['targets'][name]['version'] == new, 'Target version differs from locked 217 version')
        validate(root / name, read_json(root / name / 'release216-hashes.json'))
    require(read_json(root / 'card/release.json')['sourceCommit'] == BASE_COMMITS['web'], 'Live Web source differs from reviewed 216')
    with zipfile.ZipFile(root / 'suite-dev/suite-source.zip') as archive:
        require(archive.comment.decode('ascii') == BASE_COMMITS['suite'], 'Live Suite source differs from reviewed 216')
    backups = {name: root / (name + '-before-217') for name in TARGETS}
    require(all(not path.exists() and not (root / (name + '-failed-217')).exists() for name, path in backups.items()), 'Recovery path already exists; never overwrite it')
    require(not (root / 'release217-deployment.json').exists() and not (root / '.release217-deployment.json.tmp').exists(), '217 deployment receipt or incomplete receipt already exists')
    services = ['obr-workbench-relay-dev', 'obr-three-dragon']
    starts = {name: started(name) for name in services}
    protected_paths = [Path('/opt/obr-workbench-relay-dev') / name for name in ['server.mjs', 'documents.mjs', 'patches.mjs']] + [Path('/etc/nginx/sites-enabled/obr-plugins').resolve(), Path('/opt/obr-three-dragon/server.mjs')]
    protected = {str(path): sha(path) for path in protected_paths}
    sites = {name: tree(root / name) for name in ['suite', 'dice-lab-dev', 'three-dragon-ante-dev']}
    original = {name: tree(root / name) for name in TARGETS}
    archives = {name: args.archives / (name + '-217.tar.gz') for name in TARGETS}
    manifests = {name: archive_files(archives[name], name, receipt['targets'][name]) for name in TARGETS}
    for subtree in REPLACEMENTS:
        require(any(path.startswith(subtree + '/') for path in manifests['suite-dev']), 'Fresh replacement missing: ' + subtree)
    for asset in receipt['retainedPublicAssets']:
        validate(root / 'suite-dev', {asset['path']: asset['sha256']})
    # The public source ZIP appears at several targets; every copy must equal its validated source record.
    for name, source in receipt['sources'].items():
        expected_commit = receipt['webCommit'] if name == 'source.zip' else receipt['suiteCommit']
        require(source['commit'] == expected_commit, 'Source commit differs from package')
        for target, files in manifests.items():
            copies = [path for path in files if PurePosixPath(path).name == name]
            require(target != 'suite-dev' or copies, 'Suite source archive absent')
            require(all(files[path] == source['sha256'] for path in copies), 'Source archive copies disagree')
    if not args.apply:
        print(json.dumps({'preflightPassed': True, 'release': 217, 'writes': False, 'files': {name: len(files) for name, files in manifests.items()}, 'newDiceFiles': sum(path.startswith('dice3d/') for path in manifests['suite-dev']), 'requiresExplicitApply': True}, indent=2))
        return
    stages, unchanged = {}, {}
    for name in TARGETS:
        stages[name], unchanged[name] = prepare_stage(root, name, archives[name], manifests[name], original[name], receipt['targets'][name]['sha256'])
        manifest, _, version = TARGETS[name]
        require(read_json(stages[name] / manifest)['version'] == version, 'Staged version mismatch')
    require(all(tree(root / name) == files for name, files in original.items()), 'Concurrent publication; stop before cutover')
    def verify_cutover():
        for name, files in manifests.items():
            validate(root / name, files)
            validate(root / name, unchanged[name])
        for subtree in REPLACEMENTS:
            expected = {path[len(subtree) + 1:]: digest for path, digest in manifests['suite-dev'].items() if path.startswith(subtree + '/')}
            require(tree(root / 'suite-dev' / subtree) == expected, 'New dice application is incomplete or contains obsolete chunks: ' + subtree)
        require(all(tree(root / name) == files for name, files in sites.items()), 'Protected independent site changed')
        require(all(sha(Path(path)) == digest for path, digest in protected.items()), 'Service code or nginx changed')
        require(all(started(name) == stamp for name, stamp in starts.items()), 'Service restarted')
        record = {'versions': {name: values[2] for name, values in TARGETS.items()}, 'webCommit': receipt['webCommit'], 'suiteCommit': receipt['suiteCommit'], 'verifiedFiles': {name: len(files) for name, files in manifests.items()}, 'unchangedFiles': {name: len(files) for name, files in unchanged.items()}, 'replacedSubtrees': {name: sum(path.startswith(name + '/') for path in manifests['suite-dev']) for name in REPLACEMENTS}, 'protectedSites': {name: len(files) for name, files in sites.items()}, 'backups': {name: str(path) for name, path in backups.items()}, 'servicesUnchanged': True, 'nginxUnchanged': True, 'deploymentWritesPlayerData': False, 'realOwlbearRoomVerified': False, 'crossHostDicePriorityFixed': False}
        receipt_tmp = root / '.release217-deployment.json.tmp'
        with receipt_tmp.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(record, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        receipt_tmp.rename(root / 'release217-deployment.json')
        return record
    record = cutover(root, stages, backups, verify_cutover)
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
