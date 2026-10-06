"""Fixed read-only SSH entry point. No publish, upload, shell or rollback operation."""
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ISSUER = 'https://token.actions.githubusercontent.com'
AUDIENCE = 'https://obr.dnd.center/dot-deploy'
ROOT = Path('/var/www/obr-plugins')
LOCK = Path('/run/lock/obr-static-release.lock')
POLICIES = {
    'card': {'repository':'FullPeople/DND-card-web', 'repository_id':'1378484252', 'branch':'main', 'environment':'production-card', 'ci_paths':('.github/workflows/web.yml',)},
    'suite-dev': {'repository':'FullPeople/obr-suite', 'repository_id':'1222135055', 'branch':'dev', 'environment':'production-suite-dev', 'ci_paths':('.github/workflows/verify-suite.yml','.github/workflows/dice-cross-window-ready.yml','.github/workflows/dice-release246-profile.yml')},
}
SHA = re.compile(r'[a-f0-9]{40}')
HASH = re.compile(r'[a-f0-9]{64}')

class Denied(Exception):
    pass

def require(condition, code):
    if not condition: raise Denied(code)

def json_unique(raw):
    def pairs(items):
        obj = {}
        for key, value in items:
            require(key not in obj, 'duplicate-json-key')
            obj[key] = value
        return obj
    return json.loads(raw, object_pairs_hook=pairs)

def b64(value):
    require(isinstance(value,str) and len(value) <= 24000 and re.fullmatch(r'[A-Za-z0-9_-]+',value), 'invalid-base64')
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))

def get_json(url):
    # URLs are built from fixed origins and allowlisted repositories, never client URLs.
    req = urllib.request.Request(url, headers={'Accept':'application/vnd.github+json','User-Agent':'obr-fixed-preflight/1'})
    with urllib.request.urlopen(req,timeout=15) as response:
        require(response.geturl() == url, 'unexpected-redirect')
        raw = response.read(4*1024*1024+1)
    require(len(raw) <= 4*1024*1024, 'response-too-large')
    return json_unique(raw)

def der(tag, value):
    n = len(value)
    length = bytes([n]) if n < 128 else n.to_bytes((n.bit_length()+7)//8,'big')
    if n >= 128: length = bytes([0x80|len(length)]) + length
    return bytes([tag])+length+value

def public_pem(jwk):
    require(jwk.get('kty') == 'RSA' and jwk.get('use','sig') == 'sig' and jwk.get('alg','RS256') == 'RS256','invalid-signing-key')
    def integer(value):
        raw = b64(value).lstrip(b'\0') or b'\0'
        return der(2,(b'\0' if raw[0]&0x80 else b'')+raw)
    modulus = b64(jwk['n'])
    require(256 <= len(modulus) <= 1024,'invalid-rsa-key-size')
    rsa = der(0x30,integer(jwk['n'])+integer(jwk['e']))
    algorithm = bytes.fromhex('300d06092a864886f70d0101010500')
    encoded = base64.b64encode(der(0x30,algorithm+der(3,b'\0'+rsa))).decode()
    return ('-----BEGIN PUBLIC KEY-----\n'+'\n'.join(encoded[i:i+64] for i in range(0,len(encoded),64))+'\n-----END PUBLIC KEY-----\n').encode()

def verify_token(token):
    require(isinstance(token,str) and len(token) <= 24000,'invalid-token')
    parts = token.split('.')
    require(len(parts)==3,'invalid-token-format')
    header = json_unique(b64(parts[0]))
    require(header.get('alg')=='RS256' and isinstance(header.get('kid'),str) and not header.get('crit'),'invalid-token-header')
    keys = get_json(ISSUER+'/.well-known/jwks')['keys']
    matches = [k for k in keys if k.get('kid') == header['kid']]
    require(len(matches)==1,'unknown-signing-key')
    pem = public_pem(matches[0])
    # Only public key and signature use transient files. The JWT is never stored or printed.
    with tempfile.TemporaryDirectory(prefix='obr-oidc-') as directory:
        key = Path(directory)/'public.pem'; signature = Path(directory)/'signature.bin'
        key.write_bytes(pem); signature.write_bytes(b64(parts[2]))
        verified = subprocess.run(['/usr/bin/openssl','dgst','-sha256','-verify',str(key),'-signature',str(signature)],input=(parts[0]+'.'+parts[1]).encode(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    require(verified.returncode==0,'invalid-token-signature')
    return json_unique(b64(parts[1]))

def authorize(request, claims, now=None):
    require(isinstance(request,dict) and set(request)=={'operation','target','sha','ci_run_ids','expected_release_sha256','oidc'},'invalid-request-fields')
    require(request['operation']=='preflight','operation-not-allowed')
    require(request['target'] in POLICIES,'target-not-allowed')
    require(isinstance(request['sha'],str) and SHA.fullmatch(request['sha']),'invalid-sha')
    require(isinstance(request['ci_run_ids'],str) and re.fullmatch(r'[1-9][0-9]{0,19}(,[1-9][0-9]{0,19}){0,7}',request['ci_run_ids']),'invalid-ci-runs')
    require(len(set(request['ci_run_ids'].split(',')))==len(request['ci_run_ids'].split(',')),'duplicate-ci-runs')
    require(isinstance(request['expected_release_sha256'],str) and HASH.fullmatch(request['expected_release_sha256']),'invalid-baseline-hash')
    policy = POLICIES[request['target']]; repo = policy['repository']; branch = policy['branch']
    expected = {'iss':ISSUER, 'aud':AUDIENCE, 'repository':repo, 'repository_id':policy['repository_id'], 'repository_owner_id':'166210040', 'ref':'refs/heads/'+branch, 'ref_type':'branch', 'sub':'repo:'+repo+':environment:'+policy['environment'], 'environment':policy['environment'], 'event_name':'workflow_dispatch', 'runner_environment':'github-hosted', 'workflow_ref':repo+'/.github/workflows/dot-deploy-preflight.yml@refs/heads/'+branch, 'sha':request['sha'], 'workflow_sha':request['sha']}
    require(all(claims.get(k)==v for k,v in expected.items()),'oidc-scope-denied')
    now = int(time.time()) if now is None else now
    for field in ('iat','nbf','exp'): require(type(claims.get(field)) is int,'invalid-token-time')
    require(claims['nbf'] <= now+30 and claims['iat'] <= now+30 and claims['exp'] > now and now-claims['iat'] <= 600 and 0 < claims['exp']-claims['iat'] <= 900,'token-expired-or-future')
    require(re.fullmatch(r'[1-9][0-9]{0,19}',str(claims.get('run_id',''))),'invalid-oidc-run')
    return policy

def verify_ci(request, policy):
    api = 'https://api.github.com/repos/'+policy['repository']
    head = get_json(api+'/git/ref/heads/'+policy['branch'])['object']['sha']
    require(head==request['sha'],'branch-head-changed')
    checked=[]; paths=set()
    for run_id in request['ci_run_ids'].split(','):
        run = get_json(api+'/actions/runs/'+run_id)
        path=run.get('path')
        require(path in policy['ci_paths'] and path not in paths and run.get('repository',{}).get('full_name')==policy['repository'] and run.get('head_sha')==request['sha'] and run.get('head_branch')==policy['branch'] and run.get('status')=='completed' and run.get('conclusion')=='success' and run.get('event') in ('push','workflow_dispatch'),'full-ci-not-successful-for-exact-sha')
        jobs = []; page = 1
        while True:
            data = get_json(api+'/actions/runs/'+run_id+'/jobs?filter=latest&per_page=100&page='+str(page))
            jobs.extend(data['jobs'])
            if len(jobs) >= data['total_count']: break
            require(page<10 and data['jobs'],'incomplete-ci-jobs'); page+=1
        require(jobs and len(jobs)==data['total_count'] and all(j.get('status')=='completed' and j.get('conclusion')=='success' for j in jobs),'ci-job-failed-skipped-or-incomplete')
        checked.append({'runId':run_id,'jobs':len(jobs),'workflow':path}); paths.add(path)
    require(paths==set(policy['ci_paths']),'required-ci-workflow-missing')
    require(get_json(api+'/git/ref/heads/'+policy['branch'])['object']['sha']==request['sha'],'branch-head-changed')
    return {'runs':checked,'exactSha':request['sha']}

def sha_file(path):
    require(path.is_file() and not path.is_symlink(),'invalid-static-file')
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def tree(path):
    require(path.is_dir() and not path.is_symlink(),'invalid-static-tree')
    result={}; size=0
    for p in sorted(path.rglob('*')):
        require(not p.is_symlink(),'static-symlink-denied')
        if p.is_file(): result[p.relative_to(path).as_posix()]=sha_file(p); size+=p.stat().st_size
        else: require(p.is_dir(),'special-static-file-denied')
    digest=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {'files':len(result),'bytes':size,'sha256':digest}

def inventory(request):
    import fcntl
    require(ROOT.is_dir() and ROOT.resolve()==ROOT,'static-root-denied')
    require(LOCK.is_file() and not LOCK.is_symlink(),'existing-lock-required')
    with LOCK.open('rb') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise Denied('publisher-lock-busy')
        target=ROOT/request['target']; release=target/'release.json'
        require(sha_file(release)==request['expected_release_sha256'],'online-baseline-changed')
        protected_before=protected_metadata()
        sites={name:tree(ROOT/name) for name in ('card','suite-dev','suite','three-dragon-ante','three-dragon-ante-dev')}
        available=shutil.disk_usage(ROOT).free
        require(available > sites[request['target']]['bytes']*2+300*1024*1024,'insufficient-backup-stage-space')
        require(getattr(ctypes.CDLL(None),'renameat2',None) is not None,'atomic-rename-unavailable')
        require(sha_file(release)==request['expected_release_sha256'],'baseline-changed-during-preflight')
        require(protected_before==protected_metadata(),'protected-state-changed-during-preflight')
    return {'onlineVersionWrites':False,'persistentServerWrites':False,'lockAcquired':True,'target':request['target'],'releaseSha256':request['expected_release_sha256'],'sites':sites,'protected':protected_before,'diskFreeBytes':available,'atomicRenameAvailable':True,'candidateArtifactValidated':False,'note':'Read-only readiness check; publication remains unavailable.'}

def protected_metadata():
    data={}
    for name in ('obr-workbench-relay-dev','obr-three-dragon'):
        result=subprocess.run(['/usr/bin/systemctl','show',name,'-p','ActiveState','-p','ActiveEnterTimestampMonotonic'],capture_output=True,text=True,timeout=15)
        require(result.returncode==0,'protected-service-unavailable')
        data[name]=result.stdout.strip()
    # Hash existing protected files; never return configuration contents or player data.
    fixed_files=('/etc/nginx/sites-enabled/obr-plugins','/opt/obr-three-dragon/server.mjs','/opt/obr-three-dragon/service.mjs','/etc/systemd/system/obr-three-dragon.service','/opt/obr-workbench-relay-dev/server.mjs','/opt/obr-workbench-relay-dev/documents.mjs','/opt/obr-workbench-relay-dev/patches.mjs')
    for name in fixed_files: data[name]=sha_file(Path(name).resolve())
    return data

def main():
    try:
        require(len(sys.argv)==1,'arguments-denied')
        raw=sys.stdin.buffer.read(32769)
        require(len(raw)<=32768,'request-too-large')
        request=json_unique(raw)
        require(isinstance(request,dict),'invalid-request')
        # Reject commands and unknown targets before parsing an authentication token.
        require(request.get('operation')=='preflight' and request.get('target') in POLICIES,'operation-or-target-denied')
        claims=verify_token(request.get('oidc'))
        policy=authorize(request,claims)
        ci=verify_ci(request,policy)
        result=inventory(request); result['ci']=ci
        print(json.dumps({'ok':True,'result':result},sort_keys=True))
    except Denied as error:
        print(json.dumps({'ok':False,'error':str(error)})); return 1
    except Exception:
        # Never expose HTTP bodies, tokens, environment variables or raw exceptions.
        print(json.dumps({'ok':False,'error':'preflight-unavailable'})); return 1
    return 0

if __name__=='__main__': sys.exit(main())
