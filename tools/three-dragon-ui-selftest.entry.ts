import {mountTableUI} from "../src/modules/threeDragonAnte/ui";
import {CARDS,createGame,projectSeat,projectPublic,applyAction,eligibleActions} from "../src/modules/threeDragonAnte/rules";
import type {TableView} from "../src/modules/threeDragonAnte/protocol";
import type {TableUICommand,TableDisplayMode} from "../src/modules/threeDragonAnte/ui-command";
import {localViewParts} from "../src/modules/threeDragonAnte/local-view";
const w=window as unknown as Record<string,any>;
w.localViewParts=localViewParts;
const state=createGame({id:"game",seed:42,seats:[{id:"s0",name:"Alice <script>"},{id:"s1",name:"Bob"}]});
const table={version:1 as const,id:"table",hostPlayerId:"p0",hostConnectionId:"conn",hostName:"Alice",stage:"playing" as const,seats:[{playerId:"p0",seatId:"s0",name:"Alice"},{playerId:"p1",seatId:"s1",name:"Bob"}],revision:1};
w.commands=[];w.base={table,selfPlayerId:"p0",isHost:true,connected:true,pending:false,game:projectSeat(state,"s0")} satisfies TableView;
w.publicGame=projectPublic(state);w.otherHand=[...state.seats[1].hand];w.cardIds=CARDS.map(c=>c.id);w.cards=CARDS;
w.ui=mountTableUI(document.getElementById("table-app")!,{language:"en",send:(command:TableUICommand)=>{w.commands.push(command);},id:()=>`ui-action-${w.commands.length+1}`});
w.remount=(mode:TableDisplayMode,view:TableView,draft:unknown)=>{w.ui.destroy();w.ui=mountTableUI(document.getElementById("table-app")!,{language:"en",mode,send:command=>{w.commands.push(command);}});w.ui.restore(draft);w.ui.update(view);};
w.scenario=(count:number,ownTurn=false)=>{
 let game=createGame({id:`visual-${count}`,seed:42,seats:Array.from({length:count},(_,index)=>({id:`s${index}`,name:["Arden","Mira","Jun","Elara","Theo","Neri"][index]}))});
 for(let serial=0;serial<160;serial++){
  if(game.round>=2&&game.stage==="play"&&(!ownTurn||eligibleActions(game,"s0").length))break;
  const seat=game.seats.find(seat=>eligibleActions(game,seat.id).length),a=seat&&eligibleActions(game,seat.id)[0];if(!seat||!a)break;
  const action={id:`visual-action-${serial}`,revision:game.revision,seatId:seat.id,kind:a.kind,...(a.kind==="choose"?{choiceId:a.choice.id,optionIds:a.choice.options.slice(0,a.choice.min).map(option=>option.id)}:{cardId:a.cardIds[0]})};
  const result=applyAction(game,action);if(!result.ok)throw Error(result.error.code);game=result.state;
 }
 const seats=game.seats.map((seat,index)=>({playerId:`p${index}`,seatId:seat.id,name:seat.name}));
 const result={table:{...table,seats},selfPlayerId:"p0",isHost:true,connected:true,pending:false,game:projectSeat(game,"s0")};
 w.otherVisualHand=game.seats.slice(1).flatMap(seat=>seat.hand);w.visualPublic=projectPublic(game);w.set(result);return result;
};
w.set=(view:TableView)=>w.ui.update(view);
w.choice=(code:string,min=1,max=1)=>{const v=structuredClone(w.base);v.game.phase="choice";v.game.choice={id:`choice-${code}`,seatId:"s0",code};v.game.actions=[{kind:"choose",choice:{id:`choice-${code}`,seatId:"s0",code,min,max,beneficiarySeatId:"s1",sourceCardId:"brass-sultan",options:[{id:"c1",cardId:"gold-13"},{id:"c2",cardId:"black-9"},{id:"s1",seatId:"s1"},{id:"skip",code:"SKIP_POWER"}]}}];return v;};
