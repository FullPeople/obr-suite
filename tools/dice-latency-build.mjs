import {build,loadConfigFromFile} from 'vite';
import {resolve} from 'node:path';
import {verifyDiceAssets} from './dice-pinned-assets.mjs';
process.env.SUITE_BASE='suite-dev';process.env.SUITE_CHANNEL='dev';
const root=resolve('.'),out=resolve(process.env.DND_DICE_LATENCY_BUILD||'.local-evidence/dice-latency/runtime');
if(!process.env.DND_CARD_WEB_ROOT)throw Error('Set DND_CARD_WEB_ROOT to the exact paired Web checkout');
const timing={name:'dice-fixture-timing',enforce:'pre',transform(code,id){const file=id.replaceAll('\\','/');
 if(file.endsWith('/extensions/workbench-dice3d/src/controller.ts')){const marker='const seed=crypto.getRandomValues(new Uint32Array(1))[0];';if(!code.includes(marker))throw Error('Submission seed probe boundary changed');return code.replace(marker,'const seed=(globalThis as any).__diceProfileSeed?.()??crypto.getRandomValues(new Uint32Array(1))[0];');}
 if(file.endsWith('/src/workbench/dice3d-verify.ts')){const marker='events.push(e.data)';if(!code.includes(marker))throw Error('SDK timing probe boundary changed');return code.replace(marker,'events.push({...e.data,observedAt:performance.timeOrigin+performance.now()})');}
 if(file.endsWith('/extensions/workbench-dice3d/src/renderer.ts')){const marker='this.gl.render(this.scene,this.camera);';if(!code.includes(marker))throw Error('Renderer probe boundary changed');return code.replaceAll(marker,marker+'(globalThis as any).__diceRenderedFrames?.push(performance.timeOrigin+performance.now());');}
}};
const {config}=await loadConfigFromFile({command:'build',mode:'production'},resolve('vite.config.ts'));
await build({...config,plugins:[...(config.plugins||[]),timing],root,configFile:false,base:'/suite-dev/',build:{...config.build,outDir:out,emptyOutDir:true,copyPublicDir:false,rollupOptions:{...config.build.rollupOptions,input:{'sdk-verify':resolve('extensions/workbench-dice3d/sdk-verify.html')}}}});
const source=resolve('extensions/workbench-dice3d');await build({root:source,plugins:[timing],configFile:false,base:'/suite-dev/dice3d/',worker:{format:'es'},build:{outDir:resolve(out,'dice3d'),emptyOutDir:true,rollupOptions:{input:{overlay:resolve(source,'overlay.html')}}}});
console.log(JSON.stringify({out,assets:verifyDiceAssets(resolve(out,'dice3d'),{normalize:true})}));
