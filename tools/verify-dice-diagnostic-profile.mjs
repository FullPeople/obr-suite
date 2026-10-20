import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {identifyBuiltDiceProfile} from './dice-diagnostic-profile.mjs';
const root=resolve(import.meta.dirname,'..'),build=join(root,'dist-workbench-dev'),out=join(root,'.local-evidence/ci-dice-profile');mkdirSync(out,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceCommit=git('rev-parse','HEAD'),webCommit=process.env.DND_CARD_WEB_ROOT?execFileSync('git',['rev-parse','HEAD'],{cwd:process.env.DND_CARD_WEB_ROOT,encoding:'utf8'}).trim():undefined;
try{
 assert.equal(git('status','--porcelain','--untracked-files=no'),'','Tracked source changed before diagnostic validation');
 const before=identifyBuiltDiceProfile(build,{sourceCommit,webCommit});
 const validator=before.mode==='physical'?'tools/dice-production-package-selftest.mjs':'tools/dice-light292-browser.mjs';
 const result=spawnSync(process.execPath,[validator],{cwd:root,stdio:'inherit',env:process.env});
 if(result.error)throw result.error;assert.equal(result.status,0,'Applicable dice validation failed: '+validator);
 assert.equal(git('rev-parse','HEAD'),sourceCommit,'Suite source changed during validation');
 assert.equal(git('status','--porcelain','--untracked-files=no'),'','Tracked source changed during validation');
 const after=identifyBuiltDiceProfile(build,{sourceCommit,webCommit});assert.deepEqual(after,before,'Built package changed during validation');
 const report={at:new Date().toISOString(),success:true,sourceCommit,webCommit,validator,...before,realOwlbearRoom:false};writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`mode=${before.mode}\n`);
 console.log(JSON.stringify(report));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({success:false,sourceCommit,webCommit,error:String(error)},null,2)+'\n');throw error;}
