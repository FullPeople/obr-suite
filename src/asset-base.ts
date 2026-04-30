// Build-target-aware asset URL helper.
//
// `import.meta.env.BASE_URL` is the value vite injects at build time —
// "/suite/" for stable builds and "/suite-dev/" for dev builds (set
// via SUITE_BASE in the deploy scripts). `location.origin` is the
// host we're served from at runtime (always obr.dnd.center on prod).
//
// Combining the two means every URL the plugin constructs at runtime
// (popover URLs, modal URLs, image item URLs, sound assets, template
// download links…) points to the SAME deploy as the background
// iframe that's running. Without this the dev install's background.js
// would open popovers from /suite/ — i.e. silently load stable's
// HTML/JS — which is exactly the "dev shows stable's code" symptom
// the user reported.
//
// Use `assetUrl("foo.html")` instead of writing a literal
// "https://obr.dnd.center/suite/foo.html". Pass the path RELATIVE to
// the suite root, no leading slash.
export const ASSET_BASE = `${location.origin}${import.meta.env.BASE_URL}`;

export function assetUrl(path: string): string {
  return `${ASSET_BASE}${path}`;
}
