/* Share-code encoder/decoder for music-studio ↔ OBR plugin.
 *
 * Format goal:
 *   - URL-safe text small enough to paste in a chat / DM
 *   - Carries everything the OBR plugin needs to add the track to the
 *     player's local catalog WITHOUT us hosting the file
 *   - Versioned so we can extend without breaking old codes
 *
 * Format:
 *   "obrm1:" + base64url(JSON)
 *
 *   JSON shape (single track):
 *     { v:1, n:"name", u:"url", b:"bgm"|"sfx", l:true|false, vol:0..1, d:42 }
 *
 *   For multi-track export the JSON top-level is an array. The "obrm1:"
 *   prefix is identical in both cases — the parser detects.
 *
 *   Field abbreviations stay short (n/u/b/l/vol/d) to keep encoded
 *   length minimal for QR-code / chat-paste use.
 *
 * Why "obrm1:" prefix:
 *   - Lets the OBR plugin's importer reject pasted text that ISN'T a
 *     music-board code (e.g. random URL, raw JSON) with a clear error
 *     instead of trying to parse arbitrary input.
 *   - The trailing digit is the FORMAT version, separate from the v
 *     field inside the JSON — bumps if we ever change the envelope.
 *
 * Only URL-backed tracks export. Blob-backed (IDB-only) tracks would
 * need to be uploaded first; the UI calls this on demand and refuses
 * to export blob-only entries with a clear toast.
 */

import { t as T } from "./i18n.js";

const PREFIX = "obrm1:";

function encJson(obj) {
  const json = JSON.stringify(obj);
  // base64url: standard base64 with +→-, /→_, padding stripped. Smaller
  // and safer in URLs / chat clients than raw base64.
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decJson(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  // Re-pad to a multiple of 4 since we stripped on encode.
  const pad = b64.length % 4 ? "====".slice(b64.length % 4) : "";
  const json = decodeURIComponent(escape(atob(b64 + pad)));
  return JSON.parse(json);
}

function trackToCompact(t) {
  // Pick out the fields the OBR side needs; reject blob-only entries.
  if (!t.url) {
    throw new Error(T("muShareLocalErr", { name: t.name }));
  }
  const out = {
    v: 1,
    n: t.name || T("muUnnamed"),
    u: t.url,
    b: t.bus === "sfx" ? "sfx" : "bgm",
    l: t.loop !== false,
    vol: Math.max(0, Math.min(1, t.volume ?? 1)),
  };
  if (Number.isFinite(t.duration) && t.duration > 0) {
    out.d = Math.round(t.duration);
  }
  return out;
}

/** Encode one track or many to a single share-code string. */
export function encodeShareCode(tracks) {
  const arr = Array.isArray(tracks) ? tracks : [tracks];
  const compact = arr.map(trackToCompact);
  const payload = compact.length === 1 ? compact[0] : compact;
  return PREFIX + encJson(payload);
}

/** Decode a share-code back to a normalised array of tracks. Returns
 *  null when the input is not a valid music-board code. */
export function decodeShareCode(text) {
  const s = (text || "").trim();
  if (!s.startsWith(PREFIX)) return null;
  let obj;
  try {
    obj = decJson(s.slice(PREFIX.length));
  } catch {
    return null;
  }
  const arr = Array.isArray(obj) ? obj : [obj];
  return arr.map((c) => ({
    name:     typeof c.n === "string" ? c.n : T("muUnnamed"),
    url:      typeof c.u === "string" ? c.u : "",
    bus:      c.b === "sfx" ? "sfx" : "bgm",
    loop:     c.l !== false,
    volume:   typeof c.vol === "number" ? c.vol : 1,
    duration: typeof c.d === "number" ? c.d : 0,
  })).filter((t) => t.url);
}
