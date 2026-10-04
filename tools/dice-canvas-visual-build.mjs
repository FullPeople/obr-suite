import {build} from 'vite';
import {resolve,dirname} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createPinnedPlugin,BASELINE,sha256} from './dice-canvas-visual-source.mjs';
const root=resolve('.'),out=resolve(process.env.DICE_CANVAS_BUILD||'.local-evidence/dice-canvas-visual/runtime');
assert(out.startsWith(root+'/'),'build output must be inside this checkout');
const {plugin,revisions,records}=createPinnedPlugin(process.env.DICE_CANVAS_CANDIDATE);
await build({root:resolve('tools'),configFile:false,plugins:[plugin],publicDir:false,base:'/',build:{outDir:out,emptyOutDir:true,minify:false,rollupOptions:{input:resolve('tools/dice-canvas-visual-fixture.html')}}});
// FormulaShow uses this production URL. Assets are pinned independently of working tree files.
const assets=[];
for(const kind of ['d4','d6','d8','d10','d12','d20','d_percentile']){
 const path=`extensions/workbench-dice3d/public/research-assets/${kind}.png`;
 const {execFileSync}=await import('node:child_process');const bytes=execFileSync('git',['show',BASELINE+':'+path]);
 const target=resolve(out,'suite-dev/dice3d/research-assets/'+kind+'.png');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);assets.push({path,sha256:sha256(bytes)});
}
for(const side of ['baseline','candidate'])for(const file of ['shared-overlay-canvas.ts','cue-renderer.ts','research/presentation.ts','research/formula.ts','research/rule-timeline.ts'])assert(records.has(side+':extensions/workbench-dice3d/src/'+file),'missing production module '+side+'/'+file);
const report={...revisions,sources:[...records.values()],assets,boundary:'Pinned production 2D modules; deterministic recorded pose fixture, actual parsers/timelines and Canvas2D. Not SDK, physics, WebGL, real room, or performance evidence.'};
writeFileSync(resolve(out,'build.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
