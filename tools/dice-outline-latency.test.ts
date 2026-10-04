import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {addSketchOutline,disposeDiceDecorations} from '../extensions/workbench-dice3d/src/dice-materials';
import {addDynamicOutline} from '../extensions/workbench-dice3d/src/dynamic-decorations';
const catalog=JSON.parse(readFileSync('extensions/workbench-dice3d/public/assets/catalog.json','utf8'));
let checks=0;
for(const [kind,asset] of Object.entries(catalog.dice) as [string,{model:string}][]){
  const bytes=readFileSync('extensions/workbench-dice3d/public/'+asset.model);
  const model=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const source=(model.scene.getObjectByName('RenderMesh') as T.Mesh).geometry.clone();source.scale(40,40,40);
  const expectedEdges=new T.EdgesGeometry(source,24),array=expectedEdges.getAttribute('position'),points:number[]=[];
  for(let i=0;i<array.count;i+=2)for(let k=0;k<6;k++)for(const t of [k/6,(k+1)/6])for(let axis=0;axis<3;axis++)points.push(array.getComponent(i,axis)*(1-t)+array.getComponent(i+1,axis)*t);
  const shared=new Map<string,T.BufferGeometry>();
  for(const style of ['sketch','comic','ink-flow','runic'] as const){
    const create=()=>{const material=new T.MeshPhysicalMaterial();material.userData.time={value:0};const mesh=new T.Mesh(source,material);if(style==='sketch')addSketchOutline(mesh,source);else addDynamicOutline(mesh,source,style);return mesh;};
    const first=create(),second=create(),a=first.children.at(-1) as T.LineSegments,b=second.children.at(-1) as T.LineSegments;
    assert.deepEqual(a.geometry.getAttribute('position').array,style==='sketch'?new Float32Array(points):array.array,kind+' '+style+' exact vertices');
    assert.equal(a.geometry,b.geometry,kind+' '+style+' must reuse immutable outline geometry');
    assert.notEqual(a.material,b.material,'material and animated time remain per die');
    assert.notEqual((a.material as T.ShaderMaterial).uniforms.time,(b.material as T.ShaderMaterial).uniforms.time);
    shared.set(style==='sketch'?'sketch':'edges',a.geometry);
    let disposed=0;a.geometry.addEventListener('dispose',()=>disposed++);
    disposeDiceDecorations(first);assert.equal(disposed,0,'removing one die keeps siblings/replay valid');
    const third=create();assert.equal((third.children.at(-1) as T.LineSegments).geometry,a.geometry);
    disposeDiceDecorations(second);disposeDiceDecorations(third);assert.equal(disposed,0,'outline retained for warm rolls');
    for(const mesh of [first,second,third])mesh.material.dispose();checks++;
  }
  const counts=new Map<T.BufferGeometry,number>();for(const geo of shared.values()){counts.set(geo,0);geo.addEventListener('dispose',()=>counts.set(geo,counts.get(geo)!+1));}
  source.dispose();for(const count of counts.values())assert.equal(count,1,'source disposal releases cached GPU geometries once');
  expectedEdges.dispose();checks++;
}
console.log(JSON.stringify({checks,passed:checks,exactModelVertices:true,realGPU:false}));
