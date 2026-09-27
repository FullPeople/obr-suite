import assert from "node:assert/strict";
import {BASE_CARDS,CARDS,SPECIAL_CARDS,TIME_DRAGON,DECK_CATALOG,createGame,applyAction,applyEdit,checkInvariants,handPowerHint,parseVariant,projectPublic,projectSeat,cardName,cardHint,type GameState,type SeatView} from "../extensions/three-dragon-ante/src/game/rules";
import {validGameSetup} from "../extensions/three-dragon-ante/src/game/setup";
import {validRecovery,tableSummary} from "../extensions/three-dragon-ante/src/game/controller-validation";
import {packPublic,packSeat,unpackPublic,unpackSeat} from "../extensions/three-dragon-ante/src/game/wire";
import {TableController} from "../extensions/three-dragon-ante/src/game/controller";
import {ControllerRoom,MemoryStore,until} from "./fixtures/three-dragon-controller-room";
import {fateVariant,timeDragonPosition} from "./fixtures/three-dragon-time-dragon";
const active=(game:GameState)=>[...game.deck,...game.discard,...game.ante,...Object.values(game.committed),...game.seats.flatMap(seat=>[...seat.hand,...seat.flight.map(item=>item.cardId)])];
const summary=(game:GameState)=>({version:1 as const,id:"test-table",hostPlayerId:"you",hostConnectionId:"host",hostName:"你",stage:"playing" as const,revision:game.revision,seats:game.seats.map(seat=>({playerId:seat.id,seatId:seat.id,name:seat.name})),...(game.variant?{variant:game.variant}:{})});
function recovers(game:GameState){const table=summary(game);return validRecovery({version:1,roomId:"test-room",serial:1,table,game},"test-room",table);}
const seats=[{id:"you",name:"你"},{id:"two",name:"玩家二"},{id:"three",name:"玩家三"}];
assert.equal(BASE_CARDS.length,100);assert.equal(SPECIAL_CARDS.length,30);assert.equal(CARDS.length,101);
assert.deepEqual([TIME_DRAGON.strength,TIME_DRAGON.alignment,TIME_DRAGON.category],[12,"good","legendary"]);
assert.equal(DECK_CATALOG[1].name,"命运之轮的轮转使用");assert.equal(cardName(TIME_DRAGON.id,"zh"),"时光龙");assert.match(cardHint(TIME_DRAGON.id,"zh"),/弃牌堆/);
for(let seed=1;seed<=32;seed++){
 const base=createGame({id:"base",seats,seed}),fate=createGame({id:"fate",seats,seed,variant:fateVariant});
 assert.equal(active(base).length,80);assert.equal(active(fate).length,81);
 assert.equal(active(fate).filter(id=>id===TIME_DRAGON.id).length,1);assert.ok(![...active(base),...base.excluded].includes(TIME_DRAGON.id));
 assert.deepEqual(fate.excluded,base.excluded,"original special selection remains identical for the same seed");
 assert.ok(recovers(base));assert.ok(recovers(fate));
 delete base.variant;assert.ok(recovers(base),"pre-variant legacy saves remain valid");
}
console.log("PASS: 32 seeds preserve the original 80-card deck; the new deck adds exactly one guaranteed Time Dragon and both recover");
const selected=createGame({id:"selected",seats,seed:1,specialIds:SPECIAL_CARDS.slice(0,10).map(card=>card.id)});
assert.equal(active(selected).length,80);assert.ok(recovers(selected));
assert.equal(parseVariant({...fateVariant,specialIds:[TIME_DRAGON.id]}),null);
assert.ok(validGameSetup({variant:fateVariant}));assert.equal(validGameSetup({variant:{...fateVariant,deckId:"unknown"}}),false);
assert.equal(parseVariant({ruleSetId:fateVariant.ruleSetId,deckId:"selected-specials-v1",specialIds:[TIME_DRAGON.id,...SPECIAL_CARDS.slice(0,9).map(card=>card.id)]}),null);
for(const [handCount,discardCount] of [[3,4],[9,8],[10,8],[3,0],[3,18]]){
 const before=timeDragonPosition(handCount,discardCount),snapshot=structuredClone(before),room=10-(handCount-1),taken=before.discard.slice(-Math.min(room,discardCount)).reverse();
 if(!discardCount)taken.length=0;
 assert.equal(handPowerHint(before,"you",TIME_DRAGON.id).state,"power-ready");
 const action={id:"play-time",revision:before.revision,seatId:"you",kind:"play" as const,cardId:TIME_DRAGON.id},result=applyAction(before,action);assert.ok(result.ok);
 const after=result.state;
 assert.deepEqual(after.seats[0].hand,[...before.seats[0].hand.slice(1),...taken]);
 assert.deepEqual(after.discard,before.discard.slice(0,discardCount-taken.length));
 assert.deepEqual(after.deck,before.deck,"no draw or shuffle to fill a short discard");assert.deepEqual(before,snapshot,"rule input remains immutable");
 assert.equal(after.seats[0].flight[0].cardId,TIME_DRAGON.id);assert.deepEqual(checkInvariants(after),[]);assert.ok(recovers(after));
 const receipt=after.events.find(event=>event.code==="DISCARD_RECLAIMED");assert.deepEqual(receipt?.cardIds,taken);assert.equal(receipt?.amount,taken.length);
 const duplicate=applyAction(after,action);assert.ok(duplicate.ok&&duplicate.duplicate);assert.deepEqual(duplicate.state,after);
 const wire=packPublic(projectPublic(after));assert.deepEqual(unpackPublic(wire).variant,fateVariant);
 for(const id of after.seats[1].hand)assert.ok(!JSON.stringify(wire).includes('"'+id+'"'),"other hands stay private");
 assert.deepEqual(unpackSeat(packSeat(projectSeat(after,"you")))?.hand.map(card=>card.id),after.seats[0].hand);
 console.log(`PASS: ${handCount} hand / ${discardCount} discard -> ${after.seats[0].hand.length} hand, ${after.discard.length} remaining; recovery, duplicate receipt and private projection`);
}
const blocked=timeDragonPosition(3,4,false),blockedResult=applyAction(blocked,{id:"no-trigger",revision:0,seatId:"you",kind:"play",cardId:TIME_DRAGON.id});assert.ok(blockedResult.ok);
assert.deepEqual(blockedResult.state.discard,blocked.discard);assert.ok(!blockedResult.state.events.some(event=>event.code==="DISCARD_RECLAIMED"));
const corrupt=timeDragonPosition();corrupt.deck.push(corrupt.deck[0]);assert.equal(recovers(corrupt),false);
const missing=timeDragonPosition();missing.seats[0].hand.shift();assert.equal(recovers(missing),false);
const wrong=timeDragonPosition();wrong.variant={ruleSetId:fateVariant.ruleSetId,deckId:"random-specials-v1"};assert.equal(recovers(wrong),false);
const edited=timeDragonPosition();const replaced=applyEdit(edited,{kind:"replaceCard",cardId:TIME_DRAGON.id,withCardId:edited.excluded[0]});assert.ok(replaced&&recovers(replaced),"explicit DM replacement preserves new-deck conservation");
console.log("PASS: trigger conditions, invalid setup, corrupt/mismatched saves and explicit DM replacement");

// Real controller/private transport; only the room and persistence boundaries are simulated.
const room=new ControllerRoom(),storage=new MemoryStore(),options={retryMs:100,heartbeatMs:300,timeoutMs:1600,creationSettleMs:20};
let host=new TableController(()=>{},{...options,platform:room.port("owner","time-host"),storage});
const guest=new TableController(()=>{},{...options,platform:room.port("guest","time-guest"),storage:new MemoryStore()});
try{
 await host.start();await guest.start();await host.command({type:"create"});await until(()=>guest.view.connected,"lobby connected");await guest.command({type:"join"});await until(()=>host.view.table?.seats.length===2&&!guest.view.pending,"guest joined");
 await guest.command({type:"start",options:{variant:fateVariant}});await until(()=>!guest.view.pending,"non-host rejected");assert.equal(host.view.game,null);
 await host.command({type:"start",options:{variant:fateVariant}});await until(()=>!!guest.view.game&&guest.view.table?.stage==="playing","new deck projected");
 assert.deepEqual(guest.view.game!.variant,fateVariant);assert.ok(tableSummary(room.table));
 const tableId=host.view.table!.id,saved=await storage.load(room.roomId,tableId);assert.ok(saved?.game);assert.equal(active(saved.game).length,81);assert.ok(validRecovery(saved,room.roomId,host.view.table!));
 const before=guest.view.game!.id;await host.stop();room.remove("time-host");host=new TableController(()=>{},{...options,platform:room.port("owner","time-host-returned"),storage});await host.start();
 await until(()=>host.view.game?.id===before&&guest.view.connected&&guest.view.game?.id===before,"81-card recovery reconnects");
 assert.deepEqual((guest.view.game as SeatView).variant,fateVariant);assert.equal((guest.view.game as SeatView).hand.length,6);
 console.log("PASS: new-deck host authorization, encrypted seat delivery, persisted 81-card game and host restart");
}finally{await host.stop();await guest.stop();}
