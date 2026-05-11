# buff-fx-gen

Parameterised generator for OBR status-tracker buff effect WebMs.

## What

`buff_fx.py` takes a high-level config (effect type + parameters) and
produces a transparent WebM video. Each effect lives in its own
renderer function inside the script — adding a new effect = one new
function + one CLI subcommand.

Output WebMs are dropped into `public/buff-fx/` and served by OBR via
`buildImage({ mime: "video/webm", url })`. The status tracker can
swap from per-glyph text labels (currently ~20 items per buff) to a
single WebM per buff (1 item per buff).

## Built-in effects

| Subcommand | D&D condition | Visual |
|---|---|---|
| `paralysis` | 麻痹 | Random ⚡ lightning sparks flash on/off at random scales/positions |
| `dizzy` | 眩晕 | 💫 stars orbit an ellipse above the token (pseudo-3D depth) |
| `poison` | 中毒 | 🧪 test-tubes fall top-to-bottom at random sizes & speeds |

Each accepts parameters (count, speed range, scale range, life range,
emoji, …) — see `python buff_fx.py <effect> --help`.

## Usage

```bash
# One-off:
python buff_fx.py paralysis --out ../../public/buff-fx/paralysis.webm

# Tweak:
python buff_fx.py paralysis --out test.webm --count 12 --emoji boom \
                            --duration 2 --width 256 --height 256

# Build the whole catalogue:
./build_all.sh
```

After regenerating, open `preview.html` in a browser to visually
confirm transparency works. ffmpeg's CLI decoder can't read WebM
BlockAdditional alpha back (this is a known limitation; even JB2A's
proven-working WebMs trip the same "Requested planes not available"
error), so programmatic verification with `ffprobe` / `alphaextract`
will mislead you. Trust the `alpha_mode=1` tag + visual browser
check.

## Adding a new effect

1. Add a `render_<name>(args)` function returning `List[Image.Image]`
2. Add an entry to `EFFECTS` dict with `renderer` + `defaults`
3. Add a subparser in `build_parser()` with effect-specific flags
4. Add a `run` line in `build_all.sh` so it ships in the catalogue
5. Run `./build_all.sh`, open `preview.html`, adjust until it looks right

## Adding a new emoji

Append to `EMOJI_CODEPOINTS` at the top of `buff_fx.py`. The codepoint
is the Twemoji filename — find it at
<https://github.com/twitter/twemoji/tree/master/assets/72x72>.

First run downloads + caches the PNG under `.emoji-cache/`. Subsequent
runs are offline.

## Encoder notes (2026-05)

ffmpeg WebM-alpha encoding is finicky:

- `-pix_fmt yuva420p` MUST be set
- `-auto-alt-ref 0` MUST be set (VP8 errors out without it, VP9
  silently drops alpha on some builds)
- `-metadata:s:v:0 alpha_mode=1` MUST be on the output stream (the
  tag browsers check to enable alpha decoding from BlockAdditional)
- `ffprobe` will report `pix_fmt=yuv420p` even when alpha is present
  — the alpha plane lives in matroska's BlockAdditional, not in the
  primary VP9 stream's pix_fmt. Same with JB2A's files.

Codec choice: VP9 by default (smaller, faster decode); pass
`--codec vp8` for the JB2A-compatible path if VP9 alpha misbehaves on
some clients.

## Why generate locally instead of on the server

The server hosting `obr.dnd.center/suite-dev/` doesn't have ffmpeg.
Generating client-side once + checking the WebMs into the repo means:

- No server-side runtime dependency on ffmpeg
- WebMs deploy as plain static files alongside the rest of the suite
- Plugin code references them by stable URL like
  `https://obr.dnd.center/suite-dev/buff-fx/paralysis.webm`
- Caching is "forever" (the files don't change between deploys)
