import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),game=join(root,'extensions/three-dragon-ante/src/game');
const out=mkdtempSync(join(tmpdir(),'tda-power-metadata-'));
const files=['rules/engine.ts','rules/projection.ts','rules/types.ts','wire.ts','power-sequence.ts'];
const pins=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(join(game,p))).digest('hex')]));
const before=pins(),mutant=process.argv.find(a=>a.startsWith('--mutant='))?.slice(9);let applied=false;
const mutations={
 copied:['rules/engine.ts','if(family!==card(source).family)s.events[s.events.length-1].effectFamily=family;','','copied power event retains Prophet identity and the actually copied family'],
 beneficiary:['rules/engine.ts','beneficiarySeatId:s.seats[task.seat].id','beneficiarySeatId:s.seats[seat].id','Brass has distinct chooser and beneficiary'],
 bronze:['rules/engine.ts','{...t,kind:"bronze-keep",ids:t.ids}','{kind:"bronze-keep",seat,ids:t.ids}','Bronze keep-one continuation retains the power source'],
 wire:['wire.ts','choice: view.choice?{id:view.choice.id','choice: view.choice?{...view.choice,id:view.choice.id','public wire re-whitelists private choice extensions'],
};
if(mutant)assert.ok(mutations[mutant],'known mutation');
const entry=`import assert from 'node:assert/strict';
import{createGame,applyAction,projectPublic,projectSeat,card,STANDARD_CARDS,SPECIAL_CARDS,checkInvariants}from ${JSON.stringify(join(game,'rules/index.ts'))};
import{packPublic,packSeat,unpackPublic}from ${JSON.stringify(join(game,'wire.ts'))};
import{powerEvents,activePowerCards}from ${JSON.stringify(join(game,'power-sequence.ts'))};
export const checks=[],evidence=[];let serial=0;
function check(name,ok){assert.ok(ok,name);checks.push(name)}
function position(source,extra={}){
 const hand=extra.hand??['white-8'],ante=extra.ante??[],opponent=extra.opponent??[[],[]],top=extra.deck??[];
 const all=[source,...hand,...ante,...opponent.flat(),...top],required=[...new Set(all)].filter(id=>card(id).category!=='standard');
 assert.equal(new Set(all).size,all.length,'fixture partitions card identities');
 const special=[...required,...SPECIAL_CARDS.map(c=>c.id).filter(id=>!required.includes(id))].slice(0,10);
 const s=createGame({id:'metadata-'+(++serial),seed:7341,seats:[{id:'actor',name:'Actor'},{id:'left',name:'Left'},{id:'right',name:'Right'}],specialIds:special});
 s.stage='play';s.round=1;s.active=0;s.leader=0;s.turnIndex=0;s.roundCards=[null,null,null];s.stakes=30;s.discard=[];s.ante=ante.slice();s.events=[];s.revealed=[];s.effects=[];s.committed={};
 s.seats.forEach((seat,i)=>{seat.hand=i===0?[source,...hand]:[...opponent[i-1]];seat.flight=[];seat.gold=20});
 const used=new Set(all),pool=[...STANDARD_CARDS.map(c=>c.id),...special];
 for(const seat of s.seats.slice(1))while(seat.hand.length<3){const id=pool.find(id=>!used.has(id));seat.hand.push(id);used.add(id)}
 s.deck=[...top,...pool.filter(id=>!used.has(id))];assert.deepEqual(checkInvariants(s),[],'valid authored rules fixture');return s;
}
function act(s,kind,data={}){const result=applyAction(s,{id:'a'+(++serial),revision:s.revision,seatId:s.pending?.seatId??s.seats[s.active].id,kind,...data});assert.ok(result.ok,result.ok?'':result.error.code);assert.deepEqual(checkInvariants(result.state),[]);return result.state}
const play=(id,extra)=>act(position(id,extra),'play',{cardId:id});
const pick=(s,id)=>act(s,'choose',{choiceId:s.pending.id,optionIds:[id]});
const publiclySafe=(s)=>{
 const p=projectPublic(s),w=packPublic(p),allowed=['beneficiarySeatId','code','id','seatId','sourceCardId'];
 assert.ok(Object.keys(p.choice??{}).every(k=>allowed.includes(k)));assert.ok(Object.keys(w.choice??{}).every(k=>allowed.includes(k)));
 assert.ok(!('hand'in w)&&!('actions'in w)&&!('queue'in w)&&!('deck'in w));return {p,w};
};
let s=play('brass-3',{opponent:[['red-2'],['gold-9']]});let value=publiclySafe(s);
check('Brass has distinct chooser and beneficiary',value.p.choice.seatId==='right'&&value.p.choice.beneficiarySeatId==='actor'&&value.p.choice.sourceCardId==='brass-3');
check('Brass options are private to its responding player',projectSeat(s,'right').actions[0].kind==='choose'&&projectSeat(s,'actor').actions.length===0&&projectSeat(s,'left').actions.length===0&&!JSON.stringify(value.w).includes('gold-9'));
check('pending public source remains active for a fresh spectator',activePowerCards(unpackPublic(value.w)).includes('brass-3'));
const oldMoney=s.seats.map(v=>v.gold);s=pick(s,'pay');check('resolving response retains actual original five-gold rule',s.seats[0].gold===oldMoney[0]+5&&s.seats[2].gold===oldMoney[2]-5);
check('resolved instantaneous demand no longer lights its source',!activePowerCards(projectPublic(s)).includes('brass-3'));
s=play('green-5',{opponent:[['red-2'],['gold-9']]});value=publiclySafe(s);
check('Green uses left chooser and original actor as beneficiary',value.p.choice.seatId==='left'&&value.p.choice.beneficiarySeatId==='actor'&&value.w.choice.sourceCardId==='green-5');
check('Green private hand options stay absent from public wire',!JSON.stringify(value.w).includes('red-2')&&projectSeat(s,'left').actions[0].choice.options.some(o=>o.cardId==='red-2'));
for(const source of ['brass-sultan','green-schemer']){s=play(source);for(let n=0;n<2;n++){value=publiclySafe(s);check(source+' response '+n+' retains original public source and beneficiary',value.p.choice.sourceCardId===source&&value.p.choice.beneficiarySeatId==='actor'&&value.p.choice.seatId!=='actor');s=pick(s,'pay')}}
s=play('prophet',{hand:['green-1','white-8'],opponent:[['blue-9','blue-11'],['gold-9']]});const beforeCopy=projectPublic(s);s=pick(s,'green-1');value=publiclySafe(s);const afterCopy=value.p;
const copied=powerEvents(beforeCopy,afterCopy);
check('copied power event retains Prophet identity and the actually copied family',copied.length===1&&copied[0].cardId==='prophet'&&copied[0].family==='green'&&copied[0].seatId==='actor');
check('copied demand compares with Prophet strength and keeps original actor',s.pending.sourceCardId==='prophet'&&s.pending.beneficiarySeatId==='actor'&&s.pending.seatId==='left'&&s.pending.options.some(o=>o.id==='blue-9')&&!s.pending.options.some(o=>o.id==='blue-11'));
check('copied selected dragon is public only after the reveal event',!JSON.stringify(beforeCopy).includes('green-1')&&afterCopy.events.some(e=>e.code==='CARD_REVEALED'&&e.cardIds?.includes('green-1'))&&s.seats[0].hand.includes('green-1'));
check('new metadata survives compact public wire unchanged',JSON.stringify(unpackPublic(value.w).events)===JSON.stringify(afterCopy.events)&&value.w.choice.sourceCardId==='prophet');
evidence.push({case:'copied-green',events:copied,choice:value.w.choice});
const nine=STANDARD_CARDS.map(c=>c.id).filter(id=>!['bronze-7','black-1','blue-2','red-12'].includes(id)).slice(0,9);
s=play('bronze-7',{hand:nine,ante:['black-1','blue-2','red-12']});check('Bronze fixture reaches a real nine-card response',s.seats[0].hand.length===9&&s.pending.code==='LOWEST_ANTE_CARD');
s=pick(s,'black-1');s=pick(s,'blue-2');value=publiclySafe(s);
check('Bronze keep-one continuation retains the power source',value.p.choice.code==='KEEP_ONE_ANTE_CARD'&&value.p.choice.sourceCardId==='bronze-7'&&value.p.choice.beneficiarySeatId==='actor'&&activePowerCards(value.p).includes('bronze-7'));
check('public keep-one metadata contains no options or task',!('options'in value.w.choice)&&!('task'in value.w.choice)&&projectSeat(s,'actor').actions[0].choice.options.length===2);
const choice=structuredClone(value.p.choice);s=pick(s,'blue-2');check('Bronze keep-one still obeys hand cap and leaves unchosen ante',s.seats[0].hand.length===10&&s.seats[0].hand.includes('blue-2')&&s.ante.includes('black-1'));evidence.push({case:'bronze-keep',choice});
s=play('silver-seer',{deck:['blue-1','black-1','red-2','gold-13']});value=publiclySafe(s);const hidden=s.pending.options.map(o=>o.id),serialized=JSON.stringify(value.w);
check('private Seer candidates do not enter metadata or public wire',hidden.length===3&&hidden.every(id=>!serialized.includes('"'+id+'"'))&&value.w.choice.sourceCardId==='silver-seer');
check('only chooser private wire carries the Seer options',packSeat(projectSeat(s,'actor')).actions[0].choice.options.length===3&&packSeat(projectSeat(s,'left')).actions.length===0);
const enriched={...projectSeat(s,'actor'),choice:{...value.p.choice,options:s.pending.options,task:s.pending.task,min:1,max:1}};
check('public wire re-whitelists private choice extensions',Object.keys(packPublic(enriched).choice).every(k=>['beneficiarySeatId','code','id','seatId','sourceCardId'].includes(k)));
const legacy=structuredClone(s);delete legacy.pending.sourceCardId;delete legacy.pending.beneficiarySeatId;check('legacy pending without new optional metadata remains readable',JSON.stringify(Object.keys(packPublic(projectPublic(legacy)).choice).sort())===JSON.stringify(['code','id','seatId']));
let chain=position('copper-1',{deck:['copper-3','black-3']});const chainBefore=projectPublic(chain);chain=act(chain,'play',{cardId:'copper-1'});const cues=powerEvents(chainBefore,projectPublic(chain));
check('multiple powers in one real action preserve public order',JSON.stringify(cues.map(c=>c.cardId))===JSON.stringify(['copper-1','copper-3','black-3'])&&new Set(cues.map(c=>c.key)).size===3);
check('first snapshot and duplicate revision do not replay powers',powerEvents(null,projectPublic(chain)).length===0&&powerEvents(projectPublic(chain),projectPublic(chain)).length===0);
evidence.push({case:'copper-chain',cues});
`;
await build({input:'power-metadata',platform:'node',plugins:[{name:'fixture',resolveId(id){if(id==='power-metadata')return '\0power-metadata.ts'},load(id){if(id==='\0power-metadata.ts')return entry},transform(code,id){if(!mutant||!id.replaceAll('\\','/').endsWith('/'+mutations[mutant][0]))return;code=code.replaceAll('\r\n','\n');const[,from,to]=mutations[mutant];assert.equal(code.split(from).length-1,1,'unique mutation anchor');applied=true;return code.replace(from,to)}}],output:{file:join(out,'fixture.mjs'),format:'esm'},logLevel:'silent'});
if(mutant)assert.ok(applied,'mutation compiled');
try{
 const result=await import(pathToFileURL(join(out,'fixture.mjs')));assert.deepEqual(pins(),before,'product source remained unchanged');if(mutant)throw Error('mutant survived');
 writeFileSync(join(out,'result.json'),JSON.stringify({checks:result.checks,count:result.checks.length,evidence:result.evidence,pins:before,scope:'Production rules actions, projections, compact wire and public effect selector. Authored complete-deck positions retain invariant checks; no browser or native-Owlbear claim.'},null,2));console.log(JSON.stringify({count:result.checks.length,out}));
}catch(error){if(mutant&&applied&&error instanceof assert.AssertionError&&error.message===mutations[mutant][3]){writeFileSync(join(out,'mutation.json'),JSON.stringify({mutant,applied,killedBy:error.message,pins:before},null,2));console.log('KILL '+mutant+' '+out)}else{writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,pins:before},null,2));throw new Error(out,{cause:error})}}
