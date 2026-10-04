/** Diagnostic only. Self-contained for browser evaluate(); never changes the clock. */
export function installGroundLiveProbe({r=globalThis.__diceProfileRenderer,T=globalThis.__diceProfileThree,enabled=false,minBodies=20,stableFrames=3,maxRecords=5000,trust}={}) {
  if(!r?.gl||!T)throw Error('Missing diagnostic renderer/Three');
  if(!Number.isInteger(minBodies)||minBodies<1||!Number.isInteger(stableFrames)||stableFrames<2||!Number.isInteger(maxRecords)||maxRecords<1)throw Error('Invalid experiment thresholds');
  const renderer=r.gl,gl=renderer.getContext(),scene=r.scene,camera=r.camera,originalRender=renderer.render;
  const objectHooks=['onBeforeRender','onAfterRender','onBeforeShadow','onAfterShadow'];
  const shadowHookNames=['updateMatrices','getFrustum','getViewport','getViewportCount','getFrameExtents','getCamera','_updateMatrix'];
  const defaults=Object.fromEntries(objectHooks.map(key=>[key,T.Object3D.prototype[key]]));
  const materialBefore=T.Material.prototype.onBeforeRender,materialCompile=T.Material.prototype.onBeforeCompile,materialKey=T.Material.prototype.customProgramCacheKey;
  const shadowMethods=Object.getPrototypeOf(new T.DirectionalLight().shadow);
  const hooks=(trust?.bodyMaterialHooks||[]).map(x=>({compile:x.onBeforeCompile,key:x.customProgramCacheKey}));
  const geometryTrust=new Set(trust?.geometries||[]),decorationSources=new Set((trust?.decorationShaders||[]).map(x=>JSON.stringify([x.vertexShader,x.fragmentShader])));
  const trusted=trust?.exclusiveRenderer===true&&typeof trust.source==='string'&&trust.source.length>0&&trust.rendererRender===originalRender&&hooks.length>0&&geometryTrust.size>0;
  const originalCompile=renderer.compile,rendererMethods=new Map(['renderBufferDirect','setRenderTarget','getContext','setViewport','setScissor','setScissorTest','clear','compile','setPixelRatio','setSize','getCurrentViewport','getViewport','getScissor','getScissorTest','getClearColor','getClearAlpha','getRenderTarget','getActiveCubeFace','getActiveMipmapLevel','getPixelRatio'].map(k=>[k,renderer[k]]));
  const alphaGain={value:1};let bypass=0,fatalError=null;
  let cache=null,lastKey=null,stable=0,generation=0,resourceEpoch=0,busy=false,disposed=false,lost=false,nextId=1,gpuPhase='init';
  const ids=new WeakMap(),watched=new Map(),deferredDisposal=[];let mirror,mirrorHooks=[];
  const stats={kind:'experimental-live-ground-r32f',enabled,minBodies,stableFrames,source:trust?.source??null,frames:0,hits:0,builds:0,fallbacks:0,invalidations:0,errors:[],records:[],droppedRecords:0,contextGeneration:0,syncCalls:{init:{},build:{},hit:{}},resources:{targetsCreated:0,targetsDisposed:0,liveTargets:0,peakTargets:0,colorBytes:0,peakColorBytes:0,estimatedDepthBytes:0,peakEstimatedDepthBytes:0}};
  function gpu(name,...args){const counts=stats.syncCalls[gpuPhase];counts[name]=(counts[name]||0)+1;return gl[name](...args);}
  let supported=!!gpu('getExtension','EXT_color_buffer_float')&&!!gpu('getExtension','EXT_float_blend');lost=gpu('isContextLost');
  function detachMirror(){for(const h of mirrorHooks)if(h.owner[h.key]===h.wrapper)h.owner[h.key]=h.original;mirrorHooks=[];}
  function attachMirror(){detachMirror();const phase=gpuPhase;gpuPhase='init';try{mirror={valid:true,depth:gpu('getParameter',gl.DEPTH_CLEAR_VALUE),stencil:gpu('getParameter',gl.STENCIL_CLEAR_VALUE),locks:{color:false,depth:false,stencil:false}};}finally{gpuPhase=phase;}
    function wrap(owner,key,update){const original=owner[key];if(typeof original!=='function')return;const wrapper=function(...args){const result=original.apply(this,args);update(...args);return result;};owner[key]=wrapper;mirrorHooks.push({owner,key,original,wrapper});}
    for(const key of ['color','depth','stencil']){const buffer=renderer.state.buffers[key];wrap(buffer,'setLocked',value=>{mirror.locks[key]=value;});wrap(buffer,'reset',()=>{mirror.valid=false;invalidate('unknown state reset');});}
    wrap(renderer.state.buffers.depth,'setClear',value=>{mirror.depth=value;});wrap(renderer.state.buffers.stencil,'setClear',value=>{mirror.stencil=value;});
  }
  attachMirror();gpuPhase='hit';
  function fail(reason){throw Error(reason);}
  function engineCall(fn,args,kind){if(stats.requiresRendererRecreation)throw fatalError;try{return fn.apply(renderer,args);}catch(error){enabled=false;stats.enabled=false;stats.requiresRendererRecreation=true;fatalError??=error;stats.fatalReason=kind+' threw inside Three: '+String(fatalError.message||fatalError);fatalError.requiresRendererRecreation=true;if(!busy)invalidate('renderer requires recreation');throw fatalError;}}
  function check(condition,reason){if(!condition)fail(reason);}
  function exactJSON(value){return JSON.stringify(value,(_key,v)=>{if(typeof v==='number'&&!Number.isFinite(v))fail('nonfinite dependency');return v;});}
  function id(o){if(o===null||o===undefined)return null;if(!ids.has(o))ids.set(o,nextId++);return ids.get(o);}
  function addRecord(record){if(stats.records.length<maxRecords)stats.records.push(record);else stats.droppedRecords++;}
  function unwatch(){for(const [o,fn]of watched)o.removeEventListener('dispose',fn);watched.clear();}
  function disposeResources(o){if(o.disposed)return;o.disposed=true;o.target.dispose();o.capture.dispose();o.cached.dispose();const v=stats.resources;v.targetsDisposed++;v.liveTargets--;v.colorBytes-=o.width*o.height*4;v.estimatedDepthBytes-=o.width*o.height*4;}
  function discard(){if(cache){const old=cache;cache=null;if(busy)deferredDisposal.push(old);else disposeResources(old);}unwatch();}
  function flushDisposal(){for(const old of deferredDisposal.splice(0))disposeResources(old);}
  function invalidate(reason='manual'){discard();lastKey=null;stable=0;resourceEpoch++;stats.invalidations++;stats.lastInvalidation=reason;}
  function watch(o){if(!o?.addEventListener||watched.has(o))return;const fn=()=>invalidate('resource-disposed');watched.set(o,fn);o.addEventListener('dispose',fn);}
  function textureKey(t){if(!t)return null;watch(t);return[id(t),t.version,t.format,t.type,t.internalFormat,t.colorSpace,t.minFilter,t.magFilter,t.wrapS,t.wrapT,t.compareFunction,t.flipY,t.generateMipmaps,t.image?.width,t.image?.height,t.source?.version];}
  function objectKey(o){return[id(o),id(o.parent),o.visible,o.layers.mask,o.renderOrder,o.frustumCulled,o.castShadow,o.receiveShadow,o.matrixAutoUpdate,o.matrixWorldAutoUpdate,o.matrix.elements,o.matrixWorld.elements,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray()];}
  function attributesKey(g){watch(g);check(g.computeBoundingSphere===T.BufferGeometry.prototype.computeBoundingSphere&&g.computeBoundingBox===T.BufferGeometry.prototype.computeBoundingBox,'unknown geometry callback');check(g.isBufferGeometry&&!g.isInstancedBufferGeometry&&Object.keys(g.morphAttributes).length===0,'unknown/deformed geometry');const attrs=Object.entries(g.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>{check(!a.isInstancedBufferAttribute,'instanced attribute');const data=a.isInterleavedBufferAttribute?a.data:a;return[name,id(a),id(data),data.version,data.count,data.stride??null,data.array?.constructor.name,data.array?.length,a.itemSize,a.normalized,a.offset??null,a.gpuType,data.usage];});const index=g.index;return[id(g),attrs,index?[id(index),index.version,index.count,index.array?.constructor.name,index.array?.length]:null,g.drawRange.start,g.drawRange.count===Infinity?'unbounded':g.drawRange.count,g.groups.map(x=>[x.start,x.count,x.materialIndex]),g.boundingBox?[g.boundingBox.min.toArray(),g.boundingBox.max.toArray()]:null,g.boundingSphere?[g.boundingSphere.center.toArray(),g.boundingSphere.radius]:null];}
  function cameraKey(c){return[objectKey(c),c.projectionMatrix.elements,c.projectionMatrixInverse.elements,c.matrixWorldInverse.elements,c.near,c.far,c.left,c.right,c.top,c.bottom,c.zoom,c.view,c.coordinateSystem,c.reversedDepth];}
  function materialKeyData(m){watch(m);return[id(m),m.version,m.visible,m.opacity,m.transparent,m.blending,m.premultipliedAlpha,m.side,m.shadowSide,m.depthTest,m.depthWrite,m.depthFunc,m.colorWrite,m.polygonOffset,m.polygonOffsetFactor,m.polygonOffsetUnits,m.alphaTest,m.alphaHash,m.alphaToCoverage,m.stencilWrite,m.stencilFunc,m.stencilRef,m.stencilFuncMask,m.stencilWriteMask,m.stencilFail,m.stencilZFail,m.stencilZPass,m.forceSinglePass,m.toneMapped,m.fog,m.color?.toArray(),m.defines];}
  function checkObject(o){check(o.traverse===T.Object3D.prototype.traverse&&o.traverseVisible===T.Object3D.prototype.traverseVisible,'unknown traversal callback');check(o.lookAt===T.Object3D.prototype.lookAt,'unknown lookAt callback');for(const key of objectHooks)check(o[key]===defaults[key],'unknown object callback: '+key);const proto=o.isCamera?T.Camera.prototype:T.Object3D.prototype;check(o.updateMatrix===T.Object3D.prototype.updateMatrix&&o.updateMatrixWorld===proto.updateMatrixWorld&&o.updateWorldMatrix===proto.updateWorldMatrix,'unknown transform callback');const frustumProto=o.isMesh?T.Mesh.prototype:o.isLine?T.Line.prototype:o.isPoints?T.Points.prototype:o.isSprite?T.Sprite.prototype:T.Object3D.prototype;check(o.intersectsFrustum===frustumProto.intersectsFrustum,'unknown frustum callback');check(o.matrixAutoUpdate&&o.matrixWorldAutoUpdate,'manual world transform unsupported');check(!o.isSkinnedMesh&&!o.isInstancedMesh&&!o.isBatchedMesh&&!o.customDepthMaterial&&!o.customDistanceMaterial&&(!o.isMesh||o.boundingSphere===undefined),'unknown/deformed drawable');}
  function checkMaterial(m){check(m&&!Array.isArray(m)&&m.onBeforeRender===materialBefore,'unknown material callback/array');check(!m.wireframe&&!m.alphaMap&&!m.map&&!m.displacementMap&&!m.clippingPlanes?.length&&!m.clipShadows&&!m.alphaTest&&!m.alphaHash&&!m.alphaToCoverage&&!m.stencilWrite,'alpha/displacement/clipping/stencil material');}
  function state(buffers=false){const viewport=renderer.getViewport(new T.Vector4()),scissor=renderer.getScissor(new T.Vector4()),dpr=renderer.getPixelRatio(),physicalScissor=scissor.clone().multiplyScalar(dpr).toArray();
    check([...viewport.clone().multiplyScalar(dpr).toArray(),...physicalScissor].every(Number.isInteger),'fractional physical viewport/scissor unsupported');
    const s={target:renderer.getRenderTarget(),cube:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),viewport,scissor,test:renderer.getScissorTest(),auto:renderer.autoClear,autoColor:renderer.autoClearColor,autoDepth:renderer.autoClearDepth,autoStencil:renderer.autoClearStencil,color:renderer.getClearColor(new T.Color()),alpha:renderer.getClearAlpha(),shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeds:renderer.shadowMap.needsUpdate,infoAuto:renderer.info.autoReset,actualViewport:renderer.getCurrentViewport(new T.Vector4()).toArray(),actualScissor:physicalScissor,actualTest:renderer.getScissorTest(),clearDepth:mirror.depth,clearStencil:mirror.stencil,colorMask:[true,true,true,true],depthMask:true,stencilMask:0xffffffff};
    if(buffers){s.colorMask=Array.from(gpu('getParameter',gl.COLOR_WRITEMASK));s.depthMask=gpu('getParameter',gl.DEPTH_WRITEMASK);s.stencilMask=gpu('getParameter',gl.STENCIL_WRITEMASK);check(s.stencilMask===gpu('getParameter',gl.STENCIL_BACK_WRITEMASK),'asymmetric stencil masks unsupported');check(s.colorMask.every(x=>x===s.colorMask[0]),'nonuniform color mask unsupported');check(exactJSON(Array.from(gpu('getParameter',gl.VIEWPORT)))===exactJSON(s.actualViewport)&&exactJSON(Array.from(gpu('getParameter',gl.SCISSOR_BOX)))===exactJSON(s.actualScissor)&&gpu('isEnabled',gl.SCISSOR_TEST)===s.actualTest,'CPU/GL state mirror mismatch');}
    return s;
  }
  function restore(s){renderer.autoClear=s.auto;renderer.autoClearColor=s.autoColor;renderer.autoClearDepth=s.autoDepth;renderer.autoClearStencil=s.autoStencil;renderer.shadowMap.autoUpdate=s.shadowAuto;renderer.shadowMap.needsUpdate=s.shadowNeeds;renderer.info.autoReset=s.infoAuto;renderer.setClearColor(s.color,s.alpha);renderer.setViewport(s.viewport);renderer.setScissor(s.scissor);renderer.setScissorTest(s.test);renderer.setRenderTarget(s.target,s.cube,s.mip);if(s.colorMask){renderer.state.buffers.color.setMask(s.colorMask[0]);renderer.state.buffers.depth.setMask(s.depthMask);renderer.state.buffers.stencil.setMask(s.stencilMask);renderer.state.buffers.depth.setClear(s.clearDepth);renderer.state.buffers.stencil.setClear(s.clearStencil);}check(exactJSON(renderer.getCurrentViewport(new T.Vector4()).toArray())===exactJSON(s.actualViewport),'CPU viewport restore failed');}
  function groundCoversDrawingBuffer(ground,camera,width,height,pad=1){
 if(!ground?.geometry?.isBufferGeometry||!camera?.isOrthographicCamera||camera.view?.enabled||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||pad<1)return false;
 const g=ground.geometry,p=g.getAttribute('position'),ix=g.index;
 if(!(g instanceof T.PlaneGeometry)||g.parameters.widthSegments!==1||g.parameters.heightSegments!==1||p?.count!==4||ix?.count!==6||g.drawRange.start!==0||g.drawRange.count!==Infinity||g.groups.length)return false;
 const expected=[0,2,1,2,3,1];if(expected.some((v,i)=>ix.getX(i)!==v))return false;
 const w=g.parameters.width/2,h=g.parameters.height/2,expectedPositions=[[-w,h,0],[w,h,0],[-w,-h,0],[w,-h,0]];
 if(expectedPositions.some((v,i)=>v.some((x,j)=>p.getComponent(i,j)!==x)))return false;
 const m=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(ground.matrixWorld);
 if(!m.elements.every(Number.isFinite))return false;
 const polygon=[0,1,3,2].map(i=>new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(m));
 if(polygon.some(p=>![p.x,p.y,p.z].every(Number.isFinite)||p.z<=-1||p.z>=1))return false;
 const points=[[-1-2*pad/width,-1-2*pad/height],[1+2*pad/width,-1-2*pad/height],[1+2*pad/width,1+2*pad/height],[-1-2*pad/width,1+2*pad/height]];
 const cross=(a,b,p)=>(b.x-a.x)*(p[1]-a.y)-(b.y-a.y)*(p[0]-a.x);
 return points.every(p=>{const signs=polygon.map((a,i)=>cross(a,polygon[(i+1)%4],p));return signs.every(v=>v>0)||signs.every(v=>v<0);});
}

  function inspect(){
    check(r.gl===renderer,'renderer instance changed');check(trusted,'missing explicit trusted-source manifest');check(renderer.render===wrapped&&renderer.compile===originalCompile&&[...rendererMethods].every(([k,v])=>renderer[k]===v),'renderer function changed');
    check(!disposed&&!lost&&!r.contextLost,'context unavailable');check(mirror.valid&&Object.values(mirror.locks).every(v=>!v)&&mirrorHooks.every(h=>h.owner[h.key]===h.wrapper),'unknown/locked state source');
    check(renderer.getRenderTarget()===null&&!renderer.xr.isPresenting&&renderer.autoClear===false,'outside original withRenderRegion/default framebuffer');
    check(scene.parent===null&&scene===r.scene&&camera===r.camera&&camera.isOrthographicCamera&&!camera.parent&&!camera.view?.enabled&&!camera.viewport,'unknown scene/camera');
    check(scene.background===null&&scene.fog===null&&scene.overrideMaterial===null&&!renderer.localClippingEnabled&&renderer.clippingPlanes.length===0,'unknown background/fog/override/clipping');
    check(!renderer.capabilities.reversedDepthBuffer&&!renderer.capabilities.logarithmicDepthBuffer,'nonstandard depth precision');
    check(renderer.shadowMap.enabled&&renderer.shadowMap.type===T.PCFShadowMap,'non-PCF shadows');
    check(gl instanceof WebGL2RenderingContext&&supported,'Float32 rendering/blending unavailable');
    checkObject(scene);const all=[];scene.traverse(o=>{checkObject(o);all.push(o);});checkObject(camera);
    // Mirror Three's ordinary world-update order; do not alter orphan light targets.
    scene.updateMatrixWorld();camera.updateMatrixWorld();
    const effectiveVisible=new Set();scene.traverseVisible(o=>effectiveVisible.add(o));const bodies=r.active.flatMap(a=>a.meshes);const effectiveCasters=bodies.filter(o=>effectiveVisible.has(o)&&o.layers.test(camera.layers)&&o.castShadow&&o.material?.visible);check(effectiveCasters.length>=minBodies,'below effective caster count threshold');
    const grounds=all.filter(o=>o.material?.isShadowMaterial);check(grounds.length===1,'unknown ground count');const ground=grounds[0],material=ground.material;
    check(effectiveVisible.has(ground)&&ground.geometry instanceof T.PlaneGeometry&&ground.receiveShadow&&!ground.castShadow&&ground.children.length===0&&ground.layers.test(camera.layers),'unknown ground');checkMaterial(material);
    check(material.color.getHex()===0&&material.side===T.FrontSide&&(!material.defines||Object.keys(material.defines).length===0)&&material.transparent&&material.blending===T.NormalBlending&&!material.premultipliedAlpha&&material.opacity>0&&material.opacity<=1&&material.onBeforeCompile===materialCompile&&material.customProgramCacheKey===materialKey,'custom/nonblack ground');
    const bodySet=new Set(bodies),known=new Set([ground,...bodies]),bodyKeys=[],decorationKeys=[];
    for(const body of bodies){check(all.includes(body),'body outside owned scene');check(geometryTrust.has(body.geometry),'untrusted body geometry');const m=body.material;checkMaterial(m);check(m.isMeshPhysicalMaterial&&!m.transparent&&m.opacity===1&&m.depthWrite&&m.colorWrite&&m.side===T.FrontSide&&!m.transmission&&hooks.some(h=>h.compile===m.onBeforeCompile&&h.key===m.customProgramCacheKey),'untrusted/alpha body source');check(!m.defines||Object.keys(m.defines).every(k=>(k==='STANDARD'||k==='PHYSICAL')&&m.defines[k]===''),'unknown body defines');bodyKeys.push([objectKey(body),attributesKey(body.geometry),materialKeyData(m)]);
      for(const child of body.children){check(child.userData.diceDecoration&&child.children.length===0&&!child.castShadow,'unknown body child');checkMaterial(child.material);const d=child.material;check(d.isShaderMaterial&&!d.transparent&&d.opacity===1&&!d.depthWrite&&d.onBeforeCompile===materialCompile&&d.customProgramCacheKey===materialKey&&decorationSources.has(JSON.stringify([d.vertexShader,d.fragmentShader])),'untrusted decoration source');known.add(child);decorationKeys.push([objectKey(child),attributesKey(child.geometry),materialKeyData(d)]);}
    }
    const lights=[];scene.traverseVisible(o=>{if(o.isLight){check(o.isHemisphereLight||o.isDirectionalLight,'unknown light');lights.push(o);}if(o.isMesh||o.isLine||o.isPoints||o.isSprite)check(known.has(o),'unknown visible drawable/FX');});
    const casters=lights.filter(l=>l.castShadow&&l.layers.test(camera.layers));check(casters.length===1&&casters[0].isDirectionalLight,'unknown shadow light count');
    const light=casters[0],shadow=light.shadow;check(shadowHookNames.every(key=>shadow[key]===shadowMethods[key])&&shadow.camera.isOrthographicCamera&&!shadow.camera.parent,'custom shadow source');checkObject(shadow.camera);checkObject(light.target);check(shadow.intensity>=0&&shadow.intensity<=1&&Number.isInteger(shadow.mapSize.x)&&Number.isInteger(shadow.mapSize.y)&&shadow.mapSize.x>0&&shadow.mapSize.y>0,'unsupported shadow intensity/map size');check(shadow.getViewportCount()===1&&shadow.getFrameExtents().equals(new T.Vector2(1,1))&&shadow.getViewport(0).equals(new T.Vector4(0,0,1,1))&&shadow.getCamera(0)===shadow.camera,'nondefault shadow atlas/camera');
    const s=state();check(s.actualViewport[0]===0&&s.actualViewport[1]===0&&s.actualViewport[2]===gl.drawingBufferWidth&&s.actualViewport[3]===gl.drawingBufferHeight,'non-full physical viewport');check(groundCoversDrawingBuffer(ground,camera,gl.drawingBufferWidth,gl.drawingBufferHeight),'ground does not cover viewport with MSAA guard');
    const lightKeys=lights.map(l=>{const sh=l.shadow;if(sh?.map){watch(sh.map);textureKey(sh.map.texture);textureKey(sh.map.depthTexture);}return[objectKey(l),l.intensity,l.color.toArray(),l.groundColor?.toArray(),l.target?objectKey(l.target):null,sh?[id(sh),sh.autoUpdate,sh.needsUpdate,sh.intensity,sh.bias,sh.normalBias,sh.radius,sh.blurSamples,sh.mapSize.toArray(),sh.matrix.elements,cameraKey(sh.camera),sh.map?[id(sh.map),sh.map.width,sh.map.height,textureKey(sh.map.texture),textureKey(sh.map.depthTexture)]:null]:null];});
    const key=exactJSON({generation,resourceEpoch,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,dpr:renderer.getPixelRatio(),viewport:s.viewport.toArray(),scissor:s.scissor.toArray(),scissorTest:s.test,physicalViewport:s.actualViewport,physicalScissor:s.actualScissor,physicalScissorTest:s.actualTest,clear:[s.color.toArray(),s.alpha,s.auto,s.autoColor,s.autoDepth,s.autoStencil,s.clearDepth,s.clearStencil],shadow:[renderer.shadowMap.enabled,renderer.shadowMap.type,s.shadowAuto,s.shadowNeeds],output:[renderer.outputColorSpace,renderer.toneMapping,renderer.toneMappingExposure,renderer.sortObjects,renderer.capabilities.reversedDepthBuffer,renderer.capabilities.logarithmicDepthBuffer],scene:all.map(objectKey),rolls:r.active.map(a=>[id(a),id(a.roll),a.roll.request.id,a.meshes.map(id)]),camera:cameraKey(camera),ground:[objectKey(ground),attributesKey(ground.geometry),materialKeyData(material)],bodies:bodyKeys,decorations:decorationKeys,lights:lightKeys,environment:textureKey(scene.environment)});
    return{key,ground,material,bodies,effectiveCasterCount:effectiveCasters.length,drawables:all.filter(o=>o.isMesh||o.isLine||o.isPoints||o.isSprite),light,shadow,state:s};
  }
  function build(p,record){
    gpuPhase='build';const buildBegan=performance.now();
    check(p.shadow.map,'shadow map not yet populated');const s=state(true);
    const target=new T.WebGLRenderTarget(gl.drawingBufferWidth,gl.drawingBufferHeight,{format:T.RedFormat,type:T.FloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true,stencilBuffer:false,samples:0,generateMipmaps:false});target.texture.internalFormat='R32F';target.texture.colorSpace=T.NoColorSpace;target.texture.flipY=false;
    const capture=p.material.clone(),cached=p.material.clone(),texture={value:target.texture};
    const resources={target,capture,cached,width:target.width,height:target.height,disposed:false},rs=stats.resources;rs.targetsCreated++;rs.liveTargets++;rs.peakTargets=Math.max(rs.peakTargets,rs.liveTargets);rs.colorBytes+=target.width*target.height*4;rs.estimatedDepthBytes+=target.width*target.height*4;rs.peakColorBytes=Math.max(rs.peakColorBytes,rs.colorBytes);rs.peakEstimatedDepthBytes=Math.max(rs.peakEstimatedDepthBytes,rs.estimatedDepthBytes);capture.color.setRGB(1,1,1);capture.toneMapped=false;capture.fog=false;
    let compiles=0;cached.onBeforeCompile=shader=>{const expression='opacity * ( 1.0 - getShadowMask() )';check(shader.fragmentShader.includes(expression),'shadow shader boundary changed');shader.uniforms.diceGroundLiveTexture=texture;shader.uniforms.diceGroundLiveGain=alphaGain;shader.fragmentShader='uniform sampler2D diceGroundLiveTexture;\nuniform float diceGroundLiveGain;\n'+shader.fragmentShader.replace(expression,'texelFetch( diceGroundLiveTexture, ivec2( gl_FragCoord.xy ), 0 ).r * diceGroundLiveGain').replace('#include <shadowmap_pars_fragment>','').replace('#include <shadowmask_pars_fragment>','');compiles++;};cached.customProgramCacheKey=()=> 'diagnostic-ground-live-r32f-v1';
    const matrixState={matrix:p.ground.matrix.clone(),world:p.ground.matrixWorld.clone(),modelView:p.ground.modelViewMatrix.clone(),normal:p.ground.normalMatrix.clone(),needs:p.ground.matrixWorldNeedsUpdate};
    const visible=p.drawables.map(o=>[o,o.visible]),shadowFlags=[p.shadow.autoUpdate,p.shadow.needsUpdate],epoch=resourceEpoch,gen=generation;
    const began=performance.now();let good=false,restored=false;
    try{
      p.ground.material=capture;for(const [o]of visible)if(o!==p.ground)o.visible=false;
      renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;p.shadow.autoUpdate=false;p.shadow.needsUpdate=false;renderer.info.autoReset=false;
      renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.autoClear=false;renderer.setClearColor(0,0);renderer.state.buffers.color.setMask(true);
      check(gpu('checkFramebufferStatus',gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'R32F framebuffer incomplete');record.resources={width:target.width,height:target.height,colorInternalFormat:'R32F',colorBytes:target.width*target.height*4,depthWidth:target.width,depthHeight:target.height,depthBits:gpu('getParameter',gl.DEPTH_BITS),estimatedDepthBytes:target.width*target.height*4,samples:0};renderer.clear(true,true,true);engineCall(originalRender,[scene,camera],'capture render');
      check(gpu('getError')===gl.NO_ERROR&&!lost,'R32F capture GL error');record.buildSubmitMs=performance.now()-began;
      p.ground.material=cached;for(const [o,v]of visible)o.visible=v;p.shadow.autoUpdate=shadowFlags[0];p.shadow.needsUpdate=shadowFlags[1];restore(s);
      const compileBegan=performance.now();engineCall(originalCompile,[scene,camera],'cache compile');record.compileSubmitMs=performance.now()-compileBegan;check(compiles>0,'cache shader was not compiled');check(gpu('getError')===gl.NO_ERROR,'cache compile GL error');
      check(epoch===resourceEpoch&&gen===generation&&!lost,'resource/context changed during build');
      good=true;record.cacheCompiles=compiles;
    }finally{p.ground.matrix.copy(matrixState.matrix);p.ground.matrixWorld.copy(matrixState.world);p.ground.modelViewMatrix.copy(matrixState.modelView);p.ground.normalMatrix.copy(matrixState.normal);p.ground.matrixWorldNeedsUpdate=matrixState.needs;p.ground.material=p.material;for(const [o,v]of visible)o.visible=v;p.shadow.autoUpdate=shadowFlags[0];p.shadow.needsUpdate=shadowFlags[1];try{try{restore(s);restored=true;}catch(error){good=false;try{restore(s);restored=true;}catch{}throw error;}}finally{if(!good||!restored)disposeResources(resources);}}
    cache={...resources,key:p.key,ground:p.ground,material:p.material,epoch,gen};stats.builds++;record.built=true;record.buildTotalSubmitMs=performance.now()-buildBegan;gpuPhase='hit';
  }
  function original(sceneArg,cameraArg,record){const at=performance.now();const value=engineCall(originalRender,[sceneArg,cameraArg],'scene render');record.renderSubmitMs=(record.renderSubmitMs||0)+performance.now()-at;return value;}
  function fallbackAfterFailedHit(p,record){
    // Still inside the product withRenderRegion transaction. Remove any partial
    // failed candidate output, then reapply exactly its current scissor.
    const s=p.state;renderer.setScissorTest(false);renderer.state.buffers.color.setMask(true);renderer.setClearAlpha(s.alpha);renderer.clear(true,true,true);renderer.setScissor(s.scissor);renderer.setScissorTest(s.test);stats.fallbacks++;record.fallback=true;return original(scene,camera,record);
  }
  function wrapped(sceneArg,cameraArg){
    check(!stats.requiresRendererRecreation,'renderer requires recreation after interrupted Three render/compile');
    if(disposed)return originalRender.call(this,sceneArg,cameraArg);
    if(bypass){if(sceneArg!==scene||cameraArg!==camera)invalidate('foreign reference render');return engineCall(originalRender,[sceneArg,cameraArg],'reference/foreign render');}
    if(busy)fail('nested render during cache transaction');
    if(sceneArg!==scene||cameraArg!==camera){invalidate('foreign render');return engineCall(originalRender,[sceneArg,cameraArg],'reference/foreign render');}
    const record={frame:++stats.frames,hit:false,built:false},began=performance.now();busy=true;
    try{
      if(!enabled){record.reason='disabled';return original(sceneArg,cameraArg,record);}
      let p;const inspectBegan=performance.now();try{p=inspect();record.signatureMs=performance.now()-inspectBegan;record.effectiveCasterCount=p.effectiveCasterCount;}catch(error){record.reason=String(error.message||error);invalidate(record.reason);return original(sceneArg,cameraArg,record);}
      if(cache&&cache.key===p.key&&cache.gen===generation&&cache.epoch===resourceEpoch){
        const saved=state(),localCache=cache;let error,result;
        try{p.ground.material=cache.cached;result=original(sceneArg,cameraArg,record);check(!lost&&cache===localCache&&generation===localCache.gen&&resourceEpoch===localCache.epoch,'cached draw resource/context generation changed');}catch(e){error=e;}finally{p.ground.material=p.material;try{restore(saved);}catch(e){error=e;record.restoreFailed=true;}}
        if(error){record.reason=String(error.message||error);stats.errors.push(record.reason);invalidate(record.reason);if(stats.requiresRendererRecreation){if(record.restoreFailed)try{restore(saved);}catch{}throw fatalError;}if(record.restoreFailed)restore(saved);return fallbackAfterFailedHit(p,record);}
        stats.hits++;record.hit=true;return result;
      }
      if(cache)discard();
      const value=original(sceneArg,cameraArg,record);flushDisposal();
      try{const post=inspect();stable=post.key===lastKey?stable+1:1;lastKey=post.key;record.stable=stable;
        if(stable>=stableFrames)build(post,record);else record.reason='dependencies not yet stable';
      }catch(error){record.reason=String(error.message||error);stats.errors.push(record.reason);invalidate(record.reason);if(stats.requiresRendererRecreation)throw fatalError;}
      return value;
    }finally{gpuPhase='hit';busy=false;if(stats.requiresRendererRecreation)invalidate('renderer requires recreation');flushDisposal();record.totalSubmitMs=performance.now()-began;record.drawCalls=renderer.info.render.calls;record.infoFrame=renderer.info.render.frame;addRecord(record);}
  }
  function onLost(){lost=true;generation++;stats.contextGeneration=generation;invalidate('context-lost');}
  function onRestored(){lost=false;const phase=gpuPhase;gpuPhase='init';supported=!!gpu('getExtension','EXT_color_buffer_float')&&!!gpu('getExtension','EXT_float_blend');gpuPhase=phase;attachMirror();generation++;stats.contextGeneration=generation;invalidate('context-restored');}
  renderer.domElement.addEventListener('webglcontextlost',onLost);renderer.domElement.addEventListener('webglcontextrestored',onRestored);renderer.render=wrapped;
  return{stats,invalidate,setEnabled(value){enabled=!!value;stats.enabled=enabled;invalidate('enabled changed');},snapshot(){return JSON.parse(JSON.stringify(stats));},withOriginal(callback){check(!stats.requiresRendererRecreation,'renderer requires recreation');check(!busy,'reference during transaction');check(callback.constructor.name!=='AsyncFunction','reference callback must be synchronous');bypass++;try{const value=callback();check(!value?.then,'reference callback must be synchronous');return value;}finally{bypass--;}},setAlphaGain(value){if(!Number.isFinite(value)||value<0||value>1)throw Error('Invalid diagnostic gain');alphaGain.value=value;},dispose(){if(disposed)return;disposed=true;if(renderer.render===wrapped)renderer.render=originalRender;renderer.domElement.removeEventListener('webglcontextlost',onLost);renderer.domElement.removeEventListener('webglcontextrestored',onRestored);discard();flushDisposal();detachMirror();},inspect(){try{return{eligible:true,key:inspect().key};}catch(error){return{eligible:false,reason:String(error.message||error)};}}};
}
