import { dragonEngraving } from "./card-art";
import { card } from "./rules/cards";
import { cardHint, cardName } from "./rules/prompts";
import { POWER_CARD_MOTION_MS, type PowerCue } from "./power-sequence";
import type { TableLanguage } from "./text";
import "./power-presentation.css";

export function mountPowerPresentation(host:HTMLElement,options:{language:TableLanguage;seatName(id:string):string;onChange():void}) {
 let language=options.language,active:PowerCue|null=null,destroyed=false;
 let press:{id:number;x:number;y:number;cue:string;ready:boolean;moved:boolean}|null=null;
 let previousFocus:HTMLElement|null=null;
 const queue:PowerCue[]=[],seen=new Set<string>();
 const overlay=document.createElement("section");overlay.className="power-overlay";overlay.hidden=true;overlay.tabIndex=-1;overlay.setAttribute("aria-live","polite");overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");
 overlay.innerHTML='<div class="power-card-space"><div class="power-card"><span class="power-card-strength"></span><span class="power-card-art" aria-hidden="true"></span><strong class="power-card-name"></strong></div></div><div class="power-copy" tabindex="0"><p class="power-player"></p><h2></h2><p class="power-description"></p></div><p class="power-continue"></p>';
 host.append(overlay);
 const el=(selector:string)=>overlay.querySelector<HTMLElement>(selector)!;
 el('h2').id=`power-title-${crypto.randomUUID()}`;overlay.setAttribute('aria-labelledby',el('h2').id);
 function paint(){
  if(!active)return;const value=card(active.cardId);overlay.dataset.color=value.color??value.alignment;
  el('.power-card-strength').textContent=String(value.strength);el('.power-card-name').textContent=cardName(value.id,language);
  el('.power-card-art').innerHTML=value.category==='mortal'?'<svg viewBox="0 0 100 100"><path d="m23 25 13 12 14-19 14 19 13-12-5 28H28Z M34 65h32 M29 77h42" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="47" r="4" fill="currentColor"/></svg>':dragonEngraving;
  el('.power-player').textContent=language==='zh'?`${options.seatName(active.seatId)}正在触发效果`:`${options.seatName(active.seatId)} is resolving a power`;
  el('h2').textContent=cardName(value.id,language);el('.power-description').textContent=cardHint(active.family,language);
  el('.power-continue').textContent=language==='zh'?'点击任意位置继续 · 也可按 Enter 或空格':'Click anywhere to continue · Enter or Space also works';
 }
 function restoreFocus(){const target=previousFocus;previousFocus=null;if(target?.isConnected&&host.contains(target))target.focus({preventScroll:true});}
 function next(){
  if(destroyed)return;const wasActive=!!active;active=queue.shift()??null;press=null;overlay.hidden=!active;
  if(active){paint();el('.power-copy').scrollTop=0;el('.power-card').getAnimations().forEach(animation=>animation.cancel());
   if(!wasActive)previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
   overlay.focus({preventScroll:true});
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches)el('.power-card').animate([{transform:'rotateY(-12deg)'},{transform:'rotateY(12deg)'}],{duration:POWER_CARD_MOTION_MS,easing:'ease-in-out',fill:'both'});
  }else{el('.power-card').getAnimations().forEach(animation=>animation.cancel());restoreFocus();}
  options.onChange();
 }
 // Only a fresh, stationary press that started on this explanation may dismiss
 // it. The release/click from the card just played, text dragging and scrolling
 // cannot skip an explanation or submit a newly revealed choice underneath it.
 const down=(event:PointerEvent)=>{press=null;if(!active||destroyed)return;event.stopPropagation();if(event.isPrimary&&event.button===0)press={id:event.pointerId,x:event.clientX,y:event.clientY,cue:active.key,ready:false,moved:false};};
 const move=(event:PointerEvent)=>{if(!active)return;event.stopPropagation();if(press?.id===event.pointerId&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>=8)press.moved=true;};
 const up=(event:PointerEvent)=>{if(!active)return;event.stopPropagation();if(press?.id===event.pointerId)press.ready=!press.moved&&Math.hypot(event.clientX-press.x,event.clientY-press.y)<8;};
 const cancel=()=>{press=null;};
 const click=(event:MouseEvent)=>{if(!active||destroyed)return;event.preventDefault();event.stopPropagation();const accepted=press?.ready&&press.cue===active.key&&document.getSelection()?.isCollapsed!==false;press=null;if(accepted)next();};
 const key=(event:KeyboardEvent)=>{if(!active||destroyed)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(!event.repeat)next();}else if(event.key==='Tab'){event.preventDefault();event.stopPropagation();(document.activeElement===el('.power-copy')?overlay:el('.power-copy')).focus({preventScroll:true});}};
 host.addEventListener('pointerdown',down,true);host.addEventListener('pointermove',move,true);host.addEventListener('pointerup',up,true);host.addEventListener('pointercancel',cancel,true);host.addEventListener('click',click,true);host.addEventListener('keydown',key,true);el('.power-copy').addEventListener('scroll',cancel);
 return {
  get busy(){return !!active;},get current(){return active;},get remaining(){return queue.length+(active?1:0);},
  enqueue(cues:readonly PowerCue[]){if(destroyed)return;for(const cue of cues){if(seen.has(cue.key))continue;seen.add(cue.key);if(queue.length<64)queue.push(cue);}while(seen.size>256)seen.delete(seen.values().next().value!);if(!active)next();},
  language(value:TableLanguage){language=value;paint();},
  clear(){queue.length=0;active=null;press=null;seen.clear();overlay.hidden=true;el('.power-card').getAnimations().forEach(animation=>animation.cancel());restoreFocus();if(!destroyed)options.onChange();},
  destroy(){if(destroyed)return;destroyed=true;queue.length=0;active=null;press=null;previousFocus=null;seen.clear();host.removeEventListener('pointerdown',down,true);host.removeEventListener('pointermove',move,true);host.removeEventListener('pointerup',up,true);host.removeEventListener('pointercancel',cancel,true);host.removeEventListener('click',click,true);host.removeEventListener('keydown',key,true);el('.power-copy').removeEventListener('scroll',cancel);el('.power-card').getAnimations().forEach(animation=>animation.cancel());overlay.remove();},
 };
}
