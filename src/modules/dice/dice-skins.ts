// Per-player custom dice skins — shared by the dice panel's 皮肤 tab,
// the ATTACHMENT-item context-menu picker, and the roll-effect modal.
//
// Each player stores their own skin choices in OBR *player* metadata,
// which OBR syncs to the whole room — so every client can read any
// player's skins and render that player's rolls with them. A skin
// overrides one standard die type's face art with a finished image or
// a webm; unlike the built-in dice (grayscale silhouettes tinted with
// the player's colour), a custom skin is shown as-is.
//
// 2026-05-15 — extended to support:
//   • a LIBRARY of saved skins per die (not just one), so the user can
//     flip between many faces without re-uploading;
//   • a RANDOM-pool toggle per die — when on, every roll picks a random
//     skin from that die's library;
//   • named SKIN SETS — a bundle of up to 7 skins (one per die type) the
//     user can save and one-click reapply.
// All three live in a SECOND metadata key (SKIN_LIB_KEY) so the existing
// active-skin shape (SKINS_KEY) the roll-render paths read stays
// unchanged. `readMySkins` / `readSkinsForPlayer` still return the same
// flat `Partial<Record<DiceType, DiceSkin>>` — they just now apply the
// random pick on top of the saved active skin where the user opted in.

import OBR from "@owlbear-rodeo/sdk";
import { ALL_TYPES, type DiceType } from "./types";

export const SKINS_KEY = "com.obr-suite/dice/skins";
export const SKIN_LIB_KEY = "com.obr-suite/dice/skin-library";

export interface DiceSkin {
  // Absolute URL of the image / webm. OBR item image URLs are already
  // absolute; URLs typed into the panel are validated to be absolute.
  url: string;
  // MIME type — drives <img> vs <video> rendering. May be "" when set
  // from a pasted URL whose type we couldn't determine.
  mime: string;
}

export type DiceSkins = Partial<Record<DiceType, DiceSkin>>;

export interface DiceSkinSet {
  id: string;
  name: string;
  skins: DiceSkins;
}

export interface DiceSkinLibrary {
  v: 2;
  libs: Partial<Record<DiceType, DiceSkin[]>>;
  random: Partial<Record<DiceType, boolean>>;
  sets: DiceSkinSet[];
}

const VALID_TYPES = new Set<string>(ALL_TYPES);

/** True when a skin should render as a <video> rather than an <img>. */
export function isVideoSkin(skin: DiceSkin): boolean {
  return /^video\//i.test(skin.mime) || /\.webm(\?|#|$)/i.test(skin.url);
}

// Defensive parse for the active-skin map (legacy + current shape).
// Used by readMySkins/readSkinsForPlayer indirectly via readActiveSkinsRaw.
export function normalizeSkins(raw: unknown): DiceSkins {
  const out: DiceSkins = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_TYPES.has(k) || !v || typeof v !== "object") continue;
    const url = (v as { url?: unknown }).url;
    const mime = (v as { mime?: unknown }).mime;
    if (typeof url === "string" && url) {
      out[k as DiceType] = { url, mime: typeof mime === "string" ? mime : "" };
    }
  }
  return out;
}

function emptyLibrary(): DiceSkinLibrary {
  return { v: 2, libs: {}, random: {}, sets: [] };
}

function normalizeLibrary(raw: unknown): DiceSkinLibrary {
  const out = emptyLibrary();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.libs && typeof r.libs === "object") {
    for (const [k, v] of Object.entries(r.libs as Record<string, unknown>)) {
      if (!VALID_TYPES.has(k) || !Array.isArray(v)) continue;
      const arr: DiceSkin[] = [];
      for (const s of v as unknown[]) {
        if (!s || typeof s !== "object") continue;
        const url = (s as { url?: unknown }).url;
        const mime = (s as { mime?: unknown }).mime;
        if (typeof url === "string" && url) {
          arr.push({ url, mime: typeof mime === "string" ? mime : "" });
        }
      }
      if (arr.length) out.libs[k as DiceType] = arr;
    }
  }
  if (r.random && typeof r.random === "object") {
    for (const [k, v] of Object.entries(r.random as Record<string, unknown>)) {
      if (!VALID_TYPES.has(k)) continue;
      out.random[k as DiceType] = !!v;
    }
  }
  if (Array.isArray(r.sets)) {
    for (const s of r.sets as unknown[]) {
      if (!s || typeof s !== "object") continue;
      const id = (s as { id?: unknown }).id;
      const name = (s as { name?: unknown }).name;
      const skins = normalizeSkins((s as { skins?: unknown }).skins);
      if (typeof id !== "string" || typeof name !== "string") continue;
      out.sets.push({ id, name, skins });
    }
  }
  return out;
}

// --- localStorage mirror ----------------------------------------------------
//
// 2026-05-15 — `OBR.player.setMetadata` is scoped to the CURRENT room,
// so a user's skin library evaporates as soon as they join a different
// room. Mirror both blobs into `localStorage` (per-browser, cross-room)
// and treat localStorage as the source of truth for SELF reads:
//
//   • write paths: write BOTH localStorage AND OBR player metadata
//     (so other clients in this room can still see the rolls' skins).
//   • read SELF: localStorage first; if empty, lazy-bootstrap from OBR
//     (covers "fresh browser, returning to an old room with prior
//     OBR-side data") and write the result back to localStorage so
//     subsequent reads are stable.
//   • read OTHER players: still from their party metadata — we can't
//     reach their localStorage anyway.
//   • whenever localStorage holds non-empty data on read, we lazy-push
//     it to OBR (fire-and-forget) so room-mates see the same skins
//     even on the first roll after a fresh room-join.

const LS_SKINS_KEY = "obr-suite/dice/skins";       // active map mirror
const LS_LIB_KEY   = "obr-suite/dice/skin-library"; // library + sets + random

function readLSActive(): DiceSkins {
  try {
    const raw = localStorage.getItem(LS_SKINS_KEY);
    if (!raw) return {};
    return normalizeSkins(JSON.parse(raw));
  } catch { return {}; }
}
function writeLSActive(s: DiceSkins): void {
  try { localStorage.setItem(LS_SKINS_KEY, JSON.stringify(s)); } catch {}
}
function readLSLibrary(): DiceSkinLibrary {
  try {
    const raw = localStorage.getItem(LS_LIB_KEY);
    if (!raw) return emptyLibrary();
    return normalizeLibrary(JSON.parse(raw));
  } catch { return emptyLibrary(); }
}
function writeLSLibrary(lib: DiceSkinLibrary): void {
  try { localStorage.setItem(LS_LIB_KEY, JSON.stringify(lib)); } catch {}
}
function isEmptyActive(s: DiceSkins): boolean {
  return Object.keys(s).length === 0;
}
function isEmptyLibrary(lib: DiceSkinLibrary): boolean {
  return Object.keys(lib.libs).length === 0
    && Object.keys(lib.random).length === 0
    && lib.sets.length === 0;
}

// Write the active-skin map to BOTH localStorage and OBR player meta.
// All "set / clear active skin" code paths go through here so the two
// stores stay in lock-step.
async function writeActiveBoth(s: DiceSkins): Promise<void> {
  writeLSActive(s);
  try { await OBR.player.setMetadata({ [SKINS_KEY]: s }); } catch {}
}

// 2026-05-15 — one-shot session flags for the LS→OBR bootstrap push.
// The previous "sync on every read" formed an infinite loop:
//   read → setMetadata → OBR.player.onChange → renderSkinsTab → read → …
// re-creating 7 active-thumb <video> elements per iteration and
// flooding Chrome's WebMediaPlayer pool. The flag guarantees the
// push runs at most once per browsing session per blob.
let _activeSyncedThisSession = false;
let _libSyncedThisSession = false;

// --- low-level reads --------------------------------------------------------

async function readActiveSkinsRaw(): Promise<DiceSkins> {
  const ls = readLSActive();
  if (!isEmptyActive(ls)) {
    // localStorage is the source of truth. ONE-TIME lazy push to OBR
    // so room-mates see the data on the first roll after a room
    // switch / fresh browser load. Subsequent reads skip — explicit
    // writes (setActiveSkin etc.) keep OBR in sync from then on.
    if (!_activeSyncedThisSession) {
      _activeSyncedThisSession = true;
      OBR.player.setMetadata({ [SKINS_KEY]: ls }).catch(() => {});
    }
    return ls;
  }
  // First time on this browser — bootstrap from whatever the current
  // room's OBR metadata happens to have.
  try {
    const meta = await OBR.player.getMetadata();
    const obr = normalizeSkins(meta?.[SKINS_KEY]);
    if (!isEmptyActive(obr)) {
      writeLSActive(obr);
      return obr;
    }
  } catch { /* offline-style fallthrough */ }
  return {};
}

/** Party snapshot shared by the two per-player readers, so one roll
 *  costs one `getId` and one `getPlayers` rather than two of each. */
interface PlayerLookup {
  myId: string;
  /** Only fetched when the roller is someone else. */
  players: { id: string; metadata?: Record<string, unknown> }[] | null;
}

async function readActiveSkinsForPlayerRaw(
  playerId: string,
  lookup: PlayerLookup,
): Promise<DiceSkins> {
  try {
    if (playerId === lookup.myId) return readActiveSkinsRaw();
    const p = lookup.players?.find((pl) => pl.id === playerId);
    return normalizeSkins(p?.metadata?.[SKINS_KEY]);
  } catch {
    return {};
  }
}

async function readLibraryRaw(): Promise<DiceSkinLibrary> {
  const ls = readLSLibrary();
  if (!isEmptyLibrary(ls)) {
    if (!_libSyncedThisSession) {
      _libSyncedThisSession = true;
      OBR.player.setMetadata({ [SKIN_LIB_KEY]: ls }).catch(() => {});
    }
    return ls;
  }
  try {
    const meta = await OBR.player.getMetadata();
    const obr = normalizeLibrary(meta?.[SKIN_LIB_KEY]);
    if (!isEmptyLibrary(obr)) {
      writeLSLibrary(obr);
      return obr;
    }
  } catch { /* fallthrough */ }
  return emptyLibrary();
}

async function readLibraryForPlayerRaw(
  playerId: string,
  lookup: PlayerLookup,
): Promise<DiceSkinLibrary> {
  try {
    if (playerId === lookup.myId) return readLibraryRaw();
    const p = lookup.players?.find((pl) => pl.id === playerId);
    return normalizeLibrary(p?.metadata?.[SKIN_LIB_KEY]);
  } catch {
    return emptyLibrary();
  }
}

// Resolve effective skins for a roll: random pick from library if random
// mode is on for that die and the library is non-empty; otherwise the
// active skin (or undefined → default die art).
function resolveEffective(active: DiceSkins, lib: DiceSkinLibrary): DiceSkins {
  const out: DiceSkins = {};
  for (const t of ALL_TYPES) {
    const arr = lib.libs[t];
    if (lib.random[t] && arr && arr.length > 0) {
      out[t] = arr[Math.floor(Math.random() * arr.length)];
      continue;
    }
    const a = active[t];
    if (a) out[t] = a;
  }
  return out;
}

// --- public API: effective per-roll skins (legacy shape) -------------------

/** Read the current player's effective skins. Empty object on any failure. */
export async function readMySkins(): Promise<DiceSkins> {
  const [active, lib] = await Promise.all([readActiveSkinsRaw(), readLibraryRaw()]);
  return resolveEffective(active, lib);
}

/** Read any player's effective skins by id. Used by the effect modal to
 *  render a roll with the roller's skins. */
export async function readSkinsForPlayer(playerId: string): Promise<DiceSkins> {
  // Both readers used to fetch the player id AND the party list for
  // themselves, so every received roll cost four host round trips for
  // two distinct values. They run concurrently, so they were already
  // reading the same instant — sharing one snapshot is the same answer
  // from strictly less traffic, and rules out the two of them
  // disagreeing about the party.
  let myId = "";
  try {
    myId = await OBR.player.getId();
  } catch {
    // Same failure shape as before: each reader's own try/catch used to
    // swallow this and fall back. An empty id matches no player, so the
    // foreign-player branch is taken and returns the empty default.
  }
  let players: PlayerLookup["players"] = null;
  if (playerId !== myId) {
    try {
      players = (await OBR.party.getPlayers()) as PlayerLookup["players"];
    } catch {
      players = null;
    }
  }
  const lookup: PlayerLookup = { myId, players };
  const [active, lib] = await Promise.all([
    readActiveSkinsForPlayerRaw(playerId, lookup),
    readLibraryForPlayerRaw(playerId, lookup),
  ]);
  return resolveEffective(active, lib);
}

// --- public API: full library shape (skins tab + skin picker) --------------

/** Read the full library for the current player (libs + random + sets). */
export async function readMyLibrary(): Promise<DiceSkinLibrary> {
  return readLibraryRaw();
}

/** Persist the full library. Must be a deep, mutated copy from readMyLibrary. */
export async function writeMyLibrary(lib: DiceSkinLibrary): Promise<void> {
  // Mirror BOTH stores: localStorage is the cross-room source of truth,
  // OBR player metadata is what room-mates read for this player's rolls.
  // The OBR side replaces the whole SKIN_LIB_KEY blob (no merge) so a
  // removed library entry doesn't linger.
  writeLSLibrary(lib);
  try { await OBR.player.setMetadata({ [SKIN_LIB_KEY]: lib }); } catch {}
}

/** Read the active-skin map only (one DiceSkin per die at most). */
export async function readActiveSkins(): Promise<DiceSkins> {
  return readActiveSkinsRaw();
}

/** Set or clear one die type's ACTIVE skin for the current player.
 *  Passing `null` clears it. When `skin` is non-null the URL is also
 *  pushed into that die's library (deduped) — this keeps the right-click
 *  ATTACHMENT picker's "set my skin" behaviour but also remembers it
 *  for the chip strip in the skins tab. */
export async function writeSkin(type: DiceType, skin: DiceSkin | null): Promise<void> {
  // Read both blobs in parallel.
  const [active, lib] = await Promise.all([readActiveSkinsRaw(), readLibraryRaw()]);
  if (skin) active[type] = skin;
  else delete active[type];
  // Write active map first (this is what the roll-render path reads).
  await writeActiveBoth(active);
  if (skin) {
    const arr = (lib.libs[type] ?? []).slice();
    if (!arr.some((s) => s.url === skin.url)) arr.push(skin);
    lib.libs[type] = arr;
    await writeMyLibrary(lib);
  }
}

/** Add a skin to a die's library WITHOUT changing the active skin.
 *  Used by the skins tab's URL-set form when the user wants to grow
 *  the library without immediately applying the new skin. */
export async function addToLibrary(type: DiceType, skin: DiceSkin): Promise<void> {
  const lib = await readLibraryRaw();
  const arr = (lib.libs[type] ?? []).slice();
  if (!arr.some((s) => s.url === skin.url)) arr.push(skin);
  lib.libs[type] = arr;
  await writeMyLibrary(lib);
}

/** Remove a skin (by URL) from a die's library. If the active skin
 *  pointed at it, the active skin is cleared too. */
export async function removeFromLibrary(type: DiceType, url: string): Promise<void> {
  const [active, lib] = await Promise.all([readActiveSkinsRaw(), readLibraryRaw()]);
  const arr = (lib.libs[type] ?? []).filter((s) => s.url !== url);
  if (arr.length) lib.libs[type] = arr;
  else delete lib.libs[type];
  let activeChanged = false;
  if (active[type]?.url === url) {
    delete active[type];
    activeChanged = true;
  }
  await writeMyLibrary(lib);
  if (activeChanged) await OBR.player.setMetadata({ [SKINS_KEY]: active });
}

/** Toggle the random-pool flag for a die. */
export async function setRandomMode(type: DiceType, on: boolean): Promise<void> {
  const lib = await readLibraryRaw();
  if (on) lib.random[type] = true;
  else delete lib.random[type];
  await writeMyLibrary(lib);
}

/** Save the user's CURRENT active skins as a named set. If a set with
 *  the same name exists it's overwritten. */
export async function saveCurrentAsSet(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const [active, lib] = await Promise.all([readActiveSkinsRaw(), readLibraryRaw()]);
  const skins: DiceSkins = {};
  for (const t of ALL_TYPES) {
    const a = active[t];
    if (a) skins[t] = { url: a.url, mime: a.mime };
  }
  const existing = lib.sets.findIndex((s) => s.name === trimmed);
  const set: DiceSkinSet = {
    id: existing >= 0 ? lib.sets[existing].id : `set-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    name: trimmed,
    skins,
  };
  if (existing >= 0) lib.sets[existing] = set;
  else lib.sets.push(set);
  await writeMyLibrary(lib);
}

/** Apply a saved set: write each contained die's skin into the active
 *  map, and push it into that die's library (deduped) too so the chip
 *  strip stays accurate. Dice not present in the set are left alone. */
export async function applySet(setId: string): Promise<void> {
  const [active, lib] = await Promise.all([readActiveSkinsRaw(), readLibraryRaw()]);
  const set = lib.sets.find((s) => s.id === setId);
  if (!set) return;
  let libDirty = false;
  for (const [k, skin] of Object.entries(set.skins)) {
    if (!VALID_TYPES.has(k) || !skin) continue;
    active[k as DiceType] = skin;
    const arr = (lib.libs[k as DiceType] ?? []).slice();
    if (!arr.some((s) => s.url === skin.url)) {
      arr.push(skin);
      lib.libs[k as DiceType] = arr;
      libDirty = true;
    }
  }
  await writeActiveBoth(active);
  if (libDirty) await writeMyLibrary(lib);
}

/** Delete a saved set. Active skins are not touched. */
export async function deleteSet(setId: string): Promise<void> {
  const lib = await readLibraryRaw();
  lib.sets = lib.sets.filter((s) => s.id !== setId);
  await writeMyLibrary(lib);
}

/** Set or clear the active skin for a die WITHOUT touching the library.
 *  Used by the skins tab's chip strip "set as active" click — the chip
 *  is already in the library by definition. */
export async function setActiveSkin(type: DiceType, skin: DiceSkin | null): Promise<void> {
  const active = await readActiveSkinsRaw();
  if (skin) active[type] = skin;
  else delete active[type];
  await writeActiveBoth(active);
}
