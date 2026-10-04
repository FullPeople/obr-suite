/** Install in a separate correctness-only page. No code in this file is called
 * during timing. Candidate always renders FIRST, then original bypass without
 * invalidating/destroying the candidate. All comparisons use zero RGBA tolerance. */
export function installCorrectnessHarness(){
 const r=globalThis.__diceProfileRenderer,T=globalThis.__diceProfileThree,p=globalThis.__diceGroundLiveProbe;
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
  const layers=[...document.querySelectorAll('canvas')].filter(canvas=>canvas!==r.gl.domElement).map((canvas,index)=>{const context=canvas.getContext('2d');if(!context)return null;return {index,width:canvas.width,height:canvas.height,className:canvas.className,rgba:context.getImageData(0,0,canvas.width,canvas.height).data};}).filter(Boolean);
  return {width,height,rgba,layers};
 }
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
 function run({name,id=state.activeId,age=state.age,capture=false,negative=false,expectEmpty=false}){
  if(id)select(id,age);
  const compact=()=>{const snapshot=p.snapshot(),{records,...counters}=snapshot;return {...counters,lastRecord:records?.at(-1)??null};};
  const before=compact();draw();const after=compact(),candidate=read(),candidatePng=png();
  let reference;p.withOriginal(()=>{draw();reference=read();});
  const rgba=compare(candidate.rgba,reference.rgba),referencePng=capture||negative||!rgba.exact?png():null;
  if(candidate.layers.length!==reference.layers.length)fail('Cue canvas count changed in bypass');
  const layers=candidate.layers.map((layer,index)=>{const ref=reference.layers[index];if(layer.width!==ref.width||layer.height!==ref.height||layer.className!==ref.className)fail('Cue canvas identity changed');return {className:layer.className,width:layer.width,height:layer.height,...compare(layer.rgba,ref.rgba)};});
  const bodies=r.active.flatMap(active=>active.meshes),known=new Set([ground,...bodies,...bodies.flatMap(body=>body.children.filter(child=>child.userData.diceDecoration))]),unknownVisibleDrawables=[];r.scene.traverseVisible(object=>{if((object.isMesh||object.isLine||object.isPoints||object.isSprite)&&!known.has(object))unknownVisibleDrawables.push({name:object.name,type:object.type});});
  const nonzeroAlpha=candidate.rgba.reduce((sum,value,i)=>sum+(i%4===3&&value>0?1:0),0);
  const record={name,step:state.step++,id,age,time:globalThis.__diceSequenceTime,width:candidate.width,height:candidate.height,rgba,layers,nonzeroAlpha,unknownVisibleDrawables,statsBefore:before,statsAfter:after,renderPath:after.hits>before.hits?'cache-hit':after.builds>before.builds?'original-plus-build':'original-fallback',negative,expectEmpty,images:[]};
  if(capture||negative||!rgba.exact||layers.some(layer=>!layer.exact))record.images.push({name:'candidate-first',png:candidatePng});if(referencePng)record.images.push({name:'original-bypass-reference',png:referencePng});
  record.exact=rgba.exact&&layers.every(layer=>layer.exact);record.pass=negative?!rgba.exact:record.exact;
  if(expectEmpty&&(nonzeroAlpha!==0||after.resources?.liveTargets!==0))record.pass=false;
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
 function end(){resetMutations();const final=Math.max(...r.active.map(a=>a.start+a.cue.diceExit*1000))+50;globalThis.__diceSequenceTime=final;state.activeId=null;return run({name:'empty-final-frame',id:null,expectEmpty:true,capture:true});}
 globalThis.__diceSequenceCorrectness={state,run,mutate,resetMutations,select,end,read,draw,negative(enabled){p.setAlphaGain(enabled?0:1);},getPlan(id){const active=r.active.find(a=>a.roll.request.id.startsWith(id));if(!active)fail('Missing roll');return {physicalCount:active.meshes.length,frames:active.roll.frames,fps:active.roll.fps,settled:active.cue.settled,diceExit:active.cue.diceExit,firstBeam:active.cue.firstBeam,firstReveal:active.cue.beams[0]?.reveal,clamps:active.roll.formulaData?.timeline?.clamps||[]};}};
 return {ready:true};
}
