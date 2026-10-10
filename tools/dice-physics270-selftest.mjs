// Compare complete real Jolt predictions with the fixed released 269 worker.
// Independent processes preserve allocation order; advanced IPC preserves -0 and float bits.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,fork} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..');
const baseline='6fdf367ab1ebdfdb4833a5ee8c97a98834795d13';
const workerPath='extensions/workbench-dice3d/src/physics.worker.ts';
const source=resolve(root,'extensions/workbench-dice3d/src');
const assets=resolve(root,'extensions/workbench-dice3d/public');
const scenarios=[
 {name:'mixed-eight-seed-1',formula:'1d6+1d20+1d4+1d8+1d10+1d12+1d100',count:8,seed:1},
 {name:'mixed-eight-seed-7',formula:'1d6+1d20+1d4+1d8+1d10+1d12+1d100',count:8,seed:7},
 {name:'mixed-nineteen-three-attempts',formula:'3d6+3d20+3d4+3d8+3d10+2d12+1d100',count:19,seed:123456},
 {name:'twenty-d6-seed-123456',formula:'20d6',count:20,seed:123456},
 {name:'twenty-d6-seed-97',formula:'20d6',count:20,seed:97},
];

if(process.argv[2]==='--sample'){
 const waiters=new Map();
 globalThis.self={location:{origin:'https://local.invalid'},postMessage(data){
  const key=data.id||data.type,pending=waiters.get(key);
  if(pending){waiters.delete(key);clearTimeout(pending.timer);pending.resolve(data);}
 }};
 globalThis.fetch=async input=>{
  const address=new URL(String(input),'https://local.invalid');
  assert.equal(address.origin,'https://local.invalid');
  assert(address.pathname.startsWith('/suite-dev/dice3d/'));
  const file=resolve(assets,address.pathname.slice('/suite-dev/dice3d/'.length));
  assert(file.startsWith(assets+sep),'Only locked local assets may be read');
  return new Response(await readFile(file));
 };
 const {diceCatalog}=await import(pathToFileURL(process.argv[3]).href),catalog=diceCatalog();
 const run=data=>new Promise((resolve,reject)=>{
  const key=data.request?.id||({warmup:'warm',retain:'retained'})[data.type];
  if(key){
   const timer=setTimeout(()=>{waiters.delete(key);reject(Error('Physics parity timeout: '+key));},120000);
   waiters.set(key,{resolve,reject,timer});
  }
  self.onmessage({data});if(!key)resolve();
 });
 const view={w:1280,h:800},warm=await run({type:'warmup',catalog,view});
 assert(!warm.error,JSON.stringify(warm));
 const rolls=[];
 for(const scenario of scenarios){
  const request={id:'physics270-'+scenario.name,source:'synthetic-physics-parity',name:'Synthetic parity',
   kind:'mixed',theme:'ink_sketch',bodyColor:'#28b1fa',visibility:'all',recipe:true,
   formula:scenario.formula,count:scenario.count,seed:scenario.seed};
  const response=await run({request,catalog,view});assert(!response.error,response.error);
  assert(response.roll.poses instanceof Float32Array);assert.equal(response.roll.kinds.length,scenario.count);
  rolls.push(response.roll);
  await run({type:'release',id:request.id});
  const held=await run({type:'retain',rolls:[],catalog});assert.equal(held.count,0,'Release must precede the next case');
 }
 assert.equal(rolls[2].diagnostics.attempts,3,'The rejected d4 and d8 landings must still require three attempts');
 assert.equal(rolls[2].diagnostics.rejected.length,2);
 process.send({rolls},error=>{if(error){console.error(error);process.exit(1);}process.exit(0);});
}else{
 const out=resolve(process.env.DND_DICE_EVIDENCE||resolve(root,'.cache/dice-physics270'));
 await mkdir(out,{recursive:true});
 const deps=process.env.DND_SUITE_DEPS||root,require=createRequire(resolve(deps,'package.json'));
 const {build}=await import(pathToFileURL(require.resolve('rolldown')).href);
 const fixedSource=execFileSync('git',['show',baseline+':'+workerPath],{cwd:root,encoding:'utf8'});
 const currentSource=await readFile(resolve(root,workerPath),'utf8');
 const entry=resolve(out,'entry.ts');
 await writeFile(entry,`import ${JSON.stringify(resolve(source,'physics.worker.ts'))};\nexport {diceCatalog} from ${JSON.stringify(resolve(source,'asset-catalog.ts'))};\n`);
 const sample=bundle=>new Promise((resolve,reject)=>{
  const child=fork(script,['--sample',bundle],{cwd:root,serialization:'advanced',stdio:['ignore','pipe','pipe','ipc']});
  let report,logs='';
  const collect=chunk=>{logs=(logs+chunk.toString()).slice(-8000);};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const timer=setTimeout(()=>{child.kill();reject(Error('Physics child timeout\n'+logs));},180000);
  child.once('message',value=>{report=value;});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',(code,signal)=>{
   clearTimeout(timer);
   if(code!==0||!report)reject(Error(`Physics child failed (${code??signal})\n${logs}`));else resolve(report);
  });
 });
 const reports={};
 for(const [label,worker] of [['baseline',fixedSource],['candidate',currentSource]]){
  const bundle=resolve(out,label+'.mjs');
  await build({input:entry,platform:'node',external:[/^node:/],plugins:[{
   name:'physics270-fixed-worker',
   load(id){
    if(id.replaceAll('\\','/')!==resolve(root,workerPath).replaceAll('\\','/'))return;
    const marker="new URL(url('vendor/jolt-physics.wasm.js'),self.location.origin).href";
    assert(worker.includes(marker),'Verified vendor loading hook changed');
    return worker.replace(marker,JSON.stringify(pathToFileURL(resolve(assets,'vendor/jolt-physics.wasm.js')).href));
   },
  }],output:{file:bundle,format:'esm',codeSplitting:false}});
  reports[label]=await sample(bundle);
 }
 const cases=scenarios.map((scenario,index)=>{
  const a=reports.baseline.rolls[index],b=reports.candidate.rolls[index];
  const {poses:oldPoses,physicsMs:baselinePhysicsMs,...oldMeta}=a;
  const {poses:newPoses,physicsMs:candidatePhysicsMs,...newMeta}=b;
  const oldBytes=new Uint8Array(oldPoses.buffer,oldPoses.byteOffset,oldPoses.byteLength);
  const newBytes=new Uint8Array(newPoses.buffer,newPoses.byteOffset,newPoses.byteLength);
  assert.deepEqual(newBytes,oldBytes,scenario.name+': complete pose bits changed');
  assert.deepEqual(newMeta,oldMeta,scenario.name+': metadata, contacts or retry order changed');
  return{name:scenario.name,physicalDice:scenario.count,frames:b.frames,attempts:b.diagnostics.attempts,
   poseBytes:newBytes.byteLength,poseSha256:createHash('sha256').update(newBytes).digest('hex'),
   baselinePhysicsMs,candidatePhysicsMs};
 });
 const result={passed:cases.length,failed:0,baseline,candidateWorkerSha256:createHash('sha256').update(currentSource).digest('hex'),
  boundary:'Actual locked Jolt with local assets and fixed synthetic requests. Complete trajectory bits and all metadata except physicsMs match. No real room, browser, device or performance acceptance claim.',cases};
 await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}
