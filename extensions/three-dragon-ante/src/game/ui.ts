import {cardFaceImage, cardFaceURL} from "./card-images";

declare const __TDA_BUILD__: string;
/** The build stamp is injected by the Vite build; the direct rolldown builds
 *  used by the test harnesses do not define it. */
const buildStamp=():string=>typeof __TDA_BUILD__==="string"?__TDA_BUILD__:"dev";
import { dragonEngraving } from "./card-art";
import { readHandGesture, type HandGesture } from "./gesture";
import type {TableView} from "./protocol";
import {readUIDraft,type TableDisplayMode,type TableUICommand,type TableUIDraft} from "./ui-command";
import type {Card} from "./rules/cards";
import {card, SPECIAL_CARDS} from "./rules/cards";
import {cardHint, cardName, rulePrompt} from "./rules/prompts";
import {DEFAULT_VARIANT, DECK_CATALOG, RULE_SET_CATALOG} from "./rules/variants";
import type {Choice, DeckId, EligibleAction, HandPowerHint, OmniscientView, PublicEvent, PublicView, ResolutionStep, RuleSetId, SeatView, TableVariant} from "./rules/types";
import {tableText, type TableLanguage} from "./text";
import type {StageHandle, StageHit, StageQualityLevel, StageQualityMode} from "./stage";
import {mountDragController, type DropIntent, type DragContext} from "./interaction/drag-controller";
import type {GameAction} from "./rules/types";
import {activePowerCards,freshPublicEvents,powerEvents,publicGoldFlows,type PowerTargetRelation,type PublicGoldFlow} from "./power-sequence";
import {powerEffectTheme} from "./power-effects";
import {mountPowerPresentation} from "./power-presentation";
import {mountTableAudio} from "./audio";
import {mountTableReactShell} from "./react/shell";
import {publicFlightFormation} from "./flight-formations";
import "./stage-ui.css";
import "./card-images.css";
import {mountRoundPresentation,roundCues} from "./round-presentation";

export interface TableUIDeps {send(command:TableUICommand):void|Promise<void>;language:TableLanguage;mode?:TableDisplayMode;gesture?(value:HandGesture):void;id?():string;onPresentationChange?(busy:boolean):void}
/** This surface receives projections only. It never imports or constructs host state. */
export function mountTableUI(root:HTMLElement,deps:TableUIDeps){
 let view:TableView|null=null,lang=deps.language,sending=false,destroyed=false,selectionKey="",selected=new Set<string>(),resetKey="",localMessage="";
 let startingGold:number|undefined,startingHand=6,setupTableId="",setupRuleSetId:RuleSetId=DEFAULT_VARIANT.ruleSetId,setupDeckId:DeckId=DEFAULT_VARIANT.deckId,setupSpecialIds:string[]=[];
 let pendingDraft:TableUIDraft|null=null,touched=false,previewId="",previewPinned=false,pinnedPreviewId="";
 let hoveredHand = "", gestureTimer: ReturnType<typeof setTimeout> | undefined, gestureSequence = Date.now(), lastGesture = "";
 const gestures = new Map<string, { value: HandGesture; timer: ReturnType<typeof setTimeout> }>();
 const motion = new Set<Animation>();
 const signatures=new Map<string,string>();
 const scopeId=crypto.randomUUID();
 let stage:StageHandle|null=null,stageAvailable=false,stageReady=false,suspended=false;
  const stageQualityMode:StageQualityMode="auto";
 let stageQuality:StageQualityLevel="unavailable";
 let dragController:ReturnType<typeof mountDragController>|null=null,domDragController:ReturnType<typeof mountDragController>|null=null;
 let keyboardCard="",keyboardHeld=false,dispatchFailed=false,resetStage=false;
 let keyboardContext:DragContext|null=null;
 let pointerCard="";
 let domGhost:HTMLElement|null=null;
 let bannerEvent:PublicEvent|null=null,bannerTimer:ReturnType<typeof setTimeout>|undefined;
 let revealPhase:"placing"|"revealing"|"price"|"payment"|"discard"|null=null;
 let power:ReturnType<typeof mountPowerPresentation>|null=null,sound:ReturnType<typeof mountTableAudio>|null=null;
 let updating=false,syncingStage=false,stageView:PublicView|SeatView|OmniscientView|null=null,stageGoldFlows:PublicGoldFlow[]=[],presentationBase:TableView|null=null,presentationView:TableView|null=null,anteSoundKey="";
 let cinema:ReturnType<typeof mountRoundPresentation>|null=null;
 let notifiedPresentationBusy=false;
 const deferredSounds=new Map<"draw"|"flip"|"coin",string>();
 let pendingAction:{actionId:string;tableId:string;gameId:string;revision:number;cardId?:string;zone?:"ante"|"flight";action:GameAction;retryable:boolean}|null=null;
 const reduced=matchMedia("(prefers-reduced-motion: reduce)"),compactMedia=matchMedia("(max-width:580px)"),compactViewport=()=>compactMedia.matches;
 root.className="table-shell";root.dataset.mode=deps.mode??"full";root.dataset.renderer="dom";root.dataset.qualityMode=stageQualityMode;root.dataset.quality=stageQuality;
 root.innerHTML=`<header class="table-header"><div class="table-brand"><span class="brand-mark" aria-hidden="true">◈</span><div><h1 id="title"></h1><p id="edition" class="muted"></p></div></div><div class="window-controls"><button id="tutorial" type="button"></button><button id="new-game" class="quiet" type="button" hidden></button><button id="omniscient-toggle" class="quiet" type="button" aria-pressed="false" hidden></button><button id="sound-toggle" class="quiet" type="button" aria-pressed="true"></button><button id="language" class="quiet" type="button"></button><button id="display-mode" class="quiet" type="button"></button><button id="close" class="quiet" type="button"></button></div></header>
 <div id="toolbar" class="toolbar"></div>
 <div id="board-scroll" class="board-scroll"><div id="status-banner-overlay"></div><section id="lobby"><div id="lobby-copy"></div><div id="lobby-setup"></div></section><div id="stage-host" hidden><canvas id="table-stage" tabindex="0" role="application" aria-describedby="stage-keyboard"></canvas><div id="stage-summary"></div><p id="stage-keyboard" aria-live="polite"></p></div><div id="arena" class="arena">
 <section id="players" class="players"></section>
 <section id="public-zone" class="public-zone"><div id="summary" class="summary"></div><div class="table-piles"><div id="deck-pile" class="deck-pile"></div><div class="table-seal" aria-hidden="true">◇<span>III</span>◇</div><button id="discard-pile" class="discard-pile" type="button"></button></div><section id="antes"></section><section id="effects"></section></section></div>
 </div>
 <div class="table-bubbles"><div id="status" class="notice" role="status" aria-live="polite" hidden></div><div id="turn-overlay"></div><section id="turn" class="turn" aria-label="" hidden></section></div>
 <div class="player-dock"><section id="hand" class="hand"></section></div>
 <button id="slap-table" class="slap-table quiet" type="button" hidden></button>
 <aside id="card-preview" class="card-preview" aria-live="polite" hidden></aside>
 <dialog id="reset-dialog" aria-labelledby="reset-title"><h2 id="reset-title"></h2><p id="reset-body"></p><div class="toolbar"><button id="cancel-reset" type="button"></button><button id="confirm-reset" class="danger" type="button"></button></div></dialog><section id="table-editor-host" class="table-editor-host" hidden></section>`;
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>(`#${id}`)!;
 const reactShell=mountTableReactShell(root,{

  tableBanner:el("status-banner-overlay"),turnIndicator:el("turn-overlay"),tableSetup:el("lobby-setup"),
  tableToolbar:el("toolbar"),infoDrawer:el("card-preview"),actionTray:el("turn"),handRail:el("hand"),tableEditor:el("table-editor-host"),
 });
 const {tableBanner:tableBannerView,turnIndicator:turnIndicatorView,tableSetup:tableSetupView,tableToolbar:tableToolbarView,infoDrawer:infoDrawerView,actionTray:actionTrayView,handRail:handRailView,tableEditor:tableEditorView}=reactShell;
 const t=(code:string)=>tableText(code,lang);
 const selectedSpecialIds=()=>SPECIAL_CARDS.map(value=>value.id).filter(id=>setupSpecialIds.includes(id));
 const setupVariant=():TableVariant=>setupDeckId==="selected-specials-v1"?{ruleSetId:setupRuleSetId,deckId:setupDeckId,specialIds:selectedSpecialIds()}:{ruleSetId:setupRuleSetId,deckId:setupDeckId};
  const variantLabel=(variant:TableVariant|undefined)=>{const value=variant??DEFAULT_VARIANT,rule=RULE_SET_CATALOG.find(item=>item.id===value.ruleSetId),deck=DECK_CATALOG.find(item=>item.id===value.deckId),ruleVersion=rule?.version?` · ${lang==="zh"?rule.version:rule.versionEn??rule.version}`:"",deckVersion=deck?.version?` · ${lang==="zh"?deck.version:deck.versionEn??deck.version}`:"";return lang==="zh"?`${rule?.name??value.ruleSetId}${ruleVersion} · ${deck?.name??value.deckId}${deckVersion}`:`${rule?.nameEn??value.ruleSetId}${ruleVersion} · ${deck?.nameEn??value.deckId}${deckVersion}`;};
 const variantSummary=(variant:TableVariant|undefined)=>{const value=variant??DEFAULT_VARIANT,deck=DECK_CATALOG.find(item=>item.id===value.deckId);const count=value.specialIds?.length??0;return `${variantLabel(value)}${value.deckId==="selected-specials-v1"?` · ${t("selectedCount")} ${count}/10`:""}${deck?(lang==="zh"?` · ${deck.summary}`:` · ${deck.summaryEn}`):""}`;};
 const renderTableSetup=()=>{
  const table=view?.table,visible=!!table&&!view?.game&&table.stage==="lobby"&&!!view?.isHost;
  tableSetupView.render({visible,language:lang,startingGold:startingGold??(table?.seats.length??0)*10,startingHand,ruleSetId:setupRuleSetId,deckId:setupDeckId,specialIds:setupSpecialIds,ruleSets:RULE_SET_CATALOG,decks:DECK_CATALOG,specials:SPECIAL_CARDS.map(value=>({id:value.id,name:cardName(value.id,"zh"),nameEn:cardName(value.id,"en"),strength:value.strength})),variantSummary:variantSummary(setupVariant()),labels:{title:lang==="zh"?"开局设置":"Game setup",startingGold:lang==="zh"?"每人初始金币":"Starting gold per player",startingHand:lang==="zh"?"每人起始手牌":"Initial cards per player",ruleSet:t("ruleSet"),deckChoice:t("deckChoice"),variantSummary:t("variantSummary"),chooseSpecials:t("chooseSpecials"),selectedCount:t("selectedCount"),needTenSpecials:t("needTenSpecials"),note:`${lang==="zh"?"默认金币为人数 × 10，起始手牌为 6 张。手牌上限始终为 10 张。":"Default gold: players × 10. Initial cards: 6. Hand limit remains 10."} ${t("variantLocked")}`},onStartingGold:value=>{startingGold=value;render();},onStartingHand:value=>{startingHand=value;render();},onRuleSetChange:value=>{if(RULE_SET_CATALOG.some(option=>option.id===value)){setupRuleSetId=value as RuleSetId;render();}},onDeckChange:value=>{if(!DECK_CATALOG.some(option=>option.id===value))return;setupDeckId=value as DeckId;if(setupDeckId==="selected-specials-v1"&&!setupSpecialIds.length)setupSpecialIds=SPECIAL_CARDS.slice(0,10).map(card=>card.id);render();},onSpecialToggle:(id,checked)=>{if(!SPECIAL_CARDS.some(card=>card.id===id)||checked&&setupSpecialIds.length>=10&&!setupSpecialIds.includes(id))return false;setupSpecialIds=checked?[...new Set([...setupSpecialIds,id])]:setupSpecialIds.filter(value=>value!==id);render();return true;}});
 };
 const seatName=(id:string|null|undefined)=>view?.game?.seats.find(s=>s.id===id)?.name??view?.table?.seats.find(s=>s.seatId===id)?.name??"";
 const privateGame=():SeatView|null=>view?.game&&"selfSeatId" in view.game?view.game as SeatView:null;
 const omniscientGame=():OmniscientView|null=>{const game=view?.game;return game&&"omniscient" in game&&(game as OmniscientView).omniscient?game as OmniscientView:null;};
 const receiptCompatible=()=>view?.actionReceiptVersion===1;
 const busy=()=>sending||!!view?.pending||!!pendingAction;
 const locked=()=>busy()||!!power?.busy||!!cinema?.busy||!!revealPhase||suspended||!receiptCompatible()||!view?.connected||!!view?.message&&["hostOffline","recoveryMissing","protocolMismatch","privateSync"].includes(view.message);
 const node=(tag:string,text?:string,className?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
 function section(id:string,signature:unknown,build:(host:HTMLElement)=>void){const value=JSON.stringify([lang,signature]);if(signatures.get(id)===value)return;signatures.set(id,value);const host=el(id);host.replaceChildren();build(host);}
 function button(label:string,fn:()=>void,disabled=false,className=""){const b=document.createElement("button");b.type="button";b.textContent=label;b.disabled=disabled;b.className=className;b.addEventListener("click",fn);return b;}
 // Requirement: the inspection entry opens the editor directly. There is no
 // second confirmation because the editor is the only consumer.
 el<HTMLButtonElement>("omniscient-toggle").addEventListener("click",()=>{
  const current=view;
  if(!current?.game||!(current.isHost||current.role==="GM"))return;
  void deps.send({type:"omniscient",enabled:!omniscientGame()});
});
 const emblem=dragonEngraving;
 function handPowerHintFor(value:Card):HandPowerHint|undefined{
  const own=privateGame();
  return own?.hand.some(card=>card.id===value.id)?own.handPowerHints.find(hint=>hint.cardId===value.id):undefined;
 }
 function handPowerHintForSeat(value:Card,seatId:string):HandPowerHint|undefined{
  const omniscient=omniscientGame();
  return omniscient?.privateHandPowerHints[seatId]?.find(hint=>hint.cardId===value.id);
 }
 function renderInfo(value:Card|null,pinned=false){
  infoDrawerView.render({value,language:lang,pinned,closeLabel:t("closePreview"),cardName:card=>cardName(card.id,lang),cardHint:card=>cardHint(card.family,lang),onClose:hidePreview});
 }
 function preview(value:Card,pinned=false){
  previewId=value.id;previewPinned=pinned;if(pinned)pinnedPreviewId=value.id;
  renderInfo(value,pinned);
 }
 function hidePreview(){previewId="";previewPinned=false;pinnedPreviewId="";renderInfo(null);}
 function leavePreview(){if(pinnedPreviewId){const saved=pinnedPreviewId;inspectCard(saved,true);if(previewId===saved)return;}hidePreview();}
 function activeResolutionStep(stack:readonly ResolutionStep[]=(view?.game?.resolutionStack??[])):ResolutionStep|undefined{return stack.find(step=>step.status==="active")??stack[0];}
 function resolutionFamily(step:ResolutionStep|undefined):string|undefined{
  if(power?.current&&(!step||power.current.cardId===step.sourceCardId))return power.current.family;
  const source=step?.sourceCardId;if(!source)return power?.current?.family;
  const events=[...(view?.game?.events??[]),...(view?.game?.history??[]).map(entry=>entry.event)];
  const publicEvent=[...events].reverse().find(event=>event.code==="POWER_TRIGGERED"&&event.cardIds?.includes(source));
  if(publicEvent?.effectFamily)return publicEvent.effectFamily;
  try{return card(source).family;}catch{return undefined;}
 }
 function resolutionFocus(stack:readonly ResolutionStep[]=(view?.game?.resolutionStack??[])){const step=activeResolutionStep(stack),relations=power?.current?.targetRelations??[],targetSeatId=step?.targetSeatId??relations[0]?.seatId??power?.current?.targetSeatIds?.[0]??null,targetRelation:PowerTargetRelation|null=relations.find(value=>value.seatId===targetSeatId)?.relation??(targetSeatId?(step?.kind==="choice"?"choice":"direct"):null);return {sourceCardId:power?.current?.cardId??step?.sourceCardId??null,targetSeatId,targetRelation};}
 function cardNode(value:Card,optionId?:string,powerHint?:HandPowerHint):HTMLElement{
  const wrap=node("div",undefined,"card-wrap");wrap.dataset.color=value.color??value.alignment;
  const box=optionId===undefined?node("div"):button("",()=>toggle(optionId));box.className="card";box.dataset.alignment=value.alignment;box.dataset.card=value.id;
  box.classList.add("printed-card");box.append(cardFaceImage(value.id));
  const powerText=powerHint?handPowerText(powerHint):"";
  box.setAttribute("aria-label",`${cardName(value.id,lang)} · ${value.strength}. ${cardHint(value.family,lang)}${powerText?` · ${powerText}`:""}`);
  if(powerHint){
   wrap.dataset.powerState=powerHint.state;wrap.dataset.powerTrigger=String(powerHint.ruleTriggers);
   if(powerHint.state==="power-ready"){
    const theme=powerEffectTheme(value.family);
    wrap.dataset.powerReady="true";wrap.dataset.powerTheme=theme.key;wrap.dataset.powerShape=theme.shape;
    // A ready card is marked by its glowing family-coloured edge plus one short
    // label. There is no glyph badge: the printed face is the only artwork.
    const badge=node("span",undefined,"power-badge");badge.setAttribute("aria-hidden","true");badge.title=powerText;badge.append(node("i"),node("span",t("powerReadyShort")));
    wrap.append(badge);
   } else if(powerHint.state==="playable-no-power"){
    const badge=node("span",t("powerPlayableShort"),"power-badge power-badge--playable");badge.setAttribute("aria-hidden","true");badge.title=powerText;wrap.append(badge);
   }
  }
  const focus=resolutionFocus();if(focus.sourceCardId===value.id){wrap.dataset.resolutionSource="active";box.setAttribute("aria-label",`${box.getAttribute("aria-label")} · ${t("resolutionCurrent")}`);}
  if(optionId===undefined){box.tabIndex=0;box.setAttribute("role","button");box.addEventListener("click",()=>preview(value,true));box.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();preview(value,true);}});}
  box.addEventListener("pointerenter",event=>{if(event.pointerType!=="touch")preview(value);});
  box.addEventListener("pointerleave",()=>{if(!previewPinned&&previewId===value.id)leavePreview();});
  box.addEventListener("focus",()=>preview(value));box.addEventListener("blur",()=>{if(!previewPinned)leavePreview();});
  box.addEventListener("pointerdown",event=>{if(event.pointerType==="touch"&&!box.closest(".choices"))preview(value,true);});
  if(optionId!==undefined){box.dataset.option=optionId;box.setAttribute("aria-pressed",String(selected.has(optionId)));}
  const inspect=button("i",()=>preview(value,true),false,"inspect-card");inspect.setAttribute("aria-label",`${t("inspectCard")}: ${cardName(value.id,lang)}`);inspect.title=t("inspectCard");wrap.append(box,inspect);return wrap;
 }
 function cardList(values:Card[]){const list=node("div",undefined,"cards");for(const value of values)list.append(cardNode(value));return list;}
 function action():EligibleAction|undefined{return privateGame()?.actions[0];}
 function eligibleIds():string[]{const a=action();return !a?[]:a.kind==="choose"?a.choice.options.map(o=>o.id):a.cardIds;}
 function handPowerText(hint:HandPowerHint):string{
  const comparison=hint.comparedCardId?` · ${cardName(hint.comparedCardId,lang)} ${hint.comparedStrength??"?"}`:"";
  if(hint.state==="power-ready")return hint.reason==="first-player"?t("powerReadyFirst"):hint.reason==="archmage"?t("powerReadyArchmage"):`${t("powerReadyLower")}${comparison}`;
  return hint.reason==="higher-than-neighbor"||hint.reason==="not-higher-than-neighbor"?`${t("powerNoTrigger")}${comparison}`:hint.reason==="no-ordinary-power"?t("powerNoOrdinary"):hint.reason==="not-your-turn"?t("powerWaiting"):hint.reason==="ante-phase"?t("powerAnte"):hint.reason==="choice-pending"?t("powerChoice"):hint.reason==="phase-locked"?t("powerLocked"):hint.reason==="missing-neighbor-card"?t("powerNeighborMissing"):hint.reason==="legacy-sync"?t("powerLegacy"):t("powerMissing");
 }
 function dragContext():DragContext|null{const own=privateGame(),a=action();return own&&view?.table?{tableId:view.table.id,gameId:own.id,seatId:own.selfSeatId,revision:own.revision,kind:a&&a.kind!=="choose"?a.kind:null,legalCardIds:a&&a.kind!=="choose"?a.cardIds:[],locked:locked()||suspended,scopeId}:null;}
 function visibleCards(){const own=privateGame(),omniscient=omniscientGame(),g=view?.game,a=action(),display=stageView;return [...(own?.hand??[]),...(own?.committedAnte?[own.committedAnte]:[]),...(omniscient?Object.values(omniscient.privateHands).flat():[]),...(omniscient?Object.values(omniscient.privateCommittedAntes).filter((value):value is Card=>!!value):[]),...(g?.ante??[]),...(g?.discard??[]),...(g?.revealed??[]),...(g?.seats.flatMap(s=>s.flight.map(f=>f.card))??[]),...(display?.ante??[]),...(display?.discard??[]),...(display?.seats.flatMap(s=>s.flight.map(f=>f.card))??[]),...(a?.kind==="choose"?a.choice.options.filter(o=>o.cardId).map(o=>card(o.cardId!)):[])];}
 function inspectCard(id:string,pinned:boolean){const value=visibleCards().find(c=>c.id===id);if(value){preview(value,pinned);return;}
  // A public reveal can still be animating after the following snapshot moved
  // that card elsewhere. Hits only expose face-up cards; the public log proves
  // its identity without inspecting anyone's hidden hand or private choices.
  if(view?.game?.events.some(event=>event.cardIds?.includes(id)))try{preview(card(id),pinned);}catch{}
 }
 function legalDropZone(){const a=action();return !locked()&&!suspended&&a&&a.kind!=="choose"&&a.cardIds.length?(a.kind==="ante"?"ante":"flight"):null;}
 function effectCardIds(){const step=activeResolutionStep();return [...new Set([...activePowerCards(view?.game),...(power?.current?[power.current.cardId]:[]),...(step?.sourceCardId?[step.sourceCardId]:[])])];}
 function syncStage():boolean{const target=stage;if(!target||syncingStage)return false;syncingStage=true;try{if(!power?.busy&&!cinema?.holdsTable&&!settling()&&(stage?.idle()??true))stageView=view?.game??null;const step=activeResolutionStep(),focus=resolutionFocus(),resolutionIds=[...(step?.sourceCardId?[step.sourceCardId]:[]),...(power?.current?[power.current.cardId]:[])];
   // Card effects wait for the full-screen layer to be dismissed, so nothing
   // plays in parallel with it.
   const effectsReady=!power?.busy&&!revealPhase&&!pendingCues.length;target.update({view:stageView,language:lang,connected:!!view?.connected,reducedMotion:reduced.matches,legalDropZone:legalDropZone(),activeEffectCardIds:effectCardIds(),activeResolutionCardIds:effectsReady?[...new Set(resolutionIds)]:[],activeResolutionFamily:resolutionFamily(step),resolutionTargetSeatId:focus.targetSeatId,resolutionTargetRelation:focus.targetRelation,goldFlows:stageGoldFlows,selectedCardIds:[...selected,...(hoveredHand?[hoveredHand]:[])],...(resetStage?{animate:false}:{})});resetStage=false;return true;}finally{syncingStage=false;}}
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
  if(view?.table?.id!==p.tableId||view.game?.id!==p.gameId||!view.game||!("selfSeatId" in view.game)||view.game.selfSeatId!==p.action.seatId){pendingAction=null;dispatchFailed=false;resetStage=true;stageCancel();return;}
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
  else if(event.key===" "&&!keyboardHeld){event.preventDefault();const context=dragContext();keyboardCard=own.hand[index].id;if(!context||context.locked||!context.legalCardIds.includes(keyboardCard))return;keyboardHeld=true;keyboardContext={...context,legalCardIds:[...context.legalCardIds]};publishGesture();const point=stage?.getAnchor({cardId:keyboardCard});if(point&&stageAvailable&&!compactViewport())stage?.setDrag({cardId:keyboardCard,x:point.x,y:point.y});el("stage-keyboard").textContent=(lang==="zh"?"已拿起；Enter 放下，Esc 取消。":"Lifted. Enter to drop; Esc to cancel.");}
  else if(event.key==="Enter"){event.preventDefault();if(!keyboardHeld){inspectCard(own.hand[index].id,true);return;}const context=dragContext();if(context?.kind&&!context.locked){const zone=context.kind==="ante"?"ante":"flight";drop({...context,kind:context.kind,cardId:keyboardCard,zone});}}
  else if(event.key==="Escape"&&keyboardHeld){event.preventDefault();event.stopPropagation();stageCancel();el("stage-keyboard").textContent=keyboardText();}
 }
 function toggle(id:string){if(locked()||!eligibleIds().includes(id))return;touched=true;const a=action()!,max=a.kind==="choose"?a.choice.max:1;
  if(selected.has(id))selected.delete(id);else if(max===1)selected=new Set([id]);else if(selected.size<max)selected.add(id);render();
 }
 /** A public table slap. It carries no hand data, so it rides the gesture
  *  envelope and inherits that channel's validation and rate limit. */
 function publishSlap(){
  // A slap is presentation, not a rules action, so it is deliberately not gated
  // by `locked()`: the moment a player wants to hurry the table is exactly when
  // someone else is dawdling over a choice.
  const own=privateGame();if(!own||suspended)return;
  gestureSequence=Math.max(gestureSequence+1,Date.now());
  const value:HandGesture={gameId:own.id,revision:own.revision,count:own.hand.length,hover:null,selected:[],sequence:gestureSequence,slap:true};
  // The sender never receives its own broadcast, so drive the local stage
  // directly; otherwise the slapping player would see nothing at all.
  stage?.gesture(own.selfSeatId,value);
  deps.gesture?.(value);
  sound?.play('slap',`slap:${gestureSequence}`);
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
  const glowing=new Set(effectCardIds());for(const wrap of root.querySelectorAll<HTMLElement>(".card-wrap"))wrap.classList.toggle("power-active",!!wrap.closest(".flight,.dom-drop-slot,#antes")&&glowing.has(wrap.querySelector<HTMLElement>("[data-card]")?.dataset.card??""));
  const confirm=root.querySelector<HTMLButtonElement>("#confirm-action");if(confirm)confirm.disabled=locked()||selected.size<min||selected.size>max;
  const count=root.querySelector("#selection-count");if(count)count.textContent=`${t("selection")}: ${selected.size} · ${t("chooseRange")}: ${min===max?min:`${min}–${max}`}`;
 }
 function draft():TableUIDraft|null{return view?.table&&view.game?{tableId:view.table.id,gameId:view.game.id,selectionKey,selected:[...selected],boardScroll:el("board-scroll").scrollTop,handScroll:root.querySelector<HTMLElement>("#hand .cards")?.scrollLeft??0,open:[]}:null;}
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
 function resolutionStepText(step:ResolutionStep):string{
  if(step.kind==="choice")return step.code?rulePrompt(step.code,lang):t("stackChoice");
  switch(step.kind){
   case "power":return t("stackPower");
   case "rewards":return t("stackRewards");
   case "buy-empty":return t("stackBuy");
   case "end-turn":return t("stackEndTurn");
   case "score":return t("stackScore");
   case "award":return t("stackAward");
   case "demand":return t("stackDemand");
   case "bronze":case "bronze-keep":return t("stackBronze");
   case "seer":case "seer-keep":return t("stackSeer");
   case "sorcerer":case "sorcerer-ante":return t("stackSorcerer");
   case "trickster":case "trickster-trigger":return t("stackTrickster");
   case "strength-ante":return t("stackAnte");
   default:return t("stackAbility");
  }
 }
 /** The host-side editor. It is presentation only: readings come from the
  *  omniscient inspection projection and every change leaves as an `edit`
  *  command, so the panel never edits a local copy of the game. */
 /** The lobby kick capability, resolved locally as a fallback: the controller
  *  reports it from the same facts, but the page must not lose the control just
  *  because a capability field went missing in transit. The host still
  *  authorizes every removal from the authenticated connection. */
 function canKick():boolean{
  const current=view,table=current?.table;
  if(!table||table.stage!=="lobby"||current?.game)return false;
  return current?.canKick===true||!!current?.isHost;
 }
 function renderTableEditor(){
  // The panel opens on the payload itself: a GM on another client receives the
  // host's inspection view without ever satisfying canEdit (that flag means "this
  // client can build the payload", which only the serving host can).
  const inspection=omniscientGame(),authorized=!!view?.isHost||view?.role==="GM";
  const host=el("table-editor-host"),open=!!inspection&&authorized;
  host.hidden=!open;
  if(!open){tableEditorView.render({visible:false,language:lang,seats:[],pool:[],info:{deck:0,discard:0,stakes:0,hole:0,round:0,gambit:0},labels:editorLabels(),onSetGold:()=>{},onMoveCard:()=>{},onReplace:()=>{},onClose:()=>{}});return;}
  const omniscient=inspection!;
  const seats=omniscient.seats.map(seat=>({id:seat.id,name:seat.name,gold:seat.gold,debt:seat.debt,isSelf:seat.id===inspection.selfSeatId,isLeader:seat.id===inspection.leaderSeatId,committed:seat.committed,
    hand:(omniscient.privateHands[seat.id]??[]).map(editorCard),
    ante:omniscient.privateCommittedAntes[seat.id]?editorCard(omniscient.privateCommittedAntes[seat.id]!):null}));
  // Any card outside a hand may be brought in. The excluded twenty count too:
  // a replacement swaps two locations, so the 80/20 split still holds exactly.
  const taken=new Set(Object.values(omniscient.privateHands).flat().map(value=>value.id));
  const pool=[...(omniscient.privateDeck??[]),...omniscient.discard,...(omniscient.privateExcluded??[])].filter(value=>!taken.has(value.id)).map(editorCard);
  tableEditorView.render({visible:true,language:lang,seats,pool,
    info:{deck:omniscient.deckCount,discard:omniscient.discard.length,stakes:omniscient.stakes,hole:omniscient.hole,round:omniscient.round,gambit:omniscient.gambit},
    labels:editorLabels(),
    onSetGold:(seatId,amount)=>{touched=true;void deps.send({type:"edit",edit:{kind:"gold",seatId,amount}});},
    onMoveCard:(cardId,toSeatId)=>{touched=true;void deps.send({type:"edit",edit:{kind:"moveCard",cardId,toSeatId}});},
    onReplace:(cardId,withCardId)=>{touched=true;void deps.send({type:"edit",edit:{kind:"replaceCard",cardId,withCardId}});},
    onClose:()=>{void deps.send({type:"omniscient",enabled:false});}});
 }
 function editorCard(value:Card){return {id:value.id,name:cardName(value.id,lang),image:cardFaceURL(value.id),family:value.family,strength:value.strength};}
 function editorLabels(){return {title:t("omniscientTitle"),hint:t("editorHint"),gold:t("editorGold"),hand:t("editorHand"),ante:t("editorAnte"),empty:t("editorEmpty"),deck:t("editorDeck"),discard:t("editorDiscard"),stakes:t("editorStakes"),hole:t("editorHole"),round:t("editorRound"),gambit:t("editorGambit"),remove:t("editorRemove"),removeHint:t("editorRemoveHint"),replace:t("editorReplace"),replaceHint:t("editorReplaceHint"),search:t("editorSearch"),searchPlaceholder:t("editorSearchPlaceholder"),noResults:t("editorNoResults"),picked:t("editorPicked"),clear:t("editorClear"),close:t("close"),amount:t("editorAmount"),giveTo:t("editorGiveTo"),addCard:t("editorAddCard")};}
 function renderResolutionStack(host:HTMLElement,stack:ResolutionStep[],own:SeatView|null){
  const focus=resolutionFocus(stack);if(focus.sourceCardId)host.dataset.sourceCard=focus.sourceCardId;else delete host.dataset.sourceCard;if(focus.targetSeatId)host.dataset.targetSeat=focus.targetSeatId;else delete host.dataset.targetSeat;if(focus.targetRelation)host.dataset.targetRelation=focus.targetRelation;else delete host.dataset.targetRelation;
 }
  function clearBannerEvent(){if(bannerTimer)clearTimeout(bannerTimer);bannerTimer=undefined;bannerEvent=null;}
  function soundControls(){const enabled=sound?.enabled??true;el("sound-toggle").textContent=lang==="zh"?(enabled?"音效：开":"音效：关"):(enabled?"Sound: on":"Sound: off");el("sound-toggle").setAttribute("aria-pressed",String(enabled));}
 let roundNote="", roundNoteTimer:ReturnType<typeof setTimeout>|undefined;
 /** The round banner names the strongest flight that just resolved and the
  *  player who opens the next round. It reads the previous projection, because
  *  the new one has already reset the flights. */
 function noteRoundChange(previous:TableView|null){
  const before=previous?.game,after=view?.game;
  if(!before||!after||before.id!==after.id||before.round===after.round||before.round<1)return;
  const best=[...before.seats].sort((left,right)=>(right.scoringStrength??right.strength)-(left.scoringStrength??left.strength))[0];
  if(!best)return;
  const points=best.scoringStrength??best.strength,leader=after.leaderSeatId?seatName(after.leaderSeatId):"";
  roundNote=lang==="zh"?`上轮 ${seatName(best.id)} 最大，点数为 ${points}${leader?` · 新的一轮 ${leader} 开始`:""}`:`Last round went to ${seatName(best.id)} with ${points}${leader?` · round ${after.round} opens with ${leader}`:""}`;
  // The banner and its sound are one event: a new round is never silent.
  sound?.play('round',`${after.id}:${after.round}`);
  if(roundNoteTimer)clearTimeout(roundNoteTimer);
  roundNoteTimer=setTimeout(()=>{roundNoteTimer=undefined;roundNote="";if(!destroyed)render();},4500);
 }
 function playUpdateSounds(previous:TableView|null){
  const before=previous?.game,after=view?.game;if(!before||!after||before.id!==after.id||!previous?.connected||!view?.connected||after.revision!==before.revision+1||suspended||document.hidden)return;
  const fresh=freshPublicEvents(before,after),key=`${view.table?.id}:${after.id}:${after.revision}`;
  const ante=fresh.some(event=>event.code==="ANTE_REVEALED");
  if(ante){anteSoundKey=key;if(!stageAvailable||reduced.matches)sound?.play('flip',key);}
  else if(fresh.some(event=>["CARD_PLAYED","FLIGHT_REPLACED","CARD_REVEALED","CARDS_REVEALED"].includes(event.code)))sound?.play('flip',key);
  const kinds:Array<'draw'|'coin'>=[];
  if(after.deckCount<before.deckCount||fresh.some(event=>event.code==="DECK_RESHUFFLED"))kinds.push('draw');
  if((!ante||!stageAvailable||reduced.matches)&&(after.stakes!==before.stakes||after.hole!==before.hole||after.seats.some(seat=>seat.gold!==before.seats.find(old=>old.id===seat.id)?.gold)))kinds.push('coin');
  for(const kind of kinds)if(power?.busy||cinema?.busy)deferredSounds.set(kind,key);else sound?.play(kind,key);
  // Gold that changes hands gets its direction: a glint for the local seat
  // taking or winning, the same figure falling for paying and losing.
  const selfSeat=privateGame()?.selfSeatId;
  const gold=fresh.filter(event=>!!event.amount&&["PAID_STAKES","PAID_PLAYER","PAID_HOLE","TOOK_STAKES","TOOK_HOLE","GAMBIT_WON"].includes(event.code));
  const scored=fresh.find(event=>event.code==="GAMBIT_SCORED"&&!!event.score);
  if((gold.length||scored)&&selfSeat){
   const credited=scored
     ? (scored.score?.payouts??[]).some(payout=>payout?.seatId===selfSeat&&payout.amount>0)
     : gold.some(event=>event.targetSeatId===selfSeat||["TOOK_STAKES","TOOK_HOLE","GAMBIT_WON"].includes(event.code)&&event.seatId===selfSeat);
   sound?.play(credited?'gain':'pay',`${key}:gold`);
  }
  // Adjudication, the end of the game and the result are announced once each.
  if(after.phase==="adjudication"&&before.phase!=="adjudication")sound?.play('verdict',`${key}:verdict`);
  const ended=fresh.some(event=>event.code==="GAME_ENDED")||after.phase==="ended"&&before.phase!=="ended";
  if(ended){
   const won=!!selfSeat&&after.winners.includes(selfSeat);
   sound?.play(won?'victory':'gameover',`${key}:ending`);
  }
  // A turn only moves on a play phase, and only for the seat that now holds it.
  if(after.activeSeatId&&after.activeSeatId!==before.activeSeatId&&(after.phase==="play"||after.phase==="choice"))sound?.play('turn',`${key}:turn:${after.activeSeatId}`);
 }
  function clearPresentation(){presentationView=null;presentationBase=null;stageGoldFlows=[];deferredSounds.clear();anteSoundKey="";cinema?.clear();power?.clear();}
 function notifyPresentation(){if(updating||destroyed)return;const busy=!!power?.busy||!!cinema?.busy||!!revealPhase;if(busy!==notifiedPresentationBusy){notifiedPresentationBusy=busy;deps.onPresentationChange?.(busy);}}
 /** One pass of the resolution show, strictly sequential: the card lands, the
  *  table rests for 0.3s, the full-screen ability plays, and only once the
  *  player dismisses it do the card effects (stealing, transfers) run, with a
  *  final 0.3s rest before the phase label is allowed to change.
  *
  *  This is a state machine driven by facts the stage reports, never by a
  *  single guess. A cue may only open once the stage has *adopted the
  *  projection that carries it* and every motion that projection started is
  *  over. Sampling "is anything moving right now" once released the
  *  explanation while the played card was still held in the drag/pending slot
  *  — the acting seat's own stage had not even seen the projection yet — which
  *  is exactly why the full-screen layer used to open before the card landed. */
 const PRESENTATION_BEAT_MS=300, PRESENTATION_TICK_MS=50, PRESENTATION_IDLE_TICK_MS=150, PRESENTATION_TICK_LIMIT=200;
 let pendingCues:ReturnType<typeof powerEvents>=[], presentTimer:ReturnType<typeof setTimeout>|undefined;
 let landedAt=0,cueTicks=0;
 /** A show runs from the first ability cue until the table has been quiet for a
  *  full beat *after* its settlement animations (coins flying, cards drawn or
  *  taken) have finished. While it runs the next phase waits as a whole: the
  *  phase chip, the clockwise/turn line, the waiting line and the next
  *  projection all stay on the previous step, so a payout is never interrupted
  *  by the next phase appearing. */
 let showBusy=false,showQuietSince=0,statusReady=true;
 interface TableStatus {turnVisible:boolean;turnLabel:string;turnKey:string;phase:string;phaseKey:string;waiting:string;effect:string}
 const emptyStatus:TableStatus={turnVisible:false,turnLabel:"",turnKey:"",phase:"",phaseKey:"",waiting:"",effect:""};
 let committedStatus:TableStatus=emptyStatus;
 function beginShow(){showBusy=true;showQuietSince=0;statusReady=false;}
 /** The stage owns the newest projection and has nothing in flight. */
 function landingDone():boolean{
  if(!stage)return true;
  const diagnostics=stage.diagnostics(),revision=view?.game?.revision;
  const adopted=typeof revision!=="number"||typeof diagnostics.viewRevision!=="number"||diagnostics.viewRevision>=revision;
  return adopted&&(stage.settled()??true);
 }
 /** Everything that has to finish before the next phase may appear: the cue
  *  queue, the full-screen layer, the cinema, the reveal show, and every
  *  settlement animation the table is still playing. */
 function presentationQuiet():boolean{return !power?.busy&&!cinema?.busy&&!revealPhase&&!pendingCues.length&&(stage?.idle()??true);}
 /** True only while a show is waiting on its own settlement animations: the
  *  explanation is closed, no cue is queued, and the table is still paying out.
  *  The next projection is held back for exactly that window (plus the beat),
  *  never during the landing a cue is waiting for. */
 function settling():boolean{return showBusy&&!pendingCues.length&&!power?.busy&&!cinema?.holdsTable&&!revealPhase;}
function releaseCues(){
  if(destroyed||!pendingCues.length)return;
  // One explanation at a time. When a single revision carries two abilities, the
  // second one waits for the first to be dismissed *and* for the table to finish
  // the card effects that revision produced, exactly like the next phase does.
  const [cue,...rest]=pendingCues;
  pendingCues=rest;
  beginShow();
  power?.enqueue([cue]);
  render();
 }
 function holdCues(cues:ReturnType<typeof powerEvents>){
  pendingCues=cues;landedAt=0;cueTicks=0;
  beginShow();
  pumpPresentation();
 }
 /** Round/turn announcements opened by a projection that arrived mid-settlement
  *  wait here, so the banner never appears over a running payout. */
 let pendingRounds:ReturnType<typeof roundCues>=[];
 function holdRounds(cues:ReturnType<typeof roundCues>){
  if(!settling()&&!pendingRounds.length){cinema?.enqueue(cues);return;}
  for(const cue of cues)pendingRounds.push(cue);
  pumpPresentation();
 }
 function schedulePresentation(delay=PRESENTATION_TICK_MS){if(destroyed||presentTimer)return;presentTimer=setTimeout(()=>{presentTimer=undefined;pumpPresentation();},delay);}
 function pumpPresentation(){
  if(destroyed)return;
  const now=performance.now();
  if(pendingCues.length&&!power?.busy&&!revealPhase){
    // A cinema cue (round/scoring) owns the table first; the played card then
    // lands on a still table. Waiting for it keeps the show serial instead of
    // forcing a projection the stage is not allowed to adopt yet.
    if(!landingDone()&&cueTicks<PRESENTATION_TICK_LIMIT){
      cueTicks++;
      // The acting seat's own card sits in the stage's pending slot until its
      // receipt arrives, so the stage never adopts that projection by itself.
      // Nudge it every tick rather than opening the explanation early.
      syncStage();
      schedulePresentation();
      return;
    }
    if(!landedAt)landedAt=now;
    const remaining=PRESENTATION_BEAT_MS-(now-landedAt);
    if(remaining>0){schedulePresentation(remaining);return;}
    landedAt=0;cueTicks=0;
    releaseCues();
    return;
  }
  if(pendingCues.length){schedulePresentation();return;}
  if(showBusy){
    // Step three of the show: the settlement animations run here. The table
    // finishing them has no callback of its own, so the gate keeps a watch —
    // quiet for a whole beat is what ends the show.
    if(!presentationQuiet()){showQuietSince=0;schedulePresentation(PRESENTATION_IDLE_TICK_MS);return;}
    if(!showQuietSince){showQuietSince=now;schedulePresentation(PRESENTATION_BEAT_MS);return;}
    const wait=PRESENTATION_BEAT_MS-(now-showQuietSince);
    if(wait>0){schedulePresentation(wait);return;}
    showBusy=false;showQuietSince=0;statusReady=true;
    if(pendingRounds.length){const cues=pendingRounds.splice(0);cinema?.enqueue(cues);beginShow();}
    // The chip, the turn line and the waiting line land together, and only now.
    const key=view?.game?`${view.game.id}:${view.game.gambit}:${view.game.round}:${view.game.phase}`:"";
    if(key)sound?.play('phase',key);
    if(!updating)render();
    return;
  }
 }
 function presentationChanged(){
  root.dataset.powerActive=String(!!power?.busy);
  root.dataset.cinemaActive=String(!!cinema?.busy);
  cinema?.pause(!!power?.busy||!!revealPhase);
  if(!!cinema?.busy||!!revealPhase)beginShow();
  pumpPresentation();
  if(updating||destroyed)return;
  const previous=!power?.busy&&!cinema?.busy?presentationBase:null;if(!power?.busy&&!cinema?.busy)presentationBase=null;
  render();
  // A non-blocking turn/round banner must not hold a sound caused by the
  // acknowledged power. Score presentations do hold their own coin sequence;
  // all other deferred cues can be released as soon as the power and reveal
  // gates are clear.
  const releaseDeferredSounds=!power?.busy&&!revealPhase&&!cinema?.holdsTable;
  if(!power?.busy&&!cinema?.busy){if(previous)animateChanges(previous);}
  if(releaseDeferredSounds){for(const [kind,key] of deferredSounds)sound?.play(kind,key);deferredSounds.clear();}
  notifyPresentation();
 }
 function receiveBannerEvent(previous:TableView|null){
  const old=previous?.game,next=view?.game;
  if(!old||!next||old.id!==next.id||next.revision<old.revision){clearBannerEvent();return;}
  if(next.revision===old.revision)return;
  const before=old.events.map(e=>JSON.stringify(e)),after=next.events.map(e=>JSON.stringify(e));let overlap=0;
  for(let n=Math.min(before.length,after.length);n>0;n--)if(before.slice(-n).every((event,i)=>event===after[i])){overlap=n;break;}
  // A history gap is a new snapshot, not an animation to replay.
  if(before.length&&!overlap){clearBannerEvent();return;}
  const fresh=next.events.slice(overlap);
  const event=[...fresh].reverse().find(e=>["POWER_TRIGGERED","ANTE_ALL_TIED","GAMBIT_WON","GAME_ENDED","SPECIAL_FLIGHT","PAID_HOLE","TOOK_HOLE"].includes(e.code)&&(!["PAID_HOLE","TOOK_HOLE"].includes(e.code)||!!e.amount));
  if(!event)return;clearBannerEvent();bannerEvent=event;
  bannerTimer=setTimeout(()=>{bannerTimer=undefined;bannerEvent=null;if(!destroyed)renderBanner();},4500);
 }
 const phaseLabel=(phase:string|undefined)=>{
  if(!phase)return "";
  const zh:{[key:string]:string}={ante:"前注阶段",play:"出牌阶段",choice:"能力选择",resolve:"结算阶段",adjudication:"等待裁定",ended:"整局结束"};
  const en:{[key:string]:string}={ante:"Ante",play:"Playing",choice:"Power choice",resolve:"Scoring",adjudication:"Adjudication",ended:"Game over"};
  return lang==="zh"?(zh[phase]??phase):(en[phase]??phase);
 };
 function renderBanner(){
  const game=view?.game,own=privateGame();let waiting="",effect="";
  const names=game?.waitingSeatIds.map(id=>id===own?.selfSeatId?t("you"):seatName(id)).join(lang==="zh"?"、":", ")??"";
  if(game?.phase==="ante"&&names)waiting=lang==="zh"?`等待${names}选择下注牌…`:`Waiting for ${names} to choose ante cards…`;
  else if(game?.phase==="choice"&&game.choice){const actor=game.choice.beneficiarySeatId??game.choice.seatId,actorName=actor===own?.selfSeatId?t("you"):seatName(actor),source=game.choice.sourceCardId?` · ${cardName(game.choice.sourceCardId,lang)}`:"";waiting=lang==="zh"?`${actorName}正在触发效果${source} · 等待${names}选择`:`${actorName} is resolving a power${source} · Waiting for ${names} to choose`;}
  else if(game?.phase==="play"&&names)waiting=lang==="zh"?`等待${names}出牌中…`:`Waiting for ${names} to play…`;
  else if(game?.phase==="ended")waiting=`${t("winners")}: ${game.winners.map(seatName).join(", ")}`;
  if(revealPhase)waiting=lang==="zh"?({placing:"所有人已提交下注牌…",revealing:"同时翻开下注牌…",price:"点数最高的下注牌已标出…",payment:"结算下注金币…",discard:"下注牌全部并列，弃牌后重新选择…"}[revealPhase]):({placing:"All ante cards are committed…",revealing:"Revealing all ante cards…",price:"The highest ante cards are highlighted…",payment:"Paying gold into the stakes…",discard:"All antes are tied. Discard them and choose again…"}[revealPhase]);
  if(power?.current)waiting=lang==="zh"?`${seatName(power.current.seatId)}正在触发效果…`:`${seatName(power.current.seatId)} is resolving a power…`;
  if(bannerEvent){const e=bannerEvent;effect=[seatName(e.seatId),t(e.code),...(e.cardIds??[]).map(id=>cardName(id,lang)),e.amount===undefined?"":`${e.amount} ${t("gold")}`].filter(Boolean).join(" · ");}
  if(roundNote)effect=roundNote;
  const activeSeatId=game?.activeSeatId,turnVisible=!!game&&!!activeSeatId&&(game.phase==="play"||game.phase==="choice"),activeName=activeSeatId===own?.selfSeatId?t("you"):activeSeatId?seatName(activeSeatId):"",turnLabel=turnVisible?`${t("clockwise")} · ${t("turnActive")}: ${activeName||t("acting")}`:"",turnKey=turnVisible&&game?`${game.id}:${game.gambit}:${game.round}:${activeSeatId}`:"";
  // The waiting line lives with the clockwise hint in the bottom-left corner:
  // centred at the top it covered the far player's hand, which is exactly the
  // information a waiting player wants to count.
  // Every status line lives in the bottom-left cluster now: centred at the top
  // it covered the far player's hand.
  // The chip shows the *committed* phase, not the incoming one: the scheduler
  // only commits it once the show is quiet for a beat, so a round banner, an
  // explanation or a payout always finishes first.
  // While a show is running the whole line stays on the previous step; the
  // scheduler commits the live values once the settlement animations are over.
  const next={turnVisible,turnLabel,turnKey,phase:game?phaseLabel(game.phase):"",phaseKey:game?`${game.id}:${game.gambit}:${game.round}:${game.phase}`:"",waiting,effect};
  if(statusReady)committedStatus=next;
  const shown=statusReady?next:committedStatus;
  turnIndicatorView.render({...shown,reducedMotion:reduced.matches});
 }
 function render(){if(destroyed)return;
  reactShell.begin();
  try{
  refreshKeyboard();
  const game=view?.game,own=privateGame(),a=action(),table=view?.table,resolutionStack=game?.resolutionStack??[];
  const key=game?`${game.id}:${game.gambit}:${game.round}:${a?.kind??"waiting"}:${a?.kind==="choose"?a.choice.id:""}`:"";
  if(key!==selectionKey){selectionKey=key;selected.clear();}selected=new Set([...selected].filter(id=>eligibleIds().includes(id)));
  document.documentElement.lang=lang==="en"?"en":"zh-CN";document.title=t("title");
  root.dataset.phase=game?.phase??"lobby";root.dataset.players=String(game?.seats.length??0);const focus=resolutionFocus(resolutionStack);if(focus.sourceCardId)root.dataset.activePowerCard=focus.sourceCardId;else delete root.dataset.activePowerCard;if(focus.targetSeatId)root.dataset.resolutionTargetSeat=focus.targetSeatId;else delete root.dataset.resolutionTargetSeat;if(focus.targetRelation)root.dataset.resolutionTargetRelation=focus.targetRelation;else delete root.dataset.resolutionTargetRelation;
  for(const [id,code] of [["title","title"],["reset-title","resetTitle"],["reset-body","resetBody"],["cancel-reset","cancel"],["confirm-reset","confirmReset"],])el(id).textContent=t(code);
  el("edition").textContent=(game?variantSummary(game.variant):t("edition"))+` · ${buildStamp()}`;
  const omniscient=omniscientGame();
   el("tutorial").textContent = lang === "en" ? "How to play" : "如何游玩"; el("language").textContent = lang === "en" ? "中文" : "English";soundControls();root.dataset.powerActive=String(!!power?.busy);root.dataset.omniscient=String(!!omniscient);
  const slapButton=el<HTMLButtonElement>("slap-table");slapButton.hidden=!game||!privateGame();slapButton.textContent=lang==="zh"?"拍桌催促":"Knock";slapButton.title=lang==="zh"?"拍桌催促其他玩家":"Knock on the table to hurry the others";
  const newGameButton=el<HTMLButtonElement>("new-game");newGameButton.hidden=!view?.isHost||view?.table?.stage==="lobby";newGameButton.textContent=t("newGame");newGameButton.disabled=!receiptCompatible()||busy()||!!view&&!view.connected&&view.message!=="recoveryMissing";
  // The entry is decided from what this page can see itself: a running game
  // plus ownership or the room GM role. Depending on a capability flag made the
  // control vanish whenever that flag failed to arrive.
  const omniscientToggle=el<HTMLButtonElement>("omniscient-toggle");omniscientToggle.hidden=!(!!game&&(!!view?.isHost||view?.role==="GM"));omniscientToggle.textContent=t(omniscient?"omniscientOn":"omniscientOff");omniscientToggle.title=`${t("omniscientHint")}${lang==="zh"?"（本机角色：":" (local role: "}${view?.role??"unknown"}${lang==="zh"?"）":")"}`;omniscientToggle.setAttribute("aria-label",`${omniscientToggle.textContent} · ${t("omniscientHint")}`);omniscientToggle.setAttribute("aria-pressed",String(!!omniscient));
  if(!view?.canEdit&&omniscientGame())void deps.send({type:"omniscient",enabled:false});
  el("close").setAttribute("aria-label",t("close"));el("close").title=t("close");el("close").textContent=t("backToMap");el("display-mode").textContent=t(deps.mode==="compact"?"expand":"minimize");const closePreview=root.querySelector<HTMLButtonElement>("#close-preview");if(closePreview)closePreview.setAttribute("aria-label",t("closePreview"));
  const message=view&&!receiptCompatible()?(lang==="zh"?"牌桌后台仍是旧版。请完整刷新枭熊页面后再出牌；现在仍可观看或返回地图。":"The table background is an older version. Fully refresh the Owlbear page before playing. You can still watch or return to the map."):pendingAction?.retryable?(lang==="zh"?"尚未确认这次操作，请重试原操作。":"This action is not confirmed. Retry the same action."):localMessage?(rulePrompt(localMessage,lang)!==localMessage?rulePrompt(localMessage,lang):t(localMessage)):view?.message?tableText(view.message,lang):busy()?t("sending"):!view||!view.connected?t("connecting"):"";
  el("status").textContent=message;el("status").hidden=!message;el("status").classList.toggle("error",!!view?.message&&!['connecting','privateSync'].includes(view.message));
  if(table?.id!==setupTableId){setupTableId=table?.id??"";startingGold=undefined;startingHand=6;const variant=table?.variant??DEFAULT_VARIANT;setupRuleSetId=variant.ruleSetId;setupDeckId=variant.deckId;setupSpecialIds=variant.specialIds?[...variant.specialIds]:SPECIAL_CARDS.slice(0,10).map(value=>value.id);}
  tableToolbarView.render({
   table:table?{stage:table.stage,seats:table.seats}:null,
   hasView:!!view,
   selfPlayerId:view?.selfPlayerId,
   isHost:!!view?.isHost,
   connected:!!view?.connected,
   message:view?.message,
   localMessage,
   sending,
   retryable:!!pendingAction?.retryable,
   createDisabled:locked(),
   joinDisabled:locked()||!!table&&table.seats.length>=6,
   leaveDisabled:locked(),
   startDisabled:locked()||!table||table.seats.length<2||setupDeckId==="selected-specials-v1"&&selectedSpecialIds().length!==10,
   retryDisabled:sending||!!view&&!receiptCompatible(),
   labels:{create:t("create"),join:t("join"),leave:t("leave"),start:t("start"),retry:t("retry"),retryAction:lang==="zh"?"重试这次操作":"Retry this action"},
   onCreate:()=>send({type:"create"}),
   onJoin:()=>send({type:"join"}),
   onLeave:()=>send({type:"leave"}),
   onStart:()=>{if(!table)return;send({type:"start",options:{...(startingGold===undefined?{}:{startingGold}),startingHand,variant:setupVariant()}});},
   onRetry:()=>send({type:"retry"}),
  });
  section("lobby-copy",[table,view?.selfPlayerId,view?.isHost,view?.canKick,!!game],host=>{
   if(!table){host.append(node("p",t("noTable")));return;}
    if(!game){host.append(node("p",t(table.stage==="playing"?"privateSync":"lobby")));const seats=node("div",undefined,"seat-chips");
     for(const seat of table.seats){const chip=node("span",undefined,"seat-chip");
      const suffix=(seat.playerId===view?.selfPlayerId?" ("+t("you")+")":"")+(seat.playerId===table.hostPlayerId?" · "+t("host"):"");
      chip.append(node("strong",seat.name+suffix));
      // Lobby-only removal. The host re-authorizes every request from the
      // sender's authenticated connection, so this button is only an entry.
      if(canKick()&&table.stage==="lobby"&&seat.playerId!==view?.selfPlayerId&&seat.playerId!==table.hostPlayerId){const out=button(t("kick"),()=>{touched=true;void deps.send({type:"kick",playerId:seat.playerId});},false,"quiet");out.classList.add("kick");out.title=t("kickHint");chip.append(out);}
      seats.append(chip);}
     host.append(seats);if(table.stage==="lobby")host.append(node("p",t(table.seats.length<2?"needPlayers":view?.isHost?"creatorReady":"seated"),"muted"));}
  });
  renderTableEditor();
  renderTableSetup();
  section("summary",game&&[game.gambit,game.round,game.stakes,game.hole],host=>{if(!game)return;for(const [code,value] of [["gambit",game.gambit],["round",game.round],["stakes",game.stakes],["hole",game.hole]]){const chip=node("span",undefined,`counter ${code}`);chip.append(node("small",t(String(code))),node("strong",String(value)));host.append(chip);}});
  section("deck-pile",game?.deckCount,host=>{if(!game)return;const back=node("div",undefined,"card-back deck-back");back.setAttribute("aria-hidden","true");back.innerHTML=emblem;host.append(back,node("span",`${t("deck")} · ${game.deckCount}`));});
  el("discard-pile").textContent=`${t("discard")} · ${game?.discard.length??0}`;
  // A real React island owns this host and reconciles on every projection;
  // no imperative section cache is allowed to leave a stale source/target cue.
  actionTrayView.render({game:game??null,own,action:a,selectedIds:[...selected],locked:locked(),language:lang,labels:{paused:t("paused"),pausedHelp:t("pausedHelp"),ended:t("ended"),winners:t("winners"),ownAnte:t("ownAnte"),anteInstruction:lang==="zh"?"将一张手牌拖到自己的暗置区":"Drag a hand card to your face-down area",flightInstruction:lang==="zh"?"将一张手牌拖到自己的牌阵":"Drag a hand card to your flight",abilityBy:t("abilityBy"),selection:t("selection"),chooseRange:t("chooseRange"),confirm:t("confirmChoice"),inspect:t("inspectCard")},rulePrompt:code=>rulePrompt(code,lang),cardName:value=>cardName(value.id,lang),cardHint:value=>cardHint(value.family,lang),seatName:id=>seatName(id),card,cardOwner:id=>game?.seats.find(seat=>seat.flight.some(entry=>entry.cardId===id))?.name??null,onToggle:toggle,onConfirm:confirmAction,onInspect:inspectCard,onLeaveInspect:id=>{if(!previewPinned&&previewId===id)leavePreview();}});
  handRailView.render({hand:own?.hand??[],action:a,selectedIds:[...selected],hints:own?.handPowerHints??[],labels:{title:t("hand"),inspectHint:t("inspectHint"),powerReadyLegend:t("powerReadyLegend"),powerReadyShort:t("powerReadyShort"),powerPlayableShort:t("powerPlayableShort"),inspect:t("inspectCard")},cardName:value=>cardName(value.id,lang),cardHint:value=>cardHint(value.family,lang),powerText:handPowerText,onToggle:toggle,onInspect:inspectCard,onLeaveInspect:id=>{if(!previewPinned&&previewId===id)leavePreview();},onHover:id=>{if(id){hoveredHand=id;publishGesture();}else if(hoveredHand){hoveredHand="";publishGesture();}}});
  section("players",game&&[own?.selfSeatId,game.seats,game.ante,game.anteOrigins,game.leaderSeatId,game.activeSeatId,resolutionStack.map(step=>[step.status,step.targetSeatId,step.sourceCardId]),omniscient&&Object.keys(omniscient.privateHands)],host=>{if(!game)return;
   const selfIndex=Math.max(0,game.seats.findIndex(seat=>seat.id===own?.selfSeatId)),ordered=[...game.seats.slice(selfIndex+1),...game.seats.slice(0,selfIndex)];
   const positions=ordered.length===1?["top"]:ordered.length===2?["upper-left","upper-right"]:ordered.length===3?["upper-left","top","upper-right"]:ordered.length===4?["lower-left","upper-left","upper-right","lower-right"]:["lower-left","upper-left","top","upper-right","lower-right"];
   const resolutionTargetId=activeResolutionStep(resolutionStack)?.targetSeatId??null;
   for(const seat of game.seats){const panel=node("article",undefined,"seat");panel.dataset.seat=seat.id;panel.dataset.position=seat.id===game.seats[selfIndex].id?"bottom":positions[ordered.findIndex(other=>other.id===seat.id)];panel.classList.toggle("active",seat.id===game.activeSeatId);panel.classList.toggle("self",seat.id===own?.selfSeatId);panel.classList.toggle("resolution-target",seat.id===resolutionTargetId);
   panel.append(node("h2",`${seat.name}${seat.id===own?.selfSeatId?` (${t("you")})`:""}${seat.id===game.leaderSeatId?` · ${t("leader")}`:""}`),node("p",`${t("gold")} ${seat.gold} · ${t("handCount")} ${seat.handCount} · ${t("strength")} ${seat.strength}${seat.debt?` · ${t("debt")} ${seat.debt}`:""}`));
   if(seat.id!==own?.selfSeatId){const privateHand=omniscient?.privateHands[seat.id];if(omniscient&&privateHand){const faces=node("div",undefined,"opponent-hand omniscient-hand");faces.setAttribute("aria-label",`${seat.name} · ${t("omniscientOn")} · ${t("handCount")} ${privateHand.length}`);for(const value of privateHand)faces.append(cardNode(value,undefined,handPowerHintForSeat(value,seat.id)));panel.append(faces);}else{const backs=node("div",undefined,"opponent-hand");backs.setAttribute("aria-label",`${seat.name} · ${t("handCount")} ${seat.handCount}`);for(let index=0;index<Math.min(10,seat.handCount);index++){const back=node("span",undefined,"card-back");back.innerHTML=emblem;back.setAttribute("aria-hidden","true");back.dataset.slot=String(index);back.style.setProperty("--angle",`${(index-(Math.min(10,seat.handCount)-1)/2)*7}deg`);back.style.setProperty("--arc",`${Math.abs(index-(Math.min(10,seat.handCount)-1)/2)*2}px`);backs.append(back);}panel.append(backs);}}
   if(seat.committed)panel.append(node("small",t("committed")));if(seat.archmage)panel.append(node("p",t("archmage"),"effect"));
   const anteSlot=node("div",undefined,"dom-drop-slot");anteSlot.dataset.dropZone="ante";anteSlot.dataset.dropSeat=seat.id;anteSlot.append(node("small",lang==="zh"?"暗置区":"Ante area"));const anteId=game.anteOrigins?.find(origin=>origin.seatId===seat.id)?.cardId,publicAnte=game.ante.find(c=>c.id===anteId),privateAnte=omniscient?.privateCommittedAntes[seat.id]??null,anteCard=publicAnte??privateAnte;if(anteCard)anteSlot.append(cardNode(anteCard));else if(seat.committed){const back=node("div",undefined,"card-back");back.innerHTML=emblem;back.setAttribute("aria-label",t("committed"));anteSlot.append(back);}panel.append(anteSlot);
   const flight=node("div",undefined,"cards flight");flight.dataset.dropZone="flight";flight.dataset.dropSeat=seat.id;const formation=publicFlightFormation(seat);if(formation){const label=formation==="color"?t("formationColor"):formation==="strength"?t("formationStrength"):t("formationMortal");const badge=node("span",label,"formation-badge");badge.dataset.formation=formation;badge.setAttribute("aria-label",`${t("flight")} · ${label}`);flight.append(badge);}for(const item of seat.flight){const c=cardNode(item.card);if(item.wild)c.append(node("small",t("wild")));if(item.rider)c.append(node("small",t("rider")));flight.append(c);}if(!seat.flight.length)flight.append(node("small",lang==="zh"?"牌阵":"Flight"));panel.append(flight);host.append(panel);
  }});
  section("antes",game&&[game.ante,game.anteOrigins,game.revealed],host=>{if(!game)return;const unplaced=game.ante.filter(c=>!game.anteOrigins?.some(origin=>origin.cardId===c.id));if(unplaced.length)host.append(node("h2",t("ante")),cardList(unplaced));if(game.revealed.length)host.append(node("h2",t("revealed")),cardList(game.revealed));});
  section("effects",game&&[game.effects,game.lastGambit],host=>{if(!game)return;if(game.effects?.length){host.append(node("h2",t("effects")));for(const effect of game.effects)host.append(node("p",`${seatName(effect.seatId)} · ${t(effect.kind)}`));}if(game.lastGambit)host.append(node("p",`${t("lastGambit")}: ${game.lastGambit.winners.map(seatName).join(", ")}`));});
  const compactViewportActive=compactViewport();el("lobby").hidden=!!game;el("arena").hidden=!game||stageAvailable;el("stage-host").hidden=!game||!stageAvailable;el("turn").hidden=!game||!el("turn").childElementCount;el("hand").hidden=!own||stageAvailable&&!compactViewportActive;el("hand").inert=stageAvailable&&!compactViewportActive;el("turn").setAttribute("aria-label",t("acting"));root.dataset.hasChoice=String(a?.kind==="choose");renderBanner();
  const readyCards=own?.handPowerHints?.filter(hint=>hint.state==="power-ready")??[],readyNames=readyCards.map(hint=>cardName(hint.cardId,lang));
  const readySummary=readyNames.length?` · ${t("powerReadyCards")}${readyNames.join(lang==="zh"?"、":", ")}`:"";
  el("table-stage").setAttribute("aria-label",(lang==="zh"?"三维牌桌。方向键选牌，空格拿起，Enter放到自己区域。":"Three dimensional card table. Arrow keys choose; Space lifts; Enter drops in your own slot.")+readySummary);
  el("stage-keyboard").textContent=keyboardText();
  el("stage-summary").textContent=game?`${t("gambit")} ${game.gambit} · ${t("round")} ${game.round} · ${t("stakes")} ${game.stakes} · ${t("hole")} ${game.hole}${readySummary}`:"";
  root.dataset.pendingAction=pendingAction?"true":"false";
  if(previewId){const visible=visibleCards().find(value=>value.id===previewId);if(visible)renderInfo(visible,previewPinned);else hidePreview();}
  if(el<HTMLDialogElement>("reset-dialog").open&&resetKey!==`${table?.id}:${game?.id}`)el<HTMLDialogElement>("reset-dialog").close();
  }finally{reactShell.end();}
  // React commits the portals at the end of the batch. Apply imperative
  // interaction state only after that commit so reused buttons cannot retain
  // a stale disabled/selected flag from the previous projection.
  syncSelection();dragController?.refresh();domDragController?.refresh();
  restoreDraft();layoutFan();paintGestures();
 }
 function restoreDraft(){if(!pendingDraft||!view?.game)return;const incoming=pendingDraft;pendingDraft=null;if(touched||incoming.tableId!==view.table?.id||incoming.gameId!==view.game.id||incoming.selectionKey!==selectionKey)return;
  const max=action()?.kind==="choose"?(action() as {kind:"choose";choice:Choice}).choice.max:1;
  selected=new Set(incoming.selected.filter(id=>eligibleIds().includes(id)).slice(0,max));syncSelection();
  el("board-scroll").scrollTop=incoming.boardScroll;const hand=root.querySelector<HTMLElement>("#hand .cards");if(hand)hand.scrollLeft=incoming.handScroll;
 }
 function language(value:TableLanguage){
  const active=document.activeElement instanceof HTMLElement&&root.contains(document.activeElement)?document.activeElement:null;
  const option=active?.dataset.option,cardId=active?.dataset.card;
  lang=value;power?.language(value);cinema?.language(value);render();
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
 el("discard-pile").addEventListener("click",()=>{const cards=view?.game?.discard,top=cards?.[cards.length-1];if(top)preview(top,true);});
  el("display-mode").addEventListener("click",()=>send({type:"display",mode:deps.mode==="compact"?"full":"compact"}));
 const keydown=(event:KeyboardEvent)=>{keyboardInput(event);if(!event.defaultPrevented&&event.key==="Escape"&&previewId){event.preventDefault();event.stopPropagation();hidePreview();}};root.addEventListener("keydown",keydown);
  el("slap-table").addEventListener("click",publishSlap);
  el("close").addEventListener("click",()=>send({type:"close"}));el("cancel-reset").addEventListener("click",()=>el<HTMLDialogElement>("reset-dialog").close());el("new-game").addEventListener("click",reset);
 el("confirm-reset").addEventListener("click",()=>{el<HTMLDialogElement>("reset-dialog").close();if(view?.isHost&&resetKey===`${view.table?.id}:${view.game?.id}`)send({type:"newGame"});});
 const domHit=(x:number,y:number):StageHit|null=>{const element=document.elementFromPoint(x,y);if(!element||!root.contains(element)||element.closest(".choices [data-option]"))return null;
  const cardEl=element.closest<HTMLElement>("[data-card]"),slot=element.closest<HTMLElement>("[data-drop-zone]");
  if(cardEl){const hand=!!cardEl.closest("#hand");return{kind:hand?"hand":"card",cardId:cardEl.dataset.card!,zone:hand?"hand":slot?.dataset.dropZone==="flight"?"flight":"ante",...(hand?{seatId:privateGame()?.selfSeatId}:slot?{seatId:slot.dataset.dropSeat}:{})};}
  return slot?{kind:"zone",zone:slot.dataset.dropZone as "ante"|"flight",seatId:slot.dataset.dropSeat}:null;};
 const hover=(id:string|null)=>{const next=privateGame()?.hand.some(c=>c.id===id)?id??"":"";if(next!==hoveredHand){hoveredHand=next;publishGesture();syncStage();}if(id&&previewId!==id)inspectCard(id,false);else if(!id&&!previewPinned)leavePreview();};
 const ports={context:dragContext,drop,cancel:stageCancel,inspect:inspectCard,hover};
 power=mountPowerPresentation(root,{language:lang,seatName:id=>id===privateGame()?.selfSeatId?t("you"):seatName(id),onChange:presentationChanged,sound:(kind,key)=>sound?.play(kind,key)});
 cinema=mountRoundPresentation(root,{language:lang,seatName:id=>id===privateGame()?.selfSeatId?t("you"):seatName(id),onChange:presentationChanged,sound:(kind,key)=>sound?.play(kind,key),inspect:id=>inspectCard(id,true)});
 sound=mountTableAudio(root,{onEnabledChange:()=>{if(!destroyed)soundControls();}});
 el("sound-toggle").addEventListener("click",()=>{sound?.setEnabled(!sound.enabled);soundControls();});
  void import("./stage").then(({mountTableStage})=>{if(destroyed)return;stage=mountTableStage(el<HTMLCanvasElement>("table-stage"),{quality:stageQualityMode,onRevealPhase:phase=>{revealPhase=phase;cinema?.pause(!!power?.busy||!!revealPhase);if(!destroyed){renderBanner();if(anteSoundKey&&phase==="revealing")sound?.play('flip',anteSoundKey);if(anteSoundKey&&phase==="payment")sound?.play('coin',anteSoundKey);syncSelection();pumpPresentation();notifyPresentation();}},onQuality:quality=>{stageAvailable=quality.webgl;stageQuality=quality.quality;root.dataset.renderer=stageAvailable?"webgl":"dom";root.dataset.quality=stageQuality;root.dataset.qualityMode=quality.mode??stageQualityMode;if(stageReady&&!destroyed)render();}});stageReady=true;
  // The table may have been suspended by the first-run guide, practice mode
  // or page lifecycle before the deferred Three.js chunk finished loading.
  // Carry that state into the late-created renderer; otherwise a modal can
  // briefly hide an actively rendering canvas and waste the user's GPU.
  if(suspended||document.hidden)stage.suspend();
  syncStage();pumpPresentation();render();}).catch(()=>{if(!destroyed){stageReady=true;stageAvailable=false;root.dataset.renderer="dom";render();}});
 dragController=mountDragController(el("table-stage"),{...ports,hitTest:(x,y)=>{if(!stageAvailable)return null;const point=stage?.dragPoint();return stage?.hitTest(point?.x??x,point?.y??y)??null;},drag:value=>{if(value){pointerLift(value.cardId);hidePreview();}stage?.setDrag(value);}});
 domDragController=mountDragController(root,{...ports,hover:id=>{if(!stageAvailable||compactViewport())hover(id);},hitTest:(x,y)=>{if(stageAvailable&&!compactViewport())return null;const stageHit=stageAvailable?stage?.hitTest(x,y)??null:null;return stageHit??domHit(x,y);},drag:value=>{if(!value)return;pointerLift(value.cardId);const item=[...root.querySelectorAll<HTMLElement>("#hand [data-card]")].find(c=>c.dataset.card===value.cardId);if(item){item.classList.add("dom-dragging");if(!domGhost){domGhost=item.cloneNode(true) as HTMLElement;domGhost.classList.remove("dom-dragging");domGhost.classList.add("dom-drag-ghost");domGhost.setAttribute("aria-hidden","true");domGhost.removeAttribute("tabindex");document.body.append(domGhost);}domGhost.style.left=`${value.x-65}px`;domGhost.style.top=`${value.y-90}px`;}}});
 const motionPreference=()=>{syncStage();};reduced.addEventListener("change",motionPreference);const responsiveViewport=()=>{if(!destroyed)render();};compactMedia.addEventListener("change",responsiveViewport);
 const cancelKeyboard=()=>{if(keyboardHeld)stageCancel();},hideKeyboard=()=>{if(document.hidden){cancelKeyboard();clearPresentation();sound?.suspend();}else if(!suspended){sound?.resume();render();}};
 root.addEventListener("pointerdown",cancelKeyboard,true);window.addEventListener("blur",cancelKeyboard);document.addEventListener("visibilitychange",hideKeyboard);
 render();return {update(value:TableView){if(destroyed)return;const previous=view;updating=true;try{
  const baseline=presentationView;
  const oldSelf=baseline?.game&&"selfSeatId" in baseline.game?baseline.game.selfSeatId:null,newSelf=value.game&&"selfSeatId" in value.game?value.game.selfSeatId:null;
  const same=!!baseline&&baseline.table?.id===value.table?.id&&baseline.table?.hostConnectionId===value.table?.hostConnectionId&&baseline.game?.id===value.game?.id&&oldSelf===newSelf;
  const visible=!suspended&&!document.hidden;
  const live=!!baseline?.connected&&value.connected&&same&&visible;
  const catchingUp=value.syncing===true&&!value.connected&&same&&visible;
  view=value;sending=false;localMessage="";
  // Metadata can arrive before the private projection, and the dealer emits
  // while publishing its durable state. Keep the last usable visual baseline
  // across those updates without enabling input or replaying a reconnect.
  if(!catchingUp){
    const fresh=live?freshPublicEvents(baseline?.game,value.game):[];
    const presentationGap=!live||!!baseline?.game&&!!value.game&&(value.game.revision<baseline.game.revision||value.game.revision>baseline.game.revision+1&&!fresh.length);
    if(presentationGap){clearPresentation();stageGoldFlows=[];}else stageGoldFlows=publicGoldFlows(baseline?.game,value.game).filter(flow=>!fresh.some(event=>event.code==="ANTE_REVEALED")||flow.code!=="PAID_STAKES");
   const cues=live?powerEvents(baseline?.game,value.game):[];
   presentationView=value.connected&&visible?value:null;
   const rounds=live&&baseline?.game&&value.game?roundCues(baseline.game,value.game,fresh):[];
   if((cues.length||rounds.length)&&!power?.busy&&!cinema?.busy)presentationBase=baseline;
   if(cues.length)holdCues(cues);
   cinema?.pause(!!power?.busy||!!revealPhase);if(rounds.length)holdRounds(rounds);
  }
  receiveBannerEvent(previous);noteRoundChange(previous);applyReceipt();pumpPresentation();render();playUpdateSounds(previous);if(!power?.busy&&!cinema?.busy)animateChanges(previous);
 }finally{updating=false;notifyPresentation();}},gesture(seatId:string,value:unknown){if(destroyed)return;if(value===null){stage?.gesture(seatId,null);const entry=gestures.get(seatId);if(entry)clearTimeout(entry.timer);gestures.delete(seatId);paintGestures();return;}const gesture=readHandGesture(value);if(!gesture||seatId===privateGame()?.selfSeatId)return;if(gesture.slap)sound?.play("slap",`slap:${seatId}:${gesture.sequence}`);const old=gestures.get(seatId);if(old&&gesture.sequence<=old.value.sequence)return;stage?.gesture(seatId,gesture);if(old)clearTimeout(old.timer);gestures.set(seatId,{value:gesture,timer:setTimeout(()=>{gestures.delete(seatId);paintGestures();},30000)});paintGestures();},language,restore(value:unknown){if(!touched)pendingDraft=readUIDraft(value);restoreDraft();},draft,
 waitingForReceipt:()=>!!pendingAction,
 presentationBusy:()=>!!power?.busy||!!cinema?.busy||!!revealPhase,
 getAnchor(zone:"hand"|"ownAnte"|"ownFlight"|"stakes"){const own=privateGame(),compact=compactViewport();const query=zone==="hand"?{cardId:own?.hand[0]?.id}:zone==="stakes"?{zone:"stakes" as const}:{zone:zone==="ownAnte"?"ante" as const:"flight" as const,seatId:own?.selfSeatId};const point=stageAvailable?stage?.getAnchor(query):null;if(point?.visible&&!(compact&&zone==="hand"))return new DOMRect(point.x-10,point.y-10,20,20);if(!stageAvailable||compact&&zone==="hand"){const target=zone==="hand"?root.querySelector("#hand [data-card]"):zone==="stakes"?root.querySelector(".counter.stakes"):root.querySelector(`.seat.self [data-drop-zone="${zone==="ownAnte"?"ante":"flight"}"]`);return target?.getBoundingClientRect()??null;}return null;},
 suspend(){suspended=true;sound?.suspend();clearPresentation();stageCancel();hoveredHand="";if(gestureTimer)clearTimeout(gestureTimer);gestureTimer=undefined;lastGesture="";dragController?.cancel();domDragController?.cancel();stage?.suspend();},resume(){suspended=false;sound?.resume();stage?.resume();syncSelection();render();},
  failed(){sending=false;localMessage="requestFailed";if(pendingAction)pendingAction.retryable=true;if(view)view={...view,pending:false,connected:false};clearPresentation();render();},
   destroy(){if(destroyed)return;destroyed=true;pendingAction=null;if(presentTimer)clearTimeout(presentTimer);presentTimer=undefined;pendingCues=[];power?.destroy();cinema?.destroy();sound?.destroy();deferredSounds.clear();clearBannerEvent();clearDomDrag();dragController?.destroy();domDragController?.destroy();stage?.destroy();reactShell.destroy();reduced.removeEventListener("change",motionPreference);compactMedia.removeEventListener("change",responsiveViewport);root.removeEventListener("pointerdown",cancelKeyboard,true);window.removeEventListener("blur",cancelKeyboard);document.removeEventListener("visibilitychange",hideKeyboard);resize.disconnect();if(gestureTimer)clearTimeout(gestureTimer);for(const entry of gestures.values())clearTimeout(entry.timer);for(const a of motion)a.cancel();root.removeEventListener("keydown",keydown);el<HTMLDialogElement>("reset-dialog")?.close();root.replaceChildren();}};
}
