import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve('.'),out=resolve(process.env.DND_DICE_EVIDENCE||'.local-evidence/dice-outline-profile'),baseline=process.env.DICE_LATENCY_BASELINE||'7783de080b0a32465150fbb2672daf848d5385b5';mkdirSync(out,{recursive:true});
const entry=join(out,'profile.ts');writeFileSync(entry,`
import {readFileSync} from 'node:fs';
import * as T from ${JSON.stringify(root+'/node_modules/three/build/three.module.js')};
import {GLTFLoader} from ${JSON.stringify(root+'/node_modules/three/examples/jsm/loaders/GLTFLoader.js')};
import {addSketchOutline,disposeDiceDecorations} from ${JSON.stringify(root+'/extensions/workbench-dice3d/src/dice-materials')};
import {addDynamicOutline} from ${JSON.stringify(root+'/extensions/workbench-dice3d/src/dynamic-decorations')};
const root=${JSON.stringify(root+'/extensions/workbench-dice3d/public/')},catalog=JSON.parse(readFileSync(root+'assets/catalog.json','utf8')),geometries=[];
for(const kind of ['d6','d20']){const b=readFileSync(root+catalog.dice[kind].model),g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');const geo=g.scene.getObjectByName('RenderMesh').geometry.clone();geo.scale(40,40,40);geometries.push(geo);}
const results=[];for(const style of ['sketch','comic'])for(const count of [1,20,100]){const samples=[];for(let run=0;run<12;run++){const start=performance.now(),meshes=[];for(let i=0;i<count;i++){const mat=new T.MeshPhysicalMaterial();mat.userData.time={value:0};const mesh=new T.Mesh(geometries[i%2],mat);if(style==='sketch')addSketchOutline(mesh,mesh.geometry);else addDynamicOutline(mesh,mesh.geometry,'comic');meshes.push(mesh);}const ms=performance.now()-start;for(const m of meshes){disposeDiceDecorations(m);m.material.dispose();}if(run>1)samples.push(ms);}results.push({style,count,samplesMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[5]});}console.log(JSON.stringify(results));
`);
const report={boundary:'Cloud CPU Node real GLTF outline/material preparation, no browser or GPU measurement',baseline,results:{}};
for(const variant of ['baseline','candidate']){const file=join(out,variant+'.mjs');await build({input:entry,platform:'node',external:[/^node:/],plugins:variant==='baseline'?[{name:'frozen-outline-baseline',load(id){const name=id.replaceAll('\\','/').match(/extensions\/workbench-dice3d\/src\/(?:dice-materials|dynamic-decorations)\.ts$/)?.[0];if(name)return execFileSync('git',['show',baseline+':'+name],{encoding:'utf8'});}}]:[],output:{file,format:'esm'}});report.results[variant]=JSON.parse(execFileSync(process.execPath,[file],{encoding:'utf8'}));}
writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
