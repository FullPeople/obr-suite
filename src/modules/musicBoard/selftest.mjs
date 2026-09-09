import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";
const out = mkdtempSync(join(tmpdir(), "music-board-selftest-"));
const KEY = "com.obr-suite/music-board:session", CMD = "com.obr-suite/music-board:command";
const settle = async () => { for (let i = 0; i < 70; i++) await Promise.resolve(); };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const track = (id, bus = "bgm") => ({ id, url: "https://example.invalid/" + id + ".ogg", name: id, bus, loop: false, duration: 100 });
let serial = 0;
async function bundle(entry, mutation) {
  let changed = false;
  const build = await rolldown({ input: resolve("src/modules/musicBoard/" + entry + ".ts"), platform: "node", plugins: [{ name: "music-sdk-boundary",
    resolveId(source) { if (source === "@owlbear-rodeo/sdk") return "mock:sdk"; },
    load(id) {
      if (id === "mock:sdk") return "export default globalThis.__MUSIC_SDK__;";
      if (mutation && id.replaceAll("\\", "/").endsWith(mutation.file)) { const source = readFileSync(id, "utf8"); assert.ok(source.includes(mutation.from), mutation.name); changed = true; return source.replace(mutation.from, mutation.to); }
    },
  }] });
  const file = join(out, entry + "-" + serial++ + ".mjs"); await build.write({ file, format: "esm" }); await build.close(); if (mutation) assert.ok(changed); return import(pathToFileURL(file).href);
}
function network() {
  const clients = new Map(), players = new Map(); let metadata = {}, writes = [], writeGate = null;
  const deliver = (channel, data, connectionId, destination = "ALL") => { for (const [id, client] of clients) {
    if (destination === "LOCAL" && id !== connectionId || destination === "REMOTE" && id === connectionId) continue;
    client.emit(channel, { data: structuredClone(data), connectionId });
  } };
  function add(id, role) {
    const callbacks = new Map();
    const on = (key, fn) => { if (!callbacks.has(key)) callbacks.set(key, new Set()); callbacks.get(key).add(fn); return () => callbacks.get(key).delete(fn); };
    const player = { id, connectionId: id, role, name: id }; players.set(id, player);
    const client = { readGate: null, readCalls: 0, emit: (key, data) => { for (const fn of [...(callbacks.get(key) || [])]) void fn(data); }, sdk: null };
    client.sdk = {
      player: { getId: async () => id, getConnectionId: async () => id, getRole: async () => player.role, onChange: fn => on("player", fn) },
      party: { getPlayers: async () => [...players.values()].filter(p => p.id !== id), onChange: fn => on("party", fn) },
      room: { getMetadata: async () => { client.readCalls++; const copy = structuredClone(metadata); const blocked = client.readGate; if (blocked) await blocked.promise; return copy; },
        setMetadata: async patch => { writes.push({ id, patch: structuredClone(patch) }); const blocked = writeGate; if (blocked) await blocked.promise;
          metadata = { ...metadata, ...structuredClone(patch) }; for (const target of clients.values()) target.emit("metadata", structuredClone(metadata)); }, onMetadataChange: fn => on("metadata", fn) },
      scene: { isReady: async () => true, getMetadata: async () => ({ "com.obr-suite/music-board:state": { bgm: { url: "https://example.invalid/legacy.ogg", name: "Legacy", loop: true, paused: false, position: 12 }, sfx: [{ id: "old", url: "https://example.invalid/sfx.ogg", name: "Old" }] } }) },
      broadcast: { sendMessage: async (channel, data, options = {}) => deliver(channel, data, id, options.destination || "REMOTE"), onMessage: on },
    };
    clients.set(id, client); return client;
  }
  return { add, deliver, clients, players, get metadata() { return metadata; }, set metadata(value) { metadata = value; }, get writes() { return writes; },
    set writeGate(value) { writeGate = value; }, changed: () => { for (const [id, client] of clients) client.emit("party", [...players.values()].filter(p => p.id !== id)); } };
}
async function roomTest(mutation) {
  const pool = network(), a = pool.add("A", "GM"), b = pool.add("B", "PLAYER"), c = pool.add("C", "GM");
  globalThis.__MUSIC_SDK__ = a.sdk; const { RoomMusic } = await bundle("room", mutation); const host = new RoomMusic(() => {}); await host.start();
  globalThis.__MUSIC_SDK__ = b.sdk; const { RoomMusic: PlayerRoom } = await bundle("room", mutation); const player = new PlayerRoom(() => {}); await player.start();
  globalThis.__MUSIC_SDK__ = c.sdk; const { RoomMusic: OtherRoom } = await bundle("room", mutation); const other = new OtherRoom(() => {}); await other.start(); pool.changed();
  let releaseWrite = null;
  try {
    assert.equal(pool.writes.length, 0, "startup must not erase/migrate-write old scene music");
    assert.equal(host.state.bgm.track.name, "Legacy"); assert.equal(host.state.bgm.paused, true); assert.equal(host.state.sfx.length, 0);
    await player.submit({ type: "add", tracks: [track("one"), track("two"), track("bell", "sfx")] });
    const blocked = gate(); releaseWrite = blocked.resolve; pool.writeGate = blocked;
    const first = player.submit({ type: "queue", id: "one" }, "queue-one"); first.catch(()=>{}); await settle();
    const second = other.submit({ type: "queue", id: "two" }, "queue-two"); second.catch(()=>{}); await settle();
    assert.equal(pool.writes.at(-1).id, "A"); assert.equal(pool.writes.length, 2, "second concurrent command must wait for first persistence");
    pool.writeGate = null; blocked.resolve(); await Promise.all([first, second]);
    assert.deepEqual(host.state.queue, ["one", "two"]); assert.deepEqual(player.state.queue, ["one", "two"]);
    const count = pool.writes.length; await player.submit({ type: "queue", id: "one" }, "queue-one"); assert.equal(pool.writes.length, count, "retransmitted command id must not enqueue twice");
    await player.submit({ type: "next" }); const playing = host.state.bgm.playbackId;
    assert.equal(host.state.bgm.track.id, "one"); assert.deepEqual(host.state.queue, ["two"]);
    if (!mutation) {
      const beforeStale = pool.writes.length;
      for (const type of ["pause", "resume", "seek", "loop", "stop"])
        await assert.rejects(player.submit({ type, expectedPlaybackId: "previous-track", position: 20, value: true }), /stalePlayback/);
      assert.equal(pool.writes.length, beforeStale, "a delayed Studio action must not affect the replacement track");
    }
    await assert.rejects(other.submit({ type: "duration", playbackId: playing, duration: 88 }), /permission/);
    await host.submit({ type: "duration", playbackId: playing, duration: 88 }); assert.equal(player.state.bgm.track.duration, 88);
    const beforeOldDeadline = pool.writes.length;
    await host.submit({ type: "ended", playbackId: playing });
    await host.submit({ type: "duration", playbackId: "old-playback", duration: 5 });
    assert.equal(pool.writes.length, beforeOldDeadline, "early/stale automatic messages cannot write or consume the queue");
    assert.deepEqual(host.state.queue, ["two"]);
    await player.submit({ type: "sfx", id: "bell" }); const sound1 = host.state.sfx.at(-1).id;
    await player.submit({ type: "sfx", id: "bell" }); assert.notEqual(host.state.sfx.at(-1).id, sound1, "deliberately retriggered sound needs new event id");
    await host.submit({ type: "allowPlayers", value: false });
    await assert.rejects(player.submit({ type: "stop" }), /permission/); assert.equal(host.state.bgm.playbackId, playing);
    const beforeSpoof = pool.writes.length;
    pool.deliver(CMD, { requestId: "spoof", op: { type: "stop" }, role: "GM" }, "outsider"); await settle(); assert.equal(pool.writes.length, beforeSpoof);
    await host.submit({ type: "allowPlayers", value: true });
    const staleRead = gate(); a.readGate = staleRead;
    const rejectedByHandoff = player.submit({ type: "stop" }, "handoff-stop").catch(() => {}); await settle();
    // The old client is stopping (as on disconnect), and others receive new party membership.
    const stopping = host.stop(); pool.players.delete("A"); pool.changed(); a.readGate = null; staleRead.resolve(); await stopping; await settle();
    const beforeHandoff = pool.writes.length;
    await other.submit({ type: "pause" }); assert.equal(pool.writes.length, beforeHandoff + 1); assert.equal(pool.writes.at(-1).id, "C"); assert.ok(other.state.bgm.paused);
    assert.equal(other.state.bgm.track.id, "one"); assert.deepEqual(other.state.queue, ["two"]);
    const beforeStop = structuredClone(pool.metadata); await host.stop(); assert.deepEqual(pool.metadata, beforeStop); pool.clients.delete("A");
    const d = pool.add("D", "PLAYER"); pool.changed(); globalThis.__MUSIC_SDK__ = d.sdk;
    const { RoomMusic: LateRoom } = await bundle("room", mutation); const late = new LateRoom(() => {}); await late.start();
    assert.deepEqual(late.state.queue, ["two"]); assert.equal(late.state.bgm.track.id, "one"); assert.ok(late.state.bgm.paused);
    pool.metadata = { ...pool.metadata, unrelatedExtension: "x".repeat(16000) };
    const retained = structuredClone(pool.metadata[KEY]); await assert.rejects(other.submit({ type: "add", tracks: [track("large")] }), /roomFull/);
    assert.deepEqual(pool.metadata[KEY], retained);
    delete pool.metadata.unrelatedExtension;
    await other.submit({ type: "allowPlayers", value: false });
    await other.stop(); pool.players.delete("C"); pool.clients.delete("C"); pool.changed();
    assert.equal(player.writer, "B");
    await player.submit({ type: "duration", playbackId: playing, duration: 89 });
    assert.equal(late.state.bgm.track.duration, 89, "automatic playback maintenance survives the last GM leaving under a GM-only policy");
    await assert.rejects(player.submit({ type: "stop" }), /permission/);
    await late.stop(); await player.stop(); await rejectedByHandoff;
  } finally { releaseWrite?.(); await Promise.all([host.stop(), player.stop(), other.stop()]); }
}
async function audioTest() {
  const voices = [];
  class MockAudio extends EventTarget {
    constructor(url) { super(); this.src = url; this.currentTime = 0; this.duration = 100; this.paused = true; this.playCalls = 0; voices.push(this); }
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; } removeAttribute() { this.src = ""; } load() {}
  }
  const gain = () => ({ gain: { value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } }, connect() { return this; }, disconnect() {} });
  globalThis.Audio = MockAudio; globalThis.AudioContext = class { state = "running"; currentTime = 0; destination = {}; createGain = gain;
    createDynamicsCompressor() { const node = gain(); for (const key of ["threshold","ratio","attack","release","knee"]) node[key] = { value: 0 }; return node; }
    createMediaElementSource() { return gain(); } async resume() {} async close() { this.state = "closed"; } };
  const { MusicAudio } = await bundle("audio"), { emptySession, reduceMusic } = await bundle("model"); let ended = 0;
  const engine = new MusicAudio(() => {}, () => ended++); let state = reduceMusic(emptySession(), { type: "play", track: track("one") }, "play-one");
  engine.apply(state); assert.equal(voices[0].playCalls, 0); engine.unlock(); await settle(); assert.equal(voices[0].playCalls, 1);
  for (let i = 0; i < 100; i++) engine.apply(structuredClone(state)); await settle(); assert.equal(voices[0].playCalls, 1);
  state = reduceMusic(state, { type: "sfx", track: track("bell", "sfx") }, "sound-one"); engine.apply(state); await settle();
  voices.at(-1).dispatchEvent(new Event("ended")); engine.apply(state); assert.equal(voices.length, 2, "finished one-shot never resurrects");
  state = reduceMusic(state, { type: "play", track: track("two") }, "play-two"); engine.apply(state); await settle();
  const current = voices.at(-1); state = reduceMusic(state, { type: "pause" }, "pause-two"); engine.apply(state);
  assert.equal(current.paused, true); await new Promise(resolve => setTimeout(resolve, 320)); assert.equal(current.src, track("two").url, "old fade must not erase new track");
  engine.volume = { bgm: .2, sfx: .4, mute: true }; engine.volumeChanged(); assert.equal(state.bus.bgm, .8);
  engine.dispose(); assert.ok(voices.every(voice => voice.paused)); assert.equal(ended, 0);
}
async function peerTest() {
  const { StudioPeer, studioOperation } = await bundle("peer");
  class Emitter { handlers = new Map(); on(key, fn) { if (!this.handlers.has(key)) this.handlers.set(key, []); this.handlers.get(key).push(fn); } emit(key, value) { for (const fn of this.handlers.get(key) || []) fn(value); } close() { this.emit("close"); } }
  const peers = [];
  class Peer extends Emitter { constructor() { super(); this.connection = new Emitter(); peers.push(this); } connect() { return this.connection; } destroy() {} }
  const commands = [], bridge = new StudioPeer(op => commands.push(op), () => {}, async () => Peer);
  await bridge.connect("ABCDEF"); peers[0].emit("open"); peers[0].connection.emit("open"); peers[0].connection.emit("data", { type: "bgm-load", ...track("one") });
  assert.equal(commands.length, 1); peers[0].connection.emit("close"); assert.equal(commands.length, 1);
  await bridge.connect("ABCDEF", true); peers[1].emit("open"); peers[1].connection.emit("open"); peers[1].connection.emit("data", { type: "bgm-load", ...track("old") });
  assert.equal(bridge.status, "restored"); assert.equal(commands.length, 1);
  peers[0].connection.emit("data", { type: "bgm-stop" }); assert.equal(commands.length, 1);
  bridge.adopt(); assert.equal(commands.length, 2); assert.equal(commands.at(-1).track.name, "old"); bridge.disconnect();
  assert.equal(studioOperation({ type: "bgm-load", url: "blob:private-file" }), null);
  assert.deepEqual(studioOperation({ type: "bgm-pause", position: 23 }), { type: "pause", position: 23 });
}
async function modernPeerTest() {
  const { StudioPeer } = await bundle("peer"), { emptySession, reduceMusic } = await bundle("model");
  const { StudioRoomSync } = await import(pathToFileURL(resolve("tools/music-studio/room-sync.js")).href);
  class Emitter { handlers = new Map(); sent = []; on(k,f) { if(!this.handlers.has(k))this.handlers.set(k,[]);this.handlers.get(k).push(f); } emit(k,v) { for(const f of this.handlers.get(k)||[])f(v); } send(m) { this.sent.push(m); } close(){} }
  const peers=[];class Peer extends Emitter { constructor(){super();this.connection=new Emitter();peers.push(this);}connect(){return this.connection;}destroy(){} }
  const calls=[],blocked=gate();const bridge=new StudioPeer((op,id)=>{calls.push({op,id});return blocked.promise;},()=>{},async()=>Peer);
  const state=reduceMusic(emptySession(),{type:"play",track:track("one"),position:19,paused:true},"first",1000);
  assert.equal(state.bgm.paused,true,"fresh-room Studio bootstrap can load paused atomically");
  bridge.publish(state);await bridge.connect("ABCDEF",true);peers[0].emit('open');const c=peers[0].connection;c.emit('open');c.emit('data',{type:'studio-ready',protocol:2});
  const snapshot=c.sent.at(-1);assert.equal(snapshot.type,'room-state');assert.equal(snapshot.state.bgm.position,19);assert.equal(snapshot.adoptStudio,false);assert.equal(bridge.status,'connected');
  const msg={type:'studio-command',sessionId:snapshot.sessionId,requestId:'studio-action',command:{type:'bgm-pause',expectedPlaybackId:'first'}};
  c.emit('data',msg);c.emit('data',msg);await settle();assert.equal(calls.length,1);assert.equal(calls[0].op.expectedPlaybackId,'first');assert.equal(c.sent.some(m=>m.type==='studio-ack'),false,"ACK waits for room persistence");
  blocked.resolve();await settle();assert.equal(c.sent.at(-1).ok,true);
  await bridge.connect("ABCDEF",true);peers[1].emit('open');peers[1].connection.emit('open');peers[1].connection.emit('data',{type:'studio-ready',protocol:2});
  const newSession=peers[1].connection.sent.at(-1).sessionId;
  assert.notEqual(newSession,snapshot.sessionId);peers[1].connection.emit('data',msg);c.emit('data',msg);await settle();assert.equal(calls.length,1,"old handshake/connection cannot control the room");
  peers[1].connection.emit('data',{...msg,sessionId:newSession,requestId:'studio-disconnecting'});bridge.disconnect();await settle();assert.equal(calls.length,1,"disconnect before queued dispatch cancels it");
  const sent=[],applied=[],failed=[];let bootstrap=0;
  const sync=new StudioRoomSync(m=>sent.push(m),m=>applied.push(m),()=>bootstrap++,e=>failed.push(e));
  sync.receive({...snapshot,sequence:3});sync.receive({...snapshot,sequence:2,state:{...snapshot.state,bgm:null}});
  sync.receive({...snapshot,sessionId:'old',sequence:100});assert.equal(applied.length,1,"older sequence and foreign session ignored");
  for(let i=0;i<50;i++)sync.command({type:'volume',bus:'bgm',vol:i/50});await new Promise(r=>setTimeout(r,140));
  const commands=sent.filter(m=>m.type==='studio-command');assert.equal(commands.length,1);assert.equal(commands[0].command.vol,.98);
  sync.receive({type:'studio-ack',sessionId:snapshot.sessionId,requestId:commands[0].requestId,ok:false,error:'roomFull'});assert.deepEqual(failed,['roomFull']);
  sync.dispose();sync.receive({...snapshot,sequence:10});assert.equal(applied.length,1);assert.equal(bootstrap,0);
  console.log("Studio v2 unit checks PASS: persistence ACK, target guard, session/sequence isolation, 50 volume inputs coalesce, failure feedback, dispose.");
}
try {
  await roomTest(); await audioTest(); await peerTest(); await modernPeerTest();
  const mutations = [
    { name: "dedup", file: "musicBoard/room.ts", from: "if (state.recent.includes(request.requestId)) ok = true;", to: "if (false) ok = true;" },
    { name: "serialize", file: "musicBoard/room.ts", from: "this.queue = this.queue.then(() => this.execute(data, event.connectionId))", to: "this.queue = this.execute(data, event.connectionId)" },
    { name: "permission", file: "musicBoard/room.ts", from: 'if (!sender || (!automatic && sender.role !== "GM" && (!state.allowPlayers || request.op.type === "allowPlayers")))', to: 'if (!sender)' },
  ];
  for (const mutation of mutations) { let failed = false; try { await roomTest(mutation); } catch (error) { if (error.code !== "ERR_ASSERTION") throw error; failed = true; } assert.ok(failed, "surviving mutation " + mutation.name); }
  console.log("Music selftest PASS: actual multi-client writer serialization, identity permissions, 3/3 mutations, duplicate commands, handoff/late join, quota non-destruction, legacy import, audio dedup/fade cleanup, Peer reconnect isolation.");
} catch (error) { console.error(error); console.error("Artifacts: " + out); process.exitCode = 1; }
