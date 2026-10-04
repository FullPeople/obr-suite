/** Exact comparison, including RGB in fully transparent pixels. No tolerance or masks. */
export function compareRGBA(a,b){
 if(a.length!==b.length||a.length%4)throw Error('RGBA extent mismatch');
 let differentChannels=0,differentPixels=0,maxDelta=0,alphaPixelsA=0,alphaPixelsB=0;
 for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){differentChannels++;changed=true;maxDelta=Math.max(maxDelta,delta);}}differentPixels+=Number(changed);alphaPixelsA+=Number(a[i+3]>0);alphaPixelsB+=Number(b[i+3]>0);}
 return{equal:differentChannels===0,differentChannels,differentPixels,maxDelta,alphaPixelsA,alphaPixelsB};
}
export function diffRGBA(a,b){
 if(a.length!==b.length||a.length%4)throw Error('RGBA extent mismatch');
 const output=new Uint8ClampedArray(a.length);
 for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3]){output[i]=255;output[i+2]=255;output[i+3]=255;}
 return output;
}
