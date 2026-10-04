# 骰子延迟候选：等待浏览器验证，尚未合并或部署

## 基线与恢复记录

当前候选基于官方 GitHub branches API核实的 Suite dev `7783de080b0a32465150fbb2672daf848d5385b5`，精确配套 Web main `41a652373019cb912edb0fa7e0eef13f702c2fef`。保留244的读取恢复、删除管理、权限与网站链接变化。本地remote refspec只跟踪旧专用分支，普通fetch后的origin引用曾陈旧；最终使用官方API和明确SHA核验，未在旧236基线交付。

本轮最初在0527461/04d8建立候选。2026-10-04 06:56 UTC执行环境恢复到早期快照，未提交的工程树及原始证据丢失；没有推送。随后从精确远端和会话中已记录的源码差量重建，并在最新244上重新测试。Controller SHA256重新得到 `65d96bc1433fcc85e930e664931f8db98ff1ff1992452326ebef68d8409cce59`，与独立审阅版本相同。以下数据均为恢复后的新实测；不把丢失的原JSON当作可交付证据。

## 产品修复

1. 校时使用发送前、对端接收、对端发送、本端接收四个时间戳。扣除100ms节拍队列和串行收件处理等待；短期有效校时不每次投掷重复ping。旧peer缺少新增时间戳时保留旧估计；会话重启清空旧样本。身份、nonce、时间值与处理区间仍校验。
2. 起播在实际发送操作开始时仅安排一次。等待SDK回执不再挡第一帧或下一次允许的物理预测。单骰/群体保留同一有限起播时间和hash；明确限流重试及未知回执继续走235的有界幂等补传，绝不重新取点数或重复本机动画。晚端仍完整播放。此前骰子的物理落稳下界、发起者/本机准备屏障不变。
3. 同一不可变模型的精确轮廓几何在已有透明预编译阶段共享，材质、颜色和动画时钟仍逐骰独立。单骰退出不销毁兄弟实例的几何；源模型销毁会清理缓存。所有轮廓顶点保持一致。

没有改240Hz物理、120Hz权威轨迹、分片/加密/私投可见范围、材质效果、阴影质量、结果动画时长、玩家数据或Web产品代码。协议新增校时字段可被旧端忽略，不强制改变suite-3d-4。

## 恢复后量化结果与边界

真实生产Controller、密钥、编码/组装与100ms队列，10ms单向虚拟网络；物理和renderer为明确stub：

- 最新244基线把约20ms网络RTT估成约212ms，常态起播约0.6–0.75秒。
- 候选三次暖投本机/peer约372–382ms，RTT约20.6ms。
- 400ms SDK回执延迟：双方约381ms起播，回执没有加到视觉等待上。
- 一次明确限流：本机384ms、peer1196ms完整补播；未知起播回执/丢包：本机386ms、peer1866ms由既有补传恢复。故障不是零延迟，不隐瞒两端时差。

这些是协议计时，不能称为真实浏览器首像素或玩家体验。

Node云CPU、真实GLTF、各组10次热构建的中位值：

| 轮廓/材质准备 | 基线 | 候选 |
| --- | ---: | ---: |
| 20骰涂鸦 | 7.84ms | 0.62ms |
| 100骰涂鸦 | 39.70ms | 1.88ms |
| 20骰漫画 | 6.65ms | 0.28ms |
| 100骰漫画 | 32.61ms | 1.48ms |

真实Jolt/WASM及公式的13个恢复后样本全部成功，编码前后姿态逐位、骰值和公式数据一致。冷引擎约72ms，含预掷约101ms；不含网络。1d20约12–24ms，三骰混合约19–22ms，20d6约120–233ms，max(20d6,4)约158–308ms，100d6约1.84秒。13样本仅用于本机阶段定位，不是完整分布或用户设备结果。

真实轨迹1d20与混合三骰均1片，20d6为3–4片，复杂规则5片，100d6为18片。offer到chunks-done至少 `(N+1)×100ms`，另有队列、回执及准备屏障。本批没有为了减少片数改掉轨迹精度。后投骰会撞到前投骰保留的实体，所以必要的落稳/桌面容量等待仍在。

## 新验证结果

- 时钟/起播27项通过；旧基线“四时间戳扣除1600ms排队”明确失败1620≠20，候选通过。
- 真模型几何35项通过，覆盖七种骰型/四种轮廓风格、逐顶点一致、独立材质、退出/回放复用与释放。旧基线复用断言明确失败。
- 双Controller暖投/限流/未知回执/慢ACK四场景通过。
- 235故障保护13、骰子合同36、生命周期18、历史5、群体32通过，计数不相加当独立覆盖。
- 最新244完整Suite回归28组通过；主项目及Dice3D类型检查、dev宿主、实际SDK/renderer生产夹具构建和59项锁定资产校验通过。
- 独立审查发现并已修正慢ACK挡后投预测；未发现最终产品代码阻塞。

原首次整合的全Suite并非全绿：群体测试mock忽略新的dispatch stamp，导致本地start数0≠100。只修mock实际调用stamp，保留100子轨迹、单次共享start及15KB预算断言，恢复后已重新通过。旧235同类mock也按真实合同适配，没有降低断言。

## 复现

```sh
node tools/dice-clock-latency-selftest.mjs
node tools/dice-transport-latency-selftest.mjs
node tools/dice-outline-latency-selftest.mjs
node tools/dice-outline-profile.mjs
node tools/dice-physics-profile.mjs
DND_CARD_WEB_ROOT=/absolute/path/to/paired-Web node tools/verify-suite-candidate.mjs
npx tsc --noEmit
npx tsc -p extensions/workbench-dice3d/tsconfig.json
```

协议基线：在transport命令前设置 `DICE_LATENCY_BASELINE=7783de080b0a32465150fbb2672daf848d5385b5 DICE_TRANSPORT_SCENARIO=warm`。时钟负对照：在clock命令前设置同baseline和 `DICE_CLOCK_CASE='four timestamps'`，预期非零退出。

## 浏览器仍待验证

原环境Chromium实际启动因AF_UNIX `socket() failed: Operation not permitted`失败，未绕过限制。恢复后仍按同环境限制工作。没有浏览器帧率、截图、视频或真实房间通过结果。

已备手动 `Profile dice latency candidate` 工作流；基线/候选使用相同测试代码和固定每客户端提交seed、同一1280×800/DPR1画质。尚未推送或触发。可在可运行的授权环境执行：

```sh
DND_CARD_WEB_ROOT=/absolute/path/to/paired-Web node tools/dice-latency-build.mjs
DICE_LATENCY_SOFTWARE=1 DICE_LATENCY_RECOVERY=1 node tools/dice-latency-browser.mjs
```

夹具使用真实SDK、Jolt、WASM和WebGL，以虚拟双端网络覆盖角色卡快捷RPC入口、冷准备/共享缓存准备、连续单骰、复杂式、多骰、双端同时投、私投、群体及三种235故障。每个故障要求实际注入计数非零，核对双方骰值/总数与私有结果不外泄；保存实际renderer身份、截图、视频、阶段时间和长任务。

提交帧指标是WebGL render的CPU返回时刻，rAF指标是调度间隔，均不代表GPU呈现。并发固定seed不固定跨客户端排队次序；不宣称前后轨迹逐字相同。软件WebGL仅验证协议/演出；真实硬件卡顿、玩家原线路与账号房间仍待验证，不能用CI绿替代体验验收。

## 07:28 UTC 推送与 CI 授权后的准备

官方 API 再次核实 Suite dev 已到 `ca684455cef7decacb8bd0d5cffc011b77b500a3`，差量仅244发布记录；候选无冲突移到该最新底。产品 Controller 的 SHA256 未变化。浏览器两组基线固定为该 SHA，同测量代码、同一最终 Web 候选。新增仅本次独立分支的 push 触发（新 workflow 不在默认分支时不可依赖 dispatch），并保留全 Suite 回归工作流。浏览器夹具显式定时轮询隐藏 SDK iframe，等待结果通道收齐再比较，失败保留截图与运行状态。这些是测量工具修复，没有改变骰子产品路径。CI 的实际结果另记，不预先称通过。

本次候选浏览器 CI 的精确 Web 配对为三项 UI 集成提交 `f9bfb7e2ba12e6ef338f9ec505473bb944e00bfd`（远端 tree `385d13ead25bb58ecbe3a0e72fc1e946541fdaf2`）。两组性能及完整 Suite 回归均使用同一 Web SHA。

## 首轮真实浏览器结果（68fe10a；Web f9bfb7e）

完整 Suite CI `37186553439` 与双组性能 CI `37186553478` 全绿。不是体验通过：1280×800 / DPR1 / SwiftShader，baseline与candidate分属不同CI机器，16种case均完成且权限/结果一致，但软件渲染极慢。

- 三轮暖单骰双端共6读数，首次WebGL提交中位数 2065→1553ms；角色卡快捷RPC约4123→3206/3384ms。
- 暖单骰帧P95中位数375→417ms；20骰由933–950→1033–1050ms。这一轮没有证明渲染改善，慢ACK和冷初始化也没有改善。
- 20骰演出声明10.737秒，但真实视频/事件实际74→约78秒，两版均发生约108次重新计时；不能把完成断言当作流畅。
- 物理阶段暖单骰31–57ms、20骰307ms；首次release到CPU绘制返回额外448–1064ms。持续帧间隔不能全部解释成JS时间，软件GPU/呈现等待需单独诊断。
- 录像两端可见骰子、数字、私骰问号；首轮Player视频尾部未录到最后一轮最终20/退出。完成JSON有20，但视频收尾证据不足。后续夹具已补空闲帧检查、尾缓冲及最终截图。

后续新增单客户端固定真实姿态渲染A/B：保持分辨率、阴影2048²/PCF、模型和公式不变，比较编译期style常量、阴影重复pass、全屏透明地面与轮廓成本、保守scissor。降画质诊断项只定位，不作为产品交付；宣称无损的项需逐通道像素相等。测试hook只存在诊断构建。当前尚未把这些实验应用到产品。最终Web配对推进至测试夹具修订 `05dcfdb645339cac9f68d1f6009f44b7e63d5c25`，三项UI生产源码未变化。
