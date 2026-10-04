import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';

const output=resolve(process.env.DND_DICE_EVIDENCE||'.cache/dice-overlay');
const baseline=process.env.DICE_OVERLAY_REFERENCE||'2e2ddb1f642e1375cffda45efad9584b33100008';
mkdirSync(output,{recursive:true});
const modules=['shared-overlay-canvas','cue-renderer','research/presentation'];
for(const [name,revision] of [['reference',baseline],['candidate',process.env.DICE_OVERLAY_BASELINE]]){
 await build({input:'dice-overlay-production',platform:'node',external:[/^node:/],plugins:[{
  name:'overlay-production-fixture',
  resolveId(id){if(id==='dice-overlay-production')return '\0'+id;},
  load(id){
   if(id==='\0dice-overlay-production')return modules.map(file=>`export * from ${JSON.stringify(resolve('extensions/workbench-dice3d/src',file+'.ts'))};`).join('\n');
   const normalized=id.replaceAll('\\','/');
   if(revision&&modules.some(file=>normalized.endsWith('/extensions/workbench-dice3d/src/'+file+'.ts'))){
    const path=normalized.slice(normalized.indexOf('extensions/workbench-dice3d/src/'));
    return execFileSync('git',['show',revision+':'+path],{encoding:'utf8'});
   }
  },
 }],output:{file:join(output,name+'.mjs'),format:'esm'}});
}
await build({input:'tools/dice-overlay.test.ts',platform:'node',external:[/^node:/],output:{file:join(output,'selftest.mjs'),format:'esm'}});
execFileSync(process.execPath,[join(output,'selftest.mjs')],{stdio:'inherit',env:{...process.env,DND_DICE_EVIDENCE:output}});
