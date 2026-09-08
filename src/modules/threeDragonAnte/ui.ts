import type {TableCommand, TableView} from "./protocol";
import type {Card} from "./rules/cards";
import {card} from "./rules/cards";
import {cardHint, cardName, rulePrompt} from "./rules/prompts";
import type {Choice, EligibleAction, PublicView, SeatView} from "./rules/types";
import {tableText, type TableLanguage} from "./text";

export interface TableUIDeps {send(command:TableCommand):void|Promise<void>;language:TableLanguage;id?():string}
/** This surface receives projections only. It never imports or constructs host state. */
export function mountTableUI(root:HTMLElement,deps:TableUIDeps){
 let view:TableView|null=null,lang=deps.language,sending=false,destroyed=false,selectionKey="",selected=new Set<string>(),resetKey="",localMessage="";
 const signatures=new Map<string,string>();
 root.innerHTML=`<header class="table-header"><div><h1 id="title"></h1><p id="edition" class="muted"></p></div><button id="close" class="quiet" type="button">×</button></header>
 <div id="status" class="notice" role="status" aria-live="polite"></div><div id="toolbar" class="toolbar"></div>
 <section id="lobby"></section><section id="summary" class="summary"></section>
 <section id="turn" class="turn" aria-label=""></section><section id="hand" class="hand"></section>
 <section id="players" class="players"></section><section id="antes"></section><section id="effects"></section>
 <details id="discard"><summary id="discard-title"></summary><div id="discard-cards"></div></details>
 <details id="log"><summary id="log-title"></summary><ol id="events"></ol></details>
 <details id="help"><summary id="help-title"></summary><p id="help-text"></p><a id="rules-link" href="https://wizkids.com/three-dragon-ante-legendary-edition/" target="_blank" rel="noopener"></a></details>
 <footer id="close-hint" class="muted"></footer>
 <dialog id="reset-dialog" aria-labelledby="reset-title"><h2 id="reset-title"></h2><p id="reset-body"></p><div class="toolbar"><button id="cancel-reset" type="button"></button><button id="confirm-reset" class="danger" type="button"></button></div></dialog>`;
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>(`#${id}`)!;
 const t=(code:string)=>tableText(code,lang);
 const seatName=(id:string|null|undefined)=>view?.game?.seats.find(s=>s.id===id)?.name??view?.table?.seats.find(s=>s.seatId===id)?.name??"";
 const privateGame=():SeatView|null=>view?.game&&"selfSeatId" in view.game?view.game as SeatView:null;
 const busy=()=>sending||!!view?.pending;
 const locked=()=>busy()||!view?.connected||!!view?.message&&["hostOffline","recoveryMissing","protocolMismatch","privateSync"].includes(view.message);
 const node=(tag:string,text?:string,className?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
 function section(id:string,signature:unknown,build:(host:HTMLElement)=>void){const value=JSON.stringify([lang,signature]);if(signatures.get(id)===value)return;signatures.set(id,value);const host=el(id);host.replaceChildren();build(host);}
 function button(label:string,fn:()=>void,disabled=false,className=""){const b=document.createElement("button");b.type="button";b.textContent=label;b.disabled=disabled;b.className=className;b.addEventListener("click",fn);return b;}
 function cardNode(value:Card,optionId?:string):HTMLElement{
  const box=optionId===undefined?node("div"):button("",()=>toggle(optionId));box.className="card";box.dataset.alignment=value.alignment;
  box.append(node("strong",`${cardName(value.id,lang)} · ${value.strength}`),node("span",t(value.alignment),"card-kind"),node("span",cardHint(value.family,lang),"card-hint"));
  if(optionId!==undefined){box.dataset.option=optionId;box.setAttribute("aria-pressed",String(selected.has(optionId)));}
  return box;
 }
 function cardList(values:Card[]){const list=node("div",undefined,"cards");for(const value of values)list.append(cardNode(value));return list;}
 function action():EligibleAction|undefined{return privateGame()?.actions[0];}
 function eligibleIds():string[]{const a=action();return !a?[]:a.kind==="choose"?a.choice.options.map(o=>o.id):a.cardIds;}
 function toggle(id:string){if(locked()||!eligibleIds().includes(id))return;const a=action()!,max=a.kind==="choose"?a.choice.max:1;
  if(selected.has(id))selected.delete(id);else if(max===1)selected=new Set([id]);else if(selected.size<max)selected.add(id);syncSelection();
 }
 function syncSelection(){
  const a=action(),min=a?.kind==="choose"?a.choice.min:1,max=a?.kind==="choose"?a.choice.max:1;
  for(const box of root.querySelectorAll<HTMLButtonElement>("button[data-option]")){box.setAttribute("aria-pressed",String(selected.has(box.dataset.option!)));box.disabled=locked()||!eligibleIds().includes(box.dataset.option!)||!!a&&max>1&&selected.size>=max&&!selected.has(box.dataset.option!);}
  const confirm=root.querySelector<HTMLButtonElement>("#confirm-action");if(confirm)confirm.disabled=locked()||selected.size<min||selected.size>max;
  const count=root.querySelector("#selection-count");if(count)count.textContent=`${t("selection")}: ${selected.size} · ${t("chooseRange")}: ${min===max?min:`${min}–${max}`}`;
 }
 function send(command:TableCommand){
  if(destroyed)return;if(command.type!=="close"&&command.type!=="retry"&&(busy()||(!view?.connected&&!(command.type==="newGame"&&view?.isHost&&view.message==="recoveryMissing"))))return;
  if(command.type!=="close"){sending=true;localMessage="";render();}
  try{Promise.resolve(deps.send(command)).catch(()=>{if(!destroyed){sending=false;localMessage="requestFailed";render();}});}catch{sending=false;localMessage="requestFailed";render();}
 }
 function confirmAction(){const game=privateGame(),a=action();if(!game||!a||locked())return;const ids=[...selected];
  if(a.kind==="choose"){if(ids.length<a.choice.min||ids.length>a.choice.max||ids.some(id=>!a.choice.options.some(o=>o.id===id)))return;send({type:"action",action:{id:deps.id?.()??crypto.randomUUID(),revision:game.revision,seatId:game.selfSeatId,kind:"choose",choiceId:a.choice.id,optionIds:ids}});}
  else if(ids.length===1&&a.cardIds.includes(ids[0]))send({type:"action",action:{id:deps.id?.()??crypto.randomUUID(),revision:game.revision,seatId:game.selfSeatId,kind:a.kind,cardId:ids[0]}});
 }
 function reset(){resetKey=`${view?.table?.id}:${view?.game?.id}`;el<HTMLDialogElement>("reset-dialog").showModal();}
 function renderChoice(host:HTMLElement,choice:Choice){
  host.append(node("h2",rulePrompt(choice.code,lang)));
  if(choice.beneficiarySeatId)host.append(node("p",`${t("abilityBy")}: ${seatName(choice.beneficiarySeatId)}${choice.sourceCardId?` · ${cardName(choice.sourceCardId,lang)}`:""}`,"muted"));
  const options=node("div",undefined,"cards choices");for(const option of choice.options){let item:HTMLElement;
   if(option.cardId){item=cardNode(card(option.cardId),option.id);const owner=view?.game?.seats.find(s=>s.flight.some(f=>f.cardId===option.cardId));if(owner)item.append(node("small",owner.name));}
   else {item=button(option.seatId?seatName(option.seatId):rulePrompt(option.code!,lang),()=>toggle(option.id));item.dataset.option=option.id;item.setAttribute("aria-pressed",String(selected.has(option.id)));}
   options.append(item);
  }host.append(options);
 }
 function render(){if(destroyed)return;
  const game=view?.game,own=privateGame(),a=action(),table=view?.table;
  const key=game?`${game.id}:${a?.kind??"waiting"}:${a?.kind==="choose"?a.choice.id:""}`:"";
  if(key!==selectionKey){selectionKey=key;selected.clear();}selected=new Set([...selected].filter(id=>eligibleIds().includes(id)));
  document.documentElement.lang=lang==="en"?"en":"zh-CN";document.title=t("title");
  for(const [id,code] of [["title","title"],["edition","edition"],["log-title","history"],["help-title","help"],["help-text","helpText"],["rules-link","rules"],["close-hint","closeHint"],["reset-title","resetTitle"],["reset-body","resetBody"],["cancel-reset","cancel"],["confirm-reset","confirmReset"]])el(id).textContent=t(code);
  el("close").setAttribute("aria-label",t("close"));el("close").title=t("close");
  const message=localMessage?t(localMessage):view?.message?tableText(view.message,lang):busy()?t("sending"):!view||!view.connected?t("connecting"):"";
  el("status").textContent=message;el("status").hidden=!message;el("status").classList.toggle("error",!!view?.message&&!['connecting','privateSync'].includes(view.message));
  section("toolbar",[table,view?.selfPlayerId,view?.isHost,view?.connected,view?.message,busy(),localMessage],host=>{
   const seated=table?.seats.some(s=>s.playerId===view?.selfPlayerId);
   if(view&&!table)host.append(button(t("create"),()=>send({type:"create"}),locked(),"primary"));
   else if(table){
    if(!seated&&table.stage!=="playing")host.append(button(t("join"),()=>send({type:"join"}),locked()||table.seats.length>=6,"primary"));
    if(seated&&table.stage!=="playing")host.append(button(t("leave"),()=>send({type:"leave"}),locked()));
    if(view?.isHost&&table.stage==="lobby")host.append(button(t("start"),()=>send({type:"start"}),locked()||table.seats.length<2,"primary"));
    if(view?.isHost&&table.stage!=="lobby")host.append(button(t("newGame"),reset,busy()||(!view.connected&&view.message!=="recoveryMissing")));
   }
   if(!view?.connected||view?.message||localMessage)host.append(button(t("retry"),()=>send({type:"retry"}),busy()));
  });
  section("lobby",[table,view?.selfPlayerId,view?.isHost,!!game],host=>{
   if(!table){host.append(node("p",t("noTable")));return;}
   if(!game){host.append(node("p",t(table.stage==="playing"?"privateSync":"lobby")));const seats=node("div",undefined,"seat-chips");for(const seat of table.seats)seats.append(node("span",`${seat.name}${seat.playerId===view?.selfPlayerId?` (${t("you")})`:""}${seat.playerId===table.hostPlayerId?` · ${t("host")}`:""}`));host.append(seats);if(table.stage==="lobby")host.append(node("p",t(table.seats.length<2?"needPlayers":view?.isHost?"lobby":"seated"),"muted"));}
   else if(!own)host.append(node("p",t(table.stage==="playing"?"watch":"spectator"),"muted"));
  });
  section("summary",game&&[game.gambit,game.round,game.stakes,game.hole,game.deckCount],host=>{if(!game)return;for(const [code,value] of [["gambit",game.gambit],["round",game.round],["stakes",game.stakes],["hole",game.hole],["deck",game.deckCount]])host.append(node("span",`${t(String(code))} ${value}`));});
  section("turn",game&&[game.id,game.phase,game.winners,game.issue,game.waitingSeatIds,game.choice,a,own?.committedAnte,game.seats.map(s=>[s.id,s.name])],host=>{
   if(!game)return;
   if(game.phase==="adjudication"){host.append(node("h2",t("paused")),node("p",rulePrompt(game.issue??"ADJUDICATION_REQUIRED",lang)),node("p",t("pausedHelp"),"muted"));return;}
   if(game.phase==="ended"){host.append(node("h2",t("ended")),node("p",`${t("winners")}: ${game.winners.map(seatName).join(", ")}`));return;}
   if(a?.kind==="choose")renderChoice(host,a.choice);
   else if(a)host.append(node("h2",t(a.kind==="ante"?"antePrompt":"playPrompt")));
   else {host.append(node("h2",`${t("waitingFor")}: ${game.waitingSeatIds.map(seatName).join(", ")||t("waiting")}`));if(own?.committedAnte)host.append(node("p",`${t("ownAnte")}: ${cardName(own.committedAnte.id,lang)} · ${own.committedAnte.strength}`));}
   if(a){const row=node("div",undefined,"action-row"),count=node("span",undefined,"muted");count.id="selection-count";const confirm=button(t(a.kind==="ante"?"confirmAnte":a.kind==="play"?"confirmPlay":"confirmChoice"),confirmAction,true,"primary");confirm.id="confirm-action";row.append(count,confirm);host.append(row);}
  });
  section("hand",own&&[game?.id,own.hand,a?.kind,a&&a.kind!=="choose"?a.cardIds:[]],host=>{if(!own)return;host.append(node("h2",t("hand")));const cards=node("div",undefined,"cards");for(const value of own.hand)cards.append(cardNode(value,a&&a.kind!=="choose"&&a.cardIds.includes(value.id)?value.id:undefined));host.append(cards);});
  section("players",game&&[own?.selfSeatId,game.seats,game.leaderSeatId,game.activeSeatId],host=>{if(!game)return;for(const seat of game.seats){const panel=node("article",undefined,"seat");panel.dataset.seat=seat.id;panel.classList.toggle("active",seat.id===game.activeSeatId);
   panel.append(node("h2",`${seat.name}${seat.id===own?.selfSeatId?` (${t("you")})`:""}${seat.id===game.leaderSeatId?` · ${t("leader")}`:""}`),node("p",`${t("gold")} ${seat.gold} · ${t("handCount")} ${seat.handCount} · ${t("strength")} ${seat.strength}${seat.debt?` · ${t("debt")} ${seat.debt}`:""}`));
   if(seat.committed)panel.append(node("small",t("committed")));if(seat.archmage)panel.append(node("p",t("archmage"),"effect"));
   const flight=node("div",undefined,"cards flight");for(const item of seat.flight){const c=cardNode(item.card);if(item.wild)c.append(node("small",t("wild")));if(item.rider)c.append(node("small",t("rider")));flight.append(c);}panel.append(flight);host.append(panel);
  }});
  section("antes",game&&[game.ante,game.revealed],host=>{if(!game)return;host.append(node("h2",t("ante")),cardList(game.ante));if(game.revealed.length)host.append(node("h2",t("revealed")),cardList(game.revealed));});
  section("effects",game&&[game.effects,game.lastGambit],host=>{if(!game)return;if(game.effects?.length){host.append(node("h2",t("effects")));for(const effect of game.effects)host.append(node("p",`${seatName(effect.seatId)} · ${t(effect.kind)}`));}if(game.lastGambit)host.append(node("p",`${t("lastGambit")}: ${game.lastGambit.winners.map(seatName).join(", ")}`));});
  el("discard").hidden=!game;el("discard-title").textContent=`${t("discard")} · ${game?.discard.length??0}`;renderDiscard();
  section("events",game?.events,host=>{for(const event of game?.events.slice(-30).reverse()??[]){const parts=[seatName(event.seatId),t(event.code),event.amount===undefined?"":String(event.amount),seatName(event.targetSeatId),...(event.cardIds??[]).map(id=>cardName(id,lang))].filter(Boolean);host.append(node("li",parts.join(" · ")));}});
  el("log").hidden=!game;el("turn").hidden=!game;el("hand").hidden=!own;el("turn").setAttribute("aria-label",t("acting"));syncSelection();
  if(el<HTMLDialogElement>("reset-dialog").open&&resetKey!==`${table?.id}:${game?.id}`)el<HTMLDialogElement>("reset-dialog").close();
 }
 function renderDiscard(){if(destroyed||!el<HTMLDetailsElement>("discard").open)return;section("discard-cards",view?.game?.discard,host=>host.append(cardList(view?.game?.discard??[])));}
 el("discard").addEventListener("toggle",renderDiscard);
 el("close").addEventListener("click",()=>send({type:"close"}));el("cancel-reset").addEventListener("click",()=>el<HTMLDialogElement>("reset-dialog").close());
 el("confirm-reset").addEventListener("click",()=>{el<HTMLDialogElement>("reset-dialog").close();if(view?.isHost&&resetKey===`${view.table?.id}:${view.game?.id}`)send({type:"newGame"});});
 render();return {update(value:TableView){view=value;sending=false;localMessage="";render();},language(value:TableLanguage){lang=value;render();},failed(){sending=false;localMessage="requestFailed";if(view)view={...view,pending:false,connected:false};render();},destroy(){destroyed=true;el<HTMLDialogElement>("reset-dialog").close();root.replaceChildren();}};
}
