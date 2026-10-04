// Imported ONLY by dice-pass-build.mjs. Deliberate visual omissions are diagnostic, never an optimization.
import {installPassBudgetProbe} from './dice-pass-gpu.mjs';
export const PAINT_METHODS=['clearRect','fillRect','strokeRect','fill','stroke','fillText','strokeText','drawImage','putImageData','drawFocusIfNeeded'];
export function phaseFor(age,cue){
  if(age<0)return 'scheduled';
  if(age<cue.settled)return 'physics';
  if(age<cue.firstBeam)return 'settled-wait';
  if(age<cue.finalReveal)return 'gathering';
  if(age<cue.finalBeamEnd+.28)return 'afterglow-fade';
  if(age<=cue.diceExit)return 'tail-hold';
  return 'complete';
}
export function installDicePassBudget(renderer){
  const config=globalThis.__dicePassConfig;if(!config)throw Error('Diagnostic config missing');
  const now=()=>performance.now(),epoch=()=>performance.timeOrigin+now();
  const frames=[],rolls=[],events=[],audio=[],faults=[],longTasks=[],hashes=[];
  let current=null,audioStarts=0,audioRestarts=0,retimes=0;
  const gpu=installPassBudgetProbe(renderer.gl,{gpu:!!config.gpu,getFrame:()=>current?.index??null});
  const originalDraw=renderer.drawFrame,originalEmit=renderer.emit;
  const probe={frames,rolls,events,audio,faults,longTasks,config,gpu,
    wrap2D(ctx,kind){
      if(!['cue-canvas','research-effects'].includes(kind))throw Error('Unknown shared 2D surface: '+kind);
      for(const method of PAINT_METHODS){if(typeof ctx[method]!=='function')continue;const original=ctx[method];
        ctx[method]=function(...args){
          if(current){const layer=current.canvas[kind]??={attempted:{},executed:{}};layer.attempted[method]=(layer.attempted[method]||0)+1;if(!config.no2D)layer.executed[method]=(layer.executed[method]||0)+1;}
          if(!config.no2D)return original.apply(this,args);
        };
      }return ctx;
    },
    glPass(callback){
      if(!current)throw Error('GL pass outside measured drawFrame');current.glPassAttempted++;
      if(config.noGL){current.glPassSkipped++;return;}
      const started=now();try{return callback();}finally{current.glPassCpuMs+=now()-started;}
    },
    rollFrame(active,age){if(current)current.rolls.push({id:active.roll.request.id,age,phase:phaseFor(age,active.cue),start:active.start,slot:active.show.slotPosition()});},
    allowCardWrites(card){const allowed=!(config.noDetachedDOM&&!card.isConnected);if(current){current.cardDraws++;current.connectedCardDraws+=Number(card.isConnected);current.suppressedCardDraws+=Number(!allowed);}return allowed;},
    audioStart(id,at,restart){audioStarts++;audioRestarts+=Number(restart);audio.push({id,at,observedAt:epoch(),restart});},
    prepared(active){
      const {roll,cue,show}=active;
      const descriptor={id:roll.request.id,seed:roll.request.seed,request:roll.request,kinds:roll.kinds,results:roll.results,physicsMs:roll.physicsMs,duration:roll.duration,fps:roll.fps,frames:roll.frames,poseBytes:roll.poses.byteLength,contacts:roll.contacts,cue:JSON.parse(JSON.stringify(cue)),initialStart:active.start};
      rolls.push(descriptor);
      // Hash authoritative bytes outside the rAF loop. No readback or rendering synchronization.
      hashes.push(crypto.subtle.digest('SHA-256',roll.poses).then(hash=>descriptor.poseSha256=[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')));
      const draw=show.draw;show.draw=function(...args){const started=now();try{return draw.apply(this,args);}finally{if(current){current.showInclusiveCpuMs+=now()-started;current.showCalls++;current.lastShowState={latest:this.latest??null,finished:this.finished??null,slot:this.slotPosition()};}}};
    },
    async snapshot(){await Promise.all(hashes);gpu.poll();return{config,frames,rolls,events,audio,faults,longTasks,gpu:{status:gpu.status(),records:gpu.records},audioStarts,audioRestarts,retimes,active:renderer.active.length,audioState:globalThis.__diceLabAudio?.snapshot()??null,documentVisibility:document.visibilityState,webglContextLost:renderer.gl.getContext().isContextLost()};}
  };
  renderer.emit=function(event,detail){events.push({event,detail,observedAt:epoch(),frame:current?.index??null});if(event==='render-retimed')retimes++;if(['error','render-frame-retry','render-cancelled','render-context-lost','render-unavailable','render-paused'].includes(event))faults.push({event,detail});return originalEmit.call(this,event,detail);};
  renderer.drawFrame=function(...args){
    const pollStarted=now();gpu.poll();const pollCpuMs=now()-pollStarted,started=now();
    const record={index:frames.length,at:performance.timeOrigin+started,rafTimestamp:globalThis.__dicePassLastRAF??null,pollCpuMs,wholeJSCpuMs:null,glPassCpuMs:0,glPassAttempted:0,glPassSkipped:0,showInclusiveCpuMs:0,showCalls:0,cardDraws:0,connectedCardDraws:0,suppressedCardDraws:0,canvas:{},rolls:[],retimesBefore:retimes,audioStarts,audioRestarts,nextFrameMs:null,nextRAFMs:null};
    if(frames.length){frames.at(-1).nextFrameMs=record.at-frames.at(-1).at;frames.at(-1).nextRAFMs=record.rafTimestamp===null||frames.at(-1).rafTimestamp===null?null:record.rafTimestamp-frames.at(-1).rafTimestamp;}
    frames.push(record);current=record;
    const marked=config.trace&&record.index%30===0;if(marked)performance.mark('dice-pass-frame-start');
    try{return originalDraw.apply(this,args);}catch(error){record.error=String(error);throw error;}finally{
      record.wholeJSCpuMs=now()-started;record.retimes=retimes-record.retimesBefore;record.retimesCumulative=retimes;current=null;
      if(marked){performance.mark('dice-pass-frame-end');performance.measure('dice-pass-frame','dice-pass-frame-start','dice-pass-frame-end');}
    }
  };
  if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({at:performance.timeOrigin+e.startTime,duration:e.duration})))).observe({type:'longtask'});
  globalThis.__dicePassBudget=probe;globalThis.__diceProfileRenderer=renderer;
  return probe;
}
