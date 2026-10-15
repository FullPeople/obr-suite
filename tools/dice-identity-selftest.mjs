import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'rolldown';
const out=resolve('workbench-test-output/dice-identity');mkdirSync(out,{recursive:true});
const listeners=new Set();let role='GM',holdRole,reads=0;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
globalThis.__identitySDK={player:{getId:async()=>{reads++;return'player';},getConnectionId:async()=>'connection',getName:async()=>'Synthetic',getColor:async()=>'#777',getRole:()=>holdRole?.promise||Promise.resolve(role),onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}}};
const file=resolve(out,'identity.mjs');
await build({input:'src/workbench/dice-identity.ts',plugins:[{name:'identity-boundary',resolveId(id){if(id==='@owlbear-rodeo/sdk')return'virtual:sdk';},load(id){if(id==='virtual:sdk')return'export default globalThis.__identitySDK';}}],output:{file,format:'esm'}});
const {diceIdentity,resetDiceIdentity}=await import(pathToFileURL(file).href);
const event=value=>{for(const fn of listeners)fn({id:'player',connectionId:'connection',name:'Synthetic',color:'#777',metadata:{},role:value});};
const cases=[];async function test(name,run){await run();cases.push(name);console.log('PASS '+name);resetDiceIdentity();holdRole=undefined;}
await test('concurrent identity reads share their SDK calls',async()=>{reads=0;await Promise.all([diceIdentity(),diceIdentity()]);assert.equal(reads,1);assert.equal(listeners.size,1);});
await test('a role event during initial RPCs wins over their older result',async()=>{holdRole=deferred();const result=diceIdentity();event('PLAYER');holdRole.resolve('GM');assert.equal((await result).role,'PLAYER');assert.equal((await diceIdentity()).role,'PLAYER');});
await test('a stale fulfilled read cannot overwrite a new session or restore a subscription',async()=>{holdRole=deferred();const oldRole=holdRole,old=diceIdentity();resetDiceIdentity();assert.equal(listeners.size,0);holdRole=undefined;role='PLAYER';await diceIdentity();oldRole.resolve('GM');await old;assert.equal((await diceIdentity()).role,'PLAYER');assert.equal(listeners.size,1);});
await test('a stale rejected read cannot clear the new session flight or its listener',async()=>{holdRole=deferred();const oldRole=holdRole,old=diceIdentity();resetDiceIdentity();holdRole=deferred();const current=holdRole,one=diceIdentity();oldRole.reject(Error('old failure'));await assert.rejects(old,/old failure/);const two=diceIdentity();assert.equal(one,two);assert.equal(listeners.size,1);current.resolve('PLAYER');await one;});
assert.equal(listeners.size,0);console.log(JSON.stringify({passed:cases.length,controlled:true}));
