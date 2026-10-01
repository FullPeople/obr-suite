"""Build release-217 static packages only; no network or publication side effects."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, os, re, shutil, subprocess, tarfile, zipfile

RELEASE = 217
WEB_VERSION = '0.1.19'
SUITE_VERSION = '1.0.217-dev'
BASE_WEB = '4e1d74356d1db927a2e6054fe7536287c6ff2484'
BASE_SUITE = '6ff0b11c42c96bdc64427510b6e8f1862ce30e27'
SUITE = Path(__file__).resolve().parents[1]
EVIDENCE = Path('F:/DND-card-217-evidence-20261001')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def git(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo, text=True, encoding='utf-8').strip()


def inventory(folder):
    require(folder.is_dir() and not folder.is_symlink(), 'Missing or linked input: ' + str(folder))
    result = {}
    for path in sorted(folder.rglob('*')):
        require(not path.is_symlink(), 'Symlinks are not release inputs: ' + str(path))
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = sha(path)
    return result


def web_sources(web):
    result = {}
    for name in ['src', 'public', 'tools']:
        result.update({name + '/' + p: h for p, h in inventory(web / name).items()})
    for path in sorted(web.iterdir()):
        if path.is_file() and (path.name in ['index.html', 'package.json', 'package-lock.json'] or path.name.startswith('vite.') and path.suffix in ['.ts', '.js', '.mjs'] or path.name.startswith('tsconfig') and path.suffix == '.json'):
            result[path.name] = sha(path)
    return result


def suite_sources():
    result = {}
    for name in ['src', 'extensions/workbench-dice3d/src', 'extensions/workbench-dice3d/public']:
        result.update({name + '/' + p: h for p, h in inventory(SUITE / name).items()})
    paths = list(SUITE.glob('*.html')) + [p for p in (SUITE / 'public').iterdir() if p.is_file()]
    names = ['package.json', 'package-lock.json', 'vite.config.ts', 'tools/build-workbench-dice.mjs', 'tools/workbench-dice3d-vite.ts', 'tools/workbench-dice3d-history.mjs', 'tools/build-release217.mjs', 'tools/build-workbench-dice3d-release.mjs', 'extensions/workbench-dice3d/overlay.html', 'extensions/workbench-dice3d/skin-preview.html', 'extensions/workbench-dice3d/vite.config.ts']
    paths += [SUITE / name for name in names if (SUITE / name).is_file()]
    result.update({p.relative_to(SUITE).as_posix(): sha(p) for p in paths})
    return result


def validate_files(root, files):
    for name, digest in files.items():
        relative = PurePosixPath(name)
        require(not relative.is_absolute() and '..' not in relative.parts and '\\' not in name and ':' not in name, 'Unsafe path: ' + name)
        file = (root / name).resolve()
        require(file.is_relative_to(root.resolve()) and file.is_file() and sha(file) == digest, 'Changed or absent file: ' + str(file))


def suite_allowed(name):
    return name.startswith(('assets/', 'workbench/', 'workbench-dice/', 'dice3d/')) or name == 'card-viewer/suite-source.zip' or '/' not in name and (name.endswith('.html') or name in ['manifest-dev.json', 'source.zip', 'suite-source.zip'])


def source_archive(repo, output, commit):
    subprocess.run(['git', 'archive', '--format=zip', '--output=' + str(output), commit], cwd=repo, check=True)
    expected = set(git(repo, '-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', commit).splitlines())
    with zipfile.ZipFile(output) as archive:
        names = {name for name in archive.namelist() if not name.endswith('/')}
        require(names == expected, 'Source archive does not contain exactly the tracked source files')
        require(archive.comment.decode('ascii') == commit and archive.testzip() is None, 'Source ZIP integrity or commit differs')
        require('LICENSE' in names, 'Missing source license')
        for name in names:
            parts = PurePosixPath(name).parts
            require(not any(part in ['node_modules', '.local-evidence', 'real-equipment-sources', 'class-audit', 'local-rules', 'work', '.cache'] for part in parts), 'Private/generated source path: ' + name)
            require(not any(part.startswith('.env') and part != '.env.example' for part in parts), 'Environment file in source: ' + name)
    return {'commit': commit, 'files': len(expected), 'bytes': output.stat().st_size, 'sha256': sha(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-root', type=Path, default=Path(os.environ.get('DND_CARD_WEB_ROOT', 'U:/code/DND-card-cloud-feedback-20260930-7f00bead')))
    parser.add_argument('--web-commit')
    parser.add_argument('--suite-commit')
    parser.add_argument('--snapshot-web', type=Path, help='Capture Web source hashes BEFORE the two final builds, then exit; refuses overwrite')
    parser.add_argument('--web-source-snapshot', type=Path)
    parser.add_argument('--standalone', type=Path)
    parser.add_argument('--integrated', type=Path)
    parser.add_argument('--suite-host', type=Path)
    parser.add_argument('--out', type=Path, default=EVIDENCE / 'release217-ready')
    args = parser.parse_args()
    web = args.web_root.resolve()
    if args.snapshot_web:
        require(not args.snapshot_web.exists(), 'Refusing to overwrite Web source snapshot')
        args.snapshot_web.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.snapshot_web, {'release': RELEASE, 'sourceRoot': str(web), 'files': web_sources(web)})
        print(json.dumps({'snapshot': str(args.snapshot_web), 'files': len(web_sources(web))}))
        return
    require(all([args.standalone, args.integrated, args.suite_host]), 'Explicit --standalone, --integrated and --suite-host final build paths are required')
    for repo, expected in [(web, args.web_commit), (SUITE, args.suite_commit)]:
        require(bool(expected and re.fullmatch('[0-9a-f]{40}', expected)), 'Both reviewed full lowercase commit SHAs are required')
        require(git(repo, 'rev-parse', 'HEAD') == expected, 'HEAD differs from reviewed commit: ' + str(repo))
        require(not git(repo, 'status', '--porcelain'), 'Dirty source checkout: ' + str(repo))
    require(read_json(web / 'package.json')['version'] == WEB_VERSION, 'Unexpected Web version')
    require(read_json(SUITE / 'public/manifest-dev.json')['version'] == SUITE_VERSION, 'Unexpected Suite version')
    require(args.web_source_snapshot is not None, 'A Web source snapshot captured before final builds is required')
    web_snapshot = read_json(args.web_source_snapshot)
    require(web_snapshot['release'] == RELEASE and web_snapshot['files'] == web_sources(web), 'Web source changed since final build snapshot')
    standalone, integrated, compiled, out = [p.resolve() for p in [args.standalone, args.integrated, args.suite_host, args.out]]
    require(not out.exists(), 'Use a fresh release directory')
    for path in [web, SUITE, standalone, integrated, compiled]:
        require(not out.is_relative_to(path) and not path.is_relative_to(out), 'Output must not overlap source or build input')
    audit = read_json(standalone / 'standalone-audit.json')
    require(audit['singlePlayer'] is True and audit['multiplayerModules'] == [], 'Standalone includes multiplayer modules')
    host_evidence = Path(str(compiled) + '.build-evidence')
    host = read_json(host_evidence / 'release-overlay-receipt.json')
    require(host['release'] == RELEASE and host['runtimeBuild'] == 'suite-3d-3' and host['staticReferences']['allPassed'], 'Unverified or old Suite renderer build')
    source_hashes = read_json(host_evidence / 'source-sha256.json')
    require(suite_sources() == source_hashes, 'Suite build input set/content changed; rebuild fresh')
    host_files = {item['path']: item['sha256'] for item in host['files']}
    require(inventory(compiled) == host_files, 'Suite build output changed after receipt')
    require(all(suite_allowed(name) for name in host_files), 'Unexpected Suite build path')
    require(any(name.startswith('dice3d/') for name in host_files) and host['physicsWorkers'], 'Fresh dice renderer/worker absent')
    inputs = {'standalone': inventory(standalone), 'integrated': inventory(integrated), 'suiteHost': host_files}
    require('index.html' in inputs['integrated'] and 'sw.js' in inputs['integrated'], 'Incomplete integrated Web build')
    out.mkdir(parents=True)
    source_records = {}
    for repo, name, commit in [(web, 'source.zip', args.web_commit), (SUITE, 'suite-source.zip', args.suite_commit)]:
        source_records[name] = source_archive(repo, out / name, commit)
    archive_path = out / 'DND-Card-Standalone-217.zip'
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in inputs['standalone']:
            archive.write(standalone / name, 'DND-Card-Standalone/site/' + name)
        for name, path in [('Start.cmd', web / 'tools/standalone/Start.cmd'), ('Serve.ps1', web / 'tools/standalone/Serve.ps1'), ('使用说明.md', web / 'docs/STANDALONE.md'), ('LICENSE', web / 'LICENSE'), ('LICENSING.md', web / 'docs/LICENSING.md'), ('source.zip', out / 'source.zip')]:
            archive.write(path, 'DND-Card-Standalone/' + name)
    with zipfile.ZipFile(archive_path) as archive:
        require(archive.testzip() is None, 'Standalone archive failed CRC')
    site = out / 'card-site'
    shutil.copytree(standalone, site)
    (site / 'downloads').mkdir(exist_ok=True)
    shutil.copy2(archive_path, site / 'downloads' / archive_path.name)
    shutil.copy2(out / 'source.zip', site / 'source.zip')
    shutil.copy2(web / 'LICENSE', site / 'LICENSE.txt')
    write_json(site / 'release.json', {'version': 'standalone-1.0.217', 'announcementVersion': WEB_VERSION, 'sourceCommit': args.web_commit})
    patch = out / 'suite-patch'
    shutil.copytree(compiled, patch)
    shutil.copytree(integrated, patch / 'workbench')
    shutil.copy2(web / 'LICENSE', patch / 'workbench/LICENSE')
    shutil.copy2(web / 'docs/LICENSING.md', patch / 'workbench/LICENSING.md')
    shutil.copy2(SUITE / 'public/manifest-dev.json', patch / 'manifest-dev.json')
    for folder in [patch, patch / 'workbench']:
        for name in source_records:
            shutil.copy2(out / name, folder / name)
    (patch / 'card-viewer').mkdir()
    shutil.copy2(out / 'suite-source.zip', patch / 'card-viewer/suite-source.zip')
    record = {'release': RELEASE, 'webCommit': args.web_commit, 'suiteCommit': args.suite_commit, 'announcementVersion': WEB_VERSION, 'baselineCommits': {'web': BASE_WEB, 'suite': BASE_SUITE}, 'sources': source_records, 'targets': {}, 'replaceSuiteSubtrees': ['dice3d', 'workbench-dice'], 'runtimeBuild': host['runtimeBuild'], 'retainedPublicAssets': host['staticReferences']['retainedPublicAssets'], 'relayChanged': False, 'playerDataChanged': False, 'crossHostDicePriorityFixed': False}
    for name, folder, manifest, version in [('card', site, 'release.json', 'standalone-1.0.217'), ('suite-dev', patch, 'manifest-dev.json', SUITE_VERSION)]:
        require(read_json(folder / manifest)['version'] == version, 'Packaged version mismatch')
        files = inventory(folder)
        if name == 'suite-dev':
            require(all(suite_allowed(path) for path in files), 'Unapproved Suite package path')
        write_json(folder / 'release217-hashes.json', files)
        write_json(out / (name + '-hashes.json'), files)
        tar_path = out / (name + '-217.tar.gz')
        with tarfile.open(tar_path, 'w:gz') as archive:
            for path in sorted(folder.rglob('*')):
                if path.is_file():
                    archive.add(path, arcname=path.relative_to(folder).as_posix(), recursive=False)
        record['targets'][name] = {'version': version, 'files': len(files), 'bytes': sum((folder / path).stat().st_size for path in files), 'sha256': sha(tar_path), 'manifestSha256': sha(folder / 'release217-hashes.json')}
    for name in ['dice3d', 'workbench-dice']:
        require(inventory(patch / name) == inventory(compiled / name), 'Rebuilt dice application was not copied exactly')
    require(inventory(standalone) == inputs['standalone'] and inventory(integrated) == inputs['integrated'], 'Web build input changed while packaging')
    require(suite_sources() == source_hashes, 'Suite build input set/content changed; rebuild fresh')
    require(web_sources(web) == web_snapshot['files'], 'Web source changed while packaging')
    for repo, expected in [(web, args.web_commit), (SUITE, args.suite_commit)]:
        require(git(repo, 'rev-parse', 'HEAD') == expected and not git(repo, 'status', '--porcelain'), 'Source changed while packaging')
    write_json(out / 'build-input-hashes.json', inputs)
    write_json(out / 'package-receipt.json', record)
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
