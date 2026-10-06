"""GitHub-hosted runner client. Secret values are consumed without output."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

HOST = 'obr.dnd.center'
USER = 'obr-deploy'
AUDIENCE = 'https://obr.dnd.center/dot-deploy'
FINGERPRINT = 'SHA256:bS1JRj3+1zJntm+ZOKtjlRhK7MjAAOEdKOdnKq+2yco'
POLICIES = {
    'FullPeople/DND-card-web': ('refs/heads/main','card'),
    'FullPeople/obr-suite': ('refs/heads/dev','suite-dev'),
}

def run():
    repo=os.environ.get('GITHUB_REPOSITORY','')
    if repo not in POLICIES: raise ValueError()
    ref,target=POLICIES[repo]
    if os.environ.get('GITHUB_REF')!=ref or os.environ.get('GITHUB_EVENT_NAME')!='workflow_dispatch': raise ValueError()
    sha=os.environ.get('GITHUB_SHA',''); ci=os.environ.get('CI_RUN_IDS',''); baseline=os.environ.get('EXPECTED_RELEASE_SHA256','')
    if not re.fullmatch(r'[a-f0-9]{40}',sha) or not re.fullmatch(r'[1-9][0-9]{0,19}(,[1-9][0-9]{0,19}){0,7}',ci) or not re.fullmatch(r'[a-f0-9]{64}',baseline): raise ValueError()
    key=os.environ.get('DEPLOY_SSH_KEY',''); known=os.environ.get('DEPLOY_KNOWN_HOSTS','').strip()
    if not key or '\n' in known or not re.fullmatch(r'obr\.dnd\.center ssh-ed25519 [A-Za-z0-9+/=]+',known): raise ValueError()
    url=os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    if urllib.parse.urlparse(url).scheme!='https' or not urllib.parse.urlparse(url).hostname.endswith('.actions.githubusercontent.com'): raise ValueError()
    url+=('&' if '?' in url else '?')+'audience='+urllib.parse.quote(AUDIENCE,safe='')
    req=urllib.request.Request(url,headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(req,timeout=20) as response:
        token=json.load(response)['value']
    envelope={'operation':'preflight','target':target,'sha':sha,'ci_run_ids':ci,'expected_release_sha256':baseline,'oidc':token}
    # The SSH key is transient on the hosted runner, outside the checkout and artifacts.
    with tempfile.TemporaryDirectory(prefix='obr-deploy-',dir=os.environ['RUNNER_TEMP']) as directory:
        p=Path(directory); private=p/'identity'; hosts=p/'known_hosts'
        private.write_text(key.rstrip()+'\n',encoding='utf-8'); private.chmod(0o600)
        hosts.write_text(known+'\n',encoding='utf-8'); hosts.chmod(0o600)
        checked=subprocess.run(['ssh-keygen','-lf',str(hosts),'-E','sha256'],capture_output=True,text=True,timeout=10)
        if checked.returncode or len(checked.stdout.splitlines())!=1 or checked.stdout.split()[1]!=FINGERPRINT: raise ValueError()
        command=['ssh','-F','/dev/null','-T','-p','22','-i',str(private),'-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','BatchMode=yes','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(hosts),'-o','GlobalKnownHostsFile=/dev/null','-o','ClearAllForwardings=yes','-o','ConnectTimeout=20','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2',USER+'@'+HOST,'obr-preflight-v1']
        completed=subprocess.run(command,input=json.dumps(envelope),capture_output=True,text=True,timeout=240)
    # Only the fixed helper's bounded JSON report is eligible for output.
    if len(completed.stdout)>16384: raise ValueError()
    report=json.loads(completed.stdout)
    if completed.returncode!=0 or report.get('ok') is not True:
        # Server error codes are allowlisted; stderr is deliberately not published.
        code=report.get('error','preflight-denied')
        if not isinstance(code,str) or not re.fullmatch('[a-z-]{1,90}',code): code='preflight-denied'
        print(json.dumps({'ok':False,'error':code})); return 1
    result=report.get('result',{})
    if result.get('target')!=target or result.get('onlineVersionWrites') is not False or result.get('persistentServerWrites') is not False: raise ValueError()
    output=Path('.local-evidence/dot-deploy'); output.mkdir(parents=True,exist_ok=True)
    (output/'preflight.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a',encoding='utf-8') as summary:
        summary.write('Read-only preflight passed for `'+target+'`. No online version was changed. Candidate artifact validation and production publishing remain disabled.\n')
    return 0

def main():
    try: return run()
    except Exception:
        print(json.dumps({'ok':False,'error':'runner-preflight-unavailable'})); return 1

if __name__=='__main__': sys.exit(main())
