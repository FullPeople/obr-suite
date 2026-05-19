/* Music Board plugin popover.
 *
 * Owns audio + PeerJS DIRECTLY (engine-in-background was abandoned
 * because the background iframe can't resume its AudioContext without
 * a user gesture in that document — and the background has no UI).
 *
 * Closing the popover therefore stops music. To preserve music while
 * dismissing the panel, use the in-popover "minimize" button: it
 * collapses the visible UI to a thin status strip but keeps the
 * iframe alive (audio + PeerJS keep running).
 *
 * Scene metadata sync: whenever the GM-paired client mutates state
 * (track change, pause, etc) we write to OBR.scene.metadata. Every
 * other player's popover (if open) reads + plays. So multi-player
 * sync only requires each player to OPEN their music board popover
 * once. Players who never open it won't hear anything.
 */
import OBR from "@owlbear-rodeo/sdk";

const META_KEY = "com.obr-suite/music-board:state";
const LS_VOL   = "obr-music-board:local-volumes";
const LS_PAIR  = "obr-music-board:last-pair-code";

interface MusicState {
  bgm: BgmEntry | null;
  sfx: SfxEntry[];
  bus: { bgm: number; sfx: number };
  ts: number;
}
interface BgmEntry {
  url: string; name: string; loop: boolean;
  position: number; startedAt: number; paused: boolean;
}
interface SfxEntry { id: string; url: string; name: string; loop: boolean; }

const DEFAULT_STATE: MusicState = {
  bgm: null, sfx: [], bus: { bgm: 0.8, sfx: 1.0 }, ts: 0,
};

// ---- DOM ------------------------------------------------------------
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;

const appEl       = $(".app");
const npCard      = $("#npCard");
const npStatus    = $("#npStatus");
const npTitle     = $("#npTitle");
const npTime      = $("#npTime");
const bgmVol      = $("#bgmVol") as HTMLInputElement;
const bgmVolReadout = $("#bgmVolReadout");
const sfxVol      = $("#sfxVol") as HTMLInputElement;
const sfxVolReadout = $("#sfxVolReadout");
const muteChk     = $("#muteChk") as HTMLInputElement;
const pairStatusEl = $("#pairStatus");
const pairCodeEl  = $("#pairCode") as HTMLInputElement;
const pairBtn     = $("#pairBtn") as HTMLButtonElement;
const unpairBtn   = $("#unpairBtn") as HTMLButtonElement;
const pairHint    = $("#pairHint");
const minimizeBtn = $("#minimizeBtn") as HTMLButtonElement | null;
const miniBar     = $("#miniBar");
const miniTitle   = $("#miniTitle");
const miniExpand  = $("#miniExpand") as HTMLButtonElement | null;
const toastStack  = $("#toastStack");

// ---- Local volume ---------------------------------------------------
const localVol = { bgm: 0.8, sfx: 1.0, mute: false };
try {
  const v = JSON.parse(localStorage.getItem(LS_VOL) || "{}");
  if (typeof v.bgm === "number")  localVol.bgm = v.bgm;
  if (typeof v.sfx === "number")  localVol.sfx = v.sfx;
  if (typeof v.mute === "boolean") localVol.mute = v.mute;
} catch {}
function saveLocalVol() { try { localStorage.setItem(LS_VOL, JSON.stringify(localVol)); } catch {} }

bgmVol.value = String(Math.round(localVol.bgm * 100));
sfxVol.value = String(Math.round(localVol.sfx * 100));
muteChk.checked = localVol.mute;
bgmVolReadout.textContent = bgmVol.value;
sfxVolReadout.textContent = sfxVol.value;

// ---- WebAudio engine ------------------------------------------------
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
interface AudioChain { fadeGain: GainNode; busGain: GainNode; duckGain?: GainNode; }
const chainMap = new WeakMap<HTMLAudioElement, AudioChain>();
function ensureChain(audio: HTMLAudioElement, bus: "bgm" | "sfx"): AudioChain {
  let chain = chainMap.get(audio);
  if (chain) return chain;
  const ctx = getCtx();
  const src = ctx.createMediaElementSource(audio);
  const fadeGain = ctx.createGain(); fadeGain.gain.value = 0;
  const busGain  = ctx.createGain(); busGain.gain.value = busVolumeFor(bus);
  audio.volume = 1;
  if (bus === "bgm") {
    const duckGain = ctx.createGain(); duckGain.gain.value = 1;
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

const FADE_IN_MS = 350;
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
  return Math.max(0, bgm.position + (Date.now() - bgm.startedAt) / 1000);
}

// ---- State application ----------------------------------------------
let lastBgmKey = "";
let lastSfxIds = new Set<string>();

async function applyState(next: MusicState) {
  currentState = next;
  renderUI();
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
          const c = ensureChain(bgmAudio, "bgm");
          rampGain(c.fadeGain, 0, 0);
          await bgmAudio.play();
          rampGain(c.fadeGain, 1, FADE_IN_MS);
          updateDucking();
        } catch {
          toast("浏览器拦截了自动播放，请点击页面任意位置允许", "warn");
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
      if (Math.abs(bgmAudio.currentTime - target) > 1.5) bgmAudio.currentTime = target;
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
          setTimeout(() => { try { a.pause(); } catch {} sfxAudios.delete(id); updateDucking(); }, FADE_OUT_MS + 20);
        } else { try { a.pause(); } catch {} sfxAudios.delete(id); }
      }
    }
  }
  for (const s of next.sfx) {
    if (!sfxAudios.has(s.id)) {
      const a = new Audio(s.url);
      a.preload = "auto"; a.crossOrigin = "anonymous"; a.loop = !!s.loop;
      a.addEventListener("ended", () => {
        if (!a.loop) { sfxAudios.delete(s.id); updateDucking(); }
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
}

// ---- Loop-boundary fade (rAF tick) ----------------------------------
function tickLoopFade() {
  requestAnimationFrame(tickLoopFade);
  if (!bgmAudio.loop || bgmAudio.paused) return;
  const d = bgmAudio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  const chain = chainMap.get(bgmAudio);
  if (!chain) return;
  const t = bgmAudio.currentTime;
  const fadeOutSec = FADE_OUT_MS / 1000;
  if (t > d - fadeOutSec) {
    if (chain.fadeGain.gain.value > 0.5) {
      rampGain(chain.fadeGain, 0, Math.max(80, (d - t) * 1000));
    }
  } else if (t < 0.4) {
    if (chain.fadeGain.gain.value < 0.5) {
      rampGain(chain.fadeGain, 1, FADE_IN_MS);
    }
  }
}
requestAnimationFrame(tickLoopFade);

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
  try { await OBR.scene.setMetadata({ [META_KEY]: next as any }); }
  catch (e) { console.warn("[music-board] setMetadata failed", e); }
}

// ---- PeerJS bridge (popover-side) ----------------------------------
const PEER_PREFIX = "obr-music-";
let peer: any = null;
let peerConn: any = null;
let lastPairCode = "";
try { lastPairCode = localStorage.getItem(LS_PAIR) || ""; } catch {}

async function loadPeerJs() {
  const url = "https://esm.sh/peerjs@1.5.4";
  const dynImport = new Function("u", "return import(u)") as (u: string) => Promise<any>;
  const m: any = await dynImport(url);
  return m.default ?? m.Peer;
}
function setPairStatus(text: string, kind: "" | "live" | "connecting" | "error" = "") {
  pairStatusEl.textContent = text;
  pairStatusEl.className = "pair-status" + (kind ? " " + kind : "");
}
async function connectPeer(code: string) {
  try {
    setPairStatus("加载 PeerJS…", "connecting");
    const Peer = await loadPeerJs();
    if (peer) try { peer.destroy(); } catch {}
    setPairStatus("连接信令…", "connecting");
    peer = new Peer();
    peer.on("open", () => {
      setPairStatus("拨号 " + code + "…", "connecting");
      const conn = peer.connect(PEER_PREFIX + code.toUpperCase(), { reliable: true });
      peerConn = conn;
      conn.on("open", () => {
        setPairStatus("已连接 " + code, "live");
        toast(`已连接到网页音乐板 ${code}`, "ok");
        pairBtn.style.display = "none";
        unpairBtn.style.display = "";
      });
      conn.on("data", (data: any) => handlePeerMessage(data));
      conn.on("close", () => {
        setPairStatus("已断开", "error");
        pairBtn.style.display = "";
        unpairBtn.style.display = "none";
      });
      conn.on("error", (e: any) => {
        setPairStatus("连接错误", "error");
        toast("连接失败：" + (e?.message || e), "error");
      });
    });
    peer.on("error", (e: any) => {
      setPairStatus("信令错误", "error");
      toast("PeerJS：" + (e?.type || e?.message || e), "error");
      pairBtn.style.display = "";
      unpairBtn.style.display = "none";
    });
  } catch (e: any) {
    setPairStatus("加载失败", "error");
    toast("加载 PeerJS 失败：" + (e?.message || e), "error");
  }
}
function disconnectPeer() {
  if (peerConn) try { peerConn.close(); } catch {}
  if (peer) try { peer.destroy(); } catch {}
  peer = null; peerConn = null;
  setPairStatus("未连接", "");
  pairBtn.style.display = "";
  unpairBtn.style.display = "none";
}
function handlePeerMessage(msg: any) {
  if (!msg || typeof msg !== "object") return;
  const next = structuredClone(currentState);
  switch (msg.type) {
    case "bgm-load":
      next.bgm = {
        url: String(msg.url ?? ""), name: String(msg.name ?? "未命名"),
        loop: !!msg.loop,
        position: typeof msg.position === "number" ? msg.position : 0,
        startedAt: Date.now(), paused: false,
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
    default: return;
  }
  void writeSceneMusic(next);
}

// ---- UI ---------------------------------------------------------
function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  return `${pad2(m)}:${pad2(sec)}`;
}
function pad2(n: number) { return n < 10 ? "0" + n : "" + n; }

function renderUI() {
  const bgm = currentState.bgm;
  if (bgm) {
    const playing = !bgm.paused;
    npCard.classList.toggle("playing", playing);
    npStatus.textContent = playing ? "正在播放" : "已暂停";
    npTitle.textContent = bgm.name || "未命名 BGM";
    // Mini-bar mirror
    if (miniTitle) miniTitle.textContent = `${playing ? "♪ " : "‖ "}${bgm.name || ""}`;
  } else {
    npCard.classList.remove("playing");
    npStatus.textContent = "空闲";
    npTitle.textContent = "没有 BGM 在播放";
    npTime.textContent = "--:-- / --:--";
    if (miniTitle) miniTitle.textContent = "空闲";
  }
}

setInterval(() => {
  if (!currentState.bgm || currentState.bgm.paused) return;
  if (!bgmAudio.duration || isNaN(bgmAudio.duration)) {
    npTime.textContent = `${fmtTime(bgmAudio.currentTime || 0)} / --:--`;
  } else {
    npTime.textContent = `${fmtTime(bgmAudio.currentTime)} / ${fmtTime(bgmAudio.duration)}`;
  }
}, 500);

// ---- Minimize toggle (popover stays open) ---------------------------
//
// Closing the OBR popover destroys the iframe and stops music. Minimize
// instead collapses the visible content to a thin status pill at the
// top of the popover area; the iframe stays alive so audio + PeerJS
// keep running. The hidden areas are transparent (hidePaper:true), but
// the popover footprint still blocks clicks in its registered area —
// move the OBR people-panel etc out of the way if you need that space.
let minimized = false;
function setMinimized(state: boolean) {
  minimized = state;
  if (state) {
    appEl.classList.add("minimized");
  } else {
    appEl.classList.remove("minimized");
  }
}
minimizeBtn?.addEventListener("click", () => setMinimized(true));
miniExpand?.addEventListener("click", () => setMinimized(false));
miniBar?.addEventListener("click", (e) => {
  if (e.target === miniExpand) return;
  setMinimized(false);
});

// ---- User-controls wiring ------------------------------------------
bgmVol.addEventListener("input", () => {
  localVol.bgm = Number(bgmVol.value) / 100;
  if (bgmVolReadout) bgmVolReadout.textContent = bgmVol.value;
  saveLocalVol(); applyBgmVolume();
});
sfxVol.addEventListener("input", () => {
  localVol.sfx = Number(sfxVol.value) / 100;
  if (sfxVolReadout) sfxVolReadout.textContent = sfxVol.value;
  saveLocalVol(); applySfxVolume();
});
muteChk.addEventListener("change", () => {
  localVol.mute = muteChk.checked;
  saveLocalVol(); applyBgmVolume(); applySfxVolume();
});

pairCodeEl.value = lastPairCode;
pairCodeEl.addEventListener("input", () => {
  const cleaned = pairCodeEl.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (cleaned !== pairCodeEl.value) pairCodeEl.value = cleaned;
});
pairCodeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") pairBtn.click(); });
pairBtn.addEventListener("click", () => {
  const code = pairCodeEl.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 4) { toast("配对码至少 4 位", "warn"); return; }
  lastPairCode = code;
  try { localStorage.setItem(LS_PAIR, code); } catch {}
  void connectPeer(code);
});
unpairBtn.addEventListener("click", () => disconnectPeer());

// ---- toast ---------------------------------------------------------
function toast(text: string, kind: "ok" | "warn" | "error" | "" = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity = "0"; el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 260);
  }, 2400);
}

// ---- Boot ----------------------------------------------------------
OBR.onReady(async () => {
  // Initial scene-state pull + live subscription.
  try { await OBR.scene.isReady(); } catch {}
  const s = await readSceneMusic();
  await applyState(s);
  OBR.scene.onMetadataChange((meta) => {
    const raw = meta[META_KEY];
    if (!raw) { void applyState(structuredClone(DEFAULT_STATE)); return; }
    const next = normaliseState(raw as Partial<MusicState>);
    if (next.ts >= currentState.ts) void applyState(next);
  });
});
