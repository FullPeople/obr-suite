// Status Tracker — buff effect shaders.
//
// === How effects are added ============================================
// EFFECT items are NOT accepted by `OBR.scene.items.addItems` — that
// validator only allows [CURVE, IMAGE, LABEL, LINE, POINTER, RULER,
// SHAPE, TEXT, PATH]. We add Effect items via `OBR.scene.local`
// instead (per-client items). This means animated shader effects
// only render on the GM's screen — players don't see them. The
// static buff bubble IS shared across clients (it goes through
// scene.items as a Path).
//
// === SkSL conventions =================================================
// OBR auto-injects:
//   uniform vec2  size;      // effect bbox in scene units
//   uniform float time;      // seconds since the effect was created
// We add:
//   uniform vec3 u_color;    // buff color, RGB in 0..1
//
// SkSL gotchas:
//   • Uniforms must be `vec2/vec3` not `float2/float3`.
//   • Entry: `half4 main(float2 coord)`.
//   • `for` loops with int counter ARE permitted (we tested via
//     simpler shaders — the issue all along was scene.items
//     rejecting type EFFECT, not the shader code).

import type { BuffEffect } from "./types";

const HEAD = `uniform vec2 size;
uniform float time;
uniform vec3 u_color;
`;

export const SHADER_DEFAULT = "";

// === float — particles drift up from bottom ========================
// 6 deterministic particles at fixed horizontal positions, vertical
// phase offset by index so they don't all rise in lock-step.
export const SHADER_FLOAT = `${HEAD}
half4 main(float2 coord) {
  vec2 uv = coord / size;
  float a = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float speed = 0.25 + fi * 0.04;
    float xOff = 0.18 + fi * 0.13;
    float r = 0.06;
    float t = fract(time * speed + fi * 0.27);
    vec2 pp = vec2(xOff, 1.0 - t);
    float d = distance(uv, pp);
    float fade = sin(t * 3.14159);
    a = max(a, smoothstep(r, 0.0, d) * fade);
  }
  return half4(u_color * a, a);
}`;

// === drop — particles fall from top ================================
export const SHADER_DROP = `${HEAD}
half4 main(float2 coord) {
  vec2 uv = coord / size;
  float a = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float speed = 0.25 + fi * 0.04;
    float xOff = 0.18 + fi * 0.13;
    float r = 0.06;
    float t = fract(time * speed + fi * 0.27);
    vec2 pp = vec2(xOff, t);
    float d = distance(uv, pp);
    float fade = sin(t * 3.14159);
    a = max(a, smoothstep(r, 0.0, d) * fade);
  }
  return half4(u_color * a, a);
}`;

// === flicker — random twinkles inside =============================
// Each cycle picks a fresh pseudo-random position derived from the
// integer cycle count + index, giving an "always somewhere new"
// blink pattern.
export const SHADER_FLICKER = `${HEAD}
half4 main(float2 coord) {
  vec2 uv = coord / size;
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float period = 1.2 + fi * 0.15;
    float phase = fi * 0.31;
    float t = fract(time / period + phase);
    float cycle = floor(time / period + phase);
    float px = fract(sin(cycle * 7.13 + fi * 4.7) * 43758.0);
    float py = fract(sin(cycle * 5.93 + fi * 8.1) * 43758.0);
    vec2 pp = vec2(0.15 + px * 0.7, 0.15 + py * 0.7);
    float r = 0.06;
    float d = distance(uv, pp);
    float pulse = smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.55, 1.0, t));
    a = max(a, smoothstep(r, 0.0, d) * pulse);
  }
  return half4(u_color * a, a);
}`;

// === curve — bardic music notes sweeping outward ==================
export const SHADER_CURVE = `${HEAD}
half4 main(float2 coord) {
  vec2 uv = (coord - size * 0.5) / (size.y * 0.5);
  float a = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float speed = 0.20 + fi * 0.025;
    float t = fract(time * speed + fi * 0.31);
    float baseAng = fi * 1.04719;
    float radius = t * 1.3;
    float wobble = sin(t * 9.42 + fi) * 0.18 * t;
    float ang = baseAng + wobble;
    vec2 pp = vec2(cos(ang), sin(ang)) * radius;
    float r = 0.07;
    float d = distance(uv, pp);
    float fade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.65, 1.0, t));
    a = max(a, smoothstep(r, 0.0, d) * fade);
  }
  return half4(u_color * a, a);
}`;

// === spread — concentric ripples expanding from centre =============
export const SHADER_SPREAD = `${HEAD}
half4 main(float2 coord) {
  vec2 uv = (coord - size * 0.5) / (size.y * 0.5);
  float dist = length(uv);
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = fract(time * 0.45 + fi / 3.0);
    float ringR = t * 1.05;
    float ringW = 0.08 + 0.03 * (1.0 - t);
    float band = smoothstep(ringW, 0.0, abs(dist - ringR));
    float fade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.85, 1.0, t));
    a = max(a, band * fade * 0.85);
  }
  return half4(u_color * a, a);
}`;

export function shaderFor(effect: BuffEffect): string {
  switch (effect) {
    case "float":   return SHADER_FLOAT;
    case "drop":    return SHADER_DROP;
    case "flicker": return SHADER_FLICKER;
    case "curve":   return SHADER_CURVE;
    case "spread":  return SHADER_SPREAD;
    case "default": return SHADER_DEFAULT;
    default:        return SHADER_DEFAULT;
  }
}

export function isBelowTokenEffect(effect: BuffEffect): boolean {
  return effect === "curve" || effect === "spread";
}

export function effectBoxScale(effect: BuffEffect): number {
  switch (effect) {
    case "float":   return 1.7;
    case "drop":    return 1.7;
    case "flicker": return 1.0;
    case "curve":   return 2.6;
    case "spread":  return 2.4;
    case "default": return 0;
    default:        return 0;
  }
}
