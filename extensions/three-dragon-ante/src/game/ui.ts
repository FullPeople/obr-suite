import { dragonEngraving } from "./card-art";
import { readHandGesture, type HandGesture } from "./gesture";
import type {TableView} from "./protocol";
import {readUIDraft,type TableDisplayMode,type TableUICommand,type TableUIDraft} from "./ui-command";
import type {Card} from "./rules/cards";
import {card} from "./rules/cards";
import {cardHint, cardName, rulePrompt} from "./rules/prompts";
import type {Choice, EligibleAction, PublicView, SeatView} from "./rules/types";
import {tableText, type TableLanguage} from "./text";

export interface TableUIDeps {send(command:TableUICommand):void|Promise<void>;language:TableLanguage;mode?:TableDisplayMode;gesture?(value:HandGesture):void;id?():string}
/** This surface receives projections only. It never imports or constructs host state. */
export function mountTableUI(root:HTMLElement,deps:TableUIDeps){
 let view:TableView|null=null,lang=deps.language,sending=false,destroyed=false,selectionKey="",selected=new Set<string>(),resetKey="",localMessage="";
 let pendingDraft:TableUIDraft|null=null,touched=false,previewId="",previewPinned=false;
 let hoveredHand = "", gestureTimer: ReturnType<typeof setTimeout> | undefined, gestureSequence = Date.now(), lastGesture = "";
 const gestures = new Map<string, { value: HandGesture; timer: ReturnType<typeof setTimeout> }>();
 const motion = new Set<Animation>();
 const signatures=new Map<string,string>();
 root.className="table-shell";root.dataset.mode=deps.mode??"full";
 root.innerHTML=`<header class="table-header"><div class="table-brand"><span class="brand-mark" aria-hidden="true">◈</span><div><h1 id="title"></h1><p id="edition" class="muted"></p></div></div><div class="window-controls"><button id="tutorial" type="button"></button><button id="language" class="quiet" type="button"></button><button id="display-mode" class="quiet" type="button"></button><button id="close" class="quiet" type="button"></button></div></header>
 <div id="status" class="notice" role="status" aria-live="polite"></div><div id="toolbar" class="toolbar"></div>
 <div id="board-scroll" class="board-scroll"><section id="lobby"></section><div id="arena" class="arena">
 <section id="players" class="players"></section>
 <section id="public-zone" class="public-zone"><div id="summary" class="summary"></div><div class="table-piles"><div id="deck-pile" class="deck-pile"></div><div class="table-seal" aria-hidden="true">◇<span>III</span>◇</div><button id="discard-pile" class="discard-pile" type="button"></button></div><section id="antes"></section><section id="effects"></section></section></div>
 <div class="table-notes"><details id="discard"><summary id="discard-title"></summary><div id="discard-cards"></div></details>
 <details id="log"><summary id="log-title"></summary><ol id="events"></ol></details>
 <details id="help"><summary id="help-title"></summary><p id="help-text"></p><a id="rules-link" href="https://wizkids.com/three-dragon-ante-legendary-edition/" target="_blank" rel="noopener"></a></details></div></div>
 <div class="player-dock"><section id="turn" class="turn" aria-label=""></section><section id="hand" class="hand"></section><footer id="close-hint" class="muted"></footer></div>
 <aside id="card-preview" class="card-preview" aria-live="polite" hidden><button id="close-preview" class="quiet" type="button">×</button><div id="preview-content"></div></aside>
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
 const emblem=dragonEngraving;
 function preview(value:Card,pinned=false){previewId=value.id;previewPinned=pinned;const host=el("preview-content");host.replaceChildren();host.append(node("span",`${value.strength}`,"preview-strength"),node("h2",cardName(value.id,lang)),node("p",t(value.alignment),"card-kind"),node("p",cardHint(value.family,lang),"preview-hint"));el("card-preview").hidden=false;el("card-preview").dataset.pinned=String(pinned);el("card-preview").dataset.color=value.color??value.alignment;}
 function hidePreview(){previewId="";previewPinned=false;el("card-preview").hidden=true;}
 function cardNode(value:Card,optionId?:string):HTMLElement{
  const wrap=node("div",undefined,"card-wrap");wrap.dataset.color=value.color??value.alignment;
  const box=optionId===undefined?node("div"):button("",()=>toggle(optionId));box.className="card";box.dataset.alignment=value.alignment;box.dataset.card=value.id;
  const art=node("span",undefined,`card-art ${value.category}`);art.innerHTML=value.category==="mortal"?'<svg viewBox="0 0 100 100" aria-hidden="true"><path d="m23 25 13 12 14-19 14 19 13-12-5 28H28Z M34 65h32 M29 77h42" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="47" r="4" fill="currentColor"/></svg>':emblem;
  box.append(node("span",String(value.strength),"card-strength"),art,node("strong",cardName(value.id,lang)),node("span",t(value.alignment),"card-kind"),node("span",cardHint(value.family,lang),"card-hint"));
  box.setAttribute("aria-label",`${cardName(value.id,lang)} · ${value.strength}. ${cardHint(value.family,lang)}`);
  if(optionId===undefined){box.tabIndex=0;box.setAttribute("role","button");box.addEventListener("click",()=>preview(value,true));box.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();preview(value,true);}});}
  box.addEventListener("pointerenter",event=>{if(event.pointerType!=="touch"&&!previewPinned)preview(value);});
  box.addEventListener("pointerleave",()=>{if(!previewPinned&&previewId===value.id)hidePreview();});
  box.addEventListener("focus",()=>{if(!previewPinned)preview(value);});box.addEventListener("blur",()=>{if(!previewPinned)hidePreview();});
  box.addEventListener("pointerdown",event=>{if(event.pointerType==="touch")preview(value,true);});
  if(optionId!==undefined){box.dataset.option=optionId;box.setAttribute("aria-pressed",String(selected.has(optionId)));}
  const inspect=button("i",()=>preview(value,true),false,"inspect-card");inspect.setAttribute("aria-label",`${t("inspectCard")}: ${cardName(value.id,lang)}`);inspect.title=t("inspectCard");wrap.append(box,inspect);return wrap;
 }
 function cardList(values:Card[]){const list=node("div",undefined,"cards");for(const value of values)list.append(cardNode(value));return list;}
 function action():EligibleAction|undefined{return privateGame()?.actions[0];}
 function eligibleIds():string[]{const a=action();return !a?[]:a.kind==="choose"?a.choice.options.map(o=>o.id):a.cardIds;}
 function toggle(id:string){if(locked()||!eligibleIds().includes(id))return;touched=true;const a=action()!,max=a.kind==="choose"?a.choice.max:1;
  if(selected.has(id))selected.delete(id);else if(max===1)selected=new Set([id]);else if(selected.size<max)selected.add(id);syncSelection();
 }
 function publishGesture(){
  if (!deps.gesture || destroyed || !privateGame()) return;
  if (gestureTimer) return;
  gestureTimer = setTimeout(() => {
    gestureTimer = undefined; const own = privateGame(); if (!own || destroyed) return;
    const hover = own.hand.findIndex(c => c.id === hoveredHand);
    const value = { gameId: own.id, revision: own.revision, count: own.hand.length, hover: hover < 0 ? null : hover, selected: own.hand.flatMap((c,i) => selected.has(c.id) ? [i] : []), sequence: 0 };
    const signature = JSON.stringify(value); if (signature === lastGesture) return; lastGesture = signature;
    deps.gesture!({ ...value, sequence: gestureSequence = Math.max(gestureSequence + 1, Date.now()) });
  }, 125);
 }
 function syncSelection(){
  const a=action(),min=a?.kind==="choose"?a.choice.min:1,max=a?.kind==="choose"?a.choice.max:1;
  for(const box of root.querySelectorAll<HTMLButtonElement>("button[data-option]")){box.setAttribute("aria-pressed",String(selected.has(box.dataset.option!)));box.disabled=locked()||!eligibleIds().includes(box.dataset.option!)||!!a&&max>1&&selected.size>=max&&!selected.has(box.dataset.option!);}
  for (const wrap of root.querySelectorAll<HTMLElement>("#hand .card-wrap")) wrap.classList.toggle("selected", selected.has(wrap.querySelector<HTMLElement>("[data-card]")?.dataset.card ?? ""));
  publishGesture();
  const confirm=root.querySelector<HTMLButtonElement>("#confirm-action");if(confirm)confirm.disabled=locked()||selected.size<min||selected.size>max;
  const count=root.querySelector("#selection-count");if(count)count.textContent=`${t("selection")}: ${selected.size} · ${t("chooseRange")}: ${min===max?min:`${min}–${max}`}`;
 }
 function draft():TableUIDraft|null{return view?.table&&view.game?{tableId:view.table.id,gameId:view.game.id,selectionKey,selected:[...selected],boardScroll:el("board-scroll").scrollTop,handScroll:root.querySelector<HTMLElement>("#hand .cards")?.scrollLeft??0,open:["discard","log","help"].filter(id=>el<HTMLDetailsElement>(id).open)}:null;}
 function send(command:TableUICommand){
  const windowCommand=command.type==="close"||command.type==="display"||command.type==="remember";
  if(destroyed)return;if(!windowCommand&&command.type!=="retry"&&(busy()||(!view?.connected&&!(command.type==="newGame"&&view?.isHost&&view.message==="recoveryMissing"))))return;
  if(command.type==="close"||command.type==="display")command={...command,draft:draft()??undefined};
  if(!windowCommand){sending=true;localMessage="";render();}
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
  const key=game?`${game.id}:${game.gambit}:${game.round}:${a?.kind??"waiting"}:${a?.kind==="choose"?a.choice.id:""}`:"";
  if(key!==selectionKey){selectionKey=key;selected.clear();}selected=new Set([...selected].filter(id=>eligibleIds().includes(id)));
  document.documentElement.lang=lang==="en"?"en":"zh-CN";document.title=t("title");
  root.dataset.phase=game?.phase??"lobby";root.dataset.players=String(game?.seats.length??0);
  for(const [id,code] of [["title","title"],["edition","edition"],["log-title","history"],["help-title","help"],["help-text","helpText"],["rules-link","rules"],["close-hint","closeHint"],["reset-title","resetTitle"],["reset-body","resetBody"],["cancel-reset","cancel"],["confirm-reset","confirmReset"]])el(id).textContent=t(code);
  el("tutorial").textContent = lang === "en" ? "Learn by playing" : "跟着打一局"; el("language").textContent = lang === "en" ? "中文" : "English";
  el("close").setAttribute("aria-label",t("close"));el("close").title=t("close");el("close").textContent=t("backToMap");el("display-mode").textContent=t(deps.mode==="compact"?"expand":"minimize");el("close-preview").setAttribute("aria-label",t("closePreview"));
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
  section("summary",game&&[game.gambit,game.round,game.stakes,game.hole],host=>{if(!game)return;for(const [code,value] of [["gambit",game.gambit],["round",game.round],["stakes",game.stakes],["hole",game.hole]]){const chip=node("span",undefined,`counter ${code}`);chip.append(node("small",t(String(code))),node("strong",String(value)));host.append(chip);}});
  section("deck-pile",game?.deckCount,host=>{if(!game)return;const back=node("div",undefined,"card-back deck-back");back.setAttribute("aria-hidden","true");back.textContent="◈";host.append(back,node("span",`${t("deck")} · ${game.deckCount}`));});
  el("discard-pile").textContent=`${t("discard")} · ${game?.discard.length??0}`;
  section("turn",game&&[game.id,game.phase,game.winners,game.issue,game.waitingSeatIds,game.choice,a,own?.committedAnte,game.seats.map(s=>[s.id,s.name])],host=>{
   if(!game)return;
   if(game.phase==="adjudication"){host.append(node("h2",t("paused")),node("p",rulePrompt(game.issue??"ADJUDICATION_REQUIRED",lang)),node("p",t("pausedHelp"),"muted"));return;}
   if(game.phase==="ended"){host.append(node("h2",t("ended")),node("p",`${t("winners")}: ${game.winners.map(seatName).join(", ")}`));return;}
   if(a?.kind==="choose")renderChoice(host,a.choice);
   else if(a)host.append(node("h2",t(a.kind==="ante"?"antePrompt":"playPrompt")));
   else {host.append(node("h2",`${t("waitingFor")}: ${game.waitingSeatIds.map(seatName).join(", ")||t("waiting")}`));if(own?.committedAnte)host.append(node("p",`${t("ownAnte")}: ${cardName(own.committedAnte.id,lang)} · ${own.committedAnte.strength}`));}
   if(a){const row=node("div",undefined,"action-row"),count=node("span",undefined,"muted");count.id="selection-count";const confirm=button(t(a.kind==="ante"?"confirmAnte":a.kind==="play"?"confirmPlay":"confirmChoice"),confirmAction,true,"primary");confirm.id="confirm-action";row.append(count,confirm);host.append(row);}
  });
  section("hand",own&&[game?.id,own.hand,a?.kind,a&&a.kind!=="choose"?a.cardIds:[]],host=>{if(!own)return;const heading=node("div",undefined,"hand-heading");heading.append(node("h2",`${t("hand")} · ${own.hand.length}`),node("span",t("inspectHint"),"muted"));host.append(heading);const cards=node("div",undefined,"cards");for(const value of own.hand){
    const wrap=cardNode(value,a&&a.kind!=="choose"&&a.cardIds.includes(value.id)?value.id:undefined);
    wrap.addEventListener("pointerenter",()=>{hoveredHand=value.id;publishGesture();});
    wrap.addEventListener("pointerleave",()=>{if(hoveredHand===value.id){hoveredHand="";publishGesture();}});
    wrap.addEventListener("focusin",()=>{hoveredHand=value.id;publishGesture();});
    wrap.addEventListener("focusout",()=>{hoveredHand="";publishGesture();}); cards.append(wrap);
   }host.append(cards);});
  section("players",game&&[own?.selfSeatId,game.seats,game.leaderSeatId,game.activeSeatId],host=>{if(!game)return;
   const selfIndex=game.seats.findIndex(seat=>seat.id===own?.selfSeatId),ordered=selfIndex<0?game.seats:[...game.seats.slice(selfIndex+1),...game.seats.slice(0,selfIndex)];
   const positions=ordered.length===1?["top"]:ordered.length===2?["upper-left","upper-right"]:ordered.length===3?["upper-left","top","upper-right"]:["upper-left","top","upper-right","lower-right","lower-left","bottom"];
   for(const seat of game.seats){const panel=node("article",undefined,"seat");panel.dataset.seat=seat.id;panel.dataset.position=seat.id===own?.selfSeatId?"bottom":positions[ordered.findIndex(other=>other.id===seat.id)];panel.classList.toggle("active",seat.id===game.activeSeatId);panel.classList.toggle("self",seat.id===own?.selfSeatId);
   panel.append(node("h2",`${seat.name}${seat.id===own?.selfSeatId?` (${t("you")})`:""}${seat.id===game.leaderSeatId?` · ${t("leader")}`:""}`),node("p",`${t("gold")} ${seat.gold} · ${t("handCount")} ${seat.handCount} · ${t("strength")} ${seat.strength}${seat.debt?` · ${t("debt")} ${seat.debt}`:""}`));
   if(seat.id!==own?.selfSeatId){const backs=node("div",undefined,"opponent-hand");backs.setAttribute("aria-label",`${seat.name} · ${t("handCount")} ${seat.handCount}`);for(let index=0;index<Math.min(10,seat.handCount);index++){const back=node("span","◈","card-back");back.setAttribute("aria-hidden","true");back.dataset.slot=String(index);back.style.setProperty("--angle",`${(index-(Math.min(10,seat.handCount)-1)/2)*7}deg`);back.style.setProperty("--arc",`${Math.abs(index-(Math.min(10,seat.handCount)-1)/2)*2}px`);backs.append(back);}panel.append(backs);}
   if(seat.committed)panel.append(node("small",t("committed")));if(seat.archmage)panel.append(node("p",t("archmage"),"effect"));
   const flight=node("div",undefined,"cards flight");for(const item of seat.flight){const c=cardNode(item.card);if(item.wild)c.append(node("small",t("wild")));if(item.rider)c.append(node("small",t("rider")));flight.append(c);}panel.append(flight);host.append(panel);
  }});
  section("antes",game&&[game.ante,game.revealed],host=>{if(!game)return;host.append(node("h2",t("ante")));host.append(game.ante.length?cardList(game.ante):node("p",t("none"),"muted"));if(game.revealed.length)host.append(node("h2",t("revealed")),cardList(game.revealed));});
  section("effects",game&&[game.effects,game.lastGambit],host=>{if(!game)return;if(game.effects?.length){host.append(node("h2",t("effects")));for(const effect of game.effects)host.append(node("p",`${seatName(effect.seatId)} · ${t(effect.kind)}`));}if(game.lastGambit)host.append(node("p",`${t("lastGambit")}: ${game.lastGambit.winners.map(seatName).join(", ")}`));});
  el("discard").hidden=!game;el("discard-title").textContent=`${t("discard")} · ${game?.discard.length??0}`;renderDiscard();
  section("events",game?.events,host=>{for(const event of game?.events.slice(-30).reverse()??[]){const parts=[seatName(event.seatId),t(event.code),event.amount===undefined?"":String(event.amount),seatName(event.targetSeatId),...(event.cardIds??[]).map(id=>cardName(id,lang))].filter(Boolean);host.append(node("li",parts.join(" · ")));}});
  el("arena").hidden=!game;el("log").hidden=!game;el("turn").hidden=!game;el("hand").hidden=!own;el("turn").setAttribute("aria-label",t("acting"));syncSelection();
  if(previewId){const visible=[...(own?.hand??[]),...(game?.ante??[]),...(game?.revealed??[]),...(game?.discard??[]),...(game?.seats.flatMap(seat=>seat.flight.map(value=>value.card))??[]),...(a?.kind==="choose"?a.choice.options.filter(option=>option.cardId).map(option=>card(option.cardId!)):[])].find(value=>value.id===previewId);if(visible)preview(visible,previewPinned);else hidePreview();}
  restoreDraft(); layoutFan(); paintGestures();
  if(el<HTMLDialogElement>("reset-dialog").open&&resetKey!==`${table?.id}:${game?.id}`)el<HTMLDialogElement>("reset-dialog").close();
 }
 function renderDiscard(){if(destroyed||!el<HTMLDetailsElement>("discard").open)return;section("discard-cards",view?.game?.discard,host=>host.append(cardList(view?.game?.discard??[])));}
 function restoreDraft(){if(!pendingDraft||!view?.game)return;const incoming=pendingDraft;pendingDraft=null;if(touched||incoming.tableId!==view.table?.id||incoming.gameId!==view.game.id||incoming.selectionKey!==selectionKey)return;
  const max=action()?.kind==="choose"?(action() as {kind:"choose";choice:Choice}).choice.max:1;
  selected=new Set(incoming.selected.filter(id=>eligibleIds().includes(id)).slice(0,max));syncSelection();
  for(const id of incoming.open)el<HTMLDetailsElement>(id).open=true;renderDiscard();
  el("board-scroll").scrollTop=incoming.boardScroll;const hand=root.querySelector<HTMLElement>("#hand .cards");if(hand)hand.scrollLeft=incoming.handScroll;
 }
 function layoutFan() {
   const hand=root.querySelector<HTMLElement>("#hand .cards"); if(!hand)return;
   const wraps=[...hand.querySelectorAll<HTMLElement>(".card-wrap")], width=wraps[0]?.offsetWidth??100;
   const step=Math.max(12,Math.min(width*.65,(hand.clientWidth-width-48)/Math.max(1,wraps.length-1)));
   const faceHeight = wraps[0]?.querySelector<HTMLElement>(".card")?.offsetHeight ?? 0;
   hand.style.height = `${faceHeight + 30 + Math.pow(Math.max(0,wraps.length-1)/2,2)*1.4}px`;
   for(const [i,wrap] of wraps.entries()) { const offset=i-(wraps.length-1)/2; wrap.style.setProperty("--fan-x",`${offset*step}px`);wrap.style.setProperty("--fan-angle",`${offset*Math.min(5.5,30/Math.max(1,wraps.length))}deg`);wrap.style.setProperty("--fan-y",`${offset*offset*1.4}px`);wrap.style.setProperty("--card-order",String(i+1)); }
 }
 function paintGestures() {
  for(const [seatId,entry] of gestures){
   const seat = view?.game?.seats.find(s=>s.id===seatId);
   if(!seat || view?.game?.id!==entry.value.gameId || view.game.revision!==entry.value.revision || seat.handCount!==entry.value.count){clearTimeout(entry.timer);gestures.delete(seatId);}
  }
  for(const seat of root.querySelectorAll<HTMLElement>(".seat[data-seat]")) {
   const gesture=gestures.get(seat.dataset.seat!)?.value;
   for(const back of seat.querySelectorAll<HTMLElement>("[data-slot]")){const index=Number(back.dataset.slot);back.classList.toggle("hovered",gesture?.hover===index);back.classList.toggle("selected",gesture?.selected.includes(index)??false);}
  }
 }
 function animateChanges(previous: TableView|null) {
   if(!previous?.game || previous.game.id!==view?.game?.id || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
   const oldFlights=new Set(previous.game.seats.flatMap(s=>s.flight.map(c=>c.cardId)));
   for(const card of root.querySelectorAll<HTMLElement>(".flight [data-card]")) {
     if(oldFlights.has(card.dataset.card!))continue;
     const a=card.animate([{transform:"translateY(-70px) translateZ(50px) rotate(-12deg) scale(1.22)",opacity:0,boxShadow:"0 32px 18px #0007"},{offset:.76,transform:"translateY(3px) rotate(1deg) scale(.98)",opacity:1},{transform:"none",opacity:1}],{duration:500,easing:"cubic-bezier(.2,.7,.25,1)"}); motion.add(a);a.finished.catch(()=>{}).finally(()=>motion.delete(a));
   }
   const oldHand=new Set("hand" in previous.game ? (previous.game as SeatView).hand.map(c=>c.id):[]);
   for(const card of root.querySelectorAll<HTMLElement>("#hand [data-card]")){
    if(oldHand.has(card.dataset.card!))continue;
    const a=card.animate([{transform:"translateY(-130px) rotateY(90deg) scale(.65)",opacity:0},{transform:"none",opacity:1}],{duration:420,easing:"ease-out"});motion.add(a);a.finished.catch(()=>{}).finally(()=>motion.delete(a));
   }
 }
 const resize = new ResizeObserver(layoutFan); resize.observe(el("hand"));
 el("discard").addEventListener("toggle",renderDiscard);
 el("discard-pile").addEventListener("click",()=>{el<HTMLDetailsElement>("discard").open=true;renderDiscard();el("discard").scrollIntoView({block:"nearest"});});
 el("close-preview").addEventListener("click",hidePreview);
 el("display-mode").addEventListener("click",()=>send({type:"display",mode:deps.mode==="compact"?"full":"compact"}));
 const keydown=(event:KeyboardEvent)=>{if(event.key==="Escape"&&previewId){event.preventDefault();event.stopPropagation();hidePreview();}};root.addEventListener("keydown",keydown);
 el("close").addEventListener("click",()=>send({type:"close"}));el("cancel-reset").addEventListener("click",()=>el<HTMLDialogElement>("reset-dialog").close());
 el("confirm-reset").addEventListener("click",()=>{el<HTMLDialogElement>("reset-dialog").close();if(view?.isHost&&resetKey===`${view.table?.id}:${view.game?.id}`)send({type:"newGame"});});
 render();return {update(value:TableView){const previous=view;view=value;sending=false;localMessage="";render();animateChanges(previous);},gesture(seatId:string,value:unknown){if(value===null){const entry=gestures.get(seatId);if(entry)clearTimeout(entry.timer);gestures.delete(seatId);paintGestures();return;}const gesture=readHandGesture(value);if(!gesture||seatId===privateGame()?.selfSeatId)return;const old=gestures.get(seatId);if(old&&gesture.sequence<=old.value.sequence)return;if(old)clearTimeout(old.timer);gestures.set(seatId,{value:gesture,timer:setTimeout(()=>{gestures.delete(seatId);paintGestures();},30000)});paintGestures();},language(value:TableLanguage){lang=value;render();},restore(value:unknown){if(!touched)pendingDraft=readUIDraft(value);restoreDraft();},draft,failed(){sending=false;localMessage="requestFailed";if(view)view={...view,pending:false,connected:false};render();},destroy(){destroyed=true;resize.disconnect();if(gestureTimer)clearTimeout(gestureTimer);for(const entry of gestures.values())clearTimeout(entry.timer);for(const a of motion)a.cancel();root.removeEventListener("keydown",keydown);el<HTMLDialogElement>("reset-dialog").close();root.replaceChildren();}};
}
