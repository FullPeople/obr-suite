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
};

const LS_VOL   = "obr-music-board:volumes";
const LS_FAVS  = "obr-music-board:favorites";
const LS_FADE  = "obr-music-board:fade-enabled";
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
function saveVolumes() { try { localStorage.setItem(LS_VOL, JSON.stringify(state.volumes)); } catch {} }
function saveFavs()    { try { localStorage.setItem(LS_FAVS, JSON.stringify(state.favorites)); } catch {} }
function saveFade()    { try { localStorage.setItem(LS_FADE, state.fadeEnabled ? "1" : "0"); } catch {} }

// ============ WebAudio master ============
let audioCtx = null;
let MASTER_LIMITER = null;
function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    MASTER_LIMITER = audioCtx.createDynamicsCompressor();
    MASTER_LIMITER.threshold.value = -3;
    MASTER_LIMITER.ratio.value = 20;
    MASTER_LIMITER.attack.value = 0.001;
    MASTER_LIMITER.release.value = 0.05;
    MASTER_LIMITER.knee.value = 0;
    MASTER_LIMITER.connect(audioCtx.destination);
  }
  return audioCtx;
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
        this.audio.currentTime = ((e.clientX - r.left) / r.width) * this.audio.duration;
      });
    }
    this.audio.addEventListener("ended", () => {
      if (!this.audio.loop) {
        this._setSpinning(false);
        this._syncPlayUI();
        this.track = null;
        state.turntableTrack[this.slot] = null;
        if (this.nameEl) this.nameEl.textContent = this.bus === "bgm" ? "-- 空闲 --" : "空";
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
    if (this.audio.duration && !this.audio.paused) {
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
    if (this.track && !this.audio.paused && this.fadeGain) {
      await this._ramp(0, FADE_OUT_MS);
    }
    if (this.audio.src.startsWith("blob:")) URL.revokeObjectURL(this.audio.src);
    this.track = track;
    state.turntableTrack[this.slot] = track.id;
    if (this.nameEl) this.nameEl.textContent = track.name || "未命名";
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
        this._ensureAudioGraph();
        await this.audio.play();
        this._applyVolume();
        await this._ramp(1, FADE_IN_MS);
        this._setSpinning(true);
        this._syncPlayUI();
        updateDucking();
      } catch (e) {
        toast("播放失败：" + (e?.message || e), "error");
      }
    }
    renderLibrary(); renderFavorites();

    if (this.bus === "bgm") {
      sendToObr({
        type: "bgm-load",
        url: track.url || "",
        name: track.name, loop: !!track.loop, position: 0,
      });
      if (!track.url) toast("本地压缩文件无法分享给其他玩家。请使用在线直链。", "warn");
    } else {
      sendToObr({
        type: "sfx-add", id: crypto.randomUUID(),
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
    const wasPaused = this.audio.paused;
    if (wasPaused) {
      try {
        await getCtx().resume();
        this._ensureAudioGraph();
        await this.audio.play();
        this._applyVolume();
        await this._ramp(1, FADE_IN_MS);
        this._setSpinning(true);
        this._syncPlayUI();
        updateDucking();
      } catch (e) {
        toast("播放失败：" + (e?.message || e), "error");
      }
    } else {
      await this._ramp(0, FADE_OUT_MS);
      this.audio.pause();
      this._setSpinning(false);
      this._syncPlayUI();
      updateDucking();
    }
    if (this.bus === "bgm") {
      sendToObr({ type: wasPaused ? "bgm-play" : "bgm-pause", position: this.audio.currentTime });
    }
  }

  async stop() {
    const wasBgm = this.bus === "bgm" && this.track;
    if (this.fadeGain && !this.audio.paused) {
      await this._ramp(0, FADE_OUT_MS);
    }
    this.audio.pause(); this.audio.currentTime = 0;
    if (this.audio.src.startsWith("blob:")) URL.revokeObjectURL(this.audio.src);
    this.audio.removeAttribute("src"); this.audio.load();
    this.track = null;
    state.turntableTrack[this.slot] = null;
    if (this.nameEl) this.nameEl.textContent = this.bus === "bgm" ? "-- 空闲 --" : "空";
    this._setSpinning(false); this._syncPlayUI();
    if (this.curEl)  this.curEl.textContent = "00:00";
    if (this.durEl)  this.durEl.textContent = "00:00";
    if (this.fillEl) this.fillEl.style.width = "0%";
    if (this.bus === "bgm") { this._updateHistoryButtons(); syncLoopToggleUi(); }
    renderLibrary(); renderFavorites();
    updateDucking();
    if (wasBgm) sendToObr({ type: "bgm-stop" });
  }

  _setSpinning(s) {
    this.el.classList.toggle("playing", s);
    if (this.spinTarget) this.spinTarget.classList.toggle("spinning", s);
  }
  _syncPlayUI() {
    if (!this.playBtn) return;
    const playing = this.track && !this.audio.paused;
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
        const t = state.lib.find((x) => x.id === id);
        histPrevName.textContent = t ? trunc(t.name) : "上一首";
      } else { histPrevName.textContent = "无"; }
    }
    if (histNextName) {
      if (hasNext) {
        const id = state.bgmHistory[state.bgmHistoryIdx + 1].id;
        const t = state.lib.find((x) => x.id === id);
        histNextName.textContent = t ? trunc(t.name) : "下一首";
      } else { histNextName.textContent = "无"; }
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
  if (!tt.track) { toast("BGM 唱片台空闲", "warn"); return; }
  const newLoop = !tt.audio.loop;
  tt.audio.loop = newLoop;
  tt.track.loop = newLoop;
  try { await updateTrack(tt.track.id, { loop: newLoop }); } catch {}
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
  toast(`淡入淡出 ${state.fadeEnabled ? "开" : "关"}`, "ok");
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
bindVerticalVol(bgmVvBar, bgmVvFill, bgmVvReadout, "bgm");
bindVerticalVol(sfxVvBar, sfxVvFill, sfxVvReadout, "sfx");

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
    toast(`库自动去重：移除 ${dups.deletes.length} 个同 URL 重复条目`, "ok");
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
  renderChipFilter();
  const arr = visibleTracks();
  libGrid.innerHTML = "";
  if (arr.length === 0) {
    const e = document.createElement("div");
    e.className = "lib-empty";
    if (state.lib.length === 0) {
      e.innerHTML = `<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div class="empty-title">曲库是空的</div>
        <div class="empty-hint">把音频文件拖到这里 → 自动打开编辑器<br>或点右上「+ 文件 / + 外链」<br>或点「默认曲库」拉服务器自带的 154 首</div>`;
    } else {
      e.innerHTML = `<div class="empty-title">没有匹配的曲目</div>`;
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
  chipFilterRow.appendChild(mk("全部", "chip--all",
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
    chipFilterRow.appendChild(mk(name, "chip--tag",
      state.filter.kind === "tag" && state.filter.value === name,
      () => { state.filter = { kind: "tag", value: name }; renderLibrary(); },
      n));
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
    warn.title = "本地压缩文件，无法分享给其他玩家。请使用在线直链。";
    corner.appendChild(warn);
  }
  const del = document.createElement("button");
  del.className = "card-corner-btn danger";
  del.textContent = "×";
  del.title = "删除";
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`删除「${t.name}」？`)) return;
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
    tags.appendChild(c);
  }
  const add = document.createElement("span");
  add.className = "card-tag add-tag"; add.textContent = "+";
  add.title = "添加标签";
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
    e.textContent = "拖任意曲目到这里收藏";
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
    item.title = isPlaying ? "正在播放，再点一次停止" : `点击或拖到唱片台播放：${t.name}`;
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
    x.title = "从常用移除";
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
  if (!confirm(`清空常用列表（${state.favorites.length} 首）？`)) return;
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
  if (state.favorites.includes(id)) { toast("已在常用", "warn"); return; }
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
  if (files.length === 0) { toast("没识别到音频文件", "warn"); return; }
  if (files.length > 1) toast(`检测到 ${files.length} 个文件，先编辑第一个`, "warn");
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
  trackMeta.textContent = "解码中…";
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
        `${buf.numberOfChannels === 2 ? "立体" : (buf.numberOfChannels + "ch")} · ` +
        fmtBytes(file.size);
      originalSize.textContent = fmtBytes(file.size);
      renderWaveform(); syncTrimUI(); updateSizeEstimate();
    } catch (err) {
      console.error("decode failed", err);
      trackMeta.textContent = "";
      toast("解码失败 —— 浏览器可能不支持该编码", "error");
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
  previewBtn.textContent = "停止预览";
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
  previewBtn.textContent = "预览截取段";
  playCursor.classList.remove("playing");
}

encodeBtn.addEventListener("click", async () => {
  if (!state.editor.file || !state.editor.audioBuffer) return;
  if (state.editor.trim.end - state.editor.trim.start < 0.1) { toast("截取段过短", "warn"); return; }
  stopPreview();
  encodeBtn.disabled = true;
  encodeProg.classList.remove("hidden");
  encodeFill.style.width = "0%";
  encodeMsg.textContent = "准备中…";
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
      name: trackName.value.trim() || "未命名",
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
    toast(`「${track.name}」已加入库（${fmtBytes(blob.size)}）`, "ok");
    closeEditor();
    await refreshLibrary();
  } catch (err) {
    console.error("encode failed", err);
    toast("编码失败：" + (err?.message || err), "error");
  } finally {
    encodeBtn.disabled = false;
    encodeProg.classList.add("hidden");
  }
});

// ============ URL modal ============
addUrlBtn.addEventListener("click", () => {
  urlInput.value = ""; urlName.value = "";
  urlAddBtn.disabled = true;
  urlModal.classList.remove("hidden");
  setTimeout(() => urlInput.focus(), 30);
});
urlModal.addEventListener("click", (e) => { if (e.target.matches("[data-close]")) urlModal.classList.add("hidden"); });
urlInput.addEventListener("input", () => { urlAddBtn.disabled = !/^https?:\/\//i.test(urlInput.value.trim()); });
urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !urlAddBtn.disabled) urlAddBtn.click(); });
urlAddBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!/^https?:\/\//i.test(url)) return;
  let name = urlName.value.trim();
  if (!name) {
    try {
      const u = new URL(url);
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs.length) name = decodeURIComponent(segs[segs.length - 1]).replace(/\.[a-z0-9]{1,5}$/i, "");
    } catch {}
    if (!name) name = "外链音乐";
  }
  await addTrack({
    id: crypto.randomUUID(),
    name, bus: state.urlBus, loop: urlLoopChk.checked, volume: 1,
    duration: 0, bitrate: 0, bytes: 0, mime: "audio/*",
    url, origName: url, tags: [], ts: Date.now(),
  });
  toast(`已添加外链「${name}」`, "ok");
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
loadDefaultsBtn.addEventListener("click", async () => {
  loadDefaultsBtn.disabled = true;
  loadDefaultsBtn.textContent = "拉取中…";
  try {
    const r = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    if (tracks.length === 0) { toast("默认曲库还是空的", "warn"); return; }
    const byUrl = new Map();
    for (const t of state.lib) if (t.url) byUrl.set(t.url, t);
    let added = 0, updated = 0, unchanged = 0;
    for (const t of tracks) {
      if (!t.url) continue;
      const incomingTags = Array.isArray(t.tags) ? t.tags : [];
      const desiredTags = incomingTags.length > 0 ? [...incomingTags, "默认"] : ["默认"];
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
          name:     t.name || "默认曲目",
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
      added && `新增 ${added}`,
      updated && `回填 ${updated}`,
      unchanged && `${unchanged} 首已就绪`,
    ].filter(Boolean).join(" · ");
    toast(`默认曲库：${summary}`, "ok");
    await refreshLibrary();
  } catch (e) {
    console.error("default manifest fetch failed", e);
    toast(`无法加载默认曲库：${e?.message || e}`, "error");
  } finally {
    loadDefaultsBtn.disabled = false;
    loadDefaultsBtn.textContent = "默认曲库";
  }
});

// ============================================================
// ====================== PAIRING (PeerJS) ====================
// ============================================================
const PEER_PREFIX = "obr-music-";
let _peer = null;
let _peerConn = null;
let _pairCode = "";

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
}
pairBtn.addEventListener("click", () => void startPairing());
pairCancelBtn.addEventListener("click", () => tearDownPair());
pairUnpairBtn.addEventListener("click", () => { if (confirm("确定断开与枭熊的连接？")) tearDownPair(); });
pairCodeChip.addEventListener("click", async (e) => {
  if (e.target.closest(".pair-code-x")) return;
  try {
    await navigator.clipboard.writeText(_pairCode);
    toast(`配对码 ${_pairCode} 已复制`, "ok");
  } catch {
    toast(`配对码：${_pairCode}（手动复制）`, "warn");
  }
});
async function startPairing() {
  if (_peer) return;
  try {
    const m = await import("https://esm.sh/peerjs@1.5.4");
    const Peer = m.default ?? m.Peer;
    _pairCode = genPairCode();
    setPairUi("waiting");
    _peer = new Peer(PEER_PREFIX + _pairCode);
    _peer.on("open", () => { toast(`配对码 ${_pairCode} 已就绪，等枭熊插件连接…`, "ok"); });
    _peer.on("connection", (conn) => {
      _peerConn = conn;
      conn.on("open", () => {
        setPairUi("live");
        toast("枭熊已连接", "ok");
        broadcastCurrentState();
      });
      conn.on("close", () => {
        _peerConn = null;
        setPairUi("waiting");
        toast("枭熊断开，回到等待", "warn");
      });
      conn.on("error", (e) => toast("通道错误：" + (e?.message || e), "error"));
    });
    _peer.on("error", (e) => {
      toast("配对失败：" + (e?.type || e?.message || e), "error");
      tearDownPair();
    });
  } catch (e) {
    toast("加载 PeerJS 失败：" + (e?.message || e), "error");
    tearDownPair();
  }
}
function tearDownPair() {
  if (_peerConn) try { _peerConn.close(); } catch {}
  if (_peer) try { _peer.destroy(); } catch {}
  _peer = null; _peerConn = null; _pairCode = "";
  setPairUi("idle");
}
function sendToObr(msg) {
  if (_peerConn && _peerConn.open) {
    try { _peerConn.send(msg); } catch (e) { console.warn("[pair] send failed", e); }
  }
}
function broadcastCurrentState() {
  sendToObr({ type: "volume", bus: "bgm", vol: state.volumes.bgm });
  sendToObr({ type: "volume", bus: "sfx", vol: state.volumes.sfx });
  const bgm = turntableFor("bgm");
  if (bgm.track && bgm.track.url) {
    sendToObr({
      type: "bgm-load",
      url:  bgm.track.url, name: bgm.track.name,
      loop: !!bgm.track.loop,
      position: bgm.audio.currentTime || 0,
    });
    if (bgm.audio.paused) sendToObr({ type: "bgm-pause", position: bgm.audio.currentTime || 0 });
  }
  for (const tt of TURNTABLES) {
    if (tt.bus !== "sfx" || !tt.track || !tt.track.url || tt.audio.paused) continue;
    sendToObr({ type: "sfx-add", id: crypto.randomUUID(), url: tt.track.url, name: tt.track.name, loop: !!tt.track.loop });
  }
}

window.addEventListener("beforeunload", (e) => {
  if (_peerConn && _peerConn.open) {
    e.preventDefault();
    e.returnValue = "已配对的枭熊插件会失去同步。确定离开？";
    return e.returnValue;
  }
});

// ============ Boot ============
refreshLibrary().catch((e) => {
  console.error("library load failed", e);
  toast("库加载失败：" + (e?.message || e), "error");
});
