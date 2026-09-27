from pathlib import Path
import subprocess

script = r'''import gzip,hashlib,http.client,json,pathlib,re
root=pathlib.Path('/var/www/obr-plugins');paths=set()
for folder in ['card','suite-dev/workbench','suite/card-viewer','suite','suite-dev','three-dragon-ante-dev']:
    html_path=root/folder/'index.html'
    if not html_path.exists():
        manifest_path=root/folder/('manifest-dev.json' if folder=='suite-dev' else 'manifest.json')
        html_path=root/json.loads(manifest_path.read_text())['action']['popover'].lstrip('/')
    html=html_path.read_text()
    urls=re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"',html)
    for url in urls:
        path='/'+folder+'/'+url.removeprefix('./') if not url.startswith('/') else url
        paths.add(path)
        if path.endswith('.js'):
            entry=(root/path.lstrip('/')).read_text()
            for chunk in re.findall(r'assets/(?:App|PlayerViewer)-[^"\s]+?\.(?:js|css)',entry):
                paths.add('/'+folder+'/'+chunk)
paths.update(['/suite/manifest.json','/suite-dev/manifest-dev.json','/three-dragon-ante-dev/manifest.json'])
rows=[]
for path in sorted(paths):
    original=(root/path.lstrip('/')).read_bytes()
    for encoding in ['gzip','identity']:
        conn=http.client.HTTPSConnection('obr.dnd.center',timeout=30)
        conn.request('GET',path,headers={'Accept-Encoding':encoding,'Cache-Control':'no-cache'})
        response=conn.getresponse();body=response.read();actual=response.getheader('Content-Encoding') or 'identity'
        decoded=gzip.decompress(body) if actual=='gzip' else body
        assert response.status==200,(path,response.status)
        assert decoded==original,('Content mismatch',path)
        expected=encoding if len(original)>=512 else 'identity'
        assert actual==expected,(path,expected,actual)
        if len(original)>=512: assert 'accept-encoding' in (response.getheader('Vary') or '').lower(),path
        rows.append({'path':path,'requested':encoding,'encoding':actual,'status':response.status,'bytes':len(body),'originalBytes':len(original),'sha256':hashlib.sha256(decoded).hexdigest(),'type':response.getheader('Content-Type'),'vary':response.getheader('Vary')})
        conn.close()
print(json.dumps({'responses':rows,'count':len(rows),'allDecodedFilesMatch':True},indent=2))
'''
result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','root@47.120.61.255','python3 -'],input=script,text=True,capture_output=True,encoding='utf8')
if result.returncode:
    print(result.stderr)
    raise SystemExit(result.returncode)
Path('D:/Temp/DND-card-startup202/after-integrity.json').write_text(result.stdout,encoding='utf8')
import json
record=json.loads(result.stdout)
print(json.dumps({'responses':record['count'],'allDecodedFilesMatch':record['allDecodedFilesMatch'],'gzipBytes':sum(r['bytes'] for r in record['responses'] if r['encoding']=='gzip'),'identityBytes':sum(r['bytes'] for r in record['responses'] if r['encoding']=='identity')},indent=2))
