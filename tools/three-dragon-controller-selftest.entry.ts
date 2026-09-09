import assert from "node:assert/strict";
import { TableController } from "../extensions/three-dragon-ante/src/game/controller";
import type { SeatView } from "../extensions/three-dragon-ante/src/game/rules";
import { createPrivateIdentity, PrivateLink } from "../extensions/three-dragon-ante/src/game/private-channel";
import { ControllerRoom, MemoryStore, gate, pause, until } from "./fixtures/three-dragon-controller-room";

const room = new ControllerRoom(), hostStore = new MemoryStore();
const options = { retryMs: 100, heartbeatMs: 500, timeoutMs: 1800, creationSettleMs: 20 };
let host = new TableController(() => {}, { ...options, platform: room.port("host", "host-old"), storage: hostStore });
const alice = new TableController(() => {}, { ...options, platform: room.port("alice", "alice"), storage: new MemoryStore() });
const bob = new TableController(() => {}, { ...options, platform: room.port("bob", "bob"), storage: new MemoryStore() });
const watcher = new TableController(() => {}, { ...options, platform: room.port("watcher", "watcher"), storage: new MemoryStore() });
const clients = [alice, bob, watcher];
const all = [host, ...clients];
const own = (controller: TableController) => controller.view.game as SeatView;
const ante = (controller: TableController, id = crypto.randomUUID()) => ({ type: "action" as const, action: { id, kind: "ante" as const, seatId: own(controller).selfSeatId, revision: own(controller).revision, cardId: own(controller).hand[0].id } });
try {
  await Promise.all(all.map(controller => controller.start()));
  assert.equal(room.traffic.length, 0, "no table means no key exchange or permanent polling traffic");
  assert.ok(all.every(controller => controller.view.connected && !controller.view.pending && !controller.view.table), "UI create guard must allow an initialized empty room");
  await host.command({ type: "create" });
  await until(() => clients.every(controller => controller.view.connected), "all visitors privately connected to empty lobby");
  await alice.command({ type: "join" }); await until(() => !alice.view.pending && alice.view.table?.seats.length === 2, "Alice joined");
  await bob.command({ type: "join" }); await until(() => !bob.view.pending && bob.view.table?.seats.length === 3, "Bob joined");
  await host.command({ type: "start" });
  await until(() => all.every(controller => controller.view.game?.phase === "ante" && controller.view.connected), "complete game distributed");
  assert.equal(own(alice).hand.length, 6); assert.equal(own(bob).hand.length, 6);
  assert.notDeepEqual(own(alice).hand, own(bob).hand); assert.ok(!("hand" in watcher.view.game!));
  assert.deepEqual(Object.keys(room.table as object).sort(), ["version", "id", "hostPlayerId", "hostConnectionId", "hostName", "stage", "seats", "revision"].sort());
  for (const packet of room.traffic) if (packet.value.kind !== "private") {
    assert.ok(!("game" in packet.value)); assert.ok(!JSON.stringify(packet.value).includes('"hand"'));
  }
  console.log("PASS: no-table idleness, create/join/start, actual private sessions, own hands and public spectator projection");

  const aliceAction = ante(alice, "alice-one"), initialRevision = own(alice).revision;
  room.drop = traffic => traffic.from === "host-old" && traffic.to === "alice" && traffic.value.kind === "private";
  await alice.command(aliceAction);
  await until(() => host.view.game?.revision === initialRevision + 1, "host saved Alice action while ACK lost");
  assert.equal(own(alice).revision, initialRevision);
  room.drop = undefined;
  await alice.command({ type: "retry" });
  await until(() => !alice.view.pending && own(alice).revision === initialRevision + 1, "same action retry receives durable result");
  assert.equal(host.view.game?.revision, initialRevision + 1, "no duplicate rule execution after missing ACK");
  assert.equal(own(alice).hand.length, 5); assert.ok(own(alice).committedAnte);
  assert.equal((watcher.view.game?.seats.find(seat => seat.id === own(alice).selfSeatId))?.handCount, 5);
  console.log("PASS: dropped private ACK retries the original action exactly once without exposing secret ante");

  const bobAction = ante(bob, "bob-one"), beforeFailure = host.view.game?.revision;
  hostStore.failNext = true;
  await bob.command(bobAction);
  await until(() => bob.view.message === "storageFailed", "failed storage reported before acknowledgement");
  assert.equal(host.view.game?.revision, beforeFailure); assert.equal(own(bob).hand.length, 6);
  await bob.command({ type: "retry" });
  await until(() => own(bob).revision === beforeFailure! + 1 && !bob.view.pending, "same command after storage recovery");
  assert.equal(host.view.game?.revision, beforeFailure! + 1);
  console.log("PASS: storage failure does not mutate authoritative state or acknowledge an unsaved action");

  const beforeReset = host.view.game!.id;
  room.failWrite = true;
  await host.command({ type: "newGame" });
  const savedAfterReset = await hostStore.load(room.roomId, host.view.table!.id);
  assert.equal(savedAfterReset?.game, null); assert.equal(savedAfterReset?.table.stage, "lobby");
  assert.equal(host.view.message, "roomFull");
  const savedLobbyRevision = savedAfterReset!.table.revision, savedSerial = savedAfterReset!.serial;
  room.failWrite = false;
  await host.command({ type: "retry" });
  await until(() => !host.view.pending && alice.view.game === null && bob.view.game === null, "saved lobby published and receipt retried");
  assert.equal(host.view.table!.revision, savedLobbyRevision);
  assert.equal((await hostStore.load(room.roomId, host.view.table!.id))!.serial, savedSerial, "retry publishes stored lobby without resetting it twice");
  await bob.command({ type: "leave" }); await until(() => !bob.view.pending && host.view.table!.seats.length === 2, "old participant can leave between games");
  await watcher.command({ type: "join" }); await until(() => !watcher.view.pending && host.view.table!.seats.some(seat => seat.playerId === "watcher"), "new participant can join next lobby");
  await watcher.command({ type: "leave" }); await until(() => !watcher.view.pending && host.view.table!.seats.length === 2, "new participant can leave lobby");
  await bob.command({ type: "join" }); await until(() => !bob.view.pending && host.view.table!.seats.some(seat => seat.playerId === "bob"), "Bob rejoins for remaining regression");
  await host.command({ type: "start" });
  await until(() => !!own(alice)?.hand && !!own(bob)?.hand, "start explicitly deals from prepared lobby");
  const savedGameId = host.view.game!.id; assert.notEqual(savedGameId, beforeReset);
  console.log("PASS: saved newGame lobby survives failed publication/retry; players can change seats before Start deals once");

  const oldHello = [...room.traffic].reverse().find(packet => packet.from === "alice" && packet.to === "host-old" && packet.value.kind === "hello")!;
  const oldReply = [...room.traffic].reverse().find(packet => packet.from === "host-old" && packet.to === "alice" && packet.value.kind === "hello-reply")!;
  const oldPrivate = [...room.traffic].reverse().find(packet => packet.from === "host-old" && packet.to === "alice" && packet.value.kind === "private")!;
  await alice.command({ type: "retry" });
  await until(() => room.traffic.some(packet => packet.from === "host-old" && packet.to === "alice" && packet.value.kind === "hello-reply" && packet.value.sessionId !== oldReply.value.sessionId) && alice.view.connected, "new handshake established");
  room.deliver(oldHello.from, oldHello.to, oldHello.value); room.deliver(oldReply.from, oldReply.to, oldReply.value); room.deliver(oldPrivate.from, oldPrivate.to, oldPrivate.value);
  await pause(40); assert.ok(alice.view.connected); assert.equal(own(alice).id, savedGameId);
  console.log("PASS: old hello/reply/private delivery cannot evict the current active session or roll back the game");

  const delayedAction = ante(alice, "saved-during-host-close"), beforeDelayed = host.view.game!.revision;
  const delay = gate(); hostStore.delay = delay;
  await alice.command(delayedAction);
  await until(() => hostStore.delay === undefined, "host reached delayed persistence boundary");
  assert.equal(host.view.game!.revision, beforeDelayed, "no optimistic authoritative mutation before save completes");
  const oldHost = host; const stopping = oldHost.stop(); room.remove("host-old");
  delay.release(); await stopping;
  await until(() => clients.every(controller => !controller.view.connected), "host offline pauses all clients");
  const durable = await hostStore.load(room.roomId, alice.view.table!.id);
  assert.equal(durable!.game!.revision, beforeDelayed + 1, "a transaction completed during close is retained");
  const noSave = new TableController(() => {}, { ...options, platform: room.port("host", "foreign-browser"), storage: new MemoryStore() });
  await noSave.start(); await until(() => noSave.view.message === "recoveryMissing", "same account without original storage cannot deal a replacement game");
  assert.equal((room.table as any).hostConnectionId, "host-old"); await noSave.stop(); room.remove("foreign-browser");
  host = new TableController(() => {}, { ...options, platform: room.port("host", "host-returned"), storage: hostStore });
  await host.start();
  await until(() => host.view.connected && clients.every(controller => controller.view.connected), "original browser recovers under new SDK connection");
  await alice.command({ type: "retry" });
  await until(() => !alice.view.pending && own(alice).revision === durable!.game!.revision, "lost acknowledgement resolves after host recovery");
  assert.equal(host.view.game!.id, durable!.game!.id); assert.equal(host.view.game!.revision, durable!.game!.revision);
  assert.equal(own(alice).hand.length, 5); assert.equal(own(bob).hand.length, 6);
  console.log("PASS: close during durable action, host offline pause, foreign-browser recovery refusal and original-browser resume with same action ID");

  const beforeReorder = host.view.game!.revision, held: { from: string; to: string; value: any }[] = [];
  let heldMessage: string | undefined;
  room.drop = traffic => {
    if (traffic.from !== "host-returned" || traffic.to !== "alice" || traffic.value.kind !== "private") return false;
    heldMessage ??= traffic.value.messageId;
    if (traffic.value.messageId !== heldMessage) return false;
    held.push(traffic); return true;
  };
  await host.command(ante(host, "host-reorder-ante"));
  await until(() => own(bob).revision === beforeReorder + 1 && held.length > 0, "first durable snapshot held for Alice only");
  await bob.command(ante(bob, "bob-reorder-ante"));
  await until(() => own(alice).revision === beforeReorder + 2, "later snapshot reaches Alice first");
  room.drop = undefined; for (const packet of held) room.deliver(packet.from, packet.to, packet.value);
  await pause(30); assert.equal(own(alice).revision, beforeReorder + 2, "authenticated previously undelivered old snapshot cannot roll back game revision");
  console.log("PASS: a withheld valid private snapshot delivered after a newer game revision cannot overwrite the current hand");

  // A modified client can submit arbitrary JSON. Authenticate it through a
  // real private session, then attempt to act as another player's seat.
  const attackerPort = room.ports.get("watcher")!, attackerIdentity = await createPrivateIdentity();
  const attackerRequest = crypto.randomUUID(); let attackerLink: PrivateLink | undefined; const replies: any[] = [];
  const removeAttacker = attackerPort.onMessage((data: any, sender) => { void (async () => {
    if (sender !== "host-returned") return;
    if (data.kind === "hello-reply" && data.requestId === attackerRequest && !attackerLink) {
      attackerLink = await PrivateLink.create({ roomId: room.roomId, tableId: host.view.table!.id, sessionId: data.sessionId, localConnectionId: "watcher", remoteConnectionId: sender }, attackerIdentity, data.hello);
      for (const packet of await attackerLink.seal({ kind: "sync", requestId: attackerRequest })) await attackerPort.send(packet);
    } else if (data.kind === "private" && attackerLink) { const decoded = await attackerLink.receive(data, sender); if (decoded) replies.push(decoded); }
  })(); });
  await attackerPort.send({ kind: "hello", version: 1, tableId: host.view.table!.id, requestId: attackerRequest, hello: attackerIdentity.hello });
  await until(() => replies.some(reply => reply.kind === "snapshot"), "authenticated malicious spectator established own session");
  assert.ok(!("hand" in replies.find(reply => reply.kind === "snapshot").game));
  const beforeForgery = host.view.game!.revision;
  const forged = { kind: "command", requestId: crypto.randomUUID(), tableId: host.view.table!.id, tableRevision: host.view.table!.revision, gameId: host.view.game!.id,
    playerId: "bob", command: ante(bob, "stolen-seat-action") };
  for (const packet of await attackerLink!.seal(forged)) await attackerPort.send(packet);
  await until(() => replies.some(reply => reply.kind === "receipt" && reply.requestId === forged.requestId), "forged seat rejected at host boundary");
  assert.equal(replies.find(reply => reply.kind === "receipt" && reply.requestId === forged.requestId).error, "notSeated");
  assert.equal(host.view.game!.revision, beforeForgery); removeAttacker(); attackerLink!.dispose();
  console.log("PASS: authenticated modified client cannot claim another player's ID or play their secret hand");

  const latePort = room.port("late", "late"), initialRead = gate(); latePort.delayedRead = initialRead;
  const late = new TableController(() => {}, { ...options, platform: latePort, storage: new MemoryStore() });
  const startingLate = late.start(); await pause(10);
  const newer = structuredClone(room.table) as any; newer.revision++;
  room.setTable(newer); initialRead.release(); await startingLate;
  assert.equal(late.view.table!.revision, newer.revision, "older initial metadata read cannot overwrite subscription update");
  const oldCallback = [...latePort.tableCallbacks][0];
  await late.stop(); await late.start();
  oldCallback(undefined); assert.equal(late.view.table!.id, newer.id, "queued callback from stopped generation cannot clear restarted controller");
  await late.stop(); room.remove("late");
  // Restore the real saved summary after intentionally simulating an impossible
  // unpersisted future metadata event; no product state was written by a host.
  room.setTable(host.view.table);
  console.log("PASS: stale initial room read and prior-lifecycle callback cannot replace current table discovery");

  await Promise.all([host, ...clients].map(controller => controller.stop()));
  assert.equal(room.listeners, 0);
  const trafficCount = room.traffic.length; await pause(150); assert.equal(room.traffic.length, trafficCount);
  console.log("PASS: stop removes listeners, timers and late sends; panel/scene lifecycle is deliberately outside controller");
  const recoveryRoom = new ControllerRoom();
  recoveryRoom.table = { version: 1, id: "one-seat-lost-game", hostPlayerId: "owner", hostConnectionId: "gone", hostName: "Owner", stage: "playing", revision: 7,
    seats: [{ playerId: "owner", seatId: "owner-seat", name: "Owner" }] };
  const missing = new TableController(() => {}, { ...options, platform: recoveryRoom.port("owner", "returned"), storage: new MemoryStore() });
  try {
    await missing.start(); assert.equal(missing.view.message, "recoveryMissing"); await missing.command({ type: "retry" }); assert.equal(missing.view.message, "recoveryMissing");
    assert.equal((recoveryRoom.table as any).revision, 7, "retry alone cannot replace unrecoverable game");
    await missing.command({ type: "newGame" }); assert.equal(missing.view.table!.stage, "lobby"); assert.equal(missing.view.game, null); assert.ok(missing.view.connected);
    await missing.command({ type: "start" }); assert.equal(missing.view.message, "tooFewPlayers"); assert.equal(missing.view.game, null);
  } finally { await missing.stop(); }
  console.log("PASS: explicit missing-archive reset with one seat produces a usable lobby; retry never invents a deck");

  const failingRoom = new ControllerRoom(), failingPort = failingRoom.port("owner", "sdk-retry");
  let readFailed = false; failingPort.self = async () => { if (!readFailed) { readFailed = true; throw Error("SDK unavailable"); } return failingPort.member; };
  const restarting = new TableController(() => {}, { ...options, platform: failingPort, storage: new MemoryStore() });
  try {
    await restarting.start(); assert.equal(restarting.view.connected, false);
    await restarting.command({ type: "retry" }); assert.ok(restarting.view.connected); assert.equal(failingRoom.listeners, 4);
    failingRoom.setTable({ version: 2, id: "future" }); assert.equal(restarting.view.message, "protocolMismatch"); assert.equal(restarting.view.connected, false);
    await restarting.command({ type: "create" }); assert.equal(restarting.view.message, "protocolMismatch");
  } finally { await restarting.stop(); }
  console.log("PASS: failed SDK initialization retries in place without duplicate listeners; incompatible metadata stays blocked");
  console.log("THREE_DRAGON_CONTROLLER: 12 actual-controller/native-crypto integration groups passed (simulated SDK transport/storage; not real Owlbear UAT)");
} finally { await Promise.allSettled([host, ...all].map(controller => controller.stop())); }
