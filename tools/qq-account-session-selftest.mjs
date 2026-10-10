import assert from 'node:assert/strict';
import {acceptQQSession,clearQQSession,qqSession,QQ_STORAGE} from '../src/modules/characterCards/qq-account.ts';
const storage=new Map(),events=[];globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};globalThis.window={dispatchEvent:event=>events.push(event.type)};
const token='synthetic-personal-token-0123456789',candidate={token,expiresAt:Date.now()+60000,accountId:'owner',nickname:'unverified-name',csrf:'unverified-csrf'};
let profile={authenticated:true,account:{id:'owner',nickname:'verified-name'},csrf:'verified-csrf'},status=200,calls=0;
globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://dnd.center/api/session');assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.credentials,'omit');return new Response(JSON.stringify(profile),{status});};
let count=0;async function check(name,fn){await fn();console.log('PASS',++count,name);}
await check('Malformed or expired sessions are rejected before HTTP',async()=>{for(const value of [null,{}, {...candidate,token:'short'}, {...candidate,expiresAt:0}])await assert.rejects(()=>acceptQQSession(value),/无效/);assert.equal(calls,0);});
await check('The server verifies identity before the private host stores a session',async()=>{await acceptQQSession(candidate);assert.equal(qqSession().accountId,'owner');assert.equal(qqSession().nickname,'verified-name');assert.equal(qqSession().csrf,'verified-csrf');assert.deepEqual(events,['qq-account-changed']);});
const original=storage.get(QQ_STORAGE);
await check('A different account cannot replace an existing session',async()=>{await assert.rejects(()=>acceptQQSession({...candidate,accountId:'other'}),/已失效/);assert.equal(storage.get(QQ_STORAGE),original);});
await check('Expired server authority or an HTTP failure leaves the old session intact',async()=>{profile={authenticated:false};await assert.rejects(()=>acceptQQSession(candidate),/已失效/);status=503;await assert.rejects(()=>acceptQQSession(candidate),/已失效/);assert.equal(storage.get(QQ_STORAGE),original);});
await check('Logout clears only the matching personal host session',async()=>{clearQQSession('another-token');assert.equal(storage.get(QQ_STORAGE),original);clearQQSession(token);assert.equal(qqSession(),undefined);assert.deepEqual(events,['qq-account-changed','qq-account-changed']);});
console.log(`QQ personal host connection: ${count} scenarios passed.`);
