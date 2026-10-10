import {DiceRenderRegion,withRenderRegion} from './render-region';
import {beginOverlayFrame} from './shared-overlay-canvas';
import {recoverPlaybackStart} from './playback-clock';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {url,now,type Catalog,type Kind,type Roll,type Theme,type ThemeID} from './types';
import {buildCue,BEAM_RECOIL,type Cue} from './cue';
import {CueRenderer} from './cue-renderer';
import {buildImpactPlan,rollingActivity,AUDIO_MAPPING,type AudioImpact} from './audio-map';
import {projectionPan} from './audio';
import {lowestHullPoint,angularSpeedBetween,projectVisual,VISUAL_PER_METER,makeProjection,fitPixelsPerDie} from './native';
import {validBodyColor} from './player-color.mjs';
import {presentationTheme} from './material-styles';
import {createDiceMaterial,instanceDiceMaterial,addSketchOutline,disposeDiceDecorations} from './dice-materials';
import {addDynamicOutline} from './dynamic-decorations';
import {questionMask} from './question-mask';
import {decodeGlyphTexture} from './glyph-texture';
import {createVerifiedTextureLoader} from './verified-texture-loader';
import {diePresence} from './die-presence';
import {DiceAssets} from './asset-loading';
import {cueSlots} from './cue-layout';
export interface RollPresentation{cue:Cue;show?:CueRenderer;births?:number[];ruleSounds?:AudioPlan['rules'];onPrepare?:(meshes:T.Mesh[])=>void;onFrame?:(age:number,meshes:T.Mesh[])=>void;onDispose?:()=>void}
type Active={roll:Roll;meshes:T.Mesh[];start:number;released:boolean;settled:boolean;cue:Cue;show:CueRenderer;slot:number;failures?:number;births?:number[];onFrame?:RollPresentation['onFrame'];onDispose?:()=>void};
/** Everything the panel's audio engine needs, derived once from the authoritative trace. */
export interface AudioPlan{impacts:AudioImpact[];hits:{t:number;ordinal:number;maximumFace:boolean}[];
  rules?:{t:number;kind:'max'|'min';pan:number}[];
  stinger:'one'|'twenty'|null;stingerAt:number;duration:number;
  rolling:{activity:Float32Array;pan:Float32Array;step:number};
  suppressed:number;merged:number;voices:number}
/**
 * Ordinary throws use the native desktop projection (13% of the shorter edge, clamped 120–210).
 * Dense tables fit all published physical bounds with a smooth camera transition; hulls never scale.
 * The native mapping has screen right +x and screen up tilted +z. A parent mirrors the complete
 * rigid transform, not only the translation. Audio pan and cue origins use that same projection.
 */
const COS_TILT=Math.cos(0.1745329252),SIN_TILT=Math.sin(0.1745329252);
const CAM_DISTANCE=44;
export class DiceRenderer {
  readonly gl:T.WebGLRenderer;
  readonly scene=new T.Scene();
  /** Mirror the complete rigid transform, not translation alone. Physics and rendered contact
   * surfaces must agree at every orientation; Three handles this parent's negative determinant. */
  private readonly diceSpace=new T.Group();
  readonly camera=new T.OrthographicCamera(-4,4,4,-4,.1,150);
  /** Native projection mirror of the layer, exposed for probes and for the result cue. */
  projection={width:0,height:0,pixelsPerDie:120};
  private geometry=new Map<Kind,T.BufferGeometry>();
  private materials=new Map<string,T.MeshPhysicalMaterial>();
  private readonly warmPrograms=new T.Group();
  private active:Active[]=[];
  private ready=false;
  private frameHandle=0;private contextLost=false;private contextGeneration=0;private suspendedAt=0;private contextTimer:ReturnType<typeof setTimeout>|undefined;private frameFailures=0;
  private last=0;
  private targetPixelsPerDie=120;
  private readonly rendererSize=new T.Vector2();
  private renderRegion!:DiceRenderRegion;
  private frames:number[]=[];
  private longTasks:number[]=[];
  private lastMetrics=0;
  private idleReported=false;
  private observer?:PerformanceObserver;
  private metricsSince=performance.now();
  private q0=new T.Quaternion();private q1=new T.Quaternion();
  constructor(private container:HTMLElement,private catalog:Catalog,private emit:(event:string,detail:any)=>void,private assets=new DiceAssets()){
    this.gl=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
    this.gl.setClearColor(0,0);this.gl.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.gl.outputColorSpace=T.SRGBColorSpace;this.gl.toneMapping=T.ACESFilmicToneMapping;this.gl.toneMappingExposure=1;
    this.gl.shadowMap.enabled=true;this.gl.shadowMap.type=T.PCFShadowMap;
    this.gl.domElement.className='dice-canvas';container.appendChild(this.gl.domElement);
    this.gl.domElement.style.opacity='0';
    this.diceSpace.scale.x=-1;this.scene.add(this.diceSpace);
    const pause=()=>{if(this.suspendedAt)return;this.suspendedAt=now();if(this.frameHandle)cancelAnimationFrame(this.frameHandle);this.frameHandle=0;for(const a of this.active)this.emit('render-paused',{roll:a.roll.request.id});};
    const resume=()=>{if(this.contextLost||document.hidden)return;const time=now();if(this.suspendedAt){for(const a of this.active){a.start+=Math.max(0,time-Math.max(this.suspendedAt,a.start));this.emit('render-retimed',{roll:a.roll.request.id,start:a.start});}this.suspendedAt=0;}this.last=time;this.wake();};
    document.addEventListener('visibilitychange',()=>document.hidden?pause():resume());
    this.gl.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextGeneration++;this.contextLost=true;pause();this.emit('render-context-lost',{active:this.active.length});clearTimeout(this.contextTimer);this.contextTimer=setTimeout(()=>{if(this.contextLost)this.emit('error',{message:'图形上下文尚未恢复，投骰动画暂停；已生成结果保留。请恢复浏览器窗口，必要时刷新。'});},10000);});
    this.gl.domElement.addEventListener('webglcontextrestored',()=>{void this.restoreContext(resume);});
    this.camera.up.set(0,1,0);
    this.camera.position.set(0,COS_TILT*CAM_DISTANCE,-SIN_TILT*CAM_DISTANCE);
    this.camera.lookAt(0,0,0);
    this.layout();
    const ambient=new T.HemisphereLight(0xffffff,0x667078,1.35);this.scene.add(ambient);
    const key=new T.DirectionalLight(0xfffaf2,2.2);key.position.set(-2.4,9,4.2);key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.5,far:40});
    key.shadow.bias=-.0003;key.shadow.normalBias=.02;this.scene.add(key);
    const rim=new T.DirectionalLight(0xe2edff,.65);rim.position.set(3,4.4,-5);this.scene.add(rim);
    const pmrem=new T.PMREMGenerator(this.gl),room=new RoomEnvironment();this.scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
    const ground=new T.Mesh(new T.PlaneGeometry(38,22),new T.ShadowMaterial({opacity:.32}));ground.rotation.x=-Math.PI/2;ground.position.y=-.015;ground.receiveShadow=true;this.scene.add(ground);
    this.renderRegion=new DiceRenderRegion(this.scene,this.camera,key,ground);
    new ResizeObserver(()=>this.resize()).observe(container);this.resize();
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')){this.observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.startTime>=this.metricsSince)this.longTasks.push(e.duration);if(this.longTasks.length>5000)this.longTasks.splice(0,1000)});this.observer.observe({entryTypes:['longtask']})}
  }
  async init(){
    const loader=new GLTFLoader();
    const kinds=Object.keys(this.catalog.dice) as Kind[];
    // 31 assets; a sequential walk made the ready wait several round trips longer than needed.
    const geometryReady=Promise.all(kinds.map(async kind=>{
      const path=this.catalog.dice[kind].model;
      const gltf=await loader.parseAsync(await this.assets.bytes(path),url('')).catch(error=>{throw Error(`模型解析 ${url(path)}: ${String(error)}`);});
      const mesh=gltf.scene.getObjectByName('RenderMesh') as T.Mesh;
      if(!mesh?.isMesh||!mesh.geometry.getAttribute('uv1'))throw Error(`模型缺少 RenderMesh/数字 UV: ${kind}`);
      const geo=mesh.geometry.clone();geo.scale(40,40,40);geo.computeBoundingSphere();geo.setAttribute('diceGlyph',geo.getAttribute('uv1'));this.geometry.set(kind,geo);
    }));
    const loadMask=createVerifiedTextureLoader(this.assets,async bytes=>{const mask=await decodeGlyphTexture(bytes);
      mask.needsUpdate=true;
      mask.flipY=false;mask.anisotropy=Math.min(8,this.gl.capabilities.getMaxAnisotropy());return mask;});
    const materialsReady=Promise.all(Object.values(this.catalog.themes).flatMap(theme=>kinds.map(async kind=>{
      const path=theme.masks[kind],mask=await loadMask(path).catch(error=>{throw Error(`贴图解码 ${url(path)}: ${String(error)}`);});
      this.materials.set(`${theme.id}:${kind}`,createDiceMaterial(theme,mask));
    })));
    await Promise.all([geometryReady,materialsReady]);
    for(const kind of kinds){const mask=questionMask(kind);mask.anisotropy=Math.min(8,this.gl.capabilities.getMaxAnisotropy());
      for(const theme of Object.values(this.catalog.themes))this.materials.set(`${theme.id}:${kind}:hidden`,createDiceMaterial(theme,mask));}
    // Compile every shader variant while the layer is transparent, before ready ACK.
    this.assets.stage('正在首次编译渲染');
    const warm:T.Mesh[]=[];for(const [key,material] of this.materials){const [id,kind]=key.split(':') as [ThemeID,Kind];const geometry=this.geometry.get(kind)!;const m=new T.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;if(this.catalog.themes[id].style==='sketch')addSketchOutline(m,geometry);else addDynamicOutline(m,geometry,this.catalog.themes[id].style!);warm.push(m);this.diceSpace.add(m)}
    await this.gl.compileAsync(this.scene,this.camera);this.gl.render(this.scene,this.camera);this.gl.getContext().finish();this.retainWarmPrograms(warm);
    if(this.contextLost||this.gl.getContext().isContextLost())throw Error('骰子图形初始化中断，无法分配图形资源，请关闭不用的浏览器窗口后重试');
    this.ready=true;this.gl.render(this.scene,this.camera);this.gl.getContext().finish();this.gl.domElement.style.opacity='1';
    const gl=this.gl.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    this.emit('renderer-ready',{renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),maxTextureSize:this.gl.capabilities.maxTextureSize,
      view:{w:this.projection.width,h:this.projection.height,pixelsPerDie:this.projection.pixelsPerDie}});
    this.resetMetrics();
  }
  private retainWarmPrograms(warm:T.Mesh[]){
    // Releasing the last outline material also deletes its compiled GL program.
    // Keep only the fixed catalog warmup objects, detached from the visible scene.
    // Every actual die still owns its mutable uniforms and normal disposal path.
    for(const mesh of warm){
      this.warmPrograms.add(mesh);
      const owner=mesh.material as T.Material;
      const release=()=>{disposeDiceDecorations(mesh);mesh.removeFromParent();owner.removeEventListener('dispose',release);};
      owner.addEventListener('dispose',release);
    }
  }
  private async compileRestoredPrograms(){
    // Three accepts a detached object plus the real lighting/environment scene.
    // Restore the retained references without ever drawing warmup dice in a room.
    await this.gl.compileAsync(this.warmPrograms,this.camera,this.scene);
    await this.gl.compileAsync(this.scene,this.camera);
  }
  private restoreContext(resume:()=>void){
    clearTimeout(this.contextTimer);this.contextLost=false;
    const generation=this.contextGeneration;
    const current=()=>generation===this.contextGeneration&&!this.contextLost&&!this.gl.getContext().isContextLost();
    // Another loss can invalidate an asynchronous compile while it is pending.
    // Only the latest live context may publish readiness or resume its timeline.
    return this.compileRestoredPrograms().then(()=>{
      if(!current())return;
      this.emit('render-context-restored',{active:this.active.length});resume();
    }).catch(error=>{if(current())this.emit('error',{message:'骰子渲染恢复失败：'+String(error)});});
  }
  /** The native desktop projection: one die is `pixels_per_die` px and the ground origin sits at
   *  62% of the height. Keeping top+bottom = 2*halfH preserves that px-per-unit scale exactly. */
  private layout(){
    const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight);
    this.targetPixelsPerDie=fitPixelsPerDie(makeProjection(w,h),this.active.flatMap(a=>a.roll.bounds?[a.roll.bounds]:[]));
    const resized=w!==this.projection.width||h!==this.projection.height;
    // A smaller viewport cannot wait for the zoom easing: settled dice would be cut off
    // immediately after rotation. Fit a contraction now; retain smooth zoom-in and the
    // existing same-viewport transition when another roll widens the physical table.
    const pixelsPerDie=this.active.some(a=>a.released)?
      (resized?Math.min(this.projection.pixelsPerDie,this.targetPixelsPerDie):this.projection.pixelsPerDie):this.targetPixelsPerDie;
    const halfW=(w*0.5)/pixelsPerDie,halfH=(h*0.5)/pixelsPerDie;
    Object.assign(this.camera,{left:-halfW,right:halfW,top:halfH*1.24,bottom:-halfH*0.76});
    this.camera.updateProjectionMatrix();
    // Three setSize rewrites both canvas dimensions even when nothing changed.
    // Check actual backing size too; setPixelRatio already resizes it itself.
    const size=this.gl.getSize(this.rendererSize),ratio=this.gl.getPixelRatio(),canvas=this.gl.domElement;
    if(size.x!==w||size.y!==h||canvas.width!==Math.floor(w*ratio)||canvas.height!==Math.floor(h*ratio))this.gl.setSize(w,h,false);
    this.projection={width:w,height:h,pixelsPerDie};
  }
  private remapSources(){for(const a of this.active)for(const beam of a.cue.beams){const o=((a.roll.frames-1)*a.roll.kinds.length+beam.dieIndex)*7,p=a.roll.poses;
    [beam.sourceX,beam.sourceY]=projectVisual(this.projection,p[o],p[o+1],p[o+2]);}}
  private animateProjection(dt:number){
    const current=this.projection.pixelsPerDie,target=this.targetPixelsPerDie;if(Math.abs(current-target)<.001)return;
    const pixels=Math.abs(current-target)<.02?target:current+(target-current)*(1-Math.exp(-dt/.12));
    const halfW=this.projection.width*.5/pixels,halfH=this.projection.height*.5/pixels;
    Object.assign(this.camera,{left:-halfW,right:halfW,top:halfH*1.24,bottom:-halfH*.76});this.camera.updateProjectionMatrix();
    this.projection.pixelsPerDie=pixels;this.remapSources();
  }
  resize(){
    const before=this.projection.width+'x'+this.projection.height;
    this.layout();
    if(before!==this.projection.width+'x'+this.projection.height){
      // Preserve the committed flight order/times; only remap the true landing positions.
      for(const a of this.active)for(const beam of a.cue.beams){const o=((a.roll.frames-1)*a.roll.kinds.length+beam.dieIndex)*7,p=a.roll.poses;
        [beam.sourceX,beam.sourceY]=projectVisual(this.projection,p[o],p[o+1],p[o+2]);}
      this.reslot(true);this.emit('viewport',{w:this.projection.width,h:this.projection.height});
    }
    if(this.ready)this.wake();
  }
  quality(scale:number){this.gl.setPixelRatio(Math.min(devicePixelRatio,scale));this.resize()}
  resetMetrics(){this.metricsSince=performance.now();this.frames=[];this.longTasks=[];this.last=0;this.observer?.takeRecords()}
  add(roll:Roll,start:number,presentation?:RollPresentation){
    if(!this.ready)throw Error('Renderer not ready');
    if(!validBodyColor(roll.request.bodyColor))throw Error('骰子玩家颜色不合法');
    if(this.active.reduce((n,r)=>n+r.meshes.length,0)+roll.kinds.length>300)throw Error('当前同时显示上限 300 枚，请等待或清屏');
    const theme=this.catalog.themes[roll.request.theme];
    const cue=presentation?.cue??buildCue(roll,this.projection,presentationTheme(theme,roll.request.bodyColor));
    const show=presentation?.show??new CueRenderer(this.container,roll.request.id,roll.request.name,roll.request.bodyColor);
    show.prepareCue(cue);
    const meshes=roll.kinds.map((kind,index)=>{
      const base=this.materials.get(`${roll.request.theme}:${kind}${roll.masked?':hidden':''}`),geometry=this.geometry.get(kind);
      if(!base||!geometry)throw Error('来源皮肤/几何不可用');
      const material=instanceDiceMaterial(base,theme,roll.request.bodyColor);
      const m=new T.Mesh(geometry,material);m.castShadow=false;m.receiveShadow=true;m.visible=false;
      if(theme.style==='sketch')addSketchOutline(m,geometry);
      else addDynamicOutline(m,geometry,theme.style!);
      this.renderRegion.register(m);this.diceSpace.add(m);return m;
    });
    try{presentation?.onPrepare?.(meshes);}catch(error){
      presentation?.onDispose?.();for(const m of meshes){disposeDiceDecorations(m);this.diceSpace.remove(m);(m.material as T.Material).dispose();}show.destroy();throw error;
    }
    this.active.push({roll,meshes,start,released:false,settled:false,cue,show,slot:0,births:presentation?.births??roll.births,onFrame:presentation?.onFrame,onDispose:presentation?.onDispose});this.layout();this.remapSources();this.reslot();this.idleReported=false;
    this.emit('render-queued',{roll:roll.request.id,count:meshes.length,start,theme:roll.request.theme,bodyColor:roll.request.bodyColor,view:{...this.projection},audio:{...this.audioPlan(roll,cue),rules:presentation?.ruleSounds}});this.wake();
  }
  /** Concurrent rolls share the layer with equal horizontal slots, as the native layout does. */
  private reslot(snap=false){
    const visible=this.active.filter(a=>!a.roll.masked),count=visible.length;if(!count)return;
    const slots=cueSlots(this.projection.width,this.projection.height,count,visible.some(a=>!!a.cue?.modifier));
    visible.forEach((a,index)=>{const slot=slots[index];a.slot=slot.x;
      a.show.setSlotOffset(slot.x,slot.y,slot.width,slot.height,snap);});
  }
  /**
   * The audio plan, derived once from the authoritative trace: contact impacts with their screen pan,
   * the rolling envelope sampled from the pose track, the per-beam hit schedule and the one stinger.
   */
  private audioPlan(roll:Roll,cue:Cue):AudioPlan{
    const audioProjection={...this.projection,pixelsPerDie:this.targetPixelsPerDie};
    const project=(x:number,y:number,z:number)=>projectionPan(audioProjection,x,y,z);
    const plan=buildImpactPlan(roll.contacts,project);
    const step=0.03,n=roll.kinds.length,frames=roll.frames,poses=roll.poses;
    const count=Math.max(1,Math.ceil(roll.duration/step)+1);
    const activity=new Float32Array(count),pan=new Float32Array(count);
    const hulls=roll.kinds.map(kind=>this.catalog.dice[kind].hull);
    const nominal=roll.kinds.map(kind=>this.catalog.dice[kind].nominal);
    const at=(t:number,index:number)=>{
      const f=Math.max(0,Math.min(frames-1,t*roll.fps)),lo=Math.floor(f),hi=Math.min(lo+1,frames-1),k=f-lo;
      const a=(lo*n+index)*7,b=(hi*n+index)*7;
      const p=[poses[a]+(poses[b]-poses[a])*k,poses[a+1]+(poses[b+1]-poses[a+1])*k,poses[a+2]+(poses[b+2]-poses[a+2])*k];
      const q=[0,1,2,3].map(c=>poses[a+3+c]+(poses[b+3+c]-poses[a+3+c])*k);
      const length=Math.hypot(q[0],q[1],q[2],q[3])||1;
      return{p,q:q.map(value=>value/length)};
    };
    for(let s=0;s<count;s++){
      const t=s*step;let loudest=-1,value=0,panValue=0;
      for(let i=0;i<n;i++){
        const current=at(t,i),previous=at(Math.max(0,t-step),i);
        const linear=Math.hypot(current.p[0]-previous.p[0],current.p[1]-previous.p[1],current.p[2]-previous.p[2])/step;
        const angular=angularSpeedBetween(previous.q,current.q,step);
        const radius=nominal[i]*0.75;
        const grounded=current.p[1]+lowestHullPoint(hulls[i],current.q)<=0.001*VISUAL_PER_METER;
        // Native batch rule: the loudest die drives the loop, and airtime is heavily attenuated.
        const audible=(grounded?linear+angular*radius:(linear+angular*radius)*0.15);
        if(audible>loudest){loudest=audible;value=rollingActivity(grounded,linear,angular,radius);panValue=project(current.p[0],current.p[1],current.p[2])}
      }
      activity[s]=value;pan[s]=panValue;
    }
    const hits=cue.beams.map(beam=>({t:beam.reveal,ordinal:beam.ordinal,maximumFace:beam.maximumFace}));
    if(cue.modifier)hits.push({t:cue.modifier.reveal,ordinal:n,maximumFace:false});
    return{impacts:plan.impacts,hits,stinger:null,
      stingerAt:roll.duration,duration:cue.diceExit,rolling:{activity,pan,step},suppressed:plan.suppressed,merged:plan.merged,voices:plan.pairs};
  }
  private removeMeshes(a:Active){a.onDispose?.();for(const m of a.meshes){disposeDiceDecorations(m);this.diceSpace.remove(m);(m.material as T.Material).dispose()}}
  clear(failed=false){for(const a of this.active){this.removeMeshes(a);a.show.destroy();this.emit('render-cancelled',{roll:a.roll.request.id,failed})}this.active=[];this.layout();this.wake()}
  wake(){if(this.contextLost||document.hidden)return;if(!this.frameHandle){this.frameHandle=requestAnimationFrame(()=>this.frame())}}
  private frame(){
    this.frameHandle=0;if(this.contextLost||document.hidden)return;
    try{this.drawFrame();this.frameFailures=0;}catch(error){this.frameFailures++;this.emit('error',{message:'骰子渲染帧异常：'+String(error)});if(this.frameFailures>=3){this.clear(true);this.emit('render-unavailable',{});}}
    finally{if(this.active.length&&!this.contextLost&&!document.hidden)this.frameHandle=requestAnimationFrame(()=>this.frame());}
  }
  private drawFrame(){
    const time=now();for(const a of this.active){const start=recoverPlaybackStart(a.start,this.last,time);if(start!==a.start){a.start=start;this.emit('render-retimed',{roll:a.roll.request.id,start});}}
    const dt=this.last?Math.min(.05,(time-this.last)/1000):1/60;if(this.last)this.frames.push(time-this.last);this.last=time;if(this.frames.length>1200)this.frames.splice(0,this.frames.length-1200);
    this.animateProjection(dt);beginOverlayFrame(this.container);
    for(const a of [...this.active]){
      try{
      const age=(time-a.start)/1000;if(age<0)continue;
      if(!a.released){a.released=true;this.emit('render-release',{roll:a.roll.request.id,planned:a.start,actual:time,lateMs:time-a.start});}
      const f=Math.min(age*a.roll.fps,a.roll.frames-1),lo=Math.floor(f),hi=Math.min(lo+1,a.roll.frames-1),t=f-lo;
      for(let i=0;i<a.meshes.length;i++){const m=a.meshes[i],p=a.roll.poses;const from=(lo*a.meshes.length+i)*7,to=(hi*a.meshes.length+i)*7;
        // Mirrored in x: the native projection puts screen right on +x and screen up on +z at once.
        m.position.set(T.MathUtils.lerp(p[from],p[to],t),T.MathUtils.lerp(p[from+1],p[to+1],t),T.MathUtils.lerp(p[from+2],p[to+2],t));
        this.q0.fromArray(p,from+3);this.q1.fromArray(p,to+3);m.quaternion.slerpQuaternions(this.q0,this.q1,t);
        const [sx,sy]=projectVisual(this.projection,m.position.x,m.position.y,m.position.z),radius=m.geometry.boundingSphere!.radius*this.projection.pixelsPerDie;
        Object.assign(m,diePresence(age,a.births?.[i]??0,sx,sy,radius,this.projection.width,this.projection.height));
        const uniforms=(m.material as T.Material).userData;
        uniforms.time.value=age;
        for(const child of m.children){const material=(child as T.Mesh).material as T.ShaderMaterial;
          if(material.uniforms?.pixelScale)material.uniforms.pixelScale.value=this.projection.pixelsPerDie;}
        uniforms.glyphWipe.value=-1;
      }
      for(const beam of a.cue.beams){const phase=(age-beam.start)/(BEAM_RECOIL+.08);
        if(phase>=0&&phase<=1)(a.meshes[beam.dieIndex].material as T.Material).userData.glyphWipe.value=phase;}
      // The show is drawn in screen space, and its timeline owns when the dice may leave.
      a.onFrame?.(age,a.meshes);
      if(!a.roll.masked)a.show.draw(age,a.cue,1);
      if(age>=a.cue.settled&&!a.settled){a.settled=true;this.emit('render-settled',a.roll.masked?{roll:a.roll.request.id,hidden:true}:{roll:a.roll.request.id,results:a.roll.results,total:a.cue.total})}
      if(age>a.cue.diceExit){this.removeMeshes(a);a.show.destroy();this.active.splice(this.active.indexOf(a),1);this.layout();this.remapSources();this.reslot();this.emit('render-complete',{roll:a.roll.request.id})}
      a.failures=0;
      }catch(error){a.failures=(a.failures||0)+1;this.emit('render-frame-retry',{roll:a.roll.request.id,attempt:a.failures,message:String(error)});if(a.failures>=3){this.removeMeshes(a);a.show.destroy();this.active.splice(this.active.indexOf(a),1);this.emit('render-cancelled',{roll:a.roll.request.id,failed:true});this.emit('error',{message:'骰子演出连续失败，保留权威结果：'+String(error)});}}
    }
    withRenderRegion(this.gl,this.renderRegion.get({...this.projection,pixelRatio:this.gl.getPixelRatio()}),()=>{this.gl.render(this.scene,this.camera);});
    if(this.active.length?time-this.lastMetrics>750:!this.idleReported){this.lastMetrics=time;this.idleReported=!this.active.length;const sorted=[...this.frames].sort((a,b)=>a-b),average=sorted.reduce((n,v)=>n+v,0)/(sorted.length||1);
      this.emit('render-metrics',{fps:average?1000/average:0,p95:sorted[Math.floor(sorted.length*.95)]||0,maxFrame:sorted.at(-1)||0,longTasks:this.longTasks.length,longestTask:Math.max(0,...this.longTasks),activeRolls:this.active.length,dice:this.active.reduce((n,a)=>n+a.meshes.length,0),drawCalls:this.gl.info.render.calls,triangles:this.gl.info.render.triangles,textures:this.gl.info.memory.textures,pixelRatio:this.gl.getPixelRatio()});}
  }
}
