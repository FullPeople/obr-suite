import { dragonEngraving } from "./card-art";
import { readHandGesture, type HandGesture } from "./gesture";
import type {TableView} from "./protocol";
import {readUIDraft,type TableDisplayMode,type TableUICommand,type TableUIDraft} from "./ui-command";
import type {Card} from "./rules/cards";
import {card} from "./rules/cards";
import {cardHint, cardName, rulePrompt} from "./rules/prompts";
import type {Choice, EligibleAction, PublicEvent, PublicView, SeatView} from "./rules/types";
import {tableText, type TableLanguage} from "./text";
import {mountTableStage, type StageHandle, type StageHit} from "./stage";
import {mountDragController, type DropIntent, type DragContext} from "./interaction/drag-controller";
import type {GameAction} from "./rules/types";
import "./stage-ui.css";

export interface TableUIDeps {send(command:TableUICommand):void|Promise<void>;language:TableLanguage;mode?:TableDisplayMode;gesture?(value:HandGesture):void;id?():string}
/** This surface receives projections only. It never imports or constructs host state. */
export function mountTableUI(root:HTMLElement,deps:TableUIDeps){
 let view:TableView|null=null,lang=deps.language,sending=false,destroyed=false,selectionKey="",selected=new Set<string>(),resetKey="",localMessage="";
 let pendingDraft:TableUIDraft|null=null,touched=false,previewId="",previewPinned=false;
 let hoveredHand = "", gestureTimer: ReturnType<typeof setTimeout> | undefined, gestureSequence = Date.now(), lastGesture = "";
 const gestures = new Map<string, { value: HandGesture; timer: ReturnType<typeof setTimeout> }>();
 const motion = new Set<Animation>();
 const signatures=new Map<string,string>();
 const scopeId=crypto.randomUUID();
 let stage:StageHandle|null=null,stageAvailable=false,stageReady=false,suspended=false;
 let dragController:ReturnType<typeof mountDragController>|null=null,domDragController:ReturnType<typeof mountDragController>|null=null;
 let keyboardCard="",keyboardHeld=false,dispatchFailed=false,resetStage=false;
 let keyboardContext:DragContext|null=null;
 let pointerCard="";
 let domGhost:HTMLElement|null=null;
 let bannerEvent:PublicEvent|null=null,bannerTimer:ReturnType<typeof setTimeout>|undefined;
 let revealPhase:"placing"|"revealing"|"price"|"payment"|"discard"|null=null;
 let pendingAction:{actionId:string;tableId:string;gameId:string;revision:number;cardId?:string;zone?:"ante"|"flight";action:GameAction;retryable:boolean}|null=null;
 const reduced=matchMedia("(prefers-reduced-motion: reduce)");
 root.className="table-shell";root.dataset.mode=deps.mode??"full";
 root.innerHTML=`<header class="table-header"><div class="table-brand"><span class="brand-mark" aria-hidden="true">◈</span><div><h1 id="title"></h1><p id="edition" class="muted"></p></div></div><div class="window-controls"><button id="tutorial" type="button"></button><button id="language" class="quiet" type="button"></button><button id="display-mode" class="quiet" type="button"></button><button id="close" class="quiet" type="button"></button></div></header>
 <div id="toolbar" class="toolbar"></div>
 <div id="board-scroll" class="board-scroll"><div id="table-banner" class="table-banner" role="status" aria-live="polite" hidden><p id="waiting-banner"></p><p id="effect-banner"></p></div><section id="lobby"></section><div id="stage-host" hidden><canvas id="table-stage" tabindex="0" role="application" aria-describedby="stage-keyboard"></canvas><div id="stage-summary"></div><p id="stage-keyboard" aria-live="polite"></p></div><div id="arena" class="arena">
 <section id="players" class="players"></section>
 <section id="public-zone" class="public-zone"><div id="summary" class="summary"></div><div class="table-piles"><div id="deck-pile" class="deck-pile"></div><div class="table-seal" aria-hidden="true">◇<span>III</span>◇</div><button id="discard-pile" class="discard-pile" type="button"></button></div><section id="antes"></section><section id="effects"></section></section></div>
 <div class="table-notes"><details id="accessible-table"><summary id="accessible-title"></summary><div id="accessible-seats"></div></details><details id="discard"><summary id="discard-title"></summary><div id="discard-cards"></div></details>
 <details id="log"><summary id="log-title"></summary><ol id="events"></ol></details>
 <details id="help"><summary id="help-title"></summary><p id="help-text"></p><a id="rules-link" href="https://wizkids.com/three-dragon-ante-legendary-edition/" target="_blank" rel="noopener"></a></details></div></div>
 <div class="table-bubbles"><div id="status" class="notice" role="status" aria-live="polite" hidden></div><section id="turn" class="turn" aria-label="" hidden></section></div>
 <div class="player-dock"><section id="hand" class="hand"></section></div>
 <aside id="card-preview" class="card-preview" aria-live="polite" hidden><button id="close-preview" class="quiet" type="button">×</button><div id="preview-content"></div></aside>
 <dialog id="reset-dialog" aria-labelledby="reset-title"><h2 id="reset-title"></h2><p id="reset-body"></p><div class="toolbar"><button id="cancel-reset" type="button"></button><button id="confirm-reset" class="danger" type="button"></button></div></dialog>`;
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>(`#${id}`)!;
 const t=(code:string)=>tableText(code,lang);
 const seatName=(id:string|null|undefined)=>view?.game?.seats.find(s=>s.id===id)?.name??view?.table?.seats.find(s=>s.seatId===id)?.name??"";
 const privateGame=():SeatView|null=>view?.game&&"selfSeatId" in view.game?view.game as SeatView:null;
 const receiptCompatible=()=>view?.actionReceiptVersion===1;
 const busy=()=>sending||!!view?.pending||!!pendingAction;
 const locked=()=>busy()||!receiptCompatible()||!view?.connected||!!view?.message&&["hostOffline","recoveryMissing","protocolMismatch","privateSync"].includes(view.message);
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
  box.addEventListener("pointerdown",event=>{if(event.pointerType==="touch"&&!box.closest(".choices"))preview(value,true);});
  if(optionId!==undefined){box.dataset.option=optionId;box.setAttribute("aria-pressed",String(selected.has(optionId)));}
  const inspect=button("i",()=>preview(value,true),false,"inspect-card");inspect.setAttribute("aria-label",`${t("inspectCard")}: ${cardName(value.id,lang)}`);inspect.title=t("inspectCard");wrap.append(box,inspect);return wrap;
 }
 function cardList(values:Card[]){const list=node("div",undefined,"cards");for(const value of values)list.append(cardNode(value));return list;}
 function action():EligibleAction|undefined{return privateGame()?.actions[0];}
 function eligibleIds():string[]{const a=action();return !a?[]:a.kind==="choose"?a.choice.options.map(o=>o.id):a.cardIds;}
 function dragContext():DragContext|null{const own=privateGame(),a=action();return own&&view?.table?{tableId:view.table.id,gameId:own.id,seatId:own.selfSeatId,revision:own.revision,kind:a&&a.kind!=="choose"?a.kind:null,legalCardIds:a&&a.kind!=="choose"?a.cardIds:[],locked:locked()||suspended,scopeId}:null;}
 function inspectCard(id:string,pinned:boolean){const own=privateGame(),g=view?.game,a=action();const visible=[...(own?.hand??[]),...(own?.committedAnte?[own.committedAnte]:[]),...(g?.ante??[]),...(g?.discard??[]),...(g?.revealed??[]),...(g?.seats.flatMap(s=>s.flight.map(f=>f.card))??[]),...(a?.kind==="choose"?a.choice.options.filter(o=>o.cardId).map(o=>card(o.cardId!)):[])].find(c=>c.id===id);if(visible)preview(visible,pinned);}
 function legalDropZone(){const a=action();return !locked()&&!suspended&&a&&a.kind!=="choose"&&a.cardIds.length?(a.kind==="ante"?"ante":"flight"):null;}
 function syncStage(){if(!stage)return;stage.update({view:view?.game??null,language:lang,connected:!!view?.connected,reducedMotion:reduced.matches,legalDropZone:legalDropZone(),selectedCardIds:[...selected,...(hoveredHand?[hoveredHand]:[])],...(resetStage?{animate:false}:{})});resetStage=false;}
 function clearDomDrag(){domGhost?.remove();domGhost=null;for(const c of root.querySelectorAll<HTMLElement>(".dom-dragging"))c.classList.remove("dom-dragging");}
 function stageCancel(){keyboardHeld=false;keyboardContext=null;pointerCard="";stage?.setDrag(null);clearDomDrag();publishGesture();}
 function pointerLift(cardId:string){if(pointerCard!==cardId){pointerCard=cardId;publishGesture();}}
 function refreshKeyboard(){if(!keyboardHeld)return;const now=dragContext(),old=keyboardContext;if(!now||!old||now.locked||now.tableId!==old.tableId||now.gameId!==old.gameId||now.seatId!==old.seatId||now.kind!==old.kind||now.scopeId!==old.scopeId||!now.legalCardIds.includes(keyboardCard))stageCancel();}
 function dispatchAction(move:GameAction,zone?:"ante"|"flight"):boolean{
  const own=privateGame(),table=view?.table;if(!own||!table||pendingAction||locked()||move.revision!==own.revision||move.seatId!==own.selfSeatId)return false;
  pendingAction={actionId:move.id,tableId:table.id,gameId:own.id,revision:move.revision,cardId:move.cardId,zone,action:structuredClone(move),retryable:false};
  if(zone)stage?.releaseDrag({pending:true,zone});keyboardHeld=false;keyboardContext=null;pointerCard="";dispatchFailed=false;sending=true;localMessage="";render();
  try{Promise.resolve(deps.send({type:"action",action:move})).catch(()=>{if(destroyed||pendingAction?.actionId!==move.id)return;sending=false;dispatchFailed=true;pendingAction.retryable=true;localMessage="requestFailed";render();});}
  catch{if(pendingAction?.actionId===move.id){sending=false;dispatchFailed=true;pendingAction.retryable=true;localMessage="requestFailed";render();}}
  return true;
 }
 function drop(intent:DropIntent){const context=dragContext();if(!context||context.locked||intent.tableId!==context.tableId||intent.gameId!==context.gameId||intent.seatId!==context.seatId||intent.revision!==context.revision||intent.kind!==context.kind||!context.legalCardIds.includes(intent.cardId))return false;
  const submitted=dispatchAction({id:deps.id?.()??crypto.randomUUID(),revision:intent.revision,seatId:intent.seatId,kind:intent.kind,cardId:intent.cardId},intent.zone);if(submitted)clearDomDrag();return submitted;}
 function applyReceipt(){const p=pendingAction;if(!p)return;
  if(view?.table?.id!==p.tableId||view.game?.id!==p.gameId||!("selfSeatId" in view.game)||view.game.selfSeatId!==p.action.seatId){pendingAction=null;dispatchFailed=false;resetStage=true;stageCancel();return;}
  const receipt=view.actionReceipt;if(!receipt||receipt.actionId!==p.actionId||receipt.tableId!==p.tableId||receipt.gameId!==p.gameId||!Number.isSafeInteger(receipt.revision))return;
  if(receipt.ok===true){if(receipt.revision<p.revision+1||view.game.revision<receipt.revision)return;pendingAction=null;dispatchFailed=false;stage?.resolvePending(true);selected.clear();}
  else if(receipt.ok===false&&receipt.revision===p.revision){if(receipt.retryable===true){p.retryable=true;localMessage=receipt.code??"requestFailed";return;}pendingAction=null;dispatchFailed=false;stage?.resolvePending(false);stageCancel();localMessage=receipt.code??"requestFailed";}
 }
 function keyboardText(){const own=privateGame(),value=own?.hand.find(c=>c.id===keyboardCard);return (lang==="zh"?"←/→ 选牌 · 空格拿起 · Enter 放入自己的区域 · Esc 取消":"←/→ choose · Space lift · Enter drop in your slot · Esc cancel")+(value?` · ${cardName(value.id,lang)} ${value.strength}`:"");}
 function keyboardInput(event:KeyboardEvent){if(event.target!==el("table-stage")&&!((event.target as HTMLElement).closest?.("#hand")))return;
  const own=privateGame();if(!own?.hand.length||pendingAction)return;
  const focusedCard=(event.target as HTMLElement).closest<HTMLElement>("#hand [data-card]")?.dataset.card;
  if(focusedCard&&!keyboardHeld&&(event.key===" "||!keyboardCard))keyboardCard=focusedCard;
  const found=own.hand.findIndex(c=>c.id===keyboardCard),index=Math.max(0,found);
  if(["ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();if(keyboardHeld)return;keyboardCard=own.hand[found<0?0:(index+(event.key==="ArrowRight"?1:own.hand.length-1))%own.hand.length].id;hoveredHand=keyboardCard;inspectCard(keyboardCard,false);publishGesture();syncStage();el("stage-keyboard").textContent=keyboardText();}
  else if(event.key===" "&&!keyboardHeld){event.preventDefault();const context=dragContext();keyboardCard=own.hand[index].id;if(!context||context.locked||!context.legalCardIds.includes(keyboardCard))return;keyboardHeld=true;keyboardContext={...context,legalCardIds:[...context.legalCardIds]};publishGesture();const point=stage?.getAnchor({cardId:keyboardCard});if(point&&stageAvailable)stage?.setDrag({cardId:keyboardCard,x:point.x,y:point.y});el("stage-keyboard").textContent=(lang==="zh"?"已拿起；Enter 放下，Esc 取消。":"Lifted. Enter to drop; Esc to cancel.");}
  else if(event.key==="Enter"){event.preventDefault();if(!keyboardHeld){inspectCard(own.hand[index].id,true);return;}const context=dragContext();if(context?.kind&&!context.locked){const zone=context.kind==="ante"?"ante":"flight";drop({...context,kind:context.kind,cardId:keyboardCard,zone});}}
  else if(event.key==="Escape"&&keyboardHeld){event.preventDefault();event.stopPropagation();stageCancel();el("stage-keyboard").textContent=keyboardText();}
 }
 function toggle(id:string){if(locked()||!eligibleIds().includes(id))return;touched=true;const a=action()!,max=a.kind==="choose"?a.choice.max:1;
  if(selected.has(id))selected.delete(id);else if(max===1)selected=new Set([id]);else if(selected.size<max)selected.add(id);syncSelection();
 }
 function publishGesture(){
  if (!deps.gesture || destroyed || suspended || !privateGame()) return;
  if (gestureTimer) return;
  gestureTimer = setTimeout(() => {
    gestureTimer = undefined; const own = privateGame(); if (!own || destroyed || suspended) return;
    const hover = own.hand.findIndex(c => c.id === hoveredHand);
    const value = { gameId: own.id, revision: own.revision, count: own.hand.length, hover: hover < 0 ? null : hover, selected: own.hand.flatMap((c,i) => selected.has(c.id)||pointerCard===c.id||keyboardHeld&&keyboardCard===c.id ? [i] : []), sequence: 0 };
    const signature = JSON.stringify(value); if (signature === lastGesture) return; lastGesture = signature;
    deps.gesture!({ ...value, sequence: gestureSequence = Math.max(gestureSequence + 1, Date.now()) });
  }, 125);
 }
 function syncSelection(){
  const a=action(),min=a?.kind==="choose"?a.choice.min:1,max=a?.kind==="choose"?a.choice.max:1;
  for(const box of root.querySelectorAll<HTMLButtonElement>("button[data-option]")){box.setAttribute("aria-pressed",String(selected.has(box.dataset.option!)));box.disabled=locked()||!eligibleIds().includes(box.dataset.option!)||!!a&&max>1&&selected.size>=max&&!selected.has(box.dataset.option!);}
  for (const wrap of root.querySelectorAll<HTMLElement>("#hand .card-wrap")) wrap.classList.toggle("selected", selected.has(wrap.querySelector<HTMLElement>("[data-card]")?.dataset.card ?? ""));
  publishGesture();
  syncStage();
  for(const zone of root.querySelectorAll<HTMLElement>("[data-drop-zone]"))zone.classList.toggle("is-legal-drop",zone.dataset.dropSeat===privateGame()?.selfSeatId&&zone.dataset.dropZone===legalDropZone());
  const confirm=root.querySelector<HTMLButtonElement>("#confirm-action");if(confirm)confirm.disabled=locked()||selected.size<min||selected.size>max;
  const count=root.querySelector("#selection-count");if(count)count.textContent=`${t("selection")}: ${selected.size} · ${t("chooseRange")}: ${min===max?min:`${min}–${max}`}`;
 }
 function draft():TableUIDraft|null{return view?.table&&view.game?{tableId:view.table.id,gameId:view.game.id,selectionKey,selected:[...selected],boardScroll:el("board-scroll").scrollTop,handScroll:root.querySelector<HTMLElement>("#hand .cards")?.scrollLeft??0,open:["discard","log","help"].filter(id=>el<HTMLDetailsElement>(id).open)}:null;}
 function send(command:TableUICommand){
  const windowCommand=command.type==="close"||command.type==="display"||command.type==="remember";
  if(!windowCommand&&!receiptCompatible()&&!(command.type==="retry"&&!view))return;
  if(destroyed)return;if(!windowCommand&&command.type!=="retry"&&(busy()||(!view?.connected&&!(command.type==="newGame"&&view?.isHost&&view.message==="recoveryMissing"))))return;
  if(command.type==="close"||command.type==="display")command={...command,draft:draft()??undefined};
  if(command.type==="retry"&&pendingAction)command={type:"retry",tableId:pendingAction.tableId,gameId:pendingAction.gameId,action:structuredClone(pendingAction.action)};
  if(!windowCommand){sending=true;localMessage="";render();}
  try{Promise.resolve(deps.send(command)).catch(()=>{if(!destroyed){sending=false;localMessage="requestFailed";render();}});}catch{sending=false;localMessage="requestFailed";render();}
 }
 function confirmAction(){const game=privateGame(),a=action();if(!game||!a||locked())return;const ids=[...selected];
  if(a.kind==="choose"){if(ids.length<a.choice.min||ids.length>a.choice.max||ids.some(id=>!a.choice.options.some(o=>o.id===id)))return;dispatchAction({id:deps.id?.()??crypto.randomUUID(),revision:game.revision,seatId:game.selfSeatId,kind:"choose",choiceId:a.choice.id,optionIds:ids});}
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
 function clearBannerEvent(){if(bannerTimer)clearTimeout(bannerTimer);bannerTimer=undefined;bannerEvent=null;}
 function receiveBannerEvent(previous:TableView|null){
  const old=previous?.game,next=view?.game;
  if(!old||!next||old.id!==next.id||next.revision<old.revision){clearBannerEvent();return;}
  if(next.revision===old.revision)return;
  const before=old.events.map(e=>JSON.stringify(e)),after=next.events.map(e=>JSON.stringify(e));let overlap=0;
  for(let n=Math.min(before.length,after.length);n>0;n--)if(before.slice(-n).every((event,i)=>event===after[i])){overlap=n;break;}
  // A history gap is a new snapshot, not an animation to replay.
  if(before.length&&!overlap){clearBannerEvent();return;}
  const fresh=next.events.slice(overlap);
  const event=[...fresh].reverse().find(e=>["POWER_TRIGGERED","ANTE_ALL_TIED","GAMBIT_WON","GAME_ENDED","SPECIAL_FLIGHT"].includes(e.code));
  if(!event)return;clearBannerEvent();bannerEvent=event;
  bannerTimer=setTimeout(()=>{bannerTimer=undefined;bannerEvent=null;if(!destroyed)renderBanner();},4500);
 }
 function renderBanner(){
  const game=view?.game,own=privateGame();let waiting="",effect="";
  const names=game?.waitingSeatIds.map(id=>id===own?.selfSeatId?t("you"):seatName(id)).join(lang==="zh"?"、":", ")??"";
  if(game?.phase==="ante"&&names)waiting=lang==="zh"?`等待${names}选择下注牌…`:`Waiting for ${names} to choose ante cards…`;
  else if(game?.phase==="choice"&&game.choice){waiting=lang==="zh"?`等待${names}选择：${rulePrompt(game.choice.code,lang)}`:`Waiting for ${names}: ${rulePrompt(game.choice.code,lang)}`;}
  else if(game?.phase==="play"&&names)waiting=lang==="zh"?`等待${names}出牌中…`:`Waiting for ${names} to play…`;
  else if(game?.phase==="ended")waiting=`${t("winners")}: ${game.winners.map(seatName).join(", ")}`;
  if(revealPhase)waiting=lang==="zh"?({placing:"所有人已提交下注牌…",revealing:"同时翻开下注牌…",price:"点数最高的下注牌已标出…",payment:"结算下注金币…",discard:"下注牌全部并列，弃牌后重新选择…"}[revealPhase]):({placing:"All ante cards are committed…",revealing:"Revealing all ante cards…",price:"The highest ante cards are highlighted…",payment:"Paying gold into the stakes…",discard:"All antes are tied. Discard them and choose again…"}[revealPhase]);
  if(bannerEvent){const e=bannerEvent;effect=[seatName(e.seatId),t(e.code),...(e.cardIds??[]).map(id=>cardName(id,lang)),e.amount===undefined?"":`${e.amount} ${t("gold")}`].filter(Boolean).join(" · ");if(e.code==="POWER_TRIGGERED"&&e.cardIds?.[0])effect+=`：${cardHint(card(e.cardIds[0]).family,lang)}`;}
  el("waiting-banner").textContent=waiting;el("waiting-banner").hidden=!waiting;el("effect-banner").textContent=effect;el("effect-banner").hidden=!effect;el("table-banner").hidden=!waiting&&!effect;
 }
 function render(){if(destroyed)return;
  refreshKeyboard();
  const game=view?.game,own=privateGame(),a=action(),table=view?.table;
  const key=game?`${game.id}:${game.gambit}:${game.round}:${a?.kind??"waiting"}:${a?.kind==="choose"?a.choice.id:""}`:"";
  if(key!==selectionKey){selectionKey=key;selected.clear();}selected=new Set([...selected].filter(id=>eligibleIds().includes(id)));
  document.documentElement.lang=lang==="en"?"en":"zh-CN";document.title=t("title");
  root.dataset.phase=game?.phase??"lobby";root.dataset.players=String(game?.seats.length??0);
  for(const [id,code] of [["title","title"],["edition","edition"],["log-title","history"],["help-title","help"],["help-text","helpText"],["rules-link","rules"],["reset-title","resetTitle"],["reset-body","resetBody"],["cancel-reset","cancel"],["confirm-reset","confirmReset"]])el(id).textContent=t(code);
  el("tutorial").textContent = lang === "en" ? "How to play" : "如何游玩"; el("language").textContent = lang === "en" ? "中文" : "English";
  el("close").setAttribute("aria-label",t("close"));el("close").title=t("close");el("close").textContent=t("backToMap");el("display-mode").textContent=t(deps.mode==="compact"?"expand":"minimize");el("close-preview").setAttribute("aria-label",t("closePreview"));
  const message=view&&!receiptCompatible()?(lang==="zh"?"牌桌后台仍是旧版。请完整刷新枭熊页面后再出牌；现在仍可观看或返回地图。":"The table background is an older version. Fully refresh the Owlbear page before playing. You can still watch or return to the map."):pendingAction?.retryable?(lang==="zh"?"尚未确认这次操作，请重试原操作。":"This action is not confirmed. Retry the same action."):localMessage?(rulePrompt(localMessage,lang)!==localMessage?rulePrompt(localMessage,lang):t(localMessage)):view?.message?tableText(view.message,lang):busy()?t("sending"):!view||!view.connected?t("connecting"):"";
  el("status").textContent=message;el("status").hidden=!message;el("status").classList.toggle("error",!!view?.message&&!['connecting','privateSync'].includes(view.message));
  section("toolbar",[table,view?.selfPlayerId,view?.isHost,view?.connected,view?.message,receiptCompatible(),busy(),sending,pendingAction?.retryable,localMessage],host=>{
   const seated=table?.seats.some(s=>s.playerId===view?.selfPlayerId);
   if(view&&!table)host.append(button(t("create"),()=>send({type:"create"}),locked(),"primary"));
   else if(table){
    if(!seated&&table.stage!=="playing")host.append(button(t("join"),()=>send({type:"join"}),locked()||table.seats.length>=6,"primary"));
    if(seated&&table.stage!=="playing")host.append(button(t("leave"),()=>send({type:"leave"}),locked()));
    if(view?.isHost&&table.stage==="lobby")host.append(button(t("start"),()=>send({type:"start"}),locked()||table.seats.length<2,"primary"));
    if(view?.isHost&&table.stage!=="lobby")host.append(button(t("newGame"),reset,!receiptCompatible()||busy()||(!view.connected&&view.message!=="recoveryMissing")));
   }
   if(!view?.connected||view?.message||localMessage||pendingAction?.retryable)host.append(button(pendingAction?(lang==="zh"?"重试这次操作":"Retry this action"):t("retry"),()=>send({type:"retry"}),sending||!!view&&!receiptCompatible()));
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
   else if(a)host.append(node("h2",lang==="zh"?(a.kind==="ante"?"将一张手牌拖到自己的暗置区":"将一张手牌拖到自己的牌阵"):(a.kind==="ante"?"Drag a hand card to your face-down area":"Drag a hand card to your flight")));
   else if(own?.committedAnte)host.append(node("p",`${t("ownAnte")}: ${cardName(own.committedAnte.id,lang)} · ${own.committedAnte.strength}`));
   if(a?.kind==="choose"){const row=node("div",undefined,"action-row"),count=node("span",undefined,"muted");count.id="selection-count";const confirm=button(t("confirmChoice"),confirmAction,true,"primary");confirm.id="confirm-action";row.append(count,confirm);host.append(row);}
  });
  section("hand",own&&[game?.id,own.hand,a?.kind,a&&a.kind!=="choose"?a.cardIds:[]],host=>{if(!own)return;const heading=node("div",undefined,"hand-heading");heading.append(node("h2",`${t("hand")} · ${own.hand.length}`),node("span",t("inspectHint"),"muted"));host.append(heading);const cards=node("div",undefined,"cards");for(const value of own.hand){
    const wrap=cardNode(value,a&&a.kind!=="choose"&&a.cardIds.includes(value.id)?value.id:undefined);
    wrap.addEventListener("pointerenter",()=>{hoveredHand=value.id;publishGesture();});
    wrap.addEventListener("pointerleave",()=>{if(hoveredHand===value.id){hoveredHand="";publishGesture();}});
    wrap.addEventListener("focusin",()=>{hoveredHand=value.id;publishGesture();});
    wrap.addEventListener("focusout",()=>{hoveredHand="";publishGesture();}); cards.append(wrap);
   }host.append(cards);});
  section("players",game&&[own?.selfSeatId,game.seats,game.ante,game.anteOrigins,game.leaderSeatId,game.activeSeatId],host=>{if(!game)return;
   const selfIndex=game.seats.findIndex(seat=>seat.id===own?.selfSeatId),ordered=selfIndex<0?game.seats:[...game.seats.slice(selfIndex+1),...game.seats.slice(0,selfIndex)];
   const positions=ordered.length===1?["top"]:ordered.length===2?["upper-left","upper-right"]:ordered.length===3?["upper-left","top","upper-right"]:["upper-left","top","upper-right","lower-right","lower-left","bottom"];
   for(const seat of game.seats){const panel=node("article",undefined,"seat");panel.dataset.seat=seat.id;panel.dataset.position=seat.id===own?.selfSeatId?"bottom":positions[ordered.findIndex(other=>other.id===seat.id)];panel.classList.toggle("active",seat.id===game.activeSeatId);panel.classList.toggle("self",seat.id===own?.selfSeatId);
   panel.append(node("h2",`${seat.name}${seat.id===own?.selfSeatId?` (${t("you")})`:""}${seat.id===game.leaderSeatId?` · ${t("leader")}`:""}`),node("p",`${t("gold")} ${seat.gold} · ${t("handCount")} ${seat.handCount} · ${t("strength")} ${seat.strength}${seat.debt?` · ${t("debt")} ${seat.debt}`:""}`));
   if(seat.id!==own?.selfSeatId){const backs=node("div",undefined,"opponent-hand");backs.setAttribute("aria-label",`${seat.name} · ${t("handCount")} ${seat.handCount}`);for(let index=0;index<Math.min(10,seat.handCount);index++){const back=node("span","◈","card-back");back.setAttribute("aria-hidden","true");back.dataset.slot=String(index);back.style.setProperty("--angle",`${(index-(Math.min(10,seat.handCount)-1)/2)*7}deg`);back.style.setProperty("--arc",`${Math.abs(index-(Math.min(10,seat.handCount)-1)/2)*2}px`);backs.append(back);}panel.append(backs);}
   if(seat.committed)panel.append(node("small",t("committed")));if(seat.archmage)panel.append(node("p",t("archmage"),"effect"));
   const anteSlot=node("div",undefined,"dom-drop-slot");anteSlot.dataset.dropZone="ante";anteSlot.dataset.dropSeat=seat.id;anteSlot.append(node("small",lang==="zh"?"暗置区":"Ante area"));const anteId=game.anteOrigins?.find(origin=>origin.seatId===seat.id)?.cardId,anteCard=game.ante.find(c=>c.id===anteId);if(anteCard)anteSlot.append(cardNode(anteCard));else if(seat.committed){const back=node("div","◈","card-back");back.setAttribute("aria-label",t("committed"));anteSlot.append(back);}panel.append(anteSlot);
   const flight=node("div",undefined,"cards flight");flight.dataset.dropZone="flight";flight.dataset.dropSeat=seat.id;for(const item of seat.flight){const c=cardNode(item.card);if(item.wild)c.append(node("small",t("wild")));if(item.rider)c.append(node("small",t("rider")));flight.append(c);}if(!seat.flight.length)flight.append(node("small",lang==="zh"?"牌阵":"Flight"));panel.append(flight);host.append(panel);
  }});
  section("antes",game&&[game.ante,game.anteOrigins,game.revealed],host=>{if(!game)return;const unplaced=game.ante.filter(c=>!game.anteOrigins?.some(origin=>origin.cardId===c.id));if(unplaced.length)host.append(node("h2",t("ante")),cardList(unplaced));if(game.revealed.length)host.append(node("h2",t("revealed")),cardList(game.revealed));});
  section("effects",game&&[game.effects,game.lastGambit],host=>{if(!game)return;if(game.effects?.length){host.append(node("h2",t("effects")));for(const effect of game.effects)host.append(node("p",`${seatName(effect.seatId)} · ${t(effect.kind)}`));}if(game.lastGambit)host.append(node("p",`${t("lastGambit")}: ${game.lastGambit.winners.map(seatName).join(", ")}`));});
  el("discard").hidden=!game;el("discard-title").textContent=`${t("discard")} · ${game?.discard.length??0}`;renderDiscard();
  section("events",game?.events,host=>{for(const event of game?.events.slice(-30).reverse()??[]){const parts=[seatName(event.seatId),t(event.code),event.amount===undefined?"":String(event.amount),seatName(event.targetSeatId),...(event.cardIds??[]).map(id=>cardName(id,lang))].filter(Boolean);host.append(node("li",parts.join(" · ")));}});
  el("accessible-table").hidden=!game||!stageAvailable;el("accessible-title").textContent=lang==="zh"?"桌面详情":"Table details";
  section("accessible-seats",game&&[game.seats,game.ante,game.effects],host=>{if(!game)return;for(const seat of game.seats){const row=node("section");row.append(node("h2",seat.name),node("p",`${t("gold")} ${seat.gold} · ${t("strength")} ${seat.strength} · ${t("handCount")} ${seat.handCount}${seat.debt?` · ${t("debt")} ${seat.debt}`:""}`));for(const item of seat.flight)row.append(button(`${cardName(item.cardId,lang)} · ${item.card.strength}`,()=>inspectCard(item.cardId,true)));host.append(row);}const antes=node("section");antes.append(node("h2",t("ante")));for(const value of game.ante)antes.append(button(`${cardName(value.id,lang)} · ${value.strength}`,()=>inspectCard(value.id,true)));host.append(antes);for(const effect of game.effects??[])host.append(node("p",`${seatName(effect.seatId)} · ${t(effect.kind)}`));});
  el("arena").hidden=!game||stageAvailable;el("stage-host").hidden=!game||!stageAvailable;el("log").hidden=!game;el("turn").hidden=!game||!el("turn").childElementCount;el("hand").hidden=!own||stageAvailable;el("hand").inert=stageAvailable;el("turn").setAttribute("aria-label",t("acting"));root.dataset.hasChoice=String(a?.kind==="choose");renderBanner();
  el("table-stage").setAttribute("aria-label",lang==="zh"?"三维牌桌。方向键选牌，空格拿起，Enter放到自己区域。":"Three dimensional card table. Arrow keys choose; Space lifts; Enter drops in your own slot.");
  el("stage-keyboard").textContent=keyboardText();
  el("stage-summary").textContent=game?`${t("gambit")} ${game.gambit} · ${t("round")} ${game.round} · ${t("stakes")} ${game.stakes} · ${t("hole")} ${game.hole}`:"";
  root.dataset.pendingAction=pendingAction?"true":"false";syncSelection();dragController?.refresh();domDragController?.refresh();
  if(previewId){const visible=[...(own?.hand??[]),...(own?.committedAnte?[own.committedAnte]:[]),...(game?.ante??[]),...(game?.revealed??[]),...(game?.discard??[]),...(game?.seats.flatMap(seat=>seat.flight.map(value=>value.card))??[]),...(a?.kind==="choose"?a.choice.options.filter(option=>option.cardId).map(option=>card(option.cardId!)):[])].find(value=>value.id===previewId);if(visible)preview(visible,previewPinned);else hidePreview();}
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
 function language(value:TableLanguage){
  const active=document.activeElement instanceof HTMLElement&&root.contains(document.activeElement)?document.activeElement:null;
  const option=active?.dataset.option,cardId=active?.dataset.card;
  lang=value;render();
  if(active&&!active.isConnected&&(option||cardId)){
   const replacement=[...root.querySelectorAll<HTMLElement>("[data-option],[data-card]")].find(node=>option?node.dataset.option===option:node.dataset.card===cardId);
   replacement?.focus({preventScroll:true});
  }
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
   if(stageAvailable)return;
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
 const keydown=(event:KeyboardEvent)=>{keyboardInput(event);if(!event.defaultPrevented&&event.key==="Escape"&&previewId){event.preventDefault();event.stopPropagation();hidePreview();}};root.addEventListener("keydown",keydown);
 el("close").addEventListener("click",()=>send({type:"close"}));el("cancel-reset").addEventListener("click",()=>el<HTMLDialogElement>("reset-dialog").close());
 el("confirm-reset").addEventListener("click",()=>{el<HTMLDialogElement>("reset-dialog").close();if(view?.isHost&&resetKey===`${view.table?.id}:${view.game?.id}`)send({type:"newGame"});});
 const domHit=(x:number,y:number):StageHit|null=>{if(stageAvailable)return null;const element=document.elementFromPoint(x,y);if(!element||!root.contains(element)||element.closest(".choices [data-option]"))return null;
  const cardEl=element.closest<HTMLElement>("[data-card]"),slot=element.closest<HTMLElement>("[data-drop-zone]");
  if(cardEl){const hand=!!cardEl.closest("#hand");return{kind:hand?"hand":"card",cardId:cardEl.dataset.card!,zone:hand?"hand":slot?.dataset.dropZone==="flight"?"flight":"ante",...(hand?{seatId:privateGame()?.selfSeatId}:slot?{seatId:slot.dataset.dropSeat}:{})};}
  return slot?{kind:"zone",zone:slot.dataset.dropZone as "ante"|"flight",seatId:slot.dataset.dropSeat}:null;};
 const hover=(id:string|null)=>{const next=privateGame()?.hand.some(c=>c.id===id)?id??"":"";if(next!==hoveredHand){hoveredHand=next;publishGesture();syncStage();}if(id&&!previewPinned&&previewId!==id)inspectCard(id,false);else if(!id&&!previewPinned)hidePreview();};
 const ports={context:dragContext,drop,cancel:stageCancel,inspect:inspectCard,hover};
 stage=mountTableStage(el<HTMLCanvasElement>("table-stage"),{onRevealPhase:phase=>{revealPhase=phase;if(!destroyed)renderBanner();},onQuality:quality=>{stageAvailable=quality.webgl;root.dataset.renderer=stageAvailable?"webgl":"dom";if(stageReady&&!destroyed)render();}});stageReady=true;
 dragController=mountDragController(el("table-stage"),{...ports,hitTest:(x,y)=>stageAvailable?stage?.hitTest(x,y)??null:null,drag:value=>{if(value)pointerLift(value.cardId);stage?.setDrag(value);}});
 domDragController=mountDragController(root,{...ports,hover:id=>{if(!stageAvailable)hover(id);},hitTest:domHit,drag:value=>{if(!value)return;pointerLift(value.cardId);const item=[...root.querySelectorAll<HTMLElement>("#hand [data-card]")].find(c=>c.dataset.card===value.cardId);if(item){item.classList.add("dom-dragging");if(!domGhost){domGhost=item.cloneNode(true) as HTMLElement;domGhost.classList.remove("dom-dragging");domGhost.classList.add("dom-drag-ghost");domGhost.setAttribute("aria-hidden","true");domGhost.removeAttribute("tabindex");document.body.append(domGhost);}domGhost.style.left=`${value.x-65}px`;domGhost.style.top=`${value.y-90}px`;}}});
 const motionPreference=()=>{syncStage();};reduced.addEventListener("change",motionPreference);
 const cancelKeyboard=()=>{if(keyboardHeld)stageCancel();},hideKeyboard=()=>{if(document.hidden)cancelKeyboard();};
 root.addEventListener("pointerdown",cancelKeyboard,true);window.addEventListener("blur",cancelKeyboard);document.addEventListener("visibilitychange",hideKeyboard);
 render();return {update(value:TableView){const previous=view;view=value;sending=false;localMessage="";receiveBannerEvent(previous);applyReceipt();render();animateChanges(previous);},gesture(seatId:string,value:unknown){if(destroyed)return;if(value===null){stage?.gesture(seatId,null);const entry=gestures.get(seatId);if(entry)clearTimeout(entry.timer);gestures.delete(seatId);paintGestures();return;}const gesture=readHandGesture(value);if(!gesture||seatId===privateGame()?.selfSeatId)return;const old=gestures.get(seatId);if(old&&gesture.sequence<=old.value.sequence)return;stage?.gesture(seatId,gesture);if(old)clearTimeout(old.timer);gestures.set(seatId,{value:gesture,timer:setTimeout(()=>{gestures.delete(seatId);paintGestures();},30000)});paintGestures();},language,restore(value:unknown){if(!touched)pendingDraft=readUIDraft(value);restoreDraft();},draft,
 waitingForReceipt:()=>!!pendingAction,
 getAnchor(zone:"hand"|"ownAnte"|"ownFlight"|"stakes"){const own=privateGame();const query=zone==="hand"?{cardId:own?.hand[0]?.id}:zone==="stakes"?{zone:"stakes" as const}:{zone:zone==="ownAnte"?"ante" as const:"flight" as const,seatId:own?.selfSeatId};const point=stageAvailable?stage?.getAnchor(query):null;if(point?.visible)return new DOMRect(point.x-10,point.y-10,20,20);if(!stageAvailable){const target=zone==="hand"?root.querySelector("#hand [data-card]"):zone==="stakes"?root.querySelector(".counter.stakes"):root.querySelector(`.seat.self [data-drop-zone="${zone==="ownAnte"?"ante":"flight"}"]`);return target?.getBoundingClientRect()??null;}return null;},
 suspend(){suspended=true;stageCancel();hoveredHand="";if(gestureTimer)clearTimeout(gestureTimer);gestureTimer=undefined;lastGesture="";dragController?.cancel();domDragController?.cancel();stage?.suspend();},resume(){suspended=false;stage?.resume();syncSelection();},
 failed(){sending=false;localMessage="requestFailed";if(pendingAction)pendingAction.retryable=true;if(view)view={...view,pending:false,connected:false};render();},
 destroy(){if(destroyed)return;destroyed=true;pendingAction=null;clearBannerEvent();clearDomDrag();dragController?.destroy();domDragController?.destroy();stage?.destroy();reduced.removeEventListener("change",motionPreference);root.removeEventListener("pointerdown",cancelKeyboard,true);window.removeEventListener("blur",cancelKeyboard);document.removeEventListener("visibilitychange",hideKeyboard);resize.disconnect();if(gestureTimer)clearTimeout(gestureTimer);for(const entry of gestures.values())clearTimeout(entry.timer);for(const a of motion)a.cancel();root.removeEventListener("keydown",keydown);el<HTMLDialogElement>("reset-dialog").close();root.replaceChildren();}};
}
