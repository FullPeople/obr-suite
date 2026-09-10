# 画布血条缩放错位：根因分层调查

2026-09-08，规范仓库 `U:\枭熊插件\obr-suite`。本报告先保存只读调查基线，随后记录经主代理授权的窄修复与测试。调查时源码散列为 `b22c978062a60cb0ee4db61eca8362ab651b153505807ee833d13a91c6aa244e`（`src/modules/bubbles/index.ts`）；下方“调查基线”表格描述该版本。**后续实现已修改提交后几何刷新签名和本模块生命周期；没有修改 Shader、继承策略、拖动工具或实际场景，也没有验收宿主中的平滑缩放。** [源函数探针](../../tools/bubbles-scale-audit.mjs) 现在检查修复后的实际源码，并输出本次源码散列。

## 结论先分开

1. **已确认并修复代码层缓存缺口。** 调查基线中，固定较短边只增加高度，以及偏心图片锚点的翻转或旋转，都会算出新锚点却不请求重建。后续真实 `setupBubbles → syncBubbles → SDK builder` 测试先复现旧图元仍为 y=1108，而期望 y=1258；修复后正确重建一次。宿主是否在手势期间自行补偿，仍待真房间测量。
2. **旧手势问题仍是未验证的宿主边界。** 历史材料描述原生拖动/缩放中使用临时渲染快照，松手前扩展取不到变化；多轮 SCALE/native/rendered/wakeup/接管拖动尝试失败。本轮没有接入真实 Owlbear 房间，不能把旧观察升级成新宿主的永久限制，也不能用数学探针声称修复了它。
3. **Shader 不是当前代码正在运行的血条绘制方式。** 新材质无法先验解决锚点或手势状态不可见问题，应等位置证据闭合后再做。不要再次启用逐帧网络写入、接管原生 Move 或高频 bounds 轮询来“追上”血条。

## 历史约束

[GODOT_PORT_DESIGN.md](../GODOT_PORT_DESIGN.md) 的 A.3 与 D.7 保存了用户历史尝试摘要：

| 历史尝试 | 记录结果 | 本轮约束 |
|---|---|---|
| v1.0.34：native 尺寸 + SCALE 继承 | 初次显示不正确 | 不能只切回原生尺寸后称已解决 |
| v1.0.35：rendered 尺寸 + SCALE 继承 | 提交后重复缩放 | 每个量只能有一次缩放来源 |
| v1.0.36：rendered + SCALE 禁用 | Effect 改尺寸不生效 | 不把快更新支持当作所有 Effect 字段均支持 |
| v1.0.37–39：多轮唤醒 | 无效，部分破坏位置继承 | 不再添加任意延时或微小位置扰动 |
| v1.0.42 基线，后续尝试回退 | 静态/提交后可用，手势问题保留 | 保护现有静态和原生拖动体验 |
| 自定义 Select 拖动模式 | 比原生更卡，光标/变换控件残留 | 不再接管原生拖动作为血条修复 |

Git 历史中的 `6ccf2a4`（bubbles revert）、`16a4e5e`（live scale）、`84dde76`（shimmer variants）与上述方向吻合。详细 `bubbles_module.md` 没有在可访问的 U 目录找到；本报告不会补造缺失的每一轮日志。旧文档中“无 workaround”“只能换引擎”的绝对结论属于历史评估，不是本轮对当前宿主的新证明。

## 调查基线的实际渲染链，以代码为准

当前画布血条属于 [bubbles/index.ts](../../src/modules/bubbles/index.ts)，而 `modules/hpBar` 是弹出的 HP 编辑小窗；Boss 是另一种屏幕提示。三者不能混为同一套缩放逻辑。

| 调查基线代码位置（修复后行号会变动） | 基线实际行为 |
|---|---|
| `bubbles/index.ts:170` | 禁用 `SCALE`、`ROTATION`、`LOCKED`、`COPY` 继承；保留 `POSITION`、`VISIBLE`、`DELETE` |
| `:428`、`:436` | 图片中心按像素中心减 grid.offset，再应用 sceneDpi/imageDpi、image.scale、rotation、position；尺寸用缩放后的宽高绝对值 |
| `:945`、`:951` | 血条尺寸已按 rendered 宽高计算，字号等按较短边大小缩放 |
| `:1032`、`:1049` | 上方/下方的血条 y 位置还依赖图片高度与中心 |
| `:1165`、`:1187`、`:1287` | 背景/填充是 Curve，HP 数字是 Text；都 attachedTo token，禁止命中 |
| `:1713`、`:1783` | 散列相同则不重建；当前尺寸散列只含 barWidth、barHeight、diameter 等，不含相对锚点 |
| `:1794`–`:1810`、`:1824` | 当前添加 bg/fill/text/AC 图元；新图元添加后删除旧图元 |
| `:1834` | shimmer builder 没有加入实际构建，动画计时器无活跃 shimmer 时停止 |

文件保留了旧 `getImageNative*`、`geometryKey`、`patchGeometry`、`buildHpShimmer` 和描述 SCALE 自动跟随的注释。当前调用链不使用这些函数。调查基线中部分活动路径注释与实际 SCALE 禁用状态相冲突；本次只更正刷新签名相关注释，旧未调用代码没有重新启用。不能照着旧注释重新加一层缩放。

## 调查基线的原函数探针

探针从 TypeScript AST 提取实际布局函数、常量和 `rebuildHash` 表达式，复用安装 SDK 3.1.0 的 Math2；没有重写一份布局算法，也没有模拟 Owlbear 渲染器。下表保存修改前的输出；当前运行 `node tools/bubbles-scale-audit.mjs` 会验证已修复的签名。

测试图片像素 150×300，scene/image DPI 都为 150，位置 (1000,1000)。居中锚点为 (75,150)。所有 HP、可见性和显示偏好不变。

| 输入变化 | 算出的血条位置变化 | 散列变化 |
|---|---|---|
| 宽高同步 1→2 倍 | 位置、宽、高都变 | 有，正常对照 |
| 仅 scale.y 1→2，下方模式 | y 从 1108→1258，宽 146 / 高 20 不变 | **无** |
| 仅 scale.y 1→2，上方模式 | y 从 804→654，宽 119.8 / 高 20 不变 | **无** |
| grid.offset=(0,0)，scale.x 1→-1 | x 从 1002→852 | **无** |
| 同一偏心锚点，rotation 0→90° | (1002,1258)→(777,1183) | **无** |
| 只移动 position.x +100 | x +100 | 无；依赖宿主 POSITION，正常对照 |

这里确认的是“插件计算出新锚点，但不请求更新”，不是屏幕最终坐标。后续窄修复采用**相对于 token.position 的布局锚点**作为缓存身份。不能直接把世界绝对位置加入散列，否则每次普通移动都重建，重新引入过去的拖动干扰；也不能仅加 scale 符号，因为偏心锚点/图片 grid 改动同样可能变更锚点。

## 已实施的窄修复与回归证据

产品改动仅 [bubbles/index.ts](../../src/modules/bubbles/index.ts)。保留 rendered 尺寸计算、Curve/Text 构建、`DISABLE_INHERIT` 和原来的 16ms 事件合并；没有增加坐标轮询、唤醒写入、定时重试或 Shader。

- `layoutAnchorSignature` 将血条和 AC 中心相对 token.position 的坐标纳入签名，使用与原尺寸签名相同的两位小数精度。普通移动保持无重建；只有提交后的相对锚点、尺寸、数据或既有显示策略改变才重建。
- 延迟测试复现关闭后旧 `getItems` 返回仍添加 5 个血条图元。现在以启用代次、场景代次和角色代次检查异步读取；旧代次不能阻塞新代次。启动监听先于角色/场景初始读取，避免迟到的 GM 或 ready 快照覆盖新事件。
- 已派发的 SDK `addItems` 不能撤回。它完成后若代次失效，只删除**该次调用生成的具体图元 ID**；不会按 token 或全模块宽泛清扫而误删新代次。添加成功之前不替换缓存；受控添加失败保留旧图元，只在下一次真实事件重试。
- 清除旧场景的 250ms 一次性初始化回调及订阅；这个既有场景等待不是血条位置的重试机制。GM 自动字号更新在真正 SDK draft 回调处再次核验，关闭或撤销 GM 后的迟到回调不改共享字号。

[行为入口](../../tools/bubbles-scale-selftest.entry.ts)、[测试执行器](../../tools/bubbles-scale-selftest.mjs)、[宿主传输替身](../../tools/fixtures/bubbles-scale-sdk.ts) 运行实际模块的 setup、事件调度、读取、重建及 teardown，并调用安装 SDK 的真实 Curve/Text/Shape/Effect builder 和 Math2。替身只提供可延迟的宿主读写、订阅和本地图元存储，**不模拟宿主挂接树、画布或原生手势**。

验收命令（工作目录为规范仓库）：

```text
node tools/bubbles-scale-audit.mjs
node tools/bubbles-scale-selftest.mjs
node tools/bubbles-scale-selftest.mjs --mutations
npx tsc --noEmit
```

行为检查包括：真实 builder 的继承和命中策略、上下方高度单独缩放、偏心翻转/旋转、居中旋转无多余重建、卸载和场景关闭、旧读取/旧添加尚未完成时重新启用、GM 撤销、初始角色/场景读取被新事件取代、无关玩家事件、迟到共享字号回调、添加失败后的缓存和重试边界。

写入预算以测试场景的单个 HP+AC token 为单位：初始化 1 次添加 / 5 个图元；每次已提交且需改变的几何 1 次添加 / 5 个新图元，再 1 次删除 / 5 个旧图元；20 次带小数普通平移与 40 次连续无关 items 事件均为 **0 次本地图元添加、删除、更新**，普通平移也无共享写入。它不等于真实房间的帧率或网络延迟测量。

源代码变异与对应缺陷：

| 变异 | 必须失败的实际行为断言 |
|---|---|
| 去掉相对锚点签名 | 单独拉高仍停在旧 y 坐标 |
| 用世界 x 坐标进入签名 | 普通平移产生额外重建 |
| 旧启用代次仍算有效 | 关闭后迟到读取重建图元 |
| 删除迟到 add 的清理 | 关闭后新增图元残留 |
| 清理迟到 add 时删除全部本地图元 | 重新启用的新图元被旧回调误删 |
| 用单个全局运行锁阻塞新代次 | 旧读取不结束时，新代次无法显示 |
| 初始 GM 快照忽略角色代次 | 已变玩家仍得到锁定 token 的完整显示 |
| 初始 ready 快照忽略场景代次 | 已关闭场景仍生成血条 |
| 删除共享字号 draft 守卫 | 卸载后迟到回调仍修改字号 |

本次执行结果：**22/22 行为检查通过，9/9 源代码变异被断言拒绝，类型检查通过**。添加失败测试主动制造并输出一次 SDK 错误日志，该日志不是未处理异常。执行器只将断言失败算作杀死变异；构建/运行异常不能冒充测试成功。测试结论仅覆盖扩展发出的对象字段、写入预算和生命周期，不覆盖实际画面；仍待主代理独立复核，本次未部署。

## 官方接口能证明什么

- Item 文档提供 attachedTo 与可禁用的继承项，没有逐类保证手势期间的临时渲染行为。[Item](https://docs.owlbear.rodeo/extensions/reference/items/item/)
- `scene.items.onChange` 是全场当前对象快照回调；`getItemBounds` 是轴对齐包围盒读取。文档没有承诺它们暴露原生 transformer 拖动的每帧临时几何。旧代码“只在 commit 更新”的注释需要在现宿主重测。[Items](https://docs.owlbear.rodeo/extensions/apis/scene/items/)
- `scene.local` 图元仅当前用户可见；它的 `fastUpdate` 只覆盖部分值。局部更新也有扩展与宿主之间的调用成本，不能称为无需传输。[Local](https://docs.owlbear.rodeo/extensions/apis/scene/local/)
- Interaction 的快速路径跳过层级处理，支持值有明确列表；不能只更新父 token 就假定整个挂接树动画正确。它也不能用来读取原生工具的手势轨迹。[Interaction](https://docs.owlbear.rodeo/extensions/apis/interaction/)
- Viewport 提供位置、缩放及 transformPoint/inverseTransformPoint；当前 bubbles 本身不调用这些转换，因而暂未发现“视口缩放重复乘进血条几何”的代码证据。屏幕坐标、场景坐标仍应实测配对，不能根据命名再额外转换一次。[Viewport](https://docs.owlbear.rodeo/extensions/apis/viewport/)

## 下一步实际房间采样

先在同一真实房间保留原生 Move/transformer。把三类操作分开录像和记录：**视口缩放、token 拖动、token 把手缩放**。各用默认居中 token、偏心锚点、矩形图片、负 scale；DM 与玩家同时观察。上方/下方模式都覆盖。

每次记录 gesture 前、gesture 中、松手后和一次“重置血条”后的：共享 token 的 position/scale/rotation/image/grid、scene DPI；本机 bg/fill/text/AC 的 position/scale/points 或 text bounds；token 和局部图元的 getItemBounds；当前 viewport position/scale；SDK 回调时间与读取往返时间。少量有界读取配合同步录像，不进行无限逐帧轮询，不向共享场景写坐标。

用证据区分：

1. **视口变化时 token 与所有血条图元同比缩放，偏移比例不变**：视口正常，继续看 token 变换与烘焙锚点。
2. **手势中宿主画面动，但对象/bounds 读取不动；松手才变化**：确认当前临时渲染路径不可由这些读接口实时追踪，不能重试同一种轮询补偿。
3. **松手后 token 数据正确、应有局部锚点变化，散列未变，重置后恢复**：缓存缺口的产品级证据。
4. **局部对象字段正确但 Curve/Text 图像在手势中不同步**：按图元类型记录宿主渲染问题；一个图元的模拟成功不代表其他图元已修复。
5. **仅观察端或低性能端异常**：追加帧时间/回调延迟对比，不能把网络或渲染插值问题归为同一个坐标公式。

目前没有可用的已连接真实 Owlbear 房间，本批不宣称双端、视觉、性能或平滑跟随验收完成。材质、伤害拖尾和程度反馈仍排在坐标与生命周期验证之后。
