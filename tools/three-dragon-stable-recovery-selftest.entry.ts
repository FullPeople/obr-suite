import assert from 'node:assert/strict';
import { createGame } from '../src/modules/threeDragonAnte/rules';
import { TableController } from '../src/modules/threeDragonAnte/controller';
import { ControllerRoom, MemoryStore, pause, until, gate } from './fixtures/three-dragon-stable-room';
import { legacyLobby } from './fixtures/three-dragon-stable-legacy-room';
import type { TableSummary } from '../src/modules/threeDragonAnte/protocol';
const options = { timeoutMs: 120, retryMs: 25, heartbeatMs: 100, creationSettleMs: 10 };
const active: TableController[] = [];
function client(room: ControllerRoom, id: string, connection = id, role: 'GM' | 'PLAYER' = 'PLAYER', store = new MemoryStore()) {
  const port = room.port(id, connection); port.member.role = role; room.membersChanged();
  const controller = new TableController(() => {}, { ...options, platform: port, storage: store });
  active.push(controller); return { controller, store, port };
}
const summary = (room: ControllerRoom) => room.table as TableSummary;
async function stop() { for (const c of active.splice(0)) await c.stop(); }
try {
  {
    const room = new ControllerRoom(); room.table = legacyLobby(); const before = structuredClone(room.table);
    const a = client(room, 'new-gm', 'gm-a', 'GM'), b = client(room, 'other-gm', 'gm-b', 'GM'), spectator = client(room, 'visitor');
    await Promise.all(active.map(c => c.start()));
    await pause(45); assert.deepEqual(room.table, before, 'missing legacy timestamps never bypass the existing grace');
    await until(() => summary(room).hostPlayerId === 'new-gm' && a.controller.view.connected, 'orphaned legacy lobby recovered by current GM');
    assert.deepEqual(summary(room).seats, (before as TableSummary).seats); assert.equal(summary(room).revision, 8);
    assert.equal(a.store.writes, 1); assert.equal(b.store.writes, 0); assert.equal(spectator.store.writes, 0);
    const save = await a.store.load(room.roomId, summary(room).id); assert.equal(save?.game, null);
    const recovered = structuredClone(room.table); await pause(250); assert.deepEqual(room.table, recovered, 'recovery is idempotent');
    await a.controller.stop(); room.remove('gm-a');
    const reload = client(room, 'new-gm', 'gm-reloaded', 'GM', a.store); await reload.controller.start();
    await until(() => reload.controller.view.connected && summary(room).hostConnectionId === 'gm-reloaded', 'new host reload recovers its archive');
    assert.deepEqual(summary(room).seats, (before as TableSummary).seats);
    await stop(); console.log('PASS legacy missing-fields fixture: GM recovery, preserved seats, competing GMs, idempotency and reload');
  }
  {
    const room = new ControllerRoom(); room.table = legacyLobby(); const a = client(room, 'new-gm', 'a', 'GM'), b = client(room, 'new-gm', 'b', 'GM');
    await Promise.all(active.map(c => c.start())); await until(() => summary(room).hostConnectionId === 'a' && a.controller.view.connected, 'one connection elected for same-player windows');
    await pause(250); assert.equal(a.store.writes, 1); assert.equal(b.store.writes, 0); assert.equal(summary(room).revision, 8);
    await stop(); console.log('PASS simultaneous same-player windows elect one connection');
  }
  {
    const room = new ControllerRoom(); const legacy = legacyLobby(); legacy.seats.push({playerId:'seat-player',seatId:'seat-2',name:'Seated'}); room.table = legacy;
    const seat = client(room, 'seat-player'), gm = client(room, 'new-gm', 'gm', 'GM'); await Promise.all(active.map(c => c.start()));
    await until(() => summary(room).hostPlayerId === 'seat-player' && seat.controller.view.connected, 'online historical seat remains preferred'); assert.equal(gm.store.writes, 0);
    await stop(); console.log('PASS online historical seat has priority over GM fallback');
  }
  {
    const room = new ControllerRoom(); room.table = legacyLobby(); const visitor = client(room, 'visitor'); await visitor.controller.start();
    await pause(300); assert.equal(summary(room).hostPlayerId, 'old-creator'); assert.equal(visitor.store.writes, 0);
    await stop(); console.log('PASS ordinary unseated spectator cannot inherit');
  }
  {
    const room = new ControllerRoom(); room.table = legacyLobby(); room.port('old-creator', 'old-browser'); const gm = client(room, 'new-gm', 'gm', 'GM'); await gm.controller.start();
    await pause(350); assert.equal(summary(room).hostPlayerId, 'old-creator'); assert.equal(gm.store.writes, 0, 'even a silent present host is not stolen by another identity');
    await stop(); console.log('PASS valid current membership retains owner despite legacy missing lease/timestamp');
  }
  {
    const room = new ControllerRoom(); const legacy=legacyLobby(); legacy.seats.push({playerId:'old-peer',seatId:'other-historical-seat',name:'Old peer'}); room.table = {...legacy,stage:'playing'};
    const originalArchive = { version:1,roomId:room.roomId,serial:1,table:structuredClone(room.table),game:createGame({id:'historical-game',seed:42,seats:legacy.seats.map(s=>({id:s.seatId,name:s.name}))}) }; const untouchedArchive=structuredClone(originalArchive); const gm = client(room, 'new-gm', 'gm', 'GM'); const before=structuredClone(room.table); await gm.controller.start();
    await pause(300); assert.deepEqual(room.table,before); assert.equal(gm.store.writes,0); assert.equal(gm.controller.view.message,'legacyArchiveRequired'); assert.deepEqual(originalArchive,untouchedArchive,'private deck, hands, turns, history and results remain untouched');
    await stop(); console.log('PASS active legacy game never resets; missing private archive is explicitly diagnosed');
  }
  {
    const room = new ControllerRoom(); room.table=legacyLobby(); const gm=client(room,'new-gm','gm','GM'); const delayed=gate(); gm.store.delay=delayed; await gm.controller.start();
    await until(()=>gm.store.delay===undefined,'recovery reached storage boundary'); room.port('old-creator','old-browser'); delayed.release(); await pause(250);
    assert.equal(summary(room).hostPlayerId,'old-creator'); assert.equal(summary(room).revision,7,'returning creator prevents publication');
    await stop(); console.log('PASS creator reconnect during local recovery prevents ownership publication');
  }
  {
    const room=new ControllerRoom(); room.table=legacyLobby(); const gm=client(room,'new-gm','gm','PLAYER'); await gm.controller.start();
    await pause(220); const replacement={...legacyLobby(),id:'another-old-table',hostPlayerId:'other-creator',hostConnectionId:'other-browser'}; gm.port.member.role='GM'; for(const notify of gm.port.selfCallbacks) notify(gm.port.member); room.setTable(replacement);
    await pause(45); assert.deepEqual(room.table,replacement,'new table identity receives a fresh full grace');
    await until(()=>summary(room).hostPlayerId==='new-gm','fresh identity grace eventually recovers');
    await stop(); console.log('PASS newly discovered table resets missing-host grace');
  }
  {
    const room=new ControllerRoom(); room.table=legacyLobby(); const gm=client(room,'new-gm','gm','GM'); gm.store.failNext=true; await gm.controller.start();
    await until(()=>gm.controller.view.message==='storageFailed','first legacy recovery save failed'); assert.equal(summary(room).hostPlayerId,'old-creator');
    await until(()=>summary(room).hostPlayerId==='new-gm'&&gm.controller.view.connected,'failed local persistence retries'); assert.equal(gm.store.writes,1); assert.equal(summary(room).revision,8);
    await stop(); console.log('PASS failed legacy save preserves owner and retry commits once');
  }
  {
    const room=new ControllerRoom(); room.table=legacyLobby(); const gm=client(room,'new-gm','gm','GM'); const delayed=gate(); gm.store.delay=delayed; await gm.controller.start();
    await until(()=>gm.store.delay===undefined,'GM recovery reached storage boundary'); gm.port.member.role='PLAYER';
    for(const notify of gm.port.selfCallbacks) notify(gm.port.member); room.membersChanged(); delayed.release(); await pause(250);
    assert.equal(summary(room).hostPlayerId,'old-creator'); assert.equal(summary(room).revision,7,'revoked GM cannot publish its locally prepared claim');
    await stop(); console.log('PASS GM authorization is rechecked after persistence before publication');
  }
  {
    const room=new ControllerRoom(), host=client(room,'creator','creator-original'), player=client(room,'player'), gm=client(room,'gm','gm','GM');
    await Promise.all(active.map(c=>c.start())); await host.controller.command({type:'create'});
    await until(()=>player.controller.view.connected&&gm.controller.view.connected,'stable original private channels connected');
    await player.controller.command({type:'join'}); await until(()=>host.controller.view.table?.seats.length===2,'stable original seat joined');
    await host.controller.command({type:'start'}); await until(()=>!!player.controller.view.game&&!!gm.controller.view.game,'stable original private deal received');
    const tableId=host.controller.view.table!.id, original=await host.store.load(room.roomId,tableId); assert.ok(original?.game); const publicBefore=structuredClone(room.table);
    assert.equal((player.controller.view.game as any).hand.length,6); assert.ok(!('hand' in gm.controller.view.game!),'unseated GM is not silently granted private hands');
    await host.controller.stop(); room.remove('creator-original'); await pause(300);
    assert.deepEqual(room.table,publicBefore,'active stable table is not claimed by seated player or GM'); assert.deepEqual(await host.store.load(room.roomId,tableId),original,'durable private game unchanged');
    const returned=client(room,'creator','creator-returned','PLAYER',host.store); await returned.controller.start();
    await until(()=>returned.controller.view.connected&&player.controller.view.connected&&gm.controller.view.connected,'original stable host reconnects with preserved archive');
    assert.deepEqual((await host.store.load(room.roomId,tableId))?.game,original!.game,'all cards, turns and results survive actual reconnect');
    await stop(); console.log('PASS real stable create/join/deal, private-hand isolation, absent-host nonmutation and original archive reconnect');
  }
  {
    const room=new ControllerRoom(); room.table=legacyLobby(); const first=client(room,'a-gm','a','GM'), second=client(room,'b-gm','b','GM'); const delayed=gate(); first.store.delay=delayed;
    await Promise.all(active.map(c=>c.start())); await until(()=>first.store.delay===undefined,'first elected GM saving'); first.port.member.role='PLAYER';
    for(const notify of first.port.selfCallbacks) notify(first.port.member); room.membersChanged(); delayed.release();
    await until(()=>summary(room).hostPlayerId==='b-gm'&&second.controller.view.connected,'remaining verified GM takes over after role transfer');
    assert.equal(summary(room).revision,8); assert.equal(second.store.writes,1); await pause(200); assert.equal(summary(room).hostPlayerId,'b-gm');
    await stop(); console.log('PASS role transfer during takeover elects remaining eligible GM exactly once');
  }
} finally { await stop(); }
console.log('THREE_DRAGON_STABLE_RECOVERY: 12 actual controller/native-crypto groups; simulated SDK and storage, no live room mutation');
