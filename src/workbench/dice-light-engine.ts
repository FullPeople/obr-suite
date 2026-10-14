import {parseExpr,exprIsEmpty,buildOneRollDice,buildFixedRollDice,totalModifier} from '../modules/dice/expression';
import {readFixedRoll,consumeFixedRoll,disarmFixedRoll} from '../modules/dice/fixed-roll';
import type {DiceIdentity} from './dice-identity';
import type {DiceRollPayload,QuickRollRequest} from '../modules/dice';
export function calculateLightRoll(req:QuickRollRequest&{rollId?:string;autoDismiss?:boolean;fixedRaw?:boolean},player:DiceIdentity):DiceRollPayload{
 let expression=String(req.expression||'').trim();if(expression.length>2048)throw Error('公式过长');
 if(req.critMode)expression=expression.replace(/(\d*)d(\d+)/gi,(_,n,s)=>`${2*Number(n||1)}d${s}`);
 if(req.advMode==='adv'||req.advMode==='dis')expression=expression.replace(/(\d*)d20\b/gi,(_,n)=>`${req.advMode}(${n||1}d20)`);
 // Bound input expansion before random calculation, rather than clipping results.
 if([...expression.matchAll(/(\d*)d\d+/gi)].reduce((n,m)=>n+Number(m[1]||1),0)>100||[...expression.matchAll(/,(\d+)\)/g)].some(m=>Number(m[1])>100))throw Error('一次最多投掷 100 枚骰子');
 const parsed=parseExpr(expression);if(exprIsEmpty(parsed))throw Error('无效公式');
 const expansion=parsed.outerPlain.groups.reduce((n,g)=>n+Math.abs(g.count),0)+parsed.segments.reduce((n,s)=>n+s.plain.groups.reduce((n,g)=>n+Math.abs(g.count),0)*s.wrappers.reduce((n,w)=>n*(w.kind==='adv'||w.kind==='dis'?(w.param??1)+1:w.kind==='repeat'?w.param??1:1),1),0);
 if(expansion>100)throw Error('一次最多投掷 100 枚骰子');
 let built:ReturnType<typeof buildOneRollDice>|undefined;
 const arm=readFixedRoll();if(arm){if(player.role!=='GM')disarmFixedRoll();else if(!req.collectiveId){const fixed=buildFixedRollDice(parsed,arm.value+(req.fixedRaw?totalModifier(parsed):0));if('ok'in fixed){built=fixed.ok;consumeFixedRoll();}}}
 built??=buildOneRollDice(parsed);if(!built.dice.length||built.dice.length>100)throw Error('一次需投掷 1 至 100 枚骰子');
 const modifier=totalModifier(parsed),rows=built.rowStarts?.length||1;
 const total=built.dice.filter(d=>!d.loser).reduce((n,d)=>n+(d.subtract?-d.value:d.value),0)+modifier*rows;
 return {...built,itemId:req.itemId??null,modifier,total,label:String(req.label||'').slice(0,120),expression:String(req.expression),rollerId:player.id,rollerName:player.name,rollerColor:player.color,rollId:req.rollId||crypto.randomUUID(),ts:Date.now(),hidden:player.role==='GM'&&!!req.hidden,collectiveId:req.collectiveId,autoDismiss:req.autoDismiss};
}
// The local renderer is invoked before any transport/history task is awaited.
export function launchLightResult(payload:DiceRollPayload,local:(p:DiceRollPayload)=>void,remote:(p:DiceRollPayload)=>Promise<unknown>,history:(p:DiceRollPayload)=>void,onError:(e:unknown)=>void){
 local(payload);
 void remote(payload).catch(onError);
 queueMicrotask(()=>history(payload));
}
