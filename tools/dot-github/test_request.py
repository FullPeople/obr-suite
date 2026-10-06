import copy
import json
import unittest
from request import Denied, OWNER_ID, POLICIES, TITLE, validate, verify_ci

SHA = 'a'*40
NOW = 1791266400

def fixture(repo='FullPeople/DND-card-web'):
    policy = POLICIES[repo]
    user = {'login':'FullPeople','id':OWNER_ID,'type':'User'}
    body = {'operation':policy['operation'],'sha':SHA}
    if policy['ci']:
        body.update(ci_run_ids=[str(100+i) for i in range(len(policy['ci']))],expected_release_sha256='b'*64)
    event = {'action':'opened','sender':user.copy(),'repository':{'full_name':repo,'id':policy['id'],'owner':{'id':OWNER_ID}},'issue':{'number':10,'title':TITLE,'user':user.copy(),'body':json.dumps(body),'created_at':'2026-10-06T06:00:00Z'}}
    env = {'GITHUB_REPOSITORY':repo,'GITHUB_EVENT_NAME':'issues','GITHUB_RUN_ATTEMPT':'1','GITHUB_ACTOR':'FullPeople','GITHUB_ACTOR_ID':str(OWNER_ID),'GITHUB_REF':'refs/heads/main','GITHUB_WORKFLOW_REF':repo+'/.github/workflows/dot-readonly-request.yml@refs/heads/main'}
    return event,env

class RequestTests(unittest.TestCase):
    def test_three_fixed_dispatches(self):
        for repo,p in POLICIES.items():
            event,env=fixture(repo); result=validate(event,env,NOW)
            self.assertEqual((result['workflow'],result['ref'],result['operation']),(p['workflow'],p['branch'],p['operation']))
            self.assertFalse(result['onlineVersionWrites'])

    def test_identity_and_event_rejection(self):
        changes=[('GITHUB_REPOSITORY','FullPeople/FUS'),('GITHUB_ACTOR','attacker'),('GITHUB_ACTOR_ID','1'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_EVENT_NAME','issue_comment'),('GITHUB_REF','refs/heads/dev'),('GITHUB_WORKFLOW_REF','attacker/.github/workflows/x.yml@refs/heads/main')]
        for key,value in changes:
            event,env=fixture();env[key]=value
            with self.subTest(key=key),self.assertRaises(Denied):validate(event,env,NOW)
        for key,value in [('action','edited'),('sender',{'login':'FullPeople','id':1,'type':'User'})]:
            event,env=fixture();event[key]=value
            with self.assertRaises(Denied):validate(event,env,NOW)

    def test_issue_author_repository_and_time(self):
        event,env=fixture()
        cases=[]
        for section,key,value in [('issue','title','dot: publish'),('issue','pull_request',{}),('issue','number',True),('repository','id',1),('issue','created_at','2026-10-06T04:00:00Z')]:
            changed=copy.deepcopy(event);changed[section][key]=value
            if key=='pull_request':changed[section][key]={'url':'https://github.com/example'}
            cases.append(changed)
        for section in ('sender','issue'):
            changed=copy.deepcopy(event)
            user=changed['sender'] if section=='sender' else changed['issue']['user']
            user['type']='Bot';cases.append(changed)
        for changed in cases:
            with self.assertRaises(Denied):validate(changed,env,NOW)

    def test_untrusted_request_fields(self):
        changes=[('operation','publish'),('sha','main'),('sha','a'*40+';id'),('target','card'),('command','id'),('token','secret'),('ci_run_ids',['100','100']),('ci_run_ids',[100]),('ci_run_ids',['1;id']),('expected_release_sha256','b'*63)]
        for key,value in changes:
            event,env=fixture();body=json.loads(event['issue']['body']);body[key]=value;event['issue']['body']=json.dumps(body)
            with self.subTest(key=key,value=value),self.assertRaises(Denied):validate(event,env,NOW)
        event,env=fixture();event['issue']['body']='{"operation":"preflight","operation":"validate","sha":"'+SHA+'"}'
        with self.assertRaises(Denied):validate(event,env,NOW)

    def test_data_rejects_server_inputs(self):
        event,env=fixture('FullPeople/dnd5e-automation-data');body=json.loads(event['issue']['body']);body['expected_release_sha256']='b'*64;event['issue']['body']=json.dumps(body)
        with self.assertRaises(Denied):validate(event,env,NOW)

    def test_complete_ci_and_pagination(self):
        event,env=fixture();receipt=validate(event,env,NOW);repo=receipt['repository'];path=POLICIES[repo]['ci'][0]
        run={'repository':{'full_name':repo},'path':path,'head_sha':SHA,'head_branch':'main','event':'push','status':'completed','conclusion':'success'}
        job={'status':'completed','conclusion':'success'};calls=[]
        def read(suffix):
            calls.append(suffix)
            if '/git/ref/' in suffix:return {'object':{'sha':SHA}}
            if '/jobs?' in suffix:return {'total_count':2,'jobs':[job]}
            return run
        result=verify_ci(receipt,read)
        self.assertEqual(result[0]['jobs'],2)
        self.assertTrue(any('page=2' in x for x in calls))
        for conclusion in ('failure','skipped','cancelled',None):
            job['conclusion']=conclusion
            with self.assertRaises(Denied):verify_ci(receipt,read)

    def test_stale_or_foreign_ci(self):
        event,env=fixture();receipt=validate(event,env,NOW);repo=receipt['repository']
        run={'repository':{'full_name':repo},'path':POLICIES[repo]['ci'][0],'head_sha':SHA,'head_branch':'main','event':'push','status':'completed','conclusion':'success'}
        def read(suffix):
            if '/git/ref/' in suffix:return {'object':{'sha':SHA}}
            if '/jobs?' in suffix:return {'total_count':1,'jobs':[{'status':'completed','conclusion':'success'}]}
            return run
        for key,value in [('head_sha','c'*40),('head_branch','evil'),('event','pull_request'),('path','.github/workflows/dot-deploy-contract.yml'),('conclusion','failure')]:
            previous=run[key];run[key]=value
            with self.assertRaises(Denied):verify_ci(receipt,read)
            run[key]=previous
        with self.assertRaises(Denied):verify_ci(receipt,lambda suffix:{'object':{'sha':'c'*40}})

if __name__=='__main__':
    unittest.main()
