from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,hashlib,urllib.request,urllib.parse,time,gzip
b=Path('D:/Temp/DND-card-release209-storage/release209');origin='https://obr.dnd.center/'
todo={}
for target in ['suite-dev','card','suite']:
 files=json.loads((b/(target+'-hashes.json')).read_text(encoding='utf8'))
 previousPath=Path('D:/Temp/DND-card-release208-storage/release208')/(target+'-hashes.json')
 previous=json.loads(previousPath.read_text(encoding='utf8')) if previousPath.exists() else {}
 for name,sha in files.items():
  entry=name in ['manifest.json','manifest-dev.json','release.json','announcement.md','index.html','background.html','launcher.html','practice.html','workbench-panels/table.html','workbench/index.html','dm-announcement.html']
  if entry or previous.get(name)!=sha and (name.endswith(('.js','.css')) or 'time-dragon' in name):
   todo[target+'/'+name]=sha
print('Verifying '+str(len(todo))+' changed runtime files and entry points',flush=True)
def verify(item):
 name,expected=item
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(origin+urllib.parse.quote(name,safe='/')+'?release209='+str(time.time_ns()),headers={'Accept-Encoding':'gzip'}),timeout=45) as response:body=gzip.decompress(response.read()) if response.headers.get('Content-Encoding')=='gzip' else response.read()
   actual=hashlib.sha256(body).hexdigest();assert actual==expected,name
   return {'path':name,'sha256':actual,'bytes':len(body)}
  except Exception:
   if attempt==2:raise
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(verify,todo.items()))
record={'verifiedPublicFiles':len(results),'results':results};(b/'public-verification.json').write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps({'verifiedPublicFiles':len(results),'totalBytes':sum(r['bytes'] for r in results)}))
