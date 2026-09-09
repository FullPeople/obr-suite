import assert from "node:assert/strict";
import { TableController } from "../extensions/three-dragon-ante/src/game/controller";
import { readHandGesture, type HandGesture } from "../extensions/three-dragon-ante/src/game/gesture";
import type { SeatView } from "../extensions/three-dragon-ante/src/game/rules";
import { ControllerRoom, MemoryStore, pause, until } from "./fixtures/three-dragon-controller-room";

const room = new ControllerRoom(), received: { seat: string; value: HandGesture | null; at: number }[] = [], sends: { value: any; at: number }[] = [];
const options = { retryMs: 100, heartbeatMs: 500, timeoutMs: 2000, creationSettleMs: 10 };
const host = new TableController(() => {}, { ...options, platform: room.port("host", "host"), storage: new MemoryStore(), onGesture: (seat,value) => received.push({seat,value,at:performance.now()}) });
const port = room.port("alice", "alice"), nativeSend = port.send.bind(port);
port.send = async value => { if ((value as any)?.kind === "gesture") sends.push({value:structuredClone(value),at:performance.now()}); await nativeSend(value); };
const alice = new TableController(() => {}, { ...options, platform: port, storage: new MemoryStore() });
const bob = new TableController(() => {}, { ...options, platform: room.port("bob", "bob"), storage: new MemoryStore() });
const spectator = new TableController(() => {}, { ...options, platform: room.port("watcher", "watcher"), storage: new MemoryStore() });
const controllers = [host, alice, bob, spectator];
const checks: string[] = [], pass = (s: string) => { checks.push(s); console.log("PASS " + s); };
const game = (controller = alice) => controller.view.game as SeatView;
const gesture = (hover: number | null = 0, selected: number[] = []): HandGesture => ({ gameId: game().id, revision: game().revision, count: game().hand.length, hover, selected, sequence: 1 });
const validEnvelope = () => ({ kind: "gesture", version: 1, tableId: alice.view.table!.id, tableRevision: alice.view.table!.revision, playerId: "alice", seatId: game().selfSeatId, gesture: gesture() });
try {
  await Promise.all(controllers.map(c => c.start())); await alice.gesture({ arbitrary: "private card" }); await pause(150);
  assert.equal(room.traffic.length,0); pass("no table/gesture means no keys, storage or gesture polling traffic");
  await host.command({type:"create"}); await until(()=>controllers.every(c=>c.view.connected),"all private links ready");
  await alice.command({type:"join"}); await until(()=>!alice.view.pending&&host.view.table?.seats.length===2,"Alice seated");
  await bob.command({type:"join"}); await until(()=>!bob.view.pending&&host.view.table?.seats.length===3,"Bob seated");
  await host.command({type:"start"}); await until(()=>controllers.every(c=>c.view.connected&&!!c.view.game),"actual game projections");
  const aliceSeat = game().selfSeatId, bobSeat = game(bob).selfSeatId;
  const secret = game().hand[0].id;
  await alice.gesture({...gesture(1,[2]), cardId: secret, hand: game().hand, seatId: bobSeat, role: "GM"});
  await until(()=>received.some(e=>e.seat===aliceSeat&&e.value?.hover===1),"mapped public ordinal");
  const wire = sends.at(-1)!.value;
  assert.deepEqual(Object.keys(wire.gesture).sort(),["gameId","revision","count","hover","selected","sequence"].sort(),"private payload must be stripped before broadcast");
  assert.equal(JSON.stringify(wire).includes(secret),false); assert.equal(wire.playerId,"alice");assert.equal(wire.seatId,aliceSeat);
  assert.ok(wire.gesture.sequence>1,"controller owns wire sequence");
  for (const bad of [{...gesture(),selected:[secret]},{...gesture(),hover:10},{...gesture(),count:11},{...gesture(),selected:[NaN]}]) assert.equal(readHandGesture(bad),null);
  pass("real private hand never escapes; arbitrary extra keys stripped and SDK identity maps own seat");
  const beforeInvalid = sends.length;
  for(const bad of [{...gesture(),gameId:"old-game"},{...gesture(),revision:game().revision+1},{...gesture(),count:game().hand.length-1}]) await alice.gesture(bad);
  await spectator.gesture(gesture());assert.equal(sends.length,beforeInvalid);
  const startInvalid=received.length, envelope=validEnvelope();
  for(const [sender,value] of [["bob",envelope],["watcher",envelope],["gone",envelope],["alice",{...envelope,playerId:"bob",seatId:bobSeat}],["alice",{...envelope,tableRevision:envelope.tableRevision+1}],["alice",{...envelope,gesture:{...gesture(),count:5,sequence:Date.now()+100}}]] as const) room.deliver(sender,"host",value);
  await pause(150);assert.equal(received.length,startInvalid,"SDK sender cannot claim another seat");pass("observer, spoofed sender/seat, stale game/revision/count and unknown connection rejected");

  await alice.clearGesture(); await until(()=>received.at(-1)?.value?.hover===null,"clear delivered");
  const idle=sends.length;await pause(350);assert.equal(sends.length,idle);pass("cleared/idle hand emits no keepalive traffic");
  const startRate=sends.length, requests:Promise<void>[]=[];
  for(let i=0;i<52;i++){requests.push(alice.gesture(gesture(i%6,[i%6])));await pause(20);}
  await Promise.all(requests);
  const movements=sends.slice(startRate);
  for(const item of movements) assert.ok(movements.filter(v=>v.at>=item.at&&v.at<item.at+1000).length<=8,"no rolling second exceeds 8 gesture sends");
  assert.ok(movements.length>=2,"budget check must observe actual sends");pass("52 real controller inputs coalesce under the 8-per-second network budget");
  const beforeClear=sends.length;const clearing=alice.clearGesture();await clearing;
  assert.equal(sends.length,beforeClear+1,"clear is never discarded by sender rate limit");assert.equal(sends.at(-1)!.value.gesture.hover,null);assert.deepEqual(sends.at(-1)!.value.gesture.selected,[]);
  await until(()=>received.at(-1)?.value?.hover===null,"rate-limited close clear reaches receiver");
  pass("clear immediately after movement is queued and delivered, not rate-dropped");

  // Receiver sees a burst even over a congested/hostile channel. Last clear
  // survives its own rate limit; old sequence and future private fields do not.
  const base=Math.max(sends.at(-1)!.value.gesture.sequence+1,Date.now()+1000), receivedStart=received.length;
  for(let i=0;i<20;i++) room.deliver("alice","host",{...validEnvelope(),gesture:{...gesture(i===19?null:0,i===19?[]:[1]),sequence:base+i,hand:[secret]}});
  await until(()=>received.length>receivedStart&&received.at(-1)?.value?.sequence===base+19,"burst final clear");
  assert.ok(received.length-receivedStart<=2);assert.deepEqual(received.at(-1)?.value?.selected,[]);assert.equal(JSON.stringify(received.at(-1)).includes(secret),false);
  const afterBurst=received.length;room.deliver("alice","host",{...validEnvelope(),gesture:{...gesture(2),sequence:base}});await pause(150);assert.equal(received.length,afterBurst);
  pass("receiver burst coalescing retains final clear and rejects replay without private payload leakage");

  // Same SDK connection is now associated with another actual player: clear the
  // prior seat locally, and do not map a delayed old packet to the new seat.
  const oldEnvelope={...validEnvelope(),gesture:{...gesture(2),sequence:base+100}};
  room.deliver("alice","host",oldEnvelope);await until(()=>received.at(-1)?.value?.sequence===base+100,"old context painted");
  port.member={id:"bob",connectionId:"alice",name:"changed"};room.membersChanged();await until(()=>received.at(-1)?.seat===aliceSeat&&received.at(-1)?.value===null,"identity swap clears old seat");
  const afterSwap=received.length;room.deliver("alice","host",{...oldEnvelope,gesture:{...oldEnvelope.gesture,sequence:base+101}});await pause(150);assert.equal(received.length,afterSwap);
  port.member={id:"alice",connectionId:"alice",name:"alice"};room.membersChanged();
  pass("same-connection player identity swap clears old context and rejects delayed packets");

  await alice.gesture(gesture(3,[0]));await until(()=>received.at(-1)?.value?.hover===3,"gesture before disconnect");
  const oldConnectionPacket=structuredClone(sends.at(-1)!.value);room.remove("alice");await until(()=>received.at(-1)?.value===null,"party departure clears immediately");
  const afterLeave=received.length;room.deliver("alice","host",oldConnectionPacket);await pause(150);assert.equal(received.length,afterLeave);
  pass("departed SDK connection loses gesture authority immediately");
  const fresh = new TableController(()=>{}, {...options,platform:room.port("alice","alice-new"),storage:new MemoryStore()});controllers.push(fresh);await fresh.start();
  await until(()=>fresh.view.connected&&!!fresh.view.game,"new connection actual private recovery");
  const freshGame=game(fresh);await fresh.gesture({gameId:freshGame.id,revision:freshGame.revision,count:freshGame.hand.length,hover:4,selected:[],sequence:1});
  await until(()=>received.at(-1)?.value?.hover===4,"new connection points to own hand");
  const afterFresh=received.length;room.deliver("alice","host",oldConnectionPacket);await pause(150);assert.equal(received.length,afterFresh);pass("fresh connection works while old connection replay stays rejected");
  const beforeStop=room.traffic.filter(t=>t.from==="alice-new"&&t.value.kind==="gesture"&&t.to==="host").length;
  await fresh.clearGesture();await fresh.stop();
  await until(()=>received.at(-1)?.value?.hover===null,"clear followed by stop does not cancel cleanup");
  assert.equal(room.traffic.filter(t=>t.from==="alice-new"&&t.value.kind==="gesture"&&t.to==="host").length,beforeStop+1);
  pass("window clear followed by controller teardown flushes exactly one final clear");
  await bob.gesture({gameId:game(bob).id,revision:game(bob).revision,count:game(bob).hand.length,hover:1,selected:[],sequence:1});await until(()=>received.at(-1)?.seat===bobSeat,"Bob gesture active");
  const beforeReset=received.length;await host.command({type:"newGame"});await until(()=>host.view.game===null,"new lobby");assert.ok(received.slice(beforeReset).some(e=>e.seat===bobSeat&&e.value===null));
  await until(()=>bob.view.game===null,"Bob receives new lobby");
  const countAfterReset=room.traffic.filter(t=>t.from==='bob'&&t.value.kind==='gesture').length;await bob.gesture(gesture());
  await pause(150);assert.equal(room.traffic.filter(t=>t.from==='bob'&&t.value.kind==='gesture').length,countAfterReset);pass("new game/lobby invalidates gesture context and rejects old-game sends");
  console.log(JSON.stringify({checks:checks.length,groups:checks,gestureSends:sends.length,scope:"Actual controllers/rules/private projections; SDK transport/storage fixtures, no real-room UAT"},null,2));
} finally { await Promise.all(controllers.map(c=>c.stop())); }
