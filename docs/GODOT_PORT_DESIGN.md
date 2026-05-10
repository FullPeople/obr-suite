# Full Suite → Godot 4.6 重构设计文档

> 写作日期 2026-05-09
> 作者 / 用户：FullPeople
> 上下文：obr-suite 已迭代到 v1.0.70-dev，受 OBR SDK 渲染管线限制，
> 决定弃用 OBR 自研一套 TRPG 桌面客户端，目标平台 Godot 4.6。

本文档分四部分：
- **Part A**：现状盘点 — OBR 提供了什么、obr-suite 实现了什么、为什么离开 OBR
- **Part B**：用户需求矩阵 — 必须保留 / 想要新增 / 可以放弃
- **Part C**：Godot 4.6 重构指南 — 架构、关键决策、模块映射、里程碑
- **Part D**：附录 — 数据 schema 迁移、外部数据源契约、踩坑列表

---

# Part A：现状盘点

## A.1 OBR 是什么 / 提供了什么

**Owlbear Rodeo (OBR)** 是一个网页版 TRPG 在线桌面平台。所谓"插件"是
跑在 sandboxed `<iframe>` 里的网页，通过官方 SDK (`@owlbear-rodeo/sdk`)
和主进程通信。所有数据修改都走异步消息总线。

### A.1.1 OBR 的核心抽象

| 抽象 | 含义 | 我们如何用 |
|---|---|---|
| **Scene** | 一张地图 / 房间 | 容器，保存 grid + items + metadata |
| **Item** | 场景内任何视觉元素 | token、形状、文字、特效等都是 Item |
| **Layer** | item 渲染层级 | `MAP / GRID / DRAWING / PROP / MOUNT / CHARACTER / ATTACHMENT / NOTE / TEXT / RULER / FOG / POINTER / POST_PROCESS / CONTROL / POPOVER` |
| **Item Type** | item 子类 | `IMAGE / SHAPE / CURVE / TEXT / EFFECT / LIGHT / LINE / LABEL / RULER` |
| **Metadata** | item 上挂的任意 JSON | 我们用它存 HP/AC、绑定卡牌 ID、status buff 列表等 |
| **scene.local** | 本地 item（不广播给其他玩家） | 用作 marquee 矩形、ghost、UI overlay 等 |
| **Tool / Mode** | 工具 + 子模式 | 接管鼠标交互（绘门、传送门、状态追踪等） |
| **Popover / Modal** | 浮层 UI | 我们的所有面板（cluster、settings、cc-info 等）都是 popover |
| **Action** | 工具栏左上角按钮 | 我们用它当 dice panel 的入口 |
| **ContextMenu** | 右键菜单 | 用作 token 上的"绑定怪物"等 |
| **Broadcast** | 跨 iframe / 跨客户端消息 | LOCAL / REMOTE / ALL 三种 destination |
| **Permission** | 角色权限 | GM / PLAYER；character_owner_only 模式 |

### A.1.2 OBR 渲染管线（重要！这是我们离开它的原因）

OBR 内核渲染走 GPU canvas。但**插件不能直接画画**——只能：
1. 通过 `OBR.scene.items.addItems` 把 item 数据塞进场景
2. 通过 `OBR.scene.items.updateItems(ids, drafter)` 改 item 字段
3. OBR 内核拿到这些数据后用 GPU 画

**致命限制**：所有数据修改都经过 message bus（异步 Promise）。
- 单次 `updateItems` 往返延迟实测约 **15–30ms**
- 高频拖动场景下，发 60Hz 跟绘制 60Hz 总是错位 → 视觉卡顿
- OBR 原生拖动**不走这条总线**——它直接改 GPU 变换矩阵，所以丝滑

我们尝试过的所有规避方案都失败：
- `scene.local.updateItems`（本地 item）也走同一条总线
- rAF throttle / 不 await / coalescing 都吃这个延迟下限
- ATTACHMENT effect 类型有 dormancy bug（首次绘制不应用 parent.scale）
- 自实现 mode 接管 drag → 拖动比原生卡 + 实现 marquee/cursor/multi-select 全要重写

**结论**：拖动流畅度 + UI 自由度，OBR 给的就是这么多。无论如何雕花，
都赶不上一个直接控制 canvas 的本地 app。

### A.1.3 OBR SDK 踩坑速查（提炼自 `feedback_obr_dev.md` + 实战）

1. `OBR.scene.onMetadataChange` 跨 iframe 不可靠 → 必须配 broadcast 冗余
2. `OBR.broadcast.onMessage` 必须在 `OBR.onReady` 内注册 — 顶层调会崩
3. `OBR.tool.createAction` 的快捷键只在 OBR 主窗口聚焦时生效 — 用户点进
   iframe 后就不响应 → 每个 iframe 自己再加一份 `keydown` listener
4. `manifest.json` 不能有 `background` 字段，OBR 拒收
5. HTTPS 强制；本地开发要 `@vitejs/plugin-basic-ssl`
6. `*.html` 必须配 nginx `Cache-Control: no-cache, must-revalidate`，
   否则更新后旧 html 引用已删除的 hash JS → 白屏
7. iframe `pointerdown` 自动展开是坑（玩家拖 token 经过区域会触发） →
   用 `keydown`
8. 跨域 iframe 不能用 `showOpenFilePicker` → 用普通 `<input type=file>`
9. Vite ESM 循环依赖会把 CJS 互操作助手放进 user chunk，用 manualChunks
   单独 vendor 块
10. **OBR 的 popover layer 第一次 open 偶尔不 render** — 注册顺序敏感
11. `attachedTo` 改了再改回去会破坏 POSITION/SCALE 继承（v1.0.38 攻略）
12. Effect item 的 width/height 只能 delete + re-add 才生效（Curve / Shape
    可以 patchGeometry）
13. Effect with SCALE inheritance 是 "capture-once" — parent.scale 改后不
    重算，必须 delete + re-add
14. `onChange` 拖动期间不触发，只在 commit 时一次

---

## A.2 obr-suite 当前架构

### A.2.1 顶层结构

```
E:/枭熊插件/obr-suite/
├── package.json           — preact 10 + @owlbear-rodeo/sdk + vite 8
├── vite.config.ts         — 多入口 + dev 命名空间重写插件
├── tsconfig.json
├── public/                — 图标、声音、xlsx 模板、manifest
├── docs/                  — store.md（OBR 商店清单）+ 截图
├── *.html                 — 23 个独立 iframe 入口
└── src/
    ├── background.ts      — 后台 iframe，模块注册 + cluster 打开
    ├── cluster.ts         — 底部按钮组
    ├── settings.ts        — 设置 + 关于（10 个 tab）
    ├── state.ts           — 跨 iframe 状态广播
    ├── i18n.ts            — 中英文翻译
    ├── feature-flags.ts   — STABLE_HIDES 开关
    ├── *.ts               — 单 iframe 页面（hp-bar / status / dm-announcement / drag-preview / layout-editor 等）
    ├── modules/<id>/      — 21 个模块
    └── utils/             — 通用工具（panelLayout / panelDrag / statEdit / debugOverlay / localContent / canvasDragMode / viewportAnchor）
```

### A.2.2 模块清单（21 个）

按"用户感知到的功能"分组：

#### 战斗工具组
| 模块 | 文件 | 描述 |
|---|---|---|
| **dice** | `modules/dice/{index, panel-page, effect-page, history-page, replay-page, sfx, sfx-broadcast, context-menu, tags}.ts` | 完整骰子系统：表达式（adv/dis/max/min/reset/burst/same/repeat）、暗骰、回放、历史、SFX、5etools 标签解析 |
| **initiative** | `modules/initiative/{index, panel-page.tsx, components/, hooks/, utils/}` | 先攻追踪面板（顶部横条）+ 战斗特效 + 隐身（半成品） |
| **bestiary** | `modules/bestiary/{index, panel-page.tsx, monster-info-page, data, spawn, group-saves}.ts` | 怪物图鉴：5etools 数据库 + 自动召怪 + 团体豁免 |
| **characterCards** | `modules/characterCards/{index, panel-page, info-page, bind-page, fullscreen-page.tsx}.ts` | 角色卡：xlsx 上传 → 服务端解析 → 全屏 Preact 渲染 + 内联编辑 + 导出导入 |
| **bubbles** | `modules/bubbles/index.ts` | token 上的 HP 条 / AC 盾 / temp HP 圈 |
| **hpBar** | `modules/hpBar/index.ts` | 单独的 HP 条组件（与 bubbles 互补） |
| **statusTracker** | `modules/statusTracker/{index, bubbles, circles, types}.ts` + `status-tracker-page.ts` | 全屏状态追踪面板：32 个 buff 调色板 + 拖入 token + 资源管理 |
| **resourceTracker** | `modules/resourceTracker/index.ts` | 角色资源（药水/卷轴/法术位）追踪（半成品） |

#### 场景工具组
| 模块 | 文件 | 描述 |
|---|---|---|
| **fullFog** | `modules/fullFog/{index, types, editor-page, door/, light/, tools/, algorithms/, refinement/, output/}` | 动态雾、光源、门窗、视野、墙的本地光线追踪重写（自定义版动态雾）|
| **portals** | `modules/portals/{index, edit-page, destination-page, types}.ts` | 传送门：拖圆 = 传送区 + 同 tag 链接 + 多 token 螺旋集合 |
| **circleImage** | `modules/circleImage/index.ts` | 圆形头像 token（替代方形） |
| **trickster** | `modules/trickster/index.ts` | 实验功能（我猜是某种伪装/变身） |
| **worldPack** | `modules/worldPack/index.ts` | 世界资源包导入 |

#### 系统工具组
| 模块 | 文件 | 描述 |
|---|---|---|
| **timeStop** | `modules/timeStop.ts` | 时停模式 — 全屏黑边淡入淡出 |
| **focus** | `modules/focus.ts`（被合并） | 同步视口 — 把 GM 当前选中或视口中心同步给所有玩家 + 登登声 |
| **follow** | `modules/follow/index.ts` | 跟随某个 token（视口锁定） |
| **search** | `modules/search/{index, page}.ts` | 5e 全局搜索（顶右浮层）|
| **dev-test** | `modules/dev-test/index.ts` | 开发测试工具，仅 dev 渠道 |
| **metadata-inspector** | `modules/metadata-inspector/{index, inspector-page}.ts` | 调试工具：检查 item / scene / room / performance 元数据 |
| **perfWindow** | `modules/perfWindow/index.ts` + `perf-window-page.ts` | FPS + drawcall 监视器（左上角小框） |

#### UI 基础设施
| 工具 | 文件 | 描述 |
|---|---|---|
| **panelLayout** | `utils/panelLayout.ts` + `drag-preview.ts` + `layout-editor.ts` | 8 个 panel 的拖动 / 缩放 / 持久化 + 全屏编辑器 |
| **panelDrag** | `utils/panelDrag.ts` | iframe 侧的 drag handle helper |
| **statEdit** | `utils/statEdit.ts` | HP/AC 输入解析 `+5` / `15+5` 表达式 + 跨字段 clamp |
| **debugOverlay** | `utils/debugOverlay.ts` | 7 个 iframe 共用的调试浮层 |
| **localContent** | `utils/localContent.ts` | 本地 JSON/MD 数据导入（替代 URL 库） |
| **canvasDragMode** | `utils/canvasDragMode.ts` | 自实现的拖动 + marquee mode（在 OBR 上失败的尝试） |
| **viewportAnchor** | `utils/viewportAnchor.ts` | viewport resize 重锚 |

### A.2.3 后端服务（character-cards-server）

`E:/枭熊插件/character-cards-server/`：
- Python Flask + gunicorn（systemd `obr-character-cards.service`）
- 端口 5001，nginx 反代 `/api/character/`
- `parser.py` — xlsx → JSON（3 种 layout：v1.0.0 / v1.0.12 / v1.0.12-2014mode）
- `renderer/template.html` — Jinja2 渲染（已被前端 Preact 替代，目前只用 parser）
- 数据存于 `/var/www/character-cards-data/<roomId>/<cardId>/data.json`

### A.2.4 部署架构

- 阿里云 ECS：`47.120.61.255`，Ubuntu 24.04
- 域名：`obr.dnd.center`（A 记录）
- HTTPS：Let's Encrypt 自动续签
- 主插件 URL：`https://obr.dnd.center/suite/manifest.json`
- Dev 渠道：`https://obr.dnd.center/suite-dev/manifest-dev.json`（命名空间 `com.obr-suite-dev/`，可与 stable 并存）
- 部署脚本：`build-and-pack.sh` / `deploy-suite.sh` / `deploy-suite-dev.sh`

---

## A.3 obr-suite 当前完成度

按模块的 readiness 分类：

### A.3.1 已稳定 / 用户验收
- **dice** — 完整骰子表达式 + 历史 + 回放 + SFX + 5etools 标签
- **initiative** — 战斗 / 准备状态 + 团体豁免 + 自动加入
- **bestiary** — 怪物列表 + 详情面板 + 拖入召怪 + 库设置
- **characterCards** — xlsx 上传 + 全屏渲染 + 内联编辑（HP/AC/HD）+ 导出导入
- **statusTracker** — 32 个 buff + 拖放 + 资源管理
- **timeStop / focus / follow / search / portals** — 都基本可用
- **panelLayout** — 8 个面板拖动持久化

### A.3.2 已实现但有遗留问题
- **bubbles** — 静态 / 初始 / commit 后状态都对，但拖动 / 缩放期间
  会"飞走"或"闪到 native 尺寸"。用户接受了这个状态作为 v1.0.42 baseline
  （详见 `bubbles_module.md` 的失败 chronology — **不要重试同样的 attempt**）
- **fullFog** — 自实现动态雾 + 光源 + 门窗 + 单墙 peek，比 OBR 官方动态雾
  更灵活但也更脆弱
- **resourceTracker** — UI 半成品，等 character card v2 schema 0.3 喂数据

### A.3.3 待办（来自 `obr_suite_pending_work.md`）
- **P4 #10** — 全屏消耗品管理面板（药水/卷轴/子弹一键扣减）
- **P5 #13** — Stealth/隐身功能（context menu + shader overlay + 暗骰 + 面板过滤），半实现，藏在 STABLE_HIDES 后
- **P5 #14** — HP bar 拖动时实时跟踪 — **明确不要再尝试**，10 轮失败的史诗

### A.3.4 已知/接受的痛点
- 拖动 token 时血条会"snap to NATIVE size"，松手才回正（OBR Curve 渲染层 bug，无 workaround）
- 缩放 token 时血条 / 文字 / AC 盾完全不跟随，commit 后才更新（SCALE 继承的 dormancy）
- transformer 把手 + 上下文菜单 UI 无法在自定义 mode 中隐藏（OBR 不暴露开关）

### A.3.5 截至 2026-05-09 最新一轮失败的尝试
**自实现拖动 mode（path A）失败记录**：
- 起因：用户希望 token 缩放时血条不闪 → 想接管 transformer drag
- 路径 A：`preventDrag: undefined` 拦截所有拖拽，自实现 token-move + marquee + cursor
- 失败：拖动比 OBR 原生卡（吃 message bus 延迟）、cursor filter 不生效、transformer 视觉残留无法隐藏
- 用户反馈："拖动比之前更卡"、"鼠标样式没变化"、"我有点绝望"
- **最终结论**：在 OBR SDK 上做 path A 是死路，所以决定转 Godot

---

# Part B：用户需求矩阵

按优先级排序：

## B.1 必须保留（核心 TRPG 体验）

### B.1.1 地图 / token 系统
- [ ] 加载图片作为地图背景
- [ ] 地图上放置 token（角色 / 怪物 / 道具）
- [ ] **token 拖动丝滑**（关键 — OBR 上做不到，是转 Godot 的主要动机）
- [ ] token 缩放 / 旋转，缩放时血条平滑跟随
- [ ] token 多选 + 框选（marquee）
- [ ] 网格 grid（方格 / 六边形可选）
- [ ] 视口缩放 / 平移
- [ ] 多人实时同步（GM + 玩家）

### B.1.2 角色血量 / AC（bubbles 模块）
- [ ] token 上方显示 HP 条 + 数值
- [ ] AC 盾形图标 + 数值
- [ ] Temp HP 后缀 `+N`
- [ ] HP 比例条颜色（红色填充）+ shimmer 动画
- [ ] DM 锁定状态：玩家根据 lock 看到 silhouette / 完整 / 隐藏
- [ ] 战斗中 vs 战斗外不同显示策略（lock + inCombat → silhouette）
- [ ] 玩家阈值量化（25%/50% step）
- [ ] DM-only 隐藏开关（hide flag）
- [ ] 跟随 token 缩放 / 移动 / 旋转（**这是 OBR 上的痛点**）

### B.1.3 骰子系统（dice 模块）
- [ ] 完整表达式：`2d6+1d20+5`、`adv(...)`、`dis(...)`、`max/min/reset/burst/same/repeat`
- [ ] 表达式编辑器（含 ± modifier 按钮）
- [ ] 多目标投掷（每个 token 一份结果）
- [ ] 暗骰（DM-only 显示）
- [ ] 投掷历史（按玩家分组，最多 N 条）
- [ ] 投骰回放（点击历史条目，token 上方浮气泡显示骰组）
- [ ] 投掷动画 + SFX（dice.mp3 + cartoon.mp3 + Web Audio 合成音）
- [ ] 5etools 标签转可点击：`{@dice}` / `{@damage}` / `{@hit N}` / `{@d20 N}` / `{@chance N}` / `{@scaledamage}` / `{@recharge N}`
- [ ] 优势/劣势右键菜单
- [ ] 添加到骰盘（让玩家在面板里编辑）

### B.1.4 先攻追踪（initiative）
- [ ] 顶部横条显示战斗顺序
- [ ] 添加 / 移除 / 清空
- [ ] 投掷先攻（自动调用 dice 系统，含 dexMod）
- [ ] 团体豁免（group save）
- [ ] 当前回合高亮 + 轮次计数
- [ ] 战斗特效（开始 / 结束 / 切换回合）
- [ ] 自动加入（怪物图鉴召唤时自动入战，per-scene 开关）
- [ ] 战斗状态（idle / preparing / inCombat）写入 scene metadata 给 bubbles 用

### B.1.5 怪物图鉴（bestiary）
- [ ] 5etools 兼容数据库浏览（CR / 体型 / 类型筛选）
- [ ] 怪物详情面板（属性 / 招式 / 词条解析含 5etools 标签）
- [ ] 拖入地图 = 召唤 token + 自动写 HP/AC/Name + dexMod
- [ ] 多库（kiwee.top / 自托管 / 本地导入 JSON+MD）
- [ ] token 右键菜单：绑定 / 替换 / 解绑怪物（同步刷新血条）
- [ ] 怪物面板里的属性 / 技能 / 招式可点击直接投骰
- [ ] 自动 popup 设置（选中绑定 token 自动开详情）
- [ ] 自动 token 名（spawn 时自动写 plainText）

### B.1.6 角色卡（characterCards）
- [ ] xlsx 模板上传（v1.0.0 / v1.0.12 / v3.5.x-2014mode）
- [ ] 服务端解析 → JSON（schema v0.3）
- [ ] 全屏面板（6 tab：概览 / 战斗 / 法术 / 特性 / 物品 / 背景）
- [ ] 暖羊皮纸调色（charcoal/parchment/gold/ember/sage/bronze）
- [ ] 点击属性 / 豁免 / 技能 / 武器 → 自动投骰（含熟练加值）
- [ ] 内联编辑 HP/AC/HD（current/max/temp）
- [ ] JSON 导出 / 导入
- [ ] 法术 / 特性可展开详情
- [ ] 多客户端实时同步（broadcast `BC_CARD_UPDATED`）
- [ ] CC 绑定优先级 > bestiary（绑定时清掉 bestiary 数据）
- [ ] 在搜索栏搜词条名（点击法术 / 专长名 → 顶部搜索栏自动检索）
- [ ] 服务端 ↻ 刷新按钮（重新上传同 xlsx，覆盖 data.json）
- [ ] 资源追踪：药水 / 卷轴 / 法术位 / 特殊（诗人激励 / 气能点等）
- [ ] 神奇物品 / 消耗品 / 战斗风格特性 / 特殊能力 字段

### B.1.7 状态追踪（statusTracker）
- [ ] 全屏面板，[ 键打开
- [ ] 32 个内置 buff 调色板（paralyzed / charmed / invisible / blessed / ...）
- [ ] 拖入 token → 应用 buff（环形布局：top → left → right，22°/slot，120° 满后外环 +30px）
- [ ] buff → 别的 token = 移动；buff → 空地 = 移除
- [ ] 资源管理（per-token consumables）
- [ ] 自定义 buff catalog（编辑 UI 待做）

### B.1.8 时停 / 同步视口 / 跟随
- [ ] DM 一键时停：黑边淡入 + 所有玩家时间感冻结
- [ ] 同步视口：DM 当前选中 / 视口中心 → 所有玩家相机 animateTo + 登登声
- [ ] 跟随：选中 token 后开启，相机锁定该 token

### B.1.9 全局搜索（search）
- [ ] 顶右浮层（idle 280×40，展开 720×440）
- [ ] 多库并行查询，按 ENG_name|source 合并
- [ ] hover 预览右栏，click 钉住
- [ ] 5etools 标签全部可点击触发投骰
- [ ] 自定义库管理（HTTPS 主机 + 本地 JSON/MD 导入）

### B.1.10 传送门（portals）
- [ ] 拖圆 = 创建圆形传送区
- [ ] 同 tag 双向链接 / 单向出口 / 中性出口
- [ ] 多 token 进入 = 螺旋集合到目的地
- [ ] 兼容动态雾的光源（snap-strip-restore 元数据）

### B.1.11 动态雾（fullFog）
- [ ] 自绘墙（线段 / 多边形 / 矩形）
- [ ] 视野算法（光线追踪，single-wall peek 漏视效果）
- [ ] 光源（attenuation radius / source radius / falloff）
- [ ] 门 / 窗（开 / 关状态切换）
- [ ] DM 编辑模式 vs 玩家视角
- [ ] 性能：视野计算控制在 16ms 内

## B.2 想要新增（在 OBR 上做不动 / 没做的）

### B.2.1 渲染层自由
- [ ] 自定义 token 视觉效果（描边 / 发光 / 描色 / 状态贴图）
- [ ] 真正的视差 / 多图层地图（背景 / 中景 / 前景）
- [ ] 灯光 / 阴影动态（不是 OBR 动态雾的"非黑即白"）
- [ ] token 速度 / 移动轨迹可视化
- [ ] 自定义 grid（六边形 / 三角形 / 等距 / 无网格）

### B.2.2 战斗增强
- [ ] AOE 模板（圆 / 锥 / 立方 / 直线）拖出来 + 对齐网格 + 显示影响 token 列表
- [ ] 攻击 / 法术施放动画（从施法者飞向目标，含粒子）
- [ ] 自动伤害分发（指定法术，选中目标，自动豁免投掷 + 伤害减半）
- [ ] 反应触发提示（目标被击中时弹"是否使用反应"）
- [ ] 死亡豁免追踪
- [ ] Concentration 检定提醒（受伤时自动提示 DC10 或 ½伤害）

### B.2.3 协作功能
- [ ] 实时聊天（in-game chat，DM 私聊 / 全频）
- [ ] 玩家笔记（私人 + 共享）
- [ ] 标记笔（GM 引导玩家注意，n 秒后自动消失）
- [ ] 协作绘图（玩家画线给 DM 看路线 etc）

### B.2.4 内容生态
- [ ] 5etools 数据库本地优先 / 离线可用（不依赖 kiwee.top）
- [ ] 自定义编辑器（DM 创建怪物 / 法术 / 物品）
- [ ] 模组 / 战役管理（多场景一个战役，跨场景持续状态）
- [ ] AI 辅助生成（NPC / 战斗 / 描述，可选模块）

### B.2.5 用户体验
- [ ] 热重载 / 版本升级时不掉数据（OBR 上常被坑）
- [ ] 房间存档（导出整个房间状态，备份 / 分享）
- [ ] 桌面端 + 移动端（玩家用手机看角色卡、投骰）
- [ ] 离线模式（无网络也能跑）
- [ ] 多语言（i18n 框架，至少中英）

## B.3 可以放弃 / 不再保留

- ❌ **OBR 兼容性** — 既然换平台，不需要保留 OBR 的概念抽象
- ❌ **Tool / Mode / Cursor 这套交互模型** — Godot 自己做更直接
- ❌ **多 iframe + broadcast 架构** — Godot 单进程，直接 signal/event
- ❌ **xlsx 服务端解析**（短期）— 角色卡可以改成本地导入 JSON 直接编辑，xlsx 模板作为可选导入路径
- ❌ **PolyForm Noncommercial** — 重写后可重新选 license（GPL-3.0 / MIT / 自定义）
- ❌ **自定义 popover panel layout 系统** — Godot 的 Control 节点直接拖
- ❌ **Stat Bubbles for D&D 兼容元数据** — 全自定义 schema
- ❌ **dev/stable 双渠道** — 单 app 用版本号管理足够

## B.4 需求优先级（重写时的实施顺序）

按"最早需要测试通"的顺序：

1. **MVP（4 周左右）**：地图 + token 拖动 + 多人同步 + HP 条 + 简单骰子表达式
2. **能跑团（再 4 周）**：先攻 + bestiary + 简单角色卡 + 视口同步 + 时停
3. **完整体验（再 6 周）**：动态雾 + 光源 + 状态追踪 + 完整骰子（adv/burst/repeat）+ 5etools 标签解析 + 传送门
4. **抛光（再 4 周）**：AOE 模板 + 自定义编辑器 + 主题 + i18n + 移动端适配
5. **生态**（持续）：模组 / 战役 / AI / 离线模式

---

# Part C：Godot 4.6 重构指南

## C.1 为什么是 Godot 4.6

- **原生渲染控制** — 直接画 canvas，60Hz 拖动无延迟（解决 OBR 主痛点）
- **GDScript + C# 双语言** — GDScript 写脚本快，C# 写性能敏感模块
- **节点 + signal 架构** — 比 OBR 的 broadcast + metadata 干净
- **跨平台** — Windows / macOS / Linux / Web (HTML5 export) / Android / iOS 一份代码
- **高级 multiplayer API** — `MultiplayerSpawner` + `MultiplayerSynchronizer` + RPC，省去自己写
  网络层
- **2D 性能** — Godot 2D 渲染基于 Vulkan / OpenGL，原生 GPU 加速
- **生态** — Godot Asset Library + AssetLib + 大量 GDExtension（粒子、特效、UI 库）
- **License 友好** — MIT，可以发布商业版（但用户偏好非商业，可以选 GPL）
- **学习曲线** — 用户已经写过 TS + Preact，GDScript / GDScript-Lambda 类似 Python，C#
  类似 TS

## C.2 Godot 项目结构建议

```
full-suite-godot/
├── project.godot                — Godot 项目文件
├── icon.svg
├── addons/                      — 第三方插件 (asset library)
│   ├── godot-jolt/              — 物理（虽然 TRPG 不大需要）
│   └── (其他)
├── globals/                     — 全局单例 (autoload)
│   ├── EventBus.gd              — 全局信号总线（替代 OBR broadcast）
│   ├── Settings.gd              — 用户设置 + i18n
│   ├── NetState.gd              — 多人状态 + RPC 入口
│   └── DiceRng.gd               — 全局骰子随机数
├── scenes/                      — 场景文件 (.tscn)
│   ├── main.tscn                — 主菜单
│   ├── game.tscn                — 主游戏画面（地图 + UI）
│   └── ui/                      — 各 panel 子场景
│       ├── cluster.tscn
│       ├── dice_panel.tscn
│       ├── initiative_strip.tscn
│       ├── bestiary_panel.tscn
│       ├── cc_fullscreen.tscn
│       ├── status_tracker.tscn
│       └── settings.tscn
├── scripts/                     — GDScript 主代码
│   ├── core/
│   │   ├── token.gd             — Token 节点（替代 OBR Item）
│   │   ├── map_view.gd          — 地图渲染 + 视口
│   │   ├── grid.gd              — 网格系统
│   │   └── selection.gd         — 选择管理
│   ├── modules/
│   │   ├── bubbles/             — 血条 / AC / temp HP
│   │   ├── dice/                — 骰子表达式 + 历史 + 回放
│   │   ├── initiative/
│   │   ├── bestiary/
│   │   ├── character_cards/
│   │   ├── status_tracker/
│   │   ├── full_fog/            — 自实现动态雾
│   │   ├── portals/
│   │   ├── time_stop/
│   │   ├── focus/
│   │   ├── follow/
│   │   ├── search/
│   │   └── world_pack/
│   ├── parsers/                 — 5etools / xlsx / md 解析
│   │   ├── etools_loader.gd
│   │   └── card_xlsx_parser.cs  — C# 用 NPOI 库读 xlsx（GDScript 没现成 xlsx）
│   ├── ui/                      — 通用 UI 控件
│   └── networking/              — 多人同步层
│       ├── server.gd            — host 模式
│       ├── client.gd
│       └── sync.gd              — MultiplayerSynchronizer 配置
├── data/                        — 静态数据
│   ├── etools/                  — 内置 5etools JSON
│   ├── card_templates/          — xlsx 模板
│   └── default_buffs.json       — 32 个 buff
├── assets/
│   ├── icons/                   — UI 图标（沿用 obr-suite 的 svg）
│   ├── sfx/                     — dice.mp3 / cartoon.mp3 + Web Audio 合成
│   ├── themes/                  — UI 主题（warm parchment + dark slate）
│   └── shaders/                 — token 描边 / shimmer / fog 着色器
└── docs/
    ├── README.md
    ├── CHANGELOG.md
    └── this file
```

## C.3 关键概念映射（OBR → Godot）

| OBR 概念 | Godot 对应 | 备注 |
|---|---|---|
| **Scene** | `Node`（一个 scene 文件 .tscn） | Godot scene 也叫 scene，但语义更广 |
| **Item** | `Node2D`（自定义节点 Token / Wall / etc） | 直接控制 transform，不走 message bus |
| **Layer** | `CanvasLayer` 或 z_index | Godot 内建分层 |
| **Item Type** | 节点 class | Token extends Node2D，Wall extends Node2D |
| **Metadata** | 节点的 `set_meta` 或自定义 dict 字段 | 序列化到 JSON 存档 |
| **scene.local** | 本地 Node（不通过 RPC 同步） | 直接 add_child，不调 spawn RPC |
| **Tool / Mode** | InputEventHandler 状态机 | 自己写状态机就好，不用 OBR 的 mode |
| **Popover / Modal** | `PopupPanel` / `Window` | Godot UI 自带 |
| **Action** | 工具栏 Button | 普通 UI 节点 |
| **ContextMenu** | `PopupMenu` | Godot 自带 |
| **Broadcast** | `signal` 或全局 `EventBus` | 同进程 = signal；跨客户端 = RPC |
| **Permission** | 自定义 role 字段 + 检查 | 服务端权威 |
| **OBR.viewport.animateTo** | `Camera2D.position` 插值 | 用 Tween |
| **OBR.scene.items.onChange** | 节点 `tree_changed` 或自定义 signal | |
| **OBR.player.onChange** | 监听 selection signal | |

## C.4 核心架构决策

### C.4.1 渲染：Node2D + Camera2D

```gdscript
# scripts/core/token.gd
class_name Token
extends Node2D

@export var token_data: TokenData       # Resource 自定义类
@onready var sprite: Sprite2D = $Sprite
@onready var hp_bar: Node2D = $HPBar    # 子节点，自动跟随父级 transform
@onready var status_ring: Node2D = $StatusRing

func _process(delta: float) -> void:
    # 直接改 position / scale / rotation，60Hz 自动渲染
    # 没有 message bus，没有延迟
    pass

func apply_drag(target_pos: Vector2) -> void:
    position = target_pos
    # 子节点（HP 条 / status 圆环）自动跟随，不需要任何同步代码
```

**核心收益**：拖动直接改 `position`，60Hz 流畅，无 bus 延迟。子节点自动继承
父级变换，HP 条 / status 圆环 / AC 盾完全不需要单独 sync。这是 OBR 上做不到的。

### C.4.2 多人同步：Server-authoritative + RPC

Godot 4 自带 `MultiplayerSpawner` + `MultiplayerSynchronizer`，配合 RPC 函数：

```gdscript
# scripts/core/token.gd

@rpc("authority", "call_local", "reliable")
func server_set_hp(new_hp: int) -> void:
    # 只在 server 上执行权威逻辑
    if not multiplayer.is_server():
        return
    token_data.hp = new_hp
    sync_to_clients.rpc(token_data.serialize())

@rpc("authority", "call_local", "reliable")
func sync_to_clients(data: Dictionary) -> void:
    # 所有客户端收到，更新本地视图
    token_data.apply(data)
    update_visuals()

func _on_dragged(new_pos: Vector2) -> void:
    if multiplayer.is_server():
        server_move.rpc(new_pos)
    else:
        request_move.rpc_id(1, new_pos)  # 请求 server

@rpc("any_peer", "call_local", "unreliable")  # unreliable for high-freq drag
func request_move(target: Vector2) -> void:
    if not multiplayer.is_server(): return
    # server 验证权限 + 应用 + 广播
    if can_move_token(multiplayer.get_remote_sender_id()):
        position = target
        sync_position.rpc(target)

@rpc("authority", "call_local", "unreliable")
func sync_position(p: Vector2) -> void:
    position = p
```

**关键**：拖动用 `unreliable` RPC（UDP），位置丢一两帧无所谓；HP/AC 改动用
`reliable` RPC（TCP），不能丢。OBR 把所有都按 reliable 走，是它另一个慢的原因。

### C.4.3 数据模型：Resource 文件

Godot 的 `Resource` 类可以序列化到 `.tres` / `.res`，类型安全，IDE 友好：

```gdscript
# scripts/core/token_data.gd
class_name TokenData
extends Resource

@export var id: String
@export var name: String = ""
@export var image_path: String = ""
@export var position: Vector2
@export var scale: Vector2 = Vector2.ONE
@export var rotation: float = 0.0

# 替代 OBR metadata
@export var hp: int = 0
@export var max_hp: int = 0
@export var temp_hp: int = 0
@export var ac: int = 10
@export var locked: bool = true
@export var hidden: bool = false

# 5etools 怪物绑定
@export var bestiary_slug: String = ""
@export var card_id: String = ""

# Buff
@export var buffs: Array[String] = []

# 自定义资源（药水/法术位）
@export var resources: Array[ResourceItem] = []

func to_dict() -> Dictionary: return inst_to_dict(self)
static func from_dict(d: Dictionary) -> TokenData:
    var t = TokenData.new()
    # ... 字段一一拷贝
    return t
```

### C.4.4 全局事件总线

Godot autoload 单例代替 OBR broadcast：

```gdscript
# globals/EventBus.gd  (autoload as "Events")
extends Node

# 全局信号定义
signal token_selected(tokens: Array[Token])
signal token_dragged(token: Token, new_pos: Vector2)
signal dice_rolled(roll: DiceRoll)
signal initiative_changed()
signal combat_state_changed(state: String)
signal scene_metadata_changed(key: String, value: Variant)

# 跨场景查询
func get_selected_tokens() -> Array[Token]:
    return SelectionManager.selected
```

任何节点 `Events.token_dragged.connect(my_handler)` 就能监听，不需要 broadcast id /
LOCAL/REMOTE 分离 / scope 检查。

## C.5 模块映射 — 怎么把 obr-suite 各模块在 Godot 里做

### C.5.1 Bubbles（HP / AC / temp）— **最受益的模块**

OBR 上：每个 bubble 是单独的 Item，attached 到 token，受 message bus 限速。

Godot 上：
```gdscript
# Token 场景树
Token (Node2D)
├── Sprite2D (token image)
├── HPBar (Node2D, 子节点自动跟随)
│   ├── BgRect (ColorRect)
│   ├── FillRect (ColorRect, scale.x = ratio)
│   ├── ShimmerOverlay (ShaderMaterial 跑 SKSL 等价 GDShader)
│   └── HPText (Label)
├── AcShield (Node2D)
│   ├── ShieldShape (Polygon2D 画 heater shield)
│   └── AcLabel (Label)
└── StatusRing (Node2D, 32 个 buff 环形布局)
```

- **静态 / 拖动 / 缩放 / 旋转** — 子节点自动跟随父级 transform，**完全不需要写 sync 代码**
- **shimmer 动画** — `_process(delta)` 里更新 shader uniform，60Hz 流畅
- **viewMode（full/silhouette/hidden）** — 简单的 `visible = ` + `text.visible = false` 切换
- **多客户端同步** — Token.sync_data RPC 把 hp/maxHp/locked/hidden 推过去，每个客户端
  自己 redraw

OBR 上的所有失败 chronology（v1.0.34→v1.0.50 那 16 个版本）在 Godot 上**根本不会出现**，
因为 Godot 的 transform 继承是渲染层的，不是 metadata sync 层的。

### C.5.2 Dice — 表达式解析器

GDScript 写表达式解析器没问题（递归下降）。骰动画用 Godot 的 Tween + AnimationPlayer：

```gdscript
# scripts/modules/dice/expression.gd
class_name DiceExpression

static func parse(s: String) -> DiceNode:
    # 把 "adv(2d6+5)+1d4" 解析成 AST
    # ... recursive descent

# scripts/modules/dice/effect.gd
extends Node2D

func play_roll_animation(rolls: Array[DiceResult]) -> void:
    # Phase A: max/min/reset 转 720°
    # Phase B: burst 链式炸开
    # Phase C: same-tint 同色高亮
    # Phase D: climax 飞向历史
    # 全部用 Tween，比 OBR effect-page 的 setTimeout 链清晰
```

**音效** — 直接 `AudioStreamPlayer.play()`，没有 OBR 的 cross-iframe broadcast 问题。

### C.5.3 Initiative — 节点列表 + 排序

```gdscript
# scripts/modules/initiative/strip.gd
extends HBoxContainer  # 顶部横条

var entries: Array[InitiativeEntry] = []

func add_entry(token: Token, init: int) -> void:
    var e = InitiativeEntry.new()
    e.token = token
    e.initiative = init
    entries.append(e)
    entries.sort_custom(func(a, b): return a.initiative > b.initiative)
    rebuild_strip()

func advance_turn() -> void:
    current_index = (current_index + 1) % entries.size()
    Events.combat_turn_changed.emit(entries[current_index])
```

### C.5.4 Bestiary — 数据驱动列表

5etools 数据可以编译进 Godot 的 `data/` 目录，运行时按需 lazy-load。多库支持
直接读不同目录就好。

```gdscript
# scripts/modules/bestiary/loader.gd
class_name BestiaryLoader

static func load_all_monsters() -> Array[MonsterData]:
    var result: Array[MonsterData] = []
    # 1. 内置库
    result.append_array(_load_dir("res://data/etools/bestiary/"))
    # 2. 用户库（从 user:// 加载）
    for lib in Settings.libraries:
        if lib.enabled:
            result.append_array(_load_url(lib.base_url))
    return result

static func _load_dir(path: String) -> Array[MonsterData]:
    # 遍历 dir，每个 json 文件解析成 MonsterData
    pass
```

**怪物详情面板** — Control 节点（VBoxContainer + ScrollContainer + RichTextLabel），
RichTextLabel 支持 BBCode，可以直接渲染 `[url=roll://1d20+5]+5[/url]` 这样的可点击
投骰链接。

### C.5.5 CharacterCards — JSON 优先 + 可选 xlsx 导入

**重大决策**：放弃服务端 xlsx 解析，改成本地 JSON 编辑：

- 内置 JSON 模板（schema v0.3 完全保留）
- 用户可以**直接在 app 内编辑**所有字段（不再需要 xlsx）
- xlsx 导入作为可选路径：用 C# + NPOI 库读 xlsx 转 JSON（NPOI 是 .NET 上 Apache POI 的端口）
- 卡牌全屏面板用 Control + 主题节点画

```gdscript
# scripts/modules/character_cards/fullscreen.gd
extends PanelContainer

var card: CharacterCard

@onready var name_label = $VBox/Header/Name
@onready var hp_input = $VBox/StatBanner/HP/Input
@onready var ability_grid = $VBox/Tabs/Combat/Abilities

func display(c: CharacterCard) -> void:
    card = c
    name_label.text = c.name
    hp_input.text = str(c.hp)
    # ...

func _on_hp_changed(value: String) -> void:
    var parsed = StatExpression.parse(value, card.hp)  # 解析 "+5" / "15+5"
    card.hp = clamp(parsed, 0, card.max_hp)
    Events.card_changed.emit(card)
```

### C.5.6 StatusTracker — 已经是 Godot 友好的设计

OBR 上的全屏面板用 HTML5 drag-and-drop。Godot 上更好：
```gdscript
# 32 个 buff 调色板 + token 卡片
# Godot 自带拖放：Control._get_drag_data + _can_drop_data + _drop_data
```

**buff 环形布局** — 父 token 上挂 `Node2D`，子 buff 用 PolygonStrip / Sprite2D 绕
父级一圈布置。父级缩放，子级自动跟随。

### C.5.7 FullFog — Godot 视野算法

Godot 2D 内建光源系统（PointLight2D + LightOccluder2D），但不一定满足
TRPG 需求。可以选：

**方案 1：用 Godot 内建**
```gdscript
# 玩家 token 上挂 PointLight2D，半径 = 视野
# 墙挂 LightOccluder2D（多边形）
# 雾用全场覆盖的 ColorRect + 玩家光源 mask
```

**方案 2：自实现光线追踪**（移植 obr-suite 的 fullFog 算法）
- `vision/raycast.ts` 的逻辑 → GDScript 重写
- single-wall peek（penetration binary）保留
- BLEED_FACTOR = 0.20 二次墙硬阻断

性能上 Godot 2D 渲染管线比 SVG 顺畅多了，原 obr-suite fullFog 在 OBR 上偶尔卡的
情况会消失。

### C.5.8 Portals — `Area2D` body_entered

```gdscript
# scripts/modules/portals/portal.gd
extends Area2D

@export var tag: String = ""  # 同 tag 互链
@export var radius: float = 100.0

func _ready() -> void:
    body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node2D) -> void:
    if not body is Token: return
    # 找同 tag 的另一个 portal
    var target = find_target_portal(tag)
    if target:
        body.position = target.position + offset_within(target.radius)
```

OBR 上要 snap-strip-restore 动态雾的光源元数据，Godot 上不存在这个问题。

### C.5.9 Search — 全局 + 5etools tags

```gdscript
# scripts/modules/search/index.gd
extends LineEdit  # 顶右浮动的搜索框

var index: Array[SearchEntry] = []

func _ready() -> void:
    text_changed.connect(_on_query_changed)
    index = BestiaryLoader.load_all_monsters() + SpellLoader.load_all() + ...

func _on_query_changed(q: String) -> void:
    var hits = index.filter(func(e): return q in e.cn or q in e.en)
    show_results(hits)
```

**5etools 标签 → 可点击** — RichTextLabel + 自定义 url handler：
```gdscript
preview_label.bbcode_text = format_etools_tags(entry.description)
preview_label.meta_clicked.connect(_on_tag_clicked)

func format_etools_tags(s: String) -> String:
    # {@dice 1d6} → [url=dice:1d6][color=#5dade2]1d6[/color][/url]
    var re = RegEx.new()
    re.compile("\\{@(\\w+)(?:\\s+([^}]*))?\\}")
    return re.sub(s, _replace_tag, true)

func _on_tag_clicked(meta: Variant) -> void:
    var s = meta as String
    if s.begins_with("dice:"):
        DiceModule.fire_quick_roll(s.substr(5))
```

### C.5.10 TimeStop / Focus / Follow — 简单到不行

```gdscript
# TimeStop
var time_stop_layer = preload("res://scenes/ui/time_stop_overlay.tscn").instantiate()
get_tree().root.add_child(time_stop_layer)
time_stop_layer.fade_in()
get_tree().paused = true  # 暂停所有非 process_mode=ALWAYS 的节点

# Focus
@rpc("authority", "call_local")
func sync_viewport_to(target: Vector2, zoom: float) -> void:
    var tween = camera.create_tween()
    tween.tween_property(camera, "position", target, 0.5)
    tween.parallel().tween_property(camera, "zoom", Vector2(zoom, zoom), 0.5)
    AudioPlayer.play_sfx("ding.wav")

# Follow
func _process(delta: float) -> void:
    if followed_token:
        camera.position = camera.position.lerp(followed_token.position, delta * 5)
```

## C.6 网络方案

### C.6.1 选 ENet（Godot 默认）还是 WebSocket？

| 协议 | 优点 | 缺点 |
|---|---|---|
| **ENet** (UDP-based) | 低延迟，可靠 + 不可靠分通道，丢包重发；Godot 默认 | 不能跑浏览器（HTML5 export 只能 WebSocket / WebRTC） |
| **WebSocket** | 浏览器友好，HTTPS 共用 443 | TCP 上层，丢包堵塞；不能 unreliable |
| **WebRTC** | 浏览器 + 低延迟 + UDP | NAT 穿透复杂，需要 STUN/TURN 服务器 |

**建议**：
- 桌面端用 ENet（性能最好）
- HTML5 web 版用 WebSocket（用 reliable 通道，能用就行）
- 同时支持两者：Godot 4 的 `MultiplayerPeerExtension` 可以选

### C.6.2 房间 / 游戏 lobby

OBR 自带房间 lobby（`obr.app/room/...`），Godot 自己写：

**最简方案**：
- 用户 A 启动 host（监听端口 7777）
- 给朋友发 IP + 端口
- 朋友输入 IP，连进来
- 不需要中央服务器

**进阶方案**（要中央服务器）：
- 你的阿里云 ECS（`47.120.61.255`）跑一个 Godot dedicated server（命令行，无 GUI）
- 用户们连这个公共 server，server 维护多个房间
- 房间 ID 分发给玩家

**最方便方案**（用第三方）：
- Steamworks（如果上 Steam）
- Nakama / Mirror（开源 lobby 服务器）

### C.6.3 同步策略

按数据频率分级：

| 数据 | 频率 | 通道 | 备注 |
|---|---|---|---|
| token 位置（拖动中）| 60Hz | unreliable | 丢一两帧不影响 |
| token 位置（commit）| 偶尔 | reliable | 必须送达 |
| HP / AC / metadata | 偶尔 | reliable | 战斗状态关键 |
| 骰子结果 | 偶尔 | reliable | 历史完整性 |
| 选择 / 高亮 | 中频 | unreliable | 视觉同步 |
| chat 消息 | 偶尔 | reliable | 顺序 |

## C.7 5etools 数据兼容

5etools JSON schema（怪物 / 法术 / 物品 / 专长）继续用，因为：
- 已经投入了大量数据（kiwee.top + 自托管 + 本地导入）
- AI prompt template 已经训练用户输出这种格式
- 社区生态都用这个

只是把"网络拉取"改成"本地文件 + 可选 URL 库"：
- 内置一份完整 5etools 数据到 `data/etools/`
- 用户可以在设置里加远程 URL 库或导入本地 JSON/MD
- 同样的 c=1/2/4/7/8 等 category map（dice_module.md 已记录）
- 同样的 `_copy` 继承解析

## C.8 角色卡 schema v0.3 兼容

服务端 parser.py 的 schema v0.3 直接搬过来，作为 Godot 内的 JSON schema：

```gdscript
# scripts/modules/character_cards/types.gd
class_name CharacterCard
extends Resource

@export var schema_version: String = "0.3"
@export var name: String = ""
@export var classes: Array[Dictionary] = []  # [{name, level, subclass}]
@export var stats: Dictionary = {}            # {str, dex, con, int, wis, cha}
@export var hp: int = 0
@export var max_hp: int = 0
@export var ac: int = 10
@export var hit_dice: Dictionary = {"current": 1, "max": 1, "die": "d8"}
# ...
@export var features: Dictionary = {
    "class_features": [],
    "race_features": [],
    "feats": [],
    "fighting_style_feats": [],     # v0.3 新增
    "special_abilities": [],         # v0.3 新增
}
@export var inventory: Dictionary = {
    "weapons": [], "armor": [], "items": [],
    "wondrous_items": [],            # v0.3 新增
    "consumables": [],                # v0.3 新增
}
@export var special_resources: Array[Dictionary] = []  # v0.3 新增

# xlsx 导入：C# 模块（NPOI）→ 转 Dictionary → 调 from_dict
static func from_xlsx(path: String) -> CharacterCard:
    var d = XlsxParser.parse(path)  # call into C# parser
    return from_dict(d)

static func from_dict(d: Dictionary) -> CharacterCard:
    # ...
```

## C.9 里程碑 / 实施计划

### M1（第 1-4 周）— MVP 单机
**目标**：能在本地跑起来一张地图 + 拖 token + 简单骰子

- [ ] Godot 项目骨架 + 主菜单
- [ ] 地图加载（图片背景 + 网格）
- [ ] Token 节点 + 拖动 + 缩放 + 旋转（无血条）
- [ ] Camera2D + 视口缩放 / 平移
- [ ] 简单骰子 panel（`1d20+5` 这种基础表达式）
- [ ] 房间存档（导出 / 导入 JSON）
- [ ] 单机模式可玩

### M2（第 5-8 周）— 多人 + 战斗工具
- [ ] ENet host + client
- [ ] Token 同步（位置 reliable + 拖动 unreliable）
- [ ] HP 条 / AC 盾（**重点验证：这次必须丝滑**）
- [ ] 完整骰子表达式（adv/dis/burst/repeat/max/min/reset/same）
- [ ] 骰子动画 + SFX
- [ ] 投掷历史 + 回放
- [ ] 先攻面板
- [ ] 战斗状态切换

### M3（第 9-14 周）— 内容生态
- [ ] 怪物图鉴（5etools 内置 + 本地导入）
- [ ] 怪物详情面板（5etools 标签可点击）
- [ ] 拖入召怪
- [ ] 角色卡（JSON 编辑 + 全屏面板 + 内联编辑）
- [ ] xlsx 导入（C# 模块）
- [ ] 全局搜索
- [ ] 状态追踪 + 32 buff
- [ ] 时停 / 视口同步 / 跟随
- [ ] 传送门

### M4（第 15-18 周）— 高级特性
- [ ] 动态雾 / 视野
- [ ] 光源
- [ ] 门 / 窗
- [ ] AOE 模板
- [ ] 主题切换
- [ ] i18n（中英）
- [ ] 移动端适配

### M5（第 19-22 周）— 抛光 + 发布
- [ ] 性能 / 内存 profile（目标 60FPS @ 100 token）
- [ ] 自动化测试
- [ ] HTML5 export 测试
- [ ] 用户文档
- [ ] 第一个公测版本

### 大约 22 周（5.5 个月）能做到 obr-suite 当前的功能 + 流畅拖动 + 跨平台

## C.10 用户技能 gap 评估

用户自评："不是专业开发者"。

| 已掌握 | 需要学 | 学习成本 |
|---|---|---|
| TypeScript / Preact / HTML/CSS | GDScript（Python-like） | 低，2 周 |
| Vite / npm / git | Godot 项目结构 | 低，1 周 |
| 服务端 Python（parser）| GDScript signals | 低，自然学会 |
| HTTP / WebSocket 的概念 | Godot Multiplayer API + RPC | 中，2 周 |
| OBR 的 Item / metadata | Godot Node + Resource | 低，类比直观 |
| - | 2D 着色器 GDShader | 中，需要时学 |
| - | C# + NPOI（如果用 xlsx 导入） | 高，可以推到 M3 末期 |

总学习曲线：~4 周边学边写。比从零开始造引擎低多了。

## C.11 Godot 自带能解决 obr-suite 痛点的功能清单

| obr-suite 痛点 | Godot 解法 |
|---|---|
| 拖动卡顿 | 直接改 transform，60Hz 流畅 |
| 子节点 transform 不跟随 | Godot 默认就是节点树继承 |
| Effect width/height 必须 delete + re-add | Godot ColorRect / Polygon2D 直接 set |
| Cursor 改不掉 | `Input.set_default_cursor_shape()` 直接生效 |
| Transformer UI 无法隐藏 | 没有 OBR transformer，自己想画就画 |
| Popover 第一次 open 崩 | Godot Popup 没这个问题 |
| 跨 iframe broadcast 复杂 | 全局 EventBus signal，单进程 |
| `onChange` 拖动期间不触发 | Godot 节点直接监听 transform_changed |
| `attachedTo` 改了破坏继承 | Godot reparent 自动重算 |
| html `Cache-Control` 必须配 | 单可执行文件，不存在 cache 问题 |
| keyboard shortcut 在 iframe 里失效 | Godot 全局 InputEvent 路由 |
| `manifest.json` 不能有 background | 不存在 |
| HTTPS 强制 | 单机不需要 |

---

# Part D：附录

## D.1 数据 schema 迁移清单

从 obr-suite 复用的 JSON schema：

| 数据 | 源文件 | Godot 对应 |
|---|---|---|
| BubbleData | `bubbles/index.ts` BubbleData interface | `TokenData.hp/max_hp/temp_hp/ac/locked/hidden` |
| MonsterData | bestiary 5etools schema | `MonsterData` Resource |
| CharacterCard | server parser.py schema v0.3 | `CharacterCard` Resource（见 C.8） |
| InitiativeEntry | `initiative/types.ts` | `InitiativeEntry` Resource |
| BuffDef | `statusTracker/types.ts` 32 个 default | `BuffDef` Resource + `data/default_buffs.json` |
| ResourceItem | `statusTracker/types.ts` | `ResourceItem` Resource |
| PortalData | `portals/types.ts` | `PortalData` Resource |
| FogWalls / FogLights | `fullFog/types.ts` | `Wall` / `Light` Node2D + 数据 |
| DiceRoll / DiceHistory | `dice/types.ts` | `DiceRoll` Resource |
| LibraryConfig | `state.ts` SuiteState.libraries | `Settings.libraries` |
| SuiteState | `state.ts` | `Settings.gd` autoload |

## D.2 5etools category map（迁移用）

来自 `dice_module.md`：

| c | 类别 | 文件路径 |
|---|---|---|
| 1 | 怪物 | `bestiary/bestiary-<src>.json` |
| 2 | 法术 | `spells/spells-<src>.json` |
| 3 | 背景 | `backgrounds.json` |
| 4 | 物品 | `items.json` |
| 7 | 专长 | `feats.json` |
| 8 | 能力 | `optionalfeatures.json` |
| 10 | 种族 | `races.json` |
| 13 | 冒险 | `adventures.json` |
| 16 | 陷阱 | `trapshazards.json` |
| 17 | 灾害 | `trapshazards.json` |
| 18, 44 | 整本书 | `books.json` |
| 24 | 表格 | `tables.json` |
| 46 | 怪物概述 | `bestiary/fluff-bestiary-<src>.json` |

## D.3 5etools 标签全表

| 标签 | 行为 |
|---|---|
| `{@dice 1d6}` | 投骰链接 |
| `{@damage 2d6+3}` | 投伤害骰 |
| `{@hit N}` | 投 1d20+N |
| `{@d20 N}` | 投 1d20+N |
| `{@chance N}` | 投 1d100，≤N 成功 |
| `{@scaledamage base|levels|scale}` | 显示 scale，不是 base |
| `{@recharge N}` | 投 1d6，≥N 重置 |
| `{@atk mw/rw/ms/rs}` | 武器攻击文本（cosmetic） |
| `{@h}` | "命中：" |
| `{@hom}` | "或命中：" |
| `{@m}` | "落空：" |
| `{@creature/spell/status/...}` | 显示文本（用 displayOverride 不是 source） |

## D.4 SFX 列表

来自 `dice_module.md`：

**合成（Web Audio → Godot AudioStreamGenerator）**
- `sfxParabola` / `sfxScalePunch` / `sfxNumFly` / `sfxNumLand` / `sfxFlashCrit` / `sfxFlashFail`
- `sfxSpin` / `sfxBurst` / `sfxSame` / `sfxSyncView` / `sfxNextTurn`

**采样**
- `dice.mp3` — per-die tumble
- `cartoon.mp3` — climax punch

Godot 上：
- 合成音继续用代码生成（GDScript 也能做 oscillator + filter，但不如 Web Audio 直接；
  或者一次性预渲染成 .ogg 文件）
- 采样直接 `AudioStreamPlayer2D`

## D.5 OBR Sketchy bug 列表（Godot 上不会有）

来自 `feedback_obr_dev.md` + `bubbles_module.md`：

1. `OBR.scene.onMetadataChange` 跨 iframe 不可靠
2. `OBR.broadcast.onMessage` 顶层调崩
3. `tool.createAction shortcut` iframe 内失效
4. popover 第一次 open 不 render
5. Effect width/height patch 不生效
6. SCALE inheritance dormancy（首次绘制不应用 parent.scale）
7. SCALE inheritance "capture-once"（commit 后不重算）
8. `attachedTo` 改了破坏 POSITION 继承
9. Curve 在 drag preview 期间 revert to NATIVE
10. `onChange` 拖动中不触发，只 commit 时
11. cross-iframe localStorage race
12. ESM 循环依赖把 CJS helper 错位
13. `<input type=file>` 跨域 iframe 不能用 FSA
14. `RateLimitHit` storms（同房间多 plugin 抢 OBR 资源）
15. transformer 视觉 UI 无法隐藏
16. cursor filter 不灵 / 文档不全
17. `preventDrag` 语义模糊（undefined / never-match / always-match 行为不一致）

Godot 上以上每一条都不存在。

## D.6 obr-suite 中**保留下来**的设计精华（值得迁移到 Godot 的好想法）

- **Hash split**（structureHash / valueHash）— 决定 rebuild vs patch 的粒度，Godot 上
  仍然有用（决定要不要重建子节点 vs 改属性）
- **ViewMode（full / silhouette / hidden）** — 玩家阈值 + 锁定 + 战斗状态联动
- **5etools 标签可点击** — 在所有 RichText 里都该有
- **Stat 输入解析**（`+5` / `15+5`）— 通用 utility
- **CC 绑定优先级 > bestiary** — 数据冲突时 cc 赢
- **多库并行 + 合并去重**（ENG_name | source）
- **本地 JSON / MD 导入** — 给用户离线 / 私货空间
- **Dev / stable 渠道分离** — Godot 上可以用 export preset 做 dev / release
- **Panel layout 持久化** — Godot 的 ConfigFile 做这个最自然
- **AI prompt template** — 给用户在设置里复制，AI 帮他生成 5etools 格式数据

## D.7 当前不要重做的反面教材

**bubbles 拖动 / 缩放期间 polish**（v1.0.34 → v1.0.50 的 16 个失败版本）：
- v1.0.34 — NATIVE + SCALE on：DORMANCY ON FIRST PAINT
- v1.0.35 — RENDERED + SCALE on：double-scale post-commit
- v1.0.36 — RENDERED + SCALE off：shimmer Effect 改尺寸不生效
- v1.0.37/38/39 — wakeup 三连：完全无效，部分破坏 POSITION 继承
- v1.0.42 — 当前 baseline，静态对，gesture-time bug 接受
- v1.0.43/44/45/48/49 — 各种再尝试，都比 v1.0.42 差
- v1.0.50 — clean revert，user 放弃

Godot 上这 16 个版本的所有问题**根本不存在**，因为 transform 继承不是 metadata 同步而是
渲染管线的子节点 transform。直接 Token 下挂 HPBar 子节点就完事。

---

## 结语

OBR SDK 给的天花板太低了。**在 SDK 之上微调拖动流畅度是死路**——
不是我们写得不好，是 message bus 物理延迟决定的。

转 Godot 4.6 是正确决策：
- 拖动流畅、子节点继承、cursor 控制、UI 自由 — 全部不用绕路就能做到
- 你已有的 obr-suite 经验（数据 schema、5etools 解析、CC 渲染、动态雾算法）90% 可以
  直接迁移
- 学习曲线就是 GDScript（~2 周）+ Godot 节点系统（~1 周），其他都是 transferable

建议下一步：
1. 装 Godot 4.6，跟官方 2D 教程做一遍（半天）
2. 在 Godot 里实现一个最简的"加载图片 + 拖 token"demo（一天）
3. 验证拖动确实丝滑 + 子节点跟随 + cursor 能改 — 这一步过了，剩下就是工作量
4. 按 M1 → M5 推进

obr-suite 这一份代码不要删 — 它是规范文档（"以前是这么做的"），数据 schema 也都是
直接可复用的。

Good luck.
