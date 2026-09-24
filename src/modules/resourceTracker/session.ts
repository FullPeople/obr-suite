// Each editor has its own synchronous marker: another room tab on this origin
// must not retire it. pagehide clears it even if the final broadcast is lost.
export const EDIT_SESSION_KEY = "com.obr-suite/resources/edit-session";
const sessionKey = (session: string) => `${EDIT_SESSION_KEY}:${session}`;
export function markEditSession(session: string) { try { localStorage.setItem(sessionKey(session), session); } catch {} }
export function editSessionOpen(session: string) { try { return localStorage.getItem(sessionKey(session)) === session; } catch { return false; } }
export function clearEditSession(session: string) { try { localStorage.removeItem(sessionKey(session)); } catch {} }
