import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "path";

export default defineConfig(({ command }) => ({
  plugins:
    command === "serve" ? [preact(), basicSsl()] : [preact()],
  base: "/suite/",
  server: {
    cors: { origin: "*" },
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  build: {
    rollupOptions: {
      input: {
        background: resolve(__dirname, "background.html"),
        cluster: resolve(__dirname, "cluster.html"),
        settings: resolve(__dirname, "settings.html"),
        about: resolve(__dirname, "about.html"),
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
        "cc-panel": resolve(__dirname, "cc-panel.html"),
        "cc-info": resolve(__dirname, "cc-info.html"),
        "cc-bind": resolve(__dirname, "cc-bind.html"),
      },
    },
  },
}));
