import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dev = process.env.THREE_DRAGON_CHANNEL !== "stable";
const base = `/three-dragon-ante${dev ? "-dev" : ""}/`;
export default defineConfig({
  root, base,
  plugins: [{ name: "standalone-manifest", generateBundle() {
    this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify({
      name: `Three-Dragon Ante${dev ? " (Dev)" : ""}`, version: `0.3.2${dev ? "-dev" : ""}`,
      manifest_version: 1, author: "FullPeople", description: "三龙牌 · Legendary Edition 基础牌桌 / A shared tavern card table with guided practice.",
      icon: `${base}icon.svg`, background_url: `${base}background.html`,
      action: { title: "三龙牌 / Three-Dragon Ante", icon: `${base}icon.svg`, popover: `${base}launcher.html`, width: 300, height: 180 },
    }, null, 2) });
  } }],
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: {
    input: { background: resolve(root, "background.html"), table: resolve(root, "index.html"), launcher: resolve(root, "launcher.html") },
    output: { manualChunks: id => /node_modules[/\\]three[/\\]/.test(id) ? "table-engine" : id.includes("node_modules") ? "vendor" : undefined },
  } },
});
