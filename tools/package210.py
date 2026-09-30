"""Package committed Web 210 and a scoped Suite card patch; no private data."""
from pathlib import Path
import hashlib,json,os,subprocess,zipfile,tarfile,shutil
s=Path(__file__).resolve().parents[1]
w=Path(os.environ['DND_CARD_WEB_ROOT']).resolve()
patch=Path(os.environ['DND_CARD_PATCH_OUT']).resolve()
out=Path(os.environ['DND_RELEASE_OUT']).resolve()
assert not out.exists(), 'Choose a new package directory; existing evidence is preserved'
out.mkdir(parents=True)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def head(repo):return subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
for repo in [w,s]:assert not subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).strip(),str(repo)+' dirty'
assert json.loads((w/'dist-standalone/standalone-audit.json').read_text(encoding='utf8'))['multiplayerModules']==[]
for repo,name in [(w,'source.zip'),(s,'suite-source.zip')]:
 subprocess.run(['git','archive','--format=zip','--output='+str(out/name),'HEAD'],cwd=repo,check=True)
 with zipfile.ZipFile(out/name) as z:
  assert 'LICENSE' in z.namelist()
  assert not any('/node_modules/' in p or p.startswith(('real-equipment-sources/','class-audit/','local-rules/','work/')) or p.startswith('.env') and p!='.env.example' for p in z.namelist())
for folder in [patch,patch/'card-viewer',patch/'workbench']:
 for name in ['source.zip','suite-source.zip']:shutil.copy2(out/name,folder/name)
archive=out/'DND-Card-Standalone-210.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in (w/'dist-standalone').rglob('*'):
  if p.is_file():z.write(p,'DND-Card-Standalone/site/'+p.relative_to(w/'dist-standalone').as_posix())
 for name,p in [('Start.cmd',w/'tools/standalone/Start.cmd'),('Serve.ps1',w/'tools/standalone/Serve.ps1'),('使用说明.md',w/'docs/STANDALONE.md'),('LICENSE',w/'LICENSE'),('LICENSING.md',w/'docs/LICENSING.md'),('source.zip',out/'source.zip')]:z.write(p,'DND-Card-Standalone/'+name)
site=out/'card-site';shutil.copytree(w/'dist-standalone',site);(site/'downloads').mkdir();shutil.copy2(archive,site/'downloads'/archive.name);shutil.copy2(out/'source.zip',site/'source.zip');shutil.copy2(w/'LICENSE',site/'LICENSE.txt')
card={'version':'standalone-1.0.210','announcementVersion':'0.1.15','url':'https://obr.dnd.center/card/','sourceCommit':head(w),'files':{p.relative_to(site).as_posix():digest(p) for p in site.rglob('*') if p.is_file()}}
(site/'release.json').write_text(json.dumps(card,indent=2),encoding='utf8')
legacy=out/'legacy-patch';legacy.mkdir();shutil.copytree(patch/'card-viewer',legacy/'card-viewer')
for name in ['manifest.json','announcement.md']:shutil.copy2(s/'public'/name,legacy/name)
for name in ['source.zip','suite-source.zip']:shutil.copy2(out/name,legacy/name)
record={'webCommit':head(w),'suiteCommit':head(s),'announcementVersion':'0.1.15','standaloneSHA256':digest(archive),'targets':{}}
for name,dist,manifest,version in [('suite-dev',patch,'manifest-dev.json','1.0.210-dev'),('card',site,'release.json','standalone-1.0.210'),('suite',legacy,'manifest.json','1.3.14')]:
 assert json.loads((dist/manifest).read_text(encoding='utf8'))['version']==version
 files={p.relative_to(dist).as_posix():digest(p) for p in dist.rglob('*') if p.is_file() and p.name!='release-hashes.json'}
 if name=='suite-dev':assert all(p.startswith(('workbench/','card-viewer/')) or p in ['manifest.json','manifest-dev.json','announcement.md','source.zip','suite-source.zip'] for p in files)
 (dist/'release-hashes.json').write_text(json.dumps(files,indent=2),encoding='utf8');(out/(name+'-hashes.json')).write_text(json.dumps(files,indent=2),encoding='utf8')
 with tarfile.open(out/(name+'-210.tar.gz'),'w:gz') as tar:
  for p in sorted(dist.rglob('*')):
   if p.is_file():tar.add(p,arcname=p.relative_to(dist).as_posix())
 record['targets'][name]={'version':version,'files':len(files),'sha256':digest(out/(name+'-210.tar.gz'))}
(out/'package-receipt.json').write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record,indent=2))
