import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const out = resolve('workbench-test-output/runtime-completion');
await mkdir(out, {recursive: true});
const file = resolve(out, 'runtime.mjs');
await build({input: 'virtual:entry', plugins: [{
  name: 'runtime-entry',
  resolveId(id) { if (id === 'virtual:entry') return id; },
  load(id) { if (id === 'virtual:entry') return [
    "export * from " + JSON.stringify(resolve('src/workbench/runtime-completion.ts')),
    "export * from " + JSON.stringify(resolve('src/modules/bubbles/presentation.ts')),
  ].join(';'); },
}], output: {file, format: 'esm', codeSplitting: false}});
const {completeRuntimeProjection, runtimeProjectionApplied, bubblePresentation, BubblePresentation}
  = await import(pathToFileURL(file).href);
const BIND = 'com.character-cards/boundCardId', BASE = 'com.obr-suite/workbench/runtime-baseline';
const HP = 'com.obr-suite/bubbles/data', RES = 'com.obr-suite/resources/data';
const runtime = health => ({stats: {health, 'max health': 30, 'temporary health': 0, 'armor class': 15},
  resources: {}, conditions: []});
const document = (health = 18, revision = 2) => ({_suiteRevision: revision,
  core_stats: {hp: {current: health, max: 30, temp: 0}, ac: 15}});
const token = (health, revision) => ({id: 'one', createdUserId: 'me', metadata: {
  [BIND]: 'hero', [HP]: runtime(health).stats, [RES]: [],
  'com.obr-suite/status/buffs': [], [BASE]: {version: 1, cardId: 'hero', revision, value: runtime(health)},
}});
function observe(items = [token(20, 1)]) {
  let value = {items}, scene = 1;
  const listeners = new Set();
  return {peek: () => value, sceneEpoch: () => scene,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(items) { value = {items}; for (const fn of listeners) fn('data'); },
    changeScene() { scene++; for (const fn of listeners) fn('data'); },
    listeners: () => listeners.size};
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const reports = [];
async function test(name, fn) { await fn(); reports.push(name); console.log('PASS', name); }

await test('matching values with an old stamp and a new stamp with old values are both pending', async () => {
  assert.equal(runtimeProjectionApplied(token(18, 1), 'hero', document()), false);
  const wrong = token(20, 2);
  wrong.metadata[BASE].value = runtime(18);
  assert.equal(runtimeProjectionApplied(wrong, 'hero', document()), false);
  assert.equal(runtimeProjectionApplied(token(18, 2), 'hero', document()), true);
});
await test('newer committed metadata satisfies an older operation; a native edit after its stamp does not', async () => {
  const newer = token(12, 3);
  assert.equal(runtimeProjectionApplied(newer, 'hero', document()), true);
  newer.metadata[HP].health = 11;
  assert.equal(runtimeProjectionApplied(newer, 'hero', document()), false);
});
await test('metadata can precede SDK response, but completion still waits for the local renderer', async () => {
  const observation = observe();
  bubblePresentation.start(); bubblePresentation.commit(observation.peek().items);
  let complete = false, starts = 0;
  const operation = completeRuntimeProjection({observation, cardId: 'hero', document: document(),
    tokenIds: ['one'], start() { starts++; return new Promise(() => {}); }}).then(() => complete = true);
  observation.emit([token(18, 2)]);
  await tick(); assert.equal(complete, false);
  bubblePresentation.commit(observation.peek().items);
  await operation; assert.equal(complete, true); assert.equal(starts, 1);
  assert.equal(observation.listeners(), 0); bubblePresentation.stop();
});
await test('a slow renderer cannot complete a later operation using its earlier rendered values', async () => {
  const observation = observe([token(18, 2)]);
  bubblePresentation.start(); bubblePresentation.commit(observation.peek().items);
  let complete = false;
  const operation = completeRuntimeProjection({observation, cardId: 'hero', document: document(12, 3),
    tokenIds: ['one'], start: async () => {}}).then(() => complete = true);
  observation.emit([token(12, 3)]);
  bubblePresentation.commit([token(18, 2)]);
  await tick(); assert.equal(complete, false);
  bubblePresentation.commit(observation.peek().items);
  await operation; bubblePresentation.stop();
});
await test('unbound cards do not wait for an SDK response or a renderer', async () => {
  const observation = observe([]);
  await completeRuntimeProjection({observation, cardId: 'hero', document: document(), tokenIds: [],
    start: () => new Promise(() => {})});
  assert.equal(observation.listeners(), 0);
});
await test('metadata failure is surfaced without resending the write', async () => {
  const observation = observe(); let starts = 0;
  await assert.rejects(completeRuntimeProjection({observation, cardId: 'hero', document: document(),
    tokenIds: ['one'], start: async () => { starts++; throw Error('SDK rejected'); }}), /SDK rejected/);
  assert.equal(starts, 1); assert.equal(observation.listeners(), 0);
});
await test('missing metadata events time out and remove the subscription', async () => {
  const observation = observe(); let starts = 0;
  await assert.rejects(completeRuntimeProjection({observation, cardId: 'hero', document: document(),
    tokenIds: ['one'], timeoutMs: 15, start: () => { starts++; return new Promise(() => {}); }}), /metadata/);
  assert.equal(starts, 1); assert.equal(observation.listeners(), 0);
});
await test('scene changes and rebinding cancel the old local completion', async () => {
  const observation = observe();
  const operation = completeRuntimeProjection({observation, cardId: 'hero', document: document(),
    tokenIds: ['one'], start: () => new Promise(() => {})});
  observation.changeScene();
  await assert.rejects(operation, /场景已改变/);
  const second = observe();
  const rebound = completeRuntimeProjection({observation: second, cardId: 'hero', document: document(),
    tokenIds: ['one'], start: () => new Promise(() => {})});
  second.emit([{...token(18, 2), metadata: {[BIND]: 'different'}}]);
  await assert.rejects(rebound, /关联已改变/);
});
await test('disabled views do not block; a renderer session change never confirms an old view', async () => {
  const renderer = new BubblePresentation();
  await renderer.waitFor([token(18, 2)]);
  renderer.start();
  const waiting = renderer.waitFor([token(18, 2)]);
  renderer.invalidate();
  await assert.rejects(waiting, /会话已改变/);
  renderer.stop();
});
await test('position-only commits do not notify readers again', async () => {
  const renderer = new BubblePresentation(); renderer.start();
  let notifications = 0; renderer.onChange(() => notifications++);
  renderer.commit([token(18, 2)]);
  renderer.commit([{...token(18, 2), position: {x: 500, y: 500}}]);
  assert.equal(notifications, 1);
});
await test('a renderer may skip to a newer confirmed revision without leaving an earlier receipt pending', async () => {
  const observation = observe(); bubblePresentation.start();
  let complete = false;
  const operation = completeRuntimeProjection({observation, cardId: 'hero', document: document(),
    tokenIds: ['one'], start: () => new Promise(() => {})}).then(() => complete = true);
  observation.emit([token(18, 2)]); await tick();
  const native = token(14, 3); native.metadata[HP].health = 13;
  bubblePresentation.commit([native]); await tick(); assert.equal(complete, false);
  bubblePresentation.commit([token(14, 3)]); await operation;
  bubblePresentation.stop();
});
await test('malformed metadata stamps cannot confirm a saved document or crash the reader', async () => {
  for (const revision of ['invalid', NaN, 1.5]) {
    const item = token(18, 2); item.metadata[BASE].revision = revision;
    assert.equal(runtimeProjectionApplied(item, 'hero', document()), false);
  }
  const item = token(14, 3); delete item.metadata[BASE].value;
  assert.equal(runtimeProjectionApplied(item, 'hero', document()), false);
});
await test('legacy documents confirm their authoritative stats without deleting extra token stats', async () => {
  const legacy = document(); delete legacy.core_stats.hp.max; delete legacy.core_stats.ac;
  assert.equal(runtimeProjectionApplied(token(18, 2), 'hero', legacy), true);
});
console.log(JSON.stringify({controlled: true, realRoomVerified: false, passed: reports.length}));
