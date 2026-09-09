import assert from "node:assert/strict";
import { TableController } from "../extensions/three-dragon-ante/src/game/controller";
import type { SeatView } from "../extensions/three-dragon-ante/src/game/rules";
import type { TableView } from "../extensions/three-dragon-ante/src/game/protocol";
import { localViewParts, LocalViewReceiver } from "../extensions/three-dragon-ante/src/game/local-view";
import { ControllerRoom, MemoryStore, gate, pause, until } from "./fixtures/three-dragon-controller-room";

// Real controllers, rules, projections, LOCAL framing and native WebCrypto.
// Only room delivery/storage are simulated. Narrow access below observes the
// original request nonce and sends intentionally bad *authenticated* host data.
const room = new ControllerRoom(), store = new MemoryStore();
const options = { retryMs: 10000, heartbeatMs: 30000, timeoutMs: 60000, creationSettleMs: 5 };
const emitted: Record<string, TableView[]> = { host: [], alice: [], bob: [] };
const host = new TableController(v => emitted.host.push(v), { ...options, platform: room.port("host", "host"), storage: store });
const alice = new TableController(v => emitted.alice.push(v), { ...options, platform: room.port("alice", "alice"), storage: new MemoryStore() });
const bob = new TableController(v => emitted.bob.push(v), { ...options, platform: room.port("bob", "bob"), storage: new MemoryStore() });
const all = [host, alice, bob];
const own = (c: TableController) => c.view.game as SeatView;
const internals = (c: TableController) => c as any;
const ante = (c: TableController, id: string) => ({ type: "action" as const, action: { id, kind: "ante" as const,
  revision: own(c).revision, seatId: own(c).selfSeatId, cardId: own(c).hand[0].id } });
const commandReceipt = (c: TableController, ok: boolean, error?: string) => ({ requestId: internals(c).pending.request.requestId, ok, ...(error ? { error } : {}) });
async function hostPacket(to: string, payload: unknown) {
  const session = internals(host).active.get(to);
  assert.ok(session, `Active private session for ${to}`);
  for (const packet of await session.link.seal(payload)) room.deliver("host", to, packet);
  await pause(20);
}
function expected(c: TableController, action: ReturnType<typeof ante>, ok = true, code?: string, retryable?: boolean) {
  return { actionId: action.action.id, tableId: c.view.table!.id, gameId: own(c).id,
    revision: action.action.revision + (ok ? 1 : 0), ok, source: "host", ...(code ? { code, retryable } : {}) };
}
const retryAction = (c: TableController, original: ReturnType<typeof ante>) => ({ type: "retry" as const, tableId: c.view.table!.id, gameId: own(c).id, action: structuredClone(original.action) });
// Models only the LOCAL delivery ambiguity, without bypassing the real
// background controller once delivered. No UI or transport source is replaced.
async function failedLocalSend(c: TableController, command: ReturnType<typeof ante>, delivered: boolean) {
  if (delivered) await c.command(command);
  throw Error("LOCAL delivery acknowledgement failed");
}
async function reset() {
  await host.command({ type: "newGame" });
  await until(() => all.every(c => c.view.game === null && !c.view.pending), "lobby reset");
  assert.ok(all.every(c => !c.view.actionReceipt), "Authoritative lobby clears previous action receipts");
  await host.command({ type: "start" });
  await until(() => all.every(c => c.view.game?.phase === "ante" && !c.view.pending), "new game");
}
let groups = 0;
function passed(label: string) { groups++; console.log(`PASS ${groups}: ${label}`); }
try {
  await Promise.all(all.map(c => c.start())); await host.command({ type: "create" });
  await until(() => alice.view.connected && bob.view.connected, "initial handshake");
  await alice.command({ type: "join" }); await until(() => !alice.view.pending && host.view.table!.seats.length === 2, "Alice join");
  await bob.command({ type: "join" }); await until(() => !bob.view.pending && host.view.table!.seats.length === 3, "Bob join");
  await host.command({ type: "start" });
  await until(() => all.every(c => c.view.game?.phase === "ante"), "initial deal");
  assert.ok(all.every(c => !c.view.actionReceipt), "Create/join/start never masquerade as a rules action receipt");

  const first = ante(host, "host-delayed-save"), hold = gate(); store.delay = hold;
  const applying = host.command(first);
  await until(() => store.delay === undefined, "host entered delayed save");
  assert.equal(host.view.pending, true); assert.equal(host.view.actionReceipt, undefined, "No local success before durable save");
  hold.release(); await applying;
  assert.deepEqual(host.view.actionReceipt, expected(host, first));
  const successViews = emitted.host.filter(v => v.actionReceipt?.actionId === first.action.id && v.actionReceipt.ok);
  assert.ok(successViews.length && successViews.every(v => v.game?.id === v.actionReceipt!.gameId && v.game!.revision >= v.actionReceipt!.revision), "Every local success is emitted with an authoritative projection");
  const receiver = new LocalViewReceiver("receipt-window"); let decoded: TableView | undefined;
  for (const part of localViewParts(host.view, "receipt-window", 1).reverse()) decoded = receiver.receive(part) ?? decoded;
  assert.deepEqual(decoded!.actionReceipt, expected(host, first), "Actual LOCAL packing retains the exact receipt");
  assert.deepEqual(Object.keys(decoded!.actionReceipt!).sort(), ["actionId", "tableId", "gameId", "revision", "ok", "source"].sort(), "LOCAL receipt contains no card, choice or private-hand data");
  passed("local save boundary, exact action receipt and lossless LOCAL projection");

  await until(() => own(alice).revision === own(host).revision, "Alice has host ante");
  const lost = ante(alice, "alice-lost-ack");
  room.drop = t => t.from === "host" && t.to === "alice" && t.value.kind === "private";
  await alice.command(lost);
  await until(() => own(host).revision === lost.action.revision + 1, "Alice action persisted without ACK");
  const receipt = commandReceipt(alice, true);
  room.drop = undefined;
  // Deliver a normal current snapshot, deliberately without its earlier ACK.
  await internals(host).snapshot("alice");
  await until(() => own(alice).revision === lost.action.revision + 1, "independent current snapshot");
  assert.equal(alice.view.actionReceipt, undefined, "A newer authoritative revision is not an action ACK");
  await hostPacket("alice", { kind: "receipt", requestId: "unrelated-request", ok: true });
  assert.equal(alice.view.actionReceipt, undefined, "Unmatched requestId cannot acknowledge an outstanding action");
  assert.equal(alice.view.pending, true);
  passed("dropped ACK, unrelated updates and wrong request identity stay unacknowledged");

  // Same genuine request nonce in an invalid snapshot must not clear pending.
  const session = internals(host).active.get("alice");
  await hostPacket("alice", { kind: "snapshot", requestId: session.requestId, table: host.view.table,
    game: { version: 1, id: own(host).id, revision: own(host).revision }, receipt });
  assert.equal(alice.view.actionReceipt, undefined, "Invalid private snapshot cannot produce an early receipt");
  assert.equal(alice.view.pending, true);
  await until(() => own(bob).revision === own(host).revision, "Bob has current state");
  await bob.command(ante(bob, "bob-after-alice"));
  await until(() => own(alice).revision === lost.action.revision + 2, "later other-player action");
  assert.equal(alice.view.actionReceipt, undefined, "Other player's actual receipt is never projected to Alice");
  const beforeRetry = own(host).revision;
  await alice.command(retryAction(alice, lost));
  await until(() => !!alice.view.actionReceipt?.ok, "retry returns genuine original result");
  assert.deepEqual(alice.view.actionReceipt, expected(alice, lost), "Late ACK uses original applied revision, not latest snapshot revision");
  assert.equal(own(host).revision, beforeRetry, "Same action retry does not execute rules twice");
  const remoteSuccess = emitted.alice.filter(v => v.actionReceipt?.actionId === lost.action.id && v.actionReceipt.ok);
  assert.ok(remoteSuccess.length && remoteSuccess.every(v => v.game?.id === v.actionReceipt!.gameId && v.game!.revision >= v.actionReceipt!.revision), "Remote ACK and validated state arrive atomically");
  passed("bad snapshots rejected; delayed ACK follows its exact action after unrelated play");

  await reset();
  const failing = ante(alice, "alice-retry-save"); store.failNext = true;
  await alice.command(failing);
  await until(() => alice.view.actionReceipt?.code === "storageFailed", "real storage rejection");
  assert.deepEqual(alice.view.actionReceipt, expected(alice, failing, false, "storageFailed", true));
  assert.equal(own(host).revision, failing.action.revision); assert.equal(alice.view.pending, false);
  const retryHold = gate(); store.delay = retryHold;
  await alice.command({ type: "retry" });
  await until(() => store.delay === undefined, "retry save blocked");
  assert.equal(alice.view.actionReceipt, undefined, "Starting retry clears its previous failure outcome");
  retryHold.release(); await until(() => !!alice.view.actionReceipt?.ok, "saved retry ACK");
  assert.deepEqual(alice.view.actionReceipt, expected(alice, failing));
  passed("real transient failure is retryable; retry retains action identity and clears old outcome");

  const invalid = { ...ante(alice, "invalid-already-anted"), action: { ...ante(alice, "invalid-already-anted").action } };
  await alice.command(invalid);
  await until(() => alice.view.actionReceipt?.actionId === invalid.action.id, "terminal rule rejection");
  assert.deepEqual(alice.view.actionReceipt, expected(alice, invalid, false, "NOT_YOUR_TURN", false));
  assert.equal(alice.view.pending, false);
  const invalidNonce = "already-consumed-request";
  await hostPacket("alice", { kind: "receipt", requestId: invalidNonce, ok: true });
  assert.equal(alice.view.actionReceipt?.code, "NOT_YOUR_TURN", "No pending request means late receipts cannot rewrite outcome");
  passed("terminal rules rejection is exact and cannot be replaced by a late receipt");

  await reset();
  const uncertain = ante(host, "host-published-later"); room.failWrite = true;
  await host.command(uncertain);
  assert.deepEqual(host.view.actionReceipt, expected(host, uncertain, false, "roomFull", true));
  assert.equal(own(host).revision, uncertain.action.revision + 1, "Failed publication can follow successful persistence");
  const writes = store.writes;
  room.failWrite = false; await host.command({ type: "retry" });
  assert.deepEqual(host.view.actionReceipt, expected(host, uncertain));
  assert.equal(store.writes, writes, "Publication retry acknowledges the saved action without saving again");
  passed("post-save publication failure remains retryable and never looks like success");

  await reset();
  // A disconnected sender is ambiguous, not an invented negative host receipt.
  room.remove("host");
  const offline = ante(alice, "alice-offline");
  await alice.command(offline);
  assert.equal(alice.view.message, "hostOffline"); assert.equal(alice.view.pending, false);
  assert.equal(alice.view.actionReceipt, undefined, "Transport failure/pending=false never fabricates a rules receipt");
  room.ports.set("host", (internals(host).platform)); room.membersChanged();
  await until(() => alice.view.connected, "same host reconnects");
  await alice.command({ type: "retry" });
  await until(() => alice.view.actionReceipt?.actionId === offline.action.id && alice.view.actionReceipt.ok, "original offline action retried");
  assert.deepEqual(alice.view.actionReceipt, expected(alice, offline));
  passed("offline pending=false is not an ACK; reconnect can acknowledge the original action");

  await reset();
  const oldAction = ante(alice, "old-game-pending");
  room.drop = t => t.from === "host" && t.to === "alice" && t.value.kind === "private";
  await alice.command(oldAction);
  await until(() => own(host).revision === oldAction.action.revision + 1, "old action persisted");
  const oldReceipt = commandReceipt(alice, true), oldGame = own(alice).id;
  room.drop = undefined; await host.command({ type: "newGame" });
  await until(() => alice.view.game === null && !alice.view.pending, "new lobby cancels obsolete outstanding action");
  assert.equal(alice.view.actionReceipt, undefined);
  await host.command({ type: "start" });
  await until(() => !!alice.view.game && own(alice).id !== oldGame, "fresh game projection");
  await hostPacket("alice", { kind: "receipt", ...oldReceipt });
  assert.equal(alice.view.actionReceipt, undefined, "Old-game receipt cannot land a card in the new game");
  await alice.command(ante(alice, "new-game-action"));
  await until(() => alice.view.actionReceipt?.actionId === "new-game-action", "new game's own receipt");
  const newOutcome = alice.view.actionReceipt;
  await hostPacket("alice", { kind: "receipt", ...oldReceipt });
  assert.deepEqual(alice.view.actionReceipt, newOutcome);
  passed("new game clears pending/outcome and ignores old-game late receipts");

  await reset();
  const neverDelivered = ante(alice, "lost-before-background"), retryNeverDelivered = retryAction(alice, neverDelivered);
  const writesBeforeLocalLoss = store.writes;
  await assert.rejects(failedLocalSend(alice, neverDelivered, false), /LOCAL delivery/);
  assert.equal(internals(alice).pending, undefined); assert.equal(alice.view.actionReceipt, undefined);
  const mutableRetry = structuredClone(retryNeverDelivered);
  const firstRetry = alice.command(mutableRetry);
  mutableRetry.action.cardId = own(alice).hand[1].id;
  await Promise.all([firstRetry, alice.command(retryNeverDelivered)]);
  await until(() => alice.view.actionReceipt?.actionId === neverDelivered.action.id, "first LOCAL delivery recovered with original action");
  assert.deepEqual(alice.view.actionReceipt, expected(alice, neverDelivered));
  assert.equal(own(alice).committedAnte!.id, neverDelivered.action.cardId, "Retry snapshots original action before caller can mutate it");
  assert.equal(store.writes, writesBeforeLocalLoss + 1, "Two retry clicks after lost LOCAL delivery execute one immutable action");
  passed("missing first LOCAL delivery is restored once with original ID/base/card, including simultaneous retries");

  await pause(35);
  const beforeKnownTraffic = room.traffic.length, knownWrites = store.writes, knownEmits = emitted.alice.length;
  await Promise.all([alice.command(retryNeverDelivered), alice.command(retryNeverDelivered)]);
  assert.equal(room.traffic.length, beforeKnownTraffic, "Known terminal receipt is replayed locally without handshake or network command");
  assert.equal(store.writes, knownWrites); assert.ok(emitted.alice.length > knownEmits);
  assert.deepEqual(alice.view.actionReceipt, expected(alice, neverDelivered));
  const changedKnown = structuredClone(retryNeverDelivered); changedKnown.action.cardId = own(alice).hand[0].id;
  await alice.command(changedKnown);
  assert.equal(alice.view.actionReceipt?.source, "local"); assert.equal(alice.view.actionReceipt?.code, "ACTION_ID_CONFLICT");
  await alice.command(retryNeverDelivered);
  assert.deepEqual(alice.view.actionReceipt, expected(alice, neverDelivered), "Conflicting retry cannot overwrite the stored genuine receipt");
  passed("already confirmed action re-emits exact host outcome; conflicting same-ID content is rejected locally");

  await reset();
  const deliveredButRejected = ante(alice, "delivered-local-send-rejected"), retryDelivered = retryAction(alice, deliveredButRejected);
  room.drop = t => t.from === "host" && t.to === "alice" && t.value.kind === "private";
  await assert.rejects(failedLocalSend(alice, deliveredButRejected, true), /LOCAL delivery/);
  await until(() => own(host).revision === deliveredButRejected.action.revision + 1, "delivered action really persisted");
  const retainedRequest = internals(alice).pending.request.requestId;
  room.drop = undefined; await internals(host).snapshot("alice");
  await until(() => own(alice).revision > deliveredButRejected.action.revision, "new state with old pending base");
  const pendingConflict = structuredClone(retryDelivered); pendingConflict.action.cardId = own(alice).hand[0].id;
  await alice.command(pendingConflict);
  assert.equal(alice.view.actionReceipt?.source, "local"); assert.equal(alice.view.actionReceipt?.retryable, true, "Conflict with an uncertain original cannot claim original was rejected");
  assert.equal(internals(alice).pending.request.requestId, retainedRequest);
  const writesAfterDelivery = store.writes;
  await Promise.all([alice.command(retryDelivered), alice.command(retryDelivered)]);
  await until(() => !!alice.view.actionReceipt?.ok, "single retry click resolves existing pending despite newer view");
  assert.deepEqual(alice.view.actionReceipt, expected(alice, deliveredButRejected));
  assert.equal(store.writes, writesAfterDelivery, "Delivered action never runs again when LOCAL send rejected");
  passed("delivered-but-rejected LOCAL send resends original pending request once without rebasing advanced state");

  await reset();
  const expiredBeforeDelivery = ante(alice, "never-delivered-expired"), expiredRetry = retryAction(alice, expiredBeforeDelivery);
  await assert.rejects(failedLocalSend(alice, expiredBeforeDelivery, false), /LOCAL delivery/);
  await host.command(ante(host, "other-player-advanced-base"));
  await until(() => own(alice).revision > expiredBeforeDelivery.action.revision, "another player's ante changed base");
  await pause(35); const noNewSend = room.traffic.length, noNewWrite = store.writes;
  await alice.command(expiredRetry);
  assert.deepEqual(alice.view.actionReceipt, { ...expected(alice, expiredBeforeDelivery, false, "STALE_REVISION", false), source: "local" }, "Expired never-submitted action receives an exact local rejection, not just a message");
  assert.equal(room.traffic.length, noNewSend); assert.equal(store.writes, noNewWrite);
  assert.equal(own(alice).hand.length, 6, "Local stale retry neither rebases nor plays another card");
  passed("never-delivered action with expired base gets precise terminal LOCAL rejection without network or new ID");

  for (const wrong of [{ tableId: "old-table" }, { gameId: "old-game" }, { action: { ...expiredRetry.action, seatId: "another-seat" } }]) {
    const bad = { ...expiredRetry, ...wrong };
    await alice.command(bad);
    assert.deepEqual(alice.view.actionReceipt, { actionId: bad.action.id, tableId: bad.tableId, gameId: bad.gameId,
      revision: bad.action.revision, ok: false, source: "local", code: "action" in wrong ? "notSeated" : "staleTable", retryable: false });
    assert.equal(store.writes, noNewWrite);
  }
  const priorGameRetry = retryAction(host, { ...ante(host, "other-player-advanced-base"), action: { ...ante(host, "other-player-advanced-base").action, revision: 0 } });
  await reset();
  await alice.command(expiredRetry);
  assert.equal(alice.view.actionReceipt?.gameId, expiredRetry.gameId); assert.equal(alice.view.actionReceipt?.source, "local"); assert.equal(alice.view.actionReceipt?.code, "staleTable");
  await host.command(priorGameRetry);
  assert.equal(host.view.actionReceipt?.ok, false, "A cached prior-game receipt cannot revive through LOCAL retry");
  assert.equal(host.view.actionReceipt?.source, "local");
  passed("wrong table/game/seat and old-game retries return bound local failures without crossing identity");

  // Authoritative table deletion and stop must clear local receipt history.
  room.setTable(null);
  assert.ok(all.every(c => !c.view.actionReceipt && c.view.game === null), "Leaving the table clears receipts and game");
  await Promise.all(all.map(c => c.stop()));
  assert.ok(all.every(c => !c.view.actionReceipt)); assert.equal(room.listeners, 0);
  passed("table change and stop clear receipts without lifecycle leakage");
  console.log(JSON.stringify({ groups, runtime: "Node native WebCrypto; simulated room/storage; actual controller/rules/LOCAL codec", noRealOwlbearUAT: true }));
} finally { room.drop = undefined; room.failWrite = false; await Promise.all(all.map(c => c.stop())); }
