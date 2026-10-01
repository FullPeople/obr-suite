"""Package the two Suite hotfixes and their announcement; no upload or deployment."""
from pathlib import Path
import argparse, importlib.util, json, re, shutil, subprocess, sys, tarfile
sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


p = load('package217')
d = load('deploy-release219')
SUITE = Path(__file__).resolve().parents[1]
EVIDENCE = Path('F:/DND-card-dice-hotfix219-evidence-20261001')
require, sha, read_json, write_json, git, inventory = p.require, p.sha, p.read_json, p.write_json, p.git, p.inventory


def web_change_allowed(name):
    return name in ['src/platform/announcement.ts', 'src/platform/releaseNotes.ts'] or (name.startswith('docs/') and name.endswith(('.md', '.txt')))


def reviewed_repo(repo, commit, baseline):
    require(bool(commit and re.fullmatch('[0-9a-f]{40}', commit)), 'Full reviewed commit required')
    require(git(repo, 'rev-parse', 'HEAD') == commit and not git(repo, 'status', '--porcelain'), 'Source must be clean at reviewed HEAD: ' + str(repo))
    subprocess.run(['git', 'merge-base', '--is-ancestor', baseline, commit], cwd=repo, check=True)
    return git(repo, 'diff', '--name-only', baseline, commit).splitlines()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-root', type=Path, required=True)
    parser.add_argument('--web-commit')
    parser.add_argument('--suite-commit')
    parser.add_argument('--snapshot-web', type=Path)
    parser.add_argument('--web-source-snapshot', type=Path)
    parser.add_argument('--integrated', type=Path)
    parser.add_argument('--suite-host', type=Path)
    parser.add_argument('--out', type=Path, default=EVIDENCE / 'release219-ready')
    args = parser.parse_args()
    web = args.web_root.resolve()
    if args.snapshot_web:
        require(not args.snapshot_web.exists(), 'Snapshot already exists')
        args.snapshot_web.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.snapshot_web, {'release': 219, 'sourceRoot': str(web), 'files': p.web_sources(web)})
        print(json.dumps({'snapshot': str(args.snapshot_web)}))
        return
    require(all([args.integrated, args.suite_host, args.web_source_snapshot]), 'Explicit final integrated build, Suite overlay and pre-build Web snapshot required')
    web_changes = reviewed_repo(web, args.web_commit, d.BASE_COMMITS['web'])
    suite_changes = reviewed_repo(SUITE, args.suite_commit, d.BASE_COMMITS['suite'])
    require(all(web_change_allowed(name) for name in web_changes), 'Web diff is not announcement-only: ' + str(web_changes))
    require(read_json(web / 'package.json')['version'] == '0.1.19', 'Standalone announcement/version must remain 217')
    announcement = (web / 'src/platform/announcement.ts').read_text(encoding='utf-8')
    require(re.search(r"\bAPP_VERSION\s*=\s*['\"]0\.1\.19['\"]", announcement) is not None, 'Standalone APP_VERSION changed')
    require(read_json(SUITE / 'public/manifest-dev.json')['version'] == d.SUITE_VERSION, 'Wrong Suite version')
    snapshot = read_json(args.web_source_snapshot)
    require(snapshot.get('release') == 219 and Path(snapshot['sourceRoot']).resolve() == web and snapshot['files'] == p.web_sources(web), 'Web inputs changed since pre-build snapshot')
    integrated, compiled, out = [path.resolve() for path in [args.integrated, args.suite_host, args.out]]
    require(not out.exists(), 'Use a fresh package directory')
    for path in [web, SUITE, integrated, compiled]:
        require(not out.is_relative_to(path) and not path.is_relative_to(out), 'Output overlaps source/build')
    evidence = Path(str(compiled) + '.build-evidence')
    host = read_json(evidence / 'release-overlay-receipt.json')
    require(host['release'] == 217 and host['kind'] == 'suite-host-overlay' and host['runtimeBuild'] == d.RUNTIME_BUILD, 'Unexpected historical builder contract')
    require(Path(host['sourceRoot']).resolve() == SUITE and Path(host['output']).resolve() == compiled, 'Build receipt belongs to another source/output')
    require(host['staticReferences']['allPassed'] and host['physicsWorkers'], 'Missing static reference/physics validation')
    source_hashes = read_json(evidence / 'source-sha256.json')
    require(p.suite_sources() == source_hashes, 'Suite build inputs changed; rebuild')
    host_files = {item['path']: item['sha256'] for item in host['files']}
    require(inventory(compiled) == host_files, 'Suite build outputs changed')
    require(all(d.host_allowed(name) for name in host_files), 'Unexpected host overlay path')
    for subtree in d.REPLACEMENTS:
        require(any(name.startswith(subtree + '/') for name in host_files), 'Missing fresh dice subtree: ' + subtree)
    integrated_files = inventory(integrated)
    require('index.html' in integrated_files and 'sw.js' in integrated_files, 'Incomplete integrated announcement build')
    out.mkdir(parents=True)
    sources = {}
    for repo, name, commit in [(web, 'source.zip', args.web_commit), (SUITE, 'suite-source.zip', args.suite_commit)]:
        sources[name] = p.source_archive(repo, out / name, commit)
    patch = out / 'suite-patch'
    shutil.copytree(compiled, patch)
    shutil.copytree(integrated, patch / 'workbench')
    shutil.copy2(web / 'LICENSE', patch / 'workbench/LICENSE')
    shutil.copy2(web / 'docs/LICENSING.md', patch / 'workbench/LICENSING.md')
    shutil.copy2(SUITE / 'public/manifest-dev.json', patch / 'manifest-dev.json')
    for folder in [patch, patch / 'workbench']:
        for name in sources:
            shutil.copy2(out / name, folder / name)
    (patch / 'card-viewer').mkdir()
    shutil.copy2(out / 'suite-source.zip', patch / 'card-viewer/suite-source.zip')
    files = inventory(patch)
    require(all(d.suite_allowed(name) for name in files), 'Unapproved Suite path')
    write_json(patch / d.HASH_MANIFEST, files)
    write_json(out / 'suite-dev-hashes.json', files)
    archive_path = out / 'suite-dev-219.tar.gz'
    with tarfile.open(archive_path, 'w:gz') as archive:
        for path in sorted(patch.rglob('*')):
            if path.is_file():
                archive.add(path, arcname=path.relative_to(patch).as_posix(), recursive=False)
    target = {'version': d.SUITE_VERSION, 'files': len(files), 'bytes': sum((patch / name).stat().st_size for name in files), 'sha256': sha(archive_path), 'manifestSha256': sha(patch / d.HASH_MANIFEST)}
    require(d.archive_files(archive_path, target) == files, 'Final archive validation failed')
    record = {'release': 219, 'suiteCommit': args.suite_commit, 'webCommit': args.web_commit, 'cardWebCommit': d.BASE_COMMITS['web'], 'announcementOnlyWeb': True, 'announcementVersion': '0.1.19', 'baselineCommits': d.BASE_COMMITS, 'baselineHashes': d.BASELINE_HASHES, 'sources': sources, 'targets': {'suite-dev': target}, 'replaceSuiteSubtrees': d.REPLACEMENTS, 'runtimeBuild': d.RUNTIME_BUILD, 'builder': {'tool': 'tools/build-release217.mjs', 'receiptRelease': 217, 'receiptSha256': sha(evidence / 'release-overlay-receipt.json'), 'sourceSnapshotSha256': sha(evidence / 'source-sha256.json')}, 'retainedPublicAssets': host['staticReferences']['retainedPublicAssets'], 'reviewedChanges': {'web': web_changes, 'suite': suite_changes}, 'relayChanged': False, 'playerDataChanged': False, 'standaloneChanged': False, 'crossHostDicePriorityFixed': False}
    d.validate_source_archives(archive_path, files, record)
    require(inventory(integrated) == integrated_files and inventory(compiled) == host_files, 'Build changed during packaging')
    require(p.suite_sources() == source_hashes and p.web_sources(web) == snapshot['files'], 'Source changed during packaging')
    reviewed_repo(web, args.web_commit, d.BASE_COMMITS['web'])
    reviewed_repo(SUITE, args.suite_commit, d.BASE_COMMITS['suite'])
    write_json(out / 'build-input-hashes.json', {'integrated': integrated_files, 'suiteHost': host_files, 'webSourceSnapshot': snapshot['files'], 'suiteSourceSnapshot': source_hashes})
    write_json(out / 'package-receipt.json', record)
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
