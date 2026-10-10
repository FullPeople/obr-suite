import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodeRoll,decodeRoll,split,Assembly,hash,FAST_CHUNK_BYTES} from '../extensions/workbench-dice3d/src/wire.mjs';
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
let codecChecks=0;
for(const count of [1,8,19,100]){
 const frames=99,backing=new Float32Array(frames*count*7+8),poses=backing.subarray(4,backing.length-4);
 for(let i=0;i<poses.length;i++)poses[i]=i%23===0?-0:i%31===0?1.401298464324817e-45:Math.sin(i*.019)*.2;
 const original=new Uint8Array(poses.buffer,poses.byteOffset,poses.byteLength).slice();
 const meta={version:2,fps:120,frames,kinds:Array(count).fill('d6'),results:Array(count).fill(3),duration:(frames-1)/120,collisions:1,request:{id:'codec269',source:'synthetic',name:'Synthetic',theme:'ink_sketch',count,modifier:0,bodyColor:'#28bceb'}};
 const contacts=[{t:.25,kind:0,a:1,b:0,seq:1,x:.125,y:0,z:-.25,speed:1.5,impulse:.125}];
 const legacy=await encodeRoll(meta,poses,contacts),compact=await encodeRoll(meta,poses,contacts,true);
 const parts=split(compact,FAST_CHUNK_BYTES),assembly=new Assembly(parts.length,compact.length,await hash(compact),FAST_CHUNK_BYTES);
 for(let i=parts.length-1;i>=0;i--)assembly.add(i,parts[i]);
 const decoded=await decodeRoll(await assembly.finish());
 assert.deepEqual(new Uint8Array(decoded.poses.buffer),original);assert.deepEqual(decoded.contacts,contacts);
 assert.deepEqual(decoded.request,meta.request);assert.deepEqual(decoded.results,meta.results);assert.equal(decoded.posePacking,undefined);
 assert.deepEqual(new Uint8Array(poses.buffer,poses.byteOffset,poses.byteLength),original);
 assert.deepEqual((await decodeRoll(legacy)).poses,decoded.poses);codecChecks++;
}
const meta={version:2,fps:120,frames:2,kinds:['d6'],results:[3],duration:1/120,collisions:0,request:{id:'bad',source:'synthetic',name:'Synthetic',theme:'ink_sketch',count:1,modifier:0}};
await assert.rejects(decodeRoll(await encodeRoll({...meta,posePacking:'unknown'},new Float32Array(14),[])),/Invalid pose packing/);
await assert.rejects(encodeRoll(meta,new Float32Array(13),[],true),/Pose count mismatch/);codecChecks+=2;
console.log(JSON.stringify({passed:true,physicalFaceAndHullCases:checks,losslessCodecCases:codecChecks,timingReduction:1/3,realRoomVerified:false}));
