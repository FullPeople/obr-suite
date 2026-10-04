// CI-only source-exact SDK/Jolt/WebGL build. No product file is written.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build,loadConfigFromFile} from 'vite';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
export const SAFE_SUITE='2e2ddb1f642e1375cffda45efad9584b33100008';
export const SAFE_WEB='05dcfdb645339cac9f68d1f6009f44b7e63d5c25';
const git=(cwd,...args)=>execFileSync('git',['-c','core.quotePath=false','-C',cwd,...args],{encoding:'utf8'}).trim();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceEvidence(root,web){
 assert(web,'Set DND_CARD_WEB_ROOT to exact paired Web checkout');
 const changed=git(root,'diff','--name-only',SAFE_SUITE,'--').split('\n').filter(Boolean);
 const productChanges=changed.filter(path=>!path.startsWith('tools/')&&!path.startsWith('.github/'));
 assert.deepEqual(productChanges,[],'Product differs from verified safe Suite baseline');
 const untracked=git(root,'ls-files','--others','--exclude-standard').split('\n').filter(Boolean).filter(path=>!path.startsWith('tools/')&&!path.startsWith('.github/')&&!path.startsWith('.paired-web/'));
 assert.deepEqual(untracked,[],'Untracked non-diagnostic files in Suite');
 assert.equal(git(web,'rev-parse','HEAD'),SAFE_WEB,'Paired Web revision changed');
 assert.equal(git(web,'diff','--name-only','HEAD','--'),'','Paired Web tracked files changed');
 const files=git(root,'ls-files').split('\n').filter(path=>!path.startsWith('tools/')&&!path.startsWith('.github/'));
 const hashes=Object.fromEntries(files.map(path=>[path,sha(readFileSync(resolve(root,path)))]));
 const threeVersion=JSON.parse(readFileSync(resolve(root,'node_modules/three/package.json'),'utf8')).version;assert.equal(threeVersion,'0.186.0','Runtime audit requires exact Three r186');
 const trustPaths=['extensions/workbench-dice3d/src/renderer.ts','extensions/workbench-dice3d/src/dice-materials.ts','extensions/workbench-dice3d/src/outline-geometry.ts','extensions/workbench-dice3d/src/material-styles.ts','extensions/workbench-dice3d/src/render-region.ts'];
 return {safeSuite:SAFE_SUITE,suiteHead:git(root,'rev-parse','HEAD'),safeWeb:SAFE_WEB,productChanges,productFileCount:files.length,productTreeSha256:sha(JSON.stringify(hashes)),trustedFactorySourceHashes:Object.fromEntries(trustPaths.map(path=>[path,hashes[path]])),threeVersion,hashes};
}
export function once(code,marker,replacement,label=marker){
 assert.equal(code.split(marker).length-1,1,'Probe boundary changed: '+label);
 return code.replace(marker,replacement);
}
export function probePlugin(root,runtimePath=resolve(root,'tools/dice-ground-live-runtime.mjs')){
 return {name:'dice-ground-sequence-instrumentation',enforce:'pre',transform(code,id){
  const file=id.replaceAll('\\','/').split('?')[0];
  if(file.endsWith('/extensions/workbench-dice3d/src/controller.ts'))return once(code,'const seed=crypto.getRandomValues(new Uint32Array(1))[0];','const seed=(globalThis as any).__diceSequenceSeed??crypto.getRandomValues(new Uint32Array(1))[0];');
  if(file.endsWith('/src/workbench/dice3d.ts'))return once(code,'const id=compat?.rollId||crypto.randomUUID();','const id=compat?.rollId||(globalThis as any).__diceSequenceRollId||crypto.randomUUID();');
  if(file.endsWith('/src/workbench/dice3d-verify.ts'))return once(code,'events.push(e.data)','events.push({...e.data,observedAt:performance.timeOrigin+performance.now()})');
  if(!file.endsWith('/extensions/workbench-dice3d/src/renderer.ts'))return;
  code=`import {installGroundLiveProbe} from ${JSON.stringify(runtimePath)};\nimport {installSequenceFixture} from ${JSON.stringify(resolve(root,'tools/dice-ground-sequence-fixture.mjs'))};\n`+code;
  const boundary='    await this.gl.compileAsync(this.scene,this.camera);this.gl.render(this.scene,this.camera);this.gl.getContext().finish();for(const m of warm)';
  code=once(code,boundary,`    // Evidence is captured only from the exact, hash-verified built-in factory.\n    const trustedSketch=warm.filter(m=>m.material.customProgramCacheKey()==='dice-inlay-v4-static-style-sketch');\n    const sequenceTrust={source:${JSON.stringify('verified-baseline-build:'+SAFE_SUITE)},exclusiveRenderer:true,rendererRender:this.gl.render,\n      bodyMaterialHooks:trustedSketch.map(m=>({onBeforeCompile:m.material.onBeforeCompile,customProgramCacheKey:m.material.customProgramCacheKey})),\n      decorationShaders:trustedSketch.flatMap(m=>m.children.map((c:any)=>({vertexShader:c.material.vertexShader,fragmentShader:c.material.fragmentShader}))),\n      geometries:[...new Set(trustedSketch.flatMap(m=>[m.geometry,...m.children.map((c:any)=>c.geometry)]))]};\n${boundary}`);
  code=once(code,'    this.ready=true;','    this.ready=true;installSequenceFixture(this,T,installGroundLiveProbe,sequenceTrust);');
  code=once(code,'private drawFrame(){\n    const time=now();','private drawFrame(){\n    const time=(globalThis as any).__diceSequenceTime??now();');
  code=once(code,'    withRenderRegion(this.gl,','    (globalThis as any).__diceSequenceBeforeRender?.(this);\n    withRenderRegion(this.gl,');
  return code;
 }};
}
export async function buildSequence(){
 const root=resolve('.'),web=process.env.DND_CARD_WEB_ROOT&&resolve(process.env.DND_CARD_WEB_ROOT);
 const evidence=sourceEvidence(root,web),out=resolve(process.env.DICE_GROUND_SEQUENCE_BUILD||'.local-evidence/dice-ground-sequence/runtime');
 const runtimePath=resolve(process.env.DICE_GROUND_LIVE_RUNTIME||resolve(root,'tools/dice-ground-live-runtime.mjs')),runtime=readFileSync(runtimePath);
 evidence.runtimeSha256=sha(runtime);evidence.builtAt=new Date().toISOString();
 process.env.SUITE_BASE='suite-dev';process.env.SUITE_CHANNEL='dev';
 const {config}=await loadConfigFromFile({command:'build',mode:'production'},resolve('vite.config.ts'));
 await build({...config,plugins:[...(config.plugins||[]),probePlugin(root,runtimePath)],root,configFile:false,base:'/suite-dev/',build:{...config.build,outDir:out,emptyOutDir:true,copyPublicDir:false,rollupOptions:{...config.build.rollupOptions,input:{'sdk-verify':resolve('extensions/workbench-dice3d/sdk-verify.html')}}}});
 const source=resolve('extensions/workbench-dice3d');
 await build({root:source,plugins:[probePlugin(root,runtimePath)],configFile:false,base:'/suite-dev/dice3d/',worker:{format:'es'},build:{outDir:resolve(out,'dice3d'),emptyOutDir:true,rollupOptions:{input:{overlay:resolve(source,'overlay.html')}}}});
 evidence.assets=verifyDiceAssets(resolve(out,'dice3d'),{normalize:true});
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'ground-sequence-source.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({out,source:{...evidence,hashes:undefined}}));return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildSequence();
