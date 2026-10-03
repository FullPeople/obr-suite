import assert from 'node:assert/strict';
import {ServerTableClient} from '../extensions/three-dragon-ante/src/game/server-client';
import {seatPlacements} from '../extensions/three-dragon-ante/src/game/stage/layout';
import {createGame,projectSeat,projectPublic} from '../extensions/three-dragon-ante/src/game/rules';
import {packSeat,packPublic} from '../extensions/three-dragon-ante/src/game/wire';
import type {TableView} from '../extensions/three-dragon-ante/src/game/protocol';
import type {ServerSession} from '../extensions/three-dragon-ante/src/game/server-protocol';

const checks:string[]=[];
const pass=(name:string)=>{checks.push(name);console.log('PASS '+name);};
const names=['Aurelia the exceptionally long-named gold dragon'.repeat(2),'北境的旅人有一个特别特别特别长的名字'.repeat(3),'Cyra','Dorian','Elara','Finn'];
function game(n=5,id='finished-game'){
 const state=createGame({id,seed:7341,seats:Array.from({length:n},(_,i)=>({id:'s'+i,name:names[i]}))});
 state.stage='ended';state.winners=['s0'];return state;
}
// Test the actual layout in every player's projection plus a spectator. Names
// must retain their physical seat's tangent coordinate, not just the edge angle.
for(let count=2;count<=6;count++){
 const state=game(count);
 for(const self of [null,...state.seats.map(s=>s.id)]){
  const view=self?projectSeat(state,self):projectPublic(state),seats=seatPlacements(view);
  for(const seat of seats){
   assert.ok(Math.abs((seat.name.x-seat.x)*seat.nz-(seat.name.z-seat.z)*seat.nx)<1e-9,'name keeps the seat tangent offset');
   assert.ok(Math.abs(Math.hypot(seat.name.x-seat.x,seat.name.z-seat.z)-1.45)<1e-9,'name stays beside its own seat');
  }
  for(let i=0;i<seats.length;i++)for(let j=i+1;j<seats.length;j++)assert.ok(Math.hypot(seats[i].name.x-seats[j].name.x,seats[i].name.z-seats[j].name.z)>2.4,'each name has a distinct, non-overlapping world anchor');
  if(self)assert.equal(seats.find(s=>s.self)?.id,self);
 }
}
pass('2–6 players, all 20 seated viewpoints and five spectator views keep names at distinct physical seats');

class MemoryStorage {
 values=new Map<string,string>();getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);}removeItem(k:string){this.values.delete(k);}
}
const storage=new MemoryStorage();Object.defineProperty(globalThis,'sessionStorage',{value:storage,configurable:true});
class Socket {
 static OPEN=1;static all:Socket[]=[];readyState=0;bufferedAmount=0;sent:any[]=[];fail=false;
 onopen?:()=>void;onmessage?:(e:{data:string})=>void;onclose?:()=>void;onerror?:()=>void;
 constructor(_url:string){Socket.all.push(this);}
 open(){this.readyState=1;this.onopen?.();}
 receive(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
 send(value:string){if(this.fail)throw Error('send failed');this.sent.push(JSON.parse(value));}
 close(){this.readyState=3;this.onclose?.();}
 last(){return this.sent.findLast(m=>m.type==='command');}
 ack(ok=true,code?:string){this.receive({type:'ack',id:this.last().id,ok,code});}
}
Object.defineProperty(globalThis,'WebSocket',{value:Socket,configurable:true});
const initial=game(),clients:ServerTableClient[]=[];
function projection(memberId:string,owner:boolean,state=initial,seated=true){return {
 actionReceiptVersion:1,table:{version:1,id:'table',hostPlayerId:'s0',hostConnectionId:'server',hostName:names[0],stage:state.stage==='ended'?'ended':'playing',revision:0,seats:state.seats.filter(s=>seated||s.id!==memberId).map(s=>({playerId:s.id,seatId:s.id,name:s.name}))},
 selfPlayerId:memberId,isHost:owner,role:'PLAYER',connected:true,pending:false,game:seated?packSeat(projectSeat(state,memberId)):packPublic(projectPublic(state)),
};}
function client(memberId:string,owner=false,roomId='room'){
 const session:ServerSession={roomId,memberId,owner,role:'PLAYER',token:'fake-session-for-unit-test'};
 const seen:TableView[]=[];let stalls=0;
 const value=new ServerTableClient(session,v=>seen.push(structuredClone(v)),()=>{},()=>{},()=>stalls++);clients.push(value);value.start();
 const socket=Socket.all.at(-1)!;socket.open();socket.receive({type:'view',seq:1,view:projection(memberId,owner)});
 return {value,socket,seen,get stalls(){return stalls;}};
}
try{
 for(const owner of [false,true]){
  storage.values.clear();const member=owner?'s0':'s1',a=client(member,owner),peer=client('s2');const original=JSON.stringify(projection(member,owner)),peerBefore=JSON.stringify(peer.value.view);
  const sending=a.value.command({type:'leave'});
  assert.equal(a.value.view.game,null,'finished leave returns main screen before acknowledgement');assert.equal(a.value.view.pending,true);await sending;
  await assert.rejects(a.value.command({type:'leave'}),/privateSync/);assert.equal(a.socket.sent.filter(m=>m.type==='command').length,1,'repeated click cannot enqueue another leave');
  assert.deepEqual(Object.keys(a.socket.last()).sort(),['command','id','type'],'local dismissal state is never sent to server');
  const envelope=structuredClone(a.socket.last());await a.value.command({type:'retry'});assert.deepEqual(a.socket.last(),envelope,'retry uses same envelope');
  a.socket.receive({type:'view',seq:2,view:projection(member,owner,initial,false)});assert.equal(a.value.view.game,null,'broadcast before acknowledgement cannot reopen result');
  a.socket.ack();assert.equal(a.value.view.pending,false);assert.equal(a.value.view.game,null);
  assert.equal(JSON.stringify(peer.value.view),peerBefore,'peer game is unchanged');assert.equal(JSON.stringify(projection(member,owner)),original,'authoritative game remains intact');
  a.socket.receive({type:'patch',base:2,seq:3,patch:{set:{isHost:false},remove:[]},gamePatch:{set:{},remove:[]}});assert.equal(a.value.view.game,null,'ownership broadcast does not reopen completed game');
  a.value.stop();const refreshed=client(member,owner);assert.equal(refreshed.value.view.game,null,'confirmed exit survives same-tab refresh');
  await refreshed.value.command({type:'join'});refreshed.socket.ack(false,'tableFull');assert.equal(refreshed.value.view.game,null,'rejected join remains on main screen');
  await refreshed.value.command({type:'join'});refreshed.socket.ack();assert.equal(refreshed.value.view.game?.id,initial.id,'successful join reopens intact result');
  await refreshed.value.command({type:'leave'});refreshed.socket.ack();assert.equal(refreshed.value.view.game,null);
  const next=game(5,'next-game');next.stage='ante';refreshed.socket.receive({type:'view',seq:4,view:projection(member,owner,next)});assert.equal(refreshed.value.view.game?.id,'next-game','another game never stays hidden');
  const otherRoom=client(member,owner,'another-room');assert.equal(otherRoom.value.view.game?.id,initial.id,'dismissal is scoped to room and identity');
  for(const c of [peer.value,refreshed.value,otherRoom.value])c.stop();
 }
 pass('Owner and nonowner: immediate exit, repeated clicks, exact retry, refresh, rejoin, next game and peer preservation');
 storage.values.clear();const denied=client('s1');await denied.value.command({type:'leave'});denied.socket.ack(false,'storageFailed');assert.equal(denied.value.view.game?.id,initial.id,'rejected leave restores completed result');assert.equal(denied.value.view.message,'storageFailed');assert.equal(storage.values.size,0);
 denied.socket.fail=true;await assert.rejects(denied.value.command({type:'leave'}),/send failed/);assert.equal(denied.value.view.game?.id,initial.id,'transport failure restores result');assert.equal(denied.value.view.pending,false);denied.socket.fail=false;
 await denied.value.command({type:'leave'});const retry=structuredClone(denied.socket.last());denied.socket.close();assert.equal(denied.stalls,1);await denied.value.command({type:'retry'});
 const reconnected=Socket.all.at(-1)!;reconnected.open();reconnected.receive({type:'view',seq:1,view:projection('s1',false)});assert.deepEqual(reconnected.last(),retry,'reconnect resends same leave');assert.equal(denied.value.view.game,null);reconnected.ack();assert.equal(denied.value.view.game,null);
 pass('Rejected/send-failed leaves restore results; interrupted leave reconnects idempotently without reopening it');
 storage.values.clear();const active=client('s1'),live=game();live.stage='ante';active.socket.receive({type:'view',seq:2,view:projection('s1',false,live)});await active.value.command({type:'leave'});assert.equal(active.value.view.game?.id,live.id,'active game must never be dismissed');active.socket.ack(false,'cannotLeave');assert.equal(active.value.view.game?.id,live.id);
 pass('Active games never get dismissed by completed-game navigation');
 storage.values.clear();const superseded=client('s0',true);await superseded.value.command({type:'leave'});const oldId=superseded.socket.last().id;superseded.socket.close();await superseded.value.command({type:'retry'});
 const newSocket=Socket.all.at(-1)!;newSocket.open();const replacement=game(5,'replacement-after-disconnect');replacement.stage='ante';newSocket.receive({type:'view',seq:1,view:projection('s0',true,replacement)});
 assert.equal(newSocket.sent.filter(m=>m.type==='command').length,0,'reconnect cannot resend old completed Leave into new game');assert.equal(superseded.value.view.pending,false);assert.equal(superseded.value.view.game?.id,replacement.id);
 newSocket.receive({type:'ack',id:oldId,ok:true});assert.equal(superseded.value.view.game?.id,replacement.id,'late old ACK cannot dismiss new game');assert.equal(superseded.value.view.isHost,true);
 pass('New game on reconnect cancels stale completed Leave before resend; late ACK cannot affect replacement');

 console.log(JSON.stringify({passed:true,checks}));
}finally{for(const c of clients)c.stop();}
