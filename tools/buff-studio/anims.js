// anims.js — per-layer animation library for Buff Studio.
//
// Each animation is param-driven and produces a list of "instances"
// (sprite copies to draw) for a normalized loop position u ∈ [0,1).
// Transform anims return 1 instance (move / scale / rotate / fade the
// one sprite); particle anims return N. Every anim is seamless:
// state(u=0) ≡ state(u=1), achieved by using only integer-cycle
// periodic functions, or per-particle phase offsets whose alpha
// fades to 0 at the loop wrap.
//
//   instance = { dx, dy, dscale, drot, dalpha }
//     dx, dy  — position offset in canvas-fraction units (+ layer.x/y)
//     dscale  — scale multiplier (× layer.scale)
//     drot    — rotation offset in degrees (+ layer.rotation)
//     dalpha  — alpha multiplier (× layer.opacity)

const TAU = Math.PI * 2;

// Cheap deterministic pseudo-random, integer seed → [0,1). Used to
// scatter particles consistently (same layout every frame & every
// re-render — important so the baked output matches the preview).
function hash(n) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15; h = (h * 2246822519) >>> 0;
  h ^= h >>> 13; h = (h * 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const ONE = () => ({ dx: 0, dy: 0, dscale: 1, drot: 0, dalpha: 1 });
const P = (key, label, min, max, step, def) => ({ key, label, min, max, step, default: def });

// Sharp positive bump, 1 per cycle, periodic in u → seamless.
const beat = (x) => Math.pow(Math.max(0, Math.sin(x)), 6);
// Edge fade-in/out for particle lifetimes so the loop-wrap is invisible.
const edgeFade = (t, k = 5) => Math.min(1, t * k) * Math.min(1, (1 - t) * k);

export const ANIMS = {
  // ---------------- transform anims (single sprite) ----------------
  none: {
    label: "无", kind: "transform", params: [],
    instances: () => [ONE()],
  },
  pulse: {
    label: "脉冲缩放", kind: "transform",
    params: [P("amp", "缩放幅度", 0.05, 0.9, 0.05, 0.2), P("cycles", "周期数", 1, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      i.dscale = 1 + p.amp * Math.sin(TAU * p.cycles * u);
      return [i];
    },
  },
  bob: {
    label: "上下浮动", kind: "transform",
    params: [P("amp", "幅度", 0.02, 0.5, 0.02, 0.1), P("cycles", "周期数", 1, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      i.dy = p.amp * Math.sin(TAU * p.cycles * u);
      return [i];
    },
  },
  sway: {
    label: "左右摇摆", kind: "transform",
    params: [P("amp", "幅度", 0.02, 0.5, 0.02, 0.1), P("cycles", "周期数", 1, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      i.dx = p.amp * Math.sin(TAU * p.cycles * u);
      return [i];
    },
  },
  orbit: {
    label: "自身环绕", kind: "transform",
    params: [P("radius", "半径", 0.02, 0.5, 0.02, 0.12), P("cycles", "圈数", 1, 8, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      i.dx = p.radius * Math.cos(ph);
      i.dy = p.radius * Math.sin(ph);
      return [i];
    },
  },
  spin: {
    label: "旋转", kind: "transform",
    params: [P("turns", "圈数", 1, 8, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      i.drot = 360 * p.turns * u;
      return [i];
    },
  },
  wobble: {
    label: "摇晃", kind: "transform",
    params: [P("amp", "角度", 5, 90, 5, 20), P("cycles", "周期数", 1, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      i.drot = p.amp * Math.sin(TAU * p.cycles * u);
      return [i];
    },
  },
  fade: {
    label: "淡入淡出", kind: "transform",
    params: [P("min", "最低透明度", 0, 0.9, 0.05, 0.15), P("cycles", "周期数", 1, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      const s = 0.5 + 0.5 * Math.cos(TAU * p.cycles * u);
      i.dalpha = p.min + (1 - p.min) * s;
      return [i];
    },
  },
  blink: {
    label: "闪烁", kind: "transform",
    params: [P("cycles", "频率", 1, 14, 1, 5), P("duty", "亮起占比", 0.1, 0.9, 0.05, 0.5)],
    instances: (p, u) => {
      const i = ONE();
      i.dalpha = ((p.cycles * u) % 1) < p.duty ? 1 : 0.05;
      return [i];
    },
  },
  shake: {
    label: "抖动", kind: "transform",
    params: [P("amp", "幅度", 0.01, 0.3, 0.01, 0.05), P("cycles", "频率", 2, 14, 1, 6)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      // Only integer harmonics of the base frequency → seamless loop.
      i.dx = p.amp * (Math.sin(ph) * 0.6 + Math.sin(ph * 3) * 0.4);
      i.dy = p.amp * (Math.cos(ph * 2) * 0.6 + Math.cos(ph * 5) * 0.4);
      return [i];
    },
  },
  heartbeat: {
    label: "心跳", kind: "transform",
    params: [P("amp", "幅度", 0.05, 0.8, 0.05, 0.25), P("cycles", "周期数", 1, 6, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      i.dscale = 1 + p.amp * (beat(ph) + 0.55 * beat(ph - 1.0));
      return [i];
    },
  },
  breathe: {
    label: "呼吸", kind: "transform",
    params: [P("amp", "幅度", 0.05, 0.6, 0.05, 0.15), P("cycles", "周期数", 1, 5, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      const s = Math.sin(TAU * p.cycles * u);
      i.dscale = 1 + p.amp * s;
      i.dalpha = 0.7 + 0.3 * (0.5 + 0.5 * s);
      return [i];
    },
  },
  drift: {
    label: "漂移", kind: "transform",
    params: [P("radius", "半径", 0.03, 0.4, 0.02, 0.14), P("cycles", "周期数", 1, 5, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      i.dx = p.radius * Math.cos(ph);
      i.dy = p.radius * 0.6 * Math.sin(ph);
      return [i];
    },
  },

  // ---------------- particle anims (N sprites) ----------------
  sparkle: {
    label: "闪烁粒子", kind: "particle",
    params: [
      P("count", "数量", 3, 40, 1, 12), P("spread", "范围", 0.05, 0.7, 0.05, 0.3),
      P("size", "粒子大小", 0.1, 1.2, 0.05, 0.4), P("cycles", "闪烁频率", 1, 8, 1, 3),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const rx = (hash(k * 2 + 1) - 0.5) * 2 * p.spread;
        const ry = (hash(k * 2 + 9) - 0.5) * 2 * p.spread;
        const tw = 0.5 + 0.5 * Math.cos(TAU * p.cycles * ((u + hash(k * 5 + 3)) % 1));
        out.push({ dx: rx, dy: ry, dscale: p.size * (0.55 + 0.45 * tw), drot: 0, dalpha: tw });
      }
      return out;
    },
  },
  radial: {
    label: "粒子迸发", kind: "particle",
    params: [
      P("count", "数量", 3, 32, 1, 10), P("radius", "扩散半径", 0.1, 0.8, 0.05, 0.4),
      P("size", "粒子大小", 0.1, 1.2, 0.05, 0.35), P("cycles", "迸发次数", 1, 6, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * TAU + hash(k) * 0.6;
        const t = ((u * p.cycles) + hash(k * 3 + 1)) % 1;
        const r = t * p.radius;
        out.push({
          dx: Math.cos(ang) * r, dy: Math.sin(ang) * r,
          dscale: p.size * (0.4 + 0.6 * (1 - t)), drot: 0,
          dalpha: Math.min(1, t * 4) * (1 - t),
        });
      }
      return out;
    },
  },
  rain: {
    label: "从上往下", kind: "particle",
    params: [
      P("count", "数量", 3, 32, 1, 12), P("speed", "速度", 1, 6, 1, 2),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.3), P("spread", "横向范围", 0.1, 1.0, 0.05, 0.8),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const t = ((u * p.speed) + hash(k * 7 + 2)) % 1;
        out.push({
          dx: (hash(k * 3 + 5) - 0.5) * p.spread,
          dy: -0.7 + t * 1.4,
          dscale: p.size, drot: 0, dalpha: edgeFade(t),
        });
      }
      return out;
    },
  },
  rise: {
    label: "从下往上", kind: "particle",
    params: [
      P("count", "数量", 3, 32, 1, 12), P("speed", "速度", 1, 6, 1, 2),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.3), P("spread", "横向范围", 0.1, 1.0, 0.05, 0.6),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 7 + 2);
        const t = ((u * p.speed) + ph) % 1;
        out.push({
          dx: (hash(k * 3 + 5) - 0.5) * p.spread + Math.sin(TAU * ((u + ph) % 1)) * 0.05,
          dy: 0.7 - t * 1.4,
          dscale: p.size * (0.7 + 0.3 * Math.sin(TAU * ((u * 2 + ph) % 1))),
          drot: 0, dalpha: edgeFade(t),
        });
      }
      return out;
    },
  },
  ring: {
    label: "环绕粒子", kind: "particle",
    params: [
      P("count", "数量", 2, 16, 1, 5), P("radius", "半径", 0.05, 0.5, 0.05, 0.22),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.4), P("cycles", "转速", 1, 6, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * TAU + TAU * p.cycles * u;
        out.push({
          dx: Math.cos(ang) * p.radius,
          dy: Math.sin(ang) * p.radius * 0.5,
          dscale: p.size, drot: 0, dalpha: 1,
        });
      }
      return out;
    },
  },
  swirl: {
    label: "漩涡", kind: "particle",
    params: [
      P("count", "数量", 3, 32, 1, 12), P("radius", "半径", 0.1, 0.7, 0.05, 0.35),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.3), P("cycles", "旋转次数", 1, 6, 1, 2),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const t = ((u * p.cycles) + hash(k * 11 + 4)) % 1;
        const ang = t * TAU * 2 + (k / n) * TAU;
        const r = (1 - t) * p.radius;
        out.push({
          dx: Math.cos(ang) * r, dy: Math.sin(ang) * r,
          dscale: p.size, drot: 0,
          dalpha: Math.min(1, t * 5) * (1 - t),
        });
      }
      return out;
    },
  },
  fountain: {
    label: "喷泉", kind: "particle",
    params: [
      P("count", "数量", 3, 32, 1, 12), P("spread", "散开", 0.05, 0.6, 0.05, 0.2),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.3), P("cycles", "喷发次数", 1, 5, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const t = ((u * p.cycles) + hash(k * 13 + 6)) % 1;
        const vx = (hash(k * 3 + 1) - 0.5) * 2 * p.spread;
        out.push({
          dx: vx * t,
          dy: -0.6 * 4 * t * (1 - t),
          dscale: p.size, drot: 0, dalpha: edgeFade(t, 6),
        });
      }
      return out;
    },
  },

  // ======== more transform anims (2026-05-15 — buff studio →50) ========
  tilt: {
    label: "倾斜摇摆", kind: "transform",
    params: [P("angle", "固定角度", -180, 180, 5, 0), P("amp", "摆动幅度", 0, 80, 5, 18), P("cycles", "周期数", 1, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      i.drot = p.angle + p.amp * Math.sin(TAU * p.cycles * u);
      return [i];
    },
  },
  bounce: {
    label: "弹跳", kind: "transform",
    params: [P("height", "弹跳高度", 0.05, 0.6, 0.05, 0.22), P("bounces", "弹跳次数", 1, 6, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      // |sin| → seamless (0 at u=0 and u=1 for integer bounces), gravity-ish feel.
      i.dy = -p.height * Math.abs(Math.sin(Math.PI * p.bounces * u));
      return [i];
    },
  },
  zoomPulse: {
    label: "缩放脉冲", kind: "transform",
    params: [
      P("maxScale", "最大缩放", 1.1, 3, 0.1, 1.8), P("cycles", "脉冲次数", 1, 6, 1, 2),
      P("opacityStart", "初始透明度", 0, 1, 0.05, 0.9), P("opacityEnd", "结尾透明度", 0, 1, 0.05, 0),
    ],
    instances: (p, u) => {
      const i = ONE();
      const t = (u * p.cycles) % 1;
      i.dscale = 1 + (p.maxScale - 1) * t;
      i.dalpha = p.opacityStart + (p.opacityEnd - p.opacityStart) * t;
      return [i];
    },
  },
  flicker: {
    label: "火光闪烁", kind: "transform",
    params: [P("intensity", "闪烁强度", 0.1, 0.9, 0.05, 0.4), P("speed", "闪烁频率", 2, 16, 1, 7)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.speed * u;
      // integer harmonics only → seamless; layered sines fake torch-flicker.
      const n = Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.25 + Math.sin(ph * 3) * 0.15;
      i.dalpha = 1 - p.intensity * (0.5 + 0.5 * n);
      i.dscale = 1 + p.intensity * 0.08 * n;
      return [i];
    },
  },
  pendulum: {
    label: "钟摆", kind: "transform",
    params: [P("amp", "摆动角度", 5, 80, 5, 35), P("cycles", "周期数", 1, 6, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      const s = Math.sin(TAU * p.cycles * u);
      i.drot = p.amp * s;
      i.dx = 0.04 * s;
      i.dy = 0.02 * (1 - Math.cos(TAU * p.cycles * u));
      return [i];
    },
  },
  figure8: {
    label: "8 字环绕", kind: "transform",
    params: [P("width", "横向幅度", 0.05, 0.5, 0.05, 0.2), P("height", "纵向幅度", 0.05, 0.5, 0.05, 0.12), P("cycles", "周期数", 1, 5, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      i.dx = p.width * Math.sin(ph);
      i.dy = p.height * Math.sin(2 * ph);
      return [i];
    },
  },
  recoil: {
    label: "后坐冲击", kind: "transform",
    params: [P("dist", "冲击距离", 0.02, 0.4, 0.02, 0.12), P("angle", "冲击方向", -180, 180, 15, 0), P("cycles", "冲击次数", 1, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      const k = beat(TAU * p.cycles * u);
      const a = p.angle * Math.PI / 180;
      i.dx = Math.cos(a) * p.dist * k;
      i.dy = Math.sin(a) * p.dist * k;
      i.dscale = 1 + 0.12 * k;
      return [i];
    },
  },
  wiggle: {
    label: "扭动", kind: "transform",
    params: [P("amp", "扭动角度", 3, 45, 3, 12), P("speed", "扭动频率", 2, 16, 1, 8)],
    instances: (p, u) => {
      const i = ONE();
      i.drot = p.amp * Math.sin(TAU * p.speed * u);
      return [i];
    },
  },
  hover: {
    label: "悬浮", kind: "transform",
    params: [P("bobAmp", "浮动幅度", 0.02, 0.3, 0.02, 0.08), P("rotAmp", "摆动角度", 0, 30, 2, 6), P("cycles", "周期数", 1, 5, 1, 1)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      i.dy = p.bobAmp * Math.sin(ph);
      i.drot = p.rotAmp * Math.sin(ph + Math.PI / 2);
      return [i];
    },
  },
  corkscrew: {
    label: "螺旋自转", kind: "transform",
    params: [P("radius", "环绕半径", 0.02, 0.4, 0.02, 0.12), P("cycles", "环绕圈数", 1, 6, 1, 1), P("spin", "自转圈数", 0, 8, 1, 2)],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      i.dx = p.radius * Math.cos(ph);
      i.dy = p.radius * Math.sin(ph);
      i.drot = 360 * p.spin * u;
      return [i];
    },
  },
  glitch: {
    label: "故障跳动", kind: "transform",
    params: [P("amp", "跳动幅度", 0.01, 0.3, 0.01, 0.06), P("steps", "跳动次数", 2, 20, 1, 8)],
    instances: (p, u) => {
      const i = ONE();
      // stepped pseudo-random jitter; %steps wraps the last step back to
      // the first so state(u=1) ≡ state(u=0).
      const seed = Math.floor(u * p.steps) % p.steps;
      i.dx = (hash(seed * 2 + 1) - 0.5) * 2 * p.amp;
      i.dy = (hash(seed * 2 + 7) - 0.5) * 2 * p.amp;
      i.dalpha = 0.7 + 0.3 * hash(seed * 3 + 5);
      return [i];
    },
  },
  levitate: {
    label: "漂浮升降", kind: "transform",
    params: [
      P("amp", "升降幅度", 0.03, 0.4, 0.02, 0.12), P("rotAmp", "倾斜角度", 0, 40, 2, 8),
      P("scaleAmp", "缩放呼吸", 0, 0.3, 0.02, 0.06), P("cycles", "周期数", 1, 5, 1, 1),
    ],
    instances: (p, u) => {
      const i = ONE();
      const ph = TAU * p.cycles * u;
      i.dy = -p.amp * Math.sin(ph);
      i.drot = p.rotAmp * Math.sin(ph - Math.PI / 3);
      i.dscale = 1 + p.scaleAmp * Math.cos(ph);
      return [i];
    },
  },

  // ======== more particle anims (2026-05-15 — buff studio →50) ========
  musicNotes: {
    label: "悠扬乐符", kind: "particle",
    params: [
      P("count", "数量", 2, 16, 1, 6), P("rise", "上升高度", 0.3, 1.4, 0.05, 0.95),
      P("drift", "横向漂移", 0, 0.5, 0.02, 0.18), P("sway", "摆动幅度", 0, 0.2, 0.01, 0.06),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.45), P("speed", "上升速度", 1, 4, 1, 1),
      P("spin", "翻转角度", 0, 60, 5, 18),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 7 + 3);
        const t = ((u * p.speed) + ph) % 1;
        const dir = (k % 2 === 0) ? 1 : -1;
        const sway = Math.sin(TAU * (t * 2 + ph)) * p.sway;
        out.push({
          dx: dir * p.drift * t + sway + (hash(k * 3 + 1) - 0.5) * 0.12,
          dy: 0.35 - t * p.rise,
          dscale: p.size * (0.7 + 0.3 * Math.sin(TAU * (t + ph))),
          drot: Math.sin(TAU * (t + ph)) * p.spin,
          dalpha: edgeFade(t, 4),
        });
      }
      return out;
    },
  },
  bubbles: {
    label: "气泡上升", kind: "particle",
    params: [
      P("count", "数量", 3, 30, 1, 12), P("speed", "上升速度", 1, 5, 1, 2),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.35), P("spread", "横向范围", 0.1, 1.0, 0.05, 0.6),
      P("wobble", "晃动幅度", 0, 0.15, 0.01, 0.05),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 7 + 2);
        const t = ((u * p.speed) + ph) % 1;
        out.push({
          dx: (hash(k * 3 + 5) - 0.5) * p.spread + Math.sin(TAU * (t * 3 + ph)) * p.wobble,
          dy: 0.6 - t * 1.2,
          dscale: p.size * (0.5 + 0.5 * t),
          drot: 0,
          dalpha: edgeFade(t, 4),
        });
      }
      return out;
    },
  },
  embers: {
    label: "火星升腾", kind: "particle",
    params: [
      P("count", "数量", 4, 40, 1, 16), P("speed", "上升速度", 1, 5, 1, 2),
      P("size", "粒子大小", 0.05, 0.6, 0.05, 0.18), P("spread", "横向范围", 0.1, 0.9, 0.05, 0.45),
      P("opacityStart", "初始透明度", 0, 1, 0.05, 1), P("opacityEnd", "结尾透明度", 0, 1, 0.05, 0),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 9 + 4);
        const t = ((u * p.speed) + ph) % 1;
        const flick = 0.6 + 0.4 * Math.sin(TAU * (t * 6 + ph));
        out.push({
          dx: (hash(k * 3 + 1) - 0.5) * p.spread + Math.sin(TAU * (t * 2 + ph)) * 0.06,
          dy: 0.55 - t * 1.1,
          dscale: p.size * flick,
          drot: 0,
          dalpha: (p.opacityStart + (p.opacityEnd - p.opacityStart) * t) * Math.min(1, t * 6) * flick,
        });
      }
      return out;
    },
  },
  snow: {
    label: "飘雪", kind: "particle",
    params: [
      P("count", "数量", 4, 40, 1, 18), P("speed", "下落速度", 1, 4, 1, 1),
      P("size", "粒子大小", 0.05, 0.6, 0.05, 0.18), P("spread", "横向范围", 0.2, 1.2, 0.05, 1.0),
      P("sway", "飘摆幅度", 0, 0.2, 0.01, 0.08),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 7 + 1);
        const t = ((u * p.speed) + ph) % 1;
        out.push({
          dx: (hash(k * 3 + 4) - 0.5) * p.spread + Math.sin(TAU * (t + ph)) * p.sway,
          dy: -0.65 + t * 1.3,
          dscale: p.size * (0.6 + 0.4 * hash(k * 5 + 2)),
          drot: 0,
          dalpha: edgeFade(t, 3),
        });
      }
      return out;
    },
  },
  fallingLeaves: {
    label: "落叶旋转", kind: "particle",
    params: [
      P("count", "数量", 3, 24, 1, 9), P("speed", "下落速度", 1, 4, 1, 1),
      P("size", "粒子大小", 0.15, 1.0, 0.05, 0.4), P("spread", "横向范围", 0.2, 1.2, 0.05, 0.9),
      P("sway", "摇摆幅度", 0, 0.25, 0.01, 0.12), P("spin", "翻转圈数", 0, 4, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 11 + 2);
        const t = ((u * p.speed) + ph) % 1;
        const dir = (hash(k * 5 + 1) < 0.5) ? 1 : -1;
        out.push({
          dx: (hash(k * 3 + 7) - 0.5) * p.spread + Math.sin(TAU * (t * 2 + ph)) * p.sway * dir,
          dy: -0.6 + t * 1.25,
          dscale: p.size,
          // drot delta across the internal t-wrap is a multiple of 360° (≡ no jump);
          // alpha is ~0 there via edgeFade — seamless.
          drot: dir * 360 * p.spin * t + ph * 360,
          dalpha: edgeFade(t, 3),
        });
      }
      return out;
    },
  },
  spiralOut: {
    label: "螺旋扩散", kind: "particle",
    params: [
      P("count", "数量", 4, 40, 1, 16), P("radius", "扩散半径", 0.1, 0.8, 0.05, 0.45),
      P("size", "粒子大小", 0.1, 0.9, 0.05, 0.3), P("turns", "螺旋圈数", 1, 5, 1, 2),
      P("cycles", "扩散次数", 1, 4, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const t = ((u * p.cycles) + hash(k * 7 + 3)) % 1;
        const ang = (k / n) * TAU + t * TAU * p.turns;
        const r = t * p.radius;
        out.push({
          dx: Math.cos(ang) * r, dy: Math.sin(ang) * r,
          dscale: p.size * (0.4 + 0.6 * (1 - t)),
          drot: 0,
          dalpha: Math.min(1, t * 5) * (1 - t),
        });
      }
      return out;
    },
  },
  confetti: {
    label: "彩纸纷飞", kind: "particle",
    params: [
      P("count", "数量", 5, 50, 1, 20), P("speed", "下落速度", 1, 4, 1, 1),
      P("size", "粒子大小", 0.1, 0.8, 0.05, 0.25), P("spread", "横向范围", 0.3, 1.4, 0.05, 1.1),
      P("spin", "翻转圈数", 0, 6, 1, 2), P("sway", "飘摆幅度", 0, 0.2, 0.01, 0.07),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 13 + 1);
        const t = ((u * p.speed) + ph) % 1;
        const dir = (hash(k * 3 + 2) < 0.5) ? 1 : -1;
        out.push({
          dx: (hash(k * 5 + 8) - 0.5) * p.spread + Math.sin(TAU * (t * 2 + ph)) * p.sway,
          dy: -0.65 + t * 1.35,
          dscale: p.size,
          drot: dir * 360 * p.spin * t + ph * 720,
          dalpha: edgeFade(t, 4),
        });
      }
      return out;
    },
  },
  fireflies: {
    label: "萤火虫", kind: "particle",
    params: [
      P("count", "数量", 3, 30, 1, 10), P("range", "游荡范围", 0.1, 0.7, 0.05, 0.35),
      P("size", "粒子大小", 0.1, 0.7, 0.05, 0.22), P("blink", "闪烁频率", 1, 8, 1, 3),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const px = hash(k * 7 + 1), py = hash(k * 7 + 5), pb = hash(k * 7 + 9);
        // each firefly wanders a small lissajous loop — periodic in u.
        out.push({
          dx: Math.sin(TAU * (u + px)) * p.range * (0.5 + 0.5 * hash(k * 3 + 2)),
          dy: Math.cos(TAU * (u * 2 + py)) * p.range * 0.6,
          dscale: p.size,
          drot: 0,
          dalpha: 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(TAU * p.blink * ((u + pb) % 1))),
        });
      }
      return out;
    },
  },
  shockwave: {
    label: "冲击波环", kind: "particle",
    params: [
      P("count", "波纹数量", 1, 5, 1, 2), P("radius", "扩散半径", 0.2, 0.9, 0.05, 0.6),
      P("ringParts", "环上粒子", 8, 40, 2, 20), P("size", "粒子大小", 0.05, 0.5, 0.05, 0.15),
      P("opacityStart", "初始透明度", 0, 1, 0.05, 0.95), P("opacityEnd", "结尾透明度", 0, 1, 0.05, 0),
    ],
    instances: (p, u) => {
      const out = [];
      const waves = Math.round(p.count);
      const parts = Math.round(p.ringParts);
      for (let w = 0; w < waves; w++) {
        const t = ((u * waves) + w / waves) % 1;
        const r = t * p.radius;
        const a = (p.opacityStart + (p.opacityEnd - p.opacityStart) * t) * Math.min(1, t * 6);
        for (let k = 0; k < parts; k++) {
          const ang = (k / parts) * TAU;
          out.push({
            dx: Math.cos(ang) * r, dy: Math.sin(ang) * r,
            dscale: p.size * (0.6 + 0.4 * (1 - t)),
            drot: 0, dalpha: a,
          });
        }
      }
      return out;
    },
  },
  petals: {
    label: "花瓣飘落", kind: "particle",
    params: [
      P("count", "数量", 3, 28, 1, 10), P("speed", "下落速度", 1, 4, 1, 1),
      P("size", "粒子大小", 0.15, 1.0, 0.05, 0.38), P("spread", "横向范围", 0.2, 1.2, 0.05, 0.95),
      P("sway", "摇摆幅度", 0, 0.3, 0.02, 0.14), P("spin", "翻转角度", 0, 90, 5, 30),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 7 + 3);
        const t = ((u * p.speed) + ph) % 1;
        out.push({
          dx: (hash(k * 3 + 9) - 0.5) * p.spread + Math.sin(TAU * (t + ph)) * p.sway,
          dy: -0.62 + t * 1.28,
          dscale: p.size * (0.8 + 0.2 * Math.sin(TAU * (t * 2 + ph))),
          drot: Math.sin(TAU * (t + ph)) * p.spin,
          dalpha: edgeFade(t, 3),
        });
      }
      return out;
    },
  },
  starfall: {
    label: "流星划过", kind: "particle",
    params: [
      P("count", "数量", 2, 16, 1, 6), P("speed", "划过速度", 1, 4, 1, 2),
      P("size", "粒子大小", 0.1, 0.8, 0.05, 0.3), P("angle", "划过方向", -80, 80, 10, -35),
      P("len", "划过距离", 0.6, 1.8, 0.1, 1.2),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      const a = p.angle * Math.PI / 180;
      const dirX = Math.sin(a), dirY = Math.cos(a);
      for (let k = 0; k < n; k++) {
        const ph = hash(k * 7 + 2);
        const t = ((u * p.speed) + ph) % 1;
        const off = (hash(k * 3 + 5) - 0.5) * 0.9;
        out.push({
          dx: -dirX * p.len * 0.5 + dirX * p.len * t + dirY * off,
          dy: -dirY * p.len * 0.5 + dirY * p.len * t - dirX * off,
          dscale: p.size,
          drot: p.angle,
          dalpha: edgeFade(t, 5),
        });
      }
      return out;
    },
  },
  vortexIn: {
    label: "漩涡吸入", kind: "particle",
    params: [
      P("count", "数量", 4, 40, 1, 16), P("radius", "起始半径", 0.2, 0.9, 0.05, 0.5),
      P("size", "粒子大小", 0.1, 0.8, 0.05, 0.28), P("turns", "旋转圈数", 1, 5, 1, 2),
      P("cycles", "吸入次数", 1, 4, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const t = ((u * p.cycles) + hash(k * 7 + 1)) % 1;
        const ang = (k / n) * TAU - t * TAU * p.turns;
        const r = (1 - t) * p.radius;
        out.push({
          dx: Math.cos(ang) * r, dy: Math.sin(ang) * r,
          dscale: p.size * (0.3 + 0.7 * (1 - t)),
          drot: 0,
          dalpha: edgeFade(t, 5),
        });
      }
      return out;
    },
  },
  aura: {
    label: "灵气环绕", kind: "particle",
    params: [
      P("count", "数量", 3, 24, 1, 10), P("radius", "环绕半径", 0.1, 0.6, 0.05, 0.3),
      P("size", "粒子大小", 0.08, 0.7, 0.05, 0.22), P("cycles", "转速", 1, 5, 1, 1),
      P("breathe", "半径呼吸", 0, 0.3, 0.02, 0.1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const base = (k / n) * TAU;
        const ang = base + TAU * p.cycles * u;
        const r = p.radius + p.breathe * Math.sin(TAU * u + base);
        out.push({
          dx: Math.cos(ang) * r, dy: Math.sin(ang) * r * 0.55,
          dscale: p.size * (0.8 + 0.2 * Math.sin(TAU * u + base)),
          drot: 0,
          dalpha: 0.5 + 0.5 * Math.sin(TAU * u + base),
        });
      }
      return out;
    },
  },
  burstUp: {
    label: "向上迸发", kind: "particle",
    params: [
      P("count", "数量", 4, 36, 1, 14), P("height", "迸发高度", 0.3, 1.2, 0.05, 0.7),
      P("spread", "散开幅度", 0.05, 0.7, 0.05, 0.35), P("size", "粒子大小", 0.08, 0.7, 0.05, 0.25),
      P("cycles", "迸发次数", 1, 4, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const t = ((u * p.cycles) + hash(k * 7 + 1)) % 1;
        const vx = (hash(k * 3 + 5) - 0.5) * 2 * p.spread;
        out.push({
          dx: vx * t,
          dy: 0.3 - p.height * 4 * t * (1 - t),
          dscale: p.size,
          drot: 0,
          dalpha: edgeFade(t, 5),
        });
      }
      return out;
    },
  },
  scatterReturn: {
    label: "散开聚合", kind: "particle",
    params: [
      P("count", "数量", 4, 36, 1, 14), P("radius", "散开半径", 0.1, 0.8, 0.05, 0.4),
      P("size", "粒子大小", 0.08, 0.7, 0.05, 0.25), P("cycles", "周期数", 1, 5, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * TAU + hash(k) * 0.5;
        const s = 0.5 - 0.5 * Math.cos(TAU * p.cycles * u);
        const r = s * p.radius;
        out.push({
          dx: Math.cos(ang) * r, dy: Math.sin(ang) * r,
          dscale: p.size,
          drot: 0,
          dalpha: 0.4 + 0.6 * s,
        });
      }
      return out;
    },
  },
  twinkle: {
    label: "星光闪耀", kind: "particle",
    params: [
      P("count", "数量", 3, 36, 1, 14), P("spread", "范围", 0.1, 0.8, 0.05, 0.4),
      P("size", "粒子大小", 0.1, 1.0, 0.05, 0.35), P("cycles", "闪烁频率", 1, 8, 1, 3),
      P("spin", "旋转角度", 0, 180, 15, 45),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const rx = (hash(k * 2 + 1) - 0.5) * 2 * p.spread;
        const ry = (hash(k * 2 + 9) - 0.5) * 2 * p.spread;
        const ph = hash(k * 5 + 3);
        const tw = 0.5 + 0.5 * Math.sin(TAU * p.cycles * (u + ph));
        out.push({
          dx: rx, dy: ry,
          dscale: p.size * (0.4 + 0.6 * tw),
          drot: p.spin * Math.sin(TAU * (u + ph)),
          dalpha: tw,
        });
      }
      return out;
    },
  },
  cascade: {
    label: "瀑布倾泻", kind: "particle",
    params: [
      P("count", "数量", 5, 50, 1, 20), P("speed", "下落速度", 1, 5, 1, 2),
      P("size", "粒子大小", 0.05, 0.5, 0.05, 0.16), P("columns", "列数", 2, 10, 1, 5),
      P("width", "宽度", 0.2, 1.2, 0.05, 0.8),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      const cols = Math.round(p.columns);
      for (let k = 0; k < n; k++) {
        const col = k % cols;
        const ph = hash(k * 7 + 2);
        const t = ((u * p.speed) + ph) % 1;
        const cx = (col / Math.max(1, cols - 1) - 0.5) * p.width;
        out.push({
          dx: cx + (hash(k * 3 + 1) - 0.5) * 0.04,
          dy: -0.6 + t * 1.25,
          dscale: p.size,
          drot: 0,
          dalpha: edgeFade(t, 4),
        });
      }
      return out;
    },
  },
  halo: {
    label: "光环旋转", kind: "particle",
    params: [
      P("count", "数量", 4, 32, 1, 12), P("radius", "光环半径", 0.1, 0.6, 0.05, 0.32),
      P("size", "粒子大小", 0.08, 0.7, 0.05, 0.24), P("cycles", "转速", 1, 6, 1, 1),
      P("tilt", "倾斜压扁", 0.2, 1, 0.05, 0.45), P("spin", "粒子自转圈数", 0, 4, 1, 1),
    ],
    instances: (p, u) => {
      const out = [];
      const n = Math.round(p.count);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * TAU + TAU * p.cycles * u;
        // lower-arc particles bigger + brighter → fake depth.
        const depth = 0.5 + 0.5 * Math.sin(ang);
        out.push({
          dx: Math.cos(ang) * p.radius,
          dy: Math.sin(ang) * p.radius * p.tilt,
          dscale: p.size * (0.7 + 0.5 * depth),
          drot: 360 * p.spin * u,
          dalpha: 0.55 + 0.45 * depth,
        });
      }
      return out;
    },
  },
};

// Display / picker order — transform anims first, then particle anims.
export const ANIM_ORDER = [
  "none", "pulse", "bob", "sway", "orbit", "spin", "wobble", "fade",
  "blink", "shake", "heartbeat", "breathe", "drift",
  "tilt", "bounce", "zoomPulse", "flicker", "pendulum", "figure8",
  "recoil", "wiggle", "hover", "corkscrew", "glitch", "levitate",
  "sparkle", "radial", "rain", "rise", "ring", "swirl", "fountain",
  "musicNotes", "bubbles", "embers", "snow", "fallingLeaves", "spiralOut",
  "confetti", "fireflies", "shockwave", "petals", "starfall", "vortexIn",
  "aura", "burstUp", "scatterReturn", "twinkle", "cascade", "halo",
];

// A fresh params object for an anim key, filled with its defaults.
export function defaultParams(key) {
  const a = ANIMS[key];
  const out = {};
  if (a) for (const pr of a.params) out[pr.key] = pr.default;
  return out;
}
