/** Install in a separate correctness-only page. No code in this file is called
 * during timing. Candidate always renders FIRST, then original bypass without
 * invalidating/destroying the candidate. All comparisons use zero RGBA tolerance. */
export function installCorrectnessHarness(){
 const r=globalThis.__diceProfileRenderer,T=globalThis.__diceProfileThree,p=globalThis.__diceGroundMaskSequenceProbe;
 if(!r||!T||!p||!globalThis.__diceSequenceConfig?.fixedClock)throw Error('Missing frozen real renderer/probe');
 const ground=r.scene.children.find(o=>o.material instanceof T.ShadowMaterial),light=r.scene.children.find(o=>o.isDirectionalLight&&o.castShadow);
 if(!ground||!light)throw Error('Verified default ground/light missing');
 const state={step:0,rows:[],restores:[],activeId:null,age:0};
 const fail=message=>{throw Error(message);};
 const resetMutations=()=>{for(const restore of state.restores.splice(0).reverse())restore();globalThis.__diceSequenceBeforeRender=undefined;};
 const save=(object,key)=>{const value=object[key];state.restores.push(()=>{object[key]=value;});};
 const vector=(object,key)=>{const value=object[key].clone();state.restores.push(()=>{object[key].copy(value);object.updateMatrix?.();object.updateMatrixWorld?.(true);});};
 const draw=()=>{cancelAnimationFrame(r.frameHandle);r.frameHandle=0;r.last=globalThis.__diceSequenceTime-16;r.drawFrame();if(p.stats.requiresRendererRecreation)fail('Fatal Three interruption requires new renderer: '+p.stats.fatalReason);};
 function read(){
  const gl=r.gl.getContext();if(gl.isContextLost())fail('Lost WebGL context during comparison');
  const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,rgba=new Uint8Array(width*height*4);
  gl.finish();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);if(gl.getError()!==gl.NO_ERROR)fail('WebGL render/readback error');
  const layers=[...document.querySelectorAll('canvas')].filter(canvas=>canvas!==r.gl.domElement).map((canvas,index)=>{const context=canvas.getContext('2d');if(!context)return null;return {index,width:canvas.width,height:canvas.height,className:canvas.className,contextAttributes:context.getContextAttributes?.()??null,rgba:context.getImageData(0,0,canvas.width,canvas.height).data};}).filter(Boolean);
  return {width,height,rgba,layers};
 }
 function inputIdentity(){return JSON.stringify({time:globalThis.__diceSequenceTime,projection:r.projection,devicePixelRatio,active:r.active.map(active=>({id:active.roll.request.id,age:(globalThis.__diceSequenceTime-active.start)/1000,seed:active.roll.request.seed,kinds:active.roll.kinds,results:active.roll.results,finalPoses:Array.from(active.roll.poses.slice(-active.meshes.length*7)),cue:active.cue,formulaData:active.roll.formulaData}))});}
 function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
 function png(){return r.gl.domElement.toDataURL('image/png');}
 function compare(a,b){
  if(a.length!==b.length)fail('Pixel surface dimensions changed within comparison');
  let differentChannels=0,differentPixels=0,maxDelta=0;const perChannel=[0,0,0,0],firstDifferences=[];
  for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){changed=true;differentChannels++;perChannel[c]++;maxDelta=Math.max(maxDelta,delta);}}if(changed){differentPixels++;if(firstDifferences.length<8)firstDifferences.push({index:i/4,candidate:Array.from(a.slice(i,i+4)),original:Array.from(b.slice(i,i+4))});}}
  return {exact:differentChannels===0,differentChannels,differentPixels,maxDelta,perChannel,firstDifferences};
 }
 function select(id,age){
  const active=r.active.find(a=>a.roll.request.id.startsWith(id));if(!active)fail('Real active roll missing: '+id);
  state.activeId=id;state.age=age;globalThis.__diceSequenceTime=active.start+age*1000;
  r.projection.pixelsPerDie=r.targetPixelsPerDie;r.layout();
  return active;
 }
 function run({name,id=state.activeId,age=state.age,capture=false,negative=false,expectEmpty=false,originalOnly=false}){
  if(id)select(id,age);
  const compact=()=>{const snapshot=p.snapshot(),{records,...counters}=snapshot;return {...counters,lastRecord:records?.at(-1)??null};};
  const before=compact();if(originalOnly)p.withOriginal(draw);else draw();const after=compact(),candidateDrawCalls=r.gl.info.render.calls,candidate=read(),candidatePng=png(),candidateInputs=inputIdentity();
  let reference,referenceInputs,originalDrawCalls;p.withOriginal(()=>{draw();originalDrawCalls=r.gl.info.render.calls;reference=read();referenceInputs=inputIdentity();});
  const rgba=compare(candidate.rgba,reference.rgba),referencePng=capture||negative||!rgba.exact?png():null;
  if(candidate.layers.length!==reference.layers.length)fail('Cue canvas count changed in bypass');
  const layers=candidate.layers.map((layer,index)=>{const ref=reference.layers[index];if(layer.width!==ref.width||layer.height!==ref.height||layer.className!==ref.className)fail('Cue canvas identity changed');return {className:layer.className,width:layer.width,height:layer.height,contextAttributes:layer.contextAttributes,referenceContextAttributes:ref.contextAttributes,...compare(layer.rgba,ref.rgba)};});
  const bodies=r.active.flatMap(active=>active.meshes),known=new Set([ground,...bodies,...bodies.flatMap(body=>body.children.filter(child=>child.userData.diceDecoration))]),unknownVisibleDrawables=[];r.scene.traverseVisible(object=>{if((object.isMesh||object.isLine||object.isPoints||object.isSprite)&&!known.has(object))unknownVisibleDrawables.push({name:object.name,type:object.type});});
  const nonzeroAlpha=candidate.rgba.reduce((sum,value,i)=>sum+(i%4===3&&value>0?1:0),0);
  const record={name,step:state.step++,id,age,time:globalThis.__diceSequenceTime,width:candidate.width,height:candidate.height,rgba,layers,nonzeroAlpha,unknownVisibleDrawables,statsBefore:before,statsAfter:after,readback2D:globalThis.__diceSequenceConfig.readback2D??'default',originalOnly,logicalInputsSame:candidateInputs===referenceInputs,logicalInputs:JSON.parse(candidateInputs),referenceLogicalInputs:candidateInputs===referenceInputs?undefined:JSON.parse(referenceInputs),drawCalls:{candidate:candidateDrawCalls,original:originalDrawCalls},renderPath:originalOnly?'original-bypass':after.eligibleFrames>before.eligibleFrames?'masked':'original-fallback',negative,expectEmpty,images:[]};
  if(capture||negative||!rgba.exact||layers.some(layer=>!layer.exact))record.images.push({name:'candidate-first',png:candidatePng});if(referencePng)record.images.push({name:'original-bypass-reference',png:referencePng});
  for(let index=0;index<layers.length;index++)if(!layers[index].exact){for(const [label,layer] of [['candidate-first',candidate.layers[index]],['original-reference',reference.layers[index]]])record.images.push({name:label+'-layer-'+index+'-'+layer.className,width:layer.width,height:layer.height,rgbaBase64:base64(layer.rgba),encoding:'Lossless PNG from observed RGBA bytes; no Canvas2D re-encoding'});}
  record.exact=rgba.exact&&layers.every(layer=>layer.exact);record.pass=(negative?!rgba.exact:record.exact)&&record.logicalInputsSame&&candidateDrawCalls===originalDrawCalls;
  if(expectEmpty&&nonzeroAlpha!==0)record.pass=false;
  state.rows.push(record);return record;
 }
 function mutate(name){
  resetMutations();const bodies=r.active.flatMap(a=>a.meshes),body=bodies[0];
  const post=fn=>{globalThis.__diceSequenceBeforeRender=fn;};
  const projection=()=>{state.restores.push(()=>r.layout());};
  switch(name){
   case 'none':break;
   case 'body-position':post(()=>{body.position.x+=.18;});break;
   case 'body-presence':post(()=>{body.visible=false;body.castShadow=false;});break;
   case 'hidden-parent':save(body.parent,'visible');body.parent.visible=false;break;
   case 'body-cast-shadow':post(()=>{body.castShadow=false;});break;
   case 'body-layer':save(body.layers,'mask');body.layers.set(1);break;
   case 'camera-world':vector(r.camera,'position');r.camera.position.x+=.12;r.camera.updateMatrixWorld(true);break;
   case 'camera-projection':projection();r.camera.zoom=1.03;state.restores.push(()=>{r.camera.zoom=1;r.camera.updateProjectionMatrix();});r.camera.updateProjectionMatrix();break;
   case 'camera-layer':save(r.camera.layers,'mask');r.camera.layers.enable(1);break;
   case 'scene-world':vector(r.scene,'position');r.scene.position.x+=.08;break;
   case 'light-position':vector(light,'position');light.position.x+=.3;break;
   case 'light-target':vector(light.target,'position');light.target.position.x+=.2;light.target.updateMatrixWorld(true);break;
   case 'light-intensity':save(light,'intensity');light.intensity*=.9;break;
   case 'shadow-intensity':save(light.shadow,'intensity');light.shadow.intensity=.8;break;
   case 'shadow-bias':save(light.shadow,'bias');light.shadow.bias-=.0001;break;
   case 'shadow-normal-bias':save(light.shadow,'normalBias');light.shadow.normalBias+=.01;break;
   case 'shadow-radius':save(light.shadow,'radius');light.shadow.radius+=.5;break;
   case 'shadow-resolution':{const size=light.shadow.mapSize.clone();state.restores.push(()=>{light.shadow.map?.dispose();light.shadow.map=null;light.shadow.mapSize.copy(size);});light.shadow.map?.dispose();light.shadow.map=null;light.shadow.mapSize.set(1024,1024);break;}
   case 'shadow-frame-extents':{const extents=light.shadow.getFrameExtents(),saved=extents.clone();state.restores.push(()=>{extents.copy(saved);light.shadow.map?.dispose();light.shadow.map=null;});extents.set(2,1);light.shadow.map?.dispose();light.shadow.map=null;break;}
   case 'shadow-viewport':{const viewport=light.shadow.getViewport(0),saved=viewport.clone();state.restores.push(()=>viewport.copy(saved));viewport.z*=.8;break;}
   case 'shadow-map-dispose':light.shadow.map?.dispose();light.shadow.map=null;break;
   case 'ground-opacity':save(ground.material,'opacity');ground.material.opacity=.27;break;
   case 'ground-position':vector(ground,'position');ground.position.y-=.02;break;
   case 'ground-geometry-position':
   case 'ground-geometry-normal':
   case 'ground-geometry-index':{const key=name.split('-').at(-1),geometry=ground.geometry,attribute=key==='index'?geometry.index:geometry.getAttribute(key),saved=attribute.array.slice();state.restores.push(()=>{attribute.array.set(saved);attribute.needsUpdate=true;});if(key==='index'){const first=attribute.array[0];attribute.array[0]=attribute.array[1];attribute.array[1]=first;}else attribute.array[0]+=.04;attribute.needsUpdate=true;break;}
   case 'viewport':{const view=r.gl.getViewport(new T.Vector4());state.restores.push(()=>r.gl.setViewport(view));r.gl.setViewport(3,0,Math.max(1,view.z-3),view.w);break;}
   case 'dpr':{const ratio=r.gl.getPixelRatio();state.restores.push(()=>{r.gl.setPixelRatio(ratio);r.resize();});r.gl.setPixelRatio(1.25);r.resize();break;}
   case 'same-size-canvas':r.gl.domElement.width=r.gl.domElement.width;break;
   case 'clear':{const color=r.gl.getClearColor(new T.Color()),alpha=r.gl.getClearAlpha();state.restores.push(()=>r.gl.setClearColor(color,alpha));r.gl.setClearColor(0x17212a,.25);break;}
   default:fail('Unknown mutation '+name);
  }
 }
 function depthWitness(){
  // A separate scene exists only AFTER mask eligibility and the ordinary frame.
  // It never enters renderRegion.get(), so cannot force an unknown-mesh fallback.
  resetMutations();select(state.activeId,state.age);draw();
  const mask=p.mask,snapshot=mask.snapshot(),base=read(),dpr=r.gl.getPixelRatio(),region=globalThis.__diceMaskMainRegion;
  if(!snapshot.valid||!snapshot.eligible||snapshot.originalMaterial||!region)fail('Depth witness requires a genuinely active mask and nonempty normal scissor');
  const rects=snapshot.physicalRects,box={x:Math.ceil(region.x*dpr),y:Math.ceil(region.y*dpr),right:Math.floor((region.x+region.width)*dpr),top:Math.floor((region.y+region.height)*dpr)},margin=12;
  let pixel=null;
  for(let y=box.y+margin;y<box.top-margin&&!pixel;y+=4)for(let x=box.x+margin;x<box.right-margin;x+=4)if(rects.every(rect=>x+margin<rect[0]||x-margin>rect[2]||y+margin<rect[1]||y-margin>rect[3])){pixel={x,y};break;}
  if(!pixel)fail('No receiver point inside normal scissor but outside all mask rectangles with witness margin');
  const normal=new T.Vector3(0,0,1).applyNormalMatrix(new T.Matrix3().getNormalMatrix(ground.matrixWorld));
  const point=new T.Vector3().setFromMatrixPosition(ground.matrixWorld).addScaledVector(normal,-.1),plane=new T.Plane().setFromNormalAndCoplanarPoint(normal,point);
  const raycaster=new T.Raycaster();raycaster.setFromCamera(new T.Vector2((pixel.x+.5)/base.width*2-1,(pixel.y+.5)/base.height*2-1),r.camera);
  const location=new T.Vector3();if(!raycaster.ray.intersectPlane(plane,location))fail('Witness camera ray misses plane below receiver');
  const size=4*(r.camera.right-r.camera.left)/r.camera.zoom/base.width,geometry=new T.PlaneGeometry(size,size),material=new T.MeshBasicMaterial({color:0xff00ff,side:T.DoubleSide,depthTest:true,depthWrite:false,toneMapped:false});
  const mesh=new T.Mesh(geometry,material),scene=new T.Scene();mesh.position.copy(location);ground.getWorldQuaternion(mesh.quaternion);scene.add(mesh);scene.updateMatrixWorld(true);
  const projectedCorners=[];for(let i=0;i<4;i++){const q=new T.Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld).project(r.camera);projectedCorners.push({x:(q.x+1)*base.width*.5,y:(q.y+1)*base.height*.5});}
  if(projectedCorners.some(q=>q.x<=box.x||q.x>=box.right||q.y<=box.y||q.y>=box.top||rects.some(rect=>q.x>=rect[0]&&q.x<=rect[2]&&q.y>=rect[1]&&q.y<=rect[3])))fail('Witness geometry escaped verified outside-mask scissor point');
  const probe=()=>{const auto=r.gl.autoClear,test=r.gl.getScissorTest();try{r.gl.autoClear=false;r.gl.setScissorTest(false);r.gl.render(scene,r.camera);return read();}finally{r.gl.autoClear=auto;r.gl.setScissorTest(test);}};
  const candidate=probe(),candidatePng=png();let originalBase,original,originalPng,negativeBase,negative,negativePng,negativeGroundDepthWrite;
  try{
   p.withOriginal(()=>{draw();originalBase=read();original=probe();originalPng=png();});
   const materials=[mask.originalMaterial,mask.maskedMaterial].filter(Boolean),saved=materials.map(m=>m.depthWrite);
   try{materials.forEach(m=>{m.depthWrite=false;});p.withOriginal(()=>{draw();negativeGroundDepthWrite=ground.material.depthWrite;negativeBase=read();negative=probe();negativePng=png();});}finally{materials.forEach((m,i)=>{m.depthWrite=saved[i];});}
   const sample=(image)=>{const at=(pixel.y*image.width+pixel.x)*4;return Array.from(image.rgba.slice(at,at+4));};
   const candidateUnchanged=compare(base.rgba,candidate.rgba),originalUnchanged=compare(originalBase.rgba,original.rgba),equivalence=compare(candidate.rgba,original.rgba),negativeChange=compare(negativeBase.rgba,negative.rgba),negativePixel=sample(negative);
   const negativeVisible=negativeGroundDepthWrite===false&&negativeChange.differentPixels>0&&negativePixel[0]>200&&negativePixel[1]<30&&negativePixel[2]>200&&negativePixel[3]>200;
   return {name:'outside-mask-alpha-zero-depth-witness',pass:candidateUnchanged.exact&&originalUnchanged.exact&&equivalence.exact&&negativeVisible,pixel,projectedCorners,groundNormal:normal.toArray(),belowGroundWorldDistance:.1,mainScissor:box,physicalRects:rects,mask:snapshot,candidateUnchanged,originalUnchanged,equivalence,negativeChange,negativeVisible,negativeGroundDepthWrite,pixels:{candidate:sample(candidate),original:sample(original),negative:negativePixel},readback2D:globalThis.__diceSequenceConfig.readback2D,probeAddedAfterEligibility:true,probeUsesSeparateScene:true,probeAutoClear:false,probeScissorDisabled:true,images:[{name:'candidate-depth-retained',png:candidatePng},{name:'original-depth-retained',png:originalPng},{name:'negative-depthwrite-false',png:negativePng}]};
  }finally{geometry.dispose();material.dispose();}
 }
 function end(){resetMutations();const final=Math.max(...r.active.map(a=>a.start+a.cue.diceExit*1000))+50;globalThis.__diceSequenceTime=final;state.activeId=null;return run({name:'empty-final-frame',id:null,expectEmpty:true,capture:true});}
 globalThis.__diceSequenceCorrectness={state,run,mutate,resetMutations,select,end,read,draw,depthWitness,getPlan(id){const active=r.active.find(a=>a.roll.request.id.startsWith(id));if(!active)fail('Missing roll');return {physicalCount:active.meshes.length,frames:active.roll.frames,fps:active.roll.fps,settled:active.cue.settled,diceExit:active.cue.diceExit,firstBeam:active.cue.firstBeam,firstReveal:active.cue.beams[0]?.reveal,clamps:active.roll.formulaData?.timeline?.clamps||[]};}};
 return {ready:true};
}
