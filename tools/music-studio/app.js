/* Music Board controller — v5.
 *
 * Changes from v4 (this round):
 *   1. 常用 promoted to its own section ABOVE the library. Dragging
 *      into 常用 ONLY adds to favorites (no autoplay). Dragging a
 *      favorite chip onto a turntable plays. Dragging a favorite chip
 *      INTO the library area removes it from 常用.
 *   2. Old 常用 corner-overlay slot is now the 待播放 queue. Drag
 *      cards in to queue them; when BGM ends the next track in the
 *      queue auto-plays. If BGM is empty when the drop happens, the
 *      track plays immediately instead of going through the queue.
 *      Queue items themselves are draggable for reorder.
 *   3. New BGM toggles: 单曲循环 (per-track loop persisted to IDB)
 *      and 淡入淡出 (session toggle of WebAudio fade ramps).
 *   4. BGM + SFX volume sliders moved to vertical gradient bars on
 *      the right edge of each deck card. SFX pad layout shifted to
 *      [vinyl LEFT 90px] [meta + controls BELOW name].
 *   5. New favorites/queue/toggle UI uses plain text + SVG, no
 *      emoji decoration.
 *
 * Data flows:
 *   library card drag  →  data: "application/x-obr-music-card"
 *   favorite chip drag →  data: "application/x-obr-music-fav"
 *   queue item drag    →  data: "application/x-obr-music-queue-idx"
 *
 * Drop target semantics:
 *   turntable  ← card | fav    → load + play
 *   queue      ← card | fav    → push to queue (or immediate play if empty)
 *              ← queue-idx     → reorder within queue
 *   favorites  ← card | fav    → add (no autoplay); fav same id = no-op
 *   library    ← fav           → remove from favorites
 */

import { encodeOpus, estimateOpusBytes } from "./encoder.js";
import { addTrack, updateTrack, deleteTrack, listTracks } from "./library.js";
import { t as T, applyI18n, mountLangToggle } from "./i18n.js?v=20260909-room-sync";
import { StudioRoomSync } from "./room-sync.js?v=20260910-storage";

applyI18n();
mountLangToggle();

const $  = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const DT_CARD  = "application/x-obr-music-card";
const DT_FAV   = "application/x-obr-music-fav";

// ============ Refs ============
const bgmDeck     = $(".bgm-deck");
const sfxPads     = $$(".sfx-pad");

const histPrevName = $("#histPrevName");
const histNextName = $("#histNextName");
const loopToggle  = $("#loopToggle");
const fadeToggle  = $("#fadeToggle");

const libCount    = $("#libCount");
const libSearch   = $("#libSearch");
const libGrid     = $("#libGrid");
const libDropZone = $("#libDropZone");
const chipFilterRow = $("#chipFilterRow");
const addFileBtn  = $("#addFileBtn");
const addUrlBtn   = $("#addUrlBtn");
const hiddenFileInput = $("#hiddenFileInput");
const loadDefaultsBtn = $("#loadDefaultsBtn");
const detailsToggle   = $("#detailsToggle");

const favoritesSection = $("#favoritesSection");
const favGrid       = $("#favGrid");
const favCount      = $("#favCount");
const favClearBtn   = $("#favClearBtn");

// Vertical volume controls
const bgmVvBar     = $("#bgmVvBar");
const bgmVvFill    = $("#bgmVvFill");
const bgmVvReadout = $("#bgmVvReadout");
const sfxVvBar     = $("#sfxVvBar");
const sfxVvFill    = $("#sfxVvFill");
const sfxVvReadout = $("#sfxVvReadout");

const pairBtn       = $("#pairBtn");
const pairCodeChip  = $("#pairCodeChip");
const pairCodeValue = $("#pairCodeValue");
const pairCancelBtn = $("#pairCancelBtn");
const pairLiveChip  = $("#pairLiveChip");
const pairUnpairBtn = $("#pairUnpairBtn");

const localMuteBanner = $("#localMuteBanner");
const lmbIcon   = $("#lmbIcon");
const lmbText   = $("#lmbText");
const lmbToggle = $("#lmbToggle");

const editorModal = $("#editorModal");
const trackName   = $("#trackName");
const trackMeta   = $("#trackMeta");
const waveformCanvas = $("#waveform");
const trimMaskL   = $("#trimMaskL");
const trimMaskR   = $("#trimMaskR");
const trimHandleL = $("#trimHandleL");
const trimHandleR = $("#trimHandleR");
const playCursor  = $("#playCursor");
const trimStartTxt = $("#trimStartTxt");
const trimEndTxt  = $("#trimEndTxt");
const trimLenTxt  = $("#trimLenTxt");
const resetTrimBtn = $("#resetTrimBtn");
const bitrateSeg  = $("#bitrateSeg");
const channelSeg  = $("#channelSeg");
const busSeg      = $("#busSeg");
const loopChk     = $("#loopChk");
const sizeEstimate = $("#sizeEstimate");
const originalSize = $("#originalSize");
const previewBtn  = $("#previewBtn");
const encodeBtn   = $("#encodeBtn");
const encodeProg  = $("#encodeProg");
const encodeFill  = $("#encodeFill");
const encodeMsg   = $("#encodeMsg");

const urlModal   = $("#urlModal");
const urlInput   = $("#urlInput");
const urlName    = $("#urlName");
const urlBusSeg  = $("#urlBusSeg");
const urlLoopChk = $("#urlLoopChk");
const urlAddBtn  = $("#urlAddBtn");

const tagModal   = $("#tagModal");
const tagInput   = $("#tagInput");
const tagSuggestions = $("#tagSuggestions");
const tagSaveBtn = $("#tagSaveBtn");

const toastStack = $("#toastStack");

// ============ State ============
const state = {
  editor: { file: null, audioBuffer: null, trim: { start: 0, end: 0 }, bitrate: 64, channels: 1, bus: "bgm", preview: null },
  urlBus: "bgm",
  lib: [],
  filter: { kind: "all" },
  libSearchStr: "",
  volumes: { bgm: 0.8, sfx: 1.0 },
  turntableTrack: { "bgm": null, "sfx-0": null, "sfx-1": null, "sfx-2": null, "sfx-3": null },
  bgmHistory: [], bgmHistoryIdx: -1,
  favorites: [],         // [trackId] — persistent
  tagEditId: null,
  fadeEnabled: true,     // session toggle
  showDetails: false,    // 详细信息 toggle — off hides the duration/bitrate/size row + shrinks cards
  tagColors: {},         // { tagName: "#hex" } — per-tag custom colour
};

const LS_VOL   = "obr-music-board:volumes";
const LS_FAVS  = "obr-music-board:favorites";
const LS_FADE  = "obr-music-board:fade-enabled";
const LS_DETAILS = "obr-music-board:show-details";
const LS_TAGCOLORS = "obr-music-board:tag-colors";
try {
  const v = JSON.parse(localStorage.getItem(LS_VOL) || "{}");
  if (typeof v.bgm === "number") state.volumes.bgm = v.bgm;
  if (typeof v.sfx === "number") state.volumes.sfx = v.sfx;
} catch {}
try {
  const f = JSON.parse(localStorage.getItem(LS_FAVS) || "[]");
  if (Array.isArray(f)) state.favorites = f.filter((x) => typeof x === "string");
} catch {}
try {
  const fd = localStorage.getItem(LS_FADE);
  if (fd === "0") state.fadeEnabled = false;
} catch {}
try {
  state.showDetails = localStorage.getItem(LS_DETAILS) === "1";
} catch {}
try {
  const tc = JSON.parse(localStorage.getItem(LS_TAGCOLORS) || "{}");
  if (tc && typeof tc === "object") state.tagColors = tc;
} catch {}
function saveVolumes() { try { localStorage.setItem(LS_VOL, JSON.stringify(state.volumes)); } catch {} }
function saveFavs()    { try { localStorage.setItem(LS_FAVS, JSON.stringify(state.favorites)); } catch {} }
function saveFade()    { try { localStorage.setItem(LS_FADE, state.fadeEnabled ? "1" : "0"); } catch {} }
function saveDetails() { try { localStorage.setItem(LS_DETAILS, state.showDetails ? "1" : "0"); } catch {} }
function saveTagColors() { try { localStorage.setItem(LS_TAGCOLORS, JSON.stringify(state.tagColors)); } catch {} }

// ============ Tag colours ============
// A tag's pill colour comes from (1) a user override, else (2) a
// semantic guess from its name, else (3) a stable hash hue. Text colour
// is auto-picked for contrast so labels stay readable on ANY background.
const TAG_PRESETS = [
  { re: /战斗|战争|boss|首领|攻击|厮杀|决斗|追逐/i, color: "#e0564f" }, // 红
  { re: /酒馆|城镇|村庄|村|集市|商店|旅店|家园|营地|市集/i, color: "#a9743f" }, // 棕
  { re: /探索|旅行|野外|森林|地图|冒险|秘境|路途/i, color: "#3fae72" }, // 绿
  { re: /紧张|危机|悬疑|潜行|谜题|警戒/i, color: "#d99a2b" }, // 琥珀
  { re: /恐怖|惊悚|黑暗|死亡|诅咒|血腥|阴森/i, color: "#8a3a55" }, // 暗酒红
  { re: /悲伤|离别|忧伤|哀|安魂|思念/i, color: "#5a7fb0" }, // 蓝
  { re: /欢快|轻松|日常|温馨|愉快|喜悦|休闲/i, color: "#e0b53f" }, // 黄
  { re: /神圣|教堂|仪式|庄严|圣堂|祈祷/i, color: "#c9a14a" }, // 金
  { re: /魔法|奥术|神秘|法术|秘法|咒/i, color: "#8a6fd6" }, // 紫
  { re: /海|水|港|船|海洋|河/i, color: "#3a9bb5" }, // 青
  { re: /雪|冰|寒|霜|北境|严冬/i, color: "#6fb6d6" }, // 冰蓝
  { re: /火|熔岩|地狱|炎|焰/i, color: "#e0703f" }, // 橙
  { re: /宫廷|贵族|王城|皇|典礼|王/i, color: "#b06fa0" }, // royal
  { re: /胜利|凯旋|结局|尾声|终幕/i, color: "#d6a93f" }, // 凯旋金
  { re: /BGM/i, color: "#4ad6c7" },
  { re: /SFX|音效/i, color: "#c184ff" },
];
function _hashHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
function guessTagColor(name) {
  for (const p of TAG_PRESETS) if (p.re.test(name)) return p.color;
  return _hslStr(_hashHue(name), 46, 46);
}
function tagColorFor(name) { return state.tagColors[name] || guessTagColor(name); }
function _hslStr(h, s, l) { return `hsl(${h} ${s}% ${l}%)`; }
function _rgbOf(c) {
  c = (c || "").trim();
  if (c[0] === "#") {
    let h = c.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m = c.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/i);
  if (m) {
    const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100, a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return { r: f(0), g: f(8), b: f(4) };
  }
  return { r: 128, g: 128, b: 128 };
}
// Black or white text, whichever reads better on the given bg.
function tagTextColor(bg) {
  const { r, g, b } = _rgbOf(bg);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.58 ? "#16110a" : "#ffffff";
}
// A version of the colour bright enough to read as TEXT on the dark UI
// (used for inactive filter chips, which keep a transparent bg).
function tagColorOnDark(bg) {
  const { r, g, b } = _rgbOf(bg);
  let max = Math.max(r, g, b);
  if (max >= 165) return bg;
  const k = 165 / Math.max(max, 1);
  return `rgb(${Math.min(255, Math.round(r * k))} ${Math.min(255, Math.round(g * k))} ${Math.min(255, Math.round(b * k))})`;
}
function _rgba(c, a) { const { r, g, b } = _rgbOf(c); return `rgba(${r},${g},${b},${a})`; }
function _toHex(c) { const { r, g, b } = _rgbOf(c); return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function setTagColor(name, color) { state.tagColors[name] = color; saveTagColors(); renderLibrary(); }

// Right-click a tag (card pill OR filter chip) → floating colour picker.
function openTagColorPicker(name, anchorEl) {
  document.querySelectorAll(".tag-color-pop").forEach((p) => p.remove());
  const cur = tagColorFor(name);
  const pop = document.createElement("div");
  pop.className = "tag-color-pop";
  const title = document.createElement("div");
  title.className = "tcp-title";
  title.textContent = T("muColorTitle", { name });
  const sw = document.createElement("div");
  sw.className = "tcp-swatches";
  const swatches = ["#e0564f", "#e0703f", "#d99a2b", "#e0b53f", "#3fae72",
                    "#3a9bb5", "#5a7fb0", "#8a6fd6", "#b06fa0", "#a9743f",
                    "#8a3a55", "#9aa0ad"];
  for (const c of swatches) {
    const b = document.createElement("button");
    b.className = "tcp-sw";
    b.style.background = c;
    b.title = c;
    if (_toHex(c) === _toHex(cur)) b.classList.add("on");
    b.addEventListener("click", () => { setTagColor(name, c); pop.remove(); });
    sw.appendChild(b);
  }
  const row = document.createElement("div");
  row.className = "tcp-row";
  const custom = document.createElement("input");
  custom.type = "color"; custom.className = "tcp-custom"; custom.value = _toHex(cur);
  custom.addEventListener("input", () => setTagColor(name, custom.value));
  const reset = document.createElement("button");
  reset.className = "tcp-reset"; reset.textContent = T("muRestoreDefault");
  reset.addEventListener("click", () => { delete state.tagColors[name]; saveTagColors(); renderLibrary(); pop.remove(); });
  row.appendChild(custom); row.appendChild(reset);
  pop.appendChild(title); pop.appendChild(sw); pop.appendChild(row);
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + "px";
  setTimeout(() => {
    const off = (e) => {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("pointerdown", off, true); }
    };
    document.addEventListener("pointerdown", off, true);
  }, 0);
}

// ============ WebAudio master ============
let audioCtx = null;
let MASTER_LIMITER = null;
// MASTER_GAIN sits between the limiter and the speakers. Setting it to
// 0 mutes the studio's LOCAL output WITHOUT touching the audio elements
// (they keep playing for progress/time tracking) and WITHOUT touching
// the peer channel (we transmit play/pause COMMANDS to OBR, not audio
// samples). That's the whole trick behind "本地静音但照常传输给枭熊".
let MASTER_GAIN = null;
function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    MASTER_LIMITER = audioCtx.createDynamicsCompressor();
    MASTER_LIMITER.threshold.value = -3;
    MASTER_LIMITER.ratio.value = 20;
    MASTER_LIMITER.attack.value = 0.001;
    MASTER_LIMITER.release.value = 0.05;
    MASTER_LIMITER.knee.value = 0;
    MASTER_GAIN = audioCtx.createGain();
    // Initialise to the current local-mute state — the graph is built
    // lazily on first play, which may be AFTER the user already paired
    // and we flipped localMute on.
    MASTER_GAIN.gain.value = localMute ? 0 : 1;
    MASTER_LIMITER.connect(MASTER_GAIN);
    MASTER_GAIN.connect(audioCtx.destination);
  }
  return audioCtx;
}

// ============ Local mute (studio-only output) ============
// Runtime-only flag (NOT persisted) — it's driven by the pairing
// lifecycle: auto-ON on pairing, preserved on network loss, auto-OFF on
// explicit unpair. The banner only controls this website's master gain.
let localMute = false;
function applyLocalMute() {
  if (MASTER_GAIN && audioCtx) {
    const t = audioCtx.currentTime;
    MASTER_GAIN.gain.cancelScheduledValues(t);
    MASTER_GAIN.gain.setValueAtTime(MASTER_GAIN.gain.value, t);
    MASTER_GAIN.gain.linearRampToValueAtTime(localMute ? 0 : 1, t + 0.1);
  }
  updateLocalMuteUi();
}
function setLocalMute(on) {
  localMute = !!on;
  applyLocalMute();
}

// ============ Utilities ============
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  return `${pad2(m)}:${pad2(sec)}`;
}
function fmtTimeMs(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${pad2(m)}:${pad2(sec)}.${pad2(cs)}`;
}
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function fmtBytes(b) {
  if (!Number.isFinite(b) || b <= 0) return "--";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(2) + " MB";
}
function parseTime(str) {
  if (typeof str !== "string") return null;
  const s = str.trim(); if (!s) return null;
  const colon = s.indexOf(":");
  if (colon < 0) { const f = parseFloat(s); return Number.isFinite(f) && f >= 0 ? f : null; }
  const m = parseInt(s.slice(0, colon), 10);
  const rest = parseFloat(s.slice(colon + 1));
  if (!Number.isFinite(m) || !Number.isFinite(rest)) return null;
  return m * 60 + rest;
}
function trunc(s, n = 14) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity = "0"; el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

// ============ Turntable (WebAudio backed) ============
const FADE_IN_MS  = 350;
const FADE_OUT_MS = 280;

class Turntable {
  constructor(el) {
    this.el = el;
    this.slot = el.dataset.slot;
    this.bus  = el.dataset.bus;
    this.isBig = el.classList.contains("bgm-deck");
    this.spinTarget = this.isBig ? $(".deck-vinyl", el) : $(".pad-vinyl", el);

    this.nameEl  = $('[data-tt-name]', el);
    this.curEl   = $('[data-tt-cur]', el);
    this.durEl   = $('[data-tt-dur]', el);
    this.barEl   = $('[data-tt-bar]', el);
    this.fillEl  = $('[data-tt-fill]', el);
    this.playBtn = $('[data-act="play"]', el);
    this.stopBtn = $('[data-act="stop"]', el);
    this.prevBtn = $('[data-act="prev"]', el);
    this.nextBtn = $('[data-act="next"]', el);

    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.track = null;
    // id of the sfx-add we last broadcast for THIS deck — lets `ended`
    // / `stop()` tell OBR to drop that exact SFX so a finished / stopped
    // one-shot can't linger in OBR's scene metadata.
    this._sfxId = null;
    this._roomVoice = null;
    this._mediaVersion = 0;

    this.sourceNode = null;
    this.fadeGain = null;
    this.duckGain = null;
    this.busGain = null;

    this._wire();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  _ensureAudioGraph() {
    if (this.sourceNode) return;
    const ctx = getCtx();
    this.sourceNode = ctx.createMediaElementSource(this.audio);
    this.fadeGain = ctx.createGain();
    this.fadeGain.gain.value = 0;
    this.busGain  = ctx.createGain();
    this.busGain.gain.value = state.volumes[this.bus];
    if (this.bus === "bgm") {
      this.duckGain = ctx.createGain();
      this.duckGain.gain.value = 1;
      this.sourceNode.connect(this.fadeGain).connect(this.duckGain).connect(this.busGain).connect(MASTER_LIMITER);
    } else {
      this.sourceNode.connect(this.fadeGain).connect(this.busGain).connect(MASTER_LIMITER);
    }
    this.audio.volume = 1;
  }

  _ramp(target, ms) {
    if (!state.fadeEnabled) {
      // Instant gain change — skip the ramp UI entirely.
      const ctx = getCtx();
      this.fadeGain.gain.cancelScheduledValues(ctx.currentTime);
      this.fadeGain.gain.setValueAtTime(target, ctx.currentTime);
      return Promise.resolve();
    }
    const ctx = getCtx();
    const t = ctx.currentTime;
    const dt = ms / 1000;
    this.fadeGain.gain.cancelScheduledValues(t);
    const cur = this.fadeGain.gain.value;
    this.fadeGain.gain.setValueAtTime(cur, t);
    this.fadeGain.gain.linearRampToValueAtTime(target, t + dt);
    return new Promise((r) => setTimeout(r, ms + 20));
  }

  _wire() {
    if (this.playBtn) this.playBtn.addEventListener("click", () => this.togglePlay());
    if (this.stopBtn) this.stopBtn.addEventListener("click", () => this.stop());
    if (this.prevBtn) this.prevBtn.addEventListener("click", () => this._historyPrev());
    if (this.nextBtn) this.nextBtn.addEventListener("click", () => this._historyNext());
    if (this.barEl) {
      this.barEl.addEventListener("click", (e) => {
        if (!this.audio.duration) return;
        const r = this.barEl.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.audio.duration;
        if (this.bus === "bgm") {
          sendToObr({ type: "bgm-seek", position });
          if (roomConnected()) return;
        }
        this.audio.currentTime = position;
      });
    }
    this.audio.addEventListener("ended", () => {
      // The room writer alone advances shared BGM. A local muted/blocked deck
      // is not a second clock and cannot clear/advance the room.
      if (this._roomVoice && roomConnected()) { this._setSpinning(false); return; }
      if (!this.audio.loop) {
        // SFX one-shot finished → tell OBR to drop THIS sfx so it can't
        // be resurrected by a later state write. (BGM end is implicit;
        // OBR just stops at the track's end.)
        if (this.bus === "sfx" && this._sfxId) {
          sendToObr({ type: "sfx-stop", id: this._sfxId });
          this._sfxId = null;
        }
        this._setSpinning(false);
        this._syncPlayUI();
        this.track = null;
        state.turntableTrack[this.slot] = null;
        if (this.nameEl) this.nameEl.textContent = this.bus === "bgm" ? T("muIdle") : T("muEmpty");
        if (this.bus === "bgm") this._updateHistoryButtons();
        renderLibrary(); renderFavorites();
        updateDucking();
        syncLoopToggleUi();
      }
    });

    // Drop target — accepts library cards AND favorite chips
    this.el.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes(DT_CARD) || e.dataTransfer.types.includes(DT_FAV)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        this.el.classList.add("drop-target");
      }
    });
    this.el.addEventListener("dragleave", () => this.el.classList.remove("drop-target"));
    this.el.addEventListener("drop", (e) => {
      e.preventDefault();
      this.el.classList.remove("drop-target");
      const id = e.dataTransfer.getData(DT_CARD) || e.dataTransfer.getData(DT_FAV);
      if (id) {
        const t = state.lib.find((x) => x.id === id);
        if (t) this.load(t, true);
      }
    });
  }

  _tick() {
    if (this._roomVoice && roomConnected()) this._paintRoomVoice();
    else if (this.audio.duration && !this.audio.paused) {
      if (this.curEl)  this.curEl.textContent  = fmtTime(this.audio.currentTime);
      if (this.durEl)  this.durEl.textContent  = fmtTime(this.audio.duration);
      if (this.fillEl) this.fillEl.style.width = (this.audio.currentTime / this.audio.duration * 100) + "%";
    }
    // Loop-boundary fade: when looping, fade out the tail before the
    // wrap and fade back in at the head. Only when fades are enabled
    // and there's a real graph attached. Guarded against the standard
    // play/pause/stop ramps by checking gain value transitions.
    if (state.fadeEnabled && this.audio.loop && !this.audio.paused &&
        this.fadeGain && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
      const t = this.audio.currentTime;
      const d = this.audio.duration;
      const fadeOutSec = FADE_OUT_MS / 1000;
      if (t > d - fadeOutSec) {
        if (this.fadeGain.gain.value > 0.5) {
          this._ramp(0, Math.max(80, (d - t) * 1000));
        }
      } else if (t < 0.4) {
        if (this.fadeGain.gain.value < 0.5) {
          this._ramp(1, FADE_IN_MS);
        }
      }
    }
    requestAnimationFrame(this._tick);
  }

  async load(track, autoplay = true) {
    if (roomConnected() && track.url) {
      sendToObr(this.bus === "bgm" ? { type: "bgm-load", url: track.url, name: track.name, loop: !!track.loop, position: 0 }
        : { type: "sfx-add", id: crypto.randomUUID(), url: track.url, name: track.name, loop: !!track.loop });
      return;
    }
    const generation = ++this._mediaVersion; this._roomVoice = null;
    if (this.track && !this.audio.paused && this.fadeGain) {
      await this._ramp(0, FADE_OUT_MS);
    }
    if (generation !== this._mediaVersion) return;
    if (this.audio.src.startsWith("blob:")) URL.revokeObjectURL(this.audio.src);
    this.track = track;
    state.turntableTrack[this.slot] = track.id;
    if (this.nameEl) this.nameEl.textContent = track.name || T("muUnnamed");
    this.audio.src = track.url || URL.createObjectURL(track.blob);
    this.audio.loop = !!track.loop;
    if (this.bus === "bgm") {
      this._pushHistory(track);
      this._updateHistoryButtons();
      syncLoopToggleUi();
    }
    if (autoplay) {
      try {
        await getCtx().resume();
        if (generation !== this._mediaVersion) return;
        this._ensureAudioGraph();
        await this.audio.play();
        if (generation !== this._mediaVersion) return;
        this._applyVolume();
        await this._ramp(1, FADE_IN_MS);
        if (generation !== this._mediaVersion) return;
        this._setSpinning(true);
        this._syncPlayUI();
        updateDucking();
      } catch (e) {
        toast(T("muPlayFail", { err: e?.message || e }), "error");
      }
    }
    renderLibrary(); renderFavorites();

    if (generation !== this._mediaVersion) return;

    if (this.bus === "bgm") {
      sendToObr({
        type: "bgm-load",
        url: track.url || "",
        name: track.name, loop: !!track.loop, position: 0,
      });
      if (!track.url) toast(T("muLocalNoShare"), "warn");
    } else {
      // Keep the id so `ended` / `stop()` can later sfx-stop THIS exact
      // SFX (a fresh id per play means re-triggering the same sound is
      // a new entry, never a resurrected stale one).
      const sfxId = crypto.randomUUID();
      this._sfxId = sfxId;
      sendToObr({
        type: "sfx-add", id: sfxId,
        url: track.url || "", name: track.name, loop: !!track.loop,
      });
    }
  }

  _applyVolume() {
    if (!this.busGain) return;
    const ctx = getCtx();
    const t = ctx.currentTime;
    this.busGain.gain.cancelScheduledValues(t);
    this.busGain.gain.setValueAtTime(this.busGain.gain.value, t);
    this.busGain.gain.linearRampToValueAtTime(state.volumes[this.bus], t + 0.12);
  }

  async togglePlay() {
    if (!this.track) return;
    if (roomConnected() && this._roomVoice) {
      // Use confirmed shared pause, not HTMLAudioElement.paused: autoplay can
      // block this website while Owlbear is legitimately playing.
      sendToObr(this.bus === "bgm" ? { type: this._roomVoice.paused ? "bgm-play" : "bgm-pause" }
        : { type: "sfx-stop", id: this._sfxId });
      return;
    }
    const generation = ++this._mediaVersion;
    const wasPaused = this.audio.paused;
    if (wasPaused) {
      try {
        await getCtx().resume();
        if (generation !== this._mediaVersion) return;
        this._ensureAudioGraph();
        await this.audio.play();
        if (generation !== this._mediaVersion) return;
        this._applyVolume();
        await this._ramp(1, FADE_IN_MS);
        if (generation !== this._mediaVersion) return;
        this._setSpinning(true);
        this._syncPlayUI();
        updateDucking();
      } catch (e) {
        toast(T("muPlayFail", { err: e?.message || e }), "error");
      }
    } else {
      await this._ramp(0, FADE_OUT_MS);
      if (generation !== this._mediaVersion) return;
      this.audio.pause();
      this._setSpinning(false);
      this._syncPlayUI();
      updateDucking();
    }
    if (generation === this._mediaVersion && this.bus === "bgm") {
      sendToObr({ type: wasPaused ? "bgm-play" : "bgm-pause", position: this.audio.currentTime });
    }
  }

  async stop() {
    if (roomConnected() && this._roomVoice) {
      sendToObr(this.bus === "bgm" ? { type: "bgm-stop" } : { type: "sfx-stop", id: this._sfxId }); return;
    }
    const generation = ++this._mediaVersion;
    const wasBgm = this.bus === "bgm" && this.track;
    // Capture the live sfx id before we clear it — a manually-stopped
    // SFX (esp. a loop) must be removed from OBR too, or OBR keeps
    // playing / re-triggering it.
    const sfxId = this.bus === "sfx" ? this._sfxId : null;
    if (this.fadeGain && !this.audio.paused) {
      await this._ramp(0, FADE_OUT_MS);
    }
    if (generation !== this._mediaVersion) return;
    this.audio.pause(); this.audio.currentTime = 0;
    if (this.audio.src.startsWith("blob:")) URL.revokeObjectURL(this.audio.src);
    this.audio.removeAttribute("src"); this.audio.load();
    this.track = null;
    this._sfxId = null;
    state.turntableTrack[this.slot] = null;
    if (this.nameEl) this.nameEl.textContent = this.bus === "bgm" ? T("muIdle") : T("muEmpty");
    this._setSpinning(false); this._syncPlayUI();
    if (this.curEl)  this.curEl.textContent = "00:00";
    if (this.durEl)  this.durEl.textContent = "00:00";
    if (this.fillEl) this.fillEl.style.width = "0%";
    if (this.bus === "bgm") { this._updateHistoryButtons(); syncLoopToggleUi(); }
    renderLibrary(); renderFavorites();
    updateDucking();
    if (wasBgm) sendToObr({ type: "bgm-stop" });
    else if (sfxId) sendToObr({ type: "sfx-stop", id: sfxId });
  }

  applyRoomVoice(voice) {
    const changed = this._roomVoice?.id !== voice?.id || this.track?.url !== voice?.track.url;
    const generation = ++this._mediaVersion;
    this._roomVoice = voice;
    if (!voice) {
      this.audio.pause();
      if (this.audio.src.startsWith("blob:")) URL.revokeObjectURL(this.audio.src);
      this.audio.removeAttribute("src"); this.audio.load(); this.track = null; this._sfxId = null;
      state.turntableTrack[this.slot] = null;
      if (this.nameEl) this.nameEl.textContent = this.bus === "bgm" ? T("muIdle") : T("muEmpty");
      if (this.curEl) this.curEl.textContent = "00:00";
      if (this.durEl) this.durEl.textContent = "00:00";
      if (this.fillEl) this.fillEl.style.width = "0%";
      this._setSpinning(false); this._syncPlayUI(); return;
    }
    const local = state.lib.find(t => t.url === voice.track.url);
    this.track = { ...voice.track, id: local?.id || voice.track.id };
    this._sfxId = this.bus === "sfx" ? voice.id : null;
    state.turntableTrack[this.slot] = this.track.id;
    if (this.nameEl) this.nameEl.textContent = this.track.name || T("muUnnamed");
    if (changed) {
      this.audio.pause();
      if (this.audio.src.startsWith("blob:")) URL.revokeObjectURL(this.audio.src);
      this.audio.src = voice.track.url;
      if (this.bus === "bgm") { this._pushHistory(this.track); this._updateHistoryButtons(); }
    }
    this.audio.loop = !!voice.track.loop;
    const seek = () => {
      if (generation !== this._mediaVersion || this._roomVoice !== voice) return;
      const position = this._roomPosition();
      if (Math.abs(this.audio.currentTime - position) > .75) { try { this.audio.currentTime = position; } catch {} }
    };
    if (this._roomMetadata) this.audio.removeEventListener("loadedmetadata", this._roomMetadata);
    this._roomMetadata = seek; this.audio.addEventListener("loadedmetadata", seek, { once: true }); seek();
    if (voice.paused) {
      this.audio.pause();
      if (this.fadeGain && audioCtx) { this.fadeGain.gain.cancelScheduledValues(audioCtx.currentTime); this.fadeGain.gain.value = 0; }
    } else if (this.audio.paused) {
      this._ensureAudioGraph(); this._applyVolume();
      this.fadeGain.gain.cancelScheduledValues(audioCtx.currentTime); this.fadeGain.gain.value = 1;
      // A suspended browser context is a local sound issue. Shared controls/UI
      // remain usable and local mute never sends a pause or volume command.
      if (audioCtx.state === "running") void this.audio.play().then(() => {
        if (generation !== this._mediaVersion) {
          if (!this._roomVoice || this._roomVoice.paused) this.audio.pause();
          return;
        }
        updateDucking();
      }).catch(() => { if (generation === this._mediaVersion && !localMute) toast(T("muLocalSoundBlocked"), "warn"); });
    }
    this._paintRoomVoice();
  }
  _roomPosition() {
    const v = this._roomVoice; if (!v) return 0;
    let position = Math.max(0, v.position + (v.paused ? 0 : (performance.now() - v.receivedAt) / 1000));
    const duration = this.audio.duration || v.track.duration;
    if (Number.isFinite(duration) && duration > 0) position = v.track.loop ? position % duration : Math.min(position, duration);
    return position;
  }
  _paintRoomVoice() {
    const v = this._roomVoice; if (!v) return;
    const position = this._roomPosition(), duration = this.audio.duration || v.track.duration || 0;
    if (this.curEl) this.curEl.textContent = fmtTime(position);
    if (this.durEl) this.durEl.textContent = fmtTime(duration);
    if (this.fillEl) this.fillEl.style.width = (duration > 0 ? position / duration * 100 : 0) + "%";
    this._setSpinning(!v.paused); this._syncPlayUI();
  }
  _setSpinning(s) {
    this.el.classList.toggle("playing", s);
    if (this.spinTarget) this.spinTarget.classList.toggle("spinning", s);
  }
  _syncPlayUI() {
    if (!this.playBtn) return;
    const playing = this.track && (this._roomVoice && roomConnected() ? !this._roomVoice.paused : !this.audio.paused);
    this.playBtn.classList.toggle("is-playing", !!playing);
  }
  _pushHistory(track) {
    const h = state.bgmHistory;
    const cur = h[state.bgmHistoryIdx];
    if (cur && cur.id === track.id) return;
    h.splice(state.bgmHistoryIdx + 1);
    h.push({ id: track.id });
    if (h.length > 50) h.shift();
    state.bgmHistoryIdx = h.length - 1;
  }
  _historyPrev() {
    if (state.bgmHistoryIdx <= 0) return;
    state.bgmHistoryIdx--;
    const t = state.lib.find((x) => x.id === state.bgmHistory[state.bgmHistoryIdx].id);
    if (t) this.load(t, true);
  }
  _historyNext() {
    if (state.bgmHistoryIdx >= state.bgmHistory.length - 1) return;
    state.bgmHistoryIdx++;
    const t = state.lib.find((x) => x.id === state.bgmHistory[state.bgmHistoryIdx].id);
    if (t) this.load(t, true);
  }
  _updateHistoryButtons() {
    if (!this.isBig) return;
    const hasPrev = state.bgmHistoryIdx > 0;
    const hasNext = state.bgmHistoryIdx >= 0 && state.bgmHistoryIdx < state.bgmHistory.length - 1;
    if (this.prevBtn) this.prevBtn.disabled = !hasPrev;
    if (this.nextBtn) this.nextBtn.disabled = !hasNext;
    if (histPrevName) {
      if (hasPrev) {
        const id = state.bgmHistory[state.bgmHistoryIdx - 1].id;
        const tk = state.lib.find((x) => x.id === id);
        histPrevName.textContent = tk ? trunc(tk.name) : T("muPrev");
      } else { histPrevName.textContent = T("muNone"); }
    }
    if (histNextName) {
      if (hasNext) {
        const id = state.bgmHistory[state.bgmHistoryIdx + 1].id;
        const tk = state.lib.find((x) => x.id === id);
        histNextName.textContent = tk ? trunc(tk.name) : T("muNext");
      } else { histNextName.textContent = T("muNone"); }
    }
  }
}
const TURNTABLES = [new Turntable(bgmDeck), ...sfxPads.map((el) => new Turntable(el))];
function turntableFor(slot) { return TURNTABLES.find((t) => t.slot === slot); }
function findEmptySfx() { return TURNTABLES.find((t) => t.bus === "sfx" && !t.track); }
const bgmDeckTT = turntableFor("bgm");

// ============ Loop + Fade toggles ============
function syncLoopToggleUi() {
  const tt = bgmDeckTT;
  const on = !!(tt.track && tt.audio.loop);
  loopToggle.classList.toggle("on", on);
}
loopToggle.addEventListener("click", async () => {
  const tt = bgmDeckTT;
  if (!tt.track) { toast(T("muBgmIdle"), "warn"); return; }
  const newLoop = !tt.audio.loop;
  if (roomConnected()) { sendToObr({ type: "bgm-loop", loop: newLoop }); return; }
  const track = tt.track, generation = tt._mediaVersion;
  tt.audio.loop = newLoop;
  tt.track.loop = newLoop;
  try { await updateTrack(tt.track.id, { loop: newLoop }); } catch {}
  if (track !== tt.track || generation !== tt._mediaVersion || roomConnected()) return;
  syncLoopToggleUi();
  // Re-render so the library card's loop badge / future loads pick up
  // the change.
  for (const t of state.lib) if (t.id === tt.track.id) t.loop = newLoop;
  sendToObr({ type: "bgm-load",
    url: tt.track.url || "", name: tt.track.name, loop: newLoop,
    position: tt.audio.currentTime || 0,
  });
});
fadeToggle.classList.toggle("on", state.fadeEnabled);
fadeToggle.addEventListener("click", () => {
  state.fadeEnabled = !state.fadeEnabled;
  saveFade();
  fadeToggle.classList.toggle("on", state.fadeEnabled);
  toast(T("muFadeToggled", { state: state.fadeEnabled ? T("muOn") : T("muOff") }), "ok");
});

// ============ Vertical volume bars ============
function bindVerticalVol(bar, fill, readout, bus) {
  // Update visual from state on init.
  const sync = () => {
    const pct = Math.round(state.volumes[bus] * 100);
    fill.style.height = pct + "%";
    if (readout) readout.textContent = String(pct);
  };
  sync();
  let dragging = false;
  function pickFromEvent(e) {
    const r = bar.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const ratio = Math.max(0, Math.min(1, (r.bottom - clientY) / r.height));
    state.volumes[bus] = ratio;
    saveVolumes();
    sync();
    for (const tt of TURNTABLES) if (tt.bus === bus) tt._applyVolume();
    sendToObr({ type: "volume", bus, vol: ratio });
  }
  bar.addEventListener("pointerdown", (e) => {
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    pickFromEvent(e);
  });
  bar.addEventListener("pointermove", (e) => { if (dragging) pickFromEvent(e); });
  bar.addEventListener("pointerup", (e) => {
    dragging = false;
    try { bar.releasePointerCapture(e.pointerId); } catch {}
  });
  bar.addEventListener("pointercancel", () => { dragging = false; });
  // Wheel: ± 5 %
  bar.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.volumes[bus] = Math.max(0, Math.min(1, state.volumes[bus] + (e.deltaY < 0 ? 0.05 : -0.05)));
    saveVolumes(); sync();
    for (const tt of TURNTABLES) if (tt.bus === bus) tt._applyVolume();
    sendToObr({ type: "volume", bus, vol: state.volumes[bus] });
  }, { passive: false });
  // External update hook (e.g. setting changed from elsewhere — unused now).
  return sync;
}
const syncBgmVolume = bindVerticalVol(bgmVvBar, bgmVvFill, bgmVvReadout, "bgm");
const syncSfxVolume = bindVerticalVol(sfxVvBar, sfxVvFill, sfxVvReadout, "sfx");

// ============ Auto-ducking ============
function updateDucking() {
  const bgmTT = bgmDeckTT;
  if (!bgmTT.duckGain) return;
  const sfxActive = TURNTABLES.some((tt) => tt.bus === "sfx" && tt.track && !tt.audio.paused);
  const ctx = getCtx();
  const t = ctx.currentTime;
  const cur = bgmTT.duckGain.gain.value;
  bgmTT.duckGain.gain.cancelScheduledValues(t);
  bgmTT.duckGain.gain.setValueAtTime(cur, t);
  bgmTT.duckGain.gain.linearRampToValueAtTime(sfxActive ? 0.4 : 1.0, t + (sfxActive ? 0.4 : 0.8));
}

// ============ Library ============
function findDuplicatesByUrl(tracks) {
  const byUrl = new Map();
  for (const t of tracks) {
    if (!t.url) continue;
    if (!byUrl.has(t.url)) byUrl.set(t.url, []);
    byUrl.get(t.url).push(t);
  }
  const deletes = [], tagUpdates = new Map(), rewrite = new Map();
  for (const [, group] of byUrl) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const primary = group[0];
    const tagSet = new Set();
    for (const g of group) for (const tag of (g.tags || [])) tagSet.add(tag);
    const merged = [...tagSet];
    if (JSON.stringify(merged) !== JSON.stringify(primary.tags || [])) tagUpdates.set(primary.id, merged);
    for (const dup of group.slice(1)) { deletes.push(dup.id); rewrite.set(dup.id, primary.id); }
  }
  return { deletes, tagUpdates, rewrite };
}

async function refreshLibrary() {
  let raw = await listTracks();
  const dups = findDuplicatesByUrl(raw);
  if (dups.deletes.length > 0) {
    for (const [primaryId, tags] of dups.tagUpdates) {
      try { await updateTrack(primaryId, { tags }); } catch (e) { console.warn(e); }
    }
    for (const id of dups.deletes) {
      try { await deleteTrack(id); } catch (e) { console.warn(e); }
    }
    for (const [dupId, primaryId] of dups.rewrite) {
      for (const slot of Object.keys(state.turntableTrack)) {
        if (state.turntableTrack[slot] === dupId) state.turntableTrack[slot] = primaryId;
      }
      for (const tt of TURNTABLES) {
        if (tt.track?.id === dupId) tt.track = raw.find((x) => x.id === primaryId) || tt.track;
      }
      const fi = state.favorites.indexOf(dupId);
      if (fi >= 0) {
        if (state.favorites.includes(primaryId)) state.favorites.splice(fi, 1);
        else state.favorites[fi] = primaryId;
      }
      for (const h of state.bgmHistory) if (h.id === dupId) h.id = primaryId;
    }
    const ch = [];
    for (const h of state.bgmHistory) {
      if (ch.length === 0 || ch[ch.length - 1].id !== h.id) ch.push(h);
    }
    state.bgmHistory = ch;
    if (state.bgmHistoryIdx >= ch.length) state.bgmHistoryIdx = ch.length - 1;
    saveFavs();
    toast(T("muDedup", { n: dups.deletes.length }), "ok");
    raw = await listTracks();
  }
  state.lib = raw.map((t) => ({ tags: [], ...t }));
  // Prune favorites against deleted ids
  const ids = new Set(state.lib.map((t) => t.id));
  const fBefore = state.favorites.length;
  state.favorites = state.favorites.filter((id) => ids.has(id));
  if (state.favorites.length !== fBefore) saveFavs();
  renderLibrary();
  renderFavorites();
  bgmDeckTT._updateHistoryButtons();
  syncLoopToggleUi();
}

function visibleTracks() {
  let arr = state.lib;
  if (state.filter.kind === "bus") arr = arr.filter((t) => t.bus === state.filter.value);
  else if (state.filter.kind === "tag") arr = arr.filter((t) => (t.tags || []).includes(state.filter.value));
  if (state.libSearchStr) {
    const q = state.libSearchStr.toLowerCase();
    arr = arr.filter((t) =>
      (t.name || "").toLowerCase().includes(q) ||
      (t.origName || "").toLowerCase().includes(q) ||
      (t.tags || []).some((g) => g.toLowerCase().includes(q)),
    );
  }
  return arr;
}
function renderLibrary() {
  libCount.textContent = state.lib.length;
  // 详细信息 off → hide the duration/bitrate/size row + shrink cards
  // (CSS keys off this class on the grid).
  libGrid.classList.toggle("hide-details", !state.showDetails);
  renderChipFilter();
  const arr = visibleTracks();
  libGrid.innerHTML = "";
  if (arr.length === 0) {
    const e = document.createElement("div");
    e.className = "lib-empty";
    if (state.lib.length === 0) {
      e.innerHTML = `<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div class="empty-title">${T("muLibEmptyTitle")}</div>
        <div class="empty-hint">${T("muLibEmptyHint")}</div>`;
    } else {
      e.innerHTML = `<div class="empty-title">${T("muNoMatch")}</div>`;
    }
    libGrid.appendChild(e);
    return;
  }
  for (const t of arr) libGrid.appendChild(makeCard(t));
}
function renderChipFilter() {
  const tagCounts = new Map();
  let bgmN = 0, sfxN = 0;
  for (const t of state.lib) {
    if (t.bus === "bgm") bgmN++; else sfxN++;
    for (const g of (t.tags || [])) tagCounts.set(g, (tagCounts.get(g) || 0) + 1);
  }
  chipFilterRow.innerHTML = "";
  const mk = (label, klass, isOn, onClick, count) => {
    const chip = document.createElement("button");
    chip.className = "chip " + klass + (isOn ? " on" : "");
    chip.innerHTML = `<span>${label}</span>` + (count != null ? `<span class="chip-count">${count}</span>` : "");
    chip.addEventListener("click", onClick);
    return chip;
  };
  chipFilterRow.appendChild(mk(T("muAll"), "chip--all",
    state.filter.kind === "all",
    () => { state.filter = { kind: "all" }; renderLibrary(); },
    state.lib.length));
  chipFilterRow.appendChild(mk("BGM", "chip--bus chip--bgm",
    state.filter.kind === "bus" && state.filter.value === "bgm",
    () => { state.filter = { kind: "bus", value: "bgm" }; renderLibrary(); },
    bgmN));
  chipFilterRow.appendChild(mk("SFX", "chip--bus chip--sfx",
    state.filter.kind === "bus" && state.filter.value === "sfx",
    () => { state.filter = { kind: "bus", value: "sfx" }; renderLibrary(); },
    sfxN));
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
  for (const [name, n] of tags) {
    const isOn = state.filter.kind === "tag" && state.filter.value === name;
    const chip = mk(name, "chip--tag", isOn,
      () => { state.filter = isOn ? { kind: "all" } : { kind: "tag", value: name }; renderLibrary(); },
      n);
    // Colour the chip by its tag colour. Active = solid fill + contrast
    // text; inactive = tinted bg + bright colour text + soft border, so
    // the hue is always readable on the dark UI.
    const color = tagColorFor(name);
    if (isOn) {
      chip.style.background = color;
      chip.style.borderColor = color;
      chip.style.color = tagTextColor(color);
    } else {
      chip.style.background = _rgba(color, 0.12);
      chip.style.borderColor = _rgba(color, 0.5);
      chip.style.color = tagColorOnDark(color);
    }
    // Right-click → recolour this tag.
    chip.addEventListener("contextmenu", (e) => { e.preventDefault(); openTagColorPicker(name, chip); });
    chipFilterRow.appendChild(chip);
  }
}

const PLAYING_IDS = () => new Set(Object.values(state.turntableTrack).filter(Boolean));

function makeCard(t) {
  const playing = PLAYING_IDS().has(t.id);
  const localOnly = !!t.blob && !t.url;
  const inFavorites = state.favorites.includes(t.id);
  const card = document.createElement("div");
  card.className = "lib-card"
    + (playing ? " is-playing" : "")
    + (localOnly ? " local-only" : "")
    + (inFavorites ? " is-favorite" : "");
  card.draggable = true;
  card.dataset.id = t.id;
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData(DT_CARD, t.id);
    e.dataTransfer.effectAllowed = "copy";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("dblclick", () => playOnBestTarget(t));

  const head = document.createElement("div");
  head.className = "card-head-row";
  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = t.name;
  name.title = t.origName || t.name;
  name.contentEditable = "true";
  name.spellcheck = false;
  name.addEventListener("blur", async () => {
    const n = name.textContent.trim();
    if (n && n !== t.name) {
      t.name = n;
      await updateTrack(t.id, { name: n });
      for (const tt of TURNTABLES) if (tt.track?.id === t.id && tt.nameEl) tt.nameEl.textContent = n;
      renderFavorites();
    } else { name.textContent = t.name; }
  });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } });
  name.addEventListener("mousedown", (e) => e.stopPropagation());
  const bus = document.createElement("span");
  bus.className = "card-bus " + t.bus;
  bus.textContent = t.bus.toUpperCase();
  head.appendChild(name); head.appendChild(bus);

  const corner = document.createElement("div");
  corner.className = "card-corner";
  if (localOnly) {
    const warn = document.createElement("button");
    warn.className = "card-corner-btn warn";
    warn.textContent = "!";
    // Custom CSS tooltip (::after on hover, see style.css) — no native
    // `title` because the native tooltip has a 0.5–1 s OS delay and
    // can't be styled. aria-label keeps screen-reader access.
    warn.dataset.tip = T("muLocalNoShareTip");
    warn.setAttribute("aria-label", T("muLocalNoShareAria"));
    corner.appendChild(warn);
  }
  const del = document.createElement("button");
  del.className = "card-corner-btn danger";
  del.textContent = "×";
  del.title = T("muDelete");
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(T("muConfirmDelTrack", { name: t.name }))) return;
    for (const tt of TURNTABLES) if (tt.track?.id === t.id) tt.stop();
    await deleteTrack(t.id);
    if (state.favorites.includes(t.id)) {
      state.favorites = state.favorites.filter((id) => id !== t.id);
      saveFavs();
    }
    await refreshLibrary();
  });
  corner.appendChild(del);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const bits = [];
  if (t.duration) bits.push(fmtTime(t.duration));
  if (t.bitrate)  bits.push(t.bitrate + "k");
  if (t.bytes)    bits.push(fmtBytes(t.bytes));
  meta.innerHTML = bits.map((b, i) => i === 0 ? `<span>${b}</span>` : `<span class="dot">·</span><span>${b}</span>`).join("");

  const tags = document.createElement("div");
  tags.className = "card-tags";
  for (const g of (t.tags || [])) {
    const c = document.createElement("span");
    c.className = "card-tag"; c.textContent = g;
    const color = tagColorFor(g);
    c.style.background = color;
    c.style.color = tagTextColor(color);
    c.style.borderColor = _rgba(color, 0.6);
    c.title = T("muRightClickColor");
    c.addEventListener("contextmenu", (e) => { e.stopPropagation(); e.preventDefault(); openTagColorPicker(g, c); });
    tags.appendChild(c);
  }
  const add = document.createElement("span");
  add.className = "card-tag add-tag"; add.textContent = "+";
  add.title = T("muAddTag");
  add.addEventListener("click", (e) => { e.stopPropagation(); openTagModal(t); });
  tags.appendChild(add);

  card.appendChild(head);
  card.appendChild(corner);
  card.appendChild(meta);
  card.appendChild(tags);
  return card;
}

function playOnBestTarget(t) {
  for (const tt of TURNTABLES) if (tt.track?.id === t.id) { tt.stop(); return; }
  if (t.bus === "bgm") turntableFor("bgm").load(t, true);
  else (findEmptySfx() || turntableFor("sfx-0")).load(t, true);
}

// ============ Favorites (own section) ============
function renderFavorites() {
  favCount.textContent = state.favorites.length;
  favGrid.innerHTML = "";
  if (state.favorites.length === 0) {
    const e = document.createElement("div");
    e.className = "fav-empty";
    e.textContent = T("muFavEmpty");
    favGrid.appendChild(e);
    return;
  }
  const playingIds = PLAYING_IDS();
  for (const id of state.favorites) {
    const t = state.lib.find((x) => x.id === id);
    if (!t) continue;
    const isPlaying = playingIds.has(id);
    const item = document.createElement("div");
    item.className = "fav-item" + (isPlaying ? " is-playing" : "");
    item.title = isPlaying ? T("muPlayingClickStop") : T("muClickToPlay", { name: t.name });
    item.draggable = true;
    item.dataset.id = id;
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(DT_FAV, id);
      e.dataTransfer.effectAllowed = "copy";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
    });
    item.addEventListener("click", (e) => {
      if (e.target.closest(".fav-item-x")) return;
      playOnBestTarget(t);
    });
    const n = document.createElement("span");
    n.className = "fav-item-name";
    n.textContent = t.name;
    const x = document.createElement("button");
    x.className = "fav-item-x";
    x.textContent = "×";
    x.title = T("muRemoveFav");
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      state.favorites = state.favorites.filter((q) => q !== id);
      saveFavs(); renderFavorites(); renderLibrary();
    });
    item.appendChild(n); item.appendChild(x);
    favGrid.appendChild(item);
  }
}
favClearBtn.addEventListener("click", () => {
  if (state.favorites.length === 0) return;
  if (!confirm(T("muConfirmClearFav", { n: state.favorites.length }))) return;
  state.favorites = []; saveFavs(); renderFavorites(); renderLibrary();
});

// Drop target on favorites section — accepts cards (add) but does NOT play.
favoritesSection.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes(DT_CARD)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    favoritesSection.classList.add("drop-target");
  }
});
favoritesSection.addEventListener("dragleave", () => favoritesSection.classList.remove("drop-target"));
favoritesSection.addEventListener("drop", (e) => {
  if (!e.dataTransfer.types.includes(DT_CARD)) return;
  e.preventDefault();
  favoritesSection.classList.remove("drop-target");
  const id = e.dataTransfer.getData(DT_CARD);
  if (!id) return;
  if (state.favorites.includes(id)) { toast(T("muAlreadyFav"), "warn"); return; }
  state.favorites.push(id); saveFavs(); renderFavorites(); renderLibrary();
});

// ============ Library drop zone — files only ============
let _dragDepth = 0;
libDropZone.addEventListener("dragenter", (e) => {
  // Only react to OS file drops here. fav-removal is handled by `library`
  // wrapper below (which fires for the bigger area).
  if (!e.dataTransfer.types.includes("Files")) return;
  e.preventDefault(); _dragDepth++; libDropZone.classList.add("drag-over");
});
libDropZone.addEventListener("dragleave", () => {
  _dragDepth = Math.max(0, _dragDepth - 1);
  if (_dragDepth === 0) libDropZone.classList.remove("drag-over");
});
libDropZone.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  }
});
libDropZone.addEventListener("drop", async (e) => {
  if (!e.dataTransfer.types.includes("Files")) return;
  e.preventDefault(); _dragDepth = 0; libDropZone.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files).filter((f) =>
    f.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|opus|flac|webm|aac)$/i.test(f.name));
  if (files.length === 0) { toast(T("muNoAudioFile"), "warn"); return; }
  if (files.length > 1) toast(T("muMultiFileFirst", { n: files.length }), "warn");
  openEditor(files[0]);
});

addFileBtn.addEventListener("click", () => hiddenFileInput.click());
hiddenFileInput.addEventListener("change", () => {
  if (hiddenFileInput.files?.[0]) openEditor(hiddenFileInput.files[0]);
  hiddenFileInput.value = "";
});
libSearch.addEventListener("input", () => { state.libSearchStr = libSearch.value.trim(); renderLibrary(); });

// ============ Editor modal ============
function openEditor(file) {
  state.editor.file = file;
  trackName.value = file.name.replace(/\.[a-z0-9]+$/i, "");
  trackMeta.textContent = T("muDecoding");
  editorModal.classList.remove("hidden");
  (async () => {
    try {
      const ab = await file.arrayBuffer();
      const buf = await getCtx().decodeAudioData(ab.slice(0));
      state.editor.audioBuffer = buf;
      state.editor.trim.start = 0;
      state.editor.trim.end = buf.duration;
      trackMeta.textContent =
        `${fmtTimeMs(buf.duration)} · ${buf.sampleRate}Hz · ` +
        `${buf.numberOfChannels === 2 ? T("muStereo") : (buf.numberOfChannels + "ch")} · ` +
        fmtBytes(file.size);
      originalSize.textContent = fmtBytes(file.size);
      renderWaveform(); syncTrimUI(); updateSizeEstimate();
    } catch (err) {
      console.error("decode failed", err);
      trackMeta.textContent = "";
      toast(T("muDecodeFail"), "error");
      closeEditor();
    }
  })();
}
function closeEditor() {
  stopPreview();
  state.editor.file = null; state.editor.audioBuffer = null;
  editorModal.classList.add("hidden");
}
editorModal.addEventListener("click", (e) => { if (e.target.matches("[data-close]")) closeEditor(); });

function renderWaveform() {
  if (!state.editor.audioBuffer) return;
  const cv = waveformCanvas;
  const dpr = window.devicePixelRatio || 1;
  const cssW = cv.clientWidth, cssH = cv.clientHeight;
  cv.width  = Math.max(1, Math.floor(cssW * dpr));
  cv.height = Math.max(1, Math.floor(cssH * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const buf = state.editor.audioBuffer;
  const d0 = buf.getChannelData(0);
  const d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const spp = Math.max(1, Math.floor(d0.length / cssW));
  const midY = cssH / 2;
  const peak = getCssVar("--wave-peak");
  const rms  = getCssVar("--wave-rms");
  ctx.fillStyle = peak;
  for (let x = 0; x < cssW; x++) {
    const s = x * spp;
    let lo = 0, hi = 0;
    const end = Math.min(d0.length, s + spp);
    for (let i = s; i < end; i++) {
      let v = d0[i]; if (d1) v = (v + d1[i]) * 0.5;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    ctx.fillRect(x, midY - hi * midY, 1, Math.max(1, (midY - lo * midY) - (midY - hi * midY)));
  }
  ctx.fillStyle = rms;
  for (let x = 0; x < cssW; x++) {
    const s = x * spp;
    let sum = 0, cnt = 0;
    const end = Math.min(d0.length, s + spp);
    for (let i = s; i < end; i++) {
      let v = d0[i]; if (d1) v = (v + d1[i]) * 0.5;
      sum += v * v; cnt++;
    }
    const r = cnt ? Math.sqrt(sum / cnt) : 0;
    const h = r * midY * 1.6;
    ctx.fillRect(x, midY - h, 1, h * 2);
  }
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, midY - 0.5, cssW, 1);
}
function getCssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#5dade2"; }
new ResizeObserver(() => { if (!editorModal.classList.contains("hidden")) renderWaveform(); }).observe(waveformCanvas);

function syncTrimUI() {
  if (!state.editor.audioBuffer) return;
  const dur = state.editor.audioBuffer.duration;
  const pxPerSec = waveformCanvas.clientWidth / dur;
  const lx = state.editor.trim.start * pxPerSec;
  const rx = state.editor.trim.end * pxPerSec;
  trimMaskL.style.width  = `${lx}px`;
  trimMaskR.style.width  = `${waveformCanvas.clientWidth - rx}px`;
  trimHandleL.style.left = `${lx}px`;
  trimHandleR.style.left = `${rx}px`;
  trimStartTxt.value = fmtTimeMs(state.editor.trim.start);
  trimEndTxt.value   = fmtTimeMs(state.editor.trim.end);
  trimLenTxt.textContent = fmtTimeMs(state.editor.trim.end - state.editor.trim.start);
  updateSizeEstimate();
}
function updateSizeEstimate() {
  const dur = Math.max(0, state.editor.trim.end - state.editor.trim.start);
  sizeEstimate.textContent = fmtBytes(estimateOpusBytes(dur, state.editor.bitrate));
}

let _dragHandle = null;
function onHandleDown(h, e) { _dragHandle = h; e.preventDefault(); document.body.style.userSelect = "none"; }
function onHandleMove(e) {
  if (!_dragHandle || !state.editor.audioBuffer) return;
  const rect = waveformCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const px = Math.max(0, Math.min(rect.width, cx - rect.left));
  const t = (px / rect.width) * state.editor.audioBuffer.duration;
  if (_dragHandle === "L") state.editor.trim.start = Math.max(0, Math.min(t, state.editor.trim.end - 0.1));
  else state.editor.trim.end = Math.min(state.editor.audioBuffer.duration, Math.max(t, state.editor.trim.start + 0.1));
  syncTrimUI();
}
function onHandleUp() { _dragHandle = null; document.body.style.userSelect = ""; }
trimHandleL.addEventListener("mousedown",  (e) => onHandleDown("L", e));
trimHandleR.addEventListener("mousedown",  (e) => onHandleDown("R", e));
trimHandleL.addEventListener("touchstart", (e) => onHandleDown("L", e), { passive: false });
trimHandleR.addEventListener("touchstart", (e) => onHandleDown("R", e), { passive: false });
document.addEventListener("mousemove", onHandleMove);
document.addEventListener("touchmove", onHandleMove, { passive: false });
document.addEventListener("mouseup",   onHandleUp);
document.addEventListener("touchend",  onHandleUp);
trimStartTxt.addEventListener("change", () => {
  const t = parseTime(trimStartTxt.value); if (t == null) { syncTrimUI(); return; }
  state.editor.trim.start = Math.max(0, Math.min(t, state.editor.trim.end - 0.1));
  syncTrimUI();
});
trimEndTxt.addEventListener("change", () => {
  const t = parseTime(trimEndTxt.value); if (t == null) { syncTrimUI(); return; }
  state.editor.trim.end = Math.min(state.editor.audioBuffer.duration, Math.max(t, state.editor.trim.start + 0.1));
  syncTrimUI();
});
resetTrimBtn.addEventListener("click", () => {
  if (!state.editor.audioBuffer) return;
  state.editor.trim.start = 0;
  state.editor.trim.end = state.editor.audioBuffer.duration;
  syncTrimUI();
});
function wireSeg(seg, setter) {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-opt"); if (!b) return;
    seg.querySelectorAll(".seg-opt").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); setter(b);
  });
}
wireSeg(bitrateSeg, (b) => { state.editor.bitrate = parseInt(b.dataset.br, 10); updateSizeEstimate(); });
wireSeg(channelSeg, (b) => { state.editor.channels = parseInt(b.dataset.ch, 10); });
wireSeg(busSeg,     (b) => { state.editor.bus = b.dataset.bus; });
wireSeg(urlBusSeg,  (b) => { state.urlBus = b.dataset.bus; });

previewBtn.addEventListener("click", async () => {
  if (!state.editor.audioBuffer) return;
  if (state.editor.preview) { stopPreview(); return; }
  await getCtx().resume();
  const src = getCtx().createBufferSource();
  src.buffer = state.editor.audioBuffer;
  src.connect(getCtx().destination);
  const off = state.editor.trim.start;
  const len = Math.max(0, state.editor.trim.end - state.editor.trim.start);
  src.start(0, off, len);
  state.editor.preview = src;
  previewBtn.textContent = T("muStopPreview");
  playCursor.classList.add("playing");
  const t0 = getCtx().currentTime;
  const tick = () => {
    if (state.editor.preview !== src) return;
    const e = getCtx().currentTime - t0;
    if (e >= len) { stopPreview(); return; }
    const pxs = waveformCanvas.clientWidth / state.editor.audioBuffer.duration;
    playCursor.style.left = ((off + e) * pxs) + "px";
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  src.onended = () => { if (state.editor.preview === src) stopPreview(); };
});
function stopPreview() {
  if (state.editor.preview) { try { state.editor.preview.stop(); } catch {} state.editor.preview = null; }
  previewBtn.textContent = T("muPreview");
  playCursor.classList.remove("playing");
}

encodeBtn.addEventListener("click", async () => {
  if (!state.editor.file || !state.editor.audioBuffer) return;
  if (state.editor.trim.end - state.editor.trim.start < 0.1) { toast(T("muTrimTooShort"), "warn"); return; }
  stopPreview();
  encodeBtn.disabled = true;
  encodeProg.classList.remove("hidden");
  encodeFill.style.width = "0%";
  encodeMsg.textContent = T("muPreparing");
  try {
    const blob = await encodeOpus(state.editor.file, {
      trimStart: state.editor.trim.start,
      trimEnd:   state.editor.trim.end,
      bitrate:   state.editor.bitrate,
      channels:  state.editor.channels,
      onProgress: (r, msg) => { encodeFill.style.width = (r * 100).toFixed(1) + "%"; if (msg) encodeMsg.textContent = msg; },
    });
    const track = {
      id: crypto.randomUUID(),
      name: trackName.value.trim() || T("muUnnamed"),
      bus:  state.editor.bus,
      loop: loopChk.checked,
      volume: 1,
      duration: state.editor.trim.end - state.editor.trim.start,
      bitrate:  state.editor.bitrate,
      bytes:    blob.size,
      mime:     blob.type,
      blob,
      origName: state.editor.file.name,
      trim:     { start: state.editor.trim.start, end: state.editor.trim.end },
      tags:     [],
      ts:       Date.now(),
    };
    await addTrack(track);
    toast(T("muAddedToLib", { name: track.name, size: fmtBytes(blob.size) }), "ok");
    closeEditor();
    await refreshLibrary();
  } catch (err) {
    console.error("encode failed", err);
    toast(T("muEncodeFail", { err: err?.message || err }), "error");
  } finally {
    encodeBtn.disabled = false;
    encodeProg.classList.add("hidden");
  }
});

// ============ URL modal (single + batch import) ============
//
// Accepts MANY links at once — split on newline / comma / semicolon /
// whitespace / Chinese punctuation. Each token is normalised:
//   · NetEase share link / song page / bare song id → the playable
//     "outer" direct URL. NetEase's CDN sends Access-Control-Allow-
//     Origin:* and serves HTTPS, so it plays through our WebAudio
//     graph like any direct mp3. Only non-VIP songs resolve — VIP /
//     region-locked ids 302 to /404 and simply won't play.
//   · A plain http(s) audio URL → used as-is.
//   · A QQ Music link → rejected (QQ needs a per-play signed vkey;
//     there is no static playable URL).

function deriveNameFromUrl(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length) {
      const last = decodeURIComponent(segs[segs.length - 1]).replace(/\.[a-z0-9]{1,5}$/i, "");
      if (last) return last;
    }
  } catch {}
  return T("muExtMusic");
}

const NETEASE_RE = /(?:music\.163\.com|y\.music\.163\.com|y\.163\.com)/i;
function neteaseSongId(s) {
  // ?id=NNN / &id=NNN  (song?id=, outer/url?id=, share links)
  let m = s.match(/[?&]id=(\d+)/);
  if (m) return m[1];
  // /song/NNN  (path-style share links)
  m = s.match(/\/song\/(\d+)/);
  if (m) return m[1];
  return null;
}
function neteaseOuter(id) {
  // HTTPS outer endpoint → 302 to the CDN mp3 (HTTPS-capable, ACAO:*).
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

/** Normalise one pasted token into a playable entry, or report why it
 *  can't be used. → { ok, url?, name?, source?, reason? } */
function normalizeMusicUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return { ok: false, reason: T("muReasonEmpty") };
  if (NETEASE_RE.test(s)) {
    const id = neteaseSongId(s);
    if (!id) return { ok: false, reason: T("muReasonNoId") };
    return { ok: true, url: neteaseOuter(id), name: T("muNeteaseName", { id }), source: "netease" };
  }
  if (/(?:y\.qq\.com|i\.y\.qq\.com|c\.y\.qq\.com|qqmusic)/i.test(s)) {
    return { ok: false, reason: T("muReasonQQ") };
  }
  if (/^\d{5,}$/.test(s)) {
    // bare number → assume a NetEase song id
    return { ok: true, url: neteaseOuter(s), name: T("muNeteaseName", { id: s }), source: "netease" };
  }
  if (/^https?:\/\//i.test(s)) {
    return { ok: true, url: s, source: "direct" };
  }
  return { ok: false, reason: T("muReasonNotLink") };
}

/** Split the textarea into candidate tokens. */
function parseUrlTokens(text) {
  return (text || "").split(/[\n\r,，;；、\s]+/).map((s) => s.trim()).filter(Boolean);
}

addUrlBtn.addEventListener("click", () => {
  urlInput.value = ""; urlName.value = "";
  urlAddBtn.disabled = true;
  urlAddBtn.textContent = T("muUrlAdd");
  urlModal.classList.remove("hidden");
  setTimeout(() => urlInput.focus(), 30);
});
urlModal.addEventListener("click", (e) => { if (e.target.matches("[data-close]")) urlModal.classList.add("hidden"); });
urlInput.addEventListener("input", () => {
  const okCount = parseUrlTokens(urlInput.value).filter((t) => normalizeMusicUrl(t).ok).length;
  urlAddBtn.disabled = okCount === 0;
  urlAddBtn.textContent = okCount > 1 ? T("muImportN", { n: okCount }) : T("muUrlAdd");
});
// Plain Enter inserts a newline (multi-line paste); Ctrl/Cmd+Enter submits.
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !urlAddBtn.disabled) {
    e.preventDefault();
    urlAddBtn.click();
  }
});
urlAddBtn.addEventListener("click", async () => {
  const tokens = parseUrlTokens(urlInput.value);
  if (tokens.length === 0) return;
  // Dedup against URLs already in the library.
  const existing = new Set(state.lib.filter((t) => t.url).map((t) => t.url));
  const customName = urlName.value.trim();
  let added = 0, dup = 0; const skipped = [];
  for (const tok of tokens) {
    const r = normalizeMusicUrl(tok);
    if (!r.ok) { skipped.push(`${tok} → ${r.reason}`); continue; }
    if (existing.has(r.url)) { dup++; continue; }
    existing.add(r.url);
    const name = (tokens.length === 1 && customName)
      ? customName
      : (r.name || deriveNameFromUrl(r.url));
    await addTrack({
      id: crypto.randomUUID(),
      name, bus: state.urlBus, loop: urlLoopChk.checked, volume: 1,
      duration: 0, bitrate: 0, bytes: 0, mime: "audio/*",
      url: r.url, origName: tok, tags: [], ts: Date.now(),
    });
    added++;
  }
  let msg = T("muImported", { n: added });
  if (dup) msg += T("muSkippedDup", { n: dup });
  if (skipped.length) msg += T("muUnrecognized", { n: skipped.length });
  toast(msg, added ? "ok" : "warn");
  if (skipped.length) console.warn("[music-studio] 批量导入跳过：\n" + skipped.join("\n"));
  urlModal.classList.add("hidden");
  await refreshLibrary();
});

// ============ Tag modal ============
function openTagModal(track) {
  state.tagEditId = track.id;
  tagInput.value = (track.tags || []).join(" ");
  const all = new Set();
  for (const t of state.lib) for (const g of (t.tags || [])) all.add(g);
  const have = new Set(track.tags || []);
  tagSuggestions.innerHTML = "";
  for (const g of [...all].filter((x) => !have.has(x)).sort((a, b) => a.localeCompare(b, "zh"))) {
    const chip = document.createElement("span");
    chip.className = "chip"; chip.textContent = "+ " + g;
    chip.addEventListener("click", () => {
      const cur = tagInput.value.trim();
      tagInput.value = cur ? cur + " " + g : g;
      chip.remove();
    });
    tagSuggestions.appendChild(chip);
  }
  tagModal.classList.remove("hidden");
  setTimeout(() => tagInput.focus(), 30);
}
tagModal.addEventListener("click", (e) => { if (e.target.matches("[data-close]")) tagModal.classList.add("hidden"); });
tagSaveBtn.addEventListener("click", async () => {
  if (!state.tagEditId) return;
  const tags = tagInput.value.split(/[\s,，、]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set(), uniq = [];
  for (const g of tags) if (!seen.has(g)) { seen.add(g); uniq.push(g); }
  await updateTrack(state.tagEditId, { tags: uniq });
  tagModal.classList.add("hidden");
  await refreshLibrary();
});

// ============ Default catalog import ============
const MANIFEST_URL = "https://obr.dnd.center/music/manifest.json";
// 详细信息 toggle — show/hide the duration·bitrate·size meta row and
// compact the cards. Persisted per browser.
function syncDetailsToggleUi() {
  if (!detailsToggle) return;
  detailsToggle.classList.toggle("on", state.showDetails);
  detailsToggle.setAttribute("aria-pressed", state.showDetails ? "true" : "false");
}
if (detailsToggle) {
  syncDetailsToggleUi();
  detailsToggle.addEventListener("click", () => {
    state.showDetails = !state.showDetails;
    saveDetails();
    syncDetailsToggleUi();
    renderLibrary();
  });
}

loadDefaultsBtn.addEventListener("click", async () => {
  loadDefaultsBtn.disabled = true;
  loadDefaultsBtn.textContent = T("muLoading");
  try {
    const r = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    if (tracks.length === 0) { toast(T("muDefaultEmpty"), "warn"); return; }
    const byUrl = new Map();
    for (const t of state.lib) if (t.url) byUrl.set(t.url, t);
    let added = 0, updated = 0, unchanged = 0;
    for (const t of tracks) {
      if (!t.url) continue;
      const incomingTags = Array.isArray(t.tags) ? t.tags : [];
      const desiredTags = incomingTags.length > 0 ? [...incomingTags, T("muDefaultTag")] : [T("muDefaultTag")];
      const existing = byUrl.get(t.url);
      if (existing) {
        const seen = new Set(), merged = [];
        for (const g of [...(existing.tags || []), ...desiredTags]) {
          if (!seen.has(g)) { seen.add(g); merged.push(g); }
        }
        const sameTags = JSON.stringify(merged) === JSON.stringify(existing.tags || []);
        if (!sameTags) { await updateTrack(existing.id, { tags: merged }); updated++; }
        else { unchanged++; }
      } else {
        await addTrack({
          id:       crypto.randomUUID(),
          name:     t.name || T("muDefaultTrack"),
          bus:      t.bus === "sfx" ? "sfx" : "bgm",
          loop:     t.loop !== false,
          volume:   1,
          duration: typeof t.duration === "number" ? t.duration : 0,
          bitrate:  typeof t.bitrate === "number" ? t.bitrate : 64,
          bytes:    typeof t.bytes === "number" ? t.bytes : 0,
          mime:     "audio/ogg; codecs=opus",
          url:      t.url,
          origName: t.name || t.url,
          tags:     desiredTags,
          ts:       Date.now(),
        });
        added++;
      }
    }
    const summary = [
      added && T("muNew", { n: added }),
      updated && T("muBackfilled", { n: updated }),
      unchanged && T("muReady", { n: unchanged }),
    ].filter(Boolean).join(" · ");
    toast(T("muDefaultsResult", { summary }), "ok");
    await refreshLibrary();
  } catch (e) {
    console.error("default manifest fetch failed", e);
    toast(T("muDefaultsFail", { err: e?.message || e }), "error");
  } finally {
    loadDefaultsBtn.disabled = false;
    loadDefaultsBtn.textContent = T("muDefaults");
  }
});

// ============================================================
// ====================== PAIRING (PeerJS) ====================
// ============================================================
const PEER_PREFIX = "obr-music-";
let _peer = null;
let _peerConn = null;
let _pairCode = "";
let _roomSync = null;
let _pairVersion = 0;
const _seenRoomSfx = new Map();
function roomConnected() { return !!_roomSync?.connected; }
function applyRoomState(snapshot, sentAt) {
  const receivedAt = performance.now(), now = Number.isFinite(sentAt) ? sentAt : Date.now();
  const voice = (track, id, position, startedAt, paused) => ({ track, id, paused, receivedAt,
    position: Math.max(0, position + (paused ? 0 : Math.max(0, now - startedAt) / 1000)) });
  const bgm = snapshot.bgm;
  bgmDeckTT.applyRoomVoice(bgm ? voice(bgm.track, bgm.playbackId, bgm.position, bgm.startedAt, bgm.paused) : null);
  const pads = TURNTABLES.filter(tt => tt.bus === "sfx");
  const desired = snapshot.sfx.filter(s => s.track.loop || s.expiresAt > now);
  for (const tt of pads) if (tt._sfxId && !desired.some(s => s.id === tt._sfxId)) tt.applyRoomVoice(null);
  for (const s of desired) {
    let tt = pads.find(p => p._sfxId === s.id);
    if (tt && !s.track.loop && tt.audio.ended) { tt.applyRoomVoice(null); continue; }
    if (!tt && (_seenRoomSfx.has(s.id) || (!s.track.loop && now - s.at > 3000))) continue;
    if (!tt) tt = pads.find(p => !p._roomVoice);
    if (!tt) continue;
    _seenRoomSfx.set(s.id, now);
    tt.applyRoomVoice(voice(s.track, s.id, 0, s.at, false));
  }
  for (const [id, at] of _seenRoomSfx) if (now - at > 60000 && !desired.some(s => s.id === id)) _seenRoomSfx.delete(id);
  state.volumes = { ...snapshot.bus }; syncBgmVolume(); syncSfxVolume();
  for (const tt of TURNTABLES) tt._applyVolume();
  syncLoopToggleUi(); renderLibrary(); renderFavorites(); updateDucking();
}

function genPairCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
function setPairUi(s) {
  pairBtn.classList.toggle("hidden", s !== "idle");
  pairCodeChip.classList.toggle("hidden", s !== "waiting");
  pairLiveChip.classList.toggle("hidden", s !== "live");
  if (s === "waiting") pairCodeValue.textContent = _pairCode;
  // Banner only makes sense while live (= the music is mirrored into
  // OBR). Hide it otherwise so a disconnected studio looks normal.
  if (localMuteBanner) localMuteBanner.classList.toggle("hidden", s !== "live");
}

// Reflect the current localMute state into the banner. Two phrasings:
//   muted   → "本地已静音 · 音乐正在枭熊内播放" + [在本地也播放]
//   audible → "本地也在播放 · 已同步到枭熊"     + [本地静音]
function updateLocalMuteUi() {
  if (!localMuteBanner) return;
  localMuteBanner.dataset.muted = localMute ? "1" : "0";
  if (lmbIcon) lmbIcon.textContent = localMute ? "🔇" : "🔊";
  if (lmbText) {
    lmbText.textContent = localMute
      ? T("muMutedBanner")
      : T("muAudibleBanner");
  }
  if (lmbToggle) {
    lmbToggle.textContent = localMute ? T("muPlayLocal") : T("muMuteLocal");
  }
}
if (lmbToggle) {
  lmbToggle.addEventListener("click", () => {
    setLocalMute(!localMute);
    if (!localMute) {
      const generation = _pairVersion;
      void getCtx().resume().then(() => {
        if (generation !== _pairVersion || localMute) return;
        for (const tt of TURNTABLES) if (tt._roomVoice) {
          const v = tt._roomVoice; tt.applyRoomVoice({ ...v, position: tt._roomPosition(), receivedAt: performance.now() });
        }
      }).catch(() => toast(T("muLocalSoundBlocked"), "warn"));
    }
  });
}
pairBtn.addEventListener("click", () => void startPairing());
pairCancelBtn.addEventListener("click", () => tearDownPair());
pairUnpairBtn.addEventListener("click", () => { if (confirm(T("muConfirmUnpair"))) tearDownPair(); });
pairCodeChip.addEventListener("click", async (e) => {
  if (e.target.closest(".pair-code-x")) return;
  try {
    await navigator.clipboard.writeText(_pairCode);
    toast(T("muPairCopied", { code: _pairCode }), "ok");
  } catch {
    toast(T("muPairCopyManual", { code: _pairCode }), "warn");
  }
});
async function startPairing() {
  if (_peer) return;
  const generation = ++_pairVersion;
  try {
    const m = await import("https://esm.sh/peerjs@1.5.4");
    if (generation !== _pairVersion) return;
    const Peer = m.default ?? m.Peer;
    _pairCode = genPairCode();
    setPairUi("waiting");
    _peer = new Peer(PEER_PREFIX + _pairCode);
    _peer.on("open", () => { toast(T("muPairReady", { code: _pairCode }), "ok"); });
    _peer.on("connection", (conn) => {
      if (generation !== _pairVersion) { conn.close(); return; }
      const old = _peerConn;
      _roomSync?.dispose(); _roomSync = null;
      _peerConn = conn;
      if (old && old !== conn) old.close();
      conn.on("open", () => {
        if (_peerConn !== conn || generation !== _pairVersion) return;
        // Auto-silence local output: the music now plays inside the
        // DM's枭熊 popover too, so leaving the studio audible would
        // double up. setLocalMute BEFORE setPairUi so the banner shows
        // the muted phrasing on first paint.
        setLocalMute(true);
        setPairUi("live");
        toast(T("muXiongConnected"), "ok");
        _roomSync = new StudioRoomSync(msg => { if (_peerConn === conn && conn.open) conn.send(msg); },
          applyRoomState, broadcastCurrentState, (error,adoptionFailed) => { if(adoptionFailed)tearDownPair();toast(T(error === "permission" ? "muRoomPermission" : "muRoomCommandFailed"), "warn"); });
      });
      conn.on("data", message => { if (_peerConn === conn && generation === _pairVersion) _roomSync?.receive(message); });
      conn.on("close", () => {
        if (_peerConn !== conn || generation !== _pairVersion) return;
        _roomSync?.dispose(); _roomSync = null;
        _peerConn = null;
        // Owlbear background continues on transport loss. Do not unexpectedly
        // unmute this website and create a second audible playback.
        setPairUi("waiting");
        toast(T("muXiongDisconnected"), "warn");
      });
      conn.on("error", (e) => { if (_peerConn === conn && generation === _pairVersion) toast(T("muChannelError", { err: e?.message || e }), "error"); });
    });
    _peer.on("error", (e) => {
      if (generation !== _pairVersion) return;
      toast(T("muPairFail", { err: e?.type || e?.message || e }), "error");
      tearDownPair();
    });
  } catch (e) {
    if (generation !== _pairVersion) return;
    toast(T("muPeerLoadFail", { err: e?.message || e }), "error");
    tearDownPair();
  }
}
function tearDownPair() {
  _pairVersion++; _roomSync?.dispose(); _roomSync = null;
  if (_peerConn) try { _peerConn.close(); } catch {}
  if (_peer) try { _peer.destroy(); } catch {}
  _peer = null; _peerConn = null; _pairCode = "";
  // Manual unpair / cancel → studio is audible again.
  setLocalMute(false);
  setPairUi("idle");
}
function sendToObr(msg) {
  if (_peerConn && _peerConn.open) {
    if (roomConnected() && ["bgm-play", "bgm-pause", "bgm-seek", "bgm-loop", "bgm-stop"].includes(msg.type))
      msg = { ...msg, expectedPlaybackId: bgmDeckTT._roomVoice?.id || "" };
    try { if (_roomSync) _roomSync.command(msg); else _peerConn.send(msg); } catch (e) { console.warn("[pair] send failed", e); }
  }
}
function broadcastCurrentState(modern = false) {
  if (modern) {
    const bgm = turntableFor("bgm");
    sendToObr({type:"studio-load",snapshot:{
      bgm:bgm.track?{url:bgm.track.url||"",name:bgm.track.name,loop:!!bgm.track.loop,position:bgm.audio.currentTime||0,paused:bgm.audio.paused}:null,
      sfx:TURNTABLES.filter(tt=>tt.bus==="sfx"&&tt.track&&!tt.audio.paused).map(tt=>({url:tt.track.url||"",name:tt.track.name,loop:!!tt.track.loop,bus:"sfx"})),
      bus:{bgm:state.volumes.bgm,sfx:state.volumes.sfx}
    }});
    return;
  }
  sendToObr({ type: "volume", bus: "bgm", vol: state.volumes.bgm });
  sendToObr({ type: "volume", bus: "sfx", vol: state.volumes.sfx });
  const bgm = turntableFor("bgm");
  if (bgm.track && bgm.track.url) {
    sendToObr({
      type: "bgm-load",
      url:  bgm.track.url, name: bgm.track.name,
      loop: !!bgm.track.loop,
      position: bgm.audio.currentTime || 0,
      paused: bgm.audio.paused,
    });
    if (bgm.audio.paused && !roomConnected()) sendToObr({ type: "bgm-pause", position: bgm.audio.currentTime || 0 });
  }
  for (const tt of TURNTABLES) {
    if (tt.bus !== "sfx" || !tt.track || !tt.track.url || tt.audio.paused) continue;
    sendToObr({ type: "sfx-add", id: crypto.randomUUID(), url: tt.track.url, name: tt.track.name, loop: !!tt.track.loop });
  }
}

window.addEventListener("beforeunload", (e) => {
  if (_peerConn && _peerConn.open) {
    e.preventDefault();
    e.returnValue = T("muLeaveConfirm");
    return e.returnValue;
  }
});

// ============ Boot ============
refreshLibrary().catch((e) => {
  console.error("library load failed", e);
  toast(T("muLibLoadFail", { err: e?.message || e }), "error");
});
