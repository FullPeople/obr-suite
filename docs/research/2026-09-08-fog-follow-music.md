# 线上版本审查：共享视野、迷雾、跟随与音乐板

审查日期：2026-09-08。仅阅读源码、公开构建和官方资料；未修改产品代码，未部署，未完成真实房间测试。

## 权威基线

- stable：[manifest 1.2.2](https://obr.dnd.center/suite/manifest.json)，[background-D8XTooCn.js](https://obr.dnd.center/suite/assets/background-D8XTooCn.js)。下载快照 SHA-256：`F26EFD58F626CAEF87A38DFF9E3C66CECD6C1C90853528EF4B15B54CFA751089`。
- dev：[manifest 1.0.148-dev](https://obr.dnd.center/suite-dev/manifest-dev.json)，[background-uO2s4b_z.js](https://obr.dnd.center/suite-dev/assets/background-uO2s4b_z.js)。下载快照 SHA-256：`BD94E99597A2498C2DBE5873F57695A7508ADE41BE9050C793DCA1DFAC5EC8F8`。
- 两个 background 快照分别与 `\\192.168.0.49\Share\枭熊插件\deploy\obr-plugins\suite{,-dev}\assets` 对应文件哈希一致。
- 本文源码最初从 `\\192.168.0.49\Share\枭熊插件\obr-suite` 读取，现已恢复至最终工作目录 `U:\枭熊插件\obr-suite`；相对路径和行号对应同一源码，并对照上述线上 bundle 的实际表达式核实。新动态迷雾位于 `src/modules/fullFog/dynfog/`。
- 先前占用 U: 同一路径的 1.1.11/143 旧副本已移至 `U:\枭熊插件\_retired_local_20260908` 下隔离，未删除；其旧研究不再是线上故障依据。尤其“按 commands.length 缓存墙体”和“完全没有光源所有者过滤”两项已被新引擎取代，应撤回其当前缺陷结论。
- 线上运行代码已完成历史提交重建：stable 来自 `aea5ebb`、dev 来自 `68e5f18`，dev 148 的 manifest 另由 `9e65f43` 记录；最新源码还有四个未上线提交至 `d9be401`。详见[版本依据](../DEPLOYMENT_BASELINE_20260908.md)，不能将当前全部源码视为同时上线于两个频道。

## 结论与顺序

可以在现有动态迷雾架构上添加队伍共享策略，无需重做整套迷雾。音乐板应先验证播放生命周期解耦，再恢复入口和多人控制。跟随应以 SDK 实验验证边界，不能直接恢复旧实验模块。历史迷雾保持最低优先级，现有引擎已具备不少可以沿用的性能基础。

建议先做两项窄范围可靠性验证：新光源授权前是否短暂显示；SDK 写入失败后迷雾是否能自愈。它们均有最新代码证据，但尚未得到房间复现。

## 1. 玩家共享视野

### 线上已经具备什么

当前模块表包含独立 `fogEditor` 和 `dynamicFog`，见 `src/background.ts:709-716`；两个线上 background 均可检索到同名注册项。编辑器只负责描图入口，运行引擎已单独存在。

当前配置是 `fogPlayerDoors`、`fogDoorOverlayAlways`、`fogLightOcclusion`，见 `src/state.ts:138-148` 及 `src/modules/fullFog/index.ts:148-150`。设置页 `src/settings.ts:3242-3246` 明确介绍“光源遮挡”：自己的光始终允许、环境光例外、别人的灯只有在与自己某盏灯之间无墙遮挡时允许；不计算距离，也不传递。

真正执行规则在 `src/modules/fullFog/dynfog/light/occlusion.ts:71-109`：

- 主持人或关闭光源遮挡时，所有 Light 都被允许。
- 开启时，自己的 Light、ambient Light、与自己的可见光源有直线无墙连接的 Light 被允许。
- 来源按 `createdUserId` 判断，环境光有明确字段；并非旧版完全没有所有者逻辑。

**这个开关不能改个名字充当“玩家之间共享视野”。** 将遮挡关闭，会同时放行 NPC/主持人布置的远方光源；它没有“仅队伍成员”的集合定义。

### 推荐最简交互

设置中增加主持人可控的一个“队伍共享视野”开关，玩家只读看到当前模式；逐角色例外放进高级区域。旧光源遮挡规则保持独立，避免悄悄改变已经签定的照明行为。

- 定义显式队伍视野来源，默认可参考在线玩家拥有的角色，但不能把所有非本人 token 自动视为队友；角色卡多拥有者也不能简单等同 OBR 创建者。
- 个人模式以自己授权的视野源计算；共享模式合并队伍视野源。NPC、秘密角色、未授权光源不因此获准。
- 区分角色“看见范围”和物体“发光范围”；当前 LightConfig 已有 PRIMARY/SECONDARY/AUXILIARY、视锥、ambient 字段（`dynfog/light/config.ts:23-32`），可沿用，而不是另造 shader。
- 模式、所有权、玩家身份、场景变化时更新本地允许集合。关闭共享必须先撤销旧可见范围，再产生新范围；未来历史记录不能因开关被不可逆地混到个人历史里。
- 与 S&S/其他迷雾扩展同时启用时明确哪一个系统管理视野；Suite 不能声称控制了其他扩展创建的全部 Light。

SDK Light 本身是 local-only，适合每客户端独立设置可见集合。[Light API](https://docs.owlbear.rodeo/extensions/reference/items/light/)。以上方案尚未实现或房间验证。

## 2. 最新引擎的性能基础与验证候选

### 已经存在的改进，不能作为“待从零实现”重复开工

- `dynfog/reconcile/Reconciler.ts:76-95` 使用完整场景快照生成差异并统一执行 after-hooks；不是旧版每个 watcher 都重新拉取一次全场。
- `dynfog/reconcile/Patcher.ts:44-64` 同步捕获一批改动，再通过 Promise 队列串行提交；旧版“50ms 去抖没有串行化”的指控不适用于这里。
- `dynfog/reconcile/actors/WallActor.ts:159-173` 签名包含 lastModified、坐标变换和门洞签名；同数量顶点变化不会仅因数量相同被跳过。`132-149` 还比较派生点，避免所有墙无条件重写。
- `dynfog/light/wallIndex.ts:93-159` 已有网格空间索引、重复测试标记和单元数量约束；`light/occlusion.ts:113-120` 按墙几何签名缓存索引。

### P1 候选：新建 Light 在授权隐藏前存在一次可见提交

这是最新源码与线上表达式都支持的执行顺序推导，**未进行真实房间复现**：

1. `LightActor.ts:50` 将 `allowed` 初始化为 true；`52-61` 构建并排队新 Light，`105` 使用 `parent.visible && allowed`，普通可见 NPC 火把因此先产生 visible=true 的对象。
2. `light/occlusion.ts:95-102` 在 after-hook 中计算该光源不允许可见，调用 `setAllowed(false)`。
3. `LightActor.ts:87-96` 把隐藏操作放进 updates 队列，没有修改原 additions 中的对象。
4. `Patcher.ts:89-108` 先 await addItems，再 await updateItems，形成两个 SDK 提交。引擎代码自己的批处理说明也承认两次调用之间可能渲染。

复现场景：玩家自己的灯与 NPC 灯分处封闭墙两侧，保持光源遮挡开启，然后新增 NPC 灯或让玩家重进重建；录制玩家端是否闪现远方灯区。只有真房间才能判定这段中间状态实际是否可见及持续多久。

建议修法：权限未计算完成的新 Light 默认不显示，或在提交前将同批次可见性 updates 合并进 additions，再一次性发出最终对象。不要简单把全局提交顺序改成“先删除再添加”，因为墙体收缩时原实现特意先增后减来避免开口漏视野。

### P2 候选：失败后账本可能不再重试

`Patcher.ts:94-115` 对失败记录日志后继续，丢弃该批次；Reconciler 已更新 prevItems、Reactor 已保存 actor，LightActor 的 allowed 状态也已更新。没有找到将失败 ID 标记为待重试/重建的反馈路径。同一父对象没有再次改变时，后续无关场景快照可能不会重新创建缺失的本地对象。

建议注入一次 add/update/delete 拒绝，确认恢复后无需刷新页面即可自愈；记录 affected IDs 和场景代号。当前日志只有操作类型和异常，缺少批次对象 ID。不要把这项写成已证实的用户故障；它是应优先验证的静态风险。

### 渲染成本

`WallActor.ts:294` 仍生成双面墙。官方说明 sourceRadius=0 可使用较快硬阴影路径，但场景存在双面墙时会迫使所有灯走软阴影路径，SECONDARY 还可能额外渲染一次阴影。因此只改源半径不能保证提速，直接取消双面墙可能改变遮挡正确性。[官方 Dynamic Fog 性能说明](https://docs.owlbear.rodeo/extensions/reference/dynamic-fog/#performance)。

下一步应测大量墙、少量角色灯、大量环境灯、门开关、共享模式切换的玩家端耗时，再决定几何/光源预算；不要宣称已取得 FPS 提升。

## 3. S&S 与高性能历史迷雾（最低优先级）

本次只读作者公开说明和 manifest，公开 manifest 返回 S&S `4.20`；未下载或复制它的运行脚本、shader、美术或音效。未找到可验证的作者源仓库及许可证；GitHub API 一度返回限额，不能把搜索不到仓库解释为确定闭源，也不能把网站可读解释为允许复制。

作者公开说明涵盖所有者/关联视野、门窗、视锥、灰度视野、层高、UVTT 导入、探索保留及指定玩家可见对象。关键限制：其 Trailing Fog 和 Autohide 在商店说明中仍标记 beta，说明不检查碰撞；探索保留描述为记录角色停留处。Spectre 会把共享对象转为本地对象，作者也列出与其他扩展及移动平滑度的兼容限制。[作者发布的 S&S 文档](https://extensions.owlbear.rodeo/smoke)。

因此可以研究公开功能和用户流程，但不能认为复刻其功能名就等于“墙后不泄漏、完整记录途经区域、无限地图高精度历史”。官方 [dynamic-fog 示例仓库](https://github.com/owlbear-rodeo/dynamic-fog) 标示 GPL-3.0；那是 Owlbear 项目的许可证，不是 S&S 许可证。最新 Suite 引擎源码已有 upstream port 说明，后续应保持对应归属与授权文件。

当前最新 `dynfog` 源码未发现探索历史存储/累积模块；这只是源码检索结论，非遍历所有运行态的证明。

推荐路线：

1. 保留原生实时 Light/Wall；调查官方是否提供遮挡后可见几何或遮罩读取接口。本次已读文档没有给出此接口，不假设可以读取引擎 GPU fog 纹理。
2. 历史按场景、玩家授权、地图坐标系和格式版本独立记录；共享只影响显示合成，保留个人历史隔离。
3. 若必须自算可见区域，沿用现有空间索引，比较分块几何与分块遮罩；后台预算受控，不为每个移动点永远新增一个场景图元。
4. 普通行走覆盖途经视野；传送不能把起终点之间的直线全部探索。清楚定义采样精度，不能只记录停留点却声称连续完整历史。
5. 先验墙后不泄漏、开关门、离屏探索、换设备和重连，再测 FPS/内存/保存体积。门控制、视锥和共享开关不用等待历史迷雾。
6. Spectre 式迁出共享场景可能影响 Suite 血条、状态、角色绑定，不建议为了特殊观感直接采用该对象迁移方案。

## 4. Token 平滑跟随

线上 stable/dev 的模块表都没有 follow 注册，state 中 follow 默认 false；最新源 `src/background.ts:16-18` 明确保留的是下线实验。不能把旧实验的 A* 卡顿当作当前线上正在执行的路径。

SDK 有可用的平滑基础：`OBR.interaction` 对网络快照插值，高频本地更新经过低频网络采样后在远端平滑播放；单次交互 30 秒后停止网络发送，而本地仍可继续更新。[Interaction API](https://docs.owlbear.rodeo/extensions/apis/interaction/)。

可行性建议分为两个用户场景：

- **骑乘/挂件同移**：先测原生 attachment，减少每帧同步。必须保留原父子关系，验证缩放、旋转、权限、碰撞和解除。官方 Item 支持 attachedTo 及 attachment 行为配置。[Item API](https://docs.owlbear.rodeo/extensions/reference/items/item/)。
- **宠物沿路追随**：目标放手后，唯一执行端规划路径并用 interaction 播放，按实际世界距离计算速度，处理取消和 30 秒续期。若要求在原生拖动过程中紧跟，必须先证明 SDK 能取得目标在途轨迹；已读接口不能保证它，可能需要专用组拖动模式。

最新源仍保留的旧 follow 实验有可借鉴的教训：`follow/pathfinding.ts:172-173` 直线返回两点，`follow/index.ts:344` 按点数算时间使任意直线距离都只播 150ms；不得原样恢复。其主线程路径规划、按墙数判断失效、多 GM 并行和后台 setInterval 假设也需要重评。这些是**未启用代码的复用风险**，不是当前线上运行故障。

验收必须在 DM+两玩家检查：长直线/拐角、多 GM、连续改目标、玩家手动抢控 follower、移动同数量墙、解除、切场景、网络抖动和超过 30 秒的路径。用户已报告卡顿，新方向须有真房间证据。

## 5. 音乐板恢复与所有玩家控制

### 当前线上状态

两个线上模块表均未注册 musicBoard；最新源 `src/background.ts:694-699` 明确下线，线上 settings 仍显示“插件内的音乐板已停止维护”。当前 manifest 都有 background_url，未声明 autoplay 权限。

所以当前任务是恢复并重构，不能说在线运行的音乐板已经修好了。留存源码只能解释旧方案的毛病：

- `src/music-board-page.ts:132-187` 在面板 iframe 内创建 AudioContext 和音轨。
- `src/modules/musicBoard/index.ts:194-227` 拖动/重置/缩小/展开时关闭并重开播放器面板。
- `src/music-board-page.ts:490-497` 在 PeerJS 连接关闭时主动停止并清空场景音乐；外部 Studio 关闭或短暂网络断开被等同于“全员停播”。

### 最简产品目标

玩家首次点击“启用声音”，以后打开、关闭音乐面板都只影响界面。默认人人能播放/暂停/排队，主持人可收紧；个人音量和静音不改其他人。常用区只保留当前歌曲、播放、下一首、队列；曲库管理展开后再显示，不要求每场复制配对码。

### 技术先后

1. 先在干净浏览器环境验证 **manifest autoplay + 常驻 background 音频引擎**，面板只发命令。Owlbear 官方支持此 manifest 权限。[Manifest](https://docs.owlbear.rodeo/extensions/reference/manifest/)。
2. 该权限不能保证所有浏览器无需手势。Chrome 文档说明跨域 iframe 需要父文档授权，Web Audio 还受用户激活影响；测试 Chrome/Edge、Firefox、Safari/iOS，再确定回退方式。[Chrome autoplay](https://developer.chrome.com/blog/autoplay/)、[MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)。
3. 音乐会话使用房间生命周期以便跨场景；晚加入从版本快照和播放位置恢复，瞬时音效带 ID/时效去重。短暂连接断开不自动发布停止。
4. 人人可控制通过唯一会话执行者串行接受命令实现，不能所有人并发覆盖整份状态。使用广播 connectionId 对照在线玩家验证权限，主持人改权限即时生效。
5. 若目标浏览器确实限制后台播放，再研究常驻音频表面或可选独立音乐扩展。新扩展可提供独立 action，但无法让已销毁的播放文档继续发声，也不能解决关闭整个房间后的音频生命周期。
6. 本地文件/blob 地址不可直接让所有玩家下载播放；在线直链和本地仅自己播放要明确区分。共享本地音乐另需授权存储或文件传输方案。

只有常驻播放已经验证，再恢复按钮；别先重新接上旧 GM-only 配对弹窗。多客户端验收涵盖关闭面板、切 action、拖动/缩放、玩家同时操作、切场景、关闭 Studio、主持人重进和断线恢复；失败需可见提示及会话/命令/阶段日志。

## 交付范围

本次最终输出只有本审查文档。没有修改共享源码或旧 U 源码，没有修复、构建或部署功能。真实房间验证尚未执行。旧 U 报告已被本文明确取代，不作为当前待修清单使用。
