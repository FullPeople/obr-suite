export const MUSIC_ROOM_KEY = "com.obr-suite/music-board:session";
export const MUSIC_LEGACY_KEY = "com.obr-suite/music-board:state";
export const MUSIC_COMMAND = "com.obr-suite/music-board:command";
export const MUSIC_ACK = "com.obr-suite/music-board:ack";
export const MUSIC_LOCAL = "com.obr-suite/music-board:local";
export const MUSIC_VIEW = "com.obr-suite/music-board:view";
export const MUSIC_READY = "com.obr-suite/music-board:ready";
export const MUSIC_BACKUP = "com.obr-suite/music-board:backup";
export const LOCAL_VOLUMES = "obr-music-board:local-volumes";
export const MAX_TRACKS = 128;
export const MAX_QUEUE = 32;
export interface Track { id: string; url: string; name: string; bus: "bgm" | "sfx"; loop: boolean; duration: number;
  tags?: string[]; group?: string; favorite?: boolean; color?: string; volume?: number }
export interface Bgm { track: Track; playbackId: string; position: number; startedAt: number; paused: boolean }
export interface Sfx { id: string; track: Track; at: number; expiresAt: number }
export interface MusicSession { version: 2; revision: number; playbackSet?: boolean; author: string; allowPlayers: boolean; tracks: Track[]; queue: string[];
  bgm: Bgm | null; sfx: Sfx[]; bus: { bgm: number; sfx: number }; recent: string[]; ts: number; libraryRevision?: number; history?: Track[] }
export interface MusicOp { type: string; snapshot?: unknown; track?: unknown; tracks?: unknown[]; id?: string; ids?: string[]; position?: number; target?: number; duration?: number; value?: boolean; volume?: number; bus?: "bgm" | "sfx"; playbackId?: string; expectedPlaybackId?: string; paused?: boolean; expectedLibraryRevision?: number; expectedQueue?: string[] }
export const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const unit = (value: unknown, fallback = 1) => Math.max(0, Math.min(1, finite(value, fallback)));
export function emptySession(): MusicSession { return { version: 2, revision: 0, playbackSet: false, author: "", allowPlayers: true, tracks: [], queue: [], bgm: null, sfx: [], bus: { bgm: .8, sfx: 1 }, recent: [], ts: 0 }; }
export function safeMediaUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try { const url = new URL(value.trim()); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
function urlId(url: string): string { let hash = 2166136261; for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `url-${(hash >>> 0).toString(36)}`; }
export function trackFrom(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>, url = safeMediaUrl(raw.url ?? raw.u); if (!url) return null;
  const label = raw.name ?? raw.n;
  const out: Track = { id: typeof raw.id === "string" && raw.id.trim() && raw.id.length <= 100 ? raw.id : urlId(url), url,
    name: typeof label === "string" ? label.trim().slice(0, 100) : "", bus: (raw.bus ?? raw.b) === "sfx" ? "sfx" : "bgm",
    loop: (raw.loop ?? raw.l) === undefined ? (raw.bus ?? raw.b) !== "sfx" : (raw.loop ?? raw.l) !== false, duration: Math.min(604800, Math.max(0, finite(raw.duration ?? raw.d))) };
  if (Array.isArray(raw.tags)) out.tags = [...new Set(raw.tags.filter((tag): tag is string => typeof tag === "string").map(tag => tag.trim().slice(0, 24)).filter(Boolean))].slice(0, 6);
  if (typeof raw.group === "string") out.group = raw.group.trim().slice(0, 24);
  if (typeof raw.favorite === "boolean") out.favorite = raw.favorite;
  if (typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color)) out.color = raw.color;
  if (typeof (raw.volume ?? raw.vol) === "number") out.volume = unit(raw.volume ?? raw.vol);
  return out;
}
export function livePosition(bgm: Bgm, now = Date.now()): number {
  const value = Math.max(0, bgm.position + (bgm.paused ? 0 : Math.max(0, now - bgm.startedAt) / 1000));
  return bgm.track.loop && bgm.track.duration > 0 ? value % bgm.track.duration : value;
}
export function normaliseSession(value: unknown): MusicSession | null {
  if (!value || typeof value !== "object" || (value as MusicSession).version !== 2) return null;
  const raw = value as MusicSession, out = emptySession();
  out.revision = Math.max(0, Math.trunc(finite(raw.revision))); out.author = typeof raw.author === "string" ? raw.author : "";
  out.allowPlayers = raw.allowPlayers !== false;
  out.playbackSet = typeof raw.playbackSet === "boolean" ? raw.playbackSet : !!raw.bgm || out.revision > 0;
  out.libraryRevision = Math.max(0, Math.trunc(finite(raw.libraryRevision, out.revision)));
  out.history = Array.isArray(raw.history) ? raw.history.map(trackFrom).filter((track): track is Track => !!track).slice(-8) : [];
  out.tracks = Array.isArray(raw.tracks) ? raw.tracks.map(trackFrom).filter((track): track is Track => !!track).slice(0, MAX_TRACKS) : [];
  out.queue = Array.isArray(raw.queue) ? raw.queue.filter(id => typeof id === "string" && out.tracks.some(track => track.id === id)).slice(0, MAX_QUEUE) : [];
  const track = trackFrom(raw.bgm?.track);
  if (track) out.bgm = { track, playbackId: String(raw.bgm?.playbackId || track.id).slice(0, 100), position: Math.max(0, finite(raw.bgm?.position)), startedAt: finite(raw.bgm?.startedAt), paused: !!raw.bgm?.paused };
  out.sfx = Array.isArray(raw.sfx) ? raw.sfx.map(item => {
    const track = trackFrom(item.track); return track && typeof item.id === "string" ? { id: item.id.slice(0, 100), track, at: finite(item.at), expiresAt: finite(item.expiresAt) } : null;
  }).filter((item): item is Sfx => !!item).slice(-4) : [];
  out.bus = { bgm: unit(raw.bus?.bgm, .8), sfx: unit(raw.bus?.sfx, 1) };
  out.recent = Array.isArray(raw.recent) ? raw.recent.filter(id => typeof id === "string").slice(-36) : [];
  out.ts = finite(raw.ts); return out;
}
/** Read-only migration: no old scene key or Studio IndexedDB is deleted.
 * Historical one-shots are not resurrected; legacy BGM is offered paused. */
export function migrateLegacy(value: unknown): MusicSession {
  const out = emptySession();
  if (!value || typeof value !== "object") return out;
  const raw = value as Record<string, any>, track = trackFrom(raw.bgm);
  if (track) { out.tracks.push(track); out.bgm = { track, playbackId: `legacy-${track.id}`, position: Math.max(0, finite(raw.bgm.position)), startedAt: 0, paused: true }; }
  for (const item of Array.isArray(raw.sfx) ? raw.sfx : []) { const track = trackFrom({ ...item, bus: "sfx" }); if (track && out.tracks.length < MAX_TRACKS && !out.tracks.some(t => t.url === track.url)) out.tracks.push(track); }
  out.bus = { bgm: unit(raw.bus?.bgm, .8), sfx: unit(raw.bus?.sfx, 1) }; return out;
}
export function reduceMusic(state: MusicSession, op: MusicOp, commandId: string, now = Date.now()): MusicSession {
  if (["pause", "resume", "seek", "loop", "stop"].includes(op.type) && typeof op.expectedPlaybackId === "string"
    && op.expectedPlaybackId !== (state.bgm?.playbackId || "")) throw new Error("stalePlayback");
  if (["update", "remove", "replace"].includes(op.type) && typeof op.expectedLibraryRevision === "number" && op.expectedLibraryRevision !== (state.libraryRevision ?? state.revision)) throw new Error("staleLibrary");
  if (op.expectedQueue && JSON.stringify(op.expectedQueue) !== JSON.stringify(state.queue)) throw new Error("staleQueue");
  const next = structuredClone(state);
  next.sfx = next.sfx.filter(sfx => sfx.track.loop || sfx.expiresAt > now);
  const requireTrack = () => { const track = op.track ? trackFrom(op.track) : next.tracks.find(track => track.id === op.id); if (!track) throw new Error("invalidTrack"); return track; };
  const play = (track: Track, remember = true) => { if (remember && next.bgm && next.bgm.track.id !== track.id) next.history = [...(next.history || []), next.bgm.track].slice(-8); next.playbackSet=true; next.bgm = { track: { ...track, bus: "bgm" }, playbackId: commandId, position: Math.max(0, finite(op.position)), startedAt: now, paused: op.paused === true }; };
  switch (op.type) {
    case "studio-load": {
      // Fresh pairing adopts one coherent snapshot. No successful volume write
      // may publish an empty BGM between the website's bootstrap commands.
      if ((state.playbackSet ?? state.revision > 0) || state.bgm || state.sfx.length) throw new Error("stalePlayback");
      const source=op.snapshot as {bgm?:{url?:unknown;name?:unknown;loop?:unknown;position?:unknown;paused?:unknown};sfx?:unknown[];bus?:{bgm?:unknown;sfx?:unknown}} | null;
      if(!source||typeof source!=="object"||Array.isArray(source)||!Array.isArray(source.sfx)||source.sfx.length>4)throw new Error("invalidCommand");
      if(source.bgm){const track=trackFrom(source.bgm);if(!track)throw new Error("invalidTrack");
        next.bgm={track:{...track,bus:"bgm"},playbackId:commandId,position:Math.max(0,finite(source.bgm.position)),startedAt:now,paused:source.bgm.paused===true};}
      next.playbackSet=true;
      next.sfx=source.sfx.map((value,index)=>{const track=trackFrom(value);if(!track)throw new Error("invalidTrack");return{id:`${commandId}:${index}`,track:{...track,bus:"sfx" as const},at:now,expiresAt:now+Math.max(3000,(track.duration||30)*1000)};});
      next.bus={bgm:unit(source.bus?.bgm,.8),sfx:unit(source.bus?.sfx,1)};
      break;
    }
    case "add": {
      const tracks = (op.tracks || [op.track]).map(trackFrom); if (tracks.some(track => !track)) throw new Error("invalidTrack");
      for (const track of tracks as Track[]) { if (next.tracks.some(t => t.url === track.url)) continue; if (next.tracks.some(t => t.id === track.id)) throw new Error("invalidTrack"); if (next.tracks.length >= MAX_TRACKS) throw new Error("libraryFull"); next.tracks.push(track); } break;
    }
    case "replace": {
      if (!Array.isArray(op.tracks) || op.tracks.length > MAX_TRACKS) throw new Error("invalidTrack");
      const tracks = op.tracks.map(trackFrom); if (tracks.some(track => !track) || new Set(tracks.map(track => track!.id)).size !== tracks.length || new Set(tracks.map(track => track!.url)).size !== tracks.length) throw new Error("invalidTrack");
      next.tracks = tracks as Track[]; next.queue = next.queue.filter(id => next.tracks.some(track => track.id === id)); break;
    }
    case "update": {
      const index = next.tracks.findIndex(track => track.id === op.id), track = trackFrom(op.track);
      if (index < 0 || !track || track.id !== op.id || next.tracks.some((item, i) => i !== index && item.url === track.url)) throw new Error("invalidTrack");
      next.tracks[index] = track; if (track.bus === "sfx") next.queue = next.queue.filter(id => id !== track.id); break;
    }
    case "remove": next.tracks = next.tracks.filter(track => track.id !== op.id); next.queue = next.queue.filter(id => id !== op.id); break;
    case "queue": { const track = requireTrack(); if (track.bus !== "bgm") throw new Error("invalidTrack"); if (next.queue.length >= MAX_QUEUE) throw new Error("queueFull"); next.queue.push(track.id); break; }
    case "queue-many": {
      if (!Array.isArray(op.ids) || !op.ids.length || next.queue.length + op.ids.length > MAX_QUEUE) throw new Error("queueFull");
      if (op.ids.some(id => !next.tracks.some(track => track.id === id && track.bus === "bgm"))) throw new Error("invalidTrack");
      next.queue.push(...op.ids); break;
    }
    case "queue-remove": { const index = Math.trunc(finite(op.position, -1)); if (index >= 0) next.queue.splice(index, 1); break; }
    case "queue-move": { const from = Math.trunc(finite(op.position, -1)), to = Math.trunc(finite(op.target, -1)); if (from < 0 || to < 0 || from >= next.queue.length || to >= next.queue.length) throw new Error("invalidCommand"); const [id] = next.queue.splice(from, 1); next.queue.splice(to, 0, id); break; }
    case "queue-clear": next.queue = []; break;
    case "previous": { const track = next.history?.pop(); if (!track) return state; play(track, false); break; }
    case "play": play(requireTrack()); break;
    case "duration": {
      const duration = finite(op.duration);
      if (!next.bgm || next.bgm.playbackId !== op.playbackId || duration <= 0 || duration > 604800 || Math.abs(next.bgm.track.duration - duration) < .25) return state;
      next.bgm.track.duration = duration; break;
    }
    case "next": case "ended": {
      if (op.type === "ended" && (!next.bgm || next.bgm.playbackId !== op.playbackId || next.bgm.track.loop || next.bgm.paused)) return state;
      // A seek/pause may win while an old deadline or media event is queued.
      if (op.type === "ended" && next.bgm!.track.duration > 0 && livePosition(next.bgm!, now) < next.bgm!.track.duration - .15) return state;
      const id = next.queue.shift(), track = next.tracks.find(track => track.id === id); if (track) play(track); else next.bgm = null; break;
    }
    case "pause": if (next.bgm) { next.bgm.position = typeof op.position === "number" ? Math.max(0, finite(op.position)) : livePosition(next.bgm, now); next.bgm.paused = true; next.bgm.startedAt = now; } break;
    case "resume": if (next.bgm && next.bgm.paused) { if (typeof op.position === "number") next.bgm.position = Math.max(0, finite(op.position)); next.bgm.startedAt = now; next.bgm.paused = false; } break;
    case "seek": if (next.bgm) { next.bgm.position = Math.max(0, finite(op.position)); next.bgm.startedAt = now; } break;
    case "stop": next.playbackSet=true; next.bgm = null; break;
    case "loop": if (next.bgm) { next.bgm.position = livePosition(next.bgm, now); next.bgm.startedAt = now; next.bgm.track.loop = !!op.value; } break;
    case "sfx": { const track = requireTrack(), id = op.playbackId || commandId; next.sfx = next.sfx.filter(sfx => sfx.id !== id); next.sfx.push({ id, track: { ...track, bus: "sfx" }, at: now, expiresAt: now + Math.max(3000, (track.duration || 30) * 1000) }); next.sfx = next.sfx.slice(-4); break; }
    case "sfx-stop": next.sfx = next.sfx.filter(sfx => sfx.id !== op.id); break;
    case "sfx-clear": next.sfx = []; break;
    case "volume": if (op.bus === "bgm" || op.bus === "sfx") next.bus[op.bus] = unit(op.volume); break;
    case "allowPlayers": next.allowPlayers = !!op.value; break;
    default: throw new Error("invalidCommand");
  }
  if (["add", "remove", "replace", "update"].includes(op.type)) next.libraryRevision = (state.libraryRevision ?? state.revision) + 1;
  next.recent = [...next.recent, commandId].slice(-36); next.revision++; next.ts = now; return next;
}
/** `bus` applies to bare direct links only — a Studio share code carries its own
 *  per-track bus and loop flag. A link imported as SFX is a one-shot, so it must
 *  not inherit the BGM default of `loop: true`. */
export function decodeTracks(text: string, bus: "bgm" | "sfx" = "bgm"): Track[] {
  if (text.length > 262144) throw new Error("invalidTrack");
  let values: unknown[];
  if (text.trim().startsWith("obrm1:")) {
    const code = text.trim().slice(6).replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(code), char => char.charCodeAt(0)); const raw = JSON.parse(new TextDecoder().decode(bytes)); values = Array.isArray(raw) ? raw : [raw];
  } else if (/^[\[{]/.test(text.trim())) {
    const raw = JSON.parse(text); if (!Array.isArray(raw) && !Array.isArray(raw?.tracks) && !raw?.url && !raw?.u) throw new Error("invalidTrack"); values = Array.isArray(raw) ? raw : Array.isArray(raw?.tracks) ? raw.tracks : [raw];
    if (raw?.format && (raw.format !== "obr-music-library" || raw.version !== 1)) throw new Error("invalidTrack");
  } else values = text.trim().split(/\r?\n/).flatMap(line => {
    const [name, url] = line.split(/\t/); return url ? [{url: url.trim(), name: name.trim(), bus, loop: bus === "bgm"}] : line.trim().split(/\s+/).filter(Boolean).map(url => ({url, name:"", bus, loop:bus === "bgm"}));
  });
  const tracks = values.map(trackFrom); if (tracks.length === 0 && !/^[\[{]/.test(text.trim()) || tracks.length > MAX_TRACKS || tracks.some(track => !track)) throw new Error("invalidTrack"); return tracks as Track[];
}
export function encodeLibrary(tracks: Track[]): string { return JSON.stringify({format:"obr-music-library", version:1, tracks}, null, 2); }
