// Control surface only. Audio, PeerJS, room writes and reconnection live in
// modules/musicBoard in the suite background. Closing this document is harmless.
import OBR from "@owlbear-rodeo/sdk";
import { bindPanelDrag } from "./utils/panelDrag";
import { getLocalLang, onLangChange } from "./state";
import { MUSIC_ACK, MUSIC_COMMAND, MUSIC_LOCAL, MUSIC_READY, MUSIC_VIEW, decodeTracks, trackFrom, type MusicSession, type MusicOp, type Track } from "./modules/musicBoard/model";
import type { LocalVolume, SoundStatus } from "./modules/musicBoard/audio";
import type { PairStatus } from "./modules/musicBoard/peer";
import { mt, musicError } from "./modules/musicBoard/text";
import "./modules/musicBoard/style.css";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
interface View { state: MusicSession; canControl: boolean; gm: boolean; writer: string; pair: PairStatus; sound: SoundStatus;
  localVolume: LocalVolume; progress: { position: number; duration: number }; pairCode: string }
let current: View | null = null, connectionId = "", alive = true, librarySignature = "", catalog: Track[] = [], catalogLoading = false;
const pending = new Map<string, ReturnType<typeof setTimeout>>(), unsubs: Array<() => void> = [];
const mini = new URLSearchParams(location.search).get("mini") === "1";
document.body.classList.toggle("mini", mini);
function translate(): void {
  document.documentElement.lang = getLocalLang() === "en" ? "en" : "zh-CN"; document.title = mt("title");
  for (const node of document.querySelectorAll<HTMLElement>("[data-mt]")) node.textContent = mt(node.dataset.mt as Parameters<typeof mt>[0]);
  for (const node of document.querySelectorAll<HTMLInputElement>("[data-mt-placeholder]")) node.placeholder = mt(node.dataset.mtPlaceholder as Parameters<typeof mt>[0]);
  for (const [id, key] of [["close","close"],["mini",mini ? "expand":"minimize"],["drag","drag"],["seek","seek"]] as const) {
    const label = key === "seek" ? (getLocalLang() === "en" ? "Playback position" : "播放进度") : mt(key);
    el(id).title = label; el(id).setAttribute("aria-label", label);
  }
  librarySignature = ""; render(); renderCatalog();
}
function feedback(value: string): void { el("feedback").textContent = value; }
function local(type: string, extra: object = {}): void {
  void OBR.broadcast.sendMessage(MUSIC_LOCAL, { type, ...extra }, { destination: "LOCAL" }).catch(error => feedback(musicError(error)));
}
function command(op: MusicOp): void {
  if (!current?.canControl || pending.size) return;
  const requestId = crypto.randomUUID();
  const timeout = setTimeout(() => { pending.delete(requestId); feedback(mt("noWriter")); render(); }, 7500);
  pending.set(requestId, timeout); feedback(""); render();
  void OBR.broadcast.sendMessage(MUSIC_COMMAND, { requestId, op }, { destination: "ALL" }).catch(error => {
    clearTimeout(timeout); pending.delete(requestId); feedback(musicError(error)); render();
  });
}
function fmt(seconds: number): string { if (!Number.isFinite(seconds) || seconds < 0) return "--:--"; return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2,"0"); }
function button(label: string, action: () => void, shared = true): HTMLButtonElement {
  const node = document.createElement("button"); node.type = "button"; node.textContent = label; node.addEventListener("click", action);
  if (shared) { node.dataset.shared = ""; node.disabled = !current?.canControl || pending.size > 0; } return node;
}
function trackRow(track: Track): HTMLDivElement {
  const row = document.createElement("div"); row.className = "track-row";
  const name = document.createElement("span"); name.className = "track-name"; name.textContent = track.name || new URL(track.url).pathname.split("/").pop() || track.url; name.title = name.textContent;
  const bus = document.createElement("span"); bus.className = "bus"; bus.textContent = track.bus.toUpperCase(); row.append(name,bus); return row;
}
function renderLibrary(): void {
  if (!current) return;
  const { state } = current, signature = JSON.stringify([state.tracks, state.queue, state.sfx]);
  if (signature === librarySignature) return; librarySignature = signature;
  el("queue").replaceChildren();
  if (!state.queue.length) { el("queue").textContent = mt("noQueue"); el("queue").className = "hint"; } else el("queue").className = "";
  state.queue.forEach((id, index) => { const track = state.tracks.find(item => item.id === id); if (!track) return;
    const row = trackRow(track); row.append(button("×", () => command({ type: "queue-remove", position: index }))); row.lastElementChild!.setAttribute("aria-label", mt("remove")); el("queue").append(row); });
  el("library").replaceChildren();
  for (const track of state.tracks) {
    const row = trackRow(track);
    row.append(button(mt("play"), () => command({ type: track.bus === "sfx" ? "sfx" : "play", id: track.id })));
    if (track.bus === "bgm") row.append(button("+", () => command({ type: "queue", id: track.id })));
    row.append(button("×", () => command({ type: "remove", id: track.id }))); row.lastElementChild!.setAttribute("aria-label", mt("remove"));
    if (track.bus === "bgm") row.children[row.children.length - 2].setAttribute("aria-label", mt("enqueue"));
    el("library").append(row);
  }
  el("sfxSection").hidden = state.sfx.length === 0; el("sfx").replaceChildren();
  for (const sound of state.sfx) { const row = trackRow(sound.track); row.append(button(mt("stop"), () => command({ type: "sfx-stop", id: sound.id }))); el("sfx").append(row); }
}
function render(): void {
  const state = current?.state, bgm = state?.bgm;
  el("name").textContent = bgm?.track.name || (bgm ? new URL(bgm.track.url).pathname.split("/").pop() || mt("noTrack") : mt("noTrack"));
  el("status").textContent = !current ? mt("loading") : bgm ? mt(bgm.paused ? "paused" : "playing") : "";
  el("time").textContent = current && bgm ? fmt(current.progress.position) + " / " + fmt(current.progress.duration) : "";
  el("soundNotice").hidden = current?.sound === "ready";
  el("soundMessage").textContent = current?.sound === "blocked" ? mt("blocked") : current?.sound === "error" ? mt("audioError") : "";
  el("play").textContent = mt(bgm && !bgm.paused ? "pause" : "play");
  el<HTMLInputElement>("loop").checked = bgm?.track.loop || false;
  el("readOnly").hidden = !current || current.canControl;
  el("permission").hidden = !current?.gm;
  el<HTMLInputElement>("allowPlayers").checked = state?.allowPlayers !== false;
  el("pairStatus").textContent = mt(current?.pair || "disconnected");
  el("adopt").hidden = current?.pair !== "restored";
  const code = el<HTMLInputElement>("pairCode"); if (document.activeElement !== code && !code.value) code.value = current?.pairCode || "";
  if (current) {
    for (const [id, bus] of [["bgmVolume","bgm"],["sfxVolume","sfx"]] as const) {
      const input = el<HTMLInputElement>(id); if (document.activeElement !== input) input.value = String(Math.round(current.localVolume[bus] * 100)); el(id + "Value").textContent = input.value;
    }
    el<HTMLInputElement>("mute").checked = current.localVolume.mute;
    const seek = el<HTMLInputElement>("seek"); if (document.activeElement !== seek) { seek.max = String(current.progress.duration || 100); seek.value = String(current.progress.position || 0); }
    renderLibrary();
  }
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>("[data-shared]")) input.disabled = !current?.canControl || pending.size > 0;
  el<HTMLButtonElement>("play").disabled ||= !bgm && !state?.queue.length;
  el<HTMLInputElement>("seek").disabled ||= !bgm || !current?.progress.duration;
  el<HTMLInputElement>("loop").disabled ||= !bgm;
  el<HTMLInputElement>("allowPlayers").disabled = !current?.gm || pending.size > 0;
}
function renderCatalog(): void {
  el("catalogTracks").replaceChildren();
  const search = el<HTMLInputElement>("search").value.trim().toLocaleLowerCase();
  for (const track of catalog.filter(track => !search || track.name.toLocaleLowerCase().includes(search)).slice(0,80)) {
    const row = trackRow(track); row.append(button(mt("add"), () => command({ type: "add", tracks: [track] }))); el("catalogTracks").append(row);
  }
}
el("enable").addEventListener("click", () => local("enable"));
el("close").addEventListener("click", () => local("close"));
el("mini").textContent = mini ? "↗" : "−";
el("mini").addEventListener("click", () => { void OBR.broadcast.sendMessage("com.obr-suite/music-board:resize", { mini: !mini }, { destination: "LOCAL" }); });
el("play").addEventListener("click", () => command({ type: !current?.state.bgm ? "next" : current.state.bgm.paused ? "resume" : "pause" }));
for (const type of ["next","stop"] as const) el(type).addEventListener("click", () => command({ type }));
el("clearSfx").addEventListener("click", () => command({ type: "sfx-clear" }));
el<HTMLInputElement>("seek").addEventListener("change", event => command({ type: "seek", position: Number((event.target as HTMLInputElement).value) }));
el<HTMLInputElement>("loop").addEventListener("change", event => command({ type: "loop", value: (event.target as HTMLInputElement).checked }));
el<HTMLInputElement>("allowPlayers").addEventListener("change", event => command({ type: "allowPlayers", value: (event.target as HTMLInputElement).checked }));
for (const [id,bus] of [["bgmVolume","bgm"],["sfxVolume","sfx"]] as const) el<HTMLInputElement>(id).addEventListener("input", event => {
  const value = Number((event.target as HTMLInputElement).value); el(id+"Value").textContent = String(value); local("volume", { value: { [bus]: value / 100 } });
});
el<HTMLInputElement>("mute").addEventListener("change", event => local("volume", { value: { mute: (event.target as HTMLInputElement).checked } }));
el("pair").addEventListener("click", () => local("pair", { code: el<HTMLInputElement>("pairCode").value }));
el("unpair").addEventListener("click", () => local("unpair")); el("adopt").addEventListener("click", () => local("adopt"));
el("import").addEventListener("click", () => { try { command({ type: "add", tracks: decodeTracks(el<HTMLTextAreaElement>("importText").value) }); } catch(error) { feedback(musicError(error)); } });
el("search").addEventListener("input", renderCatalog);
el("defaults").addEventListener("click", () => {
  if (catalogLoading) return; el("catalog").hidden = false; if (catalog.length) { renderCatalog(); return; }
  catalogLoading = true; el<HTMLButtonElement>("defaults").disabled = true;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
  void fetch("https://obr.dnd.center/music/manifest.json", { signal: abort.signal }).then(response => { if (!response.ok) throw new Error("failed"); return response.json(); })
    .then(value => { if (!alive) return; catalog = (Array.isArray(value.tracks) ? value.tracks : []).map(trackFrom).filter((track: Track | null): track is Track => !!track); renderCatalog(); })
    .catch(error => { if (alive) feedback(musicError(error)); }).finally(() => { clearTimeout(timer); catalogLoading = false; if (alive) el<HTMLButtonElement>("defaults").disabled = false; });
  unsubs.push(() => abort.abort());
});
unsubs.push(onLangChange(translate));
translate(); bindPanelDrag(el("drag"), "music-board");
window.addEventListener("pagehide", () => { alive = false; for (const off of unsubs) off(); for (const timer of pending.values()) clearTimeout(timer); pending.clear(); });
OBR.onReady(async () => {
  connectionId = await OBR.player.getConnectionId(); if (!alive) return;
  unsubs.push(OBR.broadcast.onMessage(MUSIC_VIEW, event => { if (event.connectionId !== connectionId || !alive) return;
    current = event.data as View; render(); }),
    OBR.broadcast.onMessage(MUSIC_ACK, event => {
      const result = event.data as { requestId: string; receiver: string; ok: boolean; error?: string };
      if (!current || event.connectionId !== current.writer || result.receiver !== connectionId) return;
      const timer = pending.get(result.requestId); if (!timer) return; clearTimeout(timer); pending.delete(result.requestId);
      if (!result.ok) feedback(musicError(result.error)); render();
    }));
  await OBR.broadcast.sendMessage(MUSIC_READY, {}, { destination: "LOCAL" });
});
