/** Diagnostic only. Install before navigation, in every independently created context.
 * Counts native program calls without querying GL status or forcing a GPU fence.
 * Call duration is synchronous JavaScript/native return time, not GPU compile time. */
export function installProgramProbe(){
  if(globalThis.__diceProgramProbe)return;
  const events=[],patches=[],contexts=new WeakMap(),programs=new WeakMap(),shaders=new WeakMap();
  let nextContext=0,nextProgram=0,nextShader=0,dropped=0,sequence=0;
  const limit=20000,at=()=>performance.timeOrigin+performance.now();
  const id=(map,value,next)=>{if(!value||(typeof value!=='object'&&typeof value!=='function'))return null;let found=map.get(value);if(found===undefined){found=next();map.set(value,found);}return found;};
  const contextId=value=>id(contexts,value,()=>++nextContext);
  const programId=value=>id(programs,value,()=>++nextProgram);
  const shaderId=value=>id(shaders,value,()=>++nextShader);
  const record=entry=>{entry.sequence=++sequence;if(events.length<limit)events.push(entry);else dropped++;};
  const methods=['createProgram','linkProgram','deleteProgram','compileShader'];
  const seen=new Set();
  for(const Ctor of [globalThis.WebGLRenderingContext,globalThis.WebGL2RenderingContext]){
    if(!Ctor)continue;
    for(const method of methods){
      let owner=Ctor.prototype;
      while(owner&&!Object.hasOwn(owner,method))owner=Object.getPrototypeOf(owner);
      if(!owner)continue;
      const descriptor=Object.getOwnPropertyDescriptor(owner,method),original=descriptor?.value;
      if(typeof original!=='function'||seen.has(original))continue;
      const wrapped=function(...args){
        const startedAt=at();let result,failed=false;
        try{result=Reflect.apply(original,this,args);return result;}
        catch(error){failed=true;throw error;}
        finally{record({event:method,context:contextId(this),program:method==='compileShader'?null:programId(method==='createProgram'?result:args[0]),shader:method==='compileShader'?shaderId(args[0]):null,at:startedAt,returnedAt:at(),failed});}
      };
      seen.add(original);seen.add(wrapped);
      Object.defineProperty(owner,method,{...descriptor,value:wrapped});
      patches.push({owner,method,descriptor,wrapped});
    }
  }
  const contextEvent=event=>record({event:event.type,at:at(),context:0,program:null,shader:null,failed:false});
  document.addEventListener('webglcontextlost',contextEvent,true);
  document.addEventListener('webglcontextrestored',contextEvent,true);
  globalThis.__diceProgramProbe={
    snapshot:()=>({events:events.map(event=>({...event})),dropped,contexts:nextContext,programsCreated:nextProgram,installedMethods:patches.length,boundary:'Native call count and synchronous return time; no GPU status query or fence.'}),
    uninstall:()=>{for(const {owner,method,descriptor,wrapped} of patches)if(Object.getOwnPropertyDescriptor(owner,method)?.value===wrapped)Object.defineProperty(owner,method,descriptor);document.removeEventListener('webglcontextlost',contextEvent,true);document.removeEventListener('webglcontextrestored',contextEvent,true);},
  };
}

/** Absolute performance.timeOrigin + performance.now() boundaries match latency probes.
 * Upper bounds are exclusive so adjacent phases never double-count a call.
 * deleteProgram counts deletion requests: WebGL may defer actual destruction. */
export function summarizeProgramProbe(snapshot,{since=-Infinity,until=Infinity}={}){
  if(!snapshot)return null;
  const events=snapshot.events.filter(event=>event.at>=since&&event.at<until);
  const counts=Object.fromEntries(['createProgram','linkProgram','deleteProgram','compileShader','webglcontextlost','webglcontextrestored'].map(event=>[event,0]));
  const synchronousMs={linkProgram:0,compileShader:0};let failed=0;
  for(const event of events){counts[event.event]=(counts[event.event]||0)+1;if(event.failed)failed++;if(event.event in synchronousMs)synchronousMs[event.event]+=Math.max(0,event.returnedAt-event.at);}
  return{counts,synchronousMs,failed,dropped:snapshot.dropped,programIds:[...new Set(events.flatMap(event=>event.program===null?[]:[event.program]))],events,boundary:snapshot.boundary};
}

export function programProbeRollPhases(snapshot,{submittedAt,queuedAt,releasedAt,completedAt}){
  if(![submittedAt,releasedAt,completedAt].every(Number.isFinite)||submittedAt>releasedAt||releasedAt>completedAt)throw Error('Invalid program-probe roll boundaries');
  const result={total:summarizeProgramProbe(snapshot,{since:submittedAt,until:completedAt}),beforeRelease:summarizeProgramProbe(snapshot,{since:submittedAt,until:releasedAt}),afterRelease:summarizeProgramProbe(snapshot,{since:releasedAt,until:completedAt})};
  if(Number.isFinite(queuedAt)&&queuedAt>=submittedAt&&queuedAt<=releasedAt){result.beforeQueued=summarizeProgramProbe(snapshot,{since:submittedAt,until:queuedAt});result.queuedToRelease=summarizeProgramProbe(snapshot,{since:queuedAt,until:releasedAt});}
  return result;
}
