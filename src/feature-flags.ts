// Feature visibility for stable / dev channel split.
//
// Set STABLE_HIDES = true before building the stable channel (`/suite/`)
// to hide features that aren't ready for the public listing yet.
// Set STABLE_HIDES = false before building the dev channel
// (`/suite-dev/`) so the full feature set shows up for ongoing
// iteration / testing.
export const STABLE_HIDES = false;

// === Mobile detection (per-iframe) =====================================
// Modules that run heavy WebGL / continuous rAF work (status tracker
// palette, metadata-inspector tool, character-card fullscreen panel,
// global search bar) are disabled on mobile clients to save the
// limited memory + GPU budget. Other modules still work.
//
// Mobile is detected via userAgent regex — same simple check as the
// rest of the suite (cluster-row.ts, background.ts already use this).
// It runs once per iframe load, not per-call, since the userAgent
// doesn't change between page loads.
export function isMobileDevice(): boolean {
  try {
    const ua = navigator.userAgent || "";
    return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
  } catch {
    return false;
  }
}
export const IS_MOBILE = isMobileDevice();

/** Panel IDs that should NOT appear in the layout editor / drag-
 *  preview when running on mobile, because their underlying tool
 *  was never registered. Used by `src/layout-editor.ts` to filter
 *  proxies. */
export const MOBILE_HIDDEN_PANELS: ReadonlySet<string> = new Set([
  "status-palette",
  // Metadata inspector doesn't have a registered panel-layout entry,
  // but listing it here is harmless and keeps the spec explicit.
  "metadata-inspector",
]);
