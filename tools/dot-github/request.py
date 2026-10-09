"""Fixed issue-to-workflow router. No server access or production operation."""
import datetime
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

OWNER_ID = 166210040
TITLE = 'dot: readonly request'
POLICIES = {
    'FullPeople/DND-card-web': {'id':1378484252, 'branch':'main', 'operation':'preflight', 'workflow':'dot-deploy-preflight.yml', 'ci':('.github/workflows/web.yml',)},
    'FullPeople/obr-suite': {'id':1222135055, 'branch':'dev', 'operation':'preflight', 'workflow':'dot-deploy-preflight.yml', 'ci':('.github/workflows/verify-suite.yml','.github/workflows/dice-cross-window-ready.yml','.github/workflows/dice-release246-profile.yml')},
    'FullPeople/dnd5e-automation-data': {'id':1403237501, 'branch':'main', 'operation':'validate', 'workflow':'build.yml', 'ci':()},
}

class Denied(Exception):
    pass

def require(ok, reason):
    if not ok:
        raise Denied(reason)

def unique_json(raw):
    def pairs(items):
        result = {}
        for k, v in items:
            require(k not in result, 'duplicate-field')
            result[k] = v
        return result
    return json.loads(raw, object_pairs_hook=pairs)

def validate(event, env, now=None):
    now = time.time() if now is None else now
    repo = env.get('GITHUB_REPOSITORY')
    require(repo in POLICIES, 'repository-denied')
    policy = POLICIES[repo]
    require(env.get('GITHUB_EVENT_NAME') == 'issues' and event.get('action') == 'opened', 'event-denied')
    require(env.get('GITHUB_RUN_ATTEMPT') == '1', 'rerun-denied-create-new-request')
    require(env.get('GITHUB_ACTOR') == 'FullPeople' and env.get('GITHUB_ACTOR_ID') == str(OWNER_ID), 'actor-denied')
    require(event.get('repository', {}).get('full_name') == repo and event['repository'].get('id') == policy['id'] and event['repository'].get('owner', {}).get('id') == OWNER_ID, 'repository-identity-denied')
    require(env.get('GITHUB_REF') == 'refs/heads/main' and env.get('GITHUB_WORKFLOW_REF') == repo+'/.github/workflows/dot-readonly-request.yml@refs/heads/main', 'workflow-scope-denied')
    for user in (event.get('sender', {}), event.get('issue', {}).get('user', {})):
        require(user.get('login') == 'FullPeople' and user.get('id') == OWNER_ID and user.get('type') == 'User', 'request-author-denied')
    issue = event.get('issue', {})
    require(type(issue.get('number')) is int and issue['number'] > 0 and not issue.get('pull_request') and issue.get('title') == TITLE, 'issue-denied')
    require(isinstance(issue.get('created_at'), str), 'issue-time-denied')
    created = datetime.datetime.fromisoformat(issue['created_at'].replace('Z','+00:00')).timestamp()
    require(-30 <= now-created <= 1800, 'request-expired')
    body = issue.get('body')
    require(isinstance(body, str) and 0 < len(body.encode()) <= 4096, 'body-size-denied')
    request = unique_json(body)
    expected = {'operation','sha'} if policy['operation'] == 'validate' else {'operation','sha','ci_run_ids','expected_release_sha256'}
    require(isinstance(request, dict) and set(request) == expected, 'request-fields-denied')
    require(request['operation'] == policy['operation'], 'operation-denied')
    require(isinstance(request['sha'], str) and re.fullmatch(r'[a-f0-9]{40}', request['sha']), 'sha-denied')
    inputs = {}
    if policy['operation'] == 'preflight':
        runs = request['ci_run_ids']
        require(isinstance(runs, list) and len(runs) == len(policy['ci']) and all(isinstance(v,str) and re.fullmatch(r'[1-9][0-9]{0,19}',v) for v in runs) and len(set(runs)) == len(runs), 'ci-ids-denied')
        require(isinstance(request['expected_release_sha256'], str) and re.fullmatch(r'[a-f0-9]{64}',request['expected_release_sha256']), 'baseline-denied')
        inputs = {'ci_run_ids':','.join(runs), 'expected_release_sha256':request['expected_release_sha256']}
    return {'repository':repo, 'issue':issue['number'], 'expectedSha':request['sha'], 'operation':policy['operation'], 'workflow':policy['workflow'], 'ref':policy['branch'], 'inputs':inputs, 'onlineVersionWrites':False}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Denied('api-redirect-denied')

def api(repo, suffix, token, body=None):
    require(repo in POLICIES, 'api-scope-denied')
    policy = POLICIES[repo]
    if body is None:
        require(suffix == '/git/ref/heads/'+policy['branch'] or re.fullmatch(r'/actions/runs/[1-9][0-9]{0,19}(/jobs\?filter=latest&per_page=100&page=[1-9][0-9]?)?',suffix), 'api-scope-denied')
    else:
        require(suffix == '/actions/workflows/'+policy['workflow']+'/dispatches' and set(body) == {'ref','inputs'} and body['ref'] == policy['branch'], 'dispatch-scope-denied')
    url = 'https://api.github.com/repos/'+repo+suffix
    payload = None if body is None else json.dumps(body).encode()
    headers = {'Accept':'application/vnd.github+json', 'Authorization':'Bearer '+token, 'User-Agent':'dot-fixed-readonly-router/1', 'X-GitHub-Api-Version':'2022-11-28'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=payload, headers=headers, method='GET' if payload is None else 'POST')
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            require(response.geturl() == url, 'api-origin-denied')
            raw = response.read(4*1024*1024+1)
            require(len(raw) <= 4*1024*1024, 'api-response-too-large')
            return {} if not raw else unique_json(raw)
    except urllib.error.HTTPError as error:
        raise Denied('api-http-'+str(error.code)) from None

def verify_ci(receipt, read):
    repo = receipt['repository']; policy = POLICIES[repo]; sha = receipt['expectedSha']
    require(read('/git/ref/heads/'+policy['branch'])['object']['sha'] == sha, 'branch-head-changed')
    checked = []; seen = set()
    for run_id in receipt['inputs'].get('ci_run_ids','').split(',') if policy['ci'] else ():
        run = read('/actions/runs/'+run_id)
        require(run.get('repository',{}).get('full_name') == repo and run.get('path') in policy['ci'] and run['path'] not in seen and run.get('head_sha') == sha and run.get('head_branch') == policy['branch'] and run.get('event') in ('push','workflow_dispatch') and run.get('status') == 'completed' and run.get('conclusion') == 'success', 'exact-ci-denied')
        seen.add(run['path']); jobs = []; page = 1
        while True:
            data = read('/actions/runs/'+run_id+'/jobs?filter=latest&per_page=100&page='+str(page))
            jobs.extend(data['jobs'])
            if len(jobs) >= data['total_count']:
                break
            require(data['jobs'] and page < 10, 'ci-pagination-denied')
            page += 1
        require(jobs and len(jobs) == data['total_count'] and all(j.get('status') == 'completed' and j.get('conclusion') == 'success' for j in jobs), 'ci-job-denied')
        checked.append({'runId':run_id, 'workflow':run['path'], 'jobs':len(jobs)})
    require(seen == set(policy['ci']), 'ci-workflow-missing')
    require(read('/git/ref/heads/'+policy['branch'])['object']['sha'] == sha, 'branch-head-changed')
    return checked

def main():
    event = unique_json(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
    receipt = validate(event, os.environ)
    token = os.environ['GH_TOKEN']
    receipt['ci'] = verify_ci(receipt, lambda suffix:api(receipt['repository'],suffix,token))
    # This is the only mutation: fixed own-repository workflow_dispatch.
    api(receipt['repository'],'/actions/workflows/'+receipt['workflow']+'/dispatches',token,{'ref':receipt['ref'],'inputs':receipt['inputs']})
    receipt['dispatched'] = True
    receipt['deploymentCompleted'] = False
    receipt['resultRequiresExactShaCheck'] = True
    output = Path('.local-evidence/dot-requests/request.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    summary = Path(os.environ['GITHUB_STEP_SUMMARY'])
    with summary.open('a',encoding='utf-8') as stream:
        stream.write('Fixed read-only request dispatched. Repository: '+receipt['repository']+'; ref: '+receipt['ref']+'; expected SHA: '+receipt['expectedSha']+'.\n\nFind the downstream workflow_dispatch run, verify its exact SHA and result artifact. Environment approval remains required for Web/Suite. Production was not requested.\n')

if __name__ == '__main__':
    try:
        main()
    except (Denied, ValueError, KeyError, TypeError, OSError):
        # No event bodies, tokens, request headers or untrusted exception text in logs.
        print('Fixed read-only request denied; check author, format, current SHA and complete CI.',file=sys.stderr)
        sys.exit(1)
