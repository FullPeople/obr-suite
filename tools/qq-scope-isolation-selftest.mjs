import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mock} from 'node:test';
const out=resolve('.local-evidence/qq-scope-isolation');mkdirSync(out,{recursive:true});
await build({input:{notice:'src/modules/characterCards/qq-change-watch.ts',refresh:'src/workbench/cloud-refresh.ts'},external:['@owlbear-rodeo/sdk'],output:{dir:out,format:'esm',entryFileNames:'[name].mjs'}});
const {observeQQChanges}=await import(pathToFileURL(join(out,'notice.mjs'))),{refreshCloudIndependently}=await import(pathToFileURL(join(out,'refresh.mjs')));
const bad='00000000-0000-4000-8000-000000000001',good='00000000-0000-4000-8000-000000000002',cursor='a'.repeat(64);
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check,budget=2500){const deadline=Date.now()+budget;while(!check()){if(Date.now()>deadline)throw Error('Fixture condition timed out');await tick();}}
const results=[];
const measurements=[];
async function check(name,run){await run();results.push(name);console.log('PASS',results.length,name);}
function environment(){const storage=new Map([['dnd-qq-plugin',JSON.stringify({token:'synthetic-owner',accountId:'owner',expiresAt:Date.now()+60000})]]);globalThis.localStorage={getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)};globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});}
function held(signal){return new Promise((_resolve,reject)=>{const abort=()=>reject(new DOMException('Cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
await check('Deleted room scope is quarantined while a valid room continues receiving notifications',async()=>{
 environment();const rooms=[{id:bad,capability:'old-proof'},{id:good,capability:'good-proof'}],posts=[],status=[];let changes=0;
 globalThis.fetch=async(url,init)=>{if(url.includes('/room-cards/'))return reply({},url.includes(bad)?404:200);const data=JSON.parse(init.body);posts.push(data.rooms);if(data.rooms.some(room=>room.id===bad))return reply({message:'Deleted room'},404);if(posts.filter(rooms=>!rooms.some(room=>room.id===bad)).length===1)return reply({accountId:'owner',cursor,changed:true});return held(init.signal);};
 const observer=observeQQChanges({rooms:()=>rooms,changed:async()=>{changes++;},scopeStatus:value=>status.push(...value)});
 try{await until(()=>changes>0);assert(posts.some(rooms=>rooms.length===1&&rooms[0].id===good));assert(observer.blockedRooms().has(bad));assert(status.some(row=>row.room.id===bad&&!row.valid&&row.status===404));assert(status.some(row=>row.room.id===good&&row.valid));}finally{observer.stop();await observer.done;}
});
await check('Rotating a proof resumes the repaired scope without restarting healthy scopes or using the stale proof',async()=>{
 environment();let rooms=[{id:bad,capability:'stale-proof'},{id:good,capability:'good-proof'}],changes=0;const posts=[];
 globalThis.fetch=async(url,init)=>{if(url.includes('/room-cards/'))return reply({},url.includes(bad)?403:200);const data=JSON.parse(init.body);posts.push(data.rooms);if(data.rooms.some(room=>room.capability==='stale-proof'))return reply({message:'Rotated proof'},403);if(data.rooms.some(room=>room.capability==='new-proof')||data.cursor===undefined)return reply({accountId:'owner',cursor,changed:true});return held(init.signal);};
 const observer=observeQQChanges({rooms:()=>rooms,changed:async()=>{changes++;}});
 try{await until(()=>observer.blockedRooms().has(bad));rooms=rooms.map(room=>room.id===bad?{...room,capability:'new-proof'}:room);const before=changes;observer.checkScope();await until(()=>posts.some(rooms=>rooms.some(room=>room.capability==='new-proof'))&&changes>before);assert(!observer.blockedRooms().has(bad));}finally{observer.stop();await observer.done;}
});
await check('A timed-out validation probe does not prevent the valid scope from reconnecting',async()=>{
 environment();const rooms=[{id:bad,capability:'stale-proof'},{id:good,capability:'good-proof'}];let changes=0;
 globalThis.fetch=async(url,init)=>{if(url.includes('/room-cards/'))return url.includes(bad)?held(init.signal):reply({});const data=JSON.parse(init.body);if(data.rooms.some(room=>room.id===bad))return reply({message:'One invalid proof'},403);if(data.cursor===undefined)return reply({accountId:'owner',cursor,changed:true});return held(init.signal);};
 const observer=observeQQChanges({rooms:()=>rooms,changed:async()=>{changes++;}});
 try{await until(()=>changes>0);assert(observer.blockedRooms().has(bad));}finally{observer.stop();await observer.done;}
});
await check('A successful read is published while another card is still waiting, then its failure is isolated',async()=>{
 let release;const pending=new Promise((_resolve,reject)=>release=reject),published=[],failed=[];
 const batch=refreshCloudIndependently(['waiting','good'],async card=>{if(card==='waiting')await pending;},async()=>{published.push('published');},card=>failed.push(card));
 await tick();assert.equal(published.length,1);assert.equal(failed.length,0);release(Error('Read timed out'));const outcomes=await batch;assert.deepEqual(failed,['waiting']);assert.equal(published.length,2);assert(outcomes.every(outcome=>outcome.status==='fulfilled'));
});
await check('A failed publication does not prevent another card from being published',async()=>{
 let published=0;const outcomes=await refreshCloudIndependently(['one','two'],async()=>{},async()=>{published++;if(published===1)throw Error('Publication failed');},()=>{});assert.equal(published,2);assert(outcomes.some(outcome=>outcome.status==='rejected'));assert(outcomes.some(outcome=>outcome.status==='fulfilled'));
});
for(const repair of ['proof','retry','online'])await check('A guest whose final room is rejected can resume after '+repair,async()=>{
 environment();localStorage.removeItem('dnd-qq-plugin');let rooms=[{id:bad,capability:'stale-proof'}],valid=false,changes=0;const posts=[];
 globalThis.fetch=async(url,init)=>{if(url.includes('/room-cards/'))return reply({},404);const data=JSON.parse(init.body);posts.push(data.rooms);if(!valid)return reply({message:'Deleted room'},404);if(data.cursor===undefined)return reply({accountId:null,cursor,changed:true});return held(init.signal);};
 const observer=observeQQChanges({rooms:()=>rooms,changed:async()=>{changes++;}});
 try{await until(()=>observer.blockedRooms().has(bad));await new Promise(resolve=>setTimeout(resolve,30));valid=true;if(repair==='proof'){rooms=[{id:bad,capability:'new-proof'}];observer.checkScope();}else if(repair==='retry')observer.retry();else window.dispatchEvent(new Event('online'));await until(()=>posts.length>1&&changes>0&&!observer.blockedRooms().has(bad));assert(posts.at(-1)[0].capability===(repair==='proof'?'new-proof':'stale-proof'));}finally{observer.stop();await observer.done;}
});
for(const [status,deadline] of [[503,5000],[404,30000]])await check('Independent '+deadline+'ms retry interrupts a held healthy-room notification and publishes recovery',async()=>{
 environment();const rooms=[{id:bad,capability:'bad-proof'},{id:good,capability:'good-proof'}],posts=[],statuses=[];let initial=true,quarantinedAt=0,recoveredAt=0,changes=0,aborts=0;
 globalThis.fetch=async(url,init)=>{if(url.includes('/room-cards/'))return reply({},url.includes(bad)?status:200);const data=JSON.parse(init.body);posts.push({at:Date.now(),rooms:data.rooms});if(initial){initial=false;return reply({message:'Invalid room'},404);}if(data.rooms.some(room=>room.id===bad)){recoveredAt=Date.now();return reply({accountId:'owner',cursor,changed:false});}if(data.cursor===undefined)return reply({accountId:'owner',cursor,changed:true});init.signal.addEventListener('abort',()=>aborts++,{once:true});return held(init.signal);};
 const observer=observeQQChanges({rooms:()=>rooms,changed:async()=>{changes++;},scopeStatus:values=>{statuses.push(...values);if(values.some(row=>row.room.id===bad&&!row.valid))quarantinedAt=Date.now();}});
 try{await until(()=>quarantinedAt>0);await until(()=>posts.length>=3);const before=changes;await until(()=>recoveredAt>0&&changes>before&&!observer.blockedRooms().has(bad),deadline+1500);const elapsed=recoveredAt-quarantinedAt;assert(elapsed>=deadline-100&&elapsed<=deadline+1000,'Retry starts independently at its deadline');assert(aborts>0);assert(statuses.some(row=>row.room.id===bad&&row.valid));measurements.push({status,deadlineMs:deadline,actualRetryMs:elapsed,requests:posts.length,heldRequestsAborted:aborts,publishedAfterRecovery:true});}finally{observer.stop();await observer.done;}
});
await check('An actually missing notification endpoint still exits to lightweight polling',async()=>{
 environment();let calls=0;globalThis.fetch=async(url)=>{calls++;return reply({},url.includes('/room-cards/')?200:404);};const observer=observeQQChanges({rooms:()=>[{id:good,capability:'good-proof'}],changed:async()=>{}});try{await observer.done;assert.equal(calls,2);assert.equal(observer.blockedRooms().size,0);}finally{observer.stop();}
});
await check('Stopping releases the scheduled retry without a later request',async()=>{
 environment();let calls=0;globalThis.fetch=async(url)=>{calls++;return reply({},url.includes('/room-cards/')?503:404);};const observer=observeQQChanges({rooms:()=>[{id:bad,capability:'bad-proof'}],changed:async()=>{}});await until(()=>observer.blockedRooms().has(bad));observer.stop();await observer.done;const before=calls;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,before);
});
await check('A five-second retry keeps a second thirty-second deadline armed while the first retry is held',async()=>{
 mock.timers.enable({apis:['setTimeout','Date'],now:100000});let observer;
 const settle=async()=>{for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));};
 try{
  environment();const hard='00000000-0000-4000-8000-000000000003',rooms=[{id:bad,capability:'soft-proof'},{id:hard,capability:'hard-proof'},{id:good,capability:'good-proof'}],posts=[];let initial=true,changes=0;
  globalThis.fetch=async(url,init)=>{if(url.includes('/room-cards/'))return reply({},url.includes(bad)?503:url.includes(hard)?404:200);const data=JSON.parse(init.body);posts.push({at:Date.now(),rooms:data.rooms.map(room=>room.id)});if(initial){initial=false;return reply({message:'Invalid scopes'},404);}if(Date.now()>=130000)return reply({accountId:'owner',cursor,changed:false});if(data.rooms.length===1&&data.cursor===undefined)return reply({accountId:'owner',cursor,changed:false});return held(init.signal);};
  observer=observeQQChanges({rooms:()=>rooms,changed:async()=>{changes++;}});await settle();mock.timers.tick(50);await settle();mock.timers.tick(4950);await settle();assert(posts.some(row=>row.at===105000&&row.rooms.includes(bad)&&!row.rooms.includes(hard)));
  mock.timers.tick(25000);await settle();assert(posts.some(row=>row.at===130000&&row.rooms.includes(hard)));assert(changes>0);assert.equal(observer.blockedRooms().size,0);measurements.push({clock:'controlled',fiveSecondRetryAt:105000,thirtySecondRetryAt:130000,recoveredScopePublished:true,posts});
 }finally{observer?.stop();await observer?.done;mock.timers.reset();}
});
writeFileSync(join(out,'result.json'),JSON.stringify({checks:results.length,results,measurements,synthetic:true,realQQ:false,realRoom:false,published:false},null,2)+'\n');
