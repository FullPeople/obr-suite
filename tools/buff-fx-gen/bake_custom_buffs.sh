#!/bin/bash
# Bake the 9 customised buff effects per user spec (2026-05-14b).
#
# These are NOT generic catalog variants — they are SPECIFIC effects
# matched to specific D&D conditions, using the new templates
# (ripple, place, drift) plus compose for multi-layer cases.
#
# Each output is named `custom-{buff-id}.webm` to make it easy to
# spot in the catalog.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../public/buff-fx"
mkdir -p "$OUT"

run() {
  echo
  echo "→ $@"
  python "$HERE/buff_fx.py" "$@"
}

# ============================================================
# 1. 魅惑 charmed — pink translucent ripples from centre outward
# ============================================================
run ripple --out "$OUT/custom-charmed.webm" \
           --count 3 --cycles 1 \
           --color "#ff66cc" --alpha-peak 0.75 \
           --line-width 4

# ============================================================
# 2. 隐形 invisible — upside-down box covering top 40% of token,
#    70% of token width. Centre vertically at y=0.20 so the box
#    bottom sits at the 40% line; width via scale ≈ 0.70.
#    mirror_y flips it upside down so the "open mouth" sits down.
# ============================================================
run place --out "$OUT/custom-invisible.webm" \
          --emoji box \
          --x-frac 0.5 --y-frac 0.20 \
          --scale 0.70 \
          --mirror-y

# ============================================================
# 3. 诗人激励 bardic — music notes drift up-and-to-the-right,
#    extending far beyond the token bounds (canvas 2× normal size
#    so the path can be long). Plugin applies webmScale 1.0; the
#    canvas itself is bigger so the effect "leaks" past the token.
# ============================================================
run drift --out "$OUT/custom-bardic.webm" \
          --emoji musical_note --count 4 \
          --width 320 --height 320 \
          --angle 45 \
          --cycles-min 1 --cycles-max 2 \
          --scale-min 0.14 --scale-max 0.22 \
          --spread 0.4

# ============================================================
# 4. 劣势 disadvantage (was 被骂) — blue down-arrow falls top→bottom.
#    Use 🔻 (down triangle) tinted blue. Single column down the
#    centre, slow speed so it's a clear "debuff" reading.
# ============================================================
run drift --out "$OUT/custom-disadvantage.webm" \
          --emoji down_arrow --count 3 \
          --angle 180 \
          --cycles-min 1 --cycles-max 1 \
          --scale-min 0.30 --scale-max 0.40 \
          --spread 0.2 \
          --tint "#3b82f6"

# ============================================================
# 5. 耳聋 deafened — ear at far right + red X overlaid on it.
#    Uses compose (2 layers).
# ============================================================
run compose --out "$OUT/custom-deafened.webm" --layers '[
  {"template":"place","emoji":"ear","x_frac":0.82,"y_frac":0.50,"scale":0.45},
  {"template":"place","emoji":"cross_mark","x_frac":0.82,"y_frac":0.50,"scale":0.32,"opacity":0.90}
]'

# ============================================================
# 6. 缓慢术 slowed — hourglass at bottom-left corner, slowly
#    rotating (1 full turn per loop = continuous slow spin).
# ============================================================
run place --out "$OUT/custom-slowed.webm" \
          --emoji hourglass \
          --x-frac 0.18 --y-frac 0.82 \
          --scale 0.40 \
          --rotation-speed 360

# ============================================================
# 7. 猎人印记 hunters_mark — green X above token head, breathing
#    (scale pulses). User wanted GREEN X — tint cross_mark green.
# ============================================================
run place --out "$OUT/custom-hunters_mark.webm" \
          --emoji cross_mark \
          --x-frac 0.5 --y-frac 0.15 \
          --scale 0.30 \
          --pulse-pulses 2 --pulse-amp 0.20 \
          --tint "#00ff44"

# ============================================================
# 8. 冰冻 frozen — ice cube covers the whole token, slight pulse
#    so it feels alive but mostly stable.
# ============================================================
run place --out "$OUT/custom-frozen.webm" \
          --emoji ice_cube \
          --x-frac 0.5 --y-frac 0.5 \
          --scale 0.92 \
          --opacity 0.80 \
          --pulse-pulses 1 --pulse-amp 0.04

# ============================================================
# 9. 飞行术 flying — feather/wing on left + right (mirrored).
#    Use compose with two place layers, one mirrored.
# ============================================================
run compose --out "$OUT/custom-flying.webm" --layers '[
  {"template":"place","emoji":"feather","x_frac":0.18,"y_frac":0.55,"scale":0.45,"rotation":-25,"mirror_x":true},
  {"template":"place","emoji":"feather","x_frac":0.82,"y_frac":0.55,"scale":0.45,"rotation":25}
]'

# guidance (神导术) intentionally skipped — user undecided.

echo
echo "All 9 custom buffs baked."
ls -la "$OUT"/custom-*.webm 2>&1 | awk '{ printf "  %-50s %5.1f KB\n", $9, $5/1024 }'
