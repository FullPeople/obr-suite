import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { SharedPointerController } from "../src/modules/sharedPointer/index";
import { POINTER_NETWORK, POINTER_SCENE_KEY, POINTER_MODE, POINTER_TOOL, POINTER_LOCAL_KEY } from "../src/modules/sharedPointer/protocol";
import { Room, Client, flush } from "./fixtures/shared-pointer-sdk";
const room = new Room(), gm = new Client(room, "a", "GM"), player = new Client(room, "b");
const a = new SharedPointerController(gm.sdk, room.time), b = new SharedPointerController(player.sdk, room.time);
const pointers = (client: Client) => [...client.local.values()].filter(item => item.type === "POINTER");
const labels = (client: Client) => [...client.local.values()].filter(item => item.type === "LABEL");
const moving = (client: Client) => client.network.filter(message => message.data.k === "p" && message.data.p !== null);
try {
  await a.start(); await b.start(); await room.time.advance(2500);
  assert.equal(room.metadataWrites, 1); assert.equal(typeof room.metadata[POINTER_SCENE_KEY], "string");
  assert.equal(gm.local.size + player.local.size, 0); assert.equal(moving(gm).length + moving(player).length, 0);
  const idleNetwork = gm.network.length + player.network.length; await room.time.advance(10000);
  assert.equal(gm.network.length + player.network.length, idleNetwork, "no polling/traffic after startup handshake");
  gm.move(15); await room.time.advance(200); assert.equal(gm.local.size, 0, "native Move cannot generate shared pointers");
  await a.activate(); gm.move(25, 40); await room.time.advance(300);
  assert.equal(pointers(player).length, 1); assert.equal(labels(player)[0].text.plainText, gm.player.name);
  assert.equal(pointers(player)[0].color, gm.player.color); assert.deepEqual(pointers(player)[0].position, { x: 25, y: 40 });
  assert.ok([...player.local.values()].every(item => item.disableHit && item.layer === "POINTER" && item.metadata[POINTER_LOCAL_KEY]));
  assert.deepEqual(gm.log.find(message => message.type === "OBR_TOOL_MODE_CREATE").data.preventDrag, {});
  assert.equal(gm.log.filter(message => message.type === "OBR_TOOL_MODE_ACTIVATE").length, 1, "never takes Move automatically");
  gm.player.name = "Renamed GM"; gm.player.color = "#aa22ff"; gm.emit("player", structuredClone(gm.player)); room.publishParty(); await room.time.advance(80);
  assert.equal(labels(player)[0].text.plainText, "Renamed GM"); assert.equal(labels(player)[0].text.style.fillColor, "#aa22ff");
  assert.equal(pointers(player)[0].color, "#aa22ff", "both native label and pointer recolor from actual party identity");
  assert.equal(player.log.findLast(message => message.type === "OBR_SCENE_LOCAL_UPDATE_ITEMS").data.fastUpdate, false, "appearance update uses the full local path, which supports label style and pointer color");
  console.log("PASS: actual ToolApi + Pointer/Label builders, first-GM scene initialization, identity and zero idle/shared item writes");

  const start = room.time.now(), before = gm.network.length;
  for (let i = 0; i < 1250; i++) { gm.move(100 + i, 60); await room.time.advance(8); }
  const budget = gm.network.slice(before), points = budget.filter(message => message.data.k === "p");
  assert.ok(player.log.some(message => message.type === "OBR_SCENE_LOCAL_UPDATE_ITEMS" && message.data.fastUpdate), "pure movement keeps the documented fast path");
  assert.equal(gm.invalidFastUpdates + player.invalidFastUpdates, 0);
  assert.ok(pointers(player)[0].position.x > 1290, "real local updates keep following the coalesced broadcast positions");
  assert.ok(budget.length <= 101, `${budget.length} sends exceed 10 Hz total budget`);
  assert.ok(budget.every((message, index) => index === 0 || message.at - budget[index - 1].at >= 100));
  assert.ok(budget.every(message => Buffer.byteLength(JSON.stringify(message.data)) <= 512));
  assert.equal(gm.maxInFlight, 1);
  const active = moving(gm).at(-1)!.data;
  const oldCount = pointers(player).length;
  player.receive({ ...active, n: active.n + 100, p: [9999, 9999], name: "forged", color: "red" }, "unrecognized-connection");
  player.receive({ ...active, n: active.n - 1, p: [7777, 7777] }, gm.player.connectionId);
  await room.time.advance(40); assert.equal(pointers(player).length, oldCount); assert.notEqual(pointers(player)[0].position.x, 7777);
  player.receive({ ...active, n: active.n + 1, p: [1350, 60], name: "forged", color: "#000000" }, gm.player.connectionId);
  await room.time.advance(40);
  assert.equal(labels(player)[0].text.plainText, gm.player.name);
  assert.equal(pointers(player)[0].color, gm.player.color, "valid sender still cannot supply a forged name or color");
  gm.move(1360, 60); await room.time.advance(200); // Resume the real sender beyond the injected sequence before testing its stop.
  console.log("PASS: 1,250 motion inputs are coalesced into <=101 bounded packets over 10 seconds; identity/sequence checks reject forgery and replay");

  gm.switchTool(); await room.time.advance(300); assert.equal(gm.local.size + player.local.size, 0);
  player.receive(active, gm.player.connectionId); await room.time.advance(100); assert.equal(player.local.size, 0, "stop sequence prevents old point replay");
  await a.activate(); gm.move(4000); await room.time.advance(200); assert.ok(player.local.size);
  await room.time.advance(1500); assert.equal(gm.local.size + player.local.size, 0, "stationary pointers expire without continuous timers");
  const stopped = gm.network.length; await room.time.advance(5000); assert.equal(gm.network.length, stopped);
  console.log("PASS: switch-tool and inactivity cleanup, no idle traffic or old-point resurrection after stop");

  await a.activate(); gm.move(4001); await room.time.advance(200);
  const oldPoint = moving(gm).at(-1)!.data, oldAck = gm.network.findLast(message => message.data.k === "a")!.data;
  room.setReady(false); await room.time.advance(100); room.setReady(true); await room.time.advance(2500);
  assert.equal(room.metadataWrites, 1, "existing scene key persists across reopen");
  player.receive(oldAck, gm.player.connectionId); player.receive(oldPoint, gm.player.connectionId); await room.time.advance(200);
  assert.equal(player.local.size, 0, "same-scene reopen rejects old hello reply and moving packet");
  await a.activate(); gm.move(6000); await room.time.advance(200); assert.equal(pointers(player)[0].position.x, 6000);
  console.log("PASS: fresh receiver challenges on same-scene return prevent delayed old-session traffic");

  await b.activate(); player.move(6200); await room.time.advance(200);
  const oldPlayerPoint = moving(player).at(-1)!.data, oldPlayerAck = player.network.findLast(message => message.data.k === "a")!.data;
  await b.stop(); await b.start(); await room.time.advance(2500);
  gm.receive(oldPlayerAck, player.player.connectionId); gm.receive(oldPlayerPoint, player.player.connectionId); await room.time.advance(100);
  assert.equal(gm.local.size, 0, "old handshake ACK cannot roll a same-connection peer back to its previous module session");
  console.log("PASS: unique per-request handshake challenges reject old ACKs after a peer module restart");

  gm.sendDelay = 180;
  const slowBefore = gm.network.length;
  for (let i = 0; i < 300; i++) { gm.move(7000 + i); await room.time.advance(8); }
  assert.equal(gm.maxInFlight, 1); assert.ok(gm.network.length - slowBefore <= 15);
  gm.sendDelay = 0; await room.time.advance(2000); assert.equal(gm.local.size + player.local.size, 0);
  console.log("PASS: slow broadcast acknowledgement keeps one in-flight send and a single latest unsent point");

  player.holdAdd = true; gm.move(8500); await room.time.advance(200);
  const lateIds = player.log.findLast(message => message.type === "OBR_SCENE_LOCAL_ADD_ITEMS").data.items.map((item: any) => item.id);
  assert.ok(player.pendingAdd.length);
  room.setReady(false); await room.time.advance(80); room.setReady(true); await room.time.advance(2500);
  gm.move(8600); await room.time.advance(180);
  player.holdAdd = false; player.pendingAdd.splice(0).forEach(resolve => resolve()); await room.time.advance(180);
  assert.equal(pointers(player)[0].position.x, 8600, "late add cannot replace current scene position");
  assert.ok(lateIds.every((id: string) => !player.local.has(id)), "late old-scene UUIDs deleted before drawing fresh generation");
  assert.ok([...player.local.keys()].every(id => !lateIds.includes(id)), "fresh generation never reuses retired UUIDs");
  const foreign = { id: "other-extension-local-item", metadata: {}, type: "SHAPE" }; player.local.set(foreign.id, foreign);
  player.failDeletes = 1; gm.switchTool(); await room.time.advance(700);
  assert.deepEqual([...player.local.keys()], [foreign.id], "transient deletion failure retries and preserves unrelated local items");
  console.log("PASS: cross-scene delayed adds retire old UUIDs; a transient delete failure retries without deleting another module's items");

  await a.activate(); gm.move(8700); await room.time.advance(200); assert.equal(pointers(player).length, 1);
  player.failDeletes = Infinity;
  await assert.rejects(b.stop(), /Local delete unavailable/, "persistent cleanup failure must not report successful teardown");
  assert.equal(pointers(player).length, 1); assert.equal(player.local.has(foreign.id), true);
  const failedAttempts = player.log.filter(message => message.type === "OBR_SCENE_LOCAL_DELETE_ITEMS").length;
  await room.time.advance(800); assert.equal(player.log.filter(message => message.type === "OBR_SCENE_LOCAL_DELETE_ITEMS").length, failedAttempts, "stopped module does not poll host cleanup indefinitely");
  player.failDeletes = 0; await b.stop(); assert.deepEqual([...player.local.keys()], [foreign.id], "later teardown retries retained exact owned UUIDs");
  player.local.delete(foreign.id); await b.start(); await room.time.advance(2500);
  console.log("PASS: permanent delete failure is surfaced, remains bounded, and later cleanup retries only retained module IDs");

  player.holdAdd = true; await a.activate(); gm.move(9000); await room.time.advance(200);
  assert.ok(player.pendingAdd.length); const stopping = b.stop(); player.holdAdd = false; player.pendingAdd.splice(0).forEach(resolve => resolve()); await stopping; await room.time.advance(200);
  assert.equal(player.local.size, 0, "delayed host add is cleaned after teardown");
  const removedMode = (player.sdk.tool as any).toolModes[POINTER_MODE]; assert.ok(removedMode, "installed SDK retains old callback after removeMode");
  const sentAfterStop = player.network.length; player.mode = POINTER_MODE; player.move(10000); player.emit("OBR_TOOL_MODE_EVENT_ACTIVATE", { id: POINTER_MODE, context: player.context() }); await room.time.advance(2000);
  assert.equal(player.network.length, sentAfterStop); assert.equal(player.local.size, 0, "own lifetime rejects SDK's retained callbacks");
  await a.stop(); await room.time.advance(100); assert.equal(gm.local.size, 0); assert.equal(room.time.timers.size, 0);
  assert.ok(gm.log.concat(player.log).every(message => !message.type.startsWith("OBR_SCENE_ITEMS_")));
  console.log("PASS: late local adds, removed-mode callbacks and shutdown clean up all owned items/timers");

  const waiting = new Room(), lonely = new Client(waiting, "player"), c = new SharedPointerController(lonely.sdk, waiting.time);
  await c.start(); await c.activate(); assert.ok(lonely.notifications.at(-1)?.includes("waiting for a GM"));
  lonely.move(100); await waiting.time.advance(200); assert.equal(lonely.local.size, 0);
  const laterGm = new Client(waiting, "gm", "GM"), d = new SharedPointerController(laterGm.sdk, waiting.time); waiting.publishParty(); await d.start(); await waiting.time.advance(2500);
  lonely.move(200); await waiting.time.advance(200); assert.equal(pointers(laterGm)[0].position.x, 200, "later GM initializes automatically without player reconfiguration");
  await c.stop(); await d.stop(); await waiting.time.advance(200);
  console.log("PASS: no-GM first scene gives clear local feedback and a later GM restores operation automatically");
  const unavailable = new Room(), owner = new Client(unavailable, "owner", "GM"), e = new SharedPointerController(owner.sdk, unavailable.time);
  unavailable.failMetadata = true; await e.start(); await e.activate(); assert.ok(owner.notifications.at(-1)?.includes("could not initialize"));
  unavailable.failMetadata = false; let releaseRole!: (role: string) => void;
  owner.roleRead = () => new Promise(resolve => { releaseRole = resolve; });
  const retry = e.activate(); await flush(); assert.equal(typeof releaseRole, "function");
  owner.player.role = "PLAYER"; owner.emit("player", structuredClone(owner.player)); releaseRole("GM"); await retry;
  assert.equal(unavailable.metadataWrites, 0, "role revoked during getRole cannot initialize scene");
  owner.roleRead = null; owner.player.role = "GM"; owner.emit("player", structuredClone(owner.player)); await unavailable.time.advance(2500);
  assert.equal(unavailable.metadataWrites, 1, "failed initial scene key write recovers when GM is available");
  owner.move(42); await unavailable.time.advance(100); assert.equal(pointers(owner)[0].position.x, 42);
  await e.stop(); await unavailable.time.advance(100); assert.equal(unavailable.time.timers.size, 0);
  console.log("PASS: scene-key write failure stays recoverable and a revoked GM cannot write after delayed role lookup");
  const toolRoom = new Room(), toolClient = new Client(toolRoom, "tool", "GM"), f = new SharedPointerController(toolClient.sdk, toolRoom.time);
  await f.start(); toolClient.failModeRemove = 1; toolClient.failToolRemove = 2;
  await assert.rejects(f.stop(), /Mode removal unavailable/);
  assert.equal(toolClient.registeredModes.size, 1); assert.equal(toolClient.registeredTools.size, 1);
  await assert.rejects(f.stop(), /Tool removal unavailable/);
  assert.equal(toolClient.registeredModes.size, 0); assert.equal(toolClient.registeredTools.size, 1);
  const successfulModeRemoves = toolClient.log.filter(message => message.type === "OBR_TOOL_MODE_REMOVE").length;
  await f.stop(); await f.stop(); assert.equal(toolClient.registeredTools.size, 0);
  assert.equal(toolClient.log.filter(message => message.type === "OBR_TOOL_MODE_REMOVE").length, successfulModeRemoves, "retry skips already-confirmed removed mode");
  const successfulToolRemoves = toolClient.log.filter(message => message.type === "OBR_TOOL_REMOVE").length;
  await f.stop(); assert.equal(toolClient.log.filter(message => message.type === "OBR_TOOL_REMOVE").length, successfulToolRemoves, "repeated stop does not remove an already-confirmed absent tool");
  await toolRoom.time.advance(200); assert.equal(toolRoom.time.timers.size, 0);
  console.log("PASS: native mode/tool cleanup failures stay retryable; partial success and repeated teardown preserve exact remaining work");
  writeFileSync(process.argv[2], JSON.stringify({ inputSamples: 1250, intervalMs: room.time.now() - start, measuredMotionPeriodMs: 10000, sends: budget.length, pointSends: points.length, payloadBytes: budget.reduce((sum, message) => sum + Buffer.byteLength(JSON.stringify(message.data)), 0), maxPacketBytes: Math.max(...budget.map(message => Buffer.byteLength(JSON.stringify(message.data)))), maxInFlight: gm.maxInFlight, builders: "installed SDK 3.1.0", sdkHostSimulated: true, realOwlbearUat: false }, null, 2));
} finally { await a.stop(); await b.stop(); await flush(); }
