# Buff FX Studio

Browser-based WebM effect generator with **alpha channel**. Built to
produce drop-in `.webm` files for the OBR Suite status tracker
(`public/buff-fx/`).

Sibling tool to `tools/buff-fx-gen/` (the Python CLI generator). The
studio uses the same 9 templates and the same matroska-alpha encoder
flags, so output is interchangeable.

## What it does

1. **Pick a source** — Twemoji emoji from the catalog, OR upload a
   local image, OR fetch a remote URL.
2. **Pick a template** — flash · orbit · rain · float · pulse ·
   radial · shake · static · fade. Live preview reacts to changes
   instantly.
3. **Tune parameters** — sliders for count, scale, speed, lifetime,
   etc. Per-template plus canvas-wide (size / duration / fps / seed).
4. **Generate** — bakes all frames in-browser, hands them to
   **ffmpeg.wasm** for VP9 + yuva420p encoding. Output is a
   downloadable `.webm` with real alpha.

## Architecture

Pure static page — no backend, no build step.

```
index.html  →  app.js (main)
                ├─ templates.js   (9 render functions, ports of Python)
                ├─ encoder.js     (ffmpeg.wasm wrapper)
                ├─ emoji.js       (Twemoji catalog + image loader)
                └─ style.css      (dark theme)
```

- `templates.js` mirrors the math of `tools/buff-fx-gen/buff_fx.py`
  so a config produced in the studio looks identical to a config
  baked with the Python tool.
- `encoder.js` loads `@ffmpeg/ffmpeg@0.12` from esm.sh on first
  Generate click. ~30 MB one-time download, cached by the browser
  forever after. Single-threaded core — no SharedArrayBuffer or
  COOP/COEP headers needed on the host.
- All seamless-loop guarantees from the Python tool carry over:
  normalised-time `u ∈ [0, 1)`, integer cycles per loop, state(u=0)
  ≡ state(u=1).

## Running locally

```bash
# Any static file server works. Examples:
cd tools/buff-fx-studio
python -m http.server 8000
# then visit http://localhost:8000/
```

## Deploying

The page is fully static. Push to any HTTP host:

```bash
# Sibling deploy script (deploy-studio.sh):
bash deploy-studio.sh
# → uploads everything in this directory to the server.
```

URL after deploy: `https://obr.dnd.center/studio/` (or wherever the
deploy script points).

## Adding a new template

1. Add the renderer + meta + paramSpec to `templates.js`
2. Add the template key to `TEMPLATE_ORDER`
3. Reload page; the new template appears in the picker

## Adding a new emoji

1. Add to `emoji.js` `EMOJI_CATALOG`. Codepoint is the Twemoji
   filename without `.png` (e.g. `1f9ea` for 🧪).
2. Reload; it shows in the grid + searchable by name/label.

## CORS notes

- Twemoji loads from jsdelivr CDN with proper CORS.
- ffmpeg.wasm loads from esm.sh + unpkg with proper CORS.
- Custom URLs the user pastes need their own CORS headers — if the
  paste fails, F12 console shows the CORS error.

## Output spec (matches OBR Suite plugin)

| Field            | Value                                       |
|------------------|---------------------------------------------|
| Container        | WebM (matroska)                             |
| Codec            | VP9 (libvpx-vp9)                            |
| pix_fmt          | yuva420p (BlockAdditional alpha)            |
| Metadata tag     | `alpha_mode=1`                              |
| Resolution       | configurable, default 192×192               |
| Duration         | configurable, default 1.5 s                 |
| FPS              | configurable, default 30                    |
| Quality          | crf 30, constant-quality VP9                |
| File size        | ~3-200 KB depending on motion + transparency|

These match the `tools/buff-fx-gen/build_all.sh` outputs.
