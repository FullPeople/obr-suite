import {cardFaceImage} from "./card-images";
import {cardName} from "./rules/prompts";
import type {PublicEvent,PublicView,ScoreReport} from "./rules/types";
import type {TableLanguage} from "./text";
import "./round-presentation.css";

export type RoundCue = {key:string} & (
 {kind:"score";report:ScoreReport} |
 {kind:"round"|"turn";round:number;seatId:string} |
 {kind:"ante";gambit:number} | {kind:"end";winners:string[]} |
 {kind:"purchase";seatId:string;cardId:string;price:number} |
 {kind:"reward";seatId:string;amount:number});

/** Only live, authenticated suffixes are passed here. Coalescing must not lose
 * a score's pre-cleanup cards; a public score event carries that immutable data. */
export function roundCues(before:PublicView,after:PublicView,events:PublicEvent[]):RoundCue[]{
 if(before.id!==after.id||after.revision<=before.revision||after.revision>before.revision+1&&!events.length)return [];
 const cues:RoundCue[]=[],prefix=`${after.id}:${after.revision}`;
 for(const [i,event] of events.entries()){
  const key=`${prefix}:event:${i}`;
  if(event.code==="GAMBIT_SCORED"&&event.score)cues.push({key,kind:"score",report:event.score});
  else if(event.code==="BUY_PRICE"&&event.seatId&&event.cardIds?.[0])cues.push({key,kind:"purchase",seatId:event.seatId,cardId:event.cardIds[0],price:event.amount??0});
  else if(event.code==="SPECIAL_FLIGHT"&&event.seatId)cues.push({key,kind:"reward",seatId:event.seatId,amount:event.amount??0});
 }
 if(after.phase==="ended"&&before.phase!=="ended")cues.push({key:prefix+":end",kind:"end",winners:after.winners});
 else if(after.phase==="ante"&&after.gambit!==before.gambit)cues.push({key:prefix+":ante",kind:"ante",gambit:after.gambit});
 else if(after.round>0&&after.activeSeatId&&after.phase!=="choice"&&after.phase!=="adjudication"){
  if(before.round!==after.round||before.gambit!==after.gambit)cues.push({key:prefix+":round",kind:"round",round:after.round,seatId:after.activeSeatId});
  else if(before.activeSeatId!==after.activeSeatId||before.phase!==after.phase)cues.push({key:prefix+":turn",kind:"turn",round:after.round,seatId:after.activeSeatId});
 }
 return cues;
}

/** Local finite presentation. It never delays a rules commit or broadcasts
 * animation ticks. Powers/reveals can pause it; real disconnects discard it. */
export function mountRoundPresentation(host:HTMLElement,options:{language:TableLanguage;seatName(id:string):string;onChange():void;sound(kind:"coin"|"flip"|"draw",key:string):void;inspect(id:string):void}){
 let language=options.language,active:RoundCue|null=null,dead=false,paused=false,step=0;
 let timer:ReturnType<typeof setTimeout>|undefined,due=0,remaining=0,continuation:(()=>void)|null=null;
 const queue:RoundCue[]=[],seen=new Set<string>(),animations=new Set<Animation>();
 const overlay=document.createElement("section");overlay.className="round-overlay";overlay.hidden=true;overlay.setAttribute("aria-live","polite");overlay.setAttribute("role","status");
 const content=document.createElement("div");content.className="round-content";overlay.append(content);host.append(overlay);
 const words=(zh:string,en:string)=>language==="zh"?zh:en;
 const node=(tag:string,text?:string,cls?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 function animate(el:HTMLElement,frames:Keyframe[],duration:number){if(reduced()||paused)return null;const animation=el.animate(frames,{duration,easing:"cubic-bezier(.18,.78,.25,1)",fill:"both"});animations.add(animation);animation.finished.catch(()=>{}).finally(()=>animations.delete(animation));return animation;}
 function fly(from:DOMRect,to:DOMRect,text:string,coin=false){
  if(reduced()||paused)return;const particle=node("span",text,coin?"score-flying-coin":"score-flying-point");
  const origin=overlay.getBoundingClientRect();particle.style.left=`${from.x+from.width/2-origin.x}px`;particle.style.top=`${from.y+from.height/2-origin.y}px`;overlay.append(particle);
  const dx=to.x+to.width/2-from.x-from.width/2,dy=to.y+to.height/2-from.y-from.height/2;
  const a=animate(particle,[{transform:"translate(-50%,-50%) scale(1)",opacity:1},{offset:.4,transform:`translate(calc(-50% + ${dx*.45}px),calc(-50% + ${dy*.45-65}px)) scale(1.6)`,opacity:1},{transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.8)`,opacity:0}],coin?1000:640);
  if(a)a.finished.catch(()=>{}).finally(()=>particle.remove());else particle.remove();
 }
 function cancelTimer(){if(timer!==undefined)clearTimeout(timer);timer=undefined;}
 function arm(){if(dead||paused||!continuation)return;due=performance.now()+remaining;overlay.dataset.nextAt=String(due);timer=setTimeout(()=>{timer=undefined;const fn=continuation;continuation=null;fn?.();},remaining);}
 function wait(ms:number,fn:()=>void){cancelTimer();remaining=ms;continuation=fn;arm();}
 function name(id:string){return options.seatName(id)||id;}
 function heading(text:string,sub:string){content.append(node("h2",text),node("p",sub,"round-subtitle"));}
 function scorePaint(cue:Extract<RoundCue,{kind:"score"}>){
  const report=cue.report,max=Math.max(0,...report.rows.map(row=>row.cards.length));
  const bonusStep=max+1,finished=step>bonusStep;
  heading(words(`第 ${report.gambit} 轮局 · 计分`,`Gambit ${report.gambit} · Scoring`),words(report.weakest?"比较最低总力量":"比较最高总力量",report.weakest?"Compare lowest totals":"Compare highest totals"));
  const rows=node("div",undefined,"score-rows");
  for(const row of report.rows){
   const line=node("div",undefined,"score-row");line.dataset.seat=row.seatId;line.classList.toggle("score-winner",finished&&report.winners.includes(row.seatId));
   line.append(node("strong",name(row.seatId),"score-player"));const cards=node("div",undefined,"score-cards");
   row.cards.forEach((entry,index)=>{
    const tile=document.createElement("button");tile.type="button";tile.className="score-card";tile.dataset.card=entry.cardId;tile.classList.toggle("counted",index<step);tile.classList.toggle("counting",index===step-1);
    tile.append(cardFaceImage(entry.cardId),node("span",`+${entry.points}`));tile.setAttribute("aria-label",`${cardName(entry.cardId,language)}: ${entry.points}`);
    tile.addEventListener("pointerenter",()=>options.inspect(entry.cardId));tile.addEventListener("focus",()=>options.inspect(entry.cardId));tile.addEventListener("click",()=>options.inspect(entry.cardId));cards.append(tile);
   });
   line.append(cards);const visible=row.cards.slice(0,Math.min(step,row.cards.length)),bonus=step>=bonusStep?row.bonus:0;
   const amount=visible.reduce((sum,c)=>sum+c.points,0)+bonus;
   const sum=node("div",undefined,"score-sum");sum.append(node("span",visible.map(c=>c.points).join(" + ")+(bonus?` + ${bonus}`:"")||"0","score-equation"),node("b",`= ${amount}`,"score-total"));
   if(row.bonus)sum.append(node("small",words(`龙巫妖加成 +${step>=bonusStep?row.bonus:"…"}`,`Dracolich bonus +${step>=bonusStep?row.bonus:"…"}`)));
   if(!row.eligible)sum.append(node("small",words("龙神条件：不能赢得本轮局","Dragon god restriction: ineligible"),"score-ineligible"));
   line.append(sum);rows.append(line);
  }
  content.append(rows);
  if(finished){
   const result=node("div",undefined,"score-result");
   if(report.reason==="tied")result.append(node("h3",words("总力量并列 · 所有人加打一轮","Tied totals · Everyone plays another round")));
   else if(report.reason==="warlord")result.append(node("h3",words("青铜大督军 · 加打一轮","Bronze Warlord · Play another round")));
   else {result.append(node("h3",words(`${report.winners.map(name).join("、")} 赢得本轮局`,`${report.winners.map(name).join(", ")} wins the gambit`)));
    for(const pay of report.payouts){const payout=node("p",`${name(pay.seatId)} +${pay.amount} ${words("金币","gold")}`,"score-payout");result.append(payout);
     if(step===bonusStep+1)animate(payout,[{transform:"translateY(-38px) scale(.8)",opacity:0},{transform:"translateY(0) scale(1)",opacity:1}],950);}
    if(report.reason==="empty-stakes")result.append(node("small",words("赌注堆已取空，本轮局立即结束。","Empty stakes end this gambit immediately.")));
   }content.append(result);
  }
  const hint=node("small",words("逐张相加 → 特殊加成 → 胜负与金币","Cards → Bonuses → Winner and gold"),"score-progress");content.append(hint);
  if(step>0&&step<=bonusStep){for(const line of content.querySelectorAll<HTMLElement>('.score-row')){
   const source=line.querySelector<HTMLElement>('.score-card.counting'),total=line.querySelector<HTMLElement>('.score-total')!;
   if(source){fly(source.getBoundingClientRect(),total.getBoundingClientRect(),source.querySelector('span')!.textContent!);animate(total,[{transform:'scale(1.22)',color:'#fff8e8'},{transform:'scale(1)',color:'#ffdc93'}],560);}
  }}
  if(step===bonusStep+1&&report.payouts.some(pay=>pay.amount>0))for(const payout of content.querySelectorAll<HTMLElement>('.score-payout'))for(let i=0;i<4;i++){
   const rect=content.getBoundingClientRect();fly(new DOMRect(rect.x+rect.width*.5+i*15,rect.y+rect.height*.35,12,12),payout.getBoundingClientRect(),"✦",true);
  }
 }
 function paint(){if(!active)return;content.replaceChildren();overlay.dataset.kind=active.kind;overlay.dataset.step=String(step);
  if(active.kind==="score"){scorePaint(active);return;}
  if(active.kind==="round"||active.kind==="turn")heading(active.kind==="round"?words(`新的一轮 · 第 ${active.round} 轮`,`A new round · Round ${active.round}`):words("出牌回合","Next turn"),words(`轮到 ${name(active.seatId)} 出牌`,`${name(active.seatId)} to play`));
  else if(active.kind==="ante")heading(words(`新的一轮局 · 第 ${active.gambit} 轮局`,`A new gambit · Gambit ${active.gambit}`),words("每人暗置一张前注牌","Each player commits an ante card"));
  else if(active.kind==="end")heading(words("整局结束","Game over"),words(`${active.winners.map(name).join("、")} 获胜`,`${active.winners.map(name).join(", ")} wins`));
  else if(active.kind==="purchase"){heading(words(`${name(active.seatId)} 买牌`,`${name(active.seatId)} buys cards`),words(`翻开定价牌 → 支付 ${active.price} 金币 → 从牌堆补至 4 张手牌`,`Reveal price → Pay ${active.price} gold → Draw from the deck up to 4 hand cards`));const image=cardFaceImage(active.cardId);image.classList.add("purchase-card");content.append(image);}
  else if(active.kind==="reward")heading(words(`${name(active.seatId)} 组成特殊牌阵`,`${name(active.seatId)} completes a special flight`),words(`组合奖励 · ${active.amount} 金币`,`Flight reward · ${active.amount} gold`));
 }
 function next(){cancelTimer();continuation=null;for(const a of animations)a.cancel();animations.clear();active=queue.shift()??null;step=0;overlay.hidden=!active||paused;
  if(active){paint();if(active.kind==="score"){wait(650,advanceScore);}else{animate(content,[{transform:"translateX(-18vw) scale(.9)",opacity:0},{offset:.2,transform:"translateX(0) scale(1)",opacity:1},{offset:.78,transform:"translateX(0) scale(1)",opacity:1},{transform:"translateX(18vw) scale(1.04)",opacity:0}],active.kind==="turn"?1900:2700);wait(active.kind==="turn"?1900:2700,next);}}
  options.onChange();
 }
 function advanceScore(){if(active?.kind!=="score")return;step++;const max=Math.max(0,...active.report.rows.map(row=>row.cards.length));paint();
  options.sound(step>max+1?"coin":"flip",`${active.key}:${step}`);
  if(step>max+1)wait(2600,next);else wait(step===max+1?1100:720,advanceScore);
 }
 return {
  get busy(){return !!active||queue.length>0;},get holdsTable(){return active?.kind==="score"||queue.some(cue=>cue.kind==="score");},
  enqueue(cues:RoundCue[]){if(dead)return;for(const cue of cues){if(seen.has(cue.key))continue;seen.add(cue.key);
   // Never make a lagging viewer watch a backlog of obsolete turn prompts.
   if(cue.kind==='turn'||cue.kind==='round')for(let i=queue.length-1;i>=0;i--)if(queue[i].kind==='turn'||queue[i].kind==='round')queue.splice(i,1);
   if(queue.length<32)queue.push(structuredClone(cue));}while(seen.size>256)seen.delete(seen.values().next().value!);if(!active&&queue.length)next();},
  pause(value:boolean){if(dead||paused===value)return;paused=value;overlay.hidden=!active||paused;if(paused){if(timer!==undefined){remaining=Math.max(0,due-performance.now());cancelTimer();}for(const a of animations)a.pause();}else{for(const a of animations)a.play();arm();}},
  language(value:TableLanguage){language=value;paint();},
  clear(){cancelTimer();continuation=null;active=null;queue.length=0;seen.clear();for(const a of animations)a.cancel();animations.clear();overlay.hidden=true;content.replaceChildren();if(!dead)options.onChange();},
  destroy(){dead=true;cancelTimer();continuation=null;active=null;queue.length=0;for(const a of animations)a.cancel();animations.clear();overlay.remove();}
 };
}
