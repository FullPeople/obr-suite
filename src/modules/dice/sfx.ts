// Web-Audio synthesized sound effects.
//
// We don't ship audio assets — every sound here is generated on the
// fly with oscillators + filtered noise. Cheap to render (each sound
// is ~50-700ms), zero asset weight, no fetch round-trip.
//
// Each function plays its sound and returns immediately. If the user
// disabled sound (via the suite Settings → 基础设置 → 音效 toggle), all
// functions are no-ops. The on/off pref is checked at play time so a
// just-toggled change takes effect on the next sound.

const LS_KEY = "obr-suite/sfx-on";

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

function isOn(): boolean {
  try { return localStorage.getItem(LS_KEY) !== "0"; }
  catch { return true; }
}

// Resume the ctx if suspended (browsers throttle until first user
// gesture). Call defensively before each play; it's a no-op when
// already running.
function resume(): void {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
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

// ──────────────── Public API: one function per sound ────────────────

// 1. Dice rolling parabola — bouncing arc fly-in.
//    Brief whoosh + descending pitch click bounces.
export function sfxParabola(): void {
  if (!isOn()) return; resume();
  noiseBurst({ duration: 0.55, startFreq: 1800, endFreq: 200, Q: 1.4, gain: 0.18, attack: 0.05, release: 0.25 });
  // 4 little impacts spaced like the bounce cascade in the visual.
  tone({ freq: 380, type: "triangle", duration: 0.06, gain: 0.10, attack: 0.005, release: 0.05, delay: 0.32 });
  tone({ freq: 320, type: "triangle", duration: 0.05, gain: 0.08, attack: 0.005, release: 0.04, delay: 0.42 });
  tone({ freq: 280, type: "triangle", duration: 0.04, gain: 0.06, attack: 0.005, release: 0.03, delay: 0.49 });
  tone({ freq: 240, type: "triangle", duration: 0.03, gain: 0.05, attack: 0.005, release: 0.025, delay: 0.54 });
}

// 2. Single-die zoom punch (the climax scale on a winner).
export function sfxScalePunch(): void {
  if (!isOn()) return; resume();
  tone({ freq: 660, endFreq: 440, type: "sine", duration: 0.18, gain: 0.20, attack: 0.005, release: 0.10 });
  tone({ freq: 1320, endFreq: 880, type: "triangle", duration: 0.14, gain: 0.12, attack: 0.005, release: 0.08, delay: 0.01 });
}

// 3. Number flying up to running total (rush per-die).
export function sfxNumFly(): void {
  if (!isOn()) return; resume();
  tone({ freq: 540, endFreq: 1080, type: "sine", duration: 0.16, gain: 0.10, attack: 0.005, release: 0.10 });
}

// 4. Number landing in / merging with the running total — softer
//    confirmation tick for each per-die rush.
export function sfxNumLand(): void {
  if (!isOn()) return; resume();
  tone({ freq: 880, type: "triangle", duration: 0.07, gain: 0.10, attack: 0.005, release: 0.05 });
}

// 5. Final result flash (crit / fail).
export function sfxFlashCrit(): void {
  if (!isOn()) return; resume();
  tone({ freq: 660, endFreq: 1320, type: "sawtooth", duration: 0.30, gain: 0.18, attack: 0.005, release: 0.18, filter: { type: "lowpass", freq: 4000, Q: 0.7 } });
  tone({ freq: 880, endFreq: 1760, type: "triangle", duration: 0.34, gain: 0.13, attack: 0.01, release: 0.20, delay: 0.04 });
}
export function sfxFlashFail(): void {
  if (!isOn()) return; resume();
  tone({ freq: 220, endFreq: 90, type: "sawtooth", duration: 0.40, gain: 0.20, attack: 0.005, release: 0.25, filter: { type: "lowpass", freq: 1200, Q: 1.0 } });
}

// 6. Spin-and-replace (max/min/reset transform).
export function sfxSpin(): void {
  if (!isOn()) return; resume();
  // Whirring "spin" — pitched filtered noise sweeping up.
  noiseBurst({ duration: 0.55, startFreq: 400, endFreq: 1800, Q: 4, gain: 0.12, attack: 0.03, release: 0.20 });
  // Click at the end where the value snaps.
  tone({ freq: 1100, type: "triangle", duration: 0.10, gain: 0.16, attack: 0.005, release: 0.08, delay: 0.50 });
}

// 7. Burst (explosion dice triggered).
export function sfxBurst(): void {
  if (!isOn()) return; resume();
  noiseBurst({ duration: 0.42, startFreq: 1400, endFreq: 80, Q: 0.8, gain: 0.30, attack: 0.005, release: 0.25 });
  tone({ freq: 220, endFreq: 60, type: "sawtooth", duration: 0.35, gain: 0.20, attack: 0.005, release: 0.20, filter: { type: "lowpass", freq: 800, Q: 1.2 } });
}

// 8. Same-value highlight (duplicate dice).
export function sfxSame(): void {
  if (!isOn()) return; resume();
  // A small chord — perfect fifth — plays as one chime.
  tone({ freq: 880, type: "sine", duration: 0.42, gain: 0.10, attack: 0.005, release: 0.30 });
  tone({ freq: 1318.5, type: "sine", duration: 0.42, gain: 0.08, attack: 0.005, release: 0.30, delay: 0.04 });
}

// 9. Sync-viewport "登" — a gentle low-pitch confirmation thunk.
export function sfxSyncView(): void {
  if (!isOn()) return; resume();
  tone({ freq: 220, type: "sine", duration: 0.25, gain: 0.20, attack: 0.005, release: 0.20 });
  tone({ freq: 110, type: "sine", duration: 0.25, gain: 0.16, attack: 0.005, release: 0.20, delay: 0.005 });
}

// 10. Next-turn "登" — slightly higher / brighter than sync.
export function sfxNextTurn(): void {
  if (!isOn()) return; resume();
  tone({ freq: 392, type: "sine", duration: 0.22, gain: 0.18, attack: 0.005, release: 0.18 });
  tone({ freq: 587.3, type: "triangle", duration: 0.20, gain: 0.10, attack: 0.005, release: 0.16, delay: 0.02 });
}

// Initial tap from any iframe — call once after the user has clicked
// something, so the AudioContext can resume from its suspended state.
// We don't auto-suspend later; the ctx stays alive for the session.
export function sfxPrime(): void {
  resume();
}
