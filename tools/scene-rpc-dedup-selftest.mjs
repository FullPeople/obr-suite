import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function declaration(file,name){
 const text=readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);let result;
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)result=node.getText(source);ts.forEachChild(node,visit);}visit(source);
 assert(result,`${file}:${name}`);return result.replace(/^export /,'');
}
function run(declarations,globals){
 const source=ts.transpileModule(declarations.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const context=vm.createContext({...globals,console,structuredClone,Promise,Map,Set});vm.runInContext(source,context);return context;
}
const hold=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const cases=[];async function check(name,test){await test();cases.push(name);console.log('PASS '+name);}
function notice(){
 const calls=[],errors=[],pending=[],own={alive:true,epoch:1,ready:true,state:{active:false,cgUrl:null},role:'GM'};
 let deferred=false;
 const context=run(['notify','applyState'].map(name=>declaration('src/modules/timeStop.ts',name)),{
  current:value=>value.alive,TIME_STOP_META:'state',readTimeStop:value=>({active:value?.active===true,cgUrl:value?.cgUrl??null}),syncOverlay:async()=>{},interruptSelection:()=>{},STATE:'state-message',log:e=>errors.push(e),
  local:async(_channel,data)=>{calls.push(data.active);if(deferred){const task=hold();pending.push(task);await task.promise;}},
 });
 return {context,own,calls,errors,pending,defer:()=>deferred=true,emit:value=>context.applyState(own,value)};
}
await check('unrelated metadata bursts issue one unchanged local state notification',async()=>{
 const f=notice();for(let index=0;index<80;index++)f.emit({unrelated:index,state:{active:false}});await Promise.resolve();assert.deepEqual(f.calls,[false]);
 f.emit({state:{active:true}});f.emit({state:{active:true,cgUrl:'https://example.invalid/image.png'}});f.emit({state:{active:false}});assert.deepEqual(f.calls,[false,true,false]);
});
await check('a new scene sends its own initial state and retired sessions cannot send',async()=>{
 const f=notice();await f.context.notify(f.own);f.own.epoch++;await f.context.notify(f.own);f.own.alive=false;f.own.state.active=true;await f.context.notify(f.own);assert.deepEqual(f.calls,[false,false]);
});
await check('a failed state send remains eligible for retry without parallel duplicate sends',async()=>{
 const f=notice();f.defer();const first=f.context.notify(f.own);await f.context.notify(f.own);assert.deepEqual(f.calls,[false]);f.pending[0].reject(Error('authored local failure'));await first;assert.equal(f.errors.length,1);
 const retry=f.context.notify(f.own);assert.deepEqual(f.calls,[false,false]);f.pending[1].resolve();await retry;
});
await check('an old failed send cannot erase a newer identical final state',async()=>{
 const f=notice();f.defer();const first=f.context.notify(f.own);f.own.state.active=true;const second=f.context.notify(f.own);f.own.state.active=false;const third=f.context.notify(f.own);
 f.pending[2].resolve();await third;f.pending[1].resolve();await second;f.pending[0].reject(Error('old failure'));await first;await f.context.notify(f.own);assert.deepEqual(f.calls,[false,true,false]);
});
const HP='hp',EXT='external',DEX='dex',BIND='bind';
function refresh(){
 const item={id:'token',metadata:{[BIND]:'test',[HP]:{health:27,'max health':40,'armor class':10,'temporary health':3,hidden:false,color:'#123456'},[DEX]:2}};
 const snapshot={maxHp:40,ac:10,initBonus:2},calls={reads:0,writes:0};let beforeUpdate;
 const context=run(['cardRefreshChanged','propagateCardRefresh'].map(name=>declaration('src/modules/characterCards/index.ts',name)),{
  active:true,sceneReady:true,ccRole:'GM',generation:1,sceneGeneration:1,cards:new Map([['test',{}]]),refreshes:new Map(),current:(g,s)=>g===1&&s===1,AbortController,
  BUBBLES_META_KEY:HP,EXTERNAL_BUBBLES_META_KEY:EXT,INIT_DEXMOD_META:DEX,BIND_META:BIND,fetchCardSnapshot:async()=>snapshot,
  OBR:{room:{id:'room'},scene:{items:{getItems:async predicate=>{calls.reads++;return [structuredClone(item)].filter(predicate);},updateItems:async(ids,apply)=>{calls.writes++;beforeUpdate?.();assert.deepEqual([...ids],['token']);apply([item]);}}}},
 });
 return {item,snapshot,context,calls,update:()=>context.propagateCardRefresh('test'),beforeUpdate:fn=>beforeUpdate=fn};
}
await check('HP-only changes never rewrite unchanged maximum, armor or initiative',async()=>{
 const f=refresh();for(let index=0;index<12;index++){f.item.metadata[HP].health=index;await f.update();}assert.equal(f.calls.writes,0);assert.equal(f.calls.reads,12);
});
await check('real summary changes write once and preserve current HP, temp HP and appearance',async()=>{
 const f=refresh();Object.assign(f.snapshot,{maxHp:50,ac:13,initBonus:4});await f.update();await f.update();assert.equal(f.calls.writes,1);assert.deepEqual(structuredClone(f.item.metadata[HP]),{health:27,'max health':50,'armor class':13,'temporary health':3,hidden:false,color:'#123456'});assert.equal(f.item.metadata[DEX],4);
});
await check('legacy mirrors and absent native metadata still migrate once',async()=>{
 const f=refresh();f.item.metadata[EXT]=f.item.metadata[HP];delete f.item.metadata[HP];await f.update();await f.update();assert.equal(f.calls.writes,1);assert.deepEqual(structuredClone(f.item.metadata[HP]),structuredClone(f.item.metadata[EXT]));assert.equal(f.item.metadata[HP].health,27);
});
await check('rebind and permission changes during SDK preparation prevent stale writes',async()=>{
 for(const revoke of [f=>{f.item.metadata[BIND]='replacement';},f=>{f.context.ccRole='PLAYER';}]){const f=refresh();f.snapshot.ac=18;f.beforeUpdate(()=>revoke(f));await f.update();assert.equal(f.item.metadata[HP]['armor class'],10);}
});
console.log(JSON.stringify({passed:cases.length,realRoom:false,productionFunctions:true}));
