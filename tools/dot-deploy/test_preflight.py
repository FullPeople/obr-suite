"""Authorization and regression tests; no deployment credentials are generated."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import server_preflight as s

NOW=1000000

def request(target='card'):
    return {'operation':'preflight','target':target,'sha':'a'*40,'ci_run_ids':'123' if target=='card' else '123,124,125','expected_release_sha256':'b'*64,'oidc':'test-placeholder'}

def claims(target='card'):
    p=s.POLICIES[target]; repo=p['repository']; ref='refs/heads/'+p['branch']
    # Pin externally specified identity values independently of helper policy data.
    subject='repo:FullPeople@166210040/DND-card-web@1378484252:environment:production-card' if target=='card' else 'repo:FullPeople/obr-suite:environment:production-suite-dev'
    return {'iss':s.ISSUER,'aud':s.AUDIENCE,'repository':repo,'repository_id':p['repository_id'],'repository_owner_id':'166210040','ref':ref,'ref_type':'branch','sub':subject,'environment':p['environment'],'event_name':'workflow_dispatch','runner_environment':'github-hosted','workflow_ref':repo+'/.github/workflows/dot-deploy-preflight.yml@'+ref,'workflow_sha':'a'*40,'sha':'a'*40,'iat':NOW-60,'nbf':NOW-60,'exp':NOW+240,'run_id':'456'}

class Authorization(unittest.TestCase):
    def test_both_exact_scopes(self):
        for target in s.POLICIES: self.assertEqual(s.authorize(request(target),claims(target),NOW),s.POLICIES[target])

    def test_web_requires_only_the_exact_immutable_subject(self):
        valid='repo:FullPeople@166210040/DND-card-web@1378484252:environment:production-card'
        self.assertEqual(s.POLICIES['card']['subject'],valid)
        for subject in ('repo:FullPeople/DND-card-web:environment:production-card',valid.replace('@166210040','@1'),valid.replace('@1378484252','@1'),valid.replace('production-card','production-suite-dev'),valid.replace('DND-card-web','dnd-card-web'),valid+':ref:refs/heads/main',None):
            modified=claims(); modified['sub']=subject
            with self.subTest(subject=subject),self.assertRaises(s.Denied): s.authorize(request(),modified,NOW)

    def test_suite_retains_its_single_existing_subject(self):
        self.assertEqual(s.POLICIES['suite-dev']['subject'],'repo:FullPeople/obr-suite:environment:production-suite-dev')
        for subject in (claims()['sub'],'repo:FullPeople@166210040/obr-suite@1222135055:environment:production-suite-dev'):
            modified=claims('suite-dev'); modified['sub']=subject
            with self.subTest(subject=subject),self.assertRaises(s.Denied): s.authorize(request('suite-dev'),modified,NOW)

    def test_forged_claims_and_cross_repo_target(self):
        original=claims()
        for field in ('iss','aud','repository','repository_id','repository_owner_id','ref','ref_type','sub','environment','event_name','runner_environment','workflow_ref','workflow_sha','sha'):
            modified=copy.deepcopy(original); modified[field]='untrusted'
            with self.subTest(field=field),self.assertRaises(s.Denied): s.authorize(request(),modified,NOW)
            missing=copy.deepcopy(original); missing.pop(field)
            with self.subTest(missing_field=field),self.assertRaises(s.Denied): s.authorize(request(),missing,NOW)
        with self.assertRaises(s.Denied): s.authorize(request('suite-dev'),claims(),NOW)

    def test_forbidden_operations_paths_and_fields(self):
        for operation in ('publish','apply','rollback','upload','sh','preflight; id'):
            modified=request(); modified['operation']=operation
            with self.subTest(operation=operation),self.assertRaises(s.Denied): s.authorize(modified,claims(),NOW)
        for target in ('suite','three-dragon-ante','/var/www/obr-plugins/card','../card','FUS'):
            modified=request(); modified['target']=target
            with self.subTest(target=target),self.assertRaises(s.Denied): s.authorize(modified,claims(),NOW)
        for key,value in [('sha','main'),('ci_run_ids','1;id'),('ci_run_ids','123,123'),('expected_release_sha256','../../etc/shadow'),('command','id'),('archives','/tmp/package')]:
            modified=request(); modified[key]=value
            with self.subTest(key=key),self.assertRaises(s.Denied): s.authorize(modified,claims(),NOW)

    def test_token_time_and_json_duplicates(self):
        for field,value in [('exp',NOW),('iat',NOW+100),('nbf',NOW+100),('iat',NOW-601),('exp',NOW+10000),('iat',True)]:
            modified=claims(); modified[field]=value
            with self.subTest(field=field,value=value),self.assertRaises(s.Denied): s.authorize(request(),modified,NOW)
        with self.assertRaises(s.Denied): s.json_unique('{"target":"card","target":"suite"}')

    def test_unsigned_algorithms_rejected_before_network(self):
        for algorithm in ('none','HS256','RS512'):
            head=base64.urlsafe_b64encode(json.dumps({'alg':algorithm,'kid':'test'}).encode()).decode().rstrip('=')
            with patch.object(s,'get_json') as network,self.assertRaises(s.Denied): s.verify_token(head+'.e30.AA')
            network.assert_not_called()

class Gates(unittest.TestCase):
    def run_ci(self):
        return {'repository':{'full_name':'FullPeople/DND-card-web'},'head_sha':'a'*40,'head_branch':'main','path':'.github/workflows/web.yml','status':'completed','conclusion':'success','event':'workflow_dispatch'}

    def test_exact_ci_and_complete_job_pagination(self):
        responses=[{'object':{'sha':'a'*40}},self.run_ci(),{'jobs':[{'status':'completed','conclusion':'success'}]*100,'total_count':101},{'jobs':[{'status':'completed','conclusion':'success'}],'total_count':101},{'object':{'sha':'a'*40}}]
        with patch.object(s,'get_json',side_effect=responses) as api:
            self.assertEqual(s.verify_ci(request(),s.POLICIES['card'])['runs'][0]['jobs'],101)
        self.assertTrue(api.call_args_list[-2].args[0].endswith('page=2'))

    def test_stale_head_ci_wrong_sha_workflow_and_skipped_jobs(self):
        with patch.object(s,'get_json',return_value={'object':{'sha':'c'*40}}),self.assertRaises(s.Denied): s.verify_ci(request(),s.POLICIES['card'])
        for key,value in [('head_sha','c'*40),('head_branch','dev'),('path','.github/workflows/fast.yml'),('conclusion','failure'),('status','in_progress'),('event','pull_request')]:
            run=self.run_ci(); run[key]=value
            with self.subTest(key=key),patch.object(s,'get_json',side_effect=[{'object':{'sha':'a'*40}},run]),self.assertRaises(s.Denied): s.verify_ci(request(),s.POLICIES['card'])
        for conclusion in ('failure','skipped','cancelled',None):
            with self.subTest(conclusion=conclusion),patch.object(s,'get_json',side_effect=[{'object':{'sha':'a'*40}},self.run_ci(),{'jobs':[{'status':'completed','conclusion':conclusion}],'total_count':1}]),self.assertRaises(s.Denied): s.verify_ci(request(),s.POLICIES['card'])

    def test_empty_or_truncated_job_list(self):
        for jobs,total in [([],0),([],101)]:
            with patch.object(s,'get_json',side_effect=[{'object':{'sha':'a'*40}},self.run_ci(),{'jobs':jobs,'total_count':total}]),self.assertRaises(s.Denied): s.verify_ci(request(),s.POLICIES['card'])

    def test_suite_requires_all_three_release_workflows(self):
        inputs=request('suite-dev'); responses=[{'object':{'sha':'a'*40}}]
        for path in s.POLICIES['suite-dev']['ci_paths']:
            run=self.run_ci(); run.update(repository={'full_name':'FullPeople/obr-suite'},head_branch='dev',path=path)
            responses.extend([run,{'jobs':[{'status':'completed','conclusion':'success'}],'total_count':1}])
        responses.append({'object':{'sha':'a'*40}})
        with patch.object(s,'get_json',side_effect=responses): self.assertEqual(len(s.verify_ci(inputs,s.POLICIES['suite-dev'])['runs']),3)
        inputs['ci_run_ids']='123'
        with patch.object(s,'get_json',side_effect=responses[:3]),self.assertRaises(s.Denied): s.verify_ci(inputs,s.POLICIES['suite-dev'])

    def test_last_minute_branch_drift_is_denied(self):
        responses=[{'object':{'sha':'a'*40}},self.run_ci(),{'jobs':[{'status':'completed','conclusion':'success'}],'total_count':1},{'object':{'sha':'c'*40}}]
        with patch.object(s,'get_json',side_effect=responses),self.assertRaises(s.Denied): s.verify_ci(request(),s.POLICIES['card'])

    def test_static_hash_changes_when_content_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); (root/'index.html').write_text('before')
            old=s.tree(root)
            (root/'index.html').write_text('after')
            self.assertNotEqual(old['sha256'],s.tree(root)['sha256'])

    def test_symlink_denied_if_platform_supports_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); (root/'file').write_text('content')
            try: (root/'link').symlink_to(root/'file')
            except OSError: self.skipTest('Local Windows user cannot create symlinks')
            with self.assertRaises(s.Denied): s.tree(root)

    def test_invalid_request_errors_do_not_echo_secret_marker(self):
        raw=json.dumps({'operation':'publish','target':'card','oidc':'NEVER_ECHO_MARKER'}).encode()
        fake=type('Input',(),{'buffer':io.BytesIO(raw)})()
        output=io.StringIO()
        with patch.object(s.sys,'stdin',fake),patch.object(s.sys,'argv',['server_preflight.py']),patch('sys.stdout',output): self.assertEqual(s.main(),1)
        self.assertNotIn('NEVER_ECHO_MARKER',output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['error'],'operation-or-target-denied')

if __name__=='__main__': unittest.main(verbosity=2)
