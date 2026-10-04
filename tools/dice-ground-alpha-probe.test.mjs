// Control-flow/shader-boundary tests only. This is NOT GPU/MSAA pixel evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {probeGroundAlphaCache} from './dice-ground-alpha-probe.mjs';
const require=createRequire(process.env.DICE_GROUND_ALPHA_PACKAGE_JSON||new URL('../package.json',import.meta.url));
const T=require('three');
assert.deepEqual(probeGroundAlphaCache().reasons,['Missing diagnostic renderer/Three globals']);
const prior={renderer:globalThis.__diceProfileRenderer,three:globalThis.__diceProfileThree,time:globalThis.__diceProfileTime,WebGL2:globalThis.WebGL2RenderingContext,performance:globalThis.performance};
let clock=0;
class MockWebGL2 {
  NO_ERROR=0;VIEWPORT=1;SCISSOR_BOX=2;SCISSOR_TEST=3;SAMPLES=4;FRAMEBUFFER=5;FRAMEBUFFER_COMPLETE=6;IMPLEMENTATION_COLOR_READ_FORMAT=7;IMPLEMENTATION_COLOR_READ_TYPE=8;RED=9;RGBA=10;FLOAT=11;UNSIGNED_BYTE=12;
  drawingBufferWidth=2;drawingBufferHeight=2;viewport=[0,0,2,2];scissor=[0,0,2,2];scissorTest=false;pixels=new Uint8Array(16).fill(80);error=0;lost=false;
  getContextAttributes(){return {antialias:true,premultipliedAlpha:true};}
  getError(){const e=this.error;this.error=0;return e;}
  getExtension(name){return this.missing===name?null:{};}
  isContextLost(){return this.lost;}
  isEnabled(){return this.scissorTest;}
  getParameter(key){return new Map([[this.VIEWPORT,this.viewport],[this.SCISSOR_BOX,this.scissor],[this.SAMPLES,4],[this.IMPLEMENTATION_COLOR_READ_FORMAT,this.RED],[this.IMPLEMENTATION_COLOR_READ_TYPE,this.FLOAT]]).get(key);}
  checkFramebufferStatus(){return this.incomplete?0:this.FRAMEBUFFER_COMPLETE;}
  finish(){}
  readPixels(x,y,w,h,format,type,data){clock++;if(type===this.FLOAT)data.fill(this.empty?0:Math.fround(.2));else data.set(this.pixels);}
}
function fixture({mismatch=false,noEffect=false}={}) {
  const gl=new MockWebGL2(),scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);
  const ground=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShadowMaterial({opacity:.32})),body=new T.Mesh(new T.BoxGeometry(),new T.MeshPhysicalMaterial());
  ground.receiveShadow=true;body.castShadow=true;
  const light=new T.DirectionalLight();light.castShadow=true;light.shadow.map=new T.WebGLRenderTarget(2,2);
  scene.add(ground,body,light,new T.HemisphereLight());
  const eventTarget=new EventTarget(),shaders=new Map();eventTarget.toDataURL=()=> 'data:image/png;base64,aGVsbG8=';
  const renderer={xr:{isPresenting:false},shadowMap:{enabled:true,type:T.PCFShadowMap,autoUpdate:true,needsUpdate:false},localClippingEnabled:false,clippingPlanes:[],autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,domElement:eventTarget,info:{render:{calls:2,triangles:14}},target:null,viewport:new T.Vector4(0,0,2,2),scissor:new T.Vector4(0,0,2,2),clearColor:new T.Color(0),clearAlpha:0,
    state:{buffers:{color:{setMask(){}}}},getContext:()=>gl,getPixelRatio:()=>1,getRenderTarget(){return this.target;},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,getViewport(v){return v.copy(this.viewport);},getScissor(v){return v.copy(this.scissor);},getScissorTest:()=>gl.scissorTest,getClearColor(c){return c.copy(this.clearColor);},getClearAlpha(){return this.clearAlpha;},setClearColor(c,a){this.clearColor.set(c);this.clearAlpha=a;},setScissorTest(v){gl.scissorTest=v;},setViewport(v){this.viewport.copy(v);gl.viewport=v.toArray();},setScissor(v){this.scissor.copy(v);gl.scissor=v.toArray();},setRenderTarget(v){this.target=v;gl.viewport=(v?.viewport??this.viewport).toArray();gl.scissor=(v?.scissor??this.scissor).toArray();gl.scissorTest=v?.scissorTest??gl.scissorTest;},clear(){},
    render(){const m=ground.material;if(!shaders.has(m)){const s={fragmentShader:T.ShaderLib.shadow.fragmentShader,uniforms:{}};m.onBeforeCompile(s,this);shaders.set(m,s);}ground.onBeforeRender(this,scene,camera,ground.geometry,m,null);if(this.target){clock+=5;return;}const shader=shaders.get(m),gain=shader.uniforms.diceGroundAlphaProbeGain?.value;
      clock+=gain===undefined?10:4;gl.pixels.fill(gain===0&&!noEffect?0:mismatch&&gain!==undefined?79:80);
    }};
  const r={gl:renderer,scene,camera,active:[{meshes:[body]}],frameHandle:0,contextLost:false,last:3,drawFrame(){renderer.render();}};
  globalThis.__diceProfileRenderer=r;globalThis.__diceProfileThree=T;globalThis.__diceProfileTime=1000;
  return {r,gl,renderer,scene,camera,ground,original:ground.material,light,shaders};
}
try {
  globalThis.WebGL2RenderingContext=MockWebGL2;globalThis.performance={now:()=>clock};
  let f=fixture(),result=probeGroundAlphaCache({samples:3,captureImages:true});assert.equal(result.images.length,4);
  assert.equal(result.status,'passed-fixed-pose-only',JSON.stringify(result));assert.equal(result.stateRestored,true);assert.equal(result.activation.compiles,1);assert(result.activation.negativeControlDifferentChannels>0);assert.equal(result.summary.savingMs,6);assert.equal(f.ground.material,f.original);assert.equal(f.r.last,3);assert.equal(f.renderer.shadowMap.autoUpdate,true);
  const shader=[...f.shaders.values()].find(s=>s.uniforms.diceGroundAlphaProbeTexture);
  assert(shader.fragmentShader.includes('texelFetch'));assert(!shader.fragmentShader.includes('getShadowMask'));assert(!shader.fragmentShader.includes('<shadowmap_pars_fragment>'));
  f=fixture({mismatch:true});result=probeGroundAlphaCache();assert.equal(result.status,'rejected');assert(result.reasons.some(s=>s.includes('at least one RGBA byte')));assert.equal(f.ground.material,f.original);assert.equal(f.renderer.shadowMap.autoUpdate,true);assert.equal(result.failureClass,'diagnostic-rejection');
  f=fixture({noEffect:true});result=probeGroundAlphaCache();assert.equal(result.status,'rejected');assert(result.reasons.some(s=>s.includes('no visible effect')));
  f=fixture();f.gl.missing='EXT_float_blend';result=probeGroundAlphaCache();assert(result.reasons.some(s=>s.includes('Float32 blending required')));
  f=fixture();f.gl.incomplete=true;result=probeGroundAlphaCache();assert(result.reasons.some(s=>s.includes('framebuffer incomplete')));assert.equal(f.ground.material,f.original);assert.equal(f.renderer.target,null);assert.equal(f.renderer.shadowMap.autoUpdate,true);
  f=fixture();f.gl.empty=true;result=probeGroundAlphaCache();assert(result.reasons.some(s=>s.includes('cached alpha')));assert.equal(f.ground.material,f.original);
  f=fixture();f.scene.add(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));result=probeGroundAlphaCache();assert(result.reasons.some(s=>s.includes('Unknown visible drawable')));
  f=fixture();f.ground.visible=true;f.r.active[0].meshes[0].visible=false;const productDraw=f.r.drawFrame.bind(f.r);f.r.drawFrame=()=>{f.r.active[0].meshes[0].visible=true;productDraw();};result=probeGroundAlphaCache();assert.equal(result.status,'passed-fixed-pose-only');assert.equal(f.r.active[0].meshes[0].visible,true);
  f=fixture();f.r.drawFrame=()=>{throw Error('Unexpected renderer exception');};result=probeGroundAlphaCache();assert.equal(result.failureClass,'probe-error');
  f=fixture();f.r.frameHandle=7;result=probeGroundAlphaCache();assert(result.reasons.some(s=>s.includes('stop RAF')));assert.equal(result.failureClass,'fixture-error');
  console.log('ground-alpha control flow: PASS (10 cases; mocked GL only, no GPU pixel/performance claim)');
} finally {globalThis.__diceProfileRenderer=prior.renderer;globalThis.__diceProfileThree=prior.three;globalThis.__diceProfileTime=prior.time;globalThis.WebGL2RenderingContext=prior.WebGL2;globalThis.performance=prior.performance;}
