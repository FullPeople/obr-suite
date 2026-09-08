import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { PANEL_IDS, getPanelOffset, registerPanelBbox, BC_PANEL_DRAG_END, BC_PANEL_RESET } from "../../utils/panelLayout";
import { onViewportResize } from "../../utils/viewportAnchor";
import { MusicAudio, type LocalVolume } from "./audio";
import { RoomMusic } from "./room";
import { StudioPeer } from "./peer";
import { LOCAL_VOLUMES, MUSIC_LOCAL, MUSIC_READY, MUSIC_VIEW, livePosition, unit, type MusicOp } from "./model";
import { musicError } from "./text";

const PANEL = "com.obr-suite/music-board/popover";
const TOGGLE = "com.obr-suite/music-board:toggle", ACTIVE = "com.obr-suite/music-board:state-active", RESIZE = "com.obr-suite/music-board:resize";
const MINI = "obr-music-board:minimized", PAIR = "obr-music-board:last-pair-code", INTENT = "obr-music-board:conn-intent";
let active = false, epoch = 0, panelOpen = false, desiredOpen = false, geometryDirty = false;
let syncing: Promise<void> | null = null, panelRequested = false, lastViewAt = 0;
let audio: MusicAudio | null = null, room: RoomMusic | null = null, peer: StudioPeer | null = null;
let resizeOff: (() => void) | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null, durationReported = "";
const unsubs: Array<() => void> = [];
function stored(key: string): string { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function volumes(): LocalVolume { try { const value = JSON.parse(stored(LOCAL_VOLUMES) || "{}"); return { bgm: unit(value.bgm, .8), sfx: unit(value.sfx, 1), mute: value.mute === true }; } catch { return { bgm: .8, sfx: 1, mute: false }; } }
async function view(force = false): Promise<void> {
  if (!active || !room || !audio || (!force && (!panelOpen || Date.now() - lastViewAt < 400))) return;
  lastViewAt = Date.now();
  try { await OBR.broadcast.sendMessage(MUSIC_VIEW, { state: room.state, writer: room.writer, canControl: room.canControl, gm: room.isGM, pair: peer?.status || "disconnected",
    sound: audio.status, localVolume: audio.volume, progress: audio.progress(), pairCode: stored(PAIR) }, { destination: "LOCAL" }); }
  catch (error) { console.warn("[music-board] panel status failed", error); }
}
function command(op: MusicOp): void {
  if (!room) return;
  void room.submit(op).catch(error => { console.warn("[music-board] operation failed", error); void OBR.notification.show(musicError(error), "WARNING"); });
}
function reportDuration(): void {
  if (!active || !audio || !room || room.writer !== room.connectionId) { durationReported = ""; return; }
  const bgm = room.state.bgm, duration = audio.progress().duration;
  if (!bgm || !Number.isFinite(duration) || duration <= 0 || duration > 604800 || Math.abs(bgm.track.duration - duration) < .25) return;
  const key = `${bgm.playbackId}:${duration}`; if (key === durationReported) return; durationReported = key;
  // Metadata loading needs no local playback consent. Publish once, not on each progress event.
  command({ type: "duration", playbackId: bgm.playbackId, duration });
}
function scheduleAdvance(): void {
  if (nextTimer !== null) clearTimeout(nextTimer); nextTimer = null;
  if (!active || !room || room.writer !== room.connectionId) return;
  const bgm = room.state.bgm;
  if (!bgm || bgm.paused || bgm.track.loop || bgm.track.duration <= 0) return;
  const playbackId = bgm.playbackId, generation = epoch;
  nextTimer = setTimeout(() => {
    nextTimer = null;
    if (!active || generation !== epoch || !room || room.writer !== room.connectionId || room.state.bgm?.playbackId !== playbackId) return;
    command({ type: "ended", playbackId });
  }, Math.min(2147480000, Math.max(0, (bgm.track.duration - livePosition(bgm)) * 1000) + 100));
}
async function geometry(): Promise<{ left: number; top: number; width: number; height: number }> {
  const [vw, vh] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  const mini = stored(MINI) === "1", width = Math.max(160, Math.min(mini ? 210 : 380, vw - 16)), height = Math.max(80, Math.min(mini ? 80 : 560, vh - 32));
  const offset = getPanelOffset(PANEL_IDS.musicBoard);
  return { left: Math.max(8, Math.min(vw - width - 8, vw - width - 70 + offset.dx)), top: Math.max(8, Math.min(vh - height - 8, 56 + offset.dy)), width, height };
}
function syncPanel(): Promise<void> {
  panelRequested = true; if (syncing) return syncing;
  syncing = (async () => {
    while (true) {
      panelRequested = false;
      if (!active || !desiredOpen) {
        resizeOff?.(); resizeOff = null;
        if (!panelOpen) return;
        await OBR.popover.close(PANEL); panelOpen = false;
        await OBR.broadcast.sendMessage(ACTIVE, { open: false }, { destination: "LOCAL" }); continue;
      }
      if (panelOpen && !geometryDirty) return;
      const generation = epoch, box = await geometry(); if (!active || !desiredOpen || generation !== epoch) continue;
      // Reopening/reanchoring is a view operation. Audio and PeerJS remain here.
      geometryDirty = false;
      await OBR.popover.open({ id: PANEL, url: assetUrl("music-board.html") + "?mini=" + (stored(MINI) === "1" ? "1" : "0"),
        width: box.width, height: box.height, anchorReference: "POSITION", anchorPosition: { left: box.left, top: box.top },
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" }, hidePaper: true, disableClickAway: true });
      panelOpen = true; if (!resizeOff) resizeOff = onViewportResize(() => { geometryDirty = true; void syncPanel(); });
      await OBR.broadcast.sendMessage(ACTIVE, { open: true }, { destination: "LOCAL" }); await view(true);
    }
  })().catch(error => console.warn("[music-board] panel update failed", error)).finally(() => { syncing = null; if (panelRequested) void syncPanel(); });
  return syncing;
}
export async function setupMusicBoard(): Promise<void> {
  if (active) return; active = true; const generation = ++epoch;
  audio = new MusicAudio(() => { reportDuration(); void view(); }, playbackId => { if (room && room.writer === room.connectionId) command({ type: "ended", playbackId }); });
  audio.volume = volumes();
  room = new RoomMusic(state => { audio?.apply(state); scheduleAdvance(); reportDuration(); if (room && !room.canControl && peer?.status !== "disconnected") peer?.disconnect(); void view(true); });
  peer = new StudioPeer(command, () => { void view(true); });
  registerPanelBbox(PANEL_IDS.musicBoard, async () => panelOpen ? geometry() : null);
  const onStorage = (event: StorageEvent) => { if (event.key === LOCAL_VOLUMES && audio) { audio.volume = volumes(); audio.volumeChanged(); void view(true); } };
  window.addEventListener("storage", onStorage); unsubs.push(() => window.removeEventListener("storage", onStorage));
  unsubs.push(OBR.broadcast.onMessage(TOGGLE, event => { if (event.connectionId !== room?.connectionId) return; desiredOpen = !desiredOpen; void syncPanel(); }),
    OBR.broadcast.onMessage(MUSIC_READY, event => { if (event.connectionId === room?.connectionId) void view(true); }),
    OBR.broadcast.onMessage(RESIZE, event => { const value = event.data as { mini?: boolean }; if (event.connectionId !== room?.connectionId || typeof value?.mini !== "boolean") return;
      localStorage.setItem(MINI, value.mini ? "1" : "0"); geometryDirty = true; void syncPanel(); }),
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, event => { if ((event.data as { panelId?: string })?.panelId === PANEL_IDS.musicBoard) { geometryDirty = true; void syncPanel(); } }),
    OBR.broadcast.onMessage(BC_PANEL_RESET, () => { geometryDirty = true; void syncPanel(); }),
    OBR.broadcast.onMessage(MUSIC_LOCAL, event => {
      if (!active || event.connectionId !== room?.connectionId) return;
      const message = event.data as { type?: string; value?: Partial<LocalVolume>; code?: string };
      if (message.type === "enable") audio?.unlock();
      else if (message.type === "close") { desiredOpen = false; void syncPanel(); }
      else if (message.type === "volume" && audio && message.value) {
        const next = { ...audio.volume, ...message.value }; audio.volume = { bgm: unit(next.bgm), sfx: unit(next.sfx), mute: !!next.mute };
        localStorage.setItem(LOCAL_VOLUMES, JSON.stringify(audio.volume)); audio.volumeChanged(); void view(true);
      } else if (message.type === "pair" && room.canControl && message.code) {
        localStorage.setItem(PAIR, message.code.trim().toUpperCase()); localStorage.setItem(INTENT, "1"); void peer?.connect(message.code);
      } else if (message.type === "unpair") { localStorage.setItem(INTENT, "0"); peer?.disconnect(); }
      else if (message.type === "adopt" && room.canControl) peer?.adopt();
    }));
  try {
    await room.start();
    if (!active || generation !== epoch) return;
    scheduleAdvance(); reportDuration();
    // Reconnect transport without adopting the Studio's unversioned bootstrap.
    if (stored(INTENT) === "1" && stored(PAIR) && room.canControl) void peer.connect(stored(PAIR), true);
  } catch (error) { if (generation === epoch) await teardownMusicBoard(); throw error; }
}
export async function teardownMusicBoard(): Promise<void> {
  active = false; epoch++; desiredOpen = false;
  if (nextTimer !== null) clearTimeout(nextTimer); nextTimer = null; durationReported = "";
  for (const off of unsubs.splice(0)) off(); resizeOff?.(); resizeOff = null;
  peer?.disconnect(false); peer = null; audio?.dispose(); audio = null;
  const oldRoom = room; room = null; await oldRoom?.stop(); await syncPanel();
  // No open flag, playlist, room session or legacy scene metadata is cleared.
}
