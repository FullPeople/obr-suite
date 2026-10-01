type Layer={canvas:HTMLCanvasElement;context:CanvasRenderingContext2D;refs:number};
const layers=new WeakMap<HTMLElement,Map<string,Layer>>();
/** Group rolls share two compositing surfaces instead of allocating two full
 * viewport canvases per target. Logical cues keep their independent state. */
export function acquireOverlayCanvas(container:HTMLElement,kind:string){
 let map=layers.get(container);if(!map){map=new Map();layers.set(container,map);}let layer=map.get(kind);
 if(!layer){const canvas=document.createElement('canvas');canvas.className=kind;container.append(canvas);layer={canvas,context:canvas.getContext('2d')!,refs:0};map.set(kind,layer);}layer.refs++;
 let released=false;return {...layer,release:()=>{if(released)return;released=true;if(!layer||--layer.refs>0)return;layer.canvas.remove();map!.delete(kind);}};
}
export function beginOverlayFrame(container:HTMLElement){for(const layer of layers.get(container)?.values()||[]){layer.context.setTransform(1,0,0,1,0,0);layer.context.clearRect(0,0,layer.canvas.width,layer.canvas.height);}}
