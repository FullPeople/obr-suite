import * as THREE from 'three';
import inventory from '../art/currency/inventory.json';
const sources={gold:new URL('../art/currency/dragon-gold.webp',import.meta.url).href,silver:new URL('../art/currency/shard-silver.webp',import.meta.url).href};
/** Extruded outlines and photographed faces from the user's coin reference. */
export function currencyGeometry(kind:'gold'|'silver') {
 const source=inventory.coins[kind==='gold'?0:1], [left,top,right,bottom]=source.crop;
 const width=right-left,height=bottom-top,size=kind==='gold'?.43:.35;
 const shape=new THREE.Shape();source.outline.forEach(([x,y],i)=>{const px=((x-left)/width-.5)*size,py=(.5-(y-top)/height)*size*height/width;i?shape.lineTo(px,py):shape.moveTo(px,py);});shape.closePath();
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:.038,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.002,bevelThickness:.002,curveSegments:1});
 const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
 for(let i=0;i<positions.count;i++)uv.setXY(i,positions.getX(i)/size+.5,positions.getY(i)/(size*height/width)+.5);
 geometry.rotateX(-Math.PI/2);return geometry;
}
export function currencyTexture(kind:'gold'|'silver',loaded:()=>void) {
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const context=canvas.getContext('2d')!;
 context.fillStyle=kind==='gold'?'#b39345':'#9eabb3';context.fillRect(0,0,256,256);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const image=new Image();let dead=false;const cleanup=()=>{dead=true;image.onload=null;image.onerror=null;image.removeAttribute('src');texture.removeEventListener('dispose',cleanup);};texture.addEventListener('dispose',cleanup);
 image.onload=()=>{if(dead)return;context.clearRect(0,0,256,256);context.drawImage(image,0,0,256,256);texture.needsUpdate=true;image.onload=null;image.onerror=null;loaded();};image.onerror=()=>{image.onload=null;image.onerror=null;};image.src=sources[kind];return texture;
}
