/* Music-board engine — lives in the background plugin iframe.
 *
 * Holds all state that needs to OUTLIVE the popover:
 *   • WebAudio context + node chains + the <audio> elements driving
 *     playback (BGM + per-id SFX)
 *   • OBR scene-metadata subscription (the source of truth: a paired
 *     studio writes here; this engine reads + plays)
 *   • PeerJS peer + active connection + last-used pair code
 *   • Per-client local volume + mute (persisted to localStorage)
 *
 * The popover (music-board-page.ts) is a thin viewer that talks to
 * us via OBR.broadcast LOCAL on two channels:
 *   "com.obr-suite/music-board:cmd"    popover → engine commands
 *   "com.obr-suite/music-board:state"  engine → popover snapshots
 *
 * Both ends run within the SAME OBR room context, so LOCAL broadcasts
 * stay on this user's machine and don't pollute the room messages.
 *
 * The background.ts module entry calls `setupMusicEngine()` on plugin
 * activation; everything below survives popover open/close cycles.
 */

import OBR from "@owlbear-rodeo/sdk";

const META_KEY     = "com.obr-suite/music-board:state";
const BC_CMD       = "com.obr-suite/music-board:cmd";
const BC_STATE     = "com.obr-suite/music-board:state";
const LS_VOL       = "obr-music-board:local-volumes";
const LS_PAIR_CODE = "obr-music-board:last-pair-code";

// ---- Types -----------------------------------------------------------

interface MusicState {
  bgm: BgmEntry | null;
  sfx: SfxEntry[];
  bus: { bgm: number; sfx: number };
  ts: number;
}
interface BgmEntry {
  url: string;
  name: string;
  loop: boolean;
  position: number;
  startedAt: number;
  paused: boolean;
}
interface SfxEntry {
  id: string;
  url: string;
  name: string;
  loop: boolean;
}

const DEFAULT_STATE: MusicState = {
  bgm: null, sfx: [],
  bus: { bgm: 0.8, sfx: 1.0 },
  ts: 0,
};

// ---- Local volume (per-client) ---------------------------------------
const localVol = { bgm: 0.8, sfx: 1.0, mute: false };
try {
  const v = JSON.parse(localStorage.getItem(LS_VOL) || "{}");
  if (typeof v.bgm === "number")  localVol.bgm = v.bgm;
  if (typeof v.sfx === "number")  localVol.sfx = v.sfx;
  if (typeof v.mute === "boolean") localVol.mute = v.mute;
} catch {}
function saveLocalVol() {
  try { localStorage.setItem(LS_VOL, JSON.stringify(localVol)); } catch {}
}

// ---- WebAudio engine -------------------------------------------------
let audioCtx: AudioContext | null = null;
let masterLimiter: DynamicsCompressorNode | null = null;
function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterLimiter = audioCtx.createDynamicsCompressor();
    masterLimiter.threshold.value = -3;
    masterLimiter.ratio.value = 20;
    masterLimiter.attack.value = 0.001;
    masterLimiter.release.value = 0.05;
    masterLimiter.knee.value = 0;
    masterLimiter.connect(audioCtx.destination);
  }
  return audioCtx;
}
interface AudioChain {
  fadeGain: GainNode;
  busGain:  GainNode;
  duckGain?: GainNode;
}
const chainMap = new WeakMap<HTMLAudioElement, AudioChain>();
function ensureChain(audio: HTMLAudioElement, bus: "bgm" | "sfx"): AudioChain {
  let chain = chainMap.get(audio);
  if (chain) return chain;
  const ctx = getCtx();
  const src = ctx.createMediaElementSource(audio);
  const fadeGain = ctx.createGain();
  fadeGain.gain.value = 0;
  const busGain = ctx.createGain();
  busGain.gain.value = busVolumeFor(bus);
  audio.volume = 1;
  if (bus === "bgm") {
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;
    src.connect(fadeGain).connect(duckGain).connect(busGain).connect(masterLimiter!);
    chain = { fadeGain, busGain, duckGain };
  } else {
    src.connect(fadeGain).connect(busGain).connect(masterLimiter!);
    chain = { fadeGain, busGain };
  }
  chainMap.set(audio, chain);
  return chain;
}
function busVolumeFor(bus: "bgm" | "sfx"): number {
  const localK = bus === "bgm" ? localVol.bgm : localVol.sfx;
  const remote = bus === "bgm" ? currentState.bus.bgm : currentState.bus.sfx;
  return Math.max(0, Math.min(1, remote * localK * (localVol.mute ? 0 : 1)));
}
function rampGain(g: GainNode, target: number, ms: number) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(target, t + ms / 1000);
}

const FADE_IN_MS  = 350;
const FADE_OUT_MS = 280;

let currentState: MusicState = structuredClone(DEFAULT_STATE);

const bgmAudio = new Audio();
bgmAudio.preload = "auto";
bgmAudio.crossOrigin = "anonymous";
const sfxAudios = new Map<string, HTMLAudioElement>();

function applyBgmVolume() {
  const chain = chainMap.get(bgmAudio);
  if (chain) rampGain(chain.busGain, busVolumeFor("bgm"), 120);
  else bgmAudio.volume = busVolumeFor("bgm");
}
function applySfxVolume() {
  const v = busVolumeFor("sfx");
  for (const a of sfxAudios.values()) {
    const chain = chainMap.get(a);
    if (chain) rampGain(chain.busGain, v, 120);
    else a.volume = v;
  }
}
function updateDucking() {
  const chain = chainMap.get(bgmAudio);
  if (!chain?.duckGain) return;
  const anySfx = [...sfxAudios.values()].some((a) => !a.paused);
  rampGain(chain.duckGain, anySfx ? 0.4 : 1.0, anySfx ? 400 : 800);
}

function livePosition(bgm: BgmEntry): number {
  if (bgm.paused) return bgm.position;
  const dtSec = (Date.now() - bgm.startedAt) / 1000;
  return Math.max(0, bgm.position + dtSec);
}

// ---- State application (metadata → audio) ----------------------------
let lastBgmKey = "";
let lastSfxIds: Set<string> = new Set();

async function applyState(next: MusicState) {
  currentState = next;
  applyBgmVolume();
  applySfxVolume();

  const bgm = next.bgm;
  const key = bgm ? `${bgm.url}|${bgm.loop}` : "";
  if (key !== lastBgmKey) {
    const cur = chainMap.get(bgmAudio);
    if (cur && !bgmAudio.paused) {
      rampGain(cur.fadeGain, 0, FADE_OUT_MS);
      await new Promise((r) => setTimeout(r, FADE_OUT_MS + 20));
    }
    try { bgmAudio.pause(); } catch {}
    if (bgm) {
      bgmAudio.src = bgm.url;
      bgmAudio.loop = bgm.loop;
      bgmAudio.currentTime = Math.max(0, livePosition(bgm));
      if (!bgm.paused) {
        try {
          await getCtx().resume();
          const chain = ensureChain(bgmAudio, "bgm");
          rampGain(chain.fadeGain, 0, 0);
          await bgmAudio.play();
          rampGain(chain.fadeGain, 1, FADE_IN_MS);
          updateDucking();
        } catch {
          publishState(); // popover may show "tap to allow"
        }
      }
    } else {
      bgmAudio.removeAttribute("src");
      bgmAudio.load();
    }
    lastBgmKey = key;
  } else if (bgm) {
    const chain = chainMap.get(bgmAudio);
    if (bgm.paused && !bgmAudio.paused) {
      if (chain) {
        rampGain(chain.fadeGain, 0, FADE_OUT_MS);
        setTimeout(() => { try { bgmAudio.pause(); } catch {} }, FADE_OUT_MS + 20);
      } else { bgmAudio.pause(); }
    } else if (!bgm.paused && bgmAudio.paused) {
      bgmAudio.currentTime = livePosition(bgm);
      try {
        await getCtx().resume();
        const c = ensureChain(bgmAudio, "bgm");
        rampGain(c.fadeGain, 0, 0);
        await bgmAudio.play();
        rampGain(c.fadeGain, 1, FADE_IN_MS);
        updateDucking();
      } catch {}
    } else if (!bgm.paused) {
      const target = livePosition(bgm);
      if (Math.abs(bgmAudio.currentTime - target) > 1.5) {
        bgmAudio.currentTime = target;
      }
    }
  }

  // SFX diff
  const desired = new Set(next.sfx.map((s) => s.id));
  for (const id of lastSfxIds) {
    if (!desired.has(id)) {
      const a = sfxAudios.get(id);
      if (a) {
        const c = chainMap.get(a);
        if (c) {
          rampGain(c.fadeGain, 0, FADE_OUT_MS);
          setTimeout(() => {
            try { a.pause(); } catch {}
            sfxAudios.delete(id);
            updateDucking();
          }, FADE_OUT_MS + 20);
        } else {
          try { a.pause(); } catch {}
          sfxAudios.delete(id);
        }
      }
    }
  }
  for (const s of next.sfx) {
    if (!sfxAudios.has(s.id)) {
      const a = new Audio(s.url);
      a.preload = "auto";
      a.crossOrigin = "anonymous";
      a.loop = !!s.loop;
      a.addEventListener("ended", () => {
        if (!a.loop) {
          sfxAudios.delete(s.id);
          updateDucking();
          publishState();
        }
      });
      sfxAudios.set(s.id, a);
      try {
        await getCtx().resume();
        const c = ensureChain(a, "sfx");
        rampGain(c.fadeGain, 0, 0);
        await a.play();
        rampGain(c.fadeGain, 1, FADE_IN_MS);
        updateDucking();
      } catch {}
    }
  }
  lastSfxIds = desired;
  publishState();
}

// ---- OBR scene metadata sync ----------------------------------------
async function readSceneMusic(): Promise<MusicState> {
  try {
    const meta = await OBR.scene.getMetadata();
    const raw = meta[META_KEY];
    if (raw && typeof raw === "object") return normaliseState(raw as Partial<MusicState>);
  } catch {}
  return structuredClone(DEFAULT_STATE);
}
function normaliseState(raw: Partial<MusicState>): MusicState {
  const out: MusicState = structuredClone(DEFAULT_STATE);
  if (raw.bgm && typeof raw.bgm === "object") {
    const b = raw.bgm as Partial<BgmEntry>;
    if (typeof b.url === "string" && b.url) {
      out.bgm = {
        url: b.url,
        name: typeof b.name === "string" ? b.name : "未命名",
        loop: !!b.loop,
        position: typeof b.position === "number" ? b.position : 0,
        startedAt: typeof b.startedAt === "number" ? b.startedAt : Date.now(),
        paused: !!b.paused,
      };
    }
  }
  if (Array.isArray(raw.sfx)) {
    out.sfx = raw.sfx
      .filter((s: any) => s && typeof s.url === "string" && typeof s.id === "string")
      .slice(0, 4)
      .map((s: any) => ({
        id: s.id, url: s.url,
        name: typeof s.name === "string" ? s.name : "SFX",
        loop: !!s.loop,
      }));
  }
  if (raw.bus && typeof raw.bus === "object") {
    const b = raw.bus as any;
    if (typeof b.bgm === "number") out.bus.bgm = b.bgm;
    if (typeof b.sfx === "number") out.bus.sfx = b.sfx;
  }
  if (typeof raw.ts === "number") out.ts = raw.ts;
  return out;
}
async function writeSceneMusic(next: MusicState): Promise<void> {
  next.ts = Date.now();
  try {
    await OBR.scene.setMetadata({ [META_KEY]: next as any });
  } catch (e) {
    console.warn("[music-engine] setMetadata failed", e);
  }
}

// ---- PeerJS bridge (in background context, persists across popover) -
type PairStatus = "idle" | "loading" | "connecting" | "live" | "error";
const pair = {
  status: "idle" as PairStatus,
  code: "",                  // last attempted code
  errorMsg: "",
  peer: null as any,
  conn: null as any,
};
try {
  const c = localStorage.getItem(LS_PAIR_CODE);
  if (c) pair.code = c;
} catch {}

const PEER_PREFIX = "obr-music-";

async function loadPeerJs() {
  const url = "https://esm.sh/peerjs@1.5.4";
  const dynImport = new Function("u", "return import(u)") as (u: string) => Promise<any>;
  const m: any = await dynImport(url);
  return m.default ?? m.Peer;
}

function setPairStatus(s: PairStatus, errorMsg = "") {
  pair.status = s;
  pair.errorMsg = errorMsg;
  publishState();
}

async function connectPeer(code: string) {
  const upper = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (upper.length < 4) return;
  pair.code = upper;
  try { localStorage.setItem(LS_PAIR_CODE, upper); } catch {}

  // Tear down any prior session before reconnecting.
  if (pair.peer) try { pair.peer.destroy(); } catch {}
  pair.peer = null; pair.conn = null;

  setPairStatus("loading");
  let Peer: any;
  try { Peer = await loadPeerJs(); }
  catch (e: any) { setPairStatus("error", "加载 PeerJS 失败"); return; }

  setPairStatus("connecting");
  pair.peer = new Peer();
  pair.peer.on("open", () => {
    const conn = pair.peer.connect(PEER_PREFIX + upper, { reliable: true });
    pair.conn = conn;
    conn.on("open", () => { setPairStatus("live"); });
    conn.on("data", (data: any) => void handlePeerMessage(data));
    conn.on("close", () => {
      pair.conn = null;
      setPairStatus("idle");
    });
    conn.on("error", (e: any) => setPairStatus("error", e?.type || e?.message || "通道错误"));
  });
  pair.peer.on("error", (e: any) => {
    setPairStatus("error", e?.type || e?.message || "PeerJS 错误");
  });
}

function disconnectPeer() {
  if (pair.conn) try { pair.conn.close(); } catch {}
  if (pair.peer) try { pair.peer.destroy(); } catch {}
  pair.peer = null; pair.conn = null;
  setPairStatus("idle");
}

async function handlePeerMessage(msg: any) {
  if (!msg || typeof msg !== "object") return;
  const next = structuredClone(currentState);
  switch (msg.type) {
    case "bgm-load":
      next.bgm = {
        url: String(msg.url ?? ""),
        name: String(msg.name ?? "未命名"),
        loop: !!msg.loop,
        position: typeof msg.position === "number" ? msg.position : 0,
        startedAt: Date.now(),
        paused: false,
      };
      break;
    case "bgm-play":
      if (next.bgm) {
        next.bgm.startedAt = Date.now();
        next.bgm.position = typeof msg.position === "number" ? msg.position : next.bgm.position;
        next.bgm.paused = false;
      }
      break;
    case "bgm-pause":
      if (next.bgm) {
        next.bgm.position = typeof msg.position === "number" ? msg.position : livePosition(next.bgm);
        next.bgm.paused = true;
      }
      break;
    case "bgm-seek":
      if (next.bgm) {
        next.bgm.position = Math.max(0, msg.position ?? 0);
        next.bgm.startedAt = Date.now();
      }
      break;
    case "bgm-stop":
      next.bgm = null; break;
    case "sfx-add":
      if (msg.id && msg.url) {
        next.sfx = next.sfx.filter((s) => s.id !== msg.id);
        next.sfx.push({ id: String(msg.id), url: String(msg.url),
          name: String(msg.name ?? "SFX"), loop: !!msg.loop });
        if (next.sfx.length > 4) next.sfx = next.sfx.slice(-4);
      }
      break;
    case "sfx-stop":
      if (msg.id) next.sfx = next.sfx.filter((s) => s.id !== msg.id);
      break;
    case "sfx-stop-all":
      next.sfx = []; break;
    case "volume":
      if (msg.bus === "bgm" && typeof msg.vol === "number") next.bus.bgm = msg.vol;
      if (msg.bus === "sfx" && typeof msg.vol === "number") next.bus.sfx = msg.vol;
      break;
    default:
      console.info("[music-engine] unknown msg", msg);
      return;
  }
  await writeSceneMusic(next);
  // The scene-metadata change handler below will pick it up and call
  // applyState, which also publishes state to the popover.
}

// ---- Snapshot publish ----------------------------------------------
// The popover renders from these snapshots. Includes everything the
// UI needs: BGM info, local volumes, pair state. Audio currentTime
// gets sampled on each publish so the progress display tracks live.
function publishState() {
  const bgm = currentState.bgm;
  const snap = {
    bgm: bgm ? {
      url: bgm.url,
      name: bgm.name,
      loop: bgm.loop,
      paused: bgm.paused || bgmAudio.paused,
      currentTime: bgmAudio.currentTime || 0,
      duration: Number.isFinite(bgmAudio.duration) ? bgmAudio.duration : 0,
    } : null,
    sfxCount: currentState.sfx.length,
    bus: { bgm: currentState.bus.bgm, sfx: currentState.bus.sfx },
    localVol: { bgm: localVol.bgm, sfx: localVol.sfx, mute: localVol.mute },
    pair: {
      status: pair.status,
      code: pair.code,
      errorMsg: pair.errorMsg,
    },
  };
  try {
    OBR.broadcast.sendMessage(BC_STATE, snap, { destination: "LOCAL" });
  } catch {}
}

// Periodically re-publish so the progress bar in the popover stays
// live without the popover needing its own ticker into our state.
let pubTimer: number | null = null;
function startPublishTimer() {
  if (pubTimer != null) return;
  pubTimer = window.setInterval(() => publishState(), 500);
}

// ---- Loop-boundary fade ----------------------------------------------
//
// When a BGM track has loop=true, HTMLAudioElement's native looping
// snaps the playhead back to 0 instantly — no audible gap, but also
// no fade between the tail and the head. For a smooth "fade out at
// end + fade in at start" effect we monitor currentTime on every
// rAF and:
//   • when remaining < FADE_OUT_MS → ramp fadeGain toward 0
//   • when playhead wraps to ~0 and fadeGain was near 0 → ramp back
//     up to 1 over FADE_IN_MS
//
// Only kicks in when bgmAudio.loop is true. The standard fade-in on
// .load() and fade-out on .stop() handle the non-loop case.

let loopFadeRAF = 0;
function loopFadeTick() {
  loopFadeRAF = requestAnimationFrame(loopFadeTick);
  if (!bgmAudio.loop || bgmAudio.paused) return;
  const d = bgmAudio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  const chain = chainMap.get(bgmAudio);
  if (!chain) return;

  const t = bgmAudio.currentTime;
  const fadeOutSec = FADE_OUT_MS / 1000;
  const fadeInGuardSec = 0.4;        // "just looped" detection window

  if (t > d - fadeOutSec) {
    // Tail — ensure we're ramping toward 0 (only schedule once per cycle).
    if (chain.fadeGain.gain.value > 0.5) {
      rampGain(chain.fadeGain, 0, Math.max(80, (d - t) * 1000));
    }
  } else if (t < fadeInGuardSec) {
    // Head — if we previously ramped out, the gain is still near 0
    // because the loop wrap happened. Ramp it back up.
    if (chain.fadeGain.gain.value < 0.5) {
      rampGain(chain.fadeGain, 1, FADE_IN_MS);
    }
  }
}

// ---- Command receiver ------------------------------------------------
function handlePopoverCmd(data: any) {
  if (!data || typeof data !== "object") return;
  switch (data.type) {
    case "state-request":
      publishState();
      break;
    case "pair-connect":
      void connectPeer(String(data.code || ""));
      break;
    case "pair-disconnect":
      disconnectPeer();
      break;
    case "local-vol":
      if (typeof data.bgm  === "number")  localVol.bgm  = data.bgm;
      if (typeof data.sfx  === "number")  localVol.sfx  = data.sfx;
      if (typeof data.mute === "boolean") localVol.mute = data.mute;
      saveLocalVol();
      applyBgmVolume(); applySfxVolume();
      publishState();
      break;
  }
}

// ---- Setup / Teardown ----------------------------------------------
let engineUnsubs: Array<() => void> = [];
let engineStarted = false;

export async function setupMusicEngine(): Promise<void> {
  if (engineStarted) return;
  engineStarted = true;

  // Initial state pull + ongoing subscription.
  try { await OBR.scene.isReady(); } catch {}
  const initial = await readSceneMusic();
  await applyState(initial);

  const unMeta = OBR.scene.onMetadataChange((meta) => {
    const raw = meta[META_KEY];
    if (!raw) { void applyState(structuredClone(DEFAULT_STATE)); return; }
    const next = normaliseState(raw as Partial<MusicState>);
    if (next.ts >= currentState.ts) void applyState(next);
  });
  if (typeof unMeta === "function") engineUnsubs.push(unMeta);

  // Listen for popover commands.
  try {
    const unBc = OBR.broadcast.onMessage(BC_CMD, (event: any) => {
      handlePopoverCmd(event?.data);
    });
    if (typeof unBc === "function") engineUnsubs.push(unBc);
  } catch (e) {
    console.warn("[music-engine] broadcast subscribe failed", e);
  }

  startPublishTimer();
  if (!loopFadeRAF) loopFadeRAF = requestAnimationFrame(loopFadeTick);
  publishState();
}

export function teardownMusicEngine(): void {
  for (const fn of engineUnsubs.splice(0)) { try { fn(); } catch {} }
  if (pubTimer != null) { window.clearInterval(pubTimer); pubTimer = null; }
  if (loopFadeRAF) { cancelAnimationFrame(loopFadeRAF); loopFadeRAF = 0; }
  // Stop any audio + tear down peer.
  try { bgmAudio.pause(); } catch {}
  for (const a of sfxAudios.values()) { try { a.pause(); } catch {} }
  sfxAudios.clear();
  if (pair.peer) try { pair.peer.destroy(); } catch {}
  pair.peer = null; pair.conn = null;
  engineStarted = false;
}
