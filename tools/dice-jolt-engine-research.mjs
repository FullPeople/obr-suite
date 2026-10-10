// Local research only: the production worker and asset integrity checks stay intact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {cpus,totalmem,platform,arch,availableParallelism} from 'node:os';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..');
const research=resolve(root,'..'),out=resolve(research,'evidence/engine');
const src=resolve(root,'extensions/workbench-dice3d/src');
const assets=resolve(root,'extensions/workbench-dice3d/public');
const mixed='1d6+1d20+1d4+1d8+1d10+1d12+1d100';
const core=[
 {name:'mixed-eight-seed-1',formula:mixed,count:8,seed:1},
 {name:'mixed-eight-seed-7',formula:mixed,count:8,seed:7},
 {name:'mixed-nineteen-seed-123456',formula:'3d6+3d20+3d4+3d8+3d10+2d12+1d100',count:19,seed:123456},
 {name:'twenty-d6-seed-123456',formula:'20d6',count:20,seed:123456},
 {name:'twenty-d6-seed-97',formula:'20d6',count:20,seed:97},
];
const fixtures=[...core,
 ...Array.from({length:24},(_,i)=>({name:'fixed-seed-'+i,formula:i%3===0?'20d6':i%3===1?core[2].formula:mixed,
  count:i%3===0?20:i%3===1?19:8,seed:Math.imul(i+1,0x9e3779b9)>>>0})),
 ...[4,6,8,10,12,20,100].map(s=>({name:'family-d'+s,formula:`${s===100?10:20}d${s}`,count:20,seed:0x1234abcd})),
 {name:'mixed-landscape',formula:mixed,count:8,seed:0xffffffff,view:{w:1920,h:1080}},
 {name:'mixed-portrait',formula:mixed,count:8,seed:42,view:{w:390,h:844}},
 {name:'advantage-three',formula:'adv(1d20,2)',count:3,seed:7},
 {name:'disadvantage-two',formula:'dis(1d20)',count:2,seed:1},
 {name:'physical-minimum-hop',formula:'max(2d6,6)',count:2,seed:97},
 {name:'physical-maximum-hop',formula:'min(2d20,10)',count:2,seed:97},
 {name:'forced-reroll',formula:'resetmin(2d6,6)',count:4,seed:7},
 {name:'burst-rule',formula:'burst(1d4)',seed:123456},
 {name:'authoritative-preset',count:4,seed:97,preset:{total:25,dice:[{type:'d6',value:6},{type:'d20',value:19},{type:'d100',value:100,loser:true}]}},
 {name:'retained-first',formula:'8d6',count:8,seed:97,keep:true},
 {name:'retained-second',formula:mixed,count:8,seed:7,retained:true},
];
const digest=b=>createHash('sha256').update(b).digest('hex');
const bytes=p=>Buffer.from(p.buffer,p.byteOffset,p.byteLength);
const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['physicsMs','engineMs','totalMs'].includes(key)).map(([key,v])=>[key,clean(v)])):value;

if(process.argv[2]==='--sample'){
 const [bundle,variant,mode,roundText]=process.argv.slice(3),round=Number(roundText);
 const variantDir=resolve(research,'variants',variant),waiters=new Map();
 globalThis.self={location:{origin:'https://local.invalid'},postMessage(data){
  const key=data.id||data.type,pending=waiters.get(key);
  if(pending){waiters.delete(key);clearTimeout(pending.timer);pending.resolve(data);}
 }};
 globalThis.fetch=async input=>{
  const address=new URL(String(input),'https://local.invalid');assert.equal(address.origin,'https://local.invalid');
  assert(address.pathname.startsWith('/suite-dev/dice3d/'));
  const rel=address.pathname.slice('/suite-dev/dice3d/'.length);
  const file=rel==='vendor/jolt-physics.wasm.js'||rel==='vendor/jolt-physics.wasm.wasm'
   ?resolve(variantDir,rel.slice('vendor/'.length)):resolve(assets,rel);
  assert(file.startsWith(assets+sep)||file.startsWith(variantDir+sep),'Only pinned local assets may be read');
  return new Response(await readFile(file));
 };
 const startup=performance.now();
 const {diceCatalog}=await import(pathToFileURL(bundle).href),catalog=diceCatalog();
 const run=data=>new Promise((resolve,reject)=>{
  const key=data.request?.id||({warmup:'warm',retain:'retained'})[data.type];
  if(key){const timer=setTimeout(()=>{waiters.delete(key);reject(Error('Engine research timeout: '+key));},120000);waiters.set(key,{resolve,reject,timer});}
  self.onmessage({data});if(!key)resolve();
 });
 const view={w:1280,h:800},warm=await run({type:'warmup',catalog,view});
 assert(!warm.error,JSON.stringify(warm));const startupMs=performance.now()-startup,rolls=[];
 for(const scenario of mode==='parity'?fixtures:core){
  const request={id:'jolt-research-'+scenario.name,source:'synthetic-jolt-engine-research',name:'Synthetic engine comparison',
   kind:'mixed',theme:'ink_sketch',bodyColor:'#28b1fa',visibility:'all',recipe:true,
   formula:scenario.formula,count:scenario.count??1,seed:scenario.seed,...(scenario.preset?{preset:scenario.preset}:{})};
  const began=performance.now(),response=await run({request,catalog,view:scenario.view||view}),elapsedMs=performance.now()-began;
  if(response.error){rolls.push({name:scenario.name,error:response.error,elapsedMs});continue;}
  const roll=response.roll;assert(roll.poses instanceof Float32Array);
  assert.equal(roll.poses.length,roll.frames*roll.kinds.length*7);assert(roll.poses.every(Number.isFinite));
  if(scenario.count!==undefined)assert.equal(roll.kinds.length,scenario.count,scenario.name);
  for(let i=0;i<roll.kinds.length;i++)assert(catalog.dice[roll.kinds[i]].outcomes.some(o=>o.value===roll.results[i]),'No engraved face matches '+scenario.name);
  let normError=0;for(let at=3;at<roll.poses.length;at+=7){const q=roll.poses;const n=q[at]**2+q[at+1]**2+q[at+2]**2+q[at+3]**2;normError=Math.max(normError,Math.abs(n-1));}assert(normError<0.01,'Invalid physical orientation');
  const {poses,physicsMs,...meta}=roll,raw=bytes(poses),metadata=clean(meta);
  if(mode==='parity'){const dir=resolve(out,'poses',variant);await mkdir(dir,{recursive:true});await writeFile(resolve(dir,scenario.name+'.bin'),raw);await writeFile(resolve(dir,scenario.name+'.json'),JSON.stringify(metadata,null,2)+'\n');}
  rolls.push({name:scenario.name,elapsedMs,physicsMs,physicalDice:roll.kinds.length,frames:roll.frames,poseBytes:raw.length,
   poseSha256:digest(raw),metadataSha256:digest(JSON.stringify(metadata)),results:roll.results,diagnostics:roll.diagnostics,normError,
   ruleKinds:roll.formulaData?.rows?.flatMap(row=>row.events.map(e=>e.kind))||[]});
  if(!scenario.keep){await run({type:'release',id:request.id});if(scenario.retained)await run({type:'release',id:'jolt-research-retained-first'});
   const held=await run({type:'retain',rolls:[],catalog});assert(!held.error,JSON.stringify(held));assert.equal(held.count,0,'World was not released');}
 }
 process.send({variant,mode,round,warm,startupMs,rolls},error=>{if(error){console.error(error);process.exit(1);}process.exit(0);});
}else{
 await mkdir(out,{recursive:true});await writeFile(resolve(out,'fixtures.json'),JSON.stringify({core,fixtures},null,2)+'\n');
 const require=createRequire(resolve(root,'package.json')),{build}=await import(pathToFileURL(require.resolve('rolldown')).href);
 const assetHashes=JSON.parse(await readFile(resolve(assets,'asset-hashes.json'),'utf8'));
 const productionLock=JSON.parse(await readFile(resolve(assets,'vendor/lock.json'),'utf8'));
 const workerSource=await readFile(resolve(src,'physics.worker.ts'),'utf8'),entry=resolve(out,'entry.ts');
 await writeFile(entry,`import ${JSON.stringify(resolve(src,'physics.worker.ts'))};\nexport {diceCatalog} from ${JSON.stringify(resolve(src,'asset-catalog.ts'))};\n`);
 const variants=(process.env.DICE_JOLT_VARIANTS||'original,scalar,simd').split(',');assert(variants.every(v=>['original','scalar','simd'].includes(v)));const manifest={},bundles={};
 for(const variant of variants){
  const dir=resolve(research,'variants',variant),files={...productionLock.files},sizes={};
  for(const name of ['jolt-physics.wasm.js','jolt-physics.wasm.wasm']){const b=await readFile(resolve(dir,name));files[name]=digest(b);sizes[name]=b.length;}
  const lock={...productionLock,files},hashes={...assetHashes,...Object.fromEntries(Object.entries(files).map(([name,h])=>['vendor/'+name,h]))};
  manifest[variant]={files,sizes};const bundle=resolve(out,variant+'.mjs');bundles[variant]=bundle;
  await build({input:entry,platform:'node',external:[/^node:/],plugins:[{name:'jolt-engine-research',load(id){
   const f=id.replaceAll('\\','/');
   if(f===resolve(src,'physics.worker.ts').replaceAll('\\','/')){
    const marker="new URL(url('vendor/jolt-physics.wasm.js'),self.location.origin).href";assert(workerSource.includes(marker));
    return workerSource.replace(marker,JSON.stringify(pathToFileURL(resolve(dir,'jolt-physics.wasm.mjs')).href));
   }
   if(f===resolve(src,'asset-manifest.ts').replaceAll('\\','/'))return `export const VENDOR_LOCK=${JSON.stringify(lock)};export const ASSET_LOCKS=Object.freeze(${JSON.stringify(hashes)});`;
  }}],output:{file:bundle,format:'esm',codeSplitting:false}});
 }
 await writeFile(resolve(out,'engine-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const sample=(variant,mode,round)=>new Promise((resolve,reject)=>{
  const child=fork(script,['--sample',bundles[variant],variant,mode,String(round)],{cwd:root,serialization:'advanced',stdio:['ignore','pipe','pipe','ipc']});
  let report,logs='';const collect=chunk=>{logs=(logs+chunk.toString()).slice(-8000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  const timer=setTimeout(()=>{child.kill();reject(Error('Engine child timed out\n'+logs));},300000);
  child.once('message',v=>{report=v;});child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);if(code!==0||!report)reject(Error(`Engine child failed (${code??signal})\n${logs}`));else resolve(report);});
 });
 const parity={},trials=[];
 for(const variant of variants){parity[variant]=await sample(variant,'parity',0);await writeFile(resolve(out,'parity-'+variant+'.json'),JSON.stringify(parity[variant],null,2)+'\n');console.log(JSON.stringify({stage:'parity',variant,cases:parity[variant].rolls.length,errors:parity[variant].rolls.filter(r=>r.error)}));}
 // Balanced, predetermined order; no engine is always timed first or last.
 const orders=[['original','scalar','simd'],['scalar','simd','original'],['simd','original','scalar'],['original','simd','scalar'],['simd','scalar','original'],['scalar','original','simd'],['original','scalar','simd']];
 for(const [round,order] of (process.env.DICE_JOLT_PARITY_ONLY==='1'?[]:orders).entries())for(const variant of order.filter(v=>variants.includes(v))){const trial=await sample(variant,'timing',round);
  for(const roll of trial.rolls){const expected=parity[variant].rolls.find(r=>r.name===roll.name);assert(!roll.error,roll.error);assert.equal(roll.poseSha256,expected.poseSha256,'Repeated trajectory changed');assert.equal(roll.metadataSha256,expected.metadataSha256,'Repeated metadata changed');}
  trials.push(trial);await writeFile(resolve(out,'trials.json'),JSON.stringify(trials,null,2)+'\n');console.log(JSON.stringify({stage:'timing',round,variant,startupMs:trial.startupMs,physicsMs:trial.rolls.map(r=>r.physicsMs)}));}
 const comparisons=[];
 for(const [a,b] of [['original','scalar'],['scalar','simd'],['original','simd']].filter(([a,b])=>variants.includes(a)&&variants.includes(b)))for(const fixture of fixtures){
  const left=parity[a].rolls.find(r=>r.name===fixture.name),right=parity[b].rolls.find(r=>r.name===fixture.name);
  const record={a,b,name:fixture.name,poseBitsEqual:left.poseSha256===right.poseSha256,metadataEqual:left.metadataSha256===right.metadataSha256,resultsEqual:JSON.stringify(left.results)===JSON.stringify(right.results),errors:[left.error,right.error].filter(Boolean)};
  if(!left.error&&!right.error&&!record.poseBitsEqual){const x=await readFile(resolve(out,'poses',a,fixture.name+'.bin')),y=await readFile(resolve(out,'poses',b,fixture.name+'.bin'));let first=-1,changed=0,maxDelta=0;const len=Math.min(x.length,y.length);
   for(let at=0;at<len;at+=4)if(x.readUInt32LE(at)!==y.readUInt32LE(at)){if(first<0)first=at/4;changed++;maxDelta=Math.max(maxDelta,Math.abs(x.readFloatLE(at)-y.readFloatLE(at)));}
   Object.assign(record,{firstChangedFloat:first,changedFloats:changed,leftBytes:x.length,rightBytes:y.length,maxFloatDelta:maxDelta});}
  comparisons.push(record);
 }
 const percentile=(values,p)=>{const s=[...values].sort((a,b)=>a-b);return s[Math.ceil(p*s.length)-1];};
 const timing=trials.length?variants.map(variant=>({variant,coldStartupMedianMs:percentile(trials.filter(t=>t.variant===variant).map(t=>t.startupMs),.5),coldEngineMedianMs:percentile(trials.filter(t=>t.variant===variant).map(t=>t.warm.engineMs),.5),cases:core.map(s=>{const rolls=trials.filter(t=>t.variant===variant).map(t=>t.rolls.find(r=>r.name===s.name));return{name:s.name,samples:rolls.length,physicsMedianMs:percentile(rolls.map(r=>r.physicsMs),.5),physicsP95Ms:percentile(rolls.map(r=>r.physicsMs),.95),elapsedMedianMs:percentile(rolls.map(r=>r.elapsedMs),.5),attempts:rolls.map(r=>r.diagnostics?.attempts),results:rolls.map(r=>r.results)};})})):[];
 const result={createdAt:new Date().toISOString(),suiteBaseline:'0d9cc2aec992066f810af9501fe432427b95f8cb',workerSha256:digest(workerSource),
  hardware:{platform:platform(),arch:arch(),node:process.version,cpu:cpus()[0]?.model,logicalCpus:cpus().length,availableParallelism:availableParallelism(),totalMemory:totalmem()},
  boundary:'Real pinned production Jolt worker and asset verification, synthetic fixtures in Node. No browser/network/Owlbear/mobile acceptance. All measurements serial after compilation.',manifest,comparisons,timing};
 await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({result:resolve(out,'result.json'),timing:timing.map(({cases,...summary})=>({...summary,cases:cases.map(({results,...timing})=>timing)})),comparisonSummary:variants.flatMap((a,i)=>variants.slice(i+1).map(b=>{const c=comparisons.filter(r=>r.a===a&&r.b===b);return{a,b,cases:c.length,identical:c.filter(r=>r.poseBitsEqual&&r.metadataEqual).length,resultsEqual:c.filter(r=>r.resultsEqual).length,errors:c.filter(r=>r.errors.length).length};}))},null,2));
}
