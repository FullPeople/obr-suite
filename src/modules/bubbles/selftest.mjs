// Run from the repository root: node src/modules/bubbles/selftest.mjs
//
// Covers `anchorMode: "box"` — laying the bubble cluster out against the
// token's grid footprint instead of its full PNG canvas.
//
//   1. the pure maths in anchor-box.ts (occupancy, snapping, rigid follow)
//   2. the metadata codec in anchor-memory.ts (round-trip, prune, junk)
//   3. the REAL wiring: `anchorBoxFor` + `computeLayout` are bundled out
//      of src/modules/bubbles/index.ts and driven directly, so the
//      numbers below are the ones the background actually bakes — there
//      is no second copy of the formula living in this file
//   4. three deliberate breakages, each of which must make the suite fail
//      (otherwise the assertions above are vacuous)
//
// Nothing here needs a room: the SDK is aliased away and only `Math2` is
// borrowed from the real package so the trigonometry is the real one.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const root = resolve(process.cwd());
const out = mkdtempSync(join(tmpdir(), "bubbles-anchor-selftest-"));
/** One grid square, in world units — the value the OBR ruler shows. */
const DPI = 150;

let checks = 0;
const check = (value, name) => {
  assert.ok(value, name);
  checks++;
  console.log("PASS " + name);
};

const stubs = {
  "asset-base": "export const assetUrl = (x) => x;",
  suppression:
    "export const bossReplacesHealthBar = () => false;export const onPresentedBossesChange = () => () => {};export const presentedBossesRevision = () => 0;",
};

// Test-only exports appended at bundle time. Keeping them out of the
// shipped module means the public surface stays exactly as it was.
const TEST_EXPORTS = `
export const __test = {
  computeLayout,
  anchorBoxFor,
  anchorFrameOf,
  resolveAnchorBox,
  readSceneAnchorMode,
  sameRef,
  loadAnchorMemory,
  resetAnchorMemory,
  pruneAnchorMemory,
  setAnchorMode: (m) => { cachedAnchorMode = m; },
  memory: () => anchorMemory,
  encodeAnchors,
  readAnchors,
};
`;

let serial = 0;
/** Bundle the real modules, optionally rewriting one file on the way in. */
async function bundle(mutation) {
  let changed = false;
  const build = await rolldown({
    input: "virtual:entry",
    platform: "node",
    plugins: [
      {
        name: "bubbles-anchor-sdk",
        resolveId(source) {
          if (source === "virtual:entry" || source.startsWith("mock:")) return source;
          if (source === "@owlbear-rodeo/sdk") return "mock:sdk";
          const name = source.split("/").pop();
          if (stubs[name]) return `mock:${name}`;
        },
        load(id) {
          if (id === "virtual:entry") {
            return [
              `export * from ${JSON.stringify(join(root, "src/modules/bubbles/anchor-box.ts"))};`,
              `export * from ${JSON.stringify(join(root, "src/modules/bubbles/anchor-memory.ts"))};`,
              `export * as core from ${JSON.stringify(join(root, "src/modules/bubbles/index.ts"))};`,
            ].join("\n");
          }
          if (id === "mock:sdk") {
            // Real Math2 (so rotation is the production trigonometry),
            // stub everything else — this suite never builds a bubble.
            return [
              `export { Math2 } from ${JSON.stringify(join(root, "node_modules/@owlbear-rodeo/sdk/lib/math/Math2.js"))};`,
              `export const isImage = (i) => !!i && i.type === "IMAGE";`,
              `export const buildCurve = () => { throw new Error("buildCurve is not exercised by this suite"); };`,
              `export const buildShape = buildCurve;`,
              `export const buildText = buildCurve;`,
              `export const buildEffect = buildCurve;`,
              `export default {};`,
            ].join("\n");
          }
          if (id.startsWith("mock:")) return stubs[id.slice(5)];
          const p = id.replaceAll("\\", "/");
          if (mutation && p.endsWith(mutation.file)) {
            const source = readFileSync(id, "utf8");
            assert.ok(source.includes(mutation.from), `mutation target missing: ${mutation.name}`);
            changed = true;
            return source.replace(mutation.from, mutation.to);
          }
          if (p.endsWith("src/modules/bubbles/index.ts")) {
            return readFileSync(id, "utf8") + TEST_EXPORTS;
          }
        },
      },
    ],
  });
  const file = join(out, `${serial++}.mjs`);
  await build.write({ file, format: "esm" });
  await build.close();
  if (mutation) assert.ok(changed, `mutation "${mutation.name}" never applied`);
  // The appended exports are only reachable through the `core` namespace.
  const mod = await import(pathToFileURL(file));
  return { ...mod, ...mod.core.__test, __raw: mod };
}

/**
 * Token fixture. `size` is the PNG canvas, `grid.dpi` is how many of its
 * pixels make one scene cell — the pair that decides how much transparent
 * padding the artwork carries.
 */
function token({ id, size, dpi = size, position, scale = { x: 1, y: 1 }, rotation = 0 }) {
  return {
    id,
    type: "IMAGE",
    layer: "CHARACTER",
    name: id,
    position: { ...position },
    rotation,
    scale: { ...scale },
    image: { width: size, height: size, mime: "image/png", url: "about:blank" },
    grid: { dpi, offset: { x: size / 2, y: size / 2 } },
    metadata: {},
  };
}

const DATA = { pendingHp: false, hp: 10, maxHp: 20, tempHp: 0, ac: null, hide: false, locked: false };
/** Standard (non-overhead) placement, no user offset, scale 1. */
const layoutOriginY = (api, img, box) =>
  api.computeLayout(img, DPI, DATA, 1, 0, false, false, false, box).origin.y;

console.log("【1】占用格数 = 四舍五入（画布 ÷ 格距），至少 1 格 —— 与枭熊标尺同口径");
{
  const api = await bundle();
  check(api.occupancyOf(150, 150, DPI).cols === 1, "512px 图（渲染 150）= 1 格");
  check(api.occupancyOf(205.08, 205.08, DPI).cols === 1, "700px 图（渲染 205）仍算 1 格，不是 1.37");
  check(api.occupancyOf(300, 600, DPI).cols === 2 && api.occupancyOf(300, 600, DPI).rows === 4, "2×4 的长条按格算");
  check(api.occupancyOf(0, 0, DPI).cols === 1, "坏尺寸兜底 1 格，不产生 0 宽血条");
  check(api.occupancyOf(99999, 99999, DPI).cols === api.MAX_OCCUPANCY, "离谱尺寸被 MAX_OCCUPANCY 夹住");
}

console.log("【2】摆正判定：偏差 ≤ 0.3 格且未旋转 ⇒ 吸附到最近格线");
{
  const api = await bundle();
  const a = api.alignTarget(api.anchorFrameOf(token({ id: "a", size: 512, position: { x: 1000, y: 1000 } }), DPI), DPI);
  check(a.aligned && a.gx === 6 && a.gy === 6, "中心 1000（偏 0.167 格）算摆正，格索引 6");
  const free = api.alignTarget(api.anchorFrameOf(token({ id: "a", size: 512, position: { x: 1200, y: 1200 } }), DPI), DPI);
  check(!free.aligned && free.deviation === 0.5, "中心 1200（偏 0.5 格，正落交点）不算摆正");
  const rot = api.alignTarget(
    api.anchorFrameOf(token({ id: "a", size: 512, position: { x: 1000, y: 1000 }, rotation: 30 }), DPI), DPI,
  );
  check(!rot.aligned, "位置再正，旋转 30° 也不算摆正（血条是轴对齐的，装不下斜方块）");
}

console.log("【3】现状（画布锚）复现问题：大画布小图案的 token 血条被顶飞");
{
  const api = await bundle();
  api.setAnchorMode("canvas");
  const thin = token({ id: "a", size: 512, position: { x: 1000, y: 1000 } });
  const fat = token({ id: "b", size: 700, dpi: 512, position: { x: 1020, y: 1000 } });
  check(api.anchorBoxFor(thin, DPI) === null, "关掉开关时根本不参与计算（anchorBoxFor 返回 null）");
  check(api.anchorBoxFor(fat, DPI) === null, "同上，与图片尺寸无关");
  const yThin = layoutOriginY(api, thin, null);
  const yFat = layoutOriginY(api, fat, null);
  check(yThin === 1075, "512 图：画布底边 1075");
  check(Math.abs(yFat - 1102.539) < 1e-3, "700 图：画布底边 1102.54（多出来的 27.5 = 透明留白）");
  check(yThin !== yFat, "同一排的两个 token 落在两条不同的线上 —— 这就是要被修掉的现象");
}

console.log("【4】占格框锚定：同一排必然同一条线，且与画布尺寸无关");
{
  const api = await bundle();
  api.setAnchorMode("box");
  const thin = token({ id: "a", size: 512, position: { x: 1000, y: 1000 } });
  const fat = token({ id: "b", size: 700, dpi: 512, position: { x: 1020, y: 1000 } });
  const boxThin = api.anchorBoxFor(thin, DPI);
  const boxFat = api.anchorBoxFor(fat, DPI);
  check(
    boxThin && boxThin.source === "grid" && boxThin.centerX === 975 && boxThin.centerY === 975 && boxThin.width === 150,
    "512 图 ⇒ 吸附到 (900,900) 的 1×1 格块，中心 975、宽 150",
  );
  check(boxFat && boxFat.centerX === 975 && boxFat.centerY === 975 && boxFat.width === 150, "700 图 ⇒ 同一块格块");
  check(layoutOriginY(api, thin, boxThin) === 1050, "血条底边 = 格线 1050（不再是 1075）");
  check(layoutOriginY(api, fat, boxFat) === 1050, "另一枚也是 1050 —— 同排同线成立");
}

console.log("【5】头顶模式用同一套锚定，只是换个方向");
{
  const api = await bundle();
  api.setAnchorMode("box");
  const img = token({ id: "a", size: 512, position: { x: 1000, y: 1000 } });
  const box = api.anchorBoxFor(img, DPI);
  const above = api.computeLayout(img, DPI, DATA, 1, 0, false, false, true, box);
  const below = api.computeLayout(img, DPI, DATA, 1, 0, false, false, false, box);
  check(above.overheadMode === true && above.origin.y === 900, "头顶模式锚在格块上边 900（不再是画布上边 925）");
  check(above.origin.y < below.origin.y, "头顶条整体在下方条之上");
}

console.log("【6】格内位置记忆：摆正时记下，拖到自由位按刚体跟随");
{
  const api = await bundle();
  api.setAnchorMode("box");
  api.resetAnchorMemory();
  const aligned = token({ id: "m", size: 512, position: { x: 1000, y: 1000 } });
  api.anchorBoxFor(aligned, DPI);
  const ref = api.memory().get("m");
  check(ref && ref.gx === 6 && ref.gy === 6 && ref.px === 1000, "摆正 ⇒ 写下一份快照（格索引 + 当时的 position）");

  const freed = token({ id: "m", size: 512, position: { x: 1200, y: 1200 } });
  const box = api.anchorBoxFor(freed, DPI);
  check(box && box.source === "memory", "偏 0.5 格 ⇒ 走记忆，而不是重新吸附");
  check(layoutOriginY(api, freed, box) === 1250, "底边 1250 = 贴线值 1050 + 位移 200（纯跟随会是 1275）");

  const scaled = token({ id: "m", size: 512, position: { x: 1275, y: 1275 }, scale: { x: 2, y: 2 } });
  const sbox = api.anchorBoxFor(scaled, DPI);
  check(sbox && sbox.width === 300, "放大 2× ⇒ 血条宽 300（跟着 token 变大）");
  check(sbox.centerX === 1225, "锚点偏移同样按 2× 放大（1225，纯跟随会是 1275）");

  const mirrored = token({ id: "m", size: 512, position: { x: 1200, y: 1200 }, scale: { x: -1, y: 1 } });
  const mbox = api.anchorBoxFor(mirrored, DPI);
  check(mbox && mbox.centerX === 1225 && mbox.width === 150, "横向镜像 ⇒ 锚点镜像到另一侧，宽度不变");

  const back = token({ id: "m", size: 512, position: { x: 1125, y: 1125 } });
  const bbox = api.anchorBoxFor(back, DPI);
  check(bbox && bbox.source === "grid" && layoutOriginY(api, back, bbox) === 1200, "重新摆正 ⇒ 贴回格线并刷新记忆");
  check(api.memory().get("m").px === 1125, "快照已更新到新的摆正位置");
}

console.log("【7】记忆持久化：房间 metadata 往返 / 淘汰 / 脏数据不致命");
{
  const api = await bundle();
  const map = new Map([
    ["a", { gx: 6, gy: 6, cols: 1, rows: 1, px: 1000, py: 1000, rot: 0, sx: 1, sy: 1 }],
    ["b", { gx: 3, gy: 4, cols: 2, rows: 2, px: 900, py: 900, rot: 0, sx: 1, sy: 1 }],
  ]);
  const encoded = api.encodeAnchors(map);
  const decoded = api.readAnchors({ [api.BUBBLE_ANCHORS_KEY]: encoded });
  check(decoded.size === 2 && api.sameRef(decoded.get("a"), map.get("a")), "编码 → 解码后逐字段还原");

  const prune = new Map(map);
  check(api.pruneAnchors(prune, new Set(["a"])) === true && prune.size === 1, "离场 token 的记忆被清掉");
  const capped = new Map();
  for (let i = 0; i < api.MAX_ANCHORS + 10; i++) capped.set(`x${i}`, { gx: i, gy: 0, cols: 1, rows: 1, px: 0, py: 0, rot: 0, sx: 1, sy: 1 });
  api.pruneAnchors(capped, null);
  check(capped.size === api.MAX_ANCHORS && !capped.has("x0") && capped.has(`x${api.MAX_ANCHORS + 9}`), "超出上限时淘汰最旧的、保留最新的");
  check(api.encodeAnchors(capped).x0 === undefined, "编码结果同样受上限约束（metadata 体积可控）");

  const junk = api.readAnchors({
    [api.BUBBLE_ANCHORS_KEY]: { bad: "nope", bad2: { gx: "NaN" }, ok: { gx: 1, gy: 2, px: 0, py: 0 } },
  });
  check(junk.size === 1 && junk.get("ok").cols === 1, "坏条目被丢弃，剩下的按默认值补齐 —— 不会拖垮同步");
  check(api.readAnchors(null).size === 0 && api.readAnchors({}).size === 0, "metadata 缺失 / 为空都安全");
}

console.log("【8】开关解析：只有恰好 \"box\" 才启用，其余一律保持现状");
{
  const api = await bundle();
  const withMode = (anchorMode) => api.readSceneAnchorMode({ "com.obr-suite/bubbles/settings": { anchorMode } });
  check(withMode("box") === "box", "\"box\" ⇒ 占格框");
  check(withMode("canvas") === "canvas", "\"canvas\" ⇒ 画布");
  check(withMode(undefined) === "canvas", "缺字段（老场景）⇒ 画布");
  check(withMode("grid") === "canvas" && withMode(1) === "canvas", "不认识的值 ⇒ 画布，不做任何猜测");
  check(api.readSceneAnchorMode({}) === "canvas", "设置对象缺失 ⇒ 画布");
}

console.log("【9】反向验证：故意改坏，测试必须失败");
{
  const cases = [
    {
      name: "把贴线容差改成 0（摆正检测失效）",
      mutation: {
        file: "src/modules/bubbles/anchor-box.ts",
        from: "export const SNAP_TOLERANCE_CELLS = 0.3;",
        to: "export const SNAP_TOLERANCE_CELLS = 0;",
      },
      run: (api) => {
        api.setAnchorMode("box");
        const img = token({ id: "a", size: 512, position: { x: 1000, y: 1000 } });
        const box = api.anchorBoxFor(img, DPI);
        assert.ok(box, "应当仍有格框（否则本用例无效）");
        assert.equal(layoutOriginY(api, img, box), 1050);
      },
    },
    {
      name: "记忆跟随退化成「贴住 token 中心」（丢掉格内位置）",
      mutation: {
        file: "src/modules/bubbles/anchor-box.ts",
        from: "    centerX: frame.px + (refCx - ref.px) * kx,",
        to: "    centerX: frame.px,",
      },
      run: (api) => {
        api.setAnchorMode("box");
        api.resetAnchorMemory();
        api.anchorBoxFor(token({ id: "m", size: 512, position: { x: 1000, y: 1000 } }), DPI);
        const freed = token({ id: "m", size: 512, position: { x: 1200, y: 1200 } });
        const box = api.anchorBoxFor(freed, DPI);
        assert.equal(box.centerX, 1175);
      },
    },
    {
      name: "computeLayout 忽略传进来的锚定框",
      mutation: {
        file: "src/modules/bubbles/index.ts",
        from: "  const box = anchorBox ?? {",
        to: "  const box = {",
      },
      run: (api) => {
        api.setAnchorMode("box");
        const img = token({ id: "a", size: 512, position: { x: 1000, y: 1000 } });
        const box = api.anchorBoxFor(img, DPI);
        assert.equal(layoutOriginY(api, img, box), 1050);
      },
    },
  ];
  for (const c of cases) {
    const api = await bundle(c.mutation);
    let failed = false;
    try {
      c.run(api);
    } catch {
      failed = true;
    }
    check(failed, `改坏「${c.name}」后断言如期失败`);
  }
}

console.log(`\n全部 ${checks} 项通过`);
if (dirname(resolve(out)) === resolve(tmpdir()) && basename(out).startsWith("bubbles-anchor-selftest-")) {
  rmSync(out, { recursive: true, force: true });
}
