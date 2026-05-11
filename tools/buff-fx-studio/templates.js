/* JS port of the Python buff_fx.py renderers.
 *
 * Each template exports:
 *   - meta: { id, name, icon, description } for the UI
 *   - paramSpec: array of parameter descriptors for the UI form
 *   - defaults:  object of default param values
 *   - render(ctx, frameIdx, totalFrames, params, source):
 *       draws ONE frame onto the provided 2D context.
 *       `source` is the loaded image element to composite.
 *
 * All templates use NORMALISED TIME `u = frameIdx / totalFrames` and
 * INTEGER CYCLES per loop so the WebM loops seamlessly at u=1 → u=0.
 *
 * `params` includes per-template fields PLUS canvas-wide:
 *     width, height, duration, fps, seed.
 *
 * Per-particle randomness is reproducible from `seed` via mulberry32.
 */

// ===== seeded RNG (mulberry32) =====
// Same outputs as Python's random.Random(seed) for the FIRST few
// draws (close enough for our visual purposes; not bit-exact since
// Python uses Mersenne Twister). The point is deterministic per-seed
// output across reloads.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(seed);
  return {
    next: () => r(),
    uniform: (lo, hi) => lo + (hi - lo) * r(),
    randInt: (lo, hi) => Math.floor(lo + (hi - lo + 1) * r()),
    choice: (arr) => arr[Math.floor(r() * arr.length)],
  };
}

// ===== generic emoji compositor =====
function pasteEmoji(ctx, img, cx, cy, scale, rotationDeg, opacity, canvasW) {
  const targetW = Math.max(1, scale * canvasW);
  const targetH = targetW * img.height / img.width;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.translate(cx, cy);
  if (rotationDeg) ctx.rotate(rotationDeg * Math.PI / 180);
  ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
  ctx.restore();
}

// ===== helper: regenerate per-particle state from seed =====
// Each renderer creates its particle array lazily, keyed on
// (seed, count, ...stable params). For simplicity in the studio, we
// re-roll on every frame using the same seed — cheap.
function buildParticles(seed, count, builderFn) {
  const rng = makeRng(seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(builderFn(rng, i));
  return out;
}

// ===========================================================
// TEMPLATE 1 — flash: random emoji pops on/off at random positions
// ===========================================================
const flash = {
  meta: {
    id: "flash", name: "闪现", icon: "⚡",
    description: "随机位置闪烁",
  },
  defaults: {
    count: 6,
    lifeMin: 0.18,
    lifeMax: 0.38,
    scaleMin: 0.18,
    scaleMax: 0.42,
    margin: 18,
  },
  paramSpec: [
    { key: "count",    type: "int",   min: 1,    max: 30,   step: 1,    label: "粒子数" },
    { key: "lifeMin",  type: "float", min: 0.05, max: 1.0,  step: 0.01, label: "最短显示 (秒)" },
    { key: "lifeMax",  type: "float", min: 0.05, max: 1.0,  step: 0.01, label: "最长显示 (秒)" },
    { key: "scaleMin", type: "float", min: 0.05, max: 1.0,  step: 0.01, label: "最小缩放" },
    { key: "scaleMax", type: "float", min: 0.05, max: 1.0,  step: 0.01, label: "最大缩放" },
    { key: "margin",   type: "int",   min: 0,    max: 96,   step: 2,    label: "边距 (px)" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H, duration } = p;
    const lifeNormMin = p.lifeMin / duration;
    const lifeNormMax = p.lifeMax / duration;
    const particles = buildParticles(p.seed, p.count, (rng) => ({
      x: rng.uniform(p.margin, W - p.margin),
      y: rng.uniform(p.margin, H - p.margin),
      phase: rng.uniform(0, 1),
      life: rng.uniform(lifeNormMin, lifeNormMax),
      scaleMin: rng.uniform(p.scaleMin * 0.6, p.scaleMin),
      scaleMax: rng.uniform(p.scaleMax * 0.7, p.scaleMax),
      rot: rng.uniform(-25, 25),
    }));
    const u = f / totalFrames;
    for (const part of particles) {
      let local = (u - part.phase) % 1; if (local < 0) local += 1;
      if (local > part.life) continue;
      const lp = local / part.life;
      const env = Math.max(0, 1 - Math.abs((lp - 0.4) * 2));
      const scale = part.scaleMin + (part.scaleMax - part.scaleMin) * env;
      const op = Math.pow(env, 0.65);
      pasteEmoji(ctx, source, part.x, part.y, scale, part.rot, op, W);
    }
  },
};

// ===========================================================
// TEMPLATE 2 — orbit: emoji orbits ellipse above token
// ===========================================================
const orbit = {
  meta: {
    id: "orbit", name: "环绕", icon: "💫",
    description: "椭圆轨道环绕",
  },
  defaults: {
    count: 3,
    period: 1.5,
    spinRate: 180,
    scaleMin: 0.18,
    scaleMax: 0.30,
    centerY: -1,   // -1 = auto (30% from top)
    radiusX: 0,    // 0 = auto (40% W)
    radiusY: 0,    // 0 = auto (16% H)
  },
  paramSpec: [
    { key: "count",    type: "int",   min: 1,   max: 8,    step: 1,    label: "数量" },
    { key: "period",   type: "float", min: 0.3, max: 5.0,  step: 0.1,  label: "周期 (秒)", hint: "实际会自动 snap 到整数转/loop" },
    { key: "spinRate", type: "float", min: 0,   max: 720,  step: 30,   label: "自旋 (°/秒)", hint: "也会 snap 到整数自旋/loop" },
    { key: "scaleMin", type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最小缩放" },
    { key: "scaleMax", type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最大缩放" },
    { key: "centerY",  type: "float", min: -1,   max: 256, step: 1,    label: "椭圆 Y 中心 (-1=自动)" },
    { key: "radiusX",  type: "float", min: 0,    max: 256, step: 1,    label: "椭圆 X 半径 (0=自动)" },
    { key: "radiusY",  type: "float", min: 0,    max: 256, step: 1,    label: "椭圆 Y 半径 (0=自动)" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H, duration } = p;
    const cx = W / 2;
    const cy = p.centerY >= 0 ? p.centerY : H * 0.30;
    const rx = p.radiusX > 0 ? p.radiusX : W * 0.40;
    const ry = p.radiusY > 0 ? p.radiusY : H * 0.16;
    const revolutions = Math.max(1, Math.round(duration / p.period));
    const spinsPerLoop = Math.round(p.spinRate * duration / 360);
    const baseOffsets = [];
    for (let i = 0; i < p.count; i++) baseOffsets.push(i * (2 * Math.PI / p.count));
    const u = f / totalFrames;
    const thetaBase = u * 2 * Math.PI * revolutions;
    const spinDeg   = u * 360 * spinsPerLoop;
    for (let i = 0; i < p.count; i++) {
      const theta = thetaBase + baseOffsets[i];
      const depth = (Math.sin(theta) + 1) * 0.5;     // 0=back, 1=front
      const scale = p.scaleMin + (p.scaleMax - p.scaleMin) * depth;
      const opacity = 0.45 + 0.55 * depth;
      const x = cx + rx * Math.cos(theta);
      const y = cy + ry * Math.sin(theta);
      const rot = (spinDeg + i * 47) % 360 - 180;
      pasteEmoji(ctx, source, x, y, scale, rot, opacity, W);
    }
  },
};

// ===========================================================
// TEMPLATE 3 — rain: emoji falls top → bottom
// ===========================================================
const rain = {
  meta: {
    id: "rain", name: "下落", icon: "🌧",
    description: "从上往下掉",
  },
  defaults: {
    count: 8,
    cyclesMin: 1, cyclesMax: 2,
    scaleMin: 0.10, scaleMax: 0.22,
    xJitter: 6,
    margin: 12,
  },
  paramSpec: [
    { key: "count",     type: "int", min: 1, max: 30, step: 1, label: "粒子数" },
    { key: "cyclesMin", type: "int", min: 1, max: 5,  step: 1, label: "最慢 cycles/loop" },
    { key: "cyclesMax", type: "int", min: 1, max: 5,  step: 1, label: "最快 cycles/loop" },
    { key: "scaleMin",  type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最小缩放" },
    { key: "scaleMax",  type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最大缩放" },
    { key: "xJitter",   type: "float", min: 0, max: 32, step: 1, label: "横向晃动" },
    { key: "margin",    type: "int", min: 0, max: 64, step: 2, label: "左右边距" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H } = p;
    const spawnYMin = -H * 0.2;
    const travel = H + H * 0.4;
    const drops = buildParticles(p.seed, p.count, (rng) => ({
      xBase: rng.uniform(p.margin, W - p.margin),
      xAmp:  rng.uniform(0, p.xJitter),
      xWobbles: rng.choice([0, 1, 2]),
      cycles: rng.randInt(p.cyclesMin, p.cyclesMax),
      phase:  rng.uniform(0, 1),
      scale:  rng.uniform(p.scaleMin, p.scaleMax),
      rotBase: rng.uniform(0, 360),
      spinsPerCycle: rng.choice([-1, 0, 0, 1]),
    }));
    const u = f / totalFrames;
    for (const d of drops) {
      let prog = (u * d.cycles + d.phase) % 1; if (prog < 0) prog += 1;
      const y = spawnYMin + travel * prog;
      const x = d.xBase + d.xAmp * Math.sin(prog * d.xWobbles * 2 * Math.PI);
      let op;
      if (prog < 0.10)      op = prog / 0.10;
      else if (prog > 0.92) op = (1 - prog) / 0.08;
      else                  op = 1.0;
      const rot = d.rotBase + d.spinsPerCycle * 360 * prog;
      pasteEmoji(ctx, source, x, y, d.scale, rot, op, W);
    }
  },
};

// ===========================================================
// TEMPLATE 4 — float: emoji drifts upward (opposite of rain)
// ===========================================================
const float_ = {
  meta: {
    id: "float", name: "上升", icon: "🎈",
    description: "从下往上飘",
  },
  defaults: {
    count: 6,
    cyclesMin: 1, cyclesMax: 2,
    scaleMin: 0.16, scaleMax: 0.26,
    xJitter: 8,
    margin: 14,
  },
  paramSpec: [
    { key: "count",     type: "int", min: 1, max: 30, step: 1, label: "粒子数" },
    { key: "cyclesMin", type: "int", min: 1, max: 5,  step: 1, label: "最慢 cycles/loop" },
    { key: "cyclesMax", type: "int", min: 1, max: 5,  step: 1, label: "最快 cycles/loop" },
    { key: "scaleMin",  type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最小缩放" },
    { key: "scaleMax",  type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最大缩放" },
    { key: "xJitter",   type: "float", min: 0, max: 32, step: 1, label: "横向晃动" },
    { key: "margin",    type: "int", min: 0, max: 64, step: 2, label: "左右边距" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H } = p;
    const spawnYMax = H + H * 0.15;
    const travel = H + H * 0.30;
    const parts = buildParticles(p.seed, p.count, (rng) => ({
      xBase:    rng.uniform(p.margin, W - p.margin),
      xAmp:     rng.uniform(0, p.xJitter),
      xWobbles: rng.choice([0, 1, 2]),
      rises:    rng.randInt(p.cyclesMin, p.cyclesMax),
      phase:    rng.uniform(0, 1),
      scale:    rng.uniform(p.scaleMin, p.scaleMax),
      rotBase:  rng.uniform(-15, 15),
      rotAmp:   rng.uniform(0, 12),
    }));
    const u = f / totalFrames;
    for (const d of parts) {
      let prog = (u * d.rises + d.phase) % 1; if (prog < 0) prog += 1;
      const y = spawnYMax - travel * prog;
      const x = d.xBase + d.xAmp * Math.sin(prog * d.xWobbles * 2 * Math.PI);
      const rot = d.rotBase + d.rotAmp * Math.sin(prog * 2 * Math.PI);
      let op;
      if (prog < 0.12)      op = prog / 0.12;
      else if (prog > 0.88) op = (1 - prog) / 0.12;
      else                  op = 1.0;
      pasteEmoji(ctx, source, x, y, d.scale, rot, op, W);
    }
  },
};

// ===========================================================
// TEMPLATE 5 — pulse: centre emoji breathing scale
// ===========================================================
const pulse = {
  meta: {
    id: "pulse", name: "呼吸", icon: "💗",
    description: "中心缩放呼吸",
  },
  defaults: {
    pulses: 2,
    scaleMin: 0.35,
    scaleMax: 0.55,
  },
  paramSpec: [
    { key: "pulses",   type: "int",   min: 1,    max: 8,   step: 1,    label: "脉动次数/loop", hint: "整数" },
    { key: "scaleMin", type: "float", min: 0.10, max: 1.0, step: 0.01, label: "最小缩放" },
    { key: "scaleMax", type: "float", min: 0.10, max: 1.0, step: 0.01, label: "最大缩放" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H } = p;
    const u = f / totalFrames;
    const envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * u * p.pulses);
    const scale = p.scaleMin + (p.scaleMax - p.scaleMin) * envelope;
    pasteEmoji(ctx, source, W / 2, H / 2, scale, 0, 1.0, W);
  },
};

// ===========================================================
// TEMPLATE 6 — radial: emoji radiates outward from centre
// ===========================================================
const radial = {
  meta: {
    id: "radial", name: "扩散", icon: "✨",
    description: "向外扩散",
  },
  defaults: {
    count: 8,
    cyclesMin: 1, cyclesMax: 1,
    scaleMin: 0.18, scaleMax: 0.28,
  },
  paramSpec: [
    { key: "count",     type: "int", min: 1, max: 24, step: 1, label: "粒子数" },
    { key: "cyclesMin", type: "int", min: 1, max: 4,  step: 1, label: "最慢 cycles/loop" },
    { key: "cyclesMax", type: "int", min: 1, max: 4,  step: 1, label: "最快 cycles/loop" },
    { key: "scaleMin",  type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最小缩放" },
    { key: "scaleMax",  type: "float", min: 0.05, max: 0.6, step: 0.01, label: "最大缩放" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H } = p;
    const cx = W / 2, cy = H / 2;
    const maxR = Math.min(W, H) * 0.45;
    const parts = buildParticles(p.seed, p.count, (rng, i) => ({
      angle: (i / p.count) * 360 + rng.uniform(-10, 10),
      cycles: rng.randInt(p.cyclesMin, p.cyclesMax),
      phase: rng.uniform(0, 1),
      scale: rng.uniform(p.scaleMin, p.scaleMax),
    }));
    const u = f / totalFrames;
    for (const d of parts) {
      let prog = (u * d.cycles + d.phase) % 1; if (prog < 0) prog += 1;
      const r = maxR * prog;
      const θ = d.angle * Math.PI / 180;
      const x = cx + Math.cos(θ) * r;
      const y = cy + Math.sin(θ) * r;
      const op = Math.pow(Math.max(0, 1 - prog), 1.2);
      const scale = d.scale * (1 + prog * 0.3);
      pasteEmoji(ctx, source, x, y, scale, 0, op, W);
    }
  },
};

// ===========================================================
// TEMPLATE 7 — shake: centre emoji shakes left-right
// ===========================================================
const shake = {
  meta: {
    id: "shake", name: "震颤", icon: "😱",
    description: "左右抖动",
  },
  defaults: {
    shakes: 6,
    amplitude: 0.08,
    tilt: 8,
    scale: 0.50,
  },
  paramSpec: [
    { key: "shakes",    type: "int",   min: 1,    max: 20,   step: 1,    label: "震次数/loop", hint: "整数" },
    { key: "amplitude", type: "float", min: 0.01, max: 0.30, step: 0.01, label: "横向幅度 (frac W)" },
    { key: "tilt",      type: "float", min: 0,    max: 30,   step: 1,    label: "倾斜 (°)" },
    { key: "scale",     type: "float", min: 0.10, max: 1.0,  step: 0.01, label: "缩放" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H } = p;
    const u = f / totalFrames;
    const sw = 2 * Math.PI * u * p.shakes;
    const xOff = p.amplitude * W * Math.sin(sw);
    const rot = Math.sin(sw) * p.tilt;
    pasteEmoji(ctx, source, W / 2 + xOff, H / 2, p.scale, rot, 1.0, W);
  },
};

// ===========================================================
// TEMPLATE 8 — static: centre emoji, no motion (still encoded
// as WebM for renderer-pipeline uniformity)
// ===========================================================
const static_ = {
  meta: {
    id: "static", name: "静止", icon: "🗿",
    description: "无动画",
  },
  defaults: { scale: 0.55 },
  paramSpec: [
    { key: "scale", type: "float", min: 0.10, max: 1.0, step: 0.01, label: "缩放" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H } = p;
    pasteEmoji(ctx, source, W / 2, H / 2, p.scale, 0, 1.0, W);
  },
};

// ===========================================================
// TEMPLATE 9 — fade: centre emoji opacity in/out
// ===========================================================
const fade = {
  meta: {
    id: "fade", name: "隐现", icon: "👻",
    description: "透明度呼吸",
  },
  defaults: {
    pulses: 1,
    alphaMin: 0.20,
    alphaMax: 1.00,
    scale: 0.55,
    scalePulse: false,
  },
  paramSpec: [
    { key: "pulses",     type: "int",   min: 1,    max: 6,   step: 1,    label: "次数/loop" },
    { key: "alphaMin",   type: "float", min: 0,    max: 1.0, step: 0.05, label: "最低透明度" },
    { key: "alphaMax",   type: "float", min: 0,    max: 1.0, step: 0.05, label: "最高透明度" },
    { key: "scale",      type: "float", min: 0.10, max: 1.0, step: 0.01, label: "缩放" },
    { key: "scalePulse", type: "bool",                                    label: "缩放也呼吸 ±10%" },
  ],
  render(ctx, f, totalFrames, p, source) {
    const { width: W, height: H } = p;
    const u = f / totalFrames;
    const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * u * p.pulses);
    const op = p.alphaMin + (p.alphaMax - p.alphaMin) * env;
    const scale = p.scale * (p.scalePulse ? (1 + (env - 0.5) * 0.10) : 1);
    pasteEmoji(ctx, source, W / 2, H / 2, scale, 0, op, W);
  },
};

// Ordered list for the UI.
export const TEMPLATES = {
  flash, orbit, rain, float: float_, pulse, radial, shake,
  static: static_, fade,
};

export const TEMPLATE_ORDER = ["flash", "orbit", "rain", "float", "pulse", "radial", "shake", "static", "fade"];
