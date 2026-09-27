import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {WebSocket}=createRequire(new URL('../server/three-dragon/package.json',import.meta.url))('ws');
const out=process.env.TDA_SERVER_OUT||'D:/Temp/DND-card-feedback208/server';
const {createTableService}=await import(pathToFileURL(out+'/service.mjs'));
let failCommit=false;
const service=createTableService({database:':memory:',origin:'http://test.local',hostGraceMs:120,injectFailure(){if(failCommit){failCommit=false;throw Error('storageFailed');}}});
await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+service.server.address().port+'/three-dragon-api/v1',clients=[],checks=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{for(let i=0;i<500;i++){if(fn())return;await pause(10);}throw Error('Timeout '+label);};
async function post(path,value,token){const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value)});assert.ok(r.ok);return r.json();}
async function connect(session){const ws=new WebSocket(url.replace('http:','ws:')+'/socket',{origin:'http://test.local'}),c={ws,session,messages:[]};clients.push(c);ws.on('error',()=>{});ws.on('message',raw=>c.messages.push(JSON.parse(raw)));await new Promise(r=>ws.once('open',r));ws.send(JSON.stringify({type:'auth',room:session.roomId,token:session.token}));await wait(()=>c.messages.some(m=>m.type==='view'),'auth');return c;}
async function command(c,command){const id=crypto.randomUUID();c.ws.send(JSON.stringify({type:'command',id,command}));await wait(()=>c.messages.some(m=>m.id===id),'ack');return c.messages.find(m=>m.id===id);}
const state=id=>JSON.parse(service.db.prepare('SELECT state FROM rooms WHERE id=?').get(id).state);
const pass=s=>{checks.push(s);console.log('PASS '+s);};
async function table(){
 const {room,session}=await post('/rooms',{name:'Creator',externalId:crypto.randomUUID()}),host=await connect(session);
 async function peer(name,role='PLAYER',seat=true){const externalId=crypto.randomUUID(),s=await post('/rooms/'+room.id+'/sessions',{joinKey:room.joinKey,name,externalId});await post('/rooms/'+room.id+'/grants',{memberId:s.memberId,challenge:s.challenge,externalId,role},session.token);const c=await connect(s);if(seat)assert.equal((await command(c,{type:'join'})).ok,true);return c;}
 const alice=await peer('Alice');return {room,host,alice,peer};
}
try{
 const {room,host,alice,peer}=await table(),gm=await peer('DM','GM',false);
 assert.equal((await command(host,{type:'start',options:{startingGold:200}})).ok,true);
 const before=state(room.id),second=await connect(host.session);
 host.ws.terminate();await pause(250);assert.equal(state(room.id).table.hostPlayerId,host.session.memberId);pass('closing one of two creator windows does not transfer');
 second.ws.terminate();const reopened=await connect(host.session);await pause(250);assert.equal(state(room.id).table.hostPlayerId,host.session.memberId);pass('quick refresh within grace retains host');
 failCommit=true;reopened.ws.terminate();await wait(()=>state(room.id).table.hostPlayerId===gm.session.memberId,'automatic GM succession');
 assert.deepEqual(state(room.id).game,before.game);assert.deepEqual(state(room.id).table.seats,before.table.seats);assert.equal(state(room.id).table.revision,before.table.revision+1);pass('disconnect automatically transfers to authenticated GM; failed commit retries without redealing or duplicate revision');
 gm.ws.terminate();await wait(()=>state(room.id).table.hostPlayerId===alice.session.memberId,'seated succession');
 const returned=await connect(host.session);await pause(250);assert.equal(state(room.id).table.hostPlayerId,alice.session.memberId);assert.deepEqual(state(room.id).game,before.game);pass('next online seat inherits host; returning creator does not steal it back');
 assert.equal((await command(returned,{type:'start',options:{}})).ok,false);assert.equal((await command(returned,{type:'omniscient',enabled:true})).ok,false);pass('previous owner loses host-only permissions');
 const active=state(room.id);assert.equal((await command(alice,{type:'leave'})).ok,true);assert.equal(state(room.id).table.hostPlayerId,host.session.memberId);assert.deepEqual(state(room.id).game,active.game);assert.deepEqual(state(room.id).table.seats,active.table.seats);pass('explicit active host leave also preserves game and hands');
 const isolated=await table();isolated.alice.ws.terminate();await pause(30);isolated.host.ws.terminate();await pause(200);assert.equal(state(isolated.room.id).table.hostPlayerId,isolated.host.session.memberId);
 const pending=await post('/rooms/'+isolated.room.id+'/sessions',{joinKey:isolated.room.joinKey,name:'Unverified',externalId:'unverified'});await connect(pending);await pause(200);assert.equal(state(isolated.room.id).table.hostPlayerId,isolated.host.session.memberId);
 await connect(isolated.alice.session);await wait(()=>state(isolated.room.id).table.hostPlayerId===isolated.alice.session.memberId,'late reconnect successor');pass('empty room retains durable game; unverified spectator cannot inherit; admitted seated player can resume');
 assert.equal((await command(returned,{type:'newGame'})).ok,true);pass('new owner can manage the next game');
 mkdirSync('D:/Temp/DND-card-feedback208',{recursive:true});writeFileSync('D:/Temp/DND-card-feedback208/auto-host.json',JSON.stringify({checks,scope:'real local WebSocket + SQLite, short injected grace; no real Owlbear room'},null,2));
}finally{for(const c of clients)c.ws.terminate();await service.close();}
