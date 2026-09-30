from pathlib import Path
import json,zipfile,hashlib
baseline=json.loads(Path('/tmp/dice3d-base-tree.json').read_text())
with zipfile.ZipFile('/var/www/obr-plugins/suite-dev/suite-source.zip') as archive:
 differences=[]
 for name,expected in baseline.items():
  try:data=archive.read(name)
  except KeyError:continue
  if name.endswith(('.ts','.tsx','.mjs','.js','.json','.md','.txt','.html','.css','.yml','.yaml')):data=data.replace(b'\r\n',b'\n')
  oid=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
  if oid!=expected:
   differences.append({'path':name,'text':data.decode('utf8') if len(data)<100000 and name.startswith(('src/','public/','tools/','package')) else None})
 Path('/tmp/dice3d-base-diff.json').write_text(json.dumps({'sourceCommit':archive.comment.decode(),'differences':differences},ensure_ascii=False))
 print(json.dumps({'sourceCommit':archive.comment.decode(),'differences':[d['path'] for d in differences]},ensure_ascii=False))
