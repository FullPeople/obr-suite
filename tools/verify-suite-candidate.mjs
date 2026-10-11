// Stable-only checks; every declared check must exist and pass.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local-evidence/verification');
mkdirSync(out,{recursive:true});
const scripts=['appearance-preferences-selftest','qq-account-session-selftest','inventory-model-selftest','bestiary-dependency-selftest','bestiary-render-selftest','announcement-inline-selftest','card-sync260-selftest','workbench-merge-selftest','workbench-inventory-sync-selftest','workbench-condition-selftest','three-dragon-controller-selftest','three-dragon-handover-selftest','three-dragon-stable-recovery-selftest'];
const results=[];
for(const script of scripts){
 const run=spawnSync(process.execPath,['--experimental-strip-types',join(root,'tools',script+'.mjs')],{cwd:root,env:{...process.env,BESTIARY_DIST:'dist'},encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
 const log=(run.stdout||'')+(run.stderr||'')+(run.error?'\n'+run.error:'');
 writeFileSync(join(out,script+'.log'),log);
 results.push({script,exitCode:run.status,passed:run.status===0});
 console.log(`${run.status===0?'PASS':'FAIL'} ${script}`);
 if(run.status!==0)console.error(log);
}
writeFileSync(join(out,'results.json'),JSON.stringify({target:'legacy-stable',realRoomVerified:false,results},null,2)+'\n');
if(results.some(result=>!result.passed))process.exitCode=1;
