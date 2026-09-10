import assert from "node:assert/strict";
import { f } from "./fixtures/timestop-sdk";
import { setupTimeStop, teardownTimeStop, turnOnTimeStop } from "../src/modules/timeStop";
import { TIME_STOP_META as META, TIME_STOP_READY as READY, TIME_STOP_VIEW as VIEW, TIME_STOP_HIDE as HIDE, TIME_STOP_HIDDEN as HIDDEN, TIME_STOP_RETRY as RETRY } from "../src/modules/timeStopProtocol";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = <T=void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise, resolve}; };
const opens = () => f.native.filter(v => v.channel === "OBR_MODAL_OPEN");
const closes = () => f.native.filter(v => v.channel === "OBR_MODAL_CLOSE");
const lease = () => { const last = opens().at(-1)!.data; return {id: last.id, nonce: new URL(last.url).searchParams.get("window")}; };
const image = (id="image", layer="PROP", locked=false) => ({ id, type: "IMAGE", layer, locked, image: {url: "https://example.test/scene.webp"}, metadata: {} as any });
const state = (active=true, cgUrl: string|null="https://example.test/scene.webp") => ({[META]: {active, cgUrl}});
let count = 0;
async function clean() {
  f.openWait = f.closeWait = f.removeWait = f.updateWait = null;
  f.metadataRead = f.roleRead = f.selectionRead = f.itemsRead = f.connectionRead = null;
  await teardownTimeStop(); await f.flush();
  assert.equal(f.listenerCount(), 0);
  f.role="GM"; f.ready=true; f.metadata={}; f.items=[]; f.selected=[]; f.lang="en";
  f.sent=[]; f.native=[]; f.writes=[]; f.updates=[]; f.deselected=0;
}
async function test(name:string, fn:()=>Promise<void>) { await clean(); await fn(); await clean(); console.log("PASS "+name); count++; }
await test("actual installed SDK emits stable GM IMAGE except CHARACTER menu and local language update", async () => {
  await setupTimeStop(); const first=f.native.find(v=>v.channel==="OBR_CONTEXT_MENU_CREATE")!.data;
  assert.deepEqual(first.icons[0].filter, {roles:["GM"],every:[{key:"type",value:"IMAGE"},{key:"layer",value:"CHARACTER",operator:"!="}],min:1,max:1});
  await f.language("zh"); const second=f.native.filter(v=>v.channel==="OBR_CONTEXT_MENU_CREATE").at(-1)!.data;
  assert.equal(first.id,second.id); assert.equal(second.icons[0].label,"显示为 CG"); assert.equal(opens().length,0);
  assert.equal(f.native.filter(v=>v.channel==="OBR_CONTEXT_MENU_REMOVE").length,0);
});
await test("CG supports every actual non-character image layer and never trusts context snapshots", async () => {
  await setupTimeStop();
  for(const layer of ["MAP","PROP","MOUNT","ATTACHMENT","NOTE","DRAWING","TEXT","RULER","FOG"]){
    f.items=[image("cg",layer)]; await f.click([f.items[0]]); assert.equal(f.writes.at(-1)?.[META].cgUrl,"https://example.test/scene.webp");
    await f.scene(false); f.metadata={}; await f.scene(true);
  }
  const before=f.writes.length;
  for(const item of [image("cg","CHARACTER"), {...image("cg"),type:"TEXT"}, {...image("cg"),image:{url:"javascript:alert(1)"}}]){
    f.items=[item]; await f.click([image("cg")]); assert.equal(f.writes.length,before);
  }
});
await test("players and foreign local messages cannot write or force remote CG", async()=>{
  f.role="PLAYER"; await setupTimeStop(); f.items=[image()]; await f.click(f.items);
  await f.emit("com.obr-suite/timestop-toggle",{},"player-connection"); await turnOnTimeStop();
  await f.emit("com.time-stop/on",{active:true,cgUrl:"https://evil.test/x"},"player-connection");
  assert.equal(f.writes.length,0); assert.equal(opens().length,0);
  await f.emit("com.time-stop/on",{active:true,cgUrl:"https://evil.test/x"},"gm-connection"); assert.equal(opens().length,0);
});
await test("revocation or scene change during actual item fetch cancels old CG write",async()=>{
  await setupTimeStop();
  for(const revoke of [true,false]){
    const wait=deferred<any>(); f.itemsRead=()=>wait.promise;
    await f.click([image()]); if(revoke) await f.player("PLAYER"); else await f.scene(false);
    wait.resolve([image()]); await f.flush(); assert.equal(f.writes.length,0);
    f.itemsRead=null; await f.player("GM"); if(!revoke) await f.scene(true);
  }
});
await test("new metadata supersedes delayed initial read and unrelated snapshots never reopen CG",async()=>{
  const wait=deferred<any>(); f.metadataRead=()=>wait.promise; const setup=setupTimeStop(); await f.flush();
  await f.snapshot(state()); await f.flush(); assert.equal(opens().length,1);
  wait.resolve({}); await setup; f.metadataRead=null; await f.flush();
  assert.equal(f.sent.filter(v=>v.channel==="com.obr-suite/timestop-state").at(-1)?.data.active,true);
  assert.equal(f.sent.filter(v=>v.channel===HIDE).length,0);
  assert.equal(opens().length,1); await f.snapshot({...state(),unrelated:2}); await f.player("GM"); await f.language("zh");
  assert.equal(opens().length,1); assert.equal(closes().length,0);
});
await test("exact local window ready/hide and fade completion precede native close",async()=>{
  f.role="PLAYER"; f.metadata=state(); await setupTimeStop(); await f.flush(); const own=lease();
  assert.equal(opens()[0].data.fullScreen,true); assert.equal(opens()[0].data.disablePointerEvents,false);
  await f.emit(READY,{nonce:own.nonce},"player-connection"); assert.equal(f.sent.filter(v=>v.channel===VIEW).length,0);
  await f.emit(READY,{nonce:own.nonce}); assert.equal(f.sent.filter(v=>v.channel===VIEW).length,1);
  await f.snapshot(state(false)); assert.equal(f.sent.at(-2)?.channel===HIDE || f.sent.some(v=>v.channel===HIDE),true); assert.equal(closes().length,0);
  await f.emit(HIDDEN,{nonce:"old"}); await f.emit(HIDDEN,{nonce:own.nonce},"player-connection"); assert.equal(closes().length,0);
  await f.emit(HIDDEN,{nonce:own.nonce}); assert.equal(closes().at(-1)?.data.id,own.id);
});
await test("missing iframe fade acknowledgement has bounded close fallback",async()=>{
  f.metadata=state(); await setupTimeStop(); await f.flush(); await f.snapshot(state(false));
  await pause(980); assert.equal(closes().length,1);
});
await test("failed native close stays owned, exposes retry, and retries the exact ID",async()=>{
  f.metadata=state(); await setupTimeStop(); await f.flush(); const own=lease();
  f.closeWait=async()=>{throw Error("native-close-failed");}; await f.snapshot(state(false)); await f.emit(HIDDEN,{nonce:own.nonce});
  assert.ok(f.sent.some(v=>v.channel===VIEW && v.data.error===true));
  await assert.rejects(teardownTimeStop(),/cleanup failed/); assert.ok(f.listenerCount()>0);
  f.closeWait=null; await teardownTimeStop(); assert.equal(f.listenerCount(),0);
  assert.ok(closes().every(v=>v.data.id===own.id));
});
await test("failed close local button retries; remote retry does nothing",async()=>{
  f.metadata=state(); await setupTimeStop(); await f.flush(); const own=lease();
  f.closeWait=async()=>{throw Error("close");}; await f.snapshot(state(false)); await f.emit(HIDDEN,{nonce:own.nonce});
  const before=closes().length; f.closeWait=null;
  await f.emit(RETRY,{nonce:own.nonce},"player-connection"); assert.equal(closes().length,before);
  await f.emit(RETRY,{nonce:own.nonce}); assert.equal(closes().length,before+1); assert.equal(opens().length,1);
});
await test("old pending open after scene switch is closed by own ID before replacement",async()=>{
  const wait=deferred(); f.openWait=()=>wait.promise; f.metadata=state(); await setupTimeStop(); await f.flush(); const old=lease();
  await f.scene(false); f.openWait=null; f.metadata=state(true,"https://example.test/new.webp"); await f.scene(true);
  wait.resolve(); await f.flush(); assert.ok(closes().some(v=>v.data.id===old.id));
  assert.equal(opens().length,2); const next=lease(); assert.notEqual(next.id,old.id);
  await f.emit(READY,{nonce:old.nonce}); assert.ok(!closes().some(v=>v.data.id===next.id));
});
await test("original locked token stays locked; only owned temporary locks are restored",async()=>{
  f.role="PLAYER"; f.items=[image("locked","CHARACTER",true),image("free","CHARACTER",false)]; f.selected=["locked","free"];
  await setupTimeStop(); await f.snapshot(state());
  assert.equal(f.items[0].locked,true); assert.equal(f.items[1].locked,true); assert.equal(f.deselected,1);
  await pause(290); assert.equal(f.items[0].locked,true); assert.equal(f.items[1].locked,false);
});
await test("late selection and delayed item drafts cannot lock a new scene",async()=>{
  f.role="PLAYER"; f.items=[image("same","CHARACTER")]; f.selected=["same"]; await setupTimeStop();
  const wait=deferred(); f.updateWait=()=>wait.promise; await f.snapshot(state());
  await f.scene(false); f.items=[image("same","CHARACTER")]; f.metadata={}; await f.scene(true);
  wait.resolve(); f.updateWait=null; await f.flush(); await pause(280); assert.equal(f.items[0].locked,false); assert.equal(f.deselected,0);
});
await test("same-scene teardown drains temporary locks and scene listeners",async()=>{
  f.role="PLAYER"; f.items=[image("free","CHARACTER")]; f.selected=["free"]; await setupTimeStop(); await f.snapshot(state());
  assert.equal(f.items[0].locked,true); await teardownTimeStop(); assert.equal(f.items[0].locked,false); assert.equal(f.listenerCount(),0);
});
await test("initial required connection failure is observable and recoverable",async()=>{
  f.connectionRead=async()=>{throw Error("connection failed");}; await assert.rejects(setupTimeStop(),/connection failed/);
  await teardownTimeStop(); f.connectionRead=null; await setupTimeStop(); assert.ok(f.native.some(v=>v.channel==="OBR_CONTEXT_MENU_CREATE"));
});
await test("failed menu removal is observable and must clear before restart",async()=>{
  await setupTimeStop(); f.removeWait=async()=>{throw Error("remove failed");}; await assert.rejects(teardownTimeStop(),/cleanup failed/);
  const n=f.native.filter(v=>v.channel==="OBR_CONTEXT_MENU_CREATE").length;
  await assert.rejects(setupTimeStop(),/cleanup failed/); assert.equal(f.native.filter(v=>v.channel==="OBR_CONTEXT_MENU_CREATE").length,n);
  f.removeWait=null; await teardownTimeStop(); await setupTimeStop(); assert.equal(f.native.filter(v=>v.channel==="OBR_CONTEXT_MENU_CREATE").length,n+1);
});
console.log("TIMESTOP_SELFTEST "+count+"/"+count);
