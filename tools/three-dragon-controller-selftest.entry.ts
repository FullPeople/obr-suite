import assert from "node:assert/strict";
import { TableController } from "../extensions/three-dragon-ante/src/game/controller";
import type { OmniscientView, SeatView } from "../extensions/three-dragon-ante/src/game/rules";
import { createPrivateIdentity, PrivateLink } from "../extensions/three-dragon-ante/src/game/private-channel";
import { ControllerRoom, MemoryStore, gate, pause, until } from "./fixtures/three-dragon-controller-room";
import { validRecovery } from "../extensions/three-dragon-ante/src/game/controller-validation";
import { checkInvariants } from "../extensions/three-dragon-ante/src/game/rules";

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
  assert.deepEqual(Object.keys(room.table as object).sort(), ["version", "id", "hostPlayerId", "hostConnectionId", "hostName", "stage", "seats", "revision", "variant"].sort());
  const hostRevision = host.view.game!.revision;
  host.setOmniscient(true);
  assert.equal((host.view.game as OmniscientView).omniscient, true, "host can enable a local omniscient projection");
  assert.equal(Object.keys((host.view.game as OmniscientView).privateHands).length, 3, "local omniscient projection includes every seat hand");
  assert.equal(host.view.game!.revision, hostRevision, "omniscient inspection does not mutate the game");
  assert.ok(!("privateHands" in alice.view.game!), "other players never receive host-only hand inspection");
  host.setOmniscient(false);
  assert.ok(!("privateHands" in host.view.game!), "host can return to the normal seat projection");
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
  const setupRoom=new ControllerRoom(),setupStore=new MemoryStore();
  let dealer=new TableController(()=>{}, {...options,platform:setupRoom.port("owner","setup-owner"),storage:setupStore});
  const guest=new TableController(()=>{}, {...options,platform:setupRoom.port("guest","setup-guest"),storage:new MemoryStore()});
  try {
    await dealer.start();await guest.start();await dealer.command({type:"create"});
    await until(()=>guest.view.connected&&!!guest.view.table,"setup lobby connected");await guest.command({type:"join"});
    await until(()=>!guest.view.pending&&dealer.view.table?.seats.length===2,"setup guest seated");
    await guest.command({type:"start",options:{startingGold:75,startingHand:8}});
    await until(()=>!guest.view.pending,"unauthorized start replied");assert.equal(guest.view.message,"notHost");assert.equal(dealer.view.game,null);
    for(const invalid of [{startingGold:0},{startingGold:1001},{startingGold:1.5},{startingHand:11},{startingHand:2},{startingGold:"75"},{seed:1},null]){
      await dealer.command({type:"start",options:invalid as any});await until(()=>!dealer.view.pending,"invalid setup replied");assert.equal(dealer.view.message,"invalidCommand");assert.equal(dealer.view.game,null);
    }
    await dealer.command({type:"start",options:{startingGold:75,startingHand:8}});
    await until(()=>guest.view.connected&&!!guest.view.game,"custom game synchronized");
    assert.deepEqual(dealer.view.game!.seats.map(s=>s.gold),[75,75]);assert.equal(own(guest).hand.length,8);assert.equal(dealer.view.game!.deckCount,64);
    const id=dealer.view.game!.id;await dealer.stop();setupRoom.remove("setup-owner");
    dealer=new TableController(()=>{}, {...options,platform:setupRoom.port("owner","setup-returned"),storage:setupStore});await dealer.start();
    await until(()=>dealer.view.connected&&dealer.view.game?.id===id,"custom deal restored");assert.deepEqual(dealer.view.game!.seats.map(s=>s.gold),[75,75]);assert.equal(own(dealer).hand.length,8);
  } finally {await Promise.allSettled([dealer.stop(),guest.stop()]);}
  console.log("PASS: custom starting gold/hand is creator-only, bounds-checked, synchronized and restored without redealing");
  const historyRoom=new ControllerRoom(),historyStore=new MemoryStore();
  let historyHost=new TableController(()=>{}, {...options,platform:historyRoom.port("history-owner","history-owner-old"),storage:historyStore});
  const historyGuest=new TableController(()=>{}, {...options,platform:historyRoom.port("history-guest","history-guest"),storage:new MemoryStore()});
  try {
    await Promise.all([historyHost.start(),historyGuest.start()]);await historyHost.command({type:"create"});
    await until(()=>historyGuest.view.connected&&!!historyGuest.view.table,"history lobby connected");await historyGuest.command({type:"join"});
    await until(()=>!historyGuest.view.pending&&historyHost.view.table?.seats.length===2,"history guest seated");await historyHost.command({type:"start"});
    await until(()=>!!historyGuest.view.game&&historyGuest.view.connected,"history game synchronized");
    const savedHistory=await historyStore.load(historyRoom.roomId,historyHost.view.table!.id),longGame=structuredClone(savedHistory!.game!);
    longGame.history=Array.from({length:600},(_,index)=>({sequence:index+1,revision:longGame.revision,phase:"play" as const,gambit:1,round:1,activeSeatId:null,event:{code:"CARD_PLAYED"}}));
    longGame.historyComplete=true;longGame.events=longGame.history.slice(-100).map(entry=>entry.event);
    await historyStore.save({...savedHistory!,game:longGame},savedHistory!.serial);
    await historyHost.stop();historyRoom.remove("history-owner-old");
    historyHost=new TableController(()=>{}, {...options,platform:historyRoom.port("history-owner","history-owner-returned"),storage:historyStore});await historyHost.start();
    await until(()=>historyHost.view.connected&&historyGuest.view.connected&&!!historyGuest.view.game&&historyGuest.view.game.historyStartSequence>1,"bounded history window delivered");
    const boundedStart=historyGuest.view.game!.historyStartSequence;assert.ok(historyGuest.view.game!.history.length<600);
    await historyGuest.command({type:"history",before:boundedStart});
    await until(()=>!historyGuest.view.pending&&!!historyGuest.view.historyPage,"encrypted history page delivered");
    assert.equal(historyGuest.view.historyPage!.gameId,historyGuest.view.game!.id);assert.ok(historyGuest.view.historyPage!.entries.every(entry=>entry.sequence<boundedStart));
    assert.ok(historyGuest.view.historyPage!.entries.length>0);assert.equal(historyGuest.view.historyPage!.historyComplete,historyGuest.view.historyPage!.entries[0].sequence===1);
    console.log("PASS: long public history is windowed in snapshots and older pages arrive on demand without private fields");
  } finally {await Promise.allSettled([historyHost.stop(),historyGuest.stop()]);}
  // --- lobby kick and the host-side table editor -------------------------
  {
    const lobby = new ControllerRoom(), lobbyStore = new MemoryStore();
    const creator = new TableController(() => {}, { ...options, platform: lobby.port("creator", "creator"), storage: lobbyStore });
    const player = new TableController(() => {}, { ...options, platform: lobby.port("player", "player"), storage: new MemoryStore() });
    const gmPort = lobby.port("gm", "gm"), gm = new TableController(() => {}, { ...options, platform: gmPort, storage: new MemoryStore() });
    const guestPort = lobby.port("guest", "guest"), guest = new TableController(() => {}, { ...options, platform: guestPort, storage: new MemoryStore() });
    // Only the room party read can say who is a GM; the roster the host sees
    // carries the role because the SDK supplies it locally.
    lobby.ports.get("creator")!.member.role = "GM";
    gmPort.member.role = "GM"; guestPort.member.role = "PLAYER";
    lobby.membersChanged();
    try {
      await Promise.all([creator, player, gm, guest].map(controller => controller.start()));
      await creator.command({ type: "create" });
      await until(() => [player, gm, guest].every(controller => controller.view.connected), "kick room connected");
      for (const controller of [player, gm, guest]) await controller.command({ type: "join" });
      await until(() => creator.view.table?.seats.length === 4, "four seats seated");
      assert.equal(creator.view.canKick, true, "the creator may remove a seat in the lobby");
      assert.equal(player.view.canKick, false, "an ordinary seated player may not remove a seat");
      assert.equal(gm.view.canKick, true, "a room GM may remove a seat in the lobby: " + JSON.stringify({ role: gm.view.role, isHost: gm.view.isHost, table: !!gm.view.table, game: !!gm.view.game, seats: gm.view.table?.seats.length }));
      assert.equal(creator.view.canEdit, false, "the editor needs a running game to edit");
      assert.equal(gm.view.canEdit, false, "a GM on someone else's table never holds the private hands");

      await player.command({ type: "kick", playerId: guest.view.selfPlayerId });
      await until(() => player.view.message === "notAllowed", "ordinary player kick rejected");
      assert.equal(creator.view.table!.seats.length, 4, "a rejected kick changes nothing");

      await gm.command({ type: "kick", playerId: guest.view.selfPlayerId });
      await until(() => creator.view.table!.seats.length === 3, "GM kick removed the seat");
      assert.ok(!creator.view.table!.seats.some(seat => seat.playerId === guest.view.selfPlayerId));

      await creator.command({ type: "kick", playerId: creator.view.selfPlayerId });
      await until(() => creator.view.message === "notAllowed", "the creator cannot remove itself");
      assert.equal(creator.view.table!.seats.length, 3, "a self kick changes nothing");

      await creator.command({ type: "kick", playerId: player.view.selfPlayerId });
      await until(() => creator.view.table!.seats.length === 2, "creator kick removed a player");
      assert.ok(!creator.view.table!.seats.some(seat => seat.playerId === player.view.selfPlayerId));

      // Kicking is lobby-only, and the host decides that from its own state.
      await creator.command({ type: "start" });
      await until(() => !!creator.view.game, "game started");
      assert.equal(creator.view.canEdit, true, "the serving creator is offered the editor once the game is dealt when it is the room GM");
      assert.equal(gm.view.canEdit, false, "a GM still never holds another table's private hands");
      assert.equal(creator.view.canKick, false, "seat removal is closed once the game is dealt");
      await gm.command({ type: "kick", playerId: creator.view.selfPlayerId });
      await until(() => gm.view.message === "gameStarted", "kick refused once the game is running");
      assert.ok(!!creator.view.game, "a refused kick leaves the running game intact");

      // Editor authority: the private hands are host-local, so only the host.
      // The editor is host-authoritative: a room GM may edit (the host applies
      // it), an ordinary player may not.
      const editTarget = creator.view.game!.seats[0].id, editBefore = creator.view.game!.seats[0].gold;
      await gm.command({ type: "edit", edit: { kind: "gold", seatId: editTarget, amount: editBefore + 5 } });
      await until(() => creator.view.game!.seats.some(seat => seat.id === editTarget && seat.gold === editBefore + 5), "a room GM edit is applied by the host");
      await guest.command({ type: "edit", edit: { kind: "gold", seatId: editTarget, amount: 999 } });
      await until(() => guest.view.message === "notAllowed", "an ordinary player cannot edit");
      assert.notEqual(creator.view.game!.seats.find(seat => seat.id === editTarget)!.gold, 999);

      // Editor accounting on the live game.
      const target = creator.view.game!.seats[1].id;
      const beforeGold = creator.view.game!.seats[1].gold;
      await creator.command({ type: "edit", edit: { kind: "gold", seatId: target, amount: beforeGold + 7 } });
      await until(() => creator.view.game!.seats.some(seat => seat.id === target && seat.gold === beforeGold + 7), "gold edit applied");
      const saved = await lobbyStore.load(lobby.roomId, creator.view.table!.id);
      assert.ok(!!saved, "edited table is durably saved");
      assert.ok(validRecovery(saved!, lobby.roomId, creator.view.table!), "an edited save still passes recovery conservation");
      assert.deepEqual(checkInvariants(saved!.game!), [], "an edited game keeps every engine invariant");
      assert.equal(saved!.game!.seats.reduce((sum, seat) => sum + seat.gold, 0) + saved!.game!.stakes + saved!.game!.hole, saved!.game!.initialGold, "currency total is conserved by the edit");

      await creator.command({ type: "edit", edit: { kind: "gold", seatId: target, amount: -5 } });
      await until(() => creator.view.message === "invalidEdit", "negative gold refused");
      await creator.command({ type: "edit", edit: { kind: "moveCard", cardId: "not-a-card", toSeatId: null } });
      await until(() => creator.view.message === "invalidEdit", "unknown card refused");

      // Move a card between two hands, then out of play, then swap one for a
      // deck card: every step keeps 80 cards in play and the piles sized.
      creator.setOmniscient(true);
      await until(() => !!(creator.view.game as OmniscientView).privateHands, "host inspection available");
      const inspect = () => creator.view.game as OmniscientView;
      const from = creator.view.game!.seats[0].id, to = creator.view.game!.seats[1].id;
      const moveCard = inspect().privateHands[from][0].id;
      const fromCount = inspect().privateHands[from].length, toCount = inspect().privateHands[to].length;
      await creator.command({ type: "edit", edit: { kind: "moveCard", cardId: moveCard, toSeatId: to } });
      await until(() => inspect().privateHands[to].length === toCount + 1, "card moved between hands");
      assert.equal(inspect().privateHands[from].length, fromCount - 1);
      assert.ok(inspect().privateHands[to].some(card => card.id === moveCard));
      const discardBefore = creator.view.game!.discard.length;
      await creator.command({ type: "edit", edit: { kind: "moveCard", cardId: moveCard, toSeatId: null } });
      await until(() => creator.view.game!.discard.length === discardBefore + 1, "card removed to the discard pile");
      assert.ok(!inspect().privateHands[to].some(card => card.id === moveCard));
      const handCard = inspect().privateHands[to][0].id, deckBefore = creator.view.game!.deckCount, deckCard = inspect().privateDeck![0].id;
      await creator.command({ type: "edit", edit: { kind: "replaceCard", cardId: handCard, withCardId: deckCard } });
      await until(() => creator.view.game!.deckCount === deckBefore, "replacement keeps the deck size");
      assert.ok(inspect().privateHands[to].some(card => card.id === deckCard));
      const afterEdits = await lobbyStore.load(lobby.roomId, creator.view.table!.id);
      assert.ok(validRecovery(afterEdits!, lobby.roomId, creator.view.table!), "card edits also keep the save recoverable");
      assert.deepEqual(checkInvariants(afterEdits!.game!), [], "card edits keep every engine invariant");
      const edited = afterEdits!.game!;
      const inPlay = [...edited.deck, ...edited.discard, ...edited.ante, ...Object.values(edited.committed), ...edited.seats.flatMap(seat => [...seat.hand, ...seat.flight.map(entry => entry.cardId)])];
      assert.equal(inPlay.length, 80, "eighty cards stay in play after host edits");
      assert.equal(edited.excluded.length, 20, "twenty excluded cards stay excluded after host edits");
      console.log("PASS: lobby-only kick authorized by the party role read, and a creator-only editor whose edits keep the save recoverable");
    } finally { await Promise.allSettled([creator, player, gm, guest].map(controller => controller.stop())); }
  }
  console.log("THREE_DRAGON_CONTROLLER: 15 actual-controller/native-crypto integration groups passed (simulated SDK transport/storage; not real Owlbear UAT)");
} finally { await Promise.allSettled([host, ...all].map(controller => controller.stop())); }
