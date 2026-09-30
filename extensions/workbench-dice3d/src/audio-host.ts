import {RollAudioMixer} from './audio-mixer';
import {CHANNEL} from './types';
/** Persistent overlay owns sound, not the transient Owlbear popover. The user's gesture in the
 * same-origin panel explicitly requests resume; actual browser state is reported, never assumed. */
export function mountAudioHost(client:string){
  const bus=new BroadcastChannel(`${CHANNEL}:local:${client}`);
  const mixer=new RollAudioMixer((event,detail)=>bus.postMessage({type:'renderer-event',event,detail}));
  const stored=Number(localStorage.getItem('obr-suite/dice3d/volume')??100);mixer.setVolume(Number.isFinite(stored)?stored/100:1);
  const state=()=>bus.postMessage({type:'audio-state',...mixer.snapshot()});
  bus.onmessage=e=>{const p=e.data;void (async()=>{
    if(p.type==='audio-plan')mixer.prepare(p.roll,p.theme,p.plan);
    else if(p.type==='audio-release')await mixer.release(p.roll,p.at);
    else if(p.type==='audio-stop')mixer.stop(p.roll);
    else if(p.type==='audio-command'){
      if(p.action==='unlock')await mixer.resume();
      else if(p.action==='volume')mixer.setVolume(p.value);
      state();
    }else if(p.type==='panel-ready')state();
  })().catch(error=>bus.postMessage({type:'renderer-event',event:'error',detail:{message:'音频: '+String(error)}}))};
  return mixer;
}
