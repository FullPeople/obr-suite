"""Package the reviewed 215 card and Suite host overlay; retain deployed dice sub-apps."""
from pathlib import Path
import hashlib,json,os,subprocess,zipfile,tarfile,shutil
s=Path(__file__).resolve().parents[1]
w=Path(os.environ['DND_CARD_WEB_ROOT']).resolve()
build=Path(os.environ['DND_RELEASE_BUILD']).resolve()
out=Path(os.environ['DND_RELEASE_OUT']).resolve()
assert not out.exists(),'Use a fresh release directory'
out.mkdir(parents=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def head(repo):return subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
for repo in [w,s]:assert not subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).strip(),str(repo)+' dirty'
assert json.loads((build/'standalone/standalone-audit.json').read_text(encoding='utf-8'))['multiplayerModules']==[]
for repo,name in [(w,'source.zip'),(s,'suite-source.zip')]:
 subprocess.run(['git','archive','--format=zip','--output='+str(out/name),'HEAD'],cwd=repo,check=True)
 with zipfile.ZipFile(out/name) as z:
  assert 'LICENSE' in z.namelist()
  assert not any('/node_modules/' in p or p.startswith(('real-equipment-sources/','class-audit/','local-rules/','work/','.cache/')) or p.startswith('.env') and p!='.env.example' for p in z.namelist())
archive=out/'DND-Card-Standalone-215.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in (build/'standalone').rglob('*'):
  if p.is_file():z.write(p,'DND-Card-Standalone/site/'+p.relative_to(build/'standalone').as_posix())
 for name,p in [('Start.cmd',w/'tools/standalone/Start.cmd'),('Serve.ps1',w/'tools/standalone/Serve.ps1'),('使用说明.md',w/'docs/STANDALONE.md'),('LICENSE',w/'LICENSE'),('LICENSING.md',w/'docs/LICENSING.md'),('source.zip',out/'source.zip')]:z.write(p,'DND-Card-Standalone/'+name)
site=out/'card-site';shutil.copytree(build/'standalone',site);(site/'downloads').mkdir();shutil.copy2(archive,site/'downloads'/archive.name);shutil.copy2(out/'source.zip',site/'source.zip');shutil.copy2(w/'LICENSE',site/'LICENSE.txt')
(site/'release.json').write_text(json.dumps({'version':'standalone-1.0.215','announcementVersion':'0.1.17','sourceCommit':head(w)},indent=2))
patch=out/'suite-patch';patch.mkdir();compiled=build/'suite-host'
for p in compiled.glob('*.html'):shutil.copy2(p,patch/p.name)
shutil.copytree(compiled/'assets',patch/'assets')
# Fresh dice panel bridge; the already deployed 214 physics/skins remain intact.
panels=compiled/'workbench-dice'
assert (panels/'index.html').is_file() and (panels/'quick.html').is_file()
shutil.copytree(panels,patch/'workbench-dice')
shutil.copytree(build/'integrated',patch/'workbench')
shutil.copy2(w/'LICENSE',patch/'workbench/LICENSE');shutil.copy2(w/'docs/LICENSING.md',patch/'workbench/LICENSING.md')
shutil.copy2(s/'public/manifest-dev.json',patch/'manifest-dev.json')
for folder in [patch,patch/'workbench']:
 for name in ['source.zip','suite-source.zip']:shutil.copy2(out/name,folder/name)
# The already-deployed reader is retained; update only its corresponding Suite source archive.
(patch/'card-viewer').mkdir();shutil.copy2(out/'suite-source.zip',patch/'card-viewer/suite-source.zip')
record={'webCommit':head(w),'suiteCommit':head(s),'announcementVersion':'0.1.17','targets':{}}
for name,folder,manifest,version in [('card',site,'release.json','standalone-1.0.215'),('suite-dev',patch,'manifest-dev.json','1.0.215-dev')]:
 assert json.loads((folder/manifest).read_text(encoding='utf-8'))['version']==version
 files={p.relative_to(folder).as_posix():sha(p) for p in folder.rglob('*') if p.is_file()}
 if name=='suite-dev':assert all(p.startswith(('assets/','workbench/','workbench-dice/')) or p=='card-viewer/suite-source.zip' or '/' not in p and (p.endswith('.html') or p in ['manifest-dev.json','source.zip','suite-source.zip']) for p in files)
 (folder/'release215-hashes.json').write_text(json.dumps(files,indent=2));(out/(name+'-hashes.json')).write_text(json.dumps(files,indent=2))
 with tarfile.open(out/(name+'-215.tar.gz'),'w:gz') as tar:
  for p in sorted(folder.rglob('*')):
   if p.is_file():tar.add(p,arcname=p.relative_to(folder).as_posix())
 record['targets'][name]={'version':version,'files':len(files),'sha256':sha(out/(name+'-215.tar.gz'))}
record['relayChanged']=False
(out/'package-receipt.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
