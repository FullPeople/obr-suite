/**
 * DIAGNOSTIC ONLY. Serialize this exported function into the existing profile
 * overlay with Playwright evaluate(). No product imports, flags or invalidator.
 * Caller must cancel RAF and fix __diceProfileTime before calling. Never run in
 * a live session. This probes one already-owned pose and always restores state.
 */
export function probeGroundAlphaCache({samples=5,warmup=2,captureImages=false}={}) {
  const r=globalThis.__diceProfileRenderer,T=globalThis.__diceProfileThree;
  const report={kind:'ground-alpha-r32f-fixed-pose',status:'rejected',reasons:[],comparisons:[],baseline:[],hit:[]};
  const require=(condition,message,failureClass='diagnostic-rejection')=>{if(!condition){const error=Error(message);error.groundAlphaFailureClass=failureClass;throw error;}};
  let saved,ground,original,capture,cached,target,contextLost=false,contextRestored=false,restoreState;
  try {
    require(r&&T,'Missing diagnostic renderer/Three globals','fixture-error');
    require(!r.frameHandle&&Number.isFinite(globalThis.__diceProfileTime),'Caller must stop RAF and fix __diceProfileTime','fixture-error');
    require(Number.isInteger(samples)&&samples>=2&&samples<=30&&Number.isInteger(warmup)&&warmup>=1&&warmup<=10,'Invalid bounded sample counts','fixture-error');
    const renderer=r.gl,gl=renderer.getContext(),scene=r.scene,camera=r.camera;
    require(!r.contextLost&&!gl.isContextLost(),'Context lost');
    require(gl.getError()===gl.NO_ERROR,'Pre-existing GL error','fixture-error');
    require(renderer.getRenderTarget()===null&&!renderer.xr.isPresenting,'Only the ordinary default framebuffer is supported');
    require(gl instanceof WebGL2RenderingContext,'WebGL2/texelFetch required');
    const floatColor=!!gl.getExtension('EXT_color_buffer_float'),floatBlend=!!gl.getExtension('EXT_float_blend');
    report.extensions={EXT_color_buffer_float:floatColor,EXT_float_blend:floatBlend};

    require(scene.background===null&&scene.fog===null&&scene.overrideMaterial===null&&!renderer.localClippingEnabled&&renderer.clippingPlanes.length===0,'Background/fog/override/clipping unsupported');
    require(camera.isOrthographicCamera&&!camera.view?.enabled,'Only the existing unoffset orthographic camera is supported');
    // Apply the caller's fixed time before inventory: newly admitted dice start
    // invisible, and rule FX can become visible only during this product draw.
    const entryLast=r.last;r.last=globalThis.__diceProfileTime-16;
    try {r.drawFrame();} finally {r.last=entryLast;}
    require(!gl.isContextLost()&&gl.getError()===gl.NO_ERROR,'Pose preparation failed','fixture-error');
    const grounds=[],lights=[],drawables=[];
    scene.traverseVisible(o=>{if(o.material?.isShadowMaterial)grounds.push(o);if(o.isLight)lights.push(o);if(o.isMesh||o.isLine||o.isPoints||o.isSprite)drawables.push(o);});
    require(grounds.length===1,'Exactly one visible ShadowMaterial ground required');
    ground=grounds[0];original=ground.material;
    const bodies=r.active.flatMap(a=>a.meshes),known=new Set([ground,...bodies,...bodies.flatMap(m=>m.children.filter(c=>c.userData.diceDecoration))]);
    report.scene={visibleDrawables:drawables.length,unknownVisibleDrawables:drawables.filter(o=>!known.has(o)).map(o=>({name:o.name,type:o.type}))};
    require(drawables.every(o=>known.has(o)),'Unknown visible drawable/FX: reject rather than cache through it');
    require(floatColor&&floatBlend,'R32F renderability AND Float32 blending required; no precision fallback');
    require(lights.filter(l=>l.castShadow).length===1&&lights.every(l=>l.isHemisphereLight||l.isDirectionalLight),'Unknown shadow/light arrangement');
    require(renderer.shadowMap.enabled&&renderer.shadowMap.type===T.PCFShadowMap,'Only unchanged PCFShadowMap supported');
    require(ground.geometry instanceof T.PlaneGeometry&&!ground.castShadow&&ground.receiveShadow&&ground.children.length===0,'Unexpected ground geometry/ownership');
    require(original.color.getHex()===0&&original.transparent&&original.blending===T.NormalBlending&&!original.premultipliedAlpha&&!original.alphaToCoverage&&!original.alphaHash&&original.alphaTest===0&&original.opacity>0&&original.opacity<=1,'Only ordinary black alpha-blended ShadowMaterial supported');
    require(original.onBeforeCompile===T.Material.prototype.onBeforeCompile&&ground.onBeforeRender===T.Object3D.prototype.onBeforeRender,'Existing custom ground hooks unsupported');
    const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,readback=new Uint8Array(width*height*4),fixed=globalThis.__diceProfileTime;
    const vector=()=>new T.Vector4();
    function viewportState(){return {target:renderer.getRenderTarget(),cubeFace:renderer.getActiveCubeFace(),mipmap:renderer.getActiveMipmapLevel(),viewport:renderer.getViewport(vector()),scissor:renderer.getScissor(vector()),scissorTest:renderer.getScissorTest(),autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,clearColor:renderer.getClearColor(new T.Color()),clearAlpha:renderer.getClearAlpha(),actualViewport:Array.from(gl.getParameter(gl.VIEWPORT)),actualScissor:Array.from(gl.getParameter(gl.SCISSOR_BOX)),actualScissorTest:gl.isEnabled(gl.SCISSOR_TEST)};}
    function restoreViewport(s){renderer.setClearColor(s.clearColor,s.clearAlpha);renderer.autoClear=s.autoClear;renderer.autoClearColor=s.autoClearColor;renderer.autoClearDepth=s.autoClearDepth;renderer.autoClearStencil=s.autoClearStencil;renderer.setViewport(s.viewport);renderer.setScissor(s.scissor);renderer.setScissorTest(s.scissorTest);renderer.setRenderTarget(s.target,s.cubeFace,s.mipmap);}
    function serialState(){const s=viewportState();return JSON.stringify({...s,target:s.target?.uuid??null,clearColor:s.clearColor.toArray(),viewport:s.viewport.toArray(),scissor:s.scissor.toArray(),shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeds:renderer.shadowMap.needsUpdate,lightFlags:lights.filter(l=>l.shadow).map(l=>[l.shadow.autoUpdate,l.shadow.needsUpdate])});}
    saved={viewport:viewportState(),material:original,visible:drawables.map(o=>[o,o.visible]),shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeds:renderer.shadowMap.needsUpdate,lightFlags:lights.filter(l=>l.shadow).map(l=>[l.shadow,l.shadow.autoUpdate,l.shadow.needsUpdate]),groundBefore:ground.onBeforeRender,last:r.last};
    const initialState=serialState();
    const onLost=()=>{contextLost=true;},onRestored=()=>{contextRestored=true;};
    renderer.domElement.addEventListener('webglcontextlost',onLost);renderer.domElement.addEventListener('webglcontextrestored',onRestored);
    restoreState=()=>{ground.material=original;ground.onBeforeRender=saved.groundBefore;for(const [o,visible] of saved.visible)o.visible=visible;renderer.shadowMap.autoUpdate=saved.shadowAuto;renderer.shadowMap.needsUpdate=saved.shadowNeeds;for(const [shadow,auto,needs] of saved.lightFlags){shadow.autoUpdate=auto;shadow.needsUpdate=needs;}restoreViewport(saved.viewport);r.last=saved.last;renderer.domElement.removeEventListener('webglcontextlost',onLost);renderer.domElement.removeEventListener('webglcontextrestored',onRestored);report.stateRestored=serialState()===initialState&&ground.material===original&&ground.onBeforeRender===saved.groundBefore&&saved.visible.every(([o,visible])=>o.visible===visible)&&r.last===saved.last;};
    require(JSON.stringify(saved.viewport.actualViewport)===JSON.stringify([0,0,width,height]),'Non-full default viewport unsupported');
    report.view={width,height,pixelRatio:renderer.getPixelRatio(),samples:gl.getParameter(gl.SAMPLES),antialias:gl.getContextAttributes().antialias,premultipliedAlpha:gl.getContextAttributes().premultipliedAlpha,colorBytes:width*height*4,captureSamples:0,captureDepthBuffer:true};
    function png(name){if(captureImages)(report.images??=[]).push({name,png:renderer.domElement.toDataURL('image/png')});}
    function compare(name,before,after){let differentChannels=0,maxDelta=0,differentPixels=0;const perChannel=[0,0,0,0],firstDifferences=[];for(let i=0;i<before.length;i+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(before[i+c]-after[i+c]);if(d){differentChannels++;perChannel[c]++;changed=true;}maxDelta=Math.max(maxDelta,d);}if(changed){differentPixels++;if(firstDifferences.length<8)firstDifferences.push({x:(i/4)%width,y:Math.floor(i/4/width),before:Array.from(before.subarray(i,i+4)),after:Array.from(after.subarray(i,i+4))});}}const result={name,exact:differentChannels===0,differentChannels,differentPixels,maxDelta,perChannel,firstDifferences};report.comparisons.push(result);return result;}
    function syncRead(){require(!contextLost&&!contextRestored&&!gl.isContextLost(),'Context generation changed: cache invalid');gl.finish();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,readback);require(gl.getError()===gl.NO_ERROR,'WebGL readback/render error');}
    function draw(){require(globalThis.__diceProfileTime===fixed&&!r.frameHandle,'Diagnostic clock/RAF changed','fixture-error');const began=performance.now();r.last=fixed-16;r.drawFrame();const submitted=performance.now();gl.finish();const finished=performance.now();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,readback);const ended=performance.now();require(!contextLost&&!contextRestored&&!gl.isContextLost()&&gl.getError()===gl.NO_ERROR,'WebGL frame/readback invalid',ground.material===cached?'diagnostic-rejection':'fixture-error');return{wholeFrameReadbackMs:ended-began,frameSubmitMs:submitted-began,finishMs:finished-submitted,readbackMs:ended-finished,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};}
    // Let the original renderer own pose placement, shadow construction and the
    // conservative scissor. No substitution of submission time for completion.
    for(let n=0;n<warmup;n++)draw();
    const reference=readback.slice();png('original-reference');
    require(reference.some((v,i)=>i%4===3&&v>0),'Empty reference frame','fixture-error');
    const caster=lights.find(l=>l.castShadow);
    require(caster.shadow.map,'Missing populated shadow map','fixture-error');
    renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
    for(const [shadow] of saved.lightFlags){shadow.autoUpdate=false;shadow.needsUpdate=false;}
    function poseSignature(){scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);return JSON.stringify({time:globalThis.__diceProfileTime,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,pixelRatio:renderer.getPixelRatio(),camera:camera.matrixWorld.elements,projection:camera.projectionMatrix.elements,groundGeometry:ground.geometry.uuid,groundPositionVersion:ground.geometry.attributes.position.version,groundMaterial:original.uuid,groundOpacity:original.opacity,drawables:drawables.map(o=>[o.uuid,o.visible,o.matrixWorld.elements,o.castShadow,o.receiveShadow]),lights:lights.map(l=>[l.uuid,l.visible,l.matrixWorld.elements,l.intensity,l.color.toArray(),l.target?.matrixWorld.elements,l.shadow?.matrix.elements,l.shadow?.map?.texture.uuid,l.shadow?.bias,l.shadow?.normalBias,l.shadow?.radius])});}
    const signature=poseSignature();
    for(let n=0;n<samples;n++){report.baseline.push(draw());require(poseSignature()===signature,'Pose/light/camera changed within baseline','fixture-error');require(compare('baseline-'+n,reference,readback).exact,'Original fixed pose is not byte-stable','fixture-error');}
    target=new T.WebGLRenderTarget(width,height,{format:T.RedFormat,type:T.FloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true,stencilBuffer:false,samples:0,generateMipmaps:false});
    target.texture.internalFormat='R32F';target.texture.colorSpace=T.NoColorSpace;target.texture.flipY=false;
    capture=original.clone();capture.color.setRGB(1,1,1);capture.toneMapped=false;capture.fog=false;
    // One isolated capture. White RGB * source alpha through ordinary blending
    // writes the intrinsic alpha to R32F. Never cache resolved MSAA coverage.
    const captureState=viewportState(),buildBegan=performance.now();
    try {
      for(const [o] of saved.visible)if(o!==ground)o.visible=false;
      ground.material=capture;
      renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.autoClear=false;
      require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'R32F framebuffer incomplete');
      renderer.setClearColor(0,0);renderer.state.buffers.color.setMask(true);renderer.clear(true,true,true);
      renderer.render(scene,camera);
      const submitted=performance.now();gl.finish();const finished=performance.now();
      // Read the implementation's Float32 color format; never convert to bytes.
      const format=gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT),type=gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE),channels=format===gl.RED?1:format===gl.RGBA?4:0;
      require(type===gl.FLOAT&&channels,'No legal Float32 R32F readback format');
      const floats=new Float32Array(width*height*channels);gl.readPixels(0,0,width,height,format,type,floats);const read=performance.now();
      require(gl.getError()===gl.NO_ERROR,'Float32 capture/readback failed');
      let nonzero=0,max=0,min=Infinity,nonfinite=0;for(let i=0;i<floats.length;i+=channels){const v=floats[i];if(!Number.isFinite(v))nonfinite++;if(v>0)nonzero++;max=Math.max(max,v);min=Math.min(min,v);}
      report.capture={buildSubmitMs:submitted-buildBegan,finishMs:finished-submitted,floatReadbackMs:read-finished,buildReadbackMs:read-buildBegan,nonzero,min,max,nonfinite,readFormat:format,readType:type,depthBuffer:true};
      require(nonzero>0&&max>0&&max<=Math.fround(original.opacity)&&min>=0&&nonfinite===0,'Empty/invalid/inflated cached alpha');
    } finally {ground.material=original;for(const [o,visible] of saved.visible)o.visible=visible;restoreViewport(captureState);}
    require(poseSignature()===signature,'Capture changed pose/light/shadow state');
    const gain={value:1},texture={value:target.texture};let compiles=0,cachedDraws=0;
    report.activation={compiles:0,cachedDraws:0,texelFetch:true,fragmentShadowChunksRemoved:true};
    cached=original.clone();
    cached.onBeforeCompile=shader=>{
      const expression='opacity * ( 1.0 - getShadowMask() )';
      require(shader.fragmentShader.includes(expression),'Shadow shader boundary changed','probe-error');
      shader.uniforms.diceGroundAlphaProbeTexture=texture;shader.uniforms.diceGroundAlphaProbeGain=gain;
      shader.fragmentShader='uniform sampler2D diceGroundAlphaProbeTexture;\nuniform float diceGroundAlphaProbeGain;\n'+shader.fragmentShader.replace(expression,'texelFetch( diceGroundAlphaProbeTexture, ivec2( gl_FragCoord.xy ), 0 ).r * diceGroundAlphaProbeGain').replace('#include <shadowmap_pars_fragment>','').replace('#include <shadowmask_pars_fragment>','');
      require(!shader.fragmentShader.includes('getShadowMask'),'PCF path still present in hit shader');compiles++;report.activation.compiles=compiles;
    };
    cached.customProgramCacheKey=()=>original.customProgramCacheKey()+'-DIAGNOSTIC-ground-alpha-r32f-1';
    ground.material=cached;
    ground.onBeforeRender=function(...args){if(this.material===cached){cachedDraws++;report.activation.cachedDraws=cachedDraws;}saved.groundBefore.apply(this,args);};
    const hitFirstBegan=performance.now();draw();report.firstHitCompileReadbackMs=performance.now()-hitFirstBegan;png('first-cache-hit');
    require(compare('first-cache-hit',reference,readback).exact,'Cached alpha changed at least one RGBA byte (including MSAA/resin composition)');
    for(let n=0;n<warmup;n++)draw();
    for(let n=0;n<samples;n++){report.hit.push(draw());require(poseSignature()===signature,'Pose/light/camera changed within hit');require(compare('cache-hit-'+n,reference,readback).exact,'Cached hit is not byte-exact');}
    require(compiles>0&&cachedDraws>=samples+warmup+1,'Cache shader/draw not observed');
    // Same shader, same geometry and depth/order; zeroing only the fetched alpha
    // MUST change visible output. Prevents passing an unexercised cache branch.
    gain.value=0;draw();png('zero-cached-alpha-negative-control');const negative=compare('zero-cached-alpha-negative-control',reference,readback);
    gain.value=1;draw();require(compare('cache-restored-after-negative-control',reference,readback).exact,'Cache did not recover after negative control');
    require(!negative.exact,'Cached-alpha negative control had no visible effect');
    report.activation={compiles,cachedDraws,negativeControlDifferentChannels:negative.differentChannels,texelFetch:true,fragmentShadowChunksRemoved:true};
    ground.material=original;ground.onBeforeRender=saved.groundBefore;draw();png('original-material-restored');
    require(compare('original-material-restored',reference,readback).exact,'Original material did not restore exactly');
    const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
    const baselineMs=median(report.baseline.map(x=>x.wholeFrameReadbackMs)),hitMs=median(report.hit.map(x=>x.wholeFrameReadbackMs)),savingMs=baselineMs-hitMs;
    report.summary={baselineMedianMs:baselineMs,hitMedianMs:hitMs,savingMs,conservativeBuildBreakEvenHits:savingMs>0?Math.ceil((report.capture.buildReadbackMs+report.firstHitCompileReadbackMs)/savingMs):null};
    report.status=savingMs>0?'passed-fixed-pose-only':'rejected';
    if(savingMs<=0){report.failureClass='diagnostic-rejection';report.reasons.push('No positive median whole-frame + synchronous readback saving');}
    restoreState();restoreState=undefined;
    require(report.stateRestored,'Renderer/viewport/scissor/clear/shadow flags were not restored');
    syncRead();
  } catch(error) {report.status='rejected';report.failureClass=error.groundAlphaFailureClass||'probe-error';report.reasons.push(String(error.message||error));}
  finally {
    if(restoreState)try{restoreState();report.restorationAttempted=true;}catch(error){report.status='rejected';report.failureClass='probe-error';report.stateRestored=false;report.reasons.push('RESTORATION FAILED: '+String(error));}
    // Never retain a cache across frames, scene mutations or a context generation.
    capture?.dispose();cached?.dispose();target?.dispose();
    report.contextLost=contextLost;report.contextRestored=contextRestored;
  }
  return report;
}
