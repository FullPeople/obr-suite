import assert from "node:assert/strict";
import { m } from "./fixtures/cc-entry-sdk";
import { setupCharacterCards, teardownCharacterCards } from "../src/modules/characterCards/index";
const INFO = "com.obr-suite/cc-info", SHOW = "com.character-cards/info-show", READY = "com.character-cards/info-ready", UPDATED = "com.obr-suite/cc-card-updated";
const sleep = (ms = 5) => new Promise(done => setTimeout(done, ms));
async function until(test: () => boolean, label: string) { const limit = Date.now() + 2000; while (!test()) { if (Date.now() > limit) throw Error(label); await sleep(); } }
const latest = () => m.sent.filter(event => event.topic === SHOW).at(-1)?.data;
const open = () => m.popovers.has(INFO);
async function fresh() { await teardownCharacterCards(); m.reset(); }
try {
  m.role = "PLAYER";
  await setupCharacterCards(); assert.ok(open(), "assigned owner can open locked GM-created token");
  localStorage.setItem("obr-suite/cc-info-pinned", "1");
  m.player([]); await sleep(); assert.ok(open(), "pin preserves ordinary deselection");
  m.metadata["com.character-cards/list"][0].visibility = "dm"; m.sceneMetadata();
  await until(() => !open(), "pin cannot preserve DM-only card after revocation");
  m.metadata["com.character-cards/list"][0] = { id: "card", visibility: "owners", owner_ids: ["player"] }; m.sceneMetadata(); m.player(["A"]);
  await until(open, "assigned private card remains available to its owner");
  m.metadata["com.character-cards/list"][0].owner_ids = ["someone-else"]; m.sceneMetadata();
  await until(() => !open(), "owner removal revokes even a pinned card");
  console.log("PASS: owner_ids/visibility match info-page, including GM-created locked cards and pinned revocation");

  await fresh(); m.holds.selection = true;
  const starting = setupCharacterCards(); await until(() => m.pending.selection.length > 0, "initial selection held");
  m.holds.selection = false; m.player(["B"]); m.release("selection"); await starting;
  assert.equal(latest().itemId, "B"); assert.ok(!m.sent.some(event => event.topic === SHOW && event.data.itemId === "A"));
  m.holds.items = true; m.player(["A"]); await until(() => m.pending.items.length > 0, "A read held");
  m.holds.items = false; m.player(["C"]); await until(() => latest()?.itemId === "C", "C read wins");
  m.release("items"); await sleep(); assert.equal(latest().itemId, "C");
  console.log("PASS: delayed initial selection and old A read cannot overwrite newer selected target");

  await fresh(); await setupCharacterCards();
  const originalUrl = m.opens[0].url; m.player(["B"]); await until(() => latest()?.itemId === "B", "same-card new token");
  const beforeResize = m.opens.length; m.emit("resize", {}); await until(() => m.opens.length > beforeResize, "reanchor applied");
  assert.equal(m.opens.at(-1).url, originalUrl, "same iframe URL survives target changes and resize");
  assert.equal(latest().itemId, "B", "resize does not restore old token A");
  const beforeReady = m.sent.length; m.broadcast(READY, {}, "foreign"); await sleep(); assert.equal(m.sent.length, beforeReady);
  m.broadcast(READY); await until(() => m.sent.length > beforeReady, "local ready receives latest target"); assert.equal(latest().itemId, "B");
  const counts = { ...m.counts }, sends = m.sent.length, opens = m.opens.length;
  for (let i = 0; i < 120; i++) { m.items.B.position.x = i; m.items.B.metadata["com.obr-suite/bubbles/data"].health = i; m.sceneItems(); }
  await sleep(); assert.deepEqual(m.counts, counts); assert.equal(m.sent.length, sends); assert.equal(m.opens.length, opens);
  console.log("PASS: same-card token and READY/resize target remain current; 120 unrelated/HP events cause no rereads or panel messages");

  await fresh(); m.holds.open = true; const opening = setupCharacterCards();
  await until(() => m.pending.open.length > 0, "A open held"); m.player(["B"]); await sleep();
  m.holds.open = false; m.flush("open"); await opening; assert.equal(latest().itemId, "B");
  m.broadcast(READY); await sleep(); assert.equal(latest().itemId, "B");
  m.holds.close = true; m.player([]); await until(() => m.pending.close.length > 0, "old close held");
  m.player(["C"]); await sleep(); assert.equal(m.pending.close.length, 1);
  m.holds.close = false; m.flush("close"); await until(() => open() && latest()?.itemId === "C", "new target opens after old close");
  m.player([]); await until(() => !open(), "selection closes current window");
  const afterClose = [m.opens.length, m.sent.length]; m.broadcast(READY); m.emit("resize", {}); await sleep();
  assert.deepEqual([m.opens.length, m.sent.length], afterClose, "old READY cannot reopen or message a closed target");
  console.log("PASS: slow open and close serialize correctly; late iframe READY receives B and old close cannot hide C");

  await fresh(); m.holds.viewport = true; const viewportSetup = setupCharacterCards();
  await until(() => m.pending.viewport.length > 0, "viewport held before open"); m.scene(false);
  m.holds.viewport = false; m.release("viewport"); await viewportSetup; assert.ok(!open()); assert.equal(m.opens.length, 0);
  m.scene(true); await until(open, "scene ready recovers current selection");
  localStorage.setItem("obr-suite/cc-info-pinned", "1"); m.metadata["com.character-cards/list"][0].visibility = "dm"; m.sceneMetadata();
  m.player(["A"], "PLAYER"); await until(() => !open(), "GM downgrade closes pinned private card");
  m.broadcast("com.character-cards/panel-open", {}, "foreign"); await sleep(); assert.equal(m.modals.size, 0);
  await m.menus.get("com.obr-suite/cc-bind-menu").onClick({ items: [m.items.A] }); assert.equal(m.modals.size, 0);
  console.log("PASS: scene unload cancels deferred open, role downgrade revokes pin, and remote UI/PLAYER bind entries are rejected");

  await fresh(); await setupCharacterCards(); m.holds.fetch = true;
  m.items.A.metadata["com.owlbear-rodeo-bubbles-extension/metadata"] = { health: 7, "temporary health": 2, "name plate": true, name: "Authored legacy label" };
  m.broadcast(UPDATED, { cardId: "card" }); await until(() => m.pending.fetch.length === 1, "first fetch held");
  m.broadcast(UPDATED, { cardId: "card" }); await until(() => m.pending.fetch.length === 2, "new fetch held");
  const firstFetch = m.pending.fetch.shift()!, latestFetch = m.pending.fetch.shift()!;
  latestFetch.release({ core_stats: { hp: { max: 45 }, ac: 18, initiative: 5 } }); await until(() => m.writes.length === 1, "new snapshot applied");
  firstFetch.release({ core_stats: { hp: { max: 9 }, ac: 1, initiative: 0 } }); await sleep();
  assert.equal(m.writes.length, 1); assert.equal(m.items.A.metadata["com.obr-suite/bubbles/data"]["max health"], 45);
  assert.equal(m.items.A.metadata["com.obr-suite/bubbles/data"].health, 7); assert.equal(m.items.A.metadata["com.obr-suite/bubbles/data"]["temporary health"], 2);
  assert.equal(m.items.A.metadata["com.owlbear-rodeo-bubbles-extension/metadata"]["name plate"], true);
  assert.equal(m.items.A.metadata["com.owlbear-rodeo-bubbles-extension/metadata"].name, "Authored legacy label");
  assert.equal(m.items.A.metadata["com.owlbear-rodeo-bubbles-extension/metadata"]["max health"], 45);
  m.broadcast(UPDATED, { cardId: "card" }); await until(() => m.pending.fetch.length === 1, "fetch before role downgrade");
  const revoked = m.pending.fetch.shift()!; m.player(["A"], "PLAYER"); revoked.release(); await sleep(); assert.equal(m.writes.length, 1);
  console.log("PASS: latest card refresh wins, current/temp HP survive, and an old GM response cannot write after downgrade");

  m.holds.fetch = false; m.player(["A"], "GM"); m.holds.updates = true;
  m.broadcast(UPDATED, { cardId: "card" }); await until(() => m.pending.updates.length === 1, "actual update callback delayed");
  m.items.A.metadata["com.character-cards/boundCardId"] = "other"; m.items.B.metadata["com.character-cards/boundCardId"] = "other";
  m.flush("updates"); await sleep(); assert.equal(m.writes.length, 1, "rebound drafts do not receive previous card values");
  m.items.A.metadata["com.character-cards/boundCardId"] = "card";
  m.broadcast(UPDATED, { cardId: "card" }); await until(() => m.pending.updates.length === 1, "late update before scene close");
  m.scene(false); m.flush("updates"); await sleep(); assert.equal(m.writes.length, 1);
  await teardownCharacterCards();
  const beforeFinalReady = m.sent.length; m.broadcast(READY); m.emit("resize", {}); await sleep();
  assert.equal(m.sent.length, beforeFinalReady); assert.equal(m.popovers.size, 0); assert.equal(m.modals.size, 0);
  assert.equal([...m.listeners.values()].reduce((sum, group) => sum + group.size, 0), 0);
  console.log("PASS: update-time binding/scene guards reject stale writes; teardown removes listeners and ignores old READY");
  console.log("CC_ENTRY: 7 actual-entry delayed SDK integration groups passed; SDK host transport simulated, not Owlbear UAT");
} finally {
  m.holds.open = m.holds.close = false; m.flush("open"); m.flush("close"); m.flush("updates"); m.release("items"); m.release("viewport"); m.release("selection"); m.release("role");
  await teardownCharacterCards();
}
