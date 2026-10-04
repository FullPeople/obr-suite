// Diagnostic-only build. No product files or timing/physics/graphics policy changes.
import {build,loadConfigFromFile} from 'vite';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';

export const PROBE_SCHEMA=2;
export function replaceBoundary(code,needle,next){
 if(code.split(needle).length!==2)throw Error('Idle probe boundary changed or ambiguous: '+needle);
 return code.replace(needle,next);
}
export function createIdleObservationPlugin(){return{name:'dice-idle-lifecycle-observation',enforce:'pre',transform(code,id){
 const p=id.replaceAll('\\','/');
 if(p.endsWith('/src/workbench/dice3d-verify.ts')){
  code=replaceBoundary(code,'{setupWorkbenchDice,rolls}','{setupWorkbenchDice,teardownWorkbenchDice,rolls}');
  code=replaceBoundary(code,'suiteHostProbe={','suiteHostProbe={setupWorkbenchDice,teardownWorkbenchDice,');
  // The original verifier retains full state/roll copies indefinitely. Retain only a bounded
  // scalar event ring used by this probe, never pose arrays, meshes or repeated state snapshots.
  code=replaceBoundary(code,"local.onmessage=e=>{if(e.data.type==='state'||e.data.type==='log')events.push(e.data);};resultListeners.add((data,revealed)=>results.push({data,revealed}));",`local.onmessage=e=>{if(e.data.type!=='log')return;const d=e.data;events.push({type:'log',event:d.event,detail:{roll:d.detail?.roll,failed:d.detail?.failed,stage:d.detail?.stage,message:d.detail?.message,error:d.detail?.error}});if(events.length>64)events.shift();};resultListeners.add((data,revealed)=>{results.push({rollId:data.rollId,revealed});if(results.length>32)results.shift();});`);
 }
 if(p.endsWith('/src/workbench/dice3d.ts'))code+=`\n(globalThis as any).__diceControllerSnapshot=()=>{const c=core as any;if(!c)return null;const maps=['peers','inbound','outgoing','rolls','requests','accepted','heldRolls','retainedUntil','settledAt','privateAudiences','secrets','records','started','reservations','probes','clocks','privateRunning','retirementTimers'];const buffers=new Set<ArrayBufferLike>();for(const r of [...c.rolls.values(),...c.heldRolls.values(),...[...c.outgoing.values()].map((o:any)=>o.roll)])if(r.poses?.buffer)buffers.add(r.poses.buffer);return{generation,ready:c.ready,physicsReady:c.physicsReady,overlayReady:c.overlayReady,error:c.error,failures:c.failures,maps:Object.fromEntries(maps.map(k=>[k,c[k]?.size])),uniquePoseBufferBytes:[...buffers].reduce((n,b)=>n+b.byteLength,0),events:c.events.length,receipts:c.receipts.length,queue:c.queue.length,disabled:c.disabled};};\n`;
 if(p.endsWith('/extensions/workbench-dice3d/src/renderer.ts')){
  const needle='this.gl.render(this.scene,this.camera);';
  if(code.split(needle).length!==4)throw Error('Idle probe renderer call sites changed');
  // A scalar counter does not create a new strong root to the renderer.
  code=code.replaceAll(needle,needle+'(globalThis as any).__diceIdleRenderCount=((globalThis as any).__diceIdleRenderCount||0)+1;');
 }
 if(p.endsWith('/extensions/workbench-dice3d/src/overlay.ts'))code=replaceBoundary(code,"  assets.stage('加载模型、数字贴图和音效');",`  (globalThis as any).__diceOverlaySnapshot=()=>{const r=renderer as any,a=audio as any;return{ready:r.ready,contextLost:r.contextLost,active:r.active.length,scheduledFrame:!!r.frameHandle,hidden:document.hidden,renderCalls:(globalThis as any).__diceIdleRenderCount||0,geometries:r.gl.info.memory.geometries,textures:r.gl.info.memory.textures,programs:r.gl.info.programs?.length,prepared:prepared.size,archive:archive.size,archiveIds:[...archive.keys()],archivePoseViewBytes:[...archive.values()].reduce((n,x)=>n+x.poses.byteLength,0),parentEntries:parents.size,tracking:tracking.size,labelNodes:labelNodes.size,audio:a.snapshot(),audioTimer:!!a.timer,audioDecodeCacheEntries:a.root.decoded.size,downloadedAssetBytes:[...(assets as any).sizes.values()].reduce((n:number,x:number)=>n+x,0),canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight}))};};\n  (globalThis as any).__diceOverlayContextLoss=(restore=false)=>{if(restore){(globalThis as any).__diceIdleLostContext?.restoreContext();return;}const ext=(renderer as any).gl.getContext().getExtension('WEBGL_lose_context');if(!ext)throw Error('WEBGL_lose_context required for pause fixture');(globalThis as any).__diceIdleLostContext=ext;ext.loseContext();};\n  assets.stage('加载模型、数字贴图和音效');`);
 if(p.endsWith('/extensions/workbench-dice3d/src/physics.worker.ts'))code+='\n(globalThis as any).__diceWorkerSnapshot=()=>({wasmLinearMemoryBytes:J?.HEAP8?.buffer.byteLength??null,incumbents:incumbents.size,incumbentBodies:[...incumbents.values()].reduce((n,a)=>n+a.length,0),bounds:incumbentBounds.size,kinds:incumbentKinds.size,groups:incumbentGroups.size,ruleRestPoses:ruleRestPoses.size});\n';
 return code;
}};}

export async function buildIdleProbe(){
 process.env.SUITE_BASE='suite-dev';process.env.SUITE_CHANNEL='dev';
 const root=resolve('.'),out=resolve(process.env.DICE_IDLE_BUILD||'.local-evidence/dice-idle/runtime');
 if(!process.env.DND_CARD_WEB_ROOT)throw Error('Set DND_CARD_WEB_ROOT to the exact paired Web checkout');
 const paths=execFileSync('git',['ls-files','src','extensions/workbench-dice3d/src'],{encoding:'utf8'}).trim().split('\n');
 const digest=()=>{const h=createHash('sha256');for(const p of paths){h.update(p+'\0');h.update(readFileSync(p));}return h.digest('hex');},before=digest();
 const {config}=await loadConfigFromFile({command:'build',mode:'production'},resolve('vite.config.ts'));
 await build({...config,plugins:[...(config.plugins||[]),createIdleObservationPlugin()],worker:{format:'es',plugins:()=>[createIdleObservationPlugin()]},root,configFile:false,base:'/suite-dev/',build:{...config.build,outDir:out,emptyOutDir:true,copyPublicDir:false,rollupOptions:{...config.build.rollupOptions,input:{'sdk-verify':resolve('extensions/workbench-dice3d/sdk-verify.html')}}}});
 const source=resolve('extensions/workbench-dice3d');await build({root:source,plugins:[createIdleObservationPlugin()],configFile:false,base:'/suite-dev/dice3d/',worker:{format:'es',plugins:()=>[createIdleObservationPlugin()]},build:{outDir:resolve(out,'dice3d'),emptyOutDir:true,rollupOptions:{input:{overlay:resolve(source,'overlay.html')}}}});
 if(digest()!==before)throw Error('Product source changed during diagnostic build');
 const provenance={probeSchema:PROBE_SCHEMA,suite:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),web:execFileSync('git',['-C',process.env.DND_CARD_WEB_ROOT,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),productSourceSha256:before,sourceFileCount:paths.length,assets:verifyDiceAssets(resolve(out,'dice3d'),{normalize:true}),diagnosticOnly:true,webRuntimeIncluded:false};
 writeFileSync(resolve(out,'provenance.json'),JSON.stringify(provenance,null,2));console.log(provenance);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildIdleProbe();
