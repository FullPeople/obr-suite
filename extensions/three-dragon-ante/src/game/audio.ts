/** Local, synthesized table sounds. No files, room traffic, or private game data. */
export type TableSound = "draw" | "flip" | "coin";
export interface TableAudio {
  /** A stable table/game/revision/event key is required. The UI must omit initial
   * snapshots and unprovable/reconnected event history. Dropped cues never queue. */
  play(kind: TableSound, cueKey: string): boolean;
  readonly enabled: boolean;
  setEnabled(value: boolean): void;
  suspend(): void;
  resume(): void;
  destroy(): void;
}
export interface TableAudioOptions { onEnabledChange?(enabled: boolean): void }
const PREFERENCE = "three-dragon-ante.sound.v1";
const CHANNEL = "three-dragon-ante.sound-owner.v1";
const MAX_VOICES = 3, MAX_RECENT = 256, MAX_PER_SECOND = 8;
interface Voice { stop(): void }

/** The output is deliberately quiet and finite. Native source ended events own
 * cleanup; there is no idle interval and no deferred playback after unlocking. */
function synthesize(context: BaseAudioContext, output: AudioNode, kind: TableSound, ended: () => void): Voice {
  const nodes: AudioNode[] = [], sources: AudioScheduledSourceNode[] = [];
  const now = context.currentTime;
  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    for (const source of sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } }
    for (const node of nodes) node.disconnect();
    ended();
  };
  function envelope(peak: number, duration: number) {
    const gain = context.createGain(); nodes.push(gain);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + .004);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    gain.connect(output); return gain;
  }
  function tone(frequency: number, peak: number, duration: number, finish = false, pitch?: number) {
    const source = context.createOscillator(); sources.push(source); nodes.push(source);
    source.type = "sine"; source.frequency.setValueAtTime(frequency, now);
    if (pitch) source.frequency.exponentialRampToValueAtTime(pitch, now + duration);
    source.connect(envelope(peak, duration)); if (finish) source.onended = stop;
    source.start(now); source.stop(now + duration + .008);
  }
  try {
    if (kind === "coin") {
      tone(2090, .18, .22, true); tone(3180, .09, .14); tone(4720, .035, .095);
    } else {
      const duration = kind === "draw" ? .145 : .095;
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
      const values = buffer.getChannelData(0); let state = kind === "draw" ? 17391 : 37199;
      for (let i = 0; i < values.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; values[i] = (state >>> 0) / 2147483648 - 1; }
      const source = context.createBufferSource(), filter = context.createBiquadFilter();
      sources.push(source); nodes.push(source, filter); source.buffer = buffer;
      filter.type = "bandpass"; filter.frequency.value = kind === "draw" ? 2800 : 1600; filter.Q.value = .55;
      source.connect(filter).connect(envelope(kind === "draw" ? .2 : .24, duration));
      source.onended = stop; source.start(now); source.stop(now + duration + .008);
      if (kind === "flip") tone(230, .13, .065, false, 110);
    }
    return { stop };
  } catch (error) { stop(); throw error; }
}

interface Instance { host: HTMLElement; suspended: boolean; destroyed: boolean; changed?: (enabled: boolean) => void }
interface Claim { at: number; id: string }
interface Pool {
  mount(host: HTMLElement, options: TableAudioOptions): TableAudio;
}
const pools = new WeakMap<Document, Pool>();

/** One context/voice budget per document; trusted interaction claims the local
 * surface. A same-origin channel silences other frames, with no periodic lease. */
function createPool(doc: Document): Pool {
  const win = doc.defaultView as Window & typeof globalThis;
  const instances = new Set<Instance>(), voices = new Set<Voice>(), recent = new Set<string>();
  let owner: Instance | null = null, context: AudioContext | null = null, master: GainNode | null = null;
  let disposed = false, pageActive = true, foreign = false, enabled = true;
  let starts: number[] = [];
  try { enabled = win.localStorage.getItem(PREFERENCE) !== "off"; } catch { /* Session preference still works. */ }
  const poolId = win.crypto.randomUUID(); let claim: Claim = { at: 0, id: poolId };
  let channel: BroadcastChannel | null = null;
  try { channel = new win.BroadcastChannel(CHANNEL); } catch { /* Same-document arbitration remains available. */ }
  const abort = new AbortController();
  const active = (instance: Instance) => !disposed && !instance.destroyed && !instance.suspended && instance.host.isConnected && !doc.hidden && pageActive;
  const stop = () => {
    for (const voice of [...voices]) voice.stop(); voices.clear();
    if (master && context) { master.gain.cancelScheduledValues(context.currentTime); master.gain.setValueAtTime(0, context.currentTime); }
    if (context && context.state !== "closed") void context.suspend().catch(() => {});
  };
  function wake() {
    if (!context || !owner || !active(owner) || !enabled || foreign) return;
    // No old cue is replayed when this promise settles. A later event may play.
    void context.resume().catch(() => {});
  }
  function claimLocal() {
    claim = { at: Math.max(Date.now(), claim.at + 1), id: poolId }; foreign = false;
    try { channel?.postMessage(claim); } catch { /* Local sounds do not depend on channel delivery. */ }
  }
  function unlock(instance: Instance, event: Event) {
    if (!event.isTrusted || !active(instance)) return;
    if (event instanceof KeyboardEvent && (event.repeat || ["Shift", "Control", "Alt", "Meta"].includes(event.key))) return;
    if (owner !== instance) { stop(); owner = instance; }
    claimLocal();
    if (!enabled) return;
    try {
      if (!context) { context = new win.AudioContext({ latencyHint: "interactive" }); master = context.createGain(); master.gain.value = 0; master.connect(context.destination); }
      wake();
    } catch { /* Unsupported or blocked audio never blocks a rule action. */ }
  }
  function notify() { for (const instance of instances) { try { instance.changed?.(enabled); } catch { /* A control label cannot interrupt audio cleanup. */ } } }
  function changeEnabled(value: boolean, persist: boolean) {
    if (enabled === value) return; enabled = value;
    if (persist) { try { win.localStorage.setItem(PREFERENCE, enabled ? "on" : "off"); } catch { /* Keep this session's setting. */ } }
    if (!enabled) stop(); else wake(); notify();
  }
  channel?.addEventListener("message", event => {
    const next = event.data as Partial<Claim> | null;
    if (!next || typeof next.at !== "number" || !Number.isSafeInteger(next.at) || next.at < 0 || typeof next.id !== "string" || next.id.length > 80 || next.id === poolId) return;
    if (next.at > claim.at || next.at === claim.at && next.id > claim.id) { claim = { at: next.at, id: next.id }; foreign = true; stop(); }
  }, { signal: abort.signal });
  win.addEventListener("storage", event => { if (event.key === PREFERENCE || event.key === null) changeEnabled(event.key === null || event.newValue !== "off", false); }, { signal: abort.signal });
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) stop(); else wake(); }, { signal: abort.signal });
  win.addEventListener("pagehide", () => { pageActive = false; stop(); }, { signal: abort.signal });
  win.addEventListener("pageshow", () => { pageActive = true; wake(); }, { signal: abort.signal });
  function destroy(instance: Instance) {
    if (instance.destroyed) return; instance.destroyed = true; instances.delete(instance);
    if (owner === instance) { stop(); owner = null; }
    if (instances.size) return;
    disposed = true; abort.abort(); channel?.close(); channel = null;
    stop(); if (context) void context.close().catch(() => {});
    context = null; master = null; recent.clear(); starts = []; pools.delete(doc);
  }
  return { mount(host, options) {
    const instance: Instance = { host, suspended: false, destroyed: false, changed: options.onEnabledChange };
    instances.add(instance); if (!owner) { owner = instance; wake(); }
    const inputAbort = new AbortController();
    for (const type of ["pointerdown", "click", "keydown"]) host.addEventListener(type, event => unlock(instance, event), { capture: true, signal: inputAbort.signal });
    return {
      get enabled() { return enabled; },
      setEnabled(value) { if (!instance.destroyed && typeof value === "boolean") changeEnabled(value, true); },
      play(kind, cueKey) {
        if (instance.destroyed || !["draw", "flip", "coin"].includes(kind) || typeof cueKey !== "string" || !cueKey.length || cueKey.length > 512) return false;
        const key = `${kind}:${cueKey}`; if (recent.has(key)) return false;
        recent.add(key); if (recent.size > MAX_RECENT) recent.delete(recent.values().next().value!);
        if (owner !== instance || !active(instance) || !enabled || foreign || !context || context.state !== "running" || !master || voices.size >= MAX_VOICES) return false;
        const now = performance.now(); starts = starts.filter(value => now - value < 1000); if (starts.length >= MAX_PER_SECOND) return false;
        let voice: Voice | undefined;
        try {
          master.gain.setValueAtTime(.22, context.currentTime);
          voice = synthesize(context, master, kind, () => { if (voice) voices.delete(voice); });
          voices.add(voice); starts.push(now); return true;
        } catch { return false; }
      },
      suspend() { if (instance.destroyed) return; instance.suspended = true; if (owner === instance) { stop(); owner = null; } },
      resume() { if (instance.destroyed) return; instance.suspended = false; if (!owner) owner = instance; if (owner === instance) wake(); },
      destroy() { inputAbort.abort(); destroy(instance); },
    };
  } };
}

export function mountTableAudio(host: HTMLElement, options: TableAudioOptions = {}): TableAudio {
  const doc = host.ownerDocument;
  let pool = pools.get(doc); if (!pool) { pool = createPool(doc); pools.set(doc, pool); }
  return pool.mount(host, options);
}
