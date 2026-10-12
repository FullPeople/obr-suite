// Real notice transport and watcher; disposable identity, HTTP and window boundaries.
import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve(import.meta.dirname,'../.local-evidence/qq-notifications');mkdirSync(out,{recursive:true});
await build({input:resolve(import.meta.dirname,'../src/modules/characterCards/qq-change-watch.ts'),external:['@owlbear-rodeo/sdk'],output:{file:join(out,'notice.mjs'),format:'esm',codeSplitting:false}});
const api=await import(pathToFileURL(join(out,'notice.mjs')));
const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)};
globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const account=(id)=>storage.set('dnd-qq-plugin',JSON.stringify({token:'synthetic-notice-token-'+id,expiresAt:Date.now()+60000,accountId:id}));
const cursor='a'.repeat(64),reply=(changed=false,accountId='owner')=>new Response(JSON.stringify({accountId,cursor,changed}));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let count=0;async function check(name,run){await run();console.log('PASS',++count,name);}
await check('Room scopes are sorted, deduplicated, validated and bounded to 32',async()=>{
 const rows=Array.from({length:40},(_,i)=>({qqRoom:{id:String(i).padStart(2,'0'),capability:'proof-'+i}}));
 rows.push({qqRoom:{id:'00',capability:'latest'}},{qqRoom:{id:'invalid'}},null);
 const result=api.qqChangeRooms({'com.obr-suite/qq-cards':rows});assert.equal(result.length,32);assert.deepEqual(result[0],{id:'00',capability:'latest'});assert.equal(result.at(-1).id,'31');
});
await check('The read-only wait sends only scopes and cursor, without a mutation preflight',async()=>{
 account('owner');let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://dnd.center/api/changes');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,'Bearer synthetic-notice-token-owner');assert.equal(init.headers['X-CSRF-Token'],undefined);assert.deepEqual(JSON.parse(init.body),{cursor,rooms:[{id:'room',capability:'proof'}]});return reply();};
 assert.equal((await api.qqChangeNotice([{id:'room',capability:'proof'}],cursor,new AbortController().signal)).changed,false);assert.equal(calls,1);
});
await check('Cancelling an abandoned page cancels its held HTTP request',async()=>{
 const parent=new AbortController();let transport;
 globalThis.fetch=async(_url,init)=>{transport=init.signal;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));};
 const held=api.qqChangeNotice([],undefined,parent.signal),rejected=assert.rejects(held,{name:'AbortError'});parent.abort();await rejected;assert.equal(transport.aborted,true);
});
await check('A late notice cannot refresh a newly selected account; stop removes listeners and requests',async()=>{
 account('owner');const flights=[];let changes=0;
 globalThis.fetch=(_url,init)=>new Promise(resolve=>flights.push({init,resolve}));
 const watch=api.observeQQChanges({rooms:()=>[],changed:async()=>{changes++;}});assert.equal(flights.length,1);
 account('other');window.dispatchEvent(new Event('qq-account-changed'));assert.equal(flights[0].init.signal.aborted,true);assert.equal(changes,1);
 flights[0].resolve(reply(true,'owner'));await tick();assert.equal(changes,1);assert.equal(flights.length,2);
 watch.stop();flights[1].resolve(reply(true,'other'));await watch.done;window.dispatchEvent(new Event('qq-account-changed'));assert.equal(changes,1);assert.equal(flights[1].init.signal.aborted,true);
});
await check('An unchanged room observation preserves the same held request',async()=>{
 account('owner');const flights=[];let rooms=[{id:'one',capability:'proof'}],changes=0;
 globalThis.fetch=(_url,init)=>new Promise(resolve=>flights.push({init,resolve}));
 const watch=api.observeQQChanges({rooms:()=>rooms,changed:async()=>{changes++;}});watch.checkScope();assert.equal(flights[0].init.signal.aborted,false);
 rooms=[{id:'two',capability:'other-proof'}];watch.checkScope();assert.equal(flights[0].init.signal.aborted,true);assert.equal(changes,1);
 flights[0].resolve(reply(true));await tick();assert.equal(flights.length,2);assert.deepEqual(JSON.parse(flights[1].init.body).rooms,rooms);
 watch.stop();flights[1].resolve(reply());await watch.done;
});
console.log(`QQ change notifications: ${count} scenarios passed; real QQ and real rooms pending.`);
