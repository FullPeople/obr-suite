// CI-only real SDK/Jolt build. Product and paired Web bytes are source-exact.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build,loadConfigFromFile} from 'vite';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
import {sourceEvidence,once,SAFE_SUITE,SAFE_WEB} from './dice-ground-sequence-build.mjs';
export {sourceEvidence,once,SAFE_SUITE,SAFE_WEB};
export function probePlugin(root){
 return {name:'dice-ground-mask-sequence-instrumentation',enforce:'pre',transform(code,id){
  const file=id.replaceAll('\\','/').split('?')[0];
  if(file.endsWith('/extensions/workbench-dice3d/src/controller.ts'))return once(code,'const seed=crypto.getRandomValues(new Uint32Array(1))[0];','const seed=(globalThis as any).__diceSequenceSeed??crypto.getRandomValues(new Uint32Array(1))[0];');
  if(file.endsWith('/src/workbench/dice3d.ts'))return once(code,'const id=compat?.rollId||crypto.randomUUID();','const id=compat?.rollId||(globalThis as any).__diceSequenceRollId||crypto.randomUUID();');
  if(file.endsWith('/src/workbench/dice3d-verify.ts'))return once(code,'events.push(e.data)','events.push({...e.data,observedAt:performance.timeOrigin+performance.now()})');
  if(!file.endsWith('/extensions/workbench-dice3d/src/renderer.ts'))return;
  code=`import {installSequenceFixture} from ${JSON.stringify(resolve(root,'tools/dice-ground-mask-sequence-fixture.mjs'))};\n`+code;
  code=once(code,'    this.ready=true;','    installSequenceFixture(this,T);this.ready=true;');
  code=once(code,'private drawFrame(){\n    const time=now();','private drawFrame(){\n    const time=(globalThis as any).__diceSequenceTime??now();');
  const beforeRegion=code.includes('    const groundMaskView=')?'    const groundMaskView=':'    withRenderRegion(this.gl,';
  code=once(code,beforeRegion,'    (globalThis as any).__diceSequenceBeforeRender?.(this);\n'+beforeRegion);
  if(code.includes('    const groundMaskRegion=')){code=once(code,'    const groundMaskRegion=this.renderRegion.get(groundMaskView);','    const maskBoundsBegan=performance.now();const groundMaskRegion=this.renderRegion.get(groundMaskView);');code=once(code,'    this.groundMask.update(groundMaskView,groundMaskRegion);','    this.groundMask.update(groundMaskView,groundMaskRegion);(globalThis as any).__diceMaskBoundsMs=performance.now()-maskBoundsBegan;(globalThis as any).__diceMaskMainRegion=groundMaskRegion;');}
  code=once(code,'()=>{this.gl.render(this.scene,this.camera);});','()=>{const began=performance.now();this.gl.render(this.scene,this.camera);(globalThis as any).__diceMaskRenderMs=performance.now()-began;});');
  return code;
 }};
}
export async function buildSequence(){
 const root=resolve('.'),web=process.env.DND_CARD_WEB_ROOT&&resolve(process.env.DND_CARD_WEB_ROOT);
 const evidence=sourceEvidence(root,web),out=resolve(process.env.DICE_GROUND_MASK_SEQUENCE_BUILD||'.local-evidence/dice-ground-mask-sequence/runtime');
 const transformPath=resolve(process.env.DICE_GROUND_MASK_TRANSFORM||'tools/dice-ground-mask-transform.mjs');
 const {groundMaskTransform}=await import(pathToFileURL(transformPath));
 const sourcePaths=readdirSync(resolve(root,'tools')).filter(name=>name.startsWith('dice-ground-mask')&&/\.(mjs|ts)$/.test(name));
 evidence.experimentHashes=Object.fromEntries(sourcePaths.map(name=>['tools/'+name,createHash('sha256').update(readFileSync(resolve(root,'tools',name))).digest('hex')]));
 evidence.harnessDependencyHashes=Object.fromEntries(['tools/dice-ground-sequence-build.mjs','tools/dice-ground-sequence-pixels.mjs','tools/dice-pinned-assets.mjs','tools/workbench-dice3d-vite.ts'].map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]));
 evidence.builtAt=new Date().toISOString();evidence.baselineShader='true original ShadowMaterial; no mask hook or disabled-uniform variant';
 process.env.SUITE_BASE='suite-dev';process.env.SUITE_CHANNEL='dev';
 const plugins=()=>[groundMaskTransform(),probePlugin(root)];
 const {config}=await loadConfigFromFile({command:'build',mode:'production'},resolve('vite.config.ts'));
 await build({...config,plugins:[...(config.plugins||[]),...plugins()],root,configFile:false,base:'/suite-dev/',build:{...config.build,outDir:out,emptyOutDir:true,copyPublicDir:false,rollupOptions:{...config.build.rollupOptions,input:{'sdk-verify':resolve('extensions/workbench-dice3d/sdk-verify.html')}}}});
 const source=resolve('extensions/workbench-dice3d');
 await build({root:source,plugins:plugins(),configFile:false,base:'/suite-dev/dice3d/',worker:{format:'es'},build:{outDir:resolve(out,'dice3d'),emptyOutDir:true,rollupOptions:{input:{overlay:resolve(source,'overlay.html')}}}});
 evidence.assets=verifyDiceAssets(resolve(out,'dice3d'),{normalize:true});
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'ground-mask-sequence-source.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({out,source:{...evidence,hashes:undefined}}));return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildSequence();
