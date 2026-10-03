// Read-only/synthetic regression runner. Browser DOM tests run separately in CI.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local-evidence/verification');mkdirSync(out,{recursive:true});
const scripts=['resource-layout-235-selftest','resource-presentation-217-selftest','resource-dashboard-220-selftest','native-owner-selftest','announcement-scope-selftest','action-launcher-layout-selftest','workbench-selection-223-selftest','workbench-group-217-selftest','three-dragon-legacy-recovery-selftest','three-dragon-stable-recovery-selftest','three-dragon-local-connection-selftest','three-dragon-controller-selftest','three-dragon-handover-selftest','workbench-merge-selftest','workbench-inventory-sync-selftest','workbench-condition-selftest'];
const results=[];
for(const script of scripts){
 const run=spawnSync(process.execPath,['--experimental-strip-types',join(root,'tools',script+'.mjs')],{cwd:root,env:process.env,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 const log=(run.stdout||'')+(run.stderr||'')+(run.error?'\n'+run.error:'');writeFileSync(join(out,script+'.log'),log);
 results.push({script,exitCode:run.status,passed:run.status===0});console.log(`${run.status===0?'PASS':'FAIL'} ${script}`);if(run.status!==0)console.error(log);
}
writeFileSync(join(out,'results.json'),JSON.stringify({realRoomVerified:false,results},null,2)+'\n');
if(results.some(result=>!result.passed))process.exitCode=1;
