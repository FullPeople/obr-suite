import { dragonEngraving } from "./card-art";
import { card } from "./rules/cards";
import { cardHint, cardName } from "./rules/prompts";
import { POWER_PRESENTATION_MS, type PowerCue } from "./power-sequence";
import type { TableLanguage } from "./text";
import "./power-presentation.css";

export function mountPowerPresentation(host:HTMLElement,options:{language:TableLanguage;seatName(id:string):string;onChange():void}) {
 let language=options.language,active:PowerCue|null=null,timer:ReturnType<typeof setTimeout>|undefined,destroyed=false;
 const queue:PowerCue[]=[],seen=new Set<string>();
 const overlay=document.createElement("section");overlay.className="power-overlay";overlay.hidden=true;overlay.setAttribute("aria-live","polite");overlay.setAttribute("role","status");
 overlay.innerHTML='<div class="power-card-space"><div class="power-card"><span class="power-card-strength"></span><span class="power-card-art" aria-hidden="true"></span><strong class="power-card-name"></strong></div></div><div class="power-copy"><p class="power-player"></p><h2></h2><p class="power-description"></p></div>';
 host.append(overlay);
 const el=(selector:string)=>overlay.querySelector<HTMLElement>(selector)!;
 function paint(){
  if(!active)return;const value=card(active.cardId);overlay.dataset.color=value.color??value.alignment;
  el('.power-card-strength').textContent=String(value.strength);el('.power-card-name').textContent=cardName(value.id,language);
  el('.power-card-art').innerHTML=value.category==='mortal'?'<svg viewBox="0 0 100 100"><path d="m23 25 13 12 14-19 14 19 13-12-5 28H28Z M34 65h32 M29 77h42" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="47" r="4" fill="currentColor"/></svg>':dragonEngraving;
  el('.power-player').textContent=language==='zh'?`${options.seatName(active.seatId)}正在触发效果`:`${options.seatName(active.seatId)} is resolving a power`;
  el('h2').textContent=cardName(value.id,language);el('.power-description').textContent=cardHint(active.family,language);
 }
 function next(){
  if(destroyed)return;active=queue.shift()??null;overlay.hidden=!active;
  if(active){paint();el('.power-copy').scrollTop=0;el('.power-card').getAnimations().forEach(animation=>animation.cancel());
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches)el('.power-card').animate([{transform:'rotateY(-12deg)'},{transform:'rotateY(12deg)'}],{duration:POWER_PRESENTATION_MS,easing:'ease-in-out',fill:'both'});
   timer=setTimeout(()=>{timer=undefined;next();},POWER_PRESENTATION_MS);
  }else el('.power-card').getAnimations().forEach(animation=>animation.cancel());
  options.onChange();
 }
 return {
  get busy(){return !!active;},get current(){return active;},get remaining(){return queue.length+(active?1:0);},
  enqueue(cues:readonly PowerCue[]){if(destroyed)return;for(const cue of cues){if(seen.has(cue.key))continue;seen.add(cue.key);if(queue.length<64)queue.push(cue);}while(seen.size>256)seen.delete(seen.values().next().value!);if(!active)next();},
  language(value:TableLanguage){language=value;paint();},
  clear(){if(timer)clearTimeout(timer);timer=undefined;queue.length=0;active=null;seen.clear();overlay.hidden=true;el('.power-card').getAnimations().forEach(animation=>animation.cancel());if(!destroyed)options.onChange();},
  destroy(){if(destroyed)return;destroyed=true;if(timer)clearTimeout(timer);queue.length=0;active=null;seen.clear();el('.power-card').getAnimations().forEach(animation=>animation.cancel());overlay.remove();},
 };
}
