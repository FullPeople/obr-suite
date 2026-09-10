import { createGame, applyAction, projectPublic, projectSeat, checkInvariants, SPECIAL_CARDS, type GameState, type GameAction } from '../extensions/three-dragon-ante/src/game/rules';
import { packPublic, packSeat, unpackPublic, unpackSeat } from '../extensions/three-dragon-ante/src/game/wire';

let checks=0,serial=0;
function check(value:unknown,label:string):asserts value {if(!value)throw Error(`ASSERTION: ${label}`);checks++;}
const stable=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
function equal(a:unknown,b:unknown,label:string){check(stable(a)===stable(b),label);}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function game(hands:string[][],deckPrefix:string[]=[]):GameState {
 const required=[...new Set(hands.flat().concat(deckPrefix))].filter(id=>SPECIAL_CARDS.some(card=>card.id===id));
 const specials=[...required,...SPECIAL_CARDS.map(card=>card.id).filter(id=>!required.includes(id))].slice(0,10);
 const state=createGame({id:'origins',seats:hands.map((_,i)=>({id:`s${i}`,name:`Seat ${i}`})),specialIds:specials,seed:1848});
 const pool=state.deck.concat(state.seats.flatMap(seat=>seat.hand));
 const used=hands.flat().concat(deckPrefix);check(new Set(used).size===used.length&&used.every(id=>pool.includes(id)),'fixture uses distinct cards from this actual game');
 state.seats.forEach((seat,i)=>{seat.hand=[...hands[i]];});state.deck=[...deckPrefix,...pool.filter(id=>!used.includes(id))];
 equal(checkInvariants(state),[],'fixture preserves full physical deck');return state;
}
function act(state:GameState,seat:number,kind:GameAction['kind'],extra:Partial<GameAction>={}) {
 const result=applyAction(state,{id:`origin-${++serial}`,revision:state.revision,seatId:state.seats[seat].id,kind,...extra});
 check(result.ok,`actual ${kind} accepted`);if(!result.ok)throw Error('unreachable');equal(checkInvariants(result.state),[],`actual ${kind} preserves cards`);return result.state;
}
function choose(state:GameState,id:string){check(!!state.pending,'real choice is pending');return act(state,state.seats.findIndex(seat=>seat.id===state.pending!.seatId),'choose',{choiceId:state.pending!.id,optionIds:[id]});}
function reveal(state:GameState) {const ids=state.seats.map(seat=>seat.hand[0]);for(let i=state.seats.length-1;i>=0;i--)state=act(state,i,'ante',{cardId:ids[i]});return state;}

const hands=[['gold-13','bronze-7','white-2'],['red-12','copper-3','green-2'],['silver-10','brass-4','green-4'],['gold-11','white-3','black-5'],['blue-9','silver-3','brass-5'],['bronze-8','green-5','copper-5']];
for(const n of [2,6]){
 let state=game(hands.slice(0,n));const anteIds=state.seats.map(seat=>seat.hand[0]);
 equal(state.anteOrigins??[],[],`${n} initial game has no public origin`);
 for(let seat=n-1;seat>=0;seat--){
  state=act(state,seat,'ante',{cardId:anteIds[seat]});
  if(seat===0)continue;
  const publicView=projectPublic(state),packed=packPublic(publicView);
  equal(publicView.anteOrigins,[],'unrevealed ante has no public origin');equal(publicView.ante,[],'unrevealed ante has no public card');
  check(anteIds.every(id=>!JSON.stringify(packed).includes(`"${id}"`)),'public wire contains no committed identity');
  const spectatorSeat=projectSeat(state,'s0');check(anteIds.slice(seat).every(id=>!JSON.stringify(spectatorSeat).includes(`"${id}"`)),'another seat projection has no committed identities');
  equal(projectSeat(state,`s${seat}`).committedAnte?.id,anteIds[seat],'committer sees its own private ante');
  equal(unpackSeat(packSeat(projectSeat(state,`s${seat}`))),projectSeat(state,`s${seat}`),'private wire retains own committed card without adding public origins');
 }
 const expected=anteIds.map((cardId,i)=>({seatId:`s${i}`,cardId})),publicView=projectPublic(state);
 equal(publicView.anteOrigins,expected,'revealed provenance follows seats rather than submission order');
 equal(publicView.ante.map(card=>card.id),anteIds,'all completed antes stay public');
 equal(unpackPublic(packPublic(publicView)),publicView,`${n} public wire round trip preserves origins and cards`);
 equal(unpackSeat(packSeat(projectSeat(state,'s0'))),projectSeat(state,'s0'),`${n} seat wire round trip preserves origins and own hand`);
 const projected=projectPublic(state);projected.anteOrigins![0].cardId='tampered';equal(state.anteOrigins,expected,'projection origins do not alias private authoritative storage');
}

let state=reveal(game([['gold-13','bronze-7','white-2'],['red-12','copper-3','green-2'],['white-8','brass-4','green-4']]));
state=act(state,0,'play',{cardId:'bronze-7'});equal(state.pending?.code,'LOWEST_ANTE_CARD','Bronze uses real lowest-ante choice');
state=choose(state,'white-8');state=choose(state,'red-12');
equal(projectPublic(state).anteOrigins,[{seatId:'s0',cardId:'gold-13'}],'taken Bronze antes are filtered from public origins');
check(state.seats[0].hand.includes('white-8')&&state.seats[0].hand.includes('red-12'),'Bronze physically takes both origin cards');
equal(unpackPublic(packPublic(projectPublic(state))).anteOrigins,[{seatId:'s0',cardId:'gold-13'}],'wire does not restore removed Bronze origins');

state=reveal(game([['gold-13','sorcerer','white-2'],['red-12','copper-3','green-2'],['white-8','brass-4','green-4']],['black-1','blue-1','brass-1']));
const originalOrigins=clone(projectPublic(state).anteOrigins);
state=act(state,0,'play',{cardId:'sorcerer'});equal(state.pending?.code,'SORCERER_REPLACEMENT','Sorcerer exposes real replacement choice');
equal(projectPublic(state).anteOrigins,originalOrigins,'Sorcerer reveal does not assign origins to candidate cards');
state=choose(state,'black-1');
check(state.ante.includes('blue-1')&&state.ante.includes('brass-1'),'Sorcerer adds its remaining public cards after replacement');
equal(projectPublic(state).anteOrigins,originalOrigins,'Sorcerer-added antes have no invented seat origin');
equal(projectPublic(state).ante.filter(card=>!projectPublic(state).anteOrigins!.some(origin=>origin.cardId===card.id)).map(card=>card.id),['blue-1','brass-1'],'unowned Sorcerer cards remain available in the common public area');
equal(unpackPublic(packPublic(projectPublic(state))).anteOrigins,originalOrigins,'wire preserves Sorcerer no-origin distinction');

const oldState=clone(state);delete oldState.anteOrigins;const oldProjection=projectPublic(oldState);
equal(oldProjection.anteOrigins,[],'legacy state without origins degrades to no assigned slots');
equal(oldProjection.ante.map(card=>card.id),state.ante,'legacy fallback retains all visible and selectable antes');
const oldWire=packPublic(oldProjection);delete oldWire.anteOrigins;const oldUnpacked=unpackPublic(oldWire);
equal(oldUnpacked.ante.map(card=>card.id),state.ante,'legacy wire retains public antes without needing provenance');
equal(oldUnpacked.anteOrigins??[],[],'legacy wire does not guess origins from public array positions');
const badPublic=projectPublic(state);badPublic.anteOrigins!.push({seatId:'foreign-seat',cardId:'blue-1'},{seatId:'s0',cardId:'sorcerer'});
equal(packPublic(badPublic).anteOrigins,originalOrigins,'wire drops origins for missing seats and cards outside ante');

let tied=game([['black-1','black-2','black-3'],['blue-1','blue-2','blue-4'],['white-1','white-2','white-3']]);tied=reveal(tied);
equal(tied.stage,'ante','all-tied deal actually repeats');equal(tied.anteOrigins,[],'all-tied deal clears origins before another ante');equal(projectPublic(tied).anteOrigins,[],'all-tied cards do not remain in seat slots');

let finishing=reveal(game([['gold-13','black-1','white-2'],['red-12','copper-3','green-2'],['white-8','brass-4','green-4']]));finishing.stakes=3;
finishing=act(finishing,0,'play',{cardId:'black-1'});
equal(finishing.lastGambit?.reason,'empty-stakes','real Black power ends this gambit immediately');
equal(finishing.anteOrigins,[],'completed gambit clears retained origins');equal(projectPublic(finishing).anteOrigins,[],'new gambit publishes no previous seat origins');
equal(projectPublic(finishing).ante,[],'new gambit has no previous ante cards');
console.log(`ANTE_ORIGINS ${checks} actual rules/projection/wire assertions PASS`);
