import {createGame,checkInvariants,type GameState,type TableVariant} from "../../extensions/three-dragon-ante/src/game/rules";
export const fateVariant:TableVariant={ruleSetId:"provided-pack-20260910",deckId:"wheel-of-fate-v1"};
/** A labelled mid-round fixture partitioned from a real 81-card game. */
export function timeDragonPosition(handCount=3,discardCount=4,trigger=true):GameState{
 const game=createGame({id:"time-dragon-fixture",variant:fateVariant,seed:15,seats:[{id:"you",name:"你"},{id:"two",name:"玩家二"},{id:"three",name:"玩家三"}]});
 const pool=[...game.deck,...game.seats.flatMap(seat=>seat.hand)].filter(id=>id!=="time-dragon"&&(trigger||id!=="gold-2"));
 game.seats[0].hand=["time-dragon",...pool.splice(0,handCount-1)];
 game.discard=pool.splice(0,discardCount);
 for(const seat of game.seats.slice(1))seat.hand=pool.splice(0,4);
 game.deck=pool;game.stage="play";game.round=1;game.active=0;game.leader=trigger?0:2;game.turnIndex=trigger?0:1;
 if(!trigger){game.seats[2].flight=[{cardId:"gold-2"}];game.roundCards[2]="gold-2";}
 game.stakes=30;for(const seat of game.seats)seat.gold=20;
 if(checkInvariants(game).length)throw Error("Invalid time-dragon fixture");
 return game;
}
