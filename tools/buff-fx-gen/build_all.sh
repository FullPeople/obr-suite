#!/bin/bash
# Build the full buff-fx catalogue into public/buff-fx/.
# Add new entries as the status-tracker catalogue grows.
#
# After running, open tools/buff-fx-gen/preview.html in a browser to
# visually verify alpha is preserved (ffmpeg's CLI can't read WebM
# BlockAdditional alpha back, but browsers can).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../public/buff-fx"
mkdir -p "$OUT"

run() {
  echo
  echo "→ $@"
  python "$HERE/buff_fx.py" "$@"
}

# === D&D 5e default condition set ====================================

# 麻痹 / paralysis — lightning sparks at random positions
run paralysis --out "$OUT/paralysis.webm" \
              --emoji lightning --count 6 \
              --life-min 0.18 --life-max 0.38 \
              --scale-min 0.18 --scale-max 0.42

# 眩晕 / dizzy — swirly stars orbit above the token
run dizzy --out "$OUT/dizzy.webm" \
          --emoji dizzy --count 3 --period 1.5 \
          --scale-min 0.18 --scale-max 0.30

# 中毒 / poison — test-tube emojis fall like rain.
# cycles ∈ [1, 2] = each drop falls 1 or 2 times per 1.5 s loop. Integer
# cycles are REQUIRED for seamless wrap; the legacy --speed-* args
# silently round to integer cycles and warn on stderr.
run poison --out "$OUT/poison.webm" \
           --emoji test_tube --count 8 \
           --cycles-min 1 --cycles-max 2 \
           --scale-min 0.12 --scale-max 0.22

# === Cheap variants (palette extras) =================================
# Same effect family, different emoji — caller can pick by URL.

# Burning: fire emoji raining up (= falling with negative speed not
# supported, so we re-use the dizzy renderer with the fire emoji).
# Skipped for now; example of how to add more:
# run poison --out "$OUT/poison-snake.webm" --emoji snake --count 6 --speed-min 60 --speed-max 130

echo
echo "All effects built. Sizes:"
ls -la "$OUT"/*.webm 2>&1 | awk '{ printf "  %-30s %5.1f KB\n", $9, $5/1024 }'
echo
echo "Verify alpha by opening tools/buff-fx-gen/preview.html in Chrome/Firefox."
