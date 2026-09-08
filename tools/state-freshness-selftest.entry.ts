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
console.log("8 settings freshness regressions passed");
