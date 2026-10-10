import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {encodeRoll,decodeRoll,split,Assembly,hash,FAST_CHUNK_BYTES} from '../extensions/workbench-dice3d/src/wire.mjs';
const baselineSource=execFileSync('git',['show','6fdf367ab1ebdfdb4833a5ee8c97a98834795d13:extensions/workbench-dice3d/src/wire.mjs'],{encoding:'utf8'}).replace(/from '(\.\/[^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL('../extensions/workbench-dice3d/src/'+path,import.meta.url).href));
const baseline=await import('data:text/javascript;base64,'+Buffer.from(baselineSource).toString('base64'));
let seed=270,cases=0,wordsChecked=0;
const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
for(const count of [1,8,19,20,100])for(const frames of [2,3,99]){
 const backing=new Uint32Array(count*7*frames+8),words=backing.subarray(4,backing.length-4);
 const boundary=[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x3f800000,0xbf800000,0x447a0000,0xc47a0000];
 for(let i=0;i<words.length;i++)words[i]=i<boundary.length?boundary[i]:((next()&0x807fffff)|((next()%135)<<23))>>>0;
 const poses=new Float32Array(words.buffer,words.byteOffset,words.length),original=words.slice();
 const meta={version:2,fps:120,frames,kinds:Array(count).fill('d6'),results:Array(count).fill(3),duration:(frames-1)/120,collisions:1,request:{id:'delta270',source:'synthetic',name:'Synthetic',theme:'ink_sketch',count,modifier:0}};
 const contacts=[{t:0,kind:0,a:1,b:0,seq:1,x:.125,y:-0,z:-.25,speed:1.5,impulse:.125}];
 const encoded=await encodeRoll(meta,poses,contacts,'delta2-shuffle-v1');
 const parts=split(encoded,FAST_CHUNK_BYTES),assembly=new Assembly(parts.length,encoded.length,await hash(encoded),FAST_CHUNK_BYTES);
 for(let i=parts.length-1;i>=0;i--){assembly.add(i,parts[i]);assembly.add(i,parts[i]);}
 const decoded=await decodeRoll(await assembly.finish());
 assert.deepEqual(new Uint32Array(decoded.poses.buffer),original,'all bits including sign, denormals, wraparound');
 assert.deepEqual(decoded.contacts,contacts);assert.deepEqual(words,original,'source view is never mutated');
 assert.equal(decoded.posePacking,undefined);assert.equal(meta.posePacking,undefined);
 assert.deepEqual(decoded.request,meta.request);
 for(const oldPacking of [false,true]){
  const oldBytes=await encodeRoll(meta,poses,contacts,oldPacking);
  assert.deepEqual(oldBytes,await baseline.encodeRoll(meta,poses,contacts,oldPacking),'269 XOR and legacy wire bytes stay exact');
  const old=await decodeRoll(oldBytes);
  assert.deepEqual(new Uint32Array(old.poses.buffer),original,'legacy and 269 XOR formats remain readable');
 }
 cases++;wordsChecked+=words.length;
}
const meta={version:2,fps:120,frames:2,kinds:['d6'],results:[3],duration:1/120,collisions:0,request:{id:'bad',source:'synthetic',name:'Synthetic',theme:'ink_sketch',count:1,modifier:0}};
await assert.rejects(encodeRoll(meta,new Float32Array(13),[],'delta2-shuffle-v1'),/Pose count mismatch/);
await assert.rejects(encodeRoll(meta,new Float32Array(14),[],'delta3'),/Invalid pose packing/);
console.log(JSON.stringify({passed:true,cases,wordsChecked,malformedCases:2,realRoom:false}));
