/** PeerJS data-channel boundary. Room snapshots are authoritative, local output
 * preferences never cross it. No media/network tick or room-storage writer here. */
export class StudioRoomSync {
  sessionId = "";
  sequence = 0;
  active = true;
  pending = new Map();
  volumes = new Map();
  volumeTimer = null;
  constructor(send, apply, bootstrap, failed) {
    this.send = send; this.apply = apply; this.bootstrap = bootstrap; this.failed = failed;
    this.helloTimer = setTimeout(() => { if (this.active && !this.sessionId) this.send({ type: "studio-ready", protocol: 2 }); }, 750);
    this.timer = setTimeout(() => { if (this.active && !this.sessionId) this.bootstrap(); }, 1500);
    this.send({ type: "studio-ready", protocol: 2 });
  }
  get connected() { return this.active && !!this.sessionId; }
  receive(message) {
    if (!this.active || !message || typeof message !== "object") return;
    if (message.type === "room-state" && message.protocol === 2) {
      if (typeof message.sessionId !== "string" || !message.sessionId || (this.sessionId && message.sessionId !== this.sessionId)
        || !Number.isSafeInteger(message.sequence) || message.sequence <= this.sequence || !validState(message.state)) return;
      const first = !this.sessionId;
      this.sessionId = message.sessionId; this.sequence = message.sequence; clearTimeout(this.timer); clearTimeout(this.helloTimer);
      // On an explicitly paired, completely fresh room, preserve Studio playback.
      // Reconnect always receives the existing room, including a deliberate stop.
      if (first && message.adoptStudio) this.bootstrap(message.atomicStudioLoad === true);
      else this.apply(message.state, message.sentAt);
      return;
    }
    if (message.type === "studio-ack" && message.sessionId === this.sessionId) {
      const entry = this.pending.get(message.requestId); if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(message.requestId);
      if (!message.ok) this.failed(message.error || "failed",entry.message.command.type === "studio-load");
    }
  }
  command(command) {
    if (!this.active) return;
    if (!this.connected) { this.send(command); return; } // Studio 1.x plugin compatibility.
    if (command.type === "volume") {
      this.volumes.set(command.bus, command);
      if (!this.volumeTimer) this.volumeTimer = setTimeout(() => {
        this.volumeTimer = null; const values = [...this.volumes.values()]; this.volumes.clear();
        if (this.active) for (const value of values) this.dispatch(value);
      }, 120);
      return;
    }
    this.dispatch(command);
  }
  dispatch(command) {
    if (this.pending.size >= 16) { this.failed("busy"); return; }
    const requestId = "studio-" + crypto.randomUUID();
    const message = { type: "studio-command", sessionId: this.sessionId, requestId, command };
    const entry = { message, tries: 0, timer: null };
    this.pending.set(requestId, entry);
    const attempt = () => {
      if (!this.active || !this.pending.has(requestId)) return;
      if (++entry.tries > 3) { this.pending.delete(requestId); this.failed("timeout",command.type === "studio-load"); return; }
      this.send(message); entry.timer = setTimeout(attempt, 2500);
    };
    attempt();
  }
  dispose() {
    this.active = false; clearTimeout(this.timer); clearTimeout(this.helloTimer); clearTimeout(this.volumeTimer);
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear(); this.volumes.clear();
  }
}
function validState(state) {
  const track = t => t && typeof t.url === "string" && /^https?:\/\//i.test(t.url) && typeof t.name === "string";
  return state && Number.isSafeInteger(state.revision) && state.revision >= 0
    && state.bus && [state.bus.bgm, state.bus.sfx].every(v => Number.isFinite(v) && v >= 0 && v <= 1)
    && (!state.bgm || (track(state.bgm.track) && typeof state.bgm.playbackId === "string" && Number.isFinite(state.bgm.position) && Number.isFinite(state.bgm.startedAt)))
    && Array.isArray(state.sfx) && state.sfx.length <= 4 && state.sfx.every(s => track(s.track) && typeof s.id === "string" && Number.isFinite(s.at) && Number.isFinite(s.expiresAt));
}
