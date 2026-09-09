import assert from "node:assert/strict";
import { createPrivateIdentity, PrivateLink } from "../extensions/three-dragon-ante/src/game/private-channel";
const host = await createPrivateIdentity(), alice = await createPrivateIdentity(), bob = await createPrivateIdentity();
const context = { roomId: "room-one", tableId: "table-one", sessionId: "handshake-one", localConnectionId: "host", remoteConnectionId: "alice" };
const sender = await PrivateLink.create(context, host, alice.hello);
const receiver = await PrivateLink.create({ ...context, localConnectionId: "alice", remoteConnectionId: "host" }, alice, host.hello);
const stranger = await PrivateLink.create({ ...context, localConnectionId: "bob", remoteConnectionId: "host" }, bob, host.hello);
assert.equal(host.privateKey.extractable, false);
assert.equal(host.hello.publicKey.d, undefined);
const hand = { hand: ["sorcerer", "red-12"], committedAnte: "gold-13", revision: 4, choice: { code: "PRIVATE_TEST" } };
const packets = await sender.seal(hand);
assert.ok(!JSON.stringify(packets).includes("sorcerer"));
assert.deepEqual(await receiver.receive(packets[0], "host"), hand);
assert.equal(await receiver.receive(packets[0], "host"), undefined, "completed messages cannot be replayed");
assert.equal(await stranger.receive(packets[0], "host"), undefined, "another player cannot receive Alice's hand");
assert.equal(await receiver.receive((await sender.seal(hand))[0], "bob"), undefined, "payload sender cannot impersonate the authenticated SDK sender");
console.log("PASS: native Web Crypto private keys, seat privacy, authenticated sender and duplicate rejection");

const large = { hand: ["sorcerer"], choices: "秘密候选".repeat(3500) };
const split = await sender.seal(large);
assert.ok(split.length > 1);
assert.ok(split.every(packet => new TextEncoder().encode(JSON.stringify(packet)).length < 16000));
let result: unknown;
for (const packet of [...split].reverse()) {
  result = await receiver.receive(packet, "host");
  if (packet.part !== 0) assert.equal(result, undefined);
}
assert.deepEqual(result, large, "all private choice options survive out-of-order reassembly");
console.log("PASS: multibyte payloads split below the SDK cap and reassemble without truncating choices");

for (const mutate of [
  (p: any) => { p.ciphertext = (p.ciphertext[0] === "A" ? "B" : "A") + p.ciphertext.slice(1); },
  (p: any) => { p.iv = "AAAAAAAAAAAAAAAA"; },
  (p: any) => { p.sequence += 100; },
  (p: any) => { p.messageId += "-changed"; },
  (p: any) => { p.tableId = "other-table"; },
  (p: any) => { p.to = "bob"; },
  (p: any) => { p.toKey = bob.hello.keyId; },
  (p: any) => { p.total = 99; },
  (p: any) => { p.part = -1; },
  (p: any) => { p.sequence = Number.MAX_SAFE_INTEGER + 1; },
]) {
  const original = (await sender.seal(hand))[0], altered = structuredClone(original); mutate(altered);
  assert.equal(await receiver.receive(altered, "host"), undefined);
  assert.deepEqual(await receiver.receive(original, "host"), hand, "invalid traffic cannot consume the legitimate sequence");
}
console.log("PASS: tampered encryption, routing, table, key, sequence and fragment headers are rejected");

const [earlier, later] = await Promise.all([sender.seal({ position: 1 }), sender.seal({ position: 2 })]);
assert.deepEqual(await receiver.receive(later[0], "host"), { position: 2 });
assert.deepEqual(await receiver.receive(earlier[0], "host"), { position: 1 }, "bounded out-of-order delivery must be accepted once");
const concurrent = (await sender.seal(hand))[0];
const duplicate = await Promise.all([receiver.receive(concurrent, "host"), receiver.receive(concurrent, "host")]);
assert.equal(duplicate.filter(value => value !== undefined).length, 1, "concurrent decryptions cannot replay the same sequence");
const reverse = await receiver.seal({ action: "ante", cardId: "gold-13" });
assert.deepEqual(await sender.receive(reverse[0], "alice"), { action: "ante", cardId: "gold-13" });
console.log("PASS: concurrent messages, bounded reordering and private reverse-direction actions");

const otherRoom = await PrivateLink.create({ ...context, roomId: "other-room", localConnectionId: "alice", remoteConnectionId: "host" }, alice, host.hello);
const otherTable = await PrivateLink.create({ ...context, tableId: "other-table", localConnectionId: "alice", remoteConnectionId: "host" }, alice, host.hello);
const latest = (await sender.seal(hand))[0];
assert.equal(await otherRoom.receive(latest, "host"), undefined);
assert.equal(await otherTable.receive(latest, "host"), undefined);
const nextHandshake = await PrivateLink.create({ ...context, sessionId: "handshake-two", localConnectionId: "alice", remoteConnectionId: "host" }, alice, host.hello);
assert.equal(await nextHandshake.receive(latest, "host"), undefined, "new handshake must not reset replay protection under an old key");
assert.equal(await nextHandshake.receive({ ...latest, sessionId: "handshake-two" }, "host"), undefined, "changing handshake routing cannot retarget ciphertext");
const reconnectedAlice = await createPrivateIdentity();
const rotated = await PrivateLink.create({ ...context, localConnectionId: "alice", remoteConnectionId: "host" }, reconnectedAlice, host.hello);
assert.equal(await rotated.receive(latest, "host"), undefined, "old envelopes cannot enter a replacement key session");
await assert.rejects(() => PrivateLink.create(context, host, { ...alice.hello, keyId: bob.hello.keyId }), /invalidPeer/);
await assert.rejects(() => PrivateLink.create(context, host, { ...alice.hello, publicKey: { ...alice.hello.publicKey, d: "private" } }), /invalidPeer/);
await assert.rejects(() => PrivateLink.create({ ...context, sessionId: undefined } as any, host, alice.hello), /invalidPeer/);
console.log("PASS: room/table binding, reconnect key rotation and malformed key offers");

const burst = await Promise.all(Array.from({ length: 12 }, (_, number) => sender.seal({ number })));
const burstResults = await Promise.all(burst.map(packets => receiver.receive(packets[0], "host")));
assert.ok(burstResults.filter(value => value !== undefined).length <= 8, "native decrypt requests must remain bounded");
for (let i = 0; i < burst.length; i++) if (burstResults[i] === undefined) assert.deepEqual(await receiver.receive(burst[i][0], "host"), { number: i });
console.log("PASS: concurrent decryptions are bounded and overflow remains retryable");

const expired = await sender.seal(large);
await receiver.receive(expired[0], "host", 1000);
for (const part of expired.slice(1)) assert.equal(await receiver.receive(part, "host", 17000), undefined);
assert.equal(await receiver.receive({ ...latest, ciphertext: "A".repeat(10001) }, "host"), undefined);
await assert.rejects(() => sender.seal({ text: "x".repeat(65536) }), /payloadTooLarge/);
await assert.rejects(() => sender.seal(undefined), /invalidPayload/);
receiver.dispose();
assert.equal(await receiver.receive(latest, "host"), undefined);
await assert.rejects(() => receiver.seal(hand), /disposed/);
console.log("PASS: partial-message expiry, payload bounds and disposed link isolation");
console.log("THREE_DRAGON_PRIVATE: 7 native-crypto regression groups passed");
