import assert from "node:assert/strict";
import sdk, { readyListeners, writes } from "./fixtures/state-sdk";
import { SCENE_KEY, refreshFromScene, getState, startSceneSync, setState, onStateChange, onStateRefreshed, onStateRefreshFailed } from "../src/state";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

const old = deferred<Record<string, any>>();
sdk.scene.getMetadata = () => old.promise;
const oldRead = refreshFromScene();
sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { enabled: { search: false } } });
await refreshFromScene();
old.resolve({ [SCENE_KEY]: { enabled: { search: true } } });
await oldRead;
assert.equal(getState().enabled.search, false);
console.log("PASS 1: late older settings cannot overwrite a newer read");

startSceneSync();
await Promise.resolve(); await Promise.resolve();
const oldScene = deferred<Record<string, any>>();
sdk.scene.getMetadata = () => oldScene.promise;
const switchingRead = refreshFromScene();
readyListeners.forEach(fn => fn(false));
oldScene.resolve({ [SCENE_KEY]: { enabled: { search: true } } });
await switchingRead;
assert.equal(getState().enabled.search, false);
console.log("PASS 2: scene-unload invalidates pending reads");

const staleScene = deferred<Record<string, any>>();
sdk.scene.getMetadata = () => staleScene.promise;
sdk.room.getMetadata = async () => ({
  "com.obr-suite/state-room": { crossSceneSyncSettings: true, enabled: { search: true } },
});
const mirrorRead = refreshFromScene();
readyListeners.forEach(fn => fn(false));
staleScene.resolve({});
await mirrorRead;
assert.equal(writes.length, 0);
console.log("PASS 3: stale room mirror is not written to the next scene");

const beforeWrite = deferred<Record<string, any>>();
sdk.room.getMetadata = async () => ({});
sdk.scene.getMetadata = () => beforeWrite.promise;
const staleRead = refreshFromScene();
await setState({ enabled: { search: true } as any });
beforeWrite.resolve({ [SCENE_KEY]: { enabled: { search: false } } });
await staleRead;
assert.equal(getState().enabled.search, true);
console.log("PASS 4: acknowledged local write invalidates earlier reads");

const oldWrite = deferred<void>();
const roomWrites: unknown[] = [];
sdk.scene.setMetadata = async (data) => { writes.push(data); await oldWrite.promise; };
sdk.room.setMetadata = async (data) => { roomWrites.push(data); };
const writingOldScene = setState({ crossSceneSyncSettings: true, enabled: { search: false } as any });
readyListeners.forEach(fn => fn(false));
readyListeners.forEach(fn => fn(true));
sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { enabled: { search: true } } });
await refreshFromScene();
let oldNotifications = 0;
const stopListening = onStateChange(() => { oldNotifications++; });
oldWrite.resolve();
await writingOldScene;
stopListening();
assert.equal(getState().enabled.search, true, "old scene write acknowledgement replaced new scene settings");
assert.equal(getState().crossSceneSyncSettings, false);
assert.equal(oldNotifications, 0, "old scene write notified current-scene consumers");
assert.equal(roomWrites.length, 0, "old scene write leaked into the room mirror");
console.log("PASS 5: late old-scene writes cannot overwrite, notify or mirror into the new scene");

let refreshNotices = 0;
const stopRefreshNotices = onStateRefreshed(() => { refreshNotices++; });
const superseded = deferred<Record<string, any>>();
const latest = deferred<Record<string, any>>();
sdk.scene.getMetadata = () => superseded.promise;
const supersededRead = refreshFromScene();
sdk.scene.getMetadata = () => latest.promise;
const latestRead = refreshFromScene();
superseded.resolve({ [SCENE_KEY]: { enabled: { search: false } } });
await supersededRead;
assert.equal(refreshNotices, 0, "superseded read incorrectly marked current scene settings ready");
latest.resolve({ [SCENE_KEY]: { enabled: { search: false } } });
await latestRead;
assert.equal(refreshNotices, 1);
sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { enabled: { search: false } } });
await refreshFromScene();
assert.equal(refreshNotices, 2, "unchanged but authoritative settings must also unblock scene entry");
stopRefreshNotices();
console.log("PASS 6: only applied current reads signal readiness, including unchanged values");

const lateWrite = deferred<void>();
const newSceneRead = deferred<Record<string, any>>();
sdk.scene.setMetadata = async (data) => { writes.push(data); await lateWrite.promise; };
const finishOldWrite = setState({ enabled: { search: true } as any });
readyListeners.forEach(fn => fn(false));
readyListeners.forEach(fn => fn(true));
sdk.scene.getMetadata = () => newSceneRead.promise;
const loadingNewScene = refreshFromScene();
lateWrite.resolve();
await finishOldWrite;
newSceneRead.resolve({ [SCENE_KEY]: { enabled: { search: true }, dataVersion: "2024" } });
await loadingNewScene;
assert.equal(getState().dataVersion, "2024", "old write invalidated a still-pending new-scene read");
console.log("PASS 7: old write acknowledgements cannot invalidate pending new-scene reads");

const beforeFailure = getState();
let failedReads = 0, invalidReadiness = 0;
const stopFailures = onStateRefreshFailed(() => { failedReads++; });
const stopReadiness = onStateRefreshed(() => { invalidReadiness++; });
sdk.room.getMetadata = async () => { throw Error("room unavailable"); };
sdk.scene.getMetadata = async () => { throw Error("scene unavailable"); };
await refreshFromScene();
assert.deepEqual(getState(), beforeFailure, "failed reads replaced current cache with default module switches");
assert.equal(failedReads, 1);
assert.equal(invalidReadiness, 0, "failed read incorrectly released the new-scene startup gate");
stopFailures(); stopReadiness();
console.log("PASS 8: failed reads preserve cache, report failure and never signal scene readiness");

// Old rooms and malformed values must never accidentally grant party vision.
sdk.room.getMetadata = async () => ({});
sdk.scene.setMetadata = async (data) => { writes.push(data); };
for (const value of [undefined, false, "true", 1, {}]) {
  sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { fogShareVision: value } });
  await refreshFromScene();
  assert.equal(getState().fogShareVision, false);
  assert.equal(getState().enabled.bossBar, true);
  assert.equal(getState().enabled.transitions, true);
}
let visionChanges = 0;
const stopVisionChanges = onStateChange(() => { visionChanges++; });
sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { fogShareVision: true } });
await refreshFromScene();
assert.equal(getState().fogShareVision, true);
assert.equal(visionChanges, 1, "vision-only metadata change did not notify the fog engine");
await setState({ fogShareVision: false, enabled: { bossBar: false, transitions: false } as any });
assert.equal(getState().fogShareVision, false);
assert.equal(visionChanges, 2);
assert.equal(writes.at(-1)[SCENE_KEY].fogShareVision, false);
assert.equal(writes.at(-1)[SCENE_KEY].enabled.bossBar, false);
assert.equal(writes.at(-1)[SCENE_KEY].enabled.transitions, false);
stopVisionChanges();
console.log("PASS 9: shared vision fails closed for old/malformed rooms and toggles notify/persist with new module switches");
const library = { id: "test-library", name: "Custom", baseUrl: "https://example.com", enabled: true };
for (const value of [undefined, "fr", 1, {}, null]) {
  sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { libraries: [{ ...library, language: value }] } });
  await refreshFromScene();
  assert.equal(getState().libraries.find(lib => lib.id === library.id)?.language, undefined, "malformed/legacy language must stay unclassified");
}
let languageChanges = 0;
const stopLanguageChanges = onStateChange(() => { languageChanges++; });
for (const language of ["en", "zh", "auto"] as const) {
  sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { libraries: [{ ...library, language }] } });
  const before = languageChanges;
  await refreshFromScene();
  assert.equal(getState().libraries.find(lib => lib.id === library.id)?.language, language);
  assert.equal(languageChanges, before + 1, "language-only changes must invalidate content consumers");
  await refreshFromScene();
  assert.equal(languageChanges, before + 1, "equal language must not trigger redundant content loads");
}
await setState({ libraries: [{ ...library, language: "en" }] });
assert.equal(writes.at(-1)[SCENE_KEY].libraries.find((lib: any) => lib.id === library.id)?.language, "en");
stopLanguageChanges();
console.log("PASS 10: library languages validate, persist, invalidate consumers and skip unchanged refreshes");

sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: {} });
await refreshFromScene();
assert.equal(getState().enabled.musicBoard, true);
sdk.scene.getMetadata = async () => ({ [SCENE_KEY]: { enabled: { musicBoard: false } } });
await refreshFromScene();
assert.equal(getState().enabled.musicBoard, false, "restoration must respect an explicitly saved module choice");
await setState({ enabled: { musicBoard: true } as any });
assert.equal(writes.at(-1)[SCENE_KEY].enabled.musicBoard, true);
console.log("PASS 11: music starts enabled by default, preserves saved disable and can be restored explicitly");
console.log("11 settings freshness regressions passed");
