import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareRGBA,diffRGBA} from './dice-canvas-visual-pixels.mjs';
test('zero tolerance catches one LSB and transparent RGB; alpha does not mask RGB',()=>{
 const a=new Uint8Array([0,0,0,0,20,30,40,255]),b=new Uint8Array([1,0,0,0,20,30,40,254]);
 assert.deepEqual(compareRGBA(a,b),{equal:false,differentChannels:2,differentPixels:2,maxDelta:1,alphaPixelsA:1,alphaPixelsB:1});
 assert.deepEqual([...diffRGBA(a,b)],[255,0,255,255,255,0,255,255]);
});
test('absent transparent surface normalizes to zero and nonmatching sizes fail closed',()=>{
 const a=new Uint8Array(12);assert(compareRGBA(a,new Uint8Array(12)).equal);assert.deepEqual([...diffRGBA(a,a)],[...a]);
 assert.throws(()=>compareRGBA(a,new Uint8Array(8)),/extent/);assert.throws(()=>compareRGBA(new Uint8Array(3),new Uint8Array(3)),/extent/);
});
