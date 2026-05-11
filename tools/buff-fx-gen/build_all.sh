#!/bin/bash
# Build the FULL buff-fx variant catalogue.
#
# Each variant = (template × emoji) producing one WebM at
# `public/buff-fx/{template}-{emoji}.webm`. The runtime catalog
# editor lets the user pick from any variant in this list and bind
# it to any buff.
#
# Also emits `public/buff-fx/manifest.json` with metadata for each
# variant — used by the editor UI to populate filters + thumbnails.
#
# After running, open tools/buff-fx-gen/preview.html in Chrome /
# Firefox to spot-check.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../public/buff-fx"
MANIFEST="$OUT/manifest.json"
mkdir -p "$OUT"

# A staging file accumulated line-by-line, sorted + wrapped into
# JSON at the end. Each line is one variant `id|template|emoji`.
STAGING="$(mktemp)"
trap 'rm -f "$STAGING"' EXIT

variant() {
  # Args:  template emoji [extra-cli-args...]
  local template="$1"; shift
  local emoji="$1"; shift
  local id="${template}-${emoji}"
  local out="$OUT/${id}.webm"
  echo
  echo "→ $template / $emoji"
  python "$HERE/buff_fx.py" "$template" --out "$out" --emoji "$emoji" "$@"
  echo "${id}|${template}|${emoji}" >> "$STAGING"
}

# ===== flash: random emoji pops at random positions ==============
variant flash lightning
variant flash boom        --count 5  --scale-min 0.22 --scale-max 0.50
variant flash sparkles    --count 10 --scale-min 0.15 --scale-max 0.30
variant flash fire        --count 6
variant flash star        --count 7
variant flash clown       --count 4  --scale-min 0.28 --scale-max 0.50

# ===== orbit: emoji orbits ellipse around top of canvas ==========
variant orbit dizzy
variant orbit sparkles    --count 5
variant orbit star        --count 4
variant orbit snowflake   --count 3 --spin-rate 0

# ===== rain: emoji falls top-to-bottom ===========================
variant rain test_tube
variant rain drop         --count 12 --scale-min 0.08 --scale-max 0.18
variant rain snake        --count 5  --scale-min 0.14 --scale-max 0.24
variant rain hourglass    --count 5  --cycles-min 1 --cycles-max 1 --scale-min 0.12 --scale-max 0.22
variant rain snowflake    --count 14 --scale-min 0.08 --scale-max 0.16
variant rain leaves       --count 6  --scale-min 0.14 --scale-max 0.24
variant rain cherry_blossom --count 9 --scale-min 0.10 --scale-max 0.20

# ===== float: emoji drifts upward from bottom ====================
variant float sparkling_heart
variant float musical_note   --count 5
variant float zzz            --count 4 --scale-min 0.18 --scale-max 0.30
variant float dove           --count 3 --scale-min 0.22 --scale-max 0.32
variant float wind           --count 5 --scale-min 0.18 --scale-max 0.28
variant float sparkles       --count 8
variant float tulip          --count 5 --scale-min 0.16 --scale-max 0.24

# ===== pulse: centre emoji scale breathing =======================
variant pulse target
variant pulse brain
variant pulse sloth          --pulses 1 --scale-min 0.50 --scale-max 0.60   # slow breathing
variant pulse sparkling_heart
variant pulse sun
variant pulse crystal_ball
variant pulse thumbs_up

# ===== radial: emoji emanates from centre outward ================
variant radial sparkles
variant radial snowflake     --count 12 --scale-min 0.14 --scale-max 0.22
variant radial star          --count 6
variant radial fire          --count 8  --scale-min 0.18 --scale-max 0.28
variant radial moon          --count 5
variant radial sun           --count 5

# ===== shake: centre emoji left-right shake ======================
variant shake angry
variant shake screaming      --shakes 8 --amplitude 0.06
variant shake cold_face      --shakes 12 --amplitude 0.04 --tilt 4   # shivering
variant shake rage

# ===== static: single emoji centred, no motion ===================
variant static skull
variant static moai
variant static headphones
variant static sunglasses
variant static chains
variant static broken_heart
variant static people_hugging
variant static otter
variant static thumbs_up
variant static red_envelope
variant static crystal_ball  # repurposable

# ===== fade: opacity in/out =====================================
variant fade ghost
variant fade sparkles
variant fade broken_heart

# ===== build manifest.json ======================================
echo
echo "→ writing $MANIFEST"
python - "$STAGING" "$MANIFEST" <<'PY'
import json, sys, os
staging, manifest_path = sys.argv[1], sys.argv[2]
variants = []
with open(staging) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        id_, template, emoji = line.split("|", 2)
        path = f"buff-fx/{id_}.webm"
        full = os.path.join(os.path.dirname(manifest_path), f"{id_}.webm")
        size_kb = round(os.path.getsize(full) / 1024, 1) if os.path.exists(full) else None
        variants.append({
            "id":       id_,
            "template": template,
            "emoji":    emoji,
            "asset":    path,
            "size_kb":  size_kb,
        })
variants.sort(key=lambda v: (v["template"], v["emoji"]))
out = {
    "schema_version": 1,
    "generated_at_note": "regenerate via tools/buff-fx-gen/build_all.sh",
    "variants": variants,
}
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
print(f"  wrote {len(variants)} variants")
PY

echo
echo "All variants built. Manifest: $MANIFEST"
ls -la "$OUT"/*.webm 2>&1 | awk '{ printf "  %-50s %5.1f KB\n", $9, $5/1024 }'
echo
echo "Verify alpha by opening tools/buff-fx-gen/preview.html in a browser."
