import { emptySession, livePosition, unit, type MusicSession } from "./model";
export interface LocalVolume { bgm: number; sfx: number; mute: boolean }
export type SoundStatus = "locked" | "ready" | "blocked" | "error";
interface Voice { audio: HTMLAudioElement; gain?: GainNode; source?: MediaElementAudioSourceNode; bus: "bgm" | "sfx"; key: string; timer?: ReturnType<typeof setTimeout>; retiring?: boolean; direct?: boolean }

/** Lives exclusively in the suite background document. A control iframe never
 * owns audio nodes, PeerJS, or a playback cleanup handler. */
export class MusicAudio {
  private ctx: AudioContext | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private voices = new Set<Voice>();
  private bgm: Voice | null = null;
  private playbackId = "";
  private sfx = new Map<string, Voice>();
  private seen = new Map<string, number>();
  private state = emptySession();
  private disposed = false;
  private requested = false;
  private unlockVersion = 0;
  status: SoundStatus = "locked";
  volume: LocalVolume = { bgm: .8, sfx: 1, mute: false };
  /** `sfxEnded` reports a one-shot that actually played to its end on this
   *  device, so the room can drop it instead of carrying a dead entry until
   *  some unrelated command happens to expire it. */
  constructor(private changed: () => void, private ended: (playbackId: string) => void, private sfxEnded: (id: string) => void) {}
  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext(); this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3; this.limiter.ratio.value = 20; this.limiter.attack.value = .001; this.limiter.release.value = .05; this.limiter.knee.value = 0;
      this.limiter.connect(this.ctx.destination);
    }
    return this.ctx;
  }
  /** Call from the user's sound-enable command. Promise rejection/state is the
   * authority; a click in another iframe is not assumed to grant permission. */
  unlock(): void {
    if (this.disposed) return;
    this.requested = true; const version = ++this.unlockVersion;
    try {
      const ctx = this.context();
      const timeout = setTimeout(() => { if (!this.disposed && version === this.unlockVersion && ctx.state !== "running") { this.status = "blocked"; this.changed(); } }, 1200);
      void ctx.resume().then(() => {
        clearTimeout(timeout); if (this.disposed || version !== this.unlockVersion) return;
        if (ctx.state !== "running") { this.status = "blocked"; this.changed(); return; }
        this.status = "ready"; this.apply(this.state); this.changed();
      }).catch(() => { clearTimeout(timeout); if (!this.disposed && version === this.unlockVersion) { this.status = "blocked"; this.changed(); } });
    } catch { this.status = "error"; this.changed(); }
  }
  /** Create a voice and mount its element in CORS mode. `key` identifies the
   *  voice to its own ended handler — the playback id for BGM, the SFX id
   *  otherwise — because a re-mount outlives the `apply` call that made it. */
  private voice(bus: "bgm" | "sfx", url: string, loop: boolean, key: string): Voice {
    const voice = { bus, key } as Voice;
    this.mount(voice, url, loop, "anonymous");
    this.voices.add(voice);
    return voice;
  }
  /** Create the media element and attach its playback listeners. Re-runnable,
   *  so a voice whose CORS request failed can be re-mounted without CORS. An
   *  element Web Audio has already claimed outputs silence for cross-origin
   *  media that is not CORS-same-origin, so the failing element is unusable. */
  private mount(voice: Voice, url: string, loop: boolean, crossOrigin: string | null): void {
    const previous = voice.audio as HTMLAudioElement | undefined;
    if (previous) {
      voice.source?.disconnect(); voice.gain?.disconnect();
      try { previous.pause(); previous.removeAttribute("src"); previous.load(); } catch {}
    }
    const audio = new Audio(url);
    audio.crossOrigin = crossOrigin; audio.preload = "metadata"; audio.loop = loop;
    voice.audio = audio; voice.gain = undefined; voice.source = undefined;
    audio.addEventListener("error", () => this.mediaFailed(voice));
    if (voice.bus === "bgm") {
      audio.addEventListener("loadedmetadata", () => { if (this.bgm === voice) { this.seek(); if (!this.state.bgm?.paused) this.play(voice); this.changed(); } });
      audio.addEventListener("ended", () => { if (this.bgm === voice && !audio.loop) this.ended(voice.key); });
      audio.addEventListener("timeupdate", this.changed);
    } else {
      audio.addEventListener("ended", () => {
        if (audio.loop) return;
        this.sfx.delete(voice.key); this.stop(voice); this.volumeChanged(); this.changed(); this.sfxEnded(voice.key);
      });
    }
  }
  /** A host that sends no `Access-Control-Allow-Origin` header cannot be loaded
   *  in CORS mode at all — the load itself fails, rather than merely tainting
   *  the resource — yet a plain browser navigation plays and downloads it fine.
   *  Retry once without CORS and keep volume on the element; such media can
   *  never go through `createMediaElementSource`, which yields silence. */
  private mediaFailed(voice: Voice): void {
    if (this.disposed || !this.voices.has(voice)) return;
    if (voice.direct) { this.status = "error"; this.changed(); return; }
    const url = voice.audio.src, loop = voice.audio.loop, position = voice.audio.currentTime;
    voice.direct = true;
    this.mount(voice, url, loop, null);
    if (position > 0) { try { voice.audio.currentTime = position; } catch {} }
    voice.audio.load();
    this.apply(this.state);
  }
  private gain(voice: Voice): void {
    if (voice.retiring) return;
    const activeSfx = [...this.sfx.values()].some(v => !v.audio.paused);
    const target = unit(this.volume[voice.bus]) * unit(this.state.bus[voice.bus]) * (this.volume.mute ? 0 : 1) * (voice.bus === "bgm" && activeSfx ? .4 : 1);
    if (voice.gain && this.ctx) {
      const now = this.ctx.currentTime; voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setValueAtTime(voice.gain.gain.value, now); voice.gain.gain.linearRampToValueAtTime(target, now + .12);
    } else voice.audio.volume = target;
  }
  private play(voice: Voice): void {
    if (this.disposed || voice.retiring || !this.requested || !voice.audio.paused) return;
    if (!voice.direct && this.ctx?.state !== "running") return;
    if (!voice.direct && !voice.gain) {
      voice.source = this.ctx!.createMediaElementSource(voice.audio); voice.gain = this.ctx!.createGain(); voice.gain.gain.value = 0;
      voice.source.connect(voice.gain).connect(this.limiter!); voice.audio.volume = 1;
    }
    this.gain(voice);
    void voice.audio.play().then(() => { if (this.voices.has(voice)) { this.status = "ready"; this.volumeChanged(); this.changed(); } else voice.audio.pause(); })
      .catch(error => { if (this.voices.has(voice) && !this.disposed) { this.status = error?.name === "NotAllowedError" ? "blocked" : "error"; this.changed(); } });
  }
  private stop(voice: Voice, fade = false): void {
    voice.retiring = true;
    if (voice.timer) clearTimeout(voice.timer);
    const finish = () => { voice.audio.pause(); voice.audio.removeAttribute("src"); voice.audio.load(); voice.source?.disconnect(); voice.gain?.disconnect(); this.voices.delete(voice); };
    if (fade && voice.gain && this.ctx?.state === "running") { const now = this.ctx.currentTime; voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setValueAtTime(voice.gain.gain.value, now); voice.gain.gain.linearRampToValueAtTime(0, now + .28); voice.timer = setTimeout(finish, 300); }
    else finish();
  }
  private seek(): void {
    if (!this.bgm || !this.state.bgm) return;
    let position = livePosition(this.state.bgm);
    const duration = this.bgm.audio.duration;
    if (Number.isFinite(duration) && duration > 0) position = this.state.bgm.track.loop ? position % duration : Math.min(position, duration);
    if (Math.abs(this.bgm.audio.currentTime - position) > .75) { try { this.bgm.audio.currentTime = position; } catch {} }
  }
  apply(state: MusicSession): void {
    if (this.disposed) return;
    this.state = state;
    const id = state.bgm?.playbackId || "";
    if (id !== this.playbackId) {
      if (this.bgm) this.stop(this.bgm, true);
      this.bgm = null; this.playbackId = id;
      if (state.bgm) this.bgm = this.voice("bgm", state.bgm.track.url, state.bgm.track.loop, id);
    }
    if (this.bgm && state.bgm) { this.bgm.audio.loop = state.bgm.track.loop; this.seek(); if (state.bgm.paused) this.bgm.audio.pause(); else this.play(this.bgm); }
    const desired = new Set(state.sfx.map(sfx => sfx.id));
    for (const [id, voice] of this.sfx) if (!desired.has(id)) { this.sfx.delete(id); this.stop(voice, true); }
    const now = Date.now();
    for (const sfx of state.sfx) {
      if (this.sfx.has(sfx.id) || this.seen.has(sfx.id)) continue;
      if (!sfx.track.loop && (now - sfx.at > 3000 || sfx.expiresAt <= now)) { this.seen.set(sfx.id, now); continue; }
      this.sfx.set(sfx.id, this.voice("sfx", sfx.track.url, sfx.track.loop, sfx.id)); this.seen.set(sfx.id, now);
    }
    for (const [id, seenAt] of this.seen) if (now - seenAt > 60000 && !desired.has(id)) this.seen.delete(id);
    for (const [id, voice] of this.sfx) {
      const stateSfx = state.sfx.find(sfx => sfx.id === id)!;
      if (!stateSfx.track.loop && voice.audio.paused && now - stateSfx.at > 3000) { this.sfx.delete(id); this.stop(voice); continue; }
      this.play(voice);
    }
    this.volumeChanged();
  }
  volumeChanged(): void { for (const voice of this.voices) this.gain(voice); }
  progress(): { position: number; duration: number } { return { position: this.bgm?.audio.currentTime || 0, duration: Number.isFinite(this.bgm?.audio.duration) ? this.bgm!.audio.duration : this.state.bgm?.track.duration || 0 }; }
  dispose(): void { this.disposed = true; this.unlockVersion++; for (const voice of [...this.voices]) this.stop(voice); this.sfx.clear(); this.bgm = null; this.ctx?.close().catch(() => {}); }
}
