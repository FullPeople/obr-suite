import {build,loadConfigFromFile} from 'vite';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
import {instrumentTail} from './dice-tail-trace.mjs';
process.env.SUITE_BASE='suite-dev';process.env.SUITE_CHANNEL='dev';
const root=resolve('.'),out=resolve(process.env.DND_DICE_LATENCY_BUILD||'.local-evidence/dice-latency/runtime');
if(!process.env.DND_CARD_WEB_ROOT)throw Error('Set DND_CARD_WEB_ROOT to the exact paired Web checkout');
const researchVariant=process.env.DICE_JOLT_RESEARCH_VARIANT;
if(!['original','scalar','simd'].includes(researchVariant))throw Error('Explicit research engine variant required');
const engineDir=resolve(root,'../variants',researchVariant),assetRoot=resolve(root,'extensions/workbench-dice3d/public');
const vendor=JSON.parse(readFileSync(resolve(assetRoot,'vendor/lock.json'),'utf8'));
for(const file of ['jolt-physics.wasm.js','jolt-physics.wasm.wasm'])vendor.files[file]=createHash('sha256').update(readFileSync(resolve(engineDir,file))).digest('hex');
const researchHashes={...JSON.parse(readFileSync(resolve(assetRoot,'asset-hashes.json'),'utf8')),...Object.fromEntries(Object.entries(vendor.files).map(([name,h])=>['vendor/'+name,h]))};
const timing={name:'dice-fixture-timing',enforce:'pre',load(id){
 if(id.replaceAll('\\','/').endsWith('/extensions/workbench-dice3d/src/asset-manifest.ts'))return `export const VENDOR_LOCK=${JSON.stringify(vendor)};export const ASSET_LOCKS=Object.freeze(${JSON.stringify(researchHashes)});`;

 if(process.env.DICE_CONTEXT_BASELINE&&id.replaceAll('\\','/').endsWith('/extensions/workbench-dice3d/src/overlay.ts'))
  return execFileSync('git',['show',process.env.DICE_CONTEXT_BASELINE+':extensions/workbench-dice3d/src/overlay.ts'],{encoding:'utf8'});
},transform(code,id){const original=code;code=code.replaceAll('\r\n','\n');if(process.env.DICE_LATENCY_TAIL==='1')code=instrumentTail(code,id)??code;const file=id.replaceAll('\\','/');
 if(file.endsWith('/extensions/workbench-dice3d/src/controller.ts')){const marker='const seed=crypto.getRandomValues(new Uint32Array(1))[0];';if(!code.includes(marker))throw Error('Submission seed probe boundary changed');return code.replace(marker,'const seed=(globalThis as any).__diceProfileSeed?.()??crypto.getRandomValues(new Uint32Array(1))[0];');}
 if(file.endsWith('/src/workbench/dice3d.ts'))return code+`\n(globalThis as any).__diceProfileControllerState=()=>{const c=core as any;return c?{heldRolls:c.heldRolls.size,retainedUntil:c.retainedUntil.size,queued:c.queue.length,pending:!!c.pending}:null;};\n`;
 if(file.endsWith('/extensions/workbench-dice3d/src/physics.worker.ts'))return code+`\n(globalThis as any).__diceProfileIndependentState=()=>({incumbents:incumbents.size,bounds:incumbentBounds.size,kinds:incumbentKinds.size,groups:incumbentGroups.size});\n`;
 if(file.endsWith('/src/workbench/dice3d-verify.ts')){const marker='events.push(e.data)';if(!code.includes(marker))throw Error('SDK timing probe boundary changed');return code.replace(marker,'events.push({...e.data,observedAt:performance.timeOrigin+performance.now()})');}
 if(file.endsWith('/extensions/workbench-dice3d/src/renderer.ts')){const marker='this.gl.render(this.scene,this.camera);',clock='private drawFrame(){\n    const time=now();';if(!code.includes(marker)||!code.includes(clock))throw Error('Renderer probe boundary changed');return code.replaceAll(marker,'(()=>{const began=performance.now();'+marker+'const glReturned=performance.now(),at=performance.timeOrigin+glReturned;for(const a of this.active)(globalThis as any).__diceTailEvent?.("renderer-gl-return",a.roll.request.id,{visibleDice:a.meshes.filter(m=>m.visible).length,glReturnMs:glReturned-began},at);(globalThis as any).__diceRenderedFrames?.push(at);const probeBegan=performance.now(),readback=(globalThis as any).__diceVisibleProbe?.(this,at);(globalThis as any).__diceFrameCosts?.push({at,glReturnMs:glReturned-began,readbackSpanMs:readback?.readbackSpanMs??0,visibleProbeSpanMs:performance.now()-probeBegan,renderCpuMs:performance.now()-began,drawCalls:this.gl.info.render.calls,triangles:this.gl.info.render.triangles,visibleDice:this.active.reduce((n,a)=>n+a.meshes.filter(m=>m.visible).length,0),casters:this.active.reduce((n,a)=>n+a.meshes.filter(m=>m.visible&&m.castShadow).length,0),pendingRolls:this.active.filter(a=>at<a.start).length});})();').replace('this.ready=true;','this.ready=true;(globalThis as any).__diceProfileRenderer=this;(globalThis as any).__diceProfileThree=T;(globalThis as any).__dicePixelFactories={instanceDiceMaterial,addSketchOutline,addDynamicOutline,disposeDiceDecorations};').replace(clock,'private drawFrame(){\n    const time=(globalThis as any).__diceProfileTime??now();');}
 return code!==original?code:undefined;
}};
const {config}=await loadConfigFromFile({command:'build',mode:'production'},resolve('vite.config.ts'));
await build({...config,plugins:[...(config.plugins||[]),timing],worker:{format:'es',plugins:()=>[timing]},root,configFile:false,base:'/suite-dev/',build:{...config.build,outDir:out,emptyOutDir:true,copyPublicDir:false,rollupOptions:{...config.build.rollupOptions,input:{'sdk-verify':resolve('extensions/workbench-dice3d/sdk-verify.html')}}}});
const source=resolve('extensions/workbench-dice3d');await build({root:source,plugins:[timing],configFile:false,base:'/suite-dev/dice3d/',worker:{format:'es',plugins:()=>[timing]},build:{outDir:resolve(out,'dice3d'),emptyOutDir:true,rollupOptions:{input:{overlay:resolve(source,'overlay.html')}}}});
const originalAssetProof=verifyDiceAssets(resolve(out,'dice3d'),{normalize:true});
for(const file of ['jolt-physics.wasm.js','jolt-physics.wasm.wasm']){
 const target=resolve(out,'dice3d/vendor',file);copyFileSync(resolve(engineDir,file),target);
 if(createHash('sha256').update(readFileSync(target)).digest('hex')!==vendor.files[file])throw Error('Research engine asset hash mismatch');
}
writeFileSync(resolve(out,'dice3d/vendor/lock.json'),JSON.stringify(vendor,null,2)+'\n');
writeFileSync(resolve(out,'jolt-research.json'),JSON.stringify({researchOnly:true,variant:researchVariant,vendor,originalAssetProof},null,2)+'\n');
console.log(JSON.stringify({out,researchOnly:true,variant:researchVariant}));
execFileSync(process.execPath,['tools/build-workbench-dice.mjs'],{env:{...process.env,WORKBENCH_DICE_OUT:resolve(out,'workbench-dice')},stdio:'inherit'});
