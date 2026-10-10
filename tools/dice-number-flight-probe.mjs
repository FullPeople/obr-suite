import assert from 'node:assert/strict';

// Observe the real canvas text calls and pixels. Never manufacture product cues.
export function installNumberFlightProbe(pixels){
 const samples=[];globalThis.__diceNumberFlights=samples;
 const original=CanvasRenderingContext2D.prototype.strokeText;
 CanvasRenderingContext2D.prototype.strokeText=function(text,x,y,...args){
  const result=original.call(this,text,x,y,...args);
  if(this.canvas.classList.contains('cue-canvas')&&/\b46px\b/.test(this.font)&&/^[+−-]?\d+$/.test(String(text))&&samples.length<20000){
   const transform=this.getTransform(),point=new DOMPoint(x,y).matrixTransform(transform);
   const at=performance.timeOrigin+performance.now(),row={at,text:String(text),x:point.x,y:point.y,alpha:this.globalAlpha};
   if(pixels&&samples.filter(s=>s.opaquePixels>0&&s.at>at-1000).length<3){
    const left=Math.max(0,Math.floor(point.x-40)),top=Math.max(0,Math.floor(point.y-40));
    const width=Math.min(80,this.canvas.width-left),height=Math.min(80,this.canvas.height-top);
    if(width>0&&height>0){const data=this.getImageData(left,top,width,height).data;let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i]>20)opaque++;row.opaquePixels=opaque;}
   }
   samples.push(row);
  }
  return result;
 };
}

export function validateNumberFlights(samples,{required=true,pixels=false}={}){
 if(required)assert(samples.length>5,'actual flying numeric glyphs must be drawn');
 assert(samples.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.y)&&s.alpha>0),'finite visible text coordinates');
 if(required){assert(new Set(samples.map(s=>Math.round(s.x)+':'+Math.round(s.y))).size>5,'numeric glyphs must move across actual frames');if(pixels)assert(samples.some(s=>s.opaquePixels>0),'canvas pixels at a real numeric glyph');}
 return{drawn:samples.length,firstAt:samples[0]?.at,movingPositions:new Set(samples.map(s=>Math.round(s.x)+':'+Math.round(s.y))).size,visiblePixelSamples:samples.filter(s=>s.opaquePixels>0).length};
}
