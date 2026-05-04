import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "path";

// Dual deploy targets:
//   stable → /suite/      (default)
//   dev    → /suite-dev/  (set SUITE_BASE=suite-dev before vite build)
//
// IMPORTANT: pass the dir name WITHOUT a leading slash. Git Bash on
// Windows uses MSYS, which auto-converts UNIX-style absolute paths in
// env vars — "/suite-dev/" gets rewritten to "/Git/suite-dev/" because
// the MSYS root ships under C:\Program Files\Git\ — and the assets end
// up emitted at /Git/suite-dev/assets/* which 404s on the server.
// Passing the bare name "suite-dev" sidesteps the conversion entirely;
// we add the slashes here. Old "/suite/" / "/suite-dev/" forms still
// work — normaliseBase() strips any MSYS-prepended prefix.
function normaliseBase(raw: string): string {
  let s = raw.trim();
  // If MSYS prepended its root path, peel it back to the suite dir.
  const m = /\/(suite[^/]*)\/?$/.exec(s);
  if (m) return `/${m[1]}/`;
  if (!s.startsWith("/")) s = "/" + s;
  if (!s.endsWith("/")) s = s + "/";
  return s;
}
const SUITE_BASE = normaliseBase(process.env.SUITE_BASE || "/suite/");

export default defineConfig(({ command }) => ({
  plugins:
    command === "serve" ? [preact(), basicSsl()] : [preact()],
  base: SUITE_BASE,
  server: {
    cors: { origin: "*" },
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  build: {
    rollupOptions: {
      // Put ALL node_modules into a single vendor chunk. Without this
      // hint, vite's auto-chunker sometimes co-locates the CommonJS
      // interop helper (used by the `events` polyfill that OBR SDK
      // pulls in) into a USER chunk, then has the vendor chunk
      // import that helper back from user code — producing an ESM
      // circular dep that crashes at load time with "e is not a
      // function". Forcing the helper to live with the vendor code
      // keeps user chunks one-way dependents of vendor.
      output: {
        manualChunks: (id: string) => {
          if (id.includes("node_modules")) return "vendor";
        },
      },
      input: {
        background: resolve(__dirname, "background.html"),
        cluster: resolve(__dirname, "cluster.html"),
        "cluster-row": resolve(__dirname, "cluster-row.html"),
        "dice-history-trigger": resolve(__dirname, "dice-history-trigger.html"),
        settings: resolve(__dirname, "settings.html"),
        "timestop-overlay": resolve(__dirname, "timestop-overlay.html"),
        "search-bar": resolve(__dirname, "search-bar.html"),
        "initiative-panel": resolve(__dirname, "initiative-panel.html"),
        "initiative-combat-effect": resolve(
          __dirname,
          "initiative-combat-effect.html"
        ),
        "initiative-new-item": resolve(
          __dirname,
          "initiative-new-item.html"
        ),
        "bestiary-panel": resolve(__dirname, "bestiary-panel.html"),
        "bestiary-monster-info": resolve(
          __dirname,
          "bestiary-monster-info.html"
        ),
        "bestiary-group-saves": resolve(
          __dirname,
          "bestiary-group-saves.html"
        ),
        "cc-panel": resolve(__dirname, "cc-panel.html"),
        "cc-info": resolve(__dirname, "cc-info.html"),
        "cc-bind": resolve(__dirname, "cc-bind.html"),
        "cc-fullscreen": resolve(__dirname, "cc-fullscreen.html"),
        "dice-effect": resolve(__dirname, "dice-effect.html"),
        "dice-panel": resolve(__dirname, "dice-panel.html"),
        "dice-history": resolve(__dirname, "dice-history.html"),
        "dice-replay": resolve(__dirname, "dice-replay.html"),
        "dice-rollable-menu": resolve(__dirname, "dice-rollable-menu.html"),
        "portal-edit": resolve(__dirname, "portal-edit.html"),
        "portal-destination": resolve(__dirname, "portal-destination.html"),
        "portal-blink": resolve(__dirname, "portal-blink.html"),
        "dm-announcement": resolve(__dirname, "dm-announcement.html"),
        "drag-preview": resolve(__dirname, "drag-preview.html"),
        "layout-editor": resolve(__dirname, "layout-editor.html"),
        "monster-drag-preview": resolve(
          __dirname,
          "monster-drag-preview.html"
        ),
        "status-tracker": resolve(__dirname, "status-tracker.html"),
        "metadata-inspector": resolve(__dirname, "metadata-inspector.html"),
        "vision-light-edit": resolve(__dirname, "vision-light-edit.html"),
        "vision-collision-edit": resolve(__dirname, "vision-collision-edit.html"),
      },
    },
  },
}));
