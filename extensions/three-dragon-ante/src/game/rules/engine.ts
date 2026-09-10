import {card, CARDS, COLORS, EVIL_COLORS, SPECIAL_CARDS, STANDARD_CARDS} from "./cards";
import type {ActionResult, Choice, ChoiceOption, EffectKind, FlightCard, GameAction, GameConfig, GameState, RandomSource, Task, ScoreReport} from "./types";

const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const around=(s:GameState,seat:number,includeSelf=false)=>Array.from({length:s.seats.length-(includeSelf?0:1)},(_,i)=>(seat+i+(includeSelf?0:1))%s.seats.length);
const right=(s:GameState,seat:number)=>(seat+s.seats.length-1)%s.seats.length;
const event=(s:GameState,code:string,seat?:number,cardIds?:string[],amount?:number,target?:number)=>{
  s.events.push({code,...(seat===undefined?{}:{seatId:s.seats[seat].id}),...(target===undefined?{}:{targetSeatId:s.seats[target].id}),...(cardIds?{cardIds}:{}),...(amount===undefined?{}:{amount})});
  if(s.events.length>100)s.events.splice(0,s.events.length-100);
};
function issue(s:GameState,code:string){s.issue=code;s.stage="adjudication";s.pending=null;event(s,code);}
function int(s:GameState,upper:number,rng?:RandomSource):number {
  if(upper<1)throw Error("Invalid random bound");
  let value:number;
  if(rng)value=rng.int(upper);
  else if(s.randomState!==undefined){let x=s.randomState||0x9e3779b9;x^=x<<13;x^=x>>>17;x^=x<<5;s.randomState=x>>>0;value=Math.floor((s.randomState/4294967296)*upper);}
  else {const values=new Uint32Array(1),limit=Math.floor(4294967296/upper)*upper;do{crypto.getRandomValues(values);}while(values[0]>=limit);value=values[0]%upper;}
  if(!Number.isInteger(value)||value<0||value>=upper)throw Error("Invalid random source");return value;
}
function shuffle(s:GameState,ids:string[],rng?:RandomSource):string[]{const result=[...ids];for(let i=result.length-1;i>0;i--){const j=int(s,i+1,rng);[result[i],result[j]]=[result[j],result[i]];}return result;}
function top(s:GameState,rng?:RandomSource):string|null {
  if(!s.deck.length&&s.discard.length){s.deck=shuffle(s,s.discard,rng);s.discard=[];event(s,"DECK_RESHUFFLED");}
  if(!s.deck.length){issue(s,"RULE_DECK_AND_DISCARD_EMPTY");return null;}
  const id=s.deck.shift()!;
  // Page 11 says to reshuffle when the deck runs out, not at the next draw.
  // Later discards must not enter this already prepared next deck.
  if(!s.deck.length&&s.discard.length){s.deck=shuffle(s,s.discard,rng);s.discard=[];event(s,"DECK_RESHUFFLED");}
  return id;
}
function draw(s:GameState,seat:number,count:number,rng?:RandomSource){for(let i=0;i<count&&s.seats[seat].hand.length<10;i++){const id=top(s,rng);if(!id)return;s.seats[seat].hand.push(id);}}
function pay(s:GameState,from:number,to:number|"stakes",amount:number){
  const payer=s.seats[from],paid=Math.min(payer.gold,amount);payer.gold-=paid;payer.debt+=amount-paid;
  if(to==="stakes")s.stakes+=paid;else s.seats[to].gold+=paid;
  event(s,to==="stakes"?"PAID_STAKES":"PAID_PLAYER",from,undefined,paid,typeof to==="number"?to:undefined);
}
function steal(s:GameState,seat:number,amount:number){const taken=Math.min(s.stakes,amount);s.stakes-=taken;s.seats[seat].gold+=taken;event(s,"TOOK_STAKES",seat,undefined,taken);if(!s.stakes)emptyStakes(s);}
function takeHand(s:GameState,from:number,to:number,id:string,reveal:boolean){
  if(reveal)event(s,"CARD_REVEALED",from,[id]);
  if(s.seats[to].hand.length>=10)return;
  const index=s.seats[from].hand.indexOf(id);if(index<0)return;s.seats[from].hand.splice(index,1);s.seats[to].hand.push(id);
  event(s,"CARD_TRANSFERRED",from,undefined,1,to);
}
function randomHand(s:GameState,from:number,to:number,rng?:RandomSource){const hand=s.seats[from].hand;if(hand.length&&s.seats[to].hand.length<10)takeHand(s,from,to,hand[int(s,hand.length,rng)],false);}
const location=(s:GameState,id:string)=>{for(let seat=0;seat<s.seats.length;seat++){const index=s.seats[seat].flight.findIndex(item=>item.cardId===id);if(index>=0)return {seat,index,item:s.seats[seat].flight[index]};}return null;};
function removeFlight(s:GameState,id:string):{seat:number;index:number}|null {const found=location(s,id);if(!found)return null;s.seats[found.seat].flight.splice(found.index,1);for(let i=0;i<s.roundCards.length;i++)if(s.roundCards[i]===id)s.roundCards[i]=null;s.discard.push(id);return found;}
function replace(s:GameState,old:string,next:string):boolean {
  const found=location(s,old);if(!found)return false;
  s.seats[found.seat].flight[found.index]={cardId:next};s.discard.push(old);
  for(let i=0;i<s.roundCards.length;i++)if(s.roundCards[i]===old)s.roundCards[i]=next;
  event(s,"FLIGHT_REPLACED",found.seat,[old,next]);return true;
}
function replaceFromDeck(s:GameState,old:string,rng?:RandomSource):string|null {
  const found=location(s,old);if(!found)return null;
  // Copper discards before drawing (p18). An exhausted deck must therefore
  // include this discarded card in the reshuffle, even if it reappears.
  s.discard.push(old);const next=top(s,rng);if(!next)return null;
  s.seats[found.seat].flight[found.index]={cardId:next};
  for(let i=0;i<s.roundCards.length;i++)if(s.roundCards[i]===old)s.roundCards[i]=next;
  event(s,"FLIGHT_REPLACED",found.seat,[old,next]);return next;
}
function effect(s:GameState,kind:EffectKind,seat:number,source:string){
  // Delayed numerical rewards/costs accrue per trigger. Rule-changing effects
  // are idempotent, and Merchant Prince's beneficiary follows its card.
  const existing=kind==="monarch"||kind==="dracolich"?undefined:s.effects.find(e=>e.kind===kind&&e.source===source&&(kind==="merchant"||e.seat===seat));
  if(existing)existing.seat=seat;else s.effects.push({kind,seat,source});
}
const hasAlignment=(s:GameState,seat:number,alignment:string)=>s.seats[seat].flight.some(f=>card(f.cardId).alignment===alignment);
export function cardStrength(s:GameState,seat:number,f:FlightCard,scoring=false):number {
  if(scoring&&f.rider){const dragons=s.seats[seat].flight.filter(other=>card(other.cardId).alignment!=="mortal");return dragons.length?Math.min(...dragons.map(other=>card(other.cardId).strength)):0;}
  return card(f.cardId).strength;
}
export function flightStrength(s:GameState,seat:number,scoring=false):number {
  let total=s.seats[seat].flight.reduce((sum,f)=>sum+cardStrength(s,seat,f,scoring),0);
  if(scoring)total+=s.effects.filter(e=>e.kind==="dracolich"&&e.seat===seat).length*2*s.seats[seat].flight.filter(f=>card(f.cardId).alignment==="evil").length;
  return total;
}
function candidateWinners(s:GameState):number[]{
  const eligible=s.seats.map((_,i)=>i).filter(i=>{
    const ids=s.seats[i].flight.map(f=>f.cardId);
    return !(ids.includes("bahamut")&&hasAlignment(s,i,"evil"))&&!(ids.includes("tiamat")&&hasAlignment(s,i,"good"));
  });
  if(!eligible.length)return [];
  const values=eligible.map(i=>flightStrength(s,i,true));const best=s.effects.some(e=>e.kind==="druid")?Math.min(...values):Math.max(...values);
  return eligible.filter(i=>flightStrength(s,i,true)===best);
}
function highestUntied(values:(number|null)[]):number|null {const unique=values.map((value,index)=>({value,index})).filter(({value})=>value!==null&&values.filter(v=>v===value).length===1).sort((a,b)=>b.value!-a.value!);return unique[0]?.index??null;}
const addFront=(s:GameState,...tasks:Task[])=>s.queue.unshift(...tasks);
const choiceCards=(ids:string[]):ChoiceOption[]=>ids.map(id=>({id,cardId:id}));
function choose(s:GameState,seat:number,code:string,options:ChoiceOption[],task:Task,min=1,max=1){
  if(!options.length)return;
  s.pending={id:`${s.gambit}:${++s.choiceSerial}`,seatId:s.seats[seat].id,code,options,min,max,task,beneficiarySeatId:s.seats[task.seat].id,...(task.source?{sourceCardId:task.source}:{})};s.stage="resolve";
}
function power(s:GameState,seat:number,source:string,family=card(source).family){addFront(s,{kind:"power",seat,source,family});}
function autoBuy(s:GameState,seat:number,rng?:RandomSource){
  const price=top(s,rng);if(!price)return;s.discard.push(price);event(s,"BUY_PRICE",seat,[price],card(price).strength);
  const merchant=s.effects.find(e=>e.kind==="merchant");pay(s,seat,merchant?merchant.seat:"stakes",card(price).strength);draw(s,seat,4-s.seats[seat].hand.length,rng);
}
function startTurn(s:GameState,rng?:RandomSource){s.stage="play";if(s.seats[s.active].hand.length<=1)autoBuy(s,s.active,rng);}
function emptyStakes(s:GameState){
  // Revealed Sorcerer leftovers are physically reserved by continuations.
  // An immediate end skips their ante step, but must still discard the cards.
  for(const task of s.queue)if(task.kind==="sorcerer-ante")s.discard.push(...task.ids!);
  s.queue=[];s.pending=null;s.revealed=[];
  // The immediate end rule outranks unfinished powers, purchases and bonuses.
  addFront(s,{kind:"award",seat:s.active,mode:"empty-stakes"});s.stage="resolve";
}
function nextRound(s:GameState,rng?:RandomSource){
  const next=highestUntied(s.roundCards.map(id=>id?card(id).strength:null));if(next!==null)s.leader=next;
  s.round++;s.active=s.leader;s.turnIndex=0;s.roundCards=s.seats.map(()=>null);s.scoring=false;startTurn(s,rng);
}
function beginAnte(s:GameState,rng?:RandomSource){
  s.stage="ante";s.round=0;s.committed={};s.ante=[];s.anteOrigins=[];s.roundCards=s.seats.map(()=>null);s.effects=[];s.scoring=false;
  for(const seat of s.seats){seat.flight=[];seat.rewards=[];seat.archmage=false;}
  // No voluntary buying at ante; normal end-of-gambit draws supply these cards.
  if(s.seats.some(seat=>!seat.hand.length))issue(s,"RULE_EMPTY_HAND_AT_ANTE");
}
function resolveAnte(s:GameState,rng?:RandomSource){
  const ids=s.seats.map(seat=>s.committed[seat.id]);s.ante=[...ids];s.anteOrigins=s.seats.map((seat,index)=>({seatId:seat.id,cardId:ids[index]}));s.committed={};event(s,"ANTE_REVEALED",undefined,ids);
  const lead=highestUntied(ids.map(id=>card(id).strength));
  if(lead===null){s.discard.push(...s.ante);s.ante=[];s.anteOrigins=[];event(s,"ANTE_ALL_TIED");for(let i=0;i<s.seats.length;i++)draw(s,i,1,rng);if(s.stage!=="adjudication")s.stage="ante";return;}
  const price=Math.max(...ids.map(id=>card(id).strength));for(let i=0;i<s.seats.length;i++)pay(s,i,"stakes",price);
  s.leader=lead;s.active=lead;s.round=1;s.turnIndex=0;startTurn(s,rng);if(!s.stakes)emptyStakes(s);
}
function colors(f:FlightCard):string[]{if(f.wild)return [...COLORS,"mortal"];const c=card(f.cardId);if(c.id==="tiamat")return [...EVIL_COLORS];if(c.alignment==="mortal")return ["mortal"];return c.color?[c.color]:[];}
function nextReward(s:GameState,seat:number):{key:string;amount:number;kind:"color"|"strength"}|null {
  const f=s.seats[seat].flight;
  for(const color of [...COLORS,"mortal"]){const matching=f.filter(item=>colors(item).includes(color));const key=`color:${color}`;
    if(matching.length>=3&&!s.seats[seat].rewards.includes(key))return {key,kind:"color",amount:matching.map(item=>cardStrength(s,seat,item,s.scoring)).sort((a,b)=>b-a)[1]};}
  for(const value of [...new Set(f.map(item=>cardStrength(s,seat,item,s.scoring)))].sort((a,b)=>a-b)){
    const key=`strength:${value}`;if(f.filter(item=>cardStrength(s,seat,item,s.scoring)===value).length>=3&&!s.seats[seat].rewards.includes(key))return {key,kind:"strength",amount:value};}
  return null;
}
/** Capture only already-public cards before cleanup, including rider values and
 * accumulated Dracolich bonuses. Clients never reconstruct these from a later
 * snapshot that has already discarded the flights. */
function reportScore(s:GameState,reason:ScoreReport["reason"],winners:number[]){
 const finished=reason==="round-complete"||reason==="empty-stakes",split=s.effects.some(e=>e.kind==="priest");
 const score:ScoreReport={gambit:s.gambit,round:s.round,reason,weakest:s.effects.some(e=>e.kind==="druid"),stakes:s.stakes,
  rows:s.seats.map((seat,i)=>{const cards=seat.flight.map(f=>({cardId:f.cardId,points:cardStrength(s,i,f,true)}));const total=flightStrength(s,i,true);
   const eligible=!(seat.flight.some(f=>f.cardId==="bahamut")&&hasAlignment(s,i,"evil"))&&!(seat.flight.some(f=>f.cardId==="tiamat")&&hasAlignment(s,i,"good"));
   return {seatId:seat.id,cards,total,bonus:total-cards.reduce((sum,c)=>sum+c.points,0),eligible};}),
  winners:finished?winners.map(i=>s.seats[i].id):[],payouts:finished?winners.flatMap(i=>[{seatId:s.seats[i].id,amount:split?Math.ceil(s.stakes/2):s.stakes},...(split?[{seatId:s.seats[(i+1)%s.seats.length].id,amount:Math.floor(s.stakes/2)}]:[])]):[]};
 event(s,"GAMBIT_SCORED");s.events[s.events.length-1].score=score;
}
function award(s:GameState,reason:"round-complete"|"empty-stakes",rng?:RandomSource){
  const winners=candidateWinners(s);
  if(!winners.length){issue(s,"RULE_NO_ELIGIBLE_GAMBIT_WINNER");return;}
  if(winners.length!==1){issue(s,"RULE_EMPTY_STAKES_TIE");return;}
  reportScore(s,reason,winners);
  const winner=winners[0],stakes=s.stakes;const split=s.effects.some(e=>e.kind==="priest");
  s.seats[winner].gold+=split?Math.ceil(stakes/2):stakes;
  if(split)s.seats[(winner+1)%s.seats.length].gold+=Math.floor(stakes/2);
  s.stakes=0;
  s.lastGambit={number:s.gambit,winners:[s.seats[winner].id],reason,strengths:Object.fromEntries(s.seats.map((seat,i)=>[seat.id,flightStrength(s,i,true)])),stakes};
  for(const e of s.effects.filter(e=>e.kind==="monarch"&&e.seat===winner))for(const opponent of around(s,winner))pay(s,winner,opponent,3);
  for(const seat of s.seats){s.discard.push(...seat.flight.map(f=>f.cardId));seat.flight=[];const paid=Math.min(seat.gold,seat.debt);seat.gold-=paid;s.hole+=paid;seat.debt=0;}
  s.discard.push(...s.ante);s.ante=[];s.anteOrigins=[];s.effects=[];s.queue=[];s.pending=null;s.revealed=[];s.scoring=false;
  event(s,"GAMBIT_WON",winner,undefined,stakes);
  if(s.seats.some(seat=>seat.gold===0)){
    const most=Math.max(...s.seats.map(seat=>seat.gold));const won=s.seats.map((seat,i)=>({seat,i})).filter(({seat})=>seat.gold===most);
    s.winners=won.map(({seat})=>seat.id);const each=Math.floor(s.hole/won.length),rest=s.hole%won.length;
    for(const {seat} of won)seat.gold+=each;s.hole=rest;s.stage="ended";
    if(rest){issue(s,"RULE_TIED_WINNERS_ODD_HOLE_COIN");}else event(s,"GAME_ENDED");return;
  }
  for(const seat of around(s,winner,true))draw(s,seat,2,rng);
  if(s.stage==="adjudication")return;s.gambit++;beginAnte(s,rng);
}

function executePower(s:GameState,t:Task,rng?:RandomSource){
  const seat=t.seat,source=t.source!,family=t.family!,self=s.seats[seat],strength=card(source).strength;
  event(s,"POWER_TRIGGERED",seat,[source]);
  if(family!==card(source).family)s.events[s.events.length-1].effectFamily=family;
  const opponents=around(s,seat);
  switch(family){
    case "black":steal(s,seat,3);break;
    case "thief":steal(s,seat,7);break;
    case "black-raider":
      steal(s,seat,1);if(s.stakes)opponents.forEach((target,i)=>pay(s,target,seat,i+2));break;
    case "blue":case "blue-overlord":choose(s,seat,"BLUE_DESTINATION",[{id:"hoard",code:"TAKE_GOLD"},{id:"stakes",code:"INCREASE_STAKES"}],{...t,kind:"blue",amount:family==="blue"?1:2});break;
    case "brass":case "brass-sultan":case "green":case "green-schemer":{
      const good=family.startsWith("brass"),targets=family==="brass-sultan"||family==="green-schemer"?[(seat+1)%s.seats.length,right(s,seat)]:[good?right(s,seat):(seat+1)%s.seats.length];
      addFront(s,...targets.map(target=>({kind:"demand",seat,source,target,mode:good?"good":"evil",amount:strength,flag:family==="green-schemer"})));break;
    }
    case "bronze":case "bronze-warlord":
      if(family==="bronze-warlord")effect(s,"warlord",seat,source);
      addFront(s,{kind:"bronze",seat,source,ids:[],amount:Math.min(2,s.ante.length)});break;
    case "copper":{const next=replaceFromDeck(s,source,rng);if(next)power(s,seat,next);break;}
    case "copper-trickster":choose(s,seat,"REPLACE_OTHER_FLIGHT_CARD",choiceCards(self.flight.filter(f=>f.cardId!==source).map(f=>f.cardId)),{...t,kind:"trickster"});break;
    case "chromatic-wyrmling":case "metallic-wyrmling":{
      const alignment=family==="chromatic-wyrmling"?"evil":"good";
      const eligible=self.hand.filter(id=>card(id).alignment===alignment);
      if(eligible.length)choose(s,seat,"REPLACE_WYRMLING",[{id:"skip",code:"KEEP_CARD"},...choiceCards(eligible)],{...t,kind:"wyrmling"});break;
    }
    case "gold":case "gold-monarch":draw(s,seat,self.flight.filter(f=>card(f.cardId).alignment==="good").length,rng);if(family==="gold-monarch")effect(s,"monarch",seat,source);break;
    case "silver":case "silver-seer":
      for(const target of around(s,seat,true))if(hasAlignment(s,target,"good"))draw(s,target,1,rng);
      if(family==="silver-seer")addFront(s,{kind:"seer",seat,source});break;
    case "white":case "red":case "red-destroyer":{
      const values=opponents.map(i=>flightStrength(s,i)),best=family==="white"?Math.min(...values):Math.max(...values);
      const targets=opponents.filter(i=>flightStrength(s,i)===best);
      choose(s,seat,family==="white"?"WEAKEST_OPPONENT":"STRONGEST_OPPONENT",targets.map(i=>({id:s.seats[i].id,seatId:s.seats[i].id})),{...t,kind:"take-opponent",amount:family==="white"?2:family==="red"?1:10,flag:family!=="white"});break;
    }
    case "white-hunter":for(const target of opponents)if(flightStrength(s,target)<flightStrength(s,seat))pay(s,target,seat,3);break;
    case "bahamut":case "queen":for(const target of opponents)if(hasAlignment(s,target,"good")&&hasAlignment(s,target,"evil")){pay(s,target,seat,family==="bahamut"?10:5);if(family==="queen")randomHand(s,target,seat,rng);}break;
    case "tiamat":break;
    case "archmage":self.archmage=true;break;
    case "dracolich":effect(s,"dracolich",seat,source);break;
    case "druid":effect(s,"druid",seat,source);break;
    case "priest":effect(s,"priest",seat,source);break;
    case "merchant-prince":effect(s,"merchant",seat,source);break;
    case "dragonrider":{const f=location(s,source);if(f)f.item.rider=true;break;}
    case "wyrmpriest":{const f=location(s,source);if(f)f.item.wild=true;break;}
    case "dragonslayer":choose(s,seat,"REMOVE_WEAKER_DRAGON",choiceCards(s.seats.flatMap(p=>p.flight.filter(f=>card(f.cardId).alignment!=="mortal"&&card(f.cardId).strength<strength).map(f=>f.cardId))),{...t,kind:"slayer"});break;
    case "fool":draw(s,seat,opponents.filter(i=>flightStrength(s,i)>flightStrength(s,seat)).length,rng);break;
    case "kobold":if(self.hand.length)choose(s,seat,"EXCHANGE_HAND_CARDS",choiceCards(self.hand),{...t,kind:"kobold"},0,self.hand.length);break;
    case "illusionist":{
      const eligible=opponents.flatMap(i=>s.seats[i].flight.filter(f=>card(f.cardId).alignment==="mortal").map(f=>f.cardId));
      if(eligible.length)choose(s,seat,"SWAP_MORTAL",[{id:"skip",code:"KEEP_CARD"},...choiceCards(eligible)],{...t,kind:"illusionist"});break;
    }
    case "princess":addFront(s,{kind:"princess",seat,source,ids:self.flight.filter(f=>card(f.cardId).alignment==="good").map(f=>f.cardId)});break;
    case "prophet":{
      const eligible=self.hand.filter(id=>card(id).alignment!=="mortal");
      if(eligible.length)choose(s,seat,"COPY_HAND_DRAGON",[{id:"skip",code:"DO_NOT_COPY"},...choiceCards(eligible)],{...t,kind:"prophet"});break;
    }
    case "sorcerer":{
      const ids:string[]=[];for(let i=0;i<3;i++){const id=top(s,rng);if(!id){s.deck.unshift(...ids);return;}ids.push(id);}s.revealed.push(...ids);event(s,"CARDS_REVEALED",seat,ids);
      choose(s,seat,"SORCERER_REPLACEMENT",choiceCards(ids),{...t,kind:"sorcerer",ids});break;
    }
    default:throw Error(`Unimplemented family: ${family}`);
  }
}

function runTask(s:GameState,t:Task,rng?:RandomSource){
  const seat=t.seat,self=s.seats[seat];
  switch(t.kind){
    case "power":executePower(s,t,rng);break;
    case "sorcerer-ante":s.ante.push(...t.ids!);s.revealed=s.revealed.filter(id=>!t.ids!.includes(id));break;
    case "demand":{
      const eligible=s.seats[t.target!].hand.filter(id=>card(id).alignment===t.mode&&(t.mode==="good"||t.flag?card(id).strength>t.amount!:card(id).strength<t.amount!));
      choose(s,t.target!,"GIVE_DRAGON_OR_GOLD",[{id:"pay",code:"PAY_FIVE"},...choiceCards(eligible)],t);break;
    }
    case "bronze":{
      if(self.hand.length>=10||!t.amount)return;
      const remaining=s.ante.filter(id=>!t.ids!.includes(id));
      if(t.ids!.length<t.amount&&remaining.length){const low=Math.min(...remaining.map(id=>card(id).strength));choose(s,seat,"LOWEST_ANTE_CARD",choiceCards(remaining.filter(id=>card(id).strength===low)),t);}
      else if(self.hand.length+t.ids!.length>10)choose(s,seat,"KEEP_ONE_ANTE_CARD",choiceCards(t.ids!),{...t,kind:"bronze-keep",ids:t.ids});
      else {for(const id of t.ids!){s.ante.splice(s.ante.indexOf(id),1);self.hand.push(id);}}break;
    }
    case "seer":{
      const ids:string[]=[];for(let i=0;i<3;i++){const id=top(s,rng);if(!id){s.deck.unshift(...ids);return;}ids.push(id);}
      choose(s,seat,self.hand.length>=10?"SEER_HAND_FULL_KEEP_TOP":"KEEP_SEER_CARD",choiceCards(ids),{...t,kind:"seer-keep",ids});break;
    }
    case "princess":{
      const ids=t.ids!.filter(id=>location(s,id)?.seat===seat);
      if(ids.length)choose(s,seat,"NEXT_GOOD_DRAGON_POWER",choiceCards(ids),{...t,ids});break;
    }
    case "rewards":{
      const reward=nextReward(s,seat);
      if(!reward)return;self.rewards.push(reward.key);event(s,"SPECIAL_FLIGHT",seat,undefined,reward.amount);
      addFront(s,t);
      if(reward.kind==="color")for(const opponent of around(s,seat))pay(s,opponent,seat,reward.amount);
      else {steal(s,seat,reward.amount);if(s.stakes)addFront(s,{kind:"strength-ante",seat,amount:Math.min(2,s.ante.length,10-self.hand.length)});}break;
    }
    case "strength-ante":if(t.amount!>0&&s.ante.length&&self.hand.length<10)choose(s,seat,"STRENGTH_FLIGHT_ANTE",choiceCards(s.ante),t);break;
    case "buy-empty":for(const target of around(s,seat,true))if(!s.seats[target].hand.length){autoBuy(s,target,rng);if(s.stage==="adjudication")return;}break;
    case "end-turn":
      s.turnIndex++;
      if(s.turnIndex<s.seats.length){s.active=(s.active+1)%s.seats.length;startTurn(s,rng);}
      else if(s.round<3)nextRound(s,rng);
      else {s.scoring=true;addFront(s,...around(s,s.active,true).map(seat=>({kind:"rewards",seat})),{kind:"score",seat});}break;
    case "score":{
      const winners=candidateWinners(s);
      if(!winners.length){issue(s,"RULE_NO_ELIGIBLE_GAMBIT_WINNER");return;}
      if(winners.length>1||(s.round===3&&s.effects.some(e=>e.kind==="warlord"&&e.seat!==winners[0]))){reportScore(s,winners.length>1?"tied":"warlord",winners);nextRound(s,rng);break;}
      award(s,"round-complete",rng);break;
    }
    case "award":s.scoring=true;award(s,"empty-stakes",rng);break;
    default:throw Error(`Unknown task: ${t.kind}`);
  }
}

function resolveChoice(s:GameState,ids:string[],rng?:RandomSource){
  const pending=s.pending!,t=pending.task,seat=t.seat,self=s.seats[seat],id=ids[0];s.pending=null;
  switch(t.kind){
    case "blue":for(const target of around(s,seat))pay(s,target,id==="hoard"?seat:"stakes",t.amount!*(id==="hoard"?1:self.flight.length));break;
    case "demand":if(id==="pay")pay(s,t.target!,seat,5);else takeHand(s,t.target!,seat,id,true);break;
    case "bronze":addFront(s,{...t,ids:[...t.ids!,id]});break;
    case "bronze-keep":s.ante.splice(s.ante.indexOf(id),1);self.hand.push(id);break;
    case "strength-ante":s.ante.splice(s.ante.indexOf(id),1);self.hand.push(id);addFront(s,{...t,amount:t.amount!-1});break;
    case "take-opponent":{const target=s.seats.findIndex(p=>p.id===id);pay(s,target,seat,t.amount!);if(t.flag)randomHand(s,target,seat,rng);break;}
    case "slayer":removeFlight(s,id);event(s,"DRAGON_REMOVED",seat,[id]);break;
    case "wyrmling":if(id!=="skip"){self.hand.splice(self.hand.indexOf(id),1);if(replace(s,t.source!,id))power(s,seat,id);}break;
    case "trickster":{const next=replaceFromDeck(s,id,rng);if(next){if(self.archmage)power(s,seat,next);else choose(s,seat,"TRIGGER_REPLACEMENT",[{id:"trigger",code:"TRIGGER_POWER"},{id:"skip",code:"SKIP_POWER"}],{kind:"trickster-trigger",seat,source:next});}break;}
    case "trickster-trigger":if(id==="trigger")power(s,seat,t.source!);break;
    case "kobold":for(const id of ids){self.hand.splice(self.hand.indexOf(id),1);s.discard.push(id);}draw(s,seat,ids.length,rng);break;
    case "illusionist":if(id!=="skip"){
      const here=location(s,t.source!),there=location(s,id);
      if(here&&there){[s.seats[here.seat].flight[here.index],s.seats[there.seat].flight[there.index]]=[there.item,here.item];
        for(let i=0;i<s.roundCards.length;i++){if(s.roundCards[i]===t.source!)s.roundCards[i]=id;else if(s.roundCards[i]===id)s.roundCards[i]=t.source!;}
        for(const e of s.effects)if(e.kind==="merchant"&&e.source===id)e.seat=seat;
        event(s,"MORTALS_SWAPPED",seat,[t.source!,id],undefined,there.seat);power(s,seat,id);
      }
    }break;
    case "princess":addFront(s,{...t,ids:t.ids!.filter(value=>value!==id)});power(s,seat,id);break;
    case "prophet":if(id!=="skip"){event(s,"CARD_REVEALED",seat,[id]);power(s,seat,t.source!,card(id).family);}break;
    case "seer-keep":if(self.hand.length<10)self.hand.push(id);else s.deck.unshift(id);s.discard.push(...t.ids!.filter(value=>value!==id));break;
    case "sorcerer":{
      // Page 23: replace, resolve the new power completely, then add leftovers
      // to the ante. Nested powers must not see these cards there prematurely.
      s.revealed=s.revealed.filter(value=>value!==id);
      addFront(s,{kind:"sorcerer-ante",seat,ids:t.ids!.filter(value=>value!==id)});
      if(replace(s,t.source!,id))power(s,seat,id);break;
    }
    default:throw Error(`Unknown choice task: ${t.kind}`);
  }
}
function drain(s:GameState,rng?:RandomSource){let steps=0;while(s.queue.length&&!s.pending&&s.stage!=="ended"&&s.stage!=="adjudication"){
  if(++steps>2048){issue(s,"RULE_UNBOUNDED_EFFECT_CHAIN");return;}runTask(s,s.queue.shift()!,rng);
}}

export function createGame(config:GameConfig,rng?:RandomSource):GameState {
  if(!config||typeof config.id!=="string"||!config.id||!Array.isArray(config.seats)||config.seats.length<2||config.seats.length>6||new Set(config.seats.map(seat=>seat.id)).size!==config.seats.length||config.seats.some(seat=>!seat.id||typeof seat.id!=="string"||typeof seat.name!=="string"))throw Error("INVALID_CONFIG");
  if(config.specialIds&&(config.specialIds.length!==10||new Set(config.specialIds).size!==10||config.specialIds.some(id=>!SPECIAL_CARDS.some(c=>c.id===id))))throw Error("INVALID_CONFIG");
  if(config.seed!==undefined&&(!Number.isInteger(config.seed)||config.seed<0||config.seed>4294967295))throw Error("INVALID_CONFIG");
  if(config.startingGold!==undefined&&(!Number.isInteger(config.startingGold)||config.startingGold<10||config.startingGold>1000)||config.startingHand!==undefined&&(!Number.isInteger(config.startingHand)||config.startingHand<3||config.startingHand>10))throw Error("INVALID_CONFIG");
  const s:GameState={version:1,id:config.id,revision:0,seats:config.seats.map(seat=>({...seat,gold:config.startingGold??config.seats.length*10,debt:0,hand:[],flight:[],rewards:[],archmage:false})),stage:"ante",deck:[],discard:[],excluded:[],committed:{},ante:[],stakes:0,hole:0,gambit:1,round:0,leader:0,active:0,turnIndex:0,roundCards:config.seats.map(()=>null),effects:[],queue:[],pending:null,choiceSerial:0,events:[],revealed:[],accepted:{},...(config.seed===undefined?{}:{randomState:config.seed}),lastGambit:null,winners:[],issue:null,scoring:false};
  s.initialGold=(config.startingGold??config.seats.length*10)*config.seats.length;
  const specials=config.specialIds??shuffle(s,SPECIAL_CARDS.map(c=>c.id),rng).slice(0,10);s.excluded=SPECIAL_CARDS.map(c=>c.id).filter(id=>!specials.includes(id));
  s.deck=shuffle(s,[...STANDARD_CARDS.map(c=>c.id),...specials],rng);for(let round=0;round<(config.startingHand??6);round++)for(let seat=0;seat<s.seats.length;seat++)draw(s,seat,1,rng);
  return s;
}
function fingerprint(action:GameAction):string{return JSON.stringify([action.seatId,action.revision,action.kind,action.cardId??null,action.choiceId??null,action.optionIds??null]);}
export function applyAction(state:GameState,action:GameAction,rng?:RandomSource):ActionResult {
  const fail=(code:import("./types").ErrorCode):ActionResult=>({ok:false,error:{code}});
  if(!action||typeof action.id!=="string"||!action.id||action.id.length>128||!Number.isInteger(action.revision)||typeof action.seatId!=="string")return fail("INVALID_ACTION");
  const seat=state.seats.findIndex(p=>p.id===action.seatId);if(seat<0)return fail("UNKNOWN_SEAT");
  const print=fingerprint(action),accepted=Object.prototype.hasOwnProperty.call(state.accepted,action.id)?state.accepted[action.id]:undefined;
  if(accepted)return accepted.fingerprint===print?{ok:true,state,duplicate:true}:fail("ACTION_ID_CONFLICT");
  if(action.revision!==state.revision)return fail("STALE_REVISION");
  if(state.stage==="ended")return fail("GAME_ENDED");if(state.stage==="adjudication")return fail("ADJUDICATION_REQUIRED");
  if(state.pending){
    if(state.pending.seatId!==action.seatId)return fail("NOT_YOUR_TURN");
    if(action.kind!=="choose"||action.choiceId!==state.pending.id||!Array.isArray(action.optionIds)||action.optionIds.length<state.pending.min||action.optionIds.length>state.pending.max||new Set(action.optionIds).size!==action.optionIds.length||action.optionIds.some(id=>!state.pending!.options.some(option=>option.id===id)))return fail("INVALID_CHOICE");
  }else {
    if(action.kind!=="ante"&&action.kind!=="play")return fail("INVALID_ACTION");
    if(state.stage==="ante"?(action.kind!=="ante"||Object.prototype.hasOwnProperty.call(state.committed,action.seatId)):(state.stage!=="play"||action.kind!=="play"||state.active!==seat))return fail("NOT_YOUR_TURN");
    if(typeof action.cardId!=="string"||!state.seats[seat].hand.includes(action.cardId))return fail("CARD_NOT_AVAILABLE");
  }
  const s=copy(state);s.revision++;
  if(s.pending)resolveChoice(s,action.optionIds!,rng);
  else {
    const id=action.cardId!;s.seats[seat].hand.splice(s.seats[seat].hand.indexOf(id),1);
    if(action.kind==="ante"){
      Object.defineProperty(s.committed,action.seatId,{value:id,writable:true,enumerable:true,configurable:true});
      if(Object.keys(s.committed).length===s.seats.length)resolveAnte(s,rng);
    }else {
      const previous=s.roundCards[right(s,seat)];s.seats[seat].flight.push({cardId:id});s.roundCards[seat]=id;s.stage="resolve";
      event(s,"CARD_PLAYED",seat,[id]);
      addFront(s,...around(s,seat,true).map(seat=>({kind:"rewards",seat})),{kind:"buy-empty",seat},{kind:"end-turn",seat});
      if(s.turnIndex===0||s.seats[seat].archmage||(previous!==null&&card(id).strength<=card(previous).strength))power(s,seat,id);
    }
  }
  drain(s,rng);Object.defineProperty(s.accepted,action.id,{value:{fingerprint:print,revision:s.revision},writable:true,enumerable:true,configurable:true});return {ok:true,state:s,duplicate:false};
}

/** The engine intentionally has no general pass/buy action. Choices may permit
 * skipping an optional power; mandatory draws/payments resolve automatically. */
export function eligibleActions(state:GameState,seatId:string):import("./types").EligibleAction[]{
  const seat=state.seats.findIndex(s=>s.id===seatId);if(seat<0||state.stage==="ended"||state.stage==="adjudication")return [];
  if(state.pending){if(state.pending.seatId!==seatId)return [];const {task,...choice}=state.pending;return [{kind:"choose",choice:copy(choice)}];}
  if(state.stage==="ante"&&!Object.prototype.hasOwnProperty.call(state.committed,seatId))return [{kind:"ante",cardIds:[...state.seats[seat].hand]}];
  if(state.stage==="play"&&state.active===seat)return [{kind:"play",cardIds:[...state.seats[seat].hand]}];return [];
}

/** Useful to callers validating save integrity without projecting secrets. */
export function checkInvariants(s:GameState):string[]{
  const errors:string[]=[];const held=s.seats.flatMap(p=>[...p.hand,...p.flight.map(f=>f.cardId)]);
  const pending=s.pending&&["seer-keep","sorcerer"].includes(s.pending.task.kind)?s.pending.task.ids??[]:[];
  const reserved=s.queue.filter(t=>t.kind==="sorcerer-ante").flatMap(t=>t.ids??[]);
  const ids=[...s.deck,...s.discard,...s.ante,...Object.values(s.committed),...held,...pending,...reserved];
  if(new Set(ids).size!==ids.length)errors.push("DUPLICATE_CARD");
  if(ids.some(id=>!CARDS.some(c=>c.id===id)))errors.push("UNKNOWN_CARD");
  if(s.seats.some(p=>p.hand.length>10||p.gold<0||p.debt<0||!Number.isInteger(p.gold)||!Number.isInteger(p.debt)))errors.push("INVALID_SEAT_VALUES");
  if(s.stakes<0||s.hole<0)errors.push("INVALID_POTS");
  return errors;
}
