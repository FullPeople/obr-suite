import * as T from 'three';
/** Glyph shaders sample only red. Preserve every 2048px sample and the original
 * filtering while avoiding three unused channels in CPU/GPU residency. */
export function glyphTexture(canvas:HTMLCanvasElement|OffscreenCanvas):T.DataTexture{
 const {width,height}=canvas,ctx=canvas.getContext('2d') as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null;
 if(!ctx)throw Error('不能读取骰子字形图集');
 const rgba=ctx.getImageData(0,0,width,height).data,red=new Uint8Array(width*height);
 for(let i=0;i<red.length;i++)red[i]=rgba[i*4];
 const texture=new T.DataTexture(red,width,height,T.RedFormat,T.UnsignedByteType);
 texture.flipY=false;texture.generateMipmaps=true;texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.needsUpdate=true;
 texture.userData={glyphBytes:red.byteLength};return texture;
}
let decoding:Promise<unknown>=Promise.resolve();
/** Decode one atlas at a time; downloaded immutable assets can still overlap. */
export function decodeGlyphTexture(bytes:ArrayBuffer):Promise<T.DataTexture>{
 const task=decoding.then(async()=>{
  const bitmap=await createImageBitmap(new Blob([bytes])),canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
  try{const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('不能解码骰子字形图集');ctx.drawImage(bitmap,0,0);return glyphTexture(canvas);}
  finally{bitmap.close();canvas.width=canvas.height=1;}
 });decoding=task.catch(()=>{});return task;
}
