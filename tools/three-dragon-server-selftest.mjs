import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const {WebSocket}=createRequire(new URL('../server/three-dragon/package.json',import.meta.url))('ws');
const out=process.env.TDA_SERVER_OUT||'D:/Temp/DND-card-release203-storage/server';
const {createTableService}=await import(pathToFileURL(join(out,'service.mjs')));
const evidence=mkdtempSync('D:/Temp/tda-server203-'),database=join(evidence,'game.sqlite'),origin='http://test.local';
let failCommit=false,service,url,port;const clients=[],checks=[];
const pass=message=>{checks.push(message);console.log('PASS '+message);};
const wait=async(check,label,ms=6000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,5));}};
async function start(){service=createTableService({database,origin,injectFailure(){if(failCommit){failCommit=false;throw Error('storageFailed');}}});await new Promise(r=>service.server.listen(port||0,'127.0.0.1',r));port=service.server.address().port;url='http://127.0.0.1:'+port+'/three-dragon-api/v1';}
async function post(path,data,token){const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
function patch(old,p){const n={...old,...p.set};for(const k of p.remove)delete n[k];return n;}
async function connect(session){
 const ws=new WebSocket(url.replace('http:','ws:')+'/socket',{origin});const c={ws,session,view:null,identity:null,seq:0,messages:[],bytes:0};clients.push(c);
 ws.on('error',()=>{});ws.on('message',data=>{c.bytes+=data.length;const m=JSON.parse(data);c.messages.push(m);if(m.type==='view'){c.view=m.view;c.seq=m.seq;c.identity=m.identity;}if(m.type==='patch'){assert.equal(m.base,c.seq);c.view={...patch(c.view,m.patch),game:m.gamePatch?patch(c.view.game,m.gamePatch):m.game};c.seq=m.seq;}});
 await new Promise((resolve,reject)=>{ws.once('error',reject);ws.once('open',resolve);});ws.send(JSON.stringify({type:'auth',room:session.roomId,token:session.token}));await wait(()=>!!c.view,'authentication');return c;
}
async function command(c,cmd,id=crypto.randomUUID()){
 const at=performance.now(),offset=c.messages.length;c.ws.send(JSON.stringify({type:'command',id,command:cmd}));await wait(()=>c.messages.slice(offset).some(m=>m.id===id&&['ack','history'].includes(m.type)),'command '+cmd.type);
 const reply=c.messages.slice(offset).find(m=>m.id===id&&['ack','history'].includes(m.type));return {...reply,elapsed:performance.now()-at};
}
async function admit(room,owner,session,externalId,role='PLAYER'){const r=await post('/rooms/'+room.id+'/grants',{memberId:session.memberId,challenge:session.challenge,externalId,role},owner.token);assert.equal(r.status,200);}
try{
 await start();const created=await post('/rooms',{name:'Host',externalId:'host'});assert.equal(created.status,201);const {room,session:owner}=created.data,host=await connect(owner),players=[host];
 for(let i=1;i<6;i++){
  const r=await post('/rooms/'+room.id+'/sessions',{joinKey:room.joinKey,name:'Player '+i,externalId:'p'+i,role:'GM'});assert.equal(r.status,201);const c=await connect(r.data);assert.equal(c.view.role,'PLAYER');assert.equal(c.view.message,'admissionPending');
  assert.equal((await command(c,{type:'join'})).ok,false);await admit(room,owner,r.data,'p'+i);await wait(()=>!c.view.message,'admitted');assert.equal((await command(c,{type:'join'})).ok,true);players.push(c);
 }
 await wait(()=>host.view.table.seats.length===6,'six seats');pass('six real WebSocket clients; server-issued seats; unverified admission and forged GM rejected');
 const outsider=await post('/rooms/'+room.id+'/sessions',{joinKey:room.joinKey,name:'Unseated DM',externalId:'dm'}),dm=await connect(outsider.data);
 assert.equal((await command(players[1],{type:'omniscient',enabled:true})).ok,false);
 assert.equal((await post('/rooms/'+room.id+'/grants',{memberId:outsider.data.memberId,challenge:outsider.data.challenge,externalId:'dm',role:'GM'},players[1].session.token)).status,403);
 await admit(room,owner,outsider.data,'dm','GM');await wait(()=>dm.view.role==='GM','GM authorization');
 assert.equal((await command(host,{type:'start',options:{startingGold:200,variant:{ruleSetId:'provided-pack-20260910',deckId:'wheel-of-fate-v1'}}})).ok,true);
 await wait(()=>players.every(c=>c.view.game?.hand?.length),'six dealt hands');
 const state=()=>JSON.parse(service.db.prepare('SELECT state FROM rooms WHERE id=?').get(room.id).state);
 for(const c of players){const own=c.view.game.hand;for(const other of players.filter(x=>x!==c))for(const id of other.view.game.hand)assert.ok(!own.includes(id));assert.equal(c.view.game.privateDeck,undefined);}
 assert.equal((await command(dm,{type:'omniscient',enabled:true})).ok,true);assert.ok(dm.view.game.omniscient);assert.equal(Object.keys(dm.view.game.privateHands).length,6);pass('unseated authorized GM can inspect; ordinary clients never receive deck or opponents hands');
 const before=state(),seat=before.game.seats[1],action={id:'duplicate-action',revision:0,seatId:seat.id,kind:'ante',cardId:seat.hand[0]},cmd={type:'action',gameId:before.game.id,action};
 const denied=await command(players[2],cmd);assert.equal(denied.ok,false);assert.equal(state().game.revision,0);
 const receipt=await command(players[1],cmd,'same-envelope');assert.equal(receipt.ok,true);assert.equal(state().game.revision,1);
 assert.equal((await command(players[1],cmd,'same-envelope')).ok,true);assert.equal((await command(players[1],cmd,'new-envelope')).ok,true);assert.equal(state().game.revision,1);
 assert.equal((await command(players[1],{...cmd,action:{...action,cardId:seat.hand[1]}},'changed-envelope')).ok,false);pass('seat impersonation, duplicate actions, changed retry payload and durable exact action receipt');
 const me=players[2],s=state(),a={id:'rollback-action',revision:s.game.revision,seatId:me.view.game.selfSeatId,kind:'ante',cardId:me.view.game.hand[0]};
 failCommit=true;const failed=await command(me,{type:'action',gameId:s.game.id,action:a},'rollback-envelope');assert.equal(failed.ok,false);assert.equal(state().game.revision,1);
 assert.equal(service.db.prepare('SELECT count(*) n FROM receipts WHERE id=?').get('rollback-envelope').n,0);
 assert.equal((await command(me,{type:'action',gameId:s.game.id,action:a},'rollback-envelope')).ok,true);pass('failed database commit rolls back state, history and receipt; retry commits once');
 const timings=[];
 for(let i=0;i<130;i++){
  await wait(()=>players.every(c=>c.view.game.revision===state().game.revision),'all projections current');
  const actor=players.find(c=>c.view.game.actions?.length);if(!actor)break;const option=actor.view.game.actions[0],g=actor.view.game;
  const action={id:'played-'+i,revision:g.revision,seatId:g.selfSeatId,kind:option.kind};
  if(option.kind==='choose'){action.choiceId=option.choice.id;action.optionIds=option.choice.options.filter(o=>o.id!=='skip').slice(0,Math.max(option.choice.min,Math.min(1,option.choice.max))).map(o=>o.id);}
  else action.cardId=option.cardIds[i%option.cardIds.length];
  const result=await command(actor,{type:'action',gameId:g.id,action});assert.equal(result.ok,true,JSON.stringify(result));timings.push(result.elapsed);
 }
 const saved=state(),ledger=service.db.prepare('SELECT count(*) n FROM history WHERE room=?').get(room.id).n;
 assert.ok(timings.length>=20);assert.ok(ledger>saved.game.history.length);assert.ok(saved.game.history.length<=24);assert.equal(Object.keys(saved.game.accepted).length,0);
 const history=await command(players[1],{type:'history',before:100000});assert.ok(history.page.entries.length>0);pass('legal multi-client play/choices/settlement; bounded live state with complete separate history and on-demand pages');
 const duplicateSession=(await post('/rooms/'+room.id+'/sessions',{joinKey:room.joinKey,name:'Reopened elsewhere',externalId:'p1'})).data,second=await connect(duplicateSession);assert.equal(second.view.game.hand,undefined);
 await admit(room,owner,duplicateSession,'p1');await wait(()=>second.view.selfPlayerId===players[1].view.selfPlayerId,'verified device reconnect');assert.deepEqual(second.view.game.hand,players[1].view.game.hand);pass('another browser cannot claim a seat by ID; verified admission restores the same existing seat');
 service.db.prepare('UPDATE members SET gm_until=0 WHERE id=?').run(dm.session.memberId);
 assert.equal((await command(dm,{type:'omniscient',enabled:true})).ok,false);
 dm.ws.send(JSON.stringify({type:'sync'}));await wait(()=>dm.view.role==='PLAYER','expired GM lease');assert.equal(dm.view.game.privateHands,undefined);
 assert.equal((await post('/rooms/'+room.id+'/grants',{memberId:dm.session.memberId,challenge:dm.session.challenge,externalId:'dm',role:'GM'},dm.session.token)).status,403);
 await admit(room,owner,dm.session,'dm','GM');await wait(()=>dm.view.role==='GM','renewed verified role');
 await admit(room,owner,dm.session,'dm','PLAYER');await wait(()=>dm.view.role==='PLAYER','demoted role');assert.equal(dm.view.game.privateHands,undefined);
 pass('expired or demoted GM immediately loses private inspection and cannot renew their own authorization');
 const revision=state().game.revision;for(const c of clients)c.ws.close();await service.close();await start();const recovered=await connect(owner);assert.equal(recovered.view.game.revision,revision);
 const reGuest=await connect(players[1].session);assert.deepEqual(reGuest.view.game.hand,second.view.game.hand);pass('real service restart recovers game, private seat credentials and committed action history');
 assert.equal((await command(recovered,{type:'handover'})).ok,true);await wait(()=>reGuest.view.isHost,'handed over owner');recovered.ws.terminate();
 assert.equal((await command(reGuest,{type:'newGame'})).ok,true);assert.equal((await command(reGuest,{type:'start',options:{startingGold:200,variant:{ruleSetId:'provided-pack-20260910',deckId:'wheel-of-fate-v1'}}})).ok,true);
 pass('host handover survives original owner disconnect and the successor can start the next game');
 const stats={checks:checks.length,played:timings.length,p50Ms:timings.sort((a,b)=>a-b)[Math.floor(timings.length*.5)],p95Ms:timings[Math.floor(timings.length*.95)],maxMs:Math.max(...timings),historyEntries:ledger,liveHistory:saved.game.history.length,rss:process.memoryUsage().rss,scope:'Real local WebSocket, SQLite and rules. No real Owlbear room or production WAN.'};
 writeFileSync(join(evidence,'result.json'),JSON.stringify({checks,stats},null,2));console.log(JSON.stringify(stats));console.log(evidence);
}finally{for(const c of clients)c.ws.terminate();await service?.close();}
