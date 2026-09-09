# 三龙牌：三维牌桌实现与验收边界

更新：2026-09-09。本文件记录独立扩展的当前实现、接口与尚需验收的行为，取代同名文档最初的拟议接口。三维舞台、输入适配、精确动作回执、四页导览已经有实际代码；主代理仍在核验最终组合页面。本文件不声明发布、部署成功或具体版本日期。

## 当前范围与画面

活动目录为 `extensions/three-dragon-ante/src/game/`。`src/modules/threeDragonAnte/` 是未接入的历史副本，不在其中实现，也不恢复 Full Suite 的牌桌运行入口。

牌桌采用 Three.js WebGL2：木桌、毛毡、双面有厚度的卡片、金银筹码是真实网格；DOM 承担大字预览、状态、特殊能力选项、历史与无障碍列表。默认使用 Owlbear 原生 fullScreen modal，保留返回地图及紧凑窗口入口。关闭界面不会退出牌局或销毁后台主持状态。

按用户最新选择，卡画保留最初舞台的原创几何龙纹与人物徽记。卡面和牌背由 Canvas 路径、线条、色块及文字绘制，桌面木纹、毛毡、纸张和金属表现由运行时代码生成。这里的“向量卡画”指几何绘图来源；WebGL 最终仍使用 CanvasTexture。产品不采用 AI 位图图集，不增加图片下载、图集适配器或外部卡画依赖。没有复制发行商或其他游戏的卡面、框架和音画资产。

实际构图包括近端本人手牌、本人暗置槽与公开牌阵、中央明置 ante、牌库、弃牌顶与奖池，以及其他席位的公开牌阵、匿名牌背、金币和欠款。偿债池 `hole` 在 DOM 摘要中准确显示，当前没有单独的三维偿债池网格。详细公开信息还可通过可展开列表读取，不能把较小的三维文字当作唯一阅读途径。

## 规则动作保持 Legendary Edition 基础盒语义

规则权威仍是 `rules/engine.ts` 与其私有状态；UI 不修改牌组、能力或货币规则。

| 局面 | 当前操作 | 引擎结果 |
| --- | --- | --- |
| 本人可暗置 | 拖合法手牌到本人 ante 槽，松手提交 | `ante(cardId)`；任意牌类别均可使用，没有下注按钮 |
| 本人已暗置、其他人未齐 | 自己可查看获授权的暗置牌信息 | 桌上保持牌背；没有撤回或换牌 API |
| 最后一人提交 | 按公开投影揭示并自动结算 | 以最高点数计价，最高不并列者领出 |
| 找不到任何不并列点数 | 等待自动处理 | 暗置牌弃掉、各抓一张、重新暗置，不付款 |
| 本人可出牌 | 拖合法手牌到本人 flight 区 | `play(cardId)`；公开出牌，能力是否发动由引擎决定 |
| 能力要求选择 | 选择当前合法候选并按数量确认 | `choose(choiceId, optionIds)`；仅 min=0 或明确 skip 可不选 |
| 买牌、付款、欠款、轮局结算 | 查看最新金额与有限动画 | 已有强制购买、奖池清空中断与结算流程自动执行 |

没有独立 face-down flight、自由 buy、pass、加注或银币动作。“自己面前的暗置牌”只对应未统一揭示的 ante；不能把未发动能力的普通出牌做成持续背面。Silver Seer 的私看选项也不是公开暗置牌阵。

特殊选择保留当前合法选项、目标身份、min/max、受益者与来源牌说明。不能因三维显示方便而将所有能力改成统一确认，或把执行者与受益者当作同一个人。

### 金银筹码的确定含义

规则只有整数 `gold`、`debt`、`stakes`、`hole`。`stage/layout.ts` 的 `coinDenominations(gold)` 用十枚装饰银币表示一枚金币：正整数 n 的概念分解是 n−1 枚金币加十枚银币；0 不显示筹码。旧草案的“银色 1、金色 5”方案已经废弃。

网格数量有上限，每个池最多显示 24 枚代表性金币和 10 枚银币，旁边的整数金币标签才是准确余额。大量财富不会生成等量网格。银币不能单独下注、交易或在规则数据中积累小数。欠款独立显示，不用负数量筹码。

币流只配对相邻投影中的净减少和净增加，最多十二个临时实体。它不声称重建一次规则动作内所有付款路径；金额立即以最新投影为准，不等待动画结束。

## 已实现文件及责任

| 文件 | 当前责任 |
| --- | --- |
| `stage/index.ts` | WebGL 舞台、拾取、有限移动、pending 牌、暂停与清理 |
| `stage/types.ts` | 唯一舞台公共类型契约 |
| `stage/layout.ts` | 席位、实体位置、匿名牌背键、装饰币分解 |
| `stage/textures.ts` | 几何卡画、牌背、纸张、木纹、毛毡与文字纹理 |
| `interaction/drag-controller.ts` | Pointer Events、长按查看、取消、合法落区与一次 DropIntent |
| `ui.ts`、`stage-ui.css` | 投影适配、stage/DOM 降级、键盘、特殊选项、回执与草稿 |
| `page.ts` | 本机身份与分片投影接收、超时、语言、导览和练习生命周期 |
| `protocol.ts`、`controller.ts` | 本机能力标记、精确动作回执、原动作重试、权威投影 |
| `onboarding/index.ts`、`art.ts`、`style.css` | 四页介绍式 dialog 与原创 SVG 插图 |
| `tutorial.ts` | 41 个本机练习，使用实际引擎及同一个 mountTableUI |
| `index.ts`、`ui-command.ts`、`local-view.ts` | 原生窗口、仅本机 UI 命令与有界投影重组 |

最初提议的 `table-stage.ts`、`motion.ts`、`quality.ts`、`legal-targets.ts`、`presentation-model.ts` 并非当前接口文件，不应按旧草案新增重复实现。Three.js `0.186.0` 已进入依赖和锁文件，随扩展构建，不依赖第三方运行时 CDN。

## 实际舞台与 UI 契约

舞台入口为 `mountTableStage(canvas, options): StageHandle`。它不导入 SDK，不注册规则输入事件，不访问主持人 GameState、存储或网络。模型直接使用已授权投影，不再另造带私有字段的 StageModel。

```ts
interface StageModel {
  view: PublicView | SeatView | null;
  language: 'zh' | 'en';
  connected?: boolean;
  reducedMotion?: boolean;
  selectedCardIds?: readonly string[];
  animate?: boolean; // reconnect/snapshot replacement uses false
}
type StageZone = 'hand' | 'ante' | 'flight' | 'deck' | 'discard' | 'stakes';
```

`StageHandle` 提供 `update`、`hitTest`、`getAnchor`、`setDrag`、`releaseDrag`、`resolvePending`、`gesture`、`suspend`、`resume`、`destroy`、`diagnostics`。没有旧草案中的 `play(cues)` 或公开 `resize()`；ResizeObserver 由舞台管理。

`hitTest(clientX, clientY)` 和 `setDrag({cardId,x,y})` 使用浏览器 client CSS 像素，内部减 canvas 边界。`getAnchor({cardId?,zone?,seatId?})` 返回同坐标系的 `{x,y,visible}` 或 null。不要由调用者再减一次 canvas 偏移或乘 DPR。结果为本人手牌、可见公开牌或带 seatId 的区域；中央明置 ante 不等于本人暗置槽。

`StageOptions.onQuality` 报告 WebGL 可用、创建失败或 context loss，UI 选择三维/DOM 显示。`onInspect` 是预留字段，renderer 不安装拾取输入回调。虽然类型预留 low 档，目前没有完成独立低画质策略，不能宣称已有自动性能分档。

`mountTableUI(root,deps)` 接收 `send`、`language`、可选窗口 `mode`、匿名 `gesture` 与动作 `id` 生成器。返回投影 `update`、`language`、`restore`、`draft`、`gesture`、`failed`、`waitingForReceipt`、`getAnchor`、`suspend/resume` 和 `destroy`。UI 为导览把舞台点转换成 DOMRect；这些导览区域名 `ownAnte/ownFlight` 不属于 StageZone。

## 严格动作回执：actionReceiptVersion=1

`TableView.actionReceiptVersion === 1` 是新本机后台的必需能力标记，不是房间 schema 版本。旧后台缺少该标记时，新 UI 明确要求完整刷新 Owlbear，禁止提交游戏命令；仍允许观看、返回地图和窗口操作。不能在旧后台上退回“看到 revision 变化就算成功”的做法。

`ActionReceipt` 记录 `actionId/tableId/gameId/revision/ok`，可附 `code/retryable/source`，不包含牌面 ID。它从已验证的当前主持私有回执产生，仅随本客户端 TableView 展示。`source:'local'` 表示本机拒绝，不是主持确认；教程则直接从隔离引擎的实际返回结果产生回执。

控制器先校验 snapshot 的桌、主持、座位、版本与投影，再应用 game，最后接受同请求 receipt 并一起通知 UI。UI 必须匹配本人 pending action 的 ID、桌、局及座位；成功 revision 至少为提交版本+1，且已应用投影达到该 revision，才能 `resolvePending(true)`。拒绝必须匹配提交版本；可重试失败保留原 action。

`send()` 的 Promise resolve、`pending=false`、其他玩家推进 revision、投影先到或重复 receipt 都不能独立证明本人动作成功。页面等待 `view.pending || waitingForReceipt()` 时保持有界超时，失败显示重试。LOCAL 发送失败也可携原不可变 action 重试；不生成新 action ID、不改内容、不自动重写已提交 revision。尚不明确的结果不会显示成已撤销。

舞台本身不知道网络 ACK。`releaseDrag({pending:true,zone})` 只让牌等待；同一张牌的权威投影先到时仍保留一个实体。明确接受或拒绝后都回到最新权威位置，不凭拒绝结果虚构一张已不在手中的牌。

## 拖拽、键盘与生命周期

`mountDragController(element,ports)` 使用当前 `DragContext`，包含 tableId/gameId/seatId/revision、ante/play/null、合法牌 ID、locked 与可选 scopeId。它输出 `DropIntent`，由 UI 再核当前合法性后生成 GameAction；renderer 不调用 controller。

实际阈值为移动 7 CSS px，非鼠标长按 420 ms 查看。单击或长按只查看，不提交。松手必须命中本人正确的 ante/flight 区；区外释放、二指、Escape、失焦、pointercancel、capture 丢失、页面隐藏及销毁会取消，不补发 pointerup。

未提交的拖拽可以跨过其他玩家并行 ante 带来的 revision 变化，但必须仍是同 table/game/seat/scope、同动作种类、未锁定且该牌仍合法；松手使用最新投影 revision。身份、局、动作种类或合法性变化则取消。这与“已发送 action 的重试保持原 revision”是两个不同阶段，不能混淆。旧草案的“任何 revision 变化都终止拖拽”不是当前行为。

键盘通过方向键选牌、Space 拿起、Enter 放入本人合法区域、Escape 取消；未拿起时 Enter 只查看。特殊能力仍使用 DOM 合法选项和数量确认。触屏使用拖动或长按查看；最初设想的通用“点牌再点槽”不是当前交付契约。

草稿只保留同桌同局、同选择上下文中的合法选项及阅读位置，不存可执行 GameAction 或 armed 拖拽。语言切换更新卡面/标签并恢复对应合法焦点。关闭/缩小只清界面预览，不撤销已发送的操作。

## 三维显示与隐私边界

当前有限移动实现位于 `stage/index.ts`：位置/姿态缓动、正弦抬升弧线、有限翻转与末端轻落，通用时长 470 ms；手牌方向另用 quaternion 调整。不是最初建议的独立 CubicBezierCurve3 cue 系统，也不声称每种能力已制作完整中间动画。用户要求的拿起、转向/翻面、水平落桌仍须在最终组合画面中逐帧核验。

只有本人手牌和公开物理位置创建正面纹理。未揭示 ante 显示背面，对手手牌用 seatId+slot 的匿名键。`revealed` 是信息列表，不重复生成同一张物理牌；私选仅在有权限的 DOM 托盘出现。切换旁观身份会立即取消私有 pending 显示。

引擎一次 action 可执行多个能力，events 仅保留最近 100 项且没有稳定独立事件 ID。舞台不重播该历史；只对相邻投影产生有限移动，换局、断线、跳版本或显式 `animate:false` 直接定位。不能从最终差分猜测随机偷走的具体牌、未公开候选或完整付款路径。

匿名手牌姿态继续只发送数量/序号和版本，125 ms 节流并检查过期。不发送高频世界坐标、牌面映射、牌堆顺序或随机种子。主持私有状态仍由已有加密传输和本机存档负责；UI 不改为在房间 metadata 存手牌。

## 导览、材质与性能

`mountOnboarding(parent,{language,onClose,onPractice,getAnchor?})` 返回 `setLanguage/destroy`。四页介绍桌区、暗置、公开出牌/能力和金币结算，含前后翻页、进度、直接入座和练习入口；组件不读房间或写存储。`page.ts` 保存本机已看标记，负责首次展示、动态导入失败重试、焦点恢复及切语言。

导览/练习覆盖时暂停真人舞台并使背景 inert，后台仍接收牌局；关闭按最新投影恢复。41 练习使用同 UI 和实际引擎，示范、撤回、重启只在本机发生。关闭页面会清理异步导入代次、订阅、计时器和舞台，迟到完成不得重新挂 UI。

运行时材料是静态生成的几何卡画、纸张、木纹、毛毡和文字纹理。牌体/牌面共享几何，币堆用 InstancedMesh；当前并非所有牌背都已实例化。舞台使用一盏有界方向阴影加补光，DPR 上限 1.75；旧草案“没有实时阴影、DPR 1.5、独立低档”等仍属于未采用建议。

绘制由更新、输入、resize 或有限动画请求；静止后停止 RAF。隐藏/暂停时停止绘制；context loss 报不可用，由 UI 提供 DOM 区域和同一动作适配器，恢复时复用 canvas。销毁释放几何、纹理、材质、实例与 WebGL context。

窄屏舞台将本人手牌维持在可用前景，DOM 可展开列表补足公开信息。不得据此宣称所有 390px 六席文字已验收。60fps、首屏一秒、移动端30fps、draw call≤160 是初始性能目标，不是当前实测成绩；仍需记录硬件与实际玩家设备。

## 已有证据与最终验收范围

舞台基线记录为 **36 项实际 Chromium/Three.js WebGL 行为与像素检查**，使用 ANGLE SwiftShader。包含实际规则引擎 ante、正背隐私、投影先于 receipt、拒绝回位、有限运动/停止、银币换算、匿名 gesture、减弱动态、跳版本、暂停/恢复、窄屏前景、语言纹理释放、旁观切换、context loss 和销毁。后续展示场景是明确投影 fixture；页面可见性信号是受控 DOM 事件。

用户最终保留向量卡画后，主代理需以最终源码重新固定该基线；早先含位图请求的检查不能当作向量版本验收。独立输入、controller/receipt、UI、导览和规则测试分别计数，不把其中结果相加冒充舞台或真实房间 UAT。

从仓库根运行对应层：

```text
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs --mutant=idle
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs --mutant=pending
node extensions/three-dragon-ante/src/game/stage/stage-selftest.mjs --mutant=privacy
node tools/three-dragon-drag-selftest.mjs
node tools/three-dragon-action-receipt-selftest.mjs
node tools/three-dragon-ui-selftest.mjs
node extensions/three-dragon-ante/src/game/onboarding/onboarding-selftest.mjs
```

变异必须成功编译、命中唯一修改点，并被预期行为断言拒绝；语法错误或无关异常不计。舞台测试的 `resolvePending` 调用验证显示契约，不是实际网络 ACK 验证。软件 GPU 的通过也不能代替硬件帧时或 Owlbear 多客户端验收。

最终组合验收至少仍要覆盖：

- 2/6 席、6/10 张手牌、中英、桌面与窄屏；暗置槽、公开区、手牌和返回地图均可访问。
- 真正指针拿起、曲线移动、翻转与水平落桌的视频；区外释放和所有取消分支不提交。
- 并行 ante、STALE、投影先到、重复/迟到 ACK、LOCAL 发送失败与原请求重试；一次实际动作不能重复付款。
- 旧后台缺 actionReceiptVersion 时禁止出牌但可观看/退出；新后台正确拒绝错桌、错局、错身份回执。
- 私看、随机转移、公开揭示、多选能力、替换、奖池取空中断和欠款，不能泄漏或复活旧牌。
- 主持离线、存档缺失、重开/缩小、导览及练习；不影响后台或替真人出牌。
- 无 WebGL/context loss、减弱动态、旋转屏幕、反复开关与真实玩家设备性能。

这些是未被静态文档审阅替代的门槛；最终记录由本轮集成验收产物给出。

## 历史试验与技术参考

最初仅有的 21 项 Three.js API probe 位于 `_audit/2026-09-09/three-dragon-gameplay-redesign/`。它曾发现朴素六面 BoxGeometry 达333 draw calls、窄屏侧席被裁；它是历史方向试验，不是现舞台计数、现实现或视觉验收。

API 参考：[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)、[InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)、[Raycaster](https://threejs.org/docs/pages/Raycaster.html)、[Quaternion](https://threejs.org/docs/pages/Quaternion.html)、[Texture](https://threejs.org/docs/pages/Texture.html)。规则出处仍是既有已审 LE 基础盒引擎与教程；发行商入口：[Legendary Edition](https://wizkids.com/three-dragon-ante-legendary-edition/)。不在文档中复制官方卡牌全文。
