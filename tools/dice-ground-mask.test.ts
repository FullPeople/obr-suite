import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
// @ts-expect-error Exists only after the tools-only transform.
import {DiceRenderRegion,DiceGroundMaskRenderRegion} from '../extensions/workbench-dice3d/src/render-region';
import {DiceGroundMask,GROUND_MASK_CAPACITY,groundMaskShader,isGroundMaskObjectSafe} from './dice-ground-mask-runtime';
import {transformGroundMaskRegion,transformGroundMaskRenderer} from './dice-ground-mask-transform.mjs';
let checks=0;
const check=(name:string,fn:()=>void)=>{fn();console.log('PASS '+name);checks++;};
function fixture(mode:'baseline'|'candidate'='candidate',capacity=1024){
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-5,5,4,-4,.1,150);camera.position.set(0,44,-8);camera.lookAt(0,0,0);
 const space=new T.Group();space.scale.x=-1;scene.add(space);
 const hemi=new T.HemisphereLight(),light=new T.DirectionalLight(),rim=new T.DirectionalLight();scene.add(hemi,light,rim);
 light.position.set(-2.4,9,4.2);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.5,far:40});light.shadow.bias=-.0003;light.shadow.normalBias=.02;
 const ground=new T.Mesh(new T.PlaneGeometry(38,22),new T.ShadowMaterial({opacity:.32}));ground.rotation.x=-Math.PI/2;ground.position.y=-.015;ground.receiveShadow=true;scene.add(ground);
 const original=new DiceRenderRegion(scene,camera,light,ground),region=new DiceGroundMaskRenderRegion(scene,camera,light,ground),view={width:1280,height:800,pixelsPerDie:120,pixelRatio:1};
 const gl={MAX_FRAGMENT_UNIFORM_VECTORS:36349,getParameter:()=>capacity};
 const renderer={getContext:()=>gl,getRenderTarget:()=>null,toneMapping:T.ACESFilmicToneMapping,outputColorSpace:T.SRGBColorSpace,toneMappingExposure:1,localClippingEnabled:false,clippingPlanes:[],capabilities:{maxFragmentUniforms:capacity,logarithmicDepthBuffer:false,reversedDepthBuffer:false},shadowMap:{enabled:true,type:T.PCFShadowMap,autoUpdate:true},getViewport:(v:T.Vector4)=>v.set(0,0,view.width,view.height),getPixelRatio:()=>view.pixelRatio,domElement:{width:view.width,height:view.height}};
 const mask=new DiceGroundMask(renderer as any,scene,camera,light,ground,region,mode);
 light.shadow.camera.updateProjectionMatrix();
 const add=()=>{const body=new T.Mesh(new T.BoxGeometry(),new T.MeshPhysicalMaterial());body.castShadow=true;space.add(body);original.register(body);region.register(body);return body;};
 const update=()=>{const a=original.get(view),b=region.get(view);mask.update(view,b);return{a,b};};
 return{scene,camera,space,hemi,light,rim,ground,original,region,view,renderer,mask,add,update};
}
check('source transform leaves original region bytes unchanged and existing render/barrier counts unchanged',()=>{
 const region=readFileSync('extensions/workbench-dice3d/src/render-region.ts','utf8'),renderer=readFileSync('extensions/workbench-dice3d/src/renderer.ts','utf8');
 assert(transformGroundMaskRegion(region).startsWith(region));const transformed=transformGroundMaskRenderer(renderer);
 for(const marker of ['this.gl.render(this.scene,this.camera);','this.gl.getContext().finish();','await this.gl.compileAsync(this.scene,this.camera);'])assert.equal(transformed.split(marker).length,renderer.split(marker).length);
 assert(transformed.indexOf('new DiceGroundMask(this.gl')<transformed.indexOf('await this.gl.compileAsync'));
 assert.throws(()=>transformGroundMaskRenderer(renderer.replace('this.renderRegion=new DiceRenderRegion','this.renderRegion = new DiceRenderRegion')),/boundary changed/);
});
check('true baseline material and candidate before warmup; low uniform capacity uses original',()=>{
 const a=fixture('baseline'),b=fixture(),c=fixture('candidate',128);
 assert.equal(a.mask.maskedMaterial,null);assert.equal(a.ground.material,a.mask.originalMaterial);assert.equal(a.mask.originalMaterial.onBeforeCompile,T.Material.prototype.onBeforeCompile);
 assert(b.mask.maskedMaterial);assert.equal(b.ground.material,b.mask.maskedMaterial);assert.equal(b.mask.originalMaterial.onBeforeCompile,T.Material.prototype.onBeforeCompile);assert.equal(c.mask.maskedMaterial,null);
});
check('shader interior exact, no discard, early return after original logdepth chunk',()=>{
 const base=T.ShaderLib.shadow.fragmentShader,shader=groundMaskShader(base),main='\tgl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );';
 assert(shader.includes(main));assert(!/\bdiscard\s*;/.test(shader));assert(shader.indexOf('#include <logdepthbuf_fragment>')<shader.indexOf('gl_FragColor=vec4(0.0); return;'));
 assert(shader.endsWith(base.slice(base.indexOf(main))));assert.throws(()=>groundMaskShader(base+'\n'),/Unknown/);
});
check('per-body union equals exact original region across poses, presence, parent transforms, view and light changes',()=>{
 const f=fixture(),bodies=Array.from({length:20},()=>f.add());
 for(let i=0;i<120;i++){
  bodies.forEach((b,j)=>{b.position.set(Math.sin(i*.2+j)*4,.2+(j%5)*.6,Math.cos(i*.3+j)*2);b.rotation.set(i*.1,j*.4,i*j*.02);b.visible=(i+j)%7!==0;b.castShadow=(i+j)%3!==0;});
  f.space.rotation.y=i*.013;f.camera.zoom=1+i%7*.04;f.camera.updateProjectionMatrix();f.light.position.x=-2.4+Math.sin(i*.1);f.light.shadow.radius=1+i%4*.3;
  const {a,b}=f.update();assert.deepEqual(b,a);assert(f.mask.snapshot().valid);
  const rects=f.region.groundMaskRectangles;if(rects.length){const x=Math.min(...rects.map((v:any)=>v.x)),y=Math.min(...rects.map((v:any)=>v.y)),r=Math.max(...rects.map((v:any)=>v.x+v.width)),t=Math.max(...rects.map((v:any)=>v.y+v.height));assert.deepEqual(b,{x,y,width:r-x,height:t-y});}
 }
});
check('valid reset at every early return; unknown caster/light/child/material changes recover without stale rectangles',()=>{
 const mutations=[(f:any)=>f.view.pixelRatio=NaN,(f:any)=>f.ground.castShadow=true,(f:any)=>f.scene.background=new T.Color(),(f:any)=>f.light.position.set(1,0,0),(f:any)=>f.light.shadow.mapSize.x=0,(f:any)=>f.add().geometry.getAttribute('position').needsUpdate=true,(f:any)=>f.add().add(new T.Mesh()),(f:any)=>f.scene.add(new T.DirectionalLight())];
 for(const mutate of mutations){const f=fixture();f.add();f.update();assert(f.mask.snapshot().valid);mutate(f);f.update();assert(!f.mask.snapshot().valid);assert.equal(f.mask.snapshot().rectangleCount,0);}
 const f=fixture(),body=f.add();f.update();const extra=new T.Mesh();body.add(extra);f.update();assert(!f.region.groundMaskValid);assert.deepEqual(f.region.groundMaskRectangles,[]);extra.removeFromParent();f.update();assert(f.mask.snapshot().valid);
});
check('capacity overflow never truncates; empty scene and offscreen frames are conservative',()=>{
 const f=fixture();f.update();assert(f.mask.snapshot().valid);assert.equal(f.mask.snapshot().rectangleCount,0);
 for(let i=0;i<GROUND_MASK_CAPACITY+1;i++)f.add().position.x=i*.1;
 f.update();assert.equal(f.region.groundMaskRectangles.length,65);assert.equal(f.mask.snapshot().reason,'rectangle-capacity');assert(!f.mask.snapshot().valid);
});
check('DPR physical rectangles round outward; resize recomputes at current frame',()=>{
 const f=fixture();f.add();for(const ratio of [.75,1,1.25,1.5,2]){f.view.pixelRatio=ratio;f.renderer.domElement.width=Math.floor(f.view.width*ratio);f.renderer.domElement.height=Math.floor(f.view.height*ratio);f.update();assert(f.mask.snapshot().valid);const r=f.mask.snapshot().rects[0],p=f.mask.snapshot().physicalRects[0];assert(p[0]<=r.x*ratio&&p[1]<=r.y*ratio&&p[2]>=(r.x+r.width)*ratio&&p[3]>=(r.y+r.height)*ratio);}
});
check('unknown rendering settings select original material and disable mask without modifying requested state',()=>{
 const changes=[(f:any)=>f.renderer.shadowMap.autoUpdate=false,(f:any)=>f.light.shadow.autoUpdate=false,(f:any)=>f.light.shadow.intensity=NaN,(f:any)=>f.light.shadow.mapSize.y=1024,(f:any)=>f.light.shadow.camera.projectionMatrix.elements[0]*=2,(f:any)=>f.light.shadow.camera.setViewOffset(1024,1024,0,0,512,512),(f:any)=>f.renderer.outputColorSpace=T.LinearSRGBColorSpace,(f:any)=>f.ground.position.y+=.1,(f:any)=>f.ground.layers.set(1),(f:any)=>f.scene.onBeforeRender=()=>{},(f:any)=>f.renderer.getRenderTarget=()=>({})];
 for(const change of changes){const f=fixture();f.add();f.update();assert(f.mask.snapshot().valid);change(f);f.update();assert(!f.mask.snapshot().valid);assert.equal(f.ground.material,f.mask.originalMaterial);}
 const f=fixture();f.add();f.update();f.mask.maskedMaterial!.depthWrite=false;f.update();assert.equal(f.ground.material,f.mask.originalMaterial);assert.equal(f.mask.originalMaterial.depthWrite,false);
});
check('all-caster mutation guards, unknown callbacks, and real original-material bypass',()=>{
 const f=fixture(),b=f.add();f.update();assert(isGroundMaskObjectSafe(f.ground,f.ground,f.light));
 const child=new T.Mesh(new T.BoxGeometry(),new T.MeshPhysicalMaterial());child.castShadow=true;b.add(child);assert(!isGroundMaskObjectSafe(child,f.ground,f.light));child.removeFromParent();
 b.onBeforeShadow=()=>{};f.update();assert(!f.mask.snapshot().valid);b.onBeforeShadow=T.Object3D.prototype.onBeforeShadow;
 (b.material as T.Material).onBeforeRender=()=>{};f.update();assert(!f.mask.snapshot().valid);(b.material as T.Material).onBeforeRender=T.Material.prototype.onBeforeRender;
 f.update();f.mask.maskedMaterial!.opacity=.17;f.mask.setOriginalMaterial(true);assert.equal(f.mask.originalMaterial.opacity,.17);f.update();assert(f.mask.snapshot().originalMaterial);assert(!f.mask.snapshot().valid);
 f.mask.setOriginalMaterial(false);f.update();assert(f.mask.snapshot().valid);f.mask.setEnabled(false);f.update();assert(!f.mask.snapshot().valid);assert(!f.mask.snapshot().originalMaterial);f.mask.setEnabled(true);f.update();assert(f.mask.snapshot().valid);
});
check('fallback preserves callbacks, external material identity and advances program version',()=>{
 const f=fixture();f.add();f.update();const version=f.mask.originalMaterial.version,hook=()=>{};
 f.mask.maskedMaterial!.onBeforeCompile=hook;f.mask.maskedMaterial!.needsUpdate=true;f.update();
 assert.equal(f.mask.originalMaterial.onBeforeCompile,hook);assert(f.mask.originalMaterial.version>version);assert.equal(f.ground.material,f.mask.originalMaterial);
 const external=new T.MeshBasicMaterial({color:'red'});f.ground.material=external as any;f.update();assert.equal(f.ground.material,external);f.mask.setOriginalMaterial(true);assert.equal(f.ground.material,external);f.mask.setOriginalMaterial(false);assert.equal(f.ground.material,external);
});
check('native allocated PCF depth texture stays eligible, changed filtering and methods fall back',()=>{
 const f=fixture();f.add();const map=new T.WebGLRenderTarget(2048,2048);map.depthTexture=new T.DepthTexture(2048,2048,T.UnsignedIntType);map.depthTexture.compareFunction=T.LessEqualCompare;map.depthTexture.minFilter=T.LinearFilter;map.depthTexture.magFilter=T.LinearFilter;f.light.shadow.map=map;f.update();assert(f.mask.snapshot().valid);
 map.depthTexture.wrapS=T.RepeatWrapping;f.update();assert(!f.mask.snapshot().valid);map.depthTexture.wrapS=T.ClampToEdgeWrapping;f.update();assert(f.mask.snapshot().valid);
 f.light.shadow.updateMatrices=()=>{};f.update();assert(!f.mask.snapshot().valid);
});
check('unknown receiver deformation and stale shadow camera world matrices use original fallback',()=>{
 for(const mutate of [(f:any)=>f.ground.geometry.morphAttributes.position=[f.ground.geometry.getAttribute('position')],(f:any)=>f.ground.isInstancedMesh=true,(f:any)=>f.ground.isSkinnedMesh=true,(f:any)=>f.ground.isBatchedMesh=true,(f:any)=>f.light.shadow.camera.matrixWorldAutoUpdate=false]){
  const f=fixture();f.add();f.update();assert(f.mask.snapshot().valid);mutate(f);f.update();assert(!f.mask.snapshot().valid);assert.equal(f.ground.material,f.mask.originalMaterial);
 }
});
check('context restoration preserves warmed candidate or irreversibly retires an unwarmed fallback candidate',()=>{
 const normal=fixture();normal.add();normal.update();normal.mask.prepareContextRestore();assert(!normal.mask.snapshot().retired);assert(!normal.mask.snapshot().valid);normal.update();assert(normal.mask.snapshot().valid);
 const fallback=fixture();fallback.add();fallback.update();fallback.renderer.shadowMap.autoUpdate=false;fallback.update();assert.equal(fallback.mask.snapshot().fallbackKind,'original-material');fallback.mask.prepareContextRestore();assert(fallback.mask.snapshot().retired);
 fallback.renderer.shadowMap.autoUpdate=true;fallback.mask.setEnabled(true);fallback.mask.setOriginalMaterial(false);fallback.update();assert(!fallback.mask.snapshot().valid);assert.equal(fallback.mask.snapshot().rectangleCount,0);assert.equal(fallback.ground.material,fallback.mask.originalMaterial);
});
console.log(JSON.stringify({checks,passed:checks,GPU:false,strictRGBA:'Not established; centralized real-WebGL sequence required'}));
