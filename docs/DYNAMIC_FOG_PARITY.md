# Dynamic Fog 对等改造 (dynfog) — 设计与实施记录

> 分支 `feat/dynamic-fog-parity`，基线快照 `snapshot/pre-dynfog-port-20260825`
> (commit `8811a60`)，文件级备份 `../_backup_20260825_pre_dynfog/`。
> 上游参考实现：`../dfref`（= `github.com/owlbear-rodeo/dynamic-fog` @ `55e22b7`）。

---

## 1. 为什么要重做

原来的 `src/modules/fullFog/` 里有三套互不相干的东西：

| 子系统 | 原实现 | 问题 |
| --- | --- | --- |
| 墙 | `index.ts::syncLocalWalls()` — 只认 fullFog 编辑器保存的那一个 outline `Path`（靠 `FOG_PATH_KEY` 元数据识别） | OBR **原生迷雾工具**画出来的 FOG 图层形状（Shape / Curve / Line / Path）完全不产生墙 |
| 门 / 窗 | `door/` — 开口用 `{polyIndex, t1, t2}` 存在 outline Path 上 | 同上：只能画在 outline Path 上，普通墙上画不了门窗；没有直线（Line）工具 |
| 光源 | `light/` — 自己一套 `LightConfig`，只有 `attenuationRadius / sourceRadius / falloff` | 缺 `innerAngle / outerAngle / lightType / rotation`，没有 SelfLight、没有 PRIMARY/SECONDARY，设置面板也是另一套 |

用户诉求（第一轮）：

1. 完整复刻 dynamic-fog 的功能；
2. 在此之上增加**窗户**；
3. **玩家可见门窗开关并能自行开关**。

第二轮（桌面实测后）：

4. 窗户**开关都要能看见外面**，只有「能不能钻过去」随状态变（§4.1）；
5. 增加**密门**：玩家看不见、也开不了（§4.1）；
6. 把迷雾编辑器从动态迷雾里**拆成独立模块**，设置页删掉长篇编辑器手册（§6.1）；
7. **光源遮挡**：别人的灯默认不可见，除非有无墙视线（§5.2）；

第二轮里被评估后**放弃**的一项：**历史迷雾**（已探索区域保持可见）。OBR 的
公开 API 无法把「地形记忆」和「活体 token」分开渲染 —— 迷雾一旦揭开，房间里的
哥布林也一起可见。唯一忠实的做法是客户端重新解码地图图片、按已探索区域裁剪去色、
再作为本地 IMAGE 压在迷雾之上，属于大工程且有明显性能风险。

## 2. 总体架构

新增 `src/modules/fullFog/dynfog/`，把上游的 **Reconciler / Reactor / Actor / Patcher**
单向数据绑定框架完整搬过来，但**几何内核用纯 TypeScript 重写**（见 §3）。

```
dynfog/
  ids.ts                       元数据 / 工具 id / 配色常量
  meta.ts                      getMetadata 泛型读取器
  runtime.ts                   同步缓存的场景事实（dpi / 角色 / 两个开关）
  geom/
    xform.ts                   item ↔ world 变换（基于 MathM）
    cardinal.ts                Cardinal 样条 → PathCommand[]
    drawing.ts                 Drawing 类型 + drawingToPolylines()
    polyline.ts                弧长寻址 / 取子段 / 按 t 区间切分
    cut.ts                     跨图形开口的世界空间胶囊裁剪
    wallGeometry.ts            纯函数版墙推导（可脱离 OBR 测试）
  reconcile/
    Patcher.ts  Reactor.ts  Actor.ts  Reconciler.ts
    actors/    OpeningActor  WallActor  LightActor  SelfLightActor
               OpeningOverlayActor  LightOverlayActor
    reactors/  对应六个
  opening/
    types.ts                   Opening（door | window | secret）+ 语义谓词
    read.ts                    读取 + 上游 Door[] 兼容转换
    mutate.ts                  增 / 删 / 开关（顺带迁移上游元数据）
  tools/
    createLineMode.ts          直线墙工具（上游 Line mode）
    createOpeningMode.ts       门 / 窗 / 密门工具（上游 Door mode 的超集）
    createToggleTool.ts        玩家用「开关门窗」工具
    toggleChannel.ts           玩家 → GM 的开关广播
    snap.ts                    「离指针最近的墙」查找
  light/
    config.ts                  LightConfig（上游字段 + ambient）
    createLightMenu.ts         添加光源 / 光源设置
    edit-page.ts               光源设置面板（fullfog-light-edit.html）
    wallIndex.ts               墙体线段网格索引 + 视线查询
    occlusion.ts               「这盏灯我看得见吗」判定（套件自有）
  overlay.ts                   指示层的显隐生命周期
  selftest.ts / visual.ts      40 项自测 + SVG 证明图
  index.ts                     setup / teardown
```

原 `fullFog/door/`、`fullFog/light/`、`fullFog/index.ts::syncLocalWalls()`
全部删除，由 dynfog 接管。**fullFog 编辑器（图像自动描边）保留不动**——它产出的
outline Path 本身就是一个 FOG 图层的 Drawing，会被新的 `WallReactor` 直接接管。

## 3. 关键取舍：不引入 CanvasKit

上游用 `canvaskit-wasm`（Skia）做四件事：

1. `Path.stroke()` — 把绘制图形描边后取轮廓，作为墙；
2. `ContourMeasureIter` — 按弧长寻址（门的起止点）；
3. `PathOp.Difference` — 从墙里挖掉开着的门；
4. 曲线采样。

`canvaskit.wasm` 有 **6.8 MB**（full 版 7.6 MB）。obr-suite 的 background iframe
是**每个客户端**都要加载的，当前全部 JS 加起来才 ~400 KB。为一个子模块给所有玩家
加 6.8 MB 的 WASM，代价过高。**本次改造 `package.json` 没有新增任何依赖。**

| Skia 能力 | 本实现 |
| --- | --- |
| 曲线采样 | `geom/drawing.ts` 逐 command 采样（QUAD / CONIC / CUBIC 解析式）；Curve 走 `geom/cardinal.ts` 转成同样的 command 再采样 |
| 弧长寻址 | `geom/polyline.ts` 的归一化弧长参数 `t ∈ [0,1]`（`polyIndex` + `t`） |
| 布尔差集挖门（同一图形） | `geom/polyline.ts::splitPolylineByRanges()` — 在 t 域上精确切分 |
| 布尔差集挖门（跨图形） | `geom/cut.ts` — 开口在世界空间贡献一条「胶囊链」，别的图形按距离裁掉重叠段 |
| `stroke()` 取轮廓 | **不做**：墙直接取图形的中心线轮廓 |

### 3.1 刻意的行为差异：中心线 vs 描边轮廓

上游把 FOG 图形 `stroke(strokeWidth)` 后取**轮廓线**当墙，所以一条 20px 粗的
线会变成两条相距 20px 的平行墙。本实现直接用图形自身的**中心线**当墙，一条线
就是一条墙。

- 对遮挡视线的效果**没有可观察差异**（两条紧贴的墙 ≡ 一条墙）；
- 墙数量减半，自动描边的复杂地图上是显著的性能收益；
- 门的挖除逻辑同样简化（不需要一次挖穿两条平行墙）。

### 3.2 为什么还需要「跨图形裁剪」

OBR 的迷雾工具鼓励**画重叠的形状**（两个矩形拼出 L 形走廊）。上游把每一扇门从
**每一面墙**里减掉（Skia 在世界空间做差集），所以画在其中一个矩形上的门也会打穿
它背后那个矩形。少了这一步，共享墙上的门看起来开了、视线却仍然被第二个形状挡住
—— 正是「门窗没用」的典型症状。`geom/cut.ts` 用胶囊距离测试复现了这个行为，
精度是 `radius / 2`（若干像素，玩家不可能察觉）。

其余所有行为（哪些 item 变墙、门的开合语义、光源参数与表现、指示器颜色 / 图标、
工具的拖拽手感、快捷键）都与上游一致。

## 4. 数据模型

### 4.1 开口（门 / 窗）

存在**被画的那个 FOG Drawing** 的 metadata 上，key = `${PLUGIN_ID}/openings`：

```ts
interface Opening {
  id: string;                 // 稳定 id（玩家点击时用它定位，而不是数组下标）
  kind: "door" | "window" | "secret";
  open: boolean;              // true = 生物可以通过（不等于"能看见"，见下）
  polyIndex: number;          // drawingToPolylines() 结果里的第几条折线
  t1: number;                 // 归一化弧长 [0,1]
  t2: number;
}
```

**2026-08-25 语义修订**：`open` 原本表示「通视」，现在表示「**可通行**」。
是否通视由 `blocksVision()` 单独回答：

| kind | open = true | open = false |
| --- | --- | --- |
| door | 挖开，通视 | 保留墙，挡视线 |
| secret | 挖开，通视 | 保留墙，挡视线 |
| **window** | 挖开，通视 | **也挖开，也通视** |

窗是玻璃：关着一样看得见外面。这是这次改动的核心诉求，也是为什么代码里到处是
`blocksVision(o)` 而不是 `!o.open`。**「关着的窗爬不过去」这一半 OBR 表达不了**
（`Wall` 只影响视线，不影响移动），由指示器的颜色 / 图标承载、桌面上约定。

- **门**：默认关，<span>红</span>；开后绿。
- **密门**：视线上和门完全一样，但**玩家端不生成任何指示器**，且 GM 侧的广播
  监听器会拒绝玩家对它的开关请求（`applyPlayerOpeningState`）。GM 看到紫色**虚线**。
  ⚠ 局限：开口数组存在共享场景 metadata 里（OBR 没有仅 GM 可读的存储），
  玩家翻原始 metadata 理论上能发现密门 —— 但渲染出来的画面里没有任何痕迹，
  关着的密门产生的墙和「没有门」完全一样。
- **窗**：默认关（= 玻璃），青色；敞开后蓝绿。两种状态挖出的洞一模一样。

**上游兼容**：`opening/read.ts` 同时接受上游 `rodeo.owlbear.dynamic-fog/doors`
形状（`{open, start:{index,distance}, end:{...}}`），按折线长度换算成 `t`。
第一次写入时 `opening/mutate.ts` 会把上游 key 删掉，完成迁移；两种数据同时存在
时以我们自己的为准。

### 4.2 光源

与上游 `LightConfig` 字段完全一致：
`attenuationRadius / sourceRadius / falloff / innerAngle / outerAngle / lightType / rotation`，
另加一个套件自有字段：`ambient`（豁免遮挡，见 §5.2）。
`LightActor` 建原生 `Light`，`SelfLightActor` 给「有角度的 PRIMARY 光源」补一个
半径 75 的自照明（否则持灯人自己站在锥形光的暗区里）。

`LightActor` / `SelfLightActor` 都**关掉了 VISIBLE 附着继承**，改为自己计算
`visible = 父 item 可见 && 遮挡判定通过`。OBR 只知道前一半。

### 4.3 墙体外扩（套件自有功能，非上游）

迷雾编辑器把 `wallExpandPx` 写在 outline Path 上，让**可见轮廓**留在原地、
**挡视线的墙**向内或向外偏移。两个坑本次一并修掉：

- 保存时曾经写成 `Math.max(0, …)`，滑块的负半区（墙嵌进墙体材质里）静默失效，
  编辑器里的洋红色墙体预览和实际保存结果对不上。现在按有符号值保存。
- 该值的单位是**图片像素**，换算成 Path 命令所在的 map-local 单位需要地图图片的
  `grid.dpi`。「独立保存」模式下 Path 没有 `attachedTo`，根本找不到那张地图。
  现在保存时额外写一份换算好的 `${PLUGIN_ID}/wallExpandLocal`；老场景仍走旧路径。

## 5. 玩家开关门窗

OBR 里 FOG 图层的 item 玩家**读得到**（客户端要自己渲染迷雾，上游的墙推导也依赖
这一点），但**写不了**。所以：

```
玩家点击门指示器
  → OBR.broadcast.sendMessage(BC_TOGGLE_OPENING,
       { itemId, openingId, open: !当前状态 }, { destination: "REMOTE" })
  → GM 的 background 收到 → 校验 fogPlayerDoors → updateItems 写 open
  → 全客户端 items.onChange → Reconciler → 墙重算 + 指示器换色
```

广播里带的是**目标状态**而不是「翻转」：一个房间可能有多个 GM，每个 GM 都会收到
这条广播，翻转会被执行两次而互相抵消。

玩家侧的点击入口是工具栏上的独立工具 **「开关门窗」**（`OBR.tool.create`，快捷键
K）。之所以不用「点选指示器即切换」：本地 item 必须可选中才能触发选中事件，而可
选中的指示器就能被玩家拖走。工具事件可以命中 `locked` 的 item，所以指示器保持
锁定、不可拖动。

指示器图层：

- GM → `CONTROL`（在 FOG 之上，自己的迷雾也挡不住）
- 玩家 → `DRAWING`（在 FOG 之下，未探索区域的门不会透过迷雾泄露地图结构）

## 5.2 光源遮挡（套件自有，2026-08-25）

没有这一层，玩家会看见地牢里**每一支**火把的光晕 —— 包括三个房间外那个正准备
伏击他们的 NPC 手里那支。规则（按 GM 的要求定）：

> 别人的光源默认不可见；只有当**玩家自己某盏灯**到那盏灯之间的直线**没有被墙挡住**
> 时，它才可见。

- **只看墙，不看距离** —— 「远处那团火我看不看得见」是视线问题，空旷野地上
  几百尺外的营火当然看得见。
- **不传递** —— 走廊里一串火把会随着你逐个获得视线依次点亮，而不是一次全亮。
- `ambient` 光源（墙上火把、天光）永远可见；GM 永远不被遮挡。
- ⚠ 直接后果：**身上一盏灯都没有的玩家，除环境光外什么都看不见**。这是规则的
  正确读法，也正是 `ambient` 存在的理由。

实现：`light/wallIndex.ts` 把 WallActor **真实吐出的**那批折线（含所有已打开的
门造成的缺口）灌进一个均匀网格，视线查询沿网格 DDA 行进，只测经过的格子。
描边地图上有几万条线段，线性扫描不可行。索引按墙体签名重建，查询按每次
token 移动提交跑一次（OBR 拖拽期间不发布 item 变更，所以不在逐帧路径上）。

端点会往内**收一小段**（0.18 格）：墙上的火把 token 就坐在墙上，站在门洞里的
持灯人两侧都是墙桩，不收的话它们会永远自己挡自己。

## 5.3 黑暗视觉 —— 已撤除（2026-08-25）

做过，没成，删了。留这一节是为了让下一个想做的人不用把同样的坑再踩一遍。

**想要的效果**：每盏灯一个 `colorRadius`，半径以内保持彩色，从那里到照明边缘
转成黑白 —— D&D 的暗视。

**思路本身是对的**：挂一个 `EFFECT`，shader 在环形区域画中性灰，靠 Skia 的
**SATURATION** 混合模式抽掉色度而保留亮度与细节。不用采样、不用二次渲染。

**两次都倒在同一件事上：那个 effect 方框到底在哪。**

1. 第一版用 `POST_PROCESS` 图层。表现是「一开就整个画面全黑白，彩色区域根本
   不存在」。诊断出来了：`POST_PROCESS` 名副其实 —— OBR 在**成帧之后、按视口
   空间**跑它，世界空间的方框被整个丢掉，`coord` 横跨的是屏幕而不是光圈，圆心
   落到屏幕外，于是每个像素都判定在 `rInner` 之外。
2. 第二版改到 `ATTACHMENT`（世界空间，位于 MAP 与 CHARACTER 之上，和 bubbles /
   statusTracker 两个跑了很久的 Effect 同层），并把 uniform 声明对齐成那份已知
   可用的写法。**仍然是全黑白。**

第二次失败之后就没有再猜下去的理由了：可疑面还剩「附着 item 时 `position` 到底
被怎么处理」「非分离混合模式对 alpha 的处理」等好几个，每验证一轮都要一次真人
上桌测试。投入产出不成立，整个删掉 —— `DarkvisionActor`、`DarkvisionReactor`、
`LightConfig.colorRadius`、`fogDarkvisionForGM` 设置项。

**下次要做的话，先解决可观测性**：在真实 OBR 会话里加一个能把 effect item 实际
落点读回来的调试通道。不然就是继续盲改。存量场景里残留的 `colorRadius` 会被
`normaliseLightConfig` 直接忽略，无需迁移。

## 6. 设置项（新增）

| 位置 | key | 默认 | 说明 |
| --- | --- | --- | --- |
| 套件场景状态 | `fogPlayerDoors` | `true` | 玩家可见门窗指示器并可自行开关（**密门不受此开关影响，永远不可见**） |
| 套件场景状态 | `fogDoorOverlayAlways` | `false` | GM 不选迷雾工具时也常显门窗指示器 |
| 套件场景状态 | `fogLightOcclusion` | `true` | 光源遮挡（§5.2） |
| 每盏灯 metadata | `ambient` | `false` | 该光源豁免遮挡，对所有人永远可见 |
| **OBR 场景本身** | `scene.fog.filled` | — | 设置面板里的「整张地图铺满迷雾」直通开关。**没打开它，墙和光源不会有任何可见效果** |

### 6.1 模块拆分（2026-08-25）

原来的单一模块 `fullFog` 拆成两个可独立开关的模块：

| 模块 id | 内容 | 关掉的后果 |
| --- | --- | --- |
| `fogEditor` | 右键地图 →「编辑地图迷雾」全屏描边编辑器，没有任何常驻逻辑 | 已描好的迷雾照常工作（墙由下面那个模块生成） |
| `dynamicFog` | dynfog 引擎全部：墙推导、门 / 密门 / 窗、光源、遮挡 | **迷雾不再挡视线**（退回成纯涂黑） |

`fullFog` 这个 id 保留在类型与状态结构里但已退役（恒为 `false`、`background.ts`
不再注册），老房间存的 `fullFog: false` 会被一次性迁移成两个新 id 同时关闭。

## 7. 验证

```bash
node tools/dynfog-selftest.mjs      # 40 项自测（几何 + 视线）
node tools/dynfog-visual.mjs docs/dynfog-walls.svg   # 生成证明图
npx tsc --noEmit                    # 全量类型检查
```

自测用 rolldown（vite 自带）把纯几何打包到 node 里跑，不需要联网、不需要浏览器，
也不需要额外依赖。证明图 `docs/dynfog-walls.svg` 里画的墙**就是** `WallActor`
会生成的那些线段 —— 图上门没开，游戏里就没开。

覆盖范围：轮廓推导（矩形 / 圆 / 三角 / 六边 / Path / Line / Curve）、弧长寻址、
开口切分与合并、跨图形裁剪、墙体外扩后的顶点对应与门位置重映射、上游元数据转换、
开口语义表（kind × open → 挡不挡视线 / 玩家可不可见）、视线索引（墙阻断、门洞
放行、墙上光源的自遮挡与端点收缩、大规模网格行进）、墙体重算的幂等性（同样输入
逐位相同、远处的门不动本图形的墙 —— 这是 `WallActor` 跳过未变墙体的前提）。

### 7.1 开关门时不能有「漏光帧」

`Patcher` 的提交顺序是 **先增、再改、最后删**，不是通常的先删。三步各是一次本地
场景往返，OBR 会在中间出帧，所以顺序决定了玩家在半途看到什么：

- 先删的话，关门时会先删掉第二段墙、再把第一段扩回整圈，中间那一帧**整段第二段
  墙是不存在的**，视线直接灌进去 —— 玩家白捡一眼还没探索的房间。
- 先增则相反：任何中间状态下，挡视线的墙集合都是最终结果的**超集**，最坏只是多挡
  一帧，而多挡是看不出来的（迷雾本来就在那儿）。

代价是同一个 pass 里不能删掉又重建同一个 id。实际上没有地方这么做：每个 actor 都
用 `buildWall()` 之类现生成的新 id。

另一半是 `WallActor` **只改真正变了的墙**。任何一处门的开合都会顶掉全场 WallActor
的签名（重叠图形上的门可能切到本图形，见 `computeSignature`），不加这层判断的话
每点一次门就要重写场景里每一面墙 —— 描边地图上是几千个 item，那个卡顿肉眼就是闪烁。
