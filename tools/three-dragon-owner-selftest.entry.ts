import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TableController } from "../extensions/three-dragon-ante/src/game/controller";
import { sdkTablePlatform } from "../extensions/three-dragon-ante/src/game/controller-platform";
import { TABLE_NETWORK, TABLE_ROOM_KEY } from "../extensions/three-dragon-ante/src/game/protocol";
import { projectSeat, type SeatView } from "../extensions/three-dragon-ante/src/game/rules";
import { createPrivateIdentity, PrivateLink } from "../extensions/three-dragon-ante/src/game/private-channel";
import { ControllerRoom, MemoryStore, pause, until } from "./fixtures/three-dragon-controller-room";

// Production controller + SDK adapter + encrypted private sessions. Only the
// SDK transport, party membership and persistence boundaries are simulated.
const room = new ControllerRoom(), store = new MemoryStore();
const options = { retryMs: 100, heartbeatMs: 500, timeoutMs: 1800, creationSettleMs: 20 };
const checks: string[] = [], notes: string[] = [];
const verify = (name: string, result: unknown) => { assert.ok(result, name); checks.push(name); console.log("PASS " + name); };
const actors: TableController[] = [];
const roles = new Map<string, "PLAYER" | "GM">();
const port = (id: string, connection: string, role: "PLAYER" | "GM") => {
  roles.set(connection, role);
  const result = room.port(id, connection);
  Object.assign(result.member, { role });
  return result;
};
const creatorPort = port("ordinary-creator", "creator-live", "PLAYER");
const guestPort = port("ordinary-guest", "guest-live", "PLAYER");
let roleReads = 0, metadataWrites = 0;
(globalThis as any).__ownerTestSDK = {
  room: {
    id: room.roomId,
    getMetadata: async () => ({ [TABLE_ROOM_KEY]: await creatorPort.readTable() }),
    setMetadata: async (metadata: Record<string, unknown>) => {
      assert.deepEqual(Object.keys(metadata), [TABLE_ROOM_KEY], "adapter only writes its own table metadata key");
      metadataWrites++; await creatorPort.writeTable(metadata[TABLE_ROOM_KEY]);
    },
    onMetadataChange: (callback: (metadata: object) => void) => creatorPort.onTable(value => callback({ [TABLE_ROOM_KEY]: value })),
  },
  player: {
    getId: async () => creatorPort.member.id,
    getConnectionId: async () => creatorPort.member.connectionId,
    getName: async () => creatorPort.member.name,
    getRole: async () => { roleReads++; throw Error("owner test forbids DM-role authorization"); },
    onChange: (callback: any) => creatorPort.onSelf(callback),
  },
  party: { getPlayers: () => creatorPort.players(), onChange: (callback: any) => creatorPort.onPlayers(callback) },
  broadcast: {
    sendMessage: async (channel: string, value: unknown, opts: { destination: string }) => {
      assert.equal(channel, TABLE_NETWORK); assert.equal(opts.destination, "REMOTE"); await creatorPort.send(value);
    },
    onMessage: (channel: string, callback: (event: any) => void) => {
      assert.equal(channel, TABLE_NETWORK); return creatorPort.onMessage((data, connectionId) => callback({ data, connectionId }));
    },
  },
};
const creator = new TableController(() => {}, { ...options, platform: await sdkTablePlatform(), storage: store });
const guest = new TableController(() => {}, { ...options, platform: guestPort, storage: new MemoryStore() });
actors.push(creator, guest);
const own = (controller: TableController) => controller.view.game as SeatView;
const archive = () => store.load(room.roomId, (room.table as any).id);
async function rejected(controller: TableController, type: "start" | "newGame", label: string) {
  const before = await archive(), writes = store.writes;
  await controller.command({ type });
  await until(() => !controller.view.pending, label + " receives a terminal receipt");
  verify(label, controller.view.message === "notHost");
  assert.deepEqual(await archive(), before, label + " cannot change the saved game or lobby");
  assert.equal(store.writes, writes, label + " performs no persistence write");
}
async function startGame(controller: TableController, participants: TableController[]) {
  await controller.command({ type: "start" });
  await until(() => participants.every(c => c.view.connected && c.view.game?.phase === "ante"), "new game distributed to all actual sessions");
}
try {
  await Promise.all(actors.map(c => c.start()));
  verify("ordinary PLAYER initializes through the actual SDK adapter without a DM or role query", creator.view.connected && roleReads === 0 && [...roles.values()].every(role => role === "PLAYER"));
  await creator.command({ type: "create" });
  verify("ordinary PLAYER creates the authoritative lobby with its own player and connection identity", creator.view.table?.hostPlayerId === "ordinary-creator" && creator.view.table?.hostConnectionId === "creator-live" && creator.view.table?.stage === "lobby");
  await until(() => guest.view.connected && !!guest.view.table, "ordinary guest opens an actual private connection");
  await guest.command({ type: "join" });
  await until(() => !guest.view.pending && creator.view.table?.seats.length === 2, "ordinary guest joins the lobby");
  verify("ordinary guest joins without receiving ownership", !guest.view.isHost && creator.view.isHost && creator.view.table?.seats.some(seat => seat.playerId === "ordinary-guest"));
  await rejected(guest, "start", "non-creator PLAYER cannot start the lobby");
  await startGame(creator, actors);
  verify("ordinary creator starts and deals a real game while no DM is online", [...roles.values()].every(role => role === "PLAYER") && own(creator).hand.length === 6 && own(guest).hand.length === 6);
  verify("start distributes separate private hands through actual WebCrypto sessions", JSON.stringify(own(creator).hand) !== JSON.stringify(own(guest).hand) && room.traffic.some(packet => packet.value.kind === "private"));
  for (const actor of [creator, guest]) {
    await actor.command({ type: "action", action: { id: crypto.randomUUID(), kind: "ante", seatId: own(actor).selfSeatId, revision: own(actor).revision, cardId: own(actor).hand[0].id } });
    await until(() => !actor.view.pending && !!actor.view.actionReceipt?.ok, "real ante acknowledged without a DM");
    await until(() => own(guest).revision === own(creator).revision, "ante revision reaches both sessions");
  }
  verify("both PLAYER seats can execute and acknowledge real rules without any DM service", own(creator).revision === 2 && own(guest).revision === 2 && roleReads === 0);
  await rejected(guest, "newGame", "non-creator PLAYER cannot return an active game to the lobby");
  const firstGameId = creator.view.game!.id;
  await creator.command({ type: "newGame" });
  await until(() => actors.every(c => c.view.game === null && c.view.table?.stage === "lobby"), "creator reset delivered to all clients");
  verify("ordinary creator can return to the lobby without losing seats", creator.view.table?.seats.length === 2 && (await archive())?.game === null);
  await startGame(creator, actors);
  verify("ordinary creator explicitly starts a distinct new game from that lobby", creator.view.game!.id !== firstGameId && creator.view.game!.revision === 0 && own(guest).hand.length === 6);

  await creator.command({ type: "newGame" });
  await until(() => guest.view.game === null, "prepare lobby before the DM arrives");
  const dmPort = port("online-dm", "dm-live", "GM");
  const dm = new TableController(() => {}, { ...options, platform: dmPort, storage: new MemoryStore() }); actors.push(dm);
  await dm.start(); await until(() => dm.view.connected, "DM privately connects as a spectator");
  verify("an online DM does not replace the ordinary table creator", !dm.view.isHost && dm.view.table?.hostPlayerId === "ordinary-creator" && dm.view.table?.hostConnectionId === "creator-live");
  await rejected(dm, "start", "spectating DM cannot start another player's lobby");
  await dm.command({ type: "join" }); await until(() => !dm.view.pending && creator.view.table?.seats.length === 3, "DM joins as an ordinary table seat");
  await rejected(dm, "start", "seated DM still cannot start another player's lobby");
  await startGame(creator, actors);
  verify("PLAYER creator remains the only authority after a DM joins", own(dm).hand.length === 6 && creator.view.table?.hostPlayerId === "ordinary-creator");
  await rejected(dm, "newGame", "seated DM cannot reset the creator's active game");

  const forgerPort = port("forger", "forger-live", "PLAYER"), identity = await createPrivateIdentity(), helloId = crypto.randomUUID();
  let link: PrivateLink | undefined; const replies: any[] = [], receiveErrors: unknown[] = [];
  const removeForger = forgerPort.onMessage((data: any, sender) => { void (async () => {
    if (sender !== "creator-live") return;
    if (data.kind === "hello-reply" && data.requestId === helloId && !link) {
      link = await PrivateLink.create({ roomId: room.roomId, tableId: creator.view.table!.id, sessionId: data.sessionId, localConnectionId: "forger-live", remoteConnectionId: sender }, identity, data.hello);
      for (const packet of await link.seal({ kind: "sync", requestId: helloId })) await forgerPort.send(packet);
    } else if (data.kind === "private" && link) { const decoded = await link.receive(data, sender); if (decoded) replies.push(decoded); }
  })().catch(error => receiveErrors.push(error)); });
  try {
    await forgerPort.send({ kind: "hello", version: 1, tableId: creator.view.table!.id, requestId: helloId, hello: identity.hello });
    await until(() => replies.some(reply => reply.kind === "snapshot"), "forged client establishes its own authenticated private session");
    const beforeForgery = await archive();
    for (const type of ["start", "newGame"]) {
      const requestId = crypto.randomUUID();
      const forged = { kind: "command", requestId, tableId: creator.view.table!.id, tableRevision: creator.view.table!.revision, gameId: creator.view.game!.id,
        playerId: "ordinary-creator", hostPlayerId: "ordinary-creator", connectionId: "creator-live", role: "GM",
        command: { type, playerId: "ordinary-creator", role: "GM" } };
      for (const packet of await link!.seal(forged)) await forgerPort.send(packet);
      await until(() => replies.some(reply => reply.kind === "receipt" && reply.requestId === requestId), "forged owner command receives an authenticated response");
      verify(`authenticated forged ${type} payload cannot replace the sender's actual player identity`, replies.find(reply => reply.requestId === requestId)?.error === "notHost");
    }
    assert.deepEqual(await archive(), beforeForgery, "forged player/role/connection claims cannot alter any saved state");
    assert.deepEqual(receiveErrors, []);
  } finally { removeForger(); link?.dispose(); room.remove("forger-live"); roles.delete("forger-live"); }

  const secondPort = port("ordinary-creator", "creator-second", "PLAYER"), beforeSecond = await archive();
  const writesBeforeSecond = store.writes;
  const second = new TableController(() => {}, { ...options, platform: secondPort, storage: store }); actors.push(second);
  await second.start(); await until(() => second.view.connected, "same-player second connection syncs while the original owner is live");
  verify("same-player second connection cannot claim a live owner's connection or rewrite its archive", (room.table as any).hostConnectionId === "creator-live" && store.writes === writesBeforeSecond);
  assert.deepEqual(await archive(), beforeSecond);
  notes.push("Owner controls follow authenticated player identity across connections; persistence and recovery retain a single live authoritative connection.");
  await second.command({ type: "start" }); await until(() => !second.view.pending, "same-player remote start receives its result");
  verify("same-player second live connection can request start from the active owner connection", second.view.message === undefined && second.view.game?.id === creator.view.game?.id);
  assert.deepEqual(await archive(), beforeSecond, "start during an existing game remains idempotent");
  await second.command({ type: "newGame" }); await until(() => !second.view.pending && [creator, guest, dm, second].every(c => c.view.game === null), "same-player remote reset completes through the existing authority");
  verify("same-player remote reset preserves the live authoritative connection", (room.table as any).hostConnectionId === "creator-live" && creator.view.table?.stage === "lobby" && creator.view.connected);
  await startGame(second, [creator, guest, dm, second]);
  verify("same-player remote start deals a new game without stealing persistence authority", creator.view.game!.id !== beforeSecond!.game!.id && (room.table as any).hostConnectionId === "creator-live" && (await archive())!.table.hostConnectionId === "creator-live");
  const durable = (await archive())!, oldConnection = durable.table.hostConnectionId;
  await creator.stop(); room.remove(oldConnection); roles.delete(oldConnection);
  await until(() => second.view.connected && (room.table as any).hostConnectionId === "creator-second" && guest.view.connected && dm.view.connected, "same PLAYER recovers only after original connection leaves");
  verify("same-player replacement recovers the exact game under a new connection after the old one disappears", second.view.game?.id === durable.game?.id && second.view.game?.revision === durable.game?.revision && second.view.table?.hostConnectionId === "creator-second");
  assert.deepEqual(second.view.game, projectSeat(durable.game!, durable.table.seats.find(seat => seat.playerId === "ordinary-creator")!.seatId), "recovery preserves the full owner projection including its actual private hand");
  verify("recovery persists only the connection transfer and does not create a replacement deck", (await archive())!.serial === durable.serial + 1 && (await archive())!.game!.id === durable.game!.id);
  await rejected(dm, "newGame", "online DM still cannot reset after ordinary-player recovery");
  await second.command({ type: "newGame" }); await until(() => [second, guest, dm].every(c => c.view.game === null), "recovered creator returns to lobby");
  await startGame(second, [second, guest, dm]);
  verify("recovered ordinary creator can return to lobby and explicitly start again", second.view.game?.id !== durable.game?.id && second.view.table?.hostConnectionId === "creator-second");
  verify("the SDK path never requests DM role and writes only the table's metadata key", roleReads === 0 && metadataWrites > 0);
  await Promise.all(actors.map(c => c.stop()));
  verify("all controller instances release their room subscriptions", room.listeners === 0);
  const traffic = room.traffic.length; await pause(180); verify("stopped owner and guest sessions send no late packets", room.traffic.length === traffic);
  const result = { checks, count: checks.length, notes, roleReads, metadataWrites, scope: "Actual Controller, SDK adapter, rules, projections and native WebCrypto; simulated SDK transport/membership/storage. No Owlbear server or browser UAT claim." };
  writeFileSync(join(process.env.OWNER_TEST_OUTPUT!, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ count: checks.length, output: process.env.OWNER_TEST_OUTPUT }));
} catch (error) {
  writeFileSync(join(process.env.OWNER_TEST_OUTPUT!, "failure.json"), JSON.stringify({ error: String(error), assertion: error instanceof assert.AssertionError ? error.message : null, checks, roleReads, metadataWrites }, null, 2));
  throw error;
} finally { await Promise.allSettled(actors.map(c => c.stop())); }
