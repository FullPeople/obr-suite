// Web-Audio synthesized sound effects.
//
// We don't ship audio assets — every sound here is generated on the
// fly with oscillators + filtered noise. Cheap to render (each sound
// is ~50-700ms), zero asset weight, no fetch round-trip.
//
// IMPORTANT: this module is intentionally a leaf — no OBR SDK
// imports. Earlier we tried to broadcast from inside this file, but
// vite/rollup ended up putting a CommonJS-helper in `sfx.ts` and
// importing it back from the shared `lib` chunk, creating an ESM
// circular dep that triggered "e is not a function" at load time.
// Broadcast/subscribe wiring lives in `./sfx-broadcast.ts` instead.

// Per-module SFX gates. Each module can be muted independently.
// Old single-key "obr-suite/sfx-on" still acts as a master fallback
// when the per-module key isn't set, so existing users with sfx
// disabled keep their preference unless they touch the new toggles.
const LS_KEY_DICE = "obr-suite/sfx-dice";          // dice rolling pipeline
const LS_KEY_INITIATIVE = "obr-suite/sfx-initiative"; // turn chime, etc.
const LS_KEY_LEGACY = "obr-suite/sfx-on";

// Default the per-module gates to whatever the legacy master is set
// to (default ON if neither is set). The "channel" arg lets call
// sites tag their playback so each module's toggle controls its own
// sounds without leaking into the other.
type Channel = "dice" | "initiative";
function isOnFor(channel: Channel): boolean {
  try {
    const moduleKey = channel === "dice" ? LS_KEY_DICE : LS_KEY_INITIATIVE;
    const v = localStorage.getItem(moduleKey);
    if (v === "0") return false;
    if (v === "1") return true;
    // No per-module pref yet → fall back to legacy master.
    return localStorage.getItem(LS_KEY_LEGACY) !== "0";
  } catch {
    return true;
  }
}

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  } catch { ctx = null; }
  return ctx;
}

// Backwards-compatible wrapper. Every call site in this file plays a
// dice-module sound, so we route them all through the dice channel.
// Initiative-side sounds live in sfx-broadcast.ts and use isOnFor
// directly with channel="initiative".
function isOn(): boolean {
  return isOnFor("dice");
}

// Resume the ctx if suspended (browsers throttle until first user
// gesture). Call defensively before each play; it's a no-op when
// already running.
function resume(): void {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

// --- Audio sample playback (mp3 / wav) ---
//
// Two real samples ship with the suite:
//   - dice.mp3    (one tumble per die, dispatched per-die from the
//                  effect page so 5 dice → 5 independent overlapping
//                  plays)
//   - cartoon.mp3 (the climax punch on the final-total scale-pop)
// Other sfx stay synthesized.
//
// Credit: Sound Effect by freesound_community from Pixabay
//         (uploader: ksjsbwuil)

const DICE_URL = "https://obr.dnd.center/suite/dice.mp3";
const CARTOON_URL = "https://obr.dnd.center/suite/cartoon.mp3";

const sampleBuffers = new Map<string, AudioBuffer>();
const sampleLoading = new Map<string, Promise<AudioBuffer | null>>();

async function loadSample(url: string): Promise<AudioBuffer | null> {
  const cached = sampleBuffers.get(url);
  if (cached) return cached;
  const pending = sampleLoading.get(url);
  if (pending) return pending;
  const p = (async () => {
    const c = getCtx();
    if (!c) return null;
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      const buf = await c.decodeAudioData(data);
      sampleBuffers.set(url, buf);
      return buf;
    } catch {
      return null;
    } finally {
      sampleLoading.delete(url);
    }
  })();
  sampleLoading.set(url, p);
  return p;
}

function playSample(url: string, gain: number = 0.55): void {
  if (!isOn()) return;
  resume();
  const c = getCtx();
  if (!c) return;
  // Prime the buffer load. Once cached, subsequent plays are sync.
  loadSample(url).then((buf) => {
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(c.destination);
    try { src.start(); } catch {}
  }).catch(() => {});
}

// --- Generic envelope helpers ---

interface ToneOpts {
  freq: number;       // Hz
  endFreq?: number;   // optional pitch slide target
  type?: OscillatorType;
  duration: number;   // seconds
  gain?: number;      // peak gain (0..1)
  attack?: number;    // seconds
  release?: number;   // seconds
  delay?: number;     // seconds from now
  filter?: { type: BiquadFilterType; freq: number; Q?: number };
}

function tone(opts: ToneOpts): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const dur = opts.duration;
  const peak = opts.gain ?? 0.18;
  const att = Math.max(0.005, opts.attack ?? 0.01);
  const rel = Math.max(0.02, opts.release ?? 0.08);

  const osc = c.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (typeof opts.endFreq === "number") {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, opts.endFreq),
      t0 + dur,
    );
  }

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + att);
  g.gain.setValueAtTime(peak, t0 + Math.max(att, dur - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  let chain: AudioNode = osc;
  if (opts.filter) {
    const f = c.createBiquadFilter();
    f.type = opts.filter.type;
    f.frequency.setValueAtTime(opts.filter.freq, t0);
    f.Q.setValueAtTime(opts.filter.Q ?? 1, t0);
    chain.connect(f);
    chain = f;
  }
  chain.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Filtered noise for "whoosh" / "boom" textures. Uses an
// AudioBufferSource with white noise + a moving filter cutoff.
function noiseBurst(opts: {
  duration: number;
  startFreq: number;
  endFreq: number;
  Q?: number;
  gain?: number;
  attack?: number;
  release?: number;
  delay?: number;
}): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const dur = opts.duration;

  // 0.6s of white noise, looped if longer.
  const len = Math.max(1, Math.floor(c.sampleRate * Math.min(0.6, dur)));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.7;

  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = dur > 0.6;

  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.setValueAtTime(opts.Q ?? 6, t0);
  f.frequency.setValueAtTime(opts.startFreq, t0);
  f.frequency.exponentialRampToValueAtTime(
    Math.max(20, opts.endFreq),
    t0 + dur,
  );

  const peak = opts.gain ?? 0.22;
  const att = Math.max(0.005, opts.attack ?? 0.02);
  const rel = Math.max(0.04, opts.release ?? 0.1);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + att);
  g.gain.setValueAtTime(peak, t0 + Math.max(att, dur - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// ──────────────── Local play implementations ────────────────
// These are EXPORTED so sfx-broadcast.ts can dispatch them by name
// when a BC_SFX broadcast arrives.

// Per-die roll tumble. effect-page calls this ONCE PER DIE, slightly
// staggered, so 5 dice → 5 overlapping dice.mp3 plays (sounds like a
// pile of dice tumbling). Source: dice.mp3 (Pixabay, ksjsbwuil).
export function playParabola(): void {
  playSample(DICE_URL, 0.45);
}
// Climax punch on the final-total scale-pop. Source: cartoon.mp3
// (Pixabay, ksjsbwuil).
export function playScalePunch(): void {
  playSample(CARTOON_URL, 0.55);
}
export function playNumFly(): void {
  if (!isOn()) return; resume();
  tone({ freq: 540, endFreq: 1080, type: "sine", duration: 0.16, gain: 0.10, attack: 0.005, release: 0.10 });
}
export function playNumLand(): void {
  if (!isOn()) return; resume();
  tone({ freq: 880, type: "triangle", duration: 0.07, gain: 0.10, attack: 0.005, release: 0.05 });
}
export function playFlashCrit(): void {
  if (!isOn()) return; resume();
  tone({ freq: 660, endFreq: 1320, type: "sawtooth", duration: 0.30, gain: 0.18, attack: 0.005, release: 0.18, filter: { type: "lowpass", freq: 4000, Q: 0.7 } });
  tone({ freq: 880, endFreq: 1760, type: "triangle", duration: 0.34, gain: 0.13, attack: 0.01, release: 0.20, delay: 0.04 });
}
export function playFlashFail(): void {
  if (!isOn()) return; resume();
  tone({ freq: 220, endFreq: 90, type: "sawtooth", duration: 0.40, gain: 0.20, attack: 0.005, release: 0.25, filter: { type: "lowpass", freq: 1200, Q: 1.0 } });
}
export function playSpin(): void {
  if (!isOn()) return; resume();
  noiseBurst({ duration: 0.55, startFreq: 400, endFreq: 1800, Q: 4, gain: 0.12, attack: 0.03, release: 0.20 });
  tone({ freq: 1100, type: "triangle", duration: 0.10, gain: 0.16, attack: 0.005, release: 0.08, delay: 0.50 });
}
export function playBurst(): void {
  if (!isOn()) return; resume();
  noiseBurst({ duration: 0.42, startFreq: 1400, endFreq: 80, Q: 0.8, gain: 0.30, attack: 0.005, release: 0.25 });
  tone({ freq: 220, endFreq: 60, type: "sawtooth", duration: 0.35, gain: 0.20, attack: 0.005, release: 0.20, filter: { type: "lowpass", freq: 800, Q: 1.2 } });
}
export function playSame(): void {
  if (!isOn()) return; resume();
  tone({ freq: 880, type: "sine", duration: 0.42, gain: 0.10, attack: 0.005, release: 0.30 });
  tone({ freq: 1318.5, type: "sine", duration: 0.42, gain: 0.08, attack: 0.005, release: 0.30, delay: 0.04 });
}
// Sync-viewport chime: not strictly an initiative sound, but it's a
// "table coordination" cue so we group it under the initiative SFX
// gate (closer to "session pacing" than "dice rolling").
export function playSyncView(): void {
  if (!isOnFor("initiative")) return; resume();
  tone({ freq: 220, type: "sine", duration: 0.25, gain: 0.20, attack: 0.005, release: 0.20 });
  tone({ freq: 110, type: "sine", duration: 0.25, gain: 0.16, attack: 0.005, release: 0.20, delay: 0.005 });
}
// Initiative turn-advance chime — explicitly initiative channel.
export function playNextTurn(): void {
  if (!isOnFor("initiative")) return; resume();
  tone({ freq: 392, type: "sine", duration: 0.22, gain: 0.18, attack: 0.005, release: 0.18 });
  tone({ freq: 587.3, type: "triangle", duration: 0.20, gain: 0.10, attack: 0.005, release: 0.16, delay: 0.02 });
}

// Public sfx names — also the broadcast payload `name` field used by
// sfx-broadcast.ts.
export type SfxName =
  | "parabola" | "scalePunch" | "numFly" | "numLand"
  | "flashCrit" | "flashFail" | "spin" | "burst" | "same"
  | "syncView" | "nextTurn";

export const PLAYERS: Record<SfxName, () => void> = {
  parabola: playParabola,
  scalePunch: playScalePunch,
  numFly: playNumFly,
  numLand: playNumLand,
  flashCrit: playFlashCrit,
  flashFail: playFlashFail,
  spin: playSpin,
  burst: playBurst,
  same: playSame,
  syncView: playSyncView,
  nextTurn: playNextTurn,
};

// Resume the AudioContext — call from sfx-broadcast.ts on first user
// gesture. Exposed here so the broadcast file doesn't need to peek at
// the private ctx state.
export function primeAudio(): void {
  resume();
}
