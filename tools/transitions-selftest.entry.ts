import assert from "node:assert/strict";
import { fixture } from "./fixtures/transitions-sdk";
import { createTransitionGate, BC_TRANSITIONS_RUN, BC_TRANSITIONS_PLAY, BC_TRANSITIONS_DISMISS, DISPLAY_ID, REDUCED_MOTION_KEY, type TransitionEvent } from "../src/modules/transitions/protocol";
import { setupTransitions, teardownTransitions } from "../src/modules/transitions";
import { playScreenTransition, stopScreenTransition, screenPhase, removeScreenTransitionForOwner } from "../src/modules/transitions/screen-effect";
import { resolvePortalEffect } from "../src/modules/portals/types";

const storage = new Map<string, string>();
globalThis.localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } as any;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const event = (extra: Partial<TransitionEvent> = {}): TransitionEvent => ({ version: 1, id: crypto.randomUUID(), sceneKey: "scene-one", issuedAt: Date.now(), expiresAt: Date.now() + 6_000, kind: "short", text: "", targets: "all", ...extra });
const context = () => ({ now: Date.now(), readyAt: Date.now() - 100, sceneKey: "scene-one", playerId: "local-player", peers: fixture.peers as any });
let passed = 0;
async function test(name: string, fn: () => unknown) { await fn(); console.log(`PASS ${name}`); passed++; }

await test("only the actual GM connection can broadcast", () => {
  const gate = createTransitionGate();
  const value = event();
  assert.equal(gate.accept({ ...value, role: "GM" }, "player-connection", context()), null);
  assert.equal(gate.accept(value, "unknown", context()), null);
  assert.equal(gate.accept(value, "gm-connection", context())?.id, value.id);
});
await test("duplicates and wrong recipients are ignored", () => {
  const gate = createTransitionGate(); const value = event();
  assert.ok(gate.accept(value, "gm-connection", context()));
  assert.equal(gate.accept(value, "gm-connection", context()), null);
  assert.equal(gate.accept(event({ targets: ["other"] }), "gm-connection", context()), null);
  assert.ok(gate.accept(event({ targets: ["local-player"] }), "gm-connection", context()));
});
await test("old scenes, expired events and pre-join events never replay", () => {
  const gate = createTransitionGate(); const ctx = context();
  assert.equal(gate.accept(event({ sceneKey: "old-scene" }), "gm-connection", ctx), null);
  assert.equal(gate.accept(event({ issuedAt: ctx.now - 7_000, expiresAt: ctx.now - 1_000 }), "gm-connection", ctx), null);
  assert.equal(gate.accept(event({ issuedAt: ctx.readyAt - 1, expiresAt: ctx.now + 1_000 }), "gm-connection", ctx), null);
  assert.equal(gate.accept(event({ issuedAt: ctx.now + 2_000, expiresAt: ctx.now + 4_000 }), "gm-connection", ctx), null);
});
await test("invalid and oversized payloads are rejected", () => {
  const gate = createTransitionGate();
  for (const bad of [null, {}, event({ text: "x".repeat(121) }), event({ expiresAt: Date.now() + 60_000 })]) {
    assert.equal(gate.accept(bad, "gm-connection", context()), null);
  }
});
await test("legacy portal effect and personal motion preferences remain distinct", () => {
  assert.equal(resolvePortalEffect(undefined, true, false), "inherit");
  assert.equal(resolvePortalEffect(undefined, false, false), "off");
  assert.equal(resolvePortalEffect("fade", false, false), "fade");
  assert.equal(resolvePortalEffect("blink", true, true), "off");
  assert.equal(resolvePortalEffect("off", true, false), "off");
});
await test("screen transition is transparent at both endpoints", () => {
  assert.equal(screenPhase(0, 1200), 0); assert.equal(screenPhase(600, 1200), 1);
  assert.equal(screenPhase(1200, 1200), 0); assert.equal(screenPhase(5000, 1200), 0);
});
await test("native effect cannot capture pointers and cleans up after its duration", async () => {
  const playing = playScreenTransition("blink", 100);
  // Inspect immediately after SDK microtasks, before advancing the timer queue.
  // Waiting for the apex first races cleanup when the machine is busy.
  await fixture.flush();
  const item = [...fixture.items.values()][0];
  assert.equal(item.disableHit, true); assert.equal(item.effectType, "VIEWPORT");
  assert.equal(item.uniforms.find((uniform: any) => uniform.name === "blink").value, 1);
  await playing; await sleep(100); assert.equal(fixture.items.size, 0);
});
await test("aborting while addItems is pending removes a late effect", async () => {
  let release!: () => void; fixture.add = () => new Promise<void>((resolve) => { release = resolve; });
  const controller = new AbortController();
  const pending = playScreenTransition("fade", 100, controller.signal);
  await fixture.flush(); controller.abort(); await pending;
  release(); await fixture.flush(); fixture.add = null;
  assert.equal(fixture.items.size, 0);
});
await test("banner watchdog only removes its own screen effect", async () => {
  const playing = playScreenTransition("fade", 100, undefined, "banner-one");
  await fixture.flush();
  await removeScreenTransitionForOwner("different-banner"); assert.equal(fixture.items.size, 1);
  await removeScreenTransitionForOwner("banner-one"); assert.equal(fixture.items.size, 0);
  await stopScreenTransition(); await playing;
});
await test("stalled addItems reaches a finite recovery deadline", async () => {
  fixture.add = () => new Promise<void>(() => {});
  const started = performance.now(); await playScreenTransition("fade", 50); fixture.add = null;
  assert.ok(performance.now() - started < 2_000);
  await stopScreenTransition();
});
storage.set(REDUCED_MOTION_KEY, "1");
await setupTransitions();
await test("player requests are forced to local preview", async () => {
  fixture.role = "PLAYER"; fixture.sent.length = 0; fixture.opened.length = 0;
  await fixture.emit(BC_TRANSITIONS_RUN, { kind: "long", preview: false, targets: "all", issuedAt: Date.now() });
  assert.equal(fixture.sent.filter((message) => message.destination === "REMOTE").length, 0);
  assert.equal(fixture.opened.length, 1); assert.equal(fixture.items.size, 0);
});
await test("GM can target one player without presenting to themselves", async () => {
  fixture.role = "GM"; fixture.sent.length = 0; fixture.opened.length = 0;
  await fixture.emit(BC_TRANSITIONS_RUN, { kind: "text", text: "Dawn", targets: ["player"], issuedAt: Date.now() });
  assert.equal(fixture.sent.filter((message) => message.destination === "REMOTE").length, 1);
  assert.equal(fixture.opened.length, 0);
});
for (const createMarker of [true, false]) await test(`role revocation wins over a stale role reply before ${createMarker ? "scene marker write" : "broadcast"}`, async () => {
  await fixture.changeRole("GM"); fixture.sent.length = 0;
  if (createMarker) delete fixture.metadata["com.obr-suite/transitions/scene-key"];
  let reads = 0, release!: (role: "GM" | "PLAYER") => void;
  fixture.roleRead = () => ++reads === 2 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(fixture.role);
  await fixture.emit(BC_TRANSITIONS_RUN, { kind: "short", targets: "all", issuedAt: Date.now() });
  await fixture.changeRole("PLAYER"); release("GM"); await fixture.flush(); fixture.roleRead = null;
  assert.equal(fixture.sent.filter((message) => message.destination === "REMOTE").length, 0);
  if (createMarker) assert.equal(fixture.metadata["com.obr-suite/transitions/scene-key"], undefined);
  fixture.metadata["com.obr-suite/transitions/scene-key"] = "scene-one";
  await fixture.changeRole("GM");
});
await test("remote permissions and duplicate guards protect the real presenter", async () => {
  fixture.opened.length = 0; const value = event();
  await fixture.emit(BC_TRANSITIONS_PLAY, value, "player-connection"); assert.equal(fixture.opened.length, 0);
  await fixture.emit(BC_TRANSITIONS_PLAY, value, "gm-connection");
  await fixture.emit(BC_TRANSITIONS_PLAY, value, "gm-connection"); assert.equal(fixture.opened.length, 1);
  await fixture.emit(BC_TRANSITIONS_DISMISS, { id: value.id }, "player-connection");
  assert.ok(!fixture.closed.includes(`${DISPLAY_ID}/${value.id}`));
  await fixture.emit(BC_TRANSITIONS_DISMISS, { id: value.id });
  assert.ok(fixture.closed.includes(`${DISPLAY_ID}/${value.id}`));
});
await test("scene switches clear a presentation and reject old events", async () => {
  const value = event(); await fixture.emit(BC_TRANSITIONS_PLAY, value, "gm-connection");
  await fixture.scene(false); assert.ok(fixture.closed.includes(`${DISPLAY_ID}/${value.id}`));
  fixture.metadata["com.obr-suite/transitions/scene-key"] = "scene-two"; await fixture.scene(true);
  fixture.opened.length = 0; await fixture.emit(BC_TRANSITIONS_PLAY, event(), "gm-connection");
  assert.equal(fixture.opened.length, 0);
});
await test("a late old popover cannot close a newer presentation", async () => {
  let release!: () => void;
  fixture.metadata["com.obr-suite/transitions/scene-key"] = "scene-one";
  fixture.open = () => new Promise<void>((resolve) => { release = resolve; });
  const old = event(); await fixture.emit(BC_TRANSITIONS_PLAY, old, "gm-connection");
  fixture.open = null;
  const next = event(); await fixture.emit(BC_TRANSITIONS_PLAY, next, "gm-connection");
  release(); await fixture.flush();
  assert.ok(fixture.closed.includes(`${DISPLAY_ID}/${old.id}`));
  assert.ok(!fixture.closed.includes(`${DISPLAY_ID}/${next.id}`));
});
await test("teardown removes every runtime subscription", async () => {
  await teardownTransitions(); assert.equal(fixture.listenerCount(), 0); assert.equal(fixture.items.size, 0);
});
await test("rest dismissal and transitions teardown preserve a newer portal effect", async () => {
  await setupTransitions();
  const rest = event(); await fixture.emit(BC_TRANSITIONS_PLAY, rest, "gm-connection");
  storage.delete(REDUCED_MOTION_KEY);
  const playing = playScreenTransition("fade", 300, undefined, "portal");
  await fixture.flush();
  await fixture.emit(BC_TRANSITIONS_DISMISS, { id: rest.id });
  assert.equal(fixture.items.size, 1);
  await teardownTransitions();
  assert.equal(fixture.items.size, 1);
  await stopScreenTransition("portal"); await playing; await fixture.flush();
  assert.equal(fixture.items.size, 0); assert.equal(fixture.listenerCount(), 0);
});
console.log(`TRANSITIONS_SELFTEST ${passed}/${passed}`);
