/** Serialized into a fresh browser realm before any product code. No imports or WebGL queries. */
export function installOutlineProgramProbe(root=globalThis){
 if(root.__diceOutlineProbe)return;
 const contexts=new WeakMap(),programs=new WeakMap(),shaders=new WeakMap(),threePrograms=new Map();
 const data={version:1,events:[],snapshots:[],contexts:[],programs:[],shaders:[],errors:[],wrappers:[],adds:[]};
 const warm=[],drawnOutlineRoles=new Set();let phase='startup',seq=0,renderer,roll=null,firstDraw=false,firstOutlineDraw=false,frameCaptured=false;
 const at=()=>root.performance.timeOrigin+root.performance.now();
 const event=(type,detail={})=>{const e={seq:++seq,type,phase,at:at(),...detail};data.events.push(e);return e;};
 const context=gl=>{let c=contexts.get(gl);if(!c){c={id:data.contexts.length+1,kind:root.WebGL2RenderingContext&&gl instanceof root.WebGL2RenderingContext?'webgl2':'webgl1',counts:{},currentProgram:null,depth:new Set()};contexts.set(gl,c);data.contexts.push(c);}return c;};
 const program=(gl,value)=>{if(value==null)return null;const p=programs.get(value);if(!p||p.context!==context(gl).id)throw Error('unobserved/cross-context WebGLProgram');return p;};
 const shader=(gl,value)=>{const s=shaders.get(value);if(!s||s.context!==context(gl).id)throw Error('unobserved/cross-context WebGLShader');return s;};
 const safe=fn=>{try{return fn();}catch(e){data.errors.push(String(e));}};
 function programRef(p){let saved=threePrograms.get(p);if(!saved){const native=program(renderer.gl.getContext(),p.program);if(!native)throw Error('missing live native program');saved={threeId:p.id,nativeId:native.id,context:native.context,cacheKey:p.cacheKey};threePrograms.set(p,saved);}return {...saved,usedTimes:p.usedTimes,nativeHandlePresent:p.program!==undefined};}
 function materialRow(label,mesh,material){const props=renderer.gl.properties;const known=props.has(material),state=known?props.get(material):null;return {label,meshId:mesh.id,materialId:material.id,materialType:material.type,visible:mesh.visible,propertiesPresent:known,currentProgram:state?.currentProgram?programRef(state.currentProgram):null,programs:state?.programs?[...state.programs.values()].map(programRef):[]};}
 function mapping(){const rows=[];for(const {key,mesh,materials} of warm)for(const entry of materials)rows.push(materialRow('warm:'+key+':'+entry.role,entry.mesh,entry.material));for(const a of renderer.active)for(const [i,mesh]of a.meshes.entries()){rows.push(materialRow('roll:'+a.roll.request.id+':'+i+':body',mesh,mesh.material));for(const [j,child]of mesh.children.entries())if(child.userData.diceDecoration)rows.push(materialRow('roll:'+a.roll.request.id+':'+i+':'+(child.isLineSegments?'lines':'shell'),child,child.material));}return rows;}
 function checkpoint(label,r){renderer=r;phase=label;const marker=event('checkpoint',{label});const rows=mapping();data.snapshots.push({label,seq:marker.seq,at:marker.at,context:context(r.gl.getContext()).id,active:r.active.map(a=>({roll:a.roll.request.id,theme:a.roll.request.theme,kinds:a.roll.kinds,visible:a.meshes.filter(m=>m.visible).length})),materials:rows,threePrograms:[...threePrograms].map(([p,s])=>({...s,usedTimes:p.usedTimes,nativeHandlePresent:p.program!==undefined,listed:r.gl.info.programs.includes(p)})),counts:data.contexts.map(c=>({context:c.id,counts:{...c.counts}}))});}
 function observed(gl,name,args,result,began,ended){const c=context(gl);c.counts[name]=(c.counts[name]||0)+1;const cpuMs=ended-began;
  if(name==='createProgram'&&result){const p={id:data.programs.length+1,context:c.id,createdSeq:0,deletedSeq:null,attached:[],links:[],draws:0,parameterQueries:{}};programs.set(result,p);data.programs.push(p);p.createdSeq=event(name,{context:c.id,program:p.id,cpuMs}).seq;}
  else if(name==='createShader'&&result){const s={id:data.shaders.length+1,context:c.id,shaderType:args[0],source:null,compiles:[],deletedSeq:null};shaders.set(result,s);data.shaders.push(s);event(name,{context:c.id,shader:s.id,cpuMs});}
  else if(name==='shaderSource'){const s=shader(gl,args[0]);s.source=args[1];event(name,{context:c.id,shader:s.id,sourceLength:s.source.length,cpuMs});}
  else if(name==='compileShader'){const s=shader(gl,args[0]);s.compiles.push(event(name,{context:c.id,shader:s.id,cpuMs}).seq);}
  else if(name==='attachShader'){const p=program(gl,args[0]),s=shader(gl,args[1]);p.attached.push(s.id);event(name,{context:c.id,program:p.id,shader:s.id,cpuMs});}
  else if(name==='linkProgram'){const p=program(gl,args[0]);const e=event(name,{context:c.id,program:p.id,cpuMs});p.links.push({seq:e.seq,cpuMs,shaders:p.attached.map(id=>{const s=data.shaders[id-1];return {shader:id,type:s.shaderType,source:s.source,compiles:[...s.compiles]};})});}
  else if(name==='getProgramParameter'){const p=program(gl,args[0]);if(p){const key=String(args[1]),q=p.parameterQueries[key]??={calls:0,totalCpuMs:0,maxCpuMs:0};q.calls++;q.totalCpuMs+=cpuMs;q.maxCpuMs=Math.max(q.maxCpuMs,cpuMs);if(args[1]===35714){q.lastResult=result;q.falseResults=(q.falseResults||0)+(result===false?1:0);}}}
  else if(name==='deleteShader'){const s=shader(gl,args[0]);s.deletedSeq=event(name,{context:c.id,shader:s.id,cpuMs}).seq;}
  else if(name==='deleteProgram'){const p=program(gl,args[0]);if(p)p.deletedSeq=event(name,{context:c.id,program:p.id,cpuMs}).seq;}
  else if(name==='useProgram'){c.currentProgram=program(gl,args[0])?.id??null;}
  else if(name.startsWith('draw')){const p=c.currentProgram?data.programs[c.currentProgram-1]:null;if(p)p.draws++;if(!roll||!p)return;const geometryCount=name==='drawRangeElements'?args[3]:name.startsWith('drawArrays')?args[2]:args[1],instanceCount=name==='drawArraysInstanced'?args[3]:name==='drawElementsInstanced'?args[4]:1;if(!(geometryCount>0&&instanceCount>0)){p.zeroCountDraws=(p.zeroCountDraws||0)+1;return;}if(!p.rollDraw){p.rollDraw=event('first-program-draw-in-roll',{context:c.id,program:p.id,roll:roll.id,method:name,cpuMs,geometryCount,instanceCount,args:[...args]}).seq;}
   if(!firstDraw){firstDraw=true;checkpoint('first-roll-native-draw',renderer);}
   // Identify outline by the native handle stored by Three for a currently active decoration.
   if(drawnOutlineRoles.size<2){const matches=mapping().filter(m=>m.label.startsWith('roll:')&&!m.label.endsWith(':body')&&m.currentProgram?.nativeId===p.id);for(const match of matches){const role=match.label.split(':').at(-1);if(!drawnOutlineRoles.has(role)){drawnOutlineRoles.add(role);if(!firstOutlineDraw){firstOutlineDraw=true;checkpoint('first-roll-outline-native-draw',renderer);}checkpoint('first-roll-'+role+'-native-draw',renderer);}}}
  }
 }
 const names=['createProgram','deleteProgram','createShader','shaderSource','compileShader','attachShader','linkProgram','getProgramParameter','deleteShader','useProgram','drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements'];
 for(const name of names){const owners=new Set();for(const Ctor of [root.WebGLRenderingContext,root.WebGL2RenderingContext]){if(!Ctor)continue;let owner=Ctor.prototype;while(owner&&!Object.hasOwn(owner,name))owner=Object.getPrototypeOf(owner);if(!owner||owners.has(owner))continue;owners.add(owner);const descriptor=Object.getOwnPropertyDescriptor(owner,name),native=descriptor.value;if(typeof native!=='function')throw Error('unexpected WebGL method descriptor');
   Object.defineProperty(owner,name,{...descriptor,value:function(...args){const c=context(this);if(c.depth.has(name))return Reflect.apply(native,this,args);c.depth.add(name);try{const began=root.performance.now(),result=Reflect.apply(native,this,args),ended=root.performance.now();safe(()=>observed(this,name,args,result,began,ended));return result;}finally{c.depth.delete(name);}}});data.wrappers.push({name,owner:Ctor.name});}}
 root.__diceOutlineProbe={
  registerWarm(key,mesh){const materials=mesh.children.filter(c=>c.userData.diceDecoration).map(c=>({role:c.isLineSegments?'lines':'shell',mesh:c,material:c.material}));warm.push({key,mesh,materials});},
  checkpoint,
  startAdd(r,value,start){renderer=r;roll={id:value.request.id,theme:value.request.theme,kinds:[...value.kinds],start};data.adds.push(roll);checkpoint('add-start',r);},
  afterFrame(r){if(drawnOutlineRoles.size===2&&!frameCaptured){frameCaptured=true;checkpoint('first-roll-outline-frame-return',r);}},
  export(){return {...data,contexts:data.contexts.map(({depth,...c})=>c),boundary:'Native WebGL call return and Three program ownership only. GPU completion, driver shader-cache behavior and display presentation are not measured.'};}
 };
}
