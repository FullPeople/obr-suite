// Feature visibility for the stable / dev channel split.
//
// The deploy scripts rewrite this line before building: true hides
// features not yet ready for the public listing, false ships the lot.
//
// As of 2026-08-25 BOTH channels build with false — dynamic fog was the
// last thing behind the gate and it has now shipped to stable, so the
// flag is currently a no-op rather than a live difference. It is kept
// (along with its two call sites, `fullFog/index.ts`'s `authoring` and
// `settings.ts`'s `HIDDEN_TAB_IDS`) because the next feature that wants
// a dev-only soak will need exactly this machinery, and re-deriving it
// costs more than leaving it in place.
//
// If you put something behind it again, flip deploy-suite.sh back to
// true and say so in docs/DEV_VS_STABLE.md, which is what people
// actually read to find out what the two channels differ on.
export const STABLE_HIDES = false;

// === Mobile detection (per-iframe) =====================================
// Modules that run heavy WebGL / continuous rAF work (status tracker
// palette, metadata-inspector tool, character-card fullscreen panel,
// global search bar) are disabled on mobile clients to save the
// limited memory + GPU budget. Other modules still work.
//
// Detection has been deliberately TIGHTENED (2026-05-08): the previous
// `hasTouch && isCoarse` heuristic was a false-positive magnet —
// Surface laptops, Lenovo Yoga, Chromebook touch laptops and any
// Windows tablet-mode session all match `coarse pointer` as soon as
// the OS reports the touchscreen as primary, even when the user has a
// real keyboard + trackpad and is fully capable of running heavy
// modules. Affected players reported the status tracker / metadata
// inspector silently disappearing for them. We now restrict mobile
// detection to:
//   1. Phones / "real" mobile UAs (Mobi, Android with Mobile token,
//      iPhone, iPod, IEMobile, Opera Mini).
//   2. iPad iOS 13+ (which masquerades as Macintosh): Macintosh UA +
//      multi-touch capability AND the absence of any fine pointer.
//      A real Mac with a Magic Trackpad has `(any-pointer: fine)`,
//      iPads do not.
// Touch-only laptops are explicitly NOT mobile.
export function isMobileDevice(): boolean {
  try {
    const ua = navigator.userAgent || "";
    if (/Mobi|Android.*Mobile|iPhone|iPod|IEMobile|Opera Mini/i.test(ua)) return true;
    if (/Macintosh|iPad/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) {
      const hasFinePointer = window.matchMedia?.("(any-pointer: fine)").matches ?? false;
      if (!hasFinePointer) return true;
    }
  } catch {}
  return false;
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
