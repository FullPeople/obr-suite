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
    # === Combat / magic ===
    "lightning":       "26a1",          # ⚡
    "dizzy":           "1f4ab",         # 💫
    "swirl":           "1f300",         # 🌀
    "boom":            "1f4a5",         # 💥
    "sparkles":        "2728",          # ✨
    "fire":            "1f525",         # 🔥
    "snowflake":       "2744",          # ❄
    "star":            "2b50",          # ⭐
    "crystal_ball":    "1f52e",         # 🔮
    "moon":            "1f319",         # 🌙
    "sun":             "2600",          # ☀
    "zap":             "26a1",          # ⚡ alias

    # === Liquid / status ===
    "test_tube":       "1f9ea",         # 🧪
    "drop":            "1f4a7",         # 💧
    "snake":           "1f40d",         # 🐍
    "nauseated":       "1f922",         # 🤢
    "skull":           "1f480",         # 💀

    # === Hearts / love ===
    "sparkling_heart": "1f496",         # 💖
    "heart_pink":      "1f495",         # 💕
    "broken_heart":    "1f494",         # 💔
    "red_envelope":    "1f9e7",         # 🧧

    # === Faces ===
    "clown":           "1f921",         # 🤡
    "ghost":           "1f47b",         # 👻
    "angry":           "1f620",         # 😠
    "rage":            "1f621",         # 😡
    "screaming":       "1f631",         # 😱
    "cold_face":       "1f976",         # 🥶
    "sleepy":          "1f634",         # 😴

    # === Sound / music ===
    "musical_note":    "1f3b5",         # 🎵
    "headphones":      "1f3a7",         # 🎧

    # === Objects / icons ===
    "target":          "1f3af",         # 🎯
    "moai":            "1f5ff",         # 🗿
    "chains":          "1f517",         # 🔗
    "hourglass":       "231b",          # ⌛
    "zzz":             "1f4a4",         # 💤
    "thumbs_up":       "1f44d",         # 👍
    "sunglasses":      "1f576",         # 🕶  (no variation selector — works with Twemoji 72×72)

    # === Movement / nature ===
    "wind":            "1f4a8",         # 💨
    "dove":            "1f54a",         # 🕊
    "leaves":          "1f343",         # 🍃
    "cherry_blossom":  "1f338",         # 🌸
    "tulip":           "1f337",         # 🌷

    # === Animals ===
    "snail":           "1f40c",         # 🐌
    "sloth":           "1f9a5",         # 🦥
    "otter":           "1f9a6",         # 🦦
    "people_hugging":  "1fac2",         # 🫂

    # === Body / mind ===
    "brain":           "1f9e0",         # 🧠

    # === 2026-05-14b additions for custom buffs ===
    "box":             "1f4e6",         # 📦 — invisible (cardboard box on head)
    "ear":             "1f442",         # 👂 — deafened
    "cross_mark":      "274c",          # ❌ — generic X
    "check_mark":      "2705",          # ✅ — for buffs / approval
    "music_score":     "1f3b6",         # 🎶 — multiple notes / sheet music
    "ice_cube":        "1f9ca",         # 🧊 — frozen
    "feather":         "1fab6",         # 🪶 — flying (wing fallback)
    "down_triangle":   "1f53b",         # 🔻 — disadvantage / down arrow
    "down_arrow":      "2b07",          # ⬇ — disadvantage alt
    "bow":             "1f3f9",         # 🏹 — hunter's mark alt
    "rainbow":         "1f308",         # 🌈 — guidance / blessing alt
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


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    """Parse #RRGGBB or RRGGBB to (r, g, b). Defaults to white on parse failure."""
    s = hex_str.lstrip("#")
    if len(s) != 6:
        return (255, 255, 255)
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except ValueError:
        return (255, 255, 255)


def tint_image(img: Image.Image, color_hex: str | None) -> Image.Image:
    """Multiply the image's RGB channels by `color_hex` (#RRGGBB),
    preserving the alpha channel. Use for "give this emoji a blue
    shade" without breaking the silhouette. If color_hex is None /
    "" / "#ffffff", returns img unchanged.

    Algorithm: for each pixel, out_rgb = src_rgb * color / 255.
    Effectively a colour multiply blend; works best on light /
    neutral source emoji (a deeply red emoji multiplied by green
    stays mostly black, so consider a brightness boost via the
    `lighten` flag below for darker sources)."""
    if not color_hex or color_hex.lower() in ("#ffffff", "#fff", "ffffff", "fff"):
        return img
    r_mul, g_mul, b_mul = _hex_to_rgb(color_hex)
    src = img.convert("RGBA")
    r, g, b, a = src.split()
    r = r.point(lambda px: int(px * r_mul / 255))
    g = g.point(lambda px: int(px * g_mul / 255))
    b = b.point(lambda px: int(px * b_mul / 255))
    return Image.merge("RGBA", (r, g, b, a))


def paste_emoji(
    canvas: Image.Image,
    emoji: Image.Image,
    cx: float,
    cy: float,
    scale: float,
    rotation_deg: float = 0.0,
    opacity: float = 1.0,
    *,
    tint: str | None = None,
    mirror_x: bool = False,
    mirror_y: bool = False,
) -> None:
    """Composite an emoji onto `canvas` at (cx, cy) with the given
    scale (0..1, fraction of canvas width) and rotation/opacity.

    Optional:
      tint:     "#rrggbb" colour multiply (for "green X" type recolours)
      mirror_x: horizontal flip before paste (e.g. mirrored wing)
      mirror_y: vertical flip before paste (e.g. upside-down box)
    """
    target_w = max(1, int(scale * canvas.width))
    target_h = max(1, int(target_w * emoji.height / emoji.width))
    sized = emoji.resize((target_w, target_h), Image.Resampling.LANCZOS)
    if mirror_x:
        sized = sized.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if mirror_y:
        sized = sized.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if tint:
        sized = tint_image(sized, tint)
    if rotation_deg != 0:
        sized = sized.rotate(rotation_deg, resample=Image.Resampling.BICUBIC, expand=True)
    if opacity < 1.0:
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


def render_ripple(args: argparse.Namespace) -> List[Image.Image]:
    """Concentric translucent rings expanding outward from a centre
    point. Used for 魅惑 (charmed) — pink ripples emanating away.

    Each ring is one "actor" with phase offset; ring radius animates
    from 0 → max_radius over one cycle, opacity fades 1 → 0. Multiple
    rings staggered in phase produce a sonar-pulse look.

    Seamless: integer cycles per loop (default 1) → state(u=0) ≡
    state(u=1) because radius / alpha both wrap modulo 1.
    """
    from PIL import ImageDraw
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    cx = args.center_x if args.center_x >= 0 else W / 2
    cy = args.center_y if args.center_y >= 0 else H / 2
    r_max = args.radius_max if args.radius_max > 0 else min(W, H) * 0.50
    color = _hex_to_rgb(args.color)
    n_rings = max(1, args.count)
    cycles = max(1, args.cycles)
    line_w = max(1, args.line_width)

    phases = [i / n_rings for i in range(n_rings)]

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(frame)
        for phase in phases:
            prog = (u * cycles + phase) % 1.0
            r = r_max * prog
            if r < 1:
                continue
            # Fade in over first 10%, hold to 20%, fade out over rest.
            if prog < 0.10:
                alpha_norm = prog / 0.10
            elif prog > 0.20:
                alpha_norm = max(0.0, 1.0 - (prog - 0.20) / 0.80)
            else:
                alpha_norm = 1.0
            alpha = int(255 * args.alpha_peak * alpha_norm)
            if alpha <= 2: continue
            # Outline-only circle, no fill.
            bbox = (int(cx - r), int(cy - r), int(cx + r), int(cy + r))
            draw.ellipse(
                bbox,
                outline=(color[0], color[1], color[2], alpha),
                width=line_w,
            )
        frames.append(frame)
    return frames


def render_place(args: argparse.Namespace) -> List[Image.Image]:
    """Single emoji/image placed at a custom (x, y) anchor with
    custom scale + optional animation. The "Swiss Army knife"
    template for buffs that just want one image at a specific spot.

    Position is in CANVAS FRACTIONS (0..1) so the same config scales
    to different canvas sizes.

    Animations (all seamless via integer cycles per loop):
      - rotation_speed: degrees per loop; rotates continuously
      - pulse_pulses:   integer breaths per loop; scale oscillates
      - fade_pulses:    integer pulses; opacity oscillates

    Mirror + tint options carry through to paste_emoji."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    emoji_img = fetch_emoji(args.emoji)

    cx = args.x_frac * W
    cy = args.y_frac * H

    # Snap continuous animations to integer cycles per loop so they wrap.
    rot_per_loop = round(args.rotation_speed)        # already deg/loop
    pulse_n = max(0, args.pulse_pulses)
    fade_n  = max(0, args.fade_pulses)

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        # Animated scale: scale ± scale_pulse_amp at pulse_n beats per loop
        scale = args.scale
        if pulse_n > 0:
            env = 0.5 - 0.5 * math.cos(2 * math.pi * u * pulse_n)
            scale = args.scale * (1.0 + args.pulse_amp * (env - 0.5) * 2)
        # Animated opacity
        opacity = args.opacity
        if fade_n > 0:
            env = 0.5 - 0.5 * math.cos(2 * math.pi * u * fade_n)
            opacity = args.fade_min + (args.fade_max - args.fade_min) * env
        # Animated rotation
        rotation = args.rotation + rot_per_loop * u

        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        paste_emoji(frame, emoji_img, cx, cy, scale, rotation, opacity,
                    tint=args.tint, mirror_x=args.mirror_x, mirror_y=args.mirror_y)
        frames.append(frame)
    return frames


def render_drift(args: argparse.Namespace) -> List[Image.Image]:
    """Particles travel in a straight line at angle θ (degrees,
    clockwise from north = upward). Generalisation of `rain` (θ=180,
    downward) and `float` (θ=0, upward) to any direction.

    Use case: 诗人激励 (bardic) drifts to upper-right at θ ≈ 45°.
    Disadvantage drifts down at θ ≈ 180° with a tint.

    Each particle traverses the full travel distance over `cycles`
    full passes per loop (integer for seamless wrap)."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    rng = random.Random(args.seed)
    emoji_img = fetch_emoji(args.emoji)

    # θ in radians, with 0 = upward (–Y), CW positive.
    theta = (args.angle - 90) * math.pi / 180  # convert "0=up" to math angle
    dx = math.cos(theta)
    dy = math.sin(theta)

    # Travel distance: enough to cover the canvas diagonal twice so
    # particles enter from one side and exit the other regardless of
    # angle. Spawn point is offset BACK along the angle by half the
    # travel, end point is forward half.
    diag = (W * W + H * H) ** 0.5
    travel = diag * 1.4
    spawn_cx = W / 2 - dx * travel / 2
    spawn_cy = H / 2 - dy * travel / 2

    # Per-particle: position perpendicular to drift direction (so
    # particles spread across the lane), cycles (integer), phase,
    # scale, rotation seeded.
    perp_x = -dy
    perp_y = dx
    spread = max(W, H) * args.spread

    particles = []
    for _ in range(args.count):
        offset = rng.uniform(-spread / 2, spread / 2)
        cycles = rng.randint(args.cycles_min, args.cycles_max)
        particles.append({
            "px": spawn_cx + perp_x * offset,
            "py": spawn_cy + perp_y * offset,
            "cycles": cycles,
            "phase":  rng.uniform(0, 1),
            "scale":  rng.uniform(args.scale_min, args.scale_max),
            "rot_base": rng.uniform(0, 360),
            "rot_per_cycle": rng.choice([-1, 0, 0, 1]) * 90,  # quarter spin
        })

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for d in particles:
            prog = (u * d["cycles"] + d["phase"]) % 1.0
            x = d["px"] + dx * travel * prog
            y = d["py"] + dy * travel * prog
            # Fade in/out at the spawn / despawn endpoints
            if prog < 0.10:
                opacity = prog / 0.10
            elif prog > 0.88:
                opacity = (1 - prog) / 0.12
            else:
                opacity = 1.0
            rot = d["rot_base"] + d["rot_per_cycle"] * prog
            paste_emoji(frame, emoji_img, x, y, d["scale"], rot, opacity, tint=args.tint)
        frames.append(frame)
    return frames


def render_flash(args: argparse.Namespace) -> List[Image.Image]:
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


def render_orbit(args: argparse.Namespace) -> List[Image.Image]:
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


def render_float(args: argparse.Namespace) -> List[Image.Image]:
    """Emojis drift UPWARD from the bottom of the canvas (opposite of
    rain). Use case: charm hearts, music notes, sleep Z's, dust trails.

    Seamless: integer rises per loop. Each particle has a fixed
    `phase` ∈ [0, 1) and `rises` (integer) — its vertical progress
    `prog = (u * rises + phase) % 1.0` wraps cleanly at u=1."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    rng = random.Random(args.seed)
    emoji_img = fetch_emoji(args.emoji)

    spawn_y_max = H + H * 0.15           # start below canvas
    travel = H + H * 0.30                 # rise top → past top

    particles = []
    for _ in range(args.count):
        rises = rng.randint(args.cycles_min, args.cycles_max)
        particles.append({
            "x_base":            rng.uniform(args.margin, W - args.margin),
            "x_amp":             rng.uniform(0, args.x_jitter),
            "x_wobbles":         rng.choice([0, 1, 2]),
            "rises":             rises,
            "phase":             rng.uniform(0, 1),
            "scale":             rng.uniform(args.scale_min, args.scale_max),
            "rot_base":          rng.uniform(-15, 15),
            "rot_amp":           rng.uniform(0, 12),   # gentle sway
        })

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for p in particles:
            prog = (u * p["rises"] + p["phase"]) % 1.0
            # y goes from spawn_y_max DOWNWARD (i.e. up the screen) by
            # `travel` over one prog cycle: y = spawn_y_max - travel * prog
            y = spawn_y_max - travel * prog
            x = p["x_base"] + p["x_amp"] * math.sin(prog * p["x_wobbles"] * 2 * math.pi)
            # gentle wobble rotation tied to prog so it loops
            rot = p["rot_base"] + p["rot_amp"] * math.sin(prog * 2 * math.pi)
            # fade-in over first 12%, fade-out at last 12% of the rise
            if prog < 0.12:
                opacity = prog / 0.12
            elif prog > 0.88:
                opacity = (1.0 - prog) / 0.12
            else:
                opacity = 1.0
            paste_emoji(frame, emoji_img, x, y, p["scale"], rot, opacity)
        frames.append(frame)
    return frames


def render_pulse(args: argparse.Namespace) -> List[Image.Image]:
    """A single emoji at the canvas centre, scaling rhythmically (sin
    envelope). Used for "fixed indicator" effects — focused, hunters_
    mark, exhaustion. `--pulses` = integer beats per loop (default 2)."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    emoji_img = fetch_emoji(args.emoji)

    pulses = max(1, args.pulses)
    cx, cy = W / 2, H / 2
    s_lo, s_hi = args.scale_min, args.scale_max

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        # `0.5 - 0.5*cos(2π * u * pulses)` swings 0..1 smoothly with
        # integer pulses per loop → seamless. cos so the cycle BOTTOMS
        # at u=0 and u=1, peaks in the middle.
        envelope = 0.5 - 0.5 * math.cos(2 * math.pi * u * pulses)
        scale = s_lo + (s_hi - s_lo) * envelope
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        paste_emoji(frame, emoji_img, cx, cy, scale, 0, 1.0)
        frames.append(frame)
    return frames


def render_radial(args: argparse.Namespace) -> List[Image.Image]:
    """Emojis radiate outward from the canvas centre in random
    directions, fading as they go. Ring-like emanation effect — used
    for blessing, frozen (ripple), innate spell, guidance.

    Seamless: each emoji travels from centre to its `max_radius` in
    integer cycles per loop."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    rng = random.Random(args.seed)
    emoji_img = fetch_emoji(args.emoji)

    cx, cy = W / 2, H / 2
    max_radius = min(W, H) * 0.45

    particles = []
    for i in range(args.count):
        # Evenly spaced angles + small jitter so the ring doesn't look
        # mechanical. Each particle picks its own integer cycles count.
        base_angle = (i / args.count) * 360 + rng.uniform(-10, 10)
        cycles = rng.randint(args.cycles_min, args.cycles_max)
        particles.append({
            "angle":     base_angle,
            "cycles":    cycles,
            "phase":     rng.uniform(0, 1),
            "scale":     rng.uniform(args.scale_min, args.scale_max),
        })

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for p in particles:
            prog = (u * p["cycles"] + p["phase"]) % 1.0
            r = max_radius * prog
            θ = p["angle"] * math.pi / 180
            x = cx + math.cos(θ) * r
            y = cy + math.sin(θ) * r
            # Fade out as it travels — peak alpha at 30% of journey,
            # zero at 100%. Slight grow during travel (1.0 → 1.3 scale).
            opacity = max(0.0, 1.0 - prog) ** 1.2
            scale = p["scale"] * (1.0 + prog * 0.3)
            paste_emoji(frame, emoji_img, x, y, scale, 0, opacity)
        frames.append(frame)
    return frames


def render_shake(args: argparse.Namespace) -> List[Image.Image]:
    """Single emoji at the canvas centre, shaking left-right rapidly.
    Use case: anger trembling, fear, shivering from cold.

    Seamless: x position oscillates as sin(2π · u · shakes), where
    `shakes` is an integer — wraps cleanly at u=1."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    emoji_img = fetch_emoji(args.emoji)

    cx, cy = W / 2, H / 2
    shakes = max(1, args.shakes)         # integer shakes per loop
    amp = args.amplitude * W              # horizontal amplitude in px

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        x_offset = amp * math.sin(2 * math.pi * u * shakes)
        # Counter-tilt the emoji slightly so the shake "feels" mechanical
        rot = math.sin(2 * math.pi * u * shakes) * args.tilt
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        paste_emoji(frame, emoji_img, cx + x_offset, cy, args.scale, rot, 1.0)
        frames.append(frame)
    return frames


def render_static(args: argparse.Namespace) -> List[Image.Image]:
    """A single emoji at the canvas centre. No animation, but encoded
    as a short WebM so the renderer pipeline stays uniform. 6 identical
    frames = ~2 KB encoded.

    Used for "low-energy" / "static state" effects where motion would
    feel wrong — petrified, dead, prone, restrained, deafened."""
    W, H = args.width, args.height
    emoji_img = fetch_emoji(args.emoji)
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    paste_emoji(frame, emoji_img, W / 2, H / 2, args.scale, 0, 1.0)
    # 6 frames so the encoder always has enough for a clean GOP. All
    # identical → VP9 inter-frame coder compresses them to nearly
    # nothing.
    return [frame] * 6


def render_fade(args: argparse.Namespace) -> List[Image.Image]:
    """Emoji at the canvas centre with opacity oscillating in/out
    smoothly. Used for "now-you-see-me" effects — invisible, ghost-
    like states.

    Seamless: opacity = (1 - cos(2π · u · pulses)) / 2, integer pulses
    per loop. Optional `--scale-pulse` to additionally breathe the
    scale by ±10% for an organic feel."""
    W, H = args.width, args.height
    total_frames = int(args.fps * args.duration)
    emoji_img = fetch_emoji(args.emoji)

    pulses = max(1, args.pulses)
    cx, cy = W / 2, H / 2

    frames: List[Image.Image] = []
    for f in range(total_frames):
        u = f / total_frames
        env = 0.5 - 0.5 * math.cos(2 * math.pi * u * pulses)
        # min..max alpha range so it never fully disappears (still
        # readable as "this is the buff icon").
        opacity = args.alpha_min + (args.alpha_max - args.alpha_min) * env
        scale = args.scale * (1.0 + (env - 0.5) * 0.10 if args.scale_pulse else 1.0)
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        paste_emoji(frame, emoji_img, cx, cy, scale, 0, opacity)
        frames.append(frame)
    return frames


def render_rain(args: argparse.Namespace) -> List[Image.Image]:
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
    "flash": {
        "renderer": render_flash,
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
    "orbit": {
        "renderer": render_orbit,
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
    "rain": {
        "renderer": render_rain,
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
    "float": {
        "renderer": render_float,
        "defaults": {
            "emoji":      "sparkling_heart",
            "count":      6,
            "cycles_min": 1,
            "cycles_max": 2,
            "scale_min":  0.16,
            "scale_max":  0.26,
            "x_jitter":   8,
            "margin":     14,
        },
    },
    "pulse": {
        "renderer": render_pulse,
        "defaults": {
            "emoji":     "target",
            "pulses":    2,           # integer beats per loop
            "scale_min": 0.35,
            "scale_max": 0.55,
        },
    },
    "radial": {
        "renderer": render_radial,
        "defaults": {
            "emoji":      "sparkles",
            "count":      8,
            "cycles_min": 1,
            "cycles_max": 1,
            "scale_min":  0.18,
            "scale_max":  0.28,
        },
    },
    "shake": {
        "renderer": render_shake,
        "defaults": {
            "emoji":      "angry",
            "shakes":     6,           # integer shakes per loop
            "amplitude":  0.08,        # fraction of width
            "tilt":       8,           # degrees of counter-tilt per shake
            "scale":      0.50,
        },
    },
    "static": {
        "renderer": render_static,
        "defaults": {
            "emoji": "skull",
            "scale": 0.55,
        },
    },
    "fade": {
        "renderer": render_fade,
        "defaults": {
            "emoji":       "ghost",
            "pulses":      1,
            "alpha_min":   0.20,
            "alpha_max":   1.00,
            "scale":       0.55,
            "scale_pulse": False,
        },
    },
    "ripple": {
        "renderer": render_ripple,
        "defaults": {
            "count":       3,
            "cycles":      1,
            "color":       "#ff66cc",
            "alpha_peak":  0.85,
            "line_width":  3,
            "center_x":    -1,    # auto (W/2)
            "center_y":    -1,    # auto (H/2)
            "radius_max":  0,     # auto (min(W,H) * 0.5)
        },
    },
    "place": {
        "renderer": render_place,
        "defaults": {
            "emoji":          "lightning",
            "x_frac":         0.5,
            "y_frac":         0.5,
            "scale":          0.6,
            "rotation":       0,
            "opacity":        1.0,
            "rotation_speed": 0,        # deg per loop
            "pulse_pulses":   0,        # 0 = no pulse animation
            "pulse_amp":      0.10,     # ±10% scale at peak
            "fade_pulses":    0,
            "fade_min":       0.3,
            "fade_max":       1.0,
            "tint":           "",       # "" or "#rrggbb"
            "mirror_x":       False,
            "mirror_y":       False,
        },
    },
    "drift": {
        "renderer": render_drift,
        "defaults": {
            "emoji":      "musical_note",
            "count":      5,
            "angle":      45,           # degrees, 0=up, 90=right, 180=down
            "cycles_min": 1,
            "cycles_max": 2,
            "scale_min":  0.14,
            "scale_max":  0.22,
            "spread":     0.5,          # fraction of max(W,H), perp to drift
            "tint":       "",
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

    p_para = sub.add_parser("flash", help="Random emoji flashes at random positions (麻痹类)")
    add_common_args(p_para)
    p_para.add_argument("--count", type=int)
    p_para.add_argument("--life-min", dest="life_min", type=float, help="min flash duration (s)")
    p_para.add_argument("--life-max", dest="life_max", type=float, help="max flash duration (s)")
    p_para.add_argument("--scale-min", dest="scale_min", type=float)
    p_para.add_argument("--scale-max", dest="scale_max", type=float)
    p_para.add_argument("--margin", type=int, help="px padding from canvas edge")

    p_dizzy = sub.add_parser("orbit", help="Emoji orbits ellipse above token (眩晕类)")
    add_common_args(p_dizzy)
    p_dizzy.add_argument("--count", type=int, help="number of orbiting emojis")
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

    p_poison = sub.add_parser("rain", help="Emojis raining down top-to-bottom (中毒类)")
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

    p_float = sub.add_parser("float", help="Emojis drifting upward (上升气泡)")
    add_common_args(p_float)
    p_float.add_argument("--count", type=int)
    p_float.add_argument("--cycles-min", dest="cycles_min", type=int)
    p_float.add_argument("--cycles-max", dest="cycles_max", type=int)
    p_float.add_argument("--scale-min", dest="scale_min", type=float)
    p_float.add_argument("--scale-max", dest="scale_max", type=float)
    p_float.add_argument("--x-jitter", dest="x_jitter", type=float)
    p_float.add_argument("--margin", type=int)

    p_pulse = sub.add_parser("pulse", help="Centre emoji scale pulse (呼吸)")
    add_common_args(p_pulse)
    p_pulse.add_argument("--pulses", type=int, help="integer beats per loop")
    p_pulse.add_argument("--scale-min", dest="scale_min", type=float)
    p_pulse.add_argument("--scale-max", dest="scale_max", type=float)

    p_radial = sub.add_parser("radial", help="Emojis radiate outward (向外扩散)")
    add_common_args(p_radial)
    p_radial.add_argument("--count", type=int)
    p_radial.add_argument("--cycles-min", dest="cycles_min", type=int)
    p_radial.add_argument("--cycles-max", dest="cycles_max", type=int)
    p_radial.add_argument("--scale-min", dest="scale_min", type=float)
    p_radial.add_argument("--scale-max", dest="scale_max", type=float)

    p_shake = sub.add_parser("shake", help="Centre emoji shake left-right (震颤)")
    add_common_args(p_shake)
    p_shake.add_argument("--shakes", type=int, help="integer shakes per loop")
    p_shake.add_argument("--amplitude", type=float, help="horizontal amplitude as fraction of W (default 0.08)")
    p_shake.add_argument("--tilt", type=float, help="degrees of counter-tilt per shake")
    p_shake.add_argument("--scale", type=float)

    p_static = sub.add_parser("static", help="Single static emoji (静止)")
    add_common_args(p_static)
    p_static.add_argument("--scale", type=float)

    p_fade = sub.add_parser("fade", help="Centre emoji opacity pulse (透明度呼吸)")
    add_common_args(p_fade)
    p_fade.add_argument("--pulses", type=int)
    p_fade.add_argument("--alpha-min", dest="alpha_min", type=float)
    p_fade.add_argument("--alpha-max", dest="alpha_max", type=float)
    p_fade.add_argument("--scale", type=float)
    p_fade.add_argument("--scale-pulse", dest="scale_pulse", action="store_true",
                        help="also breathe scale ±10%% along with opacity")

    # 2026-05-14b — three new templates for the custom buff lineup.
    p_ripple = sub.add_parser("ripple", help="Concentric expanding rings (魅惑)")
    add_common_args(p_ripple)
    p_ripple.add_argument("--count", type=int, help="number of rings (phase-staggered)")
    p_ripple.add_argument("--cycles", type=int, help="ring expansions per loop (integer)")
    p_ripple.add_argument("--color", type=str, help="hex like #ff66cc")
    p_ripple.add_argument("--alpha-peak", dest="alpha_peak", type=float, help="0..1 peak alpha")
    p_ripple.add_argument("--line-width", dest="line_width", type=int, help="ring stroke width in px")
    p_ripple.add_argument("--center-x", dest="center_x", type=float, help="X centre in px (-1=auto W/2)")
    p_ripple.add_argument("--center-y", dest="center_y", type=float, help="Y centre in px (-1=auto H/2)")
    p_ripple.add_argument("--radius-max", dest="radius_max", type=float, help="max ring radius in px (0=auto)")

    p_place = sub.add_parser("place", help="Single emoji at custom position with optional animation")
    add_common_args(p_place)
    p_place.add_argument("--x-frac",   dest="x_frac",   type=float, help="X centre, 0..1 fraction of W")
    p_place.add_argument("--y-frac",   dest="y_frac",   type=float, help="Y centre, 0..1 fraction of H")
    p_place.add_argument("--scale",    type=float, help="size as fraction of W")
    p_place.add_argument("--rotation", type=float, help="initial rotation in degrees")
    p_place.add_argument("--opacity",  type=float, help="static opacity 0..1")
    p_place.add_argument("--rotation-speed", dest="rotation_speed", type=float,
                         help="continuous rotation in degrees per loop (snapped to integer)")
    p_place.add_argument("--pulse-pulses", dest="pulse_pulses", type=int,
                         help="integer scale-breath count per loop (0=no pulse)")
    p_place.add_argument("--pulse-amp",    dest="pulse_amp",    type=float,
                         help="scale-breath amplitude 0..1 (0.10 = ±10%%)")
    p_place.add_argument("--fade-pulses",  dest="fade_pulses",  type=int)
    p_place.add_argument("--fade-min",     dest="fade_min",     type=float)
    p_place.add_argument("--fade-max",     dest="fade_max",     type=float)
    p_place.add_argument("--tint",         type=str, help="colour multiply, hex (e.g. #00ff00)")
    p_place.add_argument("--mirror-x",     dest="mirror_x",     action="store_true",
                         help="horizontal flip (mirrored wing etc.)")
    p_place.add_argument("--mirror-y",     dest="mirror_y",     action="store_true",
                         help="vertical flip (upside-down box etc.)")

    p_drift = sub.add_parser("drift", help="Particles drifting in a chosen direction (诗人激励, 劣势)")
    add_common_args(p_drift)
    p_drift.add_argument("--count",     type=int)
    p_drift.add_argument("--angle",     type=float, help="direction in degrees (0=up, 90=right, 180=down)")
    p_drift.add_argument("--cycles-min", dest="cycles_min", type=int)
    p_drift.add_argument("--cycles-max", dest="cycles_max", type=int)
    p_drift.add_argument("--scale-min",  dest="scale_min",  type=float)
    p_drift.add_argument("--scale-max",  dest="scale_max",  type=float)
    p_drift.add_argument("--spread",     type=float, help="perpendicular spread 0..1 (frac of max(W,H))")
    p_drift.add_argument("--tint",       type=str, help="colour multiply hex")

    # `compose` is a multi-layer mode — takes a JSON spec via --layers
    # and renders each layer onto the same canvas. Used for buffs that
    # need 2+ images (e.g. deafened = ear + X, flying = both wings).
    p_compose = sub.add_parser("compose", help="Multi-layer composition from a JSON spec")
    p_compose.add_argument("--out",      required=True)
    p_compose.add_argument("--width",    type=int,   default=192)
    p_compose.add_argument("--height",   type=int,   default=192)
    p_compose.add_argument("--duration", type=float, default=1.5)
    p_compose.add_argument("--fps",      type=int,   default=30)
    p_compose.add_argument("--seed",     type=int,   default=42)
    p_compose.add_argument("--codec",    choices=["vp9", "vp8"], default="vp9")
    p_compose.add_argument("--layers",   required=True,
                           help='JSON array of layer specs, each "{template,...params}"')

    return parser


def apply_defaults(args: argparse.Namespace, effect: str) -> argparse.Namespace:
    """Fill in any None CLI-defaultable fields from EFFECTS[effect]['defaults']."""
    for k, v in EFFECTS[effect]["defaults"].items():
        if getattr(args, k, None) is None:
            setattr(args, k, v)
    return args


def _render_compose(args: argparse.Namespace) -> List[Image.Image]:
    """Render multiple layers on the same canvas via the JSON --layers
    spec. Each layer entry is `{template: 'place', ...params}` where
    `params` mirrors the CLI flags for that template. Layers are
    composited in order (first = bottom).
    """
    import json
    try:
        spec = json.loads(args.layers)
    except Exception as e:
        raise SystemExit(f"--layers must be valid JSON array: {e}")
    if not isinstance(spec, list):
        raise SystemExit("--layers must be a JSON array of {template,...} objects")

    total_frames = int(args.fps * args.duration)
    # Pre-render each layer's frame list, then overlay frame-by-frame.
    layer_frames: List[List[Image.Image]] = []
    for layer in spec:
        if not isinstance(layer, dict) or "template" not in layer:
            raise SystemExit(f"layer entry malformed: {layer}")
        tmpl = layer["template"]
        if tmpl not in EFFECTS:
            raise SystemExit(f"unknown template '{tmpl}' in layer")
        # Build a Namespace mirroring this layer's params + global canvas.
        ns = argparse.Namespace(
            effect=tmpl,
            out=args.out,
            width=args.width,
            height=args.height,
            duration=args.duration,
            fps=args.fps,
            seed=args.seed,
            codec=args.codec,
            emoji=None,
        )
        for k, v in layer.items():
            if k == "template": continue
            setattr(ns, k, v)
        apply_defaults(ns, tmpl)
        renderer = EFFECTS[tmpl]["renderer"]
        layer_frames.append(renderer(ns))

    # Composite. All layers MUST have the same frame count (= total_frames).
    out_frames: List[Image.Image] = []
    for i in range(total_frames):
        canvas = Image.new("RGBA", (args.width, args.height), (0, 0, 0, 0))
        for lf in layer_frames:
            # static layers have only 6 frames — repeat via modulo so
            # they survive without bloating to total_frames-each.
            f = lf[i % len(lf)]
            canvas.alpha_composite(f)
        out_frames.append(canvas)
    return out_frames


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    print(f"[buff-fx] generating '{args.effect}' -> {args.out}", file=sys.stderr)
    if args.effect == "compose":
        # compose has its own renderer path that walks per-layer specs
        print(f"          (compose mode; layers JSON below)", file=sys.stderr)
        frames = _render_compose(args)
    else:
        args = apply_defaults(args, args.effect)
        renderer: Callable[[argparse.Namespace], List[Image.Image]] = EFFECTS[args.effect]["renderer"]
        print(f"          params: {vars(args)}", file=sys.stderr)
        frames = renderer(args)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_webm(frames, out, args.fps, args.codec)
    print(f"[buff-fx] done. {out.stat().st_size / 1024:.1f} KB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
