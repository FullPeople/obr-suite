type Layer={canvas:HTMLCanvasElement;context:CanvasRenderingContext2D;refs:number;dirty:boolean;invalidate:()=>void};
const layers=new WeakMap<HTMLElement,Map<string,Layer>>();
/** Group rolls share two compositing surfaces instead of allocating two full
 * viewport canvases per target. Logical cues keep their independent state. */
export function acquireOverlayCanvas(container:HTMLElement,kind:string){
 let map=layers.get(container);if(!map){map=new Map();layers.set(container,map);}let layer=map.get(kind);
 if(!layer){const canvas=document.createElement('canvas');canvas.className=kind;container.append(canvas);
  layer={canvas,context:canvas.getContext('2d')!,refs:0,dirty:false,invalidate:()=>{layer!.dirty=true;}};
  canvas.addEventListener('contextlost',layer.invalidate);canvas.addEventListener('contextrestored',layer.invalidate);map.set(kind,layer);
 }layer.refs++;
 // Dirtiness belongs to the shared surface, not any roll's lifetime. Mark before
 // possible painting so partial output from a thrown draw is cleared next frame.
 let released=false;return {canvas:layer.canvas,context:layer.context,markDirty:layer.invalidate,release:()=>{if(released)return;released=true;if(!layer||--layer.refs>0)return;
  layer.canvas.removeEventListener('contextlost',layer.invalidate);layer.canvas.removeEventListener('contextrestored',layer.invalidate);layer.canvas.remove();map!.delete(kind);
 }};
}
export function beginOverlayFrame(container:HTMLElement){for(const layer of layers.get(container)?.values()||[]){if(!layer.dirty)continue;
 layer.context.setTransform(1,0,0,1,0,0);layer.context.clearRect(0,0,layer.canvas.width,layer.canvas.height);
 // Leave dirty set if either operation throws, so the next frame can retry.
 layer.dirty=false;
}}
