import {build} from 'rolldown';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out=mkdtempSync(join(tmpdir(),'tda-ante-origin-'));
const origins='anteOrigins:(s.anteOrigins??[]).filter(origin=>s.ante.includes(origin.cardId)&&s.seats.some(seat=>seat.id===origin.seatId)).map(origin=>({...origin}))';
const mutants={
 'early-origin':['projection.ts',origins,'anteOrigins:[...(s.anteOrigins??[]),...Object.entries(s.committed).map(([seatId,cardId])=>({seatId,cardId}))]','unrevealed ante has no public origin'],
 'wrong-seat':['engine.ts','s.anteOrigins=s.seats.map((seat,index)=>({seatId:seat.id,cardId:ids[index]}))','s.anteOrigins=s.seats.map((seat,index)=>({seatId:seat.id,cardId:ids[ids.length-1-index]}))','revealed provenance follows seats rather than submission order'],
 'retain-taken':['projection.ts',origins,'anteOrigins:(s.anteOrigins??[]).map(origin=>({...origin}))','taken Bronze antes are filtered from public origins'],
};
const sources=['tools/three-dragon-ante-origin-selftest.entry.ts','tools/three-dragon-ante-origin-selftest.mjs',...['engine.ts','types.ts','projection.ts'].map(file=>'extensions/three-dragon-ante/src/game/rules/'+file),'extensions/three-dragon-ante/src/game/wire.ts'];
const pins=()=>Object.fromEntries(sources.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const initial=pins(),results=[];
for(const name of process.argv.includes('--mutations')?['baseline',...Object.keys(mutants)]:['baseline']){
 const mutation=mutants[name],file=join(out,name+'.mjs');let applied=0;
 await build({input:resolve('tools/three-dragon-ante-origin-selftest.entry.ts'),platform:'node',plugins:mutation?[{name:'precise-origin-mutation',transform(code,id){if(!id.replaceAll('\\','/').endsWith('/rules/'+mutation[0]))return;if(code.split(mutation[1]).length!==2)throw Error('Mutation must have exactly one anchor: '+name);applied++;return code.replace(mutation[1],mutation[2]);}}]:[],output:{file,format:'esm'}});
 if(mutation&&applied!==1)throw Error('Mutation not applied exactly once: '+name);
 const run=spawnSync(process.execPath,[file],{encoding:'utf8',timeout:30000});
 writeFileSync(join(out,name+'.log'),run.stdout+run.stderr);
 if(!mutation){if(run.status!==0)throw Error(run.stdout+run.stderr);console.log(run.stdout.trim());results.push({name,status:'PASS',output:run.stdout.trim()});}
 else {if(run.status!==1||!run.stderr.includes('Error: ASSERTION: '+mutation[3]))throw Error('Mutation did not fail at expected actual assertion: '+name+'\n'+run.stdout+run.stderr);results.push({name,status:'KILLED',assertion:mutation[3],compiled:true});console.log('KILLED '+name+': '+mutation[3]);}
}
if(JSON.stringify(pins())!==JSON.stringify(initial))throw Error('Source changed during test run');
writeFileSync(join(out,'result.json'),JSON.stringify({scope:'Actual deterministic rules actions, physical-card invariants, private/public projection and wire round trips. No UI, network or real room.',sources:initial,results},null,2)+'\n');console.log('Evidence: '+out);
