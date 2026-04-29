import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "path";

// Dual deploy targets:
//   stable → /suite/      (default)
//   dev    → /suite-dev/  (set SUITE_BASE=/suite-dev/ before vite build)
//
// The deploy-suite-dev.sh script wraps this with the right env var so
// the dev build's bundled JS references /suite-dev/assets/* and its
// manifest-dev.json points everything to /suite-dev/. Both can coexist
// on the same server — install whichever URL you want in OBR.
const SUITE_BASE = process.env.SUITE_BASE || "/suite/";

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
        "dice-effect": resolve(__dirname, "dice-effect.html"),
        "dice-panel": resolve(__dirname, "dice-panel.html"),
        "dice-history": resolve(__dirname, "dice-history.html"),
        "dice-replay": resolve(__dirname, "dice-replay.html"),
        "dice-rollable-menu": resolve(__dirname, "dice-rollable-menu.html"),
        "portal-edit": resolve(__dirname, "portal-edit.html"),
        "portal-destination": resolve(__dirname, "portal-destination.html"),
        // Dev-only entry; the bg module that loads it self-gates on
        // SUITE_BASE so stable builds skip the tool registration even
        // though the html file is still present in the bundle.
        "test-panel": resolve(__dirname, "test-panel.html"),
      },
    },
  },
}));
