/** Test-only 64-rectangle ground fragment rejection. No render, target, texture or barrier. */
import * as T from 'three';
import type {RenderRegion} from '../extensions/workbench-dice3d/src/render-region';
export const GROUND_MASK_CAPACITY=64;
export const GROUND_MASK_UNIFORM_RESERVE=128;
type View={width:number;height:number;pixelsPerDie:number;pixelRatio:number};
type Collector={groundMaskValid?:boolean;groundMaskRectangles?:RenderRegion[];groundMaskLights?:T.Light[]};
const finite=(...v:number[])=>v.every(Number.isFinite);
const trustedGroundCallbacks=new WeakSet<Function>();
const unitScale=new T.Vector3(1,1,1),unitUp=new T.Vector3(0,1,0),unitExtents=new T.Vector2(1,1),unitViewport=new T.Vector4(0,0,1,1);
const stockShadowUpdateMatrices=new T.DirectionalLight().shadow.updateMatrices;
const unallocatedShadowProjection=new T.OrthographicCamera(-5,5,5,-5,.5,500).projectionMatrix;
const stockCallback=(object:T.Object3D,name:'onBeforeRender'|'onAfterRender'|'onBeforeShadow'|'onAfterShadow')=>object[name]===T.Object3D.prototype[name];
/** Extra checks share the already-required region traversal; no extra bounds pass. */
export function isGroundMaskObjectSafe(object:T.Object3D,ground:T.Mesh,light:T.DirectionalLight){
 if((!stockCallback(object,'onBeforeRender')&&!(object===ground&&trustedGroundCallbacks.has(object.onBeforeRender)))||!stockCallback(object,'onAfterRender')||!stockCallback(object,'onBeforeShadow')||!stockCallback(object,'onAfterShadow'))return false;
 for(const material of ((object as T.Mesh).material?Array.isArray((object as T.Mesh).material)?(object as T.Mesh).material as T.Material[]:[(object as T.Mesh).material as T.Material]:[]))if(material.onBeforeRender!==T.Material.prototype.onBeforeRender)return false;
 if(object===ground)return true;
 if((object as T.Light).isLight)return object===light||!object.castShadow;
 if(!object.castShadow)return true;
 const mesh=object as T.Mesh;
 if(!mesh.isMesh||(mesh as any).isSkinnedMesh||(mesh as any).isInstancedMesh||(mesh as any).isBatchedMesh||(mesh.parent as T.Mesh)?.isMesh)return false;
 if(mesh.customDepthMaterial||mesh.customDistanceMaterial||Object.values(mesh.geometry.morphAttributes).some(v=>v?.length))return false;
 for(const mat of (Array.isArray(mesh.material)?mesh.material:[mesh.material])){
  const m=mat as T.MeshStandardMaterial;
  if(m.displacementMap||m.wireframe||!Number.isFinite(m.opacity))return false;
 }
 return true;
}
export function groundMaskShader(fragment:string){
 const marker='\tgl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );';
 if(fragment!==T.ShaderLib.shadow.fragmentShader||fragment.split(marker).length!==2)throw Error('Unknown Three ShadowMaterial shader; ground mask rejected');
 return `uniform bool diceGroundMaskValid;
uniform int diceGroundMaskCount;
uniform vec4 diceGroundMaskRects[${GROUND_MASK_CAPACITY}];
bool diceGroundMaskContains(vec2 pixel) {
 for (int i=0;i<${GROUND_MASK_CAPACITY};i++) {
  if (i>=diceGroundMaskCount) break;
  vec4 rect=diceGroundMaskRects[i];
  if (all(greaterThanEqual(pixel,rect.xy)) && all(lessThanEqual(pixel,rect.zw))) return true;
 }
 return false;
}
`+fragment.replace(marker,`\t// Preserve log-depth and ordinary depth writes. Never discard.
\tif (diceGroundMaskValid && !diceGroundMaskContains(gl_FragCoord.xy)) { gl_FragColor=vec4(0.0); return; }
${marker}`);
}
export class DiceGroundMask {
 readonly originalMaterial:T.ShadowMaterial;
 readonly maskedMaterial:T.ShadowMaterial|null;
 readonly uniforms={diceGroundMaskValid:{value:false},diceGroundMaskCount:{value:0},diceGroundMaskRects:{value:Array.from({length:GROUND_MASK_CAPACITY},()=>new T.Vector4())}};
 private retired=false;
 private enabled=true;private originalBypass=false;private reason='not-updated';
 private readonly groundMatrix:T.Matrix4;private readonly geometry:T.BufferGeometry;private readonly groundPosition:T.BufferAttribute|T.InterleavedBufferAttribute;private readonly positionVersion:number;
 private readonly lights:T.Light[]=[];private readonly viewport=new T.Vector4();private readonly expectedProjection=new T.Matrix4();
 private readonly originalOnBeforeRender:T.Object3D['onBeforeRender'];
 private readonly materialSettings:Record<string,unknown>={};
 private maskedCompileHook:T.Material['onBeforeCompile']|undefined;private maskedProgramKey:(()=>string)|undefined;
 private compileCount=0;private shaderDrawCount=0;private eligible=false;private logicalRectangles:RenderRegion[]=[];
 constructor(private renderer:T.WebGLRenderer,private scene:T.Scene,private camera:T.OrthographicCamera,private light:T.DirectionalLight,private ground:T.Mesh,private collector:Collector,readonly mode:'baseline'|'candidate'){
  this.originalMaterial=ground.material as T.ShadowMaterial;this.geometry=ground.geometry;
  this.groundPosition=ground.geometry.getAttribute('position');this.positionVersion=this.groundPosition instanceof T.InterleavedBufferAttribute?this.groundPosition.data.version:this.groundPosition.version;
  scene.updateMatrixWorld(true);this.groundMatrix=ground.matrixWorld.clone();this.originalOnBeforeRender=ground.onBeforeRender;
  scene.traverseVisible(object=>{if((object as T.Light).isLight)this.lights.push(object as T.Light);});
  for(const name of ['transparent','blending','blendSrc','blendDst','blendEquation','blendSrcAlpha','blendDstAlpha','blendEquationAlpha','depthFunc','depthTest','depthWrite','colorWrite','stencilWrite','side','shadowSide','alphaTest','alphaHash','alphaToCoverage','premultipliedAlpha','toneMapped','dithering','clipIntersection','clipShadows','polygonOffset','wireframe'])this.materialSettings[name]=(this.originalMaterial as any)[name];
  const capacity=Number(renderer.capabilities.maxFragmentUniforms);
  const initial=this.settingsReason(undefined,true);
  if(mode==='baseline'||!finite(capacity)||capacity<GROUND_MASK_CAPACITY+GROUND_MASK_UNIFORM_RESERVE||initial){
   this.maskedMaterial=null;this.reason=mode==='baseline'?'baseline':initial||'uniform-capacity';return;
  }
  // Original material remains untouched, including onBeforeCompile/program key.
  const masked=this.originalMaterial.clone();
  masked.onBeforeCompile=(shader:any)=>{shader.fragmentShader=groundMaskShader(shader.fragmentShader);Object.assign(shader.uniforms,this.uniforms);this.compileCount++;};
  masked.customProgramCacheKey=()=>`dice-ground-mask-v1-${GROUND_MASK_CAPACITY}`;
  this.maskedCompileHook=masked.onBeforeCompile;this.maskedProgramKey=masked.customProgramCacheKey;
  this.maskedMaterial=masked;ground.material=masked;
  // Diagnostics only; no state mutation inside the draw and no additional render call.
  ground.onBeforeRender=(...args:Parameters<T.Object3D['onBeforeRender']>)=>{this.originalOnBeforeRender.apply(ground,args);if(ground.material===masked)this.shaderDrawCount++;};
  trustedGroundCallbacks.add(ground.onBeforeRender);
  this.reason='awaiting-current-region';
 }
 private settingsReason(view?:View,initial=false):string|null{
  const r=this.renderer,g=this.ground,m=g.material as T.ShadowMaterial,l=this.light,s=l.shadow,c=s.camera;
  if(!(m instanceof T.ShadowMaterial)||(!initial&&m!==this.originalMaterial&&m!==this.maskedMaterial)||this.originalMaterial.onBeforeCompile!==T.Material.prototype.onBeforeCompile||this.originalMaterial.customProgramCacheKey!==T.Material.prototype.customProgramCacheKey)return'ground-material';
  if(m.onBeforeRender!==T.Material.prototype.onBeforeRender||(!initial&&m===this.maskedMaterial&&(m.onBeforeCompile!==this.maskedCompileHook||m.customProgramCacheKey!==this.maskedProgramKey)))return'ground-callback';
  if((g as any).isSkinnedMesh||(g as any).isInstancedMesh||(g as any).isBatchedMesh||Object.values(g.geometry.morphAttributes).some(v=>v?.length)||g.geometry!==this.geometry||!(g.geometry instanceof T.PlaneGeometry)||g.geometry.getAttribute('position')!==this.groundPosition||(this.groundPosition instanceof T.InterleavedBufferAttribute?this.groundPosition.data.version:this.groundPosition.version)!==this.positionVersion||!g.matrixWorld.equals(this.groundMatrix)||g.castShadow||!g.receiveShadow)return'ground-geometry-transform';
  if(!finite(m.opacity)||m.opacity<0||m.opacity>1||m.color.r!==0||m.color.g!==0||m.color.b!==0||m.clippingPlanes?.length)return'ground-alpha-color';
  for(const [key,value] of Object.entries(this.materialSettings))if((m as any)[key]!==value)return'ground-state';
  if(this.scene.background!==null||this.scene.fog!==null||this.scene.overrideMaterial!==null||!stockCallback(this.scene,'onBeforeRender')||!stockCallback(this.scene,'onAfterRender')||!stockCallback(this.camera,'onBeforeRender'))return'scene-state';
  if(this.camera.parent!==null||this.camera.view!==null||!this.camera.isOrthographicCamera||this.camera.coordinateSystem!==T.WebGLCoordinateSystem||this.camera.reversedDepth||this.camera.layers.mask!==1||g.layers.mask!==1||l.layers.mask!==1)return'camera-layers';
  const main=this.camera,mdx=(main.right-main.left)/(2*main.zoom),mdy=(main.top-main.bottom)/(2*main.zoom),mcx=(main.right+main.left)/2,mcy=(main.top+main.bottom)/2;
  this.expectedProjection.makeOrthographic(mcx-mdx,mcx+mdx,mcy+mdy,mcy-mdy,main.near,main.far,T.WebGLCoordinateSystem,false);
  if(!main.projectionMatrix.equals(this.expectedProjection))return'camera-projection';
  if(r.getRenderTarget()!==null||r.toneMapping!==T.ACESFilmicToneMapping||r.outputColorSpace!==T.SRGBColorSpace||r.toneMappingExposure!==1||r.localClippingEnabled||r.clippingPlanes.length||r.capabilities.logarithmicDepthBuffer||r.capabilities.reversedDepthBuffer)return'renderer-state';
  if(!r.shadowMap.enabled||r.shadowMap.type!==T.PCFShadowMap||!r.shadowMap.autoUpdate||!s.autoUpdate||s.updateMatrices!==stockShadowUpdateMatrices||!l.isDirectionalLight||!l.castShadow||s.mapSize.x!==2048||s.mapSize.y!==2048||(s.map&&(s.map.width!==2048||s.map.height!==2048)))return'shadow-map';
  const depth=s.map?.depthTexture;
  if(s.map&&(!depth||depth.compareFunction!==T.LessEqualCompare||depth.minFilter!==T.LinearFilter||depth.magFilter!==T.LinearFilter||depth.wrapS!==T.ClampToEdgeWrapping||depth.wrapT!==T.ClampToEdgeWrapping||depth.generateMipmaps))return'shadow-sampling';
  if(!finite(s.radius,s.bias,s.normalBias,s.intensity)||s.intensity<0||s.intensity>1||!c.isOrthographicCamera||c.updateProjectionMatrix!==T.OrthographicCamera.prototype.updateProjectionMatrix||c.parent!==null||!c.matrixAutoUpdate||!c.matrixWorldAutoUpdate||c.view!==null||c.coordinateSystem!==T.WebGLCoordinateSystem||c.reversedDepth||!c.scale.equals(unitScale)||!c.up.equals(unitUp)||s.getViewportCount()!==1||!s.getFrameExtents().equals(unitExtents)||!s.getViewport(0).equals(unitViewport))return'shadow-camera';
  // Match stock OrthographicCamera.updateProjectionMatrix exactly, without mutating it.
  const dx=(c.right-c.left)/(2*c.zoom),dy=(c.top-c.bottom)/(2*c.zoom),cx=(c.right+c.left)/2,cy=(c.top+c.bottom)/2;
  this.expectedProjection.makeOrthographic(cx-dx,cx+dx,cy+dy,cy-dy,c.near,c.far,T.WebGLCoordinateSystem,false);
  // Three updates constructor projection only when the first shadow map is allocated.
  if(!c.projectionMatrix.equals(this.expectedProjection)&&!(initial&&!s.map&&c.projectionMatrix.equals(unallocatedShadowProjection)))return'shadow-projection';
  const current=initial?this.lights:this.collector.groundMaskLights;
  if(!current||current.length!==this.lights.length||current.some((value,i)=>value!==this.lights[i])||current.length!==3||current.filter(v=>(v as T.DirectionalLight).isDirectionalLight).length!==2||current.filter(v=>(v as T.HemisphereLight).isHemisphereLight).length!==1||current.some(v=>v.layers.mask!==1||v.castShadow&&v!==l))return'light-topology';
  if(view){
   const v=r.getViewport(this.viewport);
   if(v.x!==0||v.y!==0||v.z!==view.width||v.w!==view.height||r.getPixelRatio()!==view.pixelRatio||r.domElement.width!==Math.floor(view.width*view.pixelRatio)||r.domElement.height!==Math.floor(view.height*view.pixelRatio))return'viewport';
  }
  return null;
 }
 update(view:View,region:RenderRegion|null){
  if(this.mode==='baseline')return;
  this.uniforms.diceGroundMaskValid.value=false;this.uniforms.diceGroundMaskCount.value=0;this.eligible=false;this.logicalRectangles=[];
  if(!this.maskedMaterial)return;
  if(this.retired){if(this.ground.material===this.maskedMaterial){this.copyMaterialState(this.maskedMaterial,this.originalMaterial);this.ground.material=this.originalMaterial;}this.reason='context-restored-original-retired';return;}
  const reason=this.settingsReason(view),rectangles=this.collector.groundMaskRectangles;
  // Unsupported state routes to the true original material, not a bigger shader.
  if(reason){this.reason=reason;if(this.ground.material===this.maskedMaterial){this.copyMaterialState(this.maskedMaterial,this.originalMaterial);this.ground.material=this.originalMaterial;}return;}
  if(this.ground.material===this.originalMaterial&&!this.originalBypass)this.copyMaterialState(this.originalMaterial,this.maskedMaterial);
  this.ground.material=this.originalBypass?this.originalMaterial:this.maskedMaterial;
  if(!this.collector.groundMaskValid||region===null||!rectangles){this.reason='unknown-region';return;}
  if(rectangles.length>GROUND_MASK_CAPACITY){this.reason='rectangle-capacity';return;}
  for(const rect of rectangles){if(!finite(rect.x,rect.y,rect.width,rect.height)||Math.min(rect.x,rect.y,rect.width,rect.height)<0||rect.x+rect.width>view.width||rect.y+rect.height>view.height){this.reason='invalid-rectangle';return;}}
  // Outward physical rounding (also covers fractional DPR and float uniforms).
  rectangles.forEach((v,i)=>this.uniforms.diceGroundMaskRects.value[i].set(Math.floor(v.x*view.pixelRatio),Math.floor(v.y*view.pixelRatio),Math.ceil((v.x+v.width)*view.pixelRatio),Math.ceil((v.y+v.height)*view.pixelRatio)));
  this.logicalRectangles=rectangles;this.uniforms.diceGroundMaskCount.value=rectangles.length;this.eligible=true;
  this.uniforms.diceGroundMaskValid.value=this.enabled&&!this.originalBypass;this.reason=this.originalBypass?'original-material':this.enabled?'masked':'disabled';
 }
 private copyMaterialState(source:T.ShadowMaterial,target:T.ShadowMaterial){
  target.copy(source);target.onBeforeRender=source.onBeforeRender;
  target.onBeforeCompile=source.onBeforeCompile===this.maskedCompileHook?(target===this.maskedMaterial?this.maskedCompileHook!:T.Material.prototype.onBeforeCompile):(source.onBeforeCompile===T.Material.prototype.onBeforeCompile&&target===this.maskedMaterial?this.maskedCompileHook!:source.onBeforeCompile);
  target.customProgramCacheKey=source.customProgramCacheKey===this.maskedProgramKey?(target===this.maskedMaterial?this.maskedProgramKey!:T.Material.prototype.customProgramCacheKey):(source.customProgramCacheKey===T.Material.prototype.customProgramCacheKey&&target===this.maskedMaterial?this.maskedProgramKey!:source.customProgramCacheKey);
  target.needsUpdate=true;
 }
 prepareContextRestore(){
  this.uniforms.diceGroundMaskValid.value=false;this.uniforms.diceGroundMaskCount.value=0;this.eligible=false;this.logicalRectangles=[];
  if(this.mode==='candidate'&&this.maskedMaterial&&this.ground.material!==this.maskedMaterial){this.retired=true;this.reason='context-restored-original-retired';}
 }
 setEnabled(value:boolean){this.enabled=!!value;if(!value)this.uniforms.diceGroundMaskValid.value=false;}
 setOriginalMaterial(value:boolean){const previous=this.originalBypass;this.originalBypass=!!value;this.uniforms.diceGroundMaskValid.value=false;if(this.retired)return previous;if(this.ground.material!==this.originalMaterial&&this.ground.material!==this.maskedMaterial)return previous;if(this.maskedMaterial){if(value&&this.ground.material===this.maskedMaterial)this.copyMaterialState(this.maskedMaterial,this.originalMaterial);if(!value&&this.ground.material===this.originalMaterial)this.copyMaterialState(this.originalMaterial,this.maskedMaterial);}this.ground.material=value||!this.maskedMaterial?this.originalMaterial:this.maskedMaterial;return previous;}
 snapshot(){const fallbackKind=this.mode==='baseline'?'baseline':this.uniforms.diceGroundMaskValid.value?'none':this.ground.material===this.originalMaterial?'original-material':this.ground.material===this.maskedMaterial?'warm-original-branch':'external-material';return{mode:this.mode,fallbackKind,retired:this.retired,installed:!!this.maskedMaterial,eligible:this.eligible,reason:this.reason,enabled:this.enabled,originalMaterial:this.ground.material===this.originalMaterial,valid:this.uniforms.diceGroundMaskValid.value,rectangleCount:this.uniforms.diceGroundMaskCount.value,rects:this.logicalRectangles.map(v=>({...v})),physicalRects:this.uniforms.diceGroundMaskRects.value.slice(0,this.uniforms.diceGroundMaskCount.value).map(v=>v.toArray()),compileCount:this.compileCount,shaderDrawCount:this.shaderDrawCount};}
}
