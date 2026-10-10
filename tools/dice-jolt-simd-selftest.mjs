// Exercise the actual loader, strict asset fetches, and both real Jolt builds.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'rolldown';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';

const root=resolve('.'),assets=resolve('extensions/workbench-dice3d/public');
const out=resolve(process.env.DND_JOLT_SIMD_EVIDENCE||'.local-evidence/jolt-simd');
const modes=['simd','unsupported','missing','corrupt','initialization-failure','both-fail','recover-after-failure'];
if(process.argv[2]==='--sample'){
  const [bundle,mode]=process.argv.slice(3),calls=[],imports=[];
  globalThis.self={location:{origin:'https://local.invalid'}};
  const actualValidate=WebAssembly.validate;
  if(mode==='unsupported')WebAssembly.validate=()=>false;
  const originalTimer=globalThis.setTimeout;
  globalThis.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms<=1000?Math.min(ms,5):ms,...args);
  let recovered=false;
  globalThis.fetch=async input=>{
    const u=new URL(String(input),'https://local.invalid');assert.equal(u.origin,'https://local.invalid');
    const rel=u.pathname.slice('/suite-dev/dice3d/'.length),isSimd=rel.includes('/simd-');
    calls.push(rel);const path=resolve(assets,rel);assert(path.startsWith(assets+sep));
    if((mode==='missing'&&isSimd)||(['both-fail','recover-after-failure'].includes(mode)&&!recovered))return new Response('authored missing engine',{status:404});
    if(mode==='corrupt'&&isSimd&&rel.endsWith('.wasm'))return new Response('authored corrupted SIMD binary');
    return new Response(await readFile(path));
  };
  const {initializeJolt,DiceAssets,supportsJoltSIMD}=await import(pathToFileURL(bundle).href);
  assert.equal(supportsJoltSIMD(),mode!=='unsupported','Feature probe must detect real SIMD support');
  const importer=async path=>{
    imports.push(path);const module=await import(pathToFileURL(resolve(assets,path)).href);
    if(mode==='initialization-failure'&&path.includes('/simd-'))return {default:async()=>{throw Error('authored SIMD factory failure');}};
    return module;
  };
  if(['both-fail','recover-after-failure'].includes(mode)){
    await assert.rejects(initializeJolt(new DiceAssets(),importer),/SIMD.*HTTP 404.*兼容.*HTTP 404/);
    assert.equal(imports.length,0,'Unverified glue must never execute');
    if(mode==='both-fail'){process.send({mode,accepted:false,calls,imports},()=>process.exit(0));}
    else recovered=true;
  }
  if(mode!=='both-fail'){
    const result=await initializeJolt(new DiceAssets(),importer);
    assert.equal(result.build,['unsupported','missing','corrupt','initialization-failure'].includes(mode)?'scalar':'simd');
    assert.equal(typeof result.engine.JoltInterface,'function','Actual Jolt was instantiated');
    if(['missing','corrupt','initialization-failure'].includes(mode))assert(result.fallbackReason);
    if(mode==='unsupported')assert(!calls.some(p=>p.includes('/simd-')),'Unsupported browser must fetch no SIMD assets');
    if(mode==='simd')assert(!calls.includes('vendor/jolt-physics.wasm.wasm'),'Healthy SIMD must not allocate the scalar heap');
    if(mode==='corrupt'){
      assert.equal(calls.filter(p=>p.includes('/simd-')&&p.endsWith('.wasm')).length,3);
      assert(!imports.some(p=>p.includes('/simd-')),'Corrupted build must never execute glue');
    }
    WebAssembly.validate=actualValidate;
    process.send({mode,build:result.build,fallbackReason:result.fallbackReason,calls,imports},()=>process.exit(0));
  }
}else{
  await mkdir(out,{recursive:true});verifyDiceAssets(assets,{normalize:true});
  const entry=resolve(out,'entry.ts'),bundle=resolve(out,'loader.mjs');
  await writeFile(entry,`export {initializeJolt,supportsJoltSIMD} from ${JSON.stringify(root+'/extensions/workbench-dice3d/src/jolt-engine.ts')};export {DiceAssets} from ${JSON.stringify(root+'/extensions/workbench-dice3d/src/asset-loading.ts')};`);
  await build({input:entry,platform:'node',output:{file:bundle,format:'esm'}});
  const cases=[];
  for(const mode of modes){
    const result=await new Promise((resolve,reject)=>{
      const child=fork(import.meta.filename,['--sample',bundle,mode],{cwd:root,stdio:['ignore','pipe','pipe','ipc']});
      let report,logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
      const timer=setTimeout(()=>{child.kill();reject(Error('Loader child timed out: '+mode));},60000);
      child.once('message',r=>report=r);child.once('error',reject);
      child.once('exit',code=>{clearTimeout(timer);code===0&&report?resolve(report):reject(Error(mode+' failed: '+logs));});
    });
    cases.push(result);console.log('PASS '+mode);
  }
  await writeFile(resolve(out,'loader-result.json'),JSON.stringify({passed:cases.length,syntheticFailures:true,realJolt:true,cases},null,2)+'\n');
}
