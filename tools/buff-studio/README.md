# Buff Studio

Browser-based **multi-layer compositor** for OBR Suite buff effects.
Stack emoji / images / decoded GIFs / videos as layers, position and
animate each one, bake the loop to a `.webm` with real alpha.

Page 2 of the studio (Page 1 = `tools/monster-studio/`). Supersedes
the single-source `tools/buff-fx-studio/` with a free-form layer model
— move positions, collage multiple objects, drag in multiple GIFs.

## What it does

1. **Add layers** — emoji from the catalog, local images (multi-select),
   or drag in GIF / animated WebP / APNG / MP4 / WebM / MOV. Every
   source becomes its own layer; stack as many as you want.
2. **Position freely** — drag a layer directly on the stage. Per-layer
   scale, rotation, opacity, blend mode (正常 / 滤色 / 相加 / 正片叠底).
3. **Animate** — each layer gets a seamless looping animation: pulse,
   bob, orbit, spin, fade, shake — with amplitude / cycle count, plus
   a playback-speed control for GIF/video layers.
4. **Convert** — "GIF / MP4 → WebM 直转" imports one animated file,
   sizes the canvas to it, and drops it in as a full-canvas layer.
   Hit Generate → you've transcoded to alpha-WebM.
5. **Generate** — bakes every composition frame, hands the RGBA buffers
   to **ffmpeg.wasm** for VP9 + `yuva420p` encoding. Output is a
   downloadable `.webm` with real alpha.

## Architecture

Pure static page — no backend, no build step.

```
index.html  →  app.js (compositor: layers, stage, drag, animate, bake)
                ├─ decode.js   (GIF/WebP/APNG via WebCodecs ImageDecoder;
                │               MP4/WebM via a seeked <video>)
                ├─ encoder.js  (ffmpeg.wasm wrapper — copy of buff-fx-studio's)
                └─ emoji.js    (Twemoji catalog — copy of buff-fx-studio's)
               style.css
```

- A **layer** is `{ kind:"image"|"anim", source frames, x, y, scale,
  rotation, opacity, blend, anim, animAmp, animCycles, animSpeed }`.
  `x`/`y` are normalised (0–1, center anchor) so a composition is
  resolution-independent.
- `decode.js` flattens any animated source to `ImageBitmap[]` +
  per-frame durations. Downstream code never cares if it was a GIF or
  an MP4.
- The stage runs a `requestAnimationFrame` loop; `drawLayer()` applies
  transform + animation. Generate re-runs the exact same `drawLayer()`
  into an `OffscreenCanvas` per frame, so preview == output.
- `encoder.js` / `emoji.js` are copied (not imported) from
  `buff-fx-studio` so this directory deploys standalone.

## Browser support

- **GIF / WebP / APNG decoding** needs `ImageDecoder` (WebCodecs) —
  Chromium-based browsers (Chrome / Edge). Falls back to a single
  still frame elsewhere.
- **MP4 / WebM** decoding works anywhere the browser can `<video>`-play
  the file (seeked frame-by-frame — slower but dependency-free).
- `OffscreenCanvas` + `ffmpeg.wasm` for encoding (same as buff-fx-studio).

## Running locally

```bash
cd tools          # serve the tools/ dir so ../monster-studio/ resolves
python -m http.server 8123
# visit http://localhost:8123/buff-studio/
```

## Deploying

Static — shipped by `deploy-studio.sh` alongside `monster-studio`:

```
https://obr.dnd.center/studio/buff-studio/      ← this tool
https://obr.dnd.center/studio/monster-studio/   ← Page 1
```

## Output spec (matches OBR Suite plugin)

| Field        | Value                                    |
|--------------|------------------------------------------|
| Container    | WebM (matroska)                          |
| Codec        | VP9 (libvpx-vp9)                         |
| pix_fmt      | yuva420p (BlockAdditional alpha)         |
| Metadata tag | `alpha_mode=1`                           |
| Resolution   | configurable, default 256×256 (even dims)|
| Duration     | configurable, default 1.5 s              |
| FPS          | configurable, default 30                 |

Drop the output into `obr-suite/public/buff-fx/` or use it as an OBR
Image item `url`.
