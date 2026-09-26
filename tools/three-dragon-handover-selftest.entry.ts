import assert from 'node:assert/strict';
import {TableController} from '../extensions/three-dragon-ante/src/game/controller';
import {checkInvariants,type SeatView} from '../extensions/three-dragon-ante/src/game/rules';
import {ControllerRoom,MemoryStore,gate,until,pause} from './fixtures/three-dragon-controller-room';
const options={retryMs:250,heartbeatMs:500,timeoutMs:2400,creationSettleMs:15};
async function setup(gm=true){
 const room=new ControllerRoom(),original=new MemoryStore(),successor=new MemoryStore(),hostPort=room.port('host','host'),alicePort=room.port('alice','alice'),gmPort=room.port('dm','dm'),watcherPort=room.port('watcher','watcher');
 if(gm)gmPort.member.role='GM';
 const host=new TableController(()=>{},{...options,platform:hostPort,storage:original}),alice=new TableController(()=>{},{...options,platform:alicePort,storage:gm?new MemoryStore():successor}),dm=new TableController(()=>{},{...options,platform:gmPort,storage:successor}),watcher=new TableController(()=>{},{...options,platform:watcherPort,storage:new MemoryStore()});
 const clients=[host,alice,dm,watcher];await Promise.all(clients.map(c=>c.start()));await host.command({type:'create'});await until(()=>clients.every(c=>c.view.connected),'all peers authenticated');await alice.command({type:'join'});await until(()=>!alice.view.pending&&host.view.table?.seats.length===2,'alice joins');await host.command({type:'start'});await until(()=>clients.every(c=>c.view.game?.phase==='ante'&&c.view.connected),'active table');
 return {room,original,successor,host,alice,dm,watcher,clients};
}
{
 const env=await setup();const {room,original,successor,host,alice,dm,watcher,clients}=env;
 try{
  const before=structuredClone([...original.data.values()][0]),delay=gate();successor.delay=delay;
  await host.command({type:'handover'});await until(()=>host.view.pending,'handover pending');await pause(20);
  assert.equal((room.table as any).hostPlayerId,'host','ownership remains until successor durable ACK');assert.equal(successor.writes,0);assert.deepEqual([...original.data.values()][0].game,before.game);
  // A third authenticated peer still cannot complete somebody else's handover.
  const transfer=(host as any).handoverOut,session=(watcher as any).active.get('host');for(const packet of await session.link.seal({kind:'handover-ready',version:1,id:transfer.id,baseRevision:transfer.baseRevision}))room.broadcast('watcher',packet);
  await pause(15);assert.equal((room.table as any).hostPlayerId,'host');delay.release();
  await until(()=>dm.view.isHost&&dm.view.connected&&!host.view.pending&&alice.view.connected,'GM becomes host after durable receipt');
  const received=[...successor.data.values()][0];assert.deepEqual(received.game,before.game,'deck, private hands, queue, history and action receipts are preserved');assert.deepEqual(received.table.seats,before.table.seats,'active seats preserved');assert.deepEqual(checkInvariants(received.game!),[]);assert.ok(!('hand' in watcher.view.game!));assert.ok(!('privateHands' in watcher.view.game!));
  assert.equal(JSON.stringify(room.table).includes('"deck"'),false);assert.equal(JSON.stringify(room.table).includes('"game"'),false);
  for(const traffic of room.traffic){if(traffic.value.kind==='private'){assert.ok(typeof traffic.value.ciphertext==='string');assert.ok(!('text' in traffic.value));}else assert.ok(!JSON.stringify(traffic.value).includes('"hand"')&&!JSON.stringify(traffic.value).includes('"deck"'));}
  await host.stop();room.remove('host');const own=alice.view.game as SeatView;await alice.command({type:'action',action:{id:'after-transfer',kind:'ante',seatId:own.selfSeatId,revision:own.revision,cardId:own.hand[0].id}});await until(()=>!alice.view.pending&&dm.view.game?.revision===before.game!.revision+1,'new host executes exactly one action');
  const afterAction=structuredClone([...successor.data.values()][0].game);await dm.stop();room.remove('dm');const reconnectPort=room.port('dm','dm-returned');reconnectPort.member.role='GM';const resumed=new TableController(()=>{},{...options,platform:reconnectPort,storage:successor});clients.push(resumed);await resumed.start();await until(()=>resumed.view.isHost&&resumed.view.connected&&alice.view.connected,'successor reload resumes transferred private archive');assert.deepEqual([...successor.data.values()][0].game,afterAction);
  console.log('PASS: active game durable two-phase transfer, GM preference, forged peer rejection, private archive preservation, public privacy and continued play after creator leaves');
 }finally{await Promise.all(clients.map(c=>c.stop()));}
}
{
 const {room,successor,host,alice,clients}=await setup(false);
 try{
  room.drop=traffic=>traffic.from==='alice'&&traffic.to==='host'&&traffic.value.kind==='private';
  await host.command({type:'leave'});await until(()=>successor.writes===1,'successor archive saved despite lost ready');await pause(150);
  assert.equal((room.table as any).hostPlayerId,'host');assert.equal(successor.writes,1,'lost ACK retry does not rewrite archive');
  room.drop=undefined;await host.command({type:'retry'});await until(()=>alice.view.isHost&&alice.view.connected&&!host.view.pending,'same handover finishes after lost ready');assert.equal(successor.writes,1);assert.equal(alice.view.table?.seats.length,2);
  console.log('PASS: active leave hands hosting to the first seated successor, retries lost encrypted ACK without duplicate save or seat deletion');
 }finally{await Promise.all(clients.map(c=>c.stop()));}
}
{
 const {room,original,successor,host,dm,clients}=await setup();const save=successor.save.bind(successor);let fail=true;successor.save=async(...args)=>{if(fail)throw Error('storageFailed');return save(...args);};
 try{
  const before=[...original.data.values()][0].game;await host.command({type:'handover'});await until(()=>host.view.message==='storageFailed','successor storage failure reported');assert.equal((room.table as any).hostPlayerId,'host');assert.equal(successor.writes,0);assert.deepEqual([...original.data.values()][0].game,before);
  fail=false;await host.command({type:'retry'});await until(()=>dm.view.isHost&&dm.view.connected,'same user intent recovered after successor storage available');assert.equal(successor.writes,1);
  console.log('PASS: successor storage failure keeps the original game/owner intact and recovery transfers the same game');
 }finally{await Promise.all(clients.map(c=>c.stop()));}
}
{
 const {room,original,successor,host,dm,clients}=await setup();
 try{
  room.failWrite=true;const game=structuredClone([...original.data.values()][0].game);await host.command({type:'handover'});await until(()=>host.view.message==='roomFull','metadata write failure reported after successor save');assert.equal((room.table as any).hostPlayerId,'host');assert.equal(successor.writes,1);
  room.failWrite=false;await host.command({type:'retry'});await until(()=>dm.view.isHost&&dm.view.connected&&!host.view.pending,'durable transfer completes after metadata recovery');assert.equal(successor.writes,1);assert.deepEqual([...successor.data.values()][0].game,game);
  console.log('PASS: failed public ownership publication retries a previously saved private transfer without rewriting or redealing');
 }finally{await Promise.all(clients.map(c=>c.stop()));}
}
{
 const {room,host,dm,watcher,clients}=await setup();
 try{
  await dm.command({type:'inspect',enabled:true});await until(()=>!!(dm.view.game as any)?.privateHands&&!dm.view.pending,'unseated remote GM inspection');assert.equal((dm.view.game as any).selfSeatId,'');assert.equal(dm.view.canEdit,false);assert.equal(Object.keys((dm.view.game as any).privateHands).length,2);
  await watcher.command({type:'inspect',enabled:true});await until(()=>watcher.view.message==='notAllowed','ordinary spectator denied');assert.ok(!('privateHands' in watcher.view.game!));
  room.ports.get('dm')!.member.role='PLAYER';room.membersChanged();await until(()=>!!dm.view.game&&!('privateHands' in dm.view.game),'demoted GM loses inspection');assert.ok(!('privateHands' in host.view.game!));
  console.log('PASS: unseated remote GM receives authenticated inspection, ordinary spectator is denied and role revocation removes private projection');
 }finally{await Promise.all(clients.map(c=>c.stop()));}
}
{
 const {original,successor,host,dm,clients}=await setup();
 try{
  // A valid long-running controller archive can exceed one PrivateLink message.
  // Seed old durable receipts without changing any rule/game state.
  const saved=structuredClone([...original.data.values()][0]) as any;
  saved.controller={receipts:Array.from({length:80},(_,i)=>({playerId:'host',requestId:`old-${i}`,fingerprint:'x'.repeat(1000)}))};
  const durable=await original.save(saved,saved.serial);(host as any).saved=durable;
  assert.ok(JSON.stringify(durable).length>65536);
  await host.command({type:'handover'});await until(()=>dm.view.isHost&&dm.view.connected&&!host.view.pending,'large private archive reassembled');
  const transferred=[...successor.data.values()][0] as any;
  assert.deepEqual(transferred.game,durable.game);assert.deepEqual(transferred.controller.receipts.slice(0,80),saved.controller.receipts);assert.equal(transferred.controller.receipts.length,81);assert.equal(successor.writes,1);
  console.log('PASS: archive above the single-message limit is encrypted in bounded parts and durably reassembled without losing receipts or private game state');
 }finally{await Promise.all(clients.map(c=>c.stop()));}
}
console.log('THREE_DRAGON_HANDOVER: 6 actual-controller/native-crypto integration groups passed; SDK transport/storage simulated, not real room UAT');
