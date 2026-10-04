import * as T from 'three';

const outlines=new WeakMap<T.BufferGeometry,{edges:T.EdgesGeometry;sketch?:T.BufferGeometry}>();
/** Model geometry is immutable after loading. Reuse its exact outline vertices across
 * dice/materials; each die still owns its shader uniforms. Release with the source. */
export function outlineGeometry(source:T.BufferGeometry,sketch=false):T.BufferGeometry{
  let cached=outlines.get(source);
  if(!cached){
    cached={edges:new T.EdgesGeometry(source,24)};outlines.set(source,cached);
    const dispose=()=>{cached!.edges.dispose();cached!.sketch?.dispose();outlines.delete(source);source.removeEventListener('dispose',dispose);};
    source.addEventListener('dispose',dispose);
  }
  if(!sketch)return cached.edges;
  if(!cached.sketch){
    const array=cached.edges.getAttribute('position'),points:number[]=[];
    for(let i=0;i<array.count;i+=2)for(let k=0;k<6;k++)for(const t of [k/6,(k+1)/6])for(let axis=0;axis<3;axis++)points.push(array.getComponent(i,axis)*(1-t)+array.getComponent(i+1,axis)*t);
    cached.sketch=new T.BufferGeometry();cached.sketch.setAttribute('position',new T.Float32BufferAttribute(points,3));
  }
  return cached.sketch;
}
