import { assetUrl } from '../../asset-base';

export interface TokenImage { url: string; w: number; h: number; mime: string; fallback: boolean }
const loaded = new Map<string, TokenImage>();
const pending = new Map<string, Promise<TokenImage>>();
export function tokenMime(url: string): string {
  const data = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(url);
  if (data) return data[1].toLowerCase();
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1].toLowerCase();
  return ({svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',avif:'image/avif',webp:'image/webp'} as Record<string,string>)[extension || ''] || 'image/webp';
}
function probe(url: string): Promise<{w:number;h:number}|null> {
  return new Promise(resolve => {
    const image = new Image();
    const finish = (value:{w:number;h:number}|null) => { clearTimeout(timer); image.onload=null; image.onerror=null; image.removeAttribute('src'); resolve(value); };
    const timer = setTimeout(()=>finish(null), 6500);
    image.onload=()=>finish(image.naturalWidth>0 && image.naturalHeight>0 ? {w:image.naturalWidth,h:image.naturalHeight}:null);
    image.onerror=()=>finish(null);
    image.src=url;
  });
}
/** Failed requests never poison the cache; the next placement can recover without reloading the panel. */
export async function resolveTokenImage(input:string):Promise<TokenImage> {
  const url=input.trim();
  if(loaded.has(url))return loaded.get(url)!;
  if(pending.has(url))return pending.get(url)!;
  const request=(async()=>{
    if(url){
      for(let attempt=0;attempt<2;attempt++){
        const size=await probe(url);
        if(size){const result={url,...size,mime:tokenMime(url),fallback:false};loaded.set(url,result);if(loaded.size>256)loaded.delete(loaded.keys().next().value!);return result;}
        if(attempt===0)await new Promise(resolve=>setTimeout(resolve,180));
      }
    }
    return {url:new URL(assetUrl('monster-placeholder.svg'),location.href).href,w:280,h:280,mime:'image/svg+xml',fallback:true};
  })().finally(()=>{if(pending.get(url)===request)pending.delete(url);});
  pending.set(url,request);return request;
}
