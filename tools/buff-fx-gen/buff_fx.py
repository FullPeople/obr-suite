"""Buff effect WebM generator for the OBR status tracker.

Each effect is parameter-driven so the same pipeline can render any number
of variants (frequency, scale range, emoji choice, count, duration).
Outputs VP9 WebMs with alpha channel — meant to be dropped into the
status-tracker bubbles via `buildImage({mime: "video/webm", url})`.

Three reference effects (mapped to the user's D&D conditions):
    paralysis  – lightning sparks pop in at random positions / scales
    dizzy      – swirly-star emojis orbit an ellipse around the top of
                 the token
    poison     – emojis rain top-to-bottom at random sizes

Usage:
    python buff_fx.py paralysis --out paralysis.webm
    python buff_fx.py dizzy     --out dizzy.webm
    python buff_fx.py poison    --out poison.webm

All three accept --width / --height / --duration / --fps / --seed plus
effect-specific knobs (--count, --emoji, ...). See `python buff_fx.py
<effect> --help` for the full list.

Dependencies: Pillow + ffmpeg (with libvpx-vp9). Emoji PNGs come from
Twemoji via Jsdelivr — cached under .emoji-cache/ next to this file
so reruns are offline.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import subprocess
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List

from PIL import Image

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / ".emoji-cache"
CACHE_DIR.mkdir(exist_ok=True)

# Twemoji 72×72 PNG asset CDN. Files are tiny (~5 KB each).
TWEMOJI_URL = "https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/{code}.png"

# Symbolic emoji catalog — extend freely. Keep codepoints in lowercase
# hex without the U+ prefix; Twemoji's path uses that form (multi-codepoint
# emojis joined by "-").
EMOJI_CODEPOINTS: dict[str, str] = {
    # Combat / status emoji set
    "lightning":  "26a1",   # ⚡  — paralysis
    "dizzy":      "1f4ab",  # 💫  — dizzy/stun
    "swirl":      "1f300",  # 🌀  — alt for dizzy
    "skull":      "1f480",  # 💀  — death / poison
    "test_tube":  "1f9ea",  # 🧪  — poison
    "nauseated":  "1f922",  # 🤢  — poison alt
    "snake":      "1f40d",  # 🐍  — poison alt
    "drop":       "1f4a7",  # 💧  — generic drop
    "fire":       "1f525",  # 🔥
    "snowflake":  "2744",   # ❄
    "star":       "2b50",   # ⭐
    "boom":       "1f4a5",  # 💥
    "zap":        "26a1",   # ⚡  alias
    "sparkles":   "2728",   # ✨
}


def fetch_emoji(name: str) -> Image.Image:
    """Return a Pillow RGBA Image for the named emoji, cached on disk.

    Falls back to a visible magenta square if the codepoint can't be
    downloaded — easier to spot than a silent invisible frame."""
    code = EMOJI_CODEPOINTS.get(name)
    if code is None:
        raise ValueError(
            f"unknown emoji '{name}'. add it to EMOJI_CODEPOINTS or pass "
            f"--emoji=<known-name>. known: {sorted(EMOJI_CODEPOINTS)}"
        )
    cached = CACHE_DIR / f"{code}.png"
    if not cached.exists():
        url = TWEMOJI_URL.format(code=code)
        try:
            print(f"  downloading {url}", file=sys.stderr)
            urllib.request.urlretrieve(url, cached)
        except Exception as exc:
            print(f"  WARN: download failed ({exc}), using fallback", file=sys.stderr)
            fb = Image.new("RGBA", (72, 72), (255, 0, 255, 200))
            fb.save(cached)
    return Image.open(cached).convert("RGBA")


# ----- frame composition helpers -------------------------------------------


def paste_emoji(
    canvas: Image.Image,
    emoji: Image.Image,
    cx: float,
    cy: float,
    scale: float,
    rotation_deg: float = 0.0,
    opacity: float = 1.0,
) -> None:
    """Composite an emoji onto `canvas` at (cx, cy) with the given
    scale (0..1, fraction of canvas width) and rotation/opacity."""
    target_w = max(1, int(scale * canvas.width))
    target_h = max(1, int(target_w * emoji.height / emoji.width))
    sized = emoji.resize((target_w, target_h), Image.Resampling.LANCZOS)
    if rotation_deg != 0:
        sized = sized.rotate(rotation_deg, resample=Image.Resampling.BICUBIC, expand=True)
    if opacity < 1.0:
        # multiply alpha channel
        r, g, b, a = sized.split()
        a = a.point(lambda px: int(px * opacity))
        sized = Image.merge("RGBA", (r, g, b, a))
    px = int(cx - sized.width / 2)
    py = int(cy - sized.height / 2)
    canvas.alpha_composite(sized, (px, py))


def write_webm(frames: List[Image.Image], output_path: Path, fps: int, codec: str = "vp9") -> None:
    """Pipe RGBA frames into ffmpeg, encode WebM with alpha (yuva420p).

    The alpha plane is stored in matroska's BlockAdditional element —
    ffmpeg's CLI decoders don't surface it (ffprobe will report the
    file as plain yuv420p), but browsers honour the `alpha_mode=1`
    metadata tag and decode it as transparent video. This is the same
    pattern JB2A and Foundry's WebMs use.

    `-auto-alt-ref 0` is REQUIRED for VP8 alpha (libvpx errors out
    otherwise) and recommended for VP9 alpha (some builds drop alpha
    silently when alt-ref is on)."""
    if not frames:
        raise RuntimeError("no frames generated")
    W, H = frames[0].size
    encoder = {"vp9": "libvpx-vp9", "vp8": "libvpx"}[codec]
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "warning",
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "-s", f"{W}x{H}",
        "-r", str(fps),
        "-i", "-",
        "-c:v", encoder,
        "-pix_fmt", "yuva420p",
        # Bitrate / quality knobs. crf alone (constant quality) gives
        # the best size-vs-fidelity tradeoff for short alpha loops.
        "-b:v", "0",
        "-crf", "30",
        # VP9-specific tile threading; harmless on VP8 (silently ignored
        # since VP8 has its own threading model).
        "-row-mt", "1",
        # Required for alpha to survive on libvpx; see docstring.
        "-auto-alt-ref", "0",
        # Explicitly stamp the matroska tag that browsers / OBR's video
        # element look at to enable BlockAdditional alpha decoding. With
        # yuva420p input libvpx writes it automatically, but explicit
        # is safer when the build chain is unfamiliar.
        "-metadata:s:v:0", "alpha_mode=1",
        str(output_path),
    ]
    print(f"  encoding {W}x{H}@{fps}fps {codec}, {len(frames)} frames -> {output_path}", file=sys.stderr)
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    for frame in frames:
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"ffmpeg exited with code {rc}")


# ----- effect configurations -----------------------------------------------
#
# Each effect is a function that takes (args, rng) and yields per-frame
# Pillow Images of size (args.width, args.height). The CLI dispatches to
# one of these based on the chosen subcommand. New effects = new function.


@dataclass
class Particle:
    """Generic particle params; the renderer interprets these per-effect."""
    x: float                # canvas-relative X (px)
    y: float                # canvas-relative Y (px)
    phase: float            # animation phase offset (sec)
    lifetime: float         # how long visible per cycle (sec)
    scale_min: float = 0.2  # starting scale (frac of canvas width)
    scale_max: float = 0.4  # peak scale
    rotation_speed: float = 0.0   # deg / sec
    rotation_offset: float = 0.0  # deg


def render_paralysis(args: argparse.Namespace) -> List[Image.Image]:
    """Lightning sparks flash on / off at random positions, popping in
    quickly and fading.

    Seamless loop: each spark stores `phase_norm` ∈ [0, 1) (fraction of
    loop) and `life_norm` ∈ (0, 1). Its visibility at normalised time
    u is `(u - phase_norm) % 1.0`; the modular arithmetic guarantees
    that `u=0` and `u=1` produce identical state, so the WebM loops
    without a perceivable jump."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    rng = random.Random(args.seed)
    emoji_img = fetch_emoji(args.emoji)

    # life_min / life_max are in seconds in the CLI; convert to fraction
    # of loop for the modular math below.
    life_norm_min = args.life_min / args.duration
    life_norm_max = args.life_max / args.duration

    particles: List[Particle] = []
    for _ in range(args.count):
        particles.append(Particle(
            x=rng.uniform(args.margin, W - args.margin),
            y=rng.uniform(args.margin, H - args.margin),
            phase=rng.uniform(0, 1),                # phase_norm in [0,1)
            lifetime=rng.uniform(life_norm_min, life_norm_max),
            scale_min=rng.uniform(args.scale_min * 0.6, args.scale_min),
            scale_max=rng.uniform(args.scale_max * 0.7, args.scale_max),
            rotation_offset=rng.uniform(-25, 25),
        ))

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames                        # normalised time [0,1)
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for p in particles:
            local_u = (u - p.phase) % 1.0
            if local_u > p.lifetime:
                continue
            life_progress = local_u / p.lifetime    # 0..1 over the flash
            # Bell envelope peaks at 40% of the flash, fades to 0 at edges.
            envelope = max(0.0, 1.0 - abs((life_progress - 0.4) * 2.0))
            scale = p.scale_min + (p.scale_max - p.scale_min) * envelope
            opacity = envelope ** 0.65
            paste_emoji(frame, emoji_img, p.x, p.y, scale, p.rotation_offset, opacity)
        frames.append(frame)
    return frames


def render_dizzy(args: argparse.Namespace) -> List[Image.Image]:
    """Dizzy stars orbit an ellipse centred at the TOP of the canvas.

    Designed to attach above a token (token's head ≈ canvas top). The
    ellipse semi-axes default to ~40% width × ~15% height. Three stars
    spaced 120° apart so the ring always looks populated.

    Seamless loop: orbit count + self-spin count are SNAPPED to
    integers per loop. The user's `--period` (seconds-per-revolution)
    and `--spin-rate` (deg/sec) get rounded to the nearest seamless
    value if they don't already divide the loop cleanly."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    emoji_img = fetch_emoji(args.emoji)

    cx = W / 2
    cy = args.center_y if args.center_y >= 0 else H * 0.30
    rx = args.radius_x if args.radius_x > 0 else W * 0.40
    ry = args.radius_y if args.radius_y > 0 else H * 0.16

    # Snap orbit revolutions per loop to an integer (≥1). Recompute the
    # effective period from the snap so the user sees what actually got
    # used in the WebM.
    revolutions = max(1, round(args.duration / args.period))
    effective_period = args.duration / revolutions
    if abs(effective_period - args.period) > 0.01:
        print(
            f"  note: period snapped {args.period:.2f}s → {effective_period:.2f}s "
            f"({revolutions} revolution(s) per {args.duration}s loop) for seamless loop",
            file=sys.stderr,
        )

    # Snap self-spin to an integer-spins-per-loop too. Spin can be
    # negative (counter-spin) — preserve sign through rounding.
    raw_spins = args.spin_rate * args.duration / 360
    spins_per_loop = round(raw_spins) if raw_spins != 0 else 0
    effective_spin_rate = spins_per_loop * 360 / args.duration
    if abs(effective_spin_rate - args.spin_rate) > 0.5:
        print(
            f"  note: spin-rate snapped {args.spin_rate:.0f}°/s → {effective_spin_rate:.0f}°/s "
            f"({spins_per_loop} self-spin(s) per loop)",
            file=sys.stderr,
        )

    n = args.count
    base_offsets = [i * (2 * math.pi / n) for i in range(n)]

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames                        # normalised time [0,1)
        theta_base = u * 2 * math.pi * revolutions  # integer revolutions per loop
        spin_deg = u * 360 * spins_per_loop          # integer self-spins per loop
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for i, off in enumerate(base_offsets):
            theta = theta_base + off
            # back-of-ellipse stars get smaller + dimmer (pseudo-3D)
            depth = (math.sin(theta) + 1) * 0.5     # 0 (back) .. 1 (front)
            scale = args.scale_min + (args.scale_max - args.scale_min) * depth
            opacity = 0.45 + 0.55 * depth
            x = cx + rx * math.cos(theta)
            y = cy + ry * math.sin(theta)
            # `i * 47` adds a stable per-star phase offset so they don't
            # all start at the same rotation angle.
            rot = (spin_deg + i * 47) % 360 - 180
            paste_emoji(frame, emoji_img, x, y, scale, rot, opacity)
        frames.append(frame)
    return frames


def render_poison(args: argparse.Namespace) -> List[Image.Image]:
    """Emojis fall top-to-bottom at random sizes, like rain.

    Seamless loop: each drop completes an INTEGER number of full
    top-to-bottom falls per loop (`cycles ∈ [cycles_min, cycles_max]`).
    Different drops can have different cycle counts (1 = slow, 2 =
    fast, 3 = very fast) so the rain still looks varied. X-wobble and
    self-spin frequencies are likewise integer-per-cycle so they wrap
    cleanly at the loop boundary.

    The old API used `--speed-min/--speed-max` px/sec which produced
    non-integer cycles → drops jumped position at the wrap. The new
    `--cycles-min/--cycles-max` integers force seamless behaviour; the
    old flags are still accepted and auto-converted (deprecation note
    on stderr)."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    rng = random.Random(args.seed)
    emoji_img = fetch_emoji(args.emoji)

    # spawn region — y starts ABOVE the visible canvas so the first
    # frame doesn't show drops popping into existence mid-air.
    spawn_y_min = -H * 0.2
    travel = H + H * 0.4   # full top-to-bottom + offscreen padding

    # Resolve cycles range. Prefer explicit --cycles-* args; otherwise
    # convert legacy --speed-min/--speed-max to a comparable integer
    # range so old shell scripts still work.
    cyc_min = args.cycles_min
    cyc_max = args.cycles_max
    if cyc_min is None or cyc_max is None:
        if args.speed_min is not None and args.speed_max is not None:
            cyc_min_calc = max(1, round(args.speed_min * args.duration / travel))
            cyc_max_calc = max(cyc_min_calc, round(args.speed_max * args.duration / travel))
            cyc_min = cyc_min or cyc_min_calc
            cyc_max = cyc_max or cyc_max_calc
            print(
                f"  note: converted --speed-min/max ({args.speed_min:.0f}-{args.speed_max:.0f} px/s) "
                f"→ cycles {cyc_min}-{cyc_max} per {args.duration}s loop",
                file=sys.stderr,
            )
        else:
            cyc_min = cyc_min or 1
            cyc_max = cyc_max or 2

    drops = []
    for _ in range(args.count):
        cycles = rng.randint(cyc_min, cyc_max)
        drops.append({
            "x_base":            rng.uniform(args.margin, W - args.margin),
            "x_amp":             rng.uniform(0, args.x_jitter),
            # 0 = straight fall, 1-2 = slight zig. Integer for seamless wrap.
            "x_wobbles_per_cycle": rng.choice([0, 1, 2]),
            "cycles":            cycles,
            "phase":             rng.uniform(0, 1),
            "scale":             rng.uniform(args.scale_min, args.scale_max),
            "rot_base":          rng.uniform(0, 360),
            # Spin direction varies; spins-per-cycle ∈ {-1, 0, 1} keeps
            # drops mostly stable with occasional tumble.
            "spins_per_cycle":   rng.choice([-1, 0, 0, 1]),
        })

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames                        # normalised time [0,1)
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for d in drops:
            # Wrap-safe progress: cycles is integer ⇒ at u=0 and u→1
            # this returns the same value, so the WebM loops cleanly.
            prog = (u * d["cycles"] + d["phase"]) % 1.0
            y = spawn_y_min + travel * prog
            x = d["x_base"] + d["x_amp"] * math.sin(
                prog * d["x_wobbles_per_cycle"] * 2 * math.pi
            )
            # Fade-in over first 10% of the fall, fade-out at last 8%.
            if prog < 0.10:
                opacity = prog / 0.10
            elif prog > 0.92:
                opacity = (1.0 - prog) / 0.08
            else:
                opacity = 1.0
            rot = d["rot_base"] + d["spins_per_cycle"] * 360 * prog
            paste_emoji(frame, emoji_img, x, y, d["scale"], rot, opacity)
        frames.append(frame)
    return frames


# ----- CLI -----------------------------------------------------------------

EFFECTS: dict[str, dict] = {
    "paralysis": {
        "renderer": render_paralysis,
        "defaults": {
            "emoji": "lightning",
            "count": 6,
            "life_min": 0.18,
            "life_max": 0.38,
            "scale_min": 0.18,
            "scale_max": 0.42,
            "margin": 18,
        },
    },
    "dizzy": {
        "renderer": render_dizzy,
        "defaults": {
            "emoji": "dizzy",
            "count": 3,
            "period": 1.5,
            "spin_rate": 180,
            "scale_min": 0.18,
            "scale_max": 0.30,
            "center_y": -1,    # default = 30% from top
            "radius_x": 0,     # default = 40% W
            "radius_y": 0,     # default = 16% H
        },
    },
    "poison": {
        "renderer": render_poison,
        "defaults": {
            "emoji": "test_tube",
            "count": 8,
            # New integer-cycles API (default). cycles=1 means 1 full
            # top-to-bottom fall per loop; cycles=2 = twice as fast; etc.
            "cycles_min": 1,
            "cycles_max": 2,
            # Legacy speed range — only used if explicitly passed; will
            # be converted to a cycles range with a stderr note.
            "speed_min": None,
            "speed_max": None,
            "scale_min": 0.10,
            "scale_max": 0.22,
            "x_jitter": 6,
            "margin": 12,
        },
    },
}


def add_common_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--out", required=True, help="output .webm path")
    p.add_argument("--width", type=int, default=192, help="canvas px (square or aspect-set)")
    p.add_argument("--height", type=int, default=192, help="canvas px")
    p.add_argument("--duration", type=float, default=1.5, help="loop length in seconds")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--seed", type=int, default=42, help="rng seed for reproducible runs")
    p.add_argument("--emoji", help="key from EMOJI_CODEPOINTS catalog")
    p.add_argument("--codec", choices=["vp9", "vp8"], default="vp9",
                   help="WebM codec. vp9 = smaller files. vp8 = JB2A's choice, "
                        "more reliable for alpha on flaky ffmpeg builds.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="effect", required=True)

    p_para = sub.add_parser("paralysis", help="Random lightning flashes (麻痹)")
    add_common_args(p_para)
    p_para.add_argument("--count", type=int)
    p_para.add_argument("--life-min", dest="life_min", type=float, help="min flash duration (s)")
    p_para.add_argument("--life-max", dest="life_max", type=float, help="max flash duration (s)")
    p_para.add_argument("--scale-min", dest="scale_min", type=float)
    p_para.add_argument("--scale-max", dest="scale_max", type=float)
    p_para.add_argument("--margin", type=int, help="px padding from canvas edge")

    p_dizzy = sub.add_parser("dizzy", help="Stars orbiting above token (眩晕)")
    add_common_args(p_dizzy)
    p_dizzy.add_argument("--count", type=int, help="number of orbiting stars")
    p_dizzy.add_argument("--period", type=float, help="seconds per full revolution")
    p_dizzy.add_argument("--spin-rate", dest="spin_rate", type=float, help="self-spin deg/sec")
    p_dizzy.add_argument("--scale-min", dest="scale_min", type=float)
    p_dizzy.add_argument("--scale-max", dest="scale_max", type=float)
    p_dizzy.add_argument("--center-y", dest="center_y", type=float,
                         help="ellipse vertical centre in px (default: 30%% of canvas H)")
    p_dizzy.add_argument("--radius-x", dest="radius_x", type=float,
                         help="ellipse semi-axis X in px (default: 40%% of canvas W)")
    p_dizzy.add_argument("--radius-y", dest="radius_y", type=float,
                         help="ellipse semi-axis Y in px (default: 16%% of canvas H)")

    p_poison = sub.add_parser("poison", help="Emojis raining down (中毒)")
    add_common_args(p_poison)
    p_poison.add_argument("--count", type=int)
    # Preferred (seamless-loop-friendly) API:
    p_poison.add_argument("--cycles-min", dest="cycles_min", type=int,
                          help="min integer falls per loop (1 = slowest). Required for seamless loop.")
    p_poison.add_argument("--cycles-max", dest="cycles_max", type=int,
                          help="max integer falls per loop. Drops randomise in [min, max].")
    # Legacy speed-based API (converted to cycles range with a warning):
    p_poison.add_argument("--speed-min", dest="speed_min", type=float,
                          help="[legacy] min fall speed px/sec; converted to integer cycles")
    p_poison.add_argument("--speed-max", dest="speed_max", type=float,
                          help="[legacy] max fall speed px/sec; converted to integer cycles")
    p_poison.add_argument("--scale-min", dest="scale_min", type=float)
    p_poison.add_argument("--scale-max", dest="scale_max", type=float)
    p_poison.add_argument("--x-jitter", dest="x_jitter", type=float, help="horizontal wobble amplitude px")
    p_poison.add_argument("--margin", type=int, help="px padding from canvas L/R edges")

    return parser


def apply_defaults(args: argparse.Namespace, effect: str) -> argparse.Namespace:
    """Fill in any None CLI-defaultable fields from EFFECTS[effect]['defaults']."""
    for k, v in EFFECTS[effect]["defaults"].items():
        if getattr(args, k, None) is None:
            setattr(args, k, v)
    return args


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args = apply_defaults(args, args.effect)
    renderer: Callable[[argparse.Namespace], List[Image.Image]] = EFFECTS[args.effect]["renderer"]
    print(f"[buff-fx] generating '{args.effect}' -> {args.out}", file=sys.stderr)
    print(f"          params: {vars(args)}", file=sys.stderr)
    frames = renderer(args)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_webm(frames, out, args.fps, args.codec)
    print(f"[buff-fx] done. {out.stat().st_size / 1024:.1f} KB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
