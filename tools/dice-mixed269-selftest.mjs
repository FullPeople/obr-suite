import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve('.local-evidence/dice-mixed269');mkdirSync(out,{recursive:true});
const worker=resolve('extensions/workbench-dice3d/src/physics.worker.ts').replaceAll('\\','/');
const entry=resolve(out,'entry.ts');writeFileSync(entry,`export {diceCatalog} from '../../extensions/workbench-dice3d/src/asset-catalog';\n`);
// An absolute entry prevents the evidence directory from changing module identity.
writeFileSync(entry,`export {diceCatalog} from ${JSON.stringify(resolve('extensions/workbench-dice3d/src/asset-catalog.ts'))};export {buildCue,POST_SETTLE_PAUSE} from ${JSON.stringify(resolve('extensions/workbench-dice3d/src/cue.ts'))};export {probe} from ${JSON.stringify(worker)};`);
await build({input:entry,platform:'node',external:[/^node:/],plugins:[{name:'read-only-physics-probe',load(id){if(id.replaceAll('\\','/')===worker)return readFileSync(worker,'utf8')+'\nexport const probe={rotateBy,rotatedY,resolveFace,minimumSurfaceHeight,lowestSupportVertexCount};';}}],output:{file:out+'/checks.mjs',format:'esm'}});
globalThis.self={};const {probe,diceCatalog,POST_SETTLE_PAUSE}=await import(pathToFileURL(out+'/checks.mjs').href);
assert.equal(POST_SETTLE_PAUSE,2*2/3);
const catalog=diceCatalog();let checks=0,seed=269;
const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
for(let i=0;i<512;i++){
 const q=[next(),next(),next(),next()],length=Math.hypot(...q);for(let j=0;j<4;j++)q[j]/=length;
 for(const die of Object.values(catalog.dice)){
  for(const vertex of die.hull)assert.equal(probe.rotatedY(vertex,q),probe.rotateBy(vertex,q)[1]);
  const faces=die.outcomes.map(o=>({...o,y:probe.rotateBy(o.normal,q)[1]})).sort((a,b)=>b.y-a.y),face=probe.resolveFace(die.outcomes,q);
  assert.equal(face.value,faces[0].value);assert.equal(face.alignment,faces[0].y);assert.equal(face.secondAlignment,faces[1].y);assert.deepEqual(face.worldDirection,probe.rotateBy(faces[0].normal,q));
  const heights=die.hull.map(v=>probe.rotateBy(v,q)[1]),lowest=Math.min(...heights);
  assert.equal(probe.minimumSurfaceHeight(die,q,3),3+lowest);checks++;
 }
}
console.log(JSON.stringify({passed:true,physicalFaceAndHullCases:checks,timingReduction:1/3,realRoomVerified:false}));
