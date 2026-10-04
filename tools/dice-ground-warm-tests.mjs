import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {instrumentGroundWarmRuntime,instrumentGroundWarmBrowser,RUNTIME_SHA256,sha} from './dice-ground-warm-transform.mjs';
import {installGroundLiveProbe as originalInstall} from './dice-ground-live-runtime.mjs';
import {fixture,GL} from './dice-ground-live-runtime.test.mjs';
const req=createRequire(process.env.DICE_GROUND_LIVE_PACKAGE_JSON||new URL('../package.json',import.meta.url)),T=req('three');
const source=readFileSync(new URL('./dice-ground-live-runtime.mjs',import.meta.url),'utf8'),browser=readFileSync(new URL('./dice-ground-sequence-browser.mjs',import.meta.url),'utf8');
assert.equal(sha(source),RUNTIME_SHA256);
assert.throws(()=>instrumentGroundWarmRuntime(source+'\n'),/source drift/);
assert.throws(()=>instrumentGroundWarmBrowser(browser+'\n'),/runner drift/);
const instrumented=instrumentGroundWarmRuntime(source),runner=instrumentGroundWarmBrowser(browser);
assert(runner.includes("await timingLeg(scenario,0,'cache')"));assert(!runner.includes('await correctness();'));
assert(!runner.includes("id:'single-control'"));assert(runner.includes('strictPixelsNotRun:true'));
const dir=mkdtempSync(join(tmpdir(),'dice-ground-warm-')),file=join(dir,'runtime.mjs');writeFileSync(file,instrumented);
const {installGroundLiveProbe:profileInstall}=await import(pathToFileURL(file).href),prior=globalThis.WebGL2RenderingContext;
globalThis.WebGL2RenderingContext=GL;
function execute(install,{fail=false}={}){
 const f=fixture();f.probe.dispose();const calls=[];
 for(const name of ['getParameter','getError','getExtension','isContextLost','isEnabled','checkFramebufferStatus']){const old=f.gl[name];f.gl[name]=function(...args){calls.push([name,...args]);return old.apply(this,args);};}
 const body=f.bodies[0],probe=install({r:f.r,T,enabled:true,minBodies:20,stableFrames:2,trust:{source:'verified unit fixture',exclusiveRenderer:true,rendererRender:f.renderer.render,bodyMaterialHooks:[{onBeforeCompile:body.material.onBeforeCompile,customProgramCacheKey:body.material.customProgramCacheKey}],geometries:[f.geometry],decorationShaders:[]}});
 let error;
 try{f.draw();if(fail)f.failCapture=true;f.draw();if(!fail){f.draw();f.draw();}}catch(e){error=e.message;}
 const snapshot=probe.snapshot();probe.dispose();return{calls,snapshot,error,materialRestored:f.ground.material===f.material};
}
try{
 const a=execute(originalInstall),b=execute(profileInstall);
 assert.deepEqual(b.calls,a.calls,'Instrumentation changed original GL call order/count/args');
 for(const field of ['frames','hits','builds','fallbacks','invalidations'])assert.equal(b.snapshot[field],a.snapshot[field],field);
 assert.deepEqual(b.snapshot.syncCalls,a.snapshot.syncCalls);assert.deepEqual(b.snapshot.syncCalls.hit,{});
 assert.equal(b.snapshot.warmProfile.addedGPUCalls,0);
 const build=b.snapshot.records.find(r=>r.built);assert(build);
 assert(build.warmBuild.spans.some(x=>x.name==='state(true)'));
 for(const name of ['resource-allocation-and-snapshots','setRenderTarget(R32F)','capture clear','capture render','restore1-before-compile','cache compile','restore2-finally'])assert(build.warmBuild.spans.some(x=>x.name===name),name);
 const expected=Object.values(b.snapshot.syncCalls.build).reduce((a,b)=>a+b,0);assert.equal(build.warmBuild.queries.length,expected);
 assert(build.warmBuild.queries.every(x=>x.cpuWallMs>=0));assert.equal(b.materialRestored,true);
 const failedA=execute(originalInstall,{fail:true}),failedB=execute(profileInstall,{fail:true});
 assert.equal(failedB.error,failedA.error);assert.deepEqual(failedB.calls,failedA.calls);assert.equal(failedB.snapshot.requiresRendererRecreation,true);assert.equal(failedB.materialRestored,true);
 console.log('Warm observation tests PASS: pinned-source rejection, two-case runner, exact GL call equivalence, complete spans, unchanged fatal semantics. No browser run.');
}finally{globalThis.WebGL2RenderingContext=prior;rmSync(dir,{recursive:true,force:true});}
